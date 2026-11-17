# NEXUS AI — Phase 2 Milestones and Acceptance Gates

**Doc:** M0–M6 with executable exit criteria · **Written:** 2026-11-07
**Owner decisions in force:** llama.cpp sidecar · documents before installs · no weights downloaded ·
local Git baseline.

---

## 1. Rules that apply to every milestone

1. **Evidence or it didn't happen.** A gate is passed only with recorded command output in the
   commit message or in `MEASUREMENTS.md`. No milestone is reported complete on reasoning alone —
   the same standard the Phase 1 completion report was held to.
2. **Honesty swap is part of the feature, not a follow-up.** When a command becomes real, the
   screen's `DemoNotice`, its "(prototype only)" toast text, and any "simulated" label come off in
   the *same* commit. A screen that is half-real and still labelled prototype is acceptable
   mid-milestone; a screen that is half-real and claims to be whole is not.
3. **One commit per gate, tagged.** `m0-lock`, `m1-first-answer`, `m2-persistence` … so any
   regression has a known-good previous tag to compare against.
4. **Installs and downloads are checkpoints, not details.** Each one is listed in §3 and needs the
   owner's go-ahead at the time, with what it writes to disk stated plainly.
5. **Reversibility.** Phase 1 stays intact at `84cb1a8`. If Phase 2 goes badly, the UI prototype is
   one checkout away, and no milestone may make that untrue (no destructive migrations without a
   verified backup first).
6. **The machine is a stakeholder.** Any step that would thrash 20 GB of RAM or saturate the SMR
   HDD gets measured before it becomes a default.

---

## 2. Milestones

### M0 — Architecture lock *(this session)*

**Scope:** the document set — `ARCHITECTURE.md`, `PHASE2_IPC_CONTRACT.md`, `PHASE2_DATA_MODEL.md`,
`PHASE2_POLICY_MODEL.md`, `PHASE2_SIDECAR_SPEC.md`, this file — plus the Git baseline and the
recorded decisions.

**Deliverables:** the six documents, decisions D-019+ in `DECISION_LOG.md`, README pointing at the
Phase 2 set.

**Exit gate:**
```
git log --oneline                     → baseline + m0-lock commit present
npx tsc --noEmit                      → exit 0 (Phase 1 UI untouched by M0)
npm run build                         → unchanged success
owner approval of this document set   → recorded in DECISION_LOG.md
```

**Explicitly not in M0:** any dependency install, any `src-tauri/`, any schema applied, any download.

---

### M0.5 — Contract materialised as types *(done 2026-11-07, owner's choice)*

The owner chose to turn `PHASE2_IPC_CONTRACT.md` into TypeScript rather than wait for M1, on the
condition that nothing else move: no dependency, no `src-tauri/`, no screen change, no download.

**Deliverables:** `src/contract/ipc.ts` (96 commands in `CommandSpecs`, 10 channels in `EventSpecs`,
`Result<T>`/`NexusError`/`ErrorCode`, all Phase 1 shapes reused verbatim), `src/contract/client.ts`
(`NexusTransport`, the dependency-free `window.__TAURI__` probe, the `not_implemented` transport, and
error normalisation for a host that rejects with something off-contract), `src/contract/index.ts`.

**Exit gate — recorded output:**
```
npx tsc --noEmit          → exit 0
npm run build             → exit 0; 1613 modules; index-o-Cdud1n.js 425.85 kB; index-B__IBTZ4.css 33.04 kB
                            (identical hashes to Phase 1 = the bundle could not have changed)
grep for '@/contract'     → no importer outside src/contract/
git diff package.json     → empty
runtime check (temp dir)  → honest transport returns not_implemented for every command; subscriptions
                            deliver 0 payloads; stubbed bridge routes calls, unwraps event payloads,
                            and maps an off-contract rejection to 'internal'
type checks (temp dir)    → 7 deliberate misuses all fail to compile; 1 correct usage set compiles
```

