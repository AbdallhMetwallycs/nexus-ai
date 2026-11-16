//! NEXUS AI local store (Phase 2, M2).
//!
//! SQLite through `rusqlite`, bundled, WAL, foreign keys on per connection, migrations
//! numbered as SQL files and applied inside one transaction. The design of record is
//! `PHASE2_DATA_MODEL.md`; this crate is its executable half.
//!
//! Rules this crate keeps:
//!  - **No fabrication.** A missing row is `validation.unknown_id`, a broken file is
//!    `store.corrupt`, contention is `store.busy`. Nothing is silently defaulted into a
//!    success.
//!  - **Backups are verified copies.** `backup()` checkpoints the WAL, copies the file, and
//!    runs `PRAGMA integrity_check` on the copy before writing a `backup_record` row.
//!  - **Restore backs up first.** The operation that overwrites the owner's data begins by
//!    preserving it, and refuses to run on a file that fails its own integrity check.

mod activity;
mod admin;
mod chat;
mod memory;
mod settings;
pub mod types;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

pub use types::*;

/// Schema version of the migration set. `PRAGMA user_version` carries it.
pub const SCHEMA_VERSION: i64 = 1;

const INIT_SQL: &str = include_str!("migrations/0001_init.sql");

/// Errors carry the dotted contract code so `nexus-core` can translate without guessing.
#[derive(Debug, Clone, PartialEq)]
pub struct StoreError {
    pub code: &'static str,
    pub message: String,
    pub detail: Option<String>,
}

impl StoreError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), detail: None }
    }

    pub fn corrupt(detail: impl Into<String>) -> Self {
        Self::new("store.corrupt", "The local database could not be opened cleanly.")
            .with_detail(detail)
    }

    pub fn busy(detail: impl Into<String>) -> Self {
        Self::new("store.busy", "The local database is busy; try again.").with_detail(detail)
    }

    pub fn unknown_id(kind: &str, id: &str) -> Self {
        Self::new(
            "validation.unknown_id",
            format!("No {kind} with id “{id}” exists in the local store."),
        )
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} [{}]", self.message, self.code)
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(err: rusqlite::Error) -> Self {
        match &err {
            rusqlite::Error::SqliteFailure(code, message)
                if matches!(
                    code.code,
                    rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
                ) =>
            {
                StoreError::busy(message.clone().unwrap_or_else(|| err.to_string()))
            }
            _ => StoreError::internal("The local database rejected the statement.")
                .with_detail(err.to_string()),
        }
    }
}

impl From<std::io::Error> for StoreError {
    fn from(err: std::io::Error) -> Self {
        StoreError::internal("A file operation for the local store failed.")
            .with_detail(err.to_string())
    }
}

pub type StoreResult<T> = Result<T, StoreError>;

pub struct Store {
    conn: Connection,
    path: PathBuf,
}

impl Store {
    /// Open (creating parents) and migrate. A schema newer than this build refuses to open
    /// rather than risk writing through an unknown shape.
    pub fn open(path: impl AsRef<Path>) -> StoreResult<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                StoreError::corrupt(format!("{} could not be created: {e}", parent.display()))
            })?;
        }
        let conn = Connection::open(&path).map_err(|e| {
            StoreError::corrupt(format!("{} could not be opened: {e}", path.display()))
        })?;
        Self::configure(&conn)?;
        migrate(&conn)?;
        let store = Store { conn, path };
        store.touch_opened()?;
        store.seed_defaults(&now_iso())?;
        Ok(store)
    }

    /// In-memory database for tests and for a core constructed without a data directory.
    /// Persistence is impossible here by construction, which is why the Tauri host always
    /// uses [`Store::open`].
    pub fn open_in_memory() -> StoreResult<Self> {
        let conn = Connection::open_in_memory()?;
        Self::configure(&conn)?;
        migrate(&conn)?;
        let store = Store { conn, path: PathBuf::from(":memory:") };
        store.seed_defaults(&now_iso())?;
        Ok(store)
    }

    fn configure(conn: &Connection) -> StoreResult<()> {
        conn.busy_timeout(Duration::from_millis(5_000))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // WAL is the design choice. An in-memory database reports "memory" here; that is
        // not an error, it is the only honest answer for a file that does not exist.
        let _mode: String = conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn is_persistent(&self) -> bool {
        self.path.as_os_str() != ":memory:"
    }

    /// Raw connection, for the crate's own tests only. Modules in this crate use the field.
    #[cfg(test)]
    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn schema_version(&self) -> StoreResult<i64> {
        Ok(self.conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
    }

    /// Returns `["ok"]` on a clean database, or SQLite's list of problems.
    pub fn integrity_check(&self) -> StoreResult<Vec<String>> {
        let mut stmt = self.conn.prepare("PRAGMA integrity_check")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Per-call timestamp writer used by commands; kept in one place so every row is
    /// comparable and sortable as text.
    pub fn now(&self) -> String {
        now_iso()
    }

    fn touch_opened(&self) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE app_state SET last_opened_at = ?1 WHERE id = 1",
            [now_iso()],
        )?;
        Ok(())
    }

    fn seed_defaults(&self, now: &str) -> StoreResult<()> {
        // Only keys the UI needs to honour a restart. Existing owner values are never
        // overwritten: INSERT OR IGNORE, not REPLACE.
        self.conn.execute(
            "INSERT OR IGNORE INTO settings (section, key, value, value_kind, measured, updated_at)
             VALUES ('appearance', 'theme', '\"dark\"', 'json', 0, ?1)",
            [now],
        )?;
        Ok(())
    }
}

