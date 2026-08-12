/*
 * Yeni iki-fazlı sınıflandırma taksonomisi (v2).
 *
 * Kaynak: Univera kategori ağacı HTML'i (kategori-agaci.html).
 *
 * AÇILIŞ — müşteri dili, ticket açılırken 5 alan seçilir:
 *   urun, is_sureci, islem_tipi, etkilenen_nesne, etki
 *
 * KAPANIŞ — destek dili, ticket kapatılırken 3 alan doldurulur:
 *   kok_neden (Grup + Detay), cozum_tipi, kalici_onlem (opsiyonel)
 *
 * Yüklenme: cc-taxonomy-v2.json bir kez okunur, in-memory cache.
 * Tüm değerler stringdir; LLM çıktısı strict eşleşmeyle doğrulanır.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

export type OpenField =
  | "urun"
  | "platform"
  | "is_sureci"
  | "islem_tipi"
  | "etkilenen_nesne"
  | "etki";

export const OPEN_FIELD_ORDER: OpenField[] = [
  "urun",
  "platform",
  "is_sureci",
  "islem_tipi",
  "etkilenen_nesne",
  "etki",
];

export type CloseField = "kok_neden" | "cozum_tipi" | "kalici_onlem";

type OpenSpec = {
  label: string;
  description: string;
  values: string[];
};

// v4 CASCADE — detay artık {label, cozum_tipleri}: her detay yalnız kendi
// grubunun altında listelenir (grup→detay bağımlılığı) ve yalnız kabul ettiği
// çözüm tiplerini taşır (detay→çözüm bağımlılığı).
type CloseRootCauseDetail = {
  label: string;
  cozum_tipleri: string[];
};
type CloseRootCauseGroup = {
  group: string;
  mode?: "coupled" | "tumu";
  details: CloseRootCauseDetail[];
};

type CloseSpec = {
  kok_neden: {
    label: string;
    description: string;
    groups: CloseRootCauseGroup[];
  };
  cozum_tipi: OpenSpec;
  kalici_onlem: OpenSpec;
};

type TaxonomyV2 = {
  version: string;
  source: string;
  description: string;
  open: Record<OpenField, OpenSpec>;
  close: CloseSpec;
};

let cache: TaxonomyV2 | null = null;

export function loadTaxonomyV2(): TaxonomyV2 {
  if (cache) return cache;
  const p = path.resolve(process.cwd(), "data/cc-taxonomy-v2.json");
  cache = JSON.parse(readFileSync(p, "utf8")) as TaxonomyV2;
  return cache;
}

// ─── Domain Hints (Panorama özelinde deterministik kategorize kuralları) ──

export type CategorizationHints = {
  version: string;
  source: string;
  description: string;
  principles: string[];
  platform_hints: {
    mobil_kesin: { etkilenen_nesne: string[]; islem_tipi: string[] };
    backoffice_kesin: { etkilenen_nesne: string[]; islem_tipi: string[] };
    belirsiz_ipucu_yok: { etkilenen_nesne: string[]; islem_tipi: string[] };
  };
  text_keyword_hints?: {
    keywords: Array<{
      keyword: string;
      platform?: string | null;
      urun?: string | null;
      reason: string;
    }>;
  };
};

let hintsCache: CategorizationHints | null = null;

export function loadHints(): CategorizationHints {
  if (hintsCache) return hintsCache;
  const p = path.resolve(process.cwd(), "data/cc-taxonomy-hints.json");
  hintsCache = JSON.parse(readFileSync(p, "utf8")) as CategorizationHints;
  return hintsCache;
}

/**
 * LLM prompt'una eklenmek üzere hint kurallarını metin olarak format'la.
 * Açık ve tartışmasız kuralları liste halinde sunar; LLM'in unutmaması için
 * her bölüm açıkça etiketlenir.
 */
