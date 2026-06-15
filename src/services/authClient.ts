/**
 * Local auth istemcisi (Faz 3) — Supabase JS client'ın yerini aldı.
 *
 * Token'lar localStorage'da saklanır; access token süresi dolmaya yakınsa
 * getAccessToken() otomatik refresh dener (tek uçuş — eşzamanlı çağrılar
 * aynı promise'i bekler). Refresh de düşerse oturum kapatılır.
 *
 * Olaylar:
 *  - 'varuna:auth-changed'  → login/logout sonrası AuthContext'i tazeler
 *  - 'app:unauthenticated'  → apiFetch 401 yakalayınca dispatch eder (mevcut desen)
 */

const STORAGE_KEY = 'varuna.auth.v1';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  personId: string | null;
  mustChangePassword: boolean;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

function readTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.accessToken === 'string' && typeof parsed?.refreshToken === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeTokens(tokens: StoredTokens | null) {
  try {
    if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private mode vs. — oturum bellekte sürer, yenilemede düşer
  }
}

/** JWT payload'ından exp (saniye) okur; bozuksa null. */
function tokenExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

const EXPIRY_MARGIN_SEC = 30;

function isExpiringSoon(token: string): boolean {
  const exp = tokenExp(token);
  if (exp == null) return true; // okunamayan token'a güvenme
  return exp * 1000 - Date.now() < EXPIRY_MARGIN_SEC * 1000;
}

let refreshInFlight: Promise<StoredTokens | null> | null = null;

async function refreshTokens(refreshToken: string): Promise<StoredTokens | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const r = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!r.ok) return null;
        const body = await r.json();
        if (!body?.accessToken || !body?.refreshToken) return null;
        const next = { accessToken: body.accessToken, refreshToken: body.refreshToken };
        writeTokens(next);
        return next;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/**
 * apiFetch için: geçerli access token'ı döner; süresi dolmak üzereyse
 * refresh dener. Oturum yoksa/düştüyse null.
 */
export async function getAccessToken(): Promise<string | null> {
  const tokens = readTokens();
  if (!tokens) return null;
  if (!isExpiringSoon(tokens.accessToken)) return tokens.accessToken;
  const refreshed = await refreshTokens(tokens.refreshToken);
  if (refreshed) return refreshed.accessToken;
  writeTokens(null);
  return null;
}

/** Oturum var mı (senkron; geçerlilik garantisi değil, varlık kontrolü). */
export function hasSession(): boolean {
  return readTokens() !== null;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(body?.message ?? 'Giriş başarısız.');
  }
  writeTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken });
  window.dispatchEvent(new CustomEvent('varuna:auth-changed'));
  return body.user as AuthUser;
}

export async function logout(): Promise<void> {
  const tokens = readTokens();
  writeTokens(null);
  if (tokens) {
    // Best-effort; stateless backend için sadece simetri
    void fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    }).catch(() => undefined);
  }
  window.dispatchEvent(new CustomEvent('varuna:auth-changed'));
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<AuthUser> {
  const token = await getAccessToken();
  if (!token) throw new Error('Oturum bulunamadı. Tekrar giriş yapın.');
  const r = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(body?.message ?? 'Şifre güncellenemedi.');
  }
  // Yeni token çifti döner — mustChangePassword temizlenmiş claim'lerle devam
  writeTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken });
  window.dispatchEvent(new CustomEvent('varuna:auth-changed'));
  return body.user as AuthUser;
}
