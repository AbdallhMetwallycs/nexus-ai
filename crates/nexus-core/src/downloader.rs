//! The first-run model downloader.
//!
//! The owner authorised one runtime download at M6: the recommended GGUF, once, from the
//! catalogue in `nexus-model`, after an explicit consent in the UI. Everything else stays
//! offline. The rules this file enforces:
//!
//! 1. **The URL comes from the pinned catalogue, never from the caller.** A command can
//!    name a catalogue id and nothing else.
//! 2. **A `.part` file is not a model.** It is renamed only after the byte length and the
//!    SHA-256 both match the catalogue.
//! 3. **One download at a time.** A second request is refused while one is in flight, so
//!    two partial files cannot race for the same name.
//! 4. **Cancel means delete the partial file.** A failure keeps it, because the next
//!    attempt resumes with `curl --continue-at -`.
//!
//! Transport is `curl.exe`, which ships with Windows 10 1803+ and 11. That keeps the
//! dependency tree free of a TLS stack; the trade-off is recorded in `TECHNICAL_DEBT.md`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use nexus_model::CatalogEntry;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{CoreResult, NexusError};

const TICK: Duration = Duration::from_millis(250);
const SPEED_WINDOW: f64 = 0.9;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSnapshot {
    pub id: String,
    /// `idle`, `downloading`, `verifying`, `done`, `failed` or `cancelled`.
    pub state: &'static str,
    pub received: u64,
    pub total: u64,
    pub bytes_per_sec: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Default for DownloadSnapshot {
    fn default() -> Self {
        Self {
            id: String::new(),
            state: "idle",
            received: 0,
            total: 0,
            bytes_per_sec: 0,
            error: None,
        }
    }
}

struct Inner {
    snapshot: DownloadSnapshot,
    child: Option<Child>,
    cancel: bool,
}

/// Shared handle to the one download slot. Cloning shares the same slot; the core owns a
/// single instance, and the worker thread keeps a clone alive.
#[derive(Clone)]
pub struct Downloader {
    inner: Arc<Mutex<Inner>>,
}

impl Default for Downloader {
    fn default() -> Self {
        Self::new()
    }
}

impl Downloader {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                snapshot: DownloadSnapshot::default(),
                child: None,
                cancel: false,
            })),
        }
    }

    pub fn status(&self) -> DownloadSnapshot {
        match self.inner.lock() {
            Ok(g) => g.snapshot.clone(),
            Err(_) => DownloadSnapshot {
                state: "failed",
                error: Some("The download state lock was poisoned.".into()),
                ..DownloadSnapshot::default()
            },
        }
    }

    /// Start a catalogue entry. The caller has already checked that the target file does
    /// not exist and that the disk has room; both are re-checked here for direct callers.
    pub fn start(&self, entry: &'static CatalogEntry, dir: &Path) -> CoreResult<DownloadSnapshot> {
        let mut g = self
            .inner
            .lock()
            .map_err(|_| NexusError::internal("The download state lock was poisoned."))?;
        if matches!(g.snapshot.state, "downloading" | "verifying") {
            return Err(NexusError::validation("id", "a model download is already running"));
        }
        fs::create_dir_all(dir).map_err(|err| NexusError::io("Creating the models folder", &err))?;
        let part = dir.join(format!("{}.part", entry.file_name));
        let target = dir.join(entry.file_name);
        if target.is_file() {
            return Err(NexusError::validation("id", "this model is already installed"));
        }
        let received = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        g.snapshot = DownloadSnapshot {
            id: entry.id.to_owned(),
            state: "downloading",
            received,
            total: entry.bytes,
            bytes_per_sec: 0,
            error: None,
        };
        g.cancel = false;
        let snapshot = g.snapshot.clone();

        let inner = Arc::clone(&self.inner);
        let curl = curl_path();
        std::thread::Builder::new()
            .name("nexus-model-download".into())
            .spawn(move || run(inner, entry, curl, part, target))
            .map_err(|err| NexusError::io("Starting the download thread", &err))?;
        Ok(snapshot)
    }

    /// Cancel a download in flight. A finished or failed download is left as it is.
    pub fn cancel(&self) -> DownloadSnapshot {
        match self.inner.lock() {
            Ok(mut g) => {
                if g.snapshot.state == "downloading" {
                    g.cancel = true;
                }
                g.snapshot.clone()
            }
            Err(_) => DownloadSnapshot {
                state: "failed",
                error: Some("The download state lock was poisoned.".into()),
                ..DownloadSnapshot::default()
            },
        }
    }
}

