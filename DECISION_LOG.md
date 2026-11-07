# NEXUS AI — Decision Log (Phase 1)

Decisions that shaped the UI-only prototype, with rationale and trade-offs.

## Process & scope

**D-001 — UI-first, hard phase gate.** The entire frontend is finished before
any backend/AI work. Phase 2 (runtime, models, DB, agent engine) starts only on
the exact approval `APPROVE UI — START PHASE 2`. *Why:* de-risk the experience
and let the owner review the product before committing to heavy engineering.

**D-002 — Workspace was empty; built clean.** `D:\NEXUS-AI` contained nothing to
preserve, so a fresh frontend-only project was scaffolded. No unrelated project,
repo, or knowledge base was touched.

**D-003 — Honesty is a design feature, not a disclaimer.** Every simulated
action states what did *not* happen. A violet `DemoNotice` channel, a permanent
"UI prototype · Phase 1" topbar badge, and deterministic-but-labeled telemetry
implement this. *Why:* the brief forbids pretending mock functionality is real;
making that a visual system keeps it consistent instead of bolted on.

## Technology

**D-004 — React 18 + TypeScript + Vite 5 + Tailwind 3 + lucide-react.** The
stack named in the brief. No component kit (MUI/shadcn), no state library, no
chart library. *Why:* "prepare for Tauri without unnecessary dependencies" and
"distinctive visual identity" both argue for a small bespoke system; a kit would
fight the design language and bloat the bundle.

**D-005 — Zero hard third-party runtime deps beyond React/router/icons.**
Markdown, sparklines, menus, toasts, modals, theming are hand-built in
`src/lib` and `src/components/ui`. *Why:* fewer upgrade surprises at Tauri
packaging, full control of the premium aesthetic, and a smaller attack surface.

**D-006 — HashRouter + `base: './'`.** *Why:* Tauri serves the built app from
the filesystem where `BrowserRouter` history paths break; hash routing works
from `file://` and any static host. Chosen now to avoid a later rewrite.

**D-007 — Standalone (no Qoder dependency).** The app uses only public npm
packages, local files, and OS fonts as fallback. *Why:* brief requirement — the
shipped app must not depend on Qoder.

## Architecture

**D-008 — Mock data is the Phase 2 seam.** All screen data lives in typed arrays
under `src/data/` (`types.ts` defines the shared vocabulary). Screens read
arrays and call plain setters. In Phase 2 these become repository/API/fetch
calls with the same shapes. *Why:* keeps the UI decoupled and makes integration
additive rather than a rewrite.

**D-009 — Three-layer component model.** `ui/` (primitives) → `common/`
(page chrome: PageHeader, WorkArea, ContextPanelCard, Logo) → `pages/`. Shared
cross-screen state (active model, online, sidebar) is one small `PlatformContext`;
everything else is local page state. *Why:* no heavy store is justified for UI
state; the seam for real state management stays obvious.

**D-010 — Context rail is per-screen, optional.** `WorkArea.contextPanel`
renders the right rail only at ≥xl and only where it adds value (model spec,
hardware, approvals). *Why:* the brief warns against overcrowding; the rail
keeps secondary/technical detail out of the main flow.

**D-011 — Dark-first with a variable-driven light theme.** Theme = CSS variables
toggled on `<html>`; components never hardcode hex. *Why:* satisfies
"support light/dark if practical" essentially for free and keeps a single
maintainable token source. Dark is the identity theme.

## UX

**D-012 — No dead buttons.** Every control performs a real prototype action
(state change, modal, toast, filter, selection). Where the real effect is
impossible in Phase 1 (download, execute, network), the control runs the UI
flow and then truthfully reports it was simulated. *Why:* brief requirement +
trust.

**D-013 — Chat replies are canned, latency is a timer.** `SIMULATED_REPLIES`
with a short delay stand in for inference. *Why:* demonstrates the full message/
thinking/regenerate/stream skeleton now so Phase 2 can replace the timer with a
token stream without touching layout.

**D-014 — Model Manager "Installed" tab is intentionally empty.** *Why:* the
brief requires clearly indicating that no models are actually installed; an
honest empty state communicates this better than fake "installed" rows.

**D-015 — Learning Lab distinguishes three learning types.** Memory learning
(retrieval), instruction improvement (prompt steering), and fine-tuning (weights)
are explained separately, with fine-tuning marked not-automatic and out of
Phase-2 auto scope. *Why:* the brief forbids claiming the model learns
automatically; the UI must teach the real mental model.

**D-016 — Accessibility is baseline, not an add-on.** `FieldShell` gives every
input an `aria-describedby`-wired label/error; switches/tabs/menus/dialogs carry
roles and keyboard handling; global `:focus-visible`; Esc closes overlays.
*Why:* "support keyboard navigation" is a hard requirement.

**D-017 — Byte formatting lives in one helper, never re-suffixed.** The Knowledge
Base storage rail originally rendered "2.4 GB GB" because the page appended its own
unit to `formatBytes()`, which already returns a value with a unit. Fixed at the call
site and the rule recorded here. *Why:* a single owner for unit formatting prevents
duplicated or contradictory suffixes as more screens report disk and model sizes.

**D-018 — The fallback knowledge collection is "Uncategorized", not "Everything".**
Documents whose folder has no named collection fall back to this label. As
"Everything" it read as a total-of-all-documents row while showing 0, which looked
like a counting bug in a screen whose whole job is honest accounting.
*Why:* the rail must be readable without cross-checking the code.