**Still true after M0.5:** every screen runs on mock data. The contract is reachable only from code
that does not exist yet — which is the point: M1 now implements against types the compiler enforces,
not against prose.

---

### M1.0 — Toolchain prerequisite *(done 2026-11-07, owner-authorised)*

**Scope:** authorisation checkpoints 1 and 2 only — the Rust toolchain and the MSVC C++ workload.
The owner's instruction was "先授权安装 Rust 和 MSVC Build Tools", then the scope was fixed at
"verify and document this checkpoint, then stop".

**Decisions taken at the checkpoint (D-028, D-029):** add the C++ workload to the existing Visual
Studio Community 2026 instance rather than installing Build Tools beside it; let the installer pick
the Windows SDK; D-022 (no model weights) held.

**Exit gate — all recorded, plain shell, no dev command prompt:**
```
rustc -vV                    → 1.99.1 (58cf8f9c3 2026-10-13), host x86_64-pc-windows-msvc, LLVM 23.1.1
cargo build   (scratch crate) → Finished dev profile in 5.49s, exit 0
linktest.exe                 → "rust-msvc-link-ok 7596", exit 0     ← proves cargo links against MSVC
cargo clippy --all-targets   → exit 0
cl <windows.h> probe         → compiled + ran "cl-sdk-probe pid=18264", and again linked against
                               user32.lib → pid=10436 → ALL-CL-PROBES-PASSED, exit 0
```

**Footprint:** VS instance 9.09 GB (VC Tools 2.40 GB, Windows Kits 2.12 GB), `.rustup` 1.30 GB,
cargo bin 0.17 GB, package cache 4.76 GB. C: free 99.4 → **83.9 GB**; D: free 148.6 GB.

**Open flag:** the installer log ends `Exit Code: 0` but also records *"Updating instance state that a
reboot is required"*. Every verification above passed without rebooting; treat a reboot as the first
action of the next working session.

**Explicitly not in M1.0:** no llama.cpp archive download, no model weights, no `src-tauri/`, no crate
fetched from crates.io, no npm dependency added. All scratch artefacts live outside the repo, under
`C:\Users\BS\nexus-toolchain\`.

---

### M1.1 — Engine acquisition, weightless *(done 2026-11-07, owner-authorised)*

**Scope:** authorisation checkpoint 3 — download the pinned llama.cpp archive, verify it, and learn
what it actually is. The owner chose this after M1.0 and reaffirmed D-022, so the engine was run
**without any model file**.

**What was measured (all of it recorded in `PHASE2_SIDECAR_SPEC.md` §1):**

```
asset        llama-b12189-bin-win-cpu-x64.zip  24,749,596 B  (API size == downloaded bytes)
sha256       f912ea5e3e397c63405c81e732131ab0fa6e72411c80546bb5ad643f7dd82aac  (self-computed; GitHub
             published no digest for these assets, so this is a drift baseline, not a signature)
version      0.9.0-dev (build 12189, commit 80d2c0c2c), Clang 20.1.8, Windows x86_64
contents     52 files / 61 MB extracted → D:\NEXUS-SIDECAR\b12189\  (outside the repo)
weightless   warm: listening at +98 ms, /health {"status":"ok"}, idle RSS 12.4 MB, 15 threads
             bad -m: exit code 1 in 0.11 s, "exiting due to model loading error" (no socket ever)
             auth:   /v1/models 401 without bearer; /health needs NO key; /metrics 401
             routes: POST /models/load 404 → read as "the route exists"; checkpoint 4 below proved
                     it does not
             net:    0 non-loopback sockets; default bind 127.0.0.1
