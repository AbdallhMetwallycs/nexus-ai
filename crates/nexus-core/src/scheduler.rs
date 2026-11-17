//! The single execution slot (M4).
//!
//! One background thread owns a FIFO of `job` rows. It takes the oldest queued job, runs
//! its steps in order, and puts a job back in the queue while an approval is unanswered,
//! so the slot is never held by a human decision. Every start, denial and result is
//! written to `activity` with the job's `correlation_id`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use nexus_policy::{args_hash, decide_tool, resolve_in_roots, ToolFacts, Verdict};
use nexus_store::types::{ApprovalRow, PlannedStep, ToolRecord};
use nexus_store::{now_iso, now_iso_plus, Store};

use crate::tools;

const TICK: Duration = Duration::from_millis(200);
const APPROVAL_SECONDS: i64 = 300;

pub struct JobRunner {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl JobRunner {
    pub fn start(db_path: PathBuf) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let handle = thread::Builder::new()
            .name("nexus-job-runner".into())
            .spawn(move || runner_loop(db_path, flag))
            .ok();
        Self { stop, handle }
    }
}

impl Drop for JobRunner {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn runner_loop(db_path: PathBuf, stop: Arc<AtomicBool>) {
    let mut store: Option<Store> = None;
    while !stop.load(Ordering::SeqCst) {
        if store.is_none() {
            match Store::open(&db_path) {
                Ok(opened) => store = Some(opened),
                Err(err) => {
                    eprintln!("NEXUS job runner could not open the database: {err}");
                    sleep(&stop, Duration::from_secs(5));
                    continue;
                }
            }
        }
        let Some(mut db) = store.take() else { continue };
        let now = now_iso();
        let _ = db.expire_approvals(&now);
        handle_expired(&mut db, &now);
        if let Ok(Some(job_id)) = db.next_queued_job() {
            run_job(&mut db, &job_id);
        }
        store = Some(db);
        sleep(&stop, TICK);
    }
}

fn sleep(stop: &AtomicBool, duration: Duration) {
    let step = Duration::from_millis(50);
    let mut waited = Duration::ZERO;
    while waited < duration && !stop.load(Ordering::SeqCst) {
        thread::sleep(step.min(duration - waited));
        waited += step;
    }
}

fn handle_expired(store: &mut Store, now: &str) {
    let Ok(rows) = store.expired_open_jobs() else { return };
    for approval in rows {
        let (Some(job_id), Some(idx)) = (approval.job_id.as_deref(), approval.step_idx) else {
            continue;
        };
        let reason = format!(
            "Approval expired unanswered after 5 minutes ({}). Nothing ran.",
            approval.summary
        );
        let _ = store.deny_step(job_id, idx);
        let _ = store.finish_job(job_id, "failure", None, Some(&reason), 0, now);
        let _ = store.record_activity(
            "approval",
            "Approval expired — step denied",
            &reason,
            approval.agent_id.as_deref(),
            "failure",
            Some(job_id),
            approval.correlation_id.as_deref().or(Some(approval.id.as_str())),
            now,
        );
        let _ = store.consume_approval(&approval.id, now);
    }
}

fn run_job(store: &mut Store, job_id: &str) {
    let now = now_iso();
    let Ok(job) = store.get_job(job_id) else { return };
    if job.status != "queued" {
        return;
    }
    let _ = store.mark_job_running(job_id, &now);
    let correlation = job.correlation_id.clone().unwrap_or_else(|| job_id.to_owned());
    let total = job.steps.len().max(1) as i64;
    let _ = store.record_activity(
        "task",
        "Job started",
        &format!("{} ({} step{})", job.kind, total, if total == 1 { "" } else { "s" }),
        job.agent_id.as_deref(),
        "running",
        Some(job_id),
        Some(&correlation),
        &now,
    );

    loop {
        let pending = store.pending_step(job_id).ok().flatten();
        let Some((idx, step)) = pending else { break };
        let now = now_iso();
        let tool = match store.get_tool(&step.tool_id) {
            Ok(tool) => tool,
            Err(err) => {
                fail_job(store, job_id, &step, &format!("{}: {}", err.code, err.message), &correlation, &now);
                return;
            }
        };

        // Root check before any approval prompt or effect, so a traversal is a denial and
        // not a question.
        if let Some(path) = step.args.get("path").and_then(serde_json::Value::as_str) {
            if let Err(err) = resolve_in_roots(std::path::Path::new(path), &tools::allowed_roots(store)) {
                deny_step(
                    store,
                    job_id,
                    idx,
                    Denial { step: &step, code: err.code, message: &err.message },
                    &correlation,
                    &now,
                );
                return;
            }
        }

        let hash = args_hash(&[&step.tool_id, &step.args.to_string()]);
        let standing = tool.permissions.iter().all(|perm| store.standing_grant(&tool.id, perm, &now));
        let approved = store.usable_approval(&tool.id, &hash, &now).ok().flatten();
        let verdict = decide_tool(&ToolFacts {
            status: &tool.status,
            enabled: tool.enabled,
            declared: &tool.permissions,
            needed: &tool.permissions,
            standing_grant: standing,
            needs_approval: tool.needs_approval,
            has_approval: approved.is_some(),
        });

        match verdict {
            Verdict::Deny(code) => {
                let message = denial_message(&tool, code);
                deny_step(
                    store,
                    job_id,
                    idx,
                    Denial { step: &step, code, message: &message },
                    &correlation,
                    &now,
                );
                return;
            }
            Verdict::RequireApproval => {
                let (summary, detail) = tools::approval_summary(store, &step);
                let expires = now_iso_plus(APPROVAL_SECONDS);
                match store.create_approval(
                    "tool_call",
                    job.agent_id.as_deref(),
                    Some(&tool.id),
                    Some(job_id),
                    Some(idx),
                    &summary,
                    Some(&detail),
                    &hash,
                    &correlation,
                    &now,
                    &expires,
                ) {
                    Ok(approval_id) => {
                        let _ = store.await_step(job_id, idx);
                        let _ = store.park_job(job_id);
                        let _ = store.record_activity(
                            "approval",
                            "Approval requested",
                            &format!("{summary} — waiting for the owner (approval {approval_id})."),
                            job.agent_id.as_deref(),
                            "pending",
                            Some(job_id),
                            Some(&correlation),
                            &now,
                        );
                    }
                    Err(err) => {
                        fail_job(store, job_id, &step, &format!("{}: {}", err.code, err.message), &correlation, &now);
                    }
                }
                return;
            }
            Verdict::Allow => {}
        }

        let _ = store.mark_step_running(job_id, idx, &now);
        let started = now.clone();
        let outcome = tools::execute(store, &step);
        let finished = now_iso();
        let outcome_detail = match &outcome {
            Ok(value) => summarize(value),
            Err(err) => err.message.clone(),
        };
        let _ = store.record_activity(
            "tool",
            &format!("{} · {}", tool.name, if outcome.is_ok() { "succeeded" } else { "failed" }),
            &outcome_detail,
            job.agent_id.as_deref(),
            if outcome.is_ok() { "success" } else { "failure" },
            Some(job_id),
            Some(&correlation),
            &finished,
        );
        match outcome {
            Ok(value) => {
                let _ = store.finish_step(job_id, idx, "success", Some(&value.to_string()), None, &finished);
                let _ = store.record_tool_run(&tool.id, None, &finished);
                if let Some(approval) = approved {
                    let _ = store.consume_approval(&approval.id, &finished);
                }
                let done = idx + 1;
                let _ = store.set_job_progress(job_id, (done * 100 / total).min(99));
                let _ = started;
            }
            Err(err) => {
                let _ = store.finish_step(job_id, idx, "failure", None, Some(&err.message), &finished);
                let _ = store.record_tool_run(&tool.id, Some(&err.message), &finished);
                let _ = store.finish_job(job_id, "failure", None, Some(&err.message), 0, &finished);
                let _ = store.record_activity(
                    "task",
                    "Job failed",
                    &format!("{} stopped at step {}: {}", job.kind, idx + 1, err.message),
                    job.agent_id.as_deref(),
                    "failure",
                    Some(job_id),
                    Some(&correlation),
                    &finished,
                );
                return;
            }
        }
    }

    let finished = now_iso();
    let Ok(detail) = store.get_job(job_id) else { return };
    let statuses: Vec<String> = detail
        .steps
        .iter()
        .map(|s| format!("{}:{}", s.tool_id, s.status))
        .collect();
    let output = format!("{} step{} completed ({})", detail.steps.len(), if detail.steps.len() == 1 { "" } else { "s" }, statuses.join(", "));
    let _ = store.finish_job(job_id, "success", Some(&output), None, 100, &finished);
    let _ = store.record_activity(
        "task",
        "Job finished",
        &output,
        job.agent_id.as_deref(),
        "success",
        Some(job_id),
        Some(&correlation),
        &finished,
    );
}

struct Denial<'a> {
    step: &'a PlannedStep,
    code: &'a str,
    message: &'a str,
}

