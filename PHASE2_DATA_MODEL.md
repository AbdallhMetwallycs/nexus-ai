# NEXUS AI — Phase 2 Data Model and Storage Schema (M0 draft)

**Doc:** SQLite design for the local store · **Written:** 2026-11-07 · **Status:** for owner approval
**Rule followed:** every column traces back to a field in `src/data/types.ts` or to a UI element
that already displays it. No table exists for a feature the Phase 1 screens don't show.

**Nothing here is applied.** No database file, migration, or schema has been created. This is the
design that M2 implements, written now so M1's choices don't paint us into a corner.

---

## 1. Engine and global settings

| Choice | Value | Why |
|---|---|---|
| Engine | SQLite 3.x via `rusqlite`, bundled | Single inspectable file, no service, crash-safe, trivially backed up |
| Journal | `WAL` | Reads never block the one writer; the UI polls lists while jobs run |
| `foreign_keys` | `ON` per connection | SQLite defaults it off per-connection; silently skipping this is a classic bug |
| `busy_timeout` | 5000 ms | With WAL, contention should be rare; a timeout is honest failure rather than a hang |
| Ids | `TEXT PRIMARY KEY` | Phase 1 already uses string ids (`'c-refactor-auth'`, `'doc-1'`); no renumbering churn |
| Timestamps | `TEXT` ISO-8601 with offset | Matches Phase 1; readable with any tool, and this is a single-user local app |
| Booleans | `INTEGER` 0/1 | SQLite has no bool type |
| Money/bigness | bytes as `INTEGER`, never floats | Floats for sizes are how rounding bugs get written into a database |

**JSON columns are the exception, not the convention.** They are used only where the payload is
genuinely variable-shaped and never queried by field: `capabilities`, `permissions`, `steps`,
`history`, `payload`. Anything the Activity Center filters on (`kind`, `status`, `agent_id`) is a
real column, because filtering JSON in SQLite is how a fast desktop app becomes a slow one.

---

## 2. Table map

```
identity     app_state          settings
models       model_install      engine_state
agents       agent_instruction  instruction_version
conversations message           message_attachment
memory       memory_history     memory_source_link
kb_root      kb_folder          kb_document      kb_chunk
vec_chunk    (virtual)          fts_*            (virtual)
tool         tool_grant         skill
job          activity           approval
learning     learning_suggestion  regression_case
update_record  backup_record
```

---

## 3. Schema (design DDL)

### 3.1 App state and settings

```sql
-- single-row tables; the core owns the only writer
CREATE TABLE app_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  contract_version   INTEGER NOT NULL DEFAULT 1,
  schema_version     INTEGER NOT NULL,
  embedding_model    TEXT,             -- fixed choice; changing it forces a re-embed
  embedding_dim      INTEGER,          -- must match vec_chunk's FLOAT[n]
  installed_at       TEXT    NOT NULL,
  last_opened_at     TEXT,
  last_error         TEXT          -- last core-level failure, shown in About
);
```

*Note on ordering:* the DDL in this document is grouped by domain for readability, not by creation
order. The real migration applies tables in dependency order — `kb_document` before
`message_attachment`, `models` before `engine_state`, and so on — since SQLite resolves
`REFERENCES` targets at creation time.

```sql
CREATE TABLE settings (
  section   TEXT NOT NULL,          -- one of the 13 Settings section ids
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,          -- JSON scalar/object
  value_kind TEXT NOT NULL,         -- 'bool' | 'int' | 'text' | 'json'
  measured  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (section, key)
);
```

`section` is constrained in the core to the exact ids the Settings screen renders — `general`,
`appearance`, `language`, `hardware`, `models`, `agents`, `memory`, `internet`, `security`,
`privacy`, `backup`, `portability`, `about`. A settings key with no UI is a setting nobody can
find, and the 13-section list is already the product's own definition of what is configurable.

`measured` on a row means "this value came from the system, not from the owner" — the flag that
lets the UI keep the Phase 1 discipline of distinguishing real from prototype.

### 3.2 Models

