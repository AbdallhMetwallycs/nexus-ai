//! The single policy gate (M4).
//!
//! Every effect point in `PHASE2_POLICY_MODEL.md` asks this crate, and the answer is a
//! pure function of *stored* facts — never of a value the UI supplied with the request.
//! The ten predicates below are the executable form of §6:
//!
//! 1. `network_decision` — offline denies before anything resolves.
//! 2. `grant_from_store` — a UI toggle cannot create a grant; only a stored row can.
//! 3. `decide_tool` — an approval-required tool cannot run without an approved row.
//! 4. `approval_matches` — one approval is bound to one argument set.
//! 5. `approval_expired` — expiry is a denial, never a silent grant.
//! 6. `memory_retrievable` — only `approved` memory reaches a prompt.
//! 7. `resolve_in_roots` — traversal outside an allow-listed root is refused.
//! 8. `spawn_context_valid` — no spawn without an explicit non-zero context.
//! 9. `telemetry_allowed` — absent means off, and off means nothing is sent.
//! 10. `valid_correlation` — every denial carries the id that ties its story together.

use std::path::{Component, Path, PathBuf};

/// A refusal that already carries the dotted contract code the UI shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyError {
    pub code: &'static str,
    pub message: String,
}

impl PolicyError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }

    pub fn root_denied(message: impl Into<String>) -> Self {
        Self::new("policy.root_denied", message)
    }

    pub fn offline() -> Self {
        Self::new("policy.offline", "The internet is off in this build, so nothing was sent.")
    }
}

/// The verdict of a tool-execution decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    RequireApproval,
    Deny(&'static str),
}

/// Everything decision point 2 is allowed to look at. `declared` and `needed` are the
/// tool's own declaration and the permissions this call actually uses.
pub struct ToolFacts<'a> {
    pub status: &'a str,
    pub enabled: bool,
    pub declared: &'a [String],
    pub needed: &'a [String],
    /// True only when a `tool_grant(scope='always')` row exists for every needed permission.
    pub standing_grant: bool,
    pub needs_approval: bool,
    /// True only when an approved, unused, unexpired approval row matched this call.
    pub has_approval: bool,
}

/// Decision point 2, in the fixed order of `PHASE2_POLICY_MODEL.md` §3.2.
pub fn decide_tool(facts: &ToolFacts<'_>) -> Verdict {
    if facts.status == "error" {
        return Verdict::Deny("policy.tool_error");
    }
    if !facts.enabled {
        return Verdict::Deny("policy.tool_disabled");
    }
    for needed in facts.needed {
        if !facts.declared.iter().any(|p| p == needed) {
            return Verdict::Deny("policy.permission_undeclared");
        }
    }
    if facts.standing_grant {
        return Verdict::Allow;
    }
    if facts.has_approval {
        return Verdict::Allow;
    }
    if facts.needs_approval {
        return Verdict::RequireApproval;
    }
    Verdict::Allow
}

/// Decision point 1: offline is a refusal, not a degraded attempt.
pub fn network_decision(mode: &str) -> Verdict {
    if mode == "online" {
        Verdict::RequireApproval
    } else {
        Verdict::Deny("policy.offline")
    }
}

/// Invariant 2: policy reads the stored grant, never the UI's claim about it.
pub fn grant_from_store(ui_claims_grant: bool, stored_grant: bool) -> bool {
    let _ = ui_claims_grant;
    stored_grant
}

