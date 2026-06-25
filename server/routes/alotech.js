import { Router } from 'express';
import { verifyJwt } from '../db/auth.js';
import { getSessionKey, getCachedSession } from '../integrations/alotech/session.js';
import { click2Call } from '../integrations/alotech/click2.js';
import { v1Fetch } from '../integrations/alotech/v1.js';
import { isAlotechConfigured, logAlotechConfigOnce } from '../integrations/alotech/config.js';

// Boot anında BİR KEZ log (eksik env varsa); route handler'ı tarafından
// (lazy) ilk istekte tetiklenir → server.js'ye dokunmadan tek yerde durur.
logAlotechConfigOnce();

/**
 * AloTech entegrasyon router'ı — /api/integrations/alotech
 *
 * Gömülü SoftphoneJS + click-to-call için BFF. Tüm endpoint'ler verifyJwt
 * arkasında; agent kimliği giriş yapan Varuna kullanıcısından türetilir.
 *
 * Agent eşleştirme: User.alotechEmail (ör. @param.com.tr). Migration uygulanana
 * kadar test için ALOTECH_DEV_AGENT_EMAIL env fallback'i kullanılır.
 */
const router = Router();

// Graceful degrade: ALOTECH_* env'ler yoksa 500 ATMA;
// tüm endpoint'ler { configured: false } döner → frontend widget'ı poll'u
// durdurur + toast göstermez. Tek yerde guard; her endpoint başına ekstra
// kod gerekmez. configured=true iken davranış AYNEN korunur.
//
// NOT: Bu guard verifyJwt'tan ÖNCE çalışır — disabled response'unda
// hiçbir AloTech data açığa çıkmaz; sadece bir flag. Auth katmanı
// gereksiz yere agent başına 401 üretmiyor; widget tek seferde "disable"
// kararı verebilsin.
router.use((req, res, next) => {
  if (isAlotechConfigured()) return next();
  // 200 → apiFetch hata akışına girmez; client { configured: false } okur.
  return res.json({ configured: false });
});

router.use(verifyJwt);

const HOST = process.env.ALOTECH_TENANT || ''; // param-univera.alo-tech.com

/**
 * İstekteki AloTech agent e-postasını çöz.
 * Eşleştirme User tablosunda DEĞİL — agent kendi AloTech e-postasını softphone
 * widget'ında girer ve `X-Alotech-Email` header'ı ile gönderilir (tarayıcıda
 * localStorage'da kalıcı). Header yoksa env tabanlı test fallback'i kullanılır.
 */
function resolveAgentEmail(req) {
  const fromHeader = req?.get?.('x-alotech-email');
  if (fromHeader && fromHeader.includes('@')) return fromHeader.trim().toLowerCase();
  return process.env.ALOTECH_DEV_AGENT_EMAIL || null;
}

/**
 * GET /session — SoftphoneJS (AWJS.init) için session key üretir.
 * Response: { session, hostname, tenant, expiresIn, agentEmail }
 */
