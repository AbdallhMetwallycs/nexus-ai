/**
 * NEXUS AI — Phase 2 IPC contract (materialised from PHASE2_IPC_CONTRACT.md)
 *
 * This file is the seam between the React UI and the future Rust core. It declares
 * the wire contract only: no screen imports it yet, and no command is implemented.
 * Until M1 lands, every call resolves to `not_implemented` (see client.ts) — that is
 * the Phase 1 honesty rule expressed as types rather than as a banner.
 *
 * Provenance rules:
 *  - Phase 1 shapes in `src/data/types.ts` are reused verbatim, never re-declared.
 *  - Every command here has a matching entry in PHASE2_IPC_CONTRACT.md §3, and every
 *    event has a row in §4. Changing one file without the other is a contract bug.
 *  - `isolatedModules` is on, so Phase 1 types are re-exported with `export type`.
 */

import type {
  ActivityEvent,
  ActivityKind,
  AgentDef,
  Approval,
  Attachment,
  ChatMessage,
  Conversation,
  CustomSkill,
  IndexStatus,
  InstructionVersion,
  KbDocument,
  KbFolder,
  LearningEvent,
  LearningKind,
  LearningSuggestion,
  MemoryEvent,
  MemoryRecord,
  MemoryTier,
  ModelRecord,
  SuggestionKind,
  SuggestionStatus,
  ToolDef,
  ToolStatus,
  TrustedSource,
} from '../data/types';
import type { Telemetry } from '../data/hardware';

export type {
  ActivityEvent,
  ActivityKind,
  AgentDef,
  Approval,
  Attachment,
  ChatMessage,
  Conversation,
  CustomSkill,
  IndexStatus,
  InstructionVersion,
  KbDocument,
  KbFolder,
  LearningEvent,
  LearningKind,
  LearningSuggestion,
  MemoryEvent,
  MemoryRecord,
  MemoryTier,
  ModelRecord,
  SuggestionKind,
  SuggestionStatus,
  ToolDef,
  ToolStatus,
  TrustedSource,
  Telemetry,
};

/** Bumped only on incompatible contract changes; the core handshake checks it. */
export const CONTRACT_VERSION = 1 as const;

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

/**
 * Stable machine-readable codes. `not_implemented` is the honesty primitive:
 * a command that exists in the contract but not yet in the build must return it,
 * never a fabricated success.
 */
export type ErrorCode =
  | 'policy.offline'
  | 'policy.approval_required'
  | 'policy.not_allowed'
  | 'policy.root_denied'
  | 'engine.not_installed'
  | 'engine.crashed'
  | 'engine.busy'
  | 'engine.not_ready'
  | 'model.not_found'
  | 'model.not_installed'
  | 'model.ram_admission_failed'
  | 'model.corrupt'
  | 'job.cancelled'
  | 'job.timeout'
  | 'store.corrupt'
  | 'store.busy'
  | 'validation.field'
  | 'validation.unknown_id'
  | 'contract.mismatch'
  | 'not_implemented'
  | 'internal';

export interface NexusError {
  code: ErrorCode;
  /** Safe to render. Written for a human, not for a log line. */
  message: string;
  /** Diagnostic detail: the numbers behind a refusal, a path, a command line. */
  detail?: string;
  retryable: boolean;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: NexusError };

/** Every list command returns this, so "N shown" counters come from `total`. */
export interface Paged<T> {
  items: T[];
  total: number;
}

/** Anything that takes queue time returns a job handle, never a direct answer. */
export interface JobRef {
  jobId: string;
}

export type JobKind =
  | 'generate'
  | 'index'
  | 'embed'
  | 'tool'
  | 'agent_run'
  | 'export'
  | 'backup'
  | 'regression'
  | 'update_check';

export type JobStatus = 'queued' | 'running' | 'success' | 'failure' | 'cancelled' | 'timeout';

export interface JobInfo {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progressPct: number;
  message?: string;
  agentId?: string;
  modelId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  correlationId?: string;
}

/* ------------------------------------------------------------------ */
/* Engine and model domain                                             */
/* ------------------------------------------------------------------ */

export interface EngineStatus {
  installed: boolean;
  binaryPath?: string;
  version?: string;
  running: boolean;
  port?: number;
  loadedModel?: string;
  threads?: number;
  contextCap?: number;
  crashCount: number;
  lastCrashAt?: string;
}

export interface EngineStartInfo {
  pid: number;
  port: number;
}

export interface ModelLoadResult {
  loadedGB: number;
  contextCapped: number;
  threads: number;
  /** Wall-clock from spawn-ready to first token budget; measured, never assumed. */
  readyMs: number;
}

