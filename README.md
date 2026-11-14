# NEXUS AI — Local Intelligence Platform

A standalone, offline-first Windows desktop application for running a local language model on
the owner's own machine: chat, model management, knowledge and memory, tools and a learning
loop — no account, no cloud dependency, and no prompts or files leaving the computer.

**Phase 1 UI is finished and approved (2026-11-07) and is not being redesigned. Phase 2 is in
progress: M1 — one real answer end to end — is complete and tagged `m1-first-answer`
(`ba15fa2`, 2026-11-14). M2 (SQLite persistence) is next.**

> **This build is source-run only. It is not installable.** There is no MSI/NSIS installer, no
> code signing, no notarization and no updater (`bundle.active` is `false`). It runs from
> source against a locally installed engine and model. See `RELEASE_NOTES.md`.

What is real today, and the evidence for it:

- Chat loads a real GGUF model through a measured RAM admission check, streams real tokens,
  stops on request, and reports engine-counted usage. The M1 gate recorded `NEXUS OK` (122
  tokens, 22.2 s cold), Stop held at 1 character after 2.5 s, a killed engine producing
  `engine.crashed: …`, and the next send recovering — `TEST_RESULTS.md` §4, `MEASUREMENTS.md`
  §14.
- Model Manager → Installed reads real GGUF files and their metadata from
  `NEXUS_MODELS_DIR`; "Set active" loads through admission.
- Every other screen is still the approved Phase 1 demo and says so with a `DemoNotice`.
  `IMPLEMENTATION_STATUS.md` is the per-screen ledger.

## Run it

Prerequisites (recorded in `TEST_RESULTS.md` → Environment and `AGENTS.md`):

- Windows with WebView2 (157.0.4341.46 was used).
- Node 24.17.0 and npm.
- Rust MSVC toolchain 1.99.0 with the C++ build tools.
- Pinned engine: `D:\NEXUS-SIDECAR\b12189\llama-server.exe` (override `NEXUS_ENGINE_DIR`).
- Authorised model: `D:\NEXUS-MODELS\Llama-3.2-3B-Instruct-Q4_K_M.gguf` (override
  `NEXUS_MODELS_DIR`). No other weights are authorised.

```powershell
cd D:\NEXUS-AI-m1
npm install        # once
npm run tauri dev  # Vite on :5173 + the Tauri window + the real engine
```

Other commands:

```powershell
npm run typecheck  # tsc --noEmit
npm run build      # tsc && vite build
npm run dev        # browser-only build: the Phase 1 demo, no engine
npm run preview    # serve the production bundle locally
```

No API key or cloud account is required. The HTML still links Google Fonts; the UI falls back
to Segoe UI/system fonts when that is unavailable, and the link is recorded as KI-10 rather
than hidden.

## Stack

React 18 · TypeScript (strict) · Vite 5 · Tailwind CSS 3 · lucide-react ·
react-router (HashRouter) on the UI; Tauri 2 and Rust (`crates/nexus-core`) for the desktop
shell and core. No component, state or chart libraries — everything visual is built from the
primitives in `src/components/ui`.

The build uses `base: './'` relative asset paths and hash routing so the bundle runs from the
Tauri filesystem with no routing changes. The application is standalone: it has no dependency
on Qoder or any other tool.

## Screens (all navigable from the left sidebar)

| Route | Screen | State today |
|---|---|---|
| `/dashboard` | Dashboard — status, telemetry, active model, recents, quick actions | Partial: active model is real; telemetry, recents and activity are mock |
| `/chat` | AI Chat — conversations, streaming answers, markdown/code, attachments UI | Real core path (load/send/stop/usage); conversation state in memory; no regenerate |
| `/agents` | Agent Management — universal + specialized agents, create/edit/enable | Demo: mock definitions, no agent process |
| `/models` | Model Manager — installed files, mock catalog, compare, hardware fit | Partial: installed rows are real; catalog/downloads are mock |
| `/memory` | Memory Center — tiers, search, approval workflow, history | Demo: React state over mock records |
| `/knowledge` | Knowledge Base — folder tree, documents, simulated indexing | Demo: no parsing or storage |
| `/tools` | Tools & Skills — permissions, enable/disable, skill builder | Demo: no commands execute |
| `/learning` | Learning Lab — corrections → root cause → approved improvements | Demo: simulated events and versions |
| `/internet` | Internet Center — offline/online, permissions, trusted sources | Demo: no network stack is wired |
| `/activity` | Activity Center — timeline, filters, approvals | Demo: in-memory mock log |
| `/settings` | Settings — 13 sections incl. real theme + active-model effects | Demo, except theme and active-model id in `localStorage` |

