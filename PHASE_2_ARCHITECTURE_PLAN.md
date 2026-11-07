# NEXUS AI — Phase 2 Architecture Plan (for owner review)

**Status:** Proposal only. **No Phase 2 code, installs, dependencies, or backend exist.**
**Written:** 2026-11-07, while Phase 1 remains the shipped state.
**Gate:** Phase 2 implementation begins only on the owner's exact message
`APPROVE UI — START PHASE 2`. This document does not unlock it; it exists so that
approval can be an informed decision.

Every claim about the current codebase below was read from `D:\NEXUS-AI`. Anything about
future behaviour is labelled *estimate* or *to verify*.

---

## 1. What Phase 2 is asked to deliver

Per the original brief, Phase 2 = "the architecture implementation and backend development"
that the Phase 1 UI prototypes. Concretely that means five engines the UI already assumes:

1. **Inference** — a real local model running on this machine.
2. **Persistence** — conversations, memories, documents, activity, settings surviving restart.
3. **Agent execution** — agents that plan, call tools, and delegate.
4. **Knowledge** — real file reading, chunking, embedding, retrieval.
5. **Connectivity** — an opt-in, allow-listed network path with per-agent grants.

Plus packaging: a Windows desktop application.

---

## 2. Non-negotiable constraints carried forward

| Constraint | Source | Consequence for Phase 2 |
|---|---|---|
| Offline-first | Brief | No network call may be reachable by default; the Internet Center's `offline` flag must be enforced in the core, not the UI |
| Approval-gated changes | Brief + Tools screen | Every tool flagged `needsApproval` must block on a human decision; no silent memory writes, no silent instruction edits |
| No weight training | Brief | Fine-tuning stays out of scope; the Learning Lab's "not automatic" copy becomes a real architectural boundary |
| Hardware ceiling | Reference machine | i5-8250U (4C/8T, ~15 W sustained), 20 GB soldered RAM, SSD + SMR HDD, MX150 4 GB |
| Tauri-compatible | Phase 1 decision | `base: './'` + `HashRouter` already in place; the UI shell should not need rewriting |
| Honesty | Phase 1 rule | As each screen becomes real, its `DemoNotice` banner is removed and its simulated toast replaced — never left misleading |
| Secrets | Brief | No API keys in the repo or in memory; local-only credentials store if a provider is ever added |

The hardware ceiling is the dominant design force. `Models.tsx` already encodes it
(`hardwareCompat`: ≤ 8 GB runtime RAM = fit, ≤ total − OS floor = tight, else no-fit) with the
explicit note that swapping on the SMR HDD "would stall the whole system". Phase 2 must treat
that function as a real admission check before loading weights, not decoration.

---

## 3. Target architecture

```
┌──────────────────────────────────────────────────────────────┐
│ React UI (Phase 1, largely unchanged)                        │
│   screens → contract types → service calls                   │
├──────────────────────────────────────────────────────────────┤
│ IPC boundary: Tauri commands (typed request/response)        │
│   model.* memory.* kb.* agent.* tool.* net.* activity.*     │
├──────────────────────────────────────────────────────────────┤
│ Rust core (the actual application)                           │
│   Policy     offline flag, approval gates, allow-list        │
│   Scheduler  one job at a time on a 15 W CPU                │
│   Engines    inference · retrieval · tools · learning        │
│   Store      SQLite + vector index + app data dir            │
├──────────────────────────────────────────────────────────────┤
│ Sidecar: local inference server (loopback only)              │
│ Models: GGUF quantized weights in a user-visible folder      │
└──────────────────────────────────────────────────────────────┘
```

Design notes worth your attention before approval:

**Single-flight scheduling.** *Estimate:* two concurrent 7B inferences on 8 threads at 15 W will
degrade both. The core should own one execution slot with a visible queue — which is exactly what
the Activity Center already renders as mock data.

**Loopback-only inference.** The sidecar binds to `127.0.0.1` with an ephemeral token. Nothing on
the LAN can reach the model. This is a security property, not a convenience.

**Models are user-visible files.** GGUF blobs in a folder the owner can inspect, copy, or delete —
no opaque cache. On a 512 GB disk with 143 GB free (Phase 1 profile), this matters.

