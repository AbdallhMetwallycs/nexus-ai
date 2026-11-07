# MEASUREMENTS — M1 with real weights

Recorded 2026-11-07, on the owner's Lenovo IdeaPad 320 (i5-8250U, 20 GB RAM, SSD C: + SMR HDD D:).
This is the checkpoint-4 record that `PHASE2_SIDECAR_SPEC.md` §6 asked for: raw command output first,
interpretation last. Everything here was executed on this machine; nothing is imported from a
benchmark table or a blog post.

Label used throughout: **[verified]** = a command was run and its output is pasted below.
**[estimated]** = arithmetic on verified numbers. **[unverified]** = asserted but not proven here.

Instrument: `C:\Users\BS\nexus-toolchain\srv1.mjs` (single-instance sidecar harness, JSONL events),
`C:\Users\BS\nexus-toolchain\route-probe.mjs`, `C:\Users\BS\nexus-toolchain\admin-probe.mjs`,
`C:\Users\BS\nexus-toolchain\mem-probe.ps1` (Win32_PerfFormattedData_PerfProc_Process),
`llama-bench.exe` from the pinned archive. Raw artefacts: `C:\Users\BS\nexus-toolchain\runs\*.{jsonl,log,txt}`.

---

## 1. The weights file — [verified]

Authorised by the owner as §9 item 4, which lifts D-022 for exactly one model.

```
$ ls -la /d/NEXUS-MODELS/
-rw-r--r-- 1 BS 197609 2019377440 Nov  7 19:26 Llama-3.2-3B-Instruct-Q4_K_M.gguf

$ sha256sum /d/NEXUS-MODELS/Llama-3.2-3B-Instruct-Q4_K_M.gguf
e4f1a04d927b09ec18eb2f233d85ecd760fc2d35cec97e37f8604d3632210d9a  */d/NEXUS-MODELS/Llama-3.2-3B-Instruct-Q4_K_M.gguf
real    0m24.705s
```

Upstream (Hugging Face `lmstudio-community/Llama-3.2-3B-Instruct-GGUF`, `/api/models/…/tree/main?blobs=true`)
published `lfs.oid` = `e4f1a04d…210d9a` and size `2019377440` for this file. **Both match.** This is the
first NEXUS artefact whose digest was verified against an independent publisher rather than against our
own computation — the asymmetry recorded in `PHASE2_SIDECAR_SPEC.md` §10 (GitHub release assets ship no
digests; HF does).

Side observation from the same command: hashing read 1.88 GB off the HDD in 24.7 s ≈ **77 MB/s**
**[verified]** — the throughput the model loader competes with on a cold cache.

## 2. GGUF metadata for the model registry — [verified]

```
$ node gguf-meta.mjs /d/NEXUS-MODELS/Llama-3.2-3B-Instruct-Q4_K_M.gguf
{
 "bytes": 2019377440, "magic": "GGUF", "version": 3, "nTensor": 255, "nKV": 31,
 "general.name": "Llama 3.2 3B Instruct", "general.type": "model",
 "general.architecture": "llama", "general.file_type": 15, "general.license": "llama3.2",
 "llama.context_length": 131072, "llama.block_count": 28, "llama.embedding_length": 3072,
 "llama.attention.head_count": 24, "llama.attention.head_count_kv": 8,
 "llama.rope.freq_base": 500000, "llama.vocab_size": 128256,
 "tokenizer.ggml.model": "gpt2", "tokenizer.ggml.pre": "llama-bpe",
 "tokenizer.ggml.eos_token_id": 128009,
 "tokenizer.chat_template": "…(3827 chars)"
}
```

Independent cross-check from the engine's own loader (`llama-bench -o json`):
`model_type: "llama 3B Q4_K - Medium"`, `model_size: 1918.4 MB`, `n_params: 3212749888`,
`cpu_info: "Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz"`, `backends: "CPU"`, `build: b12189 / 80d2c0c2c`.
So `general.file_type: 15` ↔ `Q4_K_M` in the filename ↔ `Q4_K - Medium` from the loader: the registry's
quant label can be derived from metadata alone, no filename parsing required — `ARCHITECTURE.md` §7 step 4
is satisfiable. **[verified]**

Two fields that are design inputs, not decoration:

