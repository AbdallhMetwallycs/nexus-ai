//! Knowledge base tables: roots, folders, documents, chunks and retrieval.
//!
//! Retrieval is hybrid and honest about it: SQLite FTS5 `bm25` supplies lexical rank, and
//! `kb_chunk.embedding` (a hashed bag-of-words vector, see `nexus-kb`) supplies cosine
//! rank. The two are fused with reciprocal-rank fusion. No neural claim is made anywhere.
//!
//! Memory retrieval is approval-gated in SQL, not in the caller: a `pending` row can never
//! come back from [`Store::retrieve_memories`], which is the M3 security property.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{new_id, Store, StoreError, StoreResult};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KbRootRecord {
    pub id: String,
    pub path: String,
    pub label: String,
    pub watching: bool,
    pub added_at: String,
    pub last_scan_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KbFolderRecord {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KbDocumentRecord {
    pub id: String,
    pub name: String,
    pub folder_id: String,
    pub collection: String,
    pub file_type: String,
    pub size_kb: u64,
    pub pages: Option<u32>,
    pub indexed: String,
    pub updated_at: String,
    pub excerpt: String,
    pub path: String,
    pub chunk_count: u64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub last_error: Option<String>,
    /// Change detection only; never on the wire.
    #[serde(skip)]
    pub mtime: u64,
    /// FNV-1a content fingerprint used to recognise a rename; never on the wire.
    #[serde(skip)]
    pub content_sha: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KbHit {
    pub document_id: String,
    pub chunk_id: String,
    pub text: String,
    pub page: Option<u32>,
    pub score: f32,
    /// "rental-agreement-2026.pdf p.3" — the citation travels with the hit.
    pub citation: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KbStats {
    pub documents: u64,
    pub chunks: u64,
    pub indexed_bytes: u64,
    pub pending: u64,
    pub failed: u64,
    pub roots: Vec<KbRootStat>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KbRootStat {
    pub path: String,
    pub watching: bool,
}

/// A chunk ready to be written, produced by `nexus-kb::chunk_document`.
pub struct NewChunk {
    pub text: String,
    pub page: Option<u32>,
    pub section: Option<String>,
    pub token_count: u32,
    pub embedding: Vec<f32>,
}

/// A document discovered on disk. The caller computes `content_sha` and `mtime`.
pub struct NewDocument<'a> {
    pub root_id: &'a str,
    pub folder_id: Option<&'a str>,
    pub name: &'a str,
    pub collection: &'a str,
    pub file_type: &'a str,
    pub path: &'a str,
    pub size_bytes: u64,
    pub mtime: u64,
    pub content_sha: &'a str,
    pub now: &'a str,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RetrievedMemory {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tier: String,
    pub source: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub score: f32,
}

fn doc_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<KbDocumentRecord> {
    let size_bytes: u64 = row.get::<_, i64>(6)?.max(0) as u64;
    Ok(KbDocumentRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        folder_id: row.get(2)?,
        collection: row.get(3)?,
        file_type: row.get(4)?,
        size_kb: size_bytes.div_ceil(1024),
        pages: row.get::<_, Option<i64>>(5)?.map(|p| p as u32),
        indexed: row.get(7)?,
        updated_at: row.get(8)?,
        excerpt: row.get(9)?,
        path: row.get(10)?,
        chunk_count: row.get::<_, i64>(11)?.max(0) as u64,
        last_error: row.get(12)?,
        mtime: row.get::<_, i64>(13)?.max(0) as u64,
        content_sha: row.get(14)?,
    })
}

const DOC_COLUMNS: &str = "d.id, d.name, COALESCE(d.folder_id, '') AS folder_id, d.collection,
    d.file_type, d.pages, d.size_bytes, d.indexed, d.updated_at, COALESCE(d.excerpt, ''),
    d.path, (SELECT COUNT(*) FROM kb_chunk c WHERE c.document_id = d.id), d.last_error,
    d.mtime, COALESCE(d.content_sha, '')";

/// Turn a free-text query into a safe FTS5 expression: bare quoted terms, OR-joined.
/// Anything that is not a word is dropped, so quotes and `NEAR` cannot break the statement.
fn fts_query(query: &str) -> Option<String> {
    let terms: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.chars().count() >= 2)
        .map(|t| format!("\"{}\"", t.to_lowercase()))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" OR "))
    }
}

