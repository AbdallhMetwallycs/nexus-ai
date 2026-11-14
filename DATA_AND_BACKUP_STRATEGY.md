# DATA_AND_BACKUP_STRATEGY.md — NEXUS AI

**Status:** current for Phase 2 M1 (2026-11-14). The database sections describe the committed M2
design; nothing below claims a store exists today.

## 1. What data exists right now

| Data | Location | Persistence |
| --- | --- | --- |
| Conversations and messages | Renderer memory (`Chat.tsx` state) | **Lost on close.** M2 moves this to SQLite |
| Active model id | `localStorage['nexus.activeModelId']` | Survives restart (WebView profile) |
| Theme | `localStorage['nexus.theme']` | Survives restart |
| Small UI flags (e.g. sidebar collapsed) | `localStorage['nexus.*']` | Survive restart |
| Model files | `D:\NEXUS-MODELS\` (override `NEXUS_MODELS_DIR`) | Owner-managed files |
| Engine | `D:\NEXUS-SIDECAR\b12189\` (override `NEXUS_ENGINE_DIR`) | Owner-managed files |
| Application database | **Does not exist yet** (M2) | — |

There is deliberately no hidden store, cache, or telemetry spool. If you cannot find it in this
table, the app did not write it.

## 2. Where the database will live (M2, per `PHASE2_DATA_MODEL.md`)

```
%APPDATA%\ai.nexus.local\
  nexus.db            main database (SQLite, one writer)
  nexus.db-wal        write-ahead log
  nexus.db-shm        shared-memory index
  backups\            timestamped archives written by store.backup()
  kb\                 knowledge-base source files and extracted text
  artifacts\          agent outputs, attachments kept on disk
```

- **WAL mode** with `busy_timeout = 5000 ms`: reads never block the single writer, and a lock
  timeout is reported as a failure rather than hanging the UI.
- **Migrations** are versioned and forward-only. A downgrade is not supported; the app says so
  instead of pretending a rollback exists.
- **Foreign keys on**, `integrity_check` on open, and one row per schema version in `schema_version`.

## 3. Backup

`store.backup()` (M2) does, in order:

1. `PRAGMA wal_checkpoint(TRUNCATE)` so the `.db` file is complete on its own.
2. Copy `nexus.db` (and `kb/`, `artifacts/` when included by the owner's choice) into
   `backups\nexus-YYYYMMDD-HHMMSS.zip`.
3. Record path, size, checksum, row counts and schema version in `backup_record`.
4. Verify by opening the copy and running `integrity_check` + comparing row counts.

Retention: the last **8** backups are listed. Purging is always owner-triggered; nothing deletes
itself silently.

**What is never backed up automatically:** model weights and the engine binary. They are large,
replaceable, and owned outside the app. The database stores their path, size and checksum so a
restore can tell the owner what is missing.

## 4. Restore

`store.restore(path)` (M2):

1. Takes a **pre-restore backup** of the current database first. This is not optional.
2. Closes the app's connection, replaces the database, reopens, and runs `integrity_check`.
3. Reports the restored schema version. If the backup is newer than the app, it refuses rather
   than risking a half-migrated store.

Failure at any step leaves the pre-restore backup named in the error so the owner can recover
manually.

## 5. Crash safety

- A kill during a write must leave the database openable: WAL + `integrity_check` is the test in
  the M2 exit gate (`kill the app during a write → db opens cleanly next launch`).
- Attachments are written to a temporary name and renamed into place, so a crash never leaves a
  row pointing at a half-written file.
- Partial generations are marked `incomplete` (M2 schema already has the column) rather than being
  silently presented as complete.

## 6. Privacy

- Everything stays on this machine. There is no sync, no cloud backup, and no crash reporting.
- Backup archives are plaintext ZIPs. OS-level disk encryption is the current protection; the app
  does not claim to encrypt them.
- Deleting a conversation deletes its rows; purging a knowledge base deletes its files. The app
  reports what was removed instead of implying a secure erase (SSD wear-levelling makes that claim
  dishonest).

## 7. Restore drill (do this before trusting the feature)

Once M2 lands, the acceptance test is:

```
1. create 3 conversations, 1 knowledge item, change the theme
2. store.backup()            → archive exists, integrity_check ok, counts recorded
3. delete all 3 conversations
4. store.restore(archive)    → 3 conversations return, theme unchanged, pre-restore backup exists
5. kill the app during a write, relaunch → opens cleanly, newest message complete or marked incomplete
```

The output of that drill goes into `TEST_RESULTS.md`, not into a claim.
