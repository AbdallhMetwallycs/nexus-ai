//! The tool runtime (M4).
//!
//! Every call passes `nexus_policy` first: declared permissions, enablement, roots and
//! the approval verdict. The functions here do the effect and nothing else — they never
//! decide whether they are allowed to.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use nexus_policy::{resolve_in_roots, PolicyError};
use nexus_store::types::PlannedStep;
use nexus_store::Store;
use serde_json::{json, Value};

const READ_CAP: u64 = 256 * 1024;
const PROCESS_TIMEOUT: Duration = Duration::from_secs(30);
const OUTPUT_CAP: usize = 16 * 1024;

#[derive(Debug, Clone)]
pub struct ToolFailure {
    pub code: String,
    pub message: String,
}

impl ToolFailure {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }

    fn from_policy(err: PolicyError) -> Self {
        Self::new(err.code, err.message)
    }
}

pub fn label(store: &Store, tool_id: &str) -> String {
    store.get_tool(tool_id).map(|t| t.name).unwrap_or_else(|_| tool_id.to_owned())
}

/// The allow-listed roots a filesystem tool may touch: the watched Knowledge folders.
pub fn allowed_roots(store: &Store) -> Vec<PathBuf> {
    store
        .kb_roots()
        .unwrap_or_default()
        .into_iter()
        .map(|root| PathBuf::from(root.path))
        .collect()
}

/// A human sentence for an approval dialog. Deliberately describes the effect, not the
/// internal call signature.
pub fn approval_summary(store: &Store, step: &PlannedStep) -> (String, String) {
    let name = label(store, &step.tool_id);
    match step.tool_id.as_str() {
        "fs.write" => {
            let path = step.args.get("path").and_then(Value::as_str).unwrap_or("(no path)");
            let bytes = step.args.get("content").and_then(Value::as_str).map(str::len).unwrap_or(0);
            (format!("Write {bytes} bytes to {path}"), format!("{name}: {path}"))
        }
        "python.run" => {
            let code = step.args.get("code").and_then(Value::as_str).unwrap_or("");
            (format!("Run {} characters of Python in a watched folder", code.chars().count()), format!("python.run: {code}"))
        }
        "powershell.run" => {
            let script = step.args.get("script").and_then(Value::as_str).unwrap_or("");
            (format!("Run {} characters of PowerShell in a watched folder", script.chars().count()), format!("powershell.run: {script}"))
        }
        other => (format!("Run {name}"), format!("{other}: {}", step.args)),
    }
}

pub fn execute(store: &Store, step: &PlannedStep) -> Result<Value, ToolFailure> {
    let roots = allowed_roots(store);
    match step.tool_id.as_str() {
        "fs.list" => {
            let path = required_path(&step.args)?;
            let resolved = resolve_in_roots(path, &roots).map_err(ToolFailure::from_policy)?;
            list_dir(&resolved)
        }
        "fs.read" => {
            let path = required_path(&step.args)?;
            let resolved = resolve_in_roots(path, &roots).map_err(ToolFailure::from_policy)?;
            read_file(&resolved)
        }
        "fs.write" => {
            let path = required_path(&step.args)?;
            let content = step.args.get("content").and_then(Value::as_str).ok_or_else(|| {
                ToolFailure::new("validation.field", "fs.write needs a content string.")
            })?;
            let resolved = resolve_in_roots(path, &roots).map_err(ToolFailure::from_policy)?;
            std::fs::write(&resolved, content).map_err(|e| {
                ToolFailure::new("tool.io_failed", format!("{} could not be written: {e}", resolved.display()))
            })?;
            Ok(json!({ "path": resolved.to_string_lossy(), "bytes": content.len() }))
        }
        "python.run" => {
            let code = step.args.get("code").and_then(Value::as_str).ok_or_else(|| {
                ToolFailure::new("validation.field", "python.run needs a code string.")
            })?;
            let cwd = work_dir(&roots)?;
            run_process("python", &["-I", "-c", code], &cwd, "python")
        }
        "powershell.run" => {
            let script = step.args.get("script").and_then(Value::as_str).ok_or_else(|| {
                ToolFailure::new("validation.field", "powershell.run needs a script string.")
            })?;
            let cwd = work_dir(&roots)?;
            run_process(
                "powershell",
                &["-NoProfile", "-NonInteractive", "-Command", script],
                &cwd,
                "powershell",
            )
        }
        other => Err(ToolFailure::new(
            "tool.unknown",
            format!("No runtime exists for “{other}” in this build."),
        )),
    }
}

