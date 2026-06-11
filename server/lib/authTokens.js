import jwt from 'jsonwebtoken';

/**
 * Local JWT üretimi/doğrulaması (Faz 3 — Supabase Auth yerine).
 *
 * - Access token: kısa ömürlü (default 30m), her API isteğinde Bearer olarak gelir.
 * - Refresh token: uzun ömürlü (default 7d), yalnız POST /api/auth/refresh'te kullanılır.
 *   Ayrı secret ile imzalanır; access secret sızsa bile refresh türetilemez.
 * - Stateless: sunucu tarafında oturum saklanmaz. İptal bariyeri User.isActive
 *   (verifyJwt her istekte DB'den kontrol eder) — deaktive edilen kullanıcının
 *   elindeki token'lar pratikte işe yaramaz hale gelir.
 */

function requireSecret(name) {
  const v = process.env[name];
  if (!v || v.length < 16) {
    throw new Error(`${name} .env'de tanımlı ve en az 16 karakter olmalı.`);
  }
  return v;
}

const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '30m';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, typ: 'access' },
    requireSecret('JWT_SECRET'),
    { expiresIn: ACCESS_EXPIRY },
  );
}

export function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, typ: 'refresh' },
    requireSecret('JWT_REFRESH_SECRET'),
    { expiresIn: REFRESH_EXPIRY },
  );
}

/** Geçerliyse payload, değilse null (expired/forged/yanlış tip). */
export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, requireSecret('JWT_SECRET'));
    return payload?.typ === 'access' ? payload : null;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token) {
  try {
    const payload = jwt.verify(token, requireSecret('JWT_REFRESH_SECRET'));
    return payload?.typ === 'refresh' ? payload : null;
  } catch {
    return null;
  }
}