## Phase 2 decisions (owner-approved 2026-11-07)

**D-019 — Phase 2 gate opened.** The owner sent `APPROVE UI — START PHASE 2` on 2026-11-07.
Phase 2 work is authorised, scoped by the M0 decision below. *Why:* recorded so the exact
authorisation moment is auditable rather than inferred from a conversation.

**D-020 — Inference runtime: llama.cpp sidecar.** Chosen over Ollama-as-provider and over a remote
API. The engine runs as a supervised child process bound to `127.0.0.1` with a per-launch token.
*Why:* control of quantization, thread count, context cap, and the RAM admission check; weights
stay in an owner-visible folder; a remote provider contradicts the offline-first premise.
Consequence: Rust and MSVC build tools become prerequisites, and the engine is acquired as a
pinned prebuilt archive rather than compiled from source.

**D-021 — M0 is documents only; no installs, no downloads, no scaffold.** The owner chose the
docs-lock path over "contract plus scaffold now". *Why:* the architecture decisions (process
topology, schema, policy invariants) are cheap to change on paper and expensive to change after
`src-tauri/` exists.

**D-022 — No model weights on this machine yet.** The owner declined the 7B Q4 and the 3B options
for now. *Why:* a 2–5 GB download is the first irreversible-ish disk commitment in the project and
it should follow the runtime verification, not precede it. Consequence: M1's first step is verifying
the pinned llama.cpp archive's actual contents and `--help`, because the current unified
`llama serve` binary shape rests on one third-party source.

**D-023 — Version control established at the Phase 1 boundary.** `git init` plus `.gitignore`,
baseline commit `84cb1a8` covering the verified Phase 1 UI and the Phase 2 plan; local only, no
remote. `dist/` and `node_modules/` are ignored; screenshots are committed as evidence.
*Why:* every Phase 2 gate needs a known-good tag to compare against. Side effect found and
corrected: `PHASE_1_COMPLETION_REPORT.md` had listed `.gitignore` among Phase 1 files, which was
not true until this commit — the report now says so.

**D-024 — Environment measured, not assumed, before writing the plan.** Probed 2026-11-07:
git 2.45.1 ✓, node v24.17.0 ✓, npm 11.13.0 ✓, `rustc`/`cargo`/`cmake`/`cl` **all absent**, `D:` =
252 GB total with 149 GB free. *Why:* the missing toolchain is the real M1 cost and the 512 GB /
143 GB figure in the Phase 1 mock profile describes C:, not the volume that will hold app data —
both facts change the plan and neither was knowable from the code.

**D-025 — The IPC contract is materialised as types before any runtime exists.** Owner chose
"materialise the IPC contract now" over waiting for M1. `src/contract/ipc.ts` holds the 96 commands and
10 event channels; `src/contract/client.ts` holds `NexusTransport`, a dependency-free structural probe
for a Tauri-style host, and the honest transport that answers every call with `not_implemented` and
never fires a subscription. No screen imports either file, and `package.json` is unchanged.
*Why:* a contract that only exists as prose gets re-litigated at implementation time; as types it is
checked by the compiler on every commit from now on. Verified 2026-11-07: `tsc --noEmit` exit 0,
`npm run build` exit 0 with the **same output hashes as Phase 1** (`index-o-Cdud1n.js` 425.85 kB,
`index-B__IBTZ4.css` 33.04 kB, 1613 modules) — byte-identical bundle is the proof that adding the
seam changed no screen. Runtime and type-level checks were run from scratch files in a temp directory
(so the repo gained no test dependency): the honest transport refused 2 sampled commands with
`not_implemented`, a stubbed host bridge routed calls and unwrapped event payloads correctly, a raw
string rejection degraded to `internal` rather than a fake success, and 7 deliberate misuse attempts
(`engine.status` with args, `model.get` without id, unknown command, unknown field, unknown result
field) all failed to compile.

**D-026 — Argument presence is derived, not declared per command.** `ArgsTuple` maps `args: undefined`
to a parameter that does not exist, an args type whose every field is optional to an optional object,
and anything else to a required parameter. *Why:* the alternative — writing `args?` on 96 rows — lets
the signature and the call site drift. `{} extends A` is the same test the compiler applies when it
accepts the call, so `chat.list()` and `chat.list({ query: 'auth' })` are both legal while
`model.get()` without an id is a compile error. Documented in `PHASE2_IPC_CONTRACT.md` §1.

**D-027 — `chat.list` returns `ConversationSummary`, not `Conversation`.** The list projection drops
`messages` and adds `messageCount`. *Why:* the sidebar row renders only
`"{messages.length} msg · {timeAgo(updatedAt)}"` (`src/pages/Chat.tsx:264`), so shipping full
conversations would make the list's cost grow with the chat history on a 15 W CPU. Found while
materialising the contract: the code needed the projection before the document described it, and the
document was corrected in the same commit rather than left to rot.

## Deferred (explicitly not in Phase 1)

LLM runtime (Ollama/llama.cpp), backend/API, databases, persistent memory,
real agent execution, internet/search/download, model training/fine-tuning, Tauri
build scripts. These are architecture-compatible and documented in the README's
integration section, but were not implemented, per the brief.

**Status update 2026-11-07:** Phase 2 opened (D-019), so the first group of these is now in
progress by design. Fine-tuning and any weight modification remain deferred indefinitely — that
item is a product boundary, not a schedule.