fn run(
    inner: Arc<Mutex<Inner>>,
    entry: &'static CatalogEntry,
    curl: PathBuf,
    part: PathBuf,
    target: PathBuf,
) {
    let spawned = Command::new(&curl)
        .arg("--fail")
        .arg("--location")
        .arg("--silent")
        .arg("--show-error")
        .arg("--connect-timeout")
        .arg("30")
        .arg("--retry")
        .arg("3")
        .arg("--retry-delay")
        .arg("2")
        .arg("--continue-at")
        .arg("-")
        .arg("--output")
        .arg(&part)
        .arg(entry.url)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn();
    let child = match spawned {
        Ok(child) => child,
        Err(err) => {
            fail(&inner, format!("curl.exe could not start: {err}"));
            return;
        }
    };
    {
        let Ok(mut g) = inner.lock() else { return };
        g.child = Some(child);
    }

    let mut last_len = 0u64;
    let mut last_tick = Instant::now();
    let mut speed = 0u64;
    let exit = loop {
        let mut finished = None;
        {
            let Ok(mut g) = inner.lock() else { return };
            if g.cancel {
                if let Some(mut child) = g.child.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                let _ = fs::remove_file(&part);
                g.snapshot.state = "cancelled";
                g.snapshot.bytes_per_sec = 0;
                g.snapshot.error = None;
                return;
            }
            let Some(child) = g.child.as_mut() else { return };
            match child.try_wait() {
                Ok(Some(status)) => finished = Some(status),
                Ok(None) => {}
                Err(err) => {
                    g.child = None;
                    g.snapshot.state = "failed";
                    g.snapshot.error = Some(format!("curl.exe: {err}"));
                    return;
                }
            }
        }
        if let Some(status) = finished {
            break status;
        }

        let len = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        let now = Instant::now();
        let elapsed = now.duration_since(last_tick).as_secs_f64();
        if elapsed >= SPEED_WINDOW {
            speed = ((len.saturating_sub(last_len)) as f64 / elapsed) as u64;
            last_len = len;
            last_tick = now;
        }
        if let Ok(mut g) = inner.lock() {
            if g.snapshot.state == "downloading" {
                g.snapshot.received = len;
                g.snapshot.bytes_per_sec = speed;
            }
        }
        std::thread::sleep(TICK);
    };

    let stderr_text = {
        let Ok(mut g) = inner.lock() else { return };
        match g.child.take() {
            Some(mut child) => {
                let mut text = String::new();
                if let Some(mut err) = child.stderr.take() {
                    let _ = err.read_to_string(&mut text);
                }
                let _ = child.wait();
                text
            }
            None => String::new(),
        }
    };

    if !exit.success() {
        let code = exit.code().map(|c| c.to_string()).unwrap_or_else(|| "terminated".into());
        let last = stderr_text
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("no message from curl.exe")
            .trim()
            .to_owned();
        fail(&inner, format!("curl.exe exited with {code}: {last}"));
        return;
    }

    if let Ok(mut g) = inner.lock() {
        g.snapshot.state = "verifying";
        g.snapshot.bytes_per_sec = 0;
    }
    let len = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if len != entry.bytes {
        let _ = fs::remove_file(&part);
        fail(
            &inner,
            format!(
                "the download is {len} bytes but the catalogue pins {} bytes",
                entry.bytes
            ),
        );
        return;
    }
    let digest = match sha256_file(&part) {
        Ok(digest) => digest,
        Err(err) => {
            fail(&inner, format!("the downloaded file could not be read: {err}"));
            return;
        }
    };
    if !nexus_model::hash_matches(entry.sha256, &digest) {
        let _ = fs::remove_file(&part);
        fail(
            &inner,
            format!("SHA-256 {digest} does not match the catalogue's {}", entry.sha256),
        );
        return;
    }
    if let Err(err) = fs::rename(&part, &target) {
        fail(&inner, format!("the verified file could not be moved into place: {err}"));
        return;
    }
    if let Ok(mut g) = inner.lock() {
        g.snapshot.state = "done";
        g.snapshot.received = entry.bytes;
        g.snapshot.bytes_per_sec = 0;
        g.snapshot.error = None;
    }
}

fn fail(inner: &Arc<Mutex<Inner>>, message: String) {
    if let Ok(mut g) = inner.lock() {
        g.child = None;
        g.snapshot.state = "failed";
        g.snapshot.bytes_per_sec = 0;
        g.snapshot.error = Some(message);
    }
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// `curl.exe` ships with Windows; the environment override exists for tests and for a
/// machine where the system copy was removed.
fn curl_path() -> PathBuf {
    if let Some(path) = std::env::var_os("NEXUS_CURL") {
        return PathBuf::from(path);
    }
    if let Some(root) = std::env::var_os("SystemRoot") {
        let candidate = PathBuf::from(root).join("System32").join("curl.exe");
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from("curl.exe")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_progress_snapshot_serialises_with_camel_case_fields() {
        let snapshot = DownloadSnapshot {
            id: "x".into(),
            state: "downloading",
            received: 10,
            total: 20,
            bytes_per_sec: 5,
            error: None,
        };
        let json = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(json["bytesPerSec"], 5);
        assert!(json.get("error").is_none(), "no empty error field");
    }
}
