import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'coloureasy:theme';

/** What the OS is asking for, when the visitor hasn't chosen. */
const systemTheme = (): Theme =>
  window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // index.html resolves this before first paint to avoid a flash; read back
    // whatever it decided rather than working it out a second time.
    const attr = document.documentElement.dataset.theme;
    return attr === 'light' || attr === 'dark' ? attr : systemTheme();
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Private browsing can refuse storage; the theme still applies for now.
    }
  }, [theme]);

  // Follow the OS while the visitor hasn't expressed a preference of their own.
  useEffect(() => {
    let chosen = false;
    try {
      chosen = localStorage.getItem(KEY) !== null;
    } catch {
      /* treated as no preference */
    }
    if (chosen) return;

    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setTheme(media.matches ? 'light' : 'dark');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(
    () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')),
    [],
  );

  return { theme, toggle };
}
