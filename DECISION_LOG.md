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

## Deferred (explicitly not in Phase 1)

LLM runtime (Ollama/llama.cpp), backend/API, databases, persistent memory,
real agent execution, internet/search/download, model training/fine-tuning, Tauri
build scripts. These are architecture-compatible and documented in the README's
integration section, but were not implemented, per the brief.
