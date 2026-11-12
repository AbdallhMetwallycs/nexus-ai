//! nexus-core — the Rust side of the Phase 2 contract surface.
//!
//! Provenance rules this crate lives by, inherited from `PHASE2_MILESTONES.md` §1 and
//! `MEASUREMENTS.md`:
//!
//!  1. Every number baked into here was measured on the owner's machine with the pinned
//!     engine (`b12189`) and the one authorised model, not copied from upstream READMEs.
//!     Where a number is a derivation rather than a measurement, the doc comment says so.
//!  2. A command that exists in the contract but not in this build returns
//!     `not_implemented` (see [`dispatch`]) — never a fabricated success. That is the
//!     Phase 1 honesty rule expressed as code.
//!  3. Shapes mirror `src/contract/ipc.ts` and `src/data/types.ts` field for field, in
//!     `camelCase` on the wire. A change to one side without the other is a contract bug.
//!
//! Modules: [`error`] (the 21 contract codes), [`ipc_types`] (mirrored shapes),
//! [`engine`] (spawn/supervise/terminate the sidecar), [`registry`] (GGUF metadata),
//! [`admission`] (RAM refusal before allocation), [`net`] (loopback HTTP/1.1),
//! [`inference`] (streaming + stop), [`system`] (the three OS numbers),
//! [`dispatch`] (the contract router).

pub mod admission;
pub mod dispatch;
pub mod engine;
pub mod error;
pub mod inference;
pub mod ipc_types;
pub mod net;
pub mod registry;
pub mod system;

/// The IPC contract version this build implements; the handshake compares it.
pub const CONTRACT_VERSION: u32 = 1;