```sql
CREATE TABLE models (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  family          TEXT NOT NULL,
  params_b        REAL NOT NULL,
  quantization    TEXT NOT NULL,
  context_window  INTEGER NOT NULL,
  size_bytes      INTEGER NOT NULL,
  ram_gb_estimate REAL NOT NULL,        -- catalog claim, an estimate by definition
  ram_gb_actual   REAL,                 -- measured after first load; NULL until then
  gpu_recommended INTEGER NOT NULL DEFAULT 0,
  installed       INTEGER NOT NULL DEFAULT 0,
  in_catalog      INTEGER NOT NULL DEFAULT 1,
  version         TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  description     TEXT NOT NULL,
  tags            TEXT NOT NULL,        -- JSON array
  sha256          TEXT,
  path            TEXT                  -- NULL until installed; owner-visible folder
);
CREATE INDEX idx_models_installed ON models(installed, name);

CREATE TABLE model_install (
  id            TEXT PRIMARY KEY,
  model_id      TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,          -- 'import' | 'download'
  bytes         INTEGER NOT NULL,
  sha256        TEXT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  result        TEXT NOT NULL           -- 'success' | 'failed' | 'rolled-back'
);

CREATE TABLE engine_state (              -- single row; what engine.status() returns
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  binary_path   TEXT,
  version       TEXT,
  running       INTEGER NOT NULL DEFAULT 0,
  port          INTEGER,
  loaded_model  TEXT REFERENCES models(id),
  threads       INTEGER,
  context_cap   INTEGER,
  last_crash_at TEXT,
  crash_count   INTEGER NOT NULL DEFAULT 0
);
```

`ram_gb_estimate` and `ram_gb_actual` existing as separate columns is the point: the catalog's
numbers are guesses until a model has actually been loaded on this machine, and the Model Manager
should never present a guess as a measurement. Over time the actual column becomes the basis for
the fit badges and the estimate becomes history.

### 3.3 Agents and instructions

```sql
CREATE TABLE agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  description   TEXT NOT NULL,
  capabilities  TEXT NOT NULL,          -- JSON array
  model_id      TEXT REFERENCES models(id),
  enabled       INTEGER NOT NULL DEFAULT 1,
  built_in      INTEGER NOT NULL DEFAULT 0,
  icon          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE instruction_version (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version       TEXT NOT NULL,          -- 'v7'
  ts            TEXT NOT NULL,
  summary       TEXT NOT NULL,          -- what changed, in the owner's words
  status        TEXT NOT NULL CHECK (status IN ('current','history')),
  content_path  TEXT NOT NULL,          -- the actual prompt file on disk
  content_sha   TEXT NOT NULL,
  origin        TEXT NOT NULL           -- 'manual' | 'learning' | 'import'
);
CREATE UNIQUE INDEX uq_instr_current ON instruction_version(agent_id) WHERE status = 'current';
```

**The instruction text lives on disk, not in the database.** The DB holds version metadata and a
checksum. Rationale: prompts are the thing an owner will want to diff, edit in an external editor,
and version in their own backup; a Markdown file does all three, and a partial row cannot corrupt a
behaviour definition. The partial-write risk that motivates that split is the same one that makes
`origin` worth recording — an instruction change approved through the Learning Lab must be
distinguishable from one typed by hand.

### 3.4 Conversations

```sql
CREATE TABLE conversations (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  agent_id      TEXT REFERENCES agents(id) ON DELETE SET NULL,
  model_id      TEXT REFERENCES models(id) ON DELETE SET NULL,
  pinned        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0   -- denormalised for the list view
);
CREATE INDEX idx_conv_updated ON conversations(updated_at DESC);

CREATE TABLE message (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content          TEXT NOT NULL,
  ts               TEXT NOT NULL,
  model_id         TEXT,
  agent_id         TEXT,
  stopped          INTEGER NOT NULL DEFAULT 0,   -- generation cancelled mid-stream
  prompt_tokens    INTEGER,
  completion_tokens INTEGER,
  duration_ms      INTEGER,
  client_id        TEXT UNIQUE                   -- idempotency for retried sends
);
CREATE INDEX idx_msg_conv ON message(conversation_id, ts);

CREATE TABLE message_attachment (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('image','pdf','docx','code','csv')),
  size_bytes  INTEGER NOT NULL,
  path        TEXT,
  parsed      INTEGER NOT NULL DEFAULT 0,
  doc_id      TEXT REFERENCES kb_document(id) ON DELETE SET NULL
);
```

`stopped` and the token columns exist because the Chat screen already promises context usage;
without them the rail can only ever be simulated. `duration_ms` is what turns tokens/sec from an
estimate into a measured number, which is the single most valuable unknown on this hardware.

### 3.5 Memory

