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
