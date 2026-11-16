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
