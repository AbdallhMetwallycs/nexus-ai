//! The sidecar supervisor: spawn, health-probe, terminate, restart.
//!
//! The argument vector and every number in this module come from
//! `PHASE2_SIDECAR_SPEC.md` §3/§4 and `MEASUREMENTS.md` §3/§8/§10:
//!
//!  * `llama-server.exe`, never the unified `llama.exe` — the latter exposes `update`
//!    and `download`, which would let the engine replace itself or reach the network.
//!  * Single-instance, spawned **with** `-m`; router mode cannot load a local path.
//!  * `/health` is the readiness signal and needs no API key; every other route uses the
//!    per-launch bearer token.
//!  * There is no unload route and no shutdown route. "Unload" is terminate-the-pid, and
//!    switching models costs a full cold/warm start (6–10 s warm, ~38 s cold).
//!  * `--ctx-size 0` is forbidden: this model advertises 131,072 tokens, which would be
//!    ~14.5 GB of KV cache on a 20 GB laptop. Admission always supplies a real number.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::error::{CoreResult, ErrorCode, NexusError};
use crate::ipc_types::{EngineStartInfo, EngineStatus, ModelLoadResult};
use crate::net::{Loopback, StreamOutcome};
use crate::system::{now_iso8601, process_memory, ProcessMemory};

pub const ENGINE_EXE: &str = "llama-server.exe";
/// The one engine build this app was measured against (`MEASUREMENTS.md` §1).
pub const PINNED_BUILD: &str = "b12189";
/// Warm start is 6–10 s, cold ~38 s. The budget is deliberately above both.
pub const READY_BUDGET: Duration = Duration::from_secs(120);
const HEALTH_POLL: Duration = Duration::from_millis(250);
const MAX_CONSECUTIVE_CRASHES: u32 = 5;

#[derive(Clone, Debug, PartialEq)]
pub struct Launch {
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub model_path: PathBuf,
    pub model_id: String,
    pub context: u32,
    pub threads: usize,
    pub ready_ms: u64,
}

/// Owns at most one engine process. Dropping the supervisor kills it, because a sidecar
/// left behind would hold 1.7 GB and a port until the next reboot.
pub struct Supervisor {
    pub engine_dir: PathBuf,
    child: Option<Child>,
    launch: Option<Launch>,
    crash_count: u32,
    last_crash_at: Option<String>,
}

impl std::fmt::Debug for Supervisor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Supervisor")
            .field("engine_dir", &self.engine_dir)
            .field("launch", &self.launch)
            .field("crash_count", &self.crash_count)
            .finish()
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        self.stop();
    }
}

impl Supervisor {
    pub fn new(engine_dir: impl Into<PathBuf>) -> Self {
        Self {
            engine_dir: engine_dir.into(),
            child: None,
            launch: None,
            crash_count: 0,
            last_crash_at: None,
        }
    }

    pub fn binary_path(&self) -> PathBuf {
        self.engine_dir.join(ENGINE_EXE)
    }

    pub fn installed(&self) -> bool {
        self.binary_path().is_file()
    }

    pub fn launch(&self) -> Option<&Launch> {
        self.launch.as_ref()
    }

    /// True only if the child is still alive. A process that exited since the last status
    /// call is recorded as a crash exactly once, which is what the UI's "engine crashed"
    /// state reads.
    pub fn refresh(&mut self) -> bool {
        let Some(child) = self.child.as_mut() else { return false };
        match child.try_wait() {
            Ok(None) => true,
            Ok(Some(status)) => {
                self.crash_count = self.crash_count.saturating_add(1);
                self.last_crash_at = Some(now_iso8601());
                let _ = status;
                self.child = None;
                self.launch = None;
                false
            }
            Err(_) => true,
        }
    }

    pub fn loopback(&self) -> CoreResult<Loopback> {
        let Some(launch) = self.launch.as_ref() else {
            return Err(NexusError::engine_not_ready("No engine process is running."));
        };
        Ok(Loopback::new(launch.port, launch.token.clone()))
    }

    pub fn process_memory(&self) -> Option<ProcessMemory> {
        let launch = self.launch.as_ref()?;
        process_memory(launch.pid)
    }

