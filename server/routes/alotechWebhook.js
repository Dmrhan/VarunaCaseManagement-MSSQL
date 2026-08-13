/**
 * AloTech GELEN ÇAĞRI WEBHOOK'ları — /api/alotech (PUBLIC, server-to-server).
 *
 * AloTech "Web-URL" webhook'u çağrı olayında buraya istek atar (next4biz'in
 * CustomerEntry.aspx karşılığı) — GET ve POST birlikte kabul edilir. AloTech'in
 * auto-fire'ı gövdesiz olabildiğinden GET, IIS reverse-proxy'nin gövdesiz-POST
 * 411'ini atlar; secret query param (secret/token) ile de verilebilir → özel
 * header gerekmez (next4biz gibi). Kullanıcı JWT'si
 * TAŞIMAZ → verifyJwt YOK; bunun yerine SHARED-SECRET ile doğrulanır
 * (ALOTECH_WEBHOOK_SECRET). Bu router /api/integrations/alotech'ten (JWT'li)
 * AYRIDIR ve app.js'de ONDAN ÖNCE, auth'suz mount edilir.
 *
 * Görev: çağrıyı yakala → müşteriyi şifreden çöz → CallLog'a yaz. Ekran-pop
 * YAPMAZ (o, mevcut /active-call polling'i CallLog'dan zenginleşerek yapar).
 *
 * Env:
 *   ALOTECH_WEBHOOK_SECRET  — AloTech "Yetkilendirme" ile aynı gizli anahtar (zorunlu)
 *   ALOTECH_COMPANY_ID      — tek tenant için Varuna companyId (ör. COMP-UNIVERA)
 */
import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import * as callLogRepo from '../db/callLogRepository.js';

const router = Router();

// Gizli anahtarı sabit-zamanlı karşılaştır (uzunluk sızıntısına karşı sha256'la).
function safeSecretEq(a, b) {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

// Header (x-alotech-secret / authorization: Bearer) VEYA param (secret/token) kabul et.
function extractSecret(req) {
  const h = req.get('x-alotech-secret') || req.get('x-webhook-secret');
  if (h) return h.trim();
  const auth = req.get('authorization');
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return (pick(req, ['secret', 'token', 'Secret', 'Token']) || '').trim();
}

// Body VEYA query'den ilk dolu alias'ı seç (AloTech param'ı query ya da body'de olabilir).
function pick(req, keys) {
  const src = { ...(req.query || {}), ...(req.body || {}) };
  for (const k of keys) {
    const v = src[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

// Secret guard — configure edilmemişse 503, yanlışsa 401.
router.use((req, res, next) => {
  const expected = process.env.ALOTECH_WEBHOOK_SECRET;
  if (!expected) return res.status(503).json({ ok: false, error: 'webhook_not_configured' });
  if (!safeSecretEq(extractSecret(req), expected)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
});

function companyId() { return process.env.ALOTECH_COMPANY_ID || null; }
// Secret query'den de gelebildiği için raw log'da maskele (CallLog.raw'a sızmasın).
const SECRET_KEYS = new Set(['secret', 'token', 'Secret', 'Token']);
const maskRaw = (req) => {
  try {
    const strip = (o) => { const c = { ...(o || {}) }; for (const k of Object.keys(c)) if (SECRET_KEYS.has(k)) c[k] = '***'; return c; };
    return JSON.stringify({ q: strip(req.query), b: strip(req.body) }).slice(0, 4000);
  } catch { return null; }
};

/**
 * POST /api/alotech/incoming-call-start
 * AloTech makroları (alias'lı): CustomerPassword, call_callerid|MobilePhoneNumber,
 * call_activecallkey|CallID, call_agent_email|AgentID, queue.
 */
async function handleCallStart(req, res) {
  try {
    const cid = companyId();
    if (!cid) return res.status(503).json({ ok: false, error: 'company_not_configured' });
    const callId = pick(req, ['call_activecallkey', 'CallID', 'callId', 'activecallkey']);
    if (!callId) return res.status(400).json({ ok: false, error: 'callId_required' });
    const customerPassword = pick(req, ['CustomerPassword', 'customerPassword', 'sifre', 'password']);
    const callerId = pick(req, ['call_callerid', 'MobilePhoneNumber', 'callerid', 'callerId']);
    const agentEmail = (pick(req, ['call_agent_email', 'AgentID', 'agentEmail']) || '').toLowerCase() || null;
    const queue = pick(req, ['call_queue', 'queue', 'Queue']);

    // Şifreden müşteriyi çöz (companyId-scoped, exact). Yoksa null — callerid fallback frontend'de.
    const account = customerPassword ? await callLogRepo.resolveAccountByPassword(cid, customerPassword) : null;

    await callLogRepo.upsertOnStart({
      companyId: cid, callId, callerId, customerPassword, agentEmail, queue,
      direction: 'inbound', matchedAccountId: account?.id ?? null, raw: maskRaw(req),
    });
    // AloTech'e minimal cevap (santral API paritesi).
    return res.json({ ok: true, matched: !!account, accountId: account?.id ?? null });
  } catch (err) {
    console.error('[alotech:webhook:start]', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
}
// GET + POST birlikte kayıtlı. AloTech Web-URL auto-fire'ı gövdesiz olabildiğinden
// GET, IIS'in gövdesiz-POST 411'ini atlar; secret query'den de kabul edilir (özel
// header yok → LocalProtocolError yok). next4biz CustomerEntry.aspx tarzı drop-in.
router.get('/incoming-call-start', handleCallStart);
router.post('/incoming-call-start', handleCallStart);

/**
 * POST /api/alotech/incoming-call-end
 * call_activecallkey|CallID + call_duration|call_talkduration (saniye) + answeredAt?.
 */
async function handleCallEnd(req, res) {
  try {
    const cid = companyId();
    if (!cid) return res.status(503).json({ ok: false, error: 'company_not_configured' });
    const callId = pick(req, ['call_activecallkey', 'CallID', 'callId', 'activecallkey']);
    if (!callId) return res.status(400).json({ ok: false, error: 'callId_required' });
    const durRaw = pick(req, ['call_duration', 'call_talkduration', 'duration', 'talkduration']);
    const durationSec = durRaw != null ? parseInt(String(durRaw), 10) : undefined;
    const answeredRaw = pick(req, ['call_answered_at', 'answeredAt', 'talkdate']);
    const status = (pick(req, ['status']) || 'ended');
    await callLogRepo.updateOnEnd({
      companyId: cid, callId,
      ...(answeredRaw ? { answeredAt: new Date(answeredRaw) } : {}),
      endedAt: new Date(),
      ...(Number.isFinite(durationSec) ? { durationSec } : {}),
      status: status === 'missed' ? 'missed' : 'ended',
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[alotech:webhook:end]', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
}
router.get('/incoming-call-end', handleCallEnd);
router.post('/incoming-call-end', handleCallEnd);

export default router;
