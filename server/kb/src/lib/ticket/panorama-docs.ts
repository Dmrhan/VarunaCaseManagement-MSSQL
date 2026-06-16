import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/*
 * Panorama Kullanım Kılavuzu — data/panorama-docs/ entegrasyonu.
 *
 *   screens.json          440 ekran kılavuzu (Menü Adımı + Saha + Buton)
 *   category-mapping.json 16 ticket kategorisi için ekran ID listesi
 *
 * Bu modül ham JSON'ları cache'leyip UI/analist için tip-güvenli erişim verir.
 */

export type PanoramaField = {
  name: string;
  description: string;
};

export type PanoramaScreen = {
  id: string;
  breadcrumb: string[];
  modulePath: string[];
  title: string;
  menuStep: string | null;
  summary: string | null;
  fields: PanoramaField[];
  buttons: PanoramaField[];
  rawText: string;
};

const ROOT = () => path.resolve(process.cwd(), "data", "panorama-docs");

let screensCache: PanoramaScreen[] | null = null;
let mappingCache: Record<string, string[]> | null = null;
let screenIndexCache: Map<string, PanoramaScreen> | null = null;

function loadJson<T>(file: string): T | null {
  const p = path.join(ROOT(), file);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadAllScreens(): PanoramaScreen[] {
  if (screensCache) return screensCache;
  screensCache = loadJson<PanoramaScreen[]>("screens.json") ?? [];
  screenIndexCache = new Map(screensCache.map((s) => [s.id, s]));
  return screensCache;
}

export function loadCategoryMapping(): Record<string, string[]> {
  if (mappingCache) return mappingCache;
  mappingCache = loadJson<Record<string, string[]>>("category-mapping.json") ?? {};
  return mappingCache;
}

export function getScreen(id: string): PanoramaScreen | null {
  if (!screenIndexCache) loadAllScreens();
  return screenIndexCache?.get(id) ?? null;
}

export function getScreensForCategory(categoryId: string): PanoramaScreen[] {
  const mapping = loadCategoryMapping();
  const ids = mapping[categoryId] ?? [];
  return ids
    .map((id) => getScreen(id))
    .filter((s): s is PanoramaScreen => s !== null);
}

/**
 * Bir metin sorgusu için screen havuzunda **lexical** arama.
 * Skoru: başlık eşleşmesi (×3) + breadcrumb (×2) + raw text içinde (×1).
 * Yalnızca tokenize edilmiş kelimeler eşleşir; küçük harf duyarsız.
 */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9çğıöşü\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

export function searchScreens(
  query: string,
  opts: { limit?: number; restrictTo?: string[]; boostSet?: string[] } = {},
): Array<{ screen: PanoramaScreen; score: number }> {
  const screens = loadAllScreens();
  const q = tokenize(query);
  if (q.length === 0) return [];
  const limit = opts.limit ?? 6;
  const allow = opts.restrictTo ? new Set(opts.restrictTo) : null;
  // boostSet: kategori havuzundaki ID'ler — match'in puanını artırır ama
  // diğer havuzdaki güçlü match'leri elemez (cross-module hatasını önler).
  const boost = opts.boostSet ? new Set(opts.boostSet) : null;

  const out: Array<{ screen: PanoramaScreen; score: number }> = [];
  for (const s of screens) {
    if (allow && !allow.has(s.id)) continue;
    const titleLower = (s.title ?? "").toLowerCase();
    const crumbLower = s.breadcrumb.join(" ").toLowerCase();
    const rawLower = s.rawText.toLowerCase();
    let score = 0;
    for (const t of q) {
      if (titleLower.includes(t)) score += 3;
      if (crumbLower.includes(t)) score += 2;
      if (rawLower.includes(t)) score += 1;
    }
    if (score > 0) {
      if (boost && boost.has(s.id)) score += 2; // kategori ipucu bonusu
      out.push({ screen: s, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/**
 * Bir ticket için en alakalı ekranları öner — TÜM korpus üzerinde lexical
 * arama yapılır; ticket'ın kategorisindeki ekranlara puan bonusu eklenir.
 *
 * Eski tasarımda kategori havuzu HARD FILTER idi; bu, ticket kategorisi
 * "İrsaliye" iken asıl sorun "Siparişten Araç Yükleme" (Dağıtım modülü)
 * gibi cross-module case'lerde yanlış ekrana yönlendirdi. Şimdi kategori
 * yalnız ipucu — güçlü lexical match her zaman üst sırada.
 */
export function recommendScreensForTicket(args: {
  categoryId: string | null;
  text: string;
  limit?: number;
}): PanoramaScreen[] {
  const limit = args.limit ?? 4;
  const text = args.text?.trim() ?? "";
  const pool = args.categoryId
    ? (loadCategoryMapping()[args.categoryId] ?? null)
    : null;

  // Metin yoksa kategori havuzunu olduğu gibi göster (cold-start davranışı)
  if (!text && pool) {
    return pool
      .slice(0, limit)
      .map((id) => getScreen(id))
      .filter((s): s is PanoramaScreen => s !== null);
  }

  // Tüm korpusta lexical arama + kategori havuzuna bonus puan.
  const hits = searchScreens(text, {
    limit,
    ...(pool ? { boostSet: pool } : {}),
  });

  // Lexical hiç match etmediyse kategori havuzundan fallback
  if (hits.length === 0 && pool) {
    return pool
      .slice(0, limit)
      .map((id) => getScreen(id))
      .filter((s): s is PanoramaScreen => s !== null);
  }
  return hits.map((h) => h.screen);
}

/**
 * Verilen metinde (genelde sorun açıklaması) birebir ya da yakın geçen
 * panorama ekran başlıklarını bul. "Siparişten araç yükleme ekranında..."
 * gibi bir cümlede "Siparişten Araç Yükleme" ekranı eşleşir.
 *
 * Eşleşme normalize edilmiş ASCII üzerinde substring. Çok kısa başlıklar
 * (≤ 8 char) false-positive riski taşıdığı için elenir.
 */
export function detectMentionedScreens(text: string): PanoramaScreen[] {
  if (!text || text.trim().length === 0) return [];
  const screens = loadAllScreens();
  const norm = text
    .replaceAll("İ", "I").replaceAll("ı", "i")
    .replaceAll("Ğ", "G").replaceAll("ğ", "g")
    .replaceAll("Ü", "U").replaceAll("ü", "u")
    .replaceAll("Ş", "S").replaceAll("ş", "s")
    .replaceAll("Ö", "O").replaceAll("ö", "o")
    .replaceAll("Ç", "C").replaceAll("ç", "c")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ");

  const found: Array<{ screen: PanoramaScreen; titleLen: number }> = [];
  const seen = new Set<string>();
  for (const s of screens) {
    if (!s.title) continue;
    const titleNorm = s.title
      .replaceAll("İ", "I").replaceAll("ı", "i")
      .replaceAll("Ğ", "G").replaceAll("ğ", "g")
      .replaceAll("Ü", "U").replaceAll("ü", "u")
      .replaceAll("Ş", "S").replaceAll("ş", "s")
      .replaceAll("Ö", "O").replaceAll("ö", "o")
      .replaceAll("Ç", "C").replaceAll("ç", "c")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (titleNorm.length < 8) continue; // jenerik kelime riski
    if (norm.includes(titleNorm) && !seen.has(s.id)) {
      seen.add(s.id);
      found.push({ screen: s, titleLen: titleNorm.length });
    }
  }
  // Uzun başlık önce — daha spesifik
  found.sort((a, b) => b.titleLen - a.titleLen);
  return found.map((f) => f.screen);
}

/**
 * Kategori kapsama istatistikleri — kaç ekran eşlenmiş, kaç ekran kılavuz
 * olarak parse edildi. UI'da "boşluk raporu" için.
 */
export function categoryCoverage(): Array<{
  categoryId: string;
  mappedScreens: number;
}> {
  const mapping = loadCategoryMapping();
  return Object.entries(mapping).map(([categoryId, ids]) => ({
    categoryId,
    mappedScreens: ids.length,
  }));
}
