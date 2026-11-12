//! The 21 stable machine-readable error codes from `src/contract/ipc.ts`, mirrored.
//!
//! `not_implemented` is the honesty primitive: a command that exists in the contract but
//! not in this build must return it, never a fabricated success. The wording below is the
//! same sentence the TypeScript transport emits, so a user cannot tell which side refused.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Wire spelling is the dotted contract string, not the Rust variant name.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorCode {
    #[serde(rename = "policy.offline")]
    PolicyOffline,
    #[serde(rename = "policy.approval_required")]
    PolicyApprovalRequired,
    #[serde(rename = "policy.not_allowed")]
    PolicyNotAllowed,
    #[serde(rename = "policy.root_denied")]
    PolicyRootDenied,
    #[serde(rename = "engine.not_installed")]
    EngineNotInstalled,
    #[serde(rename = "engine.crashed")]
    EngineCrashed,
    #[serde(rename = "engine.busy")]
    EngineBusy,
    #[serde(rename = "engine.not_ready")]
    EngineNotReady,
    #[serde(rename = "model.not_found")]
    ModelNotFound,
    #[serde(rename = "model.not_installed")]
    ModelNotInstalled,
    #[serde(rename = "model.ram_admission_failed")]
    ModelRamAdmissionFailed,
    #[serde(rename = "model.corrupt")]
    ModelCorrupt,
    #[serde(rename = "job.cancelled")]
    JobCancelled,
    #[serde(rename = "job.timeout")]
    JobTimeout,
    #[serde(rename = "store.corrupt")]
    StoreCorrupt,
    #[serde(rename = "store.busy")]
    StoreBusy,
    #[serde(rename = "validation.field")]
    ValidationField,
    #[serde(rename = "validation.unknown_id")]
    ValidationUnknownId,
    #[serde(rename = "contract.mismatch")]
    ContractMismatch,
    #[serde(rename = "not_implemented")]
    NotImplemented,
    #[serde(rename = "internal")]
    Internal,
}

/// `NexusError` in the contract: `message` is safe to render, `detail` is the arithmetic
/// or path behind it, `retryable` tells the UI whether a second press is honest.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NexusError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub detail: Option<String>,
    pub retryable: bool,
}

impl NexusError {
    pub fn new(code: ErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self { code, message: message.into(), detail: None, retryable }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    /// The honesty primitive. Mirrors `notImplementedError()` in `src/contract/client.ts`.
    pub fn not_implemented(command: &str) -> Self {
        Self::new(
            ErrorCode::NotImplemented,
            format!("“{command}” is not implemented in this build."),
            false,
        )
        .with_detail(
            "The command exists in src/contract/ipc.ts and PHASE2_IPC_CONTRACT.md; it becomes \
             real per PHASE2_MILESTONES.md (M1 engine, M2 storage, M3 knowledge, M4 agents, \
             M5 learning, M6 packaging).",
        )
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message, true)
    }

    pub fn io(context: &str, err: &std::io::Error) -> Self {
        Self::internal(format!("{context} failed")).with_detail(format!("{err} — {:?}", err.kind()))
    }

    pub fn validation(field: &str, problem: impl Into<String>) -> Self {
        Self::new(ErrorCode::ValidationField, format!("{field}: {}", problem.into()), false)
    }

    pub fn engine_not_ready(detail: impl Into<String>) -> Self {
        Self::new(ErrorCode::EngineNotReady, "The model engine is not answering yet.", true)
            .with_detail(detail)
    }

    pub fn model_not_found(id: &str) -> Self {
        Self::new(ErrorCode::ModelNotFound, format!("No model named “{id}” is registered."), false)
    }

    pub fn ram_admission(detail: impl Into<String>) -> Self {
        Self::new(
            ErrorCode::ModelRamAdmissionFailed,
            "This model does not fit the memory free right now, so it was not loaded.",
            true,
        )
        .with_detail(detail)
    }

    pub fn corrupt_model(path: &str, detail: impl Into<String>) -> Self {
        Self::new(ErrorCode::ModelCorrupt, format!("{path} is not a readable GGUF model."), false)
            .with_detail(detail)
    }
}

impl fmt::Display for NexusError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.detail {
            Some(d) => write!(f, "{:?}: {} — {}", self.code, self.message, d),
            None => write!(f, "{:?}: {}", self.code, self.message),
        }
    }
}

impl std::error::Error for NexusError {}

impl From<std::io::Error> for NexusError {
    fn from(err: std::io::Error) -> Self {
        Self::io("A filesystem or socket call", &err)
    }
}

impl From<serde_json::Error> for NexusError {
    fn from(err: serde_json::Error) -> Self {
        Self::internal("JSON did not parse").with_detail(err.to_string())
    }
}

pub type CoreResult<T> = Result<T, NexusError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_serialize_to_their_contract_strings() {
        assert_eq!(serde_json::to_string(&ErrorCode::PolicyOffline).unwrap(), "\"policy.offline\"");
        assert_eq!(
            serde_json::to_string(&ErrorCode::ModelRamAdmissionFailed).unwrap(),
            "\"model.ram_admission_failed\""
        );
        assert_eq!(serde_json::to_string(&ErrorCode::NotImplemented).unwrap(), "\"not_implemented\"");
    }

    #[test]
    fn every_contract_code_round_trips() {
        // The TypeScript union has 21 members; if this list drifts, the mirror is broken.
        let codes = [
            ErrorCode::PolicyOffline,
            ErrorCode::PolicyApprovalRequired,
            ErrorCode::PolicyNotAllowed,
            ErrorCode::PolicyRootDenied,
            ErrorCode::EngineNotInstalled,
            ErrorCode::EngineCrashed,
            ErrorCode::EngineBusy,
            ErrorCode::EngineNotReady,
            ErrorCode::ModelNotFound,
            ErrorCode::ModelNotInstalled,
            ErrorCode::ModelRamAdmissionFailed,
            ErrorCode::ModelCorrupt,
            ErrorCode::JobCancelled,
            ErrorCode::JobTimeout,
            ErrorCode::StoreCorrupt,
            ErrorCode::StoreBusy,
            ErrorCode::ValidationField,
            ErrorCode::ValidationUnknownId,
            ErrorCode::ContractMismatch,
            ErrorCode::NotImplemented,
            ErrorCode::Internal,
        ];
        assert_eq!(codes.len(), 21);
        for code in codes {
            let json = serde_json::to_string(&code).unwrap();
            let back: ErrorCode = serde_json::from_str(&json).unwrap();
            assert_eq!(code, back, "{json}");
        }
    }

    #[test]
    fn error_envelope_matches_the_typescript_guard() {
        // client.ts isNexusError(): string code, string message, optional string detail,
        // boolean retryable — and it must survive camelCase.
        let err = ErrorCode::EngineNotInstalled;
        let value = serde_json::to_value(err).unwrap();
        assert_eq!(value, serde_json::json!("engine.not_installed"));

        let e = NexusError::not_implemented("chat.regenerate");
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["code"], "not_implemented");
        assert!(json["message"].as_str().unwrap().contains("chat.regenerate"));
        assert!(json["detail"].is_string());
        assert_eq!(json["retryable"], false);
    }
}
