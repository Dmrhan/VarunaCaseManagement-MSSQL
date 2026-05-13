import { Router } from 'express';
import { verifyJwt } from '../db/auth.js';
import { prisma } from '../db/client.js';
import { aiClient, callOpenAI, logAIUsage, AI_MODEL, AI_MAX_TOKENS, AI_TIMEOUT_MS } from '../lib/aiClient.js';
import { computeOperationsOverview } from '../analytics/operationsAggregator.js';
import { deriveAnalyticsScope, describeScope } from '../analytics/scopeDerivation.js';
import { FORMULA_VERSION } from '../analytics/metricFormulas.js';
import {
  buildOperationsSnapshot,
  buildBriefPrompt,
  buildInsightsPrompt,
  buildExplainPrompt,
  buildReportPrompt,
  buildDrilldownAssistPrompt,
  sanitizeBrief,
  sanitizeInsights,
  sanitizeExplain,
  sanitizeReport,
  sanitizeDrilldownAssist,
  isAllowedMetricKey,
  isAllowedAssistMode,
} from '../ai/operationsAnalyst.js';
import {
  validateDrilldownBucket,
  buildDrilldownWhere,
  buildDrilldownOrderBy,
  mapDrilldownCase,
  bucketLabel,
} from '../analytics/drilldownQuery.js';

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

// ----------------------------------------------------------------
// Input validation — cost protection. (Smoke Audit P2.3)
// Her endpoint kabul edilen field'lar icin max length + max array items
// kontrolu yapar; ihlalde 400 doner ve OpenAI'ye gitmez.
// ----------------------------------------------------------------
const AI_LIMITS = {
  shortText:    500,    // title, accountName, category
  mediumText:   2_000,  // history item, message, note content
  longText:     5_000,  // description, transcript, large content
  arrayItems:   50,     // repeatedIssues, evidence, history
  historyItems: 20,     // dashboard chat history
};

/**
 * Verilen body alanlarinin boyutunu dogrula. Sorun varsa hata mesaji (string)
 * doner; aksi halde null. Route handler bu cikti varsa 400 ile reddeder.
 *
 * @param {object} body
 * @param {Array<[key: string, kind: 'shortText'|'mediumText'|'longText'|'array'|'history']>} rules
 */
