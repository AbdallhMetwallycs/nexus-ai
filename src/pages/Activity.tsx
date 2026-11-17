import { useEffect, useMemo, useState } from 'react';import {
  AlertTriangle,
  ChevronDown,
  ClipboardList,
  Cpu,
  Download,
  Filter,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DemoNotice,
  EmptyState,
  Meter,
  SearchInput,
  StatusDot,
  Tabs,
  Tooltip,
  useToast,
  type Tone,
} from '../components/ui';
import { ContextPanelCard, KeyValue, PageHeader, WorkArea } from '../components/common/PageChrome';
import type { ActivityEvent as CoreActivityEvent, PendingApproval } from '../contract/ipc';
import { resolveTransport } from '../contract/client';
import { MOCK_ACTIVITY } from '../data/activity';
import { agentById } from '../data/agents';
import type { ActivityEvent, ActivityKind } from '../data/types';
import { clockTime, cn, timeAgo } from '../lib/utils';

/* ------------------------------------------------------------------ */
/* Page-local data additions                                           */
/* ------------------------------------------------------------------ */

/** Two pending approval prompts that exercise the Approve/Reject flow. */
const PENDING_APPROVALS: ActivityEvent[] = [
  {
    id: 'act-p1',
    ts: new Date(Date.now() - 3 * 60_000).toISOString(),
    kind: 'approval',
    title: 'Approval requested: web fetch developer.mozilla.org',
    detail:
      'Research Agent wants one page (web-fetch). Allow-list only is on and this domain is allowed. Nothing is fetched in Phase 1 — this records your decision in prototype state.',
    agentId: 'researcher',
    status: 'pending',
  },
  {
    id: 'act-p2',
    ts: new Date(Date.now() - 7 * 60_000).toISOString(),
    kind: 'approval',
    title: 'Approval requested: store memory "Prefers concise replies"',
    detail:
      'Universal Agent proposes a preference memory from this session. Product principle: memory writes require explicit approval.',
    agentId: 'universal',
    status: 'pending',
  },
];

const ALL_EVENTS: ActivityEvent[] = [...PENDING_APPROVALS, ...MOCK_ACTIVITY];

/* ------------------------------------------------------------------ */
/* Mappings                                                            */
/* ------------------------------------------------------------------ */

type FilterId = 'all' | ActivityKind;

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'task', label: 'Tasks' },
  { id: 'tool', label: 'Tool runs' },
  { id: 'model', label: 'Model' },
  { id: 'error', label: 'Errors' },
  { id: 'warning', label: 'Warnings' },
  { id: 'approval', label: 'Approvals' },
];

function kindIcon(kind: ActivityKind) {
  const cls = 'h-3.5 w-3.5';
  switch (kind) {
    case 'task':
      return <ClipboardList size={14} className={cn(cls, 'text-ink-muted')} />;
    case 'tool':
      return <Wrench size={14} className={cn(cls, 'text-accent')} />;
    case 'model':
      return <Cpu size={14} className={cn(cls, 'text-violet')} />;
    case 'error':
      return <XCircle size={14} className={cn(cls, 'text-state-err')} />;
    case 'warning':
      return <AlertTriangle size={14} className={cn(cls, 'text-state-warn')} />;
    case 'approval':
      return <ShieldCheck size={14} className={cn(cls, 'text-state-ok')} />;
  }
}

const KIND_TONE: Record<ActivityKind, Tone> = {
  task: 'idle',
  tool: 'info',
  model: 'accent',
  error: 'err',
  warning: 'warn',
  approval: 'violet',
};

function statusTone(status: ActivityEvent['status']): Tone {
  switch (status) {
    case 'success':
      return 'ok';
    case 'failure':
      return 'err';
    case 'pending':
      return 'warn';
    case 'running':
      return 'info';
  }
}

/* ------------------------------------------------------------------ */

