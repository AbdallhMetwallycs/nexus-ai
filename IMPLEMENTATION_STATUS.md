# IMPLEMENTATION_STATUS.md — NEXUS AI

**Status of record for Phase 2 M3 (2026-11-17).** One row per screen. "Backed by" names the
IPC command(s) the screen actually calls, verified by reading `src/pages/*.tsx`,
`src/state/PlatformContext.tsx`, `src/theme/ThemeContext.tsx` and the `match` in
`crates/nexus-core/src/dispatch.rs`. A command listed in `src/contract/ipc.ts` but not matched
in `dispatch.rs` returns `not_implemented`; it is not backing.

Definitions:

- **real** — the screen's primary action goes through the core and does the real thing.
- **partial** — some data or actions are real, the rest is still the approved Phase 1 demo
  and is labelled as such on screen.
- **demo** — no IPC command backs the screen; it reads `src/data/*` mock data and says so.

| Screen | Status | Backed by | What is real | What is still demo |
| --- | --- | --- | --- | --- |
| **Dashboard** | partial | `model.list` (via `PlatformContext` → `useActiveModel`) | The active-model card shows the real registry record (name, quantization, context window, RAM estimate, size), and the welcome copy now says so when a core is attached. | Telemetry and sparklines are deterministic mock data; recent conversations/activity/agents are `MOCK_*`. No `system.telemetry` call. |
| **Chat** | real | `model.list`, `chat.list`, `chat.get`, `chat.create`, `chat.rename`, `chat.setPinned`, `chat.delete`, `chat.clearMessages`, `chat.send`, `chat.stop`, `chat.usage`, `engine.loadModel`, `engine.status`; `settings.get` for the remembered model; events `chat://token`, `chat://usage` | Conversations and every message are written to and read from the local database. A prompt streams real tokens; the assembled prompt includes the stored history, trimmed by the measured budget; `chat.stop` survives model load and stores the partial answer with `stopped = true` and no token counts; crash recovery is unchanged. The usage rail reads `chat.usage` (`measured` true only when a stored usage row exists). Before generating, the core retrieves approved memories and the top-indexed chunks and the answer's Sources row shows the citations it actually retrieved. | `chat.regenerate` still refuses in live mode. Attachments are stored as sent, not parsed as chat attachments (the knowledge pipeline is separate). |
| **Agents** | demo | none (`agent.*` returns `not_implemented`) | Nothing. Agent definitions are mock records; create/edit/enable/duplicate write React state. | All of it. `DemoNotice`: "no agent process exists in Phase 1." |
| **Model Manager** | partial | `model.list` (`PlatformContext`), `engine.loadModel`; core also has `model.get`, `model.verify`, `model.remove`, `model.setActive`, `engine.unloadModel`, `engine.measuredFit` | The Installed tab lists real GGUF files read from `NEXUS_MODELS_DIR`; "Set active" loads through measured admission; the loaded model id is saved as `models.active` and restored on the next launch. | Catalog rows, compatibility verdicts, compare and download are `MOCK_MODELS` behind a `DemoNotice`. Live catalog rows cannot be made active. |
| **Memory Center** | partial | `memory.list`, `memory.get`, `memory.update`, `memory.approve`, `memory.reject`, `memory.approveAllPending`, `memory.delete`, `memory.history`, `memory.search` | The list, edit, approve/reject, approve-all, delete (archive) and the history timeline all read and write the `memory` / `memory_history` tables. An explicit "remember that …" request in chat now proposes a `pending` memory, which the owner approves here before retrieval can see it. | Nothing on this screen *creates* a memory — capture is a chat-side proposal by design — and the status counts still describe only the rows on screen. |
| **Knowledge Base** | real | `kb.tree`, `kb.listDocuments`, `kb.stats`, `kb.watchRoot`, `kb.unwatchRoot`, `kb.reindex`, `kb.deleteDocument`, `kb.moveDocument`, `kb.search` | A typed folder path is scanned and watched; md, txt, csv, pdf, docx and xlsx are parsed, chunked and stored in SQLite with FTS5 + local vector retrieval. The screen lists the real index, shows measured storage and chunk counts, re-indexes from disk, moves and removes entries (removal does not touch the file on disk), and previews what retrieval actually holds. | There is no folder picker (the path is typed), no page-image rendering in preview, and the collection tree is flat until folders get their own semantics. |
| **Tools & Skills** | demo | none (`tool.*`, `skill.*` return `not_implemented`) | Nothing. Tool status, permissions, enable/disable and the skill builder are React state. | All of it. `DemoNotice`: "no commands are executed." |
| **Learning Lab** | demo | none (`learning.*` return `not_implemented`) | Nothing. Corrections, suggestions and instruction versions are mock data. | All of it. `DemoNotice`: "All events, suggestions and version changes are simulated prototype state." |
| **Internet Center** | demo | none (`net.*` returns `not_implemented`) | The offline/online flag itself is UI state; no network stack exists. | Permissions, trusted sources, per-agent grants and update history are mock data. `DemoNotice`: "No network stack is wired to this UI." |
| **Activity Center** | real | `activity.list`, `activity.get`, `activity.export` | The timeline is read from the `activity` table the core writes (model loads, sends, stops, backups, restores, purges, exports). Export writes a JSON file and reports its path. | The two pending-approval rows are mock prompts; `activity.*` has no approval decision command, so the buttons say nothing was changed. |
| **Settings** | partial | `settings.get`, `settings.patch`, `store.backup`, `store.backups`, `store.restore`, `store.export`, `store.purge` | Saving a section writes the values to the `settings` table and the section reloads them on mount; the theme is written as `appearance.theme` and re-applied at startup. Backups are real verified copies listed from `backup_record`; Restore runs the core's guarded restore; "Export my data" writes owner data as JSON; the memory danger zone purges short-tier rows and reports rows/bytes removed. | Models default, Agents config, Internet policy, Learning Lab and Portability remain mock sections behind their own copy. The archive-folder input and the retention window are not wired (the purge uses the store's fixed windows). |

