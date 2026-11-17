//! Wire types produced by the store.
//!
//! They mirror `src/contract/ipc.ts` field-for-field with `camelCase` on the wire; additive
//! fields the contract already declares (`stopped`, `usage`, `jobId`, `correlationId`) are
//! omitted rather than sent as null, which is what TypeScript `?` means.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub name: String,
    pub kind: String,
    pub size_kb: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub prompt: u64,
    pub completion: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub ts: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub attachments: Option<Vec<Attachment>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub stopped: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub usage: Option<Usage>,
    /// Citations the answer was grounded in: `{ documentId, citation, page }`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub citations: Option<Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub agent_id: String,
    pub model_id: String,
    pub pinned: bool,
    pub messages: Vec<ChatMessage>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub agent_id: String,
    pub model_id: String,
    pub pinned: bool,
    pub message_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    pub id: String,
    pub ts: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub agent_id: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub correlation_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFilter {
    pub kind: Option<String>,
    pub agent_id: Option<String>,
    pub query: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: usize,
    pub offset: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEvent {
    pub ts: String,
    pub action: String,
    pub detail: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecord {
    pub id: String,
    pub tier: String,
    pub title: String,
    pub content: String,
    pub source: String,
    pub tags: Vec<String>,
    pub approval: String,
    pub created_at: String,
    pub updated_at: String,
    pub history: Vec<MemoryEvent>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub contract_version: i64,
    pub sections: BTreeMap<String, BTreeMap<String, Value>>,
    pub measured: BTreeMap<String, bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub bytes: u64,
    pub schema_version: i64,
    pub verified: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: i64,
    pub created_at: String,
    pub schema_version: i64,
    pub verified: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreInfo {
    pub restored_at: String,
    pub previous_backup: String,
}

/// The 13 Settings section ids the UI renders. A key outside this set is a validation
/// error in the core, matching PHASE2_DATA_MODEL.md §3.1.
pub const SETTINGS_SECTIONS: [&str; 13] = [
    "general",
    "appearance",
    "language",
    "hardware",
    "models",
    "agents",
    "memory",
    "internet",
    "security",
    "privacy",
    "backup",
    "portability",
    "about",
];

/* ------------------------------------------------------------------ */
/* M4: agents, tools, approvals and jobs                               */
/* ------------------------------------------------------------------ */

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRecord {
    pub id: String,
    pub name: String,
    pub role: String,
    pub description: String,
    pub capabilities: Vec<String>,
    pub model_id: String,
    pub instructions: String,
    pub enabled: bool,
    pub built_in: bool,
    pub icon: String,
    pub conversations_last30d: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolRecord {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub permissions: Vec<String>,
    pub needs_approval: bool,
    pub enabled: bool,
    pub status: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub last_run: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub last_error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StandingGrant {
    pub permission: String,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub expires_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolGrantInfo {
    pub permissions: Vec<String>,
    pub needs_approval: bool,
    pub standing: Vec<StandingGrant>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RequestedBy {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tool_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub job_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    pub id: String,
    pub kind: String,
    pub requested_by: RequestedBy,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub detail: Option<String>,
    pub created_at: String,
    pub expires_at: String,
}

/// The stored side of an approval, including fields the UI does not need.
#[derive(Clone, Debug, PartialEq)]
pub struct ApprovalRow {
    pub id: String,
    pub kind: String,
    pub agent_id: Option<String>,
    pub tool_id: Option<String>,
    pub job_id: Option<String>,
    pub step_idx: Option<i64>,
    pub summary: String,
    pub detail: Option<String>,
    pub args_hash: Option<String>,
    pub created_at: String,
    pub expires_at: String,
    pub decided_at: Option<String>,
    pub decision: Option<String>,
    pub scope: Option<String>,
    pub used_at: Option<String>,
    pub correlation_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobStepView {
    pub idx: i64,
    pub tool_id: String,
    pub args: Value,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub finished_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    pub id: String,
    pub kind: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub model_id: Option<String>,
    pub priority: i64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub finished_at: Option<String>,
    pub progress_pct: i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub correlation_id: Option<String>,
    pub steps: Vec<JobStepView>,
}

/// A tool call as the store holds it in `job_step.args`.
#[derive(Clone, Debug, PartialEq)]
pub struct PlannedStep {
    pub tool_id: String,
    pub args: Value,
}
