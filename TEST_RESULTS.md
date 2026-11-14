# TEST_RESULTS.md — NEXUS AI

Evidence of record for every claim that something works. A result appears here only after the
command actually ran on this machine; output is copied, not paraphrased. Measurements (timings,
memory, tokens) live in `MEASUREMENTS.md`; this file records pass/fail and the exact command.

## Environment

| Item | Value |
| --- | --- |
| Machine | owner laptop, Windows, 20.3 GB physical RAM, 3 physical cores |
| Worktree | `D:\NEXUS-AI-m1`, branch `m1-first-answer` |
| Rust | 1.99.0 MSVC, `cargo clippy` from the same toolchain |
| Node | 24.17.0, npm with `vite` 5.4.21, `@tauri-apps/cli` 2.12.4 |
| WebView2 | 157.0.4341.46 |
| Engine | `D:\NEXUS-SIDECAR\b12189\llama-server.exe` (pinned b12189) |
| Model | `D:\NEXUS-MODELS\Llama-3.2-3B-Instruct-Q4_K_M.gguf` (only authorised file) |

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