export function formatHintsForPrompt(): string {
  const h = loadHints();
  const ph = h.platform_hints;
  const lines: string[] = [];

  lines.push("## DOMAIN İPUÇLARI — PANORAMA ÖZELİNDE KESIN KURALLAR");
  lines.push("");
  lines.push("### Temel Prensipler:");
  for (const p of h.principles) lines.push(`  • ${p}`);
  lines.push("");

  lines.push("### Platform = 'Mobil' OLMASI ZORUNLU (aşağıdaki terimlerden biri etkilenen_nesne veya islem_tipi olursa):");
  for (const v of ph.mobil_kesin.etkilenen_nesne) {
    lines.push(`  • etkilenen_nesne = "${v}"`);
  }
  for (const v of ph.mobil_kesin.islem_tipi) {
    lines.push(`  • islem_tipi = "${v}"`);
  }
  lines.push("");

  lines.push("### Platform = 'Backoffice' OLMASI ZORUNLU (aşağıdaki terimlerden biri etkilenen_nesne veya islem_tipi olursa):");
  for (const v of ph.backoffice_kesin.etkilenen_nesne) {
    lines.push(`  • etkilenen_nesne = "${v}"`);
  }
  for (const v of ph.backoffice_kesin.islem_tipi) {
    lines.push(`  • islem_tipi = "${v}"`);
  }
  lines.push("");

  lines.push("### Platform BELİRSİZ (bu terimler tek başına platform belirtmez, açıklamadaki bağlama bak):");
  for (const v of ph.belirsiz_ipucu_yok.etkilenen_nesne) {
    lines.push(`  • etkilenen_nesne = "${v}"`);
  }
  for (const v of ph.belirsiz_ipucu_yok.islem_tipi) {
    lines.push(`  • islem_tipi = "${v}"`);
  }

  if (h.text_keyword_hints?.keywords?.length) {
    lines.push("");
    lines.push("### AÇIKLAMA METNİNDE KEYWORD → PLATFORM/ÜRÜN ZORLAMA:");
    for (const k of h.text_keyword_hints.keywords) {
      const parts: string[] = [];
      if (k.platform) parts.push(`platform = "${k.platform}"`);
      if (k.urun) parts.push(`urun = "${k.urun}"`);
      lines.push(
        `  • "${k.keyword}" geçerse → ${parts.join(", ")} (${k.reason})`,
      );
    }
  }

  return lines.join("\n");
}

// ─── Gold (insan-doğrulanmış) few-shot örnekleri ─────────────────────────
// data/cc-gold-examples.json: uzman tarafından doğru etiketlenmiş vakalar.
// LLM prompt'una "böyle etiketle" örneği olarak eklenir (her kök neden
// grubundan en çok 2 temsili örnek — token kontrolü).
let goldCache: Array<Record<string, string>> | null = null;
export function loadGoldExamples(): Array<Record<string, string>> {
  if (goldCache) return goldCache;
  try {
    const p = path.resolve(process.cwd(), "data/cc-gold-examples.json");
    goldCache = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    goldCache = [];
  }
  return goldCache;
}

