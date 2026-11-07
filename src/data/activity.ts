import type { ActivityEvent } from './types';

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

/** Activity Center dataset — simulated log lines, newest first. */
export const MOCK_ACTIVITY: ActivityEvent[] = [
  { id: 'act-1', ts: iso(2), kind: 'tool', title: 'Filesystem Reader listed D:\\NEXUS-AI', detail: '6 entries, 0 ms denied.', agentId: 'developer', status: 'success' },
  { id: 'act-2', ts: iso(6), kind: 'model', title: 'Simulated reply generated (Qwen2.5 Coder 7B)', detail: '181 tokens · window used 22% · simulated.', agentId: 'developer', status: 'success' },
  { id: 'act-3', ts: iso(9), kind: 'task', title: 'Chat "Refactor auth middleware" resumed', detail: 'Restored 4 messages from local state.', agentId: 'developer', status: 'success' },
  { id: 'act-4', ts: iso(15), kind: 'approval', title: 'Approval requested: PowerShell Get-WinEvent', detail: 'Read-only command; auto-approved by policy.', agentId: 'sysadmin', status: 'success' },
  { id: 'act-5', ts: iso(20), kind: 'error', title: 'System Inspector telemetry fetch failed', detail: 'Simulated WMI timeout; Dashboard fell back to cached values.', status: 'failure' },
  { id: 'act-6', ts: iso(24), kind: 'warning', title: 'Context window 82% in "Weekly review draft"', detail: 'Compaction suggested (simulated).', agentId: 'universal', status: 'pending' },
  { id: 'act-7', ts: iso(45), kind: 'tool', title: 'Document Parser indexing hardware-audit-2026-10.xlsx', detail: 'Progress 60% — simulated steady state.', status: 'running' },
  { id: 'act-8', ts: iso(70), kind: 'task', title: 'Knowledge Base collection "Work" search served', detail: '8 documents scanned, 3 chunks returned (mock).', agentId: 'researcher', status: 'success' },
  { id: 'act-9', ts: iso(95), kind: 'model', title: 'Model switch: Llama 3.1 8B → Qwen2.5 Coder 7B', detail: 'Requested by Developer Agent session start.', agentId: 'developer', status: 'success' },
  { id: 'act-10', ts: iso(130), kind: 'approval', title: 'Approval DENIED by user: filesystem delete', detail: 'Agent respected denial; no retry.', status: 'failure' },
  { id: 'act-11', ts: iso(180), kind: 'warning', title: 'RAM headroom dropped under 6 GB (simulated)', detail: 'Background browser heavy; advisory only.', status: 'pending' },
  { id: 'act-12', ts: iso(260), kind: 'task', title: 'Daily memory review job completed', detail: '2 candidates proposed, 0 applied automatically.', agentId: 'universal', status: 'success' },
  { id: 'act-13', ts: iso(400), kind: 'tool', title: 'Git Operator status check on repo', detail: 'Clean tree, main branch (mock output).', agentId: 'developer', status: 'success' },
  { id: 'act-14', ts: iso(520), kind: 'model', title: 'Embedding batch indexed for 4 KB documents', detail: 'BGE-M3 (simulated) — 1.2k chunks.', status: 'success' },
  { id: 'act-15', ts: iso(700), kind: 'error', title: 'OCR request rejected: model not installed', detail: 'Expected in Phase 1 — surfaced as a real UX state.', status: 'failure' },
  { id: 'act-16', ts: iso(900), kind: 'task', title: 'Session restored after app restart', detail: 'Conversations, memories, telemetry cache rehydrated (mock).', status: 'success' },
  { id: 'act-17', ts: iso(1300), kind: 'approval', title: 'Approval requested: web fetch huggingface.co', detail: 'Blocked by Offline mode policy.', agentId: 'researcher', status: 'failure' },
  { id: 'act-18', ts: iso(1600), kind: 'model', title: 'Phi-4 Mini selected for Personal Assistant', detail: 'Low-RAM preference honored from settings.', agentId: 'assistant', status: 'success' },
];
