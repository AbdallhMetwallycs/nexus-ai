# NEXUS AI — Local Intelligence Platform

**Phase 1: UI-only prototype.** A premium desktop-first interface for a future
standalone local AI agent platform: local models, offline operation, persistent
memory, specialized agents, local tools, Learning Lab, and optional internet.

> **Status — Phase 2 open (approved 2026-11-07), still frontend only.**
> This repository contains **no LLM runtime, no Ollama/llama.cpp, no backend, no
> database, no real agent engine, no web access, and no training pipeline**. All
> screen data is mock data, labelled on screen. What Phase 2 has added so far is
> design documents plus the typed IPC contract in `src/contract/`, which nothing
> imports yet — so the running app is unchanged from Phase 1. Each later step is
> gated by the authorisation checkpoints in `PHASE2_MILESTONES.md`; nothing
> installs, downloads, or deletes without the owner's go-ahead.
>
> **Machine state, not repository state:** on 2026-11-07 the owner authorised the Rust + MSVC
> toolchain install (checkpoint M1.0, `DECISION_LOG.md` D-028), then the pinned llama.cpp b12189 CPU
> archive (checkpoint M1.1, D-030–D-032) in `D:\NEXUS-SIDECAR\b12189\`, then — for M1.2 — exactly one
> model file: `Llama-3.2-3B-Instruct-Q4_K_M.gguf`, 1,879 MB in `D:\NEXUS-MODELS\` (D-033). All of it
> sits **outside this repo**. The engine has since been run with those weights purely to measure it;
> the raw evidence is `MEASUREMENTS.md`, and the numbers changed four design positions, recorded as
> D-034–D-036. Still nothing here that generates text: no `src-tauri/`, no crates.io fetch, no npm
> dependency, and no app code changed, so the bundle is still byte-identical to Phase 1 (the hash
> check is `DECISION_LOG.md` D-025). The measurement harness is scratch Node scripts in
> `C:\Users\BS\nexus-toolchain\` — it proves what the engine does, not what `nexus-core` will do.

## Run it

```bash
cd D:\NEXUS-AI
npm install        # once
npm run dev        # http://localhost:5173
```

Other commands:

```bash
npm run build      # type-check (tsc) + production bundle (vite build)
npm run preview    # serve the production bundle locally
npm run typecheck  # tsc --noEmit only
```

No environment variables, no API keys, no network access is required at
runtime (Google Fonts is the only external request in `index.html`, and the UI
falls back to Segoe UI/system fonts if it is unavailable — fully offline-safe).

## Stack

React 18 · TypeScript (strict) · Vite 5 · Tailwind CSS 3 · lucide-react ·
react-router (HashRouter). No component libraries, no state libraries, no chart
libraries — everything visual is built from the primitives in
`src/components/ui`.

The build uses `base: './'` relative asset paths and hash routing so the bundle
can be packaged later with **Tauri** for Windows with no routing changes. The
application is standalone: it has no dependency on Qoder or any other tool.

## Screens (all navigable from the left sidebar)

| Route | Screen |
|---|---|
| `/dashboard` | Dashboard — status, telemetry, active model, recents, quick actions |
| `/chat` | AI Chat — conversations, simulated replies, markdown/code, attachments UI |
| `/agents` | Agent Management — universal + specialized agents, create/edit/enable |
| `/models` | Model Manager — mock catalog, compare, hardware fit; **nothing installed** |
| `/memory` | Memory Center — tiers, search, approval workflow, history |
| `/knowledge` | Knowledge Base — folder tree, documents, simulated indexing |
| `/tools` | Tools & Skills — permissions, enable/disable, skill builder |
| `/learning` | Learning Lab — corrections → root cause → approved improvements |
| `/internet` | Internet Center — offline/online, permissions, trusted sources |
| `/activity` | Activity Center — timeline, filters, approvals |
| `/settings` | Settings — 13 sections incl. real theme + active-model effects |

## Repository map

```
src/
  components/ui/        design-system primitives (Button, Modal, Toast, …)
  components/common/    PageChrome (PageHeader/WorkArea/ContextPanel), Logo
  components/layout/    AppShell, Sidebar, Topbar
  data/                 ALL mock data + shared types — the Phase 2 seam
  lib/                  utils, hooks, dependency-free Markdown renderer
  pages/                the 11 screens
  state/PlatformContext  cross-screen UI state (active model, online flag)
  theme/ThemeContext     dark/light theme (dark is initial)
