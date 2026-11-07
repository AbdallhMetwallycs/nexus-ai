# NEXUS AI — Phase 2 llama.cpp Sidecar Specification

**Doc:** engine acquisition, supervision, and integration contract
**Written:** 2026-11-07 · **Runtime decision:** llama.cpp sidecar
**Status update:** measured end to end on 2026-11-07. §1 is the weightless engine run (M1.1); §1.4 and §6
are the checkpoint-4 runs **with real weights** — the owner lifted D-022 for exactly one model file and
the raw outputs are in `MEASUREMENTS.md`. Two design positions were corrected by that evidence rather
than by preference: the engine is spawned single-instance with `-m` (§3, §4), and there is no HTTP
unload or shutdown route to supervise (§1.4, §7). §2, §5 and §8 remain design.

---

## 1. Measured facts (engine acquisition checkpoint, 2026-11-07)

This section replaced the M0 draft, which was research from web pages. Everything below was read off
the downloaded artefact or off the running process. The download and the weightless run were the two
things the owner authorised; no model file exists on this machine, so this remains a *no-weights*
record (D-022 holds).

| Fact | Value | How it was measured |
|---|---|---|
| Pinned tag | **b12189** — newest binary release at download time, published 2026-11-07T12:15:59Z | releases API (`/releases?per_page=8`) |
| Commit | `80d2c0c2c56e4a1bbf74be98f64b99927bf230bc` | API `target_commitish`, confirmed by `--version` |
| Asset | `llama-b12189-bin-win-cpu-x64.zip`, 24,749,596 bytes | API size vs downloaded bytes: exact match |
| SHA-256 | `f912ea5e3e397c63405c81e732131ab0fa6e72411c80546bb5ad643f7dd82aac` | computed locally after download |
| MD5 | `22180d8ed4f1241ffcff1a7b5e93955c` | computed locally |
| Install path | `D:\NEXUS-SIDECAR\b12189\` — **outside the repo**, 61 MB extracted, 52 files (29 DLLs, 22 exes, 1 license file) | `tar -xf` then `du`/`find` |
| Build string | `version: 0.9.0-dev (build 12189, commit 80d2c0c2c)`, `built with Clang 20.1.8 for Windows x86_64` | `llama-server.exe --version` |

**Provenance caveat, stated plainly:** GitHub returned no digest for these assets (the API's
`digests` field is absent for all 38), so the SHA-256 above is *our own baseline*, not an upstream
signature. It proves a later download is the same bytes and makes drift visible; it does not prove
the publisher's intent. HTTPS plus the exact asset name is the whole chain of trust until we add a
signature check, and that gap belongs in the risk list, not in a footnote we skip.

### 1.1 What the zip actually contains

- **Both** a unified `llama.exe` (105,472 B) and a standalone `llama-server.exe` (9,728 B) ship. The
  M0 question — "if current llama.cpp ships `llama.exe serve` *instead of* a standalone
  `llama-server.exe`" — resolves to *both*, so nothing in the design had to move.
- Every `llama-*.exe` is a ~9.7 KB stub that loads a sibling `-impl.dll`; the real server is
  `llama-server-impl.dll` (10,124,800 B). Packaging must therefore treat the **whole folder** as the
  unit, never a single exe.
- 14 `ggml-cpu-*.dll` backends (`sandybridge`, `haswell`, `ivybridge`, `sse42`, `x64`, `zen4`,
  `cascadelake`, `cooperlake`, `icelake`, `skylakex`, `cannonlake`, `sapphirerapids`, `alderlake`,
  `piledriver`). The i5-8250U is Kaby Lake and has **no dedicated build**, so it should resolve to
  the AVX2 `haswell` path — *should*, unverified: M1 must capture which DLL actually loads.
- Also present: `ggml.dll`, `ggml-base.dll`, `llama.dll`, `llama-common.dll`, `mtmd.dll`,
  `libomp.dll` (+ `LICENSE-LLVM-OpenMP`), `ggml-rpc-server.exe`, and tools we do not use
  (`llama-quantize`, `llama-imatrix`, `llama-perplexity`, `llama-tts`, `llama-connect`, …).
- **No** `ui/` folder and no Python converters. The web UI is a separate `llama-b12189-ui.tar.gz`
  asset, so `--no-ui` is not hygiene — it disables a UI that this zip cannot serve anyway.

`llama.exe help all` lists: `serve · cli · update · download · completion · bench · batched-bench ·
fit-params · quantize · perplexity · version · licenses · help`. **Two of those are network commands,
and `update` replaces the binary on disk.** Our supervisor must never invoke either, and the offline
invariant cannot rely on the engine's own restraint — see `PHASE2_POLICY_MODEL.md` §6 invariant 1.

### 1.2 What the earlier research got right, and what it got wrong

Right, now verified on the artefact: the release tag and asset names, `GET /health` as the readiness
endpoint, `--api-key`, `-np`, and the general `serve` shape.

Wrong or stale, and corrected here:
- `--no-webui` still parses but the binary calls it **deprecated**: `Use --ui/--no-ui (or deprecated
  --webui/--no-webui)`. Use `--no-ui`.
- **`--mlock` and `--no-mmap` do not exist in b12189.** They are replaced by one enum flag,
  `-lm, --load-mode {auto|none|mmap|mlock|mmap+mlock|dio}` (default `auto` = mmap unless a device
  cannot). §4's open question is now a measurement with four arms, not a boolean.
- New to us, and relevant on 20 GB: `-lzm, --lazy-mode` (on-demand tensor reads, requires mmap) and
  `--models-memory-margin N` (MiB to keep free, unloads LRU models until a new one fits).

### 1.3 What a weightless engine does (the D-022-compliant part of M1)

Run with a bogus path — `llama-server.exe -m Z:/definitely-absent.gguf …`: exits **code 1 after
~0.11 s**, last log line `exiting due to model loading error`. So there is no "process up, model
failed" state: **a load failure is a process exit**, and the supervisor's restart logic is the load
retry path.

Run with no `-m` at all — this is the engine-warm, model-unloaded state NEXUS needs:

```
0.00.073.990 I srv  server_run_r: starting server in router mode. models will be automatically loaded on-demand
0.00.079.389 W srv  server_setup: security: router mode enabled - do not expose to untrusted environments
0.00.097.793 I srv  server_on_li: listening on http://127.0.0.1:18169
```

- Socket up at **+98 ms**, so warm start without weights is essentially free; idle footprint measured
  as **12.4 MB working set**, 4.9 MB private, 4.2 GB virtual reserved, 15 threads.
- `GET /health` → `{"status":"ok"}` **with no API key** — readiness is unauthenticated even when
  `--api-key` is set. Any local process can see that the engine is alive. Loopback-only keeps this a
  disclosure rather than an access risk; it still gets recorded.
- `GET /v1/models` → **401** `Invalid API Key` without bearer, `{"data":[]}` with it.
- `GET /props` (with key) → `role: "router"`, `max_instances: 4`, `models_autoload: true`,
  `model_path: "none"`, `build_info: "b12189-80d2c0c2c"`, `cors_proxy_enabled: false`.
- `POST /v1/chat/completions` (with key) → **400** `model name is missing from the request`: the
  `model` field is mandatory even with exactly one model, so the inference client always sends it.
- `POST /models/load` (with key) → **404 File Not Found** for a missing path. At the time this was read
  as "the route exists"; with a real file to load it turned out to be **a route that does not exist at
  all** — see §1.4. `POST /models/unload` → 400 *model is not found*, likewise misread; `/slots` → 400
  (needs a model); `/metrics` → 401 without a key, and 501 without `--metrics`.
- `netstat` for the PID: **0 non-loopback sockets**, and the default bind is `127.0.0.1` even when
  `--host` is omitted. The offline default held during this run.

Everything that actually costs money — tokens/sec, RSS with weights, cancel latency, mmap-vs-mlock,
cold start at 3B/7B — is **still unmeasured**, because measuring it requires a model file we were not
authorised to download. That is a real limit on this checkpoint, not a pause: §6's list stays open.

### 1.4 What the HTTP surface is when weights are available (checkpoint 4, corrected)

`MEASUREMENTS.md` §10 carries the raw probe output. The short version, because it changed the design:

- `POST /models {"model": "D:\\NEXUS-MODELS\\…gguf"}` on a router-mode server → **400**
  `invalid HF repo format, expected <user>/<model>[:quant]`. The router parses the field as a
  Hugging Face repo id. **There is no local-path load in router mode**, and adding a model to the
  pool means fetching it from the network — the thing D-022 forbids and `--offline` blocks. The
  M1.1 reading of the earlier 404 ("the route exists") was wrong: `POST /models/load` is not a route
  at all.
- With a model loaded single-instance, **no unload and no shutdown route exist**: `POST /unload_model`,
  `POST /models/unload`, `DELETE /models/<path>`, `POST /shutdown` all answer 404. `engine.unloadModel`
  therefore means *kill the process*, and app-exit shutdown means *terminate*, not *ask politely*.
- Live routes, verified together: `/health` (200, unauthenticated), `/props`, `/slots`, `/v1/models`,
  `/v1/chat/completions`, `/completion`, `/metrics` — the last only when `--metrics` is in the argv;
  without it the server answers **501** `This server does not support metrics endpoint`.
- `/v1/models` echoes the model's **absolute filesystem path** as its `name`. Treat it as machine-local
  user data: do not render it in the UI, do not log it into an activity row.
- `--offline` (help line 215, `LLAMA_ARG_OFFLINE`: "forces use of cache, prevents network access") is
  accepted by `llama-server.exe` and is now in the vector, alongside the structural argument that we
  never spawn the unified `llama.exe` where `update` and `download` live.

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
  │  1. validate the model path (the registry + admission gate already chose it)
  │  2. pick free ephemeral port P
  │  3. generate token T (32 random bytes, per launch)
  ├─ spawn llama-server.exe -m <path> --host 127.0.0.1 --port P --api-key T --no-ui
  │       --offline --metrics --flash-attn on --ctx-size C --threads N --n-gpu-layers 0
  │       --parallel 1 --load-mode auto …
  │       4. poll GET /health until the socket answers {"status":"ok"}
  │          — that answer is the model being resident: measured 6–10 s warm, ~38 s cold
  │       5. record pid, port, version in engine_state
  ├─ POST /v1/chat/completions  (Authorization: Bearer T, "model" always sent) → streamed deltas
  ├─ POST /completion           (raw tokens, for fine control)
  │       6. on stop-request: abort the fetch; the engine keeps going for up to ~1.7 s (measured)
  │       7. on app exit / model switch: terminate the process (there is no unload route, §1.4)
  └─ 8. watchdog: unexpected exit → engine.crashed, restart on next request
```

