import { Router } from 'express';
import { verifyJwt } from '../db/auth.js';
import { prisma } from '../db/client.js';
import { aiClient, callOpenAI, logAIUsage, AI_MODEL, AI_MAX_TOKENS, AI_TIMEOUT_MS } from '../lib/aiClient.js';

const router = Router();

router.use(verifyJwt);

const MODEL = AI_MODEL;
const MAX_TOKENS = AI_MAX_TOKENS;
const TIMEOUT_MS = AI_TIMEOUT_MS;
const RATE_LIMIT_PER_MIN = 20;

const client = aiClient;

console.log('[ai] API Key loaded:', !!process.env.OPENAI_API_KEY);

if (!client) {
  console.warn(
    '[ai] OPENAI_API_KEY tanımlı değil — /api/ai/* endpoint\'leri 503 döner. ' +
      '.env dosyasına OPENAI_API_KEY ekleyin (örnek: .env.example).',
  );
} else {
  const apiKey = process.env.OPENAI_API_KEY;
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

// callOpenAI shared module'den (server/lib/aiClient.js) import edilir.

function aiHandler(endpointName, handler) {
  // Backward-compat: aiHandler(handler) eski signature'ında endpointName 'other'
  if (typeof endpointName === 'function') {
    handler = endpointName;
    endpointName = 'other';
  }
  return async (req, res) => {
    const t0 = Date.now();
    // Handler içinden set edilen log context'ini yakala
    req.aiLog = {};
    let logged = false;
    res.on('finish', () => {
      if (logged) return;
      logged = true;
      // Yalnızca 2xx (başarılı) yanıtları logla — timeout/hata logları gürültü olur
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const ctx = req.aiLog ?? {};
      // Handler manuel logladıysa (örn. usageLogId döndürmek için) skip
      if (ctx.skipAutoLog) return;
      const companyId = ctx.companyId ?? req.user?.allowedCompanyIds?.[0];
      void logAIUsage({
        endpoint: endpointName,
        companyId,
        caseId: ctx.caseId,
        userId: req.user?.id,
        responseTimeMs: Date.now() - t0,
        tokenCount: ctx.tokenCount,
      });
    });
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
  aiHandler('suggest-category', async (req, res) => {
    const { description, caseType, companyName, availableCategories, availableRequestTypes, caseId, companyId } = req.body ?? {};
    req.aiLog.caseId = caseId;
    req.aiLog.companyId = companyId;
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'description gerekli.' });
    }
    if (!Array.isArray(availableCategories) || availableCategories.length === 0) {
      return res.status(400).json({ error: 'availableCategories gerekli (kategori enum kilidi için).' });
    }
    if (!Array.isArray(availableRequestTypes) || availableRequestTypes.length === 0) {
      return res.status(400).json({ error: 'availableRequestTypes gerekli (talep türü enum kilidi için).' });
    }

    // Enum'lar — strict mode model'i decoding-time'da bu listelere kilitler.
    const categoryEnum = availableCategories.map((c) => c.category);
    const subCategoryEnum = Array.from(
      new Set(availableCategories.flatMap((c) => c.subCategories ?? [])),
    );
    const requestTypeEnum = availableRequestTypes;

    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['category', 'subCategory', 'requestType', 'priority', 'confidence', 'reasoning'],
      properties: {
        category:    { type: 'string', enum: categoryEnum },
        subCategory: { type: 'string', enum: subCategoryEnum },
        requestType: { type: 'string', enum: requestTypeEnum },
        priority:    { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
        confidence:  { type: 'number' },
        reasoning:   { type: 'string' },
      },
    };

    const system = [
      "Sen Varuna CRM'de çalışan bir vaka sınıflandırma asistanısın.",
      'Türkçe müşteri açıklamalarını analiz edip kategori, alt kategori, talep türü ve önceliği belirlersin.',
      'KURAL: subCategory MUTLAKA seçilen category\'nin alt kategori listesinde yer almalıdır (aşağıdaki haritaya bak).',
      'KURAL: requestType MUTLAKA verilen listeden olmalıdır.',
      'KURAL: Her alanı doldur — boş/null/atla yok. Açıklamadan emin olamadığın yerde en olası seçeneği seç ve confidence değerini düşür.',
    ].join('\n');

    const catMap = availableCategories
      .map((c) => `- ${c.category} → [${(c.subCategories ?? []).join(', ')}]`)
      .join('\n');

    const user = [
      'Vaka bilgisi:',
      `- Şirket: ${companyName ?? '-'}`,
      `- Vaka Tipi: ${caseType ?? '-'}`,
      `- Açıklama: ${description}`,
      '',
      'Kategori → alt kategori haritası (subCategory bu eşlemeye uygun olmalı):',
      catMap,
      '',
      `Talep Türü seçenekleri: ${requestTypeEnum.join(' | ')}`,
      '',
      'Talep türü ipuçları:',
      '- "bilgi/öğrenmek/sormak/açıklama" → Bilgi',
      '- "öneri/tavsiye/iyileştirme fikri" → Öneri',
      '- "talep/istiyorum/açtırmak/yapılmasını" → Talep',
      '- "şikayet/memnun değil/kötü/sinirli" → Şikayet',
      '- "hata/çalışmıyor/arıza/bozuk/açılmıyor" → Hata',
      '',
      'Öncelik ipuçları:',
      '- Critical: hizmet kesintisi, mali kayıp, yasal/güvenlik riski, anahtar müşteri',
      '- High: aktif iş bloğu, SLA tehlikede, eskalasyon riski',
      '- Medium: çözülmesi gereken ama acil olmayan',
      '- Low: bilgi/iyileştirme/sorgu',
      '',
      'confidence 0.0-1.0 arası, en uygun kategori-altkategori-talep türü kombinasyonuna ne kadar emin olduğun.',
      'reasoning: 1 kısa cümle Türkçe gerekçe.',
    ].join('\n');

    const { json } = await callOpenAI({
      system,
      user,
      schema,
      schemaName: 'category_suggestion',
    });
    res.json(json);
  }),
);

