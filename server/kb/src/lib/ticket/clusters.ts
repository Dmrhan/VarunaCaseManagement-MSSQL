import { getDb } from "./local-store";

/*
 * Hata kümeleri — lokal snapshot üzerinde groupBy aggregation.
 *
 * groupBy seçenekleri:
 *   - kok_neden       (Konunun_Kok_Nedeni)
 *   - kategori_uzun   (Uzun_Kategori_Adi)
 *   - bug_group       (Univera.BugGroup)
 *   - bildirim_tipi
 */

export type GroupBy = "kok_neden" | "kategori_uzun" | "bug_group" | "bildirim_tipi";

const ALLOWED: ReadonlySet<GroupBy> = new Set([
  "kok_neden",
  "kategori_uzun",
  "bug_group",
  "bildirim_tipi",
]);

export type Cluster = {
  key: string;
  count: number;
  firstSeen: string | null;
  lastSeen: string | null;
  severityMix: { Normal: number; Yüksek: number; Kritik: number; other: number };
  sampleIds: number[];
};

export function listClusters(opts: {
  groupBy: GroupBy;
  lookbackDays?: number;
  top?: number;
}): Cluster[] {
  if (!ALLOWED.has(opts.groupBy)) {
    throw new Error(`İzin verilmeyen groupBy: ${opts.groupBy}`);
  }
  const lookback = opts.lookbackDays ?? 180;
  const top = Math.min(Math.max(opts.top ?? 20, 1), 100);
  const col = opts.groupBy;

  // İki sorgu: küme metrikleri + her küme için 5 sample id.
  const groups = getDb()
    .prepare(
      `
      SELECT
        ${col} AS key,
        COUNT(*) AS n,
        MIN(bildirim_tarihi) AS first_seen,
        MAX(bildirim_tarihi) AS last_seen,
        SUM(CASE WHEN oncelik = 'Normal' THEN 1 ELSE 0 END) AS sev_normal,
        SUM(CASE WHEN oncelik = 'Yüksek' THEN 1 ELSE 0 END) AS sev_yuksek,
        SUM(CASE WHEN oncelik = 'Kritik' THEN 1 ELSE 0 END) AS sev_kritik,
        SUM(CASE WHEN oncelik NOT IN ('Normal','Yüksek','Kritik') OR oncelik IS NULL THEN 1 ELSE 0 END) AS sev_other
      FROM tickets
      WHERE ${col} IS NOT NULL
        AND TRIM(${col}) <> ''
        AND date(bildirim_tarihi) >= date('now', '-' || ? || ' days')
      GROUP BY ${col}
      ORDER BY n DESC
      LIMIT ?
    `,
    )
    .all(lookback, top) as Array<{
    key: string;
    n: number;
    first_seen: string | null;
    last_seen: string | null;
    sev_normal: number;
    sev_yuksek: number;
    sev_kritik: number;
    sev_other: number;
  }>;

  if (groups.length === 0) return [];

  const sampleStmt = getDb().prepare(
    `SELECT bildirim_no FROM tickets
     WHERE ${col} = ?
       AND date(bildirim_tarihi) >= date('now', '-' || ? || ' days')
     ORDER BY bildirim_tarihi DESC, bildirim_no DESC
     LIMIT 5`,
  );

  return groups.map((g) => ({
    key: g.key,
    count: g.n,
    firstSeen: g.first_seen,
    lastSeen: g.last_seen,
    severityMix: {
      Normal: g.sev_normal,
      Yüksek: g.sev_yuksek,
      Kritik: g.sev_kritik,
      other: g.sev_other,
    },
    sampleIds: (sampleStmt.all(g.key, lookback) as Array<{ bildirim_no: number }>).map(
      (r) => r.bildirim_no,
    ),
  }));
}
