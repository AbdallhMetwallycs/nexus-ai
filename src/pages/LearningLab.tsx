import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  CircleSlash,
  FlaskConical,
  GitBranch,
  History,
  ListChecks,
  Lightbulb,
  Microscope,
  Plus,
  Radar,
  ScrollText,
  SearchCheck,
  ShieldCheck,
  Tags,
  UserCheck,
  UserRound,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  DemoNotice,
  EmptyState,
  Input,
  Modal,
  Select,
  Tabs,
  Textarea,
  useToast,
  type Tone,
} from '../components/ui';
import { ContextPanelCard, KeyValue, PageHeader, WorkArea } from '../components/common/PageChrome';
import { LEARNING_MODE_EXPLAINER, MOCK_INSTRUCTION_VERSIONS, MOCK_LEARNING_EVENTS } from '../data/learning';
import type { InstructionVersion, LearningEvent, LearningKind, SuggestionKind, SuggestionStatus } from '../data/types';
import { timeAgo } from '../lib/utils';

/* ------------------------------------------------------------------ */
/* Badge / chip helpers                                                */
/* ------------------------------------------------------------------ */

const KIND_TONE: Record<LearningKind, Tone> = { correction: 'violet', mistake: 'warn', error: 'err' };

const SEVERITY_CLASS: Record<LearningEvent['severity'], string> = {
  low: 'text-ink-secondary',
  medium: 'text-state-warn',
  high: 'text-state-err',
};

const SUGGESTION_TONE: Record<SuggestionStatus, Tone> = {
  proposed: 'info',
  approved: 'accent',
  rejected: 'idle',
  applied: 'ok',
};

const SUGGESTION_ICON: Record<SuggestionKind, React.ReactNode> = {
  instruction: <ScrollText size={13} />,
  memory: <Brain size={13} />,
  skill: <Lightbulb size={13} />,
  test: <FlaskConical size={13} />,
};

const PIPELINE = [
  { label: 'User correction', icon: <UserRound size={14} /> },
  { label: 'Detection', icon: <Radar size={14} /> },
  { label: 'Classification', icon: <Tags size={14} /> },
  { label: 'Root cause', icon: <Microscope size={14} /> },
  { label: 'Suggestions', icon: <Lightbulb size={14} /> },
  { label: 'Approval', icon: <UserCheck size={14} /> },
  { label: 'Apply / Version', icon: <GitBranch size={14} /> },
];

let eventSeq = 100;

/* ------------------------------------------------------------------ */

