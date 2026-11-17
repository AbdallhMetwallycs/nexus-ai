//! Tool catalogue, declared grants and the approval queue (M4).
//!
//! Declared permissions are a boundary, not documentation: `set_tool_grant` refuses a
//! permission the tool never declared, and `decide_tool` in `nexus-policy` refuses any
//! execution that would use one. The store only records facts; it never runs a tool.

use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use crate::types::{
    ApprovalRow, PendingApproval, RequestedBy, StandingGrant, ToolGrantInfo, ToolRecord,
};
use crate::{new_id, Store, StoreError, StoreResult};

/// Tools whose ids the core knows how to execute. A row is still required: the catalogue is
/// the source of truth for enablement and declarations.
const BUILTIN_TOOLS: [(&str, &str, &str, &str, &str, i64); 5] = [
    (
        "fs.list",
        "List folder",
        "Filesystem",
        "Lists files and folders inside a watched folder. Read-only.",
        r#"["fs.read"]"#,
        0,
    ),
    (
        "fs.read",
        "Read file",
        "Filesystem",
        "Reads a text file inside a watched folder. Read-only and size-capped.",
        r#"["fs.read"]"#,
        0,
    ),
    (
        "fs.write",
        "Write file",
        "Filesystem",
        "Creates or overwrites a text file inside a watched folder.",
        r#"["fs.write"]"#,
        1,
    ),
    (
        "python.run",
        "Run Python",
        "Code",
        "Runs a short Python snippet with the watched folder as its working directory.",
        r#"["process.exec"]"#,
        1,
    ),
    (
        "powershell.run",
        "Run PowerShell",
        "Shell",
        "Runs a short PowerShell script with the watched folder as its working directory.",
        r#"["process.exec"]"#,
        1,
    ),
];

impl Store {
    pub fn seed_tools(&self, now: &str) -> StoreResult<()> {
        for (id, name, category, description, permissions, needs_approval) in BUILTIN_TOOLS {
            self.conn.execute(
                "INSERT OR IGNORE INTO tool
                   (id, name, category, description, permissions, needs_approval, enabled,
                    status, version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 'ready', '1.0.0')",
                params![id, name, category, description, permissions, needs_approval],
            )?;
        }
        self.conn.execute(
            "UPDATE tool SET status = CASE WHEN enabled = 1 THEN 'ready' ELSE 'disabled' END
              WHERE status = 'running'",
            [],
        )?;
        let _ = now;
        Ok(())
    }

    pub fn list_tools(
        &self,
        query: Option<&str>,
        category: Option<&str>,
        enabled_only: bool,
    ) -> StoreResult<(Vec<ToolRecord>, i64)> {
        let like = query.map(|q| format!("%{q}%"));
        let mut stmt = self.conn.prepare(
            "SELECT id, name, category, description, permissions, needs_approval, enabled,
                    status, version, last_run_at, last_error
               FROM tool
              WHERE (?1 IS NULL OR name LIKE ?1 OR description LIKE ?1 OR id LIKE ?1)
                AND (?2 IS NULL OR category = ?2)
                AND (?3 = 0 OR enabled = 1)
              ORDER BY category, name",
        )?;
        let rows = stmt
            .query_map(params![like, category, i64::from(enabled_only)], map_tool)?
            .collect::<Result<Vec<_>, _>>()?;
        let total = rows.len() as i64;
        Ok((rows, total))
    }

    pub fn get_tool(&self, id: &str) -> StoreResult<ToolRecord> {
        self.conn
            .query_row(
                "SELECT id, name, category, description, permissions, needs_approval, enabled,
                        status, version, last_run_at, last_error
                   FROM tool WHERE id = ?1",
                [id],
                map_tool,
            )
            .optional()?
            .ok_or_else(|| StoreError::unknown_id("tool", id))
    }

    pub fn set_tool_enabled(&self, id: &str, enabled: bool, now: &str) -> StoreResult<()> {
        let tool = self.get_tool(id)?;
        if tool.status == "error" && enabled {
            return Err(StoreError::new(
                "validation.field",
                format!("{} is in an error state; fix its last error before enabling it.", tool.name),
            ));
        }
        self.conn.execute(
            "UPDATE tool SET enabled = ?2,
                    status = CASE WHEN ?2 = 1 THEN 'ready' ELSE 'disabled' END,
                    last_error = CASE WHEN ?2 = 1 THEN NULL ELSE last_error END
              WHERE id = ?1",
            params![id, i64::from(enabled)],
        )?;
        let _ = now;
        Ok(())
    }

