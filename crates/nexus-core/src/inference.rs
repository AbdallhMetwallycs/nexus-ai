//! Prompt assembly, streaming generation and cancellation.
//!
//! One generation at a time is a hardware constraint, not a policy preference
//! (`ARCHITECTURE.md` §4): two inferences on four physical cores at 15 W both run slower
//! than one. The scheduler that enforces that arrives in M4; this module supplies the
//! primitive it will serialise.
//!
//! Context accounting is measured: `prompt_tokens`, `completion_tokens` and `cached_tokens`
//! come from the engine's usage frame, not from a character-count guess. The estimate is
//! only used to size the request before the engine answers.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::error::CoreResult;
use crate::net::{CancelHandle, Loopback, StreamOutcome};

/// The system instruction the universal assistant starts from.
///
/// It says what the assistant is and what it must not claim. It is versioned as text here
/// until M5 gives it a version table; editing it silently is exactly what
/// `PHASE2_MILESTONES.md` M5 forbids.
pub const SYSTEM_PROMPT: &str = "You are NEXUS AI, a local assistant running on the user's own \
computer. You have no internet access unless a tool explicitly grants it. Answer from the \
conversation and any provided sources. If you do not know, say so. Never claim to have run a \
tool, opened a file, or contacted a service unless the tool result is present in this \
conversation.";

/// A shared stop button. Cheap to clone; every clone refers to the same flag.
#[derive(Clone, Debug, Default)]
pub struct CancelFlag(Arc<AtomicBool>);

impl CancelFlag {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn reset(&self) {
        self.0.store(false, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatTurn {
    pub role: &'static str,
    pub content: String,
}

impl ChatTurn {
    pub fn user(content: impl Into<String>) -> Self {
        Self { role: "user", content: content.into() }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self { role: "assistant", content: content.into() }
    }
}

/// Build the OpenAI-compatible body the sidecar expects.
///
/// `cache_prompt` is on because the M1.2 measurement found `cached_tokens: 0` in every run
/// and prefill, not decode, is the binding constraint. `stream_options.include_usage` is on
/// because without it llama-server emits no usage frame at all, so every run would report
/// zero tokens; the live test asserts the frame really arrives.
pub fn chat_body(
    messages: &[ChatTurn],
    max_tokens: u32,
    temperature: f64,
) -> Value {
    let wire: Vec<Value> = messages
        .iter()
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect();
    json!({
        // In single-instance mode the engine ignores this field; sending it keeps the
        // request valid against an OpenAI-compatible server without leaking the path.
        "model": "nexus-local",
        "messages": wire,
        "max_tokens": max_tokens.clamp(1, 4_096),
        "temperature": temperature.clamp(0.0, 2.0),
        "stream": true,
        "cache_prompt": true,
        "stream_options": { "include_usage": true },
    })
}

/// Stream one completion, forwarding every delta to `on_delta`.
///
/// A `CancelFlag` interrupts the socket even during prefill, which is the difference
/// between a Stop button and a Stop suggestion. The monitor thread exits within 50 ms of
/// the generation ending, so a burst of sends cannot accumulate threads.
///
/// The caller resets the flag before the request starts; `generate` deliberately does not,
/// so a Stop pressed during a cold model load is still honoured here.
pub fn generate(
    loopback: &Loopback,
    body: &Value,
    cancel: &CancelFlag,
    mut on_delta: impl FnMut(&str) -> bool,
) -> CoreResult<StreamOutcome> {
    let handle = CancelHandle::new();
    let stopped = Arc::new(AtomicBool::new(false));

    let monitor = {
        let handle = handle.clone();
        let cancel = cancel.clone();
        let stopped = Arc::clone(&stopped);
        std::thread::spawn(move || {
            while !stopped.load(Ordering::SeqCst) {
                if cancel.is_cancelled() {
                    handle.cancel();
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        })
    };

    let result = loopback.stream_chat(body, Some(&handle), |delta| {
        if cancel.is_cancelled() {
            return false;
        }
        on_delta(delta)
    });

    stopped.store(true, Ordering::SeqCst);
    let _ = monitor.join();

    let mut outcome = result?;
    if cancel.is_cancelled() {
        outcome.cancelled = true;
    }
    Ok(outcome)
}

/// Character-based token estimate, used only before the engine reports real usage.
///
/// Four characters per token is the usual English approximation; it is wrong on code and
/// non-Latin text, which is why `UsageInfo.measured` stays false until the engine's usage
/// frame replaces this number.
pub fn estimate_tokens(text: &str) -> u32 {
    let chars = text.chars().count();
    chars.div_ceil(4).min(u32::MAX as usize) as u32
}

/// Trim a conversation to a token budget, newest turns first, always keeping the system
/// message. Prefill is the binding constraint, so dropping old turns is a real need.
pub fn trim_to_budget(mut messages: Vec<ChatTurn>, budget_tokens: u32) -> Vec<ChatTurn> {
    if messages.is_empty() {
        return messages;
    }
    let system = if messages.first().is_some_and(|m| m.role == "system") {
        Some(messages.remove(0))
    } else {
        None
    };
    let mut used = system.as_ref().map(|m| estimate_tokens(&m.content)).unwrap_or(0);
    let mut kept: Vec<ChatTurn> = Vec::new();
    for turn in messages.into_iter().rev() {
        let cost = estimate_tokens(&turn.content) + 4;
        if used + cost > budget_tokens && !kept.is_empty() {
            break;
        }
        used += cost;
        kept.push(turn);
    }
    kept.reverse();
    let mut out = Vec::with_capacity(kept.len() + 1);
    if let Some(system) = system {
        out.push(system);
    }
    out.extend(kept);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_is_openai_shaped_and_streams() {
        let body = chat_body(&[ChatTurn::user("hello")], 128, 0.7);
        assert_eq!(body["stream"], true);
        assert_eq!(body["cache_prompt"], true);
        assert_eq!(body["stream_options"]["include_usage"], true);
        assert_eq!(body["max_tokens"], 128);
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"], "hello");
        assert_eq!(body["model"], "nexus-local");
        assert!(body.get("temperature").is_some());
    }

    #[test]
    fn absurd_sampling_values_are_clamped_not_forwarded() {
        let body = chat_body(&[ChatTurn::user("x")], 0, 99.0);
        assert_eq!(body["max_tokens"], 1);
        assert_eq!(body["temperature"], 2.0);
    }

    #[test]
    fn cancel_is_shared_and_resettable() {
        let flag = CancelFlag::new();
        let clone = flag.clone();
        assert!(!flag.is_cancelled());
        clone.cancel();
        assert!(flag.is_cancelled());
        flag.reset();
        assert!(!clone.is_cancelled());
    }

    #[test]
    fn trimming_keeps_the_system_prompt_and_the_newest_turns() {
        let messages = vec![
            ChatTurn { role: "system", content: SYSTEM_PROMPT.into() },
            ChatTurn::user("first question that is quite long and will be dropped"),
            ChatTurn::assistant("first answer that is quite long and will be dropped"),
            ChatTurn::user("newest"),
        ];
        let trimmed = trim_to_budget(messages, 120);
        assert_eq!(trimmed.first().unwrap().role, "system");
        assert_eq!(trimmed.last().unwrap().content, "newest");
        assert!(trimmed.len() < 4);
    }

    #[test]
    fn token_estimate_rounds_up() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
    }
}
