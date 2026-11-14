# NEXUS AI — M1 release notes

**Release:** 0.1.0 (M1) · **Tag:** `m1-first-answer` (`ba15fa2`) · **Date:** 2026-11-14  
**Platform:** Windows, source-run only.

> ## This release is not installable.
>
> There is **no installer**, **no code signing**, **no notarization**, and **no updater**.
> `src-tauri/tauri.conf.json` has `"bundle.active": false`. Nothing here has been packaged,
> signed or published. Do not distribute it as a Windows application; run it from source as
> described below.

## What M1 is

NEXUS AI now answers a prompt with a real local model. The approved Phase 1 Chat screen keeps
its layout; behind it, a Rust core starts the pinned `llama-server.exe` sidecar, admits the
model against measured RAM, streams real tokens, stops on request, and survives the engine
being killed. Nothing leaves the machine in the measured runs.

What the M1 gate actually recorded (`TEST_RESULTS.md` §4, `MEASUREMENTS.md` §14):

- A typed prompt streamed `NEXUS OK` from the local 3B model in 22.2 s cold, including process
  spawn, weight load and prefill. The context rail read **122** engine-counted tokens.
- Stop halted generation at 1 character; 2.5 s later it was still 1 character.
- `taskkill /IM llama-server.exe /F` mid-answer produced
  `engine.crashed: The local engine stopped while answering. The next message will restart it.`
  in 1,642 ms. The app stayed up.
- The next message restarted the engine and streamed `RECOVERED` in 22.3 s.
- 0 external requests and 0 renderer console errors during the gate run.

## Run it from source

Prerequisites, as recorded in `TEST_RESULTS.md` → Environment and `AGENTS.md`:

- Windows with WebView2 (157.0.4341.46 was used).
- Node 24.17.0 and npm.
- Rust MSVC toolchain 1.99.0 and the C++ build tools.
- The pinned engine at `D:\NEXUS-SIDECAR\b12189\llama-server.exe` (override
  `NEXUS_ENGINE_DIR`).
- The authorised model at `D:\NEXUS-MODELS\Llama-3.2-3B-Instruct-Q4_K_M.gguf` (override
  `NEXUS_MODELS_DIR`). No other weights are authorised.

```powershell
cd D:\NEXUS-AI-m1
npm install
npm run tauri dev
```

`npm run dev` alone opens the browser build, which is the Phase 1 demo and has no engine; it
must say so on screen.

The first load is slow by measurement, not by accident: 37,999 ms cold and 6–10 s warm in
`MEASUREMENTS.md` §3. The Chat UI shows `Loading…` while the engine starts.

## What works

- Chat: load, send, stream, Stop, engine-counted context usage, crash banner and recovery.
- Model Manager → Installed: real GGUF files with real metadata; "Set active" loads through
  the measured RAM admission check.
- Topbar and context rail report live state instead of Phase 1 labels.
- The engine is terminated when the window closes; it does not linger holding memory.

## What does not work yet

- **Nothing persists.** Conversations are React memory and are lost when the app closes.
  Active model and theme survive in `localStorage` (`DATA_AND_BACKUP_STRATEGY.md` §1).
- **No regenerate.** The button refuses in live mode with a toast; it lands with M2.
- **No multi-turn context.** Each send gives the engine the system prompt and the current
  message only; earlier turns stay on screen but are not sent.
- **Every other screen is still the Phase 1 demo**, labelled with `DemoNotice`. See
  `IMPLEMENTATION_STATUS.md`.
- **No installer, signing, notarization or updater** (above).
- **No CSP** in the WebView, and the HTML still links Google Fonts even though the gate
  recorded 0 external requests. Both are tracked in `KNOWN_ISSUES.md`.
- Only one model, one hardware profile, one run per gate step.

## Privacy and limits

The engine is spawned with `--host 127.0.0.1`, an ephemeral port, a fresh per-launch bearer
token and `--offline`. The measured network census showed zero non-loopback sockets
(`MEASUREMENTS.md` §9) and the UI gate counted zero external requests. That is evidence for
the runs that were sampled, not a proof against every code path. The app is not hardened
against a process already running as the same Windows user (`SECURITY_MODEL.md` §1).

## If something goes wrong

- Read the error code in the Chat banner. `engine.crashed:` means the engine died and the next
  send will restart it; `internal:` means the core could not classify the failure.
- Re-run the recorded checks: `cargo test -p nexus-core`, `cargo clippy --workspace
  --all-targets -- -D warnings`, `npm run typecheck`, `npm run build`.
- Re-run the live gate with `node tools/ui-gate.mjs` while `npm run tauri dev` is running with
  WebView2 DevTools on port 9333 (`AGENTS.md` → "Live UI gate").
