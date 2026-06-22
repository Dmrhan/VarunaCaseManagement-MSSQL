/**
 * AloTech Click2 — outbound cagri yonetimi.
 * Base: POST https://api.alo-tech.com/v3/click2/...
 * Auth: Bearer token + Tenant header (client.js halleder).
 */
import { alotechFetch } from './client.js';

async function post(path, body) {
  const res = await alotechFetch(path, { method: 'POST', body });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  if (!res.ok) throw new Error(`AloTech ${path} basarisiz: HTTP ${res.status} — ${text.slice(0, 300)}`);
  return data;
}

/**
 * Click2Call — bir agent'in (user_email) bir numarayi (phone_number) aramasini baslatir.
 * @param {object} p
 * @param {string} p.userEmail      arayacak agent e-postasi (zorunlu)
 * @param {string} p.phoneNumber    aranacak numara (zorunlu)
 * @param {string} [p.transactionId] Varuna vaka no — cagriyi vakaya baglamak icin
 * @param {string} [p.accountCode]   Varuna musteri/hesap kodu
 * @param {string} [p.hangupUrl]     cagri bitince AloTech'in cagiracagi URL (webhook)
 * @param {object} [p.customVariables] ek anahtar/deger (or. caseId)
 * @param {boolean} [p.masked]
 */
export async function click2Call({ userEmail, phoneNumber, transactionId, accountCode, hangupUrl, customVariables, masked }) {
  if (!userEmail || !phoneNumber) throw new Error('click2Call: user_email ve phone_number zorunlu');
  const body = { user_email: userEmail, phone_number: phoneNumber };
  if (transactionId) body.transaction_id = transactionId;
  if (accountCode) body.account_code = accountCode;
  if (hangupUrl) body.hangup_url = hangupUrl;
  if (customVariables) body.custom_variables = customVariables;
  if (masked !== undefined) body.masked = masked;
  return post('/v3/click2/call', body); // -> { message }
}

/** Aktif cagriyi beklet / devam ettir / sonlandir. Parametre seti panele gore genisletilir. */
export async function click2Hold(body) { return post('/v3/click2/hold', body); }
export async function click2Unhold(body) { return post('/v3/click2/unhold', body); }
export async function click2Hang(body) { return post('/v3/click2/hang', body); }
