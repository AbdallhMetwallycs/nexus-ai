//! The Rust mirror of the shapes in `src/contract/ipc.ts` and `src/data/types.ts`.
//!
//! Field-for-field, `camelCase` on the wire, optional fields omitted rather than sent as
//! `null` when unset (which is what TypeScript `?` means). Changing a shape here without
//! changing the TypeScript side in the same commit is a contract bug —
//! `PHASE2_MILESTONES.md` M1 says both sides move together, and the tests below are what
//! makes that visible rather than aspirational.

use serde::{Deserialize, Serialize};

use crate::error::NexusError;

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

/// `Result<T> = { ok: true; data: T } | { ok: false; error: NexusError }`.
///
/// Tauri's own error channel is deliberately not used for contract errors: the envelope is
/// how the core refuses, so the TypeScript `Result` union stays true on both runtimes.
#[derive(Serialize, Debug)]
#[serde(untagged)]
pub enum Response<T: Serialize> {
    #[serde(rename_all = "camelCase")]
    Ok { ok: bool, data: T },
    #[serde(rename_all = "camelCase")]
    Err { ok: bool, error: NexusError },
}

impl<T: Serialize> Response<T> {
    pub fn from_core(result: crate::error::CoreResult<T>) -> Self {
        match result {
            Ok(data) => Response::Ok { ok: true, data },
            Err(error) => Response::Err { ok: false, error },
        }
    }
}

/// Every list command returns this, so "N shown" counters come from `total`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Paged<T> {
    pub items: Vec<T>,
    pub total: usize,
}