```sql
CREATE TABLE memory (
  id            TEXT PRIMARY KEY,
  tier          TEXT NOT NULL CHECK (tier IN ('short','long','preference','project','conversation')),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  source        TEXT NOT NULL,
  tags          TEXT NOT NULL,          -- JSON array
  approval      TEXT NOT NULL CHECK (approval IN ('approved','pending','rejected')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_retrieved_at TEXT,
  retrieval_count   INTEGER NOT NULL DEFAULT 0,
  archived_at   TEXT                    -- soft delete; NULL means live
);
CREATE INDEX idx_mem_tier ON memory(tier, approval, archived_at);

CREATE TABLE memory_history (
  id        TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  ts        TEXT NOT NULL,
  action    TEXT NOT NULL CHECK (action IN ('created','edited','approved','rejected','archived')),
  detail    TEXT NOT NULL
);
CREATE INDEX idx_memhist ON memory_history(memory_id, ts);

CREATE TABLE memory_source_link (
  memory_id  TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('conversation','message','document','job')),
  source_id  TEXT NOT NULL,
  PRIMARY KEY (memory_id, source_kind, source_id)
);
```

`retrieval_count` and `last_retrieved_at` make the Memory Center's tiers mean something over time:
"long-term memory" that has never been retrieved in six months is a claim, not a fact, and the
screen should be able to show that instead of pretending every row is load-bearing.
`memory_source_link` is what lets the UI answer "why do you think this is true" — the Phase 1
records already carry a `source` string; the link table makes it navigable rather than decorative.

### 3.6 Knowledge base

```sql
CREATE TABLE kb_root (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  watching    INTEGER NOT NULL DEFAULT 1,
  added_at    TEXT NOT NULL,
  last_scan_at TEXT
);

CREATE TABLE kb_folder (
  id        TEXT PRIMARY KEY,
  root_id   TEXT NOT NULL REFERENCES kb_root(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES kb_folder(id) ON DELETE CASCADE,
  name      TEXT NOT NULL
);

CREATE TABLE kb_document (
  id           TEXT PRIMARY KEY,
  root_id      TEXT NOT NULL REFERENCES kb_root(id) ON DELETE CASCADE,
  folder_id    TEXT REFERENCES kb_folder(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  collection   TEXT NOT NULL,
  file_type    TEXT NOT NULL CHECK (file_type IN ('pdf','docx','md','txt','csv','xlsx')),
  path         TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  pages        INTEGER,
  indexed      TEXT NOT NULL CHECK (indexed IN ('indexed','indexing','pending','failed')),
  indexed_at   TEXT,
  last_error   TEXT,
  updated_at   TEXT NOT NULL,
  mtime        INTEGER NOT NULL,     -- filesystem mtime, for change detection
  content_sha  TEXT,                 -- skip re-parsing when unchanged
  excerpt      TEXT
);
CREATE UNIQUE INDEX uq_doc_path ON kb_document(path);
CREATE INDEX idx_doc_state ON kb_document(indexed, collection);

CREATE TABLE kb_chunk (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES kb_document(id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,
  text        TEXT NOT NULL,
  page        INTEGER,
  token_count INTEGER,
  embedded    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (document_id, ordinal)
);
```

`mtime` plus `content_sha` is the difference between a watcher that re-parses the whole tree on
every launch and one that does the minimum work. Both columns are cheap and both prevent a class of
"why is my laptop busy" complaints that would otherwise land on this project.

### 3.7 Search and vectors

```sql
CREATE VIRTUAL TABLE fts_message USING fts5(content, message_id UNINDEXED, tokenize='porter unicode61');
CREATE VIRTUAL TABLE fts_memory  USING fts5(content, memory_id  UNINDEXED, tokenize='porter unicode61');
CREATE VIRTUAL TABLE fts_chunk   USING fts5(text,   chunk_id   UNINDEXED, tokenize='porter unicode61');

-- vector store: sqlite-vec if bundled, otherwise LanceDB files under cache/
CREATE VIRTUAL TABLE vec_chunk USING vec0(
  chunk_id  TEXT PRIMARY KEY,
  embedding FLOAT[384]            -- dimension fixed by the embedding model, recorded here
);
```

**Keyword search is not optional and not replaced by vectors.** FTS5 stays authoritative for exact
names, clause numbers, and code identifiers; vectors handle paraphrase. `kb.search` and
`memory.search` run both and merge, and the `measured` flag in the IPC contract tells the UI
whether the result came from a real index or a stub. That split is also the honest answer to
"why did it find this" — a BM25 hit and a cosine hit are different explanations.

Embedding dimension is a schema decision, not a runtime one: changing embedding model means a
migration and a full re-embed, so the chosen model is recorded in `app_state` alongside the
dimension. *To verify in M3:* whether `bge-m3` (1024-dim) or a smaller model fits the RAM budget
alongside a chat model — the answer decides `FLOAT[384]` versus `FLOAT[1024]`.

