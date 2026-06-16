/*
 * KB embedder — bekleyen chunk'ları batch'ler halinde Gemini'ye gönderir,
 * sonuçları kb_embeddings (+ vec0) tablosuna yazar. Resumable: kesilip
 * yeniden çalıştırılırsa kalan chunk'lardan devam eder.
 */

import { embedBatch, isTransientGeminiError } from "../gemini";
import { env } from "../env";
import {
  chunksNeedingEmbedding,
  saveChunkEmbeddings,
  type KbChunkPending,
} from "./db";

export type EmbedRunOpts = {
  batchSize?: number;
  maxChunks?: number;
  onProgress?: (info: { done: number; total: number }) => void;
};

export async function embedPendingChunks(
  opts: EmbedRunOpts = {},
): Promise<{ embedded: number; skipped: number; durationMs: number }> {
  const model = env().GEMINI_EMBEDDING_MODEL;
  const batchSize = opts.batchSize ?? 16;
  const maxChunks = opts.maxChunks ?? 5000;
  const startedAt = Date.now();

  let totalEmbedded = 0;
  let totalSkipped = 0;

  // Network/fetch hatalarını da geçici sayalım — "fetch failed", "ECONNRESET",
  // "socket hang up" gibi pattern'leri de geçici olarak tut.
  const isRetryable = (err: unknown): boolean => {
    if (isTransientGeminiError(err)) return true;
    const m = String((err as Error | undefined)?.message ?? "");
    return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|aborted/i.test(
      m,
    );
  };

  // Tek batch için exponential backoff'lu retry. 4 deneme: 0, 2s, 5s, 15s.
  const embedWithRetry = async (texts: string[]): Promise<number[][]> => {
    const delays = [0, 2000, 5000, 15000];
    let lastErr: unknown = null;
    for (const delay of delays) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      try {
        return await embedBatch(texts);
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err)) throw err;
        const msg = (err as Error).message.slice(0, 100);
        console.warn(`[kb/embed] batch retry (delay ${delay}ms): ${msg}`);
      }
    }
    throw lastErr;
  };

  let consecutiveBatchFails = 0;

  for (;;) {
    const remaining = maxChunks - totalEmbedded;
    if (remaining <= 0) break;

    const pending: KbChunkPending[] = chunksNeedingEmbedding(
      model,
      Math.min(batchSize, remaining),
    );
    if (pending.length === 0) break;

    let vectors: number[][];
    try {
      vectors = await embedWithRetry(pending.map((c) => c.content));
      consecutiveBatchFails = 0;
    } catch (err) {
      consecutiveBatchFails++;
      console.warn(
        `[kb/embed] batch tamamen fail (${consecutiveBatchFails}. ardışık): ${(err as Error).message.slice(0, 150)}`,
      );
      if (consecutiveBatchFails >= 5) {
        // 5 batch arka arkaya fail → durumu rapor edip exit; resumable
        throw new Error(
          `[kb/embed] 5 ardışık batch hatası — durduruluyor. Sonra tekrar başlatabilirsiniz (resumable). Son hata: ${(err as Error).message}`,
        );
      }
      // Bu batch'i atla, döngüye devam et. chunksNeedingEmbedding aynı
      // batch'i tekrar getirir — eğer Gemini geçici hata veriyorsa sonraki
      // denemede başarılı olabilir. 30s bekle.
      console.warn(`[kb/embed] 30s bekleyip tekrar denenecek...`);
      await new Promise((r) => setTimeout(r, 30000));
      continue;
    }

    const items = pending
      .map((c, i) => {
        const vec = vectors[i];
        if (!vec || vec.length === 0) {
          totalSkipped++;
          return null;
        }
        return {
          chunk_id: c.chunk_id,
          content_hash: c.content_hash,
          vector: vec,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const written = saveChunkEmbeddings(items, model);
    totalEmbedded += written;

    if (opts.onProgress) {
      opts.onProgress({ done: totalEmbedded, total: maxChunks });
    }
  }

  return {
    embedded: totalEmbedded,
    skipped: totalSkipped,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Bir sorgu metnini embed et — retrieval öncesi tek seferlik çağrı.
 * gemini-embedding-001 query/document task type ayrımı destekliyor;
 * embedContent() default'u "RETRIEVAL_QUERY" değil "RETRIEVAL_DOCUMENT"
 * olduğu için ileride task_type parametresi eklenebilir. Şimdilik tek
 * model + tek vektör akışı yeterli.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const { embed } = await import("../gemini");
  return embed(text);
}