Three changes came out of the measurements, not out of preference.

**The supervisor spawns `llama-server.exe`, not `llama.exe`.** Both exist and reach the same
10 MB `llama-server-impl.dll`, and `--help` is byte-identical (753 lines, one blank line apart).
But the unified binary also exposes `update` — which replaces the engine on disk — and `download`,
which reaches the network. Choosing the standalone exe removes those from the attack and accident
surface entirely, so "the engine never auto-updates" becomes a property of the binary we run rather
than a rule our code remembers.

**A weightless start is router mode, and router mode turns out not to be usable — so we do not start
weightless.** With no `-m`, b12189 logs `starting server in router mode` and its own warning
`security: router mode enabled - do not expose to untrusted environments`, with `max_instances: 4` and
`models_autoload: true`. The M1.1 checkpoint pinned those down (`--models-max 1 --no-models-autoload`)
and read the 404 from `POST /models/load` as a live route. With a real weights file the same probe
returns 400 `invalid HF repo format, expected <user>/<model>[:quant]` — see §1.4. Router mode cannot
load a local file over HTTP at all, and the only way it can acquire a model is a network fetch, which
D-022 and `--offline` forbid. So the engine is spawned **single-instance with `-m`**, the admission
check moves before the spawn (step 1 above), and `--models-max`/`--no-models-autoload` are no longer
part of the vector.

