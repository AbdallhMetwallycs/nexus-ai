//! The contract router: one place where a command name becomes real work or an honest
//! `not_implemented`.
//!
//! The rule from `PHASE2_MILESTONES.md` §1 is enforced structurally: `dispatch` has no
//! catch-all that fabricates a success. Anything not matched here returns
//! [`NexusError::not_implemented`] with the contract's wording, so the UI can keep a
//! `DEMO` banner until its milestone lands.
//!
//! M1 implements `engine.*`, `model.*` and `chat.send/stop`. M2 adds the SQLite store:
//! conversations, settings, activity, memory rows, backups and exports. Everything else
//! still refuses.

use std::path::{Path, PathBuf};
use std::time::Instant;

use nexus_store::types::ActivityFilter;
use nexus_store::{Attachment, Store, StoreError};
use serde_json::{json, Value};

use crate::admission;
use crate::engine::Supervisor;
use crate::error::{CoreResult, ErrorCode, NexusError};
use crate::inference::{self, CancelFlag, ChatTurn};
use crate::ipc_types::{Paged, Response};
use crate::registry::Registry;
use crate::system::{memory_status, now_iso8601, physical_cores};

/// Every event the core can emit, by contract channel name.
pub trait EventSink {
    fn emit(&mut self, channel: &str, payload: Value);
}

pub struct NullSink;

impl EventSink for NullSink {
    fn emit(&mut self, _channel: &str, _payload: Value) {}
}

/// Test sink: records the channel and payload so a test can assert on the wire shape.
#[derive(Default, Debug)]
pub struct RecordingSink {
    pub events: Vec<(String, Value)>,
}

impl EventSink for RecordingSink {
    fn emit(&mut self, channel: &str, payload: Value) {
        self.events.push((channel.to_owned(), payload));
    }
}

pub struct Core {
    pub models_dir: PathBuf,
    pub engine_dir: PathBuf,
    pub supervisor: Supervisor,
    pub active_model: Option<String>,
    pub cancel: CancelFlag,
    /// The local database. `None` only when the file could not be opened; every command
    /// that needs persistent state then refuses with `store.corrupt` and the reason,
    /// instead of pretending an in-memory substitute is the owner's data.
    pub store: Option<Store>,
    pub store_error: Option<String>,
    /// Where default backup, export and purge paths point. The Tauri host sets this to
    /// `%APPDATA%\NexusAI`; tests get the model folder.
    pub data_dir: PathBuf,
}

impl Core {
    /// A core with an in-memory store, for tests and for hosts with no data directory.
    /// Real persistence is [`Core::from_env`] or [`Core::with_store`].
    pub fn new(models_dir: impl Into<PathBuf>, engine_dir: impl Into<PathBuf>) -> Self {
        let models_dir = models_dir.into();
        let engine_dir = engine_dir.into();
        let (store, store_error) = match Store::open_in_memory() {
            Ok(store) => (Some(store), None),
            Err(err) => (None, Some(err.message)),
        };
        Self {
            supervisor: Supervisor::new(engine_dir.clone()),
            data_dir: models_dir.clone(),
            models_dir,
            engine_dir,
            active_model: None,
            cancel: CancelFlag::new(),
            store,
            store_error,
        }
    }

    /// Replace the store, e.g. with a file-backed one from a test or a host.
    pub fn with_store(mut self, store: Store) -> Self {
        self.store = Some(store);
        self.store_error = None;
        self
    }

