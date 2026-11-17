# TEST_RESULTS.md — NEXUS AI

Evidence of record for every claim that something works. A result appears here only after the
command actually ran on this machine; output is copied, not paraphrased. Measurements (timings,
memory, tokens) live in `MEASUREMENTS.md`; this file records pass/fail and the exact command.

## Environment

| Item | Value |
| --- | --- |
| Machine | owner laptop, Windows, 20.3 GB physical RAM, 3 physical cores |
| Worktree | `D:\NEXUS-AI-m1`, branch `m2-persistence` |
| Rust | 1.99.1 MSVC, `cargo clippy` from the same toolchain |
| Node | 24.17.0, npm with `vite` 5.4.21, `@tauri-apps/cli` 2.12.4 |
| WebView2 | 157.0.4341.46 |
| Engine | `D:\NEXUS-SIDECAR\b12189\llama-server.exe` (pinned b12189) |
| Model | `D:\NEXUS-MODELS\Llama-3.2-3B-Instruct-Q4_K_M.gguf` (only authorised file) |

---

## 2026-11-17 — M4 tools, permissions and approvals

Worktree `D:\NEXUS-AI-m1`, branch `m2-persistence` (M4 commits on top of tagged `m3-knowledge`).
New crate `crates/nexus-policy` (the pure decision gate), the single-slot job runner
(`crates/nexus-core/src/scheduler.rs`), the tool runtime (`crates/nexus-core/src/tools.rs`), the
`agent.*` / `tool.*` / `approval.*` / `job.*` arms in `dispatch.rs`, migration `0003_m4_execution`,
and the Agents / Tools / Activity live paths. The gate's fixture tree (`.m4-gate-tree`) was removed
at the end of the run; `.m4-gate.json` (gitignored) is the machine-readable copy of the step list.

### 1. Crate tests

```
> cargo test -p nexus-policy -p nexus-store -p nexus-core
     Running unittests src\lib.rs (target\debug\deps\nexus_core-f337cca74ad6e86d.exe)
test result: ok. 66 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.69s
     Running tests\m4_execution.rs (target\debug\deps\m4_execution-3c9c5bae9651d9c1.exe)
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.49s
     Running unittests src\lib.rs (target\debug\deps\nexus_policy-ff26fc5ef4430a1d.exe)
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
     Running unittests src\lib.rs (target\debug\deps\nexus_store-da9d48845450ed22.exe)
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.27s
```

`m4_execution` drives the real dispatcher and the real job thread against a temporary store and
folder. It covers: a three-step task completing with every step and activity row under one
correlation id; a rejection stopping the task with a visible reason and no partial write; a path
outside the watched root denied by policy with no approval created; two simultaneous jobs being
serialised; an Always-allow grant removing the second prompt; a Python tool running with the
watched folder as its working directory; and an unknown plan line producing a named validation
error that queues nothing. `nexus-policy` covers verdicts, root containment including symlink
escape, argument hashing and approval expiry.

### 2. Static gates

```
> cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [unoptimized] target(s) in 2.18s

> npx tsc --noEmit
tsc exit 0

> npm run build
dist/assets/index-BfvEiiBg.css    40.02 kB │ gzip:   9.97 kB
dist/assets/index-Do9tr3Zc.js    466.96 kB │ gzip: 135.65 kB
✓ built in 14.28s
```

### 3. Live gate — `node tools/m4-gate.mjs`

Run against the real window (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"`,
`npm run tauri dev`), exit code 0, 33/33 steps:

