# Changelog

All notable changes to NEXUS AI. This project is pre-1.0 and source-run only; there is no
installer, signing or updater yet. Entries describe what ran on this machine, with the
evidence document named.

## [Unreleased]

### Added — M3 knowledge and memory (2026-11-17)

- **`crates/nexus-kb`**: local parsing (md, txt, csv, pdf via `lopdf`, docx via `zip` +
  `quick-xml`, xlsx via `calamine`), section-aware chunking, 256-dimension hashed-token vectors and
  cosine similarity. Ten tests, including a corrupt PDF that ends `failed` without a panic.
- **Core router**: `kb.tree|listDocuments|stats|watchRoot|unwatchRoot|reindex|deleteDocument|`
  `moveDocument|search|ingestAttachment` and `memory.search` (54 commands now matched). A watched
  root is scanned immediately and re-checked by a single 2 s polling monitor; a rename keeps the
  document id by content fingerprint.
- **Retrieval in chat**: `chat.send` retrieves approved memories plus the top chunks by FTS5 bm25
  fused with the hashed-vector cosine (RRF, k = 60), places them in the prompt before generation,
  and returns `citations`; an idempotent retry now returns the citations stored on the message.
- **Memory capture**: an explicit "remember that …" / "تذكر أن …" request proposes a `pending`
  memory sourced from the conversation. Pending rows are excluded from retrieval until approved.
- **Screens**: Knowledge Base is real (watch, measured index stats, re-index, move, remove,
  preview of stored chunks); Chat renders a Sources row with one chip per retrieved citation.
- **`tools/m3-gate.mjs`**: 21-step live gate over CDP. Recorded 21/21 PASS, `kb.search` over 201
  documents in 26.50 ms, pending→approved memory 0→1 hits. Evidence in `TEST_RESULTS.md`.

### Added — M2 persistence (2026-11-17)

- **`crates/nexus-store`**: SQLite (rusqlite 0.32.1, bundled-full + backup) with WAL,
  `foreign_keys=ON`, `busy_timeout` 5000 ms, `PRAGMA user_version` migrations, FTS5 tables, and
  verified backup / guarded restore. Nine tests cover empty-db migration, `integrity_check`,
  backup to restore with identical row counts plus a pre-restore copy, and a child process killed
  mid-transaction.
- **Core router**: `chat.*` (send/list/get/create/rename/setPinned/delete/clearMessages/usage),
  `settings.get|patch`, `activity.list|get|export|purge`, `memory.list|get|update|approve|reject|`
  `approveAllPending|delete|history`, and `store.backup|backups|restore|export|purge` now read and
  write the database. `chat.send` assembles stored history, trims it to the measured budget, saves
  the question before any model refusal, and emits no usage frame for a stopped stream.
- **`store.backups` added to the contract** (96 to 97 commands; `store.export` now returns its path).
- **App data** lives at `%APPDATA%/NexusAI/nexus.db` (override `NEXUS_DATA_DIR`); the active
  model and theme are restored from the `settings` table at startup.
- **Screens**: Chat reads conversations at mount and writes every send/rename/pin/delete/clear;
  Memory Center reads, edits, approves, rejects, archives and shows history from the store;
  Activity Center reads the recorded timeline and exports it; Settings saves sections to the
  database, lists and creates real verified backups, restores them, exports owner data, and purges
  short-term memory. Demo notices now appear only in the browser build.
- **`tools/m2-gate.mjs`**: seed/verify over CDP — restart survival, painted theme, verified backup,
  restore and row-count comparison. Evidence in `TEST_RESULTS.md` (2026-11-17).

### Fixed

- **Chat showed two waiting indicators, and an attachment-only send was refused.** In live mode the
  thread rendered the assistant placeholder ("Waiting for the engine…") *and* a separate "Generating
  on this machine" row; the row now renders only on the simulated path. A send with attachments and
  no text passed `content: ''` to `chat.send`, which the core rejects with `validation.field`; the
  text shown in the bubble is now what is sent. The attach toast no longer says "Phase 1" in a live
  build, and the conversation rail says `History sent: latest turn only` (KI-4). Verified:
  `cargo test -p nexus-core` 53/0, clippy clean, live `live_chat` pass, `npm run typecheck` and
  `npm run build` exit 0, and the live UI gate re-run at exit 0 (`NEXUS OK`, stop held at 1
  character, `engine.crashed:` then `RECOVERED`, 0 external requests) — `TEST_RESULTS.md`
  2026-11-16.
