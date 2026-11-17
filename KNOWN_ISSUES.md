# KNOWN_ISSUES.md — NEXUS AI

Known issues in the M1 build (`m1-first-answer`, `ba15fa2`). "Workaround" means something the
user can do today; "none" means the fix is scheduled work, not a setting. Impact is stated in
product terms, not as a severity score. Anything that was never measured says `not recorded`.

| ID | Issue | Impact | Workaround |
| --- | --- | --- | --- |
| KI-1 | No Content-Security-Policy in the WebView | Defence-in-depth gap | None |
| KI-2 | No installer, signing, notarization or updater | Cannot install or distribute | Run from source |
| KI-3 | Conversation state is in memory | **Resolved 2026-11-17 (M2)** — conversations and messages are stored in SQLite | — |
| KI-4 | Only the current turn is sent to the engine | **Resolved 2026-11-17 (M2)** — stored history is assembled and trimmed by budget | — |
| KI-5 | Context rail estimates before a usage frame | Number changes when the answer completes | Wait for completion |
| KI-6 | Crash report is reactive, and the partial answer is replaced | No background alert; streamed text lost | Send again |
| KI-7 | One engine instance; a model switch is a full reload | Switch costs 6–10 s warm / 38 s cold | Keep one model |
| KI-8 | First load is tens of seconds; Stop is disabled while loading | First prompt feels stuck | Wait |
| KI-9 | No regenerate | No retry-without-retype | Edit and resend |
| KI-10 | Google Fonts link contradicted the "0 external requests" gate result | **Resolved 2026-11-14** — fonts vendored, no external URL remains | — |
| KI-11 | Dashboard still shows Phase 1 copy in live mode | **Resolved 2026-11-17 (M2)** — welcome and model-card copy switch on the transport | — |
| KI-12 | Evidence covers one model, one hardware profile, one run per step | Behaviour on other machines is `not recorded` | None |

## KI-1 — No CSP in the WebView

`src-tauri/tauri.conf.json` sets `"security": { "csp": null }`. The window loads local assets
only, and the core exposes no fs/shell/http plugin, so there is no known injection path. A CSP
is still the right defence-in-depth if a renderer bug ever lets untrusted markup run.

**Impact:** no second line of defence in the WebView.
**Workaround:** none. Do not load untrusted HTML or remote content into the app.
**Tracked as:** TD-2.

## KI-2 — No installer, signing, notarization or updater

`bundle.active` is `false`; there is no MSI/NSIS artefact, no code-signing certificate, no
notarization step and no update mechanism. This release is source-run only. A locally built
unsigned executable would be exactly that — unsigned.

**Impact:** cannot be installed like a normal Windows program, cannot be distributed, and
Windows would not treat it as a trusted publisher.
**Workaround:** `npm run tauri dev` from the repo (`RELEASE_NOTES.md`).
**Target:** M6 (packaging and hardening).

## KI-3 — Conversation state is in memory — resolved in M2

The M1 build kept the conversation list and messages in `Chat.tsx` state. Since 2026-11-17
`chat.list/get/create/rename/setPinned/delete/clearMessages` are matched in the core and backed
by the `conversations` / `message` tables; the Chat screen reads them at mount. Evidence:
`TEST_RESULTS.md` §"2026-11-17 — M2 persistence" (§2 unit tests and §5 restart gate).
**Tracked as:** TD-9 (closed).

## KI-4 — Only the current turn is sent to the engine — resolved in M2

Since 2026-11-17 `chat.send` loads the stored messages of the conversation, prepends the system
prompt and sends every user/assistant turn, trimmed to the measured context budget minus the
answer allowance. A long conversation therefore loses its oldest turns first, which is the
documented behaviour of `trim_to_budget`, not a silent truncation of the newest question.
**Tracked as:** TD-10 (closed).

## KI-5 — The context rail estimates until the usage frame arrives