fn migrate(conn: &Connection) -> StoreResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if current > SCHEMA_VERSION {
        return Err(StoreError::corrupt(format!(
            "the database schema is v{current} but this build understands v{SCHEMA_VERSION}; \
             open it with a newer NEXUS build or restore an older backup"
        )));
    }
    if current == 0 {
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let applied = conn
            .execute_batch(INIT_SQL)
            .and_then(|_| conn.pragma_update(None, "user_version", SCHEMA_VERSION));
        match applied {
            Ok(()) => conn.execute_batch("COMMIT")?,
            Err(err) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(StoreError::corrupt(format!("migration 0001 failed: {err}")));
            }
        }
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Time and ids                                                        */
/* ------------------------------------------------------------------ */

pub fn now_iso() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    iso8601_utc(ms)
}

/// ISO-8601 UTC from milliseconds. Same civil-date algorithm as `nexus-core::system`, kept
/// here so the store has no dependency on the engine crate.
pub fn iso8601_utc(ms_since_epoch: u64) -> String {
    let secs = (ms_since_epoch / 1000) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{year:04}-{month:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Date arithmetic for purge cutoffs, without a calendar dependency.
pub(crate) fn iso_days_ago(now_ms: u64, days: u64) -> String {
    iso8601_utc(now_ms.saturating_sub(days * 86_400_000))
}

pub(crate) fn new_id(prefix: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{n}", now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ActivityFilter, Attachment};

    fn temp_db(tag: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "nexus-store-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("nexus.db");
        (dir, db)
    }

    #[test]
    fn migrations_apply_from_empty_and_integrity_is_clean() {
        let (dir, db) = temp_db("migrate");
        let store = Store::open(&db).unwrap();
        assert_eq!(store.schema_version().unwrap(), SCHEMA_VERSION);
        assert_eq!(store.integrity_check().unwrap(), vec!["ok".to_owned()]);
        // Derived tables that M3 depends on exist, which is also the FTS5 flag check.
        let fts: i64 = store
            .conn()
            .query_row("SELECT COUNT(*) FROM fts_message", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fts, 0);
        drop(store);

        // Reopening an already-migrated file must not re-run the migration.
        let again = Store::open(&db).unwrap();
        assert_eq!(again.schema_version().unwrap(), SCHEMA_VERSION);
        assert_eq!(again.integrity_check().unwrap(), vec!["ok".to_owned()]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn conversation_crud_message_counts_and_titles() {
        let (dir, db) = temp_db("conv");
        let store = Store::open(&db).unwrap();
        let now = "2026-11-17T10:00:00Z";
        let conv = store.create_conversation(None, "universal", "llama", now).unwrap();
        assert_eq!(conv.title, "New conversation");

        let user_id = store
            .append_user_message(
                &conv.id,
                "Explain the rental clause\nsecond line",
                &[Attachment { name: "lease.pdf".into(), kind: "pdf".into(), size_kb: 12 }],
                Some("llama"),
                Some("universal"),
                "2026-11-17T10:00:01Z",
            )
            .unwrap();
        assert!(user_id.starts_with('u'));

        store
            .finish_assistant_message(
                &conv.id,
                "a-1",
                "The clause says 12 months.",
                false,
                Some(40),
                Some(12),
                Some(2_500),
                Some("llama"),
                Some("universal"),
                "2026-11-17T10:00:04Z",
            )
            .unwrap();

        let full = store.get_conversation(&conv.id).unwrap();
        assert_eq!(full.title, "Explain the rental clause");
        assert_eq!(full.messages.len(), 2);
        assert_eq!(full.messages[1].usage, Some(Usage { prompt: 40, completion: 12 }));
        assert_eq!(full.messages[0].attachments.as_ref().unwrap()[0].size_kb, 12);

        let (list, total) = store.list_conversations(Some("rental"), 10, 0).unwrap();
        assert_eq!(total, 1);
        assert_eq!(list[0].message_count, 2);

        store.rename_conversation(&conv.id, "Lease questions").unwrap();
        store.set_pinned(&conv.id, true).unwrap();
        assert!(store.get_conversation(&conv.id).unwrap().pinned);

        store.clear_messages(&conv.id, "2026-11-17T10:01:00Z").unwrap();
        assert!(store.get_conversation(&conv.id).unwrap().messages.is_empty());
        let (list, _) = store.list_conversations(None, 10, 0).unwrap();
        assert_eq!(list[0].message_count, 0);

        store.delete_conversation(&conv.id).unwrap();
        assert_eq!(store.list_conversations(None, 10, 0).unwrap().1, 0);
        assert_eq!(
            store.get_conversation(&conv.id).unwrap_err().code,
            "validation.unknown_id"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn settings_survive_a_reopen() {
        let (dir, db) = temp_db("settings");
        {
            let store = Store::open(&db).unwrap();
            let mut values = serde_json::Map::new();
            values.insert("theme".into(), serde_json::json!("light"));
            values.insert("fontScale".into(), serde_json::json!(1.1));
            store.patch_settings("appearance", &values, "2026-11-17T10:00:00Z").unwrap();
            store
                .set_setting("models", "active", &serde_json::json!("llama"), false, "2026-11-17T10:00:01Z")
                .unwrap();
        }
        let store = Store::open(&db).unwrap();
        let snapshot = store.settings().unwrap();
        assert_eq!(snapshot.sections["appearance"]["theme"], serde_json::json!("light"));
        assert_eq!(snapshot.sections["appearance"]["fontScale"], serde_json::json!(1.1));
        assert_eq!(snapshot.sections["models"]["active"], serde_json::json!("llama"));
        assert!(snapshot.sections.contains_key("backup"));
        assert!(store
            .patch_settings("nope", &serde_json::Map::new(), "2026-11-17T10:00:00Z")
            .is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn activity_is_filterable_and_exportable() {
        let (dir, db) = temp_db("activity");
        let store = Store::open(&db).unwrap();
        store
            .record_activity("model", "Loaded llama", "2.3 GB private", None, "success", None, None, "2026-11-17T10:00:00Z")
            .unwrap();
        store
            .record_activity("warning", "Stopped an answer", "1 character", None, "success", None, None, "2026-11-17T10:01:00Z")
            .unwrap();

        let all = ActivityFilter {
            kind: None,
            agent_id: None,
            query: None,
            from: None,
            to: None,
            limit: 10,
            offset: 0,
        };
        assert_eq!(store.list_activity(&all).unwrap().1, 2);
        let only_warning = ActivityFilter { kind: Some("warning".into()), ..all.clone() };
        let (items, total) = store.list_activity(&only_warning).unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].title, "Stopped an answer");
        assert_eq!(store.get_activity(&items[0].id).unwrap().kind, "warning");

        let csv = dir.join("activity.csv");
        let (bytes, events) = store.export_activity(&csv, "csv", "2026-11-17T10:02:00Z").unwrap();
        assert!(bytes > 0);
        assert_eq!(events, 2);
        let body = std::fs::read_to_string(&csv).unwrap();
        assert!(body.starts_with("id,ts,kind,title"));
        assert!(body.contains("Stopped an answer"));

        assert_eq!(store.purge("activity", 0).unwrap().0, 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn memory_pending_is_stored_and_archiving_hides_it() {
        let (dir, db) = temp_db("memory");
        let store = Store::open(&db).unwrap();
        let pending = store
            .create_memory("preference", "Tone", "Prefers concise answers", "chat", &[], "pending", "2026-11-17T10:00:00Z")
            .unwrap();
        assert_eq!(store.list_memory(None, Some("pending"), None, 10, 0).unwrap().1, 1);
        store.set_memory_approval(&pending.id, "approved", "2026-11-17T10:01:00Z").unwrap();
        let approved = store.get_memory(&pending.id).unwrap();
        assert_eq!(approved.approval, "approved");
        assert_eq!(approved.history.len(), 2);
        store.archive_memory(&pending.id, "2026-11-17T10:02:00Z").unwrap();
        assert_eq!(store.list_memory(None, None, None, 10, 0).unwrap().1, 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn backup_then_restore_keeps_rows_and_writes_a_pre_restore_copy() {
        let (dir, db) = temp_db("backup");
        let mut store = Store::open(&db).unwrap();
        let conv = store
            .create_conversation(Some("Keep me"), "universal", "llama", "2026-11-17T10:00:00Z")
            .unwrap();
        store
            .append_user_message(&conv.id, "first", &[], None, None, "2026-11-17T10:00:01Z")
            .unwrap();

        let backup = store.backup(None, "2026-11-17T10:01:00Z").unwrap();
        assert!(backup.verified);
        assert!(std::path::Path::new(&backup.path).is_file());
        assert!(backup.bytes > 0);
        let rows_before = store.list_conversations(None, 10, 0).unwrap().1;

        // Mutate after the backup so restore has something real to undo.
        store.delete_conversation(&conv.id).unwrap();
        assert_eq!(store.list_conversations(None, 10, 0).unwrap().1, 0);

        let restored = store.restore(std::path::Path::new(&backup.path), "2026-11-17T10:02:00Z").unwrap();
        assert!(std::path::Path::new(&restored.previous_backup).is_file());
        assert_eq!(store.list_conversations(None, 10, 0).unwrap().1, rows_before);
        assert_eq!(store.get_conversation(&conv.id).unwrap().title, "Keep me");
        assert!(store.backups().unwrap().len() >= 2);

        // Corruption is refused before anything is touched.
        let junk = dir.join("junk.db");
        std::fs::write(&junk, b"not a database").unwrap();
        let err = store.restore(&junk, "2026-11-17T10:03:00Z").unwrap_err();
        assert_eq!(err.code, "store.corrupt");
        assert_eq!(store.list_conversations(None, 10, 0).unwrap().1, rows_before);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn export_contains_owner_data_and_no_weights() {
        let (dir, db) = temp_db("export");
        let store = Store::open(&db).unwrap();
        store
            .create_conversation(Some("Exported"), "universal", "llama", "2026-11-17T10:00:00Z")
            .unwrap();
        let out = dir.join("export.json");
        let bytes = store.export_owner_data(&out, "json", "2026-11-17T10:01:00Z").unwrap();
        assert_eq!(bytes, std::fs::metadata(&out).unwrap().len());
        let body = std::fs::read_to_string(&out).unwrap();
        assert!(body.contains("Exported"));
        assert!(!body.to_lowercase().contains(".gguf"));
        assert!(store.export_owner_data(&out, "csv", "2026-11-17T10:02:00Z").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The child of [`a_killed_writer_leaves_a_clean_database`]. Under normal test runs the
    /// env var is absent and this returns immediately.
    #[test]
    fn crash_writer_child() {
        let Ok(db) = std::env::var("NEXUS_CRASH_CHILD_DB") else {
            return;
        };
        let store = Store::open(&db).unwrap();
        store
            .record_activity("task", "committed before crash", "must survive", None, "success", None, None, "2026-11-17T10:00:00Z")
            .unwrap();
        // A real write, inside a real transaction, with the process killed before COMMIT.
        store
            .conn()
            .execute_batch(
                "BEGIN IMMEDIATE;
                 INSERT INTO activity (id, ts, kind, title, detail, status)
                 VALUES ('act-crash', '2026-11-17T10:00:01Z', 'task', 'uncommitted', 'must not survive', 'running');",
            )
            .unwrap();
        std::process::abort();
    }

    #[test]
    fn a_killed_writer_leaves_a_clean_database() {
        let (dir, db) = temp_db("crash");
        {
            let store = Store::open(&db).unwrap();
            drop(store);
        }
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "tests::crash_writer_child", "--nocapture"])
            .env("NEXUS_CRASH_CHILD_DB", &db)
            .status()
            .unwrap();
        assert!(!status.success(), "the child was supposed to die mid-transaction");

        let store = Store::open(&db).unwrap();
        assert_eq!(store.integrity_check().unwrap(), vec!["ok".to_owned()]);
        let (items, total) = store
            .list_activity(&ActivityFilter {
                kind: None,
                agent_id: None,
                query: None,
                from: None,
                to: None,
                limit: 10,
                offset: 0,
            })
            .unwrap();
        assert_eq!(total, 1, "only the committed row survives: {items:?}");
        assert_eq!(items[0].title, "committed before crash");
        let _ = std::fs::remove_dir_all(dir);
    }
}