- `llama.context_length = 131072`. The model **advertises 128k**. Combined with the server default
  `-c 0` (= "load from model", `server-help-b12189.txt` line 25), an unset `--ctx-size` would ask for a
  128k KV cache on a machine with 6.4 GB free. The spec must pin `--ctx-size` explicitly, always.
- `head_count_kv = 8` against `head_count = 24`: grouped-query attention, which is why the KV cache per
  token is as small as §4 measures it to be.

Parser note (why it matters for the registry code): the first attempt read a 4 MB window and died with
`ERR_OUT_OF_RANGE` at offset 4,194,312 — `tokenizer.ggml.tokens` alone is a 128,256-element string array
**[verified]**. A metadata reader sized to "a few KB" is wrong for Llama-family GGUFs; the block here is
~4 MB. The window is now 128 MB with an explicit bound check that reports `metadata window too small`.

## 3. Cold start to ready, with weights — [verified]

Harness event `ready-with-weights` = the time from `spawn` until `GET /health` answers `{"status":"ok"}`.
In single-instance mode that answer only arrives after the model is resident, so this **is** the M1
"app launch → engine usable" number.

| run | threads | ctx | load-mode | ready | cache state at the time |
|---|---|---|---|---|---|
| `smoke` | 8 | 2048 | auto | **37,999 ms** | cold — ~10 min after the last full-file read |
| `b1-t8-c2k-auto` | 8 | 2048 | auto | 9,226 ms | warm — immediately after `sha256sum` read all 1.88 GB |
| `ctx2048-t4` | 4 | 2048 | auto | 9,479 ms | warm-ish |
| `ctx8192-t4` | 4 | 8192 | auto | 7,464 ms | warm |
| `ctx32768-t4` | 4 | 32768 | auto | 10,025 ms | warm |
| `lm-none` / `lm-mmap` / `lm-mlock` | 4 | 2048 | — | 6,937 / 6,218 / 5,690 ms | progressively warmer (order-confounded, see §5) |
| `longprompt` | 4 | 8192 | auto | 6,796 ms | warm |
| `sustain-t4` | 4 | 2048 | auto | 6,054 ms | warm |
| `unload-arm` | 4 | 2048 | auto | 6,044 ms | warm |
| `recover-after-kill` | 4 | 2048 | auto | 6,080 ms | warm |
| `netprobe` | 4 | 2048 | auto | 6,810 ms | warm |
| `crash-t4` | 4 | 2048 | auto | 6,379 ms | warm |

Weighted summary: **~6–10 s warm, ~38 s cold.** [verified] for both numbers; the mechanism (Windows file
cache holding the GGUF vs. re-reading it from the SMR HDD at ~77 MB/s) is [estimated] — we could not
force an exactly-repeatable cold read, because dropping the standby list needs elevation and rebooting
was out of scope for this checkpoint.

The engine's own log splits the warm case into phases (`runs/ctx8192-t4.server.log`, timestamps are
`srv` start-relative `hh.mm.ss.mmm`): **[verified]**

```
0.00.133.379 I srv  llama_server: initializing ...
0.00.151.849 I srv    load_model: loading model 'D:\NEXUS-MODELS\Llama-3.2-3B-Instruct-Q4_K_M.gguf'
0.05.645.399 I cmn          init: llama threadpool init, n_threads = 4
0.07.289.446 I srv    load_model: initializing, n_slots = 1, n_ctx_slot = 8192, kv_unified = 'false'
0.07.323.697 I srv  server_run_i: model loaded
0.07.323.725 I srv  server_on_li: listening on http://127.0.0.1:38519
```

So ~5.5 s of the 7.5 s is the model read, ~1.7 s is context/graph setup, and the socket is listening at
7.32 s. Contrast with the weightless number from M1.1: the same spawn **without weights** answered in
98 ms. Weights are not a refinement of that number, they are two orders of magnitude on top of it.

## 4. RAM as a function of context — [verified]

`mem-probe.ps1` samples `WorkingSet` (WS, includes file-backed pages) and `PrivateBytes` (priv, the part
that is genuinely ours and non-reclaimable) for the engine PID right after load. Mode `auto` = mmap.