fn deny_step(
    store: &mut Store,
    job_id: &str,
    idx: i64,
    denial: Denial<'_>,
    correlation: &str,
    now: &str,
) {
    let Denial { step, code, message } = denial;
    let _ = store.finish_step(job_id, idx, "denied", None, Some(message), now);
    let _ = store.finish_job(job_id, "failure", None, Some(message), 0, now);
    let _ = store.record_activity(
        "approval",
        &format!("{} denied by policy", step.tool_id),
        &format!("{code}: {message}"),
        None,
        "failure",
        Some(job_id),
        Some(correlation),
        now,
    );
    let _ = store.record_activity(
        "task",
        "Job failed",
        &format!("Stopped before step {} — {code}.", idx + 1),
        None,
        "failure",
        Some(job_id),
        Some(correlation),
        now,
    );
}

fn fail_job(
    store: &mut Store,
    job_id: &str,
    step: &PlannedStep,
    message: &str,
    correlation: &str,
    now: &str,
) {
    let _ = store.finish_step(job_id, 0, "failure", None, Some(message), now);
    let _ = store.finish_job(job_id, "failure", None, Some(message), 0, now);
    let _ = store.record_activity(
        "task",
        "Job failed",
        &format!("{} could not run: {message}", step.tool_id),
        None,
        "failure",
        Some(job_id),
        Some(correlation),
        now,
    );
}