    /// Terminate, because b12189 has no shutdown route (`PHASE2_SIDECAR_SPEC.md` §1.4).
    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.launch = None;
    }

    /// Spawn the engine for one model and wait until `/health` means the weights are
    /// resident. The caller has already passed admission and validated the path.
    pub fn start(
        &mut self,
        model_path: &Path,
        model_id: &str,
        context: u32,
        threads: usize,
    ) -> CoreResult<ModelLoadResult> {
        if !self.installed() {
            return Err(NexusError::new(
                ErrorCode::EngineNotInstalled,
                "The llama.cpp engine is not installed in the configured sidecar folder.",
                false,
            )
            .with_detail(self.binary_path().display().to_string()));
        }
        if !model_path.is_file() {
            return Err(NexusError::new(
                ErrorCode::ModelNotInstalled,
                "The model file is gone.",
                false,
            )
            .with_detail(model_path.display().to_string()));
        }
        // Repetition of a model that is already resident is not a restart: it costs the
        // owner 6–38 s and changes nothing.
        let already = self
            .launch
            .as_ref()
            .is_some_and(|l| l.model_path == model_path && l.context == context);
        if already && self.refresh() {
            let ready_ms = self.launch.as_ref().map(|l| l.ready_ms).unwrap_or(0);
            let threads = self.launch.as_ref().map(|l| l.threads).unwrap_or(threads);
            return Ok(ModelLoadResult {
                loaded_gb: self.process_memory().map(|m| m.private_gb()).unwrap_or(0.0),
                context_capped: context,
                threads,
                ready_ms,
            });
        }

        self.stop();

        let context = context.clamp(2_048, 32_768);
        let threads = threads.clamp(1, 64);
        let port = pick_loopback_port()?;
        let token = launcher_token();
        let mut command = Command::new(self.binary_path());
        command
            .arg("-m")
            .arg(model_path)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--api-key")
            .arg(&token)
            .arg("--no-ui")
            .arg("--offline")
            .arg("--metrics")
            .arg("--ctx-size")
            .arg(context.to_string())
            .arg("--threads")
            .arg(threads.to_string())
            .arg("--threads-batch")
            .arg(threads.to_string())
            .arg("--flash-attn")
            .arg("on")
            .arg("--n-gpu-layers")
            .arg("0")
            .arg("--parallel")
            .arg("1")
            .arg("--load-mode")
            .arg("auto")
            .arg("--log-disable")
            .stdin(Stdio::null())
            // The engine's stdout/stderr can contain the absolute model path. Keeping it
            // out of the app's log is the privacy rule in ARCHITECTURE.md §5; the exit
            // code and the measured timing are enough to diagnose a failed load here.
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let started = Instant::now();
        let child = command.spawn().map_err(|e| {
            NexusError::new(
                ErrorCode::EngineCrashed,
                "The engine process could not be started.",
                true,
            )
            .with_detail(format!("{}: {e}", self.binary_path().display()))
        })?;
        let pid = child.id();
        self.child = Some(child);

        match wait_for_health(port, &mut self.child, started) {
            Ok(ready_ms) => {
                self.launch = Some(Launch {
                    pid,
                    port,
                    token,
                    model_path: model_path.to_path_buf(),
                    model_id: model_id.to_owned(),
                    context,
                    threads,
                    ready_ms,
                });
                Ok(ModelLoadResult {
                    loaded_gb: self.process_memory().map(|m| m.private_gb()).unwrap_or(0.0),
                    context_capped: context,
                    threads,
                    ready_ms,
                })
            }
            Err(err) => {
                self.stop();
                self.crash_count = self.crash_count.saturating_add(1);
                self.last_crash_at = Some(now_iso8601());
                Err(err)
            }
        }
    }

    /// The `engine.start` contract: start whichever model is already active, or explain
    /// that nothing is active. It never picks a model on the owner's behalf.
    pub fn start_active(&mut self) -> CoreResult<EngineStartInfo> {
        let Some(launch) = self.launch.as_ref() else {
            return Err(NexusError::new(
                ErrorCode::ModelNotInstalled,
                "No model is loaded. Choose one in the Model Manager first.",
                false,
            ));
        };
        let (path, id, ctx, threads) = (
            launch.model_path.clone(),
            launch.model_id.clone(),
            launch.context,
            launch.threads,
        );
        self.start(&path, &id, ctx, threads)?;
        let launch = self.launch.as_ref().expect("start() sets launch on success");
        Ok(EngineStartInfo { pid: launch.pid, port: launch.port })
    }

    pub fn status(&mut self) -> EngineStatus {
        let running = self.refresh();
        let launch = if running { self.launch.as_ref() } else { None };
        EngineStatus {
            installed: self.installed(),
            binary_path: Some(self.binary_path().display().to_string()),
            version: self.installed().then(|| PINNED_BUILD.to_owned()),
            running,
            port: launch.map(|l| l.port),
            loaded_model: launch.map(|l| l.model_id.clone()),
            threads: launch.map(|l| l.threads),
            context_cap: launch.map(|l| l.context),
            crash_count: self.crash_count,
            last_crash_at: self.last_crash_at.clone(),
        }
    }

    pub fn cancelled_generation(&self) -> StreamOutcome {
        StreamOutcome { cancelled: true, ..StreamOutcome::default() }
    }
}