export type FitVerdict = 'ok' | 'tight' | 'exceeds';

export interface MeasuredFit {
  modelId: string;
  estimateGB: number;
  actualRSSGB: number | null;
  verdict: FitVerdict;
  measured: boolean;
}

export interface GgufMetadata {
  name: string;
  architecture: string;
  quantization: string;
  contextLength: number;
  parameterCount: string;
  sizeBytes: number;
  sha256?: string;
}

export interface ModelVerifyResult {
  sizeBytes: number;
  metadata: GgufMetadata;
  matchesCatalog: boolean;
}

export interface ModelListQuery {
  query?: string;
  sort?: 'name' | 'ram' | 'size' | 'context' | 'updated';
  installedOnly?: boolean;
  limit?: number;
  offset?: number;
}

/* ------------------------------------------------------------------ */
/* Chat domain                                                         */
/* ------------------------------------------------------------------ */

/**
 * List projection: the conversation list must not drag every message over IPC.
 * Documented in PHASE2_IPC_CONTRACT.md §3.3 (same commit as this file).
 */
export type ConversationSummary = Omit<Conversation, 'messages'> & { messageCount: number };

export interface ChatCreateInput {
  title?: string;
  agentId: string;
  modelId: string;
}

export interface ChatSendInput {
  conversationId: string;
  content: string;
  attachments?: Attachment[];
  /** UI-generated UUID so a retried invoke cannot duplicate the message. */
  clientId?: string;
  /** Agent to record when `chat.send` has to create a conversation the store has not seen. */
  agentId?: string;
}

export interface ChatRegenerateInput {
  conversationId: string;
  messageId: string;
}

export interface UsageInfo {
  contextUsed: number;
  contextMax: number;
  estTokens: number;
  /** False until the core is really counting. The UI must keep saying "simulated" while false. */
  measured: boolean;
}

/* ------------------------------------------------------------------ */
/* Agent, tool, skill domains                                          */
/* ------------------------------------------------------------------ */

export interface AgentCreateInput {
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  modelId: string;
  instructions: string;
  icon: string;
  builtIn?: false;
}

export interface AgentInstructions {
  current: InstructionVersion[];
  raw: string;
  contentPath: string;
  contentSha: string;
}

export interface AgentRunInput {
  agentId: string;
  input: string;
  modelId?: string;
}

export interface ToolGrantInfo {
  permissions: string[];
  needsApproval: boolean;
  standing: { permission: string; scope: 'once' | 'always' | 'never'; expiresAt?: string }[];
}

export interface SkillUpsertInput {
  id?: string;
  name: string;
  trigger: string;
  steps: string[];
}

/* ------------------------------------------------------------------ */
/* Approval domain                                                     */
/* ------------------------------------------------------------------ */

export type ApprovalKind =
  | 'tool_call'
  | 'memory_write'
  | 'net_fetch'
  | 'model_download'
  | 'instruction_change';

export type ApprovalScope = 'once' | 'always' | 'never';

export interface PendingApproval {
  id: string;
  kind: ApprovalKind;
  requestedBy: { agentId?: string; toolId?: string; jobId?: string };
  /** Plain language: "Delete 3 files in D:\Reports", not an internal call. */
  summary: string;
  detail?: string;
  createdAt: string;
  /** Expiry is a denial, never a silent grant. */
  expiresAt: string;
}

export interface ApprovalDecisionInput {
  id: string;
  approved: boolean;
  scope?: ApprovalScope;
}

/* ------------------------------------------------------------------ */
/* Memory domain                                                       */
/* ------------------------------------------------------------------ */

