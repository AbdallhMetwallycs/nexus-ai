import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  HardDrive,
  Loader2,
  MemoryStick,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { DownloadSnapshot, ModelCatalog } from '../../contract/ipc';
import { usePlatform } from '../../state/PlatformContext';
import { Button, Progress } from '../ui';
import { Logo } from '../common/Logo';
import { cn, formatSize } from '../../lib/utils';
import { useModelDownload } from './useModelDownload';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function gib(mb: number): string {
  return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
}

function percent(snapshot: DownloadSnapshot): number {
  if (snapshot.total <= 0) return 0;
  return Math.min(100, Math.max(0, (snapshot.received / snapshot.total) * 100));
}

/** Where a catalogue URL came from, for the licence line: `huggingface.co`. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The repository page behind a `…/resolve/<ref>/<file>` download URL. */
function modelCardUrl(url: string): string {
  return url.replace(/\/resolve\/.*$/, '');
}

/* ------------------------------------------------------------------ */
/* Gate                                                                */
/* ------------------------------------------------------------------ */

/**
 * The first-run gate. It is deliberately outside the application shell:
 *
 *  - a browser build never sees it (`live` is false), so the Phase 1 UI is untouched;
 *  - a Tauri build reads the pinned catalogue from the core and, when nothing is
 *    installed, offers exactly the model the machine measurement recommends;
 *  - while the answer is being read it shows a measuring screen rather than the app,
 *    because a shell with no model is the one state this build must not pretend about.
 */
export function FirstRunGate() {
  const { live, firstRun, catalog, catalogLoading, catalogError, dismissFirstRun, refreshModels } =
    usePlatform();

  if (!live) return null;
  if (catalog === null) {
    if (catalogError !== null) {
      return <MeasureFailed message={catalogError} onRetry={() => void refreshModels()} />;
    }
    if (catalogLoading) return <Measuring />;
    return null;
  }
  if (!firstRun) return null;
  return (
    <FirstRunScreen catalog={catalog} onDismiss={dismissFirstRun} onReady={refreshModels} />
  );
}

