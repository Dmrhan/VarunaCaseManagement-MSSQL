import { Router } from 'express';
import OpenAI from 'openai';

const router = Router();

const MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 1000;
const TIMEOUT_MS = 30_000;
const RATE_LIMIT_PER_MIN = 20;

const apiKey = process.env.OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;

console.log('[ai] API Key loaded:', !!process.env.OPENAI_API_KEY);

if (!client) {
  console.warn(
    '[ai] OPENAI_API_KEY tanımlı değil — /api/ai/* endpoint\'leri 503 döner. ' +
      '.env dosyasına OPENAI_API_KEY ekleyin (örnek: .env.example).',
  );
} else {
  console.log(
    `[ai] Key format — length=${apiKey.length}, prefix=${apiKey.slice(0, 7)}, suffix=...${apiKey.slice(-4)}`,
  );
  console.log(`[ai] Model: ${MODEL}, max_tokens: ${MAX_TOKENS}, rate limit: ${RATE_LIMIT_PER_MIN}/dk`);
}

// ----------------------------------------------------------------
// IP başına dakikada N istek — basit sliding window (in-memory)
// ----------------------------------------------------------------
const ipBuckets = new Map();

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
// OpenAI çağrısı (timeout + JSON parse + standart hata cevabı)
// ----------------------------------------------------------------
async function callOpenAI({ system, user, expectJson = false }) {
  if (!client) {
    const err = new Error('AI servisi yapılandırılmamış (API key yok).');
    err.status = 503;
    throw err;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await client.chat.completions.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        ...(expectJson ? { response_format: { type: 'json_object' } } : {}),
      },
      { signal: ctrl.signal },
    );
    const text = (resp.choices?.[0]?.message?.content ?? '').trim();

    if (!expectJson) return { text };

    // JSON modu: response_format=json_object ile gelen ama defansif kod-fence kaldır
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

    const { json } = await callOpenAI({ system, user, expectJson: true });
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

    const { text } = await callOpenAI({ system, user });
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

    // SLA bilgisini human-readable formata çevir (now'a göre kalan/geçen süre)
    const slaSummary = formatSlaInfo(c);

    const user = [
      'Vaka bilgileri:',
      `- Konu: ${c?.title ?? '-'}`,
      `- Kategori: ${c?.category ?? '-'} / ${c?.subCategory ?? '-'}`,
      `- Statü: ${c?.status ?? '-'}`,
      `- Öncelik: ${c?.priority ?? '-'}`,
      `- SLA Yanıt: ${slaSummary.response}`,
      `- SLA Çözüm: ${slaSummary.resolution}`,
      `- SLA Durum: ${slaSummary.status}`,
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

    const { json } = await callOpenAI({ system, user, expectJson: true });
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

    const { json } = await callOpenAI({ system, user, expectJson: true });
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

    // İlginç vakaları kompakt formatta dök — token bütçesinde kalır (~30 vaka × ~180 char)
    const now = Date.now();
    const casesStr = Array.isArray(ctx.interestingCases) && ctx.interestingCases.length > 0
      ? ctx.interestingCases
          .map((c) => {
            const flags = [c.priority];
            if (c.slaViolation) flags.push('SLA-İHLAL');
            const flagStr = `[${flags.join(', ')}]`;
            const assigned = c.assignedPersonName ?? '(atanmamış)';
            const team = c.assignedTeamName ?? '-';
            // SLA çözüm süresi — kalan/geçen
            let slaInfo = '';
            if (c.slaResolutionDueAt) {
              const ms = new Date(c.slaResolutionDueAt).getTime();
              const diff = ms - now;
              const absH = Math.abs(diff) / 3600_000;
              const human = absH < 24
                ? `${Math.round(absH)}sa`
                : `${Math.round(absH / 24)}g`;
              slaInfo = ` | SLA: ${diff < 0 ? `${human} GEÇTİ` : `${human} kaldı`}`;
            }
            return `- ${c.caseNumber} ${flagStr} "${c.title}" | ${c.companyName}/${c.accountName} | ${c.category}/${c.subCategory} | ${c.status} | ${c.ageHours}saat${slaInfo} | ${assigned} (${team})`;
          })
          .join('\n')
      : '(vaka snapshot\'ı verilmedi)';

    const system = [
      "Sen Varuna CRM'in dashboard analisti RUNA AI'sın.",
      'Müşteri hizmetleri ve operasyon yöneticilerine vaka yönetimi verileri hakkında',
      'net, uygulanabilir içgörüler sunarsın.',
      '',
      'Türkçe yaz. Kısa ve net ol — maksimum 3-4 cümle.',
      'Rakamları kullan. Soyut tavsiye verme, somut aksiyon öner.',
      'Spesifik vaka sorulduğunda CASE-XXXXX numarasını VE konusunu mutlaka belirt.',
      'Eğer veri yetersizse bunu açıkça söyle.',
      '',
      '=== ÖZET METRİKLER ===',
      `Toplam Vaka: ${ctx.totalCases ?? '-'}`,
      `Açık Vaka: ${ctx.openCases ?? '-'}`,
      `SLA İhlal Oranı: %${ctx.slaViolationRate ?? '-'}`,
      `Ortalama Çözüm Süresi: ${ctx.avgTtrHours ?? '-'} saat`,
      `Kritik Açık Vaka: ${ctx.criticalOpen ?? '-'}`,
      `Churn Riski: ${ctx.churnAtRisk ?? '-'} vaka`,
      `Retention Başarı: %${ctx.retentionRate ?? '-'}`,
      `En Yoğun Kategori: ${ctx.topCategory ?? '-'}`,
      `Takım Yükleri: ${teamLoadStr}`,
      '',
      '=== EN İLGİNÇ AÇIK VAKALAR (skor: priority + SLA ihlali + yaş; max 30) ===',
      'Format: CASE-NO [Priority, opsiyonel SLA-İHLAL] "Konu" | Şirket/Müşteri | Kategori/Alt | Statü | Yaş(saat) | SLA: <kalan veya GEÇTİ> | Atanan (Takım)',
      casesStr,
    ].join('\n');

    // History'yi son 6 mesajla sınırla, role/content olarak normalize et
    const recent = Array.isArray(history) ? history.slice(-6) : [];
    const messages = [
      { role: 'system', content: system },
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
      const resp = await client.chat.completions.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          messages,
        },
        { signal: ctrl.signal },
      );
      const text = (resp.choices?.[0]?.message?.content ?? '').trim();
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

    const { text } = await callOpenAI({ system, user });
    res.json({ summary: text });
  }),
);

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/**
 * Vaka SLA bilgilerini human-readable forma çevirir.
 * Returns: { response, resolution, status }
 */