/* ------------------------------------------------------------------ */
/* Engine and model domain                                             */
/* ------------------------------------------------------------------ */

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub binary_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub version: Option<String>,
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub loaded_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub threads: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub context_cap: Option<u32>,
    pub crash_count: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub last_crash_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EngineStartInfo {
    pub pid: u32,
    pub port: u16,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelLoadResult {
    /// The Phase 1 spelling keeps the trailing caps; serde's camelCase would otherwise
    /// quietly rename this to `loadedGb` and the UI would read `undefined`.
    #[serde(rename = "loadedGB")]
    pub loaded_gb: f64,
    pub context_capped: u32,
    pub threads: usize,
    /// Wall-clock from spawn to `/health` answering — measured, never assumed.
    pub ready_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FitVerdict {
    Ok,
    Tight,
    Exceeds,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MeasuredFit {
    pub model_id: String,
    pub estimate_gb: f64,
    #[serde(rename = "actualRSSGB", skip_serializing_if = "Option::is_none", default)]
    pub actual_rss_gb: Option<f64>,
    pub verdict: FitVerdict,
    /// False unless a load of this model at this context was really observed on this
    /// machine. `MEASUREMENTS.md` §11 is the only place `true` is currently earned.
    pub measured: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GgufMetadata {
    pub name: String,
    pub architecture: String,
    pub quantization: String,
    pub context_length: u32,
    pub parameter_count: String,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub sha256: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelVerifyResult {
    pub size_bytes: u64,
    pub metadata: GgufMetadata,
    pub matches_catalog: bool,
}

/// Mirror of `ModelRecord` in `src/data/types.ts` — Phase 1 shape, reused verbatim.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRecord {
    pub id: String,
    pub name: String,
    pub family: String,
    /// Billions of parameters.
    pub params_b: f64,
    pub quantization: String,
    pub context_window: u32,
    /// On disk.
    #[serde(rename = "sizeGB")]
    pub size_gb: f64,
    /// Estimated runtime requirement.
    #[serde(rename = "ramGB")]
    pub ram_gb: f64,
    pub gpu_recommended: bool,
    pub installed: bool,
    pub in_catalog: bool,
    pub version: String,
    pub updated_at: String,
    pub description: String,
    pub tags: Vec<String>,
}

/* ------------------------------------------------------------------ */
/* Chat domain                                                         */
/* ------------------------------------------------------------------ */

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentKind {
    Image,
    Pdf,
    Docx,
    Code,
    Csv,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub name: String,
    pub kind: AttachmentKind,
    pub size_kb: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendInput {
    pub conversation_id: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub attachments: Option<Vec<Attachment>>,
    /// UI-generated id so a retried invoke cannot duplicate the message.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub client_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageInfo {
    pub context_used: u32,
    pub context_max: u32,
    pub est_tokens: u32,
    /// False until the core is really counting. The UI must keep saying "simulated"
    /// while this is false.
    pub measured: bool,
}

/* ------------------------------------------------------------------ */
/* Event payloads                                                      */
/* ------------------------------------------------------------------ */

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatTokenEvent {
    pub conversation_id: String,
    pub message_id: String,
    pub delta: String,
    pub done: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatUsageEvent {
    pub conversation_id: String,
    pub context_used: u32,
    pub context_max: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelStateEvent {
    pub model_id: String,
    pub installed: bool,
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub loaded_gb: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn engine_status_uses_the_contract_casing_and_omits_unset_optionals() {
        let status = EngineStatus {
            installed: true,
            binary_path: None,
            version: Some("b12189".into()),
            running: false,
            port: None,
            loaded_model: None,
            threads: None,
            context_cap: None,
            crash_count: 0,
            last_crash_at: None,
        };
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            json!({ "installed": true, "version": "b12189", "running": false, "crashCount": 0 })
        );
    }

    #[test]
    fn measured_fit_can_be_the_honest_shape_and_the_measured_one() {
        // The M1.2 result for the authorised model, and the shape every other model keeps.
        let honest = MeasuredFit {
            model_id: "llama-3.2-3b".into(),
            estimate_gb: 1.68,
            actual_rss_gb: None,
            verdict: FitVerdict::Ok,
            measured: false,
        };
        let json = serde_json::to_value(&honest).unwrap();
        assert_eq!(json["verdict"], "ok");
        assert!(!json.as_object().unwrap().contains_key("actualRSSGB"));
        assert_eq!(json["measured"], false);

        let measured = MeasuredFit { actual_rss_gb: Some(1.68), measured: true, ..honest };
        let json = serde_json::to_value(&measured).unwrap();
        assert_eq!(json["actualRSSGB"], 1.68);
    }

    #[test]
    fn envelope_serialises_to_the_typescript_union() {
        let ok: Response<u32> = Response::from_core(Ok(7));
        assert_eq!(serde_json::to_value(&ok).unwrap(), json!({ "ok": true, "data": 7 }));

        let err: Response<u32> =
            Response::from_core(Err(crate::error::NexusError::not_implemented("chat.usage")));
        let value = serde_json::to_value(&err).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "not_implemented");
        assert!(value.get("data").is_none());
    }

    #[test]
    fn chat_token_event_round_trips_with_done_false_during_stream() {
        let event = ChatTokenEvent {
            conversation_id: "c1".into(),
            message_id: "m1".into(),
            delta: "Hel".into(),
            done: false,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(
            json,
            json!({ "conversationId": "c1", "messageId": "m1", "delta": "Hel", "done": false })
        );
        let back: ChatTokenEvent = serde_json::from_value(json).unwrap();
        assert_eq!(back, event);
    }

    #[test]
    fn model_record_round_trips_through_the_phase_one_shape() {
        let record = ModelRecord {
            id: "llama-3.2-3b".into(),
            name: "Llama 3.2 3B Instruct".into(),
            family: "llama".into(),
            params_b: 3.21,
            quantization: "Q4_K_M".into(),
            context_window: 131_072,
            size_gb: 1.88,
            ram_gb: 1.72,
            gpu_recommended: false,
            installed: true,
            in_catalog: false,
            version: "1.0.0".into(),
            updated_at: "2026-11-07T00:00:00Z".into(),
            description: "Local".into(),
            tags: vec!["local".into()],
        };
        let json = serde_json::to_value(&record).unwrap();
        assert_eq!(json["paramsB"], 3.21);
        assert_eq!(json["contextWindow"], 131_072);
        assert_eq!(json["gpuRecommended"], false);
        let back: ModelRecord = serde_json::from_value(json).unwrap();
        assert_eq!(back, record);
    }
}
