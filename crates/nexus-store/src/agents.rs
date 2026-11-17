//! Agents: the stored definitions and the built-in Developer Agent (M4).
//!
//! Only the definition lives here. Execution is the scheduler's job (`nexus-core`), and a
//! definition that is disabled simply refuses to be scheduled — the store never runs code.

use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::types::AgentRecord;
use crate::{new_id, Store, StoreError, StoreResult};

/// The universal assistant the Chat screen already names, plus the one agent M4 can run.
pub const UNIVERSAL_AGENT: &str = "universal";
pub const DEVELOPER_AGENT: &str = "developer-agent";

impl Store {
    /// Idempotent seed of the built-in definitions. Called once after migrations.
    pub fn seed_runtime(&self, now: &str) -> StoreResult<()> {
        let builtins: [(&str, &str, &str, &str, &str, &str); 2] = [
            (
                UNIVERSAL_AGENT,
                "Universal Assistant",
                "Generalist",
                "The default local assistant: answers from the model, the knowledge index and approved memory.",
                r#"["chat","retrieval"]"#,
                "You are a careful local assistant. Answer from the provided context and say when you do not know.",
            ),
            (
                DEVELOPER_AGENT,
                "Developer Agent",
                "Engineer",
                "Runs an explicit plan of local tool calls — list, read, write, Python or PowerShell — with one approval per effect.",
                r#"["filesystem","process"]"#,
                "You are a developer assistant. Each line of the task is one tool call. Nothing runs without policy and, for writes and processes, an approval.",
            ),
        ];
        for (id, name, role, description, capabilities, instructions) in builtins {
            self.conn.execute(
                "INSERT OR IGNORE INTO agents
                   (id, name, role, description, capabilities, model_id, enabled, built_in,
                    icon, created_at, updated_at, instructions)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, 1, 1, 'bot', ?6, ?6, ?7)",
                params![id, name, role, description, capabilities, now, instructions],
            )?;
        }
        Ok(())
    }

    pub fn list_agents(&self, query: Option<&str>, enabled_only: bool) -> StoreResult<(Vec<AgentRecord>, i64)> {
        let like = query.map(|q| format!("%{q}%"));
        let mut stmt = self.conn.prepare(
            "SELECT id, name, role, description, capabilities, COALESCE(model_id, ''), instructions,
                    enabled, built_in, icon,
                    (SELECT COUNT(*) FROM conversations c
                      WHERE c.agent_id = agents.id
                        AND c.updated_at >= datetime('now', '-30 days'))
               FROM agents
              WHERE (?1 IS NULL OR name LIKE ?1 OR role LIKE ?1 OR description LIKE ?1)
                AND (?2 = 0 OR enabled = 1)
              ORDER BY built_in DESC, name",
        )?;
        let rows = stmt
            .query_map(params![like, i64::from(enabled_only)], map_agent)?
            .collect::<Result<Vec<_>, _>>()?;
        let total = rows.len() as i64;
        Ok((rows, total))
    }

    pub fn get_agent(&self, id: &str) -> StoreResult<AgentRecord> {
        self.conn
            .query_row(
                "SELECT id, name, role, description, capabilities, COALESCE(model_id, ''),
                        instructions, enabled, built_in, icon,
                        (SELECT COUNT(*) FROM conversations c
                          WHERE c.agent_id = agents.id
                            AND c.updated_at >= datetime('now', '-30 days'))
                   FROM agents WHERE id = ?1",
                [id],
                map_agent,
            )
            .optional()?
            .ok_or_else(|| StoreError::unknown_id("agent", id))
    }

    pub fn set_agent_enabled(&self, id: &str, enabled: bool, now: &str) -> StoreResult<()> {
        let changed = self.conn.execute(
            "UPDATE agents SET enabled = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, i64::from(enabled), now],
        )?;
        if changed == 0 {
            return Err(StoreError::unknown_id("agent", id));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_agent(
        &self,
        name: &str,
        role: &str,
        description: &str,
        capabilities: &Value,
        model_id: &str,
        instructions: &str,
        icon: &str,
        now: &str,
    ) -> StoreResult<AgentRecord> {
        if name.trim().is_empty() {
            return Err(StoreError::new("validation.field", "An agent needs a name."));
        }
        let id = new_id("agent");
        self.conn.execute(
            "INSERT INTO agents (id, name, role, description, capabilities, model_id, enabled,
                                 built_in, icon, created_at, updated_at, instructions)
             VALUES (?1, ?2, ?3, ?4, ?5, NULLIF(?6, ''), 1, 0, ?7, ?8, ?8, ?9)",
            params![
                id,
                name.trim(),
                role,
                description,
                capabilities.to_string(),
                model_id,
                icon,
                now,
                instructions
            ],
        )?;
        self.get_agent(&id)
    }

    pub fn update_agent(&self, id: &str, patch: &Value, now: &str) -> StoreResult<AgentRecord> {
        let current = self.get_agent(id)?;
        if current.built_in {
            return Err(StoreError::new(
                "validation.field",
                "Built-in agents keep their definition; duplicate it to make a variant.",
            ));
        }
        let name = patch.get("name").and_then(Value::as_str).unwrap_or(&current.name).to_owned();
        let role = patch.get("role").and_then(Value::as_str).unwrap_or(&current.role).to_owned();
        let description = patch
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or(&current.description)
            .to_owned();
        let instructions = patch
            .get("instructions")
            .and_then(Value::as_str)
            .unwrap_or(&current.instructions)
            .to_owned();
        let icon = patch.get("icon").and_then(Value::as_str).unwrap_or(&current.icon).to_owned();
        let capabilities = patch
            .get("capabilities")
            .cloned()
            .unwrap_or_else(|| Value::Array(current.capabilities.iter().cloned().map(Value::String).collect()));
        self.conn.execute(
            "UPDATE agents SET name=?2, role=?3, description=?4, instructions=?5, icon=?6,
                    capabilities=?7, updated_at=?8 WHERE id=?1",
            params![id, name, role, description, instructions, icon, capabilities.to_string(), now],
        )?;
        self.get_agent(id)
    }

    pub fn duplicate_agent(&self, id: &str, now: &str) -> StoreResult<AgentRecord> {
        let source = self.get_agent(id)?;
        self.create_agent(
            &format!("{} copy", source.name),
            &source.role,
            &source.description,
            &Value::Array(source.capabilities.iter().cloned().map(Value::String).collect()),
            &source.model_id,
            &source.instructions,
            &source.icon,
            now,
        )
    }

    pub fn delete_agent(&self, id: &str) -> StoreResult<()> {
        let agent = self.get_agent(id)?;
        if agent.built_in {
            return Err(StoreError::new(
                "validation.field",
                "Built-in agents cannot be deleted; they can be disabled.",
            ));
        }
        self.conn.execute("DELETE FROM agents WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn assign_agent_model(&self, id: &str, model_id: &str, now: &str) -> StoreResult<()> {
        let changed = self.conn.execute(
            "UPDATE agents SET model_id = NULLIF(?2, ''), updated_at = ?3 WHERE id = ?1",
            params![id, model_id, now],
        )?;
        if changed == 0 {
            return Err(StoreError::unknown_id("agent", id));
        }
        Ok(())
    }

    /// M4 has no instruction-version history yet; the raw text is the stored definition
    /// and `current` is empty rather than a fabricated version row.
    pub fn agent_instructions(&self, id: &str) -> StoreResult<(String, Vec<Value>)> {
        let agent = self.get_agent(id)?;
        Ok((agent.instructions, Vec::new()))
    }
}

fn map_agent(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRecord> {
    let capabilities: String = row.get(4)?;
    Ok(AgentRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        role: row.get(2)?,
        description: row.get(3)?,
        capabilities: serde_json::from_str(&capabilities).unwrap_or_default(),
        model_id: row.get(5)?,
        instructions: row.get(6)?,
        enabled: row.get::<_, i64>(7)? == 1,
        built_in: row.get::<_, i64>(8)? == 1,
        icon: row.get(9)?,
        conversations_last30d: row.get(10)?,
    })
}
