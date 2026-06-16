import {
  existsSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { getDb } from "./local-store";
import { loadCategoryMapping } from "./panorama-docs";

/*
 * Yeniden kategorizasyon — MANUEL (Claude tarafından bizzat okunup atanmış).
 *
 * Veri kaynağı: data/topics-v2/
 *   taxonomy.json     — 16 anlamlı iş kategorisi
 *   assignments.json  — her bildirim_no için { category_id, confidence }
 *   meta.json         — üretim metadata
 *
 * Bu modül artık LLM ÇAĞRISI YAPMAZ. Sayfaların sadece file-system'den
 * okuyup gruplu sayım üretmesi için view helper'larını sağlar.
 */

export type Category = {
  id: string;
  title: string;
  description: string;
};

export type Assignment = {
  bildirim_no: number;
  category_id: string;
  confidence?: number;
};

export type RecatMeta = {
  generatedAt: string;
  model: string;
  ticketCount: number;
  categoryCount: number;
  taxonomyLatencyMs: number;
  assignLatencyMs: number;
  totalLatencyMs: number;
  lookbackDays: number;
};

export type RecatBundle = {
  meta: RecatMeta;
  categories: Category[];
  assignments: Assignment[];
};

const ROOT = () => path.resolve(process.cwd(), "data", "topics-v2");

export function loadBundle(): RecatBundle | null {
  const r = ROOT();
  if (!existsSync(path.join(r, "meta.json"))) return null;
  try {
    const meta = JSON.parse(readFileSync(path.join(r, "meta.json"), "utf8")) as RecatMeta;
    const categories = JSON.parse(
      readFileSync(path.join(r, "taxonomy.json"), "utf8"),
    ) as Category[];
    const assignments = JSON.parse(
      readFileSync(path.join(r, "assignments.json"), "utf8"),
    ) as Assignment[];
    return { meta, categories, assignments };
  } catch {
    return null;
  }
}

// === UI view helpers ===
export type TopicView = {
  category: Category;
  count: number;
  severityMix: { Normal: number; Yüksek: number; Kritik: number; other: number };
  firstSeen: string | null;
  lastSeen: string | null;
  sampleBildirimNos: number[];
  /** Bu kategoriye eşlenmiş Panorama kılavuz ekran sayısı. */
  mappedGuides: number;
};

export function listTopicsFromBundle(b: RecatBundle): TopicView[] {
  // Her ticket için meta (tarih, severity) snapshot'tan
  const ids = b.assignments.map((a) => a.bildirim_no);
  if (ids.length === 0) {
    const guideMappingEmpty = loadCategoryMapping();
    return b.categories.map((c) => ({
      category: c,
      count: 0,
      severityMix: { Normal: 0, Yüksek: 0, Kritik: 0, other: 0 },
      firstSeen: null,
      lastSeen: null,
      sampleBildirimNos: [],
      mappedGuides: guideMappingEmpty[c.id]?.length ?? 0,
    }));
  }
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT bildirim_no, bildirim_tarihi, oncelik
       FROM tickets WHERE bildirim_no IN (${placeholders})`,
    )
    .all(...ids) as Array<{
    bildirim_no: number;
    bildirim_tarihi: string | null;
    oncelik: string | null;
  }>;
  const metaById = new Map(rows.map((r) => [r.bildirim_no, r]));

  const buckets = new Map<string, number[]>();
  for (const a of b.assignments) {
    const arr = buckets.get(a.category_id) ?? [];
    arr.push(a.bildirim_no);
    buckets.set(a.category_id, arr);
  }

  const guideMapping = loadCategoryMapping();
  const out: TopicView[] = b.categories.map((c) => {
    const members = buckets.get(c.id) ?? [];
    const mappedGuides = guideMapping[c.id]?.length ?? 0;
    const severityMix = { Normal: 0, Yüksek: 0, Kritik: 0, other: 0 };
    const dates: string[] = [];
    // En yeni 8 örneği bul
    const memberMeta = members
      .map((id) => metaById.get(id))
      .filter((m): m is { bildirim_no: number; bildirim_tarihi: string | null; oncelik: string | null } => !!m)
      .sort((a, x) => {
        if (!a.bildirim_tarihi) return 1;
        if (!x.bildirim_tarihi) return -1;
        return x.bildirim_tarihi.localeCompare(a.bildirim_tarihi);
      });
    for (const m of memberMeta) {
      if (m.oncelik === "Normal") severityMix.Normal++;
      else if (m.oncelik === "Yüksek") severityMix.Yüksek++;
      else if (m.oncelik === "Kritik") severityMix.Kritik++;
      else severityMix.other++;
      if (m.bildirim_tarihi) dates.push(m.bildirim_tarihi);
    }
    dates.sort();
    return {
      category: c,
      count: members.length,
      severityMix,
      firstSeen: dates[0] ?? null,
      lastSeen: dates[dates.length - 1] ?? null,
      sampleBildirimNos: memberMeta.slice(0, 8).map((m) => m.bildirim_no),
      mappedGuides,
    };
  });

  // En kalabalıktan az'a sıralı
  out.sort((a, b) => b.count - a.count);
  return out;
}

export function listMembersOfCategory(
  bundle: RecatBundle,
  categoryId: string,
  limit = 100,
): Array<{
  bildirim_no: number;
  bildirim_tarihi: string | null;
  oncelik: string | null;
  proje: string | null;
  kategori_uzun: string | null;
  aciklama: string | null;
  confidence: number;
}> {
  const ids = bundle.assignments
    .filter((a) => a.category_id === categoryId)
    .map((a) => a.bildirim_no);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT bildirim_no, bildirim_tarihi, oncelik, proje, kategori_uzun, aciklama
       FROM tickets WHERE bildirim_no IN (${placeholders})
       ORDER BY bildirim_tarihi DESC, bildirim_no DESC
       LIMIT ?`,
    )
    .all(...ids, limit) as Array<{
    bildirim_no: number;
    bildirim_tarihi: string | null;
    oncelik: string | null;
    proje: string | null;
    kategori_uzun: string | null;
    aciklama: string | null;
  }>;
  const confById = new Map(
    bundle.assignments.map((a) => [a.bildirim_no, a.confidence ?? 0.7]),
  );
  return rows.map((r) => ({
    ...r,
    confidence: confById.get(r.bildirim_no) ?? 0.7,
  }));
}
