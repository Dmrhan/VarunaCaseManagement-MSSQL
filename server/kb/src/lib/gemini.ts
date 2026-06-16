/*
 * LLM provider wrapper — dosya adı "gemini" tarihsel (orjinal entegrasyon
 * Gemini ile başlamıştı), ama artık şunları kullanıyor:
 *
 *   - Generation → Anthropic Claude (sonnet primary, haiku fast)
 *   - Embedding  → Lokal model (transformers.js + multilingual-e5-large)
 *
 * Export contract'ı değişmedi — call site'lar dokunulmadı:
 *   embed(text)       → number[]
 *   embedBatch(texts) → number[][]
 *   generate(systemInstruction, userPrompt, options) → { text, modelUsed, latencyMs }
 *
 * Tier sistemi: GenerateOptions.tier ile model seçimi:
 *   "primary" (default) → claude-sonnet-4-5 (kaliteli analiz)
 *   "fast"               → claude-haiku-4-5 (verifier, categorize, rerank için ucuz)
 *
 * NOT: Lokal embedding modeli ilk kullanımda ~1.3 GB dosya indirir
 * (~/.cache/huggingface/...). Sonraki çağrılar disk cache'inden yüklenir.
 * E5 modelleri için query'lere "query: " prefix, dokümanlara "passage: "
 * prefix gerekir (model spec). embedBatch dokümanlar için kullanılır,
 * embed sorgular için kullanılır.
 */

import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

// ─── Claude client singleton ─────────────────────────────────────────────

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (anthropicClient) return anthropicClient;
  const apiKey = env().ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY eksik (.env dosyasına ekle).");
  }
  anthropicClient = new Anthropic({
    apiKey,
    maxRetries: env().ANTHROPIC_MAX_RETRIES,
  });
  return anthropicClient;
}

// ─── Lokal embedding (transformers.js) ───────────────────────────────────

