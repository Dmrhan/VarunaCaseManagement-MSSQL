import { useEffect, useState, type ReactNode } from 'react';
import { loadBootstrap } from '@/services/lookupBootstrap';
import { USE_MOCK } from '@/services/caseService';

/**
 * Bootstrap kapısı — uygulama render olmadan önce /api/lookups/bootstrap'ı çeker.
 * USE_MOCK=true ise atlanır (mock veri zaten sync mevcut).
 *
 * Yükleme süresi sıcak DB'de < 200ms, soğuk Vercel function'da ~1.5sn.
 */
export function LookupGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(
    USE_MOCK ? 'ready' : 'loading',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (USE_MOCK) return;
    let alive = true;
    loadBootstrap()
      .then(() => alive && setState('ready'))
      .catch((e) => {
        if (!alive) return;
        setError(String(e?.message ?? e));
        setState('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-ndark-bg">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p className="text-sm text-slate-500 dark:text-ndark-muted">Veriler yükleniyor…</p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-ndark-bg">
        <div className="max-w-md rounded-md border border-rose-200 bg-rose-50 p-6 text-center">
          <p className="mb-2 font-medium text-rose-900">Uygulama yüklenemedi</p>
          <p className="mb-4 text-sm text-rose-700">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            Yeniden dene
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
