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
             routes: POST /models/load exists (404 File Not Found) → engine.loadModel has a home
             net:    0 non-loopback sockets; default bind 127.0.0.1
```

**Design corrections this forced:** the supervisor spawns `llama-server.exe` rather than the unified
`llama.exe`, because the latter exposes `update` and `download` subcommands; a weightless start is
**router mode**, so `--models-max 1 --no-models-autoload` become part of the vector; `--mlock` and
`--no-mmap` no longer exist and are replaced by `-lm/--load-mode`; and `--n-gpu-layers` defaults to
`auto`, so a CPU-only baseline must say `0` out loud.

**Explicitly not in M1.1:** no model weights (D-022), so every §6 performance number — tokens/sec, RSS
under load, cancel latency, cold start at 3B/7B — remains unmeasured. No `src-tauri/`, no crates.io
fetch, no npm dependency, and no repo code changed: this milestone produced documents only.

---

### M1 — One real answer, end to end

**Scope:** Tauri scaffold; sidecar supervisor; model registry reading real GGUF metadata; RAM
admission check; token streaming into the existing Chat screen; stop/cancel.

**Prerequisite checkpoints:** ~~Rust + MSVC build tools install~~ **done at M1.0**; ~~pinned llama.cpp
archive download~~ **done at M1.1**; one model file (owner chooses; nothing downloaded without that
choice) — **still unauthorised, and it is the last prerequisite**.

**Deliverables:** `src-tauri/`, `crates/nexus-core` with `engine`, `registry`, `admission`,
`inference` modules; the Rust mirror of `src/contract/` (already written at M0.5 — M1 implements it,
and any change to a shape updates both sides in one commit); `MEASUREMENTS.md` with
the §6 checklist from `PHASE2_SIDECAR_SPEC.md` filled in.

**Exit gate — all of these, with output recorded:**
```
cargo test -p nexus-core              → pass (unit: admission thresholds, port picker, metadata parse)
cargo clippy -p nexus-core -- -D warnings → clean
npm run typecheck && npm run build    → exit 0
manual: start app offline → load a real model → send a prompt → tokens stream incrementally
manual: press stop → generation halts within the measured cancel latency
manual: kill llama.exe mid-generation → answer marked incomplete, app survives, next request restarts engine
```
**Honesty swap:** Chat loses its `DemoNotice` and the "(Simulated response…)" italic; the context
rail switches to `measured: true`. Model Manager's Installed tab can show real rows.

**If M1 fails the premise** (tokens/sec unusable on this CPU), that result is itself the deliverable
and the next decision is model size or provider — not more infrastructure.

---

### M2 — Persistence

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

---

### M3 — Knowledge and Memory

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
measured; the Document Analyst agent's page-referenced answers become real.

---

### M4 — Tools and one working agent

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
| 4 | Download a model file | 2–5 GB in the owner's weights folder | M1 |
| 5 | Add npm/Cargo dependencies | `node_modules`, registry cache | each milestone |
| 6 | Create the SQLite database | `%APPDATA%\NexusAI\nexus.db` | M2 |
| 7 | Watch a real folder | reads only; no writes outside cache | M3 |
| 8 | Enable a network path | live requests | M3/M4, per feature |
| 9 | Run a Windows installer build | `src-tauri\target\` | M6 |
| 10 | Create a GitHub remote / push | off-machine copy | only if you ask |

Items 1–4 are the M1 gate. 1, 2 and 3 are paid; **item 4 — a model file — is the one authorisation
M1 still does not have**, and it is the difference between an engine that starts and an answer that
streams. Item 5 has not been exercised yet either: no crate has been fetched from crates.io, so the
first `cargo` build that pulls Tauri dependencies is itself a checkpoint, not a background step.

---

## 4. Definition of done for Phase 2

Phase 2 is done when: every `DemoNotice` banner in the app has been removed because the screen it
warns about became real; the ten policy invariants pass as automated tests; the measurement checklist
has real numbers instead of estimates; an installer runs on a clean machine; and every milestone has
a tag with its gate output recorded. Anything still simulated keeps its banner — that is the
difference between a roadmap and a lie.

---

## 5. Companion documents

`ARCHITECTURE.md` · `PHASE2_IPC_CONTRACT.md` · `PHASE2_DATA_MODEL.md` · `PHASE2_POLICY_MODEL.md` ·
`PHASE2_SIDECAR_SPEC.md` · `PHASE_1_COMPLETION_REPORT.md`
