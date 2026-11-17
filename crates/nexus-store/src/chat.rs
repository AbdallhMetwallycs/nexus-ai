//! Conversations and messages.
//!
//! The conversation row carries `message_count` because the sidebar must not pull every
//! message over IPC (PHASE2_IPC_CONTRACT.md §3.3). It is maintained here, in the same
//! statements that insert and delete messages, so it cannot drift from the rows it counts.

use rusqlite::{params, OptionalExtension};

use crate::types::*;
use crate::{new_id, Store, StoreError, StoreResult};

impl Store {
    pub fn list_conversations(
        &self,
        query: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> StoreResult<(Vec<ConversationSummary>, i64)> {
        let like = query
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .map(|q| format!("%{}%", q.replace('%', "\\%").replace('_', "\\_")));

        let total: i64 = match &like {
            Some(pat) => self.conn.query_row(
                "SELECT COUNT(*) FROM conversations
                 WHERE title LIKE ?1 ESCAPE '\\'
                    OR EXISTS (SELECT 1 FROM message m
                               WHERE m.conversation_id = conversations.id
                                 AND m.content LIKE ?1 ESCAPE '\\')",
                [pat],
                |r| r.get(0),
            )?,
            None => self.conn.query_row("SELECT COUNT(*) FROM conversations", [], |r| r.get(0))?,
        };

        let mut stmt = self.conn.prepare(
            "SELECT id, title, updated_at, COALESCE(agent_id, ''), COALESCE(model_id, ''),
                    pinned, message_count
             FROM conversations
             WHERE (?1 IS NULL
                    OR title LIKE ?1 ESCAPE '\\'
                    OR EXISTS (SELECT 1 FROM message m
                               WHERE m.conversation_id = conversations.id
                                 AND m.content LIKE ?1 ESCAPE '\\'))
             ORDER BY pinned DESC, updated_at DESC
             LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt.query_map(params![like.as_deref(), limit as i64, offset as i64], |r| {
            Ok(ConversationSummary {
                id: r.get(0)?,
                title: r.get(1)?,
                updated_at: r.get(2)?,
                agent_id: r.get(3)?,
                model_id: r.get(4)?,
                pinned: r.get::<_, i64>(5)? != 0,
                message_count: r.get(6)?,
            })
        })?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok((items, total))
    }

    pub fn get_conversation(&self, id: &str) -> StoreResult<Conversation> {
        let row = self
            .conn
            .query_row(
                "SELECT id, title, updated_at, COALESCE(agent_id, ''), COALESCE(model_id, ''),
                        pinned
                 FROM conversations WHERE id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, i64>(5)? != 0,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::unknown_id("conversation", id))?;

        let messages = self.messages(id)?;
        Ok(Conversation {
            id: row.0,
            title: row.1,
            updated_at: row.2,
            agent_id: row.3,
            model_id: row.4,
            pinned: row.5,
            messages,
        })
    }

    pub fn create_conversation(
        &self,
        title: Option<&str>,
        agent_id: &str,
        model_id: &str,
        now: &str,
    ) -> StoreResult<Conversation> {
        self.create_conversation_with_id(&new_id("c"), title, agent_id, model_id, now)
    }

    /// Create with a caller-supplied id. `chat.send` uses this so a message sent to a
    /// conversation the UI already named keeps that id instead of forking a second row.
    pub fn create_conversation_with_id(
        &self,
        id: &str,
        title: Option<&str>,
        agent_id: &str,
        model_id: &str,
        now: &str,
    ) -> StoreResult<Conversation> {
        self.ensure_agent(agent_id, now)?;
        self.ensure_model(model_id, now)?;
        let title = title.map(str::trim).filter(|t| !t.is_empty()).unwrap_or("New conversation");
        self.conn.execute(
            "INSERT INTO conversations (id, title, agent_id, model_id, pinned, created_at,
                                        updated_at, message_count)
             VALUES (?1, ?2, NULLIF(?3, ''), NULLIF(?4, ''), 0, ?5, ?5, 0)",
            params![id, title, agent_id, model_id, now],
        )?;
        Ok(Conversation {
            id: id.to_owned(),
            title: title.to_owned(),
            updated_at: now.to_owned(),
            agent_id: agent_id.to_owned(),
            model_id: model_id.to_owned(),
            pinned: false,
            messages: Vec::new(),
        })
    }

    pub fn update_conversation(
        &self,
        id: &str,
        title: Option<&str>,
        agent_id: Option<&str>,
        model_id: Option<&str>,
        now: &str,
    ) -> StoreResult<Conversation> {
        self.require_conversation(id)?;
        if let Some(agent) = agent_id {
            self.ensure_agent(agent, now)?;
        }
        if let Some(model) = model_id {
            self.ensure_model(model, now)?;
        }
        self.conn.execute(
            "UPDATE conversations
             SET title = COALESCE(?2, title),
                 agent_id = COALESCE(?3, agent_id),
                 model_id = COALESCE(?4, model_id),
                 updated_at = ?5
             WHERE id = ?1",
            params![id, title, agent_id, model_id, now],
        )?;
        self.get_conversation(id)
    }

    pub fn rename_conversation(&self, id: &str, title: &str) -> StoreResult<()> {
        let title = title.trim();
        if title.is_empty() {
            return Err(StoreError::new("validation.field", "title: is required"));
        }
        let changed = self
            .conn
            .execute("UPDATE conversations SET title = ?2 WHERE id = ?1", params![id, title])?;
        if changed == 0 {
            return Err(StoreError::unknown_id("conversation", id));
        }
        Ok(())
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> StoreResult<()> {
        let changed = self.conn.execute(
            "UPDATE conversations SET pinned = ?2 WHERE id = ?1",
            params![id, i64::from(pinned)],
        )?;
        if changed == 0 {
            return Err(StoreError::unknown_id("conversation", id));
        }
        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> StoreResult<()> {
        self.require_conversation(id)?;
        self.conn.execute(
            "DELETE FROM fts_message WHERE message_id IN (SELECT id FROM message WHERE conversation_id = ?1)",
            [id],
        )?;
        self.conn.execute("DELETE FROM conversations WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn clear_messages(&self, id: &str, now: &str) -> StoreResult<()> {
        self.require_conversation(id)?;
        self.conn.execute(
            "DELETE FROM fts_message WHERE message_id IN (SELECT id FROM message WHERE conversation_id = ?1)",
            [id],
        )?;
        self.conn.execute("DELETE FROM message WHERE conversation_id = ?1", [id])?;
        self.conn.execute(
            "UPDATE conversations SET message_count = 0, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        Ok(())
    }

    pub fn messages(&self, conversation_id: &str) -> StoreResult<Vec<ChatMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, role, content, ts, model_id, agent_id, stopped,
                    prompt_tokens, completion_tokens, citations
             FROM message WHERE conversation_id = ?1 ORDER BY ts ASC, rowid ASC",
        )?;
        let rows = stmt.query_map([conversation_id], |r| {
            let id: String = r.get(0)?;
            let prompt: Option<i64> = r.get(7)?;
            let completion: Option<i64> = r.get(8)?;
            let stopped: i64 = r.get(6)?;
            Ok(ChatMessage {
                id,
                role: r.get(1)?,
                content: r.get(2)?,
                ts: r.get(3)?,
                model_id: r.get(4)?,
                agent_id: r.get(5)?,
                attachments: None,
                stopped: if stopped != 0 { Some(true) } else { None },
                usage: match (prompt, completion) {
                    (Some(p), Some(c)) => Some(Usage { prompt: p as u64, completion: c as u64 }),
                    _ => None,
                },
                citations: r
                    .get::<_, Option<String>>(9)?
                    .and_then(|raw| serde_json::from_str(&raw).ok()),
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            let mut message = row?;
            let attachments = self.attachments(&message.id)?;
            message.attachments = if attachments.is_empty() { None } else { Some(attachments) };
            out.push(message);
        }
        Ok(out)
    }

    fn attachments(&self, message_id: &str) -> StoreResult<Vec<Attachment>> {
        let mut stmt = self.conn.prepare(
            "SELECT name, kind, size_bytes FROM message_attachment WHERE message_id = ?1 ORDER BY rowid",
        )?;
        let rows = stmt.query_map([message_id], |r| {
            let bytes: i64 = r.get(2)?;
            Ok(Attachment {
                name: r.get(0)?,
                kind: r.get(1)?,
                size_kb: ((bytes.max(0) as u64).div_ceil(1024)) as u32,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Persist the owner's turn before generation starts. If this is the first message in a
    /// conversation still called "New conversation", the title becomes the message's first
    /// line, truncated to 42 characters — the same rule the UI's local path uses.
    pub fn append_user_message(
        &self,
        conversation_id: &str,
        content: &str,
        attachments: &[Attachment],
        model_id: Option<&str>,
        agent_id: Option<&str>,
        now: &str,
    ) -> StoreResult<String> {
        self.require_conversation(conversation_id)?;
        let id = new_id("u");
        self.conn.execute(
            "INSERT INTO message (id, conversation_id, role, content, ts, model_id, agent_id,
                                  stopped)
             VALUES (?1, ?2, 'user', ?3, ?4, ?5, ?6, 0)",
            params![id, conversation_id, content, now, model_id, agent_id],
        )?;
        for attachment in attachments {
            let attachment_id = new_id("att");
            self.conn.execute(
                "INSERT INTO message_attachment (id, message_id, name, kind, size_bytes)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    attachment_id,
                    id,
                    attachment.name,
                    attachment.kind,
                    i64::from(attachment.size_kb) * 1024
                ],
            )?;
        }
        self.conn.execute(
            "INSERT INTO fts_message (content, message_id) VALUES (?1, ?2)",
            params![content, id],
        )?;

        let first_line = content.lines().next().unwrap_or("").trim();
        let title = if first_line.is_empty() {
            "New conversation".to_owned()
        } else {
            first_line.chars().take(42).collect()
        };
        self.conn.execute(
            "UPDATE conversations
             SET message_count = message_count + 1,
                 updated_at = ?2,
                 title = CASE WHEN title = 'New conversation' AND message_count = 0
                              THEN ?3 ELSE title END
             WHERE id = ?1",
            params![conversation_id, now, title],
        )?;
        Ok(id)
    }

    /// Persist the assistant turn at the end of generation — complete, stopped, or failed.
    /// A killed process therefore leaves the owner's question and no half-written answer.
    #[allow(clippy::too_many_arguments)]
    pub fn finish_assistant_message(
        &self,
        conversation_id: &str,
        id: &str,
        content: &str,
        stopped: bool,
        prompt_tokens: Option<u64>,
        completion_tokens: Option<u64>,
        duration_ms: Option<u64>,
        model_id: Option<&str>,
        agent_id: Option<&str>,
        now: &str,
    ) -> StoreResult<()> {
        self.require_conversation(conversation_id)?;
        let exists: Option<i64> = self
            .conn
            .query_row("SELECT 1 FROM message WHERE id = ?1", [id], |r| r.get(0))
            .optional()?;
        self.conn.execute(
            "INSERT INTO message (id, conversation_id, role, content, ts, model_id, agent_id,
                                  stopped, prompt_tokens, completion_tokens, duration_ms,
                                  client_id)
             VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?1)
             ON CONFLICT(id) DO UPDATE SET
                content = excluded.content,
                stopped = excluded.stopped,
                prompt_tokens = excluded.prompt_tokens,
                completion_tokens = excluded.completion_tokens,
                duration_ms = excluded.duration_ms",
            params![
                id,
                conversation_id,
                content,
                now,
                model_id,
                agent_id,
                i64::from(stopped),
                prompt_tokens.map(|v| v as i64),
                completion_tokens.map(|v| v as i64),
                duration_ms.map(|v| v as i64)
            ],
        )?;
        self.conn.execute("DELETE FROM fts_message WHERE message_id = ?1", [id])?;
        if !content.is_empty() {
            self.conn.execute(
                "INSERT INTO fts_message (content, message_id) VALUES (?1, ?2)",
                params![content, id],
            )?;
        }
        if exists.is_none() {
            self.conn.execute(
                "UPDATE conversations SET message_count = message_count + 1, updated_at = ?2
                 WHERE id = ?1",
                params![conversation_id, now],
            )?;
        } else {
            self.conn.execute(
                "UPDATE conversations SET updated_at = ?2 WHERE id = ?1",
                params![conversation_id, now],
            )?;
        }
        Ok(())
    }

    /// Idempotency: a retried send with the same `clientId` must not generate twice.
    pub fn assistant_for_client_id(&self, client_id: &str) -> StoreResult<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT id FROM message WHERE client_id = ?1", [client_id], |r| r.get(0))
            .optional()?)
    }

    /// Citations stored for a message, so an idempotent retry answers with the same
    /// sources instead of silently dropping them.
    pub fn message_citations(&self, message_id: &str) -> StoreResult<Option<serde_json::Value>> {
        Ok(self
            .conn
            .query_row("SELECT citations FROM message WHERE id = ?1", [message_id], |r| {
                r.get::<_, Option<String>>(0)
            })
            .optional()?
            .flatten()
            .and_then(|raw| serde_json::from_str(&raw).ok()))
    }

    /// Attach the citations an answer was grounded in. Absent is the honest value for an
    /// answer that retrieved nothing.
    pub fn set_message_citations(
        &self,
        message_id: &str,
        citations: &serde_json::Value,
    ) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE message SET citations = ?2 WHERE id = ?1",
            rusqlite::params![message_id, citations.to_string()],
        )?;
        Ok(())
    }

    /// Tokens from the last completed answer, for `chat.usage`.
    pub fn last_usage(&self, conversation_id: &str) -> StoreResult<Option<Usage>> {
        Ok(self
            .conn
            .query_row(
                "SELECT prompt_tokens, completion_tokens FROM message
                 WHERE conversation_id = ?1 AND role = 'assistant'
                   AND prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL
                 ORDER BY ts DESC, rowid DESC LIMIT 1",
                [conversation_id],
                |r| {
                    Ok(Usage {
                        prompt: r.get::<_, i64>(0)? as u64,
                        completion: r.get::<_, i64>(1)? as u64,
                    })
                },
            )
            .optional()?)
    }

    fn require_conversation(&self, id: &str) -> StoreResult<()> {
        let found: Option<i64> = self
            .conn
            .query_row("SELECT 1 FROM conversations WHERE id = ?1", [id], |r| r.get(0))
            .optional()?;
        match found {
            Some(_) => Ok(()),
            None => Err(StoreError::unknown_id("conversation", id)),
        }
    }

    /// A conversation references an agent and a model. M2 has no agent editor yet, so the
    /// row is created on first use with its id as its name; the registry can enrich it
    /// later without changing the foreign key.
    fn ensure_agent(&self, id: &str, now: &str) -> StoreResult<()> {
        if id.is_empty() {
            return Ok(());
        }
        self.conn.execute(
            "INSERT OR IGNORE INTO agents (id, name, role, description, capabilities, enabled,
                                            built_in, icon, created_at, updated_at)
             VALUES (?1, ?1, '', '', '[]', 1, 0, 'Bot', ?2, ?2)",
            params![id, now],
        )?;
        Ok(())
    }

    fn ensure_model(&self, id: &str, now: &str) -> StoreResult<()> {
        if id.is_empty() {
            return Ok(());
        }
        self.conn.execute(
            "INSERT OR IGNORE INTO models (id, name, family, params_b, quantization,
                                            context_window, size_bytes, ram_gb_estimate,
                                            gpu_recommended, installed, in_catalog, version,
                                            updated_at, description, tags)
             VALUES (?1, ?1, '', 0, '', 0, 0, 0, 0, 0, 0, '0.0.0', ?2, '', '[]')",
            params![id, now],
        )?;
        Ok(())
    }
}