    /// Paths come from the environment so the app is not tied to one machine's drive
    /// letters. The defaults are the M1.1/M1.2 locations on the development laptop.
    ///
    /// `NEXUS_DATA_DIR` overrides the data directory; otherwise
    /// `%APPDATA%\NexusAI` (falling back to the working directory). The database lives at
    /// `<data>/nexus.db` with SQLite's `-wal`/`-shm` beside it.
    pub fn from_env() -> Self {
        let models = std::env::var_os("NEXUS_MODELS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("D:\\NEXUS-MODELS"));
        let engine = std::env::var_os("NEXUS_ENGINE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("D:\\NEXUS-SIDECAR\\b12189"));
        let mut core = Self::new(models, engine);
        let data = std::env::var_os("NEXUS_DATA_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("APPDATA")
                    .map(PathBuf::from)
                    .map(|root| root.join("NexusAI"))
            })
            .unwrap_or_else(|| core.data_dir.clone());
        core.data_dir = data.clone();
        match Store::open(data.join("nexus.db")) {
            Ok(store) => {
                core.store = Some(store);
                core.store_error = None;
            }
            Err(err) => {
                core.store = None;
                core.store_error = Some(err.message);
            }
        }
        // The selected model is a preference, not a running process: restore it so the
        // first message after a restart targets the same model without a load.
        if let Some(store) = core.store.as_ref() {
            if let Ok(Some(Value::String(id))) = store.setting("models", "active") {
                if core.registry().find(&id).is_ok() {
                    core.active_model = Some(id);
                }
            }
        }
        core
    }

    pub fn registry(&self) -> Registry {
        Registry::new(&self.models_dir)
    }

    pub fn active_context(&self) -> Option<u32> {
        self.supervisor.launch().map(|l| l.context)
    }

    fn store(&self) -> CoreResult<&Store> {
        self.store
            .as_ref()
            .ok_or_else(|| store_missing(self.store_error.as_deref()))
    }

    fn store_mut(&mut self) -> CoreResult<&mut Store> {
        if self.store.is_none() {
            return Err(store_missing(self.store_error.as_deref()));
        }
        Ok(self.store.as_mut().expect("checked above"))
    }

    /// Activity is evidence, not control flow: a full disk must not turn a successful
    /// answer into a failed one, but it is also not silent.
    fn log_activity(&self, kind: &str, title: &str, detail: &str, status: &str) {
        if let Some(store) = self.store.as_ref() {
            if let Err(err) =
                store.record_activity(kind, title, detail, None, status, None, None, &now_iso8601())
            {
                eprintln!("NEXUS activity row was not written: {err}");
            }
        }
    }

    fn persist_active_model(&self, model_id: &str) {
        if let Some(store) = self.store.as_ref() {
            if let Err(err) = store.set_setting(
                "models",
                "active",
                &Value::String(model_id.to_owned()),
                false,
                &now_iso8601(),
            ) {
                eprintln!("NEXUS active model was not saved: {err}");
            }
        }
    }

    /// Load one model through admission and the supervisor. Used by `engine.loadModel` and
    /// by `chat.send` so a cold chat starts the engine instead of refusing.
    fn load_model(&mut self, model_id: &str, sink: &mut dyn EventSink) -> CoreResult<u32> {
        if self.supervisor.launch().is_some_and(|l| l.model_id == model_id)
            && self.supervisor.refresh()
        {
            self.active_model = Some(model_id.to_owned());
            return Ok(self.supervisor.launch().map(|l| l.context).unwrap_or(0));
        }
        let info = self.registry().find(model_id)?;
        let footprint = info.footprint();
        let plan = admission::plan(model_id, footprint, admission::DEFAULT_CONTEXT, memory_status())?;
        if !plan.allowed {
            return Err(NexusError::ram_admission(plan.reason));
        }
        let result =
            self.supervisor.start(&info.path, model_id, plan.context, physical_cores())?;
        self.active_model = Some(model_id.to_owned());
        sink.emit(
            "model://state",
            serde_json::to_value(crate::ipc_types::ModelStateEvent {
                model_id: model_id.to_owned(),
                installed: true,
                active: true,
                loaded_gb: Some(result.loaded_gb),
            })
            .unwrap_or(Value::Null),
        );
        Ok(plan.context)
    }

    /// A default file name under `<data>/exports`, created on demand.
    fn export_path(&self, prefix: &str, format: &str) -> CoreResult<PathBuf> {
        let dir = self.data_dir.join("exports");
        std::fs::create_dir_all(&dir)
            .map_err(|e| NexusError::io("creating the export folder", &e))?;
        let stamp: String = now_iso8601().chars().filter(|c| c.is_ascii_digit()).collect();
        let ext = if format.eq_ignore_ascii_case("csv") { "csv" } else { "json" };
        Ok(dir.join(format!("{prefix}-{stamp}.{ext}")))
    }

    /// One chat turn end to end: persist the question, stream the answer, persist what was
    /// actually produced. `clientId` is the assistant message id the UI already rendered, so
    /// a retried invoke returns the stored row instead of generating twice.
    fn chat_send(&mut self, args: &Value, sink: &mut dyn EventSink) -> CoreResult<Value> {
        let conversation_id = required_str(args, "conversationId")?;
        let content = required_str(args, "content")?;
        let client_id = optional_str(args, "clientId");
        let attachments: Vec<Attachment> = match args.get("attachments") {
            None | Some(Value::Null) => Vec::new(),
            Some(value) => serde_json::from_value(value.clone())
                .map_err(|e| NexusError::validation("attachments", e.to_string()))?,
        };
        let now = now_iso8601();

        if let Some(client_id) = client_id.as_deref() {
            if let Some(existing) = self.store()?.assistant_for_client_id(client_id)? {
                return Ok(json!({ "messageId": existing }));
            }
        }

        // The Chat screen creates its conversation locally, so the first send to an id the
        // store has not seen yet creates that exact row — same id, no fork.
        let conversation = match self.store()?.get_conversation(&conversation_id) {
            Ok(conversation) => conversation,
            Err(err) if err.code == "validation.unknown_id" => {
                let agent = optional_str(args, "agentId").unwrap_or_default();
                let model = self.active_model.clone().unwrap_or_default();
                self.store()?.create_conversation_with_id(
                    &conversation_id,
                    None,
                    &agent,
                    &model,
                    &now,
                )?
            }
            Err(err) => return Err(err.into()),
        };

        let chosen_model = self
            .active_model
            .clone()
            .filter(|m| !m.is_empty())
            .or_else(|| (!conversation.model_id.is_empty()).then(|| conversation.model_id.clone()));
        if let Some(model) = chosen_model.as_ref() {
            self.active_model = Some(model.clone());
        }
        let agent_id = (!conversation.agent_id.is_empty()).then(|| conversation.agent_id.clone());

        // The owner's turn is real even if the engine then refuses: save it first. That is
        // what lets a restart show the same question beside the same error.
        self.store()?.append_user_message(
            &conversation_id,
            &content,
            &attachments,
            chosen_model.as_deref(),
            agent_id.as_deref(),
            &now,
        )?;

        let model_id = match chosen_model {
            Some(model) => model,
            None => {
                return Err(NexusError::new(
                    ErrorCode::ModelNotInstalled,
                    "Choose a model before sending a message.",
                    false,
                ))
            }
        };

        // Multi-turn: the whole conversation is sent, trimmed back from the newest turn.
        let history = self.store()?.messages(&conversation_id)?;
        let mut turns =
            vec![ChatTurn { role: "system", content: inference::SYSTEM_PROMPT.into() }];
        for message in &history {
            match message.role.as_str() {
                "user" => {
                    turns.push(ChatTurn { role: "user", content: message.content.clone() })
                }
                "assistant" if !message.content.is_empty() => {
                    turns.push(ChatTurn { role: "assistant", content: message.content.clone() })
                }
                _ => {}
            }
        }

        // A Stop pressed while a cold load is still running must survive into the request:
        // reset here, then refuse before generation if it flipped.
        self.cancel.reset();
        let context = match self.load_model(&model_id, sink) {
            Ok(context) => context,
            Err(err) => {
                self.log_activity("error", "Answer failed", &err.message, "failure");
                return Err(err);
            }
        };
        self.persist_active_model(&model_id);
        if self.cancel.is_cancelled() {
            self.log_activity(
                "task",
                "Answer stopped",
                "Stopped while the model was loading; the question was saved and no answer was generated.",
                "success",
            );
            return Err(NexusError::cancelled());
        }

        let message_id = client_id.unwrap_or_else(|| new_message_id("a"));
        let messages = inference::trim_to_budget(turns, context.saturating_sub(512));
        let body = inference::chat_body(&messages, 512, 0.7);
        let loopback = self.supervisor.loopback()?;
        let cancel = self.cancel.clone();
        let started = Instant::now();
        let mut streamed = String::new();
        let outcome = inference::generate(&loopback, &body, &cancel, |delta| {
            streamed.push_str(delta);
            sink.emit(
                "chat://token",
                json!({
                    "conversationId": conversation_id,
                    "messageId": message_id,
                    "delta": delta,
                    "done": false
                }),
            );
            true
        });
        let duration_ms = started.elapsed().as_millis() as u64;

        let outcome = match outcome {
            Ok(outcome) => outcome,
            Err(err) => {
                // A socket failure whose engine no longer answers is a crash, not a
                // generic I/O error: say what happened and that the next message will
                // restart it. `try_wait` lags an external kill by up to ~1.5 s on this
                // machine, so a health probe — not the handle — decides.
                let alive = self.supervisor.refresh() && self.supervisor.serving();
                if !alive {
                    self.supervisor.mark_crashed();
                }
                // Whatever reached the UI is what the store keeps, marked stopped.
                if let Some(store) = self.store.as_ref() {
                    if let Err(save) = store.finish_assistant_message(
                        &conversation_id,
                        &message_id,
                        &streamed,
                        true,
                        None,
                        None,
                        Some(duration_ms),
                        Some(&model_id),
                        agent_id.as_deref(),
                        &now_iso8601(),
                    ) {
                        eprintln!("NEXUS partial answer was not saved: {save}");
                    }
                }
                self.log_activity("error", "Answer failed", &err.message, "failure");
                if !alive {
                    let mut crashed = NexusError::new(
                        ErrorCode::EngineCrashed,
                        "The local engine stopped while answering. The next message will restart it.",
                        true,
                    );
                    crashed = crashed.with_detail(err.to_string());
                    return Err(crashed);
                }
                return Err(err);
            }
        };

        let stopped = outcome.cancelled;
        // TD-18: a stopped stream must not carry the engine's zeroed usage into the honesty
        // rail. No usage frame, and no stored usage, unless the numbers are real.
        let (prompt_tokens, completion_tokens) = if stopped {
            (None, None)
        } else {
            (
                Some(u64::from(outcome.prompt_tokens)),
                Some(u64::from(outcome.completion_tokens)),
            )
        };
        self.store()?.finish_assistant_message(
            &conversation_id,
            &message_id,
            &streamed,
            stopped,
            prompt_tokens,
            completion_tokens,
            Some(duration_ms),
            Some(&model_id),
            agent_id.as_deref(),
            &now_iso8601(),
        )?;
        if stopped {
            self.log_activity(
                "task",
                "Answer stopped",
                "Stopped at the owner's request; the partial answer was saved.",
                "success",
            );
        } else {
            self.log_activity(
                "task",
                "Answer completed",
                &format!(
                    "{} prompt + {} completion tokens in {} ms.",
                    outcome.prompt_tokens, outcome.completion_tokens, duration_ms
                ),
                "success",
            );
        }

        sink.emit(
            "chat://token",
            json!({
                "conversationId": conversation_id,
                "messageId": message_id,
                "delta": "",
                "done": true
            }),
        );
        if !stopped {
            sink.emit(
                "chat://usage",
                json!({
                    "conversationId": conversation_id,
                    "contextUsed": outcome.prompt_tokens.saturating_add(outcome.completion_tokens),
                    "contextMax": context
                }),
            );
        }
        Ok(json!({ "messageId": message_id }))
    }

    /// Data-or-error form, for hosts such as Tauri that carry the envelope themselves
    /// (a Tauri command resolves with the data and rejects with the error).
    pub fn execute(
        &mut self,
        command: &str,
        args: &Value,
        sink: &mut dyn EventSink,
    ) -> CoreResult<Value> {
        self.route(command, args, sink)
    }

    /// Envelope form, used by the unit tests and any host that transports `Response<T>`.
    pub fn dispatch(
        &mut self,
        command: &str,
        args: &Value,
        sink: &mut dyn EventSink,
    ) -> Response<Value> {
        Response::from_core(self.execute(command, args, sink))
    }

    fn route(
        &mut self,
        command: &str,
        args: &Value,
        sink: &mut dyn EventSink,
    ) -> CoreResult<Value> {
        match command {
            "engine.status" => to_json(&self.supervisor.status()),

            "engine.start" => {
                let info = self.supervisor.start_active()?;
                to_json(&info)
            }

            "engine.stop" => {
                self.cancel.cancel();
                self.supervisor.stop();
                self.active_model = None;
                self.log_activity(
                    "model",
                    "Engine stopped",
                    "The local engine process was terminated, releasing its memory.",
                    "success",
                );
                Ok(Value::Null)
            }

            "engine.loadModel" => {
                let model_id = required_str(args, "modelId")?;
                self.load_model(&model_id, sink)?;
                self.persist_active_model(&model_id);
                self.log_activity(
                    "model",
                    "Model loaded",
                    &format!("Loaded {model_id} through the measured admission check."),
                    "success",
                );
                let result = self.supervisor.launch().map(|l| {
                    crate::ipc_types::ModelLoadResult {
                        loaded_gb: self
                            .supervisor
                            .process_memory()
                            .map(|m| m.private_gb())
                            .unwrap_or(0.0),
                        context_capped: l.context,
                        threads: l.threads,
                        ready_ms: l.ready_ms,
                    }
                });
                match result {
                    Some(result) => to_json(&result),
                    None => Err(NexusError::engine_not_ready("The engine did not report a launch.")),
                }
            }

            "engine.unloadModel" => {
                self.cancel.cancel();
                self.supervisor.stop();
                self.log_activity(
                    "model",
                    "Model unloaded",
                    "The engine process was terminated; the next message reloads the model.",
                    "success",
                );
                Ok(Value::Null)
            }

            "engine.measuredFit" => {
                let model_id = required_str(args, "modelId")?;
                let info = self.registry().find(&model_id)?;
                let requested = optional_u32(args, "context").unwrap_or(admission::DEFAULT_CONTEXT);
                let plan =
                    admission::plan(&model_id, info.footprint(), requested, memory_status())?;
                let actual = self
                    .supervisor
                    .launch()
                    .filter(|l| l.model_id == model_id)
                    .and_then(|_| self.supervisor.process_memory())
                    .map(|m| m.private_gb());
                to_json(&plan.to_measured_fit(actual))
            }

            "model.list" => {
                let query = args.get("query").and_then(Value::as_str).unwrap_or("").to_lowercase();
                let sort = args.get("sort").and_then(Value::as_str).unwrap_or("name");
                let mut models: Vec<_> = self
                    .registry()
                    .scan()
                    .models
                    .into_iter()
                    .filter(|m| {
                        query.is_empty()
                            || m.name.to_lowercase().contains(&query)
                            || m.id.contains(&query)
                            || m.quantization.to_lowercase().contains(&query)
                    })
                    .collect();
                match sort {
                    "ram" => models.sort_by(|a, b| a.ram_gb.total_cmp(&b.ram_gb)),
                    "size" => models.sort_by(|a, b| a.size_gb.total_cmp(&b.size_gb)),
                    "context" => models.sort_by_key(|m| m.context_window),
                    "updated" => models.sort_by(|a, b| b.updated_at.cmp(&a.updated_at)),
                    _ => models.sort_by_key(|m| m.name.to_lowercase()),
                }
                let total = models.len();
                let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
                let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(100) as usize;
                let items = models.into_iter().skip(offset).take(limit).collect();
                to_json(&Paged { items, total })
            }

            "model.get" => {
                let id = required_str(args, "id")?;
                let info = self.registry().find(&id)?;
                to_json(&info.to_record(false))
            }

            "model.setActive" => {
                let id = required_str(args, "id")?;
                // Validate that the id resolves before writing it into state.
                let _ = self.registry().find(&id)?;
                self.active_model = Some(id.clone());
                self.persist_active_model(&id);
                Ok(Value::Null)
            }

            "model.verify" => {
                let id = required_str(args, "id")?;
                let info = self.registry().find(&id)?;
                to_json(&crate::ipc_types::ModelVerifyResult {
                    size_bytes: info.size_bytes,
                    metadata: info.metadata(),
                    // There is no catalog to compare against yet; M1's catalog is the
                    // folder itself. False is the honest answer, not a default true.
                    matches_catalog: info.is_authorised_m1_model(),
                })
            }

            "model.remove" => {
                let id = required_str(args, "id")?;
                if self.active_model.as_deref() == Some(id.as_str())
                    || self.supervisor.launch().is_some_and(|l| l.model_id == id)
                {
                    return Err(NexusError::validation(
                        "id",
                        "unload the model before deleting its file",
                    ));
                }
                let freed = self.registry().remove(&id)?;
                Ok(json!({ "freedBytes": freed }))
            }

            "chat.send" => self.chat_send(args, sink),

            "chat.list" => {
                let query = optional_str(args, "query");
                let limit = optional_usize(args, "limit").unwrap_or(100).clamp(1, 500);
                let offset = optional_usize(args, "offset").unwrap_or(0);
                let (items, total) =
                    self.store()?.list_conversations(query.as_deref(), limit, offset)?;
                to_json(&Paged { items, total: count(total) })
            }

            "chat.get" => {
                let id = required_str(args, "id")?;
                to_json(&self.store()?.get_conversation(&id)?)
            }

            "chat.create" => {
                let model_id = required_str(args, "modelId")?;
                let agent_id = optional_str(args, "agentId").unwrap_or_default();
                let title = optional_str(args, "title");
                let conversation = self.store()?.create_conversation(
                    title.as_deref(),
                    &agent_id,
                    &model_id,
                    &now_iso8601(),
                )?;
                to_json(&conversation)
            }

            "chat.rename" => {
                let id = required_str(args, "id")?;
                let title = required_str(args, "title")?;
                self.store()?.rename_conversation(&id, &title)?;
                Ok(Value::Null)
            }

            "chat.setPinned" => {
                let id = required_str(args, "id")?;
                let pinned = args.get("pinned").and_then(Value::as_bool).ok_or_else(|| {
                    NexusError::validation("pinned", "is required and must be true or false")
                })?;
                self.store()?.set_pinned(&id, pinned)?;
                Ok(Value::Null)
            }

            "chat.delete" => {
                let id = required_str(args, "id")?;
                self.store()?.delete_conversation(&id)?;
                Ok(Value::Null)
            }

            "chat.clearMessages" => {
                let id = required_str(args, "id")?;
                self.store()?.clear_messages(&id, &now_iso8601())?;
                Ok(Value::Null)
            }

            "chat.usage" => {
                let id = required_str(args, "conversationId")?;
                let (last, est) = {
                    let store = self.store()?;
                    let last = store.last_usage(&id)?;
                    let conversation = store.get_conversation(&id)?;
                    let est: u64 = conversation
                        .messages
                        .iter()
                        .map(|m| m.content.chars().count() as u64 / 4 + 4)
                        .sum();
                    (last, est)
                };
                let measured = last.is_some();
                let used = last.map(|u| u.prompt + u.completion).unwrap_or(est);
                to_json(&json!({
                    "contextUsed": used,
                    "contextMax": self.active_context().unwrap_or(admission::DEFAULT_CONTEXT),
                    "estTokens": est,
                    "measured": measured
                }))
            }

            "settings.get" => to_json(&self.store()?.settings()?),

            "settings.patch" => {
                let section = required_str(args, "section")?;
                let values = args
                    .get("values")
                    .and_then(Value::as_object)
                    .ok_or_else(|| NexusError::validation("values", "is required"))?;
                let snapshot = self
                    .store()?
                    .patch_settings(&section, values, &now_iso8601())?;
                to_json(&snapshot)
            }

            "activity.list" => {
                let filter = ActivityFilter {
                    kind: optional_str(args, "kind"),
                    agent_id: optional_str(args, "agentId"),
                    query: optional_str(args, "query"),
                    from: optional_str(args, "from"),
                    to: optional_str(args, "to"),
                    limit: optional_usize(args, "limit").unwrap_or(100).clamp(1, 500),
                    offset: optional_usize(args, "offset").unwrap_or(0),
                };
                let (items, total) = self.store()?.list_activity(&filter)?;
                to_json(&Paged { items, total: count(total) })
            }

            "activity.get" => {
                let id = required_str(args, "id")?;
                to_json(&self.store()?.get_activity(&id)?)
            }

            "activity.export" => {
                let format = optional_str(args, "format").unwrap_or_else(|| "json".to_owned());
                let path = self.export_path("activity", &format)?;
                let (bytes, events) =
                    self.store()?.export_activity(&path, &format, &now_iso8601())?;
                self.log_activity(
                    "task",
                    "Activity exported",
                    &format!("Wrote {events} events ({bytes} bytes) to {}", path.display()),
                    "success",
                );
                to_json(&json!({ "path": path, "events": events }))
            }

            "activity.purge" => {
                let older_than = required_str(args, "olderThan")?;
                let (removed, freed) = {
                    let store = self.store()?;
                    let before = store.file_bytes();
                    let removed = store.purge_activity_before(&older_than)?;
                    (removed, store.file_bytes().saturating_sub(before))
                };
                to_json(&json!({ "removed": removed, "freedBytes": freed }))
            }

            "memory.list" => {
                let tier = optional_str(args, "tier");
                let approval = optional_str(args, "approval");
                let query = optional_str(args, "query");
                let limit = optional_usize(args, "limit").unwrap_or(100).clamp(1, 500);
                let offset = optional_usize(args, "offset").unwrap_or(0);
                let (items, total) = self.store()?.list_memory(
                    tier.as_deref(),
                    approval.as_deref(),
                    query.as_deref(),
                    limit,
                    offset,
                )?;
                to_json(&Paged { items, total: count(total) })
            }

            "memory.get" => {
                let id = required_str(args, "id")?;
                to_json(&self.store()?.get_memory(&id)?)
            }

            "memory.update" => {
                let id = required_str(args, "id")?;
                let patch = args
                    .get("patch")
                    .and_then(Value::as_object)
                    .ok_or_else(|| NexusError::validation("patch", "is required"))?;
                let title = patch.get("title").and_then(Value::as_str);
                let content = patch.get("content").and_then(Value::as_str);
                let tags = patch.get("tags").and_then(Value::as_array).map(|rows| {
                    rows.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect::<Vec<_>>()
                });
                let record = self.store()?.update_memory(
                    &id,
                    title,
                    content,
                    tags.as_deref(),
                    &now_iso8601(),
                )?;
                to_json(&record)
            }

            "memory.approve" | "memory.reject" => {
                let id = required_str(args, "id")?;
                let approval = if command == "memory.approve" { "approved" } else { "rejected" };
                self.store()?.set_memory_approval(&id, approval, &now_iso8601())?;
                Ok(Value::Null)
            }

            "memory.approveAllPending" => {
                let approved = self.store()?.approve_all_pending(&now_iso8601())?;
                to_json(&json!({ "approved": approved }))
            }

            "memory.delete" => {
                let id = required_str(args, "id")?;
                self.store()?.archive_memory(&id, &now_iso8601())?;
                Ok(Value::Null)
            }

            "memory.history" => {
                let id = required_str(args, "id")?;
                to_json(&self.store()?.memory_history(&id)?)
            }

            "store.backup" => {
                let info = self.store()?.backup(None, &now_iso8601())?;
                self.log_activity(
                    "task",
                    "Database backed up",
                    &format!("Wrote a verified copy to {}", info.path),
                    "success",
                );
                to_json(&info)
            }

            "store.restore" => {
                let path = required_str(args, "path")?;
                let info = self.store_mut()?.restore(Path::new(&path), &now_iso8601())?;
                to_json(&info)
            }

            "store.export" => {
                let format = optional_str(args, "format").unwrap_or_else(|| "json".to_owned());
                let requested = optional_str(args, "path");
                let path = match requested {
                    Some(path) if !path.trim().is_empty() => PathBuf::from(path),
                    _ => self.export_path("nexus-export", &format)?,
                };
                let bytes =
                    self.store()?.export_owner_data(&path, &format, &now_iso8601())?;
                self.log_activity(
                    "task",
                    "Owner data exported",
                    &format!("Wrote {bytes} bytes to {}", path.display()),
                    "success",
                );
                to_json(&json!({ "bytes": bytes, "path": path.to_string_lossy() }))
            }

            "store.purge" => {
                let kind = required_str(args, "kind")?;
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                let (removed, freed) = self.store()?.purge(&kind, now_ms)?;
                self.log_activity(
                    "task",
                    "Owner data purged",
                    &format!("kind {kind}: removed {removed} rows, freed {freed} bytes."),
                    "success",
                );
                to_json(&json!({ "removed": removed, "freedBytes": freed }))
            }

            "store.backups" => to_json(&self.store()?.backups()?),

            "chat.stop" => {
                self.cancel.cancel();
                Ok(Value::Null)
            }

            other => Err(NexusError::not_implemented(other)),
        }
    }
}

fn store_missing(detail: Option<&str>) -> NexusError {
    NexusError::new(
        ErrorCode::StoreCorrupt,
        "The local database is not available, so nothing can be saved.",
        false,
    )
    .with_detail(detail.unwrap_or("the store was never opened"))
}

impl From<StoreError> for NexusError {
    fn from(err: StoreError) -> Self {
        let code = match err.code {
            "store.corrupt" => ErrorCode::StoreCorrupt,
            "store.busy" => ErrorCode::StoreBusy,
            "validation.unknown_id" => ErrorCode::ValidationUnknownId,
            "validation.field" => ErrorCode::ValidationField,
            _ => ErrorCode::Internal,
        };
        let out = NexusError::new(
            code,
            err.message,
            matches!(err.code, "store.busy" | "internal"),
        );
        match err.detail {
            Some(detail) => out.with_detail(detail),
            None => out,
        }
    }
}

fn to_json<T: serde::Serialize>(value: &T) -> CoreResult<Value> {
    serde_json::to_value(value).map_err(|e| {
        NexusError::internal("A command result could not be serialised")
            .with_detail(e.to_string())
    })
}

fn required_str(args: &Value, key: &str) -> CoreResult<String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| NexusError::validation(key, "is required"))
}

