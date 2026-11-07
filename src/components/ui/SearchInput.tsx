import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className, autoFocus }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          // Safari clears via a native button; keep both paths in sync
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="field h-8 pl-8 pr-8 text-xs [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-primary"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
