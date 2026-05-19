import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
// WR-H2 — Logout sırasında client cache temizlenir (cross-user PII leak önlenir).
import { clearClientCache } from './clientCache';

/**
 * AuthContext — Supabase session + DB kullanıcı bilgisi (rol dahil).
 *
 * Akış:
 *  1. App boot → supabase.auth.getSession() → mevcut oturumu öğren
 *  2. Oturum varsa /api/auth/me ile DB User satırını çek (rol bilgisi burada)
 *  3. supabase.auth.onAuthStateChange ile login/logout dinle
 *  4. 401 dispatchEvent'inde session'ı sıfırla
 */

export type UserRole = 'Agent' | 'Backoffice' | 'Supervisor' | 'CSM' | 'Admin' | 'SystemAdmin';

export interface AppUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  /** Person bağlantısı — Agent KPI'ları (Bana Atanan vb.) için frontline kullanıcılarda dolu, SystemAdmin'de null. */
  personId: string | null;
}

interface AuthState {
  status: 'loading' | 'unauthenticated' | 'authenticated' | 'error';
  user: AppUser | null;
  error: string | null;
}

interface AuthApi extends AuthState {
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthApi>({
  status: 'loading',
  user: null,
  error: null,
  signOut: async () => {},
  refresh: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

async function fetchMe(token: string): Promise<AppUser | { error: string }> {
  const r = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    let msg = `me ${r.status}`;
    try {
      const body = await r.json();
      msg = body.message ?? msg;
    } catch {
      // ignore
    }
    return { error: msg };
  }
  return r.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    error: null,
  });

  async function loadFromSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      // WR-H2 — Hata durumunda da PII cache'te kalmamalı.
      clearClientCache();
      setState({ status: 'error', user: null, error: error.message });
      return;
    }
    const session = data.session;
    if (!session) {
      // WR-H2 — Session yoksa (sign-out sonrası, expired) cache temizlenir.
      clearClientCache();
      setState({ status: 'unauthenticated', user: null, error: null });
      return;
    }
    const me = await fetchMe(session.access_token);
    if ('error' in me) {
      // Auth user var ama DB'de User yok ya da pasif → logout
      // WR-H2 (review fix) — bu sign-out yolu da cache temizler.
      clearClientCache();
      await supabase.auth.signOut();
      setState({ status: 'unauthenticated', user: null, error: me.error });
      return;
    }
    setState({ status: 'authenticated', user: me, error: null });
  }

  async function signOut() {
    // WR-H2 — Logout client cache'i temizle; sonraki kullanıcı önceki PII'ye dokunmasın.
    clearClientCache();
    await supabase.auth.signOut();
    setState({ status: 'unauthenticated', user: null, error: null });
  }

  useEffect(() => {
    void loadFromSession();

    // Login/logout event'lerinde state'i tazele.
    // WR-H2 (review fix) — SIGNED_OUT / USER_DELETED gibi event'lerde cache
    // temizliği loadFromSession() içinde "session yoksa clearClientCache()"
    // dalı tarafından idempotent şekilde garantilenir.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // SIGNED_OUT veya session null gelirse cache'i hemen temizle —
      // loadFromSession bekleyemez; sonraki render'da fetch tetiklenirse
      // cache hit eski oturumdan PII verebilir.
      if (event === 'SIGNED_OUT' || !session) {
        clearClientCache();
      }
      void loadFromSession();
    });

    // 401 → otomatik logout
    const onUnauth = () => {
      void signOut();
    };
    window.addEventListener('app:unauthenticated', onUnauth);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener('app:unauthenticated', onUnauth);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        signOut,
        refresh: loadFromSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
