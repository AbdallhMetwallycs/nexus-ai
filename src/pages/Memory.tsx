import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCheck,
  Clock,
  Eye,
  History,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DemoNotice,
  EmptyState,
  Input,
  Menu,
  Modal,
  SearchInput,
  Tabs,
  Textarea,
  Tooltip,
  useToast,
  type MenuItem,
  type Tone,
} from '../components/ui';
import { ContextPanelCard, KeyValue, PageHeader, WorkArea } from '../components/common/PageChrome';
import type { MemoryRecord as CoreMemoryRecord } from '../contract/ipc';
import { resolveTransport } from '../contract/client';
import { MEMORY_TIER_LABELS, MOCK_MEMORIES } from '../data/memory';
import type { Approval, MemoryRecord, MemoryTier } from '../data/types';
import { clockTime, timeAgo } from '../lib/utils';

/* ------------------------------------------------------------------ */
/* Page-local helpers                                                  */
/* ------------------------------------------------------------------ */

const TIER_ORDER: MemoryTier[] = ['short', 'long', 'preference', 'project', 'conversation'];

const APPROVAL_TONE: Record<Approval, Tone> = {
  approved: 'ok',
  pending: 'warn',
  rejected: 'err',
};

const TIER_MEANING: Record<MemoryTier, string> = {
  short: 'Active task context — expires within hours.',
  long: 'Durable facts about you, your machine, your work.',
  preference: 'Explicit style and format choices you stated.',
  project: 'Facts scoped to one named project.',
  conversation: 'Inferences captured from chats — need approval.',
};

const EVENT_TONE: Record<string, Tone> = {
  created: 'info',
  edited: 'accent',
  approved: 'ok',
  rejected: 'err',
  archived: 'idle',
};

const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------------ */

