# PROJECT_RECOVERY_REPORT.md — NEXUS AI

**Scope:** the Phase 1 boundary (`84cb1a8`, 2026-11-07) through tag `m1-first-answer`
(`ba15fa2`, 2026-11-14). Every statement below is traceable to a commit, a tag, or an
output quoted in `TEST_RESULTS.md` / `MEASUREMENTS.md`. Where a fact was never recorded,
this report says `not recorded` instead of estimating.

**Current state:** M1 is complete. The Tauri shell runs the pinned `llama-server.exe`, a
real GGUF model streams real tokens into the approved Chat screen, Stop halts generation,
and killing the engine mid-answer produces a contract error and recovers on the next
message. Tag `m1-first-answer` points at `ba15fa2`. M2 (SQLite persistence) is next.

---

## 1. What existed before Phase 2

Phase 1 was a finished, owner-approved UI prototype. Baseline commit `84cb1a8` (2026-11-07,
96 files, 14,271 insertions) contained:

- 11 navigable screens: Dashboard, Chat, Agents, Model Manager, Memory Center, Knowledge
  Base, Tools & Skills, Learning Lab, Internet Center, Activity Center, Settings.
- A bespoke design system in `src/components/ui` and page chrome in `src/components/common`.
- Typed mock data in `src/data/*` and shared types in `src/data/types.ts`.
- A hand-built Markdown renderer, sparklines, menus, toasts and theme support — no component,
  state or chart library.
- Phase 1 evidence and design docs: `PHASE_1_COMPLETION_REPORT.md`, `CONVENTIONS.md`,
  `UI_DESIGN_SYSTEM.md`, `UI_COMPONENTS.md`, `UI_SCREEN_MAP.md`, `DECISION_LOG.md`, and the
  Phase 2 proposal `PHASE_2_ARCHITECTURE_PLAN.md`.
- A screenshot matrix under `screenshots/`.

It had **no** Rust core, no `src-tauri/`, no engine, no model file, no database, and no IPC
transport. Chat replies were canned strings from `SIMULATED_REPLIES`; telemetry was labelled
mock data; the Model Manager's Installed tab was intentionally empty (D-014).

The one thing that had already changed at the boundary was version control: `git init` and
`.gitignore` landed in the baseline commit itself (D-023). The Phase 1 completion report had
listed `.gitignore` among Phase 1 files before a repository existed, and that claim was
corrected in the same decision rather than left as a retroactive fiction.

## 2. What was found wrong

The failures below were found by measurement or by running the product, not by review of the
plan. Each is recorded where it was found.

### 2.1 In the Phase 1 artefacts

1. **The mock hardware profile described the wrong volume.** It showed 512 GB total / 143 GB
   free, which describes `C:`; app data and models live on `D:` (252 GB total, 149 GB free at
   the 2026-11-07 probe). Recorded in D-024.
2. **The completion report claimed a file the repository did not have.** `.gitignore` was
   listed among Phase 1 files before the repo existed. Corrected by D-023, which created it.
3. **"UI prototype · Phase 1" and "measured 0" survived into the live build.** Both were
   accurate in Phase 1 and false once a real engine answered. Found by the M1 UI gate and
   fixed in `ba15fa2` (TEST_RESULTS.md §5c).

### 2.2 In the Phase 2 work itself

4. **Router mode cannot load a local GGUF file over HTTP.** M1.1 inferred from a 404 that
   `POST /models/load` existed and was usable. The corrected probe returned
   `400 invalid HF repo format, expected <user>/<model>[:quant]`; the field is a Hugging Face
   repo id. The only way router mode acquires a model is a network fetch, which `--offline`
   and the owner's scope forbid. D-032 recorded the inference; D-034 recorded the correction
   and moved the design to `-m <path>` at spawn, single-instance.
5. **The engine emits no usage frame unless the request asks for it.** Every early run through
   `nexus-core` reported `prompt_tokens 0, completion_tokens 0` while text streamed correctly,
   because `stream_options.include_usage` was missing. Fixed in `inference::chat_body`;
   `MEASUREMENTS.md` §13 records the defect and the fix.
6. **A killed engine was reported as `internal:`, not `engine.crashed:`, and recovery reused a
   dead port.** `Child::try_wait()` on this Windows build keeps reporting an externally
   `taskkill`-ed process as alive for 0.8–1.5 s (measured: 1.5 s in one probe, 0.8 s in
   another). The failing `chat.send` therefore concluded the engine was healthy, returned the
   raw socket error, and the next send reused the closed port. Fixed by probing `/health`
   (`Supervisor::serving()`), requiring `refresh() && serving()` for reuse, and calling
   `mark_crashed()` once. Evidence: TEST_RESULTS.md §5a, MEASUREMENTS.md §14.
7. **The Vite watcher died on a Rust artefact.** `npm run tauri dev` crashed the dev server
   with `EBUSY` on `nexus_ai_lib.dll` while watching build output. `vite.config.ts` now
   ignores `**/target/**`, `**/src-tauri/**`, `**/crates/**` (TEST_RESULTS.md §5b).
8. **`--ctx-size 0` would have been a memory hazard.** Zero means "use the model's advertised
   context"; this model advertises 131,072, and the measured slope implies ~14.5 GB of KV
   cache. The engine loaded 32k at 5.1 GB private without refusing, so the core's admission
   check is the only guard (D-036, MEASUREMENTS.md §4).

## 3. What changed

