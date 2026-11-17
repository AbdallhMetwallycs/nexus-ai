# IMPLEMENTATION_STATUS.md — NEXUS AI

**Status of record for Phase 2 M6 (2026-11-17).** One row per screen. "Backed by" names the
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
| **Agents** | real | `agent.list`, `agent.get`, `agent.create`, `agent.update`, `agent.setEnabled`, `agent.duplicate`, `agent.delete`, `agent.assignModel`, `agent.instructions`, `agent.run`; `model.list` for the assignment picker; `job.get` while a task runs | The roster is read from and written to the `agents` table: create, edit, enable/disable, duplicate, delete and model assignment. The Developer Agent runs an explicit plan (one line per tool call) as a real job; the details dialog polls `job.get` and shows each step, its status, its output/error and the reason a task stopped. Built-in agents refuse edit/delete, and the UI hides those actions instead of offering a failing button. | Model-driven planning is M5; only `developer-agent` executes, and any other agent returns `policy.not_allowed` naming the one runnable agent. `agent.instructions` returns an empty history list rather than invented versions. |
| **First run** (a gate outside the shell) | real | `model.catalog`, `model.list`, `model.download`, `model.downloadStatus`, `model.downloadCancel` | When the models folder holds no GGUF, this screen measures the real machine (RAM, physical cores, free disk, folder), recommends the catalogue entry whose RAM floor the machine meets, requires the licence tick, and downloads that file through `curl.exe` with live progress and Cancel. "Do this later" opens the shell with `ModelMissingBanner` saying Chat will refuse. | None on this screen. The download cannot be faster than the link (66–114 kB/s measured), and the copy says which file and how large it is before starting. |
| **Model Manager** | partial | `model.list` (`PlatformContext`), `engine.loadModel`, `model.catalog`, `model.download`, `model.downloadStatus`, `model.downloadCancel`; core also has `model.get`, `model.verify`, `model.remove`, `model.setActive`, `engine.unloadModel`, `engine.measuredFit` | The Installed tab lists real GGUF files read from `NEXUS_MODELS_DIR`, shows an install panel for both catalogue entries with size, licence gate and the same real download slot, and "Set active" loads through measured admission; the loaded model id is saved as `models.active` and restored on the next launch. | The Catalog tab's store rows, compatibility verdicts and compare view are `MOCK_MODELS` behind a `DemoNotice`. |
| **Memory Center** | partial | `memory.list`, `memory.get`, `memory.update`, `memory.approve`, `memory.reject`, `memory.approveAllPending`, `memory.delete`, `memory.history`, `memory.search` | The list, edit, approve/reject, approve-all, delete (archive) and the history timeline all read and write the `memory` / `memory_history` tables. An explicit "remember that …" request in chat now proposes a `pending` memory, which the owner approves here before retrieval can see it. | Nothing on this screen *creates* a memory — capture is a chat-side proposal by design — and the status counts still describe only the rows on screen. |
| **Knowledge Base** | real | `kb.tree`, `kb.listDocuments`, `kb.stats`, `kb.watchRoot`, `kb.unwatchRoot`, `kb.reindex`, `kb.deleteDocument`, `kb.moveDocument`, `kb.search` | A typed folder path is scanned and watched; md, txt, csv, pdf, docx and xlsx are parsed, chunked and stored in SQLite with FTS5 + local vector retrieval. The screen lists the real index, shows measured storage and chunk counts, re-indexes from disk, moves and removes entries (removal does not touch the file on disk), and previews what retrieval actually holds. | There is no folder picker (the path is typed), no page-image rendering in preview, and the collection tree is flat until folders get their own semantics. |
| **Tools & Skills** | partial | `tool.list`, `tool.setEnabled`, `tool.testRun`, `tool.grants`, `tool.setGrant` | The catalogue is the seeded five-tool set read from the database; enable/disable and test runs are real, a test run becomes a job (and waits for approval when the tool requires it), and the details dialog shows and edits the standing grant per declared permission. A tool in an error state cannot be re-enabled. | `skill.*` is still unimplemented: the Custom Skills tab is React state behind its own `DemoNotice`, and creating a skill changes nothing on disk. |
| **Learning Lab** | demo | none (`learning.*` return `not_implemented`) | Nothing. Corrections, suggestions and instruction versions are mock data. | All of it. `DemoNotice`: "All events, suggestions and version changes are simulated prototype state." |
| **Internet Center** | demo | none (`net.*` returns `not_implemented`) | The offline/online flag itself is UI state; no network stack exists. | Permissions, trusted sources, per-agent grants and update history are mock data. `DemoNotice`: "No network stack is wired to this UI." |
| **Activity Center** | real | `activity.list`, `activity.get`, `activity.export`, `approval.pending`, `approval.decide`, `approval.history` | The timeline is read from the `activity` table the core writes, including every job start, tool call, denial and finish with its `correlationId`. The queue row for each undecided approval is real and carries its approval id; Approve once / Always allow / Reject call `approval.decide` and then re-read both tables. An expired request is recorded as a denial by the runner. | `activity.get` is implemented but the screen does not open a single record; export still covers the activity table only. |
| **Settings** | partial | `settings.get`, `settings.patch`, `store.backup`, `store.backups`, `store.restore`, `store.export`, `store.purge` | Saving a section writes the values to the `settings` table and the section reloads them on mount; the theme is written as `appearance.theme` and re-applied at startup. Backups are real verified copies listed from `backup_record`; Restore runs the core's guarded restore; "Export my data" writes owner data as JSON; the memory danger zone purges short-tier rows and reports rows/bytes removed. | Models default, Agents config, Internet policy, Learning Lab and Portability remain mock sections behind their own copy. The archive-folder input and the retention window are not wired (the purge uses the store's fixed windows). |

