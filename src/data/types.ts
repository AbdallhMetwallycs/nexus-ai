/** Shared type vocabulary for all NEXUS AI mock datasets (Phase 1). */

export type Approval = 'approved' | 'pending' | 'rejected';
export type IndexStatus = 'indexed' | 'indexing' | 'pending' | 'failed';

export interface ModelRecord {
  id: string;
  name: string;
  family: string;
  paramsB: number; // billions of parameters
  quantization: string; // e.g. 'Q4_K_M'
  contextWindow: number; // tokens
  sizeGB: number; // on-disk
  ramGB: number; // estimated runtime requirement
  gpuRecommended: boolean;
  installed: boolean; // false everywhere in Phase 1 — nothing is actually installed
  inCatalog: boolean;
  version: string;
  updatedAt: string; // ISO date
  description: string;
  tags: string[];
}

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  modelId: string;
  instructions: string;
  enabled: boolean;
  builtIn: boolean;
  icon: string; // lucide icon name
  conversationsLast30d: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Attachment {
  name: string;
  kind: 'image' | 'pdf' | 'docx' | 'code' | 'csv';
  sizeKB: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string; // supports a small markdown subset (see lib/markdown.ts)
  ts: string; // ISO datetime
  modelId?: string;
  agentId?: string;
  attachments?: Attachment[];
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  agentId: string;
  modelId: string;
  pinned: boolean;
  messages: ChatMessage[];
}

export type MemoryTier = 'short' | 'long' | 'preference' | 'project' | 'conversation';

export interface MemoryEvent {
  ts: string;
  action: 'created' | 'edited' | 'approved' | 'rejected' | 'archived';
  detail: string;
}

export interface MemoryRecord {
  id: string;
  tier: MemoryTier;
  title: string;
  content: string;
  source: string; // conversation/tool that produced it
  tags: string[];
  approval: Approval;
  createdAt: string;
  updatedAt: string;
  history: MemoryEvent[];
}

export interface KbFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface KbDocument {
  id: string;
  name: string;
  folderId: string;
  collection: string;
  fileType: 'pdf' | 'docx' | 'md' | 'txt' | 'csv' | 'xlsx';
  sizeKB: number;
  pages: number | null;
  indexed: IndexStatus;
  updatedAt: string;
  excerpt: string;
}

export type ToolStatus = 'ready' | 'disabled' | 'error' | 'running';

export interface ToolDef {
  id: string;
  name: string;
  category: string;
  description: string;
  permissions: string[];
  needsApproval: boolean;
  enabled: boolean;
  status: ToolStatus;
  version: string;
  lastRun: string | null;
}

export interface CustomSkill {
  id: string;
  name: string;
  trigger: string;
  steps: string[];
  updatedAt: string;
}

export type LearningKind = 'correction' | 'mistake' | 'error';
export type SuggestionKind = 'instruction' | 'memory' | 'skill' | 'test';
export type SuggestionStatus = 'proposed' | 'approved' | 'rejected' | 'applied';

export interface LearningSuggestion {
  id: string;
  kind: SuggestionKind;
  text: string;
  status: SuggestionStatus;
}

export interface LearningEvent {
  id: string;
  kind: LearningKind;
  title: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  category: string;
  rootCause: string;
  suggestions: LearningSuggestion[];
  ts: string;
  resolved: boolean;
}

export interface InstructionVersion {
  version: string;
  ts: string;
  summary: string;
  status: 'current' | 'history';
}

export interface TrustedSource {
  id: string;
  domain: string;
  label: string;
  allowed: boolean;
}

export interface UpdateRecord {
  id: string;
  date: string;
  item: string;
  from: string | null;
  to: string;
  kind: 'model' | 'app' | 'skill';
  result: 'success' | 'rolled-back' | 'failed';
}

export type ActivityKind = 'task' | 'tool' | 'model' | 'error' | 'warning' | 'approval';

export interface ActivityEvent {
  id: string;
  ts: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  agentId?: string;
  status: 'success' | 'failure' | 'pending' | 'running';
}
