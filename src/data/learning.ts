import type { InstructionVersion, LearningEvent } from './types';

/**
 * Learning Lab dataset.
 * Phase 1 rule: the model does NOT learn automatically. Every entry below
 * is a simulated pipeline record; approvals only change frontend state.
 */
export const MOCK_LEARNING_EVENTS: LearningEvent[] = [
  {
    id: 'learn-1',
    kind: 'correction',
    title: 'User corrected SMR defrag advice',
    detail:
      'Assistant said frequent defragmentation is harmless on the secondary HDD. User corrected: the drive is SMR and regular defrag is harmful to it.',
    severity: 'high',
    category: 'Hardware facts',
    rootCause:
      'Confidence miscalibration: the assistant treated a general HDD rule as universal instead of checking shingled vs conventional technology.',
    suggestions: [
      {
        id: 'learn-1-s1',
        kind: 'memory',
        text: 'Update long-term hardware memory: mark D: secondary drive as SMR; forbid defrag recommendations for it.',
        status: 'applied',
      },
      {
        id: 'learn-1-s2',
        kind: 'instruction',
        text: 'Add global instruction: "Before disk-maintenance advice, check the drive technology stored in hardware memory."',
        status: 'approved',
      },
      {
        id: 'learn-1-s3',
        kind: 'test',
        text: 'Regression test: prompt "should I defrag my D: drive?" must answer no for SMR and explain why.',
        status: 'proposed',
      },
    ],
    ts: '2026-10-30T14:22:00',
    resolved: true,
  },
  {
    id: 'learn-2',
    kind: 'mistake',
    title: 'Fabricated file path in audit answer',
    detail:
      'Assistant cited "D:\\dev-tools\\logs\\boot.log" without the Filesystem Reader tool ever returning it.',
    severity: 'high',
    category: 'Tool grounding',
    rootCause: 'Ungrounded completion: the answer was generated from plausibility rather than tool output.',
    suggestions: [
      {
        id: 'learn-2-s1',
        kind: 'instruction',
        text: 'Universal Agent: never state file paths unless present in a tool result within this conversation.',
        status: 'applied',
      },
      {
        id: 'learn-2-s2',
        kind: 'skill',
        text: 'Enhance System Inspector skill: auto-attach verified paths to any filesystem claim.',
        status: 'proposed',
      },
    ],
    ts: '2026-11-02T09:15:00',
    resolved: true,
  },
  {
    id: 'learn-3',
    kind: 'error',
    title: 'Context overflow on long chat',
    detail: 'A 61-message conversation exceeded the active model window and the summarizer step failed silently.',
    severity: 'medium',
    category: 'Context management',
    rootCause: 'Fallback path missing: when summarization failed, the old window was truncated from the wrong end.',
    suggestions: [
      {
        id: 'learn-3-s1',
        kind: 'skill',
        text: 'Conversation compaction skill: on summarizer failure, drop oldest non-pinned turns and notify the user.',
        status: 'approved',
      },
      {
        id: 'learn-3-s2',
        kind: 'test',
        text: 'Regression test: simulate summarizer failure, expect user-visible notice + newest turns intact.',
        status: 'proposed',
      },
    ],
    ts: '2026-11-04T18:40:00',
    resolved: false,
  },
  {
    id: 'learn-4',
    kind: 'correction',
    title: 'Wrong GitHub account used in invite suggestion',
    detail:
      'Assistant suggested inviting the personal account; for company repos the user wants the company account invited.',
    severity: 'medium',
    category: 'Identity & preferences',
    rootCause: 'Preference memory existed but was not retrieved for the repo-sharing task.',
    suggestions: [
      {
        id: 'learn-4-s1',
        kind: 'memory',
        text: 'Tag identity memory as "always-check" for GitHub sharing tasks (retrieval priority bump).',
        status: 'proposed',
      },
    ],
    ts: '2026-11-05T11:05:00',
    resolved: false,
  },
];

export const MOCK_INSTRUCTION_VERSIONS: InstructionVersion[] = [
  { version: 'v7', ts: '2026-11-04T10:00:00', summary: 'Added tool-grounding rule after learn-2 (applied).', status: 'current' },
  { version: 'v6', ts: '2026-10-30T16:00:00', summary: 'Added SMR disk check clause after learn-1.', status: 'history' },
  { version: 'v5', ts: '2026-10-12T08:30:00', summary: 'Shortened system prompt; removed redundant style rules.', status: 'history' },
  { version: 'v4', ts: '2026-09-28T12:00:00', summary: 'Introduced evidence-labeling requirement (verified/estimated).', status: 'history' },
];

export const LEARNING_MODE_EXPLAINER = [
  {
    name: 'Memory learning',
    who: 'Storage layer, not the model',
    what: 'New facts and preferences are written to Memory Center and injected into future prompts.',
    cost: 'Free, instant, fully reversible.',
    note: 'The model weights never change. It is retrieval, not training.',
  },
  {
    name: 'Instruction improvement',
    who: 'System prompt / agent config',
    what: 'Approved edits to agent instructions change behavior rules (e.g. "check drive type first").',
    cost: 'Versioned, rollback in one click.',
    note: 'Still no weight change — prompt-level steering.',
  },
  {
    name: 'Model fine-tuning',
    who: 'Model weights',
    what: 'Offline retraining of the model itself on curated datasets.',
    cost: 'Hours of compute on this hardware; risky; not scheduled for Phase 2.',
    note: 'NEXUS treats this as an explicit, separate, user-initiated operation.',
  },
] as const;
