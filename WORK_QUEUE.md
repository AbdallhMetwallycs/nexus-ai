# WORK_QUEUE.md — NEXUS AI shared task board

One row per task. One writer per file. A task may be claimed only if none of its files are
already claimed by another open task (status `claimed`, `in-progress`, `blocked`, or `review`).

Status values: `todo → claimed → in-progress → blocked → review → done`.

Rules:

1. **Claim before editing.** Set `Owner` and `Status: claimed` in the same edit that you start work.
   If any file in your list is held by an open row, pick a different task.
2. **`done` requires evidence** — recorded command output, not an assertion. Put it in the row's
   evidence column and in `TEST_RESULTS.md` / `MEASUREMENTS.md`.
3. **Shared files are their own task.** `package.json`, `Cargo.toml`, `Chat.tsx`, `AGENTS.md` etc.
   may not be touched by two tasks at once. Split, do not share.
4. **Never edit `D:\NEXUS-AI` (master) and `D:\NEXUS-AI-m1` (worktree) on the same file.**
   Master carries owner UI work (`src/data/tools.ts`, `src/data/types.ts`, `src/pages/Tools.tsx`,
   `src/data/capabilities.ts`); the worktree carries Phase 2.
5. **Release a claim** by moving the row to `done` or `blocked` with a note. A blocked row keeps its
   files reserved until you say otherwise.

Agents: **A** = this session (opencode, worktree `D:\NEXUS-AI-m1`, branch `m1-first-answer`).
**B** = second agent (docs lane). **Either** = whoever is free after P0.

## P0 — Close M1 (blocking everything)

| ID | Task | Files (exclusive) | Owner | Status | Done-when (evidence) |
| --- | --- | --- | --- | --- | --- |
| 1 | Rerun the full UI gate after the latest fixes | none (writes `.ui-gate.json`, `screenshots/`) | A | done | `node tools/ui-gate.mjs` exit 0, run `13:28:27Z`–`13:29:23Z`: `answer-complete` (`NEXUS OK`, context 122), `stop` (1 char → still 1 after 2.5 s), `engine-killed`, `recovered` (`RECOVERED`) — `TEST_RESULTS.md` §4 |
| 2 | Verify crash recovery explicitly | `crates/nexus-core/src/dispatch.rs` | A | done | banner reads `engine.crashed: The local engine stopped while answering. The next message will restart it.` and the next send streams `RECOVERED` (22.3 s) — `MEASUREMENTS.md` §14 |
| 3 | Save the UI gate driver into the repo | `tools/ui-gate.mjs`, `tools/README.md`, `AGENTS.md` | A | done | driver ran from the repo root against a clean `npm run tauri dev`; usage in `AGENTS.md` → "Live UI gate" |
| 4 | Record gate output | `TEST_RESULTS.md`, `MEASUREMENTS.md` §14 | A | done | exact JSON/text quoted with ISO timestamps |
| 5 | Rebuild frontend | none (writes `dist/`) | A | done | `npm run build` exit 0, 1614 modules, built in 11.18 s |
| 6 | Re-run full regression | none | A | done | `cargo test -p nexus-core` 53 passed 0 failed; clippy exit 0; typecheck exit 0 — all recorded |
| 7 | Commit M1 shell + UI honesty fixes on `m1-first-answer` | `src-tauri/`, `src/pages/Chat.tsx`, `src/components/layout/Topbar.tsx`, `vite.config.ts`, `package.json`, `.gitignore`, `AGENTS.md`, `WORK_QUEUE.md`, `HANDOFF.md`, new P1 docs | A | done | commit `ba15fa2` (95 files, message lists the verified gate/regression output) |
| 8 | Tag `m1-first-answer` | none (creates tag) | A | done | `m1-first-answer` annotated tag points at `ba15fa2`; task 1–7 were done first |
| 9 | Reconcile `m1-first-answer` with master | merge only | A | done | fast-forward `e570692..ba15fa2` in `D:\NEXUS-AI`; user's `tools.ts`, `types.ts`, `Tools.tsx`, `capabilities.ts` still uncommitted and preserved; `npm run typecheck` exit 0 |

## P1 — Required documentation (independent files; none touch code)

