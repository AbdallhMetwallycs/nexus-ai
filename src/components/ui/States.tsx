import type { ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {icon && <div className="text-ink-faint [&>svg]:h-7 [&>svg]:w-7">{icon}</div>}
      <p className="text-sm font-semibold text-ink-secondary">{title}</p>
      {description && <p className="max-w-sm text-xs leading-relaxed text-ink-faint">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-10 text-xs text-ink-muted', className)}>
      <Loader2 size={15} className="animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({
  message = 'Something went wrong in this prototype.',
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-10 text-center', className)}>
      <AlertTriangle size={26} className="text-state-warn" />
      <p className="max-w-sm text-xs leading-relaxed text-ink-muted">{message}</p>
      {onRetry && (
        <Button size="xs" variant="secondary" onClick={onRetry}>
          Retry (simulated)
        </Button>
      )}
    </div>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}
