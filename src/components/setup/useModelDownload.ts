import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveTransport } from '../../contract/client';
import type { DownloadSnapshot } from '../../contract/ipc';

const IDLE: DownloadSnapshot = {
  id: '',
  state: 'idle',
  received: 0,
  total: 0,
  bytesPerSec: 0,
};

/**
 * The one download slot, as the UI sees it. Both the first-run screen and Model Manager
 * use this hook so the two surfaces cannot disagree about what is running.
 *
 * The snapshot is polled (`model.downloadStatus`) because the core does not push download
 * progress events yet; 500 ms is a poll of a mutex, not a network request.
 */
export function useModelDownload(onDone: () => Promise<unknown>, seed?: DownloadSnapshot) {
  const transport = useMemo(() => resolveTransport(), []);
  // A finished snapshot is not a seed: after `done` the catalogue is refreshed and the
  // file is installed, so "done" must not reappear on the next screen mount.
  const [snapshot, setSnapshot] = useState<DownloadSnapshot>(
    seed && (seed.state === 'downloading' || seed.state === 'verifying') ? seed : IDLE,
  );
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = snapshot.state === 'downloading' || snapshot.state === 'verifying';

  useEffect(() => {
    if (!active) return;
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      const res = await transport.call('model.downloadStatus');
      if (stop) return;
      if (res.ok) {
        setSnapshot(res.data);
        if (res.data.state === 'done') {
          await onDone();
          return;
        }
        if (res.data.state === 'failed' || res.data.state === 'cancelled') return;
      }
      timer = window.setTimeout(() => void tick(), 500);
    };
    timer = window.setTimeout(() => void tick(), 500);
    return () => {
      stop = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, transport, onDone]);

  const start = useCallback(
    async (id: string) => {
      setStarting(true);
      setError(null);
      const res = await transport.call('model.download', { id });
      setStarting(false);
      if (res.ok) setSnapshot(res.data);
      else setError(res.error.message);
    },
    [transport],
  );

  const cancel = useCallback(async () => {
    const res = await transport.call('model.downloadCancel');
    if (res.ok) setSnapshot(res.data);
    else setError(res.error.message);
  }, [transport]);

  return { snapshot, active, starting, error, start, cancel };
}
