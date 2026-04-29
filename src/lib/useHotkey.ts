import { useEffect, useRef } from 'react';

type Handler = (e: KeyboardEvent) => void;

/**
 * Global tek tuş kısayolu. Input/textarea/contentEditable focus'ta tetiklenmez
 * (kullanıcı yazıyor olabilir). Modifier gerekiyorsa `opts.requireMeta` veya
 * `requireShift` kullan.
 */
export function useHotkey(
  key: string,
  handler: Handler,
  opts: { requireMeta?: boolean; requireShift?: boolean; allowInInput?: boolean } = {},
) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== key) return;
      if (opts.requireMeta && !(e.metaKey || e.ctrlKey)) return;
      if (opts.requireShift && !e.shiftKey) return;
      if (!opts.allowInInput) {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        const editable = (e.target as HTMLElement | null)?.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) return;
      }
      ref.current(e);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, opts.requireMeta, opts.requireShift, opts.allowInInput]);
}
