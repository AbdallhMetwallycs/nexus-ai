//! Jobs and their steps (M4).
//!
//! A job is the record of an agent run: `queued → running → success | failure`. A step is
//! one tool call inside it. The scheduler executes; this module only stores, so a crash
//! leaves a readable queue rather than a lost list.

use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::types::{JobInfo, JobStepView, PlannedStep};
use crate::{new_id, Store, StoreError, StoreResult};

impl Store {
    pub fn create_job(
        &self,
        kind: &str,
        agent_id: Option<&str>,
        model_id: Option<&str>,
        priority: i64,
        correlation_id: &str,
        now: &str,
    ) -> StoreResult<String> {
        let id = new_id("job");
        self.conn.execute(
            "INSERT INTO job (id, kind, status, agent_id, model_id, priority, created_at,
                              progress_pct, correlation_id)
             VALUES (?1, ?2, 'queued', ?3, ?4, ?5, ?6, 0, ?7)",
            params![id, kind, agent_id, model_id, priority, now, correlation_id],
        )?;
        Ok(id)
    }

    pub fn add_job_step(
        &self,
        job_id: &str,
        idx: i64,
        step: &PlannedStep,
        correlation_id: &str,
    ) -> StoreResult<()> {
        self.conn.execute(
            "INSERT INTO job_step (job_id, idx, tool_id, args, status, correlation_id)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5)",
            params![job_id, idx, step.tool_id, step.args.to_string(), correlation_id],
        )?;
        Ok(())
    }

    pub fn get_job(&self, id: &str) -> StoreResult<JobInfo> {
        let mut job = self
            .conn
            .query_row(
                "SELECT id, kind, status, agent_id, model_id, priority, created_at, started_at,
                        finished_at, progress_pct, error, output, correlation_id
                   FROM job WHERE id = ?1",
                [id],
                |row| {
                    Ok(JobInfo {
                        id: row.get(0)?,
                        kind: row.get(1)?,
                        status: row.get(2)?,
                        agent_id: row.get(3)?,
                        model_id: row.get(4)?,
                        priority: row.get(5)?,
                        created_at: row.get(6)?,
                        started_at: row.get(7)?,
                        finished_at: row.get(8)?,
                        progress_pct: row.get(9)?,
                        error: row.get(10)?,
                        output: row.get(11)?,
                        correlation_id: row.get(12)?,
                        steps: Vec::new(),
                    })
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::unknown_id("job", id))?;
        job.steps = self.job_steps(id)?;
        Ok(job)
    }

    pub fn job_steps(&self, job_id: &str) -> StoreResult<Vec<JobStepView>> {
        let mut stmt = self.conn.prepare(
            "SELECT idx, tool_id, args, status, output, error, correlation_id, started_at,
                    finished_at
               FROM job_step WHERE job_id = ?1 ORDER BY idx",
        )?;
        let rows = stmt
            .query_map([job_id], |row| {
                let args: String = row.get(2)?;
                Ok(JobStepView {
                    idx: row.get(0)?,
                    tool_id: row.get(1)?,
                    args: serde_json::from_str(&args).unwrap_or(Value::Null),
                    status: row.get(3)?,
                    output: row.get(4)?,
                    error: row.get(5)?,
                    correlation_id: row.get(6)?,
                    started_at: row.get(7)?,
                    finished_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// The oldest runnable job: queued, and not parked on an approval. One worker means
    /// exactly one of these can be running at a time.
    pub fn next_queued_job(&self) -> StoreResult<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT j.id FROM job j
                  WHERE j.status = 'queued'
                    AND NOT EXISTS (SELECT 1 FROM job_step s
                                     WHERE s.job_id = j.id AND s.status = 'awaiting_approval')
                  ORDER BY j.priority, j.created_at LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn mark_job_running(&self, id: &str, now: &str) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE job SET status = 'running', started_at = COALESCE(started_at, ?2)
              WHERE id = ?1",
            params![id, now],
        )?;
        Ok(())
    }

    pub fn finish_job(
        &self,
        id: &str,
        status: &str,
        output: Option<&str>,
        error: Option<&str>,
        progress: i64,
        now: &str,
    ) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE job SET status = ?2, output = ?3, error = ?4, progress_pct = ?5,
                    finished_at = ?6
              WHERE id = ?1",
            params![id, status, output, error, progress, now],
        )?;
        Ok(())
    }

    /// Release the single execution slot while this job waits for a human decision.
    pub fn park_job(&self, id: &str) -> StoreResult<()> {
        self.conn.execute("UPDATE job SET status = 'queued' WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn set_job_progress(&self, id: &str, pct: i64) -> StoreResult<()> {
        self.conn.execute("UPDATE job SET progress_pct = ?2 WHERE id = ?1", params![id, pct])?;
        Ok(())
    }

    pub fn recent_jobs(&self, limit: usize) -> StoreResult<Vec<JobInfo>> {
        let ids: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM job ORDER BY created_at DESC LIMIT ?1")?;
            let rows = stmt
                .query_map([limit as i64], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        ids.into_iter().map(|id| self.get_job(&id)).collect()
    }

    pub fn pending_step(&self, job_id: &str) -> StoreResult<Option<(i64, PlannedStep)>> {
        Ok(self
            .conn
            .query_row(
                "SELECT idx, tool_id, args FROM job_step
                  WHERE job_id = ?1 AND status = 'pending' ORDER BY idx LIMIT 1",
                [job_id],
                |row| {
                    let args: String = row.get(2)?;
                    Ok((
                        row.get::<_, i64>(0)?,
                        PlannedStep {
                            tool_id: row.get(1)?,
                            args: serde_json::from_str(&args).unwrap_or(Value::Null),
                        },
                    ))
                },
            )
            .optional()?)
    }

    pub fn mark_step_running(&self, job_id: &str, idx: i64, now: &str) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE job_step SET started_at = COALESCE(started_at, ?3) WHERE job_id = ?1 AND idx = ?2",
            params![job_id, idx, now],
        )?;
        Ok(())
    }

    pub fn finish_step(
        &self,
        job_id: &str,
        idx: i64,
        status: &str,
        output: Option<&str>,
        error: Option<&str>,
        now: &str,
    ) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE job_step SET status = ?3, output = ?4, error = ?5, finished_at = ?6
              WHERE job_id = ?1 AND idx = ?2",
            params![job_id, idx, status, output, error, now],
        )?;
        Ok(())
    }

    pub fn await_step(&self, job_id: &str, idx: i64) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE job_step SET status = 'awaiting_approval' WHERE job_id = ?1 AND idx = ?2",
            params![job_id, idx],
        )?;
        Ok(())
    }

    /// An approval decision releases the step it was raised for.
    pub fn release_step(&self, job_id: &str, idx: i64) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE job_step SET status = 'pending'
              WHERE job_id = ?1 AND idx = ?2 AND status = 'awaiting_approval'",
            params![job_id, idx],
        )?;
        Ok(())
    }

    pub fn deny_step(&self, job_id: &str, idx: i64) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE job_step SET status = 'denied' WHERE job_id = ?1 AND idx = ?2",
            params![job_id, idx],
        )?;
        Ok(())
    }
}