Before an answer completes, `Chat.tsx` computes `estimatedTokens` as total message characters
divided by 4. `contextMax` comes from the last usage frame, then the last `engine.loadModel`
result, then the model's advertised window. The rail title says "(estimated)" and the copy says
the engine reports exact tokens when an answer completes. Since M2 `chat.usage` is implemented
(it returns `measured: true` only when a stored usage row exists, otherwise an estimate), but
the Chat screen still derives the number from its own stream events rather than calling it. A
stopped stream stores no usage and emits no frame.

**Impact:** the displayed count can move when the answer completes; before any load, the rail
can show the model's advertised 131,072-token window while the numerator is a character
estimate.
**Workaround:** wait for the answer; the rail switches to "(measured)" and says the count came
from the engine's usage frame.
**Tracked as:** TD-12.

## KI-6 — Crash reporting is reactive, and the partial answer is replaced

There is no background health monitor. A crash during streaming is detected by the failed
request plus a `/health` probe; the recorded banner appeared **1,642 ms** after `taskkill`
(`TEST_RESULTS.md` §4), and the measured reason the probe exists is that `Child::try_wait()`
lags by 0.8–1.5 s (`MEASUREMENTS.md` §14). A crash while the app is idle is only noticed on the
next request. In `Chat.tsx`, the `fail()` path replaces the in-flight assistant bubble's content
with the error text, so tokens already streamed are not preserved as a partial answer.

**Impact:** no proactive alert; the partly written answer is lost when the engine dies.
**Workaround:** send the message again; the next send restarts the engine (recorded recovery
`RECOVERED`, 22,258 ms). The banner text is
`engine.crashed: The local engine stopped while answering. The next message will restart it.`
**Tracked as:** TD-11.

## KI-7 — One engine instance, so a model switch is a full reload

The engine is spawned single-instance with `-m <path>`. There is no unload or shutdown HTTP
route; `engine.unloadModel` and `engine.stop` terminate the process (D-035). Loading a
different model means a new process, a new weight read and a new KV allocation. Measured ready
time: **37,999 ms cold, 6–10 s warm** (`MEASUREMENTS.md` §3).

**Impact:** switching models feels like a hang on a cold file cache; the Chat copy warns that
the first load can take 30 s.
**Workaround:** keep one model resident for a session; switch deliberately.
**Tracked as:** TD-6.

## KI-8 — First-load latency, and Stop is disabled while loading

The first answer in the gate took **22,200 ms** end to end including spawn, weight load and
prefill (`MEASUREMENTS.md` §14); the engine alone was ready in 27,290 ms in the cold §13 run
and 37,999 ms in the §3 cold run. While the assistant message status is `loading`, the Chat
Stop button is disabled (`Chat.tsx`), so a cold load cannot be abandoned from the UI even
though the core's cancel flag would honour a Stop during load.

**Impact:** the first prompt after launch feels unresponsive, and there is no visible escape.
**Workaround:** wait; the button reads `Loading…` and then becomes `Stop` once streaming starts.
**Target:** a cancel affordance during load is a code change, not a docs change.

## KI-9 — No regenerate

`chat.regenerate` is in the contract but not in `dispatch.rs`. In live mode the button shows
the toast "Regenerate is not implemented in this build (chat.regenerate lands with M2)." In the
browser demo it regenerates a simulated reply.

**Impact:** no way to retry an answer without editing or resending the prompt.
**Workaround:** edit and resend, or start a new conversation.
**Target:** M2.

## KI-10 — Google Fonts link vs. the zero-external-request gate — RESOLVED 2026-11-14

**Was:** `index.html` requested `fonts.googleapis.com` / `fonts.gstatic.com` for Inter and
JetBrains Mono. The M1 gate recorded `"externalRequestCount": 0` (`TEST_RESULTS.md` §4), so one of
the two facts was wrong on a cold WebView cache; which one was never recorded.

**Fixed:** the external links are gone. The same families are bundled from
`@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` (12 WOFF2 files, 302,728 bytes
in `dist/assets/`), and `dist/index.html` contains no `http(s)://` URL at all. Tailwind now prefers
`Inter Variable` / `JetBrains Mono Variable` with the old families as fallback, so the approved look
is unchanged.

**Evidence:** `TEST_RESULTS.md` §7.
**Tracked as:** TD-3 (closed).

