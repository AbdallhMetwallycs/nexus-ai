import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Check,
  Cpu,
  Database,
  Download,
  Eye,
  GitCompare,
  Info,
  MoreHorizontal,
  Star,
  X,
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
  Menu,
  Modal,
  Select,
  StatusDot,
  Tabs,
  Tooltip,
  useToast,
  type MenuItem,
  type Tone,
} from '../components/ui';
import { ContextPanelCard, KeyValue, PageHeader, WorkArea } from '../components/common/PageChrome';
import { HARDWARE_PROFILE, mockTelemetry } from '../data/hardware';
import { MOCK_MODELS } from '../data/models';
import type { ModelRecord } from '../data/types';
import { usePlatform } from '../state/PlatformContext';
import { cn, formatBytes } from '../lib/utils';
import { resolveTransport } from '../contract/client';

/* ------------------------------------------------------------------ */
/* Page-local helpers                                                  */
/* ------------------------------------------------------------------ */

const MAX_COMPARE = 3;

type SortKey = 'name' | 'size' | 'ram';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Sort: Name' },
  { value: 'size', label: 'Sort: Disk size' },
  { value: 'ram', label: 'Sort: Est. RAM' },
];

interface Compat {
  tone: Tone;
  label: string;
  note: string;
}

/** Honest sizing advice for the reference machine (i5-8250U, 20 GB, 15 W). */
function hardwareCompat(m: ModelRecord): Compat {
  const total = HARDWARE_PROFILE.ramTotalGB; // 20
  const osFloor = 5; // Windows + desktop apps
  if (m.ramGB <= 8) {
    return {
      tone: 'ok',
      label: 'Fits this machine',
      note: `Est. ${m.ramGB} GB runtime RAM leaves headroom on a ${total} GB machine, but the i5-8250U is capped near 15 W — expect low tokens/sec on CPU.`,
    };
  }
  if (m.ramGB <= total - osFloor) {
    return {
      tone: 'warn',
      label: 'Tight on RAM',
      note: `Est. ${m.ramGB} GB plus ~${osFloor} GB for Windows approaches the ${total} GB ceiling of this machine. Swapping on the SMR HDD would stall the whole system; GPU offload (MX150, 4 GB) is only partial.`,
    };
  }
  return {
    tone: 'err',
    label: 'Exceeds this machine',
    note: `Est. ${m.ramGB} GB runtime RAM does not fit alongside Windows on ${total} GB, and the 15 W i5-8250U / MX150 cannot sustain the offload it would need.`,
  };
}

const fmtDate = (isoDate: string) => isoDate;

/* ------------------------------------------------------------------ */