## Command surface actually implemented

`crates/nexus-core/src/dispatch.rs` matches only these commands (54); everything else falls
through to `NexusError::not_implemented` with the contract wording:

- `engine.status`, `engine.start`, `engine.stop`, `engine.loadModel`, `engine.unloadModel`,
  `engine.measuredFit`
- `model.list`, `model.get`, `model.setActive`, `model.verify`, `model.remove`
- `chat.send`, `chat.stop`, `chat.list`, `chat.get`, `chat.create`, `chat.rename`,
  `chat.setPinned`, `chat.delete`, `chat.clearMessages`, `chat.usage`
- `settings.get`, `settings.patch`
- `activity.list`, `activity.get`, `activity.export`, `activity.purge`
- `memory.list`, `memory.get`, `memory.update`, `memory.approve`, `memory.reject`,
  `memory.approveAllPending`, `memory.delete`, `memory.history`, `memory.search`
- `kb.tree`, `kb.listDocuments`, `kb.stats`, `kb.watchRoot`, `kb.unwatchRoot`, `kb.reindex`,
  `kb.deleteDocument`, `kb.moveDocument`, `kb.search`, `kb.ingestAttachment`
- `store.backup`, `store.backups`, `store.restore`, `store.export`, `store.purge`

Implementation notes that matter for reading the table:

1. In the desktop shell, `chat.stop` is intercepted in `src-tauri/src/lib.rs` before the core
   mutex and flips the shared `CancelFlag`; the `chat.stop` arm in `dispatch.rs` is what the
   unit tests exercise. Either way it halts the real generation.
2. `chat.send` saves the owner's question *before* any model check, so a refusal leaves the
   turn in the database next to its error. The first send to a conversation id the UI named
   creates that exact row (`create_conversation_with_id`) instead of forking a second one.
3. `Core::from_env()` opens `%APPDATA%\NexusAI\nexus.db` (overridable with `NEXUS_DATA_DIR`)
   and restores `models.active` when the registry can resolve it. If the file cannot be
   opened, every command that needs state refuses with `store.corrupt` and the reason.
4. `kb.watchRoot` indexes synchronously and then keeps a 2 s polling monitor over the tree; it
   runs only while the app runs. The index lives in the same SQLite file (`kb_document`,
   `kb_chunk`, `kb_chunk_fts`), so retrieval sees it after a restart without rescanning.
5. `chat.send` retrieves before it generates: approved memories plus the top chunks are placed in
   the prompt, and the same citations are stored on the assistant message so `chat.get` and an
   idempotent retry return them too.

## Verification

Read on 2026-11-17 against branch `m2-persistence` (M3 commits). Behaviour claims are backed by
`TEST_RESULTS.md` §"2026-11-17 — M3 knowledge and memory" and the gate JSON `.m3-gate.json`
(gitignored, reproduced by `tools/m3-gate.mjs`), not by the fact that the screens render.