export interface MemoryListQuery {
  tier?: MemoryTier;
  approval?: Approval;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryUpdatePatch {
  title?: string;
  content?: string;
  tags?: string[];
}

export interface MemorySearchInput {
  query: string;
  tiers?: MemoryTier[];
  maxResults?: number;
}

export interface RetrievedMemory extends MemoryRecord {
  score: number;
  /** Why this row entered the prompt — the difference between trust and faith. */
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Knowledge base domain                                               */
/* ------------------------------------------------------------------ */

export interface KbListQuery {
  folderId?: string;
  collection?: string;
  types?: KbDocument['fileType'][];
  query?: string;
  limit?: number;
  offset?: number;
}

export interface KbStats {
  documents: number;
  chunks: number;
  indexedBytes: number;
  pending: number;
  failed: number;
  roots: { path: string; watching: boolean }[];
}

export interface RetrievedChunk {
  documentId: string;
  chunkId: string;
  text: string;
  page: number | null;
  score: number;
  /** "rental-agreement-2026.pdf p.3" — citation is a contract field, not UI decoration. */
  citation: string;
}

export interface KbSearchInput {
  query: string;
  collections?: string[];
  maxResults?: number;
}

export interface KbSearchResult {
  items: RetrievedChunk[];
  /** False while the index is a stub: keyword-only, no vectors. */
  measured: boolean;
}

export interface AttachmentIngestInput {
  conversationId: string;
  messageId: string;
  paths: string[];
}

/* ------------------------------------------------------------------ */
/* Network domain                                                      */
/* ------------------------------------------------------------------ */

export type ConnectionMode = 'offline' | 'online';

export type InternetPermissionKey =
  | 'offlineByDefault'
  | 'perAgentControl'
  | 'perRequestPrompt'
  | 'allowListOnly'
  | 'sendFullContext'
  | 'blockUploadsOfPrivateDocs';

export interface AgentNetGrant {
  agentId: string;
  allowed: boolean;
}

export interface NetFetchInput {
  url: string;
  reason: string;
  agentId?: string;
}

/* ------------------------------------------------------------------ */
/* Activity, learning, settings, system, store                         */
/* ------------------------------------------------------------------ */

export interface ActivityListQuery {
  kind?: ActivityKind;
  agentId?: string;
  query?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export type ExportFormat = 'json' | 'csv';

export interface ExportResult {
  path: string;
  events: number;
}

export interface LearningListQuery {
  resolved?: boolean;
  kind?: LearningKind;
  limit?: number;
}

export interface CorrectionInput {
  title: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  category: string;
  agentId?: string;
}

export interface SuggestionOutcome {
  instructionVersion?: string;
  memoryId?: string;
  skillId?: string;
}

export interface RegressionSuite {
  cases: number;
  passing: number;
  failing: number;
  /** Explicit, because an untested case is not a passing one. */
  neverRun: number;
}

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'language'
  | 'hardware'
  | 'models'
  | 'agents'
  | 'memory'
  | 'internet'
  | 'security'
  | 'privacy'
  | 'backup'
  | 'portability'
  | 'about';

export type SettingValue = boolean | string | number | string[];

export interface AppSettings {
  contractVersion: number;
  sections: Record<SettingsSectionId, Record<string, SettingValue>>;
  /** Keys whose value came from the system rather than the owner. */
  measured: Record<string, boolean>;
}

export interface HardwareProfile {
  cpu: string;
  cpuCoresPhysical: number;
  cpuCoresLogical: number;
  ramTotalGB: number;
  ramFreeGB: number;
  gpu: string[];
  os: string;
  /** Which volume actually holds app data — the mock profile got this wrong. */
  dataVolume: { root: string; totalGB: number; freeGB: number };
  measured: boolean;
}

export interface BackupResult {
  path: string;
  bytes: number;
  schemaVersion: number;
  verified: boolean;
}

export interface BackupRecord {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  schemaVersion: number;
  verified: boolean;
}

export interface RestoreResult {
  restoredAt: string;
  previousBackup: string;
}

export interface PurgeResult {
  removed: number;
  freedBytes: number;
}

export type PurgeKind = 'short_term_memory' | 'activity' | 'cache' | 'learning';

/* ------------------------------------------------------------------ */
/* Command surface                                                     */
/* ------------------------------------------------------------------ */

/**
 * The complete command map. `args` is `undefined` for no-argument commands so the
 * generated client can make the parameter disappear rather than accept `{}`.
 */
export interface CommandSpecs {
  // engine
  'engine.status': { args: undefined; res: EngineStatus };
  'engine.start': { args: undefined; res: EngineStartInfo };
  'engine.stop': { args: undefined; res: void };
  'engine.loadModel': { args: { modelId: string }; res: ModelLoadResult };
  'engine.unloadModel': { args: undefined; res: void };
  'engine.measuredFit': { args: { modelId: string }; res: MeasuredFit };

  // models
  'model.list': { args: ModelListQuery; res: Paged<ModelRecord> };
  'model.get': { args: { id: string }; res: ModelRecord };
  'model.setActive': { args: { id: string }; res: void };
  'model.verify': { args: { id: string }; res: ModelVerifyResult };
  'model.remove': { args: { id: string }; res: { freedBytes: number } };
  'model.importFromPath': { args: { path: string }; res: ModelRecord };

