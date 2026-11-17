import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
  Wrench,
  Zap,
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
  Tabs,
  Textarea,
  Toggle,
  Tooltip,
  useToast,
  type MenuItem,
} from '../components/ui';
import { ContextPanelCard, KeyValue, PageHeader, WorkArea } from '../components/common/PageChrome';
import { MOCK_SKILLS, MOCK_TOOLS, TOOL_CATEGORIES } from '../data/tools';
import type { CustomSkill, ToolDef, ToolStatus } from '../data/types';
import type { ToolGrantInfo } from '../contract/ipc';
import { resolveTransport } from '../contract/client';
import { timeAgo } from '../lib/utils';

/* ------------------------------------------------------------------ */
/* Badge helpers                                                       */
/* ------------------------------------------------------------------ */

function statusBadge(status: ToolStatus) {
  switch (status) {
    case 'ready':
      return (
        <Badge tone="ok" dot>
          ready
        </Badge>
      );
    case 'disabled':
      return (
        <Badge tone="idle" dot>
          disabled
        </Badge>
      );
    case 'error':
      return (
        <Badge tone="err" dot>
          error
        </Badge>
      );
    case 'running':
      return (
        <Badge tone="info" dot pulse>
          running
        </Badge>
      );
    default:
      return null;
  }
}

function approvalBadge(needsApproval: boolean) {
  return needsApproval ? <Badge tone="warn">approval required</Badge> : <Badge tone="idle">auto</Badge>;
}

/* ------------------------------------------------------------------ */

interface SkillFormState {
  open: boolean;
  skill: CustomSkill | null;
}

let skillSeq = 100;