| ID | Task | Files (exclusive) | Owner | Status | Done-when (evidence) |
| --- | --- | --- | --- | --- | --- |
| 10 | Recovery report | `PROJECT_RECOVERY_REPORT.md` | B | todo | file committed, statements traceable to commits/tags |
| 11 | Per-screen implementation status | `IMPLEMENTATION_STATUS.md` | B | todo | every screen marked real/partial/demo with backing IPC command |
| 12 | Test results log | `TEST_RESULTS.md` | A (1–6) → B after | todo | commands, dates, exact output, pass/fail |
| 13 | Changelog | `CHANGELOG.md` | B | todo | M1 entries: core, shell, streaming, stop, crash, honesty fixes |
| 14 | Release notes | `RELEASE_NOTES.md` | B | todo | user-facing M1 notes, explicitly "not yet installable" |
| 15 | Architecture decisions index | `ARCHITECTURE_DECISIONS.md` | B | todo | ADR index for D-019…D-036 + single-`ipc` + Stop-before-lock |
| 16 | Known issues | `KNOWN_ISSUES.md` | B | todo | includes CSP, signing, context estimate window, in-memory chat, crash message |
| 17 | Technical debt | `TECHNICAL_DEBT.md` | B | todo | numbered TD-1… with owner/trigger |
| 18 | Master plan review | `MASTER_PROJECT_PLAN.md` | A (drafted) → B review | review | content reviewed and committed |
| 19 | Roadmap M1 line | `PROJECT_ROADMAP.md` | B | todo | M1 marked done with evidence link after task 8 |
| 20 | Security model | `SECURITY_MODEL.md` | A (drafted) → B review | review | content reviewed and committed |
| 21 | Data and backup strategy | `DATA_AND_BACKUP_STRATEGY.md` | A (drafted) → B review | review | content reviewed and committed |
| 22 | Update `PHASE2_MILESTONES.md` M1 section | `PHASE2_MILESTONES.md` | A | done | 2026-11-14 progress paragraph with gate evidence and the tag; regression numbers quoted |
| 23 | Update `README.md` | `README.md` | B | todo | points at Phase 2 doc set and `AGENTS.md` |

## P2 — M1 hygiene (small, isolated; claim after P0)

| ID | Task | Files (exclusive) | Owner | Status | Done-when (evidence) |
| --- | --- | --- | --- | --- | --- |
| 24 | Centralize model-load context cap | `crates/nexus-core/src/admission.rs` | Either | todo | one constant used by dispatch and covered by a test |
| 25 | Unit test for crash mapping (fake dead supervisor) | `crates/nexus-core/src/dispatch.rs` | Either | todo | `cargo test` count increases and passes |
| 26 | Test `chat.send` cancelled-while-loading | `crates/nexus-core/src/dispatch.rs` (after 25) | Either | todo | returns `job.cancelled` |
| 27 | Live tests skip cleanly when `NEXUS_LIVE_ENGINE` unset | `crates/nexus-core/src/dispatch.rs`, `inference.rs` | Either | todo | plain `cargo test` passes fast, no engine spawn |
| 28 | Document `NEXUS_CDP_PORT` / WebView2 debugging (dev-only) | `AGENTS.md` (after 3) | Either | todo | usage note present, no secret committed |
| 29 | Models page honesty audit | `src/pages/Models.tsx` | Either | todo | every mock action has a `DemoNotice` or refuses honestly |

## P3 — M2 preparation (new files, no overlap with M1)

| ID | Task | Files (exclusive) | Owner | Status | Done-when (evidence) |
| --- | --- | --- | --- | --- | --- |
| 30 | Create `crates/nexus-store/` skeleton | `Cargo.toml`, `crates/nexus-store/**` | Either | todo | workspace builds with empty crate |
| 31 | Schema migration 0001 from `PHASE2_DATA_MODEL.md` | `crates/nexus-store/**` (after 30) | Either | todo | applies from empty DB, `integrity_check` clean |
| 32 | `store.*` dispatch arms | `crates/nexus-core/src/dispatch.rs` (serial with 24–27) | Either | todo | one arm at a time, each with a test |
| 33 | Backup/restore implementation + drill | `crates/nexus-store/**` | Either | todo | drill recorded per `DATA_AND_BACKUP_STRATEGY.md` §7 |
| 34 | Chat persistence switch | `src/pages/Chat.tsx`, `src/contract/*` | Either | todo | chat survives restart; in-memory fallback gone |
| 35 | Crash-during-write test | — | Either | todo | kill app mid-insert, record in `TEST_RESULTS.md` |

## Current claims

| Agent | Branch | Rows held |
| --- | --- | --- |
| A | `m1-first-answer` @ worktree | 18, 20, 21 (drafts awaiting content review); P0 rows 1–9 and 22 are `done` |
| B | — | 10, 11, 13, 14, 15, 16, 17, 19, 23 (12 is released now that A finished task 4) |

P0 is closed: master fast-forwarded to the evidence commit, tag `m1-first-answer` placed, and the
migration left the owner's uncommitted UI work untouched. Next queued work is P1 docs (B) and the
P2 hygiene rows 24–29.

Last updated: 2026-11-14.
