# TECHNICAL_DEBT.md — NEXUS AI

Numbered debt in the M2 build (`m2-persistence`, 2026-11-17). Debt here is a deliberate
trade-off with a named trigger, not a to-do list. "Trigger" is the event that makes the debt
more expensive than the fix.

| ID | Debt | Trigger to pay it down |
| --- | --- | --- |
| TD-1 | No installer, signing, notarization or updater | First distribution beyond this machine |
| TD-2 | No CSP in the WebView | Any remote/untrusted content, or before an installer |
| TD-3 | External Google Fonts link | **Resolved 2026-11-14** — fonts vendored |
| TD-4 | No signature verification for the engine binary | Before shipping, or on any engine update |
| TD-5 | No OS secret store; per-launch API key lives in memory | First persistent secret |
| TD-6 | Single engine instance; model switch is a full reload | Multi-model UX, or switch cost becomes a blocker |
| TD-7 | Hand-written HTTP/1.1 client instead of a crate | First TLS/proxy/redirect need, or a framing bug |
| TD-8 | `readyMs` means load-to-health, and is stale on reuse | A second consumer reads it |
| TD-9 | Conversation state is in memory | **Resolved 2026-11-17 (M2)** — SQLite store behind `chat.*` |
| TD-10 | Only the system prompt and current turn are sent | **Resolved 2026-11-17 (M2)** — stored history, trimmed by budget |
| TD-11 | Crash mapping has no unit test with a fake dead supervisor | CI, or the next change to crash detection |
| TD-12 | Context rail still estimates locally, though `chat.usage` now exists | Any pre-answer context warning |
| TD-13 | `chat.stop` is global, with two code paths | Scheduler or concurrent conversations (M4) |
| TD-14 | Context bounds are literals outside `admission` | Changing context limits or exposing a setting |
| TD-15 | Engine stdout/stderr is discarded; no structured log | First field bug that needs engine output |
| TD-16 | The UI gate is manual and needs a running app | CI or nightly regression |
| TD-17 | `npm audit` reports 4 advisories (3 moderate, 1 high), all in build/dev tooling except react-router | Before M6 packaging, or when routing accepts external URLs |
| TD-18 | A stopped stream emits a usage frame of zero | **Resolved 2026-11-17 (M2)** — cancelled streams emit no frame and store no counts |

## TD-1 — No installer, signing, notarization or updater

**What.** `src-tauri/tauri.conf.json` has `"bundle.active": false`. There is no MSI/NSIS
artefact, no signing identity, no notarization step and no update channel.
**Why it exists.** Packaging is M6; the owner has not chosen a signing identity or a
distribution path, and inventing one earlier would lock in a trust decision that belongs to
the owner (`MASTER_PROJECT_PLAN.md` §9).
**Trigger.** The first time the app is meant to run on a machine other than this one, or the
first security fix that must reach an installed copy.

## TD-2 — No CSP in the WebView

**What.** `"security": { "csp": null }`. The window loads local assets and has no fs/shell/
http plugin capability, but there is no Content-Security-Policy.
**Why it exists.** Phase 1 had no CSP; M1 added the shell without changing the approved UI
surface, and a CSP needs to be written against the actual asset and IPC origins rather than
guessed.
**Trigger.** Before any installer, or the moment the WebView renders anything not shipped in
`dist/`.
**Related.** KI-1, `SECURITY_MODEL.md` §4.1.

## TD-3 — External Google Fonts link — RESOLVED 2026-11-14

**Was.** `index.html` requested `fonts.googleapis.com` and `fonts.gstatic.com` for Inter and
JetBrains Mono, contradicting the offline-first runtime (KI-10).
**Fixed.** Both families are bundled from `@fontsource-variable/*`; the built HTML contains no
external URL. See `TEST_RESULTS.md` §7.
**Kept here** because the font files and the Tailwind family names are still a maintenance surface:
a future font change must stay inside the bundle.

## TD-4 — No signature verification for the engine binary

**What.** b12189 is pinned by asset name, SHA-256 and MD5, and the hash is our own baseline
(D-030). There is no signature check before the supervisor spawns `llama-server.exe`.
**Why it exists.** The release API returned no digest for the assets, and no signature
mechanism has been chosen. HTTPS plus the exact asset name is the current provenance story,
and `SECURITY_MODEL.md` §4.5 says so rather than overclaiming.
**Trigger.** Before an installer ships, or on any engine update.

## TD-5 — No OS secret store; the per-launch API key stays in memory

