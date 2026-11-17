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
import type {
  ModelCatalog as CoreModelCatalog,
  ModelRecord as CoreModelRecord,
} from '../contract/ipc';

/**
 * Cross-screen UI state. In a Tauri build the active model and the real model list come
 * from the core; in a browser build the Phase 1 mock catalog stays authoritative.
 *
 * M6 adds the pinned catalogue (`model.catalog`) here because the first-run gate and the
 * Model Manager read the same measurement: what this machine is, what it is offered, and
 * whether anything is installed. Nothing in this file invents a number the core did not
 * return.
 */
interface PlatformState {
  /** id into MOCK_MODELS (browser) or the real registry (Tauri) */
  activeModelId: string;
  setActiveModelId: (id: string) => void;
  /** True when a real core answered the transport probe. */
  live: boolean;
  /** Real records from `model.list`; empty in the browser build. */
  coreModels: CoreModelRecord[];
  /** The pinned catalogue plus this machine's RAM, cores and disk; null until answered. */
  catalog: CoreModelCatalog | null;
  /** Why the catalogue could not be read, if it could not. Never hidden. */
  catalogError: string | null;
  catalogLoading: boolean;
  /** Live build, catalogue read, nothing installed, and "later" not yet chosen. */
  firstRun: boolean;
  /** Live build, catalogue read, nothing installed — the shell keeps saying so. */
  modelMissing: boolean;
  dismissFirstRun: () => void;
  /** Re-read `model.list` and `model.catalog`; resolves to the installed records. */
  refreshModels: () => Promise<CoreModelRecord[]>;
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
  const [catalog, setCatalog] = useState<CoreModelCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(live);
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);
  const [online, setOnline] = useState(false); // offline-first default
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const refreshModels = useCallback(async (): Promise<CoreModelRecord[]> => {
    if (!live) return [];
    const listed = await transport.call('model.list', { installedOnly: true, limit: 100 });
    let items: CoreModelRecord[] = [];
    if (listed.ok) {
      items = listed.data.items;
      setCoreModels(items);
      // A freshly downloaded model must become usable without a restart. The stored
      // preference wins only when that model is actually on disk.
      if (items.length > 0) {
        setActiveModelId((current) => {
          const remembered = localStorage.getItem('nexus.activeModelId');
          if (remembered && items.some((m) => m.id === remembered)) return remembered;
          if (items.some((m) => m.id === current)) return current;
          return items[0].id;
        });
      }
    }
    const cat = await transport.call('model.catalog');
    if (cat.ok) {
      setCatalog(cat.data);
      setCatalogError(null);
    } else {
      setCatalogError(cat.error.message);
    }
    return items;
  }, [live, transport]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void (async () => {
      setCatalogLoading(true);
      const items = await refreshModels();
      const settings = await transport.call('settings.get');
      if (cancelled) return;
      setCatalogLoading(false);
      if (!settings.ok) return;
      // The database is the record of the owner's choice; localStorage is only the hint
      // written before the database was opened.
      const stored = settings.data.sections.models?.active;
      const remembered = typeof stored === 'string' ? stored : null;
      if (remembered && items.some((m) => m.id === remembered)) {
        localStorage.setItem('nexus.activeModelId', remembered);
        setActiveModelId(remembered);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, transport, refreshModels]);

  const toggleSidebar = useCallback(() => setSidebarCollapsed((v) => !v), []);
  const dismissFirstRun = useCallback(() => setFirstRunDismissed(true), []);

  const modelMissing =
    live && catalog !== null && !catalog.models.some((m) => m.installed);
  const firstRun = modelMissing && !firstRunDismissed;

  const value = useMemo(
    () => ({
      activeModelId,
      setActiveModelId,
      live,
      coreModels,
      catalog,
      catalogError,
      catalogLoading,
      firstRun,
      modelMissing,
      dismissFirstRun,
      refreshModels,
      online,
      setOnline,
      sidebarCollapsed,
      toggleSidebar,
    }),
    [
      activeModelId,
      live,
      coreModels,
      catalog,
      catalogError,
      catalogLoading,
      firstRun,
      modelMissing,
      dismissFirstRun,
      refreshModels,
      online,
      sidebarCollapsed,
      toggleSidebar,
    ],
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