| `--ctx-size` | priv MB | WS MB | what the answer means |
|---|---|---|---|
| 2048 | **1,721.8** | 3,521.7 | fits with room to spare |
| 8192 | **2,401.5** | 4,194.1 | fits |
| 32768 | **5,120.1** | 6,883.4 | loads, but exceeds the 6,532 MB that was free at the start of the session |

Linear fit on private bytes **[estimated]**:

```
(5120.1 − 1721.8) / (32768 − 2048) = 3398.3 / 30720 = 0.1106 MB per token
intercept: 1721.8 − 2048 × 0.1106 ≈ 1,495 MB fixed
→ priv(ctx) ≈ 1495 MB + 0.1106 MB × ctx
```

Theory for this architecture: 2 (K+V) × 28 layers × 8 kv heads × 128 dims × 2 bytes = **114,688 B/token
= 0.1094 MB** — within 1.1% of the measured slope. **[estimated, and it agrees with [verified]]**
That is the admission model's two coefficients, measured rather than guessed: ~1.5 GB fixed for a 3B
Q4_K_M plus ~110 KB per context token.

Consequence for `hardwareCompat` and `engine.measuredFit`: with 6.4 GB free, a 16k context costs
~3,255 MB private and a 32k context ~5,089 MB. The 32k arm did load — no refusal, no crash — but it left
about 1.4 GB of headroom for the app, the browser and everything else on a Windows desktop. The honest
ceiling for this machine is therefore **~16k tokens**, and the model's advertised 131,072 must never be
honoured by default.

## 5. `--load-mode` arms — [verified], with a caveat

| mode | ready ms | WS MB | priv MB | resident shape |
|---|---|---|---|---|
| `none` | 6,937 | 2,222.2 | **2,338.2** | weights copied into private memory; nothing file-backed |
| `mmap` (= default `auto` here) | 6,218 | **3,521.7** | 1,721.9 | weights stay reclaimable file pages; only KV+overhead is private |
| `mlock` | 5,690 | 2,222.4 | **2,338.3** | like `none`, plus locked |

The read that survives the caveat: **mmap trades a bigger working set for a smaller committed set.**
WS 3.5 GB under mmap is not 3.5 GB of pressure — those pages are the GGUF in the system cache and the
first to be evicted under pressure. Under `none`/`mlock` the 2.34 GB private is a hard commitment.
On a machine running 6.4 GB free, `auto`/`mmap` is the correct default and `mlock` is a deliberate
trade of memory headroom for page-fault latency.

The caveat: the three runs executed in that order, so each saw a warmer file cache than the one before.
The monotonic drop in `ready` (6,937 → 6,218 → 5,690) is therefore **not** attributable to the mode —
**[estimated]** confound, and the only number in this table I would defend as mode-attributable is the
priv/WS split, which is structural rather than timing-based. A clean comparison needs either cache
dropping (elevation) or interleaved repeats; both are open items in §9.

## 6. Throughput — `llama-bench`, CPU only, 2×2 — [verified]

```
$ cd /d/NEXUS-SIDECAR/b12189 && ./llama-bench.exe -m /d/NEXUS-MODELS/Llama-3.2-3B-Instruct-Q4_K_M.gguf \
    -ngl 0 -p 512 -n 64 -r 2 -t 4,8 -fa on,off -o json
```

| threads | flash-attn | pp 512 (t/s) | stddev | tg 64 (t/s) | stddev |
|---|---|---|---|---|---|
| 4 | on | 16.83 | 0.42 | **4.38** | 0.15 |
| 8 | on | **21.33** | 1.22 | 3.24 | 0.38 |
| 4 | off | 16.19 | 1.29 | 3.86 | 0.57 |
| 8 | off | 7.99 | 1.27 | 3.06 | **1.69** (samples 4.26 / 1.86) |

Three things this changes in the spec:

1. **More threads is not better for decode.** 8 logical threads on 4 physical cores *cost* ~26% of
   generation throughput (3.24 vs 4.38 t/s). The supervisor must not map "threads" to
   `hardware_concurrency`; it should use physical cores. **[verified]**
2. **`-fa on` is not optional at 8 threads.** Prefill collapses from 21.33 to 7.99 t/s with flash-attn
   off at `t=8` — a 2.7× difference, and the t8/fa-off decode sample pair (4.26 / 1.86) is so unstable
   that its stddev exceeds half its mean. **[verified]**