// ----------------------------------------------------------------
// 1b) Vaka başlığı önerisi — açıklamadan kısa başlık üret
// ----------------------------------------------------------------
router.post(
  '/suggest-title',
  rateLimit,
  aiHandler('suggest-title', async (req, res) => {
    const { description, caseType } = req.body ?? {};
    if (!description || typeof description !== 'string' || description.trim().length < 10) {
      return res.status(400).json({ error: 'description gerekli (en az 10 karakter).' });
    }

    // companyId açıkça gelmediği için kullanıcının ilk şirketini fallback olarak
    // logla (yeni vaka formundaki çağrılar için pratik kabul).
    const companyId = req.body?.companyId ?? req.user?.allowedCompanyIds?.[0];
    req.aiLog.companyId = companyId;

    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'confidence'],
      properties: {
        title:      { type: 'string' },
        confidence: { type: 'number' },
      },
    };

    const system = [
      "Sen Varuna CRM'de vaka başlığı üreten bir asistanısın.",
      'Açıklamayı okur, kısa ve öz bir başlık önerirsin.',
      'KURAL: Maksimum 60 karakter — daha uzun başlıkları kısalt.',
      'KURAL: Türkçe.',
      'KURAL: Fiil içerme, isim cümlesi olsun (örn. "Sözleşme yenileme reddedildi").',
      'KURAL: Konuyu net özetle, soyut kalma. Başlık vakanın özüdür.',
      'SADECE JSON döndür — açıklama veya yorum ekleme.',
    ].join('\n');

    const user = [
      `Vaka Tipi: ${caseType ?? 'belirsiz'}`,
      `Açıklama: ${description.trim()}`,
      '',
      'confidence 0.0-1.0 — başlığın açıklamayı ne kadar iyi yansıttığına dair eminliğin.',
      'Açıklama belirsiz/kısa ise confidence düşür.',
    ].join('\n');

    const t0 = Date.now();
    const { json, tokenCount } = await callOpenAI({
      system,
      user,
      schema,
      schemaName: 'title_suggestion',
    });

    // 60 karakter savunma kesimi — model nadiren kuralı aşabilir
    const title = String(json.title ?? '').slice(0, 60).trim();

    // Manuel log → usageLogId'yi response'a ekleyebilelim (Uygula/Yoksay telemetrisi)
    req.aiLog.skipAutoLog = true;
    const log = await logAIUsage({
      endpoint: 'suggest-title',
      companyId,
      caseId: null,
      userId: req.user?.id,
      responseTimeMs: Date.now() - t0,
      tokenCount,
    });

    res.json({
      title,
      confidence: typeof json.confidence === 'number' ? json.confidence : 0,
      usageLogId: log?.id ?? null,
    });
  }),
);

