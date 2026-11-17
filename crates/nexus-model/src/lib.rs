//! The pinned model catalogue and the machine-aware recommendation.
//!
//! Two things make this crate worth its own file rather than constants in the core:
//!
//! 1. **The catalogue is an integrity claim, not a shopping list.** Each entry pins the
//!    exact byte length and SHA-256 of the file at Hugging Face. The downloader must
//!    reproduce both before the file is allowed to become a model.
//! 2. **The recommendation is a pure function of the machine.** Given the total physical
//!    RAM, it returns one entry; the caller supplies the number the OS reported. Tests can
//!    therefore cover a 32 GB workstation and an 8 GB laptop without either machine.
//!
//! No I/O, no paths beyond a rejected file name, no environment.

/// Free disk required beyond the file itself, so a download cannot fill the volume.
pub const DOWNLOAD_RESERVE_BYTES: u64 = 1024 * 1024 * 1024;

pub struct CatalogEntry {
    pub id: &'static str,
    pub label: &'static str,
    pub file_name: &'static str,
    pub url: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
    /// The total RAM at or above which this entry is the recommendation, in MiB.
    pub min_total_ram_mb: u64,
    /// Suggested context window for the first load.
    pub context_tokens: u32,
    pub license: &'static str,
    /// The page the first-run screen links to before the owner accepts. Checked to
    /// return HTTP 200 on 2026-11-17; never derived from the licence name.
    pub license_url: &'static str,
}

const ENTRIES: &[CatalogEntry] = &[
    CatalogEntry {
        id: "llama-3.2-1b-instruct-q4-k-m",
        label: "Llama 3.2 1B Instruct (Q4_K_M)",
        file_name: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
        url: "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
        bytes: 807_694_464,
        sha256: "6f85a640a97cf2bf5b8e764087b1e83da0fdb51d7c9fab7d0fece9385611df83",
        min_total_ram_mb: 0,
        context_tokens: 8_192,
        license: "Llama 3.2 Community License",
        license_url: "https://www.llama.com/llama3_2/license",
    },
    CatalogEntry {
        id: "llama-3.2-3b-instruct-q4-k-m",
        label: "Llama 3.2 3B Instruct (Q4_K_M)",
        file_name: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        bytes: 2_019_377_696,
        sha256: "6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff",
        min_total_ram_mb: 16 * 1024,
        context_tokens: 16_384,
        license: "Llama 3.2 Community License",
        license_url: "https://www.llama.com/llama3_2/license",
    },
];

pub fn catalog() -> &'static [CatalogEntry] {
    ENTRIES
}

pub fn find(id: &str) -> Option<&'static CatalogEntry> {
    ENTRIES.iter().find(|entry| entry.id == id)
}

/// The largest entry the machine's total RAM qualifies for. The catalogue is ordered by
/// `min_total_ram_mb`, so the fallback is the smallest model rather than "nothing".
pub fn recommend(total_ram_mb: u64) -> &'static CatalogEntry {
    ENTRIES
        .iter()
        .filter(|entry| total_ram_mb >= entry.min_total_ram_mb)
        .max_by_key(|entry| entry.min_total_ram_mb)
        .unwrap_or(&ENTRIES[0])
}

pub fn disk_allows(bytes: u64, free_bytes: u64) -> bool {
    free_bytes >= bytes.saturating_add(DOWNLOAD_RESERVE_BYTES)
}

/// A SHA-256 hex digest is 64 characters. Shorter strings are refused rather than
/// "compared loosely", so a truncated hash can never read as a match.
pub fn hash_matches(expected: &str, actual: &str) -> bool {
    expected.len() == 64 && actual.len() == 64 && expected.eq_ignore_ascii_case(actual)
}

pub fn is_safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name
            .chars()
            .any(|c| c == '/' || c == '\\' || c == ':' || c.is_control())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_B_HASH: &str =
        "6f85a640a97cf2bf5b8e764087b1e83da0fdb51d7c9fab7d0fece9385611df83";
    const THREE_B_HASH: &str =
        "6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff";

    #[test]
    fn catalog_pins_two_gguf_files_from_hugging_face() {
        let entries = catalog();
        assert_eq!(entries.len(), 2);

        let one = find("llama-3.2-1b-instruct-q4-k-m").expect("1B entry");
        assert_eq!(one.bytes, 807_694_464);
        assert_eq!(one.sha256, ONE_B_HASH);
        assert_eq!(one.file_name, "Llama-3.2-1B-Instruct-Q4_K_M.gguf");
        assert!(one.url.starts_with("https://huggingface.co/"));
        assert!(one.url.ends_with(".gguf"));
        assert_eq!(one.license, "Llama 3.2 Community License");
        assert!(one.license_url.starts_with("https://www.llama.com/"));

        let three = find("llama-3.2-3b-instruct-q4-k-m").expect("3B entry");
        assert_eq!(three.bytes, 2_019_377_696);
        assert_eq!(three.sha256, THREE_B_HASH);
        assert_eq!(three.file_name, "Llama-3.2-3B-Instruct-Q4_K_M.gguf");
        assert_eq!(three.license_url, one.license_url);

        assert!(find("no-such-model").is_none());
        assert!(find("").is_none());
    }

    #[test]
    fn a_machine_with_sixteen_gib_or_more_is_recommended_the_three_b() {
        assert_eq!(recommend(16 * 1024).id, "llama-3.2-3b-instruct-q4-k-m");
        assert_eq!(recommend(20_355).id, "llama-3.2-3b-instruct-q4-k-m");
        assert_eq!(recommend(64 * 1024).id, "llama-3.2-3b-instruct-q4-k-m");
    }

    #[test]
    fn a_machine_below_sixteen_gib_is_recommended_the_one_b() {
        assert_eq!(recommend(16 * 1024 - 1).id, "llama-3.2-1b-instruct-q4-k-m");
        assert_eq!(recommend(8 * 1024).id, "llama-3.2-1b-instruct-q4-k-m");
        assert_eq!(recommend(4 * 1024).id, "llama-3.2-1b-instruct-q4-k-m");
    }

    #[test]
    fn disk_space_needs_the_file_plus_the_reserve() {
        let need = 1_000 + DOWNLOAD_RESERVE_BYTES;
        assert!(disk_allows(1_000, need));
        assert!(disk_allows(1_000, need + 1));
        assert!(!disk_allows(1_000, need - 1));
    }

    #[test]
    fn hash_comparison_is_case_insensitive_and_rejects_a_mismatch() {
        assert!(hash_matches(ONE_B_HASH, ONE_B_HASH));
        assert!(hash_matches(ONE_B_HASH, &ONE_B_HASH.to_uppercase()));
        assert!(!hash_matches(ONE_B_HASH, THREE_B_HASH));
        assert!(!hash_matches(ONE_B_HASH, ""));
        assert!(!hash_matches("abc", "abc"));
    }

    #[test]
    fn catalogue_file_names_cannot_escape_the_models_folder() {
        for entry in catalog() {
            assert!(is_safe_file_name(entry.file_name), "{}", entry.file_name);
        }
        assert!(!is_safe_file_name("../escape.gguf"));
        assert!(!is_safe_file_name("sub/dir.gguf"));
        assert!(!is_safe_file_name("sub\\dir.gguf"));
        assert!(!is_safe_file_name(""));
        assert!(!is_safe_file_name(".."));
    }
}