### 3.8 Tools, skills, jobs, activity, approvals

```sql
CREATE TABLE tool (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  description    TEXT NOT NULL,
  permissions    TEXT NOT NULL,        -- JSON array of declared permissions
  needs_approval INTEGER NOT NULL DEFAULT 1,
  enabled        INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL CHECK (status IN ('ready','disabled','error','running')),
  version        TEXT NOT NULL,
  last_run_at    TEXT,
  last_error     TEXT
);

CREATE TABLE tool_grant (
  tool_id    TEXT NOT NULL REFERENCES tool(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  scope      TEXT NOT NULL CHECK (scope IN ('once','always','never')),
  roots      TEXT,                      -- JSON array of allow-listed paths, where relevant
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (tool_id, permission)
);

CREATE TABLE skill (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  trigger    TEXT NOT NULL,
  steps      TEXT NOT NULL,             -- JSON array of step descriptions
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE job (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,           -- 'generate' | 'index' | 'embed' | 'tool' | 'export' …
  status       TEXT NOT NULL CHECK (status IN ('queued','running','success','failure','cancelled','timeout')),
  agent_id     TEXT,
  model_id     TEXT,
  priority     INTEGER NOT NULL DEFAULT 5,   -- interactive chat lower number than background
  created_at   TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT,
  progress_pct INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  cancelled    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_job_open ON job(status, priority, created_at);

CREATE TABLE activity (
  id            TEXT PRIMARY KEY,
  ts            TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('task','tool','model','error','warning','approval')),
  title         TEXT NOT NULL,
  detail        TEXT NOT NULL,
  agent_id      TEXT,
  status        TEXT NOT NULL CHECK (status IN ('success','failure','pending','running')),
  job_id        TEXT,
  correlation_id TEXT                 -- ties approval → grant → execution → result
);
CREATE INDEX idx_act_ts ON activity(ts DESC);
CREATE INDEX idx_act_kind ON activity(kind, ts DESC);

CREATE TABLE approval (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('tool_call','memory_write','net_fetch','model_download','instruction_change')),
  requested_by_agent TEXT,
  requested_by_tool  TEXT,
  requested_by_job   TEXT,
  summary       TEXT NOT NULL,        -- plain language: what will happen
  detail        TEXT,                 -- command line / path / URL / memory text
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  decided_at    TEXT,
  decision      TEXT CHECK (decision IN ('approved','rejected','expired')),
  scope         TEXT CHECK (scope IN ('once','always','never'))
);
CREATE INDEX idx_approval_open ON approval(decided_at) WHERE decided_at IS NULL;
```

`correlation_id` is the reason the Activity Center can eventually tell a coherent story instead of
listing events: an approval, the grant it produced, the tool run, and its result share one id. The
partial index on `approval(decided_at) WHERE decided_at IS NULL` is the pending queue the UI polls
via an event rather than a timer.

Expiry is stored, not inferred: an unanswered approval becomes `expired` on a core tick and is
treated as a denial, matching the rule that silence never grants permission.

### 3.9 Learning, updates, backups

```sql
CREATE TABLE learning (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('correction','mistake','error')),
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL,
  severity   TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  category   TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  ts         TEXT NOT NULL,
  resolved   INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  agent_id   TEXT,
  job_id     TEXT
);

CREATE TABLE learning_suggestion (
  id           TEXT PRIMARY KEY,
  learning_id  TEXT NOT NULL REFERENCES learning(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('instruction','memory','skill','test')),
  text         TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('proposed','approved','rejected','applied')),
  applied_at   TEXT,
  result_ref   TEXT          -- instruction_version id / memory id / skill id it produced
);

CREATE TABLE regression_case (
  id           TEXT PRIMARY KEY,
  learning_id  TEXT REFERENCES learning(id) ON DELETE SET NULL,
  prompt       TEXT NOT NULL,
  expect       TEXT NOT NULL,          -- assertion text; checker is a core routine
  enabled      INTEGER NOT NULL DEFAULT 1,
  last_result  TEXT CHECK (last_result IN ('pass','fail','never_run')),
  last_run_at  TEXT
);

CREATE TABLE update_record (
  id     TEXT PRIMARY KEY,
  date   TEXT NOT NULL,
  item   TEXT NOT NULL,
  kind   TEXT NOT NULL CHECK (kind IN ('model','app','skill')),
  from_v TEXT,
  to_v   TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success','rolled-back','failed'))
);

CREATE TABLE backup_record (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  verified    INTEGER NOT NULL DEFAULT 0
);
```