3. There is a real trade, not a free win: `t=4/fa=on` is the best streaming feel (4.38 t/s), `t=8/fa=on`
   is the fastest prompt digestion (21.33 t/s). For a chat app that assembles a long context per message,
   that choice belongs to the profile, not to the code. **[estimated]**

## 7. Throughput through the sidecar, and the sustained picture — [verified]

The engine's own per-phase timings (`print_timing`) on the server runs, threads 4, `-fa on`:

| run | prompt eval | decode |
|---|---|---|
| `ctx2048-t4` | 4,908 ms / 80 tok = 16.30 t/s | 8,531 ms / 40 tok = 4.57 t/s |
| `ctx8192-t4` | 5,524 ms / 80 tok = 14.48 t/s | 10,312 ms / 40 tok = 3.78 t/s |
| `ctx32768-t4` | 4,678 ms / 80 tok = 17.10 t/s | 9,721 ms / 40 tok = 4.01 t/s |
| `lm-none` | 4,100 ms / 80 tok = 19.51 t/s | 3,559 ms / 20 tok = 5.34 t/s |
| `lm-mmap` | 3,695 ms / 80 tok = 21.65 t/s | 3,231 ms / 20 tok = 5.88 t/s |
| `lm-mlock` | 3,570 ms / 80 tok = 22.41 t/s | 3,248 ms / 20 tok = 5.85 t/s |
| `recover-after-kill` | 3,810 ms / 80 tok = 21.00 t/s | 4,940 ms / 30 tok = 5.87 t/s |
| `sustain-t4` | 3,563 ms / 80 tok = 22.45 t/s | **175,897 ms / 869 tok = 4.93 t/s** |
| `longprompt` | **36,554 ms / 710 tok = 19.42 t/s** | 817 ms / 5 tok = 4.89 t/s |

Two clusters, and the gap is the story: short 20–40 token tails measure 5.3–5.9 t/s, everything sustained
settles at 4.6–4.9 t/s. The 700-token `t=8` run (`b1`) came in at 2.83 t/s end-to-end, which is the 8-thread
penalty of §6 plus warm-up.

Thermal behaviour over a single 179 s generation (`sustain-t4`, chunks per 30 s window): **[verified]**

```
"per30sChunks":{"0":152,"1":150,"2":144,"3":142,"4":146,"5":134}
```

5.07 → 4.47 t/s, about 12% off over three minutes, with no cliff and no recovery inside the window.
The engine's rolling counters agree at the tail: `n_gen = 100, tg = 5.27 t/s, tg_3s = 5.33 t/s`.
So the 15 W ceiling shows up as a gentle slope, not a collapse — **[verified]** on this sample; the
5-minute arm is still open (§9).

**The number that decides the UX**: a 710-token prompt — the size of a message with a memory-and-history
context assembled around it — took **36.6 s before the first token**. Prefill at ~19 t/s is the binding
constraint for RAG-shaped prompts, not decode. Extrapolating the same rate **[estimated]**: 1,500 tokens
≈ 77 s, 2,000 ≈ 103 s, 4,000 ≈ 205 s. Nothing in Phase 2's memory-design works unless the prompt cache
(`cached_tokens`, which were `0` in every run above because each was the first request) is actually reused
across turns, or the assembled context stays small.

## 8. Cancel, crash, and recovery — [verified]

Cancel. Client aborted a stream 25 s in (`sustain-t4`, `abortAfterSec: 25`); the harness then polled
`GET /slots` until the slot reported `is_processing: false`:

```
{"ev":"stream-aborted","name":"cancel-25s","reason":"AbortError","ms":25015,"chunks":122,"chars":504}
{"ev":"cancel-latency","name":"cancel-25s","abortAfterSec":25,"msToIdle":1744,
 "lastSlots":[{"processing":false}]}
```

**1,744 ms** from client abort to engine idle — the CPU keeps generating for up to a full batch after the
HTTP client goes away. The `crash-t4` arm saw 231 ms in the same position, i.e. the number is
batch-bound, not fixed. UI implication: "Stop" must stay visibly busy for a second or two, and `MUI`
should not assume the engine stopped when the fetch rejected.

Crash. `crash-t4` SIGKILLed the engine 15 s into a live generation:

