# NEXUS AI — Phase 2 System Architecture

**Doc:** M0 architecture lock · **Written:** 2026-11-07 · **Status:** for owner approval
**Owner decisions locked:** llama.cpp sidecar runtime · documents before any install · no model
weights downloaded yet · local Git baseline (`84cb1a8`).
**Change policy:** this is a design document. No dependency, runtime, or build tool was installed
to produce it.

---

## 1. Measured environment (probed 2026-11-07, not assumed)

| Probe | Result | Consequence |
|---|---|---|
| `git --version` | 2.45.1.windows.1 | Baseline repo created; Phase 2 steps are revertible |
| `node --version` | v24.17.0 | Meets Tauri 2 + Vite requirements |
| `npm --version` | 11.13.0 | Fine |
| `rustc --version` | **not found** | **M1 blocker** — Tauri core cannot be built until Rust is installed |
| `cargo --version` | **not found** | Same |
| `cmake` | **not found** | Blocks building llama.cpp from source |
| `cl` (MSVC) | **not found** | Blocks both llama.cpp source builds and Tauri's Windows link step |
| `D:` volume | 252 GB total, **149 GB free** (41% used) | Ample for weights; note the app volume differs from the mock profile |
| Reference CPU/RAM | i5-8250U 4C/8T ~15 W sustained, 20 GB soldered, UHD 620 + MX150 4 GB | Dominant design constraint |

Two findings worth stating plainly:

**The Windows toolchain gap is the first real Phase 2 cost.** Tauri 2 needs the MSVC build tools
and Rust; a source-built llama.cpp needs CMake plus the same MSVC compiler. Either we install
Visual Studio Build Tools (~several GB, needs your authorization and a reboot-class install), or we
run the sidecar from an official prebuilt llama.cpp release binary and defer the source build.
The prebuilt path is the smaller ask and is what §7 recommends.

**The Phase 1 mock hardware profile is not this volume.** `HARDWARE_PROFILE` describes a 512 GB
disk with 143 GB free — that matches the machine's C: drive, not D:, which measures 252 GB / 149 GB
free. When telemetry becomes real in M6, the storage figure must come from the volume that actually
hosts the app data, and the Model Manager's disk-fit math changes accordingly.

---

## 2. Process topology

```
┌─ NEXUS.exe (Tauri 2 app) ────────────────────────────────────────┐
│  WebView2                                            Rust main   │
│   └ React UI (Phase 1 shell, unchanged)      ┌──────────────────┐│
│      • screens                                │ command surface  ││
│      • typed IPC client                       │ (#[tauri::command])│
│      • event sink (streams/progress)          │                  ││
└──────────────────────────────────────────────┼──────────────────┘
                                               │  in-process: policy,
                                               │  scheduler, store, engines
                                               └──────────┬───────────────┘
                                                          │ spawns / supervises
                                          ┌───────────────▼────────────────┐
                                          │ llama-server.exe (sidecar)     │
                                          │  127.0.0.1:<ephemeral port>    │
                                          │  + X-Nexus-Token on every call │
                                          └────────────────────────────────┘
```

Three boundaries, each with one job:

**UI ⇄ core (IPC).** The React screens never touch a file, a process, or a socket. They call typed
commands and subscribe to typed events. The contract is in `PHASE2_IPC_CONTRACT.md`.

**Core ⇄ sidecar (HTTP over loopback).** OpenAI-compatible `/v1/chat/completions` plus native
`/completion` for token streaming and control. The sidecar is disposable: the core starts it,
health-probes it, and restarts it on crash. Nothing else may connect — bind is `127.0.0.1` only,
with a per-launch random token that the core requires on every request.

**Core ⇄ disk (store).** SQLite plus the model and knowledge folders. The core is the only writer.

Why a separate process rather than linking llama.cpp into the app: a 15 W CPU means inference runs
long enough that a crash or a runaway allocation is a realistic event. A supervised sidecar can be
killed and restarted without losing the app, the database, or the UI state. It also keeps the
licensing and update path for the engine independent of ours.

---

## 3. Subsystems inside the core