## KI-11 — Dashboard still shows Phase 1 copy in live mode

The Dashboard's active-model card still ends with "Selection is simulated — no model weights
are loaded in Phase 1", the model-availability card reads "0 / 10 models installed — none
are.", and the greeting says "Everything below is prototype data until Phase 2 connects the
engine." In a live Tauri session the same screen can show a real model from the registry. This
was found by reading `Dashboard.tsx`, not by the gate; the gate does not visit Dashboard.

**Impact:** an honesty regression on the first screen, of the same class the M1 gate caught in
the Topbar.
**Workaround:** trust Model Manager → Installed for the real list.
**Target:** a copy fix in a code task, not this documentation lane.

## KI-12 — Evidence scope

Every live claim in this build comes from one model (`Llama-3.2-3B-Instruct-Q4_K_M.gguf`), one
laptop (20.3 GB RAM, 3 physical cores), and one gate run per step. Behaviour on other models,
GPUs, RAM sizes or Windows builds is `not recorded`. The gate kills the engine with `taskkill`;
it does not crash the renderer or the host.

**Impact:** do not generalise the measured timings or the RAM line to another machine.
**Workaround:** none; re-measure before claiming.

## KI-13 — The folder watcher is one poll loop, and a slow tree delays every root

**What.** `KbMonitor::start` spawns exactly one thread (`nexus-kb-monitor`). Each tick it opens its
own `Store` connection, walks every watching root serially and re-indexes what changed, then sleeps
2 s. There is no per-file thread and no parallel scan. A tree whose walk plus parse takes longer
than a tick therefore delays changes in *all* watched roots, and the monitor connection shares the
WAL database with the UI's connection.
**Impact.** Change latency is "scan time + up to 2 s", not a fixed 2 s. Large trees are not
load-tested; 201 text documents is the largest recorded run.
**Workaround:** watch a subfolder rather than a whole drive.
**Target:** TD-19 (background job queue).

## KI-14 — A memory is captured only from an explicit request

**What.** `chat.send` proposes a `pending` memory only when the message starts with an explicit
English or Arabic "remember …" form (D-045). Ordinary statements of preference are not mined in
this build.
**Impact.** The Memory Center stays empty unless the owner asks in that form; nothing is
implicitly remembered.
**Workaround:** phrase the request explicitly ("remember that …" / "تذكر أن …").
**Target:** M5 (learning loop), if inference capture is added there.

## KI-15 — A watched folder is typed, not picked

**What.** The Knowledge screen accepts a typed absolute path; there is no native folder dialog.
A path with a typo fails with the core's error and indexes nothing.
**Impact.** Slower first setup; no accidental writes (the core only reads).
**Workaround:** paste the path from Explorer's address bar; surrounding quotes are stripped.
**Target:** TD-22 (Tauri dialog plugin at packaging time).

## KI-16 — "Vector" retrieval is a hashed bag of words, not semantics

**What.** D-043: 256-dimension FNV-1a token hashing plus cosine, fused with FTS5 by RRF. It ranks
overlapping vocabulary and word order; it does not understand paraphrase or synonyms. Arabic is
additionally degraded by FTS5's porter tokenizer, which stems English only.
**Impact.** A question with no shared words with the chunk will not retrieve it. Do not present
`measured: true` as "semantic search".
**Workaround:** include a distinctive term from the document in the question.
**Target:** TD-20 (local embedding model behind the same `embed`/`cosine` seam).

## KI-17 — Bulk documents add noise to retrieved context

**What.** The gate's 200 filler files were retrieved alongside the relevant document
(`filler-013`, `filler-000`, `filler-001` appeared in the citations next to `admission.md`). RRF
keeps ranking cheap, but nothing filters near-duplicate low-value chunks out of the prompt budget.
**Impact.** On a large flat tree, prompt tokens are spent on weak matches; the answer can be
distracted.
**Workaround:** watch focused folders; give documents distinct vocabulary.
**Target:** TD-21 (relevance floor and per-document diversity cap).

## KI-18 — First indexing of a large folder blocks the core