impl Store {
    /* ---------------------------------------------------------------- */
    /* Roots and folders                                                 */
    /* ---------------------------------------------------------------- */

    pub fn kb_roots(&self) -> StoreResult<Vec<KbRootRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, label, watching, added_at, last_scan_at
             FROM kb_root ORDER BY added_at",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(KbRootRecord {
                id: r.get(0)?,
                path: r.get(1)?,
                label: r.get(2)?,
                watching: r.get::<_, i64>(3)? != 0,
                added_at: r.get(4)?,
                last_scan_at: r.get(5)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    /// Register a root (idempotent by path) and re-enable watching if it was paused.
    pub fn kb_add_root(&self, path: &str, label: &str, now: &str) -> StoreResult<KbRootRecord> {
        if let Some(existing) = self.kb_root_by_path(path)? {
            self.conn.execute(
                "UPDATE kb_root SET watching = 1, label = ?2 WHERE id = ?1",
                params![existing.id, label],
            )?;
            return self
                .kb_root_by_path(path)?
                .ok_or_else(|| StoreError::internal("the root vanished while updating it"));
        }
        let id = new_id("root");
        self.conn.execute(
            "INSERT INTO kb_root (id, path, label, watching, added_at)
             VALUES (?1, ?2, ?3, 1, ?4)",
            params![id, path, label, now],
        )?;
        self.kb_root_by_path(path)?
            .ok_or_else(|| StoreError::internal("the root was not stored"))
    }

