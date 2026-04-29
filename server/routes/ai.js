import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1000;
const TIMEOUT_MS = 30_000;
const RATE_LIMIT_PER_MIN = 20;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

console.log('[ai] API Key loaded:', !!process.env.ANTHROPIC_API_KEY);

if (!client) {
  console.warn(
    '[ai] ANTHROPIC_API_KEY tanımlı değil — /api/ai/* endpoint\'leri 503 döner. ' +
      '.env dosyasına ANTHROPIC_API_KEY ekleyin (örnek: .env.example).',
  );
} else {
  console.log(
    `[ai] Key format — length=${apiKey.length}, prefix=${apiKey.slice(0, 12)}, suffix=...${apiKey.slice(-4)}`,
  );
  console.log(`[ai] Model: ${MODEL}, max_tokens: ${MAX_TOKENS}, rate limit: ${RATE_LIMIT_PER_MIN}/dk`);
}

// ----------------------------------------------------------------
// IP başına dakikada N istek — basit sliding window (in-memory)
// ----------------------------------------------------------------
const ipBuckets = new Map(); // ip → number[] of request timestamps (ms)

function rateLimit(req, res, next) {
  const ip = req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';
  const now = Date.now();
  const windowStart = now - 60_000;
  const bucket = (ipBuckets.get(ip) ?? []).filter((t) => t > windowStart);
  if (bucket.length >= RATE_LIMIT_PER_MIN) {
    return res.status(429).json({ error: 'rate_limited', message: 'Çok fazla istek, lütfen bekleyin.' });
  }
  bucket.push(now);
  ipBuckets.set(ip, bucket);
  next();
}

// ----------------------------------------------------------------
// Anthropic çağrısı (timeout + JSON parse + standart hata cevabı)
// ----------------------------------------------------------------
async function callClaude({ system, user, expectJson = false }) {
  if (!client) {
    const err = new Error('AI servisi yapılandırılmamış (API key yok).');
    err.status = 503;
    throw err;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
      },
      { signal: ctrl.signal },
    );
    const text = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    if (!expectJson) return { text };

    // JSON modu: kod-fence kaldır, parse et
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    try {
      return { json: JSON.parse(cleaned), raw: text };
    } catch {
      const err = new Error('Modelin JSON çıktısı ayrıştırılamadı.');
      err.status = 502;
      err.detail = text.slice(0, 500);
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}

function aiHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err?.status ?? 500;
      const isTimeout = err?.name === 'AbortError';
      console.error('[ai] hata:', err?.message ?? err);
      res.status(isTimeout ? 504 : status).json({
        error: isTimeout ? 'timeout' : 'ai_error',
        message: err?.message ?? 'AI servis hatası',
      });
    }
  };
}

// ----------------------------------------------------------------
// 1) Kategori + öncelik önerisi
// ----------------------------------------------------------------
router.post(
  '/suggest-category',
  rateLimit,
  aiHandler(async (req, res) => {
    const { description, caseType, companyName, availableCategories } = req.body ?? {};
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'description gerekli.' });
    }

    const system = [
      "Sen Varuna CRM'de çalışan bir vaka sınıflandırma asistanısın.",
      'Türkçe müşteri şikayetlerini analiz edip doğru kategori ve öncelik belirlersin.',
      'Yanıtını SADECE JSON olarak ver, başka hiçbir şey yazma.',
    ].join('\n');

    const catList = Array.isArray(availableCategories)
      ? availableCategories
          .map((c) => `- ${c.category}: ${(c.subCategories ?? []).join(', ')}`)
          .join('\n')
      : '(verilmedi)';

    const user = [
      'Aşağıdaki vaka açıklamasını analiz et:',
      `Şirket: ${companyName ?? '-'}`,
      `Vaka Tipi: ${caseType ?? '-'}`,
      `Açıklama: ${description}`,
      'Mevcut kategoriler:',
      catList,
      '',
      'JSON formatı:',
      '{',
      '  "category": "en uygun kategori adı",',
      '  "subCategory": "en uygun alt kategori adı veya null",',
      '  "priority": "Low|Medium|High|Critical",',
      '  "confidence": 0.0-1.0,',
      '  "reasoning": "kısa Türkçe gerekçe (1 cümle)"',
      '}',
    ].join('\n');

    const { json } = await callClaude({ system, user, expectJson: true });
    res.json(json);
  }),
);