/// The arguments `tool.testRun` submits for a tool whose call needs no owner input.
pub fn default_test_args(store: &Store, tool_id: &str) -> Result<Value, ToolFailure> {
    let roots = allowed_roots(store);
    let root = roots.first().cloned().ok_or_else(|| {
        ToolFailure::new(
            "policy.root_denied",
            "Watch a folder in Knowledge Base first; tools may only touch a watched folder.",
        )
    })?;
    match tool_id {
        "fs.list" => Ok(json!({ "path": root.to_string_lossy() })),
        "fs.write" => Ok(json!({
            "path": root.join("nexus-tool-test.txt").to_string_lossy(),
            "content": "NEXUS tool test\n"
        })),
        "python.run" => Ok(json!({ "code": "print('nexus tool test')" })),
        "powershell.run" => Ok(json!({ "script": "Write-Output 'nexus tool test'" })),
        "fs.read" => Err(ToolFailure::new(
            "validation.field",
            "fs.read needs a file path; run it from a Developer Agent plan instead.",
        )),
        other => Err(ToolFailure::new("tool.unknown", format!("No runtime exists for “{other}”."))),
    }
}

/// Parse the Developer Agent plan. One line is one tool call; blank lines and `#`
/// comments are ignored. An unrecognised line is an error naming the line — it is never
/// skipped silently.
pub fn parse_plan(input: &str) -> Result<Vec<PlannedStep>, (usize, String)> {
    let mut steps = Vec::new();
    for (index, raw) in input.lines().enumerate() {
        let line_no = index + 1;
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (verb, rest) = match line.split_once(char::is_whitespace) {
            Some((verb, rest)) => (verb, rest.trim()),
            None => (line, ""),
        };
        let step = match verb {
            "fs.list" | "fs.read" => {
                let path = unquote(rest);
                if path.is_empty() {
                    return Err((line_no, format!("{verb} needs a path.")));
                }
                PlannedStep { tool_id: verb.to_owned(), args: json!({ "path": path }) }
            }
            "fs.write" => {
                let (path, content) = rest.split_once('|').ok_or_else(|| {
                    (line_no, "fs.write needs “path | content”.".to_owned())
                })?;
                let path = unquote(path.trim());
                if path.is_empty() {
                    return Err((line_no, "fs.write needs a path before “|”.".to_owned()));
                }
                PlannedStep {
                    tool_id: verb.to_owned(),
                    args: json!({ "path": path, "content": content.trim_start() }),
                }
            }
            "python.run" | "powershell.run" => {
                let code = rest.split_once('|').map(|(_, c)| c.trim()).unwrap_or(rest);
                if code.is_empty() {
                    return Err((line_no, format!("{verb} needs code after “|”.")));
                }
                let key = if verb == "python.run" { "code" } else { "script" };
                PlannedStep { tool_id: verb.to_owned(), args: json!({ key: code }) }
            }
            other => {
                return Err((
                    line_no,
                    format!(
                        "“{other}” is not a tool. Use fs.list, fs.read, fs.write, python.run or powershell.run."
                    ),
                ))
            }
        };
        steps.push(step);
    }
    if steps.is_empty() {
        return Err((0, "The plan has no steps.".to_owned()));
    }
    Ok(steps)
}

fn unquote(text: &str) -> &str {
    text.trim().trim_matches('"').trim()
}

fn required_path(args: &Value) -> Result<&Path, ToolFailure> {
    args.get("path")
        .and_then(Value::as_str)
        .map(Path::new)
        .ok_or_else(|| ToolFailure::new("validation.field", "This tool needs a path."))
}

fn work_dir(roots: &[PathBuf]) -> Result<PathBuf, ToolFailure> {
    let root = roots.first().ok_or_else(|| {
        ToolFailure::new(
            "policy.root_denied",
            "No folder is allow-listed yet; a process needs a watched folder as its working directory.",
        )
    })?;
    let canonical = std::fs::canonicalize(root).map_err(|e| {
        ToolFailure::new("policy.root_denied", format!("{} could not be opened: {e}", root.display()))
    })?;
    Ok(canonical)
}