```

**Design corrections this forced:** the supervisor spawns `llama-server.exe` rather than the unified
`llama.exe`, because the latter exposes `update` and `download` subcommands; a weightless start is
**router mode**, so `--models-max 1 --no-models-autoload` became part of the vector (M1.2 removed them
again for a reason given below); `--mlock` and `--no-mmap` no longer exist and are replaced by
`-lm/--load-mode`; and `--n-gpu-layers` defaults to `auto`, so a CPU-only baseline must say `0` out loud.

**Explicitly not in M1.1:** no model weights (D-022), so every §6 performance number — tokens/sec, RSS
under load, cancel latency, cold start at 3B/7B — remained unmeasured. No `src-tauri/`, no crates.io
fetch, no npm dependency, and no repo code changed: this milestone produced documents only.

---

### M1.2 — One model file, and the numbers it unlocks *(done 2026-11-07, owner-authorised)*

**Scope:** authorisation checkpoint 4 — the owner lifted D-022 for exactly one quantised model, chose
`Llama-3.2-3B-Instruct-Q4_K_M` and the path `D:\NEXUS-MODELS\`, and the `PHASE2_SIDECAR_SPEC.md` §6
measurement set was executed against it. Raw output lives in **`MEASUREMENTS.md`**; the harness is the
scratch scripts in `C:\Users\BS\nexus-toolchain\` (`srv1.mjs`, `route-probe.mjs`, `admin-probe.mjs`,
`gguf-meta.mjs`, `mem-probe.ps1`), which are deliberately not in the repository.

**What was measured:**

```
weights      2,019,377,440 B; sha256 e4f1a04d…210d9a == publisher lfs.oid  (first externally-verified
             digest in this project)
metadata     llama / 28 layers / 3072 emb / 24 heads, 8 kv heads / vocab 128256 / file_type 15
             = Q4_K_M; llama.context_length = 131072  ← the model advertises 128k
cold start   /health with weights resident: 6.0–10.0 s warm file cache, 38.0 s cold
             (the same spawn weightless answered in 98 ms; weights are two orders of magnitude)
RAM          private 1,721.8 / 2,401.5 / 5,120.1 MB at ctx 2048 / 8192 / 32768
             → priv ≈ 1,495 MB + 0.1106 MB × tokens; theoretical KV slope 0.1094, 1.1% off
             load-mode auto|mmap = 1,722 MB private + reclaimable file pages
             load-mode none|mlock = 2,338 MB private, committed
throughput   llama-bench (-ngl 0, -p 512 -n 64 -r 2):
               t4 fa-on  pp 16.83  tg 4.38    t8 fa-on  pp 21.33  tg 3.24
               t4 fa-off pp 16.19  tg 3.86    t8 fa-off pp  7.99  tg 3.06 (stddev 1.69)
             sustained server run: 869 tokens in 179.5 s = 4.93 t/s, TTFT 3.6 s on 80 tokens
             per-30s windows 152,150,144,142,146,134 → ~12% off over 3 minutes, no cliff