fn denial_message(tool: &ToolRecord, code: &str) -> String {
    match code {
        "policy.tool_disabled" => format!("{} is disabled in the Tools screen.", tool.name),
        "policy.tool_error" => format!(
            "{} is in an error state{}.",
            tool.name,
            tool.last_error.as_deref().map(|e| format!(" ({e})")).unwrap_or_default()
        ),
        "policy.permission_undeclared" => {
            format!("{} would use a permission it never declared.", tool.name)
        }
        other => format!("{} was refused ({other}).", tool.name),
    }
}

fn summarize(value: &serde_json::Value) -> String {
    let text = value.to_string();
    if text.len() <= 400 {
        text
    } else {
        format!("{}…", &text[..400])
    }
}

/// Fail a parked job whose approval was rejected, from the dispatch thread, so the reason
/// is visible immediately rather than on the next runner tick.
pub fn deny_approved_job(store: &mut Store, approval: &ApprovalRow, now: &str) {
    let (Some(job_id), Some(idx)) = (approval.job_id.as_deref(), approval.step_idx) else {
        return;
    };
    let reason = format!("Approval rejected by the owner: {}. Nothing ran.", approval.summary);
    let _ = store.deny_step(job_id, idx);
    let _ = store.finish_job(job_id, "failure", None, Some(&reason), 0, now);
    let _ = store.record_activity(
        "approval",
        "Approval rejected",
        &reason,
        approval.agent_id.as_deref(),
        "failure",
        Some(job_id),
        approval.correlation_id.as_deref(),
        now,
    );
    let _ = store.record_activity(
        "task",
        "Job stopped",
        &format!("Stopped at step {} because the approval was rejected.", idx + 1),
        approval.agent_id.as_deref(),
        "failure",
        Some(job_id),
        approval.correlation_id.as_deref(),
        now,
    );
}