`result_ref` closes the loop the Learning Lab screen promises: an approved suggestion must be
traceable to the concrete artefact it created, otherwise "the platform learns from corrections" is
a slogan. `regression_case.last_result` includes `'never_run'` explicitly — an untested case is not
a passing one, and the UI should be able to say which is which.

---

## 4. Migrations

`PRAGMA user_version` holds the schema version; migrations are numbered SQL files
(`0007_kb_chunk_embedded.sql`) applied in a transaction on launch, oldest first, with the core
refusing to open if any step fails rather than running half-applied.

Rules:
- **Additive first.** New columns default NULL; destructive changes only in a numbered migration
  with a verified backup taken automatically beforehand.
- **No ORM magic.** Hand-written SQL, reviewed as a diff. On a single-user desktop app the
  abstraction buys nothing and hides exactly the things that matter (transactions, pragmas, FTS).
- **Rebuildable data is not migrated.** `kb_chunk`, `vec_chunk`, and the FTS tables can always be
  rebuilt from source files; a broken derived index is a re-index job, not a data-loss event.
- **Downgrade is unsupported by design.** The owner keeps the previous backup; the app tells them
  so rather than pretending a rollback path exists.

---

## 5. Retention and pruning defaults

| Data | Default | Rationale |
|---|---|---|
| `activity` | 90 days, then pruned on demand from Settings → Privacy | Timeline stays useful; unbounded logs on an SMR HDD are a slow disk killer |
| `job` | 30 days for finished jobs | Queue history matters briefly, not forever |
| `approval` | kept indefinitely (small rows) | Permissions provenance is the one log worth keeping forever |
| `message` | kept until the owner deletes the conversation | Conversations are the product, not a cache |
| `memory` | `archived_at` soft delete, purge after 30 days | Reversible deletion, matching the UI's confirm dialogs |
| `kb_chunk` / vectors | rebuilt, never aged | Derived data |
| `learning` | kept until resolved + 180 days | Corrections are the improvement record |
| `backup_record` | last 8 | Enough to step back, small enough to be intentional |

Purging is always owner-triggered from the Privacy or Backup sections. Nothing self-deletes silently
— a desktop app that quietly discards the owner's history has broken the one trust relationship it
has.

---

## 6. What deliberately does **not** go in the database

- **Model weights.** Files on disk, owner-visible; the DB stores path, size, and checksum only.
- **Instruction prompt text.** Markdown files with a checksum in `instruction_version`.
- **Parsed document cache.** Under `cache/`, rebuildable.
- **Prompt and document content in logs.** The activity log stores titles and details about actions,
  not the content acted on. On a single-user machine, plaintext prompt logs are a privacy liability
  with no debugging benefit that a checksum can't provide.
- **Secrets.** None are needed locally; if a remote provider is ever added, its key goes to the OS
  credential store, never into `settings`.

---

## 7. Backup, restore, integrity

```
store.backup():   wal_checkpoint(TRUNCATE) → copy db + sidecars to a timestamped zip
                  → PRAGMA integrity_check on the copy → backup_record row (verified=1)
store.restore():  refuse while a job is running → back up current db first → replace → migrate
store.export():   JSON dump of owner data (conversations, memory, kb metadata), no weights
```

Three points worth calling out: `integrity_check` runs on the *copy*, because checking the live file
while the app uses it is theatre; restore always backs up the thing it is about to overwrite,
because a restore is the most destructive operation the app offers; and export excludes weights and
cache by construction, since an "export" that drags 5 GB of GGUF is not an export of the owner's
data.

---

## 8. Open items for M2

1. Whether `short` tier memory rows live in the DB at all or only in process memory with a TTL —
   the Phase 1 copy says short-term memory "expires within hours", which argues for a TTL column
   rather than a pruning job.
2. FTS sync strategy: triggers versus explicit writes from the core. Triggers are simpler and
   harder to desync; explicit writes allow tokenizer changes without touching table definitions.
3. Whether `correlation_id` is generated per approval or per job chain.
4. Vector store final choice (`sqlite-vec` in-file versus LanceDB sidecar files) — decided when the
   embedding model's dimension and RAM cost are measured in M3.

---

## 9. Companion documents

`ARCHITECTURE.md` (process topology, where this store sits) · `PHASE2_IPC_CONTRACT.md` (the
commands that read and write these tables) · `PHASE2_POLICY_MODEL.md` · `PHASE2_SIDECAR_SPEC.md` ·
`PHASE2_MILESTONES.md`