/** The shell's own honesty when the owner chose "later". */
export function ModelMissingBanner() {
  const { live, modelMissing } = usePlatform();
  const navigate = useNavigate();
  if (!live || !modelMissing) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-state-warn/30 bg-state-warn/10 px-4 py-1.5 text-2xs text-state-warn"
    >
      <TriangleAlert size={12} className="shrink-0" />
      <span>
        No model is installed, so Chat will refuse to answer instead of inventing one. Everything
        still stays on this machine.
      </span>
      <button
        onClick={() => navigate('/models')}
        className="ml-auto shrink-0 font-semibold underline underline-offset-2 hover:text-ink-primary"
      >
        Open Model Manager
      </button>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface-base">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-6 py-10">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={34} />
          <div>
            <p className="text-sm font-semibold text-ink-primary">NEXUS AI</p>
            <p className="text-2xs text-ink-muted">Local AI · nothing leaves this machine</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Measuring() {
  return (
    <Frame>
      <div className="flex items-center gap-3 text-sm text-ink-secondary">
        <Loader2 size={16} className="animate-spin text-accent" />
        Reading this machine's RAM, cores and free disk…
      </div>
    </Frame>
  );
}

function MeasureFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Frame>
      <div className="card max-w-xl space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
          <TriangleAlert size={15} className="text-state-err" />
          This machine could not be measured
        </h2>
        <p className="text-xs leading-5 text-ink-secondary">{message}</p>
        <p className="text-2xs leading-4 text-ink-muted">
          Without the measurement there is no honest recommendation, so no model is offered here.
        </p>
        <Button variant="secondary" onClick={onRetry} icon={<Loader2 size={14} />}>
          Measure again
        </Button>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* The welcome screen                                                  */
/* ------------------------------------------------------------------ */

function FirstRunScreen({
  catalog,
  onDismiss,
  onReady,
}: {
  catalog: ModelCatalog;
  onDismiss: () => void;
  onReady: () => Promise<unknown>;
}) {
  const { snapshot, active, starting, error, start, cancel } = useModelDownload(
    onReady,
    catalog.download,
  );
  const [accepted, setAccepted] = useState(false);

  const recommended =
    catalog.models.find((m) => m.id === catalog.recommended) ?? catalog.models[0];
  const larger = catalog.models
    .filter((m) => m.minTotalRamMb > recommended.minTotalRamMb)
    .sort((a, b) => a.minTotalRamMb - b.minTotalRamMb)[0];

  const failed = snapshot.state === 'failed' || error !== null;
  const done = snapshot.state === 'done';

  return (
    <Frame>
      <h1 className="text-xl font-semibold leading-7 text-ink-primary">
        Welcome. Let's install the model this machine can run.
      </h1>
      <p className="mt-2 max-w-2xl text-xs leading-5 text-ink-secondary">
        The installer does not contain a model, so the app downloads exactly one file — the one
        that fits the hardware below — after you accept its licence. It comes from the publisher's
        official mirror over HTTPS and is checked against a pinned SHA-256 before it becomes a
        model.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {/* This machine */}
        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-ink-primary">This machine</h2>
          <dl className="space-y-2 text-xs">
            <Row
              icon={<MemoryStick size={13} className="text-accent" />}
              label="RAM"
              value={`${gib(catalog.totalRamMb)} total · ${gib(catalog.freeRamMb)} free`}
            />
            <Row
              icon={<Cpu size={13} className="text-accent" />}
              label="CPU"
              value={`${catalog.cores} physical cores`}
            />
            <Row
              icon={<HardDrive size={13} className="text-accent" />}
              label="Free disk"
              value={formatSize(catalog.freeDiskBytes)}
            />
          </dl>
          <p className="break-all border-t border-surface-line pt-2 text-2xs leading-4 text-ink-faint">
            Models folder
            <span className="mono-num ml-1 text-ink-muted">{catalog.modelsFolder}</span>
          </p>
        </div>

        {/* Recommendation */}
        <div className="card space-y-3 border-accent/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-primary">Recommended</h2>
            <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-accent">
              Best fit
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-primary">{recommended.label}</p>
            <p className="mono-num mt-0.5 text-2xs text-ink-muted">
              {formatSize(recommended.bytes)} · {recommended.contextTokens.toLocaleString()} token
              context
            </p>
          </div>
          <p className="text-2xs leading-4 text-ink-secondary">
            {recommended.minTotalRamMb > 0
              ? `Chosen because this machine reports ${gib(catalog.totalRamMb)} of RAM, which meets the ${gib(recommended.minTotalRamMb)} this model needs.`
              : `Chosen because this machine reports ${gib(catalog.totalRamMb)} of RAM${
                  larger ? `, below the ${gib(larger.minTotalRamMb)} the larger model needs` : ''
                }. A smaller model is the honest fit here.`}
          </p>
          <p className="break-all text-2xs leading-4 text-ink-faint">
            From{' '}
            <a
              href={modelCardUrl(recommended.url)}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              {hostOf(recommended.url)} <ExternalLink size={10} className="inline" />
            </a>
          </p>
        </div>
      </div>

      {/* Licence */}
      <div className="card mt-4 space-y-3 p-4">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            disabled={active || starting}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-surface-line bg-surface-base text-accent accent-[#0284C7]"
          />
          <span className="text-xs leading-5 text-ink-secondary">
            I have read and accept the{' '}
            <a
              href={recommended.licenseUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent hover:underline"
            >
              {recommended.license} <ExternalLink size={10} className="inline" />
            </a>{' '}
            that governs this file and any model derived from it.
          </span>
        </label>
        <p className="flex items-start gap-1.5 text-2xs leading-4 text-ink-faint">
          <ShieldCheck size={12} className="mt-0.5 shrink-0" />
          The download is the only network access NEXUS AI makes. When it is done, the app runs
          offline — no telemetry, no account, no cloud.
        </p>
      </div>

      {/* Actions and progress */}
      <div className="mt-4 space-y-3">
        {active && (
          <div className="card space-y-2 p-4">
            {snapshot.state === 'downloading' ? (
              <>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium text-ink-primary">
                    Downloading {recommended.fileName}
                  </span>
                  <span className="mono-num text-ink-secondary">{Math.floor(percent(snapshot))}%</span>
                </div>
                <Progress value={percent(snapshot)} />
                <p className="mono-num text-2xs text-ink-muted">
                  {formatSize(snapshot.received)} of {formatSize(snapshot.total)}
                  {snapshot.bytesPerSec > 0 ? ` · ${formatSize(snapshot.bytesPerSec)}/s` : ''}
                </p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-xs text-ink-secondary">
                <Loader2 size={14} className="animate-spin text-accent" />
                Download complete. Verifying the file's SHA-256 against the pinned value…
              </p>
            )}
            <Button variant="ghost" size="xs" onClick={() => void cancel()}>
              Cancel download
            </Button>
          </div>
        )}

        {done && (
          <p className="flex items-center gap-2 text-xs text-state-ok">
            <CheckCircle2 size={14} /> Verified and installed. Opening NEXUS AI…
          </p>
        )}

        {failed && !active && (
          <div className="rounded-field border border-state-err/40 bg-state-err/10 px-3 py-2 text-xs leading-5 text-state-err">
            {error ?? snapshot.error ?? 'The download did not finish.'}
            <span className="mt-1 block text-2xs text-state-err/80">
              A stopped download keeps its partial file, so trying again resumes where it stopped.
            </span>
          </div>
        )}

        {snapshot.state === 'cancelled' && (
          <p className="text-xs text-ink-secondary">
            Download cancelled. The partial file was deleted; nothing was installed.
          </p>
        )}

        {!recommended.diskOk && (
          <p className="flex items-start gap-1.5 text-xs leading-5 text-state-warn">
            <TriangleAlert size={13} className="mt-1 shrink-0" />
            The models folder does not have enough free space for this file plus the safety
            reserve ({formatSize(catalog.freeDiskBytes)} free). Free space there and reload this
            screen.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="md"
            disabled={!accepted || !recommended.diskOk || active || starting || done}
            loading={starting}
            icon={<Download size={14} />}
            onClick={() => void start(recommended.id)}
          >
            {failed ? 'Retry download' : `Download ${formatSize(recommended.bytes)}`}
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={active || starting}
            onClick={onDismiss}
            icon={<ArrowRight size={14} />}
          >
            Do this later
          </Button>
        </div>
        <p className="text-2xs leading-4 text-ink-faint">
          Choosing later opens the app without a model. Chat will then refuse to answer rather
          than invent a reply, and Model Manager can install the same file at any time.
        </p>
      </div>
    </Frame>
  );
}

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-ink-muted">
        {icon}
        {label}
      </dt>
      <dd className={cn('mono-num text-right text-ink-primary')}>{value}</dd>
    </div>
  );
}
