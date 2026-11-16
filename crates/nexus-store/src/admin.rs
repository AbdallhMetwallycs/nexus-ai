//! Backup, restore, export and purge — the operations that touch the owner's data as a
//! whole, and therefore the ones that must be the most careful.
//!
//! `backup()` uses SQLite's online backup API rather than copying the main file: that is the
//! only way to get a consistent copy without assuming the WAL checkpoint succeeded while
//! another reader holds a frame.
//! `restore()` verifies the source, preserves the current database first, then copies the
//! source *into* the live connection, so no file is ever replaced under an open handle.

use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};

use crate::types::{BackupInfo, BackupRecord, RestoreInfo};
use crate::{iso_days_ago, new_id, now_iso, Store, StoreError, StoreResult, SCHEMA_VERSION};

impl Store {
    pub fn backup(&self, dir: Option<&Path>, now: &str) -> StoreResult<BackupInfo> {
        if !self.is_persistent() {
            return Err(StoreError::internal(
                "This core is running on an in-memory database; there is nothing to back up.",
            ));
        }
        let dir = dir
            .map(Path::to_path_buf)
            .or_else(|| self.path.parent().map(|p| p.join("backups")))
            .unwrap_or_else(|| PathBuf::from("backups"));
        std::fs::create_dir_all(&dir)?;

        let stamp: String = now.chars().filter(|c| c.is_ascii_digit()).collect();
        let dest = dir.join(format!("nexus-backup-{stamp}-{}.db", new_id("b").rsplit('-').next().unwrap_or("0")));

        let mut target = Connection::open(&dest)?;
        {
            let backup = rusqlite::backup::Backup::new(&self.conn, &mut target)?;
            backup.run_to_completion(128, Duration::from_millis(5), None)?;
        }
        // The online backup leaves a single file; a checkpoint here is belt-and-braces for
        // builds that open the copy with WAL enabled.
        let _: (i64, i64, i64) = target.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?;
        drop(target);

        // Integrity is checked on the copy, never on the live file (PHASE2_DATA_MODEL.md §7).
        let verified = {
            let check = Connection::open_with_flags(&dest, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            let result: String = check.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            result == "ok"
        };
        if !verified {
            let _ = std::fs::remove_file(&dest);
            return Err(StoreError::corrupt(
                "The backup copy failed its own integrity check and was discarded.",
            ));
        }

        let bytes = std::fs::metadata(&dest)?.len();
        let schema_version = self.schema_version()?;
        self.conn.execute(
            "INSERT INTO backup_record (id, name, path, size_bytes, created_at, schema_version,
                                         verified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
            rusqlite::params![
                new_id("bk"),
                dest.file_name().and_then(|n| n.to_str()).unwrap_or("backup.db"),
                dest.to_string_lossy(),
                bytes as i64,
                now,
                schema_version
            ],
        )?;
        Ok(BackupInfo {
            path: dest.to_string_lossy().into_owned(),
            bytes,
            schema_version,
            verified,
        })
    }

    pub fn backups(&self) -> StoreResult<Vec<BackupRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, path, size_bytes, created_at, schema_version, verified
             FROM backup_record ORDER BY created_at DESC, rowid DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(BackupRecord {
                id: r.get(0)?,
                name: r.get(1)?,
                path: r.get(2)?,
                size_bytes: r.get(3)?,
                created_at: r.get(4)?,
                schema_version: r.get(5)?,
                verified: r.get::<_, i64>(6)? != 0,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn restore(&mut self, from: &Path, now: &str) -> StoreResult<RestoreInfo> {
        if !self.is_persistent() {
            return Err(StoreError::internal(
                "This core is running on an in-memory database; restore needs a real data file.",
            ));
        }
        if !from.is_file() {
            return Err(StoreError::new(
                "validation.field",
                format!("path: “{}” is not a file", from.display()),
            ));
        }
        {
            let source = Connection::open_with_flags(from, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| StoreError::corrupt(format!("backup could not be opened: {e}")))?;
            let integrity: String = source
                .query_row("PRAGMA integrity_check", [], |r| r.get(0))
                .map_err(|e| StoreError::corrupt(format!("backup is unreadable: {e}")))?;
            if integrity != "ok" {
                return Err(StoreError::corrupt(format!(
                    "backup failed integrity_check: {integrity}"
                )));
            }
            let version: i64 = source.query_row("PRAGMA user_version", [], |r| r.get(0))?;
            if version == 0 || version > SCHEMA_VERSION {
                return Err(StoreError::corrupt(format!(
                    "backup schema v{version} is not supported by this build (v{SCHEMA_VERSION})"
                )));
            }
        }

        // The most destructive operation the app offers preserves what it is about to
        // replace, before touching it.
        let previous = self.backup(None, now)?;
        let known_backups = self.backups().unwrap_or_default();

        let source = Connection::open_with_flags(from, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        {
            let backup = rusqlite::backup::Backup::new(&source, &mut self.conn)?;
            backup.run_to_completion(128, Duration::from_millis(5), None)?;
        }
        self.conn.pragma_update(None, "foreign_keys", "ON")?;
        crate::migrate(&self.conn)?;
        // The restored snapshot predates the backup rows written since it was taken; the
        // files still exist, so their records are restored too rather than forgotten.
        for record in known_backups {
            self.conn.execute(
                "INSERT OR IGNORE INTO backup_record (id, name, path, size_bytes, created_at,
                                                      schema_version, verified)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    record.id,
                    record.name,
                    record.path,
                    record.size_bytes,
                    record.created_at,
                    record.schema_version,
                    i64::from(record.verified)
                ],
            )?;
        }
        self.conn.execute(
            "UPDATE app_state SET last_opened_at = ?1 WHERE id = 1",
            [now_iso()],
        )?;
        self.seed_defaults(now)?;

        let _ = self.record_activity(
            "task",
            "Restored the local database",
            &format!(
                "Restored from {} after preserving {}",
                from.display(),
                previous.path
            ),
            None,
            "success",
            None,
            None,
            now,
        );

        Ok(RestoreInfo {
            restored_at: now.to_owned(),
            previous_backup: previous.path,
        })
    }

    /// Owner data only: conversations, messages, memories, knowledge metadata and settings.
    /// Model weights and cache are excluded by construction (PHASE2_DATA_MODEL.md §7).
    pub fn export_owner_data(&self, path: &Path, format: &str, now: &str) -> StoreResult<u64> {
        if format != "json" {
            return Err(StoreError::new(
                "validation.field",
                "format: store.export writes json; activity.export writes json or csv",
            ));
        }
        let (conversations, _) = self.list_conversations(None, usize::MAX, 0)?;
        let detailed: Vec<_> = conversations
            .iter()
            .filter_map(|c| self.get_conversation(&c.id).ok())
            .collect();
        let (memories, _) = self.list_memory(None, None, None, usize::MAX, 0)?;
        let settings = self.settings()?;
        let documents: Vec<serde_json::Value> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, name, collection, file_type, path, size_bytes, indexed, updated_at
                 FROM kb_document ORDER BY name",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "name": r.get::<_, String>(1)?,
                    "collection": r.get::<_, String>(2)?,
                    "fileType": r.get::<_, String>(3)?,
                    "path": r.get::<_, String>(4)?,
                    "sizeBytes": r.get::<_, i64>(5)?,
                    "indexed": r.get::<_, String>(6)?,
                    "updatedAt": r.get::<_, String>(7)?,
                }))
            })?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row?);
            }
            out
        };

        let payload = serde_json::json!({
            "app": "NEXUS AI",
            "exportedAt": now,
            "schemaVersion": self.schema_version()?,
            "conversations": detailed,
            "memories": memories,
            "documents": documents,
            "settings": settings,
        });
        let body = serde_json::to_string_pretty(&payload).map_err(|e| {
            StoreError::internal("The export could not be serialised.").with_detail(e.to_string())
        })?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, body.as_bytes())?;
        let _ = self.record_activity(
            "task",
            "Exported owner data",
            &format!("JSON export, {} bytes, {}", body.len(), path.display()),
            None,
            "success",
            None,
            None,
            now,
        );
        Ok(body.len() as u64)
    }

    /// Purge is owner-triggered only (PHASE2_DATA_MODEL.md §5). Returns `(rows, freedBytes)`.
    pub fn purge(&self, kind: &str, now_ms: u64) -> StoreResult<(usize, u64)> {
        let before = self.file_size();
        let removed = match kind {
            "activity" => self.purge_activity_before(&iso_days_ago(now_ms, 90))?,
            "learning" => self.conn.execute(
                "DELETE FROM learning WHERE resolved = 1 AND resolved_at IS NOT NULL
                   AND resolved_at < ?1",
                [iso_days_ago(now_ms, 180)],
            )?,
            "short_term_memory" => {
                let old_short = self.conn.execute(
                    "DELETE FROM memory WHERE tier = 'short' AND updated_at < ?1",
                    [iso_days_ago(now_ms, 1)],
                )?;
                let old_archive = self.conn.execute(
                    "DELETE FROM memory WHERE archived_at IS NOT NULL AND archived_at < ?1",
                    [iso_days_ago(now_ms, 30)],
                )?;
                old_short + old_archive
            }
            "cache" => 0, // no derived cache exists until M3's parsers write one
            other => {
                return Err(StoreError::new(
                    "validation.field",
                    format!("kind: “{other}” is not a purge kind"),
                ))
            }
        };
        let freed = if removed > 0 && self.is_persistent() {
            let _ = self.conn.execute_batch("VACUUM");
            before.saturating_sub(self.file_size())
        } else {
            0
        };
        Ok((removed, freed))
    }

    /// Bytes on disk for the database plus its WAL, when it is a file.
    pub fn file_bytes(&self) -> u64 {
        self.file_size()
    }

    fn file_size(&self) -> u64 {
        std::fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0)
    }
}