## Command surface actually implemented

`crates/nexus-core/src/dispatch.rs` matches only these commands (75); everything else falls
through to `NexusError::not_implemented` with the contract wording:

- `engine.status`, `engine.start`, `engine.stop`, `engine.loadModel`, `engine.unloadModel`,
  `engine.measuredFit`
- `model.list`, `model.get`, `model.setActive`, `model.verify`, `model.remove`,
  `model.catalog`, `model.download`, `model.downloadStatus`, `model.downloadCancel`
- `chat.send`, `chat.stop`, `chat.list`, `chat.get`, `chat.create`, `chat.rename`,
  `chat.setPinned`, `chat.delete`, `chat.clearMessages`, `chat.usage`
- `settings.get`, `settings.patch`
- `activity.list`, `activity.get`, `activity.export`, `activity.purge`
- `agent.list`, `agent.get`, `agent.create`, `agent.update`, `agent.setEnabled`,
  `agent.duplicate`, `agent.delete`, `agent.assignModel`, `agent.instructions`, `agent.run`
- `tool.list`, `tool.setEnabled`, `tool.testRun`, `tool.grants`, `tool.setGrant`
- `approval.pending`, `approval.decide`, `approval.history`
- `job.list`, `job.get`
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
6. `job.*` is backed by one background thread (`nexus-job-runner`) with its own SQLite connection.
   It takes one queued job at a time; a job waiting for approval is put back in `queued`, so a
   human decision never holds the slot and `job.get` shows it as `queued` with one step in
   `awaiting_approval`.
7. Tools may only touch the paths of watched Knowledge folders. The check runs in
   `nexus_policy::resolve_in_roots` before any filesystem call and before an approval prompt, so a
   traversal is a denial (`policy.root_denied`), never a question. Filesystem writes, Python and
   PowerShell need approval; output is capped (256 KiB read, 16 KiB captured) and a process is
   killed at 30 s with `timedOut: true`.
8. An approval is bound to the tool id plus a canonical argument hash and is consumed on use. A
   second identical call asks again unless the owner chose Always allow, which writes a standing
   grant visible in the Tools details dialog. An unanswered request expires after 300 s and is
   recorded as a denial.

9. The model catalogue is compiled in (`crates/nexus-model`): two GGUF files with exact byte
   length, SHA-256, licence link and RAM floor. `model.download` refuses an unknown id, a file
   already present, or a second transfer while the slot is busy; the file is renamed from `.part`
   only after the digest matches. Progress is polled (there is no push event), cancel deletes the
   partial file, and a failure keeps it for `curl --continue-at -` to resume.
10. The installed app resolves the engine as `$RESOURCE/engine` (the installer's `engine\` folder),
    then the development folder, then `engine` beside the exe, then `%LOCALAPPDATA%\NexusAI\engine`.
    The M6 gate proved the first path by reading the binary path back from `engine.status`.

## Verification

Read on 2026-11-17 against branch `m2-persistence` (M6 commits). Behaviour claims are backed by
`TEST_RESULTS.md` §"2026-11-17 — M6 packaging, first run and uninstall", `tools/m6-gate.mjs`
(18 PASS / 1 SKIP against the installed binary) and the gate JSON `.m6-gate.json` (gitignored),
not by the fact that the screens render. Earlier milestones keep their own gate records.
