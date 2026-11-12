//! RAM admission: the check that stands between a request and a swapped desktop.
//!
//! Every constant here is a derivation of a measurement in `MEASUREMENTS.md`:
//!
//! ```text
//! priv(ctx) ≈ 1,495 MB + 0.1106 MB × ctx        (measured on this machine, 3B Q4_K_M)
//! theory     = 2 × 28 layers × 8 kv heads × 128 dims × 2 B = 0.1094 MB/token  (1.1% apart)
//! ```
//!
//! The engine does **not** refuse an over-large context — it loaded 32k at 5.1 GB private
//! on a box with 6.4 GB free (`MEASUREMENTS.md` §4). The supervisor can still be alive
//! while the desktop it belongs to is not, so this module is deliberately stricter than the
//! engine and fails closed when the OS will not report free memory
//! (`PHASE2_POLICY_MODEL.md` §7).
//!
//! A footprint is either **measured** (the authorised model, whose coefficients came from
//! `mem-probe.ps1`) or **estimated** from GGUF metadata. The `MeasuredFit.measured` flag
//! carries that distinction to the UI; it is what keeps the honesty banner honest.

use crate::error::NexusError;
use crate::ipc_types::{FitVerdict, MeasuredFit};
use crate::system::MemoryStatus;

/// Private RAM below which a load is refused regardless of the verdict.
pub const OS_FLOOR_MB: u64 = 5 * 1024;
/// The Phase 1 `fit` threshold, kept because the UI copy already uses it.
pub const FIT_CEILING_MB: u64 = 8 * 1024;
/// Headroom kept for the desktop, the WebView and the store when capping context.
pub const ADMISSION_RESERVE_MB: u64 = 1536;

pub const MIN_CONTEXT: u32 = 2_048;
pub const DEFAULT_CONTEXT: u32 = 8_192;
pub const MAX_CONTEXT: u32 = 32_768;

/// Context sizes the UI offers, smallest first.
pub const CONTEXT_LADDER: [u32; 5] = [2_048, 4_096, 8_192, 16_384, 32_768];

/// The two coefficients of the private-RAM line for one model file.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Footprint {
    /// Resident cost at zero context: graph, buffers, runtime.
    pub fixed_mb: f64,
    /// KV cache growth per context token.
    pub kv_mb_per_token: f64,
    /// True only when both numbers were measured on this machine.
    pub measured: bool,
}

impl Footprint {
    /// The authorised `Llama-3.2-3B-Instruct-Q4_K_M` at `MEASUREMENTS.md` §4.
    pub fn measured_llama_3b() -> Self {
        Self { fixed_mb: 1_495.0, kv_mb_per_token: 0.1106, measured: true }
    }

    /// Estimate from GGUF metadata when the model has never been measured here.
    ///
    /// `fixed` is calibrated against the one model we did measure: 1,495 MB fixed for a
    /// 1,918 MiB file is 0.78 × file size. The KV slope comes from the architecture
    /// itself, which is exact arithmetic, not a guess.
    pub fn estimated(file_mb: f64, kv_mb_per_token: f64) -> Self {
        Self {
            fixed_mb: (file_mb * 0.78).max(1_024.0),
            kv_mb_per_token,
            measured: false,
        }
    }

    pub fn estimate_private_mb(&self, ctx: u32) -> f64 {
        self.fixed_mb + self.kv_mb_per_token * f64::from(ctx)
    }
}

