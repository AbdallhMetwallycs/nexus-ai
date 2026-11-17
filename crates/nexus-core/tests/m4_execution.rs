//! M4 exit-gate evidence: the Developer Agent, the approval queue and the single
//! execution slot, exercised through the real `execute` router against a file-backed store.
//!
//! Each test names the milestone line it proves. They load no model, so they are part of
//! the ordinary `cargo test -p nexus-core` run and must stay fast.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use nexus_core::dispatch::{Core, RecordingSink};
use nexus_core::system::now_iso8601;
use nexus_store::types::ActivityFilter;
use nexus_store::{Store, DEVELOPER_AGENT};
use serde_json::{json, Value};

const WAIT: Duration = Duration::from_secs(30);

struct Harness {
    core: Core,
    dir: PathBuf,
    notes: PathBuf,
}

impl Harness {
    fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("nexus-m4-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let notes = dir.join("notes");
        std::fs::create_dir_all(&notes).unwrap();
        std::fs::write(notes.join("seed.txt"), "seed\n").unwrap();
        let db = dir.join("nexus.db");
        let store = Store::open(&db).unwrap();
        store
            .kb_add_root(&notes.to_string_lossy(), "notes", &now_iso8601())
            .unwrap();
        let core = Core::new(&dir, dir.join("engine"))
            .with_store(store)
            .with_runner(&db);
        Self { core, dir, notes }
    }

    fn call(&mut self, command: &str, args: Value) -> Value {
        let mut sink = RecordingSink::default();
        self.core.execute(command, &args, &mut sink).unwrap()
    }

    fn run_plan(&mut self, plan: &str) -> String {
        let queued = self.call(
            "agent.run",
            json!({ "agentId": DEVELOPER_AGENT, "input": plan }),
        );
        queued["jobId"].as_str().expect("agent.run returned no jobId").to_owned()
    }