- **Model Manager could show a model as active when it had not loaded.** In live mode `Set active`
  wrote the active id (and `localStorage`) *before* calling `engine.loadModel`, so a refused
  admission or a failed load still painted the `active` badge and remembered the choice. The badge
  and the remembered id now follow a successful load. Mock catalog rows in live mode no longer offer
  `Set active`; the menu says `Not on disk — mock catalog row`, and the details modal hides the
  button for those rows. The download toast no longer says "Phase 1". Verified with
  `npm run typecheck` exit 0; the live path was not re-driven with the engine after the change.

## [0.1.0] — 2026-11-14 — M1, tag `m1-first-answer`

M1 is "one real answer end to end": the approved Chat screen talks to a real local GGUF model
through a Rust core in a Tauri shell. Core landed 2026-11-12 (`m1-core`, `ff3edb5`); the
desktop shell and exit gate landed 2026-11-14 (`ba15fa2`).

### Added — core (2026-11-12)

- `crates/nexus-core` with an engine supervisor: spawns the pinned `llama-server.exe`, binds
  `127.0.0.1` on an OS-assigned port, generates a fresh 32-byte hex bearer token per launch,
  waits on `/health`, and terminates the child to stop it.
- A registry that parses real GGUF metadata from the model file instead of trusting a catalog.
- Measured RAM admission: `private ≈ 1,495 MB + 0.1106 MB × context tokens`, a context ladder,
  and a fail-closed refusal when Windows will not report free memory.
- Prompt assembly, SSE token streaming, and a `CancelFlag` that closes the socket rather than
  only setting a UI flag.
- A dependency-free HTTP/1.1 loopback client with chunked and SSE framing.
- A dispatch router that returns `not_implemented` for every command outside the M1 surface.
- `engine.*`, `model.*` and `chat.send` / `chat.stop` commands; `model://state`,
  `chat://token` and `chat://usage` events.

### Added — desktop shell (2026-11-14)

- Tauri 2 host with exactly one command, `ipc`, taking `{ command, args }`; dotted contract
  names travel inside the payload.
- Event bridge for `chat://token`, `chat://usage` and `model://state`.
- `RunEvent::Exit` cleanup that cancels work and terminates the engine so it cannot outlive
  the window.
- `chat.stop` handled before the core mutex, so Stop works during a cold model load instead of
  queueing behind it.
- Chat live path: load through admission, stream into the approved message UI, Stop, measured
  context rail, crash banner and next-message recovery.
- Model Manager Installed tab reading real GGUF files; Topbar reporting the live engine rather
  than "UI prototype · Phase 1".
- `tools/ui-gate.mjs`: drives the real window and real engine over WebView2 DevTools, kills
  `llama-server.exe`, and asserts the recovery answer.

### Fixed

- **Zero usage tokens.** `llama-server` emits no usage frame unless the request carries
  `stream_options.include_usage`; `chat_body` now sends it (MEASUREMENTS.md §13).
- **A killed engine reported as `internal:` and was not restarted.** `Child::try_wait()` lags
  an external `taskkill` by 0.8–1.5 s here; crash detection now probes `/health`
  (`Supervisor::serving()`), reuses a launch only while it is serving, and returns
  `engine.crashed` once (TEST_RESULTS.md §5a).
- **Vite dev server crash** with `EBUSY` on `nexus_ai_lib.dll`; `vite.config.ts` ignores
  `**/target/**`, `**/src-tauri/**`, `**/crates/**` (TEST_RESULTS.md §5b).
- **Live UI claimed "UI prototype · Phase 1" and "measured 0"**; the Topbar and context rail
  now report only what the core sent (TEST_RESULTS.md §5c).
- **A runtime font CDN call survived the offline-first claim.** The Google Fonts links are gone;
  Inter and JetBrains Mono ship with the app (`@fontsource-variable/*`), so `dist/index.html`
  contains no external URL (D-037, TEST_RESULTS.md §7).

### Evidence

- `cargo test -p nexus-core`: 53 passed, 0 failed.
- `cargo clippy --workspace --all-targets -- -D warnings`: clean, exit 0.
- `npm run typecheck`: exit 0. `npm run build`: exit 0, 1614 modules, 11.18 s.
- UI gate exit 0, `2026-11-14T13:28:27Z`–`13:29:23Z`: `NEXUS OK` (122 measured tokens, 22.2 s
  cold), Stop held at 1 character after 2.5 s, `engine.crashed` banner in 1,642 ms, recovered
  answer `RECOVERED` in 22.3 s, 0 external requests, 0 console errors.

Full quotes: `TEST_RESULTS.md` §1–§4 and §7, and `MEASUREMENTS.md` §13–§14.
