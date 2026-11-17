import { useCallback, useState } from 'react';
import { Download, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { CatalogModel } from '../../contract/ipc';
import { usePlatform } from '../../state/PlatformContext';
import { Badge, Button, Card, CardBody, CardHeader, Progress, useToast } from '../ui';
import { formatSize } from '../../lib/utils';import { useModelDownload } from './useModelDownload';

/**
 * The recovery path behind the first-run screen's "Do this later".
 *
 * It is the same pinned catalogue and the same single download slot as the welcome
 * screen — no second implementation, no second URL. Every row states whether this
 * machine meets the model's RAM floor, from the core's own measurement.
 */
export function InstallPanel() {
  const { catalog, refreshModels } = usePlatform();
  const { toast } = useToast();
  const [accepted, setAccepted] = useState(false);

  const onDone = useCallback(async () => {
    await refreshModels();
    toast('Model downloaded, verified against its pinned SHA-256, and installed.', 'success');
  }, [refreshModels, toast]);

  const { snapshot, active, starting, error, start, cancel } = useModelDownload(
    onDone,
    catalog?.download,
  );

  if (!catalog) return null;
  const missing = catalog.models.filter((m) => !m.installed);
  if (missing.length === 0) return null;

  const percent =
    snapshot.total > 0 ? Math.min(100, Math.max(0, (snapshot.received / snapshot.total) * 100)) : 0;
  const runningLabel =
    snapshot.id && missing.find((m) => m.id === snapshot.id)?.label
      ? missing.find((m) => m.id === snapshot.id)!.label
      : snapshot.id;

  return (
    <Card>
      <CardHeader
        title="Install a model"
        subtitle="From the publisher's mirror over HTTPS. The file must match its pinned byte length and SHA-256 before it becomes a model."
        actions={
          <span className="text-2xs text-ink-faint">
            {formatSize(catalog.freeDiskBytes)} free in the models folder
          </span>
        }
      />
      <CardBody className="space-y-3">
        <ul className="divide-y divide-surface-line rounded-field border border-surface-line">
          {missing.map((m) => (
            <InstallRow
              key={m.id}
              model={m}
              recommended={m.id === catalog.recommended}
              accepted={accepted}
              busy={active || starting}
              runningId={snapshot.id}
              downloading={snapshot.state === 'downloading' && snapshot.id === m.id}
              onDownload={() => void start(m.id)}
            />
          ))}
        </ul>

        <label className="flex cursor-pointer items-start gap-2 text-2xs leading-4 text-ink-secondary">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            disabled={active}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-surface-line bg-surface-base text-accent accent-[#0284C7]"
          />
          <span>
            I have read and accept the{' '}
            <a
              href={missing[0].licenseUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              {missing[0].license}
            </a>{' '}
            that governs these files.
          </span>
        </label>

        {active && (
          <div className="space-y-1.5 rounded-field border border-surface-line bg-surface-base/60 p-3">
            <div className="flex items-baseline justify-between gap-2 text-2xs">
              <span className="text-ink-secondary">
                {snapshot.state === 'verifying'
                  ? `Verifying ${runningLabel}…`
                  : `Downloading ${runningLabel}`}
              </span>
              <span className="mono-num text-ink-muted">
                {snapshot.state === 'downloading' ? `${Math.floor(percent)}%` : 'SHA-256'}
              </span>
            </div>
            <Progress value={snapshot.state === 'verifying' ? 100 : percent} />
            <div className="flex items-center justify-between gap-2">
              <p className="mono-num text-2xs text-ink-faint">
                {formatSize(snapshot.received)} of {formatSize(snapshot.total)}
                {snapshot.bytesPerSec > 0 ? ` · ${formatSize(snapshot.bytesPerSec)}/s` : ''}
              </p>
              <Button variant="ghost" size="xs" onClick={() => void cancel()}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p className="text-2xs leading-4 text-state-err">{error}</p>
        )}
        {snapshot.state === 'failed' && !error && (
          <p className="text-2xs leading-4 text-state-err">
            {snapshot.error ?? 'The download did not finish.'} A stopped download keeps its
            partial file, so trying again resumes where it stopped.
          </p>
        )}
        {snapshot.state === 'cancelled' && (
          <p className="text-2xs leading-4 text-ink-muted">
            Download cancelled. The partial file was deleted; nothing was installed.
          </p>
        )}

        <p className="flex items-start gap-1.5 text-2xs leading-4 text-ink-faint">
          <ShieldCheck size={12} className="mt-0.5 shrink-0" />
          This is the only network request the app makes. Used only with your consent, once per
          file.
        </p>
      </CardBody>
    </Card>
  );
}

function InstallRow({
  model,
  recommended,
  accepted,
  busy,
  runningId,
  downloading,
  onDownload,
}: {
  model: CatalogModel;
  recommended: boolean;
  accepted: boolean;
  busy: boolean;
  runningId: string;
  downloading: boolean;
  onDownload: () => void;
}) {
  // The slot is shared with the first-run screen; a second start is refused by the core.
  const otherRunning = busy && !downloading;
  const disabled = !accepted || !model.diskOk || busy;

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-xs font-semibold text-ink-primary">{model.label}</p>
          {recommended ? (
            <Badge tone="accent" dot>
              recommended
            </Badge>
          ) : model.fits ? (
            <Badge tone="ok">fits this machine</Badge>
          ) : (
            <Badge tone="warn">needs {(model.minTotalRamMb / 1024).toFixed(0)} GB RAM</Badge>
          )}
        </div>
        <p className="mono-num mt-0.5 text-2xs text-ink-faint">
          {formatSize(model.bytes)} · {model.contextTokens.toLocaleString()} ctx ·{' '}
          {model.fileName}
        </p>
        {!model.diskOk && (
          <p className="mt-1 flex items-center gap-1 text-2xs text-state-warn">
            <TriangleAlert size={11} /> Not enough free space here for this file plus the safety
            reserve.
          </p>
        )}
        {otherRunning && (
          <p className="mt-1 text-2xs text-ink-muted">
            Another download is using the slot ({runningId}); finish or cancel it first.
          </p>
        )}
      </div>
      <Button
        size="xs"
        variant="secondary"
        disabled={disabled}
        loading={downloading}
        icon={<Download size={12} />}
        onClick={onDownload}
        title={!accepted ? 'Tick the licence box first' : undefined}
      >
        Download
      </Button>
    </li>
  );
}