    fn wait_job(&mut self, id: &str) -> Value {
        let started = Instant::now();
        loop {
            let job = self.call("job.get", json!({ "id": id }));
            let status = job["status"].as_str().unwrap_or("");
            if status == "success" || status == "failure" {
                return job;
            }
            assert!(started.elapsed() < WAIT, "job {id} never finished; last {job}");
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn wait_approval(&mut self) -> Value {
        let started = Instant::now();
        loop {
            let pending = self.call("approval.pending", json!({}));
            if let Some(first) = pending.as_array().and_then(|items| items.first()) {
                return first.clone();
            }
            assert!(started.elapsed() < WAIT, "no approval appeared within the wait");
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn activity_for(&mut self, job_id: &str) -> Vec<Value> {
        let store = self.core.store.as_ref().unwrap();
        let (events, _) = store
            .list_activity(&ActivityFilter {
                kind: None,
                agent_id: None,
                query: None,
                from: None,
                to: None,
                limit: 500,
                offset: 0,
            })
            .unwrap();
        let value = serde_json::to_value(events).unwrap();
        value
            .as_array()
            .unwrap()
            .iter()
            .filter(|event| event.get("jobId").and_then(Value::as_str) == Some(job_id))
            .cloned()
            .collect()
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn a_three_step_developer_task_completes_and_every_step_is_logged_under_one_correlation() {
    let mut h = Harness::new("plan");
    let notes = h.notes.to_string_lossy().replace('\\', "/");
    let plan = format!(
        "fs.list {notes}\nfs.write {notes}/summary.md | NEXUS M4 OK\nfs.read \"{notes}/summary.md\""
    );
    let job_id = h.run_plan(&plan);

    let approval = h.wait_approval();
    assert_eq!(approval["kind"], "tool_call");
    assert!(
        approval["summary"].as_str().unwrap().contains("summary.md"),
        "approval does not name the file: {approval}"
    );
    h.call(
        "approval.decide",
        json!({ "id": approval["id"], "approved": true, "scope": "once" }),
    );

    let job = h.wait_job(&job_id);
    assert_eq!(job["status"], "success", "job did not finish: {job}");
    let steps = job["steps"].as_array().unwrap();
    assert_eq!(steps.len(), 3);
    for step in steps {
        assert_eq!(step["status"], "success", "step failed: {step}");
    }
    assert!(
        steps[2]["output"].as_str().unwrap().contains("NEXUS M4 OK"),
        "fs.read did not return what fs.write wrote: {job}"
    );

    let correlation = job["correlationId"].as_str().unwrap();
    for step in steps {
        assert_eq!(step["correlationId"], correlation);
    }
    let events = h.activity_for(&job_id);
    assert!(
        events.len() >= 5,
        "expected start, tool, approval and finish rows; got {events:?}"
    );
    for event in &events {
        assert_eq!(
            event["correlationId"], correlation,
            "an activity row was logged without the job correlation: {event}"
        );
    }
    assert!(events.iter().any(|e| e["title"] == "Job started"));
    assert!(events.iter().any(|e| e["title"] == "Job finished"));
    assert!(events.iter().any(|e| e["title"] == "Approval granted"));
}

#[test]
fn rejecting_one_approval_stops_the_task_with_a_visible_reason() {
    let mut h = Harness::new("reject");
    let notes = h.notes.to_string_lossy().replace('\\', "/");
    let plan = format!("fs.write {notes}/never.md | should not exist\nfs.list {notes}");
    let job_id = h.run_plan(&plan);

    let approval = h.wait_approval();
    h.call(
        "approval.decide",
        json!({ "id": approval["id"], "approved": false }),
    );

    let job = h.wait_job(&job_id);
    assert_eq!(job["status"], "failure");
    let error = job["error"].as_str().unwrap_or_default();
    assert!(
        error.contains("rejected") && error.contains("Nothing ran"),
        "the failure does not say why: {error}"
    );
    assert_eq!(job["steps"][0]["status"], "denied");
    assert_eq!(
        job["steps"][1]["status"], "pending",
        "the task continued after a denial: {job}"
    );
    assert!(
        !h.notes.join("never.md").exists(),
        "a rejected write still touched the filesystem"
    );
    let events = h.activity_for(&job_id);
    assert!(events.iter().any(|e| e["title"] == "Approval rejected"));
    assert!(events.iter().any(|e| e["title"] == "Job stopped"));
}

#[test]
fn a_path_traversal_is_denied_by_policy_before_any_filesystem_call() {
    let mut h = Harness::new("traversal");
    let outside = h.dir.join("outside.txt");
    std::fs::write(&outside, "must not be read\n").unwrap();
    let plan = format!("fs.read \"{}\"", outside.to_string_lossy().replace('\\', "/"));
    let job_id = h.run_plan(&plan);

    let job = h.wait_job(&job_id);
    assert_eq!(job["status"], "failure", "traversal was not refused: {job}");
    assert_eq!(job["steps"][0]["status"], "denied");
    assert!(
        h.call("approval.pending", json!({}))
            .as_array()
            .unwrap()
            .is_empty(),
        "a traversal asked the owner instead of being denied"
    );
    let events = h.activity_for(&job_id);
    let denial = events
        .iter()
        .find(|e| e["detail"].as_str().unwrap_or_default().contains("policy.root_denied"))
        .expect("no activity row names policy.root_denied");
    assert!(denial["detail"].as_str().unwrap().len() > "policy.root_denied:".len());
}

#[test]
fn two_simultaneous_jobs_are_serialised_and_both_are_visible() {
    let mut h = Harness::new("serial");
    let notes = h.notes.to_string_lossy().replace('\\', "/");
    let first = h.run_plan(&format!("fs.list {notes}"));
    let second = h.run_plan(&format!("fs.list {notes}"));

    let a = h.wait_job(&first);
    let b = h.wait_job(&second);
    assert_eq!(a["status"], "success");
    assert_eq!(b["status"], "success");
    let a_done = a["finishedAt"].as_str().unwrap();
    let b_start = b["startedAt"].as_str().unwrap();
    assert!(
        a_done <= b_start,
        "the slots overlapped: first finished {a_done}, second started {b_start}"
    );

    let listed = h.call("job.list", json!({ "limit": 10 }));
    let ids: Vec<&str> = listed
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|job| job["id"].as_str())
        .collect();
    assert!(ids.contains(&first.as_str()) && ids.contains(&second.as_str()));
}

#[test]
fn an_always_approval_becomes_a_standing_grant_and_a_later_write_needs_no_prompt() {
    let mut h = Harness::new("always");
    let notes = h.notes.to_string_lossy().replace('\\', "/");
    let first = h.run_plan(&format!("fs.write {notes}/one.md | one"));
    let approval = h.wait_approval();
    h.call(
        "approval.decide",
        json!({ "id": approval["id"], "approved": true, "scope": "always" }),
    );
    let first = h.wait_job(&first);
    assert_eq!(first["status"], "success", "{first}");

    let second = h.run_plan(&format!("fs.write {notes}/two.md | two"));
    let second = h.wait_job(&second);
    assert_eq!(second["status"], "success", "the standing grant did not apply: {second}");
    assert_eq!(second["steps"][0]["status"], "success");
    assert!(h.notes.join("two.md").exists());
}

#[test]
fn a_process_tool_runs_inside_the_watched_folder_after_approval() {
    let mut h = Harness::new("process");
    let plan = "python.run | print('nexus tool test')";
    let job_id = h.run_plan(plan);
    let approval = h.wait_approval();
    h.call(
        "approval.decide",
        json!({ "id": approval["id"], "approved": true, "scope": "always" }),
    );
    let job = h.wait_job(&job_id);
    assert_eq!(job["status"], "success", "python did not run: {job}");
    let output = job["steps"][0]["output"].as_str().unwrap();
    assert!(
        output.contains("nexus tool test"),
        "python output was not captured: {output}"
    );
}

#[test]
fn an_unknown_plan_line_is_a_named_validation_error_and_queues_nothing() {
    let mut h = Harness::new("badplan");
    let mut sink = RecordingSink::default();
    let err = h
        .core
        .execute(
            "agent.run",
            &json!({ "agentId": DEVELOPER_AGENT, "input": "fs.list .\nrm -rf /" }),
            &mut sink,
        )
        .unwrap_err();
    assert_eq!(err.code, nexus_core::error::ErrorCode::ValidationField);
    assert!(
        err.message.contains("line 2"),
        "the error does not name the line: {}",
        err.message
    );
    let listed = h.call("job.list", json!({ "limit": 10 }));
    assert!(listed.as_array().unwrap().is_empty(), "a bad plan queued a job: {listed}");
}
