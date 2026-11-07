import { useEffect, useState } from 'react';

/** Debounce a fast-changing value (used by search inputs over mock data). */
export function useDebouncedValue<T>(value: T, ms = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Toggle a boolean with persistence to localStorage under `key`. */
export function useLocalFlag(key: string, initial = false): [boolean, (v: boolean) => void] {
  const [flag, setFlag] = useState<boolean>(() => {
    const raw = localStorage.getItem(key);
    return raw === null ? initial : raw === '1';
  });
  const set = (v: boolean) => {
    setFlag(v);
    localStorage.setItem(key, v ? '1' : '0');
  };
  return [flag, set];
}
