import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'idle' | 'accent' | 'violet';

const tones: Record<Tone, string> = {
  ok: 'bg-state-ok/15 text-state-ok border-state-ok/30',
  warn: 'bg-state-warn/15 text-state-warn border-state-warn/30',
  err: 'bg-state-err/15 text-state-err border-state-err/30',
  info: 'bg-state-info/15 text-state-info border-state-info/30',
  idle: 'bg-state-idle/10 text-ink-secondary border-surface-line',
  accent: 'bg-accent/12 text-accent border-accent/30',
  violet: 'bg-violet/15 text-violet border-violet/30',
};

const dotTones: Record<Tone, string> = {
  ok: 'bg-state-ok',
  warn: 'bg-state-warn',
  err: 'bg-state-err',
  info: 'bg-state-info',
  idle: 'bg-state-idle',
  accent: 'bg-accent',
  violet: 'bg-violet',
};

interface BadgeProps {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = 'idle', dot, pulse, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium leading-4',
        tones[tone],
        className,
      )}
    >
      {dot && (
        <span className={cn('h-1.5 w-1.5 rounded-full', dotTones[tone], pulse && 'animate-pulse-dot')} />
      )}
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'idle', pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full', dotTones[tone], pulse && 'animate-pulse-dot', className)}
    />
  );
}
