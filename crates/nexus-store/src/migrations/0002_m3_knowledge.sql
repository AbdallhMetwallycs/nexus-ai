-- M3 — knowledge citations and vectors.
-- Derived tables stay rebuildable: every column added here can be recomputed from the
-- files on disk, so a failed re-index is repaired, never data loss.

ALTER TABLE kb_chunk ADD COLUMN section TEXT;
ALTER TABLE kb_chunk ADD COLUMN embedding BLOB;
ALTER TABLE message   ADD COLUMN citations TEXT;
CREATE INDEX idx_doc_sha ON kb_document(content_sha);