**What.** The engine token is 32 random bytes as hex, generated per launch, sent as
`--api-key`, and held only in the `Launch` record in process memory. Nothing is written to
Windows Credential Manager or DPAPI.
**Why it exists.** There is no persistent secret to protect yet, and not persisting the token
is safer than storing it. A secret store becomes relevant only when the product holds a
credential it must reuse.
**Trigger.** The first persistent secret: a provider key, a user credential, an encryption key
for the M2 store, or a signed-update token.

## TD-6 — Single engine instance; a model switch is a full reload

**What.** One `llama-server.exe` at a time, spawned with `-m <path>`. There is no unload route,
so `engine.unloadModel` and `engine.stop` terminate the process (D-035). A switch re-reads the
weights and reallocates the KV cache.
**Why it exists.** On a 20.3 GB laptop with a measured ~1.5 GB fixed + 0.1106 MB/token cost,
keeping two models resident is the fastest way to swap. The engine also offers no unload call.
**Trigger.** A product requirement for fast A/B model switching, or a measured switch cost that
users stop tolerating. The likely fix is a warm-start cache or a second process with its own
admission budget, not a hidden reload.
**Related.** KI-7, `MEASUREMENTS.md` §3 and §10.

## TD-7 — Hand-written HTTP/1.1 client instead of a crate

**What.** `crates/nexus-core/src/net.rs` implements request writing, response parsing, chunked
transfer and SSE framing on `std::net`.
**Why it exists.** The engine lives on plain loopback HTTP with a bearer token. A
reqwest/hyper tree brings hundreds of crates for TLS, pools and redirects that this path does
not use, on a machine whose whole budget is 15 W. The file documents the measured behaviours
that shape it: `/health` needs no key, and closing the socket is the cancel path.
**Trigger.** The first non-loopback, TLS, proxy or redirect requirement; or an HTTP framing bug
that a maintained client would have prevented. Do not replace it for style.

## TD-8 — `readyMs` means load-to-health, and is stale on reuse

**What.** `ModelLoadResult.readyMs` is the time from spawn to the first successful `/health`
answer. When `start()` reuses an already-serving launch it returns that launch's original
`ready_ms`, not `0` or a fresh measurement.
**Why it exists.** The field was shaped for the first-load UI message; the reuse path needed to
return a complete result without pretending a reload happened.
**Trigger.** A second consumer reads it (telemetry, benchmark view, Settings), or the UI starts
showing "loaded in X ms" on a switch. At that point split it into `loadedAt` / `lastReadyMs` or
return `readyMs: 0` with an explicit `reused: true`.

## TD-9 — Conversation state is in memory — resolved in M2

Closed 2026-11-17. The store crate owns `conversations`, `message` and `message_attachment`;
`chat.list/get/create/rename/setPinned/delete/clearMessages` are matched in the core and the
Chat screen reads them at mount. Backups copy the same rows. Evidence: `TEST_RESULTS.md`
2026-11-17 §2 and §5.

## TD-10 — Only the system prompt and current turn are sent — resolved in M2

Closed 2026-11-17. `chat.send` reads the stored messages, maps them to user/assistant turns,
and trims the assembled prompt to `context − answer allowance` with the measured token rule,
so earlier turns reach the engine until the budget is exhausted.
**Related.** KI-4 (closed).

## TD-11 — Crash mapping has no unit test with a fake dead supervisor

**What.** The `try_wait`-lags-`taskkill` behaviour is covered by the live gate and a CDP probe,
not by a unit test with a fake supervisor. Live tests are opt-in (`NEXUS_LIVE_ENGINE=1`) and
spawn the real engine.
**Why it exists.** The defect only reproduced with a real external kill on this Windows build;
the fix landed with the measured evidence rather than a mock that could encode the same wrong
assumption.
**Trigger.** CI, or the next change to `Supervisor::serving()`, `refresh()` or
`mark_crashed()`. Add a fake supervisor that reports "handle alive, health dead" and assert
`engine.crashed` exactly once.
**Related.** WORK_QUEUE rows 25–27.

## TD-12 — The context rail still estimates locally

**What.** Before and during an answer the rail uses characters ÷ 4 for the numerator and the
last load result or advertised window for the denominator. `chat.usage` is now implemented
(2026-11-17) and returns `measured: true` only when a stored usage row exists, but `Chat.tsx`
still derives its number from stream events instead of calling it.
**Why it exists.** M1 shipped the rail before the store; M2 needed the database wired first and
did not rewrite the rail. The emitted `chat://usage` event after a completed answer is still the
only measured number the rail shows.
**Trigger.** A pre-send context warning, or the first time the rail and `chat.usage` disagree.
Then call `chat.usage` on load and after each turn and delete the character estimate from the
renderer.
**Related.** KI-5.