```
{"ev":"stream-aborted","name":"crash-15s","reason":"AbortError","ms":15015,"chunks":88,"chars":324}
{"ev":"process-exit","code":null,"sig":"SIGKILL","el":102264}
```

Recovery, immediately afterwards: `Get-Process llama-server` count = **0** (no orphan holding the port),
the GGUF is byte-identical and untouched on disk, and a fresh spawn was ready in **6,080 ms** and
generated normally (`recover-after-kill`: 30 tokens at 5.87 t/s). The port was not reused — the harness
picks a random free port per run **[verified]**, so the restart path never contends with a dead socket.

Shutdown itself is still an open design point: see §9. Note what these runs did *not* test — they killed
the process. There is no graceful shutdown route to test (§10), so "shut down cleanly with the app" from
`ARCHITECTURE.md` §7 step 3 currently means TerminateProcess, and whether that can corrupt anything is
unverified because the engine only ever writes to its own log.

## 9. Network posture with weights loaded, `--offline` on — [verified]

The M1.1 posture check, repeated while the engine was actively generating and loading real weights.
`netstat -ano` filtered to the engine PID (`netprobe`, pid 7560, mid-generation):

```
  TCP    127.0.0.1:24568        0.0.0.0:0              LISTENING       7560
  TCP    127.0.0.1:24568        127.0.0.1:54991        ESTABLISHED       7560
```

Zero non-loopback entries. Do not misread the `0.0.0.0:0` column: that is the *remote* address field for
a listening socket with no peer; the local half is `127.0.0.1:24568`, which is the bind, and it is
loopback-only. **[verified]**

`--offline` (help line 215: "Offline mode: forces use of cache, prevents network access", env
`LLAMA_ARG_OFFLINE`) is now passed in every measured run above, and it is adopted into the argument
vector. This is the structural answer to the `llama.exe update` / `download` risk recorded in
`PHASE2_POLICY_MODEL.md` invariant 1: not only do we spawn `llama-server.exe`, which has no subcommand
parser, we now also run it with its network access disabled. **[verified]** that the flag is accepted;
**[unverified]** that it cannot be bypassed by any code path inside the engine — the socket census is
corroborating evidence for the runs we sampled, not a proof about the binary.

## 10. What the HTTP surface actually is — [verified], and it corrected the design

Two probes, `route-probe.mjs` (weightless router) and `admin-probe.mjs` (single-instance, model loaded).

Router mode — `POST /models/load` **does not exist**. `runs/route-probe.txt`:

```
GET /models -> 200  {"data":[],"object":"list"}
POST /models -> 400  {"error":{"code":400,"message":"error: invalid HF repo format, expected <user>/<model>[:quant]\n","type":"invalid_request_error"}}
POST /models -> 400  {"error":{"code":400,"message":"model must be a non-empty string","type":"invalid_request_error"}}
POST /models/D%3A%5CNEXUS-MODELS%5C…gguf/load -> 404  {"error":{"message":"File Not Found","type":"not_found_error","code":404}}
PUT /models/D%3A%5CNEXUS-MODELS%5C…gguf -> 404  …
POST /load_model -> 404 …
POST /model/load -> 404 …
GET /api/models -> 404 …
--- props after ---
{"role":"router","max_instances":1,"models_autoload":false,"model_alias":"llama-server",
 "model_path":"none","build_info":"b12189-80d2c0c2c","cors_proxy_enabled":false}
```

Read the second line carefully: when the router accepts a model reference it parses it as a **Hugging Face
repo id**, not a path. So in b12189 the router cannot load a local file over HTTP at all — and the only
way it could is a network fetch, which is exactly what D-022 and `--offline` forbid. The M1.1 note that
"`/models/load` was confirmed live" was a misreading of a 404 that merely looked like the server's own
error format. Corrected: **the engine is spawned single-instance with `-m <path>`.**

Admin surface on a loaded single-instance server — `runs/admin-probe.txt`. There is **no unload route and
no shutdown route**:

```
POST /unload_model -> 404  {"error":{"message":"File Not Found",…,"code":404}}
POST /models/unload -> 404 …
POST /models/<path>/unload -> 404 …
DELETE /models/<path> -> 404 …
DELETE /models/llama-server -> 404 …
POST /shutdown -> 404 …
GET /infill -> 404 …   GET /tokenize -> 404 …   GET /additional_args -> 404 …
GET /applications -> 404 …   GET /resources -> 404 …   GET /api/tags -> 404 …
```

