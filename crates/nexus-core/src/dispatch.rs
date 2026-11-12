//! The contract router: one place where a command name becomes real work or an honest
//! `not_implemented`.
//!
//! The rule from `PHASE2_MILESTONES.md` §1 is enforced structurally: `dispatch` has no
//! catch-all that fabricates a success. Anything not matched here returns
//! [`NexusError::not_implemented`] with the contract's wording, so the UI can keep a
//! `DEMO` banner until its milestone lands.
//!
//! M1 implements `engine.*`, `model.*` and `chat.send/stop`. Everything else still refuses.

use std::path::PathBuf;

use serde_json::{json, Value};

use crate::admission;
use crate::engine::Supervisor;
use crate::error::{CoreResult, NexusError};
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
}

impl Core {
    pub fn new(models_dir: impl Into<PathBuf>, engine_dir: impl Into<PathBuf>) -> Self {
        let models_dir = models_dir.into();
        let engine_dir = engine_dir.into();
        Self {
            supervisor: Supervisor::new(engine_dir.clone()),
            models_dir,
            engine_dir,
            active_model: None,
            cancel: CancelFlag::new(),
        }
    }

    /// Paths come from the environment so the app is not tied to one machine's drive
    /// letters. The defaults are the M1.1/M1.2 locations on the development laptop.
    pub fn from_env() -> Self {
        let models = std::env::var_os("NEXUS_MODELS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("D:\\NEXUS-MODELS"));
        let engine = std::env::var_os("NEXUS_ENGINE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("D:\\NEXUS-SIDECAR\\b12189"));
        Self::new(models, engine)
    }

    pub fn registry(&self) -> Registry {
        Registry::new(&self.models_dir)
    }

    pub fn active_context(&self) -> Option<u32> {
        self.supervisor.launch().map(|l| l.context)
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

    pub fn dispatch(
        &mut self,
        command: &str,
        args: &Value,
        sink: &mut dyn EventSink,
    ) -> Response<Value> {
        match self.route(command, args, sink) {
            Ok(value) => Response::from_core(Ok(value)),
            Err(err) => Response::from_core(Err(err)),
        }
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
                Ok(Value::Null)
            }

            "engine.loadModel" => {
                let model_id = required_str(args, "modelId")?;
                self.load_model(&model_id, sink)?;
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
                self.active_model = Some(id);
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

            "chat.send" => {
                let conversation_id = required_str(args, "conversationId")?;
                let content = required_str(args, "content")?;
                let model_id = self.active_model.clone().ok_or_else(|| {
                    NexusError::new(
                        crate::error::ErrorCode::ModelNotInstalled,
                        "Choose a model before sending a message.",
                        false,
                    )
                })?;
                let context = self.load_model(&model_id, sink)?;
                let message_id = args
                    .get("clientId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .unwrap_or_else(|| new_message_id("a"));
                let messages = inference::trim_to_budget(
                    vec![
                        ChatTurn { role: "system", content: inference::SYSTEM_PROMPT.into() },
                        ChatTurn::user(content),
                    ],
                    context.saturating_sub(512),
                );
                let body = inference::chat_body(&messages, 512, 0.7);
                let loopback = self.supervisor.loopback()?;
                let cancel = self.cancel.clone();
                let outcome = inference::generate(&loopback, &body, &cancel, |delta| {
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
                })?;
                sink.emit(
                    "chat://token",
                    json!({
                        "conversationId": conversation_id,
                        "messageId": message_id,
                        "delta": "",
                        "done": true
                    }),
                );
                sink.emit(
                    "chat://usage",
                    json!({
                        "conversationId": conversation_id,
                        "contextUsed": outcome.prompt_tokens.saturating_add(outcome.completion_tokens),
                        "contextMax": context
                    }),
                );
                Ok(json!({ "messageId": message_id }))
            }

            "chat.stop" => {
                self.cancel.cancel();
                Ok(Value::Null)
            }

            other => Err(NexusError::not_implemented(other)),
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
        let response = core.dispatch("memory.list", &json!({}), &mut sink);
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "not_implemented");
        assert!(value["error"]["message"].as_str().unwrap().contains("memory.list"));
        assert_eq!(sink.events.len(), 0);
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