Design points:

- **Bind `127.0.0.1` only, no exceptions, no setting to change it.** The engine is a private
  component of a desktop app, not a LAN service. Measured: the default bind is already `127.0.0.1`
  with `--host` omitted, and the idle process opened zero non-loopback sockets — we still pass
  `--host` explicitly, because a default is something an upgrade can change.
- **Token per launch.** `--api-key` exists and works: `/v1/models` returned 401 without the bearer
  and `[]` with it. One measured exception — **`/health` answers with no key even when `--api-key`
  is set**, so any local process can tell that the engine is up. On loopback that is a disclosure,
  not an access path; it is recorded rather than papered over, and readiness polling stays the only
  thing we rely on it for.
- **CORS is open by default.** `--cors-origins` defaults to `*` with `--cors-credentials` enabled,
  which means a browser page could aim requests at our loopback port. The key blocks real use, and
  a random per-launch port makes the address unguessable, but M1 should still pass an explicit
  `--cors-origins` rather than inherit it. Flagged, not yet decided.
- **Single loaded model, enforced by the process itself.** One spawn, one `-m`, one resident model: with
  single-instance mode the constraint is structural rather than a flag. Two 7B-class models resident
  alongside Windows is not a configuration worth discovering by accident. Switching models means
  terminate-and-respawn (§1.4), which costs the full §3 cold/warm start again — that is now a UX fact,
  not an implementation detail.