**What.** `kb.watchRoot` and `kb.reindex` are synchronous (D-046) and hold the core mutex while
they parse. A 201-file text tree completed inside the gate; a folder of large PDFs would make chat
wait.
**Impact.** UI commands that need the core queue behind the scan; the scan itself is not
cancellable.
**Workaround:** watch a small folder first; re-index single documents.
**Target:** TD-19 (background scan outside the core mutex).

## KI-19 — The Developer Agent cannot plan; it executes a script

**What.** `developer-agent` accepts an explicit one-line-per-call plan (D-051). Ask it in prose and
it answers `validation.field` naming the unrecognised line. No model is involved in choosing tools
or steps.
**Impact.** The screen's "Run a plan" panel is a task runner, not an assistant. The other seeded
agents refuse to run (`policy.not_allowed`).
**Workaround:** write the steps in the documented plan syntax.
**Target:** M5 (model planning that proposes the plan, still approval-gated).

## KI-20 — A running job cannot be cancelled

**What.** There is no `job.cancel`. A long `python.run` occupies the single slot until it finishes or
hits the 30 s timeout, and the UI has no stop control for it.
**Impact.** One runaway tool delays every queued job; the owner can only wait or close the app.
**Workaround:** keep scripts short; rely on the timeout.
**Target:** TD-23 (a cancel flag checked between steps and passed into the process supervisor).

## KI-21 — Approvals bind to an argument string, not to intent

**What.** The approval hash covers the tool id and a canonical serialisation of the arguments
(D-050). Two calls that mean the same thing but differ in whitespace inside a `fs.write` content
body are different approvals; an argument that the tool ignores still changes the hash.
**Impact.** Occasionally the owner is asked twice for what looks like the same action; conversely
an approval is never silently reused for different arguments.
**Workaround:** choose Always allow for an operation you will repeat.
**Target:** not scheduled; the conservative direction is deliberate.

## KI-22 — Skills remain prototype state

**What.** The Tools & Skills screen's Skills tab still shows seeded skills and states so, under a
live-only `DemoNotice`; `skill.*` commands are not implemented.
**Impact.** Only the Tools tab reflects real state. A skill row cannot be run.
**Workaround:** none needed; the notice is explicit.
**Target:** M5 (instruction versions) or later.

## KI-23 — The installer is unsigned, so SmartScreen warns on first launch

**What.** `NEXUS AI_0.1.0_x64-setup.exe` has no Authenticode signature. Windows shows "Windows
protected your PC" until the user chooses "More info → Run anyway"; the installed app is likewise
unsigned.
**Impact.** A first-time user who does not expect it may stop at the warning. There is no way to
verify the publisher from the file itself.
**Workaround:** compare the SHA-256 of the downloaded file with `SHA256SUMS.txt` in the release.
**Target:** a code-signing certificate before any wider distribution (TD-26).

## KI-24 — The first run needs internet and can take hours on a slow link

**What.** The installer contains no weights (D-053). On first launch the app downloads one pinned
GGUF file — 808 MB for 1B, 2.02 GB for 3B. Measured on this machine: 66–114 kB/s from
huggingface.co, i.e. 2–9 hours. A failure keeps the `.part` file and the next attempt resumes.
**Impact.** A user on a slow connection waits a long time, and the app is unusable until the file
is verified. If the link dies mid-transfer the owner must press Retry.
**Workaround:** let the download finish, or copy a matching GGUF into the models folder yourself
(`model.catalog` shows the exact file name).
**Target:** no end-to-end completed download exists on record yet; that is the open M6 evidence
gap (MEASUREMENTS §16).

## KI-25 — The bundled engine is the CPU build only

**What.** `tools/stage-engine.mjs` stages the cpu-x64 build (`b12189`) with every `ggml-cpu-*.dll`
kernel. There is no CUDA/Metal/Vulkan backend in the installer.
**Impact.** Decode speed is what §6 of `MEASUREMENTS.md` measured: CPU-only, 3B at single-digit
tokens/s on this laptop. Machines with a GPU cannot use it.
**Workaround:** none in-app; `NEXUS_ENGINE_DIR` can point at a GPU build during development.
**Target:** a separate GPU bundle, if the owner asks for one.
