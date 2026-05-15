import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/services/AuthContext';
import { LoginPage } from '@/features/auth/LoginPage';
import { SetPasswordPage } from '@/features/auth/SetPasswordPage';

/** sessionStorage'daki pending-password-setup flag'ini gozler. */
function readPendingFlag(): boolean {
  try {
    return sessionStorage.getItem('varuna.pendingPasswordSetup') === '1';
  } catch {
    return false;
  }
}

/**
 * AuthGate — children'ı render etmeden önce oturum kontrolü yapar.
 *  - loading → spinner
 *  - unauthenticated → LoginPage
 *  - authenticated + invite/recovery link tıklandı → SetPasswordPage
 *  - authenticated → children
 *
 * LookupGate'in DIŞINDA olmalı: lookup'lar sadece login olmuş kullanıcı için çekilir.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, error } = useAuth();
  // Davet/recovery link'inden gelen oturum mu? main.tsx flag'ini set etmis olur.
  // Re-render'larda sessionStorage'i tekrar oku — SetPasswordPage flag'i temizledigi
  // anda buradan da gozetlenir.
  const [pendingPasswordSetup, setPendingPasswordSetup] = useState(readPendingFlag);
  useEffect(() => {
    const tick = () => setPendingPasswordSetup(readPendingFlag());
    // 1) Diger sekmelerdeki storage event'lerini dinle
    window.addEventListener('storage', tick);
    // 2) Sayfa focus oldugunda tekrar oku (sekme degisimi sonrasi)
    window.addEventListener('focus', tick);
    // 3) SetPasswordPage flag'i temizledikten sonra dispatch eder
    window.addEventListener('varuna:password-setup-complete', tick);
    return () => {
      window.removeEventListener('storage', tick);
      window.removeEventListener('focus', tick);
      window.removeEventListener('varuna:password-setup-complete', tick);
    };
  }, []);

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

  // Authenticated AMA invite/recovery link tıklandı → şifre belirleme zorunlu
  if (status === 'authenticated' && pendingPasswordSetup) {
    return <SetPasswordPage />;
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
