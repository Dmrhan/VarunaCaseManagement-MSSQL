import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getAccessToken, logout as authLogout } from './authClient';
// WR-H2 — Logout sırasında client cache temizlenir (cross-user PII leak önlenir).
import { clearClientCache } from './clientCache';
import { clearBootstrap } from './lookupBootstrap';

/**
 * AuthContext — local JWT oturumu + DB kullanıcı bilgisi (rol dahil). (Faz 3)
 *
 * Akış:
 *  1. App boot → authClient.getAccessToken() (gerekirse sessiz refresh)
 *  2. Token varsa /api/auth/me ile DB User satırını çek (rol bilgisi burada)
 *  3. 'varuna:auth-changed' (login/logout/şifre değişimi) ile state tazele
 *  4. 'app:unauthenticated' (apiFetch 401) → oturumu sıfırla
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
  /** Admin'in atadığı geçici şifreyle girişte true — AuthGate şifre değişimi zorlar. */
  mustChangePassword: boolean;
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
    const token = await getAccessToken();
    if (!token) {
      // WR-H2 — Session yoksa (sign-out sonrası, expired) cache temizlenir.
      clearClientCache();
      setState({ status: 'unauthenticated', user: null, error: null });
      return;
    }
    const me = await fetchMe(token);
    if ('error' in me) {
      // Token var ama DB'de User yok ya da pasif → logout
      // WR-H2 (review fix) — bu sign-out yolu da cache temizler.
      clearClientCache();
      await authLogout();
      setState({ status: 'unauthenticated', user: null, error: me.error });
      return;
    }
    setState({ status: 'authenticated', user: me, error: null });
  }

  async function signOut() {
    // WR-H2 — Logout client cache'i temizle; sonraki kullanıcı önceki PII'ye dokunmasın.
    clearClientCache();
    clearBootstrap();
    await authLogout();
    setState({ status: 'unauthenticated', user: null, error: null });
  }

  useEffect(() => {
    void loadFromSession();

    // Login/logout/şifre değişimi event'lerinde state'i tazele.
    const onAuthChanged = () => {
      void loadFromSession();
    };
    window.addEventListener('varuna:auth-changed', onAuthChanged);

    // 401 → otomatik logout
    const onUnauth = () => {
      void signOut();
    };
    window.addEventListener('app:unauthenticated', onUnauth);

    return () => {
      window.removeEventListener('varuna:auth-changed', onAuthChanged);
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