    pub fn kb_root_by_path(&self, path: &str) -> StoreResult<Option<KbRootRecord>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, path, label, watching, added_at, last_scan_at
                 FROM kb_root WHERE path = ?1",
                [path],
                |r| {
                    Ok(KbRootRecord {
                        id: r.get(0)?,
                        path: r.get(1)?,
                        label: r.get(2)?,
                        watching: r.get::<_, i64>(3)? != 0,
                        added_at: r.get(4)?,
                        last_scan_at: r.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn kb_remove_root(&self, path: &str) -> StoreResult<bool> {
        let changed = self
            .conn
            .execute("DELETE FROM kb_root WHERE path = ?1", [path])?;
        Ok(changed > 0)
    }

    pub fn kb_touch_root(&self, root_id: &str, now: &str) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE kb_root SET last_scan_at = ?2 WHERE id = ?1",
            params![root_id, now],
        )?;
        Ok(())
    }

    pub fn kb_folders(&self) -> StoreResult<Vec<KbFolderRecord>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, parent_id FROM kb_folder ORDER BY name")?;
        let rows = stmt.query_map([], |r| {
            Ok(KbFolderRecord { id: r.get(0)?, name: r.get(1)?, parent_id: r.get(2)? })
        })?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    /// Create the folder if (root, parent, name) does not exist yet; return its id.
    pub fn kb_ensure_folder(
        &self,
        root_id: &str,
        parent_id: Option<&str>,
        name: &str,
    ) -> StoreResult<String> {
        if let Some(id) = self
            .conn
            .query_row(
                "SELECT id FROM kb_folder
                 WHERE root_id = ?1 AND COALESCE(parent_id, '') = COALESCE(?2, '') AND name = ?3",
                params![root_id, parent_id, name],
                |r| r.get::<_, String>(0),
            )
            .optional()?
        {
            return Ok(id);
        }
        let id = new_id("folder");
        self.conn.execute(
            "INSERT INTO kb_folder (id, root_id, parent_id, name) VALUES (?1, ?2, ?3, ?4)",
            params![id, root_id, parent_id, name],
        )?;
        Ok(id)
    }

    /* ---------------------------------------------------------------- */
    /* Documents                                                         */
    /* ---------------------------------------------------------------- */

    pub fn kb_documents_for_root(&self, root_id: &str) -> StoreResult<Vec<KbDocumentRecord>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {DOC_COLUMNS} FROM kb_document d WHERE d.root_id = ?1 ORDER BY d.path"
        ))?;
        let rows = stmt.query_map([root_id], doc_from_row)?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    pub fn kb_document(&self, id: &str) -> StoreResult<KbDocumentRecord> {
        self.conn
            .query_row(
                &format!("SELECT {DOC_COLUMNS} FROM kb_document d WHERE d.id = ?1"),
                [id],
                doc_from_row,
            )
            .optional()?
            .ok_or_else(|| StoreError::unknown_id("document", id))
    }

    pub fn kb_document_by_path(&self, path: &str) -> StoreResult<Option<KbDocumentRecord>> {
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {DOC_COLUMNS} FROM kb_document d WHERE d.path = ?1"),
                [path],
                doc_from_row,
            )
            .optional()?)
    }

    /// A document with the same content that no longer exists at its recorded path —
    /// this is what turns a rename into an update instead of a duplicate.
    pub fn kb_document_by_sha(
        &self,
        sha: &str,
    ) -> StoreResult<Option<KbDocumentRecord>> {
        if sha.is_empty() {
            return Ok(None);
        }
        Ok(self
            .conn
            .query_row(
                &format!(
                    "SELECT {DOC_COLUMNS} FROM kb_document d
                     WHERE d.content_sha = ?1 ORDER BY d.updated_at DESC LIMIT 1"
                ),
                [sha],
                doc_from_row,
            )
            .optional()?)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn kb_insert_document(&self, doc: NewDocument<'_>) -> StoreResult<String> {
        let id = new_id("doc");
        self.conn.execute(
            "INSERT INTO kb_document
               (id, root_id, folder_id, name, collection, file_type, path, size_bytes,
                pages, indexed, updated_at, mtime, content_sha, excerpt)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, 'pending', ?9, ?10, ?11, '')",
            params![
                id,
                doc.root_id,
                doc.folder_id,
                doc.name,
                doc.collection,
                doc.file_type,
                doc.path,
                doc.size_bytes as i64,
                doc.now,
                doc.mtime as i64,
                doc.content_sha
            ],
        )?;
        Ok(id)
    }

    /// Record a rename: same row, new path and name. Chunks and vectors stay valid.
    pub fn kb_rename_document(
        &self,
        id: &str,
        path: &str,
        name: &str,
        folder_id: Option<&str>,
        mtime: u64,
        now: &str,
    ) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE kb_document
             SET path = ?2, name = ?3, folder_id = ?4, mtime = ?5, updated_at = ?6
             WHERE id = ?1",
            params![id, path, name, folder_id, mtime as i64, now],
        )?;
        Ok(())
    }

    pub fn kb_set_index_state(
        &self,
        id: &str,
        state: &str,
        pages: Option<u32>,
        excerpt: &str,
        error: Option<&str>,
        now: &str,
    ) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE kb_document
             SET indexed = ?2, pages = ?3, excerpt = ?4, last_error = ?5,
                 indexed_at = CASE WHEN ?2 = 'indexed' THEN ?6 ELSE indexed_at END,
                 updated_at = ?6
             WHERE id = ?1",
            params![id, state, pages.map(|p| p as i64), excerpt, error, now],
        )?;
        Ok(())
    }

    pub fn kb_touch_document_mtime(&self, id: &str, mtime: u64, now: &str) -> StoreResult<()> {
        self.conn.execute(
            "UPDATE kb_document SET mtime = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, mtime as i64, now],
        )?;
        Ok(())
    }

    /// Replace every chunk of a document and keep `fts_chunk` in step in one transaction.
    pub fn kb_replace_chunks(&mut self, document_id: &str, chunks: &[NewChunk]) -> StoreResult<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM fts_chunk WHERE chunk_id IN
               (SELECT id FROM kb_chunk WHERE document_id = ?1)",
            [document_id],
        )?;
        tx.execute("DELETE FROM kb_chunk WHERE document_id = ?1", [document_id])?;
        for (ordinal, chunk) in chunks.iter().enumerate() {
            let id = new_id("chunk");
            tx.execute(
                "INSERT INTO kb_chunk
                   (id, document_id, ordinal, text, page, token_count, embedded, section, embedding)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8)",
                params![
                    id,
                    document_id,
                    ordinal as i64,
                    chunk.text,
                    chunk.page.map(|p| p as i64),
                    chunk.token_count as i64,
                    chunk.section,
                    if chunk.embedding.is_empty() {
                        None
                    } else {
                        Some(nexus_kb::encode(&chunk.embedding))
                    }
                ],
            )?;
            tx.execute(
                "INSERT INTO fts_chunk (text, chunk_id) VALUES (?1, ?2)",
                params![chunk.text, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn kb_delete_document(&self, id: &str) -> StoreResult<bool> {
        let chunk_ids: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM kb_chunk WHERE document_id = ?1")?;
            let rows = stmt.query_map([id], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<_, _>>()?
        };
        for chunk_id in chunk_ids {
            self.conn.execute(
                "DELETE FROM fts_chunk WHERE chunk_id = ?1",
                [chunk_id],
            )?;
        }
        let changed = self.conn.execute("DELETE FROM kb_document WHERE id = ?1", [id])?;
        Ok(changed > 0)
    }

    pub fn kb_move_document(&self, id: &str, collection: &str) -> StoreResult<()> {
        let changed = self.conn.execute(
            "UPDATE kb_document SET collection = ?2 WHERE id = ?1",
            params![id, collection],
        )?;
        if changed == 0 {
            return Err(StoreError::unknown_id("document", id));
        }
        Ok(())
    }

    pub fn kb_list_documents(
        &self,
        folder_id: Option<&str>,
        collection: Option<&str>,
        types: &[String],
        query: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> StoreResult<(Vec<KbDocumentRecord>, i64)> {
        let like = query
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .map(|q| format!("%{}%", q.replace('%', "\\%").replace('_', "\\_")));
        // Only the six schema-checked extensions are accepted, so the clause can be built
        // as literals without concatenating caller text into SQL.
        let wanted: Vec<&str> = ["pdf", "docx", "md", "txt", "csv", "xlsx"]
            .into_iter()
            .filter(|t| types.iter().any(|wanted| wanted == t))
            .collect();
        let type_filter = if wanted.is_empty() {
            "1".to_owned()
        } else {
            let clauses: Vec<String> =
                wanted.iter().map(|t| format!("d.file_type = '{t}'")).collect();
            format!("({})", clauses.join(" OR "))
        };
        let where_sql = format!(
            "WHERE (?1 IS NULL OR d.folder_id = ?1)
               AND (?2 IS NULL OR d.collection = ?2)
               AND (?3 IS NULL OR d.name LIKE ?3 ESCAPE '\\' OR d.path LIKE ?3 ESCAPE '\\')
               AND ({type_filter})"
        );
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM kb_document d {where_sql}"),
            params![folder_id, collection, like.as_deref()],
            |r| r.get(0),
        )?;
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {DOC_COLUMNS} FROM kb_document d {where_sql}
             ORDER BY d.updated_at DESC, d.name LIMIT ?4 OFFSET ?5"
        ))?;
        let rows = stmt.query_map(
            params![folder_id, collection, like.as_deref(), limit as i64, offset as i64],
            doc_from_row,
        )?;
        let items = rows.collect::<Result<Vec<_>, _>>()?;
        Ok((items, total))
    }

    pub fn kb_stats(&self) -> StoreResult<KbStats> {
        let (documents, indexed_bytes, pending, failed): (i64, i64, i64, i64) =
            self.conn.query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN indexed = 'indexed' THEN size_bytes ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN indexed IN ('pending','indexing') THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN indexed = 'failed' THEN 1 ELSE 0 END), 0)
                 FROM kb_document",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )?;
        let chunks: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM kb_chunk", [], |r| r.get(0))?;
        let roots = self
            .kb_roots()?
            .into_iter()
            .map(|r| KbRootStat { path: r.path, watching: r.watching })
            .collect();
        Ok(KbStats {
            documents: documents.max(0) as u64,
            chunks: chunks.max(0) as u64,
            indexed_bytes: indexed_bytes.max(0) as u64,
            pending: pending.max(0) as u64,
            failed: failed.max(0) as u64,
            roots,
        })
    }

    /* ---------------------------------------------------------------- */
    /* Retrieval                                                         */
    /* ---------------------------------------------------------------- */

    /// Hybrid search. FTS5 rank and hashed-vector cosine are fused by reciprocal rank;
    /// `measured` is true when at least one chunk carried a vector.
    pub fn kb_search(
        &self,
        query: &str,
        collections: &[String],
        max_results: usize,
    ) -> StoreResult<(Vec<KbHit>, bool)> {
        let max_results = max_results.clamp(1, 50);
        let collection_clause = if collections.is_empty() { "" } else { "AND d.collection IN" };
        let fts_expression = fts_query(query);
        let mut fused: Vec<(f32, String)> = Vec::new();
        let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

        if let Some(expression) = fts_expression.as_ref() {
            let sql = format!(
                "SELECT c.id FROM fts_chunk
                   JOIN kb_chunk c ON c.id = fts_chunk.chunk_id
                   JOIN kb_document d ON d.id = c.document_id
                 WHERE fts_chunk MATCH ?1 AND d.indexed = 'indexed'
                   {collection_clause} {collection_placeholder}
                 ORDER BY bm25(fts_chunk) LIMIT 50",
                collection_clause = collection_clause,
                collection_placeholder = collection_placeholder(collections.len(), 1),
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let mut bind: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(expression.clone())];
            for collection in collections {
                bind.push(Box::new(collection.clone()));
            }
            let refs: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|b| b.as_ref()).collect();
            let rows = stmt.query_map(refs.as_slice(), |r| r.get::<_, String>(0))?;
            for (rank, row) in rows.enumerate() {
                let chunk_id = row?;
                let score = 1.0 / (60.0 + rank as f32);
                match seen.get(&chunk_id) {
                    Some(index) => fused[*index].0 += score,
                    None => {
                        seen.insert(chunk_id.clone(), fused.len());
                        fused.push((score, chunk_id));
                    }
                }
            }
        }

        // Vector arm: cosine over every embedded chunk of indexed documents. The corpus is
        // bounded by the owner's folder size; M3's 200-document gate is the recorded size.
        let mut vector_ranked: Vec<(f32, String)> = Vec::new();
        let mut any_vector = false;
        {
            let sql = format!(
                "SELECT c.id, c.embedding FROM kb_chunk c
                   JOIN kb_document d ON d.id = c.document_id
                 WHERE d.indexed = 'indexed' AND c.embedding IS NOT NULL
                   {collection_clause} {collection_placeholder}",
                collection_clause = collection_clause,
                collection_placeholder = collection_placeholder(collections.len(), 0),
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let mut bind: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
            for collection in collections {
                bind.push(Box::new(collection.clone()));
            }
            let refs: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|b| b.as_ref()).collect();
            let rows = stmt.query_map(refs.as_slice(), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
            })?;
            let query_vector = nexus_kb::embed(query);
            for row in rows {
                let (chunk_id, blob) = row?;
                any_vector = true;
                let vector = nexus_kb::decode(&blob);
                let score = nexus_kb::cosine(&query_vector, &vector);
                if score > 0.02 {
                    vector_ranked.push((score, chunk_id));
                }
            }
            vector_ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
        }
        for (rank, (_, chunk_id)) in vector_ranked.iter().take(50).enumerate() {
            let score = 1.0 / (60.0 + rank as f32);
            match seen.get(chunk_id) {
                Some(index) => fused[*index].0 += score,
                None => {
                    seen.insert(chunk_id.clone(), fused.len());
                    fused.push((score, chunk_id.clone()));
                }
            }
        }

        fused.sort_by(|a, b| b.0.total_cmp(&a.0));
        let mut hits = Vec::new();
        for (score, chunk_id) in fused.into_iter().take(max_results) {
            if let Some(hit) = self.kb_hit(&chunk_id, score)? {
                hits.push(hit);
            }
        }
        Ok((hits, any_vector))
    }

    /// A real row for a job that was completed synchronously. The id is what a `JobRef`
    /// points at; it is not a queue ticket.
    pub fn record_finished_job(
        &self,
        kind: &str,
        status: &str,
        now: &str,
        error: Option<&str>,
    ) -> StoreResult<String> {
        let id = new_id("job");
        self.conn.execute(
            "INSERT INTO job
               (id, kind, status, priority, created_at, started_at, finished_at, progress_pct, error)
             VALUES (?1, ?2, ?3, 5, ?4, ?4, ?4, ?5, ?6)",
            params![id, kind, status, now, if status == "success" { 100 } else { 0 }, error],
        )?;
        Ok(id)
    }

    fn kb_hit(&self, chunk_id: &str, score: f32) -> StoreResult<Option<KbHit>> {
        Ok(self
            .conn
            .query_row(
                "SELECT c.document_id, c.text, c.page, c.section, d.name, d.file_type
                 FROM kb_chunk c JOIN kb_document d ON d.id = c.document_id
                 WHERE c.id = ?1",
                [chunk_id],
                |r| {
                    let document_id: String = r.get(0)?;
                    let text: String = r.get(1)?;
                    let page: Option<i64> = r.get(2)?;
                    let section: Option<String> = r.get(3)?;
                    let name: String = r.get(4)?;
                    let file_type: String = r.get(5)?;
                    let citation = if let Some(page) = page {
                        format!("{name} p.{page}")
                    } else if let Some(section) = section.as_deref().filter(|s| !s.is_empty()) {
                        format!("{name} §{section}")
                    } else {
                        format!("{name} ({file_type})")
                    };
                    let excerpt: String = text.chars().take(600).collect();
                    Ok(KbHit {
                        document_id,
                        chunk_id: chunk_id.to_owned(),
                        text: excerpt,
                        page: page.map(|p| p as u32),
                        score,
                        citation,
                    })
                },
            )
            .optional()?)
    }

    /// Approved, unarchived memory only. A pending row cannot pass this filter — the M3
    /// exit gate asserts exactly that.
    pub fn retrieve_memories(
        &self,
        query: &str,
        limit: usize,
    ) -> StoreResult<Vec<RetrievedMemory>> {
        let limit = limit.clamp(1, 20) as i64;
        let mut items = Vec::new();
        if let Some(expression) = fts_query(query) {
            let mut stmt = self.conn.prepare(
                "SELECT m.id, m.title, m.content, m.tier, m.source, m.tags, m.created_at,
                        m.updated_at, bm25(fts_memory)
                 FROM fts_memory JOIN memory m ON m.id = fts_memory.memory_id
                 WHERE fts_memory MATCH ?1 AND m.approval = 'approved' AND m.archived_at IS NULL
                 ORDER BY bm25(fts_memory) LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![expression, limit], |r| {
                Ok(RetrievedMemory {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    content: r.get(2)?,
                    tier: r.get(3)?,
                    source: r.get(4)?,
                    tags: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default(),
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                    score: 1.0,
                })
            })?;
            for row in rows {
                items.push(row?);
            }
        }
        if items.is_empty() {
            let mut stmt = self.conn.prepare(
                "SELECT id, title, content, tier, source, tags, created_at, updated_at FROM memory
                 WHERE approval = 'approved' AND archived_at IS NULL
                 ORDER BY updated_at DESC LIMIT ?1",
            )?;
            let rows = stmt.query_map([limit], |r| {
                Ok(RetrievedMemory {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    content: r.get(2)?,
                    tier: r.get(3)?,
                    source: r.get(4)?,
                    tags: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default(),
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                    score: 0.5,
                })
            })?;
            for row in rows {
                items.push(row?);
            }
        }
        for item in &items {
            self.conn.execute(
                "UPDATE memory SET last_retrieved_at = ?2, retrieval_count = retrieval_count + 1
                 WHERE id = ?1",
                params![item.id, crate::now_iso()],
            )?;
        }
        Ok(items)
    }
}

