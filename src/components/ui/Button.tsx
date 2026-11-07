import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'xs' | 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-deep text-white hover:bg-accent shadow-[0_0_12px_rgba(56,189,248,0.25)] disabled:hover:bg-accent-deep',
  secondary: 'bg-surface-overlay text-ink-primary border border-surface-line hover:border-accent/40 hover:bg-surface-line/50',
  ghost: 'text-ink-secondary hover:text-ink-primary hover:bg-surface-line/40',
  danger: 'bg-red-600/90 text-white hover:bg-red-500',
  outline: 'border border-accent/50 text-accent hover:bg-accent/10',
};

const sizes: Record<ButtonSize, string> = {
  xs: 'h-6 gap-1 px-2 text-2xs rounded-md',
  sm: 'h-8 gap-1.5 px-3 text-xs rounded-field',
  md: 'h-9 gap-2 px-4 text-sm rounded-field',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'sm', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: 'default' | 'danger';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tone = 'default', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors',
        tone === 'danger'
          ? 'hover:bg-state-err/15 hover:text-state-err'
          : 'hover:bg-surface-line/50 hover:text-ink-primary',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
