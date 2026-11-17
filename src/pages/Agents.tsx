import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Bot,
  Code2,
  Copy,
  Eye,
  FileText,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  DemoNotice,
  EmptyState,
  Input,
  Menu,
  Modal,
  Select,
  StatusDot,
  Textarea,
  Toggle,
  Tooltip,
  useToast,
  type MenuItem,
  type Tone,
} from '../components/ui';
import { ContextPanelCard, KeyValue, PageHeader, WorkArea } from '../components/common/PageChrome';
import { MOCK_AGENTS } from '../data/agents';
import { MOCK_MODELS, modelById, modelName } from '../data/models';
import type { AgentDef, ModelRecord } from '../data/types';
import type { JobInfo } from '../contract/ipc';
import { resolveTransport } from '../contract/client';

/* ------------------------------------------------------------------ */
/* Helpers (page-local)                                                */
/* ------------------------------------------------------------------ */

let copySeq = 0;

const AGENT_ICONS: Record<string, ReactNode> = {
  sparkles: <Sparkles size={15} />,
  'code-2': <Code2 size={15} />,
  search: <Search size={15} />,
  'file-text': <FileText size={15} />,
  'bar-chart-3': <BarChart3 size={15} />,
  'user-round': <UserRound size={15} />,
  'shield-check': <ShieldCheck size={15} />,
};

function agentIcon(name: string): ReactNode {
  return AGENT_ICONS[name] ?? <Bot size={15} />;
}

function parseCapabilities(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => (seen.has(s.toLowerCase()) ? false : (seen.add(s.toLowerCase()), true)));
}

const modelSelectOptions = MOCK_MODELS.map((m) => ({ value: m.id, label: m.name }));

interface AgentForm {
  name: string;
  role: string;
  description: string;
  capabilities: string;
  modelId: string;
  instructions: string;
  enabled: boolean;
}

const emptyForm: AgentForm = {
  name: '',
  role: '',
  description: '',
  capabilities: '',
  modelId: MOCK_MODELS[0].id,
  instructions: '',
  enabled: true,
};

function formOf(a: AgentDef): AgentForm {
  return {
    name: a.name,
    role: a.role,
    description: a.description,
    capabilities: a.capabilities.join(', '),
    modelId: a.modelId,
    instructions: a.instructions,
    enabled: a.enabled,
  };
}

/* ------------------------------------------------------------------ */