// ----------------------------------------------------------------
// 2) Çözüm notu taslağı
// ----------------------------------------------------------------
router.post(
  '/draft-resolution',
  rateLimit,
  aiHandler(async (req, res) => {
    const { caseSubject, description, category, history, notes } = req.body ?? {};

    const system = [
      "Sen Varuna CRM'de müşteri hizmetleri temsilcilerine yardımcı olan bir asistanısın.",
      'Vaka bilgilerine dayanarak profesyonel, net ve müşteri dostu çözüm notları yazarsın.',
      'Yanıtı Türkçe yaz. Sadece çözüm notunu yaz, başka açıklama ekleme.',
    ].join('\n');

    const lastHistory = Array.isArray(history)
      ? history
          .slice(-5)
          .map((h) => `- ${h.action ?? h.fieldName ?? ''}${h.toValue ? `: ${h.toValue}` : ''}`)
          .join('\n')
      : '(yok)';
    const lastNotes = Array.isArray(notes)
      ? notes.slice(0, 3).map((n) => `- ${n.content ?? n}`).join('\n')
      : '(yok)';

    const user = [
      `Vaka Konusu: ${caseSubject ?? '-'}`,
      `Kategori: ${category ?? '-'}`,
      `Açıklama: ${description ?? '-'}`,
      'Yapılan işlemler:',
      lastHistory,
      'Notlar:',
      lastNotes,
      '',
      'Çözüm notu 2-4 cümle olsun.',
    ].join('\n');

    const { text } = await callClaude({ system, user });
    res.json({ draft: text });
  }),
);

// ----------------------------------------------------------------
// 3) Supervisor inceleme özeti
// ----------------------------------------------------------------
router.post(
  '/supervisor-summary',
  rateLimit,
  aiHandler(async (req, res) => {
    const { case: c, history, notes, callLogs } = req.body ?? {};

    const system = [
      "Sen Varuna CRM'de supervisor incelemelerine yardımcı olan bir asistanısın.",
      'Türkçe yaz. SADECE JSON formatında yanıt ver.',
    ].join('\n');

    const user = [
      'Vaka bilgileri:',
      `- Konu: ${c?.title ?? '-'}`,
      `- Kategori: ${c?.category ?? '-'} / ${c?.subCategory ?? '-'}`,
      `- Statü: ${c?.status ?? '-'}`,
      `- Öncelik: ${c?.priority ?? '-'}`,
      `- SLA İhlali: ${c?.slaViolation ? 'Evet' : 'Hayır'}`,
      `- Açıklama: ${c?.description ?? '-'}`,
      '',
      `History (son 5): ${(Array.isArray(history) ? history.slice(-5) : []).map((h) => h.action ?? h.fieldName).join(' / ')}`,
      `Notlar: ${(Array.isArray(notes) ? notes.slice(0, 3) : []).map((n) => n.content ?? n).join(' | ')}`,
      `Çağrılar: ${Array.isArray(callLogs) ? callLogs.length : 0} adet`,
      '',
      'JSON formatı:',
      '{',
      '  "summary": "2-3 cümle vaka özeti",',
      '  "riskLevel": "Düşük|Orta|Yüksek|Kritik",',
      '  "keyPoints": ["nokta 1", "nokta 2", "nokta 3"],',
      '  "recommendation": "1 cümle öneri"',
      '}',
    ].join('\n');

    const { json } = await callClaude({ system, user, expectJson: true });
    res.json(json);
  }),
);

// ----------------------------------------------------------------
// 4) Churn dönüşüm önerisi
// ----------------------------------------------------------------
router.post(
  '/churn-conversion',
  rateLimit,
  aiHandler(async (req, res) => {
    const { case: c, callLogs, financialStatus, productUsage, usageChangeAlert } = req.body ?? {};

    const system = [
      "Sen Varuna CRM'de müşteri elde tutma süreçlerine yardımcı olan bir asistanısın.",
      'Türkçe yaz. SADECE JSON formatında yanıt ver.',
    ].join('\n');

    const lastCalls = Array.isArray(callLogs)
      ? callLogs.slice(-3).map((cl) => `- ${cl.outcome ?? cl.disposition ?? ''}: ${(cl.summary ?? cl.aiCallBrief ?? '').slice(0, 80)}`).join('\n')
      : '(yok)';

    const user = [
      `Vaka Konusu: ${c?.title ?? '-'}`,
      `Şirket: ${c?.companyName ?? '-'}`,
      `Müşteri: ${c?.accountName ?? '-'}`,
      `Finansal Durum: ${financialStatus ?? c?.financialStatus ?? '-'}`,
      `Ürün Kullanımı: ${productUsage ?? c?.productUsage ?? '-'}`,
      `Kullanım Trendi: ${usageChangeAlert ?? c?.usageChangeAlert ?? '-'}`,
      'Arama Geçmişi:',
      lastCalls,
      '',
      'JSON formatı:',
      '{',
      '  "churnRisk": "Düşük|Orta|Yüksek|Kritik",',
      '  "shouldConvert": true|false,',
      '  "reasoning": "2-3 cümle gerekçe",',
      '  "suggestedAction": "önerilen aksiyon"',
      '}',
    ].join('\n');

    const { json } = await callClaude({ system, user, expectJson: true });
    res.json(json);
  }),
);

