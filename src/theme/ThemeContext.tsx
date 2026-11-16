import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { resolveTransport } from '../contract/client';

export type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'nexus.theme';

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const transport = useMemo(() => resolveTransport(), []);
  const live = transport.kind === 'tauri';
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' ? 'light' : 'dark'; // dark is the initial theme
  });

  useEffect(() => applyTheme(theme), [theme]);

  // On a real core the database is the record of the owner's choice; localStorage is
  // only the pre-paint hint. A failed read leaves the current theme alone.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void (async () => {
      const res = await transport.call('settings.get');
      if (cancelled || !res.ok) return;
      const stored = res.data.sections.appearance?.theme;
      if (stored === 'light' || stored === 'dark') {
        localStorage.setItem(STORAGE_KEY, stored);
        setThemeState(stored);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, transport]);

  const setTheme = useCallback(
    (t: Theme) => {
      localStorage.setItem(STORAGE_KEY, t);
      setThemeState(t);
      if (!live) return;
      void transport.call('settings.patch', { section: 'appearance', values: { theme: t } }).then((res) => {
        if (!res.ok) console.warn(`theme was applied but not saved: ${res.error.code} — ${res.error.message}`);
      });
    },
    [live, transport],
  );

  const toggleTheme = useCallback(
    () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    [theme, setTheme],
  );

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
