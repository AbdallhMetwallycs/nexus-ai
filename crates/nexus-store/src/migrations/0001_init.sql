-- NEXUS AI — migration 0001: the M0 data model, verbatim in dependency order.
--
-- Source: PHASE2_DATA_MODEL.md §3. Dependency order matters because SQLite resolves
-- REFERENCES targets at CREATE time. Derived tables (kb_chunk, fts_*) are rebuildable
-- per §4; vec_chunk is deliberately absent until M3 chooses sqlite-vec or sidecar files
-- (§8 item 4). A schema change is a new numbered file, never an edit to this one.

CREATE TABLE app_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  contract_version   INTEGER NOT NULL DEFAULT 1,
  schema_version     INTEGER NOT NULL,
  embedding_model    TEXT,
  embedding_dim      INTEGER,
  installed_at       TEXT    NOT NULL,
  last_opened_at     TEXT,
  last_error         TEXT
);

CREATE TABLE settings (
  section    TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  value_kind TEXT NOT NULL,
  measured   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (section, key)
);

CREATE TABLE models (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  family          TEXT NOT NULL,
  params_b        REAL NOT NULL,
  quantization    TEXT NOT NULL,
  context_window  INTEGER NOT NULL,
  size_bytes      INTEGER NOT NULL,
  ram_gb_estimate REAL NOT NULL,
  ram_gb_actual   REAL,
  gpu_recommended INTEGER NOT NULL DEFAULT 0,
  installed       INTEGER NOT NULL DEFAULT 0,
  in_catalog      INTEGER NOT NULL DEFAULT 1,
  version         TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  description     TEXT NOT NULL,
  tags            TEXT NOT NULL,
  sha256          TEXT,
  path            TEXT
);
CREATE INDEX idx_models_installed ON models(installed, name);

CREATE TABLE model_install (
  id            TEXT PRIMARY KEY,
  model_id      TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  sha256        TEXT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  result        TEXT NOT NULL
);

CREATE TABLE engine_state (
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

CREATE TABLE agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  description   TEXT NOT NULL,
  capabilities  TEXT NOT NULL,
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
  version       TEXT NOT NULL,
  ts            TEXT NOT NULL,
  summary       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('current','history')),
  content_path  TEXT NOT NULL,
  content_sha   TEXT NOT NULL,
  origin        TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_instr_current ON instruction_version(agent_id) WHERE status = 'current';

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
  mtime        INTEGER NOT NULL,
  content_sha  TEXT,
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

CREATE TABLE conversations (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  agent_id      TEXT REFERENCES agents(id) ON DELETE SET NULL,
  model_id      TEXT REFERENCES models(id) ON DELETE SET NULL,
  pinned        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0
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
  stopped          INTEGER NOT NULL DEFAULT 0,
  prompt_tokens    INTEGER,
  completion_tokens INTEGER,
  duration_ms      INTEGER,
  client_id        TEXT UNIQUE
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

CREATE TABLE memory (
  id            TEXT PRIMARY KEY,
  tier          TEXT NOT NULL CHECK (tier IN ('short','long','preference','project','conversation')),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  source        TEXT NOT NULL,
  tags          TEXT NOT NULL,
  approval      TEXT NOT NULL CHECK (approval IN ('approved','pending','rejected')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_retrieved_at TEXT,
  retrieval_count   INTEGER NOT NULL DEFAULT 0,
  archived_at   TEXT
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

CREATE TABLE tool (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  description    TEXT NOT NULL,
  permissions    TEXT NOT NULL,
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
  roots      TEXT,
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (tool_id, permission)
);

CREATE TABLE skill (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  trigger    TEXT NOT NULL,
  steps      TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE job (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('queued','running','success','failure','cancelled','timeout')),
  agent_id     TEXT,
  model_id     TEXT,
  priority     INTEGER NOT NULL DEFAULT 5,
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
  correlation_id TEXT
);
CREATE INDEX idx_act_ts ON activity(ts DESC);
CREATE INDEX idx_act_kind ON activity(kind, ts DESC);

CREATE TABLE approval (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('tool_call','memory_write','net_fetch','model_download','instruction_change')),
  requested_by_agent TEXT,
  requested_by_tool  TEXT,
  requested_by_job   TEXT,
  summary       TEXT NOT NULL,
  detail        TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  decided_at    TEXT,
  decision      TEXT CHECK (decision IN ('approved','rejected','expired')),
  scope         TEXT CHECK (scope IN ('once','always','never'))
);
CREATE INDEX idx_approval_open ON approval(decided_at) WHERE decided_at IS NULL;

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
  result_ref   TEXT
);

CREATE TABLE regression_case (
  id           TEXT PRIMARY KEY,
  learning_id  TEXT REFERENCES learning(id) ON DELETE SET NULL,
  prompt       TEXT NOT NULL,
  expect       TEXT NOT NULL,
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

-- Derived indexes. Rebuildable per PHASE2_DATA_MODEL.md §4; sync is an explicit write
-- from the core (open item 2), not a trigger, so the table definitions stay migration-only.
CREATE VIRTUAL TABLE fts_message USING fts5(content, message_id UNINDEXED, tokenize='porter unicode61');
CREATE VIRTUAL TABLE fts_memory  USING fts5(content, memory_id  UNINDEXED, tokenize='porter unicode61');
CREATE VIRTUAL TABLE fts_chunk   USING fts5(text,   chunk_id   UNINDEXED, tokenize='porter unicode61');

INSERT INTO app_state (id, contract_version, schema_version, installed_at)
VALUES (1, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
