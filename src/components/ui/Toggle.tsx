import { cn } from '../../lib/utils';

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
  size?: 'sm' | 'md';
}

export function Toggle({ checked, onChange, disabled, label, size = 'md' }: ToggleProps) {
  const dims = size === 'sm' ? { w: 'w-8', h: 'h-4.5', k: 'h-3.5 w-3.5', t: 'translate-x-3.5' } : { w: 'w-10', h: 'h-6', k: 'h-4 w-4', t: 'translate-x-4' };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full border transition-colors',
        dims.w,
        size === 'sm' ? 'h-[18px]' : 'h-[22px]',
        checked ? 'border-accent/50 bg-accent-deep' : 'border-surface-line bg-surface-line/60',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      <span
        className={cn(
          'ml-0.5 inline-block rounded-full bg-white shadow transition-transform',
          dims.k,
          checked ? dims.t : 'translate-x-0',
        )}
      />
    </button>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, disabled }: CheckboxProps) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm text-ink-secondary', disabled && 'cursor-not-allowed opacity-50')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-surface-line bg-surface-base text-accent accent-[#0284C7]"
      />
      {label}
    </label>
  );
}