export default function LearningLab() {
  const { toast } = useToast();
  const [events, setEvents] = useState<LearningEvent[]>(MOCK_LEARNING_EVENTS);
  const [versions, setVersions] = useState<InstructionVersion[]>(MOCK_INSTRUCTION_VERSIONS);
  const [statusTab, setStatusTab] = useState<'all' | 'open' | 'resolved'>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [rollback, setRollback] = useState<InstructionVersion | null>(null);
  const [regressionAdded, setRegressionAdded] = useState<Set<string>>(() => new Set());

  const visibleEvents = useMemo(() => {
    if (statusTab === 'open') return events.filter((e) => !e.resolved);
    if (statusTab === 'resolved') return events.filter((e) => e.resolved);
    return events;
  }, [events, statusTab]);

  const stats = useMemo(() => {
    const all = events.flatMap((e) => e.suggestions);
    return {
      open: events.filter((e) => !e.resolved).length,
      resolved: events.filter((e) => e.resolved).length,
      pending: all.filter((s) => s.status === 'proposed').length,
      approved: all.filter((s) => s.status === 'approved').length,
    };
  }, [events]);

  const setSuggestionStatus = (eventId: string, suggestionId: string, status: SuggestionStatus) =>
    setEvents((prev) =>
      prev.map((e) =>
        e.id === eventId ? { ...e, suggestions: e.suggestions.map((s) => (s.id === suggestionId ? { ...s, status } : s)) } : e,
      ),
    );

  const approveSuggestion = (event: LearningEvent, suggestion: LearningEvent['suggestions'][number]) => {
    setSuggestionStatus(event.id, suggestion.id, 'approved');
    if (suggestion.kind === 'instruction') {
      toast('Queued into instruction versioning (simulated)', 'success');
    } else {
      toast(`Suggestion approved (prototype state — ${suggestion.kind})`, 'success');
    }
  };

  const rejectSuggestion = (event: LearningEvent, suggestion: LearningEvent['suggestions'][number]) => {
    setSuggestionStatus(event.id, suggestion.id, 'rejected');
    toast('Suggestion rejected — nothing changed', 'info');
  };

  const toggleRegression = (suggestionId: string, text: string) => {
    setRegressionAdded((prev) => {
      const next = new Set(prev);
      if (next.has(suggestionId)) {
        next.delete(suggestionId);
        toast('Removed from regression suite (simulated)', 'info');
      } else {
        next.add(suggestionId);
        toast('Added to regression suite (simulated)', 'success');
      }
      return next;
    });
    void text;
  };

  const confirmRollback = (version: InstructionVersion) => {
    setVersions((prev) =>
      prev.map((v) => {
        if (v.version === version.version) return { ...v, status: 'current' };
        if (v.status === 'current') return { ...v, status: 'history' };
        return v;
      }),
    );
    setRollback(null);
    toast('Instruction version switched (prototype state)', 'success');
  };

  const detailEvent = events.find((e) => e.id === detailId) ?? null;

  return (
    <WorkArea
      contextPanel={
        <>
          <ContextPanelCard title="Learning pipeline">
            <div className="space-y-0.5">
              <KeyValue k="Events open" v={String(stats.open)} mono />
              <KeyValue k="Events resolved" v={String(stats.resolved)} mono />
              <KeyValue k="Suggestions pending" v={String(stats.pending)} mono />
              <KeyValue k="Suggestions approved" v={String(stats.approved)} mono />
            </div>
          </ContextPanelCard>

          <ContextPanelCard title="How learning works here">
            <p className="text-2xs leading-relaxed text-ink-muted">
              The model does <strong className="text-ink-secondary">not</strong> learn automatically. The platform improves
              via memory + instructions <strong className="text-ink-secondary">with your approval</strong>. Nothing is
              written to model weights.
            </p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 rounded-field border border-accent/20 bg-accent/5 px-2.5 py-1.5 text-2xs text-ink-secondary">
                <ShieldCheck size={13} className="shrink-0 text-accent" /> Every change is gated by approval
              </div>
              <div className="flex items-center gap-2 rounded-field border border-surface-line bg-surface-base px-2.5 py-1.5 text-2xs text-ink-secondary">
                <GitBranch size={13} className="shrink-0 text-violet" /> Instruction edits are versioned &amp; reversible
              </div>
            </div>
          </ContextPanelCard>
        </>
      }
    >
      <PageHeader
        title="Learning Lab"
        description="The platform's differentiator: corrections and mistakes become classified events with root-cause analysis and approval-gated improvements — never silent model retraining."
        notice={<DemoNotice text="All events, suggestions and version changes are simulated prototype state." />}
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setLogOpen(true)}>
            Log manual correction
          </Button>
        }
      >
        <Tabs
          active={statusTab}
          onChange={(id) => setStatusTab(id as 'all' | 'open' | 'resolved')}
          tabs={[
            { id: 'all', label: 'All', badge: <span className="mono-num text-2xs text-ink-faint">{events.length}</span> },
            { id: 'open', label: 'Open', badge: <span className="mono-num text-2xs text-ink-faint">{stats.open}</span> },
            { id: 'resolved', label: 'Resolved', badge: <span className="mono-num text-2xs text-ink-faint">{stats.resolved}</span> },
          ]}
        />
      </PageHeader>

      <div className="space-y-5 p-5">
        {/* Explainer row */}
        <div className="grid gap-4 lg:grid-cols-3">
          {LEARNING_MODE_EXPLAINER.map((mode) => {
            const isFineTune = mode.name === 'Model fine-tuning';
            return (
              <Card key={mode.name} className={isFineTune ? 'border-dashed opacity-90' : undefined}>
                <CardBody>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink-primary">{mode.name}</h3>
                    {isFineTune && <Badge tone="idle">not automatic</Badge>}
                  </div>
                  <p className="mt-1 text-2xs font-medium uppercase tracking-widest text-ink-faint">{mode.who}</p>
                  <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{mode.what}</p>
                  <div className="mt-3 space-y-1.5 border-t border-surface-line pt-2.5">
                    <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-ink-muted">
                      <ListChecks size={12} className="mt-0.5 shrink-0 text-ink-faint" /> {mode.cost}
                    </p>
                    <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-ink-muted">
                      <SearchCheck size={12} className="mt-0.5 shrink-0 text-ink-faint" /> {mode.note}
                    </p>
                  </div>
                  {isFineTune && (
                    <p className="mt-2 rounded-field border border-violet/25 bg-violet/10 px-2.5 py-1.5 text-2xs leading-relaxed text-violet">
                      Out of scope for this platform&apos;s auto-behavior — fine-tuning is always a separate, explicit,
                      user-initiated operation.
                    </p>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>

        {/* Pipeline flow strip */}
        <Card>
          <CardBody>
            <div className="mb-3 flex items-center gap-2">
              <History size={14} className="text-ink-faint" />
              <h3 className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Improvement pipeline</h3>
            </div>
            <div className="flex flex-wrap items-center gap-y-3">
              {PIPELINE.map((step, i) => (
                <div key={step.label} className="flex items-center">
                  <div className="flex min-w-[92px] flex-col items-center gap-1.5 rounded-card border border-surface-line bg-surface-base px-3 py-2.5 text-center">
                    <span className="text-accent">{step.icon}</span>
                    <span className="text-2xs font-medium leading-tight text-ink-secondary">{step.label}</span>
                  </div>
                  {i < PIPELINE.length - 1 && <ArrowRight size={15} className="mx-1 shrink-0 text-ink-faint" />}
                </div>
              ))}
            </div>
            <p className="mt-2 text-2xs text-ink-faint">
              Static diagram — the pipeline is illustrative; each stage is simulated in the prototype only.
            </p>
          </CardBody>
        </Card>

        {/* Event list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Learning events</h3>
            <span className="mono-num text-2xs text-ink-faint">{visibleEvents.length} shown</span>
          </div>

          {visibleEvents.length === 0 ? (
            <EmptyState
              title={`No ${statusTab === 'all' ? '' : statusTab + ' '}events`}
              description="Log a manual correction or switch the filter to see more."
              className="py-10"
            />
          ) : (
            visibleEvents.map((event) => (
              <LearningEventCard
                key={event.id}
                event={event}
                onOpen={() => setDetailId(event.id)}
                onApprove={(s) => approveSuggestion(event, s)}
                onReject={(s) => rejectSuggestion(event, s)}
              />
            ))
          )}
        </div>

        {/* Version history */}
        <Card>
          <CardBody>
            <div className="mb-3 flex items-center gap-2">
              <GitBranch size={14} className="text-ink-faint" />
              <h3 className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Instruction version history</h3>
            </div>
            <ol className="relative space-y-3 border-l border-surface-line pl-5">
              {versions.map((v) => (
                <li key={v.version} className="relative">
                  <span
                    className={
                      'absolute -left-[26px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border ' +
                      (v.status === 'current' ? 'border-state-ok bg-state-ok/30' : 'border-surface-line bg-surface-base')
                    }
                  />
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="mono-num text-xs font-bold text-ink-primary">{v.version}</span>
                        {v.status === 'current' && (
                          <Badge tone="ok" dot>
                            current
                          </Badge>
                        )}
                        <span className="mono-num text-2xs text-ink-faint">{timeAgo(new Date(v.ts))}</span>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{v.summary}</p>
                    </div>
                    {v.status !== 'current' && (
                      <Button size="xs" variant="outline" icon={<History size={12} />} onClick={() => setRollback(v)}>
                        Rollback to this version
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>

      <LearningDetailModal
        event={detailEvent}
        onClose={() => setDetailId(null)}
        onApprove={(s) => detailEvent && approveSuggestion(detailEvent, s)}
        onReject={(s) => detailEvent && rejectSuggestion(detailEvent, s)}
        regressionAdded={regressionAdded}
        toggleRegression={toggleRegression}
      />

      <LogCorrectionModal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        onSave={(draft) => {
          const created: LearningEvent = {
            id: `learn-new-${++eventSeq}`,
            kind: 'correction',
            title: draft.title,
            detail: draft.detail,
            severity: draft.severity,
            category: draft.category || 'Uncategorized',
            rootCause: 'No automated root-cause analysis for manually logged corrections.',
            suggestions: [],
            ts: new Date().toISOString(),
            resolved: false,
          };
          setEvents((prev) => [created, ...prev]);
          setLogOpen(false);
          toast('Manual correction logged (prototype state only)', 'success');
        }}
      />

      <ConfirmDialog
        open={rollback !== null}
        title="Rollback instruction version?"
        message={
          <>
            Switching the active instruction set to <strong className="mono-num">{rollback?.version}</strong> will mark{' '}
            <strong>{versions.find((v) => v.status === 'current')?.version}</strong> as history. This is a simulated
            prototype action.
          </>
        }
        confirmLabel="Rollback"
        onCancel={() => setRollback(null)}
        onConfirm={() => rollback && confirmRollback(rollback)}
      />
    </WorkArea>
  );
}

/* ================================================================== */
/* Event card                                                          */
/* ================================================================== */

function LearningEventCard({
  event,
  onOpen,
  onApprove,
  onReject,
}: {
  event: LearningEvent;
  onOpen: () => void;
  onApprove: (s: LearningEvent['suggestions'][number]) => void;
  onReject: (s: LearningEvent['suggestions'][number]) => void;
}) {
  const pending = event.suggestions.filter((s) => s.status === 'proposed');
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={KIND_TONE[event.kind]} dot>
            {event.kind}
          </Badge>
          <button onClick={onOpen} className="text-sm font-semibold text-ink-primary hover:text-accent">
            {event.title}
          </button>
          <span className="ml-auto mono-num text-2xs text-ink-faint">{timeAgo(new Date(event.ts))}</span>
          {event.resolved ? (
            <Badge tone="ok">
              <CheckCircle2 size={11} /> resolved
            </Badge>
          ) : (
            <Badge tone="warn">open</Badge>
          )}
        </div>

        <p className="text-xs leading-relaxed text-ink-secondary">{event.detail}</p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-surface-line bg-surface-base px-2 py-0.5">
            <span className={'text-2xs font-medium uppercase tracking-wider ' + SEVERITY_CLASS[event.severity]}>
              {event.severity}
            </span>
          </span>
          <Badge tone="idle">{event.category}</Badge>
        </div>

        <div className="rounded-card border border-violet/20 bg-violet/5 p-3">
          <p className="text-2xs font-bold uppercase tracking-widest text-violet">Root cause analysis</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{event.rootCause}</p>
        </div>

        {event.suggestions.length > 0 ? (
          <div className="space-y-2">
            <p className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Suggestions</p>
            {event.suggestions.map((s) => (
              <div key={s.id} className="flex items-start gap-2.5 rounded-field border border-surface-line bg-surface-base px-3 py-2">
                <span className="mt-0.5 shrink-0 text-accent">{SUGGESTION_ICON[s.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs leading-relaxed text-ink-secondary">{s.text}</span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="text-2xs uppercase tracking-wider text-ink-faint">{s.kind}</span>
                    <Badge tone={SUGGESTION_TONE[s.status]}>{s.status}</Badge>
                  </span>
                </span>
                {s.status === 'proposed' && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Button size="xs" variant="primary" onClick={() => onApprove(s)}>
                      Approve
                    </Button>
                    <Button size="xs" variant="ghost" icon={<X size={12} />} onClick={() => onReject(s)}>
                      Reject
                    </Button>
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-2xs italic text-ink-faint">No suggestions generated for this logged correction.</p>
        )}

        <div className="flex items-center justify-between border-t border-surface-line pt-2.5">
          <p className="text-2xs text-ink-faint">{pending.length} pending approval</p>
          <Button size="xs" variant="ghost" onClick={onOpen}>
            Open full workflow <ArrowRight size={12} />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ================================================================== */
/* Detail modal                                                        */
/* ================================================================== */

function LearningDetailModal({
  event,
  onClose,
  onApprove,
  onReject,
  regressionAdded,
  toggleRegression,
}: {
  event: LearningEvent | null;
  onClose: () => void;
  onApprove: (s: LearningEvent['suggestions'][number]) => void;
  onReject: (s: LearningEvent['suggestions'][number]) => void;
  regressionAdded: Set<string>;
  toggleRegression: (id: string, text: string) => void;
}) {
  const tests = event ? event.suggestions.filter((s) => s.kind === 'test') : [];
  const others = event ? event.suggestions.filter((s) => s.kind !== 'test') : [];

  return (
    <Modal
      open={event !== null}
      onClose={onClose}
      title={event?.title}
      subtitle={event ? `${event.kind} · ${timeAgo(new Date(event.ts))}` : undefined}
      size="xl"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {event && (
        <div className="space-y-5">
          {/* Classification */}
          <section>
            <SectionTitle icon={<Tags size={13} />} text="Classification" />
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={KIND_TONE[event.kind]} dot>
                {event.kind}
              </Badge>
              <span className="rounded-full border border-surface-line bg-surface-base px-2.5 py-0.5 text-2xs font-medium uppercase tracking-wider text-ink-secondary">
                severity: {event.severity}
              </span>
              <Badge tone="idle">{event.category}</Badge>
              {event.resolved ? <Badge tone="ok">resolved</Badge> : <Badge tone="warn">open</Badge>}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{event.detail}</p>
          </section>

          {/* Root cause */}
          <section>
            <SectionTitle icon={<Microscope size={13} />} text="Root cause" />
            <div className="rounded-card border border-violet/20 bg-violet/5 p-3 text-xs leading-relaxed text-ink-secondary">
              {event.rootCause}
            </div>
          </section>

          {/* Suggestions */}
          <section>
            <SectionTitle icon={<Lightbulb size={13} />} text="Suggestions & actions" />
            {event.suggestions.length === 0 ? (
              <p className="text-2xs italic text-ink-faint">No suggestions generated for this logged correction.</p>
            ) : (
              <ul className="space-y-2">
                {others.map((s) => (
                  <li key={s.id} className="flex items-start gap-2.5 rounded-field border border-surface-line bg-surface-base px-3 py-2">
                    <span className="mt-0.5 shrink-0 text-accent">{SUGGESTION_ICON[s.kind]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs leading-relaxed text-ink-secondary">{s.text}</span>
                      <span className="mt-1 flex items-center gap-2">
                        <span className="text-2xs uppercase tracking-wider text-ink-faint">{s.kind}</span>
                        <Badge tone={SUGGESTION_TONE[s.status]}>{s.status}</Badge>
                      </span>
                    </span>
                    {s.status === 'proposed' && (
                      <span className="flex shrink-0 items-center gap-1.5">
                        <Button size="xs" variant="primary" onClick={() => onApprove(s)}>
                          Approve
                        </Button>
                        <Button size="xs" variant="ghost" icon={<X size={12} />} onClick={() => onReject(s)}>
                          Reject
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Regression tests */}
          <section>
            <SectionTitle icon={<FlaskConical size={13} />} text="Linked regression tests" />
            {tests.length === 0 ? (
              <p className="text-2xs italic text-ink-faint">No regression tests linked to this event.</p>
            ) : (
              <ul className="space-y-2">
                {tests.map((s) => {
                  const added = regressionAdded.has(s.id);
                  return (
                    <li key={s.id} className="flex items-start gap-2.5 rounded-field border border-surface-line bg-surface-base px-3 py-2">
                      <span className={'mt-0.5 shrink-0 ' + (added ? 'text-state-ok' : 'text-ink-faint')}>
                        {added ? <CheckCircle2 size={14} /> : <CircleSlash size={14} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs leading-relaxed text-ink-secondary">{s.text}</span>
                        <span className="mt-1 flex items-center gap-2">
                          <Badge tone={SUGGESTION_TONE[s.status]}>{s.status}</Badge>
                          {added && <Badge tone="ok">in suite</Badge>}
                        </span>
                      </span>
                      <Button size="xs" variant={added ? 'ghost' : 'outline'} onClick={() => toggleRegression(s.id, s.text)}>
                        {added ? 'Remove from suite' : 'Add to regression suite'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function SectionTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <span className="text-ink-faint">{icon}</span>
      <h4 className="text-2xs font-bold uppercase tracking-widest text-ink-muted">{text}</h4>
    </div>
  );
}

/* ================================================================== */
/* Log manual correction modal                                         */
/* ================================================================== */

function LogCorrectionModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (draft: { title: string; detail: string; severity: LearningEvent['severity']; category: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [severity, setSeverity] = useState<LearningEvent['severity']>('medium');
  const [category, setCategory] = useState('');

  const titleError = title.trim() === '' ? 'Title is required' : null;
  const detailError = detail.trim() === '' ? 'Detail is required' : null;
  const valid = title.trim() !== '' && detail.trim() !== '';

  const reset = () => {
    setTitle('');
    setDetail('');
    setSeverity('medium');
    setCategory('');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log manual correction"
      subtitle="Adds an event card with no suggestions — approvals are simulated"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              if (!valid) return;
              onSave({ title: title.trim(), detail: detail.trim(), severity, category: category.trim() });
              reset();
            }}
          >
            Log correction
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={title ? titleError : null} required />
        <Textarea
          label="Detail"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          error={detail ? detailError : null}
          rows={4}
          placeholder="What happened and what the correct behavior should be…"
          required
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as LearningEvent['severity'])}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
          />
          <Input label="Category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Hardware facts" hint="Optional" />
        </div>
      </div>
    </Modal>
  );
}