| Subsystem | Responsibility | Phase 1 counterpart it satisfies |
|---|---|---|
| **Policy** | Single enforcement point for offline flag, tool approval, per-agent internet grants, allow-list evaluation, memory write approval | `PlatformContext.online`, Tools `needsApproval`, Internet Center matrix |
| **Scheduler** | One execution slot, FIFO queue, cancel, timeouts, priority for interactive chat over background indexing | Activity Center timeline (mock today) |
| **Admission** | RAM/thread check before any load; refuse with an explanation rather than thrash | `hardwareCompat()` thresholds in `Models.tsx` |
| **Model registry** | Discover GGUF files, read metadata, track installed vs catalog, activate one at a time | `MOCK_MODELS`, all `installed: false` |
| **Inference client** | Sidecar lifecycle, prompt assembly, streaming, token/context accounting | `SIMULATED_REPLIES`, "context usage (simulated)" |
| **Store** | SQLite schema, migrations, transactions, backup/restore | none (Phase 1 had no persistence) |
| **Knowledge** | Folder watch → parse → chunk → embed → index → retrieve with citations | `MOCK_DOCUMENTS`, `indexed/indexing/pending/failed` |
| **Memory** | Tiered records, approval states, retrieval injection, history | `MOCK_MEMORY` + `MemoryEvent` history |
| **Tool runtime** | Registry, permission checks, approval round-trip, sandboxed execution, audit | `MOCK_TOOLS`, security-model rail |
| **Learning** | Correction log → suggestion → instruction version → rollback | `MOCK_LEARNING_EVENTS`, `INSTRUCTION_VERSIONS` |
| **Telemetry** | CPU/RAM/GPU/disk reads on a timer | `mockTelemetry(tick)` |

---

## 4. Concurrency and resource model

The machine, not the framework, dictates this section.

**One generation at a time.** Two concurrent inferences on 8 logical cores at ~15 W sustained both
run slower than one, and the second doubles peak RSS. The scheduler therefore holds a single
in-flight generation slot; everything else queues and is visible in the Activity Center.

**Interactive beats background.** Chat generation can preempt indexing or embedding work; background
jobs pause at chunk boundaries rather than being killed mid-file.

**Admission check before load.** Carried forward from the UI, with the same thresholds and the same
honesty when it refuses:

```
fit      : estimated runtime RAM ≤ 8 GB
tight    : ≤ (total RAM − 5 GB OS floor)      → 15 GB on this machine
exceeds  : otherwise → refuse to load, explain why
```

`tight` should require an explicit owner confirmation before loading, and the core should measure
actual RSS after load and surface the difference between estimate and reality — that comparison is
how the catalog's `ramGB` estimates get corrected over time.

**Thread count is a real parameter, not a default.** *To verify in M1:* `--threads 4` (physical
cores) versus 8 (logical) on an i5-8250U; the assumption is that physical cores with lower
concurrency produces better sustained throughput once thermal throttling arrives, but this must be
measured, not asserted.

**Context window is a memory decision.** A 32k context on a 7B Q4 model is not free; the core should
cap loaded context based on measured headroom and report the effective limit to the UI, replacing
the "context usage (simulated)" rail with a measured one.

---

## 5. Data layout

```
%APPDATA%\NexusAI\
  nexus.db                SQLite (single file, WAL mode)
  nexus.db-shm / -wal
  settings.json           or a settings table — decided in the data-model doc
  backups\                timestamped db copies (owner-triggered)
  logs\                   rotating app log; no prompt content by default

<D: or owner-chosen root>\
  models\                 GGUF files, owner-visible, deletable
  knowledge\              watched root for the Knowledge Base
  sidecar\                llama-server.exe + its runtime DLLs
  cache\                  parsed text, chunks, embeddings (rebuildable)
```

Principles: weights and knowledge live in folders the owner can see and delete; the database is one
inspectable file; the cache is always rebuildable and never authoritative; logs must not record
prompt or document content by default, because on a single-user machine that is a privacy leak with
no benefit.

---

## 6. Security and privacy posture

- **Loopback only, always.** The sidecar binds `127.0.0.1`. No LAN listener, ever, behind any
  setting. A random per-launch token guards even loopback callers.
- **Offline is enforced in the core.** The UI flag becomes a policy query that every network and
  tool path must pass. A UI bug cannot grant itself connectivity, because the check is not in the UI.
- **Approval is a core concept, not a dialog.** Tool calls with `needsApproval` produce a pending
  record the core waits on; the dialog is just a view of that record. Denials and timeouts are
  logged identically to grants.
- **Filesystem tools are root-scoped.** Read/write tools resolve against allow-listed roots; path
  traversal is rejected at the core, not the tool.