    pub fn tool_grant_info(&self, id: &str) -> StoreResult<ToolGrantInfo> {
        let tool = self.get_tool(id)?;
        let mut stmt = self.conn.prepare(
            "SELECT permission, scope, expires_at FROM tool_grant
              WHERE tool_id = ?1 AND scope = 'always'
              ORDER BY permission",
        )?;
        let standing = stmt
            .query_map([id], |row| {
                Ok(StandingGrant {
                    permission: row.get(0)?,
                    scope: row.get(1)?,
                    expires_at: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ToolGrantInfo { permissions: tool.permissions, needs_approval: tool.needs_approval, standing })
    }

    /// `scope='never'` revokes. Only `always` is stored as a standing grant, and only for a
    /// permission the tool declared.
    pub fn set_tool_grant(
        &self,
        id: &str,
        permission: &str,
        scope: &str,
        roots: Option<&Value>,
        now: &str,
    ) -> StoreResult<()> {
        let tool = self.get_tool(id)?;
        if !tool.permissions.iter().any(|p| p == permission) {
            return Err(StoreError::new(
                "policy.permission_undeclared",
                format!("{} never declared “{permission}”, so it cannot be granted it.", tool.name),
            ));
        }
        match scope {
            "never" => {
                self.conn.execute(
                    "DELETE FROM tool_grant WHERE tool_id = ?1 AND permission = ?2",
                    params![id, permission],
                )?;
            }
            "always" => {
                self.conn.execute(
                    "INSERT INTO tool_grant (tool_id, permission, scope, roots, granted_at, expires_at)
                     VALUES (?1, ?2, 'always', ?3, ?4, NULL)
                     ON CONFLICT(tool_id, permission) DO UPDATE SET
                       scope = 'always', roots = excluded.roots, granted_at = excluded.granted_at,
                       expires_at = NULL",
                    params![id, permission, roots.map(Value::to_string), now],
                )?;
            }
            other => {
                return Err(StoreError::new(
                    "validation.field",
                    format!("A grant scope must be once, always or never (got “{other}”)."),
                ))
            }
        }
        Ok(())
    }

    pub fn standing_grant(&self, tool_id: &str, permission: &str, now: &str) -> bool {
        self.conn
            .query_row(
                "SELECT 1 FROM tool_grant
                  WHERE tool_id = ?1 AND permission = ?2 AND scope = 'always'
                    AND (expires_at IS NULL OR expires_at > ?3)",
                params![tool_id, permission, now],
                |_| Ok(()),
            )
            .optional()
            .ok()
            .flatten()
            .is_some()
    }

    pub fn record_tool_run(&self, id: &str, error: Option<&str>, now: &str) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE tool SET last_run_at = ?2, status = ?3, last_error = ?4 WHERE id = ?1",
            params![id, now, if error.is_some() { "error" } else { "ready" }, error],
        )?;
        Ok(())
    }

    /* ---------------------------- approvals ---------------------------- */

    #[allow(clippy::too_many_arguments)]
    pub fn create_approval(
        &self,
        kind: &str,
        agent_id: Option<&str>,
        tool_id: Option<&str>,
        job_id: Option<&str>,
        step_idx: Option<i64>,
        summary: &str,
        detail: Option<&str>,
        args_hash: &str,
        correlation_id: &str,
        created_at: &str,
        expires_at: &str,
    ) -> StoreResult<String> {
        let id = new_id("apr");
        self.conn.execute(
            "INSERT INTO approval (id, kind, requested_by_agent, requested_by_tool,
                                   requested_by_job, summary, detail, created_at, expires_at,
                                   args_hash, correlation_id, step_idx)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                id,
                kind,
                agent_id,
                tool_id,
                job_id,
                summary,
                detail,
                created_at,
                expires_at,
                args_hash,
                correlation_id,
                step_idx
            ],
        )?;
        Ok(id)
    }

    /// Marks every unanswered approval past its deadline as `expired` and returns how many.
    pub fn expire_approvals(&self, now: &str) -> StoreResult<usize> {
        Ok(self.conn.execute(
            "UPDATE approval SET decision = 'expired', decided_at = ?1, scope = 'never'
              WHERE decided_at IS NULL AND expires_at <= ?1",
            [now],
        )?)
    }

    pub fn pending_approvals(&self, now: &str) -> StoreResult<Vec<PendingApproval>> {
        self.expire_approvals(now)?;
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, requested_by_agent, requested_by_tool, requested_by_job,
                    summary, detail, created_at, expires_at
               FROM approval
              WHERE decided_at IS NULL
              ORDER BY created_at",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(PendingApproval {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    requested_by: RequestedBy {
                        agent_id: row.get(2)?,
                        tool_id: row.get(3)?,
                        job_id: row.get(4)?,
                    },
                    summary: row.get(5)?,
                    detail: row.get(6)?,
                    created_at: row.get(7)?,
                    expires_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_approval(&self, id: &str) -> StoreResult<ApprovalRow> {
        self.conn
            .query_row(
                "SELECT id, kind, requested_by_agent, requested_by_tool, requested_by_job,
                        step_idx, summary, detail, args_hash, created_at, expires_at,
                        decided_at, decision, scope, used_at, correlation_id
                   FROM approval WHERE id = ?1",
                [id],
                map_approval,
            )
            .optional()?
            .ok_or_else(|| StoreError::unknown_id("approval", id))
    }

    /// Expired approvals that still own a job step, so the runner can fail that job
    /// with a visible reason exactly once.
    pub fn expired_open_jobs(&self) -> StoreResult<Vec<ApprovalRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, requested_by_agent, requested_by_tool, requested_by_job,
                    step_idx, summary, detail, args_hash, created_at, expires_at,
                    decided_at, decision, scope, used_at, correlation_id
               FROM approval
              WHERE decision = 'expired' AND used_at IS NULL AND requested_by_job IS NOT NULL",
        )?;
        let rows = stmt.query_map([], map_approval)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn decide_approval(
        &self,
        id: &str,
        decision: &str,
        scope: Option<&str>,
        now: &str,
    ) -> StoreResult<ApprovalRow> {
        let current = self.get_approval(id)?;
        if current.decided_at.is_some() {
            return Err(StoreError::new(
                "validation.field",
                "This approval was already decided; a new call asks again.",
            ));
        }
        if now >= current.expires_at.as_str() {
            self.conn.execute(
                "UPDATE approval SET decision = 'expired', decided_at = ?2, scope = 'never'
                  WHERE id = ?1",
                params![id, now],
            )?;
            return self.get_approval(id);
        }
        if decision == "approved" {
            let scope = scope.unwrap_or("once");
            if !matches!(scope, "once" | "always") {
                return Err(StoreError::new(
                    "validation.field",
                    "An approval scope must be once or always.",
                ));
            }
            self.conn.execute(
                "UPDATE approval SET decision = 'approved', decided_at = ?2, scope = ?3
                  WHERE id = ?1",
                params![id, now, scope],
            )?;
        } else {
            self.conn.execute(
                "UPDATE approval SET decision = 'rejected', decided_at = ?2, scope = 'never'
                  WHERE id = ?1",
                params![id, now],
            )?;
        }
        self.get_approval(id)
    }

    pub fn consume_approval(&self, id: &str, now: &str) -> StoreResult<()> {
        self.conn.execute("UPDATE approval SET used_at = ?2 WHERE id = ?1", params![id, now])?;
        Ok(())
    }

    /// An approved, unused, unexpired approval whose argument fingerprint matches this call.
    pub fn usable_approval(
        &self,
        tool_id: &str,
        args_hash: &str,
        now: &str,
    ) -> StoreResult<Option<ApprovalRow>> {
        let row = self
            .conn
            .query_row(
                "SELECT id, kind, requested_by_agent, requested_by_tool, requested_by_job,
                        step_idx, summary, detail, args_hash, created_at, expires_at,
                        decided_at, decision, scope, used_at, correlation_id
                   FROM approval
                  WHERE requested_by_tool = ?1 AND args_hash = ?2
                    AND decision = 'approved' AND used_at IS NULL AND expires_at > ?3
                  ORDER BY created_at LIMIT 1",
                params![tool_id, args_hash, now],
                map_approval,
            )
            .optional()?;
        Ok(row)
    }

    pub fn approval_history(&self, limit: usize) -> StoreResult<Vec<Value>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, ts, kind, title, detail, status
               FROM activity WHERE kind = 'approval'
              ORDER BY ts DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map([limit as i64], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "ts": row.get::<_, String>(1)?,
                    "kind": row.get::<_, String>(2)?,
                    "title": row.get::<_, String>(3)?,
                    "detail": row.get::<_, String>(4)?,
                    "status": row.get::<_, String>(5)?,
                }))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

