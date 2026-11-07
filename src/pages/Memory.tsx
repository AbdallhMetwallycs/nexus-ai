import { useMemo, useState } from 'react';
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
  const [memories, setMemories] = useState<MemoryRecord[]>(MOCK_MEMORIES);
  const [tab, setTab] = useState<MemoryTier>('short');
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [approveAllOpen, setApproveAllOpen] = useState(false);

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
  const historyRecord = historyId ? memories.find((r) => r.id === historyId) ?? null : null;
  const deleteRecord = deleteId ? memories.find((r) => r.id === deleteId) ?? null : null;

  const patch = (id: string, fn: (r: MemoryRecord) => MemoryRecord) =>
    setMemories((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));

  const openEdit = (r: MemoryRecord) => {
    setEditId(r.id);
    setEditTitle(r.title);
    setEditContent(r.content);
  };

  const saveEdit = () => {
    if (!editId || !editTitle.trim() || !editContent.trim()) return;
    patch(editId, (r) => ({
      ...r,
      title: editTitle.trim(),
      content: editContent.trim(),
      updatedAt: nowIso(),
      history: [...r.history, { ts: nowIso(), action: 'edited', detail: 'Edited in Memory Center (prototype action).' }],
    }));
    setEditId(null);
    toast('Memory updated (prototype only)', 'success');
  };

  const setApproval = (id: string, approval: 'approved' | 'rejected', detail: string) => {
    patch(id, (r) => ({
      ...r,
      approval,
      updatedAt: nowIso(),
      history: [...r.history, { ts: nowIso(), action: approval, detail }],
    }));
    toast(
      approval === 'approved' ? 'Memory approved (prototype state only)' : 'Memory rejected (prototype state only)',
      approval === 'approved' ? 'success' : 'info',
    );
  };

  const approveAll = () => {
    const ts = nowIso();
    setMemories((prev) =>
      prev.map((r) =>
        r.approval === 'pending'
          ? {
              ...r,
              approval: 'approved',
              updatedAt: ts,
              history: [...r.history, { ts, action: 'approved', detail: 'Bulk-approved from Memory Center header.' }],
            }
          : r,
      ),
    );
    setApproveAllOpen(false);
    toast(`${pendingCount} pending memories approved (prototype only)`, 'success');
  };

  const removeRecord = () => {
    if (!deleteRecord) return;
    setMemories((prev) => prev.filter((r) => r.id !== deleteRecord.id));
    setDeleteId(null);
    toast('Memory deleted from prototype state — nothing persists anyway', 'info');
  };

  const editInvalid = editId !== null && (!editTitle.trim() || !editContent.trim());

  const rowMenu = (r: MemoryRecord): MenuItem[] => [
    { id: 'edit', label: 'Edit', icon: <Pencil />, onSelect: () => openEdit(r) },
    ...(r.approval === 'pending'
      ? ([
          { id: 'approve', label: 'Approve', icon: <Check />, onSelect: () => setApproval(r.id, 'approved', 'Approved via row menu (prototype action).') },
          { id: 'reject', label: 'Reject', icon: <X />, onSelect: () => setApproval(r.id, 'rejected', 'Rejected via row menu (prototype action).') },
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
              Every record here is fictional demo data. Edits, approvals and deletions live in React state only —
              nothing persists across restarts in Phase 1.
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
        description="Review, approve, and edit the memories the platform would keep about you. Approvals are prototype actions on mock data."
        notice={<DemoNotice text="All memories are fictional demo content — this prototype reads and writes React state only." />}
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
            subtitle={`${tierRows.length} record${tierRows.length === 1 ? '' : 's'}${q ? ` matching "${search.trim()}"` : ''} · mock dataset`}
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
                    : 'This tier is empty in the mock dataset. Real capture rules arrive with the Phase 2 backend.'
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
                                ? 'Marked trustworthy in this prototype'
                                : 'Dismissed — would be excluded from recall'
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
        subtitle="Prototype edit — saved to React state and recorded in the history timeline"
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
        subtitle="Event timeline for this record (mock + prototype actions)"
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
            removed from prototype state along with its {deleteRecord?.history.length ?? 0}-event history. There is no
            undo — though nothing persists across restarts anyway.
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
            <Badge tone="ok" dot>approved</Badge> and gain a history event. In Phase 2 this would grant the engine
            permission to use them; here it only mutates prototype state.
          </>
        }
        confirmLabel="Approve all"
        onCancel={() => setApproveAllOpen(false)}
        onConfirm={approveAll}
      />
    </WorkArea>
  );
}