  // chat
  'chat.list': { args: { query?: string; limit?: number; offset?: number }; res: Paged<ConversationSummary> };
  'chat.get': { args: { id: string }; res: Conversation };
  'chat.create': { args: ChatCreateInput; res: Conversation };
  'chat.rename': { args: { id: string; title: string }; res: void };
  'chat.setPinned': { args: { id: string; pinned: boolean }; res: void };
  'chat.delete': { args: { id: string }; res: void };
  'chat.clearMessages': { args: { id: string }; res: void };
  'chat.send': { args: ChatSendInput; res: { messageId: string } };
  'chat.stop': { args: { conversationId: string }; res: void };
  'chat.regenerate': { args: ChatRegenerateInput; res: { messageId: string } };
  'chat.usage': { args: { conversationId: string }; res: UsageInfo };

  // agents
  'agent.list': { args: { query?: string; enabledOnly?: boolean }; res: Paged<AgentDef> };
  'agent.get': { args: { id: string }; res: AgentDef };
  'agent.create': { args: AgentCreateInput; res: AgentDef };
  'agent.update': { args: { id: string; patch: Partial<AgentCreateInput> }; res: AgentDef };
  'agent.setEnabled': { args: { id: string; enabled: boolean }; res: void };
  'agent.duplicate': { args: { id: string }; res: AgentDef };
  'agent.delete': { args: { id: string }; res: void };
  'agent.assignModel': { args: { id: string; modelId: string }; res: void };
  'agent.instructions': { args: { id: string }; res: AgentInstructions };
  'agent.run': { args: AgentRunInput; res: JobRef };

  // tools and skills
  'tool.list': { args: { query?: string; category?: string; enabledOnly?: boolean }; res: Paged<ToolDef> };
  'tool.setEnabled': { args: { id: string; enabled: boolean }; res: void };
  'tool.testRun': { args: { id: string }; res: JobRef };
  'tool.grants': { args: { id: string }; res: ToolGrantInfo };
  'tool.setGrant': { args: { id: string; permission: string; scope: ApprovalScope }; res: void };
  'skill.list': { args: undefined; res: Paged<CustomSkill> };
  'skill.upsert': { args: SkillUpsertInput; res: CustomSkill };
  'skill.delete': { args: { id: string }; res: void };

  // approvals
  'approval.pending': { args: undefined; res: PendingApproval[] };
  'approval.decide': { args: ApprovalDecisionInput; res: void };
  'approval.history': { args: { limit?: number }; res: ActivityEvent[] };

  // memory
  'memory.list': { args: MemoryListQuery; res: Paged<MemoryRecord> };
  'memory.get': { args: { id: string }; res: MemoryRecord };
  'memory.update': { args: { id: string; patch: MemoryUpdatePatch }; res: MemoryRecord };
  'memory.approve': { args: { id: string }; res: void };
  'memory.reject': { args: { id: string }; res: void };
  'memory.approveAllPending': { args: undefined; res: { approved: number } };
  'memory.delete': { args: { id: string }; res: void };
  'memory.history': { args: { id: string }; res: MemoryEvent[] };
  'memory.search': { args: MemorySearchInput; res: { items: RetrievedMemory[]; measured: boolean } };

  // knowledge base
  'kb.tree': { args: undefined; res: KbFolder[] };
  'kb.listDocuments': { args: KbListQuery; res: Paged<KbDocument> };
  'kb.watchRoot': { args: { path: string }; res: { root: string; label: string } };
  'kb.unwatchRoot': { args: { path: string }; res: void };
  'kb.reindex': { args: { id: string }; res: JobRef };
  'kb.deleteDocument': { args: { id: string }; res: void };
  'kb.moveDocument': { args: { id: string; collection: string }; res: void };
  'kb.stats': { args: undefined; res: KbStats };
  'kb.search': { args: KbSearchInput; res: KbSearchResult };
  'kb.ingestAttachment': { args: AttachmentIngestInput; res: JobRef };

  // network policy
  'net.mode': { args: undefined; res: ConnectionMode };
  'net.setMode': { args: { mode: ConnectionMode }; res: void };
  'net.permissions': { args: undefined; res: Record<InternetPermissionKey, boolean> };
  'net.setPermission': { args: { key: InternetPermissionKey; allowed: boolean }; res: void };
  'net.agentGrants': { args: undefined; res: AgentNetGrant[] };
  'net.setAgentGrant': { args: { agentId: string; allowed: boolean }; res: void };
  'net.allowList': { args: undefined; res: TrustedSource[] };
  'net.addAllRule': { args: { domain: string; label: string }; res: TrustedSource };
  'net.removeRule': { args: { id: string }; res: void };
  'net.checkUpdates': { args: undefined; res: JobRef };
  'net.fetch': { args: NetFetchInput; res: JobRef };