- **Load failure looks like a crash, because it is one.** `-m <missing file>` exits code 1 in
  ~0.11 s with `exiting due to model loading error` and never reaches a listening socket. So the
  supervisor's model-error path is "process gone", and the registry must validate the path before
  the spawn, not after.
- **Embedding runs sequentially, not concurrently.** The likely pattern is: unload chat model →
  load embedding model → run the batch → restore. *Open, decided in M3:* whether a second sidecar
  process holding a small embedding model permanently is affordable — the answer is a measurement,
  and the RAM figures in `PHASE2_DATA_MODEL.md` are what settle it.
- **No web UI.** `--no-ui` (`--no-webui` is deprecated but still parses). This zip carries no `ui`
  folder at all — it is a separate release asset — so there is nothing to serve anyway.
- **The folder is the unit of packaging, not the exe.** 22 stubs and 29 DLLs; the server needs
  `llama-server-impl.dll` plus the ggml backend set it picks at runtime.
- **Crash containment is the reason for the separate process.** A sidecar death costs one answer,
  not the app, the database, or the UI state.

---

## 4. Argument vector (reconciled against the real `--help`, 2026-11-07)

```
llama-server.exe
  -m             <validated path>       # single-instance: the model arrives with the process (§1.4)
  --host         127.0.0.1
  --port         <ephemeral, chosen by core>
  --api-key      <per-launch token>
  --no-ui                     # was --no-webui: still parses, now deprecated
  --offline                   # help 215: prevents network access; the belt to spawn-only-llama-server's braces
  --metrics                   # without it /metrics is 501, and engine.metrics has nothing to read
  --ctx-size     <min(model context, admission cap)>   # -c; 0 = take it from the model — never use 0
  --threads      <physical cores, not logical>         # -t, generation threads; measured §6
  --threads-batch <same unless measured otherwise>     # -tb, exists separately
  --flash-attn   on                                  # -fa {on|off|auto}; at t=8 off costs 2.7× prefill
  --n-gpu-layers 0            # -ngl; accepts a number, 'auto', or 'all' (default auto!)
  --parallel     1            # -np: server SLOTS, not CPU threads — do not confuse the two
  --load-mode    auto         # -lm {auto|none|mmap|mlock|mmap+mlock|dio}; auto = mmap, measured §6
  --log-disable              # we capture stdout/stderr ourselves; no prompt content in files
```

`-c 0` is the one flag in this table that can damage the machine: this file advertises
`llama.context_length = 131072`, so "load from model" asks for a 128k KV cache ≈ **14.5 GB** by the
measured slope of 0.1106 MB/token (`MEASUREMENTS.md` §4) on a box with 6.4 GB free. The admission
check must never pass `0`, and the registry's default context must be a number we chose, not the
model's.

Corrections this replaced, each one a flag the M0 draft assumed:

- `--model` **is** in the spawn vector — the M1.1 draft deliberately left it out so a model could
  arrive later by HTTP. §1.4 closed that route: the router only accepts HF repo ids, so a local file
  can only be loaded at spawn. The admission check moves earlier, from "before the load call" to
  "before the spawn".
- `--models-max 1` and `--no-models-autoload` are **gone**. They were pins on a router mode we no longer
  enter; single-instance spawn enforces the same property structurally.