export function formatGoldForPrompt(mode: "open" | "close"): string {
  const gold = loadGoldExamples();
  if (!gold.length) return "";

  if (mode === "open") {
    // Açılış taksonomisi değişmedi → gold örnekleri geçerli, doğrudan kullanılır.
    const byGroup: Record<string, number> = {};
    const picked: Array<Record<string, string>> = [];
    for (const g of gold) {
      const k = g.kokNedenGrubu || "?";
      byGroup[k] = (byGroup[k] || 0) + 1;
      if (byGroup[k] <= 2) picked.push(g);
    }
    return picked
      .map(
        (g) =>
          `- "${(g.sorun || "").slice(0, 110)}" => platform=${g.platform}; is_sureci=${g.isSureci}; islem_tipi=${g.islemTipi}; etkilenen_nesne=${g.etkilenenNesne}; etki=${g.etki}`,
      )
      .join("\n");
  }

  // KAPANIŞ (close) — v4 GEÇERLİLİK FİLTRELİ few-shot. Mekanizma AÇIK; ancak her
  // gold örneği GÜNCEL v4 taksonomisine karşı doğrulanır (grup + gruba-bağlı detay
  // + detaya-bağlı çözüm + kalıcı önlem). Eski taksonomiyle etiketli örnekler
  // geçersiz sayılıp elenir → v4 gold (build-gold-from-reviews ile doğrulamalardan)
  // birikene kadar doğal olarak boş kalır, biriktikçe otomatik devreye girer.
  const byGroup: Record<string, number> = {};
  const picked: Array<Record<string, string>> = [];
  for (const g of gold) {
    const grup = g.kokNedenGrubu;
    const detay = g.kokNedenDetayi;
    if (!grup || !isValidKokNedenGrubu(grup)) continue;
    if (!detay || !isValidKokNedenDetay(detay, grup)) continue;
    if (!g.cozumTipi || !isValidCozumTipi(g.cozumTipi, grup, detay)) continue;
    if (g.kaliciOnlem && !isValidKaliciOnlem(g.kaliciOnlem)) continue;
    byGroup[grup] = (byGroup[grup] || 0) + 1;
    if (byGroup[grup] <= 2) picked.push(g);
  }
  return picked
    .map(
      (g) =>
        `- Sorun: "${(g.sorun || "").slice(0, 90)}" Çözüm: "${(g.cozum || "").slice(0, 90)}" => kok_neden_grubu=${g.kokNedenGrubu}; kok_neden_detayi=${g.kokNedenDetayi}; cozum_tipi=${g.cozumTipi}; kalici_onlem=${g.kaliciOnlem}`,
    )
    .join("\n");
}

/**
 * Açıklama metnindeki keyword'lere göre platform/ürün ipuçlarını çıkar.
 * Türkçe karakter → ASCII normalize, kelime sınırı (\b) match.
 * Birden çok keyword eşleşirse hepsinin önerisi döner.
 */
export function detectTextKeywordHints(
  description: string,
): Array<{ keyword: string; platform: string | null; urun: string | null; reason: string }> {
  if (!description) return [];
  const h = loadHints();
  const keywords = h.text_keyword_hints?.keywords ?? [];
  if (keywords.length === 0) return [];

  const norm = description
    .replaceAll("İ", "I").replaceAll("ı", "i")
    .replaceAll("Ğ", "G").replaceAll("ğ", "g")
    .replaceAll("Ü", "U").replaceAll("ü", "u")
    .replaceAll("Ş", "S").replaceAll("ş", "s")
    .replaceAll("Ö", "O").replaceAll("ö", "o")
    .replaceAll("Ç", "C").replaceAll("ç", "c")
    .toLowerCase();

  const matched: Array<{ keyword: string; platform: string | null; urun: string | null; reason: string }> = [];
  for (const k of keywords) {
    const kw = k.keyword
      .replaceAll("İ", "I").replaceAll("ı", "i")
      .replaceAll("Ğ", "G").replaceAll("ğ", "g")
      .replaceAll("Ü", "U").replaceAll("ü", "u")
      .replaceAll("Ş", "S").replaceAll("ş", "s")
      .replaceAll("Ö", "O").replaceAll("ö", "o")
      .replaceAll("Ç", "C").replaceAll("ç", "c")
      .toLowerCase();
    // Türkçe çekim eklerini yakalamak için PREFIX MATCH:
    // başında kelime sınırı, sonu serbest — "panorama" → "panoramada", "panoramamda" da eşleşir.
    // Bu pragmatik bir trade-off; tek-yön sınır false positive riskini minimumda tutar
    // (keyword'lerin kendisi benzersiz: panorama, quest, calldesk, stokbar, enroute).
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    if (re.test(norm)) {
      matched.push({
        keyword: k.keyword,
        platform: k.platform ?? null,
        urun: k.urun ?? null,
        reason: k.reason,
      });
    }
  }
  return matched;
}