prefill wall 710-token prompt → TTFT 36,576 ms (19.42 t/s); every run measured cached_tokens: 0
cancel       abort → engine idle 1,744 ms (231 ms in another arm; batch-bound, not constant)
crash        SIGKILL mid-generation → 0 orphan processes, GGUF untouched, respawn ready in 6,080 ms
network      mid-generation netstat for the pid: 1 loopback listener + 1 loopback peer, 0 non-loopback
```

**Design corrections this forced — four of them, each against something M1.1 had asserted:**

1. **The engine is spawned single-instance with `-m`.** `POST /models` in router mode answers 400
   `invalid HF repo format, expected <user>/<model>[:quant]`: it parses a model reference as a
   Hugging Face repo id, so **router mode cannot load a local file at all** and the only alternative
   would be a network fetch, which D-022 and `--offline` forbid. `--models-max 1` and
   `--no-models-autoload` left the vector; the admission check moved from "before the load call" to
   "before the spawn".
2. **There is no unload route and no shutdown route.** `POST /unload_model`, `POST /models/unload`,
   `DELETE /models/<path>` and `POST /shutdown` all 404 on a loaded server. `engine.unloadModel` is
   therefore terminate-the-pid, and every "unloaded" state in the UI implies a 6–38 s reload on the
   other side of it.
3. **`--ctx-size 0` is a hazard, not a default.** 0 means "take it from the model", this model says
   131072, and by the measured slope that is ~14.5 GB of KV on a machine with 6.4 GB free. The engine
   did not refuse 32k; it loaded 5.1 GB private without complaint — the admission check is the only
   thing between a user's request and a swapped desktop.
4. **Threads must come from physical cores, and flash-attn must be stated.** 8 logical threads cost
   ~26% of decode against 4; with `-fa off` at 8 threads prefill collapses 2.7× and the decode samples
   spread from 4.26 to 1.86 t/s. Added to the vector: `--offline`, `--metrics` (without it `/metrics`
   is 501), `-fa on`.

**Premise verdict:** M1's exit — one real streamed local answer — is **achievable on this hardware**,
verified: 869 real tokens streamed end to end at 4.93 t/s in 1.7 GB private, loopback-only, `--offline`.
Qualified: at 4.5–5 t/s a 300-token answer takes about a minute, so this is a "thinking for a minute"
product on this laptop; and the binding constraint is **prefill, not decode** — 36.6 s of dead air
before the first token on a 710-token prompt, with no prompt cache exercised in any run. Phase 2's
memory-and-RAG context assembly must be designed around cache reuse or small contexts, which is a new
requirement no M0 document carried.

**Explicitly not in M1.2:** no `src-tauri/`, no crates.io fetch, no npm dependency, no app code changed,
and no second model. `MEASUREMENTS.md` §12 lists what stayed open, including concurrent indexing (needs
another authorisation) and the 5-minute sustained arm.

---

### M1 — One real answer, end to end

**Scope:** Tauri scaffold; sidecar supervisor; model registry reading real GGUF metadata; RAM
admission check; token streaming into the existing Chat screen; stop/cancel.

**Prerequisite checkpoints:** ~~Rust + MSVC build tools install~~ **done at M1.0**; ~~pinned llama.cpp
archive download~~ **done at M1.1**; ~~one model file~~ **done at M1.2** — the owner authorised exactly
one, chose it and chose the path. **No prerequisite is left unauthorised: the only gate standing
between here and M1 code is the `src-tauri/` scaffold plus the first crates.io fetch** (checkpoint 5).

**Deliverables:** `src-tauri/`, `crates/nexus-core` with `engine`, `registry`, `admission`,
`inference` modules; the Rust mirror of `src/contract/` (already written at M0.5 — M1 implements it,
and any change to a shape updates both sides in one commit); `MEASUREMENTS.md` with
the §6 checklist from `PHASE2_SIDECAR_SPEC.md` filled in.

**Progress 2026-11-12 — core library landed, gate not yet met.** `crates/nexus-core` implements the
supervisor (`engine`), real GGUF metadata parser (`registry`), measured RAM admission (`admission`),
prompt assembly and cancellation (`inference`), loopback HTTP/SSE (`net`) and the IPC dispatch router
(`dispatch`). `cargo test -p nexus-core` is **52 passed, 0 failed**; `cargo clippy -p nexus-core
--all-targets -- -D warnings` is clean. The opt-in live test streamed a real answer from the real
engine and reported real usage (43 prompt / 5 completion tokens, 1722 MB private) — numbers in
`MEASUREMENTS.md` §13. Tagged `m1-core`; **the `m1-first-answer` tag stays unclaimed** until the
Tauri shell and the three manual gates below are done.

**Progress 2026-11-14 — M1 exit gate met.** The Tauri shell exists (`src-tauri/`), exposes the single
`ipc` command, bridges `chat://token`, `chat://usage` and `model://state`, and terminates the child on
exit. `tools/ui-gate.mjs` drives the real window and the real engine, and the recorded run
(`TEST_RESULTS.md` §4, `MEASUREMENTS.md` §14) shows:

