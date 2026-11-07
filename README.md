# NEXUS AI — Local Intelligence Platform

**Phase 1: UI-only prototype.** A premium desktop-first interface for a future
standalone local AI agent platform: local models, offline operation, persistent
memory, specialized agents, local tools, Learning Lab, and optional internet.

> **Status — STOP CONDITION ACTIVE.**
> This repository contains **frontend only**. There is no LLM runtime, no
> Ollama/llama.cpp, no backend, no database, no real agent engine, no web
> access, and no training pipeline — by design. All data is mock data labeled
> on screen. Phase 2 begins only after written approval
> (`APPROVE UI — START PHASE 2`).

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

## Phase 2 integration points (designed at M0, not implemented)

Every screen consumes plain typed arrays from `src/data/*` and calls plain
setters; the intended seams are:

- `src/data/*` → repository/API layer (same types, fetched instead of literal).
- `src/state/PlatformContext` → real runtime status (model engine, telemetry).
- Chat send/regenerate → streaming inference client (keep the simulated
  latency UI as the streaming skeleton).
- Memory/Knowledge/Activity writes → local storage + indexing service.
- Tauri commands replace the "simulated" action handlers 1:1.

The Phase 2 design set, written 2026-11-07 after the owner's approval and containing
**no implemented code**:

- `PHASE_2_ARCHITECTURE_PLAN.md` — the proposal the owner reviewed.
- `ARCHITECTURE.md` — process topology, subsystems, concurrency, measured environment.
- `PHASE2_IPC_CONTRACT.md` — typed command surface and the 44-row simulated-action ledger.
- `PHASE2_DATA_MODEL.md` — SQLite schema design, migrations, retention.
- `PHASE2_POLICY_MODEL.md` — offline/approval/permission enforcement and its 10 invariants.
- `PHASE2_SIDECAR_SPEC.md` — llama.cpp acquisition, supervision, measurement checklist.
- `PHASE2_MILESTONES.md` — M0–M6 exit gates and the authorisation checkpoints.

See `PHASE_1_COMPLETION_REPORT.md` for the full completion evidence and
`DECISION_LOG.md` for rationale (D-019 onward records the Phase 2 decisions).