| # | Step | Detail |
| --- | --- | --- |
| 1 | fixture tree written | `.m4-gate-tree\notes` plus a secret file outside it |
| 2 | the page reaches the real core | `engine.status` answered |
| 3 | the Developer Agent exists and is enabled | `Developer Agent` |
| 4 | the catalogue marks `fs.write` approval-gated | `Write file · needsApproval=true` |
| 5 | `kb.watchRoot` accepted the fixture as a tool root | `D:\NEXUS-AI-m1\.m4-gate-tree\notes` |
| 6 | the write step asked before acting, in plain language | `Write 16 bytes to …\gate-one-1794892794126.txt` |
| 7 | the job is parked in the queue while the decision waits | `queued / step awaiting_approval` |
| 8 | `approval.decide` accepted the approval | `approved once` |
| 9 | the three-step task completed | `success` |
| 10 | `fs.read` returned what `fs.write` wrote | `{"bytes":16,"path":"\\?\D:\…\gate-one-…txt"}` |
| 11 | every step carries the job correlation id | `corr-1794892794467-4` |
| 12 | every activity row for the job carries the same correlation id | `9 rows` |
| 13 | the log names the start, the tool calls and the finish | `Job finished · Read file · Write file · Job started · Approval granted · Approval requested · List folder · Agent task queued` |
| 14 | `approval.decide` accepted the rejection | `rejected` |
| 15 | the task stopped with a visible reason | `Approval rejected by the owner: … Nothing ran.` |
| 16 | the denied step is marked and the second step never ran | `denied / pending` |
| 17 | the rejected write left no file behind | absent on disk |
| 18 | a path outside every watched folder is denied before any read | `… is outside every watched folder.` |
| 19 | the denial is recorded as `policy.root_denied` | `Stopped before step 1 — policy.root_denied.` |
| 20 | a traversal does not ask the owner; no approval was created | `0 before, 0 after` |
| 21 | both queued jobs completed | `success / success` |
| 22 | the single slot serialised them: one finished before the other started | `2026-11-17T05:19:55Z <= 2026-11-17T05:19:56Z` |
| 23 | `job.list` shows the queue the Activity Center reads | `5 jobs` |
| 24 | the Tools screen lists the live catalogue | `fs.write listed` |
| 25 | the Tools screen no longer claims to be simulated | demo notice absent |
| 26 | the Agents screen lists the stored roster | `Developer Agent listed` |
| 27 | the Agents screen no longer claims to be mock definitions | demo notice absent |
| 28 | the Activity Center shows the pending decision | `gate-ui-1794892794126.txt` |
| 29 | the pending row expands to its decision controls | `opened` |
| 30 | the Activity Center offers Approve once / Always allow / Reject | `always` |
| 31 | the UI decision resumed and finished the job | `success` |
| 32 | the approved write exists on disk | `…\gate-ui-1794892794126.txt` |
| 33 | Always allow created a visible standing grant | `[{"permission":"fs.write","scope":"always"}]` |

Cleanup unwatched the fixture folder and removed the tree. The two queued jobs in steps 21–22 were
two `fs.list` plans submitted back to back; their timestamps show the second started after the first
finished, which is the one-slot behaviour.

### 4. Defects found and fixed during M4

1. **The traversal test pointed at the wrong path.** `fs.read ../outside.txt` resolves to a sibling
   *inside* the temporary root, so it proved nothing. The test and the gate now plan an absolute
   path outside every root; the gate asserts the denial text, the `policy.root_denied` activity row
   and that no approval was created.
2. **`AgentCreateInput` did not match the payload the screen builds.** The contract required
   `icon`/`builtIn` that `agent.create` never read, and omits fields the screen sends. The interface
   now marks role/description/capabilities/modelId/icon optional and adds `enabled`; `agent.update`
   still ignores `modelId`, so the screen follows it with `agent.assignModel`.
3. **`JobInfo.steps` was optional** although every job row returns an array; it is now required so
   the screen can iterate without a guard.

The live gate itself passed on its first complete run.

### 5. What this does not prove

No model planning (the Developer Agent executes an explicit plan; planning is M5), no cancellation
of a running job, only one runnable agent, approvals keyed on a canonical arguments string rather
than semantic intent, and `skill.*` remains prototype state behind its own notice. Those limits are
recorded in `KNOWN_ISSUES.md` and `TECHNICAL_DEBT.md`.

