import { useLocation, useNavigate } from 'react-router-dom';
import { Cpu, Moon, Sun, Wifi, WifiOff } from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext';
import { useActiveModel, usePlatform } from '../../state/PlatformContext';
import { Badge, StatusDot, Tooltip } from '../ui';
import { NAV_ITEMS } from './Sidebar';

export function Topbar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { online, setOnline, live } = usePlatform();
  const activeModel = useActiveModel();

  const current =
    NAV_ITEMS.find((n) => pathname.startsWith(n.to)) ?? NAV_ITEMS[0];

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-surface-line bg-surface-raised/80 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-sm font-semibold text-ink-primary">{current.label}</h1>
        <Badge tone={live ? 'ok' : 'violet'} className="hidden xl:inline-flex">
          {live ? 'Local engine' : 'UI prototype · Phase 1'}
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        <Tooltip content={`Active model (${live ? 'local registry' : 'simulated'}): ${activeModel.name} — click to open Model Manager`} side="bottom">
          <button
            onClick={() => navigate('/models')}
            className="flex h-7 items-center gap-1.5 rounded-full border border-surface-line bg-surface-base px-2.5 text-2xs font-medium text-ink-secondary hover:border-accent/40 hover:text-ink-primary"
          >
            <Cpu size={12} className="text-accent" />
            <span className="max-w-[180px] truncate">{activeModel.name}</span>
          </button>
        </Tooltip>

        <Tooltip
          content={
            online
              ? 'Online mode (simulated) — internet tools may run under your permission rules. Click to go Offline.'
              : 'Offline mode — no network access. Everything local keeps working. Click to simulate Online.'
          }
          side="bottom"
        >
          <button
            onClick={() => setOnline(!online)}
            aria-pressed={online}
            className="flex h-7 items-center gap-1.5 rounded-full border border-surface-line bg-surface-base px-2.5 text-2xs font-medium text-ink-secondary hover:text-ink-primary"
          >
            {online ? <Wifi size={12} className="text-state-ok" /> : <WifiOff size={12} className="text-ink-muted" />}
            {online ? 'Online' : 'Offline'}
          </button>
        </Tooltip>

        <Tooltip content={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} side="bottom">
          <button
            onClick={toggleTheme}
            aria-label="Toggle color theme"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-surface-line bg-surface-base text-ink-secondary hover:text-ink-primary"
          >
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </Tooltip>

        <span className="hidden items-center gap-1.5 text-2xs text-ink-faint 2xl:flex">
          <StatusDot tone="idle" /> v0.1.0
        </span>
      </div>
    </header>
  );
}
