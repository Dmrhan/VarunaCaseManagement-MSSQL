import Database, { type Database as DB } from "better-sqlite3";
import path from "node:path";
import { existsSync } from "node:fs";

/*
 * Ticket_Kayıtları_Ozet snapshot okuma katmanı.
 *
 * Veri scripts/sync-ozet.mjs ile çekilir, agregasyonlar burada üretilir.
 * Dashboard sayfası yalnızca buradaki fonksiyonları kullanır.
 */

let dbInstance: DB | null = null;

function dbPath(): string {
  return path.resolve(process.cwd(), "data/ozet.sqlite");
}

export function getOzetDb(): DB {
  if (dbInstance) return dbInstance;
  const p = dbPath();
  if (!existsSync(p)) {
    throw new Error(
      "Özet snapshot yok. Önce çalıştır: node scripts/sync-ozet.mjs",
    );
  }
  const db = new Database(p, { readonly: true });
  db.pragma("journal_mode = WAL");
  dbInstance = db;
  return db;
}

export type OzetFilters = {
  yil?: number | null;
  ay?: number | null;
  oncelik?: string | null;
  support?: string | null;
  kokNeden?: string | null;
};

function whereClause(f: OzetFilters): { sql: string; params: Record<string, unknown> } {
  const parts: string[] = [];
  const params: Record<string, unknown> = {};
  if (f.yil != null) { parts.push("yil = @yil"); params.yil = f.yil; }
  if (f.ay != null) { parts.push("ay = @ay"); params.ay = f.ay; }
  if (f.oncelik) { parts.push("oncelik = @oncelik"); params.oncelik = f.oncelik; }
  if (f.support) { parts.push("support = @support"); params.support = f.support; }
  if (f.kokNeden) { parts.push("kok_neden = @kokNeden"); params.kokNeden = f.kokNeden; }
  return {
    sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "",
    params,
  };
}

export type Kpi = {
  total: number;
  avgSure: number;
  medianSure: number;
  p90Sure: number;
  acilCount: number;
  tfsCount: number;
  closedSameDay: number;
  over7DayCount: number;
};

export function kpis(f: OzetFilters): Kpi {
  const db = getOzetDb();
  const { sql, params } = whereClause(f);
  const base = db.prepare(`
    SELECT
      COUNT(*) AS total,
      AVG(sure) AS avgSure,
      SUM(CASE WHEN acil = 'Evet' THEN 1 ELSE 0 END) AS acilCount,
      SUM(CASE WHEN tfs_no IS NOT NULL AND tfs_no > 0 THEN 1 ELSE 0 END) AS tfsCount,
      SUM(CASE WHEN sure < 1 THEN 1 ELSE 0 END) AS closedSameDay,
      SUM(CASE WHEN sure > 7 THEN 1 ELSE 0 END) AS over7DayCount
    FROM ozet ${sql}
  `).get(params) as {
    total: number;
    avgSure: number | null;
    acilCount: number;
    tfsCount: number;
    closedSameDay: number;
    over7DayCount: number;
  };

  // medyan + p90 için manuel
  const sures = db.prepare(`SELECT sure FROM ozet ${sql} ORDER BY sure ASC`)
    .all(params) as Array<{ sure: number }>;
  const arr = sures.map((x) => x.sure ?? 0);
  const medianSure = arr.length === 0 ? 0 : (arr[Math.floor(arr.length / 2)] ?? 0);
  const p90Sure = arr.length === 0 ? 0 : (arr[Math.floor(arr.length * 0.9)] ?? 0);

  return {
    total: base.total,
    avgSure: base.avgSure ?? 0,
    medianSure,
    p90Sure,
    acilCount: base.acilCount,
    tfsCount: base.tfsCount,
    closedSameDay: base.closedSameDay,
    over7DayCount: base.over7DayCount,
  };
}

export type KokNedenRow = {
  kokNeden: string;
  count: number;
  avgSure: number;
  medianSure: number;
  p90Sure: number;
  acilCount: number;
  tfsCount: number;
  topKategori: string;
  topKategoriCount: number;
};