/// KV bytes per token for a Llama-style grouped-query model.
///
/// `2` (K and V) × layers × kv heads × head dim × 2 bytes (f16). Uses `head_count_kv`
/// rather than `head_count` because GQA is why this model is affordable at all.
pub fn kv_mb_per_token(
    layers: u32,
    embedding_length: u32,
    head_count: u32,
    head_count_kv: u32,
) -> f64 {
    if head_count == 0 {
        return 0.0;
    }
    let head_dim = f64::from(embedding_length) / f64::from(head_count);
    let bytes = 2.0 * f64::from(layers) * f64::from(head_count_kv) * head_dim * 2.0;
    bytes / (1024.0 * 1024.0)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub model_id: String,
    pub requested_context: u32,
    /// The context the supervisor may actually pass to `--ctx-size`.
    pub context: u32,
    pub estimate_mb: f64,
    pub free_mb: u64,
    pub total_mb: u64,
    pub verdict: FitVerdict,
    /// False when admission refuses; the caller must not spawn.
    pub allowed: bool,
    pub measured: bool,
    pub reason: String,
}

impl Plan {
    pub fn to_measured_fit(&self, actual_rss_gb: Option<f64>) -> MeasuredFit {
        MeasuredFit {
            model_id: self.model_id.clone(),
            estimate_gb: self.estimate_mb / 1024.0,
            actual_rss_gb,
            verdict: self.verdict,
            measured: self.measured && actual_rss_gb.is_some(),
        }
    }
}