export default function Tools() {
  const { toast } = useToast();
  const transport = useMemo(() => resolveTransport(), []);
  const live = transport.kind === 'tauri';
  const [tab, setTab] = useState<'tools' | 'skills'>('tools');
  const [tools, setTools] = useState<ToolDef[]>(live ? [] : MOCK_TOOLS);
  const [skills, setSkills] = useState<CustomSkill[]>(MOCK_SKILLS);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(live);

  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [detailsGrant, setDetailsGrant] = useState<ToolGrantInfo | null>(null);
  const [skillForm, setSkillForm] = useState<SkillFormState>({ open: false, skill: null });
  const [skillDelete, setSkillDelete] = useState<CustomSkill | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  /** Reload the catalogue the store holds. Every live mutation ends here. */
  const refresh = useCallback(async () => {
    if (!live) return;
    const listed = await transport.call('tool.list', {});
    setLoading(false);
    if (!listed.ok) {
      toast(`${listed.error.code}: ${listed.error.message}`, 'error');
      return;
    }
    setTools(listed.data.items);
  }, [live, transport, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const categories = useMemo(
    () =>
      live
        ? [...new Set(tools.map((t) => t.category))].sort((a, b) => a.localeCompare(b))
        : TOOL_CATEGORIES,
    [live, tools],
  );

  const filteredTools = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tools.filter(
      (t) =>
        (categoryFilter === '' || t.category === categoryFilter) &&
        (q === '' ||
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)),
    );
  }, [tools, search, categoryFilter]);

  const groupedByCategory = useMemo(() => {
    const order = categories.filter((c) => filteredTools.some((t) => t.category === c));
    return order.map((category) => ({
      category,
      items: filteredTools.filter((t) => t.category === category),
    }));
  }, [categories, filteredTools]);

  const filteredSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.trigger.toLowerCase().includes(q) || s.steps.some((x) => x.toLowerCase().includes(q)),
    );
  }, [skills, search]);

  const setToolStatus = (id: string, status: ToolStatus) =>
    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));

  const toggleTool = async (t: ToolDef) => {
    if (t.status === 'error') {
      toast(`"${t.name}" is in an error state${t.lastRun ? ` — last run ${t.lastRun}` : ''}; fix it before enabling.`, 'warning');
      return;
    }
    const nextEnabled = !t.enabled;
    if (live) {
      const set = await transport.call('tool.setEnabled', { id: t.id, enabled: nextEnabled });
      if (!set.ok) {
        toast(`${set.error.code}: ${set.error.message}`, 'error');
        return;
      }
      await refresh();
      toast(`${t.name} ${nextEnabled ? 'enabled' : 'disabled'} in the local database`, 'success');
      return;
    }
    setTools((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, enabled: nextEnabled, status: nextEnabled ? 'ready' : 'disabled' } : x)),
    );
    toast(`${t.name} ${nextEnabled ? 'enabled' : 'disabled'} (prototype state — nothing runs)`, 'success');
  };

  const runTest = async (t: ToolDef) => {
    if (t.status === 'error') {
      toast(`"${t.name}" is in an error state — cannot run a test`, 'warning');
      return;
    }
    if (live) {
      if (!t.enabled) {
        toast(`Enable ${t.name} before running a test.`, 'warning');
        return;
      }
      const queued = await transport.call('tool.testRun', { id: t.id });
      if (!queued.ok) {
        toast(`${queued.error.code}: ${queued.error.message}`, 'error');
        return;
      }
      toast(
        `Test queued as ${queued.data.jobId}. ${t.needsApproval ? 'It waits for your approval in the Activity Center.' : 'Watch the Activity Center for the result.'}`,
        'success',
      );
      return;
    }
    setToolStatus(t.id, 'running');
    later(() => {
      setToolStatus(t.id, 'ready');
      toast('Simulated run completed — no real command executed', 'success');
    }, 1500);
  };

  const openDetails = async (id: string) => {
    setDetailsId(id);
    setDetailsGrant(null);
    if (!live) return;
    const grant = await transport.call('tool.grants', { id });
    if (grant.ok) setDetailsGrant(grant.data);
    else toast(`${grant.error.code}: ${grant.error.message}`, 'error');
  };

  const setGrant = async (id: string, permission: string, scope: 'once' | 'always' | 'never') => {
    const set = await transport.call('tool.setGrant', { id, permission, scope });
    if (!set.ok) {
      toast(`${set.error.code}: ${set.error.message}`, 'error');
      return;
    }
    const grant = await transport.call('tool.grants', { id });
    if (grant.ok) setDetailsGrant(grant.data);
    toast(
      scope === 'never'
        ? 'Standing grant removed; the next call asks again.'
        : `Standing grant saved: ${permission} is ${scope === 'always' ? 'allowed without asking' : 'allowed once'}.`,
      'success',
    );
  };

  const detailsTool = tools.find((t) => t.id === detailsId) ?? null;
  const approvalRequiredCount = tools.filter((t) => t.needsApproval).length;
  const autoCount = tools.filter((t) => !t.needsApproval).length;

  const openSkillForm = (skill: CustomSkill | null) => setSkillForm({ open: true, skill });

  /* ------------------------------------------------------------------ */

  return (
    <WorkArea
      contextPanel={
        <>
          <ContextPanelCard title="Security model">
            <div className="mb-2 flex items-center gap-2 text-xs text-ink-secondary">
              <ShieldCheck size={14} className="shrink-0 text-accent" />
              <span>Approval gating</span>
            </div>
            <p className="mb-2 text-2xs leading-relaxed text-ink-muted">
              Tools flagged <strong>approval required</strong> cannot act until a human confirms the call
              {live ? ' in the Activity Center' : ' in Phase 2'}. Auto tools cover read-only operations.
            </p>
            <div className="space-y-0.5">
              <KeyValue k="Approval-required tools" v={String(approvalRequiredCount)} mono />
              <KeyValue k="Auto tools" v={String(autoCount)} mono />
              <KeyValue k="Enabled now" v={String(tools.filter((t) => t.enabled).length)} mono />
            </div>
            <p className="mt-3 rounded-field border border-surface-line bg-surface-base px-2.5 py-2 text-2xs leading-relaxed text-ink-faint">
              <Wrench size={11} className="mr-1 inline text-ink-faint" />
              {live
                ? 'Runs happen only inside a watched Knowledge folder. Writes and processes wait for your approval in the Activity Center.'
                : 'No commands are executed. Enable, disable and test-run only change in-memory state.'}
            </p>
          </ContextPanelCard>

          <ContextPanelCard title="Categories">
            <ul className="space-y-1">
              {categories.map((c) => {
                const n = tools.filter((t) => t.category === c).length;
                return (
                  <li key={c} className="flex items-center justify-between gap-2 text-xs">
                    <button
                      onClick={() => {
                        setCategoryFilter((cur) => (cur === c ? '' : c));
                        setTab('tools');
                      }}
                      className={
                        'truncate text-left hover:text-accent ' +
                        (categoryFilter === c ? 'text-accent' : 'text-ink-secondary')
                      }
                    >
                      {c}
                    </button>
                    <span className="mono-num shrink-0 text-ink-faint">{n}</span>
                  </li>
                );
              })}
            </ul>
          </ContextPanelCard>
        </>
      }
    >
      <PageHeader
        title="Tools & Skills"
        description={
          live
            ? 'The tool catalogue the core executes: filesystem access inside watched Knowledge folders, plus short Python and PowerShell runs. Every call passes policy and, where required, your approval.'
            : 'Review agent tool permissions, enable/disable them and author custom skills. All execution is disabled in Phase 1 — nothing here runs a real command.'
        }
        notice={
          live ? undefined : <DemoNotice text="Tools show simulated status; no commands are executed." />
        }
        actions={
          tab === 'skills' ? (
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => openSkillForm(null)}>
              Create skill
            </Button>
          ) : null
        }
      >
        <Tabs
          active={tab}
          onChange={(id) => setTab(id as 'tools' | 'skills')}
          tabs={[
            { id: 'tools', label: 'Tools', badge: <span className="mono-num text-2xs text-ink-faint">{tools.length}</span> },
            {
              id: 'skills',
              label: 'Custom Skills',
              badge: <span className="mono-num text-2xs text-ink-faint">{skills.length}</span>,
            },
          ]}
        />
      </PageHeader>

      {tab === 'tools' ? (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search tools by name, description or category…" className="w-[320px]" />
            <Select
              aria-label="Filter by category"
              className="h-8 w-[200px] text-xs"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              placeholder="All categories"
              options={categories.map((c) => ({ value: c, label: c }))}
            />
          </div>

          {live && loading && (
            <p className="text-xs text-ink-faint">Reading the tool catalogue from the local database…</p>
          )}

          {filteredTools.length === 0 ? (
            <EmptyState title="No tools match" description="Try a different search term or category." className="py-10" />
          ) : (
            groupedByCategory.map((group) => (
              <Card key={group.category}>
                <div className="flex items-center justify-between border-b border-surface-line px-4 py-2.5">
                  <h3 className="text-2xs font-bold uppercase tracking-widest text-ink-muted">{group.category}</h3>
                  <span className="mono-num text-2xs text-ink-faint">{group.items.length} tools</span>
                </div>
                <ul className="divide-y divide-surface-line">
                  {group.items.map((t) => (
                    <li key={t.id} className={'flex items-start gap-3 px-4 py-3 ' + (t.status === 'disabled' ? 'opacity-60' : '')}>
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-surface-line bg-surface-base text-accent">
                        <Zap size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button onClick={() => void openDetails(t.id)} className="text-xs font-semibold text-ink-primary hover:text-accent">
                            {t.name}
                          </button>
                          <span className="mono-num rounded bg-surface-line/40 px-1.5 py-0.5 text-2xs text-ink-faint">v{t.version}</span>
                          {statusBadge(t.status)}
                          {approvalBadge(t.needsApproval)}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{t.description}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {t.permissions.map((p) => (
                            <span key={p} className="mono-num rounded border border-surface-line bg-surface-base px-1.5 py-0.5 text-2xs text-ink-secondary">
                              {p}
                            </span>
                          ))}
                        </div>
                        <p className="mt-1 flex items-center gap-1 text-2xs text-ink-faint">
                          <Clock size={10} /> {t.lastRun ?? (live ? 'never run on this machine' : 'never run (simulated)')}
                          {live && t.status === 'error' && t.lastError ? ` — ${t.lastError}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Tooltip
                          content={t.status === 'error' ? 'Simulated fault — toggle disabled' : t.enabled ? 'Disable tool' : 'Enable tool'}
                          side="left"
                        >
                          <Toggle
                            checked={t.enabled}
                            disabled={t.status === 'error'}
                            onChange={() => toggleTool(t)}
                            label={`Toggle ${t.name}`}
                            size="sm"
                          />
                        </Tooltip>
                        <Menu
                          triggerLabel={`Actions for ${t.name}`}
                          trigger={
                            <span className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint hover:text-ink-primary">
                              <MoreHorizontal size={15} />
                            </span>
                          }
                          items={
                            [
                              {
                                id: 'test',
                                label: live ? 'Run test' : 'Run test (simulated)',
                                icon: <Play />,
                                onSelect: () => void runTest(t),
                              },
                              { id: 'details', label: 'Details', onSelect: () => void openDetails(t.id) },
                            ] satisfies MenuItem[]
                          }
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-4 p-5">
          {live && <DemoNotice text="Custom skills are still prototype state — the skill.* commands are not implemented. Creating or editing a skill changes this screen only." />}
          <SearchInput value={search} onChange={setSearch} placeholder="Search skills by name, trigger or steps…" className="w-[320px]" />
          {filteredSkills.length === 0 ? (
            <EmptyState
              title="No skills yet"
              description="Create a skill to describe a repeatable multi-step workflow the agents can follow."
              action={
                <Button variant="primary" icon={<Plus size={14} />} onClick={() => openSkillForm(null)}>
                  Create skill
                </Button>
              }
              className="py-10"
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredSkills.map((s) => (
                <Card key={s.id}>
                  <div className="flex items-start justify-between gap-2 border-b border-surface-line px-4 pb-2.5 pt-3.5">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-ink-primary">{s.name}</h3>
                      <p className="mt-0.5 flex items-center gap-1 text-2xs text-ink-faint">
                        <Clock size={10} /> updated {timeAgo(new Date(s.updatedAt))}
                      </p>
                    </div>
                    <Menu
                      triggerLabel={`Actions for ${s.name}`}
                      trigger={
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:text-ink-primary">
                          <MoreHorizontal size={15} />
                        </span>
                      }
                      items={
                        [
                          { id: 'edit', label: 'Edit', icon: <Pencil />, onSelect: () => openSkillForm(s) },
                          { id: 'del', label: 'Delete', danger: true, icon: <Trash2 />, onSelect: () => setSkillDelete(s) },
                        ] satisfies MenuItem[]
                      }
                    />
                  </div>
                  <div className="space-y-3 p-4">
                    <div>
                      <p className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Trigger</p>
                      <p className="mt-1 rounded-field border border-accent/20 bg-accent/5 px-2.5 py-1.5 text-xs leading-relaxed text-ink-secondary">
                        {s.trigger}
                      </p>
                    </div>
                    <div>
                      <p className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Steps</p>
                      <ol className="mt-1.5 space-y-1.5">
                        {s.steps.map((step, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-ink-secondary">
                            <span className="mono-num mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface-line/60 text-2xs text-ink-muted">
                              {i + 1}
                            </span>
                            <span className="leading-relaxed">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <ToolDetailsModal
        tool={detailsTool}
        live={live}
        grant={detailsGrant}
        onSetGrant={(permission, scope) => void setGrant(detailsTool!.id, permission, scope)}
        onClose={() => {
          setDetailsId(null);
          setDetailsGrant(null);
        }}
        onRunTest={detailsTool ? () => void runTest(detailsTool) : undefined}
      />

      <SkillFormModal
        open={skillForm.open}
        initial={skillForm.skill}
        onClose={() => setSkillForm({ open: false, skill: null })}
        onSave={(draft) => {
          if (draft.id) {
            setSkills((prev) =>
              prev.map((s) => (s.id === draft.id ? { ...s, name: draft.name, trigger: draft.trigger, steps: draft.steps, updatedAt: new Date().toISOString() } : s)),
            );
            toast(`Skill "${draft.name}" updated (prototype state only)`, 'success');
          } else {
            const created: CustomSkill = { ...draft, id: `skill-new-${++skillSeq}`, updatedAt: new Date().toISOString() };
            setSkills((prev) => [created, ...prev]);
            toast('Skill stored in prototype state only', 'success');
          }
          setSkillForm({ open: false, skill: null });
        }}
      />

      <ConfirmDialog
        open={skillDelete !== null}
        title="Delete skill?"
        message={
          <>
            <strong>{skillDelete?.name}</strong> will be removed from the prototype skill list. This cannot be undone
            (simulated).
          </>
        }
        confirmLabel="Delete skill"
        danger
        onCancel={() => setSkillDelete(null)}
        onConfirm={() => {
          if (skillDelete) {
            setSkills((prev) => prev.filter((s) => s.id !== skillDelete.id));
            toast('Skill removed from prototype state', 'success');
          }
          setSkillDelete(null);
        }}
      />
    </WorkArea>
  );
}

/* ================================================================== */
/* Tool details modal                                                  */
/* ================================================================== */

function ToolDetailsModal({
  tool,
  live,
  grant,
  onSetGrant,
  onClose,
  onRunTest,
}: {
  tool: ToolDef | null;
  live: boolean;
  grant: ToolGrantInfo | null;
  onSetGrant: (permission: string, scope: 'once' | 'always' | 'never') => void;
  onClose: () => void;
  onRunTest?: () => void;
}) {
  const scopeOf = (permission: string) =>
    grant?.standing.find((s) => s.permission === permission)?.scope ?? '';
  return (
    <Modal
      open={tool !== null}
      onClose={onClose}
      title={tool ? `${tool.name} — details` : 'Details'}
      subtitle={tool ? `${tool.category} · v${tool.version}` : undefined}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {onRunTest && (
            <Button variant="secondary" icon={<Play size={14} />} onClick={onRunTest}>
              {live ? 'Run test' : 'Run test (simulated)'}
            </Button>
          )}
        </>
      }
    >
      {tool && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(tool.status)}
            {approvalBadge(tool.needsApproval)}
            <span className="mono-num rounded bg-surface-line/40 px-1.5 py-0.5 text-2xs text-ink-faint">v{tool.version}</span>
          </div>

          <p className="text-sm leading-relaxed text-ink-secondary">{tool.description}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-2xs font-bold uppercase tracking-widest text-ink-muted">Permissions</p>
              <ul className="space-y-1">
                {tool.permissions.map((p) => (
                  <li key={p} className="mono-num flex items-center gap-2 rounded border border-surface-line bg-surface-base px-2 py-1 text-2xs text-ink-secondary">
                    <ShieldCheck size={11} className="text-accent" />
                    {p}
                  </li>
                ))}
              </ul>
              {live && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-2xs font-bold uppercase tracking-widest text-ink-muted">Standing grant</p>
                  {tool.permissions.map((p) => (
                    <label key={p} className="flex items-center justify-between gap-2 text-2xs text-ink-secondary">
                      <span className="mono-num">{p}</span>
                      <select
                        aria-label={`Standing grant for ${p}`}
                        className="field h-7 px-1.5 text-2xs"
                        value={scopeOf(p)}
                        onChange={(e) => onSetGrant(p, e.target.value as 'once' | 'always' | 'never')}
                      >
                        <option value="">ask each time</option>
                        <option value="always">always allow</option>
                        <option value="once">allow once</option>
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-2xs font-bold uppercase tracking-widest text-ink-muted">
                {live ? 'Recorded state' : 'Status history (fake)'}
              </p>
              <ul className="space-y-1.5">
                <li className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-ink-secondary">Last run</span>
                  <span className="mono-num text-ink-faint">{tool.lastRun ?? 'never'}</span>
                </li>
                <li className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-ink-secondary">Enabled</span>
                  <span className="text-ink-faint">{tool.enabled ? 'yes' : 'no'}</span>
                </li>
                <li className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-ink-secondary">Approval</span>
                  <span className="text-ink-faint">{tool.needsApproval ? 'per call' : 'not required'}</span>
                </li>
                {live && tool.lastError && (
                  <li className="mt-2 rounded-field border border-state-err/30 bg-state-err/5 px-2.5 py-2 text-2xs leading-relaxed text-state-err">
                    {tool.lastError}
                  </li>
                )}
                {!live && (
                  <li className="mt-2 rounded-field border border-surface-line bg-surface-base px-2.5 py-2 text-2xs leading-relaxed text-ink-faint">
                    execution is disabled in Phase 1
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ================================================================== */
/* Skill form modal                                                    */
/* ================================================================== */

function SkillFormModal({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: CustomSkill | null;
  onClose: () => void;
  onSave: (skill: Pick<CustomSkill, 'id' | 'name' | 'trigger' | 'steps'>) => void;
}) {
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('');
  const [stepsText, setStepsText] = useState('');

  // sync when opening for edit/create
  const key = `${open}-${initial?.id ?? 'new'}`;
  const [lastKey, setLastKey] = useState('');
  if (open && lastKey !== key) {
    setLastKey(key);
    setName(initial?.name ?? '');
    setTrigger(initial?.trigger ?? '');
    setStepsText(initial?.steps.join('\n') ?? '');
  }

  const steps = stepsText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const nameError = name.trim() === '' ? 'Name is required' : null;
  const triggerError = trigger.trim() === '' ? 'Trigger is required' : null;
  const stepsError = steps.length === 0 ? 'Add at least one step (one per line)' : null;
  const valid = !nameError && !triggerError && !stepsError;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit skill' : 'Create skill'}
      subtitle="Skills are stored in prototype state only"
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
              onSave({ id: initial?.id ?? '', name: name.trim(), trigger: trigger.trim(), steps });
            }}
          >
            {initial ? 'Save changes' : 'Create skill'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={name ? nameError : null} required />
        <Input
          label="Trigger"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          error={trigger ? triggerError : null}
          placeholder="When … happens"
          required
        />
        <Textarea
          label="Steps"
          value={stepsText}
          onChange={(e) => setStepsText(e.target.value)}
          error={stepsText.length > 0 ? stepsError : null}
          rows={5}
          placeholder={'One step per line\nParse each PDF\nExtract vendor and amount'}
          hint={`${steps.length} step(s) — one per line`}
          required
        />
      </div>
    </Modal>
  );
}
