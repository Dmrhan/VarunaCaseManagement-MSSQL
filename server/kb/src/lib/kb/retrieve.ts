/*
 * KB retrieval — hibrit (BM25 + vector) + Reciprocal Rank Fusion + optional
 * Gemini rerank.
 *
 * Akış:
 *   1. Query'i embed et (Gemini).
 *   2. Paralel olarak FTS5 (BM25) + sqlite-vec (cosine) sorgula → her birinden top K_RAW.
 *   3. RRF ile birleştir → top K_FUSED (default 20).
 *   4. (opsiyonel) Gemini ile rerank → top K_FINAL (default 8).
 *
 * Vector mevcut değilse (extension yüklenmediyse) sadece FTS5 kullanılır;
 * embedder de yoksa retrieval boş döner. Graceful degradation.
 */

import { getKbDb, isVecAvailable, DEFAULT_TENANT, type SourceType } from "./db";
import { embedQuery } from "./embedder";
import { env } from "../env";
import { generate } from "../gemini";

export type RetrievedChunk = {
  chunk_id: number;
  doc_id: string;
  source_type: SourceType;
  title: string | null;
  heading_path: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  bm25Score: number | null;
  vecScore: number | null;
  rrfScore: number;
  rerankScore: number | null;
};

export type RetrieveOpts = {
  topK?: number;
  rawK?: number;
  fusedK?: number;
  sourceTypes?: SourceType[];
  /** RRF formülünde k sabiti (Cormack et al. 2009: k=60). */
  rrfK?: number;
  /** true ise Gemini rerank yapılır (1 ekstra LLM çağrısı, ~1–2s). */
  rerank?: boolean;
  /** Multi-tenant izolasyon. Default 'varuna'. */
  tenantId?: string;

  /**
   * Tiered (cascade) retrieval — önce bu source type'larda arama yapılır.
   * Sonuçlar yeterli kalitedeyse diğer kaynaklara geçilmez. Aksi halde
   * tüm kaynaklarda (veya `sourceTypes` ile sınırlı) tam retrieve yapılır.
   *
   * "Yeterli kalite" ölçütü:
   *   - rerank true ise: en az bir chunk'ın rerank skoru
   *     priorityMinRerankScore üzerinde (default 5/10)
   *   - rerank false ise: en az priorityMinResults adet chunk döndü
   *     (default 2)
   */
  priorityTypes?: SourceType[];
  /** Tier-fallback için minimum chunk sayısı (rerank kapalıyken). Default 2. */
  priorityMinResults?: number;
  /** Tier-fallback için minimum rerank skoru (rerank açıkken). Default 5/10. */
  priorityMinRerankScore?: number;
};

const DEFAULTS = {
  topK: 8,
  rawK: 50,
  fusedK: 20,
  rrfK: 60,
} as const;

