/**
 * AloTech Public API v3 — istemci (token alma + cache + Bearer wrapper).
 *
 * Auth: OAuth2 client credentials.
 *   POST https://api.alo-tech.com/application/access_token/
 *   Header: Tenant: <tenant>
 *   Body:   { client_id, client_secret }
 *   -> access_token (1 saat gecerli; ayni anda max 10 aktif token)
 *
 * Token CACHE'lenir: her cagride yeni token alinmaz (10 token limiti).
 * Token suresinden ~5 dk once yenilenir.
 */
const BASE_URL = process.env.ALOTECH_BASE_URL || 'https://api.alo-tech.com';
const TENANT = process.env.ALOTECH_TENANT || '';
const CLIENT_ID = process.env.ALOTECH_CLIENT_ID || '';
const SECRET = process.env.ALOTECH_SECRET_KEY || '';

function assertConfig() {
  const miss = [];
  if (!TENANT) miss.push('ALOTECH_TENANT');
  if (!CLIENT_ID) miss.push('ALOTECH_CLIENT_ID');
  if (!SECRET) miss.push('ALOTECH_SECRET_KEY');
  if (miss.length) throw new Error(`AloTech config eksik: ${miss.join(', ')} (.env)`);
}

let tokenCache = null; // { token, expiresAt }

/** Gecerli token'i dondurur; yoksa/expire ise yenisini alir. */
export async function getAccessToken({ force = false } = {}) {
  assertConfig();
  if (!force && tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const res = await fetch(`${BASE_URL}/application/access_token/`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Tenant: TENANT },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: SECRET }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AloTech token alinamadi: HTTP ${res.status} — ${text.slice(0, 300)}`);

  let data; try { data = JSON.parse(text); } catch { throw new Error(`AloTech token cevabi JSON degil: ${text.slice(0, 200)}`); }
  // Cevap alan adi dokumana gore degisebilir — yaygin varyantlari dene:
  const token = data.access_token || data.token || data.bearer || data.accessToken;
  if (!token) throw new Error(`AloTech token cevabinda access_token yok: ${JSON.stringify(data).slice(0, 300)}`);

  // 1 saat gecerli; guvenli pay icin 55 dk cache.
  tokenCache = { token, expiresAt: Date.now() + 55 * 60 * 1000, raw: data };
  return token;
}

/** Bearer + Tenant header'lariyla AloTech API cagrisi. path '/' ile baslamali. */
export async function alotechFetch(path, { method = 'GET', body, headers = {}, retryOn401 = true } = {}) {
  const token = await getAccessToken();
  const doFetch = (tok) => fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Tenant: TENANT, Authorization: `Bearer ${tok}`, ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let res = await doFetch(token);
  // 401 ise token expire olmus olabilir — bir kez zorla yenile.
  if (res.status === 401 && retryOn401) { const fresh = await getAccessToken({ force: true }); res = await doFetch(fresh); }
  return res;
}

export const alotechConfig = { BASE_URL, TENANT, hasCreds: Boolean(CLIENT_ID && SECRET) };