## Repository map

```
crates/nexus-core/        Rust core: engine supervisor, inference client, registry, admission,
                          system probes, dispatch (the whole IPC contract lives here)
src-tauri/                Tauri 2 shell: one `ipc` command, event bridge, exit cleanup
src/
  components/ui/          design-system primitives (Button, Modal, Toast, …)
  components/common/      page chrome (PageHeader/WorkArea/ContextPanel), Logo
  components/layout/      AppShell, Sidebar, Topbar
  contract/               IPC types + transport (Tauri or browser-demo)
  data/                   mock data + shared types, still used by the honest demos
  lib/                    utils, hooks, dependency-free Markdown renderer
  pages/                  the 11 screens
  state/PlatformContext   core-aware active model and model list
  theme/ThemeContext      dark/light theme (dark is initial)
tools/                    ui-gate.mjs (live evidence driver) + README
```

Runtime assets are not in the repo: the engine lives in `D:\NEXUS-SIDECAR\b12189\` and the
model in `D:\NEXUS-MODELS\`. Both are overridable by environment variable.

## Documentation

Phase 2 status and evidence:

- `AGENTS.md` — operating instructions for any agent working here; build, test, gate, rules.
- `MASTER_PROJECT_PLAN.md` — product definition, hardware envelope, delivery plan, risks.
- `PROJECT_ROADMAP.md` — milestone order and dependencies.
- `PHASE2_MILESTONES.md` — what "done" means for M0–M6; the schedule of record.
- `TEST_RESULTS.md` — commands, dates and exact output; pass/fail evidence.
- `MEASUREMENTS.md` — hardware and latency evidence, all runs.
- `IMPLEMENTATION_STATUS.md` — one row per screen: real / partial / demo, with backing commands.

Supporting records: `PROJECT_RECOVERY_REPORT.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`,
`ARCHITECTURE_DECISIONS.md`, `KNOWN_ISSUES.md`, `TECHNICAL_DEBT.md`, `SECURITY_MODEL.md`,
`DATA_AND_BACKUP_STRATEGY.md`, `DECISION_LOG.md`, `WORK_QUEUE.md`, `HANDOFF.md`.

Design set from M0 (still the architecture of record): `ARCHITECTURE.md`,
`PHASE2_ARCHITECTURE_PLAN.md`, `PHASE2_IPC_CONTRACT.md`, `PHASE2_DATA_MODEL.md`,
`PHASE2_POLICY_MODEL.md`, `PHASE2_SIDECAR_SPEC.md`, plus the Phase 1 records
`PHASE_1_COMPLETION_REPORT.md`, `CONVENTIONS.md`, `UI_DESIGN_SYSTEM.md`, `UI_COMPONENTS.md`,
`UI_SCREEN_MAP.md`.

## Honesty contract

- Purple `DEMO` banners state where data is fictional (every demo screen).
- In Tauri, Chat replies come from the local engine; in a plain browser the app is the Phase 1
  demo and the reply is a canned string with a timer. It must say which one it is.
- Telemetry (CPU/RAM/GPU) is deterministic pseudo-random data, **not sensor data**.
- "Download model", "run tool", "check updates" and "export log" never perform IO; they show
  progress/toasts that say the action is simulated.
- Model Manager's Installed tab is empty until a real GGUF file exists in the models folder;
  the catalog remains mock data.
- There is no installer, signing, updater, CSP or persistence yet. Those gaps are listed with
  impact and workarounds in `KNOWN_ISSUES.md`, not left for the reader to discover.

## How the seam works

The UI calls one Tauri command, `ipc`, with `{ command, args }`; the dotted contract name
(`chat.send`, `model.list`, …) travels inside the payload because Tauri command names must be
Rust identifiers. `nexus_core::dispatch` matches the name and returns either real data or
`not_implemented` — never a fabricated success. Streams arrive as `chat://token`,
`chat://usage` and `model://state` events. The typed contract is `src/contract/ipc.ts`; the
transport probe is `src/contract/client.ts`; `withGlobalTauri: true` is what lets the app
detect the host.

Phase 2 integration of the remaining screens is tracked in `IMPLEMENTATION_STATUS.md` and
`PROJECT_ROADMAP.md`. Dependencies and rationale are numbered in `DECISION_LOG.md` (D-019
onward) and indexed in `ARCHITECTURE_DECISIONS.md`.
