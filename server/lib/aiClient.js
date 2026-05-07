import OpenAI from 'openai';
import { prisma } from '../db/client.js';

/**
 * AI istemci modülü — server/routes/ai.js + transfer/case route'ları paylaşıyor.
 * `callOpenAI` ve `logAIUsage` tek yerde tanımlı; her iki katman da aynı
 * timeout/parsing/log davranışına sahip olsun.
 */

export const AI_MODEL = 'gpt-4o-mini';
export const AI_MAX_TOKENS = 1000;
export const AI_TIMEOUT_MS = 30_000;

const apiKey = process.env.OPENAI_API_KEY;
export const aiClient = apiKey ? new OpenAI({ apiKey }) : null;

/**
 * AI usage telemetry — her başarılı çağrı için bir AIUsageLog satırı.
 * companyId yoksa sessizce skip; log yazma hatası ana akışı durdurmaz.
 * Yaratılan satırı döner (id alanını çağırana iletmek isteyenler için);
 * skip/hata durumunda null.
 */
export async function logAIUsage({ endpoint, companyId, caseId, userId, responseTimeMs, tokenCount }) {
  if (!companyId || !endpoint) return null;
  try {
    return await prisma.aIUsageLog.create({
      data: {
        endpoint,
        companyId,
        caseId: caseId ?? null,
        userId: userId ?? null,
        responseTimeMs: responseTimeMs ?? null,
        tokenCount: tokenCount ?? null,
        accepted: null,
      },
    });
  } catch (e) {
    console.warn('[ai-usage-log]', e?.message ?? e);
    return null;
  }
}

/**
 * Ortak OpenAI çağrısı.
 * - schema verilirse strict json_schema modu (decoding-time enum kilidi)
 * - expectJson: response_format=json_object (soft)
 * - varsayılan: düz metin
 */
export async function callOpenAI({ system, user, expectJson = false, schema = null, schemaName = 'response' }) {
  if (!aiClient) {
    const err = new Error('AI servisi yapılandırılmamış (API key yok).');
    err.status = 503;
    throw err;
  }

  let responseFormat;
  if (schema) {
    responseFormat = {
      type: 'json_schema',
      json_schema: { name: schemaName, schema, strict: true },
    };
  } else if (expectJson) {
    responseFormat = { type: 'json_object' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const resp = await aiClient.chat.completions.create(
      {
        model: AI_MODEL,
        max_tokens: AI_MAX_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        ...(responseFormat ? { response_format: responseFormat } : {}),
      },
      { signal: ctrl.signal },
    );
    const text = (resp.choices?.[0]?.message?.content ?? '').trim();
    const tokenCount = resp.usage?.total_tokens ?? null;

    if (!expectJson && !schema) return { text, tokenCount };

    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    try {
      return { json: JSON.parse(cleaned), raw: text, tokenCount };
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
