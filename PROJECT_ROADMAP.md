# PROJECT_ROADMAP.md — NEXUS AI

**Updated:** 2026-11-14
**Relationship to other docs:** `PHASE2_MILESTONES.md` defines *what "done" means* for each
milestone. This file defines *order, dependencies, and what comes next*. Execution status is in
`IMPLEMENTATION_STATUS.md`.

## Where we are

```
Phase 1  UI prototype .......................... DONE (approved 2026-11-07, frozen)
Phase 2
  M0     Architecture lock ...................... DONE (tag m0-lock)
  M0.5   IPC contract as types .................. DONE (tag m0-5-contract)
  M1.0   Rust + MSVC toolchain .................. DONE (tag m1-0-toolchain)
  M1.1   llama.cpp engine acquired .............. DONE (tag m1-1-engine)
  M1.2   One model, measured .................... DONE (tag m1-2-measurements)
  M1     One real answer end to end ............. DONE (tag m1-first-answer; TEST_RESULTS.md §4, MEASUREMENTS.md §14)
  M2     Persistence ............................ NEXT
  M3     Knowledge and Memory ................... PLANNED
  M4     Tools and one working agent ............ PLANNED
  M5     Learning loop .......................... PLANNED
  M6     Packaging and hardening ................ PLANNED
```

## M1 — closed 2026-11-14

Gate evidence: `TEST_RESULTS.md` §4 and `MEASUREMENTS.md` §14; tag `m1-first-answer` points at
`ba15fa2`. The three exit items are done:

1. **UI gate evidence.** `node tools/ui-gate.mjs` drove the real Tauri window: `NEXUS OK`
   streamed (122 measured tokens, 22.2 s cold), Stop held at 1 character after 2.5 s,
   `taskkill /IM llama-server.exe /F` produced the `engine.crashed` banner in 1,642 ms, the
   next send streamed `RECOVERED`, 0 external requests, 0 console errors.
2. **Tag `m1-first-answer`.** Placed on `ba15fa2` after the gate and regression were recorded.
3. **Reconcile with `master`.** Fast-forward `e570692..ba15fa2`; the owner's uncommitted UI work
   (`src/data/tools.ts`, `src/data/types.ts`, `src/pages/Tools.tsx`, `src/data/capabilities.ts`)
   is still uncommitted and untouched; `npm run typecheck` exit 0 in the master worktree.

**Unblocks:** M2 (persistence) — the IPC contract already has the shapes M2 fills in.

## M2 — Persistence

**Why now:** every conversation is lost on close, so no other feature can be trusted with state.
**Builds on:** `PHASE2_DATA_MODEL.md` schema, IPC `store.*` commands (already in the contract).
**Delivers:** SQLite store crate, migrations, WAL, conversation/message/settings/activity tables,
`store.backup()` / `store.restore()`, Chat and Memory/Activity screens switch from memory to real
storage with the honesty swap.
**Gate:** see `PHASE2_MILESTONES.md` §M2 — restore drill, crash-during-write test, row-count
equality after backup/restore.
**Risk:** migration mistakes destroy the only copy of user data → pre-restore backup is mandatory.

## M3 — Knowledge and Memory

**Builds on:** M2 storage; measured prefill limits.
**Delivers:** folder watch, parsers, chunking, embeddings, FTS5 + vector retrieval with citations,
memory writes behind approval, retrieval injection with visible provenance.
**Gate:** index a real `.md`, cite it, rename it without duplication, sub-second search on 200
documents, pending memory is not retrievable until approved.
**Risk:** embeddings add another model and RAM cost → must be admitted like the chat model.

## M4 — Tools and one working agent

**Builds on:** M3 retrieval; `PHASE2_POLICY_MODEL.md` invariants.
**Delivers:** tool registry with declared permissions, approval queue, filesystem/Python/PowerShell
families, serialised job scheduler, Developer Agent completing a 3-step task.
**Gate:** all ten policy invariants pass as tests, deny path is visible, path traversal refused
before any filesystem call.
**Risk:** highest blast radius in the product. Nothing ships without approval gating.

## M5 — Learning loop

**Builds on:** M2 (corrections), M3 (retrieval), M4 (tool traces).
**Delivers:** correction logging, suggestion → approval → instruction version with diff and
rollback, regression suite replay.
**Gate:** approve a suggestion, see the version and diff, roll back and prove the behaviour
reverts; fine-tuning path stays absent.
**Boundary:** no weight modification, ever.

## M6 — Packaging and hardening

**Builds on:** everything.
**Delivers:** Tauri bundle (MSI/NSIS), sidecar as a pinned external binary, real hardware telemetry,
correct disk figures, installer, uninstall cleanliness, cold-start measurement.
**Gate:** install on a clean Windows profile, launch offline, uninstall leaves weights and knowledge
folders untouched.
**Risk:** signing certificates and installer trust are owner decisions, not engineering defaults.

## Post-Phase-2 (not planned, needs an owner decision)

Candidate directions, deliberately unsequenced: model download catalog, additional model families,
multi-window/parallel conversations, OCR, mobile/remote access. None of these are in the current
plan and none should be started without the owner choosing them.

## Cross-cutting workstreams (run alongside milestones)

| Workstream | Rule |
| --- | --- |
| Honesty | Every screen flips from demo to real in the same commit as the capability, or keeps its banner. |
| Measurement | Any change to engine flags, context, or admission is re-measured in `MEASUREMENTS.md`. |
| Security | New plugin/network/tool capability updates `SECURITY_MODEL.md` and gets a decision entry. |
| Docs | Status docs update in the same commit as the change. |
| Regression | `cargo test`, `clippy -D warnings`, `npm run typecheck`, `npm run build` before every tag. |