/// Fail-closed admission.
///
/// `None` for memory status is a refusal, not a pass. The detail names the exact numbers
/// so the Model Manager can show arithmetic instead of "not enough memory".
pub fn plan(
    model_id: &str,
    footprint: Footprint,
    requested_context: u32,
    status: Option<MemoryStatus>,
) -> Result<Plan, NexusError> {
    let Some(status) = status else {
        return Err(NexusError::ram_admission(
            "Windows did not report total/free physical memory, so the load was refused \
             rather than guessed.",
        ));
    };

    let requested = requested_context.clamp(MIN_CONTEXT, MAX_CONTEXT);
    let mut context = requested;
    let mut estimate_mb = footprint.estimate_private_mb(context);
    let headroom_mb = status.free_mb.saturating_sub(ADMISSION_RESERVE_MB);

    // Walk the ladder down until the estimate fits the free memory with headroom. This is
    // the behaviour `MEASUREMENTS.md` §4 asks for: 32k is not wrong in the abstract, it is
    // wrong on a box with 6.5 GB free while a desktop is running.
    while context > MIN_CONTEXT && estimate_mb > headroom_mb as f64 {
        let smaller = CONTEXT_LADDER
            .iter()
            .copied()
            .filter(|c| *c < context)
            .max()
            .unwrap_or(MIN_CONTEXT);
        context = smaller;
        estimate_mb = footprint.estimate_private_mb(context);
    }

    let verdict = if estimate_mb > (status.total_mb.saturating_sub(OS_FLOOR_MB)) as f64 {
        FitVerdict::Exceeds
    } else if estimate_mb > FIT_CEILING_MB as f64 {
        FitVerdict::Tight
    } else {
        FitVerdict::Ok
    };

    let fits_free = estimate_mb <= headroom_mb as f64;
    let allowed = verdict != FitVerdict::Exceeds && fits_free;

    let reason = if !fits_free {
        format!(
            "needs {:.0} MB private at ctx {}, but only {} MB free minus the {} MB desktop reserve",
            estimate_mb, context, status.free_mb, ADMISSION_RESERVE_MB
        )
    } else if verdict == FitVerdict::Tight {
        format!(
            "fits ({:.0} MB private at ctx {}) but above the {} MB comfort ceiling; \
             expect the desktop to feel tight",
            estimate_mb, context, FIT_CEILING_MB
        )
    } else if context < requested {
        format!(
            "context capped from {} to {} to keep {:.0} MB private within the {} MB free budget",
            requested, context, estimate_mb, headroom_mb
        )
    } else {
        format!("{:.0} MB private at ctx {} fits the free memory", estimate_mb, context)
    };

    Ok(Plan {
        model_id: model_id.to_owned(),
        requested_context: requested,
        context,
        estimate_mb,
        free_mb: status.free_mb,
        total_mb: status.total_mb,
        verdict,
        allowed,
        measured: footprint.measured,
        reason,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn machine(free_mb: u64) -> Option<MemoryStatus> {
        Some(MemoryStatus { total_mb: 20_355, free_mb })
    }

    #[test]
    fn the_measured_llama_slope_matches_the_documented_arithmetic() {
        let measured = Footprint::measured_llama_3b();
        assert!((measured.estimate_private_mb(2_048) - 1_721.5).abs() < 1.0);
        assert!((measured.estimate_private_mb(8_192) - 2_400.8).abs() < 2.0);
        assert!((measured.estimate_private_mb(32_768) - 5_118.6).abs() < 3.0);
    }

    #[test]
    fn kv_theory_agrees_with_the_measured_slope_within_the_recorded_tolerance() {
        let theory = kv_mb_per_token(28, 3_072, 24, 8);
        assert!((theory - 0.1094).abs() < 0.001, "{theory}");
        let drift = (theory - 0.1106).abs() / 0.1106;
        assert!(drift < 0.02, "drift {drift}");
    }

    #[test]
    fn a_32k_request_is_capped_to_16k_on_the_measured_machine() {
        let plan = plan("llama-3.2-3b", Footprint::measured_llama_3b(), 32_768, machine(6_532))
            .unwrap();
        assert_eq!(plan.context, 16_384);
        assert_eq!(plan.requested_context, 32_768);
        assert!(plan.allowed, "{plan:?}");
        assert_eq!(plan.verdict, FitVerdict::Ok);
        assert!(plan.reason.contains("capped"), "{}", plan.reason);
    }

    #[test]
    fn a_2k_request_is_never_raised() {
        let plan =
            plan("llama-3.2-3b", Footprint::measured_llama_3b(), 1_024, machine(12_000)).unwrap();
        assert_eq!(plan.context, MIN_CONTEXT);
        assert!(plan.allowed);
    }

    #[test]
    fn free_memory_below_the_floor_is_a_refusal_with_numbers() {
        let plan = plan("llama-3.2-3b", Footprint::measured_llama_3b(), 2_048, machine(2_000))
            .unwrap();
        assert!(!plan.allowed);
        assert!(!plan.reason.is_empty());
        assert!(plan.reason.contains("needs"));
    }

    #[test]
    fn unknown_memory_is_a_refusal_not_a_pass() {
        let err = plan("llama-3.2-3b", Footprint::measured_llama_3b(), 2_048, None).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::ModelRamAdmissionFailed);
        assert!(err.detail.unwrap_or_default().contains("refused"));
    }

    #[test]
    fn a_multi_gigabyte_model_above_the_ceiling_is_tight_but_allowed_when_it_fits() {
        // 9.5 GB fixed: above the 8 GB comfort ceiling, below total - 5 GB, fits 16 GB free.
        let footprint = Footprint { fixed_mb: 9_728.0, kv_mb_per_token: 0.5, measured: false };
        let plan = plan("hypothetical-13b", footprint, 4_096, machine(16_000)).unwrap();
        assert_eq!(plan.verdict, FitVerdict::Tight);
        assert!(plan.allowed);
    }

    #[test]
    fn a_model_larger_than_the_usable_machine_is_refused() {
        let footprint = Footprint { fixed_mb: 16_000.0, kv_mb_per_token: 1.0, measured: false };
        let plan = plan("too-big", footprint, 8_192, machine(16_000)).unwrap();
        assert_eq!(plan.verdict, FitVerdict::Exceeds);
        assert!(!plan.allowed);
    }

    #[test]
    fn measured_fit_is_only_measured_when_the_rss_was_observed() {
        let plan =
            plan("llama-3.2-3b", Footprint::measured_llama_3b(), 8_192, machine(12_000)).unwrap();
        assert!(!plan.to_measured_fit(None).measured);
        let fit = plan.to_measured_fit(Some(2.34));
        assert!(fit.measured);
        assert_eq!(fit.actual_rss_gb, Some(2.34));
    }
}