/**
 * detectTextKeywordHints sonucunu LLM çıktısının platform/urun alanlarına uygula.
 * Birden çok keyword çakışırsa ilk eşleşmenin değeri kullanılır (öncelikli).
 */
export function applyKeywordHints(
  description: string,
  currentPlatform: string | null,
  currentUrun: string | null,
): {
  platform: string | null;
  urun: string | null;
  appliedReasons: string[];
} {
  const hits = detectTextKeywordHints(description);
  if (hits.length === 0) {
    return { platform: currentPlatform, urun: currentUrun, appliedReasons: [] };
  }
  let platform = currentPlatform;
  let urun = currentUrun;
  const reasons: string[] = [];
  for (const h of hits) {
    if (h.platform && platform !== h.platform) {
      platform = h.platform;
      reasons.push(`'${h.keyword}' → platform=${h.platform} (${h.reason})`);
    }
    if (h.urun && urun !== h.urun) {
      urun = h.urun;
      reasons.push(`'${h.keyword}' → urun=${h.urun} (${h.reason})`);
    }
  }
  return { platform, urun, appliedReasons: reasons };
}

/**
 * Bir etkilenen_nesne/islem_tipi seçimine göre platform'u kesin olarak ZORLA.
 * Hint'lerde kesin kural varsa kullanılır; yoksa input platform aynen döner.
 * Deterministik post-processing — LLM çıktısı hint'e uymuyorsa override eder.
 */
export function enforcePlatformFromHints(
  current: string | null,
  etkilenenNesne: string | null,
  islemTipi: string | null,
): { platform: string | null; overridden: boolean; reason: string | null } {
  const h = loadHints();
  const ph = h.platform_hints;
  const checkSet = (
    arrEN: string[],
    arrIT: string[],
  ): boolean => {
    if (etkilenenNesne && arrEN.includes(etkilenenNesne)) return true;
    if (islemTipi && arrIT.includes(islemTipi)) return true;
    return false;
  };
  if (checkSet(ph.mobil_kesin.etkilenen_nesne, ph.mobil_kesin.islem_tipi)) {
    if (current !== "Mobil") {
      return {
        platform: "Mobil",
        overridden: true,
        reason: `Hint kuralı: "${etkilenenNesne ?? islemTipi}" mobil platforma kesin işaret eder.`,
      };
    }
    return { platform: "Mobil", overridden: false, reason: null };
  }
  if (checkSet(ph.backoffice_kesin.etkilenen_nesne, ph.backoffice_kesin.islem_tipi)) {
    if (current !== "Backoffice") {
      return {
        platform: "Backoffice",
        overridden: true,
        reason: `Hint kuralı: "${etkilenenNesne ?? islemTipi}" backoffice platforma kesin işaret eder.`,
      };
    }
    return { platform: "Backoffice", overridden: false, reason: null };
  }
  return { platform: current, overridden: false, reason: null };
}

// ─── Açılış alanları ─────────────────────────────────────────────────────

export function getOpenField(field: OpenField): OpenSpec {
  return loadTaxonomyV2().open[field];
}

export function isValidOpenValue(field: OpenField, value: string | null): boolean {
  if (value == null) return true;
  return getOpenField(field).values.includes(value);
}

// ─── Kapanış alanları ───────────────────────────────────────────────────

// WR-KB-Taxonomy-Sync — Admin panelindeki "Akıllı Ticket Tanımları" ekranı
// kapanış etiketlerini (kök neden grubu/detayı, çözüm tipi, kalıcı önlem)
// TaxonomyDef (DB) tablosuna yazar; DB tek doğruluk kaynağıdır. Çağıran
// (smartTicket.js) aktif DB satırlarından bu şekli kurup HTTP body ile
// suggestClose'a taşır. Verilmezse (undefined) mevcut davranış aynen
// çalışır: loadTaxonomyV2() → data/cc-taxonomy-v2.json (geri uyum).
export type CloseTaxonomyOverride = {
  groups: CloseRootCauseGroup[];
  cozum_tipi: OpenSpec;
  kalici_onlem: OpenSpec;
};