fn optional_u32(args: &Value, key: &str) -> Option<u32> {
    args.get(key).and_then(Value::as_u64).map(|v| v as u32)
}

fn optional_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn count(total: i64) -> usize {
    usize::try_from(total).unwrap_or(0)
}

fn optional_usize(args: &Value, key: &str) -> Option<usize> {
    args.get(key).and_then(Value::as_u64).map(|v| v as usize)
}

fn new_message_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{n}", now_iso8601().replace(':', ""))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core_with_tmp(tag: &str) -> (Core, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "nexus-dispatch-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        (Core::new(&dir, dir.join("engine")), dir)
    }

    #[test]
    fn unimplemented_commands_refuse_with_the_contract_wording() {
        let (mut core, dir) = core_with_tmp("unimplemented");
        let mut sink = RecordingSink::default();
        let response = core.dispatch("agent.list", &json!({}), &mut sink);
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "not_implemented");
        assert!(value["error"]["message"].as_str().unwrap().contains("agent.list"));
        assert_eq!(sink.events.len(), 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn conversations_persist_through_the_router() {
        let (mut core, dir) = core_with_tmp("conv");
        let mut sink = NullSink;
        let created = core
            .execute(
                "chat.create",
                &json!({ "title": "Notes", "agentId": "universal", "modelId": "m1" }),
                &mut sink,
            )
            .expect("create");
        let id = created["id"].as_str().unwrap().to_owned();
        assert_eq!(created["title"], "Notes");

        let listed = core.execute("chat.list", &json!({}), &mut sink).unwrap();
        assert_eq!(listed["total"], 1);
        assert_eq!(listed["items"][0]["messageCount"], 0);

        core.execute(
            "chat.rename",
            &json!({ "id": id, "title": "Renamed" }),
            &mut sink,
        )
        .unwrap();
        core.execute("chat.setPinned", &json!({ "id": id, "pinned": true }), &mut sink)
            .unwrap();
        let got = core.execute("chat.get", &json!({ "id": id }), &mut sink).unwrap();
        assert_eq!(got["title"], "Renamed");
        assert_eq!(got["pinned"], true);

        core.execute("chat.delete", &json!({ "id": id }), &mut sink).unwrap();
        let listed = core.execute("chat.list", &json!({}), &mut sink).unwrap();
        assert_eq!(listed["total"], 0);

        let missing = core.dispatch("chat.get", &json!({ "id": id }), &mut sink);
        let missing = serde_json::to_value(&missing).unwrap();
        assert_eq!(missing["error"]["code"], "validation.unknown_id");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn owner_export_returns_the_path_it_wrote() {
        let (mut core, dir) = core_with_tmp("export");
        core = core.with_store(Store::open(dir.join("nexus.db")).expect("open store"));
        let mut sink = NullSink;
        let exported = core
            .execute("store.export", &json!({ "format": "json" }), &mut sink)
            .unwrap();
        let path = exported["path"].as_str().expect("path in the response");
        assert!(Path::new(path).is_file(), "the export file exists: {path}");
        assert!(exported["bytes"].as_u64().unwrap_or(0) > 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_restart_reads_the_same_conversation_settings_and_active_model() {
        let (mut core, dir) = core_with_tmp("restart");
        let db = dir.join("nexus.db");
        core = core.with_store(Store::open(&db).expect("open store"));
        let mut sink = NullSink;
        let created = core
            .execute(
                "chat.create",
                &json!({ "title": "Survives", "agentId": "universal", "modelId": "m1" }),
                &mut sink,
            )
            .expect("create");
        let id = created["id"].as_str().unwrap().to_owned();
        core.execute(
            "settings.patch",
            &json!({ "section": "appearance", "values": { "theme": "light" } }),
            &mut sink,
        )
        .unwrap();
        core.execute(
            "settings.patch",
            &json!({ "section": "models", "values": { "active": "m1" } }),
            &mut sink,
        )
        .unwrap();
        drop(core); // closes the database and checkpoints the WAL

        let mut reopened = Core::new(&dir, dir.join("engine"))
            .with_store(Store::open(&db).expect("reopen store"));
        let listed = reopened.execute("chat.list", &json!({}), &mut sink).unwrap();
        assert_eq!(listed["total"], 1);
        assert_eq!(listed["items"][0]["id"], id);
        let got = reopened.execute("chat.get", &json!({ "id": id }), &mut sink).unwrap();
        assert_eq!(got["title"], "Survives");
        let settings = reopened.execute("settings.get", &json!({}), &mut sink).unwrap();
        assert_eq!(settings["sections"]["appearance"]["theme"], "light");
        assert_eq!(settings["sections"]["models"]["active"], "m1");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_question_is_saved_even_when_no_model_is_chosen() {
        let (mut core, dir) = core_with_tmp("question");
        let mut sink = RecordingSink::default();
        // The Chat screen names the conversation locally; the first send creates that row.
        let response = core.dispatch(
            "chat.send",
            &json!({ "conversationId": "c-local", "content": "Hello there" }),
            &mut sink,
        );
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "model.not_installed");
        assert!(sink.events.is_empty());

        let got = core.execute("chat.get", &json!({ "id": "c-local" }), &mut sink).unwrap();
        let messages = got["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"], "Hello there");
        assert_eq!(got["title"], "Hello there");

        // Usage is estimated from the saved text, and says so.
        let usage = core
            .execute("chat.usage", &json!({ "conversationId": "c-local" }), &mut sink)
            .unwrap();
        assert_eq!(usage["measured"], false);
        assert!(usage["estTokens"].as_u64().unwrap() > 0);
        assert_eq!(usage["contextUsed"], usage["estTokens"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn settings_are_stored_read_back_and_validated() {
        let (mut core, dir) = core_with_tmp("settings");
        let mut sink = NullSink;
        let patched = core
            .execute(
                "settings.patch",
                &json!({ "section": "appearance", "values": { "theme": "light" } }),
                &mut sink,
            )
            .unwrap();
        assert_eq!(patched["sections"]["appearance"]["theme"], "light");

        let read = core.execute("settings.get", &json!({}), &mut sink).unwrap();
        assert_eq!(read["sections"]["appearance"]["theme"], "light");
        assert_eq!(read["contractVersion"], 1);

        let bad = core.dispatch(
            "settings.patch",
            &json!({ "section": "nope", "values": {} }),
            &mut sink,
        );
        let bad = serde_json::to_value(&bad).unwrap();
        assert_eq!(bad["error"]["code"], "validation.field");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn backup_refuses_an_in_memory_store_instead_of_writing_a_fake_file() {
        let (mut core, dir) = core_with_tmp("backup");
        let mut sink = NullSink;
        let response = core.dispatch("store.backup", &json!({}), &mut sink);
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "internal");
        assert!(value["error"]["message"].as_str().unwrap().contains("in-memory"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn engine_status_reports_not_installed_without_inventing_a_port() {
        let (mut core, dir) = core_with_tmp("status");
        let mut sink = NullSink;
        let response = core.dispatch("engine.status", &json!({}), &mut sink);
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["ok"], true);
        assert_eq!(value["data"]["installed"], false);
        assert_eq!(value["data"]["running"], false);
        assert!(value["data"].get("port").is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_model_in_the_folder_is_listed_and_gettable() {
        let (mut core, dir) = core_with_tmp("list");
        write_synthetic_gguf(&dir.join("Tiny-Test-Q4_K_M.gguf"));
        let mut sink = NullSink;
        let response = core.dispatch("model.list", &json!({}), &mut sink);
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["ok"], true, "{value}");
        assert_eq!(value["data"]["total"], 1);
        let id = value["data"]["items"][0]["id"].as_str().unwrap().to_owned();
        let get = core.dispatch("model.get", &json!({ "id": id }), &mut sink);
        let get = serde_json::to_value(&get).unwrap();
        assert_eq!(get["ok"], true, "{get}");
        assert_eq!(get["data"]["installed"], true);
        assert_eq!(get["data"]["inCatalog"], false);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn loading_an_unknown_model_is_model_not_found_not_engine_not_installed() {
        let (mut core, dir) = core_with_tmp("unknown");
        let mut sink = NullSink;
        let response =
            core.dispatch("engine.loadModel", &json!({ "modelId": "nope" }), &mut sink);
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["error"]["code"], "model.not_found");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn deleting_the_last_model_is_real_and_reports_freed_bytes() {
        let (mut core, dir) = core_with_tmp("remove");
        let path = dir.join("Tiny-Test-Q4_K_M.gguf");
        write_synthetic_gguf(&path);
        let size = std::fs::metadata(&path).unwrap().len();
        let mut sink = NullSink;
        let listed = core.dispatch("model.list", &json!({}), &mut sink);
        let listed = serde_json::to_value(&listed).unwrap();
        let id = listed["data"]["items"][0]["id"].as_str().unwrap().to_owned();
        let removed = core.dispatch("model.remove", &json!({ "id": id }), &mut sink);
        let removed = serde_json::to_value(&removed).unwrap();
        assert_eq!(removed["ok"], true, "{removed}");
        assert_eq!(removed["data"]["freedBytes"], size);
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn chat_without_a_model_refuses_instead_of_faking_a_reply() {
        let (mut core, dir) = core_with_tmp("chat");
        let mut sink = RecordingSink::default();
        let response = core.dispatch(
            "chat.send",
            &json!({ "conversationId": "c1", "content": "hello" }),
            &mut sink,
        );
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "model.not_installed");
        assert!(sink.events.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The exact path the Chat screen takes in the Tauri build: list from disk, load
    /// through admission, stream `chat.send`, and receive token/usage events.
    /// ```text
    /// $env:NEXUS_LIVE_ENGINE="1"; cargo test -p nexus-core live_chat -- --nocapture
    /// ```
    #[test]
    fn live_chat_send_streams_tokens_and_measured_usage() {
        if std::env::var("NEXUS_LIVE_ENGINE").as_deref() != Ok("1") {
            eprintln!("skipped: set NEXUS_LIVE_ENGINE=1 to load the real model");
            return;
        }
        let models = std::env::var("NEXUS_MODELS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("D:\\NEXUS-MODELS"));
        let engine = std::env::var("NEXUS_ENGINE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("D:\\NEXUS-SIDECAR\\b12189"));
        let mut core = Core::new(&models, &engine);
        let mut sink = RecordingSink::default();

        let listed = core.execute("model.list", &json!({}), &mut sink).unwrap();
        let id = listed["items"][0]["id"].as_str().expect("one installed model").to_owned();
        let loaded = core
            .execute("engine.loadModel", &json!({ "modelId": id }), &mut sink)
            .expect("engine becomes ready");
        println!("loaded {id}: {loaded}");

        let sent = core.execute(
            "chat.send",
            &json!({
                "conversationId": "live-ui",
                "content": "Reply with exactly: NEXUS OK",
                "clientId": "assistant-1"
            }),
            &mut sink,
        );
        // Stop the child before asserting so a failed assertion cannot leave 1.7 GB running.
        let memory = core.supervisor.process_memory();
        core.supervisor.stop();

        let sent = sent.expect("chat.send succeeds");
        assert_eq!(sent["messageId"], "assistant-1");
        let tokens: Vec<&Value> = sink
            .events
            .iter()
            .filter(|(channel, _)| channel == "chat://token")
            .map(|(_, payload)| payload)
            .collect();
        assert!(tokens.len() > 1, "expected deltas plus a done frame");
        assert_eq!(tokens.last().unwrap()["done"], true);
        assert_eq!(tokens.last().unwrap()["conversationId"], "live-ui");
        let text: String = tokens.iter().map(|t| t["delta"].as_str().unwrap_or("")).collect();
        println!("streamed {text:?} in {} frames, private {:?}", tokens.len(), memory);

        let usage = sink
            .events
            .iter()
            .find(|(channel, _)| channel == "chat://usage")
            .map(|(_, payload)| payload)
            .expect("a measured usage frame");
        assert!(usage["contextUsed"].as_u64().unwrap() > 0, "{usage}");
        assert!(usage["contextMax"].as_u64().unwrap() >= usage["contextUsed"].as_u64().unwrap());
    }

    fn write_synthetic_gguf(path: &std::path::Path) {
        // Minimal but structurally real GGUF: enough for the registry, not a model.
        fn s(out: &mut Vec<u8>, v: &str) {
            out.extend_from_slice(&(v.len() as u64).to_le_bytes());
            out.extend_from_slice(v.as_bytes());
        }
        fn u32v(out: &mut Vec<u8>, v: u32) {
            out.extend_from_slice(&v.to_le_bytes());
        }
        fn u64v(out: &mut Vec<u8>, v: u64) {
            out.extend_from_slice(&v.to_le_bytes());
        }
        fn kv_u32(out: &mut Vec<u8>, k: &str, v: u32) {
            s(out, k);
            u32v(out, 4);
            u32v(out, v);
        }
        let mut out = Vec::new();
        u32v(&mut out, 0x4655_4747);
        u32v(&mut out, 3);
        u64v(&mut out, 1);
        u64v(&mut out, 6);
        s(&mut out, "general.name");
        u32v(&mut out, 8);
        s(&mut out, "Tiny Test");
        s(&mut out, "general.architecture");
        u32v(&mut out, 8);
        s(&mut out, "llama");
        kv_u32(&mut out, "general.file_type", 15);
        kv_u32(&mut out, "llama.context_length", 4_096);
        kv_u32(&mut out, "llama.block_count", 4);
        kv_u32(&mut out, "llama.embedding_length", 256);
        s(&mut out, "tiny.weight");
        u32v(&mut out, 1);
        u64v(&mut out, 1_000);
        u32v(&mut out, 0);
        u64v(&mut out, 0);
        std::fs::write(path, out).unwrap();
    }
}
