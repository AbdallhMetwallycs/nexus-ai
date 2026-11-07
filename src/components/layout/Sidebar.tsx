import { NavLink } from 'react-router-dom';
import {
  Activity,
  Bot,
  Brain,
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Library,
  MessagesSquare,
  Settings,
  Wrench,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePlatform } from '../../state/PlatformContext';
import { Logo } from '../common/Logo';

export const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/chat', label: 'AI Chat', icon: MessagesSquare },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/models', label: 'Model Manager', icon: Cpu },
  { to: '/memory', label: 'Memory Center', icon: Brain },
  { to: '/knowledge', label: 'Knowledge Base', icon: Library },
  { to: '/tools', label: 'Tools & Skills', icon: Wrench },
  { to: '/learning', label: 'Learning Lab', icon: FlaskConical },
  { to: '/internet', label: 'Internet Center', icon: Globe },
  { to: '/activity', label: 'Activity Center', icon: Activity },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = usePlatform();

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-surface-line bg-surface-raised transition-[width] duration-200',
        sidebarCollapsed ? 'w-[56px]' : 'w-[212px]',
      )}
    >
      <div className={cn('flex items-center gap-2.5 px-3 py-3.5', sidebarCollapsed && 'justify-center px-0')}>
        <Logo size={28} />
        {!sidebarCollapsed && (
          <div className="min-w-0 leading-none">
            <p className="text-sm font-extrabold tracking-wide text-ink-primary">
              NEXUS<span className="ml-1 font-semibold text-accent">AI</span>
            </p>
            <p className="mt-1 text-2xs text-ink-faint">Local Intelligence Platform</p>
          </div>
        )}
      </div>

      <nav aria-label="Primary navigation" className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={sidebarCollapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-2.5 rounded-field px-2.5 py-2 text-[13px] font-medium transition-colors',
                sidebarCollapsed && 'justify-center px-0',
                isActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-ink-secondary hover:bg-surface-line/40 hover:text-ink-primary',
              )
            }
          >
            <Icon size={16} className="shrink-0" />
            {!sidebarCollapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-surface-line p-2">
        <button
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-field px-2.5 py-2 text-xs font-medium text-ink-muted hover:bg-surface-line/40 hover:text-ink-primary',
            sidebarCollapsed && 'justify-center px-0',
          )}
        >
          {sidebarCollapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
          {!sidebarCollapsed && 'Collapse'}
        </button>
      </div>
    </aside>
  );
}
