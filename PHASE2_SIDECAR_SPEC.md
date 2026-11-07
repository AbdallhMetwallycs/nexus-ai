# NEXUS AI — Phase 2 llama.cpp Sidecar Specification (M0 draft)

**Doc:** engine acquisition, supervision, and integration contract
**Written:** 2026-11-07 · **Status:** for owner approval · **Runtime decision:** llama.cpp sidecar
**Nothing in this document has been installed or executed.** Two facts below come from published
llama.cpp sources and are cited; everything else is design pending verification on the pinned
release.

---

## 1. Verified external facts (researched 2026-11-07)

| Fact | Source | Confidence |
|---|---|---|
| Latest release at time of writing is **b12189** | [ggml-org/llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases) | verified (page read) |
| Windows assets include `llama-b12189-bin-win-cpu-x64.zip` and `llama-b12189-bin-win-cuda-12.4-x64.zip` | same | verified (page read) |
| Release list also shows **Windows x64 (Vulkan)**, Windows arm64 (CPU), Windows arm64 (OpenCL Adreno) | [releases index](https://github.com/ggml-org/llama.cpp/releases) | verified as listed; exact asset filenames not re-read |
| A current Windows guide uses a **unified `llama` binary** with `serve` / `cli` subcommands: `llama.exe serve -m … --host … --port … -c … -ngl … --no-webui --api-key … -np`, readiness via `GET /health` | [llama.cpp on Windows cheat sheet](https://rizamarhaban.com/cheatsheets/llama-cpp-windows.html) | **single third-party source — must verify** |

That last row is the one that changes our design most, so it is stated as unconfirmed rather than
assumed: if current llama.cpp ships `llama.exe serve` instead of a standalone `llama-server.exe`,
the supervisor's process name, argument vector, and packaging entry all shift. **M1 step 0 is to
download the pinned asset, list its contents, and record the actual binary and `--help` output in
this document before writing a line of supervision code.** The release page as fetched does not
state which binaries the zip contains, so the assumption is not yet supportable.

---

## 2. Acquisition strategy

**Recommended: prebuilt Windows binary, pinned by release tag and checksum.**

| Path | Requirement | Cost | Verdict |
|---|---|---|---|
| Prebuilt `bin-win-cpu-x64` asset | none beyond download authorisation | ~tens of MB | **primary** — works with the toolchain we actually have |
| Build from source | CMake + MSVC + Ninja — available since the 2026-11-07 checkpoint (MSVC 14.51.36231; CMake and Ninja ship inside the VS 2026 instance, not on PATH) | no new install, but our own build and its flag matrix | deferred; only if a flag we need is missing from the prebuilt |
| Ollama as provider | external app dependency | loses control of weights and threading | not chosen (owner decision), kept behind the same provider interface |

Pinning rules: one exact release tag per app version; the SHA-256 of the downloaded archive is
recorded in `DECISION_LOG.md` at install time; the engine never auto-updates. When we do move
versions, it is a deliberate change with a rollback to the previous pinned folder — because a
generation-speed regression in a minor engine update would otherwise look like a NEXUS bug to the
owner.

Download itself is an owner-authorised network operation and goes through the approval queue as
kind `model_download`/engine-equivalent; the offline default means it must be explicitly enabled
first. Nothing in this spec assumes a silent fetch.

---

## 3. Process model

```
core (Rust)                              sidecar
  │  1. pick free ephemeral port P
  │  2. generate token T (32 random bytes, per launch)
  ├─ spawn llama.exe serve --host 127.0.0.1 --port P --api-key T …
  │       3. poll GET /health until ready (bounded, e.g. 90 s for a 4.7 GB load)
  │       4. record pid, port, version in engine_state
  ├─ POST /v1/chat/completions  (Authorization: Bearer T)   → streamed deltas
  ├─ POST /completion           (raw tokens, for fine control)
  │       5. on app exit / cancel: graceful terminate, kill on timeout
  └─ 6. watchdog: unexpected exit → engine.crashed, restart on next request
```

Design points:

- **Bind `127.0.0.1` only, no exceptions, no setting to change it.** The engine is a private
  component of a desktop app, not a LAN service.
- **Token per launch.** `--api-key` exists in the current server, so we use it even on loopback:
  another local process should not be able to drive our model for free. The token lives in memory
  and in `engine_state` only for the session, never in the database or logs.
- **Single loaded model.** The core loads one model at a time and refuses a second until the first
  is unloaded. Two 7B-class models resident on 20 GB alongside Windows is not a configuration worth
  discovering by accident.
- **Embedding runs sequentially, not concurrently.** The likely pattern is: unload chat model →
  load embedding model → run the batch → restore. *Open, decided in M3:* whether a second sidecar
  process holding a small embedding model permanently is affordable — the answer is a measurement,
  and the RAM figures in `PHASE2_DATA_MODEL.md` are what settle it.
- **No web UI.** `--no-webui` per the current flag set; a browser-served console on a loopback port
  is an invitation to confuse ourselves during debugging and a needless surface.
- **Crash containment is the reason for the separate process.** A sidecar death costs one answer,
  not the app, the database, or the UI state.

---

## 4. Argument vector (draft, to be reconciled with `--help` at M1)

```
llama.exe serve
  --model        <path to .gguf>
  --host         127.0.0.1
  --port         <ephemeral, chosen by core>
  --ctx-size     <min(model context, admission cap)>
  --threads      <measured: 4 vs 8, see §6>
  --n-gpu-layers <0 for CPU-only; tuned only after measurement>
  --parallel     1              # one slot; the core's scheduler is the queue
  --api-key      <per-launch token>
  --no-webui
  --mlock?  --no-mmap?          # RAM behaviour on 20 GB: must be measured, not guessed
  --log-disable                 # we capture stdout/stderr ourselves; no prompt content in files
```

`--mlock`/`--no-mmap` is a genuinely open question on this machine: mlock prevents the weights from
being paged to the SMR HDD (good for latency, bad for headroom), while mmap lets Windows page them
out under pressure (bad for latency, keeps the system responsive). The right answer is a measurement
on a 7B Q4 with the desktop busy, and it belongs in the M1 checklist rather than in a config default.

---

## 5. GPU offload: the MX150 question

The reference machine has an NVIDIA MX150 with 4 GB VRAM — Pascal generation, integrated alongside
a 15 W CPU. Realistically:

- A 7B Q4 model is ~4 GB of weights before KV cache, so it does not fit in 4 GB VRAM with context.
- Partial offload (`-ngl`) helps only if the PCIe/memory bottleneck isn't dominant, and on a 15 W
  laptop the thermal envelope is usually the real limit.
- The CUDA 12.4 asset targets a toolkit version whose support for Pascal needs checking before we
  depend on it; the Vulkan asset is the more likely way to use this GPU at all.

**Decision for M1: CPU-only baseline, measured first.** GPU offload becomes an experiment after we
know the CPU tokens/sec, with the Vulkan build tried in a separate folder so the primary path stays
clean. Any claim about speedup here before measurement would be fiction, and the Model Manager's
`gpuRecommended` flag should stay an estimate until we have numbers from this exact hardware.

---

## 6. M1 measurement checklist (the numbers we currently estimate)

Recorded as raw output in `MEASUREMENTS.md`, not summarised:

1. Cold start to `/health` ready, at 3B and 7B Q4.
2. Peak RSS after load vs the catalog's `ramGB` estimate — the correction that makes future fit
   badges measured rather than estimated.
3. Tokens/sec: first token, and sustained over 60 s and over 5 min (thermal throttle behaviour).
4. `--threads` 4 vs 8, same prompt, interleaved runs to avoid ordering bias.
5. Context growth cost: 2k / 8k / 32k on RAM and speed.
6. Cancel latency: time from `chat.stop` to the sidecar actually being idle.
7. Crash restart: kill the process mid-generation, measure recovery and what the UI showed.
8. Concurrent indexing: embedding batch while a chat runs — does chat throughput collapse?
9. Disk: whether model load from the SSD versus the SMR HDD changes cold start materially.

Item 3 and 8 are the two that decide whether the product premise works on this laptop. Everything
else is optimisation.

---

## 7. Failure handling (mirrors `ARCHITECTURE.md` §8)

| Condition | Detection | Core action | UI result |
|---|---|---|---|
| Binary missing | spawn failure | `engine.not_installed`, no retry storm | Model Manager: engine-not-installed with expected path |
| Wrong version | `--version` mismatch with pin | refuse to start, keep old binary | Settings → About: engine version + mismatch detail |
| Startup timeout | `/health` not ready in budget | terminate, mark failed, allow one retry | Chat: "model did not become ready" with the log tail |
| Mid-generation crash | process exit / connection drop | mark job failed, restart lazily | Chat: partial answer marked incomplete; Activity error row |
| Port collision | bind failure | pick another port, retry once | none visible (internal), logged |
| OOM kill | exit code + Windows event | unload model, set admission floor lower for the session | Model Manager: model unloaded with reason |
| Orphan process | pid from a previous session alive | kill on next launch | none, logged |

The orphan case is worth stating explicitly because it is the classic sidecar bug: a crash that
leaves `llama.exe` holding 5 GB of RAM with no owner. The core records the pid and start time in
`engine_state` and cleans up at launch.

---

## 8. Packaging

Declared as a Tauri external binary and placed in a versioned subfolder of the app directory, not
in `%APPDATA%` — the binary is program, weights are data. The sidecar folder layout:

```
sidecar\
  b12189\           llama.exe (+ DLLs)
  active.txt        which pinned version the core should launch
```

Keeping pinned versions side by side is what makes an engine rollback a one-file change instead of a
reinstall, and it is the reason the checksum record in `DECISION_LOG.md` matters.

---

## 9. What must be true before M1 code is written

1. Owner authorises the download of the pinned prebuilt archive (and states whether the CPU or
   Vulkan build is the starting point; recommendation is CPU).
2. The archive's actual contents and `--help` are recorded here, replacing the unverified unified-
   binary assumption from §1.
3. ~~Rust + MSVC build tools installed for Tauri — a separate authorisation, since it is a system
   install.~~ **Satisfied 2026-11-07.** The owner authorised exactly this install; Rust 1.99.1 and
   MSVC 14.51.36231 with Windows SDK 10.0.26100.0 are in place and verified by a cargo link and an
   `cl` compile against `<windows.h>` (`ARCHITECTURE.md` §1 checkpoint, `DECISION_LOG.md` D-028).
   The installer flagged that a reboot is required; nothing observed so far depends on one, but the
   next session should start with it.
4. A weights folder path chosen by the owner (no download implied).

Items 1 and 4 are still unauthorised downloads, and item 2 can only be completed after item 1. Item 3
is done, and its checkpoint deliberately stopped there: no llama.cpp archive was downloaded, no
`src-tauri/` scaffold was created, and no crate was fetched from crates.io, because the owner scoped
the authorisation to "verify and document, then stop".

---

## 10. Sources consulted

- [llama.cpp releases (ggml-org)](https://github.com/ggml-org/llama.cpp/releases) — release tag and
  Windows asset names.
- [llama.cpp on Windows cheat sheet (Riza Marhaban)](https://rizamarhaban.com/cheatsheets/llama-cpp-windows.html) —
  `llama serve` flag set and `/health` readiness; third-party, marked for verification.
