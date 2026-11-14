# ARCHITECTURE_DECISIONS.md — NEXUS AI

ADR index for Phase 2. Each entry is one line: the decision, its status, and the record it
came from. Full rationale lives in `DECISION_LOG.md`; this file exists so the numbered
decisions are readable as architecture rather than as a diary.

**Scope:** D-019 … D-036 are the Phase 2 decisions (owner-approved from 2026-11-07). D-001 …
D-018 are Phase 1 UI decisions and are not repeated here. The two ADR-00x entries below are
seam decisions that were implemented without a numbered `DECISION_LOG` entry; the ADR id is
local to this index, not a `D-` number. There are no gaps in D-019 … D-036.

## Index

| ID | Decision | Status |
| --- | --- | --- |
| D-019 | Phase 2 is open, authorised by the exact owner message `APPROVE UI — START PHASE 2` on 2026-11-07. | Accepted |
| D-020 | Inference runtime is a llama.cpp sidecar on `127.0.0.1` with a per-launch token — not Ollama-as-provider, not a remote API. | Accepted |
| D-021 | M0 is documents only: no installs, no downloads, no scaffold; architecture changes are cheaper on paper. | Fulfilled (M0 delivered; M1 authorised separately by D-028/D-030/D-033) |
| D-022 | No model weights on the machine yet; runtime verification comes before the first multi-GB download. | Superseded by D-033 |
| D-023 | Version control starts at the Phase 1 boundary: `git init`, `.gitignore`, baseline `84cb1a8`, local only. | Accepted |
| D-024 | Environment is measured, not assumed; the probe found `rustc`/`cargo`/`cmake`/`cl` absent and `D:` at 252 GB / 149 GB free. | Accepted; toolchain half superseded by D-028 |
| D-025 | The IPC contract is materialised as TypeScript types before any runtime exists (96 commands, 10 events). | Accepted |
| D-026 | Argument presence is derived by `ArgsTuple` (`undefined` → no parameter; all-optional → optional object; else required) rather than declared per command. | Accepted |
| D-027 | `chat.list` returns `ConversationSummary` (no `messages`, plus `messageCount`), because the sidebar only needs counts. | Accepted |
| D-028 | Owner authorises the Rust + MSVC install, scoped to "verify, document, stop", adding C++ to the existing VS instance. | Accepted |
| D-029 | VS 2026's C++ workload is `Microsoft.VisualStudio.Workload.NativeDesktop`; an installer exit code is not evidence — the artefact is. | Accepted |
| D-030 | Engine is pinned to b12189, CPU x64, outside the repo, with our own SHA-256 baseline rather than a publisher digest. | Accepted |
| D-031 | The supervisor spawns `llama-server.exe`, not the unified `llama.exe`, so `update`/`download` are not in the launched binary's surface. | Accepted |
| D-032 | A weightless start is router mode; `--models-max 1` / `--no-models-autoload` were added and `POST /models/load` was believed usable. | Partly superseded by D-034 (the load-route half was wrong) |
| D-033 | D-022 is lifted for exactly one model: `Llama-3.2-3B-Instruct-Q4_K_M.gguf` in `D:\NEXUS-MODELS\`, digest verified against the publisher. | Accepted |
| D-034 | Spawn single-instance with `-m <path>`; router mode cannot load a local GGUF over HTTP, so the admission check moves before the spawn. | Accepted; corrects D-032 |
| D-035 | There is no unload and no shutdown route; `engine.unloadModel` and `engine.stop` mean terminating the process, and a model switch costs a full reload. | Accepted |
| D-036 | The measured envelope: decode survives, prefill is the threat; `--ctx-size 0` is a hazard, threads are physical cores, cancel is batch-bound. | Accepted |
| ADR-001 | Tauri exposes exactly one command, `ipc`, with a `{ command, args }` payload carrying the dotted contract name. | Accepted |
| ADR-002 | `chat.stop` sets the shared `CancelFlag` before taking the core mutex; `generate` never resets it. | Accepted |

## The two seam ADRs in full

### ADR-001 — One `ipc` command with a dotted payload

**Context.** The contract has 96 command names in `domain.verb` form (`chat.send`,
`model.list`). Tauri command names must be valid Rust identifiers, so a dotted name cannot be
registered as a handler. Registering 96 renamed handlers would put the contract in two places
and invite drift.

**Decision.** `src-tauri/src/lib.rs` registers one `#[tauri::command] async fn ipc(command:
String, args: Option<Value>)`. `src/contract/client.ts` calls `invoke('ipc', { command, args })`;
`nexus_core::dispatch::Core::route` matches the dotted name. The contract stays authoritative
in one Rust `match`, and every command runs on a blocking thread because `engine.loadModel` is
a process spawn and a health wait.

**Consequences.** Adding a command is one arm in `dispatch.rs` plus the TypeScript spec; there
is no per-command Tauri ACL to maintain. `not_implemented` remains the default. The cost is
that Tauri's command-level permission granularity is not used; the capability file grants only
`core:default`, and the real allow-list is the `match`.

**Recorded in:** `PHASE2_IPC_CONTRACT.md` §1, `src-tauri/src/lib.rs`, `src/contract/client.ts`.

### ADR-002 — `chat.stop` before the mutex

**Context.** A generation holds the core mutex for its whole duration, including the cold model
load and prefill. If Stop had to acquire that mutex, it would wait for exactly the work it is
supposed to interrupt. Separately, cancel is batch-bound on this engine: 1,744 ms in one
measured arm and 231 ms in another from client abort to engine idle (`MEASUREMENTS.md` §8), so
Stop cannot assume the CPU stopped when the socket closes.

**Decision.** The Tauri `ipc` handler intercepts `command == "chat.stop"` before locking the
core, calls `CancelFlag::cancel()`, and returns. The same flag is cloned into
`inference::generate`, whose monitor thread checks it every 50 ms and shuts the socket. The
request path (`chat.send`) resets the flag at the start, then checks it after the model load,
so a Stop pressed during a cold load survives into the request. `generate` deliberately never
resets the flag.

**Consequences.** Stop works during load and during streaming; a second generation cannot
start while the first holds the mutex; `conversationId` is informational because M1 runs one
generation at a time. When M4 adds a scheduler, the flag must become conversation-scoped
rather than global (TD-13).

**Recorded in:** `src-tauri/src/lib.rs`, `crates/nexus-core/src/dispatch.rs`,
`crates/nexus-core/src/inference.rs`, `AGENTS.md` → "Hard-won constraints".
