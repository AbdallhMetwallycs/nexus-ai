# IMPLEMENTATION_STATUS.md — NEXUS AI

**Status of record for Phase 2 M1 (2026-11-14).** One row per screen. "Backed by" names the
IPC command(s) the screen actually calls, verified by reading `src/pages/*.tsx`,
`src/state/PlatformContext.tsx` and the `match` in `crates/nexus-core/src/dispatch.rs`.
A command listed in `src/contract/ipc.ts` but not matched in `dispatch.rs` returns
`not_implemented`; it is not backing.

Definitions:

- **real** — the screen's primary action goes through the core and does the real thing.
- **partial** — some data or actions are real, the rest is still the approved Phase 1 demo
  and is labelled as such on screen.
- **demo** — no IPC command backs the screen; it reads `src/data/*` mock data and says so.

| Screen | Status | Backed by | What is real | What is still demo |
| --- | --- | --- | --- | --- |
| **Dashboard** | partial | `model.list` (via `PlatformContext` → `useActiveModel`) | The active-model card shows the real registry record (name, quantization, context window, RAM estimate, size) when the Tauri host answered. | Telemetry and sparklines are deterministic mock data; recent conversations/activity/agents are `MOCK_*`; "0 / 10 models installed" and "Selection is simulated" are stale Phase 1 copy in live mode. No `system.telemetry` or `engine.status` call. |
| **Chat** | real (core path) | `engine.loadModel`, `chat.send`, `chat.stop`, `engine.status`, `model.list`; events `chat://token`, `chat://usage` | A prompt typed into the real composer loads the model through admission, streams real tokens, stops, and reports engine-counted context tokens after the usage frame. Crash and recovery are handled. | Conversation list/create/rename/pin/delete/clear are React state only; there is no `chat.list`/`chat.get`/`chat.create` call. `chat.regenerate` refuses in live mode ("lands with M2"). `chat.usage` is not implemented; usage exists only as the event after an answer completes. The engine receives the system prompt and the current message only — earlier turns stay in the UI but are not sent. |
| **Agents** | demo | none (`agent.*` returns `not_implemented`) | Nothing. Agent definitions are mock records; create/edit/enable/duplicate write React state. | All of it. `DemoNotice`: "no agent process exists in Phase 1." |
| **Model Manager** | partial | `model.list` (`PlatformContext`), `engine.loadModel`; core also has `model.get`, `model.verify`, `model.remove`, `model.setActive`, `engine.unloadModel`, `engine.measuredFit` | The Installed tab lists real GGUF files read from `NEXUS_MODELS_DIR`, showing real metadata; "Set active" loads the model through measured admission and reports the capped context and thread count; the `active` badge changes only after the load succeeds. | Catalog rows, compatibility verdicts, compare and download are `MOCK_MODELS` behind a `DemoNotice`. The hardware rail is the mock profile. Live catalog rows cannot be made active ("Not on disk — mock catalog row"). |
| **Memory Center** | demo | none (`memory.*` returns `not_implemented`) | Nothing. Memories, approval actions, search and history are React state over `MOCK_MEMORIES`. | All of it. `DemoNotice`: "this prototype reads and writes React state only." |
| **Knowledge Base** | demo | none (`kb.*` returns `not_implemented`) | Nothing. Folder tree, documents, indexing status and search are mock data. | All of it. `DemoNotice`: "No documents are actually parsed or stored." |
| **Tools & Skills** | demo | none (`tool.*`, `skill.*` return `not_implemented`) | Nothing. Tool status, permissions, enable/disable and the skill builder are React state. | All of it. `DemoNotice`: "no commands are executed." |
| **Learning Lab** | demo | none (`learning.*` returns `not_implemented`) | Nothing. Corrections, suggestions and instruction versions are mock data. | All of it. `DemoNotice`: "All events, suggestions and version changes are simulated prototype state." |
| **Internet Center** | demo | none (`net.*` returns `not_implemented`) | The offline/online flag itself is UI state; no network stack exists. | Permissions, trusted sources, per-agent grants and update history are mock data. `DemoNotice`: "No network stack is wired to this UI." |
| **Activity Center** | demo | none (`activity.*` returns `not_implemented`) | Nothing. The timeline is an in-memory mock log cleared on reload. | All of it, including the approval queue shown there. |
| **Settings** | demo | none (`settings.*`, `system.*`, `store.*` return `not_implemented`) | Theme and the active-model id persist in `localStorage`; the rest is React state. | Every settings section, the hardware profile and backup/export actions. `DemoNotice`: "no registry, no config file, no network." |

## Command surface actually implemented

`crates/nexus-core/src/dispatch.rs` matches only these commands; everything else falls through
to `NexusError::not_implemented` with the contract wording:

- `engine.status`, `engine.start`, `engine.stop`, `engine.loadModel`, `engine.unloadModel`,
  `engine.measuredFit`
- `model.list`, `model.get`, `model.setActive`, `model.verify`, `model.remove`
- `chat.send`, `chat.stop`

Two implementation notes that matter for reading the table:

1. In the desktop shell, `chat.stop` is intercepted in `src-tauri/src/lib.rs` before the core
   mutex and flips the shared `CancelFlag`; the `chat.stop` arm in `dispatch.rs` is what the
   unit tests exercise. Either way it halts the real generation.
2. `chat.send` keys the stream by `conversationId` and `clientId` but the core holds no
   conversation table. The id is passed through to `chat://token`; the messages themselves
   live in `Chat.tsx` state.

## Verification

Read on 2026-11-14 against `m1-first-answer` (`ba15fa2`). The live behaviour claim is backed by
the gate run quoted in `TEST_RESULTS.md` §4 and `MEASUREMENTS.md` §14, not by the fact that the
screens render.
