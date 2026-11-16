//! Activity log: append-only rows the Activity Center reads and exports.
//!
//! Content the owner acted on is deliberately not logged (PHASE2_DATA_MODEL.md §6): titles
//! and details describe the action, never the prompt or document body.

use std::path::Path;

use rusqlite::{params, OptionalExtension};

use crate::types::{ActivityEvent, ActivityFilter};
use crate::{new_id, Store, StoreError, StoreResult};

impl Store {
    #[allow(clippy::too_many_arguments)]
    pub fn record_activity(
        &self,
        kind: &str,
        title: &str,
        detail: &str,
        agent_id: Option<&str>,
        status: &str,
        job_id: Option<&str>,
        correlation_id: Option<&str>,
        now: &str,
    ) -> StoreResult<String> {
        let id = new_id("act");
        self.conn.execute(
            "INSERT INTO activity (id, ts, kind, title, detail, agent_id, status, job_id,
                                   correlation_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id, now, kind, title, detail, agent_id, status, job_id, correlation_id
            ],
        )?;
        Ok(id)
    }

    pub fn list_activity(&self, filter: &ActivityFilter) -> StoreResult<(Vec<ActivityEvent>, i64)> {
        let like = filter
            .query
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .map(|q| format!("%{}%", q.replace('%', "\\%").replace('_', "\\_")));

        let where_sql = "WHERE (?1 IS NULL OR kind = ?1)
                           AND (?2 IS NULL OR agent_id = ?2)
                           AND (?3 IS NULL OR title LIKE ?3 ESCAPE '\\'
                                            OR detail LIKE ?3 ESCAPE '\\')
                           AND (?4 IS NULL OR ts >= ?4)
                           AND (?5 IS NULL OR ts <= ?5)";
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM activity {where_sql}"),
            params![
                filter.kind.as_deref(),
                filter.agent_id.as_deref(),
                like.as_deref(),
                filter.from.as_deref(),
                filter.to.as_deref()
            ],
            |r| r.get(0),
        )?;

        let mut stmt = self.conn.prepare(&format!(
            "SELECT id, ts, kind, title, detail, agent_id, status, job_id, correlation_id
             FROM activity {where_sql}
             ORDER BY ts DESC, rowid DESC LIMIT ?6 OFFSET ?7"
        ))?;
        let rows = stmt.query_map(
            params![
                filter.kind.as_deref(),
                filter.agent_id.as_deref(),
                like.as_deref(),
                filter.from.as_deref(),
                filter.to.as_deref(),
                filter.limit as i64,
                filter.offset as i64
            ],
            |r| {
                Ok(ActivityEvent {
                    id: r.get(0)?,
                    ts: r.get(1)?,
                    kind: r.get(2)?,
                    title: r.get(3)?,
                    detail: r.get(4)?,
                    agent_id: r.get(5)?,
                    status: r.get(6)?,
                    job_id: r.get(7)?,
                    correlation_id: r.get(8)?,
                })
            },
        )?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok((items, total))
    }

    pub fn get_activity(&self, id: &str) -> StoreResult<ActivityEvent> {
        self.conn
            .query_row(
                "SELECT id, ts, kind, title, detail, agent_id, status, job_id, correlation_id
                 FROM activity WHERE id = ?1",
                [id],
                |r| {
                    Ok(ActivityEvent {
                        id: r.get(0)?,
                        ts: r.get(1)?,
                        kind: r.get(2)?,
                        title: r.get(3)?,
                        detail: r.get(4)?,
                        agent_id: r.get(5)?,
                        status: r.get(6)?,
                        job_id: r.get(7)?,
                        correlation_id: r.get(8)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::unknown_id("activity event", id))
    }

    /// JSON or CSV, written to `path`. Returns `(bytes, events)`.
    pub fn export_activity(&self, path: &Path, format: &str, now: &str) -> StoreResult<(u64, usize)> {
        let filter = ActivityFilter {
            kind: None,
            agent_id: None,
            query: None,
            from: None,
            to: None,
            limit: 1_000_000,
            offset: 0,
        };
        let (events, _) = self.list_activity(&filter)?;
        let body = match format {
            "csv" => {
                let mut out = String::from(
                    "id,ts,kind,title,detail,agentId,status,jobId,correlationId\n",
                );
                for e in &events {
                    out.push_str(&csv_row(&[
                        &e.id,
                        &e.ts,
                        &e.kind,
                        &e.title,
                        &e.detail,
                        e.agent_id.as_deref().unwrap_or(""),
                        &e.status,
                        e.job_id.as_deref().unwrap_or(""),
                        e.correlation_id.as_deref().unwrap_or(""),
                    ]));
                }
                out
            }
            _ => serde_json::to_string_pretty(&events).map_err(|e| {
                StoreError::internal("The activity log could not be serialised.")
                    .with_detail(e.to_string())
            })?,
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, body.as_bytes())?;
        // The export is recorded as an event so the log does not silently leave the machine.
        let _ = self.record_activity(
            "task",
            "Exported the activity log",
            &format!("{format} export, {} events, {}", events.len(), path.display()),
            None,
            "success",
            None,
            None,
            now,
        );
        Ok((body.len() as u64, events.len()))
    }

    pub fn purge_activity_before(&self, cutoff: &str) -> StoreResult<usize> {
        Ok(self.conn.execute("DELETE FROM activity WHERE ts < ?1", [cutoff])?)
    }
}

fn csv_row(fields: &[&str]) -> String {
    let mut out = String::new();
    for (i, field) in fields.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        if field.contains([',', '"', '\n', '\r']) {
            out.push('"');
            out.push_str(&field.replace('"', "\"\""));
            out.push('"');
        } else {
            out.push_str(field);
        }
    }
    out.push('\n');
    out
}
