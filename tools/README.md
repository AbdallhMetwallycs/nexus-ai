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
