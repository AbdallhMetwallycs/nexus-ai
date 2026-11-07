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
| `rustc --version` | 1.99.1 (58cf8f9c3 2026-10-13), host `x86_64-pc-windows-msvc`, LLVM 23.1.1 | **Installed after the M0 lock** — see the checkpoint below; Tauri core is buildable |
| `cargo --version` | 1.99.1 (5f94df478 2026-08-27) | Same |
| `cmake` | Not a global command; the VS 2026 instance ships its own (`CMake tools for Visual Studio`) | Source builds must invoke it through the VS environment, not PATH |
| `cl` (MSVC) | 19.51.36260 (toolset 14.51.36231) via `vcvars64.bat`; Windows SDK 10.0.26100.0 | Present since the checkpoint; not on a plain PATH by design |
| `D:\NEXUS-SIDECAR\b12189\` | llama.cpp b12189 CPU x64, 61 MB extracted, sha256 `f912ea5e…82aac` | Engine binary present and run weightless (M1.1); **no model file exists**, so no inference number below is measured |
| `D:` volume | 252 GB total, **~148.6 GB free** | Ample for weights; note the app volume differs from the mock profile |
| `C:` volume | **83.9 GB free** after the toolchain install (was 99.4 GB) | The toolchain landed on C:; ~15.5 GB consumed |
| Reference CPU/RAM | i5-8250U 4C/8T ~15 W sustained, 20 GB soldered, UHD 620 + MX150 4 GB | Dominant design constraint |

**Checkpoint M1.0 — toolchain prerequisite (2026-11-07, owner-authorised; see `DECISION_LOG.md`
D-028/D-029 and `PHASE2_MILESTONES.md` M1.0):**
the original M0 probe was correct at the time and is now superseded. The real finding was that
Visual Studio Community 2026 (18.11.2, instance `bcdd2c05`) was **already installed without a C++
workload**, so the plan was to modify that instance rather than install Build Tools alongside it.
Three results from that operation are worth keeping:

1. Adding `Microsoft.VisualStudio.Workload.VCTools` exits 0 and installs nothing — the id was renamed
   in VS 2026. The authoritative id came from the channel's `VisualStudio.vsman`:
   **`Microsoft.VisualStudio.Workload.NativeDesktop`**. Never trust a 0 exit code from the installer;
   check the artefact.
2. `setup.exe modify` rejects `--wait` (exit 87), so completion is detected from the installed
   packages, not the process.
3. `rustc` 1.99.1 finds the v18 MSVC install on its own — **no `vcvars` wrapper is needed for cargo
   builds**, which removes a whole class of environment bugs from the Tauri build path. `cl` itself
   still needs `vcvars64.bat`.

Verification output (plain shell, no dev command prompt): `cargo build` finished in 5.49 s and the
binary printed a live PID; `cargo clippy --all-targets` exited 0; and `cl` compiled and ran a
`<windows.h>` program that called `GetCurrentProcessId()`, then relinked it against `user32.lib`.
Footprint: VS instance 9.09 GB (of which VC Tools 2.40 GB, Windows Kits 2.12 GB), `.rustup` 1.30 GB,
cargo package cache 4.76 GB. The installer log ends `Exit Code: 0` but also records
**"Updating instance state that a reboot is required"**, so the next working session should start with a
reboot even though everything verified without one.

Two findings worth stating plainly:

**The Windows toolchain gap was the first real Phase 2 cost, and it is now paid.** Tauri 2 needs the
MSVC build tools and Rust; a source-built llama.cpp needs CMake plus the same MSVC compiler. The
owner authorised the Rust + MSVC half on 2026-11-07 (checkpoint above). The remaining question is
unchanged: whether the sidecar is built from source or run from an official prebuilt llama.cpp
release binary. The prebuilt path stays the smaller ask and is what §7 recommends — the compiler we
now have makes a source build *possible*, not necessary.

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
commands and subscribe to typed events. The contract is in `PHASE2_IPC_CONTRACT.md`, materialised as
types in `src/contract/` and imported by no screen yet.

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

1. **Prerequisites — DONE 2026-11-07 (§1 checkpoint and M1.1):** Rust toolchain + Windows MSVC build
   tools for Tauri, and the **official prebuilt llama.cpp b12189 CPU x64 archive** — downloaded,
   checksummed, and run weightless into `D:\NEXUS-SIDECAR\b12189\`. Building the engine from source
   stays unnecessary, not impossible; the compiler we now have simply is not needed for this. What is
   still missing is a model file (D-022), which is the last thing between this and a real answer.
2. `src-tauri/` scaffold, `beforeBuildCommand` wired to the existing Vite build, `base: './'` +
   `HashRouter` preserved so nothing in the UI changes.
3. Sidecar supervisor: locate binary, verify version, pick a free port, launch with the token,
   health-probe `/health`, restart on exit, shut down cleanly with the app. **Half of this is now
   measured** (`PHASE2_SIDECAR_SPEC.md` §3/§7): spawn `llama-server.exe` — not `llama.exe`, which can
   `update` itself — bind `127.0.0.1` explicitly, add `--models-max 1 --no-models-autoload` because a
   modelless start is router mode, poll `/health` (answers in ~98 ms with no key, so key it out of any
   security claim), and treat a bad model path as a process exit within 0.11 s rather than an error
   response.
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
