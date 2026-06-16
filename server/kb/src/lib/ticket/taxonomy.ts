import { getDb } from "./local-store";

/*
 * Taxonomy — sınıflandırma LLM'ine geçecek etiket setleri.
 *
 * Kaynak: lokal sqlite snapshot'ı. View'dan distinct çekmek yavaş olduğu
 * için snapshot üzerinden döner. Snapshot dolu değilse boş döner; bu
 * durumda sync-and-embed script'i çalıştırılmalı.
 */

export type Taxonomy = {
  tipler: string[];      // Bildirim_Tipi
  oncelikler: string[];  // Oncelik
  katmanlar: string[];   // Katman
  kokNedenler: string[]; // Konunun_Kok_Nedeni
  bugGroups: string[];   // Univera.BugGroup
  tfsTipler: string[];   // TfsTip
};

function distinctValues(column: string, limit = 100): string[] {
  const sql = `
    SELECT ${column} AS v, COUNT(*) AS n
    FROM tickets
    WHERE ${column} IS NOT NULL AND TRIM(${column}) <> ''
    GROUP BY ${column}
    ORDER BY n DESC
    LIMIT ?
  `;
  const rows = getDb().prepare(sql).all(limit) as Array<{ v: string }>;
  return rows.map((r) => r.v);
}

let cached: Taxonomy | null = null;

export function loadTaxonomy(force = false): Taxonomy {
  if (cached && !force) return cached;
  cached = {
    tipler: distinctValues("bildirim_tipi"),
    oncelikler: distinctValues("oncelik"),
    katmanlar: distinctValues("katman"),
    kokNedenler: distinctValues("kok_neden", 200),
    bugGroups: distinctValues("bug_group", 200),
    tfsTipler: distinctValues("tfs_tip"),
  };
  return cached;
}

export function invalidateTaxonomy(): void {
  cached = null;
}
