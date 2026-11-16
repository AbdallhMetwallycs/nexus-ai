//! Memory rows and their history.
//!
//! M2 stores and serves them; the writer that turns a conversation into a pending memory is
//! the M3 memory service. Keeping the CRUD here now is what lets Memory Center stop
//! pretending — it reads a real table, even when the table is empty.

use rusqlite::{params, OptionalExtension};

use crate::types::{MemoryEvent, MemoryRecord};
use crate::{new_id, Store, StoreError, StoreResult};

impl Store {
    pub fn list_memory(
        &self,
        tier: Option<&str>,
        approval: Option<&str>,
        query: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> StoreResult<(Vec<MemoryRecord>, i64)> {
        let like = query
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .map(|q| format!("%{}%", q.replace('%', "\\%").replace('_', "\\_")));
        let where_sql = "WHERE archived_at IS NULL
                           AND (?1 IS NULL OR tier = ?1)
                           AND (?2 IS NULL OR approval = ?2)
                           AND (?3 IS NULL OR title LIKE ?3 ESCAPE '\\'
                                            OR content LIKE ?3 ESCAPE '\\')";
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM memory {where_sql}"),
            params![tier, approval, like.as_deref()],
            |r| r.get(0),
        )?;
        let mut stmt = self.conn.prepare(&format!(
            "SELECT id, tier, title, content, source, tags, approval, created_at, updated_at
             FROM memory {where_sql} ORDER BY updated_at DESC LIMIT ?4 OFFSET ?5"
        ))?;
        let rows = stmt.query_map(
            params![tier, approval, like.as_deref(), limit as i64, offset as i64],
            |r| {
                Ok(MemoryRecord {
                    id: r.get(0)?,
                    tier: r.get(1)?,
                    title: r.get(2)?,
                    content: r.get(3)?,
                    source: r.get(4)?,
                    tags: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default(),
                    approval: r.get(6)?,
                    created_at: r.get(7)?,
                    updated_at: r.get(8)?,
                    history: Vec::new(),
                })
            },
        )?;
        let mut items = Vec::new();
        for row in rows {
            let mut record = row?;
            record.history = self.memory_history(&record.id)?;
            items.push(record);
        }
        Ok((items, total))
    }

    pub fn get_memory(&self, id: &str) -> StoreResult<MemoryRecord> {
        let mut record = self
            .conn
            .query_row(
                "SELECT id, tier, title, content, source, tags, approval, created_at, updated_at
                 FROM memory WHERE id = ?1 AND archived_at IS NULL",
                [id],
                |r| {
                    Ok(MemoryRecord {
                        id: r.get(0)?,
                        tier: r.get(1)?,
                        title: r.get(2)?,
                        content: r.get(3)?,
                        source: r.get(4)?,
                        tags: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default(),
                        approval: r.get(6)?,
                        created_at: r.get(7)?,
                        updated_at: r.get(8)?,
                        history: Vec::new(),
                    })
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::unknown_id("memory", id))?;
        record.history = self.memory_history(id)?;
        Ok(record)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_memory(
        &self,
        tier: &str,
        title: &str,
        content: &str,
        source: &str,
        tags: &[String],
        approval: &str,
        now: &str,
    ) -> StoreResult<MemoryRecord> {
        if title.trim().is_empty() || content.trim().is_empty() {
            return Err(StoreError::new(
                "validation.field",
                "title and content are required for a memory",
            ));
        }
        let id = new_id("mem");
        let tags = serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_owned());
        self.conn.execute(
            "INSERT INTO memory (id, tier, title, content, source, tags, approval, created_at,
                                  updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![id, tier, title.trim(), content, source, tags, approval, now],
        )?;
        self.conn.execute(
            "INSERT INTO memory_history (id, memory_id, ts, action, detail)
             VALUES (?1, ?2, ?3, 'created', ?4)",
            params![new_id("mh"), id, now, format!("Created with approval “{approval}”.")],
        )?;
        self.conn.execute(
            "INSERT INTO fts_memory (content, memory_id) VALUES (?1, ?2)",
            params![format!("{title}\n{content}"), id],
        )?;
        self.get_memory(&id)
    }

    pub fn update_memory(
        &self,
        id: &str,
        title: Option<&str>,
        content: Option<&str>,
        tags: Option<&[String]>,
        now: &str,
    ) -> StoreResult<MemoryRecord> {
        let current = self.get_memory(id)?;
        let title = title.map(str::trim).filter(|t| !t.is_empty()).unwrap_or(&current.title);
        let content = content.unwrap_or(&current.content);
        let tags = tags
            .map(|t| t.to_vec())
            .unwrap_or_else(|| current.tags.clone());
        let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_owned());
        self.conn.execute(
            "UPDATE memory SET title = ?2, content = ?3, tags = ?4, updated_at = ?5 WHERE id = ?1",
            params![id, title, content, tags_json, now],
        )?;
        self.conn.execute(
            "INSERT INTO memory_history (id, memory_id, ts, action, detail)
             VALUES (?1, ?2, ?3, 'edited', 'Edited in Memory Center or by the owner.')",
            params![new_id("mh"), id, now],
        )?;
        self.conn.execute("DELETE FROM fts_memory WHERE memory_id = ?1", [id])?;
        self.conn.execute(
            "INSERT INTO fts_memory (content, memory_id) VALUES (?1, ?2)",
            params![format!("{title}\n{content}"), id],
        )?;
        self.get_memory(id)
    }

    pub fn set_memory_approval(&self, id: &str, approval: &str, now: &str) -> StoreResult<()> {
        if !matches!(approval, "approved" | "pending" | "rejected") {
            return Err(StoreError::new(
                "validation.field",
                format!("approval: “{approval}” is not approved, pending or rejected"),
            ));
        }
        self.get_memory(id)?;
        self.conn.execute(
            "UPDATE memory SET approval = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, approval, now],
        )?;
        let action = if approval == "approved" { "approved" } else { "rejected" };
        self.conn.execute(
            "INSERT INTO memory_history (id, memory_id, ts, action, detail)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                new_id("mh"),
                id,
                now,
                action,
                format!("Decision: {approval}.")
            ],
        )?;
        Ok(())
    }

    pub fn approve_all_pending(&self, now: &str) -> StoreResult<usize> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM memory WHERE approval = 'pending' AND archived_at IS NULL")?;
        let ids: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<_, _>>()?;
        for id in &ids {
            self.set_memory_approval(id, "approved", now)?;
        }
        Ok(ids.len())
    }

    pub fn archive_memory(&self, id: &str, now: &str) -> StoreResult<()> {
        self.get_memory(id)?;
        self.conn.execute(
            "UPDATE memory SET archived_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        self.conn.execute(
            "INSERT INTO memory_history (id, memory_id, ts, action, detail)
             VALUES (?1, ?2, ?3, 'archived', 'Archived (soft delete); purgeable after 30 days.')",
            params![new_id("mh"), id, now],
        )?;
        self.conn.execute("DELETE FROM fts_memory WHERE memory_id = ?1", [id])?;
        Ok(())
    }

    pub fn memory_history(&self, id: &str) -> StoreResult<Vec<MemoryEvent>> {
        let mut stmt = self.conn.prepare(
            "SELECT ts, action, detail FROM memory_history WHERE memory_id = ?1
             ORDER BY ts ASC, rowid ASC",
        )?;
        let rows = stmt.query_map([id], |r| {
            Ok(MemoryEvent { ts: r.get(0)?, action: r.get(1)?, detail: r.get(2)? })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }
}
