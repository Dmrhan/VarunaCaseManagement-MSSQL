import type { ReactNode } from 'react';
import { useAuth } from '@/services/AuthContext';
import { LoginPage } from '@/features/auth/LoginPage';

/**
 * AuthGate — children'ı render etmeden önce oturum kontrolü yapar.
 *  - loading → spinner
 *  - unauthenticated → LoginPage
 *  - authenticated → children
 *
 * LookupGate'in DIŞINDA olmalı: lookup'lar sadece login olmuş kullanıcı için çekilir.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, error } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-ndark-bg">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p className="text-sm text-slate-500 dark:text-ndark-muted">Oturum kontrolü…</p>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginPage />;
  }

  if (status === 'error') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-ndark-bg">
        <div className="max-w-md rounded-md border border-rose-200 bg-rose-50 p-6 text-center">
          <p className="mb-2 font-medium text-rose-900">Oturum hatası</p>
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
