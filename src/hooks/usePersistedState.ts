import { useEffect, useState, Dispatch, SetStateAction } from 'react';

/**
 * useState backed by localStorage. SSR-safe and tolerant of storage errors
 * (e.g. private mode, quota exceeded). Falls back to the initial value when
 * the stored value is missing or unparseable.
 */
export function usePersistedState<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return initialValue;
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore (quota / disabled storage)
    }
  }, [key, value]);

  return [value, setValue];
}