Live ones, with their answers:

```
GET /health -> 200  {"status":"ok"}
GET /props  -> 200  {…}
GET /slots  -> 200  [{"id":0,"n_ctx":2048,"speculative":false,"is_processing":false}]
GET /v1/models -> 200  {"models":[{"name":"D:\\NEXUS-MODELS\\Llama-3.2-3B-Instruct-Q4_K_M.gguf",…
GET /metrics -> 200  (only with `--metrics`; without it the server answers 501
                      "This server does not support metrics endpoint. Start it with `--metrics`")
```

Authentication, same process, no `Authorization` header:

```
NO-AUTH GET /health   -> 200
NO-AUTH GET /props    -> 401
NO-AUTH GET /slots    -> 401
NO-AUTH GET /v1/models-> 401
NO-AUTH GET /metrics  -> 401
```

`/health` stays unauthenticated (that is what makes the readiness probe cheap, and what keeps it a
no-secret probe), everything else requires the per-launch bearer token. **[verified]**

Three contract consequences, recorded where they belong: `engine.loadModel` = the spawn argv, not an HTTP
call; `engine.unloadModel` = terminate the process (there is no route to call), so it is *slow and
destructive*, not a cheap release; `--metrics` must be in the argv or `engine.metrics` has nothing to
read. Note also that `/v1/models` echoes the **absolute filesystem path** of the model as its name — the
UI must not render that field raw, because the path is user data about this machine.

## 11. Premise verdict for M1

M1's exit is "one real streamed local answer in the existing Chat screen".

**Achievable: [verified].** `sustain-t4` streamed 869 tokens of a real answer through
`/v1/chat/completions` on this laptop, end to end, at 4.93 t/s, with a 3.6 s first token on an
80-token prompt, inside 1.7 GB of private RAM, loopback-only, `--offline`, with no app code written yet.

**But the premise needs three honest qualifications, all measured here:**

1. **Answers are slow by chat-app standards.** 4.5–5 t/s sustained means a 300-token answer takes about
   60–65 s and a 500-token answer about 100 s. The Chat screen's streaming UI is the right shape, but it
   must be honest about the wait — this is a "thinking for a minute" product on this hardware, not a
   snappy one.
2. **Long assembled contexts are the real wall.** Prefill at ~19 t/s gives 36.6 s of dead air before the
   first token for a 710-token prompt, and every measured run started with `cached_tokens: 0`. Memory
   retrieval and multi-turn history must be designed around prompt-cache reuse, or the first-token
   latency becomes minutes and the feature is unusable. This is a Phase 2 design requirement that did not
   exist in the M0 documents.
3. **The RAM model is now arithmetic, not vibes.** ~1.5 GB fixed plus ~110 KB per context token, measured
   linear across 2k→32k. 16k is the practical ceiling here; 32k loads but eats the machine.

What is still not proven, and is the actual M1 work: none of the above was measured through `src-tauri/`.
The Rust supervisor, the registry, the admission check and the IPC bridge are still unbuilt — this
checkpoint says the engine and the weights can do the job on this hardware, and what timings the job
will demand of the UI.

## 12. Open items this checkpoint did not close

- Sustained 5-minute and 10-minute generation for the throttle slope (only 3 minutes observed, 12% off).
- Interleaved `--load-mode` repeats, or a repeat with the cache dropped under elevation, to remove the
  order confound in §5.
- Which `ggml-cpu-*.dll` is actually chosen at runtime (expected `ggml-cpu-haswell.dll`; the loader log
  line was not captured — `--log-file`/`-lv 4` would show it).
- Graceful shutdown behaviour: there is no HTTP shutdown route (§10), so the question is now "what does
  TerminateProcess during a write leave behind", not "does the engine exit cleanly".
- Prompt-cache reuse across turns (`cached_tokens > 0`) — the single most valuable unmeasured number.
- A second model size, to test whether the ~110 KB/token KV slope and the ~1.5 GB base generalise, which
  is what the admission model ultimately needs.
- `llama-perplexity` / answer quality. This checkpoint measured speed and memory only; it says nothing
  about whether the answers are good.
