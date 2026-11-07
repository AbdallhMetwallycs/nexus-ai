import type { AgentDef } from './types';

export const MOCK_AGENTS: AgentDef[] = [
  {
    id: 'universal',
    name: 'NEXUS Universal Agent',
    role: 'Main orchestrator',
    description:
      'Default agent for everything. Routes specialized work to sub-agents, keeps persistent memory, and answers directly when no specialist is needed.',
    capabilities: ['Routing', 'Memory read/write', 'Tool calling', 'Web (when enabled)', 'Sub-agent delegation'],
    modelId: 'llama3.1-8b',
    instructions:
      'You are NEXUS, a personal local AI. Prefer direct answers. Delegate coding to Developer Agent, retrieval-heavy questions to Research Agent, tabular work to Data Analyst. Cite Knowledge Base sources when used. Never claim an action succeeded unless a tool result confirms it.',
    enabled: true,
    builtIn: true,
    icon: 'sparkles',
    conversationsLast30d: 214,
  },
  {
    id: 'developer',
    name: 'Developer Agent',
    role: 'Software engineering',
    description:
      'Writes, refactors, and reviews code in the local workspace. Explains diffs and runs project checks through approved tools only.',
    capabilities: ['Code generation', 'Refactoring', 'Diff review', 'Test authoring'],
    modelId: 'qwen2.5-coder-7b',
    instructions:
      'You are a senior engineer working in a local repo. Always read the file before editing. Keep changes minimal and scoped. Explain trade-offs before large rewrites. Never run destructive commands without asking.',
    enabled: true,
    builtIn: true,
    icon: 'code-2',
    conversationsLast30d: 96,
  },
  {
    id: 'researcher',
    name: 'Research Agent',
    role: 'Information gathering',
    description:
      'Searches the Knowledge Base and, when internet access is granted, trusted web sources. Produces cited summaries with confidence labels.',
    capabilities: ['KB search', 'Web research (gated)', 'Source citation', 'Summarization'],
    modelId: 'mistral-nemo-12b',
    instructions:
      'You are a research analyst. Distinguish verified facts from estimates. Every claim needs a source: Knowledge Base document or URL. If evidence is missing, say so plainly instead of guessing.',
    enabled: true,
    builtIn: true,
    icon: 'search',
    conversationsLast30d: 61,
  },
  {
    id: 'doc-analyst',
    name: 'Document Analyst',
    role: 'Document understanding',
    description:
      'Reads long PDFs, contracts, and reports; extracts structure, obligations, and answers with page references.',
    capabilities: ['Long-document reading', 'Clause extraction', 'Page-referenced answers'],
    modelId: 'llama3.1-8b',
    instructions:
      'You analyze documents from the Knowledge Base. Quote exact passages before interpreting. Report page numbers. Flag anything ambiguous rather than silently choosing a reading.',
    enabled: true,
    builtIn: true,
    icon: 'file-text',
    conversationsLast30d: 38,
  },
  {
    id: 'data-analyst',
    name: 'Data Analyst',
    role: 'Tables and statistics',
    description:
      'Works with CSV/XLSX data: profiling, aggregations, chart-ready summaries, and anomaly callouts. Uses the Python tool when permitted.',
    capabilities: ['CSV/XLSX profiling', 'Aggregations', 'Chart specs', 'Anomaly flags'],
    modelId: 'qwen2.5-14b',
    instructions:
      'You are a careful data analyst. Show the query or computation behind each figure. Label estimates. When data quality is poor, state the limitation before conclusions.',
    enabled: false,
    builtIn: true,
    icon: 'bar-chart-3',
    conversationsLast30d: 12,
  },
  {
    id: 'assistant',
    name: 'Personal Assistant',
    role: 'Daily operations',
    description:
      'Notes, reminders, drafts, and routine correspondence. Knows user preferences from Memory Center.',
    capabilities: ['Drafting', 'Preferences recall', 'Summaries', 'Checklists'],
    modelId: 'phi4-mini-3.8b',
    instructions:
      'You are a personal assistant. Keep replies short and practical. Apply known user preferences from memory. Ask before anything irreversible.',
    enabled: true,
    builtIn: true,
    icon: 'user-round',
    conversationsLast30d: 143,
  },
  {
    id: 'sysadmin',
    name: 'System Administrator',
    role: 'Machine operations',
    description:
      'Inspects and maintains the local Windows machine via PowerShell tools. Every mutating command requires explicit approval.',
    capabilities: ['System inspection', 'Log analysis', 'Service checks', 'Approved mutations only'],
    modelId: 'qwen2.5-coder-7b',
    instructions:
      'You operate on the local machine. Read-only inspection runs freely; any command that changes state must be shown in full and approved first. Never suggest disabling security tooling.',
    enabled: false,
    builtIn: true,
    icon: 'shield-check',
    conversationsLast30d: 7,
  },
];

export function agentById(id: string): AgentDef | undefined {
  return MOCK_AGENTS.find((a) => a.id === id);
}

export function agentName(id: string): string {
  return agentById(id)?.name ?? 'Unknown agent (mock)';
}