function validateAiInputs(body, rules) {
  if (!body || typeof body !== 'object') return null;
  for (const [key, kind] of rules) {
    const v = body[key];
    if (v == null) continue; // optional; presence check ayri yapilir
    if (kind === 'shortText' || kind === 'mediumText' || kind === 'longText') {
      if (typeof v !== 'string') continue; // shape check ayri
      const max = AI_LIMITS[kind];
      if (v.length > max) {
        return `${key} cok uzun (max ${max} karakter, gelen ${v.length}).`;
      }
    } else if (kind === 'array') {
      if (!Array.isArray(v)) continue;
      if (v.length > AI_LIMITS.arrayItems) {
        return `${key} cok fazla oge icin (max ${AI_LIMITS.arrayItems}).`;
      }
    } else if (kind === 'history') {
      if (!Array.isArray(v)) continue;
      if (v.length > AI_LIMITS.historyItems) {
        return `${key} gecmis ogesi limit (max ${AI_LIMITS.historyItems}).`;
      }
      for (const item of v) {
        const text = typeof item === 'string' ? item : item?.content;
        if (typeof text === 'string' && text.length > AI_LIMITS.mediumText) {
          return `${key} icinde tek bir mesaj cok uzun (max ${AI_LIMITS.mediumText}).`;
        }
      }
    }
  }
  return null;
}

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
      const isTimeout = err?.name === 'AbortError';
      const upstream = err?.status; // OpenAI SDK throw'larında veya aiClient'ta set edilir
      // Frontend aiService.postJson mapping: 429→rate_limited, 503→unconfigured,
      // 504→timeout, diger non-2xx→server.
      // OpenAI hatalarini buraya gore esle (Smoke Audit P1.5):
      let status;
      let errorCode;
      if (isTimeout) {
        status = 504;
        errorCode = 'timeout';
      } else if (upstream === 401 || upstream === 403) {
        // API key gecersiz/revoke → kullanici "AI yapilandirilmamis" gorsun
        status = 503;
        errorCode = 'ai_unavailable';
      } else if (upstream === 429) {
        status = 429;
        errorCode = 'rate_limited';
      } else if (upstream === 503) {
        // aiClient.callOpenAI "API key yok" durumunda 503 firlatir — koru.
        status = 503;
        errorCode = 'ai_unavailable';
      } else if (upstream === 502) {
        // aiClient parse hatasi
        status = 502;
        errorCode = 'ai_parse_error';
      } else if (typeof upstream === 'number' && upstream >= 400 && upstream < 600) {
        // Diger OpenAI/upstream hatalari — frontend bunlari 'server' olarak isler
        status = 502;
        errorCode = 'ai_error';
      } else {
        // Bilinmeyen — bizim bug'imiz olabilir; 500 yerine 502 don ki "AI tarafi"
        // gibi gorunsun ve frontend "AI onerisi alinamadi" toast'i gostersin.
        status = 502;
        errorCode = 'ai_error';
      }
      console.error(`[ai] hata (upstream=${upstream ?? '-'}, mapped=${status}):`, err?.message ?? err);
      res.status(status).json({
        error: errorCode,
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
    {
      const e = validateAiInputs(req.body, [
        ['description', 'longText'],
        ['companyName', 'shortText'],
      ]);
      if (e) return res.status(400).json({ error: 'input_too_large', message: e });
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
    {
      const e = validateAiInputs(req.body, [['description', 'longText']]);
      if (e) return res.status(400).json({ error: 'input_too_large', message: e });
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
    {
      const e = validateAiInputs(req.body, [
        ['message', 'mediumText'],
        ['history', 'history'],
      ]);
      if (e) return res.status(400).json({ error: 'input_too_large', message: e });
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
    if (!(req.user?.allowedCompanyIds ?? []).includes(c.companyId)) {
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
// 8) Customer Pulse — AI-zenginleştirilmiş özet
// Roadmap §"Customer Context Intelligence" Phase 5.
//
// Deterministic Customer Pulse (caseRepository.getCustomerPulse) çoktan
// state + metrics + summary üretiyor. Bu endpoint o veriyi alır ve daha
// doğal Türkçe 2-3 cümlelik özet + öneri üretir.
//
// GÜVENLİK NOTU: SADECE numeric/kategorik veri AI'a gönderilir. Raw note
// veya call log içeriği gitmez — KVKK uyumlu yaklaşım.
// ----------------------------------------------------------------
router.post(
  '/customer-pulse-summary',
  rateLimit,
  aiHandler('customer-pulse-summary', async (req, res) => {
    const { caseId, accountName, state, metrics, repeatedIssues, evidence } = req.body ?? {};
    if (!caseId || typeof caseId !== 'string') {
      return res.status(400).json({ error: 'caseId gerekli.' });
    }
    if (!state || typeof state !== 'string') {
      return res.status(400).json({ error: 'state gerekli (Stable/Watch/Risky/Critical).' });
    }
    if (!metrics || typeof metrics !== 'object') {
      return res.status(400).json({ error: 'metrics gerekli.' });
    }
    {
      const e = validateAiInputs(req.body, [
        ['accountName',    'shortText'],
        ['state',          'shortText'],
        ['repeatedIssues', 'array'],
        ['evidence',       'array'],
      ]);
      if (e) return res.status(400).json({ error: 'input_too_large', message: e });
    }

    // Vakanın companyId'sini telemetri için al — scope kontrolüne gerek yok
    // çünkü body sadece numerik/kategorik veri (yan kanal sızıntı riski yok).
    const c = await prisma.case.findUnique({
      where: { id: caseId },
      select: { companyId: true },
    });
    req.aiLog.caseId = caseId;
    req.aiLog.companyId = c?.companyId ?? req.user?.allowedCompanyIds?.[0];

    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'recommendedAction', 'evidence'],
      properties: {
        summary:           { type: 'string' },
        recommendedAction: { type: 'string' },
        evidence:          { type: 'array', items: { type: 'string' } },
      },
    };

    const repeatedList = Array.isArray(repeatedIssues) && repeatedIssues.length > 0
      ? repeatedIssues
          .slice(0, 3)
          .map((r) => `- ${r.category}${r.subCategory ? ` / ${r.subCategory}` : ''}: ${r.count}×`)
          .join('\n')
      : '(yok)';
    const evidenceList = Array.isArray(evidence) && evidence.length > 0
      ? evidence.map((e) => `- ${e}`).join('\n')
      : '(yok)';

    const system = [
      "Sen Varuna CRM'de müşteri durum analizi yapan bir asistanısın.",
      'Bir agent\'a, vakayı açtığı müşterinin geniş durumunu özetlersin.',
      'Türkçe yaz. Soyut kalma — sayılara dayan.',
      'KURAL: SADECE JSON döndür.',
    ].join('\n');

    const user = [
      `Müşteri: ${accountName ?? '-'}`,
      `Durum etiketi: ${state}`,
      '',
      'Metrikler:',
      `- Açık vaka: ${metrics.openCases ?? 0}`,
      `- Son 30 gün: ${metrics.recent30d ?? 0}`,
      `- Son 90 gün: ${metrics.recent90d ?? 0}`,
      `- SLA ihlali: ${metrics.slaViolations ?? 0}`,
      `- Kritik vaka: ${metrics.criticalCases ?? 0}`,
      `- Eskalasyon: ${metrics.escalatedCases ?? 0}`,
      '',
      'Tekrar eden konular:',
      repeatedList,
      '',
      'Deterministic evidence:',
      evidenceList,
      '',
      'Görev:',
      '- summary: 2-3 cümle, müşterinin durumunu sayılarla destekleyerek özetle.',
      '- recommendedAction: 1-2 cümle, agent ne yapmalı — somut adım.',
      '- evidence: 3-5 madde, sayısal kanıtlar (TR, kısa).',
      '',
      'Veri yetersizse "stabil" olarak özetle, evidence\'a "Risk sinyali yok" yaz.',
    ].join('\n');

    const { json } = await callOpenAI({
      system,
      user,
      schema,
      schemaName: 'customer_pulse_summary',
    });

    res.json({
      summary: String(json.summary ?? '').slice(0, 600),
      recommendedAction: String(json.recommendedAction ?? '').slice(0, 400),
      evidence: Array.isArray(json.evidence)
        ? json.evidence.slice(0, 6).map((e) => String(e).slice(0, 200))
        : [],
    });
  }),
);

// ----------------------------------------------------------------
// 9) Linked cases önerisi — FAZ 2 Collab
// Vakaya benzer/ilişkili olabilecek vakaları AI ile tespit eder.
// Body: { caseId }
// Yanıt: { suggestions: [{ caseId, caseNumber, linkType, reason, confidence }] }
// Max 3 öneri. Strict JSON schema — caseId enum candidates'tan.
// ----------------------------------------------------------------
router.post(
  '/suggest-links',
  rateLimit,
  aiHandler('suggest-links', async (req, res) => {
    const { caseId } = req.body ?? {};
    if (!caseId || typeof caseId !== 'string') {
      return res.status(400).json({ error: 'caseId gerekli.' });
    }

    const c = await prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        companyId: true,
        caseNumber: true,
        title: true,
        description: true,
        category: true,
        subCategory: true,
        accountId: true,
        accountName: true,
      },
    });
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı.' });
    if (!(req.user?.allowedCompanyIds ?? []).includes(c.companyId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    req.aiLog.caseId = caseId;
    req.aiLog.companyId = c.companyId;

    // Aday vakalar: aynı şirket, son 30 gün, aynı kategori VEYA aynı müşteri,
    // kendisi hariç, max 20. Kapalı vakalar da dahil (duplicate detect için).
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const candidates = await prisma.case.findMany({
      where: {
        id: { not: caseId },
        companyId: c.companyId,
        createdAt: { gte: thirtyDaysAgo },
        OR: [
          { category: c.category },
          { accountId: c.accountId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        caseNumber: true,
        title: true,
        category: true,
        subCategory: true,
        accountName: true,
        status: true,
      },
    });

    if (candidates.length === 0) {
      return res.json({ suggestions: [] });
    }

    // Strict JSON schema — caseId mutlaka aday listeden olmalı.
    const candidateIdEnum = candidates.map((x) => x.id);
    const linkTypeEnum = ['Related', 'Duplicate', 'Parent'];

    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['suggestions'],
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['caseId', 'linkType', 'reason', 'confidence'],
            properties: {
              caseId:     { type: 'string', enum: candidateIdEnum },
              linkType:   { type: 'string', enum: linkTypeEnum },
              reason:     { type: 'string' },
              confidence: { type: 'number' },
            },
          },
        },
      },
    };

    const candidateList = candidates
      .map((x) => `- ${x.id} | ${x.caseNumber} | ${x.title} | ${x.category}/${x.subCategory} | ${x.accountName} | ${x.status}`)
      .join('\n');

    const system = [
      "Sen Varuna CRM'de vakalar arası bağlantıları tespit eden bir asistanısın.",
      'Bir ana vakayı ve aday vaka listesini analiz eder, gerçekten benzer veya ilişkili olanları önerirsin.',
      '',
      'KURALLAR:',
      '- caseId MUTLAKA aday listeden olmalı (enum kilidi).',
      '- linkType seçenekleri:',
      "    Related   — genel ilişki (aynı müşteri başka konu, aynı ürün grubu vs.)",
      "    Duplicate — aynı sorun (yüksek benzerlik, aynı müşteri tercih)",
      "    Parent    — bu vaka, hedef vakanın parçası/alt-kırılımı",
      '- Max 3 öneri. Zayıf eşleşmeleri ekleme — gerçekten anlamlı olmayanı yoksay.',
      '- reason max 100 karakter, Türkçe, somut (örn. "Aynı müşteri, benzer kategori").',
      '- confidence 0.0-1.0. Düşük güvenli önerileri ya kesin atla ya da 0.5 altında ver.',
      '- Çıktı SADECE JSON.',
    ].join('\n');

    const user = [
      'ANA VAKA:',
      `- No: ${c.caseNumber}`,
      `- Başlık: ${c.title}`,
      `- Kategori: ${c.category} / ${c.subCategory}`,
      `- Müşteri: ${c.accountName}`,
      `- Açıklama: ${(c.description ?? '').slice(0, 500)}`,
      '',
      'ADAY VAKALAR (son 30 gün, aynı şirket, aynı kategori VEYA aynı müşteri):',
      candidateList,
    ].join('\n');

    const { json } = await callOpenAI({
      system,
      user,
      schema,
      schemaName: 'suggest_links',
    });

    // Candidate id → caseNumber map'i ile zenginleştir
    const idMap = new Map(candidates.map((x) => [x.id, x]));
    const enriched = Array.isArray(json.suggestions)
      ? json.suggestions
          .slice(0, 3)
          .map((s) => {
            const meta = idMap.get(s.caseId);
            if (!meta) return null;
            return {
              caseId: s.caseId,
              caseNumber: meta.caseNumber,
              title: meta.title,
              linkType: s.linkType,
              reason: String(s.reason ?? '').slice(0, 100),
              confidence: typeof s.confidence === 'number' ? s.confidence : 0,
            };
          })
          .filter(Boolean)
      : [];

    res.json({ suggestions: enriched });
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
    if (!(req.user?.allowedCompanyIds ?? []).includes(target.companyId)) {
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

// ----------------------------------------------------------------
// Operations Intelligence — AI Analyst (Phase 4a)
// ----------------------------------------------------------------

const OPS_MAX_PERIOD_DAYS = 90;
const ONE_DAY_MS_OPS = 24 * 60 * 60 * 1000;

function validateOpsBody(body) {
  if (!body?.from || !body?.to) return { error: '`from` ve `to` zorunlu.' };
  const from = new Date(body.from);
  const to = new Date(body.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: 'Tarihler ISO formatinda olmali.' };
  }
  if (from >= to) return { error: '`from` `to` dan kucuk olmali.' };
  if (to.getTime() - from.getTime() > OPS_MAX_PERIOD_DAYS * ONE_DAY_MS_OPS) {
    return { error: `Donem ${OPS_MAX_PERIOD_DAYS} gunu asamaz.` };
  }
  return { from, to };
}

function sanitizeOpsStringArray(value) {
  if (!Array.isArray(value)) return null;
  const clean = value.filter((v) => typeof v === 'string' && v.length > 0).slice(0, 100);
  return clean.length > 0 ? clean : null;
}

/**
 * Filter set'inden scoped overview payload + AI snapshot uret.
 * Hem brief hem insights hem report endpoint'leri ayni yoldan gecer; tek kaynak.
 */
async function buildScopedSnapshot(req) {
  const body = req.body ?? {};
  const validation = validateOpsBody(body);
  if (validation.error) return { status: 400, error: validation.error };
  const { from, to } = validation;
  const scope = deriveAnalyticsScope(req.user, body);
  const filters = {
    from: from.toISOString(),
    to: to.toISOString(),
    productGroups: sanitizeOpsStringArray(body.productGroups),
    caseTypes: sanitizeOpsStringArray(body.caseTypes),
    statuses: sanitizeOpsStringArray(body.statuses),
    granularity: body.granularity === 'hour' ? 'hour' : 'day',
  };
  const payload = await computeOperationsOverview({ scope, filters });
  // operationsAggregator scope objesini payload icine yazmaz — burada ekleyelim ki narrative cikabilsin
  const enrichedPayload = { ...payload, scope: { narrative: describeScope(scope) } };
  const snapshot = buildOperationsSnapshot(scope, enrichedPayload, filters);
  return { scope, payload: enrichedPayload, snapshot, filters };
}

function scopeMetadata(scope) {
  return {
    kind: scope.scopeKind,
    companyIds: scope.companyIds,
    teamIds: scope.teamIds,
    personIds: scope.personIds,
    canExport: scope.canExport,
    canCrossCompanyAgg: scope.canCrossCompanyAgg,
    narrowedFromBody: scope.narrowedFromBody,
    narrative: describeScope(scope),
    effectiveScopeReason: scope.effectiveScopeReason,
  };
}

// 1) Operations Brief
router.post(
  '/operations-brief',
  rateLimit,
  aiHandler('operations-brief', async (req, res) => {
    const ctx = await buildScopedSnapshot(req);
    if (ctx.error) return res.status(ctx.status).json({ error: 'invalid_input', message: ctx.error });
    const { scope, snapshot } = ctx;
    req.aiLog.companyId = scope.companyIds?.[0];
    req.aiLog.skipAutoLog = true;
    const t0 = Date.now();
    const { json, tokenCount } = await callOpenAI({
      ...buildBriefPrompt(scope, snapshot),
      expectJson: true,
    });
    const brief = sanitizeBrief(json);
    const log = await logAIUsage({
      endpoint: 'operations-brief',
      companyId: scope.companyIds?.[0] ?? null,
      caseId: null,
      userId: req.user?.id ?? null,
      responseTimeMs: Date.now() - t0,
      tokenCount,
    });
    res.json({
      brief,
      scope: scopeMetadata(scope),
      formulaVersion: FORMULA_VERSION,
      generatedAt: new Date().toISOString(),
      usageLogId: log?.id ?? null,
      sourceMetricAuditId: null,
    });
  }),
);

// 2) Operations Insights
router.post(
  '/operations-insights',
  rateLimit,
  aiHandler('operations-insights', async (req, res) => {
    const ctx = await buildScopedSnapshot(req);
    if (ctx.error) return res.status(ctx.status).json({ error: 'invalid_input', message: ctx.error });
    const { scope, snapshot } = ctx;
    req.aiLog.companyId = scope.companyIds?.[0];
    req.aiLog.skipAutoLog = true;
    const t0 = Date.now();
    const { json, tokenCount } = await callOpenAI({
      ...buildInsightsPrompt(scope, snapshot),
      expectJson: true,
    });
    const insights = sanitizeInsights(json);
    const log = await logAIUsage({
      endpoint: 'operations-insights',
      companyId: scope.companyIds?.[0] ?? null,
      caseId: null,
      userId: req.user?.id ?? null,
      responseTimeMs: Date.now() - t0,
      tokenCount,
    });
    res.json({
      insights,
      scope: scopeMetadata(scope),
      generatedAt: new Date().toISOString(),
      usageLogId: log?.id ?? null,
    });
  }),
);

// 3) Operations Explain Metric
router.post(
  '/operations-explain-metric',
  rateLimit,
  aiHandler('operations-explain-metric', async (req, res) => {
    const { metricKey } = req.body ?? {};
    if (!isAllowedMetricKey(metricKey)) {
      return res.status(400).json({ error: 'invalid_metric', message: 'Bilinmeyen metricKey.' });
    }
    const ctx = await buildScopedSnapshot(req);
    if (ctx.error) return res.status(ctx.status).json({ error: 'invalid_input', message: ctx.error });
    const { scope, snapshot } = ctx;
    req.aiLog.companyId = scope.companyIds?.[0];
    req.aiLog.skipAutoLog = true;
    const t0 = Date.now();
    const { json, tokenCount } = await callOpenAI({
      ...buildExplainPrompt(scope, snapshot, metricKey),
      expectJson: true,
    });
    const explain = sanitizeExplain(json, metricKey);
    const log = await logAIUsage({
      endpoint: 'operations-explain-metric',
      companyId: scope.companyIds?.[0] ?? null,
      caseId: null,
      userId: req.user?.id ?? null,
      responseTimeMs: Date.now() - t0,
      tokenCount,
    });
    res.json({
      metricKey,
      ...explain,
      scope: scopeMetadata(scope),
      generatedAt: new Date().toISOString(),
      usageLogId: log?.id ?? null,
    });
  }),
);

// 5) Operations Drill-down AI Assistant (Phase 4b)
router.post(
  '/operations-drilldown-assist',
  rateLimit,
  aiHandler('operations-drilldown-assist', async (req, res) => {
    const body = req.body ?? {};
    const bucketCheck = validateDrilldownBucket(body.bucket);
    if (bucketCheck.error) {
      return res.status(400).json({ error: 'invalid_bucket', message: bucketCheck.error });
    }
    const mode = isAllowedAssistMode(body.mode) ? body.mode : 'summarize';
    if (!isAllowedAssistMode(body.mode)) {
      return res.status(400).json({ error: 'invalid_mode', message: '`mode` gecersiz.' });
    }
    const customPrompt = typeof body.customPrompt === 'string' ? body.customPrompt.slice(0, 500) : null;

    const ctx = await buildScopedSnapshot(req);
    if (ctx.error) return res.status(ctx.status).json({ error: 'invalid_input', message: ctx.error });
    const { scope, snapshot } = ctx;
    req.aiLog.companyId = scope.companyIds?.[0];
    req.aiLog.skipAutoLog = true;
    const t0 = Date.now();

    const bucket = bucketCheck.value;
    const from = new Date(snapshot.period.from);
    const to = new Date(snapshot.period.to);
    const where = buildDrilldownWhere({ scope, filters: ctx.filters, from, to, bucket });
    const orderBy = buildDrilldownOrderBy('createdAt', 'desc');

    const [total, rows] = await Promise.all([
      prisma.case.count({ where }),
      prisma.case.findMany({
        where,
        orderBy,
        take: 50,
        select: {
          id: true, caseNumber: true, title: true, status: true, priority: true,
          companyName: true, accountName: true, category: true, subCategory: true,
          assignedTeamName: true, assignedPersonName: true,
          createdAt: true, slaResolutionDueAt: true, slaViolation: true,
        },
      }),
    ]);
    const topRows = rows.map(mapDrilldownCase);
    const allowedCaseNumbers = topRows.map((r) => r.caseNumber);

    const { json, tokenCount } = await callOpenAI({
      ...buildDrilldownAssistPrompt({ scope, snapshot, bucket, mode, customPrompt, topRows, total }),
      expectJson: true,
    });
    const answer = sanitizeDrilldownAssist(json, allowedCaseNumbers);
    const log = await logAIUsage({
      endpoint: 'operations-drilldown-assist',
      companyId: scope.companyIds?.[0] ?? null,
      caseId: null,
      userId: req.user?.id ?? null,
      responseTimeMs: Date.now() - t0,
      tokenCount,
    });

    res.json({
      answer,
      scope: scopeMetadata(scope),
      bucket: { ...bucket, label: bucketLabel(bucket) },
      mode,
      rowCount: topRows.length,
      total,
      generatedAt: new Date().toISOString(),
      usageLogId: log?.id ?? null,
    });
  }),
);

// 4) Operations Report Draft
router.post(
  '/operations-report-draft',
  rateLimit,
  aiHandler('operations-report-draft', async (req, res) => {
    const ctx = await buildScopedSnapshot(req);
    if (ctx.error) return res.status(ctx.status).json({ error: 'invalid_input', message: ctx.error });
    const { scope, snapshot } = ctx;
    req.aiLog.companyId = scope.companyIds?.[0];
    req.aiLog.skipAutoLog = true;
    const t0 = Date.now();
    const { json, tokenCount } = await callOpenAI({
      ...buildReportPrompt(scope, snapshot),
      expectJson: true,
    });
    const report = sanitizeReport(json);
    const log = await logAIUsage({
      endpoint: 'operations-report-draft',
      companyId: scope.companyIds?.[0] ?? null,
      caseId: null,
      userId: req.user?.id ?? null,
      responseTimeMs: Date.now() - t0,
      tokenCount,
    });
    res.json({
      ...report,
      scope: scopeMetadata(scope),
      generatedAt: new Date().toISOString(),
      usageLogId: log?.id ?? null,
    });
  }),
);

export default router;