// transformers.js'i dinamik import et (server-only, Next.js bundle'ından
// uzak tut). pipeline() heavy bir runtime; singleton olarak tut.
type EmbedderInput = string | string[];
type EmbedderOutput = {
  data: Float32Array | number[];
  dims: number[];
};
type EmbedFn = (
  input: EmbedderInput,
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<EmbedderOutput>;

let embedderPromise: Promise<EmbedFn> | null = null;

function getEmbedder(): Promise<EmbedFn> {
  if (embedderPromise) return embedderPromise;
  embedderPromise = (async () => {
    // Next.js Turbopack için: __turbopack__'a takılmasın diye dynamic import.
    const mod = (await import("@xenova/transformers")) as unknown as {
      pipeline: (
        task: string,
        model: string,
        opts?: Record<string, unknown>,
      ) => Promise<EmbedFn>;
      env?: { allowLocalModels?: boolean; cacheDir?: string };
    };
    if (mod.env) {
      mod.env.allowLocalModels = true;
    }
    const modelName = env().LOCAL_EMBEDDING_MODEL;
    // quantized=true → int8 modeli kullanır, CPU'da ~3-4x daha hızlı.
    // multilingual-e5-large bile quantize ile pratik kullanılır hale gelir.
    const pipe = await mod.pipeline("feature-extraction", modelName, {
      quantized: true,
    });
    return pipe;
  })();
  return embedderPromise;
}

const DIM = () => env().LOCAL_EMBEDDING_DIM;

/**
 * E5 modelleri için: query/passage prefix'leri eklenir.
 * embed() sorgular için → "query: <text>"
 * embedBatch() dokümanlar için → "passage: <text>"
 *
 * Diğer modeller için prefix önemli değil ama zararı da yok.
 */
function isE5Model(): boolean {
  return /e5/i.test(env().LOCAL_EMBEDDING_MODEL);
}

function prefixForQuery(text: string): string {
  return isE5Model() ? `query: ${text}` : text;
}

function prefixForPassage(text: string): string {
  return isE5Model() ? `passage: ${text}` : text;
}

function toArray(d: Float32Array | number[]): number[] {
  if (Array.isArray(d)) return d;
  return Array.from(d);
}

/** Tek metin → embedding vektörü (query için). */
export async function embed(text: string): Promise<number[]> {
  const dim = DIM();
  const trimmed = text.trim();
  if (!trimmed) return new Array(dim).fill(0);

  const embedder = await getEmbedder();
  const result = await embedder(prefixForQuery(trimmed.slice(0, 4000)), {
    pooling: "mean",
    normalize: true,
  });
  return toArray(result.data).slice(0, dim);
}

/**
 * Toplu embedding (passage için) — transformers.js native batch.
 * Bir pipeline çağrısında N input geçer, tek forward pass'le N vektör döner.
 * Tokenizer attention padding ile batch'i hizalar.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const dim = DIM();
  const embedder = await getEmbedder();

  // Boş metinleri yer tutucu ile değiştir; sonradan zero-vector ile değiştiririz.
  const placeholders: number[] = [];
  const inputs: string[] = [];
  texts.forEach((t, i) => {
    const trimmed = t.trim();
    if (!trimmed) placeholders.push(i);
    inputs.push(prefixForPassage((trimmed || ".").slice(0, 4000)));
  });

  const result = await embedder(inputs, {
    pooling: "mean",
    normalize: true,
  });
  // result.dims = [batch, hidden] (pooling: mean sonrası)
  // result.data = flat Float32Array of length batch * hidden
  const flat = result.data;
  const hidden = result.dims[result.dims.length - 1] ?? dim;

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    if (placeholders.includes(i)) {
      out.push(new Array(dim).fill(0));
      continue;
    }
    const start = i * hidden;
    const slice =
      flat instanceof Float32Array
        ? Array.from(flat.subarray(start, start + hidden))
        : (flat as number[]).slice(start, start + hidden);
    out.push(slice.slice(0, dim));
  }
  return out;
}

// ─── Transient error detection ────────────────────────────────────────────

/** Geçici hata mı (retry'a değer mi)? */
export function isTransientGeminiError(err: unknown): boolean {
  // İsim "gemini" geriye uyumluluk için; her provider için çalışır.
  const e = err as
    | { status?: number; message?: string; name?: string }
    | undefined;
  if (!e) return false;
  if (e.status === 429 || e.status === 503 || e.status === 502 || e.status === 504) {
    return true;
  }
  const msg = e.message ?? "";
  return /\b(503|429|502|504)\b|rate.?limit|overloaded|timeout|fetch failed|ECONNRESET|EAI_AGAIN|socket hang up/i.test(
    msg,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Generation (Claude) ─────────────────────────────────────────────────

export type GenerateOptions = {
  temperature?: number;
  maxOutputTokens?: number;
  /** Claude doğal JSON mode'u yok; ipucu olarak system prompt'a güveniyoruz. */
  responseMimeType?: "text/plain" | "application/json";
  /** primary = Sonnet (kaliteli), fast = Haiku (ucuz/hızlı). Default primary. */
  tier?: "primary" | "fast";
};

type AttemptPlan = { model: string; delayMs: number; label: string };

async function* claudeAttempts(
  tier: "primary" | "fast",
): AsyncGenerator<AttemptPlan> {
  const e = env();
  if (tier === "fast") {
    yield { model: e.ANTHROPIC_FAST_MODEL, delayMs: 0, label: "fast-primary" };
    yield { model: e.ANTHROPIC_FAST_MODEL, delayMs: 1500, label: "fast-retry" };
    yield {
      model: e.ANTHROPIC_PRIMARY_MODEL,
      delayMs: 3000,
      label: "fast-fallback-to-primary",
    };
    return;
  }
  yield { model: e.ANTHROPIC_PRIMARY_MODEL, delayMs: 0, label: "primary" };
  yield {
    model: e.ANTHROPIC_PRIMARY_MODEL,
    delayMs: 1500,
    label: "primary-retry",
  };
  yield {
    model: e.ANTHROPIC_FAST_MODEL,
    delayMs: 3000,
    label: "primary-fallback-to-fast",
  };
}

/**
 * Claude model fiyat tablosu — USD / milyon token.
 * Anthropic resmi public pricing'i takip eder; yeni model eklendiğinde
 * burayı güncelleyin. Bilinmeyen modeller için 0 döner (cost = 0).
 */
const CLAUDE_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  // Sonnet 4.x ailesi
  "claude-sonnet-4-5": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  "claude-sonnet-4-5-20251022": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  "claude-sonnet-4-6": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  "claude-sonnet-4-7": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  // Haiku 4.x ailesi (fast tier)
  "claude-haiku-4-5": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  "claude-haiku-4-5-20251022": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  // Opus 4.x ailesi
  "claude-opus-4-5": { inputPerMTok: 15.0, outputPerMTok: 75.0 },
};

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = CLAUDE_PRICING[model];
  if (!p) {
    // Bilinmeyen model → konservatif Sonnet fiyatına düş; yine de logla
    console.warn(`[gemini] bilinmeyen model fiyatı: ${model} → Sonnet rate kullanılıyor`);
    return (inputTokens * 3.0 + outputTokens * 15.0) / 1_000_000;
  }
  return (inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok) / 1_000_000;
}

export type GenerateResult = {
  text: string;
  modelUsed: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** USD cinsinden tahmini maliyet — modele göre. */
  costUsd: number;
};

export async function generate(
  systemInstruction: string,
  userPrompt: string,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const tier = options.tier ?? "primary";
  // JSON istenmişse system prompt'a kuvvetli imza ekle (Claude doğal
  // structured output kullanmıyoruz; prompt mühendisliği).
  const effectiveSystem =
    options.responseMimeType === "application/json"
      ? `${systemInstruction}\n\nÖNEMLİ ÇIKIŞ FORMATI: Yanıt SADECE geçerli bir JSON nesnesi olmalı. Açıklama, kod bloğu (üç tırnak), ön/son metin EKLEME. Direkt { ile başlat, } ile bitir.`
      : systemInstruction;

  let lastErr: unknown = null;
  for await (const { model, delayMs } of claudeAttempts(tier)) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      const start = Date.now();
      const resp = await getAnthropic().messages.create({
        model,
        max_tokens: options.maxOutputTokens ?? 2048,
        temperature: options.temperature ?? 0.2,
        system: effectiveSystem,
        messages: [{ role: "user", content: userPrompt }],
      });
      // Claude content blokları array — text bloklarını birleştir.
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const inputTokens = resp.usage?.input_tokens ?? 0;
      const outputTokens = resp.usage?.output_tokens ?? 0;
      return {
        text,
        modelUsed: model,
        latencyMs: Date.now() - start,
        inputTokens,
        outputTokens,
        costUsd: estimateCostUsd(model, inputTokens, outputTokens),
      };
    } catch (err) {
      lastErr = err;
      if (!isTransientGeminiError(err)) throw err;
    }
  }
  throw lastErr ?? new Error("Claude generate başarısız (bilinmeyen).");
}
