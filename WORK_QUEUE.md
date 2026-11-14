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
| 10 | Recovery report | `PROJECT_RECOVERY_REPORT.md` | B | done | 9 sections; commit/tag table checked with `git log`/`git show`; every number quoted from `TEST_RESULTS.md` or `MEASUREMENTS.md` |
| 11 | Per-screen implementation status | `IMPLEMENTATION_STATUS.md` | B | done | 11 screens + implemented command surface; each row verified against `dispatch.rs` and `src/pages/*.tsx` |
| 12 | Test results log | `TEST_RESULTS.md` | A (1–6) → B after | done | §1–§4 gate, §5 defects, §6 gaps, §7 font fix; exact commands and output quoted |
| 13 | Changelog | `CHANGELOG.md` | B | done | `[0.1.0] — 2026-11-14 — M1`; core, shell, streaming, stop, crash, honesty fixes, font fix |
| 14 | Release notes | `RELEASE_NOTES.md` | B | done | user-facing M1 notes; "not installable" callout and run-from-source steps |
| 15 | Architecture decisions index | `ARCHITECTURE_DECISIONS.md` | B | done | D-019…D-036 one-liners with status + ADR-001 (single `ipc`) and ADR-002 (Stop before mutex) |
| 16 | Known issues | `KNOWN_ISSUES.md` | B | done | KI-1…KI-12 with impact/workaround; KI-10 resolved by the font fix |
| 17 | Technical debt | `TECHNICAL_DEBT.md` | B | done | TD-1…TD-16, each with what/why/trigger; TD-3 resolved |
| 18 | Master plan review | `MASTER_PROJECT_PLAN.md` | A | done | status line and delivery table corrected to M1 done/tagged; reviewed after B flagged both as stale |
| 19 | Roadmap M1 line | `PROJECT_ROADMAP.md` | B | done | M1 marked DONE with tag `m1-first-answer` and `TEST_RESULTS.md` §4 / `MEASUREMENTS.md` §14 |
| 20 | Security model | `SECURITY_MODEL.md` | A | done | egress row rewritten to name the vendored fonts; date 2026-11-14 |
| 21 | Data and backup strategy | `DATA_AND_BACKUP_STRATEGY.md` | A | done | content re-read against the store plan; date 2026-11-14 |
| 22 | Update `PHASE2_MILESTONES.md` M1 section | `PHASE2_MILESTONES.md` | A | done | 2026-11-14 progress paragraph with gate evidence and the tag; regression numbers quoted; `llama.exe` → `llama-server.exe` in the exit-gate block |
| 23 | Update `README.md` | `README.md` | B | done | current milestone, run commands, honest per-screen table, Phase 2 doc set and `AGENTS.md` |

## P2 — M1 hygiene (small, isolated; claim after P0)

| ID | Task | Files (exclusive) | Owner | Status | Done-when (evidence) |
| --- | --- | --- | --- | --- | --- |
| 24 | Use the admission constants instead of literal context bounds | `crates/nexus-core/src/engine.rs` | Either | todo | `engine.rs` `context.clamp(2_048, 32_768)` uses `admission::MIN_CONTEXT`/`MAX_CONTEXT`; dispatch already passes `admission::DEFAULT_CONTEXT` (the old wording here was stale). UI fallback `32_768` in `Chat.tsx` is TD-14, not this row |
| 25 | Unit test for crash mapping (fake dead supervisor) | `crates/nexus-core/src/dispatch.rs` | Either | todo | `cargo test` count increases and passes |
| 26 | Test `chat.send` cancelled-while-loading | `crates/nexus-core/src/dispatch.rs` (after 25) | Either | todo | returns `job.cancelled` |
| 27 | Live tests skip cleanly when `NEXUS_LIVE_ENGINE` unset | `crates/nexus-core/src/dispatch.rs`, `inference.rs` | Either | todo | plain `cargo test` passes fast, no engine spawn |
| 28 | Document `NEXUS_CDP_PORT` / WebView2 debugging (dev-only) | `AGENTS.md` (after 3) | Either | done | `AGENTS.md` → "Live UI gate" block (port 9333, second terminal, gate driver) plus `tools/README.md` env overrides `NEXUS_CDP_PORT`, `NEXUS_SHOT`, `NEXUS_GATE_OUT`; no secret committed |
| 29 | Models page honesty audit | `src/pages/Models.tsx` | A | done | `Set active` now marks active only after `engine.loadModel` succeeds; live catalog rows show `Not on disk — mock catalog row` and hide the details-modal button; download toast corrected; `npm run typecheck` exit 0 (live path not re-driven) |
| 36 | Move UI fonts into the bundle (no font CDN) | `index.html`, `src/main.tsx`, `tailwind.config.js`, `package.json`, `package-lock.json` | A | done | `@fontsource-variable/inter` + `jetbrains-mono`; `dist/index.html` has no `http(s)://`; runtime check `interLoaded:true`, `monoLoaded:true`, only `http://ipc.localhost/ipc` — `TEST_RESULTS.md` §7, D-037 |
| 37 | Triage the `npm audit` advisories | `TECHNICAL_DEBT.md` | A | done | `npm audit --json` on 2026-11-14: 4 vulnerabilities (3 moderate, 1 high) in `vite`/`esbuild` dev tooling and `react-router`; recorded as TD-17 with trigger, nothing upgraded |

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
| A | `m1-first-answer` @ worktree | none open — 1–9, 12, 18, 20–22, 36 are `done` |
| B | — | none open — 10, 11, 13–17, 19, 23 are `done`; 12 released to A and closed |

P0 and P1 are closed. The docs lane ran against the real tree, and its review found three stale
documents (master plan status, security-model egress claim, row 24) plus the Google Fonts writeup in
`index.html`; all were fixed in the same change and the font fix is recorded as D-037. Next queued
work is P2 hygiene (24–29) and then the M2 store skeleton (30–35).

Last updated: 2026-11-14.