- `--mlock` and `--no-mmap` **do not exist**; `-lm/--load-mode` is one enum with six values. Four arms
  were measured (`MEASUREMENTS.md` §5): `mmap`/`auto` keeps the 1.9 GB of weights as reclaimable file
  pages (1,722 MB private), `none` and `mlock` commit them as ours (2,338 MB private). On this machine
  `auto` is the default, and `mlock` is an opt-in for latency that costs 600 MB of headroom.
- `--n-gpu-layers` **defaults to `auto`, not 0** — a CPU-only baseline has to say `0` out loud,
  otherwise an MX150 that happens to enumerate could take layers nobody approved.
- `--parallel` (`-np`) is server slots; CPU width is `--threads`/`--threads-batch`. Measured: 8 logical
  threads cost 26% of decode throughput against 4 physical ones, so "threads" must come from a physical
  core count, not `hardware_concurrency`.
- Added after measurement: `--offline`, `--metrics`, `--flash-attn on`.

---

## 5. GPU offload: the MX150 question

The reference machine has an NVIDIA MX150 with 4 GB VRAM — Pascal generation, integrated alongside
a 15 W CPU. Realistically:

- A 7B Q4 model is ~4 GB of weights before KV cache, so it does not fit in 4 GB VRAM with context.
- Partial offload (`-ngl`) helps only if the PCIe/memory bottleneck isn't dominant, and on a 15 W
  laptop the thermal envelope is usually the real limit.
- The CUDA 12.4 asset targets a toolkit version whose support for Pascal needs checking before we
  depend on it; the Vulkan asset is the more likely way to use this GPU at all.

**Decision for M1: CPU-only baseline, measured first.** That measurement happened on 2026-11-07
(`MEASUREMENTS.md` §6–§7): **4.93 t/s sustained decode, ~19 t/s prefill** at 4 threads on this CPU.
GPU offload is now an experiment against a number rather than an abstraction — anything that cannot
beat 4.9 t/s decode is not worth the packaging cost, and the Vulkan build should be tried in a separate
folder so the primary path stays clean. The Model Manager's `gpuRecommended` flag should stay an
estimate until we have numbers from this exact GPU.

Two measured supports for that decision from the download itself: the CPU x64 zip contains **no GPU
backend DLL at all** — every `ggml-*` in it is a CPU instruction-set build or RPC, with no
`ggml-vulkan`/`ggml-cuda` (the Vulkan runtime lives in a separate 37.7 MB asset),
and `--n-gpu-layers` **defaults to `auto`, not 0**, so a CPU-only baseline has to state `0` explicitly
or the engine will take layers from any GPU it can enumerate. The Vulkan asset is the one to try with
the MX150; the CUDA 12.4 asset is 288 MB and targets Pascal support we have not checked.

---

## 6. M1 measurement checklist (closed 2026-11-07, checkpoint 4)

Recorded as raw output in `MEASUREMENTS.md`, not summarised. That file is the evidence; this table is
the index — what was asked, what answered.

Weightless numbers, from M1.1, still true and still the floor the admission model charges:

- **Warm start with no model: socket listening at +98 ms**, `/health` answering `{"status":"ok"}`
  inside the same tenth of a second. Two runs agreed to within ~13 ms.
- **Idle sidecar footprint: 12.4 MB working set**, 4.9 MB private, 15 threads, 4.2 GB virtual
  reserved.
- **Load failure costs 0.11 s and exits code 1** — no socket, no half-alive process.
- **Zero non-loopback sockets** while the engine sat up, and the default bind was `127.0.0.1`.

Measured now, with `Llama-3.2-3B-Instruct-Q4_K_M.gguf` (2,019,377,440 B, digest verified upstream),
CPU-only, this laptop, 6.4 GB RAM free at the time:

