//! Folder scanning, indexing and the periodic monitor.
//!
//! The monitor is a **polling** watcher (two-second interval, 100 ms stop granularity),
//! not an OS notification watcher. That choice is recorded in `DECISION_LOG` D-044: it
//! needs no extra dependency, it behaves the same on a USB stick and an SMB share, and the
//! M3 gate only needs "a file dropped into a watched root becomes indexed". A rename is
//! recognised by the content fingerprint already stored in `kb_document.content_sha`, so
//! moving a file updates its row instead of creating a second one.
//!
//! Nothing here writes outside the database and the owner's own folders: scanning reads.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use nexus_store::kb::{KbRootRecord, NewChunk, NewDocument};
use nexus_store::Store;
use serde::Serialize;

const MAX_DEPTH: usize = 12;
const MAX_FILE_BYTES: u64 = 96 * 1024 * 1024;
const POLL_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Debug, Default, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub added: usize,
    pub updated: usize,
    pub renamed: usize,
    pub removed: usize,
    pub failed: usize,
    pub skipped: usize,
}

impl ScanReport {
    pub fn changed(&self) -> bool {
        self.added + self.updated + self.renamed + self.removed + self.failed > 0
    }
}

struct DiskFile {
    path: PathBuf,
    name: String,
    file_type: &'static str,
    size: u64,
    mtime: u64,
    fingerprint: String,
    folder: Option<String>,
}

/// Reconcile one watched root with what is on disk.
pub fn scan_root(store: &mut Store, root: &KbRootRecord, now: &str) -> Result<ScanReport, String> {
    let mut files = Vec::new();
    let base = Path::new(&root.path);
    if !base.is_dir() {
        return Err(format!("{} is no longer a folder", root.path));
    }
    walk(base, base, 0, &mut files).map_err(|e| format!("{} could not be read: {e}", root.path))?;

    let existing = store.kb_documents_for_root(&root.id).map_err(err_text)?;
    let mut by_path: HashMap<String, usize> = HashMap::new();
    for (i, doc) in existing.iter().enumerate() {
        by_path.insert(doc.path.clone(), i);
    }
    let disk_paths: HashSet<String> =
        files.iter().map(|f| f.path.to_string_lossy().into_owned()).collect();
    let mut consumed: HashSet<usize> = HashSet::new();
    let mut report = ScanReport::default();

    for file in &files {
        let folder = folder_for(store, &root.id, file.folder.as_deref());
        let path_str = file.path.to_string_lossy().into_owned();
        if let Some(index) = by_path.get(&path_str).copied() {
            consumed.insert(index);
            let doc = &existing[index];
            if doc.mtime == file.mtime && doc.indexed != "failed" {
                report.skipped += 1;
                continue;
            }
            match index_file(store, &doc.id, &file.path, now) {
                Ok(_) => report.updated += 1,
                Err(_) => report.failed += 1,
            }
            continue;
        }

        // Not at a known path. If a row with the same fingerprint has lost its file, this
        // is a rename: keep the id (and therefore the citations) and move the row.
        if let Some(renamed_to) = existing
            .iter()
            .enumerate()
            .find(|(i, d)| {
                !consumed.contains(i)
                    && !disk_paths.contains(&d.path)
                    && !d.content_sha.is_empty()
                    && d.content_sha == file.fingerprint
            })
            .map(|(i, d)| (i, d.id.clone(), d.mtime))
        {
            let (index, id, old_mtime) = renamed_to;
            consumed.insert(index);
            store
                .kb_rename_document(
                    &id,
                    &path_str,
                    &file.name,
                    folder.as_deref(),
                    file.mtime,
                    now,
                )
                .map_err(err_text)?;
            if old_mtime != file.mtime || existing[index].indexed != "indexed" {
                match index_file(store, &id, &file.path, now) {
                    Ok(_) => report.updated += 1,
                    Err(_) => report.failed += 1,
                }
            }
            report.renamed += 1;
            continue;
        }

        let id = store
            .kb_insert_document(NewDocument {
                root_id: &root.id,
                folder_id: folder.as_deref(),
                name: &file.name,
                collection: &root.label,
                file_type: file.file_type,
                path: &path_str,
                size_bytes: file.size,
                mtime: file.mtime,
                content_sha: &file.fingerprint,
                now,
            })
            .map_err(err_text)?;
        match index_file(store, &id, &file.path, now) {
            Ok(_) => report.added += 1,
            Err(_) => report.failed += 1,
        }
    }

    // Rows whose file disappeared and was not matched as a rename.
    for (i, doc) in existing.iter().enumerate() {
        if !consumed.contains(&i) && !disk_paths.contains(&doc.path) {
            store.kb_delete_document(&doc.id).map_err(err_text)?;
            report.removed += 1;
        }
    }

    store.kb_touch_root(&root.id, now).map_err(err_text)?;
    Ok(report)
}

