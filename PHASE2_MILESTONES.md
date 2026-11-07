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

### M1 — One real answer, end to end

**Scope:** Tauri scaffold; sidecar supervisor; model registry reading real GGUF metadata; RAM
admission check; token streaming into the existing Chat screen; stop/cancel.

**Prerequisite checkpoints:** Rust + MSVC build tools install; pinned llama.cpp archive download;
one model file (owner chooses; nothing downloaded without that choice).

**Deliverables:** `src-tauri/`, `crates/nexus-core` with `engine`, `registry`, `admission`,
`inference` modules; `src/contract/ipc.ts` generated from the contract doc; `MEASUREMENTS.md` with
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
| 1 | Install Rust toolchain | `%USERPROFILE%\.cargo`, `.rustup` | M1 |
| 2 | Install MSVC Build Tools | several GB under `Program Files (x86)` | M1 |
| 3 | Download pinned llama.cpp archive | `sidecar\b12189\` | M1 |
| 4 | Download a model file | 2–5 GB in the owner's weights folder | M1 |
| 5 | Add npm/Cargo dependencies | `node_modules`, registry cache | each milestone |
| 6 | Create the SQLite database | `%APPDATA%\NexusAI\nexus.db` | M2 |
| 7 | Watch a real folder | reads only; no writes outside cache | M3 |
| 8 | Enable a network path | live requests | M3/M4, per feature |
| 9 | Run a Windows installer build | `src-tauri\target\` | M6 |
| 10 | Create a GitHub remote / push | off-machine copy | only if you ask |

Items 1–4 are the M1 gate and are the reason M0 stayed documents-only.

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
