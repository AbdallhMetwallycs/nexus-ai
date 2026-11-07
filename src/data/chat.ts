import type { Conversation } from './types';

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

/** Seed conversations — all content is simulated (Phase 1). */
export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'c-refactor-auth',
    title: 'Refactor auth middleware',
    updatedAt: iso(24),
    agentId: 'developer',
    modelId: 'qwen2.5-coder-7b',
    pinned: true,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'The Express auth middleware has three nested callbacks. Show me a cleaner async version.',
        ts: iso(30),
      },
      {
        id: 'm2',
        role: 'assistant',
        modelId: 'qwen2.5-coder-7b',
        agentId: 'developer',
        content:
          'Here is the async rewrite. The original nesting existed because `verifyToken` and `loadUser` were callback-based; with `await` the flow becomes linear and error handling moves to one `catch`.\n\n### Changes\n- Single `try/catch` instead of three error-first callbacks\n- `loadUser` failure returns 401 with the same shape as before\n- No behavior change for valid sessions\n\n```ts\nexport async function requireAuth(req: Request, res: Response, next: NextFunction) {\n  try {\n    const token = extractBearer(req);\n    if (!token) return res.status(401).json({ error: "missing_token" });\n    const payload = await verifyToken(token);\n    const user = await loadUser(payload.sub);\n    if (!user) return res.status(401).json({ error: "unknown_user" });\n    req.user = user;\n    next();\n  } catch {\n    res.status(401).json({ error: "invalid_token" });\n  }\n}\n```\n\n*(Simulated response — no model is running in this prototype.)*',
        ts: iso(28),
      },
      {
        id: 'm3',
        role: 'user',
        content: 'Add a test for the expired-token case.',
        ts: iso(26),
      },
      {
        id: 'm4',
        role: 'assistant',
        modelId: 'qwen2.5-coder-7b',
        agentId: 'developer',
        content:
          '```ts\nit("rejects expired tokens with 401", async () => {\n  const res = await call(requireAuth, { headers: { authorization: "Bearer expired.jwt" } });\n  expect(res.status).toBe(401);\n  expect(res.body).toEqual({ error: "invalid_token" });\n});\n```\n\n`verifyToken` throws on expiry, so this exercises the `catch` branch. *(Simulated response.)*',
        ts: iso(24),
      },
    ],
  },
  {
    id: 'c-ram-plan',
    title: 'Laptop RAM upgrade plan',
    updatedAt: iso(180),
    agentId: 'assistant',
    modelId: 'phi4-mini-3.8b',
    pinned: false,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'My laptop has 20 GB RAM (8 GB soldered + 12 GB stick). What are sensible upgrade paths?',
        ts: iso(190),
      },
      {
        id: 'm2',
        role: 'assistant',
        modelId: 'phi4-mini-3.8b',
        agentId: 'assistant',
        content:
          'With 8 GB soldered, one SODIMM slot remains. Practical options:\n\n1. **Replace the 12 GB stick with 16 GB** → 24 GB total, keeps dual-channel only if the memory types match.\n2. **Leave as-is** → fine for 7B Q4 models (~8 GB working set).\n3. Avoid single-channel-only configs for local LLM work; bandwidth matters more than the last few GB.\n\nCheck the max supported per-slot capacity in the service manual before ordering. *(Simulated response.)*',
        ts: iso(180),
      },
    ],
  },
  {
    id: 'c-lease-review',
    title: 'Rental contract key clauses',
    updatedAt: iso(60 * 26),
    agentId: 'doc-analyst',
    modelId: 'llama3.1-8b',
    pinned: false,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'From the Knowledge Base document "rental-agreement-2026.pdf", list the termination conditions.',
        ts: iso(60 * 28),
      },
      {
        id: 'm2',
        role: 'assistant',
        modelId: 'llama3.1-8b',
        agentId: 'doc-analyst',
        content:
          'From `rental-agreement-2026.pdf` (simulated retrieval), the termination clauses are:\n\n- **§8.1** — Either party may end the lease with 60 days written notice.\n- **§8.3** — Landlord may terminate for cause with 14 days cure period.\n- **§9.2** — Early termination fee: two months’ rent.\n\n> Source references are mock until the Knowledge Base backend exists.\n\n*(Simulated response.)*',
        ts: iso(60 * 26),
      },
    ],
  },
  {
    id: 'c-weekly-review',
    title: 'Weekly review draft',
    updatedAt: iso(60 * 50),
    agentId: 'universal',
    modelId: 'llama3.1-8b',
    pinned: false,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Draft a short weekly review: shipped UI spec, delayed storage migration, next week is model testing.',
        ts: iso(60 * 52),
      },
      {
        id: 'm2',
        role: 'assistant',
        modelId: 'llama3.1-8b',
        agentId: 'universal',
        content:
          '**Week in review**\n\n- ✅ UI specification for the platform approved.\n- ⚠️ Storage migration slipped one week — blocked on disk health checks.\n- ➡️ Next week: local model evaluation harness setup.\n\nKept it to five lines. Want a version for management or for engineering? *(Simulated response.)*',
          ts: iso(60 * 50),
      },
    ],
  },
  {
    id: 'c-disk-audit',
    title: 'D: drive space audit',
    updatedAt: iso(60 * 75),
    agentId: 'sysadmin',
    modelId: 'qwen2.5-coder-7b',
    pinned: false,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'What is eating space on my D: drive? Read-only check first.',
        ts: iso(60 * 76),
      },
      {
        id: 'm2',
        role: 'assistant',
        modelId: 'qwen2.5-coder-7b',
        agentId: 'sysadmin',
        content:
          'Read-only scan (simulated) of top consumers on D:\\:\n\n1. `games\\` — 121 GB\n2. `Backup-codes…` folder — 0.01 GB, fine\n3. `Youtube Channel\\` media — 34 GB\n\nNo deletion proposed. If you want, I can prepare a cleanup plan with exact paths for your approval. *(Simulated response — no real scan ran.)*',
        ts: iso(60 * 75),
      },
    ],
  },
];

/** Pool used to fabricate assistant replies when the user sends a message. */
export const SIMULATED_REPLIES: string[] = [
  'Understood. Here is how I would approach that:\n\n1. Clarify the goal and constraints\n2. Inspect the current state before proposing changes\n3. Make the smallest reversible step first\n\n*(Simulated response — this prototype has no model connected.)*',
  'Short answer: it depends on whether you want speed or headroom.\n\nIf this machine stays your only host, prefer smaller quantized models (~7B Q4) and keep 6 GB free RAM as the floor. Larger models only make sense with GPU offload. *(Simulated response.)*',
  'Here is a compact checklist you can act on:\n\n- [ ] Confirm exact paths before any deletion\n- [ ] Snapshot config before changing it\n- [ ] One change per test run\n\nTell me which item to expand. *(Simulated response.)*',
  'That breaks into two separate problems: the input side (what gets collected) and the retention side (what is kept and where).\n\n### Input side\nStructured capture beats free-form notes for anything you will query later.\n\n### Retention side\nDefault to local-first storage with explicit export. *(Simulated response.)*',
];