---

## 2026-11-17 — M3 knowledge and memory

Worktree `D:\NEXUS-AI-m1`, branch `m2-persistence` (M3 commits on top of tagged `m2-persistence`).
New crate `crates/nexus-kb` (parsers + chunking + local vectors), the `kb.*` and `memory.search`
arms in `dispatch.rs`, retrieval injection and citations in `chat.send`, and the Knowledge / Chat
honesty swap. The fixture tree the gate created (`.m3-gate-tree`, 201 files) was removed at the end
of the run; `.m3-gate.json` (gitignored) is the machine-readable copy of the step list below.

### 1. Crate tests

```
> cargo test -p nexus-kb -p nexus-store -p nexus-core
     Running unittests src\lib.rs (target\debug\deps\nexus_core-2b89a9ddd6b873f1.exe)
running 63 tests
test result: ok. 63 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.47s
     Running unittests src\lib.rs (target\debug\deps\nexus_kb-e3df756b8d740310.exe)
running 10 tests
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
     Running unittests src\lib.rs (target\debug\deps\nexus_store-4a9eccc07559440f.exe)
running 12 tests
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.93s
```

The `nexus-kb` tests include a corrupt-PDF fixture that yields a `failed` document instead of a
panic, and chunk-boundary tests on multi-byte text. `nexus-core` includes
`explicit_memory_requests_are_recognised_and_other_chatter_is_not` and
`pending_memory_is_invisible_to_memory_search_until_approved`.

### 2. Static gates

```
> cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [unoptimized] target(s) in 28.16s

> npx tsc --noEmit
tsc exit 0

> npm run build
dist/assets/index-CPdT3ZE-.js   455.79 kB │ gzip: 132.37 kB
✓ built in 18.42s
```

### 3. Live gate — `node tools/m3-gate.mjs`