docs: CONVENTIONS.md, UI_DESIGN_SYSTEM.md, UI_COMPONENTS.md, UI_SCREEN_MAP.md,
      DECISION_LOG.md, PHASE_1_COMPLETION_REPORT.md
phase 2 (design only): PHASE_2_ARCHITECTURE_PLAN.md, ARCHITECTURE.md,
      PHASE2_IPC_CONTRACT.md, PHASE2_DATA_MODEL.md, PHASE2_POLICY_MODEL.md,
      PHASE2_SIDECAR_SPEC.md, PHASE2_MILESTONES.md
```

## Mock-data limitations (honesty contract)

- Purple `DEMO` banners state where data is fictional (every data screen).
- Telemetry (CPU/RAM/GPU) is deterministic pseudo-random, **not sensor data**.
- Chat replies are canned strings from `SIMULATED_REPLIES`; latency is a timer.
- "Download model", "run tool", "check updates", "export log" never perform IO;
  they show progress/toasts that say the action is simulated.
- State lives in React memory (plus theme in localStorage) — a reload resets it.
- The Model Manager's Installed tab is intentionally **empty**: no model exists.

## Phase 2 integration points (designed at M0; types exist, wiring does not)

Every screen consumes plain typed arrays from `src/data/*` and calls plain
setters; the intended seams are:

- `src/contract/` → the seam itself, now typed: commands, events, `Result<T>` envelope,
  and a transport that returns `not_implemented` until a core exists.
- `src/data/*` → repository/API layer (same types, fetched instead of literal).
- `src/state/PlatformContext` → real runtime status (model engine, telemetry).
- Chat send/regenerate → streaming inference client (keep the simulated
  latency UI as the streaming skeleton).
- Memory/Knowledge/Activity writes → local storage + indexing service.
- Tauri commands replace the "simulated" action handlers 1:1.

The Phase 2 design set, written 2026-11-07 after the owner's approval:

- `PHASE_2_ARCHITECTURE_PLAN.md` — the proposal the owner reviewed.
- `ARCHITECTURE.md` — process topology, subsystems, concurrency, measured environment.
- `PHASE2_IPC_CONTRACT.md` — typed command surface (96 commands, 10 event channels) and the
  44-row simulated-action ledger.
- `PHASE2_DATA_MODEL.md` — SQLite schema design, migrations, retention.
- `PHASE2_POLICY_MODEL.md` — offline/approval/permission enforcement and its 10 invariants.
- `PHASE2_SIDECAR_SPEC.md` — llama.cpp acquisition, supervision, measurement checklist.
- `PHASE2_MILESTONES.md` — M0–M6 exit gates and the authorisation checkpoints.
- `MEASUREMENTS.md` — not design: the raw output of the M1.2 measurement runs against the real
  engine, and the premise verdict those runs produced. Every number elsewhere in this set traces
  back to a section here.

**One exception to "design only", added 2026-11-07:** `src/contract/` now holds the IPC
contract as TypeScript — `ipc.ts` (types + `CommandSpecs`/`EventSpecs`), `client.ts`
(`NexusTransport`, host-bridge probe, and a transport that answers every call with
`not_implemented`), `index.ts` (barrel). It is **dead code on purpose**: no screen imports it,
the production bundle is byte-identical to Phase 1, and no dependency was added. Real wiring is
M1/M2. Everything above the line is still pure design.

See `PHASE_1_COMPLETION_REPORT.md` for the full completion evidence and
`DECISION_LOG.md` for rationale (D-019 onward records the Phase 2 decisions).