---

## 4. The seam: how Phase 1 becomes real without a rewrite

`src/data/types.ts` is already the contract. Phase 2 keeps those interfaces and swaps their source.

| Phase 1 (today) | Phase 2 (target) | UI change needed |
|---|---|---|
| `MOCK_MODELS` array, all `installed: false` | Registry of GGUF files found on disk + runtime probe | Remove Installed-tab empty state; keep fit badges |
| `SIMULATED_REPLIES` canned strings | Streaming tokens from the sidecar | Add token streaming + stop/cancel; remove "(Simulated response)" italics |
| `MOCK_CONVERSATIONS` in memory | SQLite `conversations` / `messages` | Add real persistence, search over history |
| `MOCK_MEMORY` with approval states | Memory service + embedding lookup | Remove `DemoNotice`; approval flow unchanged |
| `MOCK_DOCUMENTS` + fake index states | Watcher → parser → chunker → vector index | Index statuses become real progress, not seeded |
| `MOCK_TOOLS` toggles | Actual tool implementations behind the approval gate | Test-run becomes real; results appear in Activity |
| `MOCK_ACTIVITY` (20 events) | Append-only log written by the core | Export becomes real |
| `internet` flag in `PlatformContext` | Enforced in the Rust policy layer | Behaviour identical, effect real |
| `HARDWARE_PROFILE` + `mockTelemetry` | OS sensor reads | Meters become measured; "mock" labels drop |
| `localStorage('nexus.theme')` only | Settings table in SQLite | Settings screen unchanged in shape |

The migration is per-screen and reversible: each screen ships behind a flag, with its mock data
still in place until the real path passes its acceptance check. That keeps the honesty rule
intact at every intermediate commit — no half-real screen pretending to be either.

---

## 5. Decision 1 — inference runtime (needs your call)

| Option | What it is | Fit for this machine | Cost |
|---|---|---|---|
| **A. llama.cpp sidecar** *(recommended)* | Build/vendor `llama-server`, load GGUF files we manage | Best control of quantization, thread count, and the ≤ 8 GB admission check; can pin one slot | We own build + update pipeline on Windows |
| **B. Ollama as external provider** | Detect and talk to a running Ollama daemon | Fastest to working chat; model pulls are its job | Less control of memory/threading; extra app dependency; its cache hides model files from the owner |
| **C. Remote/OpenAI-compatible provider** | Point at an external API | Only option that escapes the 15 W ceiling | Breaks offline-first and local-intelligence premise; needs keys |

Recommendation: **A as the primary path**, with **B as an optional provider** behind the same
interface for users who already run Ollama, and **C left unimplemented** until you ask for it —
it contradicts the offline-first rule. This is an architecture choice, not a preference: it
determines packaging size, update mechanics, and how much of the Model Manager screen becomes
real management versus a launcher for someone else's daemon.

Realistic capability on this laptop (*estimates, to verify on day one of M1*): 7B–8B Q4 models
at roughly 4–10 tokens/sec CPU-only; 3B–4B noticeably quicker; anything needing > 8 GB runtime
RAM is a poor fit and the UI should say so before download, which it already does.

---

## 6. Decision 2 — storage and retrieval

* **Store:** SQLite (single file, no service, survives crash, easy to inspect and back up).
* **Vectors:** an in-process option such as `sqlite-vec` or `lancedb` — no separate database
  server on a 20 GB machine.
* **Embeddings:** a small local embedding model (the catalog's `bge-m3`, ~1.1 GB, 3 GB RAM,
  already marked "fit") rather than a hosted API, to keep retrieval offline.
* **Data location:** `%APPDATA%\NEXUS` for the database, a user-chosen folder for weights and the
  knowledge root. Backup/restore in Settings becomes real at this point.

Chunking, deduplication and index-rebuild policy are M3 details; the contract is already visible
in the Knowledge Base screen's `indexed / indexing / pending / failed` states.

---

## 7. Decision 3 — agent and tool engine

The Tools & Skills screen already specifies the security model, so Phase 2 implements it rather
than inventing it: a registry of typed tools, each declaring `permissions[]`; `needsApproval`
forces a confirm dialog before execution; auto tools cover read-only operations; every call —
granted or denied — writes an Activity event. Custom Skills become ordered step lists bound to a
trigger, not free-form scripts.