router.get('/session', async (req, res) => {
  try {
    const agentEmail = resolveAgentEmail(req);
    if (!agentEmail) {
      return res.status(400).json({
        error: 'alotech_email_missing',
        message: 'Hesabınıza AloTech agent e-postası tanımlı değil. Yöneticinize başvurun.',
      });
    }
    const r = await getSessionKey(agentEmail);
    const session = r.data?.session || r.data?.session_key || r.data?.sessionKey;
    if (!r.ok || r.data?.login === false || !session) {
      console.error('[alotech:session]', r.status, r.text?.slice(0, 200));
      return res.status(502).json({
        error: 'alotech_login_failed',
        message: r.data?.message || 'AloTech oturumu açılamadı.',
      });
    }
    res.json({
      session,
      hostname: HOST,
      tenant: HOST,
      expiresIn: r.data?.session_expires_in ?? 64800,
      agentEmail,
    });
  } catch (err) {
    console.error('[alotech:session]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * POST /call — click-to-call (v3). Body: { phoneNumber, caseId?, accountCode? }
 * Agent softphone'u (AWJS) çalar, açınca müşteri bağlanır.
 */
router.post('/call', async (req, res) => {
  try {
    const agentEmail = resolveAgentEmail(req);
    if (!agentEmail) {
      return res.status(400).json({ error: 'alotech_email_missing', message: 'AloTech agent e-postası tanımlı değil.' });
    }
    const { phoneNumber, caseId, accountCode } = req.body || {};
    if (!phoneNumber) {
      return res.status(400).json({ error: 'phone_required', message: 'phoneNumber zorunlu.' });
    }
    const result = await click2Call({
      userEmail: agentEmail,
      phoneNumber: String(phoneNumber),
      transactionId: caseId ? String(caseId) : undefined,
      accountCode: accountCode ? String(accountCode) : undefined,
      customVariables: caseId ? { caseId: String(caseId), source: 'varuna' } : { source: 'varuna' },
    });
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[alotech:call]', err);
    res.status(502).json({ error: 'call_failed', message: err?.message ?? 'Arama başlatılamadı.' });
  }
});

/**
 * GET /agent-status — giriş yapan agent'ın AloTech müsaitlik durumu.
 * Response: { agentEmail, status } | { status: null } (listede yoksa)
 */
router.get('/agent-status', async (req, res) => {
  try {
    const agentEmail = resolveAgentEmail(req);
    if (!agentEmail) {
      return res.status(400).json({ error: 'alotech_email_missing', message: 'AloTech agent e-postası tanımlı değil.' });
    }
    const r = await v1Fetch('/agent/get_agents_status');
    const list = r.data?.agents_status_list || [];
    const me = list.find((a) => (a.email || '').toLowerCase() === agentEmail.toLowerCase());
    res.json({ agentEmail, status: me?.status ?? null, agentName: me?.agentname ?? null });
  } catch (err) {
    console.error('[alotech:agent-status]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

const VALID_STATUSES = ['available', 'backoffice', 'aftercallwork', 'shortbreak', 'lunch', 'training', 'meeting'];

/**
 * POST /set-status — agent müsaitlik durumunu değiştirir (v1 /agent/status).
 * Body: { status }. Çağrı durumundayken (ringing/talking/hold) AloTech değiştirmez.
 */
router.post('/set-status', async (req, res) => {
  try {
    const agentEmail = resolveAgentEmail(req);
    if (!agentEmail) {
      return res.status(400).json({ error: 'alotech_email_missing', message: 'AloTech agent e-postası tanımlı değil.' });
    }
    const { status } = req.body || {};
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'invalid_status', message: 'Geçersiz durum.' });
    }
    const r = await v1Fetch('/agent/status', { method: 'POST', body: { user_name: agentEmail, status } });
    if (!r.ok || r.data?.success === false) {
      console.error('[alotech:set-status] v1 hata', { agentEmail, status, httpStatus: r.status, body: r.text?.slice(0, 200) });
      return res.status(502).json({ error: 'status_failed', message: r.data?.message || 'Durum değiştirilemedi.' });
    }
    res.json({ ok: true, status, message: r.data?.message });
  } catch (err) {
    console.error('[alotech:set-status]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * GET /active-call — agent'ın o anki aktif/çalan çağrıları (gelen çağrı yakalama).
 * v1 /activecall/user?session=. Polling ile screen pop için kullanılır.
 */
router.get('/active-call', async (req, res) => {
  try {
    const agentEmail = resolveAgentEmail(req);
    if (!agentEmail) {
      return res.status(400).json({ error: 'alotech_email_missing', message: 'AloTech agent e-postası tanımlı değil.' });
    }
    const session = await getCachedSession(agentEmail);
    if (!session) {
      return res.status(502).json({ error: 'session_failed', message: 'AloTech oturumu alınamadı.' });
    }
    const r = await v1Fetch(`/activecall/user?session=${encodeURIComponent(session)}`);
    const calls = (r.data?.MyActiveCalls || []).map((c) => ({
      callId: c.callid,
      callerId: c.callerid,
      calledNum: c.called_num,
      queue: c.queue,
      inbound: c.inbound,
      status: c.status,
      callDate: c.calldate,
      talkDate: c.talkdate,
      key: c.key,
    }));
    // Agent'ın gerçek müsaitlik durumu (çağrı bitince "ringing" takılı kalmasın)
    const st = await v1Fetch('/agent/get_agents_status');
    const me = (st.data?.agents_status_list || []).find((a) => (a.email || '').toLowerCase() === agentEmail.toLowerCase());
    res.json({ calls, agentStatus: me?.status ?? null });
  } catch (err) {
    console.error('[alotech:active-call]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * POST /hangup — agent'ın aktif çağrısını sonlandırır (v1 click2hang, session ile).
 * Çaldırma sırasında "Kapat" denince çağrıyı iptal eder.
 */
router.post('/hangup', async (req, res) => {
  try {
    const agentEmail = resolveAgentEmail(req);
    if (!agentEmail) {
      return res.status(400).json({ error: 'alotech_email_missing', message: 'AloTech agent e-postası tanımlı değil.' });
    }
    const session = await getCachedSession(agentEmail);
    if (!session) {
      return res.status(502).json({ error: 'session_failed', message: 'AloTech oturumu alınamadı.' });
    }
    const r = await v1Fetch('/activecall/click2hang', { method: 'POST', body: { session } });
    res.json({ ok: r.ok, result: r.data });
  } catch (err) {
    console.error('[alotech:hangup]', err);
    res.status(502).json({ error: 'hangup_failed', message: err?.message ?? 'Çağrı sonlandırılamadı.' });
  }
});

export default router;
