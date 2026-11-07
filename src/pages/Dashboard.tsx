import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Cpu,
  Gauge,
  HardDrive,
  MessagesSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Meter, Sparkline, StatusDot, Tooltip, DemoNotice } from '../components/ui';
import { KeyValue, WorkArea, ContextPanelCard } from '../components/common/PageChrome';
import { HARDWARE_PROFILE, mockSeries, mockTelemetry } from '../data/hardware';
import { modelName } from '../data/models';
import { MOCK_AGENTS } from '../data/agents';
import { MOCK_CONVERSATIONS } from '../data/chat';
import { MOCK_ACTIVITY } from '../data/activity';
import { useActiveModel, usePlatform } from '../state/PlatformContext';
import { formatBytes, pct, timeAgo } from '../lib/utils';

function SystemCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="text-ink-faint [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
            {label}
          </span>
        }
      />
      <CardBody className="pt-3">{children}</CardBody>
    </Card>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { online } = usePlatform();
  const activeModel = useActiveModel();
  const [tick, setTick] = useState(0);
  const telemetry = useMemo(() => mockTelemetry(tick), [tick]);
  const series = useMemo(
    () => ({
      cpu: mockSeries(`cpu${tick}`, 40, 22),
      ram: mockSeries(`ram${tick}`, 55, 12),
      gpu: mockSeries(`gpu${tick}`, 20, 15),
    }),
    [tick],
  );

  const activeAgents = MOCK_AGENTS.filter((a) => a.enabled);
  const recentConvs = [...MOCK_CONVERSATIONS].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const recentActivity = MOCK_ACTIVITY.slice(0, 6);
  const storageUsedGB = HARDWARE_PROFILE.storageTotalGB - HARDWARE_PROFILE.storageFreeGB;

  return (
    <WorkArea
      contextPanel={
        <>
          <ContextPanelCard title="Active model" actions={<StatusDot tone="idle" />}>
            <p className="text-sm font-semibold leading-snug text-ink-primary">{activeModel.name}</p>
            <div className="mt-2 space-y-0.5">
              <KeyValue k="Quantization" v={activeModel.quantization} mono />
              <KeyValue k="Context window" v={activeModel.contextWindow.toLocaleString()} mono />
              <KeyValue k="Est. RAM need" v={`${activeModel.ramGB} GB`} mono />
              <KeyValue k="On disk" v={formatBytes(activeModel.sizeGB)} mono />
            </div>
            <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
              Selection is simulated — no model weights are loaded in Phase 1.
            </p>
            <Button size="xs" variant="ghost" className="mt-2 px-0" onClick={() => navigate('/models')}>
              Change in Model Manager <ArrowRight size={12} />
            </Button>
          </ContextPanelCard>

          <ContextPanelCard
            title="Hardware"
            actions={
              <Tooltip content="Re-sample simulated telemetry (deterministic mock, not real sensors)" side="left">
                <button
                  onClick={() => setTick((t) => t + 1)}
                  aria-label="Refresh simulated telemetry"
                  className="text-ink-faint hover:text-ink-primary"
                >
                  <RefreshCw size={13} />
                </button>
              </Tooltip>
            }
          >
            <div className="space-y-3">
              <Meter label="CPU" value={telemetry.cpuPct} detail={HARDWARE_PROFILE.cpu} />
              <Meter
                label="RAM"
                value={(telemetry.ramUsedGB / telemetry.ramTotalGB) * 100}
                detail={`${telemetry.ramUsedGB.toFixed(1)} / ${telemetry.ramTotalGB} GB`}
              />
              <Meter label="GPU" value={telemetry.gpuPct} detail={HARDWARE_PROFILE.gpu} tone="accent" />
            </div>
            <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
              Values are labeled mock data — Phase 1 has no sensor access.
            </p>
          </ContextPanelCard>

          <ContextPanelCard title="Quick actions">
            <div className="grid gap-2">
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => navigate('/chat?new=1')}>
                New conversation
              </Button>
              <Button variant="secondary" icon={<Bot size={14} />} onClick={() => navigate('/agents')}>
                Manage agents
              </Button>
              <Button variant="secondary" icon={<Cpu size={14} />} onClick={() => navigate('/models')}>
                Browse model catalog
              </Button>
              <Button variant="secondary" icon={<Wrench size={14} />} onClick={() => navigate('/tools')}>
                Review tool permissions
              </Button>
            </div>
          </ContextPanelCard>
        </>
      }
    >
      <div className="space-y-5">
        {/* Welcome + status */}
        <Card className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{ background: 'radial-gradient(520px 140px at 12% 0%, rgba(56,189,248,0.10), transparent)' }}
          />
          <div className="relative flex flex-wrap items-start justify-between gap-4 p-5">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-accent" />
                <h2 className="text-xl font-bold tracking-tight">Good to see you, Abdallh.</h2>
              </div>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-muted">
                NEXUS is ready in <strong className="text-ink-secondary">offline mode</strong>. Everything below is
                prototype data until Phase 2 connects the engine.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={online ? 'ok' : 'info'} dot pulse={online}>
                  {online ? 'Online (simulated)' : 'Offline — local only'}
                </Badge>
                <Badge tone="ok" dot>
                  System nominal (mock)
                </Badge>
                <Badge tone="warn" dot>
                  2 memories pending approval
                </Badge>
                <Badge tone="idle">
                  {activeAgents.length} active agents
                </Badge>
              </div>
            </div>
            <div className="flex gap-6">
              {[
                { label: 'CPU', value: pct(telemetry.cpuPct), spark: series.cpu },
                { label: 'RAM', value: pct((telemetry.ramUsedGB / telemetry.ramTotalGB) * 100), spark: series.ram },
                { label: 'GPU', value: pct(telemetry.gpuPct), spark: series.gpu },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <p className="text-2xs font-bold uppercase tracking-widest text-ink-faint">{s.label}</p>
                  <p className="mono-num mt-1 text-xl font-bold text-ink-primary">{s.value}</p>
                  <Sparkline values={s.spark} className="mx-auto mt-1" />
                </div>
              ))}
            </div>
          </div>
        </Card>

        <DemoNotice />

        {/* System cards row — 4-up only once there's room beside the context rail */}
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          <SystemCard icon={<Gauge size={14} />} label="Model availability">
            <p className="mono-num text-2xl font-bold text-ink-primary">0 / 10</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              models installed — none are. 10 candidates shown in the mock catalog.
            </p>
            <Button size="xs" variant="ghost" className="mt-2 px-0" onClick={() => navigate('/models')}>
              Open catalog <ArrowRight size={12} />
            </Button>
          </SystemCard>
          <SystemCard icon={<HardDrive size={14} />} label="Storage (D:)">
            <Meter
              label="Used"
              value={(storageUsedGB / HARDWARE_PROFILE.storageTotalGB) * 100}
              detail={`${formatBytes(storageUsedGB)} / ${formatBytes(HARDWARE_PROFILE.storageTotalGB)}`}
              tone="auto"
            />
            <p className="mt-2 text-2xs text-ink-faint">{HARDWARE_PROFILE.os} · SMR HDD secondary drive noted</p>
          </SystemCard>
          <SystemCard icon={<Bot size={14} />} label="Active agents">
            <ul className="space-y-1.5">
              {activeAgents.slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-xs text-ink-secondary">
                  <StatusDot tone="ok" /> {a.name}
                </li>
              ))}
            </ul>
            <Button size="xs" variant="ghost" className="mt-2 px-0" onClick={() => navigate('/agents')}>
              All agents <ArrowRight size={12} />
            </Button>
          </SystemCard>
          <SystemCard icon={<Cpu size={14} />} label="Connectivity">
            <div className="flex items-center gap-2">
              <StatusDot tone={online ? 'ok' : 'info'} />
              <p className="text-sm font-semibold text-ink-primary">{online ? 'Online' : 'Offline'}</p>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
              Offline-first by design. Switching is simulated; policy lives in Internet Center.
            </p>
            <Button size="xs" variant="ghost" className="mt-2 px-0" onClick={() => navigate('/internet')}>
              Internet settings <ArrowRight size={12} />
            </Button>
          </SystemCard>
        </div>

        {/* Recents row */}
        <div className="grid gap-4 2xl:grid-cols-2">
          <Card>
            <CardHeader
              title="Recent conversations"
              subtitle="From the mock chat store"
              actions={
                <Button size="xs" variant="ghost" onClick={() => navigate('/chat')}>
                  Open chat <ArrowRight size={12} />
                </Button>
              }
            />
            <CardBody className="pt-2">
              <ul className="divide-y divide-surface-line">
                {recentConvs.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => navigate(`/chat/${c.id}`)}
                      className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <MessagesSquare size={14} className="shrink-0 text-ink-faint" />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-ink-primary hover:text-accent">
                            {c.title}
                          </span>
                          <span className="block truncate text-2xs text-ink-faint">
                            {agentNameOf(c.agentId)} · {modelName(c.modelId)}
                          </span>
                        </span>
                      </span>
                      <span className="mono-num shrink-0 text-2xs text-ink-faint">{timeAgo(new Date(c.updatedAt))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent activity"
              subtitle="Simulated event log"
              actions={
                <Button size="xs" variant="ghost" onClick={() => navigate('/activity')}>
                  Activity Center <ArrowRight size={12} />
                </Button>
              }
            />
            <CardBody className="pt-2">
              <ul className="divide-y divide-surface-line">
                {recentActivity.map((a) => (
                  <li key={a.id} className="flex items-start gap-2.5 py-2.5">
                    <StatusDot
                      className="mt-1"
                      tone={a.status === 'success' ? 'ok' : a.status === 'failure' ? 'err' : a.status === 'running' ? 'info' : 'warn'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink-primary">{a.title}</span>
                      <span className="block truncate text-2xs text-ink-faint">{a.detail}</span>
                    </span>
                    <span className="mono-num shrink-0 text-2xs text-ink-faint">{timeAgo(new Date(a.ts))}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </WorkArea>
  );
}

function agentNameOf(id: string): string {
  return MOCK_AGENTS.find((a) => a.id === id)?.name ?? id;
}