- `NEXUS OK` streamed into the real Chat screen (122 engine-counted context tokens);
- Stop halted generation at 1 character with **no growth 2.5 s later** and the incomplete-answer note;
- `taskkill /IM llama-server.exe /F` mid-answer produced
  `engine.crashed: The local engine stopped while answering. The next message will restart it.`,
  the app survived, and the next send streamed `RECOVERED`;
- zero external network requests, zero renderer console errors.

Regression at the same commit: `cargo test -p nexus-core` 53 passed, clippy clean, typecheck and
`npm run build` exit 0. Two real defects were found by the gate and fixed: the Vite watcher crashed
on `nexus_ai_lib.dll` (`EBUSY`), and crash detection trusted `Child::try_wait`, which lags an external
kill by 0.8–1.5 s and therefore misreported a dead engine as `internal:`. The supervisor now probes
`/health` (`serving()`) before reuse and before deciding "crash vs I/O error". Tag `m1-first-answer`
is placed on the commit carrying this evidence.


**Exit gate — all of these, with output recorded:**
```
cargo test -p nexus-core              → pass (unit: admission thresholds, port picker, metadata parse)
cargo clippy -p nexus-core -- -D warnings → clean
npm run typecheck && npm run build    → exit 0
manual: start app offline → load a real model → send a prompt → tokens stream incrementally
manual: press stop → generation halts within the measured cancel latency
manual: kill llama-server.exe mid-generation → answer marked incomplete, app survives, next request restarts engine
```
**Honesty swap:** Chat loses its `DemoNotice` and the "(Simulated response…)" italic; the context
rail switches to `measured: true`. Model Manager's Installed tab can show real rows.

**If M1 fails the premise** (tokens/sec unusable on this CPU), that result is itself the deliverable
and the next decision is model size or provider — not more infrastructure.

---

### M2 — Persistence — **DONE 2026-11-17**

**Scope:** SQLite schema from `PHASE2_DATA_MODEL.md`, migrations, WAL, conversations/messages/
settings/activity tables, backup and restore.

**Exit gate:**
```
cargo test -p nexus-store             → migrations apply from empty db; integrity_check clean
restart the app                       → conversation list, active model, theme, settings all survive
store.backup() then store.restore()   → identical row counts, and the pre-restore backup exists
kill the app during a write           → db opens cleanly next launch, no half-written message
npx tsc --noEmit                      → exit 0
```
**Honesty swap:** Memory Center, Activity Center and Chat stop saying "nothing persists"; Settings
→ Backup becomes real; the purge and export actions do too.

**Result (2026-11-17):** all five gate lines ran; evidence in `TEST_RESULTS.md` §"2026-11-17 — M2
persistence" and `tools/m2-gate.mjs`. `cargo test -p nexus-store` 9/0, `cargo test -p nexus-core`
59/0, clippy clean, `npx tsc --noEmit` exit 0. Restart gate: conversation, settings, `models.active`
and the painted theme survived a real process kill and relaunch; `store.backup` wrote and verified a
file, `store.restore` wrote a pre-restore copy and row counts matched (1 to 1). The kill-during-write
line is the store's child-process test, not an app kill during generation. Tagged `m2-persistence`.

---

### M3 — Knowledge and Memory — **DONE 2026-11-17**

**Scope:** folder watch, parsers (md/txt/csv first, then pdf/docx/xlsx), chunking, embedding,
FTS5 + vector retrieval with citations, memory service with approval-gated writes and retrieval
injection.

**Exit gate:**
```
drop a .md into a watched root        → indexed status reaches 'indexed' with a real chunk count
ask a question referencing it         → answer cites the document and page/section
rename the file                       → watcher updates rather than duplicating
kb.search on a 200-document tree      → sub-second on this machine, timing recorded
create a pending memory               → NOT retrievable; approve it → IS retrievable
cargo test -p nexus-kb                → parser fixtures pass; a corrupt pdf yields failed, not panic
```
**Honesty swap:** Knowledge Base and Memory Center banners come off; "STORAGE (MOCK)" becomes
measured; chat answers carry citations back to the retrieved chunks.

