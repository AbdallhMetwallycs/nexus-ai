-- M4: the execution seam — agents carry their instructions, jobs carry their steps and a
-- correlation id, and approvals carry the argument fingerprint they authorise.
--
-- Nothing here changes an existing meaning: the added columns are nullable or have a
-- default, so an M2/M3 database upgrades in place.

ALTER TABLE agents ADD COLUMN instructions TEXT NOT NULL DEFAULT '';

ALTER TABLE job ADD COLUMN correlation_id TEXT;
ALTER TABLE job ADD COLUMN output TEXT;

ALTER TABLE approval ADD COLUMN args_hash TEXT;
ALTER TABLE approval ADD COLUMN used_at TEXT;
ALTER TABLE approval ADD COLUMN correlation_id TEXT;
ALTER TABLE approval ADD COLUMN step_idx INTEGER;

CREATE TABLE job_step (
  job_id         TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  idx            INTEGER NOT NULL,
  tool_id        TEXT NOT NULL,
  args           TEXT NOT NULL,          -- JSON object of the call
  status         TEXT NOT NULL CHECK (status IN
                   ('pending','awaiting_approval','success','failure','denied')),
  output         TEXT,
  error          TEXT,
  correlation_id TEXT,
  started_at     TEXT,
  finished_at    TEXT,
  PRIMARY KEY (job_id, idx)
);
CREATE INDEX idx_step_job ON job_step(job_id, idx);
