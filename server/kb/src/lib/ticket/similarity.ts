import { env } from "../env";
import { embed } from "../gemini";
import { getDb, loadAllVectors, type LoadedVector } from "./local-store";

/*
 * Kosinüs benzerlik araması — runtime'da tüm embedding'ler RAM'e yüklenir
 * (faz 2 ölçeği için yeterli). Sorgu embedding'i ile kNN.
 *
 * Filtreler:
 *   - proje (PROJE = X)            : sadece o müşterinin geçmişi
 *   - tipi  (Bildirim_Tipi IN ...)  : "5. Hata" gibi
 *   - katman                        : "Backoffice" gibi
 *
 * Filtre uygulanırken önce sqlite'tan eligible id seti çekilir, sonra
 * kosinüs sadece o id'ler arasında hesaplanır.
 */

let vectorCache: { model: string; vectors: LoadedVector[] } | null = null;

function getVectors(model: string): LoadedVector[] {
  if (vectorCache && vectorCache.model === model) return vectorCache.vectors;
  vectorCache = { model, vectors: loadAllVectors(model) };
  return vectorCache.vectors;
}

/** Bellek cache'ini sıfırlar — yeni embedding'ler eklendiğinde çağrılır. */
export function invalidateVectorCache(): void {
  vectorCache = null;
}

function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

export type SimilarityFilter = {
  proje?: string | null;
  tipi?: string | null;
  katman?: string | null;
  excludeBildirimNo?: number | null;
};

export type SimilarHit = {
  bildirim_no: number;
  score: number;
};

function eligibleIds(filter: SimilarityFilter): Set<number> | null {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.proje) {
    where.push("proje = ?");
    params.push(filter.proje);
  }
  if (filter.tipi) {
    where.push("bildirim_tipi = ?");
    params.push(filter.tipi);
  }
  if (filter.katman) {
    where.push("katman = ?");
    params.push(filter.katman);
  }
  if (filter.excludeBildirimNo) {
    where.push("bildirim_no <> ?");
    params.push(filter.excludeBildirimNo);
  }
  if (where.length === 0) return null;
  const sql = `SELECT bildirim_no FROM tickets WHERE ${where.join(" AND ")}`;
  const rows = getDb().prepare(sql).all(...params) as Array<{ bildirim_no: number }>;
  return new Set(rows.map((r) => r.bildirim_no));
}

/**
 * Sorgu metni → embedding → kosinüs top-K.
 *
 * topK env.TICKET_SIMILARITY_TOPK üzerinden default'lar.
 */
export async function searchSimilarByText(
  queryText: string,
  filter: SimilarityFilter = {},
  topK?: number,
): Promise<SimilarHit[]> {
  if (!queryText || queryText.trim().length === 0) return [];
  const e = env();
  const model = e.GEMINI_EMBEDDING_MODEL;
  const k = topK ?? e.TICKET_SIMILARITY_TOPK;

  const queryVec = normalize(new Float32Array(await embed(queryText)));
  const corpus = getVectors(model);
  if (corpus.length === 0) return [];

  const eligible = eligibleIds(filter);

  const hits: SimilarHit[] = [];
  for (const item of corpus) {
    if (eligible && !eligible.has(item.bildirim_no)) continue;
    const normalized = normalize(item.vector);
    const score = dot(queryVec, normalized);
    hits.push({ bildirim_no: item.bildirim_no, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, k);
}
