# SECURITY_MODEL.md — NEXUS AI

**Status:** current for Phase 2 M1 (2026-11-12). Updated when a trust boundary, permission, or
storage location changes.
**Companion docs:** `PHASE2_POLICY_MODEL.md` (what the product is allowed to do on the owner's
behalf), `DATA_AND_BACKUP_STRATEGY.md` (what is stored and how it is protected), `DECISION_LOG.md`
(D-035/D-036 for the engine-surface findings).

## 1. What we are protecting

| Asset | Where it lives today | Sensitivity |
| --- | --- | --- |
| Prompts, answers, conversation state | Renderer memory only (M1); SQLite planned in M2 | High — private user text |
| Model weights | `D:\NEXUS-MODELS\*.gguf`, owner-visible files | Medium — replaceable, not secret |
| Engine binary | `D:\NEXUS-SIDECAR\b12189\llama-server.exe` | Medium — executable code we run |
| App settings / active model | `localStorage` in the WebView profile | Low |
| Application data | No database yet; M2 introduces `%APPDATA%\ai.nexus.local\` | High once it exists |

**Explicit non-goal:** protecting data from a process already running as the same Windows user. Any
such process can read the same files and memory. The model defends against *network* exposure and
against *accidental* leakage, not against local malware.

## 2. Trust boundaries

```
[ React UI in WebView2 ]  --Tauri IPC (one command: ipc)-->  [ nexus-core (Rust) ]
          |                                                        |
          |  no direct network, no fs/shell plugin                  |  loopback HTTP + SSE
          v                                                        v
   approved UI assets only                              [ llama-server.exe, 127.0.0.1:<ephemeral> ]
```

1. **WebView → core.** The window gets `core:default` only (`src-tauri/capabilities/default.json`).
   No `fs`, `shell`, `http`, or `dialog` plugin permissions are granted. Every capability the UI
   has is therefore whatever `nexus_core::dispatch::Core` chooses to expose; the dotted contract is
   enforced in one Rust `match`.
2. **Core → engine.** The engine is started with `--host 127.0.0.1`, an OS-assigned ephemeral port,
   and `--api-key <32 random bytes, hex, fresh per launch>`. It cannot be reached from another host,
   and another local process cannot casually drive it without the token.
3. **Engine → disk.** The engine reads one GGUF file and writes no user data. Its stdout/stderr is
   captured by the supervisor; only readiness and errors are surfaced.

## 3. Controls that are actually implemented

| Control | Evidence |
| --- | --- |
| Loopback-only engine bind | `engine.rs` argv: `--host 127.0.0.1`; port chosen by binding `127.0.0.1:0` |
| Per-launch bearer token on all routes except `/health` | `--api-key`; `launcher_token()` is 32 random bytes as hex and tested to differ per launch (`tokens_are_32_bytes_of_hex_and_differ_per_launch`) |
| No network egress from the app | No HTTP client dependency in the workspace except the hand-written loopback client in `net.rs`; verified at runtime by a CDP network capture during the M1 UI gate (recorded in `MEASUREMENTS.md` §14) |
| No shell / filesystem / http plugin in the shell | `src-tauri/Cargo.toml`, `capabilities/default.json` |
| Engine dies with the app | `RunEvent::Exit` cancels work, then `supervisor.stop()` terminates the child (`src-tauri/src/lib.rs`) |
| Fail-closed admission | If free/RAM status cannot be read, the load is refused rather than guessed (`admission.rs`) |
| No secrets in the repo | `.gitignore` covers `.env*`, `*.key`, `*.pem`; the engine token is generated at launch and never persisted |

## 4. Known gaps (tracked, not hidden)

1. **No CSP.** `tauri.conf.json` has `"csp": null`. The renderer loads only local assets, but a CSP
   is the right defence-in-depth for a WebView. Tracked in `TECHNICAL_DEBT.md` (TD-2).
2. **No signed binaries or updater.** `bundle.active` is `false`; packaging and signing are M6.
   Until then, the executable you run is whatever you built locally.
3. **No encryption at rest.** M2's SQLite database will be plaintext under the user profile. The
   plan is documented in `DATA_AND_BACKUP_STRATEGY.md`; OS-level disk encryption is the current
   mitigation, not an app feature.
4. **Tool execution is not implemented.** When M4 adds tools, they must go through the approval
   lifecycle in `PHASE2_POLICY_MODEL.md` before any of them can touch the filesystem or network.
   Nothing in M1 can.
5. **Engine supply chain.** `b12189` was downloaded from the pinned release and its measured
   behaviour is recorded; there is no signature verification step yet (TD-4).

## 5. Rules for future work

- New Tauri plugins require a decision entry and a capability entry that is as narrow as possible.
- New network features (model downloads, search) are owner-approved, explicit, and shown in the UI
  as network actions before they happen. No background fetches.
- Anything that writes outside the app data directory must be owner-initiated and visible.
- Logs must not contain prompt text or file contents; today the core logs lifecycle events only.

## 6. Disclosure / audit trail

Security-relevant findings are recorded where they were found: `DECISION_LOG.md` D-035 (no unload
or shutdown route; `/health` is unauthenticated but loopback-only), D-036 (`--ctx-size 0` would
allocate ~14.5 GB), and `KNOWN_ISSUES.md` for anything unresolved.