**Result (2026-11-17):** all six gate lines ran in one live session (`tools/m3-gate.mjs`,
21/21 steps PASS; evidence in `TEST_RESULTS.md` §"2026-11-17 — M3 knowledge and memory"):
a watched tree of 201 documents indexed to `indexed` with real chunk counts; `kb.search` over that
tree cited `admission.md §Admission` in **26.50 ms** with `measured: true`; renaming the file on
disk updated the index without changing the total; `chat.send` returned four citations including
`admission-renamed.md`; an explicit "remember that …" request proposed a pending memory that
`memory.search` could not see (0 hits) until `memory.approve` made it retrievable (1 hit).
`cargo test -p nexus-kb` 10/0, `-p nexus-store` 12/0, `-p nexus-core` 63/0, clippy clean,
`npx tsc --noEmit` and `npm run build` exit 0. Tagged `m3-knowledge`.

What the honesty swap actually changed: the Knowledge Base screen is now real (watch, list, search
stats, re-index, move, remove, preview of what retrieval sees); Chat renders a Sources row from the
citations the core returns. Memory Center still only reads, edits, approves and archives — a memory
is created by the core from an explicit request in chat, not from the Memory Center screen — and
the Document Analyst agent screen remains M4 because no tool loop exists yet.

---

### M4 — Tools and one working agent — **DONE 2026-11-17**

**Scope:** tool registry with declared permissions, approval queue, filesystem + Python +
PowerShell tool families, job scheduler with the single execution slot, Developer Agent completing a
multi-step task, the ten policy invariants from `PHASE2_POLICY_MODEL.md` §6 turned into tests.

**Exit gate:**
```
cargo test -p nexus-policy            → all 10 invariants pass, including fail-closed cases
Developer Agent given a 3-step task   → completes, with each tool call logged by correlation_id
deny one approval                     → task stops with a visible reason, not a silent partial
path traversal attempt                → policy.root_denied before any filesystem call
two simultaneous jobs                 → serialised; the queue is visible in Activity Center
cargo test && npm run build           → green
```
**Honesty swap:** Tools & Skills banner comes off; "Simulated run completed" is replaced by real
output; the Activity Center becomes a true log rather than a demo timeline.