export default function Models() {
  const { toast } = useToast();
  const { activeModelId, setActiveModelId, live, coreModels } = usePlatform();
  const transport = useMemo(() => resolveTransport(), []);

  const [tab, setTab] = useState<'installed' | 'catalog'>(live ? 'installed' : 'catalog');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  // The packaged build reads this list from the core; the browser build keeps the mock.
  const installed: ModelRecord[] = live ? coreModels : MOCK_MODELS.filter((m) => m.installed);

  const q = search.trim().toLowerCase();
  const catalogRows = useMemo(() => {
    const rows = MOCK_MODELS.filter((m) => m.inCatalog).filter(
      (m) =>
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.family.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    );
    return [...rows].sort((a, b) => {
      if (sort === 'size') return a.sizeGB - b.sizeGB;
      if (sort === 'ram') return a.ramGB - b.ramGB;
      return a.name.localeCompare(b.name);
    });
  }, [q, sort]);

  const toggleCompare = (id: string, next: boolean) => {
    setCompareIds((prev) => {
      if (!next) return prev.filter((x) => x !== id);
      if (prev.includes(id) || prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  };

  const setActive = async (m: ModelRecord) => {
    if (!live) {
      setActiveModelId(m.id);
      localStorage.setItem('nexus.activeModelId', m.id);
      toast(`"${m.name}" set as active model (simulated — no weights loaded)`, 'info');
      return;
    }
    // Live: the badge and the remembered id follow a successful load, never precede it.
    // Admission can refuse for RAM and `engine.loadModel` can fail; marking a model "active"
    // before the core answers is a claim the next screen would repeat as fact.
    toast(`Loading ${m.name}… first load can take 30 s`, 'info');
    const loaded = await transport.call('engine.loadModel', { modelId: m.id });
    if (loaded.ok) {
      setActiveModelId(m.id);
      localStorage.setItem('nexus.activeModelId', m.id);
      toast(`${m.name} loaded — ${loaded.data.contextCapped} token context, ${loaded.data.threads} threads`, 'success');
      return;
    }
    toast(`${loaded.error.code}: ${loaded.error.message}`, 'error');
  };

  const compareModels = MOCK_MODELS.filter((m) => compareIds.includes(m.id));
  const detailModel = detailId
    ? [...installed, ...MOCK_MODELS].find((m) => m.id === detailId) ?? null
    : null;
  const downloadModel = downloadId ? MOCK_MODELS.find((m) => m.id === downloadId) ?? null : null;

  const telemetry = useMemo(() => mockTelemetry(0), []);
  const ramHeadroomGB = telemetry.ramTotalGB - telemetry.ramUsedGB;

  /** In live mode only records the core actually found on disk can be loaded. */
  const isOnDisk = (id: string) => installed.some((m) => m.id === id);

  const rowMenu = (m: ModelRecord): MenuItem[] => [
    { id: 'details', label: 'Details', icon: <Eye />, onSelect: () => setDetailId(m.id) },
    {
      id: 'download',
      label: 'Download (simulated)',
      icon: <Download />,
      disabled: m.installed,
      onSelect: () => setDownloadId(m.id),
    },
    m.id === activeModelId
      ? { id: 'active', label: 'Active model', icon: <Check />, disabled: true, onSelect: () => undefined }
      : live && !isOnDisk(m.id)
        ? {
            id: 'not-installed',
            label: 'Not on disk — mock catalog row',
            icon: <Star />,
            disabled: true,
            onSelect: () => undefined,
          }
        : { id: 'set-active', label: 'Set active', icon: <Star />, onSelect: () => setActive(m) },
  ];

  return (
    <WorkArea
      contextPanel={
        <>
          <ContextPanelCard title="Hardware profile" actions={<Cpu size={13} className="text-ink-faint" />}>
            <div className="space-y-0.5">
              <KeyValue k="CPU" v={HARDWARE_PROFILE.cpu} />
              <KeyValue k="RAM" v={`${HARDWARE_PROFILE.ramTotalGB} GB (8 soldered)`} mono />
              <KeyValue k="GPU" v="UHD 620 + MX150 4 GB" />
              <KeyValue k="Storage" v={`${HARDWARE_PROFILE.storageFreeGB} GB free / ${HARDWARE_PROFILE.storageTotalGB} GB`} mono />
              <KeyValue k="OS" v={HARDWARE_PROFILE.os} />
            </div>
            <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
              Reference machine profile (mock). Compatibility judgements below compare model RAM needs against it.
            </p>
          </ContextPanelCard>

          <ContextPanelCard title="RAM headroom (mock)" actions={<StatusDot tone="info" pulse />}>
            <div
              role="progressbar"
              aria-valuenow={Math.round((ramHeadroomGB / telemetry.ramTotalGB) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Estimated free RAM"
              className="h-1.5 w-full overflow-hidden rounded-full bg-surface-line/70"
            >
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${Math.max(0, Math.min(100, (ramHeadroomGB / telemetry.ramTotalGB) * 100))}%` }}
              />
            </div>
            <p className="mono-num mt-2 text-xs text-ink-secondary">
              ~{ramHeadroomGB.toFixed(1)} GB free of {telemetry.ramTotalGB} GB
            </p>
            <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
              Simulated telemetry — Phase 1 has no sensor access. Treat ~8 GB quantized models as the practical ceiling
              on this 15 W machine.
            </p>
          </ContextPanelCard>
        </>
      }
    >
      <PageHeader
        title="Model Manager"
        description={
          live
            ? 'Installed models are read from disk and loaded through the measured RAM admission check. The catalog below is still Phase 1 mock data.'
            : 'Browse the mock catalog, judge fit for this machine, and pick the active model. Nothing here loads, downloads, or runs weights.'
        }
        notice={
          live ? (
            <DemoNotice text="Installed rows are real GGUF files. Catalog entries and downloads remain mock data until M2/M3." />
          ) : (
            <DemoNotice text="Prototype only — no models are actually installed, and the catalog metadata is mock data." />
          )
        }
      >
        <div className="flex flex-wrap items-center gap-3 pb-1">
          <Tabs
            variant="pill"
            active={tab}
            onChange={(id) => setTab(id as 'installed' | 'catalog')}
            tabs={[
              {
                id: 'installed',
                label: 'Installed',
                badge: <span className="mono-num rounded-full bg-state-err/15 px-1.5 text-2xs text-state-err">{installed.length}</span>,
              },
              {
                id: 'catalog',
                label: 'Catalog (mock)',
                badge: <span className="mono-num rounded-full bg-surface-line px-1.5 text-2xs text-ink-muted">{MOCK_MODELS.filter((m) => m.inCatalog).length}</span>,
              },
            ]}
          />
          {tab === 'catalog' && (
            <>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, family, or tag…"
                aria-label="Search model catalog"
                className="field h-8 w-64 text-xs [&::-webkit-search-cancel-button]:hidden"
              />
              <Select
                aria-label="Sort catalog"
                className="h-8 w-[150px] text-xs"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                options={SORT_OPTIONS}
              />
              <span className="mono-num ml-auto text-2xs text-ink-faint">{catalogRows.length} of {MOCK_MODELS.length} models</span>
            </>
          )}
        </div>
      </PageHeader>

      <div className="space-y-4 p-5">
        {tab === 'installed' ? (
          live ? (
            installed.length === 0 ? (
              <Card>
                <CardBody>
                  <EmptyState
                    icon={<Database />}
                    title="No GGUF files found"
                    description="The core scanned the models folder and found nothing it could parse. Copy a .gguf file into the folder, then reopen this screen."
                  />
                </CardBody>
              </Card>
            ) : (
              <Card>
                <CardHeader
                  title="Installed on disk"
                  subtitle="Read by the core from the models folder. Loading runs the measured admission check first."
                />
                <ul className="divide-y divide-surface-line">
                  {installed.map((m) => {
                    const isActive = m.id === activeModelId;
                    return (
                      <li
                        key={m.id}
                        className={cn(
                          'flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-line/25',
                          isActive && 'bg-accent/[0.07]',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-xs font-semibold text-ink-primary">{m.name}</p>
                            {isActive && (
                              <Badge tone="accent" dot>
                                active
                              </Badge>
                            )}
                          </div>
                          <p className="mono-num mt-0.5 truncate text-2xs text-ink-faint">
                            {m.family} · {m.quantization} · {m.contextWindow.toLocaleString()} ctx ·{' '}
                            {formatBytes(m.sizeGB)} · est. {m.ramGB} GB RAM
                          </p>
                        </div>
                        <Button
                          size="xs"
                          variant={isActive ? 'ghost' : 'secondary'}
                          disabled={isActive}
                          onClick={() => void setActive(m)}
                        >
                          {isActive ? 'Active' : 'Load'}
                        </Button>
                        <Button size="xs" variant="ghost" icon={<Eye size={12} />} onClick={() => setDetailId(m.id)}>
                          Details
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )
          ) : (
            <Card>
              <CardBody>
                <EmptyState
                  icon={<Database />}
                  title="No models are actually installed"
                  description="Phase 1 of this prototype ships with zero model weights on disk. The list below would show installed runtimes once the backend exists; for now even records marked installed in the data are false. Browse the mock catalog to see what could be added."
                  action={
                    <Button variant="primary" icon={<ArrowRight size={14} />} onClick={() => setTab('catalog')}>
                      Browse the mock catalog
                    </Button>
                  }
                />
              </CardBody>
            </Card>
          )
        ) : (
          <Card>
            <CardHeader
              title="Catalog"
              subtitle="Metadata is mock — sizes and RAM needs are estimates, not measurements"
              actions={
                compareIds.length > 0 ? (
                  <Button size="xs" variant="ghost" icon={<X size={12} />} onClick={() => setCompareIds([])}>
                    Clear selection ({compareIds.length})
                  </Button>
                ) : (
                  <span className="text-2xs text-ink-faint">tick up to 3 rows to compare</span>
                )
              }
            />
            {catalogRows.length === 0 ? (
              <EmptyState
                title="No models match"
                description={`Nothing in the mock catalog matches "${search.trim()}" by name, family, or tag.`}
                action={
                  <Button variant="secondary" onClick={() => setSearch('')}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <div>
                {/* column header */}
                <div className="hidden grid-cols-[24px_minmax(0,2fr)_repeat(4,minmax(0,1fr))_72px_32px] items-center gap-3 border-t border-surface-line px-4 py-2 text-2xs font-bold uppercase tracking-widest text-ink-faint lg:grid">
                  <span aria-hidden />
                  <span>Model</span>
                  <span>Params · Quant</span>
                  <span>Context</span>
                  <span>Disk</span>
                  <span>Est. RAM</span>
                  <span>Updated</span>
                  <span aria-hidden />
                </div>
                <ul className="divide-y divide-surface-line">
                  {catalogRows.map((m) => {
                    const isActive = m.id === activeModelId;
                    const compat = hardwareCompat(m);
                    const checked = compareIds.includes(m.id);
                    const compareFull = !checked && compareIds.length >= MAX_COMPARE;
                    return (
                      <li
                        key={m.id}
                        className={cn(
                          'grid grid-cols-[24px_minmax(0,2fr)_auto_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-line/25 lg:grid-cols-[24px_minmax(0,2fr)_repeat(4,minmax(0,1fr))_72px_32px]',
                          isActive && 'bg-accent/[0.07]',
                        )}
                      >
                        <Tooltip
                          content={
                            compareFull
                              ? `Compare holds at most ${MAX_COMPARE} models — untick one first`
                              : 'Select for side-by-side comparison'
                          }
                          side="top"
                        >
                          <span className={cn(compareFull && 'cursor-not-allowed')}>
                            <Checkbox checked={checked} disabled={compareFull} onChange={(v) => toggleCompare(m.id, v)} />
                          </span>
                        </Tooltip>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn('truncate text-xs font-semibold', isActive ? 'text-accent' : 'text-ink-primary')}>
                              {m.name}
                            </p>
                            {isActive && (
                              <Badge tone="accent" dot>
                                active
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 flex items-center gap-1.5 truncate text-2xs text-ink-faint">
                            <span>{m.family}</span>
                            <span aria-hidden>·</span>
                            <span className="mono-num">v{m.version}</span>
                            <span aria-hidden>·</span>
                            <Tooltip
                              content={
                                <>
                                  <p className="font-semibold">{compat.label}</p>
                                  <p className="mt-0.5">{compat.note}</p>
                                </>
                              }
                              side="top"
                            >
                              <span className="inline-flex items-center gap-1">
                                <StatusDot tone={compat.tone} />
                                <span className={cn(compat.tone === 'ok' ? 'text-state-ok' : compat.tone === 'warn' ? 'text-state-warn' : 'text-state-err')}>
                                  fit
                                </span>
                              </span>
                            </Tooltip>
                          </p>
                        </div>

                        <span className="mono-num hidden text-2xs text-ink-secondary lg:block">
                          {m.paramsB}B · {m.quantization}
                        </span>
                        <span className="mono-num hidden text-2xs text-ink-secondary lg:block">
                          {m.contextWindow.toLocaleString()}
                        </span>
                        <span className="mono-num text-2xs text-ink-secondary">{formatBytes(m.sizeGB)}</span>
                        <span className="mono-num hidden text-2xs text-ink-secondary lg:block">{m.ramGB} GB</span>
                        <span className="mono-num hidden text-2xs text-ink-faint xl:block">{fmtDate(m.updatedAt)}</span>

                        <Menu
                          triggerLabel={`Actions for ${m.name}`}
                          trigger={
                            <span className="rounded p-1 text-ink-faint hover:text-ink-primary">
                              <MoreHorizontal size={14} />
                            </span>
                          }
                          items={rowMenu(m)}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Card>
        )}

        {/* Sticky compare bar */}
        {tab === 'catalog' && compareIds.length >= 2 && (
          <div className="sticky bottom-0 z-30 flex flex-wrap items-center gap-3 rounded-card border border-accent/30 bg-surface-overlay/95 px-4 py-3 shadow-pop backdrop-blur">
            <GitCompare size={15} className="shrink-0 text-accent" />
            <p className="min-w-0 flex-1 truncate text-xs text-ink-secondary">
              Comparing <strong className="text-ink-primary">{compareModels.map((m) => m.name).join(', ')}</strong>
            </p>
            <Button size="xs" variant="ghost" onClick={() => setCompareIds([])}>
              Clear
            </Button>
            <Button size="sm" variant="primary" icon={<GitCompare size={13} />} onClick={() => setCompareOpen(true)}>
              Compare
            </Button>
          </div>
        )}
      </div>

      {/* Download (simulated) modal */}
      <Modal
        open={downloadModel !== null}
        onClose={() => setDownloadId(null)}
        title={downloadModel ? `Download ${downloadModel.name}` : 'Download'}
        subtitle="Simulated action — included to define the Phase 2 contract"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDownloadId(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Download size={13} />}
              onClick={() => {
                setDownloadId(null);
                toast('Downloads are not implemented yet (M2/M3)', 'warning');
              }}
            >
              Start download
            </Button>
          </>
        }
      >
        {downloadModel && (
          <div className="space-y-4">
            <div className="rounded-card border border-state-warn/30 bg-state-warn/10 p-3">
              <p className="text-xs font-semibold text-state-warn">Size warning (mock estimate)</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                Would download ~{formatBytes(downloadModel.sizeGB)} and need ~{downloadModel.ramGB} GB runtime RAM on
                top of ~5 GB for Windows. {hardwareCompat(downloadModel).label} on this machine.
              </p>
            </div>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
              <Info size={14} className="mt-0.5 shrink-0 text-ink-faint" />
              This is a UI prototype — no download will occur. Files, checksums and placement are backend concerns for
              Phase 2.
            </p>
          </div>
        )}
      </Modal>

      {/* Details modal */}
      <Modal
        open={detailModel !== null}
        onClose={() => setDetailId(null)}
        title={detailModel?.name ?? 'Model details'}
        subtitle={detailModel ? `${detailModel.family} family · version ${detailModel.version}` : undefined}
        size="lg"
        footer={
          detailModel ? (
            <>
              <Button variant="ghost" onClick={() => setDetailId(null)}>
                Close
              </Button>
              {detailModel.id !== activeModelId && (!live || isOnDisk(detailModel.id)) && (
                <Button
                  variant="primary"
                  icon={<Star size={13} />}
                  onClick={() => {
                    setActive(detailModel);
                    setDetailId(null);
                  }}
                >
                  Set active
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {detailModel && (
          <div className="space-y-4">
            <Badge tone={hardwareCompat(detailModel).tone} dot>
              {hardwareCompat(detailModel).label}
            </Badge>
            <p className="text-xs leading-relaxed text-ink-muted">{hardwareCompat(detailModel).note}</p>
            <div className="rounded-card border border-surface-line p-3">
              <KeyValue k="Parameters" v={`${detailModel.paramsB}B`} mono />
              <KeyValue k="Quantization" v={detailModel.quantization} mono />
              <KeyValue k="Context window" v={`${detailModel.contextWindow.toLocaleString()} tokens`} mono />
              <KeyValue k="Disk size" v={formatBytes(detailModel.sizeGB)} mono />
              <KeyValue k="Est. runtime RAM" v={`${detailModel.ramGB} GB`} mono />
              <KeyValue k="GPU recommended" v={detailModel.gpuRecommended ? 'yes' : 'no'} />
              <KeyValue k="Version" v={detailModel.version} mono />
              <KeyValue k="Updated" v={detailModel.updatedAt} mono />
              <KeyValue
                k="Installed"
                v={detailModel.installed ? 'yes' : live ? 'no — not on disk (mock catalog entry)' : 'no — no weights in this prototype'}
              />
            </div>
            <div>
              <p className="label">Description</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{detailModel.description}</p>
            </div>
            <div>
              <p className="label">Tags</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {detailModel.tags.map((t) => (
                  <span key={t} className="rounded-md border border-surface-line bg-surface-base px-2 py-0.5 text-2xs text-ink-secondary">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Compare modal */}
      <Modal
        open={compareOpen && compareModels.length >= 2}
        onClose={() => setCompareOpen(false)}
        title={`Compare ${compareModels.length} models`}
        subtitle="Side-by-side mock metadata — differences are informative, not measurements"
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCompareOpen(false)}>
              Close
            </Button>
            <Button
              variant="secondary"
              icon={<X size={13} />}
              onClick={() => {
                setCompareOpen(false);
                setCompareIds([]);
              }}
            >
              Clear selection
            </Button>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead>
              <tr className="border-b border-surface-line">
                <th className="py-2 pr-3 text-2xs font-bold uppercase tracking-widest text-ink-faint">Attribute</th>
                {compareModels.map((m) => (
                  <th key={m.id} className="py-2 pr-3 font-semibold text-ink-primary">
                    <span className="flex items-center gap-1.5">
                      {m.id === activeModelId && <StatusDot tone="accent" />}
                      <span className="truncate">{m.name}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-line">
              {(
                [
                  ['Family', (m: ModelRecord) => m.family],
                  ['Parameters', (m: ModelRecord) => `${m.paramsB}B`],
                  ['Quantization', (m: ModelRecord) => m.quantization],
                  ['Context window', (m: ModelRecord) => `${m.contextWindow.toLocaleString()} tok`],
                  ['Disk size', (m: ModelRecord) => formatBytes(m.sizeGB)],
                  ['Est. runtime RAM', (m: ModelRecord) => `${m.ramGB} GB`],
                  ['Machine fit', (m: ModelRecord) => <Badge key="fit" tone={hardwareCompat(m).tone} dot>{hardwareCompat(m).label}</Badge>],
                  ['GPU recommended', (m: ModelRecord) => (m.gpuRecommended ? 'yes' : 'no')],
                  ['Version', (m: ModelRecord) => m.version],
                  ['Updated', (m: ModelRecord) => m.updatedAt],
                ] as [string, (m: ModelRecord) => ReactNode][]
              ).map(([label, cell]) => (
                <tr key={label}>
                  <td className="py-2 pr-3 text-2xs font-medium uppercase tracking-wide text-ink-faint">{label}</td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="py-2 pr-3 text-ink-secondary">
                      {cell(m)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </WorkArea>
  );
}
