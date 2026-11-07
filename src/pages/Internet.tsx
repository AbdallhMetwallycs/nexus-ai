import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Globe, MoreHorizontal, Plus, RefreshCw, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
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
  LoadingState,
  Menu,
  Modal,
  Select,
  StatusDot,
  Toggle,
  Tooltip,
  useToast,
  type MenuItem,
} from '../components/ui';
import { ContextPanelCard, KeyValue, PageHeader, WorkArea } from '../components/common/PageChrome';
import { INTERNET_PERMISSION_DEFAULTS, MOCK_TRUSTED_SOURCES, MOCK_UPDATE_HISTORY } from '../data/internet';
import { MOCK_AGENTS } from '../data/agents';
import type { TrustedSource } from '../data/types';
import { usePlatform } from '../state/PlatformContext';
import { cn } from '../lib/utils';

/* ------------------------------------------------------------------ */
/* Local helpers (page-private — Phase 1 keeps them out of shared UI). */
/* ------------------------------------------------------------------ */

type PermKey = keyof typeof INTERNET_PERMISSION_DEFAULTS;
type Perms = Record<PermKey, boolean>;

interface PermRow {
  key: PermKey;
  label: string;
  desc: string;
  tip: string;
  invert?: boolean; // UI shows the protective polarity (e.g. "never send full context")
}

const PERMISSION_ROWS: PermRow[] = [
  {
    key: 'offlineByDefault',
    label: 'Offline by default',
    desc: 'NEXUS boots and stays offline unless you explicitly switch modes.',
    tip: 'The strongest guarantee in Phase 1: with this on and Offline mode active, no request is ever attempted.',
  },
  {
    key: 'perAgentControl',
    label: 'Per-agent internet control',
    desc: 'Each agent has its own internet switch instead of one global grant.',
    tip: 'Grants are read from the table below. The Universal Agent defaults to allowed; specialists start closed.',
  },
  {
    key: 'perRequestPrompt',
    label: 'Ask per request',
    desc: 'Every web fetch shows an approval prompt before anything is attempted.',
    tip: 'Approval prompts are UI-only in Phase 1 — no request exists to approve or deny.',
  },
  {
    key: 'allowListOnly',
    label: 'Allow-list only',
    desc: 'Fetches are limited to the trusted sources listed below.',
    tip: 'When on, domains outside the allow-list are refused before any connection is attempted.',
  },
  {
    key: 'sendFullContext',
    label: 'Never send full context',
    desc: 'Web tools receive the minimal query only — never your full conversation or memory.',
    tip: 'Product principle: context minimisation. Turning this off would let web tools read whole threads (not possible in Phase 1).',
    invert: true,
  },
  {
    key: 'blockUploadsOfPrivateDocs',
    label: 'Block uploads of private docs',
    desc: 'Knowledge Base documents marked private can never be sent to a URL.',
    tip: 'Hard guardrail for the future Document Analyst flow — private files stay on disk.',
  },
];

/** Which web tools each agent would use (static mock of the tool registry). */
const AGENT_WEB_TOOLS: Record<string, string[]> = {
  universal: ['web-search', 'web-fetch'],
  developer: ['web-fetch'],
  researcher: ['web-search', 'web-fetch'],
  'doc-analyst': [],
  'data-analyst': [],
  assistant: ['web-search'],
  sysadmin: [],
};

const AGENT_NET_DEFAULTS: Record<string, boolean> = {
  universal: true,
  developer: true,
  researcher: true,
  'doc-analyst': false,
  'data-analyst': false,
  assistant: true,
  sysadmin: false,
};

function validateDomain(raw: string): string | null {
  const d = raw.trim();
  if (!d) return 'Domain is required.';
  if (/\s/.test(d)) return 'No spaces allowed — enter a bare domain.';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(d) || d.includes('/')) {
    return 'Enter the bare domain only (no protocol, no path).';
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(d)) {
    return 'Must look like example.com';
  }
  return null;
}

