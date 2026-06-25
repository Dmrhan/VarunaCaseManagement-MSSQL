/**
 * AloTech Public API v1 — https://api.alo-tech.com/v1
 * Auth: HEADER app_token + tenant (OpenAPI securitySchemes).
 * CDR, recording, agent status, activecall (screen pop), click2* burada.
 */
const V1_BASE = process.env.ALOTECH_V1_BASE || 'https://api.alo-tech.com/v1';
const TENANT = process.env.ALOTECH_TENANT || '';
const APP_TOKEN = process.env.ALOTECH_APP_TOKEN || process.env.ALOTECH_SECRET_KEY || '';

export async function v1Fetch(path, { method = 'GET', body, appToken = APP_TOKEN, tenant = TENANT } = {}) {
  const res = await fetch(`${V1_BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      app_token: appToken,
      tenant,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { ok: res.ok, status: res.status, data, text };
}

export async function v1Ping(opts) { return v1Fetch('/system/ping', opts); }
