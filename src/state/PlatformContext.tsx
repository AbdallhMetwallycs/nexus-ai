import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { MOCK_MODELS } from '../data/models';
import type { ModelRecord } from '../data/types';
import { resolveTransport } from '../contract/client';
import type { ModelRecord as CoreModelRecord } from '../contract/ipc';

/**
 * Cross-screen UI state. In a Tauri build the active model and the real model list come
 * from the core; in a browser build the Phase 1 mock catalog stays authoritative.
 */
interface PlatformState {
  /** id into MOCK_MODELS (browser) or the real registry (Tauri) */
  activeModelId: string;
  setActiveModelId: (id: string) => void;
  /** True when a real core answered the transport probe. */
  live: boolean;
  /** Real records from `model.list`; empty in the browser build. */
  coreModels: CoreModelRecord[];
  online: boolean;
  setOnline: (v: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const PlatformContext = createContext<PlatformState | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const transport = useMemo(() => resolveTransport(), []);
  const live = transport.kind === 'tauri';
  const [activeModelId, setActiveModelId] = useState('qwen2.5-coder-7b');
  const [coreModels, setCoreModels] = useState<CoreModelRecord[]>([]);
  const [online, setOnline] = useState(false); // offline-first default
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void (async () => {
      const [listed, settings] = await Promise.all([
        transport.call('model.list', { installedOnly: true, limit: 100 }),
        transport.call('settings.get'),
      ]);
      if (cancelled || !listed.ok) return;
      setCoreModels(listed.data.items);
      // The database is the record of the owner's choice; localStorage is only the hint
      // written before the database was opened.
      const stored = settings.ok ? settings.data.sections.models?.active : undefined;
      const remembered = typeof stored === 'string' ? stored : localStorage.getItem('nexus.activeModelId');
      const chosen =
        listed.data.items.find((m) => m.id === remembered) ?? listed.data.items[0] ?? null;
      if (chosen) setActiveModelId(chosen.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [live, transport]);

  const toggleSidebar = useCallback(() => setSidebarCollapsed((v) => !v), []);

  const value = useMemo(
    () => ({
      activeModelId,
      setActiveModelId,
      live,
      coreModels,
      online,
      setOnline,
      sidebarCollapsed,
      toggleSidebar,
    }),
    [activeModelId, live, coreModels, online, sidebarCollapsed, toggleSidebar],
  );
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformState {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform must be used inside PlatformProvider');
  return ctx;
}

export function useActiveModel(): ModelRecord {
  const { activeModelId, coreModels } = usePlatform();
  const real = coreModels.find((m) => m.id === activeModelId);
  if (real) {
    // Same fields the screens already read, now backed by real GGUF metadata.
    return {
      id: real.id,
      name: real.name,
      family: real.family,
      paramsB: real.paramsB,
      quantization: real.quantization,
      contextWindow: real.contextWindow,
      sizeGB: real.sizeGB,
      ramGB: real.ramGB,
      gpuRecommended: real.gpuRecommended,
      installed: real.installed,
      inCatalog: real.inCatalog,
      version: real.version,
      updatedAt: real.updatedAt,
      description: real.description,
      tags: real.tags,
    };
  }
  return MOCK_MODELS.find((m) => m.id === activeModelId) ?? MOCK_MODELS[0];
}