const RESULT_TONE: Record<string, 'ok' | 'warn' | 'err'> = {
  success: 'ok',
  'rolled-back': 'warn',
  failed: 'err',
};

const KIND_TONE: Record<string, 'accent' | 'violet' | 'idle'> = {
  app: 'accent',
  model: 'violet',
  skill: 'idle',
};

/* ------------------------------------------------------------------ */

export default function Internet() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { online, setOnline } = usePlatform();

  const [perms, setPerms] = useState<Perms>({ ...INTERNET_PERMISSION_DEFAULTS });
  const [agentNet, setAgentNet] = useState<Record<string, boolean>>(AGENT_NET_DEFAULTS);
  const [sources, setSources] = useState<TrustedSource[]>(MOCK_TRUSTED_SOURCES);

  const [addOpen, setAddOpen] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [domainTouched, setDomainTouched] = useState(false);
  const [removing, setRemoving] = useState<TrustedSource | null>(null);

  const [researchRate, setResearchRate] = useState('6/min');
  const [researchResults, setResearchResults] = useState('8');
  const [researchCitation, setResearchCitation] = useState('brackets');

  const [checking, setChecking] = useState(false);

  const domainError = validateDomain(newDomain);
  const resultsInvalid = researchResults !== '' && (Number(researchResults) < 1 || Number(researchResults) > 50);

  const togglePerm = (row: PermRow, nextChecked: boolean) => {
    const value = row.invert ? !nextChecked : nextChecked;
    setPerms((prev) => ({ ...prev, [row.key]: value }));
    if (row.key === 'offlineByDefault' && value === false && online) {
      toast('Offline-first protection disabled while online — web tools would be reachable in Phase 2 (simulated)', 'warning');
    } else {
      toast(`${row.label} ${nextChecked ? 'enabled' : 'disabled'} — stored in prototype state`, 'info');
    }
  };

  const addSource = () => {
    if (domainError) return;
    const src: TrustedSource = {
      id: `src-${Date.now()}`,
      domain: newDomain.trim().toLowerCase(),
      label: newLabel.trim() || newDomain.trim().toLowerCase(),
      allowed: true,
    };
    setSources((prev) => [src, ...prev]);
    setAddOpen(false);
    setNewDomain('');
    setNewLabel('');
    setDomainTouched(false);
    toast('Rule stored in prototype state (never used to reach the network here)', 'info');
  };

  const runUpdateCheck = () => {
    if (checking) return;
    setChecking(true);
    window.setTimeout(() => {
      setChecking(false);
      toast("You're up to date (simulated check — no network request made)", 'success');
    }, 1200);
  };

  return (
    <WorkArea
      contextPanel={
        <>
          <ContextPanelCard
            title="Connection status"
            actions={<StatusDot tone={online ? 'ok' : 'info'} pulse={online} />}
          >
            <p className="text-sm font-semibold text-ink-primary">{online ? 'Online (simulated)' : 'Offline — local only'}</p>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-faint">
              This chip is the same state the topbar shows. Switching modes is simulated — no adapter is enabled or
              disabled.
            </p>
            <div className="mt-3 space-y-0.5">
              <KeyValue k="Mode" v={online ? 'online' : 'offline'} mono />
              <KeyValue k="Allow-list" v={perms.allowListOnly ? 'enforced' : 'disabled'} mono />
              <KeyValue k="Per-request prompts" v={perms.perRequestPrompt ? 'on' : 'off'} mono />
            </div>
          </ContextPanelCard>

          <ContextPanelCard title="Data flow (Phase 1)">
            <div className="space-y-0.5">
              <KeyValue k="Model weights" v="Local disk — none installed" />
              <KeyValue k="Memory" v="Local — React prototype state" />
              <KeyValue k="Knowledge Base" v="Local folder + index (planned)" />
              <KeyValue k="Web content" v="Only when explicitly allowed" />
            </div>
            <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
              Nothing leaves the machine in this prototype. Allow/deny rules above are stored in frontend state only.
            </p>
            <Button
              size="xs"
              variant="ghost"
              className="mt-3 px-0"
              onClick={() => {
                navigate('/settings');
                toast('Internet preferences also live under Settings → Internet', 'info');
              }}
            >
              Related in Settings <ArrowRight size={12} />
            </Button>
          </ContextPanelCard>
        </>
      }
    >
      <PageHeader
        title="Internet Center"
        description="Offline-first connectivity policy for agents and web tools. Every switch on this screen is enforced only inside the prototype — no real connection is ever attempted."
        notice={<DemoNotice text="No network stack is wired to this UI. All requests below would be refused in Phase 1." />}
        actions={
          <Button variant="secondary" icon={<RefreshCw size={13} />} loading={checking} onClick={runUpdateCheck}>
            Check for updates
          </Button>
        }
      />

      <div className="space-y-5 p-5">
        {/* Mode card */}
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Globe size={14} className="text-accent" /> Connection mode
              </span>
            }
            subtitle="Global switch — the same state is reflected in the topbar chip and on every screen"
          />
          <CardBody className="pt-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={!online}
                onClick={() => {
                  if (online) {
                    setOnline(false);
                    toast('Switched to Offline mode (simulated) — local features unaffected', 'success');
                  }
                }}
                className={cn(
                  'rounded-card border p-4 text-left transition-colors',
                  !online
                    ? 'border-accent/50 bg-accent/10 shadow-glow'
                    : 'border-surface-line bg-surface-raised hover:border-ink-faint/40',
                )}
              >
                <span className="flex items-center gap-2">
                  <WifiOff size={16} className={!online ? 'text-accent' : 'text-ink-faint'} />
                  <span className="text-sm font-bold text-ink-primary">Offline</span>
                  {!online && <Badge tone="ok" dot>current</Badge>}
                </span>
                <span className="mt-2 block text-xs leading-relaxed text-ink-muted">
                  All AI, memory and tools work without internet. Nothing leaves the machine.
                </span>
              </button>

              <button
                type="button"
                aria-pressed={online}
                onClick={() => {
                  if (!online) {
                    setOnline(true);
                    if (perms.offlineByDefault) {
                      toast('Online selected while "offline by default" is on — per-request approvals would gate every fetch (simulated)', 'info');
                    } else {
                      toast('Switched to Online mode — simulated only, no network stack exists here', 'info');
                    }
                  }
                }}
                className={cn(
                  'rounded-card border p-4 text-left transition-colors',
                  online
                    ? 'border-state-warn/50 bg-state-warn/10'
                    : 'border-surface-line bg-surface-raised hover:border-ink-faint/40',
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Wifi size={16} className={online ? 'text-state-warn' : 'text-ink-faint'} />
                  <span className="text-sm font-bold text-ink-primary">Online</span>
                  {online && <Badge tone="warn" dot>simulated — no real network in Phase 1</Badge>}
                </span>
                <span className="mt-2 block text-xs leading-relaxed text-ink-muted">
                  Web tools become reachable only through the permissions below. In this prototype nothing is actually
                  fetched.
                </span>
              </button>
            </div>
          </CardBody>
        </Card>

        {/* Permissions */}
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-state-ok" /> Internet permissions
              </span>
            }
            subtitle="Policy defaults for every agent and web tool"
          />
          <CardBody className="pt-2">
            <ul className="divide-y divide-surface-line">
              {PERMISSION_ROWS.map((row) => {
                const checked = row.invert ? !perms[row.key] : perms[row.key];
                return (
                  <li key={row.key} className="flex items-start justify-between gap-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink-primary">{row.label}</p>
                      <p className="mt-0.5 text-2xs leading-relaxed text-ink-muted">{row.desc}</p>
                    </div>
                    <Tooltip content={row.tip} side="left">
                      <Toggle
                        checked={checked}
                        onChange={(v) => togglePerm(row, v)}
                        label={row.label}
                        size="sm"
                      />
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>

        {/* Per-agent access table */}
        <Card>
          <CardHeader
            title="Per-agent internet access"
            subtitle={
              perms.perAgentControl
                ? 'Each agent needs its own grant (per-agent control is on)'
                : 'Per-agent control is disabled — the global mode decides for everyone'
            }
          />
          <CardBody className="pt-2">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-2xs uppercase tracking-wider text-ink-faint">
                  <th className="pb-2 font-semibold">Agent</th>
                  <th className="pb-2 font-semibold">Web tools it would use</th>
                  <th className="pb-2 text-right font-semibold">Internet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-line">
                {MOCK_AGENTS.map((a) => {
                  const tools = AGENT_WEB_TOOLS[a.id] ?? [];
                  const allowed = agentNet[a.id] ?? false;
                  return (
                    <tr key={a.id}>
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-ink-primary">{a.name}</p>
                        <p className="text-2xs text-ink-faint">{a.role}</p>
                      </td>
                      <td className="py-2.5 pr-3">
                        {tools.length ? (
                          <span className="flex flex-wrap gap-1">
                            {tools.map((t) => (
                              <span key={t} className="mono-num rounded border border-surface-line bg-surface-base px-1.5 py-0.5 text-2xs text-ink-secondary">
                                {t}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-2xs text-ink-faint">none declared</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <Tooltip
                          content={
                            tools.length === 0
                              ? 'This agent declares no web tools — the switch is precautionary.'
                              : `Grants ${tools.join(' + ')} a network path when Online mode is active (simulated).`
                          }
                          side="left"
                        >
                          <span className="inline-flex justify-end">
                            <Toggle
                              size="sm"
                              checked={allowed}
                              label={`Internet access for ${a.name}`}
                              onChange={(v) => {
                                setAgentNet((prev) => ({ ...prev, [a.id]: v }));
                                toast(`${a.name}: internet ${v ? 'granted' : 'revoked'} — prototype state only`, 'info');
                              }}
                            />
                          </span>
                        </Tooltip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>

        {/* Trusted sources */}
        <Card>
          <CardHeader
            title="Trusted sources"
            subtitle="Allow-list of domains the future Research Agent may reach"
            actions={
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
                Add source
              </Button>
            }
          />
          <CardBody className="pt-2">
            {sources.length === 0 ? (
              <EmptyState
                icon={<Globe />}
                title="No trusted sources"
                description="With an empty list, every web fetch would be refused while allow-list-only is on."
                action={
                  <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
                    Add source
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-surface-line">
                {sources.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2">
                    <span className="mono-num min-w-0 flex-1 truncate text-xs text-ink-primary">{s.domain}</span>
                    <span className="hidden max-w-[180px] truncate text-2xs text-ink-muted sm:block">{s.label}</span>
                    <Badge tone={s.allowed ? 'ok' : 'idle'} dot>
                      {s.allowed ? 'allowed' : 'blocked'}
                    </Badge>
                    <Tooltip content={s.allowed ? 'Revoke this domain from the allow-list' : 'Add this domain back to the allow-list'} side="left">
                      <Toggle
                        size="sm"
                        checked={s.allowed}
                        label={`Allow ${s.domain}`}
                        onChange={(v) => {
                          setSources((prev) => prev.map((x) => (x.id === s.id ? { ...x, allowed: v } : x)));
                          toast(`Rule stored in prototype state (never used to reach the network here)`, 'info');
                        }}
                      />
                    </Tooltip>
                    <Menu
                      triggerLabel={`Actions for ${s.domain}`}
                      align="right"
                      trigger={
                        <span className="text-ink-faint hover:text-ink-primary">
                          <MoreHorizontal size={14} />
                        </span>
                      }
                      items={
                        [
                          {
                            id: 'remove',
                            label: 'Remove',
                            danger: true,
                            onSelect: () => setRemoving(s),
                          },
                        ] satisfies MenuItem[]
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Research configuration */}
        <Card>
          <CardHeader
            title="Web research configuration"
            subtitle="Configures the future Research Agent pipeline — values are stored locally only"
          />
          <CardBody className="pt-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                label="Request rate limit"
                value={researchRate}
                onChange={(e) => {
                  setResearchRate(e.target.value);
                  toast(`Rate limit set to ${e.target.value} requests (simulated)`, 'info');
                }}
                options={[
                  { value: '2/min', label: '2 requests / min' },
                  { value: '6/min', label: '6 requests / min' },
                  { value: '12/min', label: '12 requests / min' },
                  { value: '30/min', label: '30 requests / min' },
                ]}
                hint="Upper bound for the future fetch queue."
              />
              <Input
                label="Results per query"
                type="number"
                min={1}
                max={50}
                value={researchResults}
                onChange={(e) => setResearchResults(e.target.value)}
                error={resultsInvalid ? 'Enter a number between 1 and 50.' : null}
                hint="How many pages the Research Agent would summarise."
              />
              <Select
                label="Citation style"
                value={researchCitation}
                onChange={(e) => {
                  setResearchCitation(e.target.value);
                  toast('Citation style updated (applies to future reports)', 'info');
                }}
                options={[
                  { value: 'brackets', label: 'Bracketed [1]' },
                  { value: 'apa', label: 'APA author–date' },
                  { value: 'mdlinks', label: 'Markdown links' },
                ]}
                hint="Rendering contract for research answers."
              />
            </div>
          </CardBody>
        </Card>

        {/* Update history */}
        <Card>
          <CardHeader
            title="Update history"
            subtitle="Every app, model and skill update recorded locally"
            actions={
              <Button variant="secondary" size="sm" icon={<RefreshCw size={13} />} loading={checking} onClick={runUpdateCheck}>
                Check for updates
              </Button>
            }
          />
          <CardBody className="pt-2">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-2xs uppercase tracking-wider text-ink-faint">
                  <th className="pb-2 font-semibold">Date</th>
                  <th className="pb-2 font-semibold">Item</th>
                  <th className="pb-2 font-semibold">Version</th>
                  <th className="pb-2 font-semibold">Kind</th>
                  <th className="pb-2 text-right font-semibold">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-line">
                {MOCK_UPDATE_HISTORY.map((u) => (
                  <tr key={u.id}>
                    <td className="mono-num py-2.5 pr-3 text-ink-muted">{u.date}</td>
                    <td className="py-2.5 pr-3 font-medium text-ink-primary">{u.item}</td>
                    <td className="mono-num py-2.5 pr-3 text-ink-secondary">
                      {u.from ? `${u.from} → ${u.to}` : u.to}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={KIND_TONE[u.kind] ?? 'idle'}>{u.kind}</Badge>
                    </td>
                    <td className="py-2.5 text-right">
                      <Badge tone={RESULT_TONE[u.result] ?? 'idle'} dot>
                        {u.result}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {checking && <LoadingState label="Simulating update check — no request is sent…" className="py-6" />}
          </CardBody>
        </Card>
      </div>

      {/* Add source modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add trusted source"
        subtitle="Stored in prototype state only — the list never drives a real connection in Phase 1"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={domainError !== null || newDomain.trim() === ''} onClick={addSource}>
              Add source
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Domain"
            required
            value={newDomain}
            placeholder="example.com"
            onChange={(e) => {
              setNewDomain(e.target.value);
              setDomainTouched(true);
            }}
            error={domainTouched ? domainError : null}
            hint="Bare domain, like developer.mozilla.org — no protocol or path."
          />
          <Input
            label="Label (optional)"
            value={newLabel}
            placeholder="What this source is for"
            onChange={(e) => setNewLabel(e.target.value)}
          />
        </div>
      </Modal>

      {/* Remove confirm */}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.domain ?? ''}?`}
        message={
          <>
            The rule for <strong className="mono-num">{removing?.domain}</strong> will be deleted from prototype
            state. Nothing else changes — no cached content exists to purge.
          </>
        }
        confirmLabel="Remove rule"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) {
            setSources((prev) => prev.filter((x) => x.id !== removing.id));
            toast(`Rule for ${removing.domain} removed (prototype state only)`, 'success');
          }
          setRemoving(null);
        }}
      />
    </WorkArea>
  );
}