export function getKokNedenGroups(override?: CloseTaxonomyOverride): CloseRootCauseGroup[] {
  return override?.groups ?? loadTaxonomyV2().close.kok_neden.groups;
}

export function getCozumTipi(override?: CloseTaxonomyOverride): OpenSpec {
  return override?.cozum_tipi ?? loadTaxonomyV2().close.cozum_tipi;
}

export function getKaliciOnlem(override?: CloseTaxonomyOverride): OpenSpec {
  return override?.kalici_onlem ?? loadTaxonomyV2().close.kalici_onlem;
}

// Decouple — kök neden grubu ve detayı BAĞIMSIZ doğrulanır. Detay artık seçilen
// gruba bağlı değil; tüm grupların detay birleşiminden herhangi biri geçerlidir.
export function isValidKokNedenGrubu(group: string | null, override?: CloseTaxonomyOverride): boolean {
  if (group == null) return true;
  return getKokNedenGroups(override).some((g) => g.group === group);
}

// v4 CASCADE — grup verilirse detay YALNIZ o grubun altında aranır (grup-kapsamlı).
// Grup verilmezse eski davranış (tüm gruplarda ara) — geri uyum.
export function isValidKokNedenDetay(
  detail: string | null,
  group?: string | null,
  override?: CloseTaxonomyOverride,
): boolean {
  if (detail == null) return true;
  const groups = getKokNedenGroups(override);
  const scope = group ? groups.filter((g) => g.group === group) : groups;
  return scope.some((g) => g.details.some((d) => d.label === detail));
}

// v4 CASCADE — (grup, detay) verilirse o detayın kabul ettiği çözüm tipleri döner;
// yoksa tüm çözüm tipi listesi (geri uyum).
export function getAllowedCozumTipleri(
  group: string | null,
  detail: string | null,
  override?: CloseTaxonomyOverride,
): string[] {
  if (!group || !detail) return getCozumTipi(override).values;
  const g = getKokNedenGroups(override).find((x) => x.group === group);
  const d = g?.details.find((x) => x.label === detail);
  return d?.cozum_tipleri ?? [];
}

// v4 CASCADE — (grup, detay) verilirse çözüm o detayın izinli setinde olmalı;
// yoksa düz liste doğrulaması (geri uyum).
export function isValidCozumTipi(
  value: string | null,
  group?: string | null,
  detail?: string | null,
  override?: CloseTaxonomyOverride,
): boolean {
  if (value == null) return true;
  if (group && detail) return getAllowedCozumTipleri(group, detail, override).includes(value);
  return getCozumTipi(override).values.includes(value);
}

export function isValidKaliciOnlem(value: string | null, override?: CloseTaxonomyOverride): boolean {
  if (value == null) return true;
  return getKaliciOnlem(override).values.includes(value);
}

// ─── LLM Prompt formatters ───────────────────────────────────────────────

export function formatOpenForPrompt(): string {
  const t = loadTaxonomyV2();
  return OPEN_FIELD_ORDER.map((f) => {
    const spec = t.open[f];
    return [
      `## ${spec.label} (${f})`,
      spec.description,
      ...spec.values.map((v) => `  • ${v}`),
    ].join("\n");
  }).join("\n\n");
}

// ─── Düz görüntüleme için (UI dropdown vb.) ──────────────────────────────

export type OpenFieldsResult = {
  urun: string | null;
  platform: string | null;
  is_sureci: string | null;
  islem_tipi: string | null;
  etkilenen_nesne: string | null;
  etki: string | null;
};

export type CloseFieldsResult = {
  kok_neden_grubu: string | null;
  kok_neden_detayi: string | null;
  cozum_tipi: string | null;
  kalici_onlem: string | null;
};
