//! Local knowledge parsing for NEXUS AI.
//!
//! Three honest pieces, no network and no model download:
//!  - [`extract`] turns a file on disk into page- or section-tagged text blocks;
//!  - [`chunk`] splits those blocks into overlapping windows that keep their citation;
//!  - [`embed`] is a deterministic hashed bag-of-words vector (256 dimensions), not a
//!    neural embedding. Retrieval combines it with SQLite FTS5 BM25; `DECISION_LOG`
//!    D-044 records why, and what a dedicated embedding model would replace.
//!
//! A parser failure is an error, never a panic: `pdf_extract` and friends are wrapped in
//! `catch_unwind` so a corrupt file is reported as `failed` with the reason.

pub mod chunk;
pub mod embed;
pub mod extract;

pub use chunk::{chunk_document, Chunk};
pub use embed::{cosine, decode, embed, encode, EMBED_DIM};
pub use extract::{extract_document, Block, Extracted, FileKind};

/// Why a document could not be turned into text. The store records this verbatim in
/// `kb_document.last_error` and marks the row `failed`.
#[derive(Debug, Clone, PartialEq)]
pub struct KbError {
    pub kind: &'static str,
    pub message: String,
}

impl KbError {
    pub fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }

    pub fn unsupported(extension: &str) -> Self {
        Self::new(
            "kb.unsupported",
            format!("NEXUS does not read .{extension} files yet."),
        )
    }

    pub fn unreadable(path: &std::path::Path, reason: impl std::fmt::Display) -> Self {
        Self::new(
            "kb.unreadable",
            format!("{} could not be read: {reason}", path.display()),
        )
    }

    pub fn parse(path: &std::path::Path, reason: impl std::fmt::Display) -> Self {
        Self::new(
            "kb.parse_failed",
            format!("{} could not be parsed: {reason}", path.display()),
        )
    }

    pub fn empty(path: &std::path::Path) -> Self {
        Self::new(
            "kb.empty",
            format!("{} contains no extractable text.", path.display()),
        )
    }
}

impl std::fmt::Display for KbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} [{}]", self.message, self.kind)
    }
}

impl std::error::Error for KbError {}

pub type KbResult<T> = Result<T, KbError>;