export default function Activity() {
  const { toast } = useToast();
  const transport = useMemo(() => resolveTransport(), []);
  const live = transport.kind === 'tauri';
  const [events, setEvents] = useState<ActivityEvent[]>(live ? [] : ALL_EVENTS);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(live);
  const [filter, setFilter] = useState<FilterId>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Live: the Activity Center reads the rows the core wrote, not a mock list.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void (async () => {
      const [listed, waiting] = await Promise.all([
        transport.call('activity.list', { limit: 200 }),
        transport.call('approval.pending'),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (!listed.ok) {
        toast(`${listed.error.code}: ${listed.error.message}`, 'error');
      } else {
        setEvents(
          listed.data.items.map((e: CoreActivityEvent) => ({
            id: e.id,
            ts: e.ts,
            kind: e.kind as ActivityKind,
            title: e.title,
            detail: e.detail,
            agentId: e.agentId,
            status: e.status,
          })),
        );
      }
      if (waiting.ok) setPending(waiting.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [live, transport, toast]);

  /**
   * What the timeline shows: recorded rows, plus one row per *decision still to make*.
   * The recorded "Approval requested" rows are filtered out while their approval is
   * still pending so the queue has exactly one row per decision, carrying its real id.
   */
  const rows = useMemo<ActivityEvent[]>(() => {
    if (!live) return events;
    const synthetic: ActivityEvent[] = pending.map((p) => ({
      id: p.id,
      ts: p.createdAt,
      kind: 'approval',
      title: `Approval requested: ${p.summary}`,
      detail: p.detail ?? 'No further detail was recorded.',
      agentId: p.requestedBy.agentId,
      status: 'pending',
    }));
    return [
      ...synthetic,
      ...events.filter((e) => !(e.kind === 'approval' && e.status === 'pending')),
    ];
  }, [events, live, pending]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length };
    for (const e of rows) map[e.kind] = (map[e.kind] ?? 0) + 1;
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((e) => {
      if (filter !== 'all' && e.kind !== filter) return false;
      if (!q) return true;
      return e.title.toLowerCase().includes(q) || e.detail.toLowerCase().includes(q);
    });
  }, [rows, filter, search]);

  const filtersActive = filter !== 'all' || search.trim() !== '';

  const decide = async (id: string, approved: boolean, scope?: 'once' | 'always') => {
    if (live) {
      const decided = await transport.call('approval.decide', {
        id,
        approved,
        ...(approved ? { scope: scope ?? 'once' } : {}),
      });
      if (!decided.ok) {
        toast(`${decided.error.code}: ${decided.error.message}`, 'error');
        return;
      }
      // Re-read both tables: the decision is a recorded fact, not local state.
      const [listed, waiting] = await Promise.all([
        transport.call('activity.list', { limit: 200 }),
        transport.call('approval.pending'),
      ]);
      if (listed.ok) {
        setEvents(
          listed.data.items.map((e: CoreActivityEvent) => ({
            id: e.id,
            ts: e.ts,
            kind: e.kind as ActivityKind,
            title: e.title,
            detail: e.detail,
            agentId: e.agentId,
            status: e.status,
          })),
        );
      }
      if (waiting.ok) setPending(waiting.data);
      toast(
        approved
          ? `Approved${scope === 'always' ? ' for every future call' : ' this once'}; the waiting job resumes.`
          : 'Rejected; the job stopped and the reason is in its activity row.',
        approved ? 'success' : 'warning',
      );
      return;
    }
    setEvents((prev) =>
      prev.map((e) =>
        e.id === id
          ? { ...e, status: approved ? 'success' : 'failure', detail: `${e.detail} — ${approved ? 'approved' : 'rejected'} in this session` }
          : e,
      ),
    );
    toast('Approval recorded in this browser session only', approved ? 'success' : 'warning');
  };

  const today = {
    tasks: rows.filter((e) => e.kind === 'task').length,
    tools: rows.filter((e) => e.kind === 'tool').length,
    errors: rows.filter((e) => e.kind === 'error').length,
    warnings: rows.filter((e) => e.kind === 'warning').length,
  };
  const failureRate = Math.round(
    (rows.filter((e) => e.status === 'failure').length / Math.max(1, rows.length)) * 100,
  );

  return (
    <WorkArea
      contextPanel={
        <>
          <ContextPanelCard title={live ? 'Today (recorded)' : 'Today (simulated)'}>
            <div className="space-y-0.5">
              <KeyValue k="Tasks" v={`${today.tasks} runs`} />
              <KeyValue k="Tool runs" v={`${today.tools} invocations`} />
              <KeyValue k="Errors" v={`${today.errors} recorded`} />
              <KeyValue k="Warnings" v={`${today.warnings} advisory`} />
            </div>
            <p className="mt-2 text-2xs text-ink-faint">
              {live ? 'Read from the activity table in the local database.' : 'Derived from the mock event list on this screen.'}
            </p>
          </ContextPanelCard>

          <ContextPanelCard title="Reliability">
            <Meter
              label={live ? 'Error rate (recorded)' : 'Error rate (mock)'}
              value={failureRate}
              detail={`${failureRate}% of ${live ? 'recorded' : 'simulated'} events`}
              tone="auto"
            />
            <p className="mt-2.5 text-2xs leading-relaxed text-ink-faint">
              {live
                ? 'Computed from the rows the core wrote; no engine reports these numbers separately.'
                : 'No real logging exists in the browser demo — nothing is written to disk and no engine reports these numbers.'}
            </p>
          </ContextPanelCard>
        </>
      }
    >
      <PageHeader
        title="Activity Center"
        description={
          live
            ? 'Every action the core and its dispatcher recorded, newest first, from the local database.'
            : 'Everything the agents and tools would have done, as a simulated timeline. Newest events first.'
        }
        notice={
          live ? undefined : (
            <DemoNotice text="This is an in-memory mock log — it is cleared on reload and never written anywhere." />
          )
        }
        actions={
          <>
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Filter size={13} />}
                onClick={() => {
                  setFilter('all');
                  setSearch('');
                  toast('Filters cleared', 'info');
                }}
              >
                Clear filters
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<Download size={13} />}
              onClick={() => {
                if (!live) {
                  toast('Export needs the desktop build; the browser demo has no database behind this list', 'warning');
                  return;
                }
                void (async () => {
                  const result = await transport.call('activity.export', { format: 'json' });
                  if (!result.ok) {
                    toast(`${result.error.code}: ${result.error.message}`, 'error');
                    return;
                  }
                  toast(`Exported ${result.data.events} events to ${result.data.path}`, 'success');
                })();
              }}
            >
              {live ? 'Export log' : 'Export log (simulated)'}
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            variant="pill"
            active={filter}
            onChange={(id) => setFilter(id as FilterId)}
            tabs={FILTERS.map((f) => ({
              id: f.id,
              label: f.label,
              badge: (
                <span className="mono-num rounded-full bg-surface-line/70 px-1.5 text-2xs text-ink-muted">
                  {counts[f.id] ?? 0}
                </span>
              ),
            }))}
          />
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search title or detail…"
            className="ml-auto w-[220px]"
          />
        </div>
      </PageHeader>

      <div className="space-y-4 p-5">
        <Card>
          <CardHeader
            title="Timeline"
            subtitle={`${filtered.length} event${filtered.length === 1 ? '' : 's'} · click a row for details and actions`}
          />
          <CardBody className="pt-1">
            {filtered.length === 0 ? (
              <EmptyState
                icon={<Filter />}
                title={
                  live && loading
                    ? 'Reading the local database'
                    : `No ${filter === 'all' ? 'matching ' : `${filter} `}events`
                }
                description={
                  live
                    ? loading
                      ? 'The activity table is being read.'
                      : 'The database has no activity yet. Load a model or send a message and come back.'
                    : search.trim()
                      ? `Nothing in this filter matches "${search.trim()}". Try a different search or clear the filters.`
                      : 'The mock dataset has no events of this kind. Try another filter.'
                }
                action={
                  filtersActive ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setFilter('all');
                        setSearch('');
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="relative">
                {/* vertical connector rail */}
                <span aria-hidden className="absolute bottom-3 left-[23px] top-3 w-px bg-surface-line" />
                <ul className="relative">
                  {filtered.map((e) => {
                    const expanded = expandedId === e.id;
                    const agent = e.agentId ? agentById(e.agentId) : undefined;
                    return (
                      <li key={e.id} className="border-b border-surface-line/60 last:border-b-0">
                        <div className="flex gap-3 py-1">
                          <span
                            aria-hidden
                            className={cn(
                              'z-10 mt-[18px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-surface-line bg-surface-overlay',
                              e.kind === 'error' && 'border-state-err/40',
                              e.kind === 'warning' && 'border-state-warn/40',
                              e.kind === 'approval' && 'border-state-ok/40',
                            )}
                          >
                            {kindIcon(e.kind)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              aria-expanded={expanded}
                              onClick={() => setExpandedId(expanded ? null : e.id)}
                              className="group flex w-full items-start justify-between gap-3 rounded-md py-2 pr-1 text-left hover:bg-surface-line/30"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <StatusDot tone={statusTone(e.status)} pulse={e.status === 'running'} />
                                  <span
                                    className={cn(
                                      'truncate text-xs font-medium',
                                      e.status === 'failure' ? 'text-state-err' : 'text-ink-primary',
                                    )}
                                  >
                                    {e.title}
                                  </span>
                                  <Badge tone={KIND_TONE[e.kind]}>{e.kind}</Badge>
                                </span>
                                <span className="mt-0.5 block truncate text-2xs text-ink-faint">
                                  {agent ? `${agent.name} · ` : ''}
                                  {e.detail}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-center gap-2 pt-0.5">
                                <Tooltip content={new Date(e.ts).toLocaleString()} side="left" delay={300}>
                                  <span className="mono-num text-right text-2xs text-ink-faint">
                                    {timeAgo(new Date(e.ts))}
                                    <span className="block">{clockTime(new Date(e.ts))}</span>
                                  </span>
                                </Tooltip>
                                <ChevronDown
                                  size={14}
                                  className={cn(
                                    'text-ink-faint transition-transform',
                                    expanded && 'rotate-180',
                                  )}
                                />
                              </span>
                            </button>

                            {expanded && (
                              <div className="mb-3 animate-fade-in rounded-card border border-surface-line bg-surface-base p-3.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge tone={statusTone(e.status)} dot pulse={e.status === 'running'}>
                                    {e.status}
                                  </Badge>
                                  <Badge tone={KIND_TONE[e.kind]}>{e.kind}</Badge>
                                  <span className="mono-num text-2xs text-ink-faint">
                                    {new Date(e.ts).toLocaleString()}
                                  </span>
                                </div>
                                <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{e.detail}</p>
                                {agent && (
                                  <p className="mt-1 text-2xs text-ink-muted">
                                    Agent: <span className="text-ink-secondary">{agent.name}</span> · role: {agent.role}
                                  </p>
                                )}
                                <p className="label mt-3">{live ? 'Stored log record' : 'Simulated log record'}</p>
                                <pre className="overflow-x-auto rounded-md border border-surface-line bg-surface-raised p-3 text-2xs leading-relaxed text-ink-secondary">
                                  <code>{JSON.stringify({ id: e.id, ts: e.ts, kind: e.kind, status: e.status }, null, 2)}</code>
                                </pre>
                                {e.kind === 'approval' && e.status === 'pending' && (
                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <Button variant="primary" size="sm" onClick={() => void decide(e.id, true)}>
                                      Approve once
                                    </Button>
                                    {live && (
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => void decide(e.id, true, 'always')}
                                      >
                                        Always allow
                                      </Button>
                                    )}
                                    <Button variant="danger" size="sm" onClick={() => void decide(e.id, false)}>
                                      Reject
                                    </Button>
                                    <span className="text-2xs text-ink-faint">
                                      {live
                                        ? 'Nothing runs until this is decided; an unanswered request expires after 5 minutes and counts as a denial.'
                                        : 'Decision updates this screen only — no action is performed.'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </WorkArea>
  );
}
