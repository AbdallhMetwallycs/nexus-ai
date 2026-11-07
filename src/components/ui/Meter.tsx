import { cn } from '../../lib/utils';

type Tone = 'ok' | 'warn' | 'err' | 'info' | 'accent';

const barTone: Record<Tone, string> = {
  ok: 'bg-state-ok',
  warn: 'bg-state-warn',
  err: 'bg-state-err',
  info: 'bg-state-info',
  accent: 'bg-accent',
};

const textTone: Record<Tone, string> = {
  ok: 'text-state-ok',
  warn: 'text-state-warn',
  err: 'text-state-err',
  info: 'text-state-info',
  accent: 'text-accent',
};

function toneForValue(n: number): Tone {
  if (n >= 90) return 'err';
  if (n >= 75) return 'warn';
  return 'accent';
}

interface MeterProps {
  label: string;
  value: number; // 0..100
  detail?: string;
  tone?: Tone | 'auto';
  className?: string;
}

/** Horizontal labeled meter used by Dashboard and Model Manager. */
export function Meter({ label, value, detail, tone = 'auto', className }: MeterProps) {
  const t = tone === 'auto' ? toneForValue(value) : tone;
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-ink-secondary">{label}</span>
        <span className={cn('mono-num text-xs font-semibold', textTone[t])}>{Math.round(value)}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-line/70"
      >
        <div
          className={cn('h-full rounded-full transition-all duration-500', barTone[t])}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      {detail && <p className="mono-num text-2xs text-ink-faint">{detail}</p>}
    </div>
  );
}

interface ProgressProps {
  value: number; // 0..100
  tone?: Tone;
  className?: string
}

export function Progress({ value, tone = 'accent', className }: ProgressProps) {
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-surface-line/70', className)}
    >
      <div className={cn('h-full rounded-full transition-all', barTone[tone])} style={{ width: `${value}%` }} />
    </div>
  );
}

/** Tiny inline trend chart from a number array — pure SVG, no chart library. */
export function Sparkline({
  values,
  tone = 'info',
  width = 96,
  height = 24,
  className,
}: {
  values: number[];
  tone?: Tone;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - min) / range) * (height - 4)}`)
    .join(' ');
  const stroke = { ok: '#34D399', warn: '#FBBF24', err: '#F87171', info: '#38BDF8', accent: '#38BDF8' }[tone];
  const area = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg width={width} height={height} className={cn('shrink-0', className)} aria-hidden="true">
      <polygon points={area} fill={stroke} opacity="0.1" />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