/// A short fingerprint of the arguments an approval is bound to.
pub fn args_hash(parts: &[&str]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for part in parts {
        for byte in part.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Invariant 4: an approval authorises exactly the argument set it was created for.
pub fn approval_matches(stored_hash: Option<&str>, current_hash: &str) -> bool {
    matches!(stored_hash, Some(stored) if stored == current_hash)
}

/// Invariant 5: an undecided approval past its deadline is expired (a denial).
pub fn approval_expired(expires_at: &str, now: &str, decision: Option<&str>) -> bool {
    decision.is_none() && now >= expires_at
}

/// Invariant 6: only approved memory is eligible for a prompt.
pub fn memory_retrievable(approval: &str) -> bool {
    approval == "approved"
}

/// Invariant 8 (ctx half): `--ctx-size 0` means "the model's maximum", which the
/// measurements show would cost ~14.5 GB. No spawn may carry it.
pub fn spawn_context_valid(ctx: u32) -> bool {
    ctx > 0
}

/// Decision point 4, using the measured private-memory slope from `MEASUREMENTS.md`:
/// private ≈ 1495 MB + 0.1106 MB × tokens. Returns whether the load fits the free RAM.
pub fn context_fits(free_mb: i64, tokens: u32) -> bool {
    let estimate = 1495.0 + 0.1106 * f64::from(tokens);
    free_mb > 0 && estimate <= free_mb as f64
}

/// Invariant 9: telemetry is off unless a stored value says otherwise.
pub fn telemetry_allowed(stored: Option<&str>) -> bool {
    matches!(stored, Some("on") | Some("true"))
}

/// Invariant 10: a denial without a correlation id is unattributable.
pub fn valid_correlation(id: Option<&str>) -> bool {
    matches!(id, Some(value) if !value.trim().is_empty())
}

/// Canonicalise `input` and require it to live inside one of `roots`.
///
/// Traversal is refused before any filesystem call beyond canonicalisation: any `..`
/// component, and any canonical result outside every canonical root, is
/// `policy.root_denied` with a message that says which path and why. A missing target is
/// allowed only when its parent exists inside a root (that is how a new file is written).
pub fn resolve_in_roots(input: &Path, roots: &[PathBuf]) -> Result<PathBuf, PolicyError> {
    if roots.is_empty() {
        return Err(PolicyError::root_denied(
            "No folder is allow-listed yet, so the tool has no root to work inside.",
        ));
    }
    if input.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(PolicyError::root_denied(format!(
            "{} contains “..”; paths outside a watched folder are refused.",
            input.display()
        )));
    }

    let canonical_roots: Vec<PathBuf> = roots
        .iter()
        .filter_map(|root| std::fs::canonicalize(root).ok())
        .collect();
    if canonical_roots.is_empty() {
        return Err(PolicyError::root_denied(
            "None of the allow-listed folders exists on disk right now.",
        ));
    }

    let target = match std::fs::canonicalize(input) {
        Ok(path) => path,
        Err(_) => {
            let parent = input.parent().ok_or_else(|| {
                PolicyError::root_denied(format!("{} has no parent folder.", input.display()))
            })?;
            let canonical_parent = std::fs::canonicalize(parent).map_err(|_| {
                PolicyError::root_denied(format!(
                    "{} does not exist inside a watched folder.",
                    parent.display()
                ))
            })?;
            let name = input.file_name().ok_or_else(|| {
                PolicyError::root_denied(format!("{} names no file.", input.display()))
            })?;
            canonical_parent.join(name)
        }
    };

    if canonical_roots.iter().any(|root| contains(root, &target)) {
        Ok(target)
    } else {
        Err(PolicyError::root_denied(format!(
            "{} is outside every watched folder.",
            input.display()
        )))
    }
}

fn contains(root: &Path, target: &Path) -> bool {
    let root = comparable(root);
    let target = comparable(target);
    target == root || target.starts_with(&root)
}

fn comparable(path: &Path) -> String {
    let text = path.to_string_lossy().replace('/', "\\");
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nexus-policy-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn perms(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn invariant_1_offline_refuses_without_any_attempt() {
        assert_eq!(network_decision("offline"), Verdict::Deny("policy.offline"));
        assert_eq!(network_decision("online"), Verdict::RequireApproval);
        assert_eq!(PolicyError::offline().code, "policy.offline");
    }

    #[test]
    fn invariant_2_only_a_stored_grant_grants() {
        assert!(!grant_from_store(true, false), "the UI's claim alone must grant nothing");
        assert!(grant_from_store(false, true), "the stored row is the grant");
    }

    #[test]
    fn invariant_3_needs_approval_without_one_is_refused() {
        let declared = perms(&["fs.read"]);
        let facts = ToolFacts {
            status: "ready",
            enabled: true,
            declared: &declared,
            needed: &declared,
            standing_grant: false,
            needs_approval: true,
            has_approval: false,
        };
        assert_eq!(decide_tool(&facts), Verdict::RequireApproval);
        let approved = ToolFacts { has_approval: true, ..facts };
        assert_eq!(decide_tool(&approved), Verdict::Allow);
    }

    #[test]
    fn invariant_4_one_approval_is_bound_to_one_argument_set() {
        let hash = args_hash(&["fs.write", "C:\\notes\\a.txt", "hello"]);
        assert!(approval_matches(Some(&hash), &hash));
        let changed = args_hash(&["fs.write", "C:\\notes\\a.txt", "hello!"]);
        assert!(!approval_matches(Some(&hash), &changed));
        assert!(!approval_matches(None, &hash));
    }

    #[test]
    fn invariant_5_expiry_is_a_denial() {
        let now = "2026-11-17T10:00:00Z";
        assert!(approval_expired("2026-11-17T09:59:59Z", now, None));
        assert!(!approval_expired("2026-11-17T10:05:00Z", now, None));
        assert!(!approval_expired("2026-11-17T09:00:00Z", now, Some("approved")));
    }

    #[test]
    fn invariant_6_pending_memory_is_never_retrievable() {
        assert!(memory_retrievable("approved"));
        assert!(!memory_retrievable("pending"));
        assert!(!memory_retrievable("rejected"));
    }

    #[test]
    fn invariant_7_traversal_outside_a_root_is_refused_before_the_call() {
        let root = temp_dir("root");
        std::fs::write(root.join("inside.txt"), "ok").unwrap();
        let roots = vec![root.clone()];

        let inside = resolve_in_roots(&root.join("inside.txt"), &roots).unwrap();
        assert!(inside.ends_with("inside.txt"));

        let traversal = root.join("..").join("outside.txt");
        let err = resolve_in_roots(&traversal, &roots).unwrap_err();
        assert_eq!(err.code, "policy.root_denied");

        let elsewhere = std::env::temp_dir().join("nexus-policy-outside.txt");
        let err = resolve_in_roots(&elsewhere, &roots).unwrap_err();
        assert_eq!(err.code, "policy.root_denied");

        let err = resolve_in_roots(&root.join("inside.txt"), &[]).unwrap_err();
        assert_eq!(err.code, "policy.root_denied");

        // A new file is allowed when its parent is inside the root.
        let new_file = resolve_in_roots(&root.join("new.txt"), &roots).unwrap();
        assert!(new_file.ends_with("new.txt"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn invariant_7b_a_symlink_cannot_smuggle_a_path_out_of_a_root() {
        let root = temp_dir("link-root");
        let outside = temp_dir("link-outside");
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        let link = root.join("escape");
        if std::os::windows::fs::symlink_dir(&outside, &link).is_err() {
            // Creating a symlink needs Developer Mode or elevation; the traversal test above
            // still covers the lexical case.
            let _ = std::fs::remove_dir_all(&root);
            let _ = std::fs::remove_dir_all(&outside);
            return;
        }
        let err =
            resolve_in_roots(&link.join("secret.txt"), std::slice::from_ref(&root)).unwrap_err();
        assert_eq!(err.code, "policy.root_denied");
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn invariant_8_no_spawn_without_an_explicit_context() {
        assert!(!spawn_context_valid(0));
        assert!(spawn_context_valid(8192));
        assert!(!context_fits(500, 2048), "500 MB cannot hold the measured baseline");
        assert!(context_fits(6000, 2048));
    }

    #[test]
    fn invariant_9_telemetry_defaults_to_off() {
        assert!(!telemetry_allowed(None));
        assert!(!telemetry_allowed(Some("off")));
        assert!(telemetry_allowed(Some("on")));
    }

    #[test]
    fn invariant_10_every_decision_carries_a_correlation_id() {
        assert!(!valid_correlation(None));
        assert!(!valid_correlation(Some("  ")));
        assert!(valid_correlation(Some("job-1")));
    }

    #[test]
    fn undeclared_permissions_and_bad_status_are_denied() {
        let declared = perms(&["fs.read"]);
        let needed = perms(&["fs.write"]);
        let facts = ToolFacts {
            status: "ready",
            enabled: true,
            declared: &declared,
            needed: &needed,
            standing_grant: true,
            needs_approval: false,
            has_approval: true,
        };
        assert_eq!(decide_tool(&facts), Verdict::Deny("policy.permission_undeclared"));
        let disabled = ToolFacts { enabled: false, ..facts };
        assert_eq!(decide_tool(&disabled), Verdict::Deny("policy.tool_disabled"));
        let broken = ToolFacts { status: "error", ..facts };
        assert_eq!(decide_tool(&broken), Verdict::Deny("policy.tool_error"));
    }
}