| # | Question | Answer | Where |
|---|---|---|---|
| 1 | Cold start to ready with weights | **~38 s cold, 6–10 s warm** (file cache on the SMR HDD) | `MEASUREMENTS.md` §3 |
| 2 | Peak RAM after load vs the estimate | **1,722 MB private at ctx 2k**; the catalog estimate for this model was 2.0 GB | §4 |
| 3 | Tokens/sec, first token, sustained | decode **4.6–5.9 t/s** (short tails) → **4.93 t/s over 176 s**; TTFT **3.6 s** on 80 tokens, **36.6 s on 710** | §6, §7 |
| 4 | `--threads` 4 vs 8 | **4 wins decode (4.38 vs 3.24 t/s), 8 wins prefill (21.3 vs 16.8)**; 8 is not "more cores", it is SMT | §6 |
| 5 | Context cost 2k/8k/32k | **0.1106 MB per token** (theory 0.1094, 1% off), intercept ~1,495 MB; 32k = 5,120 MB private | §4 |
| 6 | Cancel latency | **1,744 ms** abort → engine idle (231 ms in another arm; batch-bound) | §8 |
| 7 | Crash mid-generation, recovery | SIGKILL → 0 orphans, file untouched, respawn ready in **6,080 ms**, answers normally | §8 |
| 10 | `-lm/--load-mode` arms | mmap/auto = 1,722 MB private + reclaimable file pages; none/mlock = **2,338 MB committed**. Order-confounded on time, not on RAM | §5 |

Still open after this checkpoint, in priority order:

8. Concurrent indexing: embedding batch while a chat runs — does chat throughput collapse? Needs a
   second model file, so needs a fresh authorisation.
9. SSD-versus-HDD cold start, isolated. The two numbers in row 1 differ by cache state, not by disk,
   and separating them needs either elevation (drop the standby list) or the same file copied to C:.
11. Prompt-cache reuse across turns: every measured run reported `cached_tokens: 0` because each was
    the first request. **This is now the most valuable unmeasured number in the project** — row 3's
    36.6 s TTFT is only survivable if a follow-up turn reuses the cache.
12. Which `ggml-cpu-*.dll` the loader picks at runtime (expected haswell; the line was not captured).
13. Sustained 5- and 10-minute generation. Three minutes showed a 12% decline, which may be the
    beginning of a slope or the whole of it.

Item 3 and item 11 are the two that decide whether the product premise works on this laptop, and both
now have a first answer: the premise **survives** at 4.9 t/s for short-context chat, and it is
**threatened** by prefill, not by decode. `MEASUREMENTS.md` §11 states the verdict with its
qualifications.

---

## 7. Failure handling (mirrors `ARCHITECTURE.md` §8)

| Condition | Detection | Core action | UI result |
|---|---|---|---|
| Binary missing | spawn failure | `engine.not_installed`, no retry storm | Model Manager: engine-not-installed with expected path |
| Wrong version | `--version` mismatch with pin | refuse to start, keep old binary | Settings → About: engine version + mismatch detail |
| Startup timeout | `/health` not ready in budget | terminate, mark failed, allow one retry | Chat: "model did not become ready" with the log tail |
| Mid-generation crash | process exit / connection drop | mark job failed, restart lazily | Chat: partial answer marked incomplete; Activity error row |
| Port collision | bind failure | pick another port, retry once | none visible (internal), logged |
| OOM kill | exit code + Windows event | terminate and respawn at a lower context, then set the session admission floor lower | Model Manager: model unloaded with reason |
| Orphan process | pid from a previous session alive | kill on next launch | none, logged |

Two rows changed after checkpoint 4. **The OOM row can no longer say "unload model"**, because there is
no unload route in b12189 (§1.4): releasing the weights means ending the process, so the UI must expect
the full 6–38 s start cost (§3, §6 row 1) on the other side of every "unloaded" state. And **the startup
budget is now a measured number, not a guess**: `/health` was ready at 6.0–10.0 s with a warm file cache
and 38.0 s cold, so a 30 s budget would have failed a legitimate cold start — the budget needs to be at
least 90 s for the first load of a session, with the UI showing which phase it is in.

The orphan case is worth stating explicitly because it is the classic sidecar bug: a crash that
leaves `llama-server.exe` holding 5 GB of RAM with no owner. The core records the pid and start time
in `engine_state` and cleans up at launch. Measured support for the design: both probe runs were
killed with `taskkill /F` and left no listener and no process behind, so the kill path is clean on
this engine build; the orphan case is about a *crashed* previous session, not this one.

---

## 8. Packaging

Declared as a Tauri external binary and placed in a versioned subfolder of the app directory, not
in `%APPDATA%` — the binary is program, weights are data. The sidecar folder layout:

```
sidecar\
  b12189\           llama-server.exe + 29 DLLs (+ the other 21 stubs the zip ships)
  active.txt        which pinned version the core should launch
```