- **No secrets in the repo or the store.** Nothing external is required by design. If a remote
  provider is ever added, its key goes to the OS credential store, never SQLite or a config file.
- **Deletion is real deletion, with a receipt.** The Knowledge Base and Memory screens promise
  removal; the core should report exactly what was deleted and where it came from.

---

## 7. What M1 must actually build (and the prerequisite)

M1's exit is one real streamed local answer in the existing Chat screen. Ordered steps:

1. **Prerequisite (needs your authorization — installs):** Rust toolchain + Windows MSVC build
   tools for Tauri. For the engine, use an **official prebuilt llama.cpp release binary** rather
   than compiling from source, since CMake and MSVC are absent. This keeps the install footprint to
   what Tauri strictly requires and defers source building.
2. `src-tauri/` scaffold, `beforeBuildCommand` wired to the existing Vite build, `base: './'` +
   `HashRouter` preserved so nothing in the UI changes.
3. Sidecar supervisor: locate binary, verify version, pick a free port, launch with the token,
   health-probe `/health`, restart on exit, shut down cleanly with the app.
4. Model registry: scan the models folder, parse GGUF metadata (name, quant, context, size),
   populate the real `ModelRecord.installed` field.
5. Admission check wired to the existing `hardwareCompat` thresholds; refuse-with-explanation path.
6. Streaming path: `chat.send` → sidecar `/completion` with incremental chunks → Tauri event →
   Chat screen; stop/cancel wired to sidecar abort.
7. Honesty swap: remove the Chat `DemoNotice` and the "(Simulated response — no model is running)"
   italic only once 6 is genuinely producing local tokens, and update the context rail from
   simulated to measured.

**M1 measurement checklist** (numbers we currently only estimate): tokens/sec at 7B Q4 and at 3B
Q4, peak RSS after load, warm-up latency, threads 4 vs 8, sustained throughput after 5 minutes of
generation, and whether indexing can run concurrently without starving chat.

---

## 8. Failure modes and required behaviour

| Failure | What the core does | What the UI shows |
|---|---|---|
| Sidecar missing | Do not attempt load | Model Manager: engine-not-installed state with the exact path expected |
| Sidecar crashes mid-generation | Kill orphan, mark job failed, restart on next request | Chat: partial answer marked incomplete; Activity: error event |
| Model file corrupt or truncated | Refuse load, keep the file for the owner to inspect | Model Manager: failed state + size mismatch detail |
| RAM admission fails | Refuse before allocation, name the numbers | Model Manager: existing "Exceeds this machine" copy, now enforced |
| Database locked or corrupt | Stop writes, open read-only, prompt backup/restore | Settings → Backup with a real restore action |
| Tool approval times out | Treat as denial, log it | Activity: approval-expired event, not a silent skip |
| Network attempted while offline | Reject at the policy layer | Internet Center: blocked-request event with the requesting agent |

Every row is a screen state the Phase 1 UI already has a component for (`ErrorState`, `EmptyState`,
status badges) — the architecture is designed so the UI's existing vocabulary stays sufficient.

---

## 9. Packaging and update path

Tauri 2 with the Windows bundler (MSI/NSIS), sidecar declared as a bundled external binary, Vite
output as the frontend. The app updates separately from the engine and separately from models —
three independent update channels, because a model update should never require rebuilding the app
and an engine patch should never invalidate the database. No silent auto-update in Phase 2; the
Internet Center's update-check screen becomes the place where an available update is *offered*.

---

## 10. Open items this document does not settle

1. Whether the knowledge root is one watched folder or several (the UI shows a folder tree with
   Learning/Personal/Work — that is a view, not necessarily a filesystem root).
2. Embedding model choice and whether it shares the sidecar process with the chat model or runs as
   a second sidecar (RAM: two loaded models on 20 GB is the risk; recommendation is one process
   loading them sequentially).
3. Whether PowerShell/Python tools run as child processes of the core with a job object for
   kill-on-cancel, or through a narrower helper.
4. Instruction-file format for agents (Markdown with front matter is the assumption).
5. Retention: how long activity and learning events live before pruning.

These are M0 leftovers to resolve during M2/M3 design, not blockers for M1.

---

## 11. Companion documents

`PHASE2_IPC_CONTRACT.md` · `PHASE2_DATA_MODEL.md` · `PHASE2_POLICY_MODEL.md` ·
`PHASE2_SIDECAR_SPEC.md` · `PHASE2_MILESTONES.md`