  // activity
  'activity.list': { args: ActivityListQuery; res: Paged<ActivityEvent> };
  'activity.get': { args: { id: string }; res: ActivityEvent };
  'activity.export': { args: { format: ExportFormat }; res: ExportResult };
  'activity.purge': { args: { olderThan: string }; res: PurgeResult };

  // learning
  'learning.list': { args: LearningListQuery; res: Paged<LearningEvent> };
  'learning.logCorrection': { args: CorrectionInput; res: LearningEvent };
  'learning.suggestions': { args: { eventId: string }; res: LearningSuggestion[] };
  'learning.approveSuggestion': { args: { id: string }; res: SuggestionOutcome };
  'learning.rejectSuggestion': { args: { id: string }; res: void };
  'learning.instructionVersions': { args: { agentId: string }; res: InstructionVersion[] };
  'learning.switchInstructionVersion': { args: { agentId: string; version: string }; res: void };
  'learning.regressionSuite': { args: undefined; res: RegressionSuite };
  'learning.runRegression': { args: undefined; res: JobRef };

  // settings, system, store
  'settings.get': { args: undefined; res: AppSettings };
  'settings.patch': { args: { section: SettingsSectionId; values: Record<string, SettingValue> }; res: AppSettings };
  'system.telemetry': { args: undefined; res: Telemetry };
  'system.profile': { args: undefined; res: HardwareProfile };
  'system.pickDirectory': { args: { purpose?: string }; res: { path: string } | null };
  'store.backup': { args: undefined; res: BackupResult };
  'store.backups': { args: undefined; res: BackupRecord[] };
  'store.restore': { args: { path: string }; res: RestoreResult };
  'store.export': { args: { path?: string; format: ExportFormat }; res: { bytes: number; path: string } };
  'store.purge': { args: { kind: PurgeKind }; res: PurgeResult };
}

export type CommandName = keyof CommandSpecs;
export type ArgsOf<C extends CommandName> = CommandSpecs[C]['args'];
export type ResOf<C extends CommandName> = CommandSpecs[C]['res'];

/**
 * How a command's arguments appear at the call site:
 *  - `args: undefined`            → no parameter at all, so nobody can pass a fake `{}`
 *  - args type every field optional (`{} extends A`) → the whole object is optional,
 *    which is what a pure paging/filter query should be
 *  - otherwise                    → required
 * `{} extends A` is the type-level question "can an empty object legally be this args
 * value?" — the same test the compiler applies at the call site, so the signature and
 * the accepted call cannot drift.
 */
export type ArgsTuple<C extends CommandName> = [ArgsOf<C>] extends [undefined]
  ? []
  : {} extends ArgsOf<C>
    ? [args?: ArgsOf<C>]
    : [args: ArgsOf<C>];

/* ------------------------------------------------------------------ */
/* Event channels                                                      */
/* ------------------------------------------------------------------ */

export interface ChatTokenEvent {
  conversationId: string;
  messageId: string;
  delta: string;
  done: boolean;
}

export interface ChatUsageEvent {
  conversationId: string;
  contextUsed: number;
  contextMax: number;
}

export interface JobProgressEvent {
  jobId: string;
  kind: JobKind;
  pct: number;
  message: string;
}

export interface JobStateEvent {
  jobId: string;
  status: JobStatus;
  error?: string;
}

export interface ModelStateEvent {
  modelId: string;
  installed: boolean;
  active: boolean;
  loadedGB: number | null;
}

export interface KbDocumentEvent {
  documentId: string;
  indexed: IndexStatus;
  chunks?: number;
  lastError?: string;
}

export interface MemoryChangedEvent {
  id: string;
  approval: Approval;
}

export interface NetBlockedEvent {
  url: string;
  reason: string;
  agentId?: string;
}

export interface TelemetryTickEvent extends Telemetry {}

/**
 * Rule from the contract: the UI subscribes and renders; it never infers live state
 * from timing. Every badge that changes without user action needs a row here.
 */
export interface EventSpecs {
  'chat://token': ChatTokenEvent;
  'chat://usage': ChatUsageEvent;
  'job://progress': JobProgressEvent;
  'job://state': JobStateEvent;
  'approval://pending': PendingApproval;
  'model://state': ModelStateEvent;
  'kb://document': KbDocumentEvent;
  'memory://changed': MemoryChangedEvent;
  'net://blocked': NetBlockedEvent;
  'telemetry://tick': TelemetryTickEvent;
}

export type EventName = keyof EventSpecs;
export type PayloadOf<E extends EventName> = EventSpecs[E];
export type EventHandler<E extends EventName> = (payload: PayloadOf<E>) => void;
export type Unsubscribe = () => void;
