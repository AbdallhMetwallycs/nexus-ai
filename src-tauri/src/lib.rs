//! The Tauri 2 host for `nexus-core`.
//!
//! Two rules from `PHASE2_IPC_CONTRACT.md` are enforced here rather than in the UI:
//!
//! 1. **One dispatcher, no per-command bodies.** `src/contract/client.ts` invokes the single
//!    Tauri command `ipc` with `{ command, args }`; `nexus_core::dispatch::Core` decides what
//!    is real. This keeps the 97-command contract authoritative in one Rust match, and it
//!    works around a Tauri limitation: command names are Rust identifiers, so a dotted
//!    contract name (`chat.send`) cannot itself be registered.
//! 2. **Stop never queues behind work.** `chat.stop` flips the shared `CancelFlag` before
//!    taking the core mutex, so a generation that holds the lock is interrupted by the same
//!    50 ms monitor loop the core already uses.
//!
//! Every other command runs on a blocking thread: `engine.loadModel` is a process spawn and
//! a health wait (seconds), and running it on the async runtime would stall the UI thread.

use std::sync::{Arc, Mutex};

use nexus_core::dispatch::{Core, EventSink};
use nexus_core::error::NexusError;
use nexus_core::inference::CancelFlag;
use serde_json::Value;
use tauri::{Emitter, Manager};

struct AppState {
    core: Mutex<Core>,
    /// The same flag the core uses; cloned out so `chat.stop` needs no lock.
    cancel: CancelFlag,
}

struct TauriSink {
    app: tauri::AppHandle,
}

impl EventSink for TauriSink {
    fn emit(&mut self, channel: &str, payload: Value) {
        if let Err(err) = self.app.emit(channel, payload) {
            // An event that cannot be delivered is a host fault, not a reason to kill the
            // generation: the answer still completes and the invoke resolves.
            eprintln!("NEXUS event {channel} was not delivered: {err}");
        }
    }
}

#[tauri::command]
async fn ipc(
    command: String,
    args: Option<Value>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Value, NexusError> {
    let args = args.unwrap_or(Value::Null);
    let state = Arc::clone(state.inner());

    // Contract: `chat.stop({ conversationId })`. The id is informational for M1 because
    // the core runs one generation at a time.
    if command == "chat.stop" {
        state.cancel.cancel();
        return Ok(Value::Null);
    }

    tauri::async_runtime::spawn_blocking(move || {
        let mut core = state
            .core
            .lock()
            .map_err(|_| NexusError::internal("The core state lock was poisoned."))?;
        let mut sink = TauriSink { app };
        core.execute(&command, &args, &mut sink)
    })
    .await
    .map_err(|err| {
        NexusError::internal("The core task did not finish.").with_detail(err.to_string())
    })?
}

pub fn run() {
    let core = Core::from_env();
    let cancel = core.cancel.clone();
    let state = Arc::new(AppState { core: Mutex::new(core), cancel });

    let app = tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![ipc])
        .build(tauri::generate_context!())
        .expect("NEXUS AI failed to build the Tauri application");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            // A closed window must not leave llama-server.exe holding ~1.7 GB. This is the
            // same path `engine.stop` takes: cancel, then terminate the child.
            if let Some(state) = handle.try_state::<Arc<AppState>>() {
                state.cancel.cancel();
                if let Ok(mut core) = state.core.lock() {
                    core.supervisor.stop();
                }
            }
        }
    });
}
