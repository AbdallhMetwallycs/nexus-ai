# AGENTS.md — NEXUS AI

Operating instructions for any AI agent working in this repository. Read this before touching code.
It overrides `CONVENTIONS.md` where they disagree: that file describes the Phase 1 UI-only prototype,
and Phase 2 added a real Rust core and a Tauri shell.

## What this is

NEXUS AI is a standalone, offline-first local AI desktop application for Windows. It runs a real
GGUF model through a locally installed `llama-server` sidecar, streams real tokens into an approved
UI, and never sends prompts or files off the machine.

Phase state: **Phase 1 UI is finished and approved; do not redesign it.** Phase 2 is in progress —
M1 (first real answer end to end) is complete; the next milestone is M2 (SQLite persistence).
`PHASE2_MILESTONES.md` is the schedule of record, `MEASUREMENTS.md` is the evidence of record.

## Non-negotiable rules

1. **No fake functionality.** If it is not implemented, it must say so (`DemoNotice`, a toast, an
   explicit `not_implemented` error). Never make a control look like it works when it does not.
2. **No success claim without evidence.** "It works" means a command ran and its output is quoted in
   `TEST_RESULTS.md` or `MEASUREMENTS.md`. Do not infer success from a successful build.
3. **Preserve user work.** `D:\NEXUS-AI` `master` carries uncommitted UI changes (Commerce capability
   registration) that must not be lost. Never `git checkout --`, `git reset --hard`, or force-push
   without explicit approval.
4. **Local only.** No telemetry, no analytics, no cloud calls, no downloads at runtime. Dependency
   fetches during development are ordinary work but must be recorded in `DECISION_LOG.md`.
5. **Ask before destructive or irreversible actions** — deleting models, rewriting history, moving
   files outside the repo, anything that leaves the machine.
6. **Do not invent measurements.** Every number in a doc or UI must come from a recorded run on this
   machine, with the command that produced it.

## Repository map

```
crates/nexus-core/        Rust core: engine supervisor, inference client, registry, admission,
                          system probes, dispatch (the whole IPC contract lives here)
src-tauri/                Tauri 2 shell: one `ipc` command, event bridge, exit cleanup
src/                      React 18 + TS + Tailwind UI (Phase 1, approved)
  contract/               IPC types + transport (Tauri or browser-demo)
  state/PlatformContext   core-aware active model / model list
src/data/                 Mock data still used by screens that are honestly simulated
MEASUREMENTS.md           Hardware and latency evidence, all runs
PHASE2_MILESTONES.md      M0–M6 definition of done and progress
PHASE2_IPC_CONTRACT.md    The dotted command/event contract (source of truth for the seam)
DECISION_LOG.md           Numbered decisions (D-xxx) and corrections
```

## Build, test, run

Frontend (`D:\NEXUS-AI-m1`):

```powershell
npm run typecheck          # tsc --noEmit, must be clean
npm run build              # tsc && vite build
```

Rust core:

```powershell
cargo test -p nexus-core                               # unit tests, no model needed
cargo clippy --workspace --all-targets -- -D warnings  # must be clean
```

Live tests (load the real model; slow, and they spawn `llama-server`):

```powershell
$env:NEXUS_LIVE_ENGINE="1"
cargo test -p nexus-core live -- --nocapture           # engine run
cargo test -p nexus-core live_chat -- --nocapture      # full IPC + stream + usage
```

Desktop app:

```powershell
npm run tauri dev          # Vite on :5173 + the Tauri window
```

Live UI gate (evidence, not a unit test — drives the real window and kills the real engine):

```powershell
# terminal 1: DevTools enabled (9222 is usually a normal Chrome; use 9333)
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"
npm run tauri dev

# terminal 2, from the repo root, while the app is up
node tools/ui-gate.mjs     # exit 0 = every step passed
```

