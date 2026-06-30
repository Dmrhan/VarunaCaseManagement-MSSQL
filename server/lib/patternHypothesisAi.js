/**
 * Pattern Hypothesis AI — RUNA-tarzı commentary-only (PR-3).
 *
 * PatternAlert insight'larından (PR-1 patternInsight) AI hipotezi üretir:
 * "Olası kök sebep + önerilen aksiyon" — 2 cümle, Türkçe, KARAR DEĞİL,
 * SİNYAL.
 *
 * 🔒 PII GUARANTEE — kullanıcı revision'ı (P0):
 *
 *   AI prompt'a HAM BAŞLIK GIRMEZ. Yalnız yapısal sinyaller:
 *     - category (zaten kategori bazlı groupBy)
 *     - topAnaFirma.name (Account.name — tüzel kişi, PII değil)
 *     - topProduct.name (Product.name — ürün adı, PII değil)
 *     - topKeyword.word (tokenize + stop-word filtered, tek kelime)
 *     - caseCount, spike, isNewCategory
 *     - impact.* (sayılar)
 *
 *   ÇIKARILDI: exampleTitles, caseDescriptions, customerContact*,
 *   customerCompanyName, agent/person isimleri, e-mail, telefon.
 *
 *   Sanitize EK SAVUNMA: topKeyword tokenize zaten stop-word filter'lı
 *   (server/lib/patternInsight.js STOP_WORDS).
 *
 * REUSE:
 *  - aiClient.callOpenAI({schema}) — structured JSON output
 *  - logAIUsage — endpoint='pattern_hypothesis' AI panosunda görünür
 *  - actionSummaryAi.js paterni mirror (system/user prompt + schema)
 *
 * CACHE (caller'ın sorumluluğu): aiHypothesis + aiHypothesisAt PatternAlert
 * üzerinde; bu helper sadece "üret + döndür", saklama caller'da.
 */

import { callOpenAI, logAIUsage } from './aiClient.js';

const HYPOTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hypothesis', 'suggestedAction'],
  properties: {
    hypothesis: {
      type: 'string',
      description: 'Olası kök sebep, 1-2 kısa Türkçe cümle. Karar değil; hipotez.',
    },
    suggestedAction: {
      type: 'string',
      description: 'Önerilen sonraki adım, 1 kısa Türkçe cümle. Operatör onaylar.',
    },
  },
};

const SYSTEM_PROMPT = `Sen bir destek operasyonları analist asistanısın. Sana son 60 dakikada açılan vakaların yapısal özetini veriyorum.
Görevin: kısa bir KÖK SEBEP HİPOTEZİ + önerilen sonraki adım üretmek.

Kurallar:
- Yalnız sana verilen yapısal sinyallere dayan; uydurma yapma.
- Eğer bilgi yetersizse "Yeterli bilgi yok" diye yaz.
- Tonlama: net, kısa, profesyonel, Türkçe.
- KARAR VERME. "Olası", "muhtemel" gibi belirsizlik ifadeleri kullan.
- Müşteri/agent/birey ismi geçmez (zaten gelmiyor).
- En fazla 2 cümle hipotez, 1 cümle aksiyon.`;

/**
 * AI hipotezi üret.
 *
 * @param {Object} params
 * @param {Object} params.alert — PatternAlert row (category, caseCount, windowMinutes)
 * @param {Object} params.insight — PR-1 enrichPatternAlert çıktısı
 * @param {string|null} params.userId — logAIUsage için (opsiyonel)
 * @returns {Promise<{ hypothesis: string, suggestedAction: string } | null>}
 *   AI fail → null (graceful degrade)
 */
export async function generatePatternHypothesis({ alert, insight, userId = null }) {
  if (!alert || !insight) return null;

  // YAPISAL girdi — ham metin YOK (kullanıcı revision PII guard)
  const structuredInput = {
    kategori: alert.category,
    pencereDakika: alert.windowMinutes ?? 60,
    vakaSayisi: alert.caseCount,
    spike: insight.spike?.value ?? null,
    isNewCategory: insight.spike?.isNew ?? false,
    baselinePerHour: insight.spike?.baselinePerHour ?? 0,
    topAnaFirma: insight.commonThread?.topAnaFirma
      ? {
          ad: insight.commonThread.topAnaFirma.name,
          baskinlik: `${Math.round((insight.commonThread.topAnaFirma.dominance ?? 0) * 100)}%`,
        }
      : null,
    topUrun: insight.commonThread?.topProduct
      ? {
          ad: insight.commonThread.topProduct.name,
          baskinlik: `${Math.round((insight.commonThread.topProduct.dominance ?? 0) * 100)}%`,
        }
      : null,
    topAnahtarKelime: insight.commonThread?.topKeyword
      ? {
          kelime: insight.commonThread.topKeyword.word,
          baskinlik: `${Math.round((insight.commonThread.topKeyword.dominance ?? 0) * 100)}%`,
        }
      : null,
    etki: {
      etkilenenMusteri: insight.impact?.distinctAccounts ?? 0,
      slaRiskinde: insight.impact?.slaAtRisk ?? 0,
      acikVaka: insight.impact?.openCount ?? 0,
    },
  };

  const userPrompt = `Vaka örüntüsü özeti:\n\n${JSON.stringify(structuredInput, null, 2)}`;

  const startedAt = Date.now();
  try {
    const result = await callOpenAI({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      schema: HYPOTHESIS_SCHEMA,
      schemaName: 'pattern_hypothesis',
    });

    const responseTimeMs = Date.now() - startedAt;
    // logAIUsage fire-and-forget
    void logAIUsage({
      endpoint: 'pattern_hypothesis',
      companyId: alert.companyId,
      caseId: null, // PatternAlert vaka-spesifik değil; caseId nullable bu endpoint için OK
      userId,
      responseTimeMs,
      tokenCount: result?.tokenCount ?? null,
    });

    const data = result?.data ?? result?.parsed ?? result;
    if (!data || typeof data !== 'object') return null;

    // Final shape — AI'in döndürdüğünü güvenli alana al
    if (
      typeof data.hypothesis === 'string'
      && typeof data.suggestedAction === 'string'
    ) {
      return {
        hypothesis: data.hypothesis.slice(0, 600),
        suggestedAction: data.suggestedAction.slice(0, 400),
      };
    }
    return null;
  } catch (err) {
    console.warn('[ai:pattern-hypothesis] failed', err?.message);
    // logAIUsage fail durumunu da yaz (debug için)
    void logAIUsage({
      endpoint: 'pattern_hypothesis',
      companyId: alert.companyId,
      caseId: null,
      userId,
      responseTimeMs: Date.now() - startedAt,
      tokenCount: null,
    });
    return null;
  }
}

// Test/audit için iç yapıları export et
export const _internal = {
  SYSTEM_PROMPT,
  HYPOTHESIS_SCHEMA,
};