fn wait_for_health(
    port: u16,
    child: &mut Option<Child>,
    started: Instant,
) -> CoreResult<u64> {
    let probe = Loopback::new(port, "");
    loop {
        if started.elapsed() > READY_BUDGET {
            return Err(NexusError::new(
                ErrorCode::EngineCrashed,
                "The engine did not become ready within the measured budget.",
                true,
            )
            .with_detail(format!(
                "no /health answer on 127.0.0.1:{port} after {} s",
                started.elapsed().as_secs()
            )));
        }
        if let Some(process) = child.as_mut() {
            if let Ok(Some(status)) = process.try_wait() {
                // A missing/corrupt model exits in ~0.11 s without ever listening
                // (PHASE2_SIDECAR_SPEC.md §3). The exit code is the useful detail.
                return Err(NexusError::new(
                    ErrorCode::EngineCrashed,
                    "The engine exited before it was ready. The model file may be unreadable.",
                    false,
                )
                .with_detail(format!("exit {status}; port {port}")));
            }
        }
        if let Ok(response) = probe.get_unauthenticated("/health") {
            if response.status == 200 {
                let body = response.text();
                if body.contains("\"ok\"") {
                    return Ok(started.elapsed().as_millis() as u64);
                }
            }
        }
        std::thread::sleep(HEALTH_POLL);
    }
}

/// Ask the OS for an unused loopback port by binding port 0 and releasing it.
///
/// The race between release and the engine's bind is unavoidable without passing a
/// pre-bound socket, which llama-server does not accept. It is bounded by the fact that the
/// port is chosen microseconds before the spawn and is loopback-only.
pub fn pick_loopback_port() -> CoreResult<u16> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| NexusError::io("Choosing a loopback port", &e))?;
    let port = listener
        .local_addr()
        .map_err(|e| NexusError::io("Reading the chosen port", &e))?
        .port();
    drop(listener);
    Ok(port)
}

/// 32 random bytes as hex. `--api-key` guards every route except `/health`; the token is
/// per-launch and never written to disk. On Windows this is BCryptGenRandom; the fallback
/// is visibly a fallback and only exists so a failed CSPRNG cannot prevent the app from
/// starting offline.
pub fn launcher_token() -> String {
    let mut bytes = [0u8; 32];
    if !random_bytes(&mut bytes) {
        let mut state = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9E37_79B9_7F4A_7C15)
            ^ (u64::from(std::process::id()) << 32);
        for b in &mut bytes {
            // SplitMix64. Not a CSPRNG; the startup path logs no secret and the socket is
            // loopback-only, but this branch is a degradation, not an equivalent.
            state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = state;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            *b = (z ^ (z >> 31)) as u8;
        }
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(windows)]
fn random_bytes(buf: &mut [u8]) -> bool {
    use windows_sys::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };
    // SAFETY: the system-preferred RNG ignores the algorithm handle and writes exactly
    // `buf.len()` bytes into the buffer we own.
    unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            buf.as_mut_ptr(),
            buf.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        ) == 0
    }
}

#[cfg(not(windows))]
fn random_bytes(_buf: &mut [u8]) -> bool {
    false
}

