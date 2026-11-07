import { useId } from 'react';
import { cn } from '../../lib/utils';

/** NEXUS wordmark glyph — the same vector as public/nexus-logo.svg. */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="NEXUS AI logo"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38BDF8" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#0B0F17" stroke="#1E293B" strokeWidth="1.5" />
      <path
        d="M20 46V18l24 28V18"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="18" r="3.2" fill="#38BDF8" />
      <circle cx="44" cy="46" r="3.2" fill="#A78BFA" />
    </svg>
  );
}