Run against the real window (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"`)
with the real model available. Exit code 0, 21/21 steps:

| # | Step | Detail |
| --- | --- | --- |
| 1 | fixture tree written | 1 document + 200 bulk files under `D:\NEXUS-AI-m1\.m3-gate-tree` |
| 2 | the page reaches the real core | `engine.status` answered |
| 3 | `kb.watchRoot` accepted the folder | `D:\NEXUS-AI-m1\.m3-gate-tree` |
| 4 | the dropped markdown file reached indexed with a real chunk count | `admission.md · indexed · 2 chunks` |
| 5 | the whole tree was indexed | `total 201` |
| 6 | `kb.search` returns the document with a citation | `admission.md §Admission` |
| 7 | `kb.search` reports vectors as measured | `true` |
| 8 | `kb.search` over 201 documents is sub-second | `26.50 ms` |
| 9 | the watcher noticed the rename | `admission-renamed.md listed` |
| 10 | the rename did not duplicate the document | `total 201` |
| 11 | an installed model is available for the chat leg | `llama-3.2-3b-instruct-q4-k-m` |
| 12 | `chat.create` wrote a conversation | `c-1794875056133-2736` |
| 13 | `chat.send` answered and reported citations | `4 citations` |
| 14 | the answer cites the indexed document | `admission-renamed.md §Admission, filler-013.md §Filler 13, filler-000.md §Filler 0, filler-001.md §Filler 1` |
| 15 | the explicit request became a pending memory | `the cedar admission note says private memory is measured` |
| 16 | the pending memory is not retrievable | `0 hits while pending` |
| 17 | `memory.approve` accepted the decision | `approved` |
| 18 | the approved memory is retrievable | `1 hits after approval` |
| 19 | the Knowledge screen shows the live index | `document listed` |
| 20 | the Knowledge screen no longer claims to be simulated | `demo notice absent` |
| 21 | the Chat screen renders the citation chip for the answer | `Sources rendered` |

Cleanup unwatched the root, deleted the indexed rows, removed the conversation and every memory the
gate created, and deleted the fixture tree. The whole-tree search timing is a retrieval time
measured in the page; the model was not regenerating during it.

### 4. Defects the gate found, and what was fixed

1. **Idempotent retry dropped citations.** A second `chat.send` with the same `clientId` returned
   `{messageId}` only, so the gate saw "0 citations" from a message that *had* citations. Fixed in
   `dispatch.rs`: the retry now reads `citations` back from the stored message
   (`Store::message_citations`) and returns them.
2. **Case-sensitive UI assertion.** The Sources label is CSS-uppercased, so `innerText` is
   `SOURCES`; the gate's `/Sources/` test failed on a correct screen. The assertions are now
   case-insensitive (`/sources/i`, `/index \(measured\)/i`).

### 5. What this does not prove

No OCR of scanned PDFs, no semantic embeddings (the vector component is a local hashed bag of
words), no memory inference from ordinary conversation, and no multi-root load test. Those limits
are recorded in `KNOWN_ISSUES.md` and `TECHNICAL_DEBT.md`.

---

## 2026-11-17 — M2 persistence

Worktree `D:\NEXUS-AI-m1`, branch `m2-persistence` (from tagged M1 `7537a9f`). New crate
`crates/nexus-store` (rusqlite 0.32.1 bundled-full + backup), the store wired into
`crates/nexus-core/src/dispatch.rs`, and the Chat / Memory / Activity / Settings / Dashboard
honesty swap. The seed rows this gate created in the real database were deleted afterwards;
the two backup files it wrote remain in `%APPDATA%\NexusAI\backups`.

### 1. Store tests

```
> cargo test -p nexus-store
running 9 tests
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.00s
```

Includes `migrations_apply_from_empty_and_integrity_is_clean`,
`backup_then_restore_keeps_rows_and_writes_a_pre_restore_copy` and
`a_killed_writer_leaves_a_clean_database`. Exit code 0.

### 2. Core tests (router level)

```
> cargo test -p nexus-core
running 59 tests
test result: ok. 59 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.60s
```

New in M2 (examples): `conversations_persist_through_the_router`,
`a_question_is_saved_even_when_no_model_is_chosen`,
`settings_are_stored_read_back_and_validated`,
`backup_refuses_an_in_memory_store_instead_of_writing_a_fake_file`,
`owner_export_returns_the_path_it_wrote`,
`a_restart_reads_the_same_conversation_settings_and_active_model` (opens the database file,
drops the core, reopens it, reads the conversation back). Exit code 0.

### 3. Lints

```
> cargo clippy --workspace --all-targets -- -D warnings
    Checking nexus-ai v0.1.0 (D:\NEXUS-AI-m1\src-tauri)
    Finished `dev` profile [unoptimized] target(s) in 18.83s
```

Exit code 0.

### 4. Frontend

```
> npx tsc --noEmit          → exit 0
> npm run build             → ✓ built in 31.64s
  dist/assets/index-DNp-owZs.js   446.73 kB │ gzip: 129.88 kB
  dist/assets/index-DatQnz7P.css   39.87 kB │ gzip:  9.93 kB
```

### 5. App-level gate: restart, theme, backup → restore

`target/debug/nexus-ai.exe` rebuilt from this branch (`cargo build -p nexus-ai`, 3m 19s),
Vite 5.4.21 on :5173, WebView2 DevTools on 9333. `tools/m2-gate.mjs` calls the same `ipc`
command the UI calls. First launch, `node tools/m2-gate.mjs seed`:

```
PASS  the page reaches the real core — engine.status answered
PASS  chat.create wrote a conversation — c-1794871137780-0
PASS  appearance.theme was saved — light
PASS  models.active was saved — m2-gate-model
PASS  chat.list reads it back in this run — total 1
exit=0
```

App terminated (`taskkill /F /IM nexus-ai.exe`, PID 14296, then no `nexus-ai.exe` in
`tasklist`), relaunched, `node tools/m2-gate.mjs verify`:

```
PASS  the page reaches the real core — engine.status answered
PASS  the conversation survived the restart — total 1
PASS  settings survived the restart — light
PASS  the active model survived the restart — m2-gate-model
PASS  the UI painted the saved theme — html.light
PASS  store.backup wrote and verified a file — C:\Users\BS\AppData\Roaming\NexusAI\backups\nexus-backup-20261116231941-0.db
PASS  store.restore replaced the database — pre-restore C:\Users\BS\AppData\Roaming\NexusAI\backups\nexus-backup-20261116231942-3.db
PASS  row counts are identical after restore — 1 → 1
exit=0
```

The evidence file `.m2-gate.json` was written in both phases (gitignored).

**Kill during a write** is covered at the store level by
`a_killed_writer_leaves_a_clean_database` (§1): the test re-launches its own binary as a child
process (`--exact tests::crash_writer_child`), the child dies mid-transaction without
committing, and the reopened file passes `integrity_check` with exactly the one committed row.
It was **not** reproduced by killing the app process during a live generation in this run.

**Not re-run in this change:** the M1 live chain (`NEXUS_LIVE_ENGINE=1 … live_chat`) and
`tools/ui-gate.mjs`. The core's engine path was not modified except for the `chat_send`
restructuring around stored messages and the usage skip; those are covered by §2. The next
claimed engine/stream/stop/crash change must re-run both.

---

## 2026-11-16 — Post-M1 hardening (Chat honesty refinements)

Worktree `D:\NEXUS-AI-m1` at `daac7ee` plus the four `src/pages/Chat.tsx` refinements below.
`git status` reports no modification in `crates/` or `src-tauri/`: the core and shell are the
tagged implementation. A duplicate in-worktree rewrite was discarded, not shipped (D-038).

### 1. Core unit tests

```
> cargo test -p nexus-core
running 53 tests
test result: ok. 53 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.07s
```

Exit code 0.

### 2. Lints

```
> cargo clippy -p nexus-core --all-targets -- -D warnings
    Checking nexus-core v0.1.0 (D:\NEXUS-AI-m1\crates\nexus-core)
    Finished `dev` profile [unoptimized] target(s) in 10.52s
```

Exit code 0.

### 3. Live chain: load → stream → usage (real engine, real GGUF)

```
> NEXUS_LIVE_ENGINE=1 cargo test -p nexus-core live_chat -- --nocapture
loaded llama-3.2-3b-instruct-q4-k-m: {"contextCapped":8192,"loadedGB":2.3447265625,"readyMs":34556,"threads":3}
streamed "NEXUS OK" in 5 frames, private Some(ProcessMemory { working_set_mb: 4213, private_mb: 2403 })
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 52 filtered out; finished in 61.80s
```

Exit code 0. The test terminates the engine at the end; `tasklist` showed no `llama-server.exe`
afterwards. `readyMs` 34,556 is a cold load on this run.

### 4. Frontend

```
> npm run typecheck        → TYPECHECK_EXIT=0 (tsc --noEmit)
> npm run build            → ✓ built in 25.04s, BUILD_EXIT=0
  dist/assets/index-B5k_abZ7.js   436.41 kB │ gzip: 126.41 kB
```

### 5. Live UI gate — re-run after the Chat change

`npm run tauri dev` with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`,
then `node tools/ui-gate.mjs` from the repo root: **exit 0**, run window
`2026-11-16T22:09:53Z` → `22:12:03Z` (129 s). Steps copied from the driver log:

```
[host-detected]  {"isTauri":true,"waitedMs":4}
[ipc-direct]     {"engineStatus":{"installed":true,"running":false,"version":"b12189"},"models":[{"id":"llama-3.2-3b-instruct-q4-k-m","ctx":131072}]}
[chat-ready]     {"engineLine":"Local engine · Llama 3.2 3B Instruct · offline · nothing leaves this machine"}
[answer-complete]{"totalMs":63379,"text":"NEXUS OK","context":"122","error":null}
[stop]           {"msToStopClick":7313,"charsBeforeStop":1,"note":"Stopped — this answer is incomplete.","streamingAfter":false,"charsAfterSettle":1,"sendBack":true}
[engine-killed]  {"killOutput":"SUCCESS: The process \"llama-server.exe\" with PID 15616 has been terminated.","charsBefore":3,"banner":"engine.crashed: The local engine stopped while answering. The next message will restart it.","thinking":false,"messages":6,"failedNote":true,"waitedMs":2567}
[recovered]      {"ms":47223,"text":"RECOVERED"}
[network]        {"externalRequestCount":0}
consoleErrors    []
```

Screenshot `screenshots/m1-live-ui-gate.png`. `totalMs` 63,379 includes the cold model load,
because the gate sends before `engine.loadModel` returns; the rail then reports 122 measured
context tokens. Stop was pressed during prefill (1 character emitted) and nothing grew during the
2.5 s that followed.

One wrinkle the run exposed: at the stop check the rail read `Context usage (measured) 0 tokens /
8k window`. `chat.stop` ends the stream before any completion token, and the core still emits the
usage frame it has — which was empty. The number is what the core counted, not an invention, but
"measured 0" after a stop is misleading; recorded as TD-11 (do not emit usage when the stream was
cancelled).

---

## 2026-11-14 — M1 exit gate

### 1. Core unit tests

```
> cargo test -p nexus-core
...
test result: ok. 53 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.03s
```

Exit code 0. Run after the crash-detection fix in `engine.rs` / `dispatch.rs`.

### 2. Lints

```
> cargo clippy --workspace --all-targets -- -D warnings
    Checking nexus-core v0.1.0 (D:\NEXUS-AI-m1\crates\nexus-core)
    Checking nexus-ai v0.1.0 (D:\NEXUS-AI-m1\src-tauri)
    Finished `dev` profile [unoptimized] target(s) in 19.76s
```

Exit code 0. (PowerShell prints a `RemoteException` wrapper because cargo writes progress to
stderr; the `Finished` line and `$LASTEXITCODE` are the result.)

### 3. Frontend typecheck and production build

```
> npm run typecheck
> tsc --noEmit
TYPECHECK_EXIT=0

> npm run build
> tsc && vite build
vite v5.4.21 building for production...
✓ 1614 modules transformed.
dist/index.html                   0.97 kB │ gzip:   0.51 kB
dist/assets/index-BgVvcdRu.css   33.22 kB │ gzip:   6.79 kB
dist/assets/index-BbiCaZms.js   436.02 kB │ gzip: 126.28 kB
✓ built in 11.18s
BUILD_EXIT=0
```

### 4. Live UI gate — the real Tauri window, real engine, real kill

Command (second terminal, app already running with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`):

