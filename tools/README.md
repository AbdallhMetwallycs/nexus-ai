# tools/

Developer tooling that runs against the real app. Nothing here is shipped to users.

## `ui-gate.mjs` — live UI gate

Drives the actual Tauri window over the WebView2 DevTools Protocol: types into the real
composer, clicks the real Send/Stop buttons, kills the real `llama-server.exe`, and records what
the renderer painted. It is evidence, not a unit test.

Prerequisites:

```powershell
# terminal 1 — app with DevTools enabled (port 9222 is often taken by a normal Chrome)
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"
npm run tauri dev

# terminal 2 — from the repo root
node tools/ui-gate.mjs
```

Outputs:

| Path | Contents |
| --- | --- |
| `.ui-gate.json` | every step with ISO timestamps (gitignored) |
| `screenshots/m1-live-ui-gate.png` | the real window after the first answer |

Steps it asserts: `answer-complete`, `stop` (no character growth 2.5 s after Stop), `engine-killed`
(banner reads `engine.crashed: …`), `recovered` (next send streams `RECOVERED`), and
`network.externalRequestCount === 0`.

Env overrides: `NEXUS_CDP_PORT`, `NEXUS_SHOT`, `NEXUS_GATE_OUT`.

Exit code 0 means every step completed. The evidence file is written on failure too, with `error`.

## m2-gate.mjs — persistence evidence (M2)

Calls the same `ipc` command the UI calls, from inside the running window, in two phases with a
real restart in between:

```powershell
# first launch (Vite on :5173 + the window with DevTools on 9333)
node tools/m2-gate.mjs seed
taskkill /F /IM nexus-ai.exe
# launch the app again
node tools/m2-gate.mjs verify
```

`seed` creates a conversation and writes `appearance.theme` and `models.active`. `verify` reads
them back after the restart, checks that the renderer painted `html.light`, then runs
`store.backup`, `store.restore` with the path the backup returned, and compares conversation row
counts before and after. It writes `.m2-gate.json` (gitignored) and exits 0 only when every step
passed. Env: `NEXUS_CDP_PORT`, `NEXUS_GATE_OUT`.

## m3-gate.mjs — knowledge and memory evidence (M3)

Runs in one launch against the real window and the real model. It writes a fixture tree
(`.m3-gate-tree/`: one `admission.md` and 200 `bulk/filler-NNN.md`), indexes it through
`kb.watchRoot`, then checks parsing, retrieval, rename handling, the chat citation path, the memory
approval gate, and both screens:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"
npm run tauri dev
node tools/m3-gate.mjs
```

What it asserts, in order: the fixture is indexed with a chunk count; `kb.search` cites the
document, reports `measured: true` and finishes in under a second over 201 documents; renaming the
file on disk updates the index without changing the total; `chat.send` answers with citations that
include the renamed file; an explicit "remember that …" message creates a pending memory that
`memory.search` cannot see until `memory.approve`; the Knowledge screen shows the live index with
no demo notice; the Chat screen paints a Sources row.

It writes `.m3-gate.json` (gitignored), deletes every row and memory it created, unwatches the
root and removes the fixture tree. Env: `NEXUS_CDP_PORT`, `NEXUS_GATE_OUT`. Exit 0 means every
step passed; the JSON is written on failure too.


## m4-gate.mjs — tools, permissions and approvals evidence (M4)

Runs in one launch against the real window; no model is loaded. It writes a fixture folder
(`.m4-gate-tree/notes` plus a secret file under `.m4-gate-tree/outside/`), watches the notes folder,
and drives the real tool pipeline:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"
npm run tauri dev
node tools/m4-gate.mjs
```

What it asserts, in order: the page reaches the real core and the Developer Agent is enabled;
`fs.write` is declared approval-gated and `kb.watchRoot` accepts the fixture; a three-step plan
(`fs.list`, `fs.write`, `fs.read`) parks at the write with a plain-language summary and the job
shows `queued / awaiting_approval`; approving once completes the task, `fs.read` returns the bytes
written, and the three steps plus all nine activity rows share one correlation id and the log names
start, tools and finish; rejecting a second plan stops it with `Nothing ran.`, marks the step
`denied`, leaves the next `pending` and writes no file; an absolute path outside every root is
denied as `policy.root_denied` without creating an approval; two queued `fs.list` jobs run in order
and appear in `job.list`; the Tools and Agents screens show live data with no demo notice; the
Activity Center lists the pending decision, expands it, offers Approve once / Always allow / Reject,
resumes the job from the UI, and the file exists afterwards; Always allow leaves a visible
`fs.write / always` standing grant.

It writes `.m4-gate.json` (gitignored), unwatches the folder and removes the fixture tree. Env:
`NEXUS_CDP_PORT`, `NEXUS_GATE_OUT`. Exit 0 means every step passed; the JSON is written on failure
too.

## `stage-engine.mjs` — put the engine in the installer

The installer ships `llama-server.exe` and the DLLs it actually loads, not the model weights
(D-053/D-055). This script copies them from the pinned build into the Tauri resource folder, then
runs the copied binary once to prove it starts:

```powershell
node tools/stage-engine.mjs
# or point at another build
$env:NEXUS_ENGINE_DIR="D:\some\other\build"; node tools/stage-engine.mjs
```

It wipes and recreates `src-tauri/resources/engine/` (gitignored), copies the ten files the
server needs plus every `ggml-cpu-*.dll` kernel variant (24 files, 44.7 MiB in the recorded run),
records `{ name, bytes, sha256 }` per file in `STAGING.json`, and exits non-zero if
`llama-server.exe --version` fails or prints nothing. Order matters: stage the engine first, then
`npm run tauri build` — the bundle maps `resources/engine/` to `engine/` beside the exe.

## `m6-gate.mjs` — packaging, first run and uninstall evidence (M6)

Installs the produced NSIS setup silently into a scratch folder, launches the installed binary,
and drives its window over the DevTools Protocol. It does not use `tauri dev`:

```powershell
node tools/stage-engine.mjs
npm run tauri build
node tools/m6-gate.mjs                 # install, first run, download start + cancel, real answer, uninstall
node tools/m6-gate.mjs --no-answer     # skip the chat phase (no weights needed)
```

What it asserts, in order: the setup file exists (`target/release/bundle/nsis/*-setup.exe`) and its
SHA-256 is recorded; `/S /D=<scratch>` installs with exit 0 and `engine\llama-server.exe` is present
where `default_engine_dir` looks; a fresh profile with an empty models folder opens the first-run
screen whose recommendation matches `model.catalog` (the RAM floor of the real machine); the
licence tick enables the download and a `.part` starts growing; cancel deletes it and the screen
says so; with real weights it answers through the bundled engine and `engine.status` reports that
binary's path; the uninstaller removes the install folder and leaves the weights folder alone.

A download still transferring when the watch window ends is recorded as `SKIP`, never as a pass —
the file only becomes a model after its SHA-256 matches (this is what happened in the recorded run:
66 kB/s, so 2.02 GB did not finish). It writes `.m6-gate.json` (gitignored) and
`screenshots/m6-installed-first-run.png`. Env: `NEXUS_SETUP`, `NEXUS_CDP_PORT`, `NEXUS_GATE_OUT`,
`NEXUS_M6_DIR`, `NEXUS_M6_WEIGHTS`, `NEXUS_M6_DOWNLOAD_MS`, and `NEXUS_M6_KEEP=1` to keep the
install and scratch folders. Exit 0 means every step that ran passed.
