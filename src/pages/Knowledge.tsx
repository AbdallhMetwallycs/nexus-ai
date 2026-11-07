import { useMemo, useRef, useState } from 'react';
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
        <Tooltip content="simulated indexing error" side="left">
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
  const [docs, setDocs] = useState<KbDocument[]>(MOCK_DOCUMENTS);
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

  const tree = useMemo(() => buildFolderTree(MOCK_FOLDER_TREE), []);
  const scope = useMemo(() => descendantIds(MOCK_FOLDER_TREE, selectedFolderId), [selectedFolderId]);

  const docCount = useMemo(() => {
    const map = new Map<string, number>();
    MOCK_FOLDER_TREE.forEach((f) => map.set(f.id, 0));
    docs.forEach((d) => {
      MOCK_FOLDER_TREE.filter((f) => descendantIds(MOCK_FOLDER_TREE, f.id).has(d.folderId)).forEach((f) => {
        map.set(f.id, (map.get(f.id) ?? 0) + 1);
      });
    });
    return map;
  }, [docs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter(
      (d) =>
        scope.has(d.folderId) &&
        (collectionFilter === '' || d.collection === collectionFilter) &&
        (typeFilter.size === 0 || typeFilter.has(d.fileType)) &&
        (q === '' || d.name.toLowerCase().includes(q) || d.excerpt.toLowerCase().includes(q)),
    );
  }, [docs, scope, collectionFilter, typeFilter, search]);

  const collectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    MOCK_COLLECTIONS.forEach((c) => counts.set(c, 0));
    docs.forEach((d) => counts.set(d.collection, (counts.get(d.collection) ?? 0) + 1));
    return counts;
  }, [docs]);

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

  const reindex = (d: KbDocument) => {
    setStatus(d.id, 'indexing');
    toast(`Re-indexing "${d.name}" (simulated)`, 'info');
    later(() => {
      setStatus(d.id, 'indexed');
      toast(`"${d.name}" indexed — no real parser ran`, 'success');
    }, 2500);
  };

  const moveDoc = (id: string, collection: string) => {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, collection } : d)));
  };

  const deleteDoc = (id: string) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    toast('Document removed from prototype state', 'success');
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
              {MOCK_COLLECTIONS.map((c) => (
                <li key={c} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2 text-ink-secondary">
                    <Layers size={13} className="shrink-0 text-ink-faint" />
                    <span className="truncate">{c}</span>
                  </span>
                  <span className="mono-num shrink-0 text-ink-faint">{collectionCounts.get(c) ?? 0}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs leading-relaxed text-ink-faint">Counts derived from documents currently in prototype state.</p>
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
            <p className="mt-2 text-2xs leading-relaxed text-ink-faint">Parsing and chunking are disabled in Phase 1.</p>
          </ContextPanelCard>

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

          <DemoNotice text="No documents are actually parsed or stored." />
        </>
      }
    >
      <PageHeader
        title="Knowledge Base"
        description="Browse folders, review index status and manage documents. Everything here is simulated — no files are read from disk and no embeddings are produced."
        actions={
          <Button variant="primary" icon={<FilePlus2 size={14} />} onClick={() => setAddOpen(true)}>
            Add documents
          </Button>
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
                options={MOCK_COLLECTIONS.map((c) => ({ value: c, label: c }))}
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
                <strong className="text-ink-secondary">{folderName(MOCK_FOLDER_TREE, selectedFolderId)}</strong> · {filtered.length} of{' '}
                {docs.length} documents
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

            {filtered.length === 0 ? (
              <EmptyState
                title="No documents match"
                description="Adjust the folder, search term, collection or file-type filters."
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
                        <span>{folderName(MOCK_FOLDER_TREE, d.folderId)}</span>
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

      <PreviewModal doc={previewDoc} onClose={() => setPreviewId(null)} />

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
                  moveDoc(moveDoc_.id, moveTarget);
                  toast(`Moved "${moveDoc_.name}" to ${moveTarget} (prototype state)`, 'success');
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
          options={MOCK_COLLECTIONS.map((c) => ({ value: c, label: c }))}
          hint="Only changes the in-memory label — nothing is moved on disk."
        />
      </Modal>

      <ConfirmDialog
        open={deleteDoc_ !== null}
        title="Delete document?"
        message={
          <>
            <strong>{deleteDoc_?.name}</strong> will be removed from the prototype list. This cannot be undone
            (simulated).
          </>
        }
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteDoc_) deleteDoc(deleteDoc_.id);
          setDeleteId(null);
        }}
      />

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
    </WorkArea>
  );
}

/* ------------------------------------------------------------------ */
/* Preview modal                                                       */
/* ------------------------------------------------------------------ */

function PreviewModal({ doc, onClose }: { doc: KbDocument | null; onClose: () => void }) {
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
              <KeyValue k="Folder" v={folderName(MOCK_FOLDER_TREE, doc.folderId)} />
              <KeyValue k="File type" v={doc.fileType.toUpperCase()} mono />
            </div>
            <div>
              <KeyValue k="Size" v={fmtSize(doc.sizeKB)} mono />
              <KeyValue k="Pages" v={doc.pages == null ? '—' : String(doc.pages)} mono />
              <KeyValue k="Updated" v={doc.updatedAt} mono />
            </div>
          </div>

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
