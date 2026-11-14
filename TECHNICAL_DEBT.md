# TECHNICAL_DEBT.md — NEXUS AI

Numbered debt in the M1 build (`m1-first-answer`, `ba15fa2`). Debt here is a deliberate
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
| TD-9 | Conversation state is in memory | M2 (next milestone) |
| TD-10 | Only the system prompt and current turn are sent | First multi-turn claim, or M2 |
| TD-11 | Crash mapping has no unit test with a fake dead supervisor | CI, or the next change to crash detection |
| TD-12 | Context rail estimates; `chat.usage` is unimplemented | Any pre-answer context warning |
| TD-13 | `chat.stop` is global, with two code paths | Scheduler or concurrent conversations (M4) |
| TD-14 | Context bounds are literals outside `admission` | Changing context limits or exposing a setting |
| TD-15 | Engine stdout/stderr is discarded; no structured log | First field bug that needs engine output |
| TD-16 | The UI gate is manual and needs a running app | CI or nightly regression |

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

## TD-9 — Conversation state is in memory

**What.** `Chat.tsx` owns conversations and messages. The core has no `chat.list/get/create/
rename/setPinned/delete/clearMessages` implementation.
**Why it exists.** M1's deliverable is one real answer, not persistence; the M2 schema and the
IPC shapes already exist (`PHASE2_DATA_MODEL.md`, `PHASE2_IPC_CONTRACT.md` §3.3).
**Trigger.** M2, which is the next milestone. Any feature that assumes history (memory,
knowledge citations, activity) is blocked on it.
**Related.** KI-3.

## TD-10 — Only the system prompt and current turn are sent

**What.** `chat.send` builds two messages: `SYSTEM_PROMPT` and the current user content.
Earlier turns remain in React state but never reach the engine. `trim_to_budget` exists but has
no conversation to trim.
**Why it exists.** It is the smallest honest M1 prompt path; there is no store to assemble a
conversation from, and prefill is the measured product constraint.
**Trigger.** The first multi-turn product claim, or M2 when message rows exist. The prompt
budget must then be assembled from the store and trimmed by measured tokens, not characters.
**Related.** KI-4.

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

## TD-12 — Context rail estimates; `chat.usage` is unimplemented

**What.** Before the usage frame, the rail uses characters ÷ 4 for the numerator and the last
load result or advertised window for the denominator. `chat.usage` exists in the contract but
returns `not_implemented`.
**Why it exists.** M1 has one event after generation and no per-conversation usage record; a
request-time number would need the tokenizer or the engine's slot state, neither of which is
wired.
**Trigger.** A UI that must warn before sending (context budget, truncation warning), or M2
when usage can be stored.
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
