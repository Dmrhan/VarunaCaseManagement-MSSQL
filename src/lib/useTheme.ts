import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'varuna-theme';

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  // Manuel tercih yoksa sistem tercihine bak
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyToDom(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

/**
 * Tema yönetimi — varuna-theme localStorage key'i ile persist edilir.
 * Sistem tercihi (`prefers-color-scheme`) sadece kullanıcı manuel seçim yapmamışsa
 * dinlenir; kullanıcı manuel seçtikten sonra bu seçim sabit kalır.
 *
 * `<html>` elementine `dark` class'ı eklenince Tailwind dark: prefix'leri devreye
 * girer. index.html'de inline script ile bu class FOUC öncesi ayarlanır.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitial);

  useEffect(() => {
    applyToDom(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* yoksay */
    }
  }, [theme]);

  // Sistem teması değişirse, manuel kayıt yoksa ona uy
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    function onChange(e: MediaQueryListEvent) {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return; // manuel tercih var → ignore
      setTheme(e.matches ? 'dark' : 'light');
    }
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  function toggle() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  return { theme, setTheme, toggle };
}
