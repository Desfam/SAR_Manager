import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const STORAGE_KEY = 'sar.theme';
const EVENT = 'sar-theme';

function read(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyStoredTheme() {
  document.documentElement.classList.toggle('light', read() === 'light');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    const sync = () => setTheme(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = read() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable: switch for this session only
    }
    document.documentElement.classList.toggle('light', next === 'light');
    setTheme(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { theme, toggle };
}
