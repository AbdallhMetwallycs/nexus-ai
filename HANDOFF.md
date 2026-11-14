# HANDOFF.md — cold-start state

Append one block per session. Newest block on top. Keep it short: current state, next action,
what changed last. Do not edit older blocks.

---

## 2026-11-14 (docs) — Agent A — P1 documentation landed

**Current state.** The documentation set is complete and reviewed: `PROJECT_RECOVERY_REPORT.md`,
`IMPLEMENTATION_STATUS.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`, `ARCHITECTURE_DECISIONS.md`,
`KNOWN_ISSUES.md`, `TECHNICAL_DEBT.md`, updated `PROJECT_ROADMAP.md`, `README.md`,
`MASTER_PROJECT_PLAN.md`, `SECURITY_MODEL.md`, `DATA_AND_BACKUP_STRATEGY.md`. The docs lane verified
claims against `git log`, `dispatch.rs`, `src/pages/*.tsx` and the recorded gate output instead of
copying the drafts.

**Review findings, all fixed.** `MASTER_PROJECT_PLAN.md` still said "M1 core + shell landed and being
verified"; the security model claimed no egress while `index.html` linked Google Fonts; `WORK_QUEUE.md`
row 24 described a duplication that no longer exists. The font contradiction was real and is closed
by vendoring Inter/JetBrains Mono (`@fontsource-variable/*`, D-037): `dist/index.html` now contains no
`http(s)://`, and the live window reports `interLoaded:true`, `monoLoaded:true`, with only
`http://ipc.localhost/ipc` as a resource (`TEST_RESULTS.md` §7).

**Next action.** P2 hygiene: row 24 (`engine.rs` clamp should use `admission::MIN_CONTEXT` /
`MAX_CONTEXT`), 25–27 (crash-mapping and cancelled-while-loading tests), 29 (Models page audit). Then
the M2 store skeleton, rows 30–35.

---

## 2026-11-14 (later) — Agent A — P0 closed

**Current state.** M1 is done and tagged. `ba15fa2` carries the Tauri shell, the crash-detection
fix, the honesty fixes, the gate driver, and the evidence documents; tag `m1-first-answer` points at
it. `D:\NEXUS-AI` master was fast-forwarded `e570692..ba15fa2` and the owner's uncommitted UI work
(`src/data/tools.ts`, `src/data/types.ts`, `src/pages/Tools.tsx`, `src/data/capabilities.ts`) is
still uncommitted and untouched; `npm run typecheck` in the master worktree is exit 0.

**Gate evidence (2026-11-14T13:28:27Z–13:29:23Z, exit 0).** `answer-complete` `NEXUS OK` / 122
measured tokens / 22.2 s cold; `stop` 1 char and still 1 after 2.5 s; kill → `engine.crashed: The
local engine stopped while answering. The next message will restart it.` (1.64 s); next send →
`RECOVERED` (22.3 s); 0 external requests; 0 console errors. Full quotes in `TEST_RESULTS.md` §4 and
`MEASUREMENTS.md` §14.

**Defect worth remembering.** `Child::try_wait()` lags an external `taskkill` by 0.8–1.5 s here.
The supervisor now probes `/health` (`serving()`) before reusing a launch and before deciding
crash-vs-I/O. Do not "simplify" that back to a handle check.

**Next action.** P1 docs (rows 10–17, 19, 23) and the M2 store skeleton (rows 24–35).
Conversation state is still in memory; `chat.regenerate` still refuses in live mode.

---

## 2026-11-14 — Agent A (worktree `D:\NEXUS-AI-m1`, branch `m1-first-answer`)

**Current state.** M1 real-answer path works end to end through the desktop app: `llama-server.exe`
spawns, one real model is discovered, a prompt streams real tokens, `chat.stop` halts growth, and
killing the engine does not take the app down. Two defects found by the live gate were fixed:
Vite's watcher crashed on `nexus_ai_lib.dll` (`EBUSY`), and the Topbar/context rail claimed
"UI prototype · Phase 1" and "measured 0" while live.

**Next action.** Rerun the full UI gate so the crash banner reads `engine.crashed: The local engine
stopped while answering…` and recovery streams `RECOVERED`. Then tasks 4–8 of `WORK_QUEUE.md`.

**Uncommitted on this branch (expected).** Tauri shell (`src-tauri/`), `Chat.tsx`, `Topbar.tsx`,
`vite.config.ts`, `package.json`, `.gitignore`, `crates/nexus-core/src/{dispatch,error,inference}.rs`,
`src/contract/client.ts`, `src/data/models.ts`, `src/pages/Models.tsx`,
`src/state/PlatformContext.tsx`, `PHASE2_IPC_CONTRACT.md`, plus new docs (`AGENTS.md`,
`MASTER_PROJECT_PLAN.md`, `PROJECT_ROADMAP.md`, `SECURITY_MODEL.md`,
`DATA_AND_BACKUP_STRATEGY.md`, `WORK_QUEUE.md`, this file) and `screenshots/`.

**Do not touch on master.** `src/data/tools.ts`, `src/data/types.ts`, `src/pages/Tools.tsx`,
`src/data/capabilities.ts` — owner UI work, uncommitted.

**How to reproduce the gate.** See `AGENTS.md` → "Live UI gate". Driver:
`tools/ui-gate.mjs`, output `.ui-gate.json`, DevTools port via `NEXUS_CDP_PORT` (default 9333).
