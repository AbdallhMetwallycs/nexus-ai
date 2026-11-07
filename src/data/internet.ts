import type { TrustedSource, UpdateRecord } from './types';

export const MOCK_TRUSTED_SOURCES: TrustedSource[] = [
  { id: 'src-mdn', domain: 'developer.mozilla.org', label: 'MDN Web Docs', allowed: true },
  { id: 'src-ms', domain: 'learn.microsoft.com', label: 'Microsoft Learn', allowed: true },
  { id: 'src-arxiv', domain: 'arxiv.org', label: 'arXiv', allowed: true },
  { id: 'src-hf', domain: 'huggingface.co', label: 'Hugging Face (model cards)', allowed: true },
  { id: 'src-wiki', domain: 'en.wikipedia.org', label: 'Wikipedia', allowed: false },
  { id: 'src-reddit', domain: 'reddit.com', label: 'Reddit', allowed: false },
];

export const MOCK_UPDATE_HISTORY: UpdateRecord[] = [
  { id: 'upd-1', date: '2026-11-03', item: 'NEXUS app', from: '0.9.8', to: '0.9.9', kind: 'app', result: 'success' },
  { id: 'upd-2', date: '2026-10-27', item: 'Qwen2.5 Coder 7B weights', from: '1.1.0', to: '1.2.0', kind: 'model', result: 'success' },
  { id: 'upd-3', date: '2026-10-20', item: 'PowerShell Runner', from: '2.0.0', to: '2.0.1', kind: 'skill', result: 'success' },
  { id: 'upd-4', date: '2026-10-14', item: 'Document Parser', from: '2.1.0', to: '2.2.0', kind: 'skill', result: 'rolled-back' },
  { id: 'upd-5', date: '2026-10-05', item: 'NEXUS app', from: '0.9.7', to: '0.9.8', kind: 'app', result: 'success' },
  { id: 'upd-6', date: '2026-09-29', item: 'Qwen2.5 14B weights', from: '1.1.1', to: '1.1.2', kind: 'model', result: 'failed' },
];

export const INTERNET_PERMISSION_DEFAULTS = {
  offlineByDefault: true,
  perAgentControl: true,
  perRequestPrompt: true,
  allowListOnly: true,
  sendFullContext: false,
  blockUploadsOfPrivateDocs: true,
} as const;
