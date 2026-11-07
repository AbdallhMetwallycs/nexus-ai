import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface TabItem {
  id: string;
  label: ReactNode;
  badge?: ReactNode;
}

interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  variant?: 'underline' | 'pill';
}

/** Keyboard: ArrowLeft/ArrowRight move between tabs (roving tabindex). */
export function Tabs({ tabs, active, onChange, className, variant = 'underline' }: TabsProps) {
  const move = (e: React.KeyboardEvent, dir: -1 | 1) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === active);
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    onChange(next.id);
    const el = (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`);
    el?.focus();
  };

  return (
    <div
      role="tablist"
      onKeyDown={(e) => move(e, e.key === 'ArrowRight' ? 1 : -1)}
      className={cn(
        'flex items-center gap-1',
        variant === 'underline' ? 'border-b border-surface-line' : 'rounded-field bg-surface-base p-1',
        className,
      )}
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            data-tab={t.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              'relative flex items-center gap-1.5 whitespace-nowrap text-xs font-medium transition-colors',
              variant === 'underline'
                ? cn(
                    '-mb-px border-b-2 px-3 py-2',
                    isActive
                      ? 'border-accent text-ink-primary'
                      : 'border-transparent text-ink-muted hover:text-ink-secondary',
                  )
                : cn(
                    'rounded-md px-2.5 py-1.5',
                    isActive ? 'bg-surface-overlay text-ink-primary shadow-card' : 'text-ink-muted hover:text-ink-secondary',
                  ),
            )}
          >
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}