| Commit | Tag | Date | What it delivered |
| --- | --- | --- | --- |
| `84cb1a8` | — | 2026-11-07 | Baseline: verified Phase 1 UI prototype + Phase 2 plan. 96 files, 14,271 insertions. |
| `a8b532c` | `m0-lock` | 2026-11-07 | Six architecture documents; no implementation, no installs, no downloads. 1,949 insertions. |
| `e1cc89e` | `m0-5-contract` | 2026-11-07 | IPC contract materialised as TypeScript types; nothing wired. |
| `9d1f72e` | `m1-0-toolchain` | 2026-11-07 | Owner-authorised Rust + MSVC checkpoint recorded. |
| `e4c75dd` | `m1-1-engine` | 2026-11-07 | Pinned llama.cpp b12189 acquired outside the repo; weightless probes. |
| `e570692` | `m1-2-measurements` | 2026-11-07 | One authorised model file; first real engine measurements. |
| `ff3edb5` | `m1-core` | 2026-11-12 | `crates/nexus-core`: supervisor, registry, admission, inference, HTTP/SSE, dispatch. Streams a real answer. 52 tests. |
| `ba15fa2` | `m1-first-answer` | 2026-11-14 | Tauri 2 shell, single `ipc` command, event bridge, exit cleanup, crash fix, honesty fixes, UI gate driver, evidence docs. 53 tests. |
| `27b8731` | — | 2026-11-14 | Work queue closed and cold-start handoff written. |

What became real in that sequence:

- **Core:** engine supervision with a per-launch 32-byte hex bearer token, loopback-only
  bind, measured RAM admission, GGUF metadata parsed from the file itself, one generation at
  a time, and a cancel path that shuts the socket rather than hiding a UI flag.
- **Shell:** exactly one Tauri command (`ipc`, payload `{ command, args }`), events
  `chat://token`, `chat://usage`, `model://state`, and `RunEvent::Exit` cleanup so the child
  process cannot outlive the window.
- **Chat:** real load → send → stream → stop, with the context rail switching from
  "estimated" to "measured" only after the engine's usage frame.
- **Crash recovery:** a generation failure with no serving engine returns
  `engine.crashed: The local engine stopped while answering. The next message will restart
  it.`; the next send restarts the engine.

## 4. Current evidence

Quoted from `TEST_RESULTS.md` §4 (run window `2026-11-14T13:28:27.327Z` →
`2026-11-14T13:29:23.314Z`, exit 0):

```
[answer-complete]  {"totalMs":22200,"text":"NEXUS OK","context":"122","error":null}
[stop]             {"msToStopClick":5780,"charsBeforeStop":1,
                    "note":"Stopped — this answer is incomplete.",
                    "streamingAfter":false,"charsAfterSettle":1,"sendBack":true}
[engine-killed]    {"killOutput":"SUCCESS: The process \"llama-server.exe\" with PID 2304 has been terminated.",
                    "charsBefore":3,
                    "banner":"engine.crashed: The local engine stopped while answering. The next message will restart it.",
                    "thinking":false,"failedNote":true,"waitedMs":1642}
[recovered]        {"ms":22258,"text":"RECOVERED", ...}
[network]          {"externalRequestCount":0,"external":[]}
```

Regression at the same commit: `cargo test -p nexus-core` 53 passed, 0 failed; clippy clean;
`npm run typecheck` exit 0; `npm run build` exit 0 (1614 modules, 11.18 s). All quoted in
`TEST_RESULTS.md` §1–§3.

Measurements: first answer 22.2 s cold including spawn, weight load and prefill; Stop held at
1 character after 2.5 s; crash banner at 1,642 ms; recovery answer at 22,258 ms. The engine
alone is ready in **37,999 ms cold / 6–10 s warm** (`MEASUREMENTS.md` §3), and the measured
private-RAM line is **≈1,495 MB + 0.1106 MB × context tokens** (`MEASUREMENTS.md` §4).

## 5. What is still not real

- Conversation state is React memory; closing the app loses it. There is no `chat.list`,
  `chat.get`, `chat.create` or `chat.usage` implementation yet.
- `chat.regenerate` refuses in live mode with a toast; it lands with M2.
- Every screen except Chat (and the installed half of Model Manager) is still the approved
  Phase 1 demo. See `IMPLEMENTATION_STATUS.md` for the per-screen ledger.
- There is no installer, code signing, notarization or updater. `bundle.active` is `false`;
  the app runs from source. See `RELEASE_NOTES.md` and `SECURITY_MODEL.md` §4.
- There is no CSP in the WebView (`"csp": null`).
- Only one model and one hardware profile have been tested, one run per gate step.

## 6. Lessons recorded rather than remembered

1. **An installer's exit code is not evidence; the artefact is.** The VS 2026 C++ workload
   command returned 0 while installing nothing; the authoritative workload id came from the
   channel manifest (D-029).
2. **A process handle is not a health check.** Reuse and crash decisions must probe `/health`
   on this platform (TEST_RESULTS.md §5a).
3. **Zero usage is a request-shape bug, not an engine limitation** (MEASUREMENTS.md §13).
4. **A 404 that looks like the server's own error format is not proof a route exists.**
   D-034 corrects D-032 and keeps the correction visible.
5. **An inference in a design document is still an inference.** D-032/D-034 are both kept in
   `DECISION_LOG.md` so the correction is auditable.

## 7. How to re-verify

- Regression: `cargo test -p nexus-core`, `cargo clippy --workspace --all-targets -- -D
  warnings`, `npm run typecheck`, `npm run build`.
- Behaviour: run `npm run tauri dev` with WebView2 DevTools on port 9333, then
  `node tools/ui-gate.mjs` from the repo root (`AGENTS.md` → "Live UI gate").
- The gate writes `.ui-gate.json` and `screenshots/m1-live-ui-gate.png`; it is evidence, not a
  unit test. It kills the real `llama-server.exe` and asserts the recovery answer.