// ----------------------------------------------------------------
// 6) Dashboard chat — RUNA AI analist asistanı
// ----------------------------------------------------------------
router.post(
  '/dashboard-chat',
  rateLimit,
  aiHandler(async (req, res) => {
    const { message, history, context } = req.body ?? {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message gerekli.' });
    }

    const ctx = context ?? {};
    const teamLoadStr = Array.isArray(ctx.teamLoads)
      ? ctx.teamLoads.map((t) => `${t.teamName}: ${t.caseCount}`).join(', ')
      : '(yok)';

    const system = [
      "Sen Varuna CRM'in dashboard analisti RUNA AI'sın.",
      'Müşteri hizmetleri ve operasyon yöneticilerine vaka yönetimi verileri hakkında',
      'net, uygulanabilir içgörüler sunarsın.',
      '',
      'Türkçe yaz. Kısa ve net ol — maksimum 3-4 cümle.',
      'Rakamları kullan. Soyut tavsiye verme, somut aksiyon öner.',
      'Eğer veri yetersizse bunu açıkça söyle.',
      '',
      'Mevcut dashboard verileri:',
      `Toplam Vaka: ${ctx.totalCases ?? '-'}`,
      `Açık Vaka: ${ctx.openCases ?? '-'}`,
      `SLA İhlal Oranı: %${ctx.slaViolationRate ?? '-'}`,
      `Ortalama Çözüm Süresi: ${ctx.avgTtrHours ?? '-'} saat`,
      `Kritik Açık Vaka: ${ctx.criticalOpen ?? '-'}`,
      `Churn Riski: ${ctx.churnAtRisk ?? '-'} vaka`,
      `Retention Başarı: %${ctx.retentionRate ?? '-'}`,
      `En Yoğun Kategori: ${ctx.topCategory ?? '-'}`,
      `Takım Yükleri: ${teamLoadStr}`,
    ].join('\n');

    // History'yi son 6 mesajla sınırla, role/content olarak normalize et
    const recent = Array.isArray(history) ? history.slice(-6) : [];
    const messages = [
      ...recent
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .map((m) => ({ role: m.role, content: String(m.content) })),
      { role: 'user', content: message },
    ];

    if (!client) {
      const err = new Error('AI servisi yapılandırılmamış (API key yok).');
      err.status = 503;
      throw err;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const resp = await client.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages,
        },
        { signal: ctrl.signal },
      );
      const text = resp.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      res.json({ reply: text });
    } finally {
      clearTimeout(timer);
    }
  }),
);

// ----------------------------------------------------------------
// 5) Çağrı notu özeti
// ----------------------------------------------------------------
router.post(
  '/call-summary',
  rateLimit,
  aiHandler(async (req, res) => {
    const { callLog, caseSubject, customerName } = req.body ?? {};
    if (!callLog || (!callLog.note && !callLog.transcript && !callLog.content)) {
      return res.status(400).json({ error: 'callLog.note / transcript / content gerekli.' });
    }

    const system = [
      "Sen Varuna CRM'de çağrı merkezi operasyonlarına yardımcı olan bir asistanısın.",
      'Türkçe yaz. Sadece özeti yaz. Maksimum 2 cümle.',
    ].join('\n');

    const user = [
      `Vaka Konusu: ${caseSubject ?? '-'}`,
      `Müşteri: ${customerName ?? '-'}`,
      `Çağrı Sonucu: ${callLog.outcome ?? '-'}`,
      `Çağrı Türü: ${callLog.disposition ?? '-'}`,
      `Çağrı Notu: ${callLog.note ?? callLog.transcript ?? callLog.content ?? '-'}`,
    ].join('\n');

    const { text } = await callClaude({ system, user });
    res.json({ summary: text });
  }),
);

export default router;
