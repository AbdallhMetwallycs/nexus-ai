import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  File,
  FileCode2,
  FilePlus2,
  FileSpreadsheet,
  FileType2,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Layers,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DemoNotice,
  EmptyState,
  Input,
  Menu,
  Modal,
  Select,
  SearchInput,
  Tooltip,
  useToast,
  type MenuItem,
} from '../components/ui';
import { ContextPanelCard, KeyValue, PageHeader, WorkArea } from '../components/common/PageChrome';
import { MOCK_COLLECTIONS, MOCK_DOCUMENTS, MOCK_FOLDER_TREE, SUPPORTED_FILE_TYPES } from '../data/knowledge';
import type { KbDocument, KbFolder } from '../data/types';
import type { KbStats } from '../contract/ipc';
import { resolveTransport } from '../contract/client';
import { formatBytes } from '../lib/utils';

/* ------------------------------------------------------------------ */
/* Folder helpers                                                      */
/* ------------------------------------------------------------------ */

type FolderNode = KbFolder & { children: FolderNode[] };

function buildFolderTree(folders: KbFolder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  folders.forEach((f) => byId.set(f.id, { ...f, children: [] }));
  const roots: FolderNode[] = [];
  byId.forEach((node) => {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortRec = (list: FolderNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function descendantIds(folders: KbFolder[], rootId: string): Set<string> {
  const result = new Set<string>();
  const walk = (id: string) => {
    result.add(id);
    folders.filter((f) => f.parentId === id).forEach((f) => walk(f.id));
  };
  walk(rootId);
  return result;
}

function folderName(folders: KbFolder[], id: string): string {
  return folders.find((f) => f.id === id)?.name ?? id;
}

/* collection for a new doc = name of the top-level ancestor folder */
function collectionForFolder(folders: KbFolder[], id: string): string {
  let cur = folders.find((f) => f.id === id);
  while (cur && cur.parentId && cur.parentId !== 'root') {
    cur = folders.find((f) => f.id === cur!.parentId);
  }
  if (!cur || cur.id === 'root') return 'Uncategorized';
  return MOCK_COLLECTIONS.includes(cur.name) ? cur.name : 'Uncategorized';
}

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

function fmtSize(sizeKB: number): string {
  return sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
}

const FILE_ICON: Record<KbDocument['fileType'], React.ReactNode> = {
  pdf: <FileText size={15} />,
  docx: <FileType2 size={15} />,
  md: <FileCode2 size={15} />,
  txt: <File size={15} />,
  csv: <FileSpreadsheet size={15} />,
  xlsx: <FileSpreadsheet size={15} />,
};

const FILE_TONE: Record<KbDocument['fileType'], string> = {
  pdf: 'text-state-err',
  docx: 'text-accent',
  md: 'text-violet',
  txt: 'text-ink-secondary',
  csv: 'text-state-ok',
  xlsx: 'text-state-ok',
};

function indexBadge(d: KbDocument) {
  switch (d.indexed) {
    case 'indexed':
      return (
        <Badge tone="ok" dot>
          indexed
        </Badge>
      );
    case 'indexing':
      return (
        <Badge tone="info" dot pulse>
          indexing
        </Badge>
      );
    case 'pending':
      return (
        <Badge tone="warn" dot>
          pending
        </Badge>
      );
    case 'failed':
      return (
        <Tooltip content={d.lastError ?? 'simulated indexing error'} side="left">
          <Badge tone="err" dot>
            failed
          </Badge>
        </Tooltip>
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */

let newDocSeq = 0;

export default function Knowledge() {
  const { toast } = useToast();
  const transport = useMemo(() => resolveTransport(), []);
  const live = transport.kind === 'tauri';
  const [docs, setDocs] = useState<KbDocument[]>(live ? [] : MOCK_DOCUMENTS);
  const [liveFolders, setLiveFolders] = useState<KbFolder[]>([]);
  const [stats, setStats] = useState<KbStats | null>(null);
  const [loading, setLoading] = useState(live);
  const [busy, setBusy] = useState<string | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState('root');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['root']));
  const [search, setSearch] = useState('');
  const [collectionFilter, setCollectionFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<KbDocument['fileType']>>(() => new Set());

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  /** Reload what the index actually holds. Every live mutation ends here. */
  const refresh = useCallback(async () => {
    if (!live) return;
    const [s, t, l] = await Promise.all([
      transport.call('kb.stats'),
      transport.call('kb.tree'),
      transport.call('kb.listDocuments', { limit: 500 }),
    ]);
    if (s.ok) setStats(s.data);
    else toast(`Could not read index stats: ${s.error.message}`, 'error');
    if (t.ok) setLiveFolders(t.data);
    if (l.ok) setDocs(l.data.items);
    setLoading(false);
  }, [live, transport, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const folders = live ? liveFolders : MOCK_FOLDER_TREE;
  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const scope = useMemo(() => (live ? null : descendantIds(folders, selectedFolderId)), [folders, live, selectedFolderId]);

  const collections = useMemo(() => {
    if (!live) return MOCK_COLLECTIONS;
    const seen = new Set<string>();
    docs.forEach((d) => d.collection && seen.add(d.collection));
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [docs, live]);

  const docCount = useMemo(() => {
    const map = new Map<string, number>();
    folders.forEach((f) => map.set(f.id, 0));
    docs.forEach((d) => {
      folders.filter((f) => descendantIds(folders, f.id).has(d.folderId)).forEach((f) => {
        map.set(f.id, (map.get(f.id) ?? 0) + 1);
      });
    });
    return map;
  }, [docs, folders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter(
      (d) =>
        (scope === null || selectedFolderId === 'root' || scope.has(d.folderId) || d.folderId === '') &&
        (collectionFilter === '' || d.collection === collectionFilter) &&
        (typeFilter.size === 0 || typeFilter.has(d.fileType)) &&
        (q === '' || d.name.toLowerCase().includes(q) || d.excerpt.toLowerCase().includes(q)),
    );
  }, [docs, scope, selectedFolderId, collectionFilter, typeFilter, search]);

  const collectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    collections.forEach((c) => counts.set(c, 0));
    docs.forEach((d) => counts.set(d.collection, (counts.get(d.collection) ?? 0) + 1));
    return counts;
  }, [collections, docs]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleType = (t: KbDocument['fileType']) =>
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const setStatus = (id: string, indexed: KbDocument['indexed']) =>
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, indexed } : d)));

  const reindex = async (d: KbDocument) => {
    if (!live) {
      setStatus(d.id, 'indexing');
      toast(`Re-indexing "${d.name}" (simulated)`, 'info');
      later(() => {
        setStatus(d.id, 'indexed');
        toast(`"${d.name}" indexed — no real parser ran`, 'success');
      }, 2500);
      return;
    }
    setBusy(d.id);
    const res = await transport.call('kb.reindex', { id: d.id });
    setBusy(null);
    if (!res.ok) toast(`"${d.name}" could not be indexed: ${res.error.message}`, 'error');
    else toast(`"${d.name}" re-indexed from disk`, 'success');
    await refresh();
  };

  const moveDoc = async (id: string, collection: string) => {
    if (!live) {
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, collection } : d)));
      return;
    }
    const res = await transport.call('kb.moveDocument', { id, collection });
    if (!res.ok) toast(`Could not move the document: ${res.error.message}`, 'error');
    await refresh();
  };

  const deleteDoc = async (id: string) => {
    if (!live) {
      setDocs((prev) => prev.filter((d) => d.id !== id));
      toast('Document removed from prototype state', 'success');
      return;
    }
    const res = await transport.call('kb.deleteDocument', { id });
    if (!res.ok) toast(`Could not remove the document from the index: ${res.error.message}`, 'error');
    else toast('Document removed from the index — the file on disk was not touched', 'success');
    await refresh();
  };

  const watchRoot = async (path: string) => {
    setBusy('watch');
    const res = await transport.call('kb.watchRoot', { path });
    setBusy(null);
    if (!res.ok) {
      toast(`Folder not added: ${res.error.message}`, 'error');
      return false;
    }
    toast(`Watching "${res.data.label}" — files are indexed locally`, 'success');
    await refresh();
    setSelectedFolderId('root');
    return true;
  };

  const unwatchRoot = async (path: string) => {
    setBusy(`unwatch:${path}`);
    const res = await transport.call('kb.unwatchRoot', { path });
    setBusy(null);
    if (!res.ok) toast(`Folder not removed: ${res.error.message}`, 'error');
    else toast('Folder is no longer watched — indexed rows stay until removed', 'success');
    await refresh();
  };

  const previewDoc = docs.find((d) => d.id === previewId) ?? null;
  const moveDoc_ = docs.find((d) => d.id === moveId) ?? null;
  const deleteDoc_ = docs.find((d) => d.id === deleteId) ?? null;

  /* ---------------------------- tree render ---------------------------- */

  const renderNode = (node: FolderNode, depth: number): React.ReactNode => {
    const hasKids = node.children.length > 0;
    const isOpen = expanded.has(node.id);
    const isSelected = selectedFolderId === node.id;
    return (
      <li key={node.id}>
        <div
          className={
            'group flex items-center gap-1 rounded-md pr-1 ' + (isSelected ? 'bg-accent/10' : 'hover:bg-surface-line/40')
          }
          style={{ paddingLeft: depth * 12 }}
        >
          {hasKids ? (
            <button
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
              onClick={() => toggleExpand(node.id)}
              className="flex h-6 w-5 shrink-0 items-center justify-center text-ink-faint hover:text-ink-primary"
            >
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="h-6 w-5 shrink-0" />
          )}
          <button
            onClick={() => setSelectedFolderId(node.id)}
            className={'flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-xs ' + (isSelected ? 'text-ink-primary' : 'text-ink-secondary')}
          >
            {node.id === selectedFolderId ? (
              <FolderOpen size={14} className="shrink-0 text-accent" />
            ) : (
              <Folder size={14} className="shrink-0 text-ink-faint" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
          <span className="mono-num shrink-0 text-2xs text-ink-faint">{docCount.get(node.id) ?? 0}</span>
        </div>
        {hasKids && isOpen && <ul className="mt-0.5 space-y-0.5">{node.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  /* ------------------------------------------------------------------ */

  return (
    <WorkArea
      contextPanel={
        <>
          <ContextPanelCard title="Knowledge collections">
            <ul className="space-y-1.5">
              {collections.map((c) => (
                <li key={c} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2 text-ink-secondary">
                    <Layers size={13} className="shrink-0 text-ink-faint" />
                    <span className="truncate">{c}</span>
                  </span>
                  <span className="mono-num shrink-0 text-ink-faint">{collectionCounts.get(c) ?? 0}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
              {live
                ? 'Counts derived from the documents in the local index.'
                : 'Counts derived from documents currently in prototype state.'}
            </p>
          </ContextPanelCard>

          <ContextPanelCard title="Supported file types">
            <ul className="flex flex-wrap gap-1.5">
              {SUPPORTED_FILE_TYPES.map((t) => (
                <li
                  key={t}
                  className="mono-num flex items-center gap-1 rounded-md border border-surface-line bg-surface-base px-2 py-1 text-2xs text-ink-secondary"
                >
                  <span className={FILE_TONE[t]}>{FILE_ICON[t]}</span>
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
              {live
                ? 'Parsed and chunked locally; retrieval is BM25 plus a local hashed-vector cosine. No model is downloaded.'
                : 'Parsing and chunking are disabled in Phase 1.'}
            </p>
          </ContextPanelCard>

          {live ? (
            <ContextPanelCard title="Index (measured)">
              <div className="space-y-2">
                <KeyValue k="Documents" v={stats ? String(stats.documents) : '—'} mono />
                <KeyValue k="Chunks" v={stats ? String(stats.chunks) : '—'} mono />
                <KeyValue k="On disk" v={stats ? formatBytes(stats.indexedBytes / (1024 * 1024 * 1024)) : '—'} mono />
                <KeyValue k="Pending / failed" v={stats ? `${stats.pending} / ${stats.failed}` : '—'} mono />
                {stats && stats.roots.length > 0 && (
                  <div className="space-y-1 border-t border-surface-line pt-2">
                    <p className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Watched folders</p>
                    {stats.roots.map((r) => (
                      <div key={r.path} className="flex items-start gap-1.5 text-2xs">
                        <span className="min-w-0 flex-1 break-all text-ink-secondary">{r.path}</span>
                        <button
                          onClick={() => void unwatchRoot(r.path)}
                          disabled={busy === `unwatch:${r.path}`}
                          className="shrink-0 text-ink-faint hover:text-state-err disabled:opacity-50"
                        >
                          {busy === `unwatch:${r.path}` ? 'removing…' : 'remove'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-2xs text-ink-faint">
                  {stats && stats.documents === 0
                    ? 'Nothing indexed yet — add a folder to begin.'
                    : 'Numbers reported by the local index, not estimated by the UI.'}
                </p>
              </div>
            </ContextPanelCard>
          ) : (
            <ContextPanelCard title="Storage (mock)">
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-ink-secondary">Used</span>
                    <span className="mono-num text-xs font-semibold text-accent">38%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-line/70">
                    <div className="h-full rounded-full bg-accent" style={{ width: '38%' }} />
                  </div>
                </div>
                <KeyValue k="Indexed" v="6 documents" mono />
                <KeyValue k="On disk" v={formatBytes(2.4)} mono />
                <p className="text-2xs text-ink-faint">Static mock — nothing is actually stored.</p>
              </div>
            </ContextPanelCard>
          )}

          {!live && <DemoNotice text="No documents are actually parsed or stored." />}
        </>
      }
    >
      <PageHeader
        title="Knowledge Base"
        description={
          live
            ? 'Folders you add are watched on disk. Text, Markdown, CSV, PDF, DOCX and XLSX files are parsed, chunked and indexed locally; answers cite the document and page or section they came from.'
            : 'Browse folders, review index status and manage documents. Everything here is simulated — no files are read from disk and no embeddings are produced.'
        }
        actions={
          live ? (
            <Button variant="primary" icon={<FolderPlus size={14} />} onClick={() => setWatchOpen(true)} disabled={busy === 'watch'}>
              Watch folder
            </Button>
          ) : (
            <Button variant="primary" icon={<FilePlus2 size={14} />} onClick={() => setAddOpen(true)}>
              Add documents
            </Button>
          )
        }
      />

      <div className="flex gap-4 p-5">
        {/* Folder tree */}
        <aside className="w-[230px] shrink-0">
          <Card>
            <div className="flex items-center justify-between border-b border-surface-line px-3 py-2.5">
              <span className="flex items-center gap-2 text-2xs font-bold uppercase tracking-widest text-ink-muted">
                <HardDrive size={13} /> Folders
              </span>
              <button
                onClick={() => setSelectedFolderId('root')}
                className="text-2xs text-ink-faint hover:text-accent"
                aria-label="Show all documents"
              >
                Show all
              </button>
            </div>
            <div className="p-2">
              <ul className="space-y-0.5">{tree.map((n) => renderNode(n, 0))}</ul>
              {tree.length === 0 && (
                <p className="px-2 py-2 text-2xs leading-relaxed text-ink-faint">
                  {live ? 'No watched folders yet. Use “Watch folder” to index a directory.' : 'No folders in the prototype.'}
                </p>
              )}
            </div>
          </Card>
        </aside>

        {/* Document list */}
        <div className="min-w-0 flex-1">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-3 py-2.5">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search name or excerpt…"
                className="w-[240px]"
              />
              <Select
                aria-label="Filter by collection"
                className="h-8 w-[150px] text-xs"
                value={collectionFilter}
                onChange={(e) => setCollectionFilter(e.target.value)}
                placeholder="All collections"
                options={collections.map((c) => ({ value: c, label: c }))}
              />
              <div className="flex flex-wrap items-center gap-1">
                {SUPPORTED_FILE_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleType(t)}
                    aria-pressed={typeFilter.has(t)}
                    className={
                      'mono-num flex items-center gap-1 rounded-full border px-2 py-1 text-2xs transition-colors ' +
                      (typeFilter.has(t)
                        ? 'border-accent/40 bg-accent/10 text-accent'
                        : 'border-surface-line bg-surface-base text-ink-muted hover:text-ink-secondary')
                    }
                  >
                    {FILE_ICON[t]}
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between px-4 py-2 text-2xs text-ink-faint">
              <span>
                <strong className="text-ink-secondary">
                  {selectedFolderId === 'root' ? 'All documents' : folderName(folders, selectedFolderId)}
                </strong>{' '}
                · {filtered.length} of {docs.length} documents
              </span>
              {(search || collectionFilter || typeFilter.size > 0) && (
                <button
                  onClick={() => {
                    setSearch('');
                    setCollectionFilter('');
                    setTypeFilter(new Set());
                  }}
                  className="hover:text-accent"
                >
                  Clear filters
                </button>
              )}
            </div>

            {live && loading ? (
              <EmptyState title="Reading the local index…" description="The list below is what the database holds." className="py-10" />
            ) : filtered.length === 0 ? (
              <EmptyState
                title={live ? 'Nothing indexed yet' : 'No documents match'}
                description={
                  live
                    ? 'Use “Watch folder” to add a directory. Files are parsed and indexed on this machine; nothing is uploaded.'
                    : 'Adjust the folder, search term, collection or file-type filters.'
                }
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-surface-line">
                {filtered.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-line/20">
                    <span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-surface-line bg-surface-base ' + FILE_TONE[d.fileType]}>
                      {FILE_ICON[d.fileType]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <button onClick={() => setPreviewId(d.id)} className="block max-w-full truncate text-left text-xs font-medium text-ink-primary hover:text-accent">
                        {d.name}
                      </button>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-ink-faint">
                        <span className="rounded bg-surface-line/50 px-1.5 py-0.5 text-ink-secondary">{d.collection}</span>
                        <span className="mono-num">{fmtSize(d.sizeKB)}</span>
                        {d.pages != null && <span className="mono-num">{d.pages} pages</span>}
                        {d.folderId !== '' && <span>{folderName(folders, d.folderId)}</span>}
                        {live && d.chunkCount != null && <span className="mono-num">{d.chunkCount} chunks</span>}
                      </div>
                    </div>
                    <div className="shrink-0">{indexBadge(d)}</div>
                    <Menu
                      triggerLabel={`Actions for ${d.name}`}
                      trigger={
                        <span className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint hover:text-ink-primary">
                          <MoreHorizontal size={15} />
                        </span>
                      }
                      items={
                        [
                          {
                            id: 'preview',
                            label: 'Preview',
                            icon: <Eye />,
                            onSelect: () => setPreviewId(d.id),
                          },
                          {
                            id: 'reindex',
                            label: 'Re-index',
                            icon: <RefreshCw />,
                            onSelect: () => reindex(d),
                          },
                          {
                            id: 'move',
                            label: 'Move to collection',
                            icon: <FolderInput />,
                            onSelect: () => {
                              setMoveId(d.id);
                              setMoveTarget(d.collection);
                            },
                          },
                          {
                            id: 'delete',
                            label: 'Delete',
                            danger: true,
                            icon: <Trash2 />,
                            onSelect: () => setDeleteId(d.id),
                          },
                        ] satisfies MenuItem[]
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <PreviewModal doc={previewDoc} folders={folders} live={live} onClose={() => setPreviewId(null)} />

      <Modal
        open={moveDoc_ !== null}
        onClose={() => setMoveId(null)}
        title="Move to collection"
        subtitle={moveDoc_?.name}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMoveId(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!moveTarget}
              onClick={() => {
                if (moveDoc_) {
                  void moveDoc(moveDoc_.id, moveTarget);
                  if (!live) toast(`Moved "${moveDoc_.name}" to ${moveTarget} (prototype state)`, 'success');
                }
                setMoveId(null);
              }}
            >
              Move
            </Button>
          </>
        }
      >
        <Select
          label="Target collection"
          value={moveTarget}
          onChange={(e) => setMoveTarget(e.target.value)}
          options={collections.map((c) => ({ value: c, label: c }))}
          hint={
            live
              ? 'Changes the collection label stored in the index — no file is moved on disk.'
              : 'Only changes the in-memory label — nothing is moved on disk.'
          }
        />
      </Modal>

      <ConfirmDialog
        open={deleteDoc_ !== null}
        title="Delete document?"
        message={
          live ? (
            <>
              <strong>{deleteDoc_?.name}</strong> will be removed from the local index together with its chunks. The
              file on disk is not touched.
            </>
          ) : (
            <>
              <strong>{deleteDoc_?.name}</strong> will be removed from the prototype list. This cannot be undone
              (simulated).
            </>
          )
        }
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteDoc_) void deleteDoc(deleteDoc_.id);
          setDeleteId(null);
        }}
      />

      <WatchFolderModal
        open={watchOpen}
        busy={busy === 'watch'}
        onClose={() => setWatchOpen(false)}
        onSubmit={async (path) => {
          const added = await watchRoot(path);
          if (added) setWatchOpen(false);
          return added;
        }}
      />

      {!live && (
        <AddDocumentsModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onAdd={(draftDoc) => {
            const doc: KbDocument = {
              ...draftDoc,
              id: `doc-new-${++newDocSeq}`,
              indexed: 'pending',
            };
            setDocs((prev) => [doc, ...prev]);
            toast(`Queued "${doc.name}" for indexing (simulated)`, 'info');
            later(() => {
              setStatus(doc.id, 'indexing');
              toast(`Indexing "${doc.name}"…`, 'info');
            }, 1000);
            later(() => {
              setStatus(doc.id, 'indexed');
              toast(`"${doc.name}" indexed — no real parser ran`, 'success');
            }, 3500);
          }}
        />
      )}
    </WorkArea>
  );
}

/* ------------------------------------------------------------------ */
/* Watch folder modal                                                  */
/* ------------------------------------------------------------------ */

function WatchFolderModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (path: string) => Promise<boolean>;
}) {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const trimmed = path.trim().replace(/^"|"$/g, '');
    if (trimmed === '') {
      setError('Enter a folder path, for example D:\\Documents\\notes');
      return;
    }
    const ok = await onSubmit(trimmed);
    if (ok) setPath('');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Watch a folder"
      subtitle="Files are read and indexed on this machine only"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<FolderPlus size={14} />} disabled={busy} onClick={() => void submit()}>
            {busy ? 'Scanning…' : 'Start watching'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Folder path"
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setError(null);
          }}
          placeholder="D:\Documents\notes"
          error={error}
          hint="The folder must already exist. Supported: md, txt, csv, pdf, docx, xlsx — other files are skipped."
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <p className="text-2xs leading-relaxed text-ink-faint">
          The folder is scanned immediately and then re-checked every two seconds while it stays watched. Removing it
          from the index does not modify or delete any file on disk.
        </p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Preview modal                                                       */
/* ------------------------------------------------------------------ */

function PreviewModal({
  doc,
  folders,
  live,
  onClose,
}: {
  doc: KbDocument | null;
  folders: KbFolder[];
  live: boolean;
  onClose: () => void;
}) {
  const lines = useMemo(() => (doc ? Math.min(8, Math.max(4, doc.pages ?? 5)) : 0), [doc]);
  return (
    <Modal open={doc !== null} onClose={onClose} title="Document preview" subtitle={doc?.name} size="lg">
      {doc && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className={'flex h-10 w-10 items-center justify-center rounded-md border border-surface-line bg-surface-base ' + FILE_TONE[doc.fileType]}>
              {FILE_ICON[doc.fileType]}
            </span>
            <div>
              <p className="text-xs font-medium text-ink-primary">{doc.name}</p>
              <p className="mono-num text-2xs text-ink-faint">
                {doc.fileType} · {fmtSize(doc.sizeKB)}
              </p>
            </div>
            <span className="ml-auto">{indexBadge(doc)}</span>
          </div>

          <div className="rounded-card border border-surface-line bg-surface-raised p-3">
            <p className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Excerpt</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{doc.excerpt}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <KeyValue k="Collection" v={doc.collection} />
              <KeyValue k="Folder" v={doc.folderId === '' ? '—' : folderName(folders, doc.folderId)} />
              <KeyValue k="File type" v={doc.fileType.toUpperCase()} mono />
            </div>
            <div>
              <KeyValue k="Size" v={fmtSize(doc.sizeKB)} mono />
              <KeyValue k="Pages" v={doc.pages == null ? '—' : String(doc.pages)} mono />
              <KeyValue k="Updated" v={doc.updatedAt} mono />
            </div>
          </div>

          {live ? (
            <div className="space-y-2 border-t border-surface-line pt-3">
              <div>
                <p className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Indexed source</p>
                <p className="mt-1 break-all text-2xs text-ink-faint">{doc.path ?? 'path not reported'}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <KeyValue k="Chunks" v={doc.chunkCount == null ? '—' : String(doc.chunkCount)} mono />
                <KeyValue k="Status" v={doc.indexed} mono />
              </div>
              {doc.lastError && (
                <p className="rounded-md border border-state-err/30 bg-state-err/10 px-2 py-1.5 text-2xs text-state-err">
                  {doc.lastError}
                </p>
              )}
              <p className="text-2xs text-ink-faint">
                This build does not render page images — the excerpt and citation ranges are what retrieval uses.
              </p>
            </div>
          ) : (
            <div>
              <p className="mb-1.5 text-2xs font-bold uppercase tracking-widest text-ink-muted">Rendered page (simulated)</p>
              <div className="mx-auto w-[240px] rounded-md border border-surface-line bg-surface-base p-4 shadow-card">
                <div className="space-y-2">
                  <div className="h-2 w-3/4 rounded bg-surface-line" />
                  {Array.from({ length: lines }).map((_, i) => (
                    <div
                      key={i}
                      className="h-1.5 rounded bg-surface-line/70"
                      style={{ width: `${88 - ((i * 13) % 26)}%` }}
                    />
                  ))}
                </div>
              </div>
              <p className="mt-2 text-center text-2xs text-ink-faint">document preview is simulated</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Add documents modal                                                 */
/* ------------------------------------------------------------------ */

const FOLDER_OPTIONS = MOCK_FOLDER_TREE.map((f) => ({ value: f.id, label: folderName(MOCK_FOLDER_TREE, f.id) }));
const TYPE_OPTIONS = SUPPORTED_FILE_TYPES.map((t) => ({ value: t, label: t.toUpperCase() }));
const FAKE_BASES = ['quarterly-report', 'meeting-notes', 'dataset-sample', 'policy-draft', 'audit-sheet', 'research-findings'];

function AddDocumentsModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (doc: Omit<KbDocument, 'id' | 'indexed'>) => void;
}) {
  const [name, setName] = useState('');
  const [fileType, setFileType] = useState<KbDocument['fileType']>('pdf');
  const [folderId, setFolderId] = useState('f-personal');

  const hasExtension = /\.[a-z0-9]+$/i.test(name.trim());
  const nameError =
    name.trim() === '' ? 'Enter a filename' : hasExtension ? null : 'Filename must include an extension (e.g. report.pdf)';
  const valid = nameError === null;

  const reset = () => {
    setName('');
    setFileType('pdf');
    setFolderId('f-personal');
  };

  const pickFakeFile = () => {
    const base = FAKE_BASES[Math.floor(Math.random() * FAKE_BASES.length)];
    const stamp = Math.floor(Math.random() * 90) + 10;
    setName(`${base}-${stamp}.${fileType}`);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add documents"
      subtitle="Simulated upload — no file is read from disk"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            icon={<FilePlus2 size={14} />}
            onClick={() => {
              onAdd({
                name: name.trim(),
                folderId,
                collection: collectionForFolder(MOCK_FOLDER_TREE, folderId),
                fileType,
                sizeKB: 8 + Math.floor(name.length * 6.3),
                pages: fileType === 'pdf' || fileType === 'docx' ? 4 + (name.length % 20) : null,
                updatedAt: new Date().toISOString().slice(0, 10),
                excerpt: 'Simulated document added in the prototype — content is not parsed or stored.',
              });
              reset();
              onClose();
            }}
          >
            Add document
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <button
          type="button"
          onClick={pickFakeFile}
          aria-label="Simulate choosing a file"
          className="flex w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-surface-line bg-surface-base/50 px-4 py-8 text-center transition-colors hover:border-accent/40 hover:bg-accent/5"
        >
          <Upload size={22} className="text-ink-faint" />
          <span className="text-xs font-medium text-ink-secondary">Drop files here (simulated)</span>
          <span className="text-2xs text-ink-faint">Click to pick a mock file name</span>
        </button>

        <Input
          label="File name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="report-2026.pdf"
          error={name.length > 0 ? nameError : null}
          hint="Any name with a matching extension — validation is prototype-only."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="File type"
            value={fileType}
            onChange={(e) => setFileType(e.target.value as KbDocument['fileType'])}
            options={TYPE_OPTIONS}
          />
          <Select label="Target folder" value={folderId} onChange={(e) => setFolderId(e.target.value)} options={FOLDER_OPTIONS} />
        </div>

        <p className="text-2xs leading-relaxed text-ink-faint">
          New rows appear with a <strong>pending</strong> status and progress to indexing, then indexed — all transitions
          are simulated timers.
        </p>
      </div>
    </Modal>
  );
}