**Result (2026-11-17):** all six gate lines ran against the real window (`tools/m4-gate.mjs`,
33/33 steps PASS, exit 0; evidence in `TEST_RESULTS.md` §"2026-11-17 — M4 tools, permissions and
approvals"). `nexus-policy` passes the ten invariants plus a symlink-escape and an undeclared-
permission case (12/0). A three-step Developer Agent task completed after the owner approved the
write, every step and all nine activity rows carried one `correlationId`, and `fs.read` returned the
bytes `fs.write` had just written. Rejecting an approval stopped the task with
`Approval rejected by the owner: … Nothing ran.`, marked the step `denied`, left the next step
`pending` and wrote no file. An absolute path outside every watched folder was refused with
`policy.root_denied` and created no approval. Two jobs submitted together ran in order
(`05:19:55Z <= 05:19:56Z`). In the UI, the Activity Center listed the pending decision, offered
Approve once / Always allow / Reject, resumed the job on approval and then showed the created file;
Always allow produced a visible `fs.write / always` grant. `cargo test -p nexus-policy -p
nexus-store -p nexus-core` 66/0 + 7/0 + 12/0 + 12/0, clippy clean, `npx tsc --noEmit` and
`npm run build` exit 0. Tagged `m4-tools`.

The honest limits: the Developer Agent executes an explicit one-line-per-call plan, not model
planning (M5); only `developer-agent` can run; there is no job cancellation; approvals bind to a
canonical argument string. `skill.*` remains prototype state behind its own notice.

---

### M5 — Learning loop

**Scope:** correction logging, suggestion → approval → instruction version with rollback,
regression suite replay, all still gated by approval and none of it touching weights.

**Exit gate:**
```
log a correction → approve its suggestion → instruction file gains a version, diff shown
switch back to the previous version     → behaviour reverts, proven by a regression case
regression suite run                    → pass/fail/never_run reported honestly per case
cargo test -p nexus-learning            → green
fine-tuning path                        → still absent; grep confirms no training entry point
```
**Honesty swap:** Learning Lab banner comes off; the pipeline strip reflects real job states.

---

### M6 — Packaging and hardening

**Scope:** Tauri Windows bundler, sidecar as external binary with pinned version, real telemetry
replacing `mockTelemetry`, the hardware profile corrected to the actual volumes, installer,
uninstall cleanliness, performance pass under the 15 W ceiling.

**Exit gate:**
```
npm run tauri build                     → MSI/NSIS artifact produced
install on a clean Windows profile      → app launches offline with no prior state
Dashboard meters                        → match a second tool's reading within a stated tolerance
uninstall                               → leaves weights and the owner's knowledge folders alone
disk figures in Model Manager           → computed from the volume that actually holds data
cold start to first ready model         → measured and recorded
```

---

## 3. Authorisation checkpoints (nothing here happens silently)

| # | Action | Writes | Needed at |
|---|---|---|---|
| 1 | Install Rust toolchain | `%USERPROFILE%\.cargo`, `.rustup` | **done 2026-11-07 (M1.0)** |
| 2 | Install MSVC C++ workload | 9.09 GB in the existing VS Community 2026 instance | **done 2026-11-07 (M1.0)** |
| 3 | Download pinned llama.cpp archive | 61 MB in `D:\NEXUS-SIDECAR\b12189\` (outside the repo) | **done 2026-11-07 (M1.1)** |
| 4 | Download a model file | 1,879 MB in `D:\NEXUS-MODELS\` (owner named file and folder) | **done 2026-11-07 (M1.2)** |
| 5 | Add npm/Cargo dependencies | `node_modules`, registry cache | each milestone |
| 6 | Create the SQLite database | `%APPDATA%\NexusAI\nexus.db` | M2 |
| 7 | Watch a real folder | reads only; no writes outside cache | M3 |
| 8 | Enable a network path | live requests | M3/M4, per feature |
| 9 | Run a Windows installer build | `src-tauri\target\` | M6 |
| 10 | Create a GitHub remote / push | off-machine copy | only if you ask |

Items 1–4 are the M1 gate and **all four are now paid** — 1 and 2 at M1.0, 3 at M1.1, and 4 at M1.2,
where the owner named both the file and the folder. Item 5 has now been exercised once in the
*download* sense and not at all in the *registry* sense: no crate has been fetched from crates.io, so
the first `cargo build` that pulls Tauri dependencies is itself a checkpoint, not a background step —
that is checkpoint 5, and it is the only authorisation M1 still lacks.

---

## 4. Definition of done for Phase 2

Phase 2 is done when: every `DemoNotice` banner in the app has been removed because the screen it
warns about became real; the ten policy invariants pass as automated tests; the measurement checklist
has real numbers instead of estimates; an installer runs on a clean machine; and every milestone has
a tag with its gate output recorded. Anything still simulated keeps its banner — that is the
difference between a roadmap and a lie.

The measurement clause moved from "has real numbers" to **"has real numbers and real code behind
them"**: as of M1.2 the numbers exist (`MEASUREMENTS.md`) but every one of them came from a scratch
Node harness, not from `nexus-core`. Until the Rust supervisor produces the same output, no screen may
claim it.

---

## 5. Companion documents

`ARCHITECTURE.md` · `PHASE2_IPC_CONTRACT.md` · `PHASE2_DATA_MODEL.md` · `PHASE2_POLICY_MODEL.md` ·
`PHASE2_SIDECAR_SPEC.md` · `MEASUREMENTS.md` · `PHASE_1_COMPLETION_REPORT.md`
