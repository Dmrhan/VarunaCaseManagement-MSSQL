/**
 * AloTech Public API v1 — Session Key (SoftphoneJS auth icin).
 * GET https://{tenant}/api/?function=login&email={email}&app_token={app_token}
 * -> session key (10 saat gecerli). SoftphoneJS AWJS.init({ session }) ile kullanir.
 * NOT: app_token, v3 access token'dan FARKLI olabilir. Once secret_key denenir.
 */
const HOST = process.env.ALOTECH_TENANT || '';            // param-univera.alo-tech.com
const APP_TOKEN = process.env.ALOTECH_APP_TOKEN || process.env.ALOTECH_SECRET_KEY || '';

export async function getSessionKey(agentEmail, appToken = APP_TOKEN) {
  if (!HOST) throw new Error('ALOTECH_TENANT tanimsiz');
  if (!agentEmail) throw new Error('agentEmail zorunlu');
  if (!appToken) throw new Error('app_token (veya ALOTECH_SECRET_KEY) tanimsiz');
  const url = `https://${HOST}/api/?function=login&email=${encodeURIComponent(agentEmail)}&app_token=${encodeURIComponent(appToken)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { ok: res.ok, status: res.status, data, text };
}

// Session 18sa geçerli; polling her 3sn login yapmasın diye agent başına cache (17sa).
const sessionCache = new Map(); // agentEmail -> { session, expiresAt }

/** Cache'li session key. Polling/hangup/active-call için login patlamasını önler. */
export async function getCachedSession(agentEmail) {
  const c = sessionCache.get(agentEmail);
  if (c && Date.now() < c.expiresAt) return c.session;
  const r = await getSessionKey(agentEmail);
  const session = r.data?.session;
  if (session) sessionCache.set(agentEmail, { session, expiresAt: Date.now() + 17 * 60 * 60 * 1000 });
  return session || null;
}
