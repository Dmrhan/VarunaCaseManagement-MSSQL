import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

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
      setState({ status: 'error', user: null, error: error.message });
      return;
    }
    const session = data.session;
    if (!session) {
      setState({ status: 'unauthenticated', user: null, error: null });
      return;
    }
    const me = await fetchMe(session.access_token);
    if ('error' in me) {
      // Auth user var ama DB'de User yok ya da pasif → logout
      await supabase.auth.signOut();
      setState({ status: 'unauthenticated', user: null, error: me.error });
      return;
    }
    setState({ status: 'authenticated', user: me, error: null });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setState({ status: 'unauthenticated', user: null, error: null });
  }

  useEffect(() => {
    void loadFromSession();

    // Login/logout event'lerinde state'i tazele
    const { data: sub } = supabase.auth.onAuthStateChange((_event, _session) => {
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