export default function Memory() {
  const { toast } = useToast();
  const transport = useMemo(() => resolveTransport(), []);
  const live = transport.kind === 'tauri';
  const [memories, setMemories] = useState<MemoryRecord[]>(live ? [] : MOCK_MEMORIES);
  const [tab, setTab] = useState<MemoryTier>('short');
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyOverride, setHistoryOverride] = useState<MemoryRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [approveAllOpen, setApproveAllOpen] = useState(false);

  const asPageRecord = (r: CoreMemoryRecord): MemoryRecord => ({
    id: r.id,
    tier: r.tier as MemoryTier,
    title: r.title,
    content: r.content,
    source: r.source,
    tags: r.tags,
    approval: r.approval as Approval,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    history: r.history,
  });

  const loadMemories = useCallback(async () => {
    const listed = await transport.call('memory.list', { limit: 500 });
    if (!listed.ok) {
      toast(`${listed.error.code}: ${listed.error.message}`, 'error');
      return;
    }
    setMemories(listed.data.items.map(asPageRecord));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, toast]);

  useEffect(() => {
    if (!live) return;
    void loadMemories();
  }, [live, loadMemories]);

  // The history modal reads the recorded timeline, not a copy taken at page load.
  useEffect(() => {
    if (!live || !historyId) {
      setHistoryOverride(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [record, history] = await Promise.all([
        transport.call('memory.get', { id: historyId }),
        transport.call('memory.history', { id: historyId }),
      ]);
      if (cancelled) return;
      if (record.ok && history.ok) {
        setHistoryOverride({ ...asPageRecord(record.data), history: history.data });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, historyId, transport]);

  const q = search.trim().toLowerCase();
  const tierRows = useMemo(
    () =>
      memories.filter((r) => {
        if (r.tier !== tab) return false;
        if (!q) return true;
        return (
          r.title.toLowerCase().includes(q) ||
          r.content.toLowerCase().includes(q) ||
          r.tags.some((t) => t.toLowerCase().includes(q))
        );
      }),
    [memories, tab, q],
  );

  const pendingCount = memories.filter((r) => r.approval === 'pending').length;
  const historyRecord = historyId
    ? historyOverride ?? memories.find((r) => r.id === historyId) ?? null
    : null;
  const deleteRecord = deleteId ? memories.find((r) => r.id === deleteId) ?? null : null;

  const patch = (id: string, fn: (r: MemoryRecord) => MemoryRecord) =>
    setMemories((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));

  const openEdit = (r: MemoryRecord) => {
    setEditId(r.id);
    setEditTitle(r.title);
    setEditContent(r.content);
  };

  const saveEdit = async () => {
    if (!editId || !editTitle.trim() || !editContent.trim()) return;
    if (live) {
      const updated = await transport.call('memory.update', {
        id: editId,
        patch: { title: editTitle.trim(), content: editContent.trim() },
      });
      if (!updated.ok) {
        toast(`${updated.error.code}: ${updated.error.message}`, 'error');
        return;
      }
      const record = asPageRecord(updated.data);
      setMemories((prev) => prev.map((r) => (r.id === record.id ? record : r)));
      setEditId(null);
      toast('Memory updated in the local database', 'success');
      return;
    }
    patch(editId, (r) => ({
      ...r,
      title: editTitle.trim(),
      content: editContent.trim(),
      updatedAt: nowIso(),
      history: [...r.history, { ts: nowIso(), action: 'edited', detail: 'Edited in Memory Center (this browser session only).' }],
    }));
    setEditId(null);
    toast('Memory updated in this browser session only', 'success');
  };

  const setApproval = async (id: string, approval: 'approved' | 'rejected') => {
    if (live) {
      const result = await transport.call(
        approval === 'approved' ? 'memory.approve' : 'memory.reject',
        { id },
      );
      if (!result.ok) {
        toast(`${result.error.code}: ${result.error.message}`, 'error');
        return;
      }
      const fresh = await transport.call('memory.get', { id });
      if (fresh.ok) {
        const record = asPageRecord(fresh.data);
        setMemories((prev) => prev.map((r) => (r.id === record.id ? record : r)));
        setHistoryOverride((prev) => (prev?.id === record.id ? record : prev));
      }
      toast(
        approval === 'approved' ? 'Memory approved in the local database' : 'Memory rejected in the local database',
        approval === 'approved' ? 'success' : 'info',
      );
      return;
    }
    const detail = approval === 'approved' ? 'Approved via row menu (this browser session only).' : 'Rejected via row menu (this browser session only).';
    patch(id, (r) => ({
      ...r,
      approval,
      updatedAt: nowIso(),
      history: [...r.history, { ts: nowIso(), action: approval, detail }],
    }));
    toast(
      approval === 'approved' ? 'Memory approved in this browser session only' : 'Memory rejected in this browser session only',
      approval === 'approved' ? 'success' : 'info',
    );
  };

  const approveAll = async () => {
    if (live) {
      const result = await transport.call('memory.approveAllPending');
      setApproveAllOpen(false);
      if (!result.ok) {
        toast(`${result.error.code}: ${result.error.message}`, 'error');
        return;
      }
      await loadMemories();
      toast(`${result.data.approved} pending memories approved in the local database`, 'success');
      return;
    }
    const ts = nowIso();
    setMemories((prev) =>
      prev.map((r) =>
        r.approval === 'pending'
          ? {
              ...r,
              approval: 'approved',
              updatedAt: ts,
              history: [...r.history, { ts, action: 'approved', detail: 'Bulk-approved from Memory Center header (this browser session only).' }],
            }
          : r,
      ),
    );
    setApproveAllOpen(false);
    toast(`${pendingCount} pending memories approved in this browser session only`, 'success');
  };

  const removeRecord = async () => {
    if (!deleteRecord) return;
    const id = deleteRecord.id;
    if (live) {
      const result = await transport.call('memory.delete', { id });
      if (!result.ok) {
        toast(`${result.error.code}: ${result.error.message}`, 'error');
        return;
      }
      setMemories((prev) => prev.filter((r) => r.id !== id));
      setDeleteId(null);
      toast('Memory archived in the local database', 'success');
      return;
    }
    setMemories((prev) => prev.filter((r) => r.id !== id));
    setDeleteId(null);
    toast('Memory removed from this browser session only', 'info');
  };

  const editInvalid = editId !== null && (!editTitle.trim() || !editContent.trim());

  const rowMenu = (r: MemoryRecord): MenuItem[] => [
    { id: 'edit', label: 'Edit', icon: <Pencil />, onSelect: () => openEdit(r) },
    ...(r.approval === 'pending'
      ? ([
          { id: 'approve', label: 'Approve', icon: <Check />, onSelect: () => void setApproval(r.id, 'approved') },
          { id: 'reject', label: 'Reject', icon: <X />, onSelect: () => void setApproval(r.id, 'rejected') },
        ] satisfies MenuItem[])
      : []),
    { id: 'history', label: 'History', icon: <History />, onSelect: () => setHistoryId(r.id) },
    { id: 'delete', label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => setDeleteId(r.id) },
  ];

  return (
    <WorkArea
      contextPanel={
        <>
          <ContextPanelCard title="Memory stats">
            <div className="space-y-0.5">
              {TIER_ORDER.map((t) => (
                <KeyValue
                  key={t}
                  k={MEMORY_TIER_LABELS[t]}
                  v={String(memories.filter((r) => r.tier === t).length)}
                  mono
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-surface-line pt-3">
              <Badge tone="ok" dot>
                {memories.filter((r) => r.approval === 'approved').length} approved
              </Badge>
              <Badge tone="warn" dot>
                {memories.filter((r) => r.approval === 'pending').length} pending
              </Badge>
              <Badge tone="err" dot>
                {memories.filter((r) => r.approval === 'rejected').length} rejected
              </Badge>
            </div>
            <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
              {live
                ? 'Rows are read from the local database. Approvals, edits and archives survive a restart.'
                : 'Every record here is fictional demo data. Edits, approvals and deletions live in React state only — nothing persists across restarts in the browser demo.'}
            </p>
          </ContextPanelCard>

          <ContextPanelCard title="What each tier means">
            <div className="space-y-0.5">
              {TIER_ORDER.map((t) => (
                <div key={t} className="py-1">
                  <p className="text-xs font-medium text-ink-secondary">{MEMORY_TIER_LABELS[t]}</p>
                  <p className="mt-0.5 text-2xs leading-relaxed text-ink-faint">{TIER_MEANING[t]}</p>
                </div>
              ))}
            </div>
          </ContextPanelCard>
        </>
      }
    >
      <PageHeader
        title="Memory Center"
        description={
          live
            ? 'Review, approve, and edit the memories stored on this machine. Every action is written to the local database.'
            : 'Review, approve, and edit the memories the platform would keep about you. Approvals act on mock data in this browser session.'
        }
        notice={
          live ? undefined : (
            <DemoNotice text="All memories are fictional demo content — this browser build reads and writes React state only." />
          )
        }
        actions={
          <>
            <Tooltip content="Records captured automatically or inferred from chats await your approval" side="bottom">
              <Badge tone={pendingCount > 0 ? 'warn' : 'ok'} dot pulse={pendingCount > 0}>
                {pendingCount} pending review
              </Badge>
            </Tooltip>
            <Button
              variant={pendingCount > 0 ? 'primary' : 'secondary'}
              icon={<CheckCheck size={14} />}
              disabled={pendingCount === 0}
              onClick={() => setApproveAllOpen(true)}
            >
              Approve all pending
            </Button>
          </>
        }
      >
        <Tabs
          variant="underline"
          active={tab}
          onChange={(id) => setTab(id as MemoryTier)}
          tabs={TIER_ORDER.map((t) => ({
            id: t,
            label: MEMORY_TIER_LABELS[t],
            badge: (
              <span className="mono-num rounded-full bg-surface-line px-1.5 text-2xs text-ink-muted">
                {memories.filter((r) => r.tier === t).length}
              </span>
            ),
          }))}
        />
        <div className="flex items-center gap-3 pb-1 pt-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search titles, content, tags…"
            className="w-full max-w-md"
          />
          <span className="mono-num shrink-0 text-2xs text-ink-faint">{tierRows.length} shown</span>
        </div>
      </PageHeader>

      <div className="p-5">
        <Card>
          <CardHeader
            title={MEMORY_TIER_LABELS[tab]}
            subtitle={`${tierRows.length} record${tierRows.length === 1 ? '' : 's'}${q ? ` matching "${search.trim()}"` : ''}${live ? ' · local database' : ' · mock dataset'}`}
            actions={<Eye size={14} className="text-ink-faint" />}
          />
          <CardBody className="pt-1">
            {tierRows.length === 0 ? (
              <EmptyState
                icon={<History />}
                title={q ? 'No memories match your search' : `No ${MEMORY_TIER_LABELS[tab].toLowerCase()} yet`}
                description={
                  q
                    ? `Nothing in this tier mentions "${search.trim()}" in its title, content, or tags.`
                    : live
                      ? 'Nothing has been stored in this tier yet. The M3 memory service is what proposes new rows.'
                      : 'This tier is empty in the mock dataset. Real capture rules arrive with the M3 memory service.'
                }
                action={
                  q ? (
                    <Button variant="secondary" onClick={() => setSearch('')}>
                      Clear search
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="divide-y divide-surface-line">
                {tierRows.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-semibold text-ink-primary">{r.title}</p>
                        <Tooltip
                          content={
                            r.approval === 'pending'
                              ? 'Awaiting your approval before the engine would trust it'
                              : r.approval === 'approved'
                                ? 'Marked trustworthy in the local database'
                                : 'Dismissed — excluded from recall'
                          }
                          side="top"
                        >
                          <span>
                            <Badge tone={APPROVAL_TONE[r.approval]} dot>
                              {r.approval}
                            </Badge>
                          </span>
                        </Tooltip>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-muted">{r.content}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-faint">
                        <span className="flex items-center gap-1">
                          <Clock size={10} />
                          created {timeAgo(new Date(r.createdAt))} · updated {timeAgo(new Date(r.updatedAt))}
                        </span>
                        <span className="truncate">source: {r.source}</span>
                        <span className="flex flex-wrap gap-1">
                          {r.tags.map((t) => (
                            <span key={t} className="rounded border border-surface-line bg-surface-base px-1.5 py-0.5 text-ink-secondary">
                              {t}
                            </span>
                          ))}
                        </span>
                      </div>
                    </div>
                    <Menu
                      triggerLabel={`Actions for ${r.title}`}
                      trigger={
                        <span className="shrink-0 rounded p-1 text-ink-faint hover:text-ink-primary">
                          <MoreHorizontal size={14} />
                        </span>
                      }
                      items={rowMenu(r)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Edit modal */}
      <Modal
        open={editId !== null}
        onClose={() => setEditId(null)}
        title="Edit memory"
        subtitle={live ? 'Saved to the local database and recorded in the history timeline' : 'Browser-session edit — recorded in the in-memory history timeline'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditId(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={editInvalid} onClick={saveEdit}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            required
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            error={!editTitle.trim() ? 'Title is required' : null}
          />
          <Textarea
            label="Content"
            required
            rows={5}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            error={!editContent.trim() ? 'Content is required' : null}
          />
        </div>
      </Modal>

      {/* History modal */}
      <Modal
        open={historyRecord !== null}
        onClose={() => setHistoryId(null)}
        title={historyRecord ? `History — ${historyRecord.title}` : 'History'}
        subtitle={live ? 'Recorded event timeline from the local database' : 'Event timeline for this record (browser session)'}
      >
        {historyRecord && (
          <ol className="relative space-y-4 border-l border-surface-line pl-4">
            {historyRecord.history.map((ev, i) => (
              <li key={`${ev.ts}-${i}`} className="relative">
                <span
                  className={
                    'absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface-overlay ' +
                    {
                      ok: 'bg-state-ok',
                      warn: 'bg-state-warn',
                      err: 'bg-state-err',
                      info: 'bg-state-info',
                      idle: 'bg-state-idle',
                      accent: 'bg-accent',
                      violet: 'bg-violet',
                    }[EVENT_TONE[ev.action] ?? 'idle']
                  }
                />
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-semibold capitalize text-ink-primary">{ev.action}</span>
                  <span className="mono-num text-2xs text-ink-faint">
                    {timeAgo(new Date(ev.ts))} · {clockTime(new Date(ev.ts))}
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{ev.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteRecord !== null}
        title="Delete this memory?"
        message={
          <>
            <strong>{deleteRecord?.title}</strong> ({MEMORY_TIER_LABELS[deleteRecord?.tier ?? 'short']}) will be
            {live ? ' archived in the local database' : ' removed from this browser session'} along with its{' '}
            {deleteRecord?.history.length ?? 0}-event history. There is no undo.
          </>
        }
        confirmLabel="Delete memory"
        danger
        onCancel={() => setDeleteId(null)}
        onConfirm={removeRecord}
      />

      {/* Approve-all confirmation */}
      <ConfirmDialog
        open={approveAllOpen}
        title={`Approve ${pendingCount} pending memories?`}
        message={
          <>
            All {pendingCount} records marked <Badge tone="warn" dot>pending</Badge> will move to{' '}
            <Badge tone="ok" dot>approved</Badge> and gain a history event.{' '}
            {live
              ? 'They become eligible for the M3 recall path; today only the approval flag changes.'
              : 'This browser session only; nothing is written to disk.'}
          </>
        }
        confirmLabel="Approve all"
        onCancel={() => setApproveAllOpen(false)}
        onConfirm={approveAll}
      />
    </WorkArea>
  );
}