export function kokNedenStats(f: OzetFilters): KokNedenRow[] {
  const db = getOzetDb();
  const { sql: where, params } = whereClause({ ...f, kokNeden: null });
  const rows = db.prepare(`
    SELECT
      kok_neden AS kokNeden,
      COUNT(*) AS count,
      AVG(sure) AS avgSure,
      SUM(CASE WHEN acil = 'Evet' THEN 1 ELSE 0 END) AS acilCount,
      SUM(CASE WHEN tfs_no IS NOT NULL AND tfs_no > 0 THEN 1 ELSE 0 END) AS tfsCount
    FROM ozet
    ${where}
    GROUP BY kok_neden
    ORDER BY count DESC
  `).all(params) as Array<{
    kokNeden: string | null;
    count: number;
    avgSure: number | null;
    acilCount: number;
    tfsCount: number;
  }>;

  // her kök neden için medyan + p90 + top kategori
  const result: KokNedenRow[] = [];
  for (const r of rows) {
    const kn = r.kokNeden ?? "(boş)";
    const { sql: whereInner, params: paramsInner } = whereClause({
      ...f,
      kokNeden: r.kokNeden,
    });
    const sures = db.prepare(`SELECT sure FROM ozet ${whereInner} ORDER BY sure ASC`)
      .all(paramsInner) as Array<{ sure: number }>;
    const arr = sures.map((x) => x.sure ?? 0);
    const medianSure = arr.length === 0 ? 0 : (arr[Math.floor(arr.length / 2)] ?? 0);
    const p90Sure = arr.length === 0 ? 0 : (arr[Math.floor(arr.length * 0.9)] ?? 0);

    const topKat = db.prepare(`
      SELECT kategori, COUNT(*) AS c FROM ozet ${whereInner}
      GROUP BY kategori ORDER BY c DESC LIMIT 1
    `).get(paramsInner) as { kategori: string | null; c: number } | undefined;

    result.push({
      kokNeden: kn,
      count: r.count,
      avgSure: r.avgSure ?? 0,
      medianSure,
      p90Sure,
      acilCount: r.acilCount,
      tfsCount: r.tfsCount,
      topKategori: topKat?.kategori ?? "-",
      topKategoriCount: topKat?.c ?? 0,
    });
  }
  return result;
}

export type CrossCell = {
  kokNeden: string;
  kategori: string;
  count: number;
  avgSure: number;
};

export function crossMatrix(
  f: OzetFilters,
  opts: { topKokNedenLimit?: number; topKategoriLimit?: number } = {},
): {
  kokNedenler: string[];
  kategoriler: string[];
  cells: CrossCell[];
} {
  const db = getOzetDb();
  const { sql: where, params } = whereClause({ ...f, kokNeden: null });
  const topKN = (db.prepare(`
    SELECT kok_neden AS k, COUNT(*) AS c FROM ozet ${where}
    GROUP BY kok_neden ORDER BY c DESC LIMIT @lim
  `).all({ ...params, lim: opts.topKokNedenLimit ?? 10 }) as Array<{ k: string | null; c: number }>)
    .map((x) => x.k ?? "(boş)");
  const topKat = (db.prepare(`
    SELECT kategori AS k, COUNT(*) AS c FROM ozet ${where}
    GROUP BY kategori ORDER BY c DESC LIMIT @lim
  `).all({ ...params, lim: opts.topKategoriLimit ?? 15 }) as Array<{ k: string | null; c: number }>)
    .map((x) => x.k ?? "(boş)");

  const cells: CrossCell[] = [];
  for (const kn of topKN) {
    for (const kat of topKat) {
      const { sql: w2, params: p2 } = whereClause({ ...f, kokNeden: kn });
      const r = db.prepare(`
        SELECT COUNT(*) AS c, AVG(sure) AS s FROM ozet ${w2} AND kategori = @kat
      `).get({ ...p2, kat }) as { c: number; s: number | null };
      if (r.c > 0) {
        cells.push({ kokNeden: kn, kategori: kat, count: r.c, avgSure: r.s ?? 0 });
      }
    }
  }
  return { kokNedenler: topKN, kategoriler: topKat, cells };
}