/// Re-index one document in place. Returns its chunk count.
pub fn index_file(
    store: &mut Store,
    doc_id: &str,
    path: &Path,
    now: &str,
) -> Result<usize, String> {
    match nexus_kb::extract_document(path) {
        Ok(extracted) => {
            let chunks = nexus_kb::chunk_document(&extracted);
            let rows: Vec<NewChunk> = chunks
                .into_iter()
                .map(|chunk| NewChunk {
                    embedding: nexus_kb::embed(&chunk.text),
                    text: chunk.text,
                    page: chunk.page,
                    section: chunk.section,
                    token_count: chunk.token_count,
                })
                .collect();
            let excerpt: String = extracted
                .blocks
                .first()
                .map(|b| b.text.chars().take(220).collect())
                .unwrap_or_default();
            store.kb_replace_chunks(doc_id, &rows).map_err(err_text)?;
            store
                .kb_set_index_state(
                    doc_id,
                    "indexed",
                    extracted.pages,
                    &excerpt,
                    None,
                    now,
                )
                .map_err(err_text)?;
            Ok(rows.len())
        }
        Err(err) => {
            // A file that is now unreadable must not keep serving its old chunks as if
            // nothing happened.
            store.kb_replace_chunks(doc_id, &[]).map_err(err_text)?;
            store
                .kb_set_index_state(doc_id, "failed", None, "", Some(&err.message), now)
                .map_err(err_text)?;
            Err(err.message)
        }
    }
}

fn folder_for(store: &Store, root_id: &str, relative: Option<&str>) -> Option<String> {
    let relative = relative?.trim_matches(['/', '\\']);
    if relative.is_empty() {
        return None;
    }
    let mut parent: Option<String> = None;
    for part in relative.split(['/', '\\']).filter(|p| !p.is_empty()) {
        match store.kb_ensure_folder(root_id, parent.as_deref(), part) {
            Ok(id) => parent = Some(id),
            Err(err) => {
                eprintln!("NEXUS folder “{part}” was not recorded: {err}");
                return None;
            }
        }
    }
    parent
}

fn walk(
    base: &Path,
    dir: &Path,
    depth: usize,
    out: &mut Vec<DiskFile>,
) -> std::io::Result<()> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if file_type.is_symlink() {
            // A junction or symlink can loop; skipping is the safe default.
            continue;
        }
        if file_type.is_dir() {
            walk(base, &path, depth + 1, out)?;
            continue;
        }
        let kind = match nexus_kb::FileKind::from_path(&path) {
            Some(kind) => kind,
            None => continue,
        };
        let meta = match entry.metadata() {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.len() > MAX_FILE_BYTES {
            continue;
        }
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let fingerprint = fingerprint(&bytes);
        let relative = path
            .parent()
            .and_then(|p| p.strip_prefix(base).ok())
            .map(|p| p.to_string_lossy().into_owned());
        out.push(DiskFile {
            path,
            name: name.into_owned(),
            file_type: kind.as_str(),
            size: meta.len(),
            mtime,
            fingerprint,
            folder: relative,
        });
    }
    Ok(())
}

/// 64-bit FNV-1a over the bytes plus the length. Named a fingerprint, not a hash digest:
/// it detects an edit or a move; it is not a security primitive.
fn fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash ^= bytes.len() as u64;
    format!("{hash:016x}")
}

fn err_text(err: nexus_store::StoreError) -> String {
    format!("{} [{}]", err.message, err.code)
}

/* ------------------------------------------------------------------ */
/* The polling monitor                                                 */
/* ------------------------------------------------------------------ */

/// Owns the background thread. Dropping it stops the thread within one poll tick.
pub struct KbMonitor {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl KbMonitor {
    pub fn start(db_path: PathBuf) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let handle = thread::Builder::new()
            .name("nexus-kb-monitor".into())
            .spawn(move || monitor_loop(db_path, flag))
            .ok();
        Self { stop, handle }
    }
}

impl Drop for KbMonitor {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn monitor_loop(db_path: PathBuf, stop: Arc<AtomicBool>) {
    let mut store: Option<Store> = None;
    while !stop.load(Ordering::SeqCst) {
        if store.is_none() {
            match Store::open(&db_path) {
                Ok(opened) => store = Some(opened),
                Err(err) => {
                    eprintln!("NEXUS folder monitor could not open the database: {err}");
                    sleep_unless_stopped(&stop, Duration::from_secs(5));
                    continue;
                }
            }
        }
        let Some(mut db) = store.take() else { continue };
        let roots = db.kb_roots().unwrap_or_default();
        for root in roots.iter().filter(|r| r.watching) {
            let now = nexus_store::now_iso();
            match scan_root(&mut db, root, &now) {
                Ok(report) if report.changed() => {
                    let _ = db.record_activity(
                        "task",
                        "Knowledge folder scanned",
                        &format!(
                            "{}: {} added, {} updated, {} renamed, {} removed, {} failed.",
                            root.label,
                            report.added,
                            report.updated,
                            report.renamed,
                            report.removed,
                            report.failed
                        ),
                        None,
                        if report.failed > 0 { "warning" } else { "success" },
                        None,
                        None,
                        &now,
                    );
                }
                Ok(_) => {}
                Err(err) => {
                    let _ = db.record_activity(
                        "warning",
                        "Knowledge folder could not be scanned",
                        &format!("{}: {err}", root.label),
                        None,
                        "failure",
                        None,
                        None,
                        &now,
                    );
                }
            }
        }
        store = Some(db);
        sleep_unless_stopped(&stop, POLL_INTERVAL);
    }
}

fn sleep_unless_stopped(stop: &AtomicBool, total: Duration) {
    let step = Duration::from_millis(100);
    let mut slept = Duration::ZERO;
    while slept < total && !stop.load(Ordering::SeqCst) {
        thread::sleep(step);
        slept += step;
    }
}