// ----------------------------------------------------------------
// 2) Çözüm notu taslağı
// ----------------------------------------------------------------
router.post(
  '/draft-resolution',
  rateLimit,
  aiHandler('draft-resolution', async (req, res) => {
    const { caseSubject, description, category, history, notes, caseId, companyId } = req.body ?? {};
    req.aiLog.caseId = caseId;
    req.aiLog.companyId = companyId;

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
  aiHandler('supervisor-summary', async (req, res) => {
    const { case: c, history, notes, callLogs } = req.body ?? {};
    req.aiLog.caseId = c?.id;
    req.aiLog.companyId = c?.companyId;

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
  aiHandler('churn-conversion', async (req, res) => {
    const { case: c, callLogs, financialStatus, productUsage, usageChangeAlert } = req.body ?? {};
    req.aiLog.caseId = c?.id;
    req.aiLog.companyId = c?.companyId;

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
  aiHandler('dashboard-chat', async (req, res) => {
    const { message, history, context, companyId } = req.body ?? {};
    req.aiLog.companyId = companyId; // dashboard chat genelde tek vakaya bağlı değil
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
  aiHandler('call-summary', async (req, res) => {
    const { callLog, caseSubject, customerName, caseId, companyId } = req.body ?? {};
    req.aiLog.caseId = caseId;
    req.aiLog.companyId = companyId;
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
// 7) Vaka aktarımı önerisi — FAZ 2 §20.2
// ----------------------------------------------------------------
router.post(
  '/transfer-suggest',
  rateLimit,
  aiHandler('transfer-suggest', async (req, res) => {
    const { caseId } = req.body ?? {};
    if (!caseId || typeof caseId !== 'string') {
      return res.status(400).json({ error: 'caseId gerekli.' });
    }

    // 1. Vakayı bağlam ile çek (notes + callLogs + history son 3)
    const c = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        notes:    { orderBy: { createdAt: 'desc' }, take: 3 },
        callLogs: { orderBy: { callDate: 'desc' }, take: 2 },
      },
    });
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı.' });
    if (!req.user.allowedCompanyIds.includes(c.companyId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    req.aiLog.caseId = caseId;
    req.aiLog.companyId = c.companyId;

    // 2. Aynı şirketteki aktif takımlar — mevcut takım hariç
    const teams = await prisma.team.findMany({
      where: {
        companyId: c.companyId,
        isActive: true,
        ...(c.assignedTeamId ? { id: { not: c.assignedTeamId } } : {}),
      },
      select: { id: true, name: true, description: true },
    });
    if (teams.length === 0) {
      return res.status(400).json({
        error: 'no_alternative_teams',
        message: 'Bu şirkette başka aktif takım yok — aktarım yapılamaz.',
      });
    }

    // 3. Strict JSON schema — model sadece geçerli teamId üretebilir
    const teamIdEnum = teams.map((t) => t.id);
    const teamNameEnum = teams.map((t) => t.name);
    const reasonCodeEnum = ['wrong_team', 'expertise', 'workload', 'escalation', 'customer_request', 'other'];

    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['suggestedTeamId', 'suggestedTeamName', 'reasonCode', 'reasonText', 'confidence'],
      properties: {
        suggestedTeamId:   { type: 'string', enum: teamIdEnum },
        suggestedTeamName: { type: 'string', enum: teamNameEnum },
        reasonCode:        { type: 'string', enum: reasonCodeEnum },
        reasonText:        { type: 'string' },
        confidence:        { type: 'number' },
      },
    };

    const teamList = teams
      .map((t) => `- ${t.id} | ${t.name}${t.description ? ` — ${t.description}` : ''}`)
      .join('\n');
    const lastNotes = c.notes.length > 0
      ? c.notes.map((n) => `- ${n.content.slice(0, 200)}`).join('\n')
      : '(yok)';
    const lastCalls = c.callLogs.length > 0
      ? c.callLogs.map((cl) => `- ${cl.callOutcome ?? '-'}: ${(cl.description ?? '').slice(0, 150)}`).join('\n')
      : '(yok)';

    const system = [
      "Sen Varuna CRM'de vaka aktarımına yardımcı olan bir asistanısın.",
      'Bir vakayı analiz edip en uygun takıma yönlendirme önerisi verirsin.',
      'KURAL: suggestedTeamId MUTLAKA verilen takım listesinden olmalı.',
      'KURAL: suggestedTeamName, seçilen suggestedTeamId\'nin adı ile birebir aynı olmalı.',
      'KURAL: reasonCode listeden seçilmeli — sadece gerçekten karşılayan kodu seç.',
      'Türkçe yaz. SADECE JSON döndür.',
    ].join('\n');

    const userPrompt = [
      'Vaka:',
      `- Konu: ${c.title}`,
      `- Kategori: ${c.category} / ${c.subCategory}`,
      `- Statü: ${c.status} · Öncelik: ${c.priority}`,
      `- Mevcut Takım: ${c.assignedTeamName ?? '-'}`,
      `- Açıklama: ${c.description}`,
      '',
      'Son notlar:',
      lastNotes,
      '',
      'Son aramalar:',
      lastCalls,
      '',
      'Şirketin diğer takımları (id | ad — açıklama):',
      teamList,
      '',
      'Gerekçe kodları:',
      '- wrong_team: yanlış takıma atanmış',
      '- expertise: konuyu çözmek için farklı uzmanlık gerekiyor',
      '- workload: mevcut takım yoğun, başkasının daha hızlı bakabilir',
      '- escalation: eskalasyon — daha üst yetkili veya destek takımı',
      '- customer_request: müşteri açıkça başka bir takımla ilgilenmek istedi',
      '- other: yukarıdakilerin hiçbiri uymuyor',
      '',
      'reasonText: max 200 karakter, Türkçe, somut gerekçe (genel söz değil).',
      'confidence: 0.0-1.0 — kararına ne kadar emin olduğun.',
    ].join('\n');

    const t0 = Date.now();
    const { json, tokenCount } = await callOpenAI({
      system,
      user: userPrompt,
      schema,
      schemaName: 'transfer_suggestion',
    });

    // 4. Manuel logla → usageLogId'yi response'a ekleyebilelim.
    //    aiHandler'ın auto-log'unu skip et (req.aiLog.skipAutoLog) — duplikasyon olmasın.
    req.aiLog.skipAutoLog = true;
    const log = await logAIUsage({
      endpoint: 'transfer-suggest',
      companyId: c.companyId,
      caseId,
      userId: req.user.id,
      responseTimeMs: Date.now() - t0,
      tokenCount,
    });

    res.json({
      suggestedTeamId: json.suggestedTeamId,
      suggestedTeamName: json.suggestedTeamName,
      reasonCode: json.reasonCode,
      reasonText: json.reasonText,
      confidence: typeof json.confidence === 'number' ? json.confidence : 0,
      usageLogId: log?.id ?? null,
    });
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

/**
 * PATCH /api/ai/usage/:id/accept — kullanıcı AI önerisini Uygula/Yoksay
 * tıklayınca acceptance durumu kaydet. Acceptance rate hesabında bu kullanılır.
 *
 * Yetki: log'un companyId'si kullanıcının allowedCompanyIds'inde olmalı +
 * log'un userId'si kullanıcının id'siyle eşleşmeli (başkasının log'u
 * işaretlenemesin). userId null ise (eski kayıtlar / fallback) sadece
 * companyId scope kontrolü yeterli.
 */
router.patch('/usage/:id/accept', async (req, res) => {
  const { accepted } = req.body ?? {};
  if (typeof accepted !== 'boolean') {
    return res.status(400).json({ error: 'accepted boolean gerekli.' });
  }
  try {
    const target = await prisma.aIUsageLog.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'Log bulunamadı.' });
    if (!req.user.allowedCompanyIds.includes(target.companyId)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (target.userId && target.userId !== req.user.id) {
      return res.status(403).json({ error: 'forbidden — başkasının log kaydı.' });
    }
    const updated = await prisma.aIUsageLog.update({
      where: { id: req.params.id },
      data: { accepted },
    });
    res.json({ id: updated.id, accepted: updated.accepted });
  } catch (e) {
    console.error('[ai:usage-accept]', e);
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

export default router;