It writes `.ui-gate.json` (gitignored) and `screenshots/m1-live-ui-gate.png`; `tools/README.md`
lists the steps and env overrides. Use it before claiming any chat, stream, stop, or crash-recovery
change works.

Note: `cargo` writes progress to stderr, so PowerShell may report a `RemoteException` while the
command actually succeeded. Check `$LASTEXITCODE` / the final `Finished` line, not the color.

## Runtime assets (not in the repo)

| Asset | Path | Override |
| --- | --- | --- |
| `llama-server.exe` build | `D:\NEXUS-SIDECAR\b12189\` | `NEXUS_ENGINE_DIR` |
| GGUF weights | `D:\NEXUS-MODELS\` | `NEXUS_MODELS_DIR` |

Only `Llama-3.2-3B-Instruct-Q4_K_M.gguf` is authorised. Do not download other weights without asking.

## Hard-won constraints (do not regress)

- **Admission is measured, not guessed:** `private ≈ 1495 MB + 0.1106 MB × tokens`. Cap context at
  ~16k on the 20.3 GB laptop; fail closed when memory status is unknown.
- **`--ctx-size 0` is forbidden.** It means "use the model's advertised context" (131,072 here),
  which the measurements show would cost ~14.5 GB of KV cache.
- **Threads = physical cores**, never logical. Flags: `--offline --metrics -fa on --n-gpu-layers 0
  --threads-batch <physical>`.
- **There is no unload/shutdown HTTP route.** Unloading means terminating the process; a model switch
  costs the full (re)load.
- **Prefill, not decode, is the product constraint** (~36 s for 710 prompt tokens). Prompt-cache reuse
  is a design requirement, not an optimisation.
- **Stop must survive model load.** `chat.stop` sets a shared `CancelFlag` before taking the core
  mutex; `generate` must never reset the flag itself.
- **Usage is only reported if requested.** `chat_body` must send `stream_options.include_usage`, or
  the engine emits no usage frame and the context rail has nothing honest to show.
- **A process handle is not a health check.** On this machine `Child::try_wait` keeps reporting a
  `taskkill`-ed `llama-server.exe` as alive for 0.8–1.5 s. Reusing a launch and deciding "crash vs
  I/O error" must probe `/health` (`Supervisor::serving()`), not just the handle; otherwise a dead
  engine is retried on a closed port and the UI shows `internal:` instead of `engine.crashed:`.

## IPC seam

- Rust command names must be valid identifiers, so Tauri exposes exactly one command: `ipc`, with
  payload `{ command, args }`. Dotted contract names live inside the payload.
- Events: `chat://token`, `chat://usage`, `model://state`. Tauri permits `/` and `:` in event names.
- Success/failure is the envelope in `src/contract/ipc.ts`, mirroring `ipc_types.rs`. Keep both sides
  in lockstep and update `PHASE2_IPC_CONTRACT.md` in the same change.
- `withGlobalTauri: true` is required for `window.__TAURI__` transport detection.

## Frontend honesty rules (live vs demo)

`resolveTransport()` decides once per session. In a browser the app is a demo and must say so; in
Tauri it shows real engine data. Never mix: a "live" screen may only claim what the core reported.
Mock catalogs (downloads, store listings) stay behind explicit `DemoNotice`s.

## Docs you must keep current

After a change that alters behaviour or evidence, update the matching file in the same commit:
`IMPLEMENTATION_STATUS.md`, `TEST_RESULTS.md`, `MEASUREMENTS.md`, `KNOWN_ISSUES.md`,
`TECHNICAL_DEBT.md`, `DECISION_LOG.md`, `CHANGELOG.md`.

## Commit and branch rules

- Work on a branch, not directly on `master`.
- One logical change per commit; the message says what was verified, not what was attempted.
- Milestone tags (`m0-lock`, `m0-5-contract`, `m1-0-toolchain`, `m1-1-engine`, `m1-2-measurements`,
  `m1-core`, `m1-first-answer`) are immutable evidence. Do not move an existing tag.