/// `AND d.collection IN (?2, ?3, …)` starting at parameter `first + 1`.
fn collection_placeholder(count: usize, first: usize) -> String {
    if count == 0 {
        return String::new();
    }
    let slots: Vec<String> = (0..count).map(|i| format!("?{}", first + 1 + i)).collect();
    format!("({})", slots.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn temp_store(tag: &str) -> (std::path::PathBuf, Store) {
        let dir = std::env::temp_dir().join(format!(
            "nexus-kb-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(dir.join("nexus.db")).unwrap();
        (dir, store)
    }

    fn chunk(text: &str, page: Option<u32>, section: Option<&str>) -> NewChunk {
        NewChunk {
            text: text.to_owned(),
            page,
            section: section.map(str::to_owned),
            token_count: (text.chars().count() as u32).div_ceil(4),
            embedding: nexus_kb::embed(text),
        }
    }

    fn add_doc(store: &mut Store, root: &str, name: &str, text: &str) -> String {
        let now = "2026-11-17T10:00:00Z";
        let id = store
            .kb_insert_document(NewDocument {
                root_id: root,
                folder_id: None,
                name,
                collection: "docs",
                file_type: "pdf",
                path: &format!("D:/docs/{name}"),
                size_bytes: text.len() as u64,
                mtime: 1,
                content_sha: "sha",
                now,
            })
            .unwrap();
        store
            .kb_replace_chunks(&id, &[chunk(text, Some(3), None)])
            .unwrap();
        store
            .kb_set_index_state(&id, "indexed", Some(3), &text.chars().take(80).collect::<String>(), None, now)
            .unwrap();
        id
    }

    #[test]
    fn search_cites_the_page_and_reports_vectors() {
        let (dir, mut store) = temp_store("search");
        let root = store.kb_add_root("D:/docs", "docs", "2026-11-17T10:00:00Z").unwrap();
        add_doc(
            &mut store,
            &root.id,
            "admission.pdf",
            "Admission is measured, not guessed. The prefill stage costs about 36 seconds.",
        );
        let (hits, measured) = store.kb_search("prefill cost", &[], 5).unwrap();
        assert!(!hits.is_empty(), "no hits");
        assert!(measured, "vectors should be present");
        assert_eq!(hits[0].page, Some(3));
        assert!(hits[0].citation.ends_with("p.3"), "{}", hits[0].citation);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn pending_memory_is_not_retrievable_until_approved() {
        let (dir, store) = temp_store("memory");
        let now = "2026-11-17T10:00:00Z";
        let pending = store
            .create_memory(
                "project",
                "Rent is due",
                "The workshop rent is due on the first of the month.",
                "conversation",
                &[],
                "pending",
                now,
            )
            .unwrap();
        assert!(
            store.retrieve_memories("rent due", 5).unwrap().is_empty(),
            "a pending memory must not be retrievable"
        );
        store.set_memory_approval(&pending.id, "approved", now).unwrap();
        let hits = store.retrieve_memories("rent due", 5).unwrap();
        assert!(
            hits.iter().any(|m| m.id == pending.id),
            "an approved memory must be retrievable"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn search_on_a_two_hundred_document_tree_is_recorded_sub_second() {
        let (dir, mut store) = temp_store("perf");
        let root = store.kb_add_root("D:/docs", "docs", "2026-11-17T10:00:00Z").unwrap();
        for i in 0..200 {
            let text = format!(
                "Document {i} covers the admission formula, prefill timing and model {i} \
                 configuration. Every sentence repeats a little so the chunk has retrievable words."
            );
            add_doc(&mut store, &root.id, &format!("doc-{i}.md"), &text);
        }
        let started = Instant::now();
        let (hits, _) = store.kb_search("admission prefill configuration", &[], 10).unwrap();
        let elapsed = started.elapsed();
        println!(
            "M3 gate: kb.search over {} chunks took {:?}",
            store.kb_stats().unwrap().chunks,
            elapsed
        );
        assert_eq!(hits.len(), 10);
        assert!(
            elapsed.as_millis() < 1500,
            "search took {elapsed:?}, expected sub-second class"
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
