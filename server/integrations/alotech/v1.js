/**
 * AloTech Public API v1 — https://api.alo-tech.com/v1
 * Auth: HEADER app_token + tenant (OpenAPI securitySchemes).
 * CDR, recording, agent status, activecall (screen pop), click2* burada.
 */
const V1_BASE = process.env.ALOTECH_V1_BASE || 'https://api.alo-tech.com/v1';
const TENANT = process.env.ALOTECH_TENANT || '';
const APP_TOKEN = process.env.ALOTECH_APP_TOKEN || process.env.ALOTECH_SECRET_KEY || '';
// WR-PERF — AloTech dış çağrısında TIMEOUT yoktu: AloTech yavaşlar/hang olursa
// istek asılı kalıp IIS proxy timeout → 502 üretiyordu. 8sn'de abort → hızlı,
// kibar hata (throw) → caller catch'ler, 502 yerine deterministik yanıt.
const V1_TIMEOUT_MS = Number(process.env.ALOTECH_TIMEOUT_MS) || 8000;

export async function v1Fetch(path, { method = 'GET', body, appToken = APP_TOKEN, tenant = TENANT, timeoutMs = V1_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${V1_BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        app_token: appToken,
        tenant,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { _raw: text }; }
    return { ok: res.ok, status: res.status, data, text };
  } finally {
    clearTimeout(to);
  }
}

export async function v1Ping(opts) { return v1Fetch('/system/ping', opts); }