fn list_dir(path: &Path) -> Result<Value, ToolFailure> {
    if !path.is_dir() {
        return Err(ToolFailure::new(
            "tool.not_a_folder",
            format!("{} is not a folder.", path.display()),
        ));
    }
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path).map_err(|e| {
        ToolFailure::new("tool.io_failed", format!("{} could not be listed: {e}", path.display()))
    })? {
        let entry = entry.map_err(|e| ToolFailure::new("tool.io_failed", e.to_string()))?;
        let meta = entry.metadata().ok();
        entries.push(json!({
            "name": entry.file_name().to_string_lossy(),
            "kind": if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { "folder" } else { "file" },
            "size": meta.map(|m| m.len()).unwrap_or(0),
        }));
    }
    entries.sort_by(|a, b| {
        a.get("name").and_then(Value::as_str).unwrap_or("").cmp(
            b.get("name").and_then(Value::as_str).unwrap_or(""),
        )
    });
    Ok(json!({ "path": path.to_string_lossy(), "entries": entries }))
}

fn read_file(path: &Path) -> Result<Value, ToolFailure> {
    let meta = std::fs::metadata(path).map_err(|e| {
        ToolFailure::new("tool.io_failed", format!("{} could not be read: {e}", path.display()))
    })?;
    if meta.is_dir() {
        return Err(ToolFailure::new(
            "tool.not_a_file",
            format!("{} is a folder; use fs.list.", path.display()),
        ));
    }
    let mut file = std::fs::File::open(path).map_err(|e| {
        ToolFailure::new("tool.io_failed", format!("{} could not be opened: {e}", path.display()))
    })?;
    let mut bytes = Vec::new();
    file.by_ref().take(READ_CAP + 1).read_to_end(&mut bytes).map_err(|e| {
        ToolFailure::new("tool.io_failed", format!("{} could not be read: {e}", path.display()))
    })?;
    let truncated = bytes.len() as u64 > READ_CAP;
    bytes.truncate(READ_CAP as usize);
    let text = String::from_utf8_lossy(&bytes).into_owned();
    Ok(json!({
        "path": path.to_string_lossy(),
        "bytes": meta.len(),
        "truncated": truncated,
        "text": text,
    }))
}

fn run_process(program: &str, args: &[&str], cwd: &Path, label: &str) -> Result<Value, ToolFailure> {
    let started = Instant::now();
    let mut child = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            ToolFailure::new(
                "tool.process_unavailable",
                format!("{label} could not start: {e}. Is it installed and on PATH?"),
            )
        })?;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().map_err(|e| {
                    ToolFailure::new("tool.process_failed", format!("{label} output could not be read: {e}"))
                })?;
                let stdout = cap(&String::from_utf8_lossy(&output.stdout));
                let stderr = cap(&String::from_utf8_lossy(&output.stderr));
                return Ok(json!({
                    "program": label,
                    "exitCode": status.code(),
                    "success": status.success(),
                    "timedOut": false,
                    "durationMs": started.elapsed().as_millis() as u64,
                    "stdout": stdout,
                    "stderr": stderr,
                }));
            }
            Ok(None) => {
                if started.elapsed() > PROCESS_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(json!({
                        "program": label,
                        "exitCode": Value::Null,
                        "success": false,
                        "timedOut": true,
                        "durationMs": started.elapsed().as_millis() as u64,
                        "stdout": "",
                        "stderr": format!("Killed after {} seconds.", PROCESS_TIMEOUT.as_secs()),
                    }));
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => {
                let _ = child.kill();
                return Err(ToolFailure::new(
                    "tool.process_failed",
                    format!("{label} could not be waited on: {e}"),
                ));
            }
        }
    }
}

fn cap(text: &str) -> String {
    if text.len() <= OUTPUT_CAP {
        text.to_owned()
    } else {
        format!("{}\n[truncated at {} bytes]", &text[..OUTPUT_CAP], OUTPUT_CAP)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_three_line_plan_becomes_three_calls() {
        let plan = "fs.list D:\\notes\n# a comment\nfs.read \"D:\\notes\\a.md\"\nfs.write D:\\notes\\b.md | hello\n";
        let steps = parse_plan(plan).unwrap();
        assert_eq!(steps.len(), 3);
        assert_eq!(steps[0].tool_id, "fs.list");
        assert_eq!(steps[1].args["path"], "D:\\notes\\a.md");
        assert_eq!(steps[2].args["content"], "hello");
    }

    #[test]
    fn an_unknown_verb_names_its_line() {
        let err = parse_plan("fs.list D:\\notes\nrm -rf D:\\").unwrap_err();
        assert_eq!(err.0, 2);
        assert!(err.1.contains("not a tool"));
    }

    #[test]
    fn traversal_is_refused_by_policy_before_the_runtime() {
        let err = resolve_in_roots(Path::new("C:\\Windows\\win.ini"), &[PathBuf::from("C:\\notes")])
            .unwrap_err();
        assert_eq!(err.code, "policy.root_denied");
    }
}