fn map_tool(row: &rusqlite::Row<'_>) -> rusqlite::Result<ToolRecord> {
    let permissions: String = row.get(4)?;
    Ok(ToolRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        category: row.get(2)?,
        description: row.get(3)?,
        permissions: serde_json::from_str(&permissions).unwrap_or_default(),
        needs_approval: row.get::<_, i64>(5)? == 1,
        enabled: row.get::<_, i64>(6)? == 1,
        status: row.get(7)?,
        version: row.get(8)?,
        last_run: row.get(9)?,
        last_error: row.get(10)?,
    })
}

fn map_approval(row: &rusqlite::Row<'_>) -> rusqlite::Result<ApprovalRow> {
    Ok(ApprovalRow {
        id: row.get(0)?,
        kind: row.get(1)?,
        agent_id: row.get(2)?,
        tool_id: row.get(3)?,
        job_id: row.get(4)?,
        step_idx: row.get(5)?,
        summary: row.get(6)?,
        detail: row.get(7)?,
        args_hash: row.get(8)?,
        created_at: row.get(9)?,
        expires_at: row.get(10)?,
        decided_at: row.get(11)?,
        decision: row.get(12)?,
        scope: row.get(13)?,
        used_at: row.get(14)?,
        correlation_id: row.get(15)?,
    })
}