export type SlaBucket = {
  label: string;
  range: [number, number];
  count: number;
};

export function slaDistribution(f: OzetFilters): SlaBucket[] {
  const db = getOzetDb();
  const { sql: where, params } = whereClause(f);
  // Süre kolonu gün cinsinden; bant aralıkları saat tabanında düşünülüp güne çevriliyor.
  const buckets: Array<{ label: string; range: [number, number] }> = [
    { label: "< 1 saat", range: [0, 1 / 24] },
    { label: "1 – 4 saat", range: [1 / 24, 4 / 24] },
    { label: "4 – 24 saat", range: [4 / 24, 24 / 24] },
    { label: "1 – 3 gün (24–72 sa)", range: [1, 3] },
    { label: "3 – 7 gün (72–168 sa)", range: [3, 7] },
    { label: "7+ gün (>168 sa)", range: [7, Infinity] },
  ];
  return buckets.map((b) => {
    const upper = b.range[1] === Infinity ? 1e9 : b.range[1];
    const row = db.prepare(`
      SELECT COUNT(*) AS c FROM ozet ${where}
      ${where ? "AND" : "WHERE"} sure >= @lo AND sure < @hi
    `).get({ ...params, lo: b.range[0], hi: upper }) as { c: number };
    return { label: b.label, range: b.range, count: row.c };
  });
}

export type MonthlyRow = {
  yil: number;
  ay: number;
  count: number;
  avgSure: number;
};

export function monthlyTrend(f: OzetFilters): MonthlyRow[] {
  const db = getOzetDb();
  const { sql: where, params } = whereClause(f);
  const rows = db.prepare(`
    SELECT yil, ay, COUNT(*) AS count, AVG(sure) AS avgSure
    FROM ozet ${where}
    GROUP BY yil, ay
    ORDER BY yil, ay
  `).all(params) as Array<{ yil: number; ay: number; count: number; avgSure: number | null }>;
  return rows.map((r) => ({ ...r, avgSure: r.avgSure ?? 0 }));
}

export type FilterOptions = {
  yillar: number[];
  aylar: number[];
  oncelikler: string[];
  supports: string[];
  kokNedenler: string[];
};

export function getFilterOptions(): FilterOptions {
  const db = getOzetDb();
  const yillar = (db.prepare(`SELECT DISTINCT yil FROM ozet WHERE yil IS NOT NULL ORDER BY yil DESC`)
    .all() as Array<{ yil: number }>).map((x) => x.yil);
  const aylar = (db.prepare(`SELECT DISTINCT ay FROM ozet WHERE ay IS NOT NULL ORDER BY ay`)
    .all() as Array<{ ay: number }>).map((x) => x.ay);
  const oncelikler = (db.prepare(`SELECT DISTINCT oncelik FROM ozet WHERE oncelik IS NOT NULL AND oncelik != '' ORDER BY oncelik`)
    .all() as Array<{ oncelik: string }>).map((x) => x.oncelik);
  const supports = (db.prepare(`SELECT DISTINCT support FROM ozet WHERE support IS NOT NULL AND support != '' ORDER BY support`)
    .all() as Array<{ support: string }>).map((x) => x.support);
  const kokNedenler = (db.prepare(`
    SELECT kok_neden AS k, COUNT(*) AS c FROM ozet
    WHERE kok_neden IS NOT NULL AND kok_neden != ''
    GROUP BY kok_neden ORDER BY c DESC
  `).all() as Array<{ k: string; c: number }>).map((x) => x.k);
  return { yillar, aylar, oncelikler, supports, kokNedenler };
}

export type Meta = {
  syncedAt: string | null;
  rowCount: number;
};

export function getMeta(): Meta {
  const db = getOzetDb();
  const rows = db.prepare(`SELECT key, value FROM meta`).all() as Array<{ key: string; value: string }>;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    syncedAt: m.synced_at ?? null,
    rowCount: m.row_count ? Number(m.row_count) : 0,
  };
}