```
> node tools/ui-gate.mjs
```

Result: **exit 0**. Steps, quoted from `.ui-gate.json`
(run window `2026-11-14T13:28:27.327Z` → `2026-11-14T13:29:23.314Z`):

```
[host-detected]  {"isTauri":true,"waitedMs":4}
[ipc-direct]     engineStatus {"crashCount":0,"installed":true,"running":false,"version":"b12189"}
                 models [{"id":"llama-3.2-3b-instruct-q4-k-m","name":"Llama 3.2 3B Instruct","ctx":131072}]
[chat-ready]     {"engineLine":"Local engine · Llama 3.2 3B Instruct · offline · nothing leaves this machine"}
[stream-started] {"afterClickMs":31,"stopLabel":"Loading…"}
[first-characters] {"msSinceSend":21248,"text":"NEXUS"}
[answer-complete]  {"totalMs":22200,"text":"NEXUS OK","context":"122","error":null}
[stop]           {"msToStopClick":5780,"charsBeforeStop":1,
                  "note":"Stopped — this answer is incomplete.",
                  "streamingAfter":false,"charsAfterSettle":1,"sendBack":true}
[engine-killed]  {"killOutput":"SUCCESS: The process \"llama-server.exe\" with PID 2304 has been terminated.",
                  "charsBefore":3,
                  "banner":"engine.crashed: The local engine stopped while answering. The next message will restart it.",
                  "thinking":false,"failedNote":true,"waitedMs":1642}
[recovered]      {"ms":22258,"text":"RECOVERED","engineLine":"Local engine · Llama 3.2 3B Instruct · offline · nothing leaves this machine"}
[network]        {"externalRequestCount":0,"external":[]}
```

