# HANDOFF.md — cold-start state

Append one block per session. Newest block on top. Keep it short: current state, next action,
what changed last. Do not edit older blocks.

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
