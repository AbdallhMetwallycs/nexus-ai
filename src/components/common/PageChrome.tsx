import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  notice?: ReactNode;
  children?: ReactNode; // e.g. tab strip below the header
}

/** Standard header block used by every screen for visual consistency. */
export function PageHeader({ title, description, actions, notice, children }: PageHeaderProps) {
  return (
    <div className="shrink-0 border-b border-surface-line px-5 pb-0 pt-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-ink-primary">{title}</h2>
          {description && <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {notice && <div className="mt-3">{notice}</div>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

interface WorkAreaProps {
  children: ReactNode;
  contextPanel?: ReactNode; // when provided, renders the optional right rail
  className?: string;
  fill?: boolean; // fill=true => no padding, no scroll (panels manage own)
}

/** Main content (+ optional 300 px context rail) under the Topbar. */
export function WorkArea({ children, contextPanel, className, fill }: WorkAreaProps) {
  return (
    <div className={cn('flex min-h-full', fill && 'h-full', className)}>
      <div className={cn('min-w-0 flex-1', fill ? 'flex min-h-0 flex-col' : 'p-5')}>{children}</div>
      {contextPanel && (
        <div className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-surface-line bg-surface-raised/40 xl:block">
          {contextPanel}
        </div>
      )}
    </div>
  );
}

export function ContextPanelCard({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-b border-surface-line p-4', className)}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-2xs font-bold uppercase tracking-widest text-ink-muted">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function KeyValue({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-xs text-ink-muted">{k}</dt>
      <dd className={cn('min-w-0 truncate text-right text-xs font-medium text-ink-secondary', mono && 'mono-num')}>
        {v}
      </dd>
    </div>
  );
}