`"consoleErrors": []` — no renderer exception was logged during the run.
Screenshot: `screenshots/m1-live-ui-gate.png` (captured at
`2026-11-14T13:28:50.989Z`).

What each step proves:

| Step | Claim it substantiates |
| --- | --- |
| `answer-complete` | A prompt typed into the real composer streams a real answer (`NEXUS OK`) from the local model, and the rail reads 122 engine-counted tokens. |
| `stop` | Stop halts a real generation: text is 1 character when stopped and is **still 1** after 2.5 s; the bubble says `Stopped — this answer is incomplete.` |
| `engine-killed` | `taskkill /IM llama-server.exe /F` mid-answer produces `engine.crashed: The local engine stopped while answering. The next message will restart it.` The app survives (conversation count unchanged, renderer alive). |
| `recovered` | The next send restarts the engine and streams `RECOVERED`; no manual restart, no second app instance. |
| `network` | Zero requests left the machine during the whole run. |

### 5. Defects found by this session's gate, and their fix

**(a) Crash reported as `internal:` instead of `engine.crashed:`; recovery never restarted.**

Before the fix, the same gate produced:

```
[engine-killed] {"banner":"internal: A filesystem or socket call failed", ...}
GATE FAILED: Error: timeout waiting for recovered answer
```

Cause, measured with a direct CDP probe that killed `llama-server.exe` while tokens were streaming
and polled `engine.status` every few hundred ms:

