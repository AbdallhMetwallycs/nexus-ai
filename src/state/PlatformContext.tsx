import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { MOCK_MODELS } from '../data/models';

/**
 * Minimal cross-screen UI state for the Phase 1 prototype.
 * Backend integration seam: replace these setters with store/API calls
 * in Phase 2 without touching screens.
 */
interface PlatformState {
  /** id into MOCK_MODELS — the "active model" shown in topbar/context panels */
  activeModelId: string;
  setActiveModelId: (id: string) => void;
  online: boolean;
  setOnline: (v: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const PlatformContext = createContext<PlatformState | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [activeModelId, setActiveModelId] = useState('qwen2.5-coder-7b');
  const [online, setOnline] = useState(false); // offline-first default
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = useCallback(() => setSidebarCollapsed((v) => !v), []);

  const value = useMemo(
    () => ({ activeModelId, setActiveModelId, online, setOnline, sidebarCollapsed, toggleSidebar }),
    [activeModelId, online, sidebarCollapsed, toggleSidebar],
  );
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformState {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform must be used inside PlatformProvider');
  return ctx;
}

export function useActiveModel() {
  const { activeModelId } = usePlatform();
  return MOCK_MODELS.find((m) => m.id === activeModelId) ?? MOCK_MODELS[0];
}