Keeping pinned versions side by side is what makes an engine rollback a one-file change instead of a
reinstall, and it is the reason the checksum record in `DECISION_LOG.md` matters. The dev copy on this
machine is `D:\NEXUS-SIDECAR\b12189\` (61 MB), deliberately outside `D:\NEXUS-AI` so a git checkout
never carries a third-party binary; the zip stays beside it as the checksum reference. The whole
folder ships — the 9.7 KB exe is meaningless without its `-impl.dll`.

---

## 9. What must be true before M1 code is written

1. ~~Owner authorises the download of the pinned prebuilt archive~~ **Done 2026-11-07** — the owner
   authorised exactly this and the CPU build was the starting point, as recommended here. Vulkan stays
   a separate folder and a later experiment (§5).
2. ~~The archive's actual contents and `--help` are recorded here~~ **Done 2026-11-07**: §1 records
   the contents and the flag reconciliation; the full 753-line help is kept outside the repo at
   `C:\Users\BS\nexus-toolchain\serve-help-b12189.txt`.
3. ~~Rust + MSVC build tools installed for Tauri — a separate authorisation, since it is a system
   install.~~ **Satisfied 2026-11-07.** The owner authorised exactly this install; Rust 1.99.1 and
   MSVC 14.51.36231 with Windows SDK 10.0.26100.0 are in place and verified by a cargo link and an
   `cl` compile against `<windows.h>` (`ARCHITECTURE.md` §1 checkpoint, `DECISION_LOG.md` D-028).
   The installer flagged that a reboot is required; nothing observed so far depends on one, but the
   next session should start with it.
4. ~~A weights folder path chosen by the owner~~ **Done 2026-11-07** — the owner authorised exactly one
   model file and chose `D:\NEXUS-MODELS\`. `Llama-3.2-3B-Instruct-Q4_K_M.gguf` is there, verified to
   the publisher's digest, and is what §6's numbers were measured with.

Items 1–4 are done. What remains unauthorised is `src-tauri/` and the first crates.io fetch — neither
happened here. The engine has now been run with real weights, so the §6 numbers are inference
measurements on this hardware, but no NEXUS app code has executed any of them yet: the harness that
produced them is a scratch Node script outside the repository.

---

## 10. Sources consulted

- **The artefact itself** (primary, and what §1 now rests on):
  `llama-b12189-bin-win-cpu-x64.zip`, sha256 `f912ea5e…82aac`, extracted to `D:\NEXUS-SIDECAR\b12189\`,
  read via `--version`, `--help` (753 lines, saved to
  `C:\Users\BS\nexus-toolchain\serve-help-b12189.txt`), `llama.exe help all`, folder listing, and two
  live weightless runs whose HTTP and `netstat` output is quoted above.
- **The weights file** (primary for §6): `D:\NEXUS-MODELS\Llama-3.2-3B-Instruct-Q4_K_M.gguf`, 2,019,377,440
  bytes, sha256 `e4f1a04d…210d9a` matched against the publisher's `lfs.oid`, read with
  `llama-bench.exe -o json` and with the harness `C:\Users\BS\nexus-toolchain\srv1.mjs`; all raw run
  output under `C:\Users\BS\nexus-toolchain\runs\`, transcribed into `MEASUREMENTS.md`.
- [Hugging Face model tree API](https://huggingface.co/lmstudio-community/Llama-3.2-3B-Instruct-GGUF) —
  used to obtain the digest and byte size that the GitHub release assets do not publish.
- [llama.cpp releases API (ggml-org)](https://api.github.com/repos/ggml-org/llama.cpp/releases) —
  tag list, publish times, asset names and sizes; used to pin b12189 and confirm it was newest.
  Note it exposed no asset digests, which is why §1 states the provenance caveat.
- [llama.cpp releases page](https://github.com/ggml-org/llama.cpp/releases) — the M0 research pass.
- [llama.cpp on Windows cheat sheet (Riza Marhaban)](https://rizamarhaban.com/cheatsheets/llama-cpp-windows.html) —
  the third-party source that prompted the unified-binary question. Its `/health` readiness and
  `serve` shape checked out; `--no-webui` is now deprecated and `--mlock`/`--no-mmap` do not exist, so
  it is superseded by the artefact above and kept only as history.