```
kill: SUCCESS: The process "llama-server.exe" with PID 7768 has been terminated.
status +14ms   {"running":true,"crashCount":2}
status +110ms  {"running":true,"crashCount":2}
status +317ms  {"running":true,"crashCount":2}
status +816ms  {"running":true,"crashCount":2}
status +1511ms {"running":false,"crashCount":3}
chat.send      {"code":"internal","detail":"An existing connection was forcibly closed by the remote host. (os error 10054) — ConnectionReset"}
```

`Child::try_wait()` kept reporting the killed process as alive for ~1.5 s (0.8 s in a second run).
`chat.send` checked the handle immediately after the socket reset, concluded the engine was healthy,
and returned the raw I/O error. The next `start()` then reused the "already loaded" launch — a dead
port — and failed with `internal: Connecting to the engine failed`.

Fix: `Supervisor::serving()` probes `/health` on the launch port; reuse in `start()` requires
`refresh() && serving()`; a generation error with no serving engine calls
`Supervisor::mark_crashed()` (terminate, clear launch, count the crash exactly once) and returns
`engine.crashed`. Re-run above is the evidence.

**(b) Vite watcher crash during `npm run tauri dev` (`EBUSY` on `nexus_ai_lib.dll`).**
`vite.config.ts` now ignores `**/target/**`, `**/src-tauri/**`, `**/crates/**`; the dev server used
for the gate above ran for the whole session without that error.

**(c) UI claimed "UI prototype · Phase 1" and "measured 0" while live.**
The gate's `chat-ready` / `answer-complete` now show the live engine line and a measured rail only
after a usage frame (`context: "122"` above).

### 6. Not covered by this gate