/** FTS5 için query string'i sterilize et: '"', '*', operatörleri kaçır. */
function buildFtsQuery(text: string): string {
  // Her kelimeyi tırnak içine alıp OR ile birleştir → her kelime ayrı arar.
  // FTS5 default operator AND, OR'u açık kullanmak gerekli.
  const tokens = text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/["()*]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return "";
  // Her token tırnak içinde → exact ama prefix match için "*" ekleyebiliriz.
  // Türkçe için prefix match recall'ı artırır.
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}

type FtsHit = { chunk_id: number; rank: number };

function ftsSearch(
  query: string,
  limit: number,
  sourceTypes?: SourceType[],
  tenantId?: string,
): FtsHit[] {
  const db = getKbDb();
  const q = buildFtsQuery(query);
  if (!q) return [];
  try {
    const params: Record<string, unknown> = {
      q,
      limit,
      tenant: tenantId ?? DEFAULT_TENANT,
    };
    let filterClause = "";
    if (sourceTypes && sourceTypes.length > 0) {
      const placeholders = sourceTypes
        .map((_, i) => `@type${i}`)
        .join(", ");
      filterClause = `AND d.source_type IN (${placeholders})`;
      sourceTypes.forEach((t, i) => {
        params[`type${i}`] = t;
      });
    }
    const rows = db
      .prepare(
        `
        SELECT c.chunk_id, bm25(kb_chunks_fts) AS score
        FROM kb_chunks_fts
        JOIN kb_chunks c ON c.chunk_id = kb_chunks_fts.rowid
        JOIN kb_documents d ON d.doc_id = c.doc_id
        WHERE kb_chunks_fts MATCH @q
          AND c.tenant_id = @tenant
          ${filterClause}
        ORDER BY score ASC
        LIMIT @limit
        `,
      )
      .all(params) as Array<{ chunk_id: number; score: number }>;
    // bm25 daha düşük = daha iyi; rank kendi sırasından gelsin
    return rows.map((r, i) => ({ chunk_id: r.chunk_id, rank: i + 1 }));
  } catch (err) {
    console.warn("[kb/retrieve] FTS arama hatası:", (err as Error).message);
    return [];
  }
}

type VecHit = { chunk_id: number; distance: number; rank: number };

function vecSearch(
  queryVec: number[],
  limit: number,
  sourceTypes?: SourceType[],
  tenantId?: string,
): VecHit[] {
  if (!isVecAvailable()) return [];
  const db = getKbDb();
  try {
    const buf = Buffer.from(new Float32Array(queryVec).buffer);
    const params: Record<string, unknown> = {
      v: buf,
      limit,
      tenant: tenantId ?? DEFAULT_TENANT,
    };

    let filterClause = "";
    if (sourceTypes && sourceTypes.length > 0) {
      const placeholders = sourceTypes
        .map((_, i) => `@type${i}`)
        .join(", ");
      filterClause = `AND d.source_type IN (${placeholders})`;
      sourceTypes.forEach((t, i) => {
        params[`type${i}`] = t;
      });
    }

    // vec0 syntax: WHERE embedding MATCH ? AND k = ?  — k parametresi limit
    // ile birlikte LIMIT kullanılır.
    const rows = db
      .prepare(
        `
        SELECT v.chunk_id, v.distance
        FROM kb_vec v
        JOIN kb_chunks c ON c.chunk_id = v.chunk_id
        JOIN kb_documents d ON d.doc_id = c.doc_id
        WHERE v.embedding MATCH @v
          AND k = @limit
          AND c.tenant_id = @tenant
          ${filterClause}
        ORDER BY v.distance
        `,
      )
      .all(params) as Array<{ chunk_id: number; distance: number }>;
    return rows.map((r, i) => ({
      chunk_id: r.chunk_id,
      distance: r.distance,
      rank: i + 1,
    }));
  } catch (err) {
    console.warn("[kb/retrieve] vec arama hatası:", (err as Error).message);
    return [];
  }
}

/**
 * Reciprocal Rank Fusion — iki ranked liste'yi birleştirir.
 * score(d) = Σ 1/(k + rank_i(d))
 */
function rrf(
  lists: Array<Array<{ chunk_id: number; rank: number }>>,
  k: number,
): Map<number, number> {
  const fused = new Map<number, number>();
  for (const list of lists) {
    for (const hit of list) {
      const prev = fused.get(hit.chunk_id) ?? 0;
      fused.set(hit.chunk_id, prev + 1 / (k + hit.rank));
    }
  }
  return fused;
}

function fetchChunksByIds(ids: number[]): Map<number, RetrievedChunk> {
  if (ids.length === 0) return new Map();
  const db = getKbDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT c.chunk_id, c.doc_id, c.heading_path, c.content,
             d.source_type, d.title, d.metadata_json
      FROM kb_chunks c
      JOIN kb_documents d ON d.doc_id = c.doc_id
      WHERE c.chunk_id IN (${placeholders})
      `,
    )
    .all(...ids) as Array<{
    chunk_id: number;
    doc_id: string;
    heading_path: string | null;
    content: string;
    source_type: SourceType;
    title: string | null;
    metadata_json: string | null;
  }>;
  const map = new Map<number, RetrievedChunk>();
  for (const r of rows) {
    map.set(r.chunk_id, {
      chunk_id: r.chunk_id,
      doc_id: r.doc_id,
      source_type: r.source_type,
      title: r.title,
      heading_path: r.heading_path,
      content: r.content,
      metadata: r.metadata_json ? safeJsonParse(r.metadata_json) : null,
      bm25Score: null,
      vecScore: null,
      rrfScore: 0,
      rerankScore: null,
    });
  }
  return map;
}

function safeJsonParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Tiered + hibrit retrieval entry point.
 *
 * Eğer `priorityTypes` verilmişse:
 *   1. Önce sadece o tiplerde arama yap
 *   2. Kalite eşiği geçerse o sonucu döndür (diğer kaynaklara hiç bakma)
 *   3. Yetersizse tüm kaynaklara genişlet
 *
 * Aksi takdirde tek-pass `retrieveCore` çağrısı.
 */
export async function retrieve(
  query: string,
  opts: RetrieveOpts = {},
): Promise<RetrievedChunk[]> {
  if (opts.priorityTypes && opts.priorityTypes.length > 0) {
    // Priority tier: yalnız önemli kaynakları sorgula.
    const priorityHits = await retrieveCore(query, {
      ...opts,
      sourceTypes: opts.priorityTypes,
      priorityTypes: undefined, // recursion'ı kır
    });
    if (priorityTierSufficient(priorityHits, opts)) {
      return priorityHits;
    }
    // Yetersiz — fallback'e düş ve tüm kaynaklara bak.
  }
  return retrieveCore(query, opts);
}

function priorityTierSufficient(
  hits: RetrievedChunk[],
  opts: RetrieveOpts,
): boolean {
  const minResults = opts.priorityMinResults ?? 2;
  if (hits.length < minResults) return false;
  if (opts.rerank) {
    // Rerank istendi ama gerçekten uygulandı mı? geminiRerank chunk başına
    // skor set eder; herhangi biri non-null ise rerank başarılı olmuş demek.
    // (skip veya API hatası durumunda hepsi null kalır.)
    const rerankApplied = hits.some((h) => h.rerankScore !== null);
    if (rerankApplied) {
      const minScore = opts.priorityMinRerankScore ?? 5;
      return hits.some((h) => (h.rerankScore ?? 0) >= minScore);
    }
    // Rerank istendi ama uygulanmadı — count-only fallback kullan.
  }
  // Chunk sayısı eşiği üzerindeyse yeterli sayılır.
  return true;
}

async function retrieveCore(
  query: string,
  opts: RetrieveOpts = {},
): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? DEFAULTS.topK;
  const rawK = opts.rawK ?? DEFAULTS.rawK;
  const fusedK = opts.fusedK ?? DEFAULTS.fusedK;
  const rrfK = opts.rrfK ?? DEFAULTS.rrfK;

  const tenantId = opts.tenantId ?? DEFAULT_TENANT;

  // 1) Paralel arama
  const [vec, fts] = await Promise.all([
    (async () => {
      try {
        const vec = await embedQuery(query);
        return vecSearch(vec, rawK, opts.sourceTypes, tenantId);
      } catch (err) {
        console.warn("[kb/retrieve] embed query hatası:", (err as Error).message);
        return [] as VecHit[];
      }
    })(),
    Promise.resolve(ftsSearch(query, rawK, opts.sourceTypes, tenantId)),
  ]);

  // 2) RRF
  const fused = rrf(
    [
      vec.map((h) => ({ chunk_id: h.chunk_id, rank: h.rank })),
      fts.map((h) => ({ chunk_id: h.chunk_id, rank: h.rank })),
    ],
    rrfK,
  );

  const top = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, fusedK);
  if (top.length === 0) return [];

  const chunks = fetchChunksByIds(top.map(([id]) => id));

  // RRF score'larını yerleştir + raw skorları işaretle
  const vecMap = new Map(vec.map((h) => [h.chunk_id, h.distance]));
  const ftsRanks = new Map(fts.map((h) => [h.chunk_id, h.rank]));
  const result: RetrievedChunk[] = top
    .map(([id, score]) => {
      const c = chunks.get(id);
      if (!c) return null;
      c.rrfScore = score;
      c.vecScore = vecMap.get(id) ?? null;
      // BM25 negatif/küçük = daha iyi; UI için ranky inversion
      const ftsRank = ftsRanks.get(id);
      c.bm25Score = ftsRank ? 1 / ftsRank : null;
      return c;
    })
    .filter((x): x is RetrievedChunk => x !== null);

  // 3) Rerank (opsiyonel)
  let final = result;
  if (opts.rerank && result.length > topK) {
    try {
      final = await geminiRerank(query, result, topK);
    } catch (err) {
      console.warn("[kb/retrieve] rerank hatası:", (err as Error).message);
      final = result.slice(0, topK);
    }
  } else {
    final = result.slice(0, topK);
  }
  return final;
}

/**
 * Gemini ile rerank — her chunk'a 0–10 puan verdirip yeniden sıralar.
 */
async function geminiRerank(
  query: string,
  chunks: RetrievedChunk[],
  topK: number,
): Promise<RetrievedChunk[]> {
  const _ = env();
  void _;
  const system =
    "Sen bir Retrieval reranker'sın. Verilen soruya HER bir parçanın doğrudan ne kadar cevap verdiğini 0-10 arası puanla. Anlamca yakın ama soruya cevap vermeyenlere düşük puan ver. Sadece JSON array döndür.";
  const list = chunks
    .map(
      (c, i) =>
        `[${i}] (${c.source_type}) ${c.title ?? c.heading_path ?? ""}\n${c.content.slice(0, 600)}`,
    )
    .join("\n\n---\n\n");
  const userPrompt = [
    `SORU: ${query}`,
    "",
    "PARÇALAR:",
    list,
    "",
    `Yanıt formatı: [{"i":<index>,"score":<0-10>},...]  (sadece JSON, açıklama yok)`,
  ].join("\n");
  const res = await generate(system, userPrompt, {
    temperature: 0,
    maxOutputTokens: 1024,
    responseMimeType: "application/json",
    tier: "fast", // rerank basit task, Haiku yeterli
  });
  let parsed: Array<{ i: number; score: number }> = [];
  try {
    parsed = JSON.parse(res.text);
  } catch {
    return chunks.slice(0, topK);
  }
  // Her chunk'a rerankScore yerleştir
  const scoreByIdx = new Map<number, number>();
  for (const p of parsed) scoreByIdx.set(p.i, p.score);
  return [...chunks]
    .map((c, i) => {
      c.rerankScore = scoreByIdx.get(i) ?? 0;
      return c;
    })
    .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
    .slice(0, topK);
}
