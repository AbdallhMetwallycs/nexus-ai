//! File-type detection and text extraction.
//!
//! Every parser returns citations that survive into the UI: PDF keeps its page number,
//! Markdown keeps the heading it sat under, DOCX keeps the paragraph text in order, CSV and
//! XLSX keep the row/sheet label. A parser failure is converted to [`KbError`], and panics
//! inside third-party parsers are caught so one corrupt file cannot take the scan down.

use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;

use crate::{KbError, KbResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Pdf,
    Docx,
    Md,
    Txt,
    Csv,
    Xlsx,
}

impl FileKind {
    pub fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "pdf" => Some(Self::Pdf),
            "docx" => Some(Self::Docx),
            "md" | "markdown" => Some(Self::Md),
            "txt" => Some(Self::Txt),
            "csv" => Some(Self::Csv),
            "xlsx" => Some(Self::Xlsx),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Docx => "docx",
            Self::Md => "md",
            Self::Txt => "txt",
            Self::Csv => "csv",
            Self::Xlsx => "xlsx",
        }
    }
}

/// One citable unit of a document: a PDF page, a Markdown section, a CSV row block, a sheet.
#[derive(Debug, Clone, PartialEq)]
pub struct Block {
    pub page: Option<u32>,
    pub section: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Extracted {
    pub kind: FileKind,
    pub pages: Option<u32>,
    pub blocks: Vec<Block>,
}

impl Extracted {
    pub fn text_len(&self) -> usize {
        self.blocks.iter().map(|b| b.text.len()).sum()
    }
}

/// Read a file and return its citable blocks. Unsupported extensions refuse by name.
pub fn extract_document(path: &Path) -> KbResult<Extracted> {
    let kind = FileKind::from_path(path).ok_or_else(|| {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("unknown");
        KbError::unsupported(ext)
    })?;
    if !path.is_file() {
        return Err(KbError::unreadable(path, "the file no longer exists"));
    }
    let extracted = match kind {
        FileKind::Md => extract_markdown(path)?,
        FileKind::Txt => extract_txt(path)?,
        FileKind::Csv => extract_csv(path)?,
        FileKind::Pdf => extract_pdf(path)?,
        FileKind::Docx => extract_docx(path)?,
        FileKind::Xlsx => extract_xlsx(path)?,
    };
    if extracted.text_len() == 0 {
        return Err(KbError::empty(path));
    }
    Ok(extracted)
}

fn read_text(path: &Path) -> KbResult<String> {
    let bytes = std::fs::read(path).map_err(|e| KbError::unreadable(path, e))?;
    // A UTF-8 BOM and Windows line endings are the two ordinary surprises; neither is an
    // error. Invalid UTF-8 is replaced rather than refused, because a text file that mostly
    // reads is more useful to the owner than one that refuses entirely.
    let text = String::from_utf8_lossy(&bytes);
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    Ok(text)
}

fn extract_txt(path: &Path) -> KbResult<Extracted> {
    let text = read_text(path)?;
    Ok(Extracted {
        kind: FileKind::Txt,
        pages: None,
        blocks: vec![Block { page: None, section: None, text }],
    })
}

/// Markdown keeps headings: every `#` line opens a new section and becomes the citation,
/// so an answer can say “Decision log §Windows quoting”.
fn extract_markdown(path: &Path) -> KbResult<Extracted> {
    let text = read_text(path)?;
    let mut blocks = Vec::new();
    let mut heading: Option<String> = None;
    let mut buffer = String::new();

    let flush = |buffer: &mut String, heading: &Option<String>, blocks: &mut Vec<Block>| {
        let body = buffer.trim();
        if !body.is_empty() {
            blocks.push(Block {
                page: None,
                section: heading.clone(),
                text: body.to_owned(),
            });
        }
        buffer.clear();
    };

    for line in text.lines() {
        let trimmed = line.trim();
        let is_heading = trimmed.starts_with('#');
        if is_heading {
            flush(&mut buffer, &heading, &mut blocks);
            heading = Some(trimmed.trim_start_matches('#').trim().to_owned());
            continue;
        }
        buffer.push_str(line);
        buffer.push('\n');
    }
    flush(&mut buffer, &heading, &mut blocks);

    Ok(Extracted { kind: FileKind::Md, pages: None, blocks })
}

/// CSV is cited by row range, which is the only stable coordinate a flat table has.
fn extract_csv(path: &Path) -> KbResult<Extracted> {
    let text = read_text(path)?;
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .has_headers(false)
        .from_reader(text.as_bytes());
    let mut row_no = 0usize;
    let mut block = String::new();
    let mut block_start = 1usize;
    let mut blocks = Vec::new();

    for record in reader.records() {
        let record = match record {
            Ok(record) => record,
            // A malformed quote is a parser error, not a panic.
            Err(err) => return Err(KbError::parse(path, err)),
        };
        row_no += 1;
        if row_no == 1 {
            block_start = 1;
        }
        let line = record
            .iter()
            .map(|field| field.trim())
            .collect::<Vec<_>>()
            .join(" | ");
        block.push_str(&line);
        block.push('\n');
        // 40 rows per block keeps every chunk near the 900-character target.
        if row_no.is_multiple_of(40) {
            blocks.push(Block {
                page: None,
                section: Some(format!("rows {block_start}–{row_no}")),
                text: std::mem::take(&mut block),
            });
            block_start = row_no + 1;
        }
    }
    if !block.trim().is_empty() {
        blocks.push(Block {
            page: None,
            section: Some(format!("rows {block_start}–{row_no}")),
            text: block,
        });
    }
    Ok(Extracted { kind: FileKind::Csv, pages: None, blocks })
}

/// PDF pages, one block per page. `lopdf` panics on some malformed files, so the whole
/// load-and-extract step runs inside `catch_unwind` and a panic becomes `kb.parse_failed`.
fn extract_pdf(path: &Path) -> KbResult<Extracted> {
    let bytes = std::fs::read(path).map_err(|e| KbError::unreadable(path, e))?;
    let parsed = catch_unwind(AssertUnwindSafe(|| -> Result<Vec<Block>, String> {
        let document = lopdf::Document::load_mem(&bytes).map_err(|e| e.to_string())?;
        let page_numbers: Vec<u32> = document.get_pages().keys().copied().collect();
        let mut blocks = Vec::new();
        for number in page_numbers {
            // `extract_text` returns an error for an unreadable page; keep parsing the
            // rest of the file and report the page in the block only if it has text.
            if let Ok(text) = document.extract_text(&[number]) {
                let cleaned = normalise_whitespace(&text);
                if !cleaned.is_empty() {
                    blocks.push(Block { page: Some(number), section: None, text: cleaned });
                }
            }
        }
        Ok(blocks)
    }))
    .map_err(|_| KbError::parse(path, "the PDF parser panicked on a malformed file"))?
    .map_err(|e| KbError::parse(path, e))?;

    let pages = u32::try_from(parsed.len()).ok();
    Ok(Extracted { kind: FileKind::Pdf, pages, blocks: parsed })
}

/// DOCX is a zip whose `word/document.xml` holds the text. Paragraph boundaries (`w:p`)
/// are kept; runs (`w:t`) are concatenated in order; tabs and breaks become spaces and
/// newlines. Heading styles are not interpreted, so a DOCX cites by document, not section.
fn extract_docx(path: &Path) -> KbResult<Extracted> {
    let file = std::fs::File::open(path).map_err(|e| KbError::unreadable(path, e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| KbError::parse(path, e))?;
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|_| KbError::parse(path, "word/document.xml is missing"))?
        .read_to_string(&mut xml)
        .map_err(|e| KbError::parse(path, e))?;

    let parsed = catch_unwind(AssertUnwindSafe(|| parse_docx_xml(&xml)))
        .map_err(|_| KbError::parse(path, "the DOCX parser panicked on a malformed file"))?
        .map_err(|e| KbError::parse(path, e))?;

    Ok(Extracted {
        kind: FileKind::Docx,
        pages: None,
        blocks: vec![Block { page: None, section: None, text: parsed }],
    })
}

fn parse_docx_xml(xml: &str) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut out = String::new();
    let mut in_text = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                if e.local_name().as_ref() == b"t" {
                    in_text = true;
                }
            }
            Ok(Event::End(e)) => {
                match e.local_name().as_ref() {
                    b"t" => in_text = false,
                    b"p" => out.push('\n'),
                    b"br" | b"tab" => out.push(' '),
                    _ => {}
                }
            }
            Ok(Event::Text(t)) => {
                if in_text {
                    out.push_str(&t.unescape().map_err(|e| e.to_string())?);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(normalise_whitespace(&out))
}

/// XLSX is cited by sheet name. `calamine` reads the workbook without Excel installed.
fn extract_xlsx(path: &Path) -> KbResult<Extracted> {
    use calamine::{open_workbook_auto, Reader};

    let parsed = catch_unwind(AssertUnwindSafe(|| -> Result<Vec<Block>, String> {
        let mut workbook = open_workbook_auto(path).map_err(|e| e.to_string())?;
        let names = workbook.sheet_names().to_vec();
        let mut blocks = Vec::new();
        for name in names {
            let range = match workbook.worksheet_range(&name) {
                Ok(range) => range,
                Err(_) => continue,
            };
            let mut text = String::new();
            for row in range.rows() {
                let line = row
                    .iter()
                    .map(|cell| cell.to_string())
                    .collect::<Vec<_>>()
                    .join(" | ");
                if !line.trim_matches(|c: char| c == '|' || c.is_whitespace()).is_empty() {
                    text.push_str(&line);
                    text.push('\n');
                }
            }
            if !text.trim().is_empty() {
                blocks.push(Block { page: None, section: Some(name), text });
            }
        }
        Ok(blocks)
    }))
    .map_err(|_| KbError::parse(path, "the XLSX parser panicked on a malformed file"))?
    .map_err(|e| KbError::parse(path, e))?;

    Ok(Extracted { kind: FileKind::Xlsx, pages: None, blocks: parsed })
}

fn normalise_whitespace(text: &str) -> String {
    text.lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
    }

    #[test]
    fn markdown_keeps_its_headings() {
        let doc = extract_document(&fixture("sample.md")).unwrap();
        assert_eq!(doc.kind, FileKind::Md);
        let sections: Vec<_> = doc
            .blocks
            .iter()
            .filter_map(|b| b.section.as_deref())
            .collect();
        assert!(sections.contains(&"Admission"), "{sections:?}");
        assert!(doc.text_len() > 100);
    }

    #[test]
    fn csv_keeps_row_ranges() {
        let doc = extract_document(&fixture("sample.csv")).unwrap();
        assert_eq!(doc.kind, FileKind::Csv);
        assert!(doc.blocks[0].section.as_deref().unwrap().starts_with("rows 1–"));
        assert!(doc.blocks[0].text.contains("model | context"));
    }

    #[test]
    fn a_corrupt_pdf_is_an_error_not_a_panic() {
        let err = extract_document(&fixture("corrupt.pdf")).unwrap_err();
        assert!(err.kind == "kb.parse_failed" || err.kind == "kb.empty", "{err}");
    }

    #[test]
    fn an_unknown_extension_refuses_by_name() {
        let err = extract_document(&fixture("sample.xyz")).unwrap_err();
        assert_eq!(err.kind, "kb.unsupported");
        assert!(err.message.contains("xyz"));
    }

    #[test]
    fn a_docx_zip_yields_its_paragraphs() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.docx");
        let file = std::fs::File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("word/document.xml", options).unwrap();
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Prefill is the constraint.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Decode is cheap.</w:t></w:r></w:p>
  </w:body>
</w:document>"#,
        )
        .unwrap();
        zip.finish().unwrap();

        let doc = extract_document(&path).unwrap();
        assert_eq!(doc.kind, FileKind::Docx);
        let text = &doc.blocks[0].text;
        assert!(text.contains("Prefill is the constraint."), "{text}");
        assert!(text.contains("Decode is cheap."), "{text}");
    }
}