- Conversation state is still in memory: closing the app loses chats (M2).
- The gate kills the engine with `taskkill`, not by crashing the renderer or the host.
- No installer, signing, or updater exists yet (`RELEASE_NOTES.md` says so).
- Only one model, one hardware profile, one run per step.

## 7. Font egress closed — vendored Inter / JetBrains Mono (2026-11-14)

The docs review found `index.html` still linked `fonts.googleapis.com` / `fonts.gstatic.com`, while
`SECURITY_MODEL.md` claimed no egress. The gate's `externalRequestCount: 0` could not settle it,
because WebView2 may have answered from its font cache. Rather than leave an unprovable claim, the
links were removed and both families are bundled.

```
> npm run build
vite v5.4.21 building for production...
...
dist/assets/inter-latin-wght-normal-Dx4kXJAl.woff2                48.26 kB
dist/assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2      40.40 kB
dist/assets/index-DatQnz7P.css                                   39.87 kB
dist/assets/index-DLzCpqWL.js                                   436.02 kB
✓ built in 13.31s
BUILD_EXIT=0
```

Built HTML contains no external URL:

```
> Select-String -Path dist\index.html -Pattern "https?://" -AllMatches
(no output)
```

Runtime check in the real window after `Page.reload({ignoreCache:true})`:

```
{
  "bodyFont": "\"Inter Variable\", Inter, \"Segoe UI\", system-ui, sans-serif",
  "monoFont": null,
  "interLoaded": true,
  "monoLoaded": true,
  "resources": [
    "http://ipc.localhost/ipc"
  ],
  "stylesheetHrefs": []
}
```

`resources` lists only Tauri's own loopback IPC bridge; no `fonts.*`, no CDN, no stylesheet link.
Font files on disk: 12 WOFF2, 302,728 bytes total. `monoFont: null` because the dashboard route
tested has no monospace element — `monoLoaded: true` is the direct check.

Recorded as D-037; closes KI-10 and TD-3.

## 8. Post-font confirmation of the M1 gate (2026-11-14)

The gate was re-run after the font change to prove the bundle swap did not disturb the chat path.
Run window `2026-11-14T14:01:27.702Z` → `14:02:22.939Z`, exit 0, same driver and same pinned engine
and model. Screenshot was written to a temporary path
(`%TEMP%\opencode\m1-post-font.png`) so the committed `screenshots/m1-live-ui-gate.png` stays the
original evidence image.

```
[stream-started]  {"afterClickMs":26,"stopLabel":"Loading…"}
[first-characters] {"msSinceSend":23778,"text":"NEXUS"}
[answer-complete] {"totalMs":24413,"text":"NEXUS OK","context":"122","error":null}
[stop]            {"charsBeforeStop":5,"note":"Stopped — this answer is incomplete.",
                   "streamingAfter":false,"charsAfterSettle":5,"sendBack":true}
[engine-killed]   {"killOutput":"SUCCESS: … PID 3640 …","charsBefore":7,
                   "banner":"engine.crashed: The local engine stopped while answering. The next message will restart it.",
                   "thinking":false,"failedNote":true,"waitedMs":1651}
[recovered]       {"ms":20427,"text":"RECOVERED"}
[network]         {"externalRequestCount":0,"external":[]}
```

`"consoleErrors": []`. The numbers differ from §4 only by run-to-run timing (24.4 s vs 22.2 s cold,
20.4 s vs 22.3 s recovery); the text and the contract errors are identical.

**A failed first attempt is itself evidence.** Before this run, free RAM was 1.3 GB because an
orphaned `llama-server` from the crash test was still resident. The app did not try to load anyway:
Chat answered `This model does not fit the memory free right now, so it was not loaded.` and the
gate failed at the next step because no generation had started. That is the fail-closed admission
rule behaving as specified; the orphan was terminated (`Stop-Process`), free RAM rose to 5.2 GB, the
window was reloaded, and the run above passed.