/// Delay before retrying a crashed engine. Escalates with consecutive attempts so a
/// corrupt model cannot turn into a tight spawn/kill loop.
pub fn retry_delay(crashes: u32) -> Duration {
    if crashes >= MAX_CONSECUTIVE_CRASHES {
        return Duration::from_secs(60);
    }
    Duration::from_millis(500u64.saturating_mul(u64::from(crashes.max(1))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::system::physical_cores;
    use std::path::PathBuf;

    #[test]
    fn a_missing_engine_is_reported_before_any_spawn() {
        let mut supervisor = Supervisor::new(PathBuf::from("Z:\\definitely-not-here"));
        assert!(!supervisor.installed());
        let status = supervisor.status();
        assert!(!status.installed);
        assert!(!status.running);
        let err = supervisor
            .start(Path::new("Z:\\model.gguf"), "m", 2_048, 4)
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::EngineNotInstalled);
        assert!(!err.retryable);
    }

    #[test]
    fn tokens_are_32_bytes_of_hex_and_differ_per_launch() {
        let a = launcher_token();
        let b = launcher_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn a_port_is_chosen_and_immediately_reusable_by_the_engine() {
        let port = pick_loopback_port().unwrap();
        assert!(port > 0);
        // The picker releases the port; the test asserts the OS agrees it is bindable.
        let listener = std::net::TcpListener::bind(("127.0.0.1", port));
        assert!(listener.is_ok(), "port {port} was not released");
    }

    #[test]
    fn crash_backoff_escalates_and_stops_at_a_minute() {
        assert_eq!(retry_delay(1), Duration::from_millis(500));
        assert_eq!(retry_delay(4), Duration::from_millis(2_000));
        assert_eq!(retry_delay(5), Duration::from_secs(60));
        assert_eq!(retry_delay(99), Duration::from_secs(60));
    }

    #[test]
    fn physical_cores_is_what_the_engine_gets() {
        let cores = physical_cores();
        assert!((1..=64).contains(&cores), "{cores}");
    }

    /// M1's real gate, opt-in because it loads 1.9 GB and takes 6–10 s.
    /// ```text
    /// $env:NEXUS_LIVE_ENGINE="1"; cargo test -p nexus-core live -- --nocapture
    /// ```
    #[test]
    fn live_engine_streams_one_answer_and_stops() {
        if std::env::var("NEXUS_LIVE_ENGINE").as_deref() != Ok("1") {
            eprintln!("skipped: set NEXUS_LIVE_ENGINE=1 to load the real model");
            return;
        }
        let engine_dir = std::env::var("NEXUS_ENGINE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("D:\\NEXUS-SIDECAR\\b12189"));
        let models_dir = std::env::var("NEXUS_MODELS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("D:\\NEXUS-MODELS"));
        let registry = crate::registry::Registry::new(&models_dir);
        let path = registry.gguf_paths().into_iter().next().expect("one model file");
        let info = crate::registry::read_gguf(&path).unwrap();
        let mut supervisor = Supervisor::new(engine_dir);
        let result = supervisor
            .start(&path, "live", 2_048, physical_cores())
            .expect("engine must become ready");
        println!("ready in {} ms, {:?}", result.ready_ms, supervisor.launch());
        // Use the production body builder, not a hand-written copy: this is the only way the
        // live test can prove `stream_options.include_usage` actually yields a usage frame.
        let body = crate::inference::chat_body(
            &[crate::inference::ChatTurn::user("Reply with exactly: NEXUS OK")],
            16,
            0.0,
        );
        let mut text = String::new();
        let outcome = supervisor
            .loopback()
            .unwrap()
            .stream_chat(&body, None, |delta| {
                text.push_str(delta);
                true
            })
            .unwrap();
        println!("outcome {outcome:?}\ntext {text:?}");
        assert!(outcome.tokens > 0, "no deltas streamed");
        assert!(outcome.completion_tokens > 0, "engine sent no usage frame");
        assert!(outcome.prompt_tokens > 0, "usage frame has no prompt tokens");
        assert!(!text.trim().is_empty());
        let memory = supervisor.process_memory().expect("process memory");
        println!("private {} MB, working set {} MB", memory.private_mb, memory.working_set_mb);
        supervisor.stop();
        assert!(!supervisor.refresh());
        let _ = info;
    }
}