function formatSlaInfo(c) {
  const now = Date.now();
  const fmt = (iso) => {
    if (!iso) return 'tanımlı değil';
    const ms = new Date(iso).getTime();
    if (Number.isNaN(ms)) return 'geçersiz tarih';
    const diffMs = ms - now;
    const absHours = Math.abs(diffMs) / 3600_000;
    const dt = new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    if (diffMs < 0) {
      return `${dt} (${absHours < 24 ? Math.round(absHours) + ' saat' : Math.round(absHours / 24) + ' gün'} GEÇTİ)`;
    }
    return `${dt} (${absHours < 24 ? Math.round(absHours) + ' saat' : Math.round(absHours / 24) + ' gün'} kaldı)`;
  };

  let status = 'Normal';
  if (c?.slaViolation) status = 'İhlal edildi';
  else if (c?.slaPausedAt) status = 'Duraklatıldı (3rdParty)';
  else if (c?.slaResolutionDueAt) {
    const remainMs = new Date(c.slaResolutionDueAt).getTime() - now;
    const totalMs = new Date(c.slaResolutionDueAt).getTime() -
      (c.createdAt ? new Date(c.createdAt).getTime() : now);
    if (totalMs > 0 && remainMs / totalMs < 0.2) status = 'Riskli (kalan süre <%20)';
  }

  return {
    response: fmt(c?.slaResponseDueAt),
    resolution: fmt(c?.slaResolutionDueAt),
    status,
  };
}

export default router;
