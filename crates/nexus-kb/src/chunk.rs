//! Overlapping chunks that keep their citation.
//!
//! Target size is 900 characters with 120 characters of overlap, both chosen against the
//! M1 measurements: the prompt side, not decode, is what costs time, and a citation is
//! only useful if the chunk that carries it is small enough to quote.

use crate::{Block, Extracted};

#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    pub ordinal: usize,
    pub text: String,
    pub page: Option<u32>,
    pub section: Option<String>,
    /// Estimated prompt tokens, `chars / 4` rounded up — the same rule the context rail
    /// already uses. It is labelled an estimate wherever it is shown.
    pub token_count: u32,
}

pub const TARGET_CHARS: usize = 900;
pub const OVERLAP_CHARS: usize = 120;

/// Split every block into chunks of at most roughly [`TARGET_CHARS`]. Paragraphs are kept
/// whole when they fit; a paragraph larger than the target is split on word boundaries.
pub fn chunk_document(doc: &Extracted) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    for block in &doc.blocks {
        chunk_block(block, &mut chunks);
    }
    for (i, chunk) in chunks.iter_mut().enumerate() {
        chunk.ordinal = i;
    }
    chunks
}

fn chunk_block(block: &Block, out: &mut Vec<Chunk>) {
    let mut current = String::new();
    let paragraphs: Vec<&str> = block.text.split('\n').collect();
    let push = |text: String, out: &mut Vec<Chunk>| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return;
        }
        let token_count = estimated_tokens(trimmed);
        out.push(Chunk {
            ordinal: 0,
            text: trimmed.to_owned(),
            page: block.page,
            section: block.section.clone(),
            token_count,
        });
    };

    for paragraph in paragraphs {
        let paragraph = paragraph.trim();
        if paragraph.is_empty() {
            continue;
        }
        if current.chars().count() + paragraph.chars().count() + 1 > TARGET_CHARS
            && !current.is_empty()
        {
            let tail = overlap_tail(&current);
            push(std::mem::take(&mut current), out);
            if !tail.is_empty() {
                current.push_str(&tail);
                current.push('\n');
            }
        }
        if paragraph.chars().count() > TARGET_CHARS {
            // A single long line: break it on whitespace near the target size.
            let mut rest = paragraph;
            while rest.chars().count() > TARGET_CHARS {
                let cut = byte_at_char(rest, TARGET_CHARS);
                let split = rest[..cut].rfind(char::is_whitespace).unwrap_or(cut);
                let (head, tail) = rest.split_at(split);
                if !current.is_empty() {
                    let carry = overlap_tail(&current);
                    push(std::mem::take(&mut current), out);
                    current = carry;
                    if !current.is_empty() {
                        current.push('\n');
                    }
                }
                push(head.to_owned(), out);
                rest = tail.trim_start();
            }
            current.push_str(rest);
        } else {
            current.push_str(paragraph);
        }
        current.push('\n');
    }
    let tail = std::mem::take(&mut current);
    push(tail, out);
}

/// The last [`OVERLAP_CHARS`] characters of a chunk, cut at a word boundary when possible.
fn overlap_tail(text: &str) -> String {
    let count = text.chars().count();
    if count <= OVERLAP_CHARS {
        return String::new();
    }
    let start = byte_at_char(text, count - OVERLAP_CHARS);
    let slice = &text[start..];
    match slice.find(char::is_whitespace) {
        Some(i) if i + 1 < slice.len() => slice[i + 1..].to_owned(),
        _ => slice.to_owned(),
    }
}

fn byte_at_char(text: &str, char_index: usize) -> usize {
    text.char_indices()
        .nth(char_index)
        .map(|(i, _)| i)
        .unwrap_or(text.len())
}

pub fn estimated_tokens(text: &str) -> u32 {
    let chars = text.chars().count() as u32;
    chars.div_ceil(4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Block, Extracted, FileKind};

    #[test]
    fn chunks_stay_near_the_target_and_overlap() {
        let paragraph = "The prefill measurement is the product constraint. ".repeat(40);
        let doc = Extracted {
            kind: FileKind::Txt,
            pages: None,
            blocks: vec![Block { page: None, section: None, text: paragraph }],
        };
        let chunks = chunk_document(&doc);
        assert!(chunks.len() > 2, "expected several chunks, got {}", chunks.len());
        for chunk in &chunks {
            assert!(
                chunk.text.chars().count() <= TARGET_CHARS + OVERLAP_CHARS,
                "chunk {} is {} chars",
                chunk.ordinal,
                chunk.text.chars().count()
            );
        }
        let first_tail: String = chunks[0]
            .text
            .chars()
            .rev()
            .take(20)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        assert!(chunks[1].text.contains(first_tail.trim()), "overlap missing");
    }

    #[test]
    fn a_page_number_survives_into_every_chunk_from_that_page() {
        let doc = Extracted {
            kind: FileKind::Pdf,
            pages: Some(1),
            blocks: vec![Block {
                page: Some(7),
                section: None,
                text: "page seven text ".repeat(100),
            }],
        };
        for chunk in chunk_document(&doc) {
            assert_eq!(chunk.page, Some(7));
        }
    }
}