## TD-13 — `chat.stop` is global, with two code paths

**What.** The Tauri host intercepts `chat.stop` and cancels one global `CancelFlag`; the
dispatch arm does the same for tests. `conversationId` is informational because M1 runs one
generation at a time.
**Why it exists.** ADR-002 needs Stop to work without taking the mutex, and one generation is
the hardware reality today.
**Trigger.** M4's scheduler, or any concurrent/multi-window chat. The flag must become
conversation-scoped, and the host interception must stop duplicating the dispatch arm.

## TD-14 — Context bounds are literals outside `admission`

**What.** `engine.rs` clamps with `context.clamp(2_048, 32_768)`, duplicating
`admission::MIN_CONTEXT` and `admission::MAX_CONTEXT`. `Chat.tsx` also hardcodes `32_768` as a
display fallback. The model-load default is **not** duplicated: `dispatch.rs` passes
`admission::DEFAULT_CONTEXT` (verified in this pass; the admission↔dispatch duplicate in
WORK_QUEUE row 24 is gone).
**Why it exists.** `engine.rs` avoids importing admission for two bounds it "knows" are the
same, and the UI fallback predates the constants.
**Trigger.** Any change to the context ladder or limits, or the first Settings control that
lets the owner pick a context size. Then export one set of constants to the shell and use them
in both places.

## TD-15 — Engine output is discarded; no structured log

**What.** The supervisor sets the child's stdout/stderr to null because the engine's output can
contain the absolute model path (`engine.rs`). The app logs lifecycle events only.
**Why it exists.** The privacy rule in `ARCHITECTURE.md` §5 outweighs diagnosability at M1;
the exit code and measured timing are enough to classify the failures seen so far.
**Trigger.** The first field bug that cannot be classified from the contract error and timing.
The fix is a privacy-safe ring buffer or a log that redacts paths, not simply turning stderr
back on.

## TD-16 — The UI gate is manual

**What.** `tools/ui-gate.mjs` needs `npm run tauri dev` with WebView2 DevTools on a chosen
port, and it kills the real engine. It is evidence, not an automated test.
**Why it exists.** The gate's value is that it drives the real window and the real process; a
headless substitute would have missed both M1 defects (the Vite `EBUSY` crash and the
`try_wait` lag).
**Trigger.** CI or a nightly regression machine that can run a real WebView2 and a real model.
Until then, keep it in the pre-tag checklist (`AGENTS.md`).

## TD-17 — Dependency advisories reported by `npm audit`

**What.** `npm install` on 2026-11-14 reported **4 vulnerabilities (3 moderate, 1 high)**. Triage
from `npm audit --json`:

| Package | Severity | Advisory surface |
| --- | --- | --- |
| `vite` (≤6.4.3) | high | dev-server middleware, `server.fs.deny` bypass on Windows, and `launch-editor` UNC/argument handling |
| `esbuild` (≤0.24.2, via Vite) | moderate | dev server lets a website send requests to it and read responses |
| `react-router` / `react-router-dom` (6.0.0–7.17.0) | moderate | open redirect via backslash in `<Link>`/`useNavigate`; SSR hydration `deserializeErrors()` injection |

**Why it exists.** The dev toolchain is pinned to Vite 5 (`package.json`) and react-router is the
approved Phase 1 UI dependency. Both are pinned deliberately; a major upgrade is not a hygiene edit.
Vite/esbuild advisories concern a development server bound to this machine, not code that ships in
the bundle. The react-router advisories need either SSR (this app has none) or navigation to an
attacker-supplied URL (routes are static and reached by an in-app hash).
**Trigger.** Before M6 packaging, before any installer, or the first time a route or redirect takes
an externally supplied URL. Then upgrade Vite (major) and react-router together and re-run
`npm run build`, `npm run typecheck` and the UI gate.

**Verified-not-fixed:** this row records the audit output; nothing was upgraded in M1.

## TD-18 — A stopped stream still emits a usage frame of zero — resolved in M2

Closed 2026-11-17. `chat.send` distinguishes a cancelled outcome: it stores the partial answer
with `stopped = true`, no prompt/completion counts, and emits no `chat://usage` frame. A stopped
turn therefore never presents a measured zero.


