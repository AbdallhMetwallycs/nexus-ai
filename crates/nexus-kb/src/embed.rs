//! A deterministic hashed bag-of-words vector.
//!
//! This is **not** a neural embedding and must never be described as one. It maps tokens
//! (and adjacent bigrams) into 256 dimensions with signed hashing and L2-normalises the
//! result. It gives real vector maths — cosine similarity between chunks — with no model
//! download, no network and identical output on every run, which is what the M3 retrieval
//! gate and its tests need. `DECISION_LOG` D-044 states the upgrade path: when a dedicated
//! embedding GGUF is authorised, replace this module behind the same three functions.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub const EMBED_DIM: usize = 256;

/// Tokens of two or more alphanumeric characters, lowercased.
pub fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.chars().count() >= 2)
        .map(|t| t.to_lowercase())
        .collect()
}

/// Embed a chunk of text. Empty or stop-word-only text maps to the zero vector, and
/// [`cosine`] treats that as no similarity rather than dividing by zero.
pub fn embed(text: &str) -> Vec<f32> {
    let tokens = tokenize(text);
    let mut vector = vec![0.0f32; EMBED_DIM];
    for (i, token) in tokens.iter().enumerate() {
        add(&mut vector, token, 1.0);
        if let Some(next) = tokens.get(i + 1) {
            add(&mut vector, &format!("{token}_{next}"), 0.5);
        }
    }
    let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in &mut vector {
            *value /= norm;
        }
    }
    vector
}

fn add(vector: &mut [f32], token: &str, weight: f32) {
    let mut hasher = DefaultHasher::new();
    token.hash(&mut hasher);
    let hash = hasher.finish();
    let index = (hash as usize) % EMBED_DIM;
    let sign = if (hash >> 17) & 1 == 0 { 1.0 } else { -1.0 };
    vector[index] += sign * weight;
}

/// Cosine similarity in `[-1, 1]`; zero vectors score 0.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na * nb)
    }
}

/// Little-endian `f32` bytes, the form stored in `kb_chunk.embedding`.
pub fn encode(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

pub fn decode(bytes: &[u8]) -> Vec<f32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_text_scores_one_and_unrelated_text_scores_lower() {
        let a = embed("prefill latency is the product constraint");
        let b = embed("prefill latency is the product constraint");
        let c = embed("the cat sat on a mat");
        assert!((cosine(&a, &b) - 1.0).abs() < 1e-5);
        assert!(cosine(&a, &c) < 0.99);
    }

    #[test]
    fn encoding_round_trips() {
        let vector = embed("round trip");
        let decoded = decode(&encode(&vector));
        assert_eq!(vector, decoded);
    }

    #[test]
    fn empty_text_is_the_zero_vector() {
        let zero = embed("   ");
        assert!(zero.iter().all(|v| *v == 0.0));
        assert_eq!(cosine(&zero, &zero), 0.0);
    }
}