Sub-agent delegation (the Universal Agent's stated capability) should start as a single-level
spawn with its own approval context. Multi-level recursion is a risk without a budget; *to
verify* whether you want any depth at all in the first release.

---

## 8. Milestones and exit criteria

Each milestone ends in something you can run and judge. Nothing is declared done without the
check being executed and its output recorded, in the same manner as Phase 1's report.

**M0 — Architecture lock (docs only).** Decide runtime, storage, packaging; write the IPC command
surface as a typed contract. *Exit:* you approve this plan with the decisions filled in.

**M1 — One real answer end to end.** Tauri shell + sidecar + one 7B Q4 model + streaming into the
existing Chat screen. No persistence yet. *Exit:* a chat message produces real tokens from a real
local model, offline, and the Chat `DemoNotice` is removed because that screen is now honest.

**M2 — Persistence.** SQLite schema for conversations, settings, activity. Restart keeps history.
*Exit:* relaunch restores the conversation list and the active model.

**M3 — Knowledge + Memory.** File watcher, parsers for the six supported types, chunking,
embeddings, retrieval wired into chat; memory tiers with the existing approval workflow. *Exit:*
a document you drop in a folder becomes searchable in chat with a page-referenced citation, and a
proposed memory requires your approval before it is ever retrieved.

**M4 — Tools and one working agent.** Filesystem + Python + PowerShell tool families behind the
approval gate; the Developer Agent completes a real multi-step task. *Exit:* Activity Center shows
real runs including denials.

**M5 — Learning loop.** Corrections logged in the Learning Lab become instruction-file versions
with rollback; regression cases replay. Fine-tuning remains explicitly unavailable. *Exit:* an
approved instruction change alters behaviour, and reverting the version restores it.

**M6 — Packaging and hardening.** Windows installer, data-dir handling, backup/restore, telemetry
replacing mock values, performance pass under the 15 W ceiling. *Exit:* an installer that runs on
a clean Windows machine.

Suggested order rationale: M1 proves the premise (a local model actually answering on this
specific laptop) before any infrastructure is committed. If M1 shows the machine is too slow to be
useful, that is far cheaper to discover than after M4.

---

## 9. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Machine too slow to be useful at 7B | Medium (*estimates only so far*) | M1 exists precisely to measure this; fall back to 3B–4B or accept a remote provider as a decision, not a default |
| RAM pressure stalling Windows (SMR swap) | Medium | Admission check before load, single-flight scheduler, refuse rather than thrash |
| Document parsers (PDF/DOCX/XLSX) on Windows are fiddly | High | Start with md/txt/csv; gate pdf/docx/xlsx behind their own milestone slice |
| Scope creep into a general agent framework | High | Milestones are vertical slices; nothing beyond the 11 screens already designed |
| UI rewrite temptation | Low | The seam table in §4 keeps `types.ts` as the contract; screens change only where honesty requires it |
| Secrets/keys entering the project | Low | Local-only by design; any provider integration is a separate owner decision |

---

## 10. What I need from you before M1

1. **Runtime** — Option A (llama.cpp sidecar), B (Ollama provider), or both.
2. **First model** — which catalog entry to target first; my default would be `Qwen2.5 Coder 7B
   Instruct` at Q4, matching the active model the UI already shows.
3. **Data location** — confirm `%APPDATA%\NEXUS` plus a user-chosen weights folder.
4. **Tool breadth at M4** — filesystem/Python/PowerShell only, or wider.
5. **Sub-agent depth** — single-level, or disabled in the first release.
6. **Remote provider** — explicitly out, or allowed as an opt-in later.

Answer any subset of these and I'll fold it into this plan. None of it starts implementation.

---

## 11. Still out of scope

Model fine-tuning or any weight modification. Multi-user or server deployment. Cloud sync.
Mobile. Anything not represented by the eleven Phase 1 screens.

---

## 12. Gate reminder

Phase 1 is the current and only shipped state. Reading or approving this plan does not begin
Phase 2. Implementation starts solely on:

> **APPROVE UI — START PHASE 2**