## TD-19 — Indexing runs synchronously inside the core mutex

**What.** `kb.watchRoot` and `kb.reindex` scan and parse inside the `ipc` call while holding the
core mutex (D-046); the poll monitor is the only background indexing, and it re-scans whole roots.
**Why it exists.** There is no job queue until M4's scheduler, and returning a `jobId` for work
that had not started would be the fake functionality the project forbids.
**Trigger.** The first folder with large PDFs, or any second consumer of the core during a scan.
Then: a real job queue (M4), scan work moved off the mutex, and progress events (`job://progress`
is already in the contract).
**Verified-not-fixed:** the 201-file text tree in the M3 gate is the largest measured scan.

## TD-20 — Retrieval has no learned embedding model

**What.** The vector half of retrieval is a 256-dimension hash of tokens with cosine similarity
(D-043), fused with FTS5 by RRF. It is lexical, not semantic, and FTS5's porter stemmer helps
English only.
**Why it exists.** A second GGUF embedding model would need another admission budget and a
download, both outside this milestone.
**Trigger.** When answers miss documents that share meaning but not words, or when Arabic search
is part of the acceptance bar. Then: a local embedding model behind the existing `embed`/`cosine`
functions in `crates/nexus-kb`, with its admission measured like the chat model.
**Verified-not-fixed:** `measured: true` currently means "every chunk has a stored vector", not
"a semantic model ran".

## TD-21 — No relevance floor or diversity cap in retrieved context

**What.** `chat.send` takes the top chunks and memories by fused score and puts them in the prompt
without a minimum score and without limiting how many chunks come from one document. The M3 gate
retrieved three filler files next to the relevant one.
**Why it exists.** Any threshold chosen before measuring on real owner documents would be a guess.
**Trigger.** When the prompt budget is routinely spent on weak matches, or when answers start
quoting filler. Then: measure score distributions on the owner's tree, set a floor, and cap
per-document contributions.
**Verified-not-fixed:** the gate recorded the noise (`KI-17`); nothing filters it yet.

## TD-22 — No native folder picker

**What.** The Knowledge screen takes a typed path because adding a dialog plugin adds a Tauri
permission surface that M6 packaging has not designed yet.
**Why it exists.** `withGlobalTauri` and the single `ipc` command are deliberately the whole
bridge; a dialog plugin is a second bridge.
**Trigger.** Packaging (M6), or the first non-technical user of the Knowledge screen.
**Verified-not-fixed:** `WatchFolderModal` accepts a path string only.

## TD-23 — No cancellation path for a queued or running job

**What.** The scheduler has no shared cancel flag and no `job.cancel` command; a step in
`awaiting_approval` can only be resolved by deciding, and a running process is bounded only by the
30 s timeout.
**Why it exists.** M4's exit gate is about permissions and approvals; cancellation without a UI
contract would have been a dead control, which the project forbids.
**Trigger.** The first time a tool overruns and the owner asks to stop it, or before any tool whose
timeout is longer than a minute. Then: a flag checked between steps and a terminate path in the
process supervisor, plus a Stop control that says what it will kill.
**Verified-not-fixed:** the Activity Center shows a running job but offers no stop button.

## TD-24 — Approvals arrive only by polling

**What.** The Activity Center reloads `approval.pending` when it mounts or a decision is made; there
is no `approval://requested` event pushing the request into the UI, and no OS notification.
**Why it exists.** The event bridge currently carries only `chat://token`, `chat://usage` and
`model://state`; adding an approval event is a contract change that deserves its own review.
**Trigger.** When a job can be started from a screen other than Agents, or the window is often
minimised while the agent runs. Then: an `approval://pending` event plus a tray notification, with
the menu item counting undecided requests.
**Verified-not-fixed:** a pending approval is invisible to a screen that was not reloaded after the
job parked.

## TD-25 — The plan grammar is fixed and shallow

**What.** The Developer Agent plan accepts five verbs (`fs.list`, `fs.read`, `fs.write`,
`python.run`, `powershell.run`) with no variables, no output piping and no conditionals. A step
cannot use the result of a previous step.
**Why it exists.** M4 needed a deterministic, testable executor; a richer language would have been
designed before any real task needed it.
**Trigger.** The first task that needs "read this list, then act on each entry". Then: step outputs
addressable by name, still executed one call per line and still gated.
**Verified-not-fixed:** the gate's three-step plan passes a literal filename it was given.