export default function Agents() {
  const { toast } = useToast();
  const transport = useMemo(() => resolveTransport(), []);
  const live = transport.kind === 'tauri';
  const [agents, setAgents] = useState<AgentDef[]>(live ? [] : MOCK_AGENTS);
  const [liveModels, setLiveModels] = useState<ModelRecord[]>([]);
  const [loading, setLoading] = useState(live);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = create
  const [form, setForm] = useState<AgentForm>(emptyForm);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [plan, setPlan] = useState('');
  const [runJob, setRunJob] = useState<JobInfo | null>(null);
  const [runBusy, setRunBusy] = useState(false);

  /** Reload the roster the store holds. Every live mutation ends here. */
  const refresh = useCallback(async () => {
    if (!live) return;
    const [listed, models] = await Promise.all([
      transport.call('agent.list', {}),
      transport.call('model.list', { limit: 200 }),
    ]);
    if (listed.ok) setAgents(listed.data.items);
    else toast(`${listed.error.code}: ${listed.error.message}`, 'error');
    if (models.ok) setLiveModels(models.data.items);
    setLoading(false);
  }, [live, transport, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The Developer Agent's job, polled until it reaches a terminal state. A parked job
  // (waiting for approval) stays "queued"; the runner picks it up after the decision.
  useEffect(() => {
    if (!live || !runJob) return;
    if (runJob.status !== 'queued' && runJob.status !== 'running') return;
    const id = runJob.id;
    const timer = setInterval(() => {
      void (async () => {
        const got = await transport.call('job.get', { id });
        if (got.ok) setRunJob(got.data);
      })();
    }, 700);
    return () => clearInterval(timer);
  }, [live, runJob, transport]);

  const modelOptions = live
    ? liveModels.map((m) => ({ value: m.id, label: m.name + (m.installed ? '' : ' (not installed)') }))
    : modelSelectOptions;

  const modelLabel = (id: string) => {
    if (!live) return modelName(id);
    return liveModels.find((m) => m.id === id)?.name ?? (id || 'none assigned');
  };
  const modelInstalled = (id: string) => {
    if (!live) return modelById(id)?.installed ?? false;
    return liveModels.find((m) => m.id === id)?.installed ?? false;
  };

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? agents.filter(
            (a) =>
              a.name.toLowerCase().includes(q) ||
              a.role.toLowerCase().includes(q) ||
              a.description.toLowerCase().includes(q),
          )
        : agents,
    [agents, q],
  );

  const enabledCount = agents.filter((a) => a.enabled).length;
  const disabledCount = agents.length - enabledCount;

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      modelId: live ? liveModels[0]?.id ?? '' : emptyForm.modelId,
    });
    setFormOpen(true);
  };

  const openEdit = (a: AgentDef) => {
    setEditingId(a.id);
    setForm(formOf(a));
    setFormOpen(true);
  };

  const nameError = !form.name.trim() ? 'Name is required' : null;
  const instructionsError = !form.instructions.trim() ? 'Instructions are required' : null;
  const formValid = !nameError && !instructionsError;

  const saveForm = async () => {
    if (!formValid) return;
    const caps = parseCapabilities(form.capabilities);
    if (live) {
      const payload = {
        name: form.name.trim(),
        role: form.role.trim() || 'Custom agent',
        description: form.description.trim() || 'No description provided.',
        capabilities: caps,
        modelId: form.modelId,
        instructions: form.instructions.trim(),
        enabled: form.enabled,
      };
      const saved =
        editingId === null
          ? await transport.call('agent.create', payload)
          : await transport.call('agent.update', {
              id: editingId,
              patch: payload,
            });
      if (!saved.ok) {
        toast(`${saved.error.code}: ${saved.error.message}`, 'error');
        return;
      }
      if (editingId !== null) {
        const before = agents.find((a) => a.id === editingId);
        if (before && before.modelId !== form.modelId && form.modelId) {
          const assigned = await transport.call('agent.assignModel', {
            id: editingId,
            modelId: form.modelId,
          });
          if (!assigned.ok) toast(`${assigned.error.code}: ${assigned.error.message}`, 'error');
        }
        if (before && before.enabled !== form.enabled) {
          const toggled = await transport.call('agent.setEnabled', {
            id: editingId,
            enabled: form.enabled,
          });
          if (!toggled.ok) toast(`${toggled.error.code}: ${toggled.error.message}`, 'error');
        }
      } else if (!form.enabled && saved.ok) {
        const toggled = await transport.call('agent.setEnabled', {
          id: saved.data.id,
          enabled: false,
        });
        if (!toggled.ok) toast(`${toggled.error.code}: ${toggled.error.message}`, 'error');
      }
      setFormOpen(false);
      await refresh();
      toast(`Agent "${payload.name}" ${editingId === null ? 'created' : 'saved'} in the local database`, 'success');
      return;
    }
    if (editingId === null) {
      const created: AgentDef = {
        id: `custom-${Date.now()}`,
        name: form.name.trim(),
        role: form.role.trim() || 'Custom agent',
        description: form.description.trim() || 'No description provided.',
        capabilities: caps,
        modelId: form.modelId,
        instructions: form.instructions.trim(),
        enabled: form.enabled,
        builtIn: false,
        icon: 'sparkles',
        conversationsLast30d: 0,
      };
      setAgents((prev) => [created, ...prev]);
      toast('Agent created (prototype only)', 'success');
    } else {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === editingId
            ? {
                ...a,
                name: form.name.trim(),
                role: form.role.trim() || a.role,
                description: form.description.trim() || a.description,
                capabilities: caps,
                modelId: form.modelId,
                instructions: form.instructions.trim(),
                enabled: form.enabled,
              }
            : a,
        ),
      );
      toast('Agent updated (prototype only)', 'success');
    }
    setFormOpen(false);
  };

  const setEnabled = async (id: string, next: boolean) => {
    const agent = agents.find((a) => a.id === id);
    if (live) {
      const toggled = await transport.call('agent.setEnabled', { id, enabled: next });
      if (!toggled.ok) {
        toast(`${toggled.error.code}: ${toggled.error.message}`, 'error');
        return;
      }
      await refresh();
      toast(`Agent "${agent?.name ?? id}" ${next ? 'enabled' : 'disabled'} in the local database`, next ? 'success' : 'info');
      return;
    }
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: next } : a)));
    toast(`Agent "${agent?.name ?? id}" ${next ? 'enabled' : 'disabled'} (prototype state only)`, next ? 'success' : 'info');
  };

  const duplicate = async (a: AgentDef) => {
    if (live) {
      const made = await transport.call('agent.duplicate', { id: a.id });
      if (!made.ok) {
        toast(`${made.error.code}: ${made.error.message}`, 'error');
        return;
      }
      await refresh();
      toast(`Duplicated as "${made.data.name}"`, 'success');
      return;
    }
    copySeq += 1;
    const clone: AgentDef = {
      ...a,
      id: `${a.id}-copy-${Date.now()}-${copySeq}`,
      name: `${a.name} copy`,
      builtIn: false,
      conversationsLast30d: 0,
    };
    setAgents((prev) => {
      const idx = prev.findIndex((x) => x.id === a.id);
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
    toast(`Duplicated as "${clone.name}" (prototype only)`, 'success');
  };

  const runAgent = async (agentId: string) => {
    if (!live) {
      toast('Queueing a task needs the desktop core. This browser build has nowhere to run it.', 'info');
      return;
    }
    if (!plan.trim()) {
      toast('Write at least one plan line first; one line is one tool call.', 'warning');
      return;
    }
    setRunBusy(true);
    const queued = await transport.call('agent.run', { agentId, input: plan });
    setRunBusy(false);
    if (!queued.ok) {
      toast(`${queued.error.code}: ${queued.error.message}`, 'error');
      return;
    }
    setRunJob({
      id: queued.data.jobId,
      kind: 'agent_run',
      status: 'queued',
      progressPct: 0,
      createdAt: new Date().toISOString(),
      steps: [],
    });
    toast(`Task queued as ${queued.data.jobId}`, 'success');
  };

  const detailsAgent = detailsId ? agents.find((a) => a.id === detailsId) ?? null : null;

  return (
    <WorkArea
      contextPanel={
        <>
          <ContextPanelCard
            title="Agent platform status"
            actions={<StatusDot tone={enabledCount > 0 ? 'ok' : 'warn'} pulse />}
          >
            <div className="space-y-0.5">
              <KeyValue k="Total agents" v={String(agents.length)} mono />
              <KeyValue
                k="Enabled"
                v={
                  <span className="flex items-center gap-1.5">
                    <StatusDot tone="ok" /> {enabledCount}
                  </span>
                }
              />
              <KeyValue
                k="Disabled"
                v={
                  <span className="flex items-center gap-1.5">
                    <StatusDot tone="idle" /> {disabledCount}
                  </span>
                }
              />
              <KeyValue k="Matching search" v={String(filtered.length)} mono />
            </div>
            <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
              {live
                ? 'Every change here is written to the local database. Only the Developer Agent executes tasks, and only an explicit plan: one line is one tool call.'
                : 'Toggling, creating or duplicating only mutates prototype state — none of these definitions control a real runtime.'}
            </p>
          </ContextPanelCard>

          <ContextPanelCard title="Model assignments">
            <ul className="space-y-1.5">
              {agents.slice(0, 7).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-2xs text-ink-secondary">
                  <span className="min-w-0 truncate">{a.name}</span>
                  <span className="shrink-0 text-ink-faint">{modelInstalled(a.modelId) ? 'installed' : 'not installed'}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
              {live
                ? 'Read from the model catalogue the core scanned on this machine.'
                : 'No model weights are installed in Phase 1, so every assignment is pending.'}
            </p>
          </ContextPanelCard>
        </>
      }
    >
      <PageHeader
        title="Agent Management"
        description={
          live
            ? 'Agents stored in the local database. The Developer Agent runs an explicit plan — one line per tool call — under the same policy and approvals as any tool.'
            : 'Define, enable, and inspect the agents the platform will run once the engine arrives. These are visual prototypes, not live agents.'
        }
        notice={
          live ? undefined : (
            <DemoNotice text="All agents below are mock definitions rendered from prototype state — no agent process exists in Phase 1." />
          )
        }
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={openCreate}>
            New Agent
          </Button>
        }
      >
        <div className="flex items-center gap-3 pb-1">
          <div className="relative w-full max-w-md">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, role, or description…"
              aria-label="Search agents"
              className="field h-8 pl-8 pr-3 text-xs [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          <span className="mono-num shrink-0 text-2xs text-ink-faint">{filtered.length} shown</span>
        </div>
      </PageHeader>

      <div className="p-5">
        {live && loading && (
          <p className="mb-3 text-xs text-ink-faint">Loading agents from the local database…</p>
        )}
        {filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Bot />}
              title="No agents match your search"
              description={`Nothing in the ${live ? 'stored roster' : 'mock roster'} contains "${search.trim()}". Clear the search to see all ${agents.length} agents.`}
              action={
                <Button variant="secondary" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((a) => {
              const featured = a.id === 'universal';
              const installed = modelInstalled(a.modelId);
              const menuItems = [
                ...(a.builtIn
                  ? []
                  : [{ id: 'edit', label: 'Edit', icon: <Pencil />, onSelect: () => openEdit(a) }]),
                { id: 'details', label: 'View details', icon: <Eye />, onSelect: () => setDetailsId(a.id) },
                { id: 'duplicate', label: 'Duplicate', icon: <Copy />, onSelect: () => duplicate(a) },
                {
                  id: 'toggle',
                  label: a.enabled ? 'Disable' : 'Enable',
                  icon: a.enabled ? <ShieldCheck /> : <Sparkles />,
                  onSelect: () => setEnabled(a.id, !a.enabled),
                },
              ] satisfies MenuItem[];
              return (
                <Card
                  key={a.id}
                  className={
                    featured
                      ? 'ring-1 ring-accent/50 shadow-glow'
                      : undefined
                  }
                >
                  <CardHeader
                    title={
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={featured ? 'text-accent' : 'text-ink-faint'}>{agentIcon(a.icon)}</span>
                        <span className="min-w-0 truncate">{a.name}</span>
                        {featured && <Badge tone="accent">Main</Badge>}
                      </span>
                    }
                    subtitle={a.role}
                    actions={
                      <span className="flex items-center gap-2">
                        <Tooltip content={a.enabled ? 'Disable this agent' : 'Enable this agent'} side="left">
                          <span>
                            <Toggle
                              size="sm"
                              checked={a.enabled}
                              onChange={(v) => setEnabled(a.id, v)}
                              label={`Toggle ${a.name}`}
                            />
                          </span>
                        </Tooltip>
                        <Menu
                          triggerLabel={`Actions for ${a.name}`}
                          trigger={
                            <span role="presentation" className="rounded p-1 text-ink-faint hover:text-ink-primary">
                              <MoreHorizontal size={14} />
                            </span>
                          }
                          items={menuItems}
                        />
                      </span>
                    }
                  />
                  <CardBody className="space-y-3 pt-1">
                    <p className="line-clamp-2 text-xs leading-relaxed text-ink-muted">{a.description}</p>

                    <div className="flex flex-wrap gap-1.5">
                      {a.capabilities.map((c) => (
                        <span
                          key={c}
                          className="rounded-md border border-surface-line bg-surface-base px-1.5 py-0.5 text-2xs text-ink-secondary"
                        >
                          {c}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-surface-line pt-2.5">
                      <Tooltip
                        content={
                          installed
                            ? 'Model weights are present on this machine.'
                            : live
                              ? 'No screened weights for this assignment are installed.'
                              : 'Model assignment is visual only — no weights are installed in Phase 1.'
                        }
                        side="top"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 text-2xs text-ink-secondary">
                          <span className="truncate">{modelLabel(a.modelId)}</span>
                          {!installed && (
                            <Badge tone="warn" dot className="shrink-0">
                              not installed
                            </Badge>
                          )}
                        </span>
                      </Tooltip>
                      <span className="ml-auto shrink-0 text-right">
                        <span className="mono-num block text-sm font-bold text-ink-primary">{a.conversationsLast30d}</span>
                        <span className="block text-2xs text-ink-faint">convs / 30d</span>
                      </span>
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Edit agent' : 'New agent'}
        subtitle={
          live
            ? 'Written to the local database. Built-in agents keep their definition; duplicate one to make a variant.'
            : 'Stored in prototype state only — nothing is registered with a runtime.'
        }
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!formValid} onClick={saveForm}>
              {editingId ? 'Save changes' : 'Create agent'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              error={nameError}
              placeholder="e.g. Report Writer"
            />
            <Input
              label="Role"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              placeholder="e.g. Document generation"
            />
          </div>
          <Input
            label="Description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="What this agent is for, in one sentence."
            hint="Shown on the card; truncated to two lines in the grid."
          />
          <div>
            <Input
              label="Capabilities"
              value={form.capabilities}
              onChange={(e) => setForm((f) => ({ ...f, capabilities: e.target.value }))}
              placeholder="Comma-separated, e.g. Drafting, Summarization"
              hint="Rendered as chips live below as you type."
            />
            {parseCapabilities(form.capabilities).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {parseCapabilities(form.capabilities).map((c) => (
                  <span
                    key={c}
                    className="rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-2xs text-accent"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Select
            label="Assigned model"
            value={form.modelId}
            onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))}
            options={modelOptions}
            hint={
              live
                ? 'Stored as an assignment. Model-driven planning is M5; the Developer Agent runs an explicit plan.'
                : 'Assignment only — no model weights are installed in this prototype.'
            }
          />
          <Textarea
            label="System instructions"
            required
            rows={5}
            value={form.instructions}
            onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
            error={instructionsError}
            placeholder="You are…"
          />
          <Checkbox
            checked={form.enabled}
            onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            label="Agent is enabled immediately"
          />
        </div>
      </Modal>

      {/* Details modal */}
      <Modal
        open={detailsAgent !== null}
        onClose={() => setDetailsId(null)}
        title={detailsAgent?.name ?? 'Agent details'}
        subtitle={detailsAgent ? `${detailsAgent.role} · ${detailsAgent.builtIn ? 'Built-in' : 'Custom'}` : undefined}
        size="lg"
        footer={
          detailsAgent ? (
            <>
              <Button variant="ghost" onClick={() => setDetailsId(null)}>
                Close
              </Button>
              {!detailsAgent.builtIn && (
                <Button
                  variant="secondary"
                  icon={<Pencil size={13} />}
                  onClick={() => {
                    const a = detailsAgent;
                    setDetailsId(null);
                    openEdit(a);
                  }}
                >
                  Edit
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {detailsAgent && (
          <div className="space-y-4">
            <div>
              <p className="label">Description</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{detailsAgent.description}</p>
            </div>
            <div>
              <p className="label">System instructions</p>
              <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-card border border-surface-line bg-surface-base p-3 font-mono text-xs leading-relaxed text-ink-secondary">
                {detailsAgent.instructions}
              </pre>
            </div>
            <div>
              <p className="label">Capabilities</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {detailsAgent.capabilities.map((c) => (
                  <span
                    key={c}
                    className="rounded-md border border-surface-line bg-surface-base px-2 py-0.5 text-2xs text-ink-secondary"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-card border border-surface-line p-3">
              <KeyValue k="Assigned model" v={modelLabel(detailsAgent.modelId)} />
              <KeyValue
                k="Model status"
                v={
                  <Badge tone={(modelInstalled(detailsAgent.modelId) ? 'ok' : 'warn') as Tone} dot>
                    {modelInstalled(detailsAgent.modelId) ? 'installed' : 'not installed'}
                  </Badge>
                }
              />
              <KeyValue k="Enabled" v={detailsAgent.enabled ? 'yes' : 'no'} />
              <KeyValue k="Conversations (last 30d)" v={String(detailsAgent.conversationsLast30d)} mono />
            </div>

            {live && detailsAgent.id === 'developer-agent' && (
              <div className="rounded-card border border-accent/30 bg-accent/5 p-3">
                <p className="label">Run a plan</p>
                <p className="mt-1 text-2xs leading-relaxed text-ink-muted">
                  One line is one tool call: <span className="font-mono">fs.list &lt;path&gt;</span>,{' '}
                  <span className="font-mono">fs.read &quot;&lt;path&gt;&quot;</span>,{' '}
                  <span className="font-mono">fs.write &lt;path&gt; | &lt;content&gt;</span>,{' '}
                  <span className="font-mono">python.run | &lt;code&gt;</span>,{' '}
                  <span className="font-mono">powershell.run | &lt;script&gt;</span>. Paths must be inside a watched
                  Knowledge folder; writes and processes wait for your approval.
                </p>
                <Textarea
                  className="mt-2"
                  rows={4}
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  placeholder={'fs.list D:/notes\n# comments and blank lines are ignored'}
                  aria-label="Developer Agent plan"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Play size={13} />}
                    disabled={runBusy || !plan.trim() || !detailsAgent.enabled}
                    onClick={() => void runAgent(detailsAgent.id)}
                  >
                    Queue task
                  </Button>
                  {!detailsAgent.enabled && (
                    <span className="text-2xs text-state-warn">Enable the agent first.</span>
                  )}
                </div>
                {runJob && (
                  <div className="mt-3 space-y-2 border-t border-accent/20 pt-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-2xs">
                      <span className="mono-num text-ink-faint">{runJob.id}</span>
                      <Badge
                        tone={
                          runJob.status === 'success'
                            ? 'ok'
                            : runJob.status === 'failure'
                              ? 'err'
                              : runJob.status === 'running'
                                ? 'info'
                                : 'idle'
                        }
                        dot
                      >
                        {runJob.status === 'queued' ? 'queued / waiting' : runJob.status}
                      </Badge>
                    </div>
                    {runJob.steps.length > 0 && (
                      <ul className="space-y-1">
                        {runJob.steps.map((step) => (
                          <li key={step.idx} className="flex items-start gap-2 text-2xs">
                            <span className="mono-num text-ink-faint">{step.idx + 1}.</span>
                            <span className="font-mono text-ink-secondary">{step.toolId}</span>
                            <span
                              className={
                                step.status === 'success'
                                  ? 'text-state-ok'
                                  : step.status === 'failure' || step.status === 'denied'
                                    ? 'text-state-err'
                                    : 'text-ink-faint'
                              }
                            >
                              {step.status}
                            </span>
                            {(step.error ?? step.output) && (
                              <span className="min-w-0 truncate text-ink-faint" title={step.error ?? step.output}>
                                {step.error ?? step.output}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {runJob.error && (
                      <p className="text-2xs leading-relaxed text-state-err">{runJob.error}</p>
                    )}
                    {runJob.status === 'queued' && (
                      <p className="text-2xs text-ink-faint">
                        A step that needs approval is waiting in the Activity Center. Approving it resumes this job.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </WorkArea>
  );
}
