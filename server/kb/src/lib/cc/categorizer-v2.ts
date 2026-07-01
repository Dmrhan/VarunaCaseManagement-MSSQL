/*
 * Açılış sınıflandırıcısı v2 — kategori-agaci.html taksonomisine göre.
 *
 * Sorun metnini alıp 5 alanı doldurur:
 *   urun, is_sureci, islem_tipi, etkilenen_nesne, etki
 *
 * Strict mode:
 *   - LLM SADECE taksonomideki değerlerden seçer
 *   - Geçersiz seçim gelirse o alan null bırakılır (override etmek yerine
 *     boş bırakmayı tercih ediyoruz; ajan elle düzeltir)
 *   - Düşük confidence → ilgili alanlar null
 *
 * Kapanış alanları (kok_neden, cozum_tipi, kalici_onlem) ticket çözümlendiğinde
 * ayrı bir akışta doldurulur — bu modül onları üretmez.
 */

import { z } from "zod";
import { generate, type GenerateResult } from "../gemini";
import {
  formatOpenForPrompt,
  getKokNedenGroups,
  formatHintsForPrompt,
  formatGoldForPrompt,
  enforcePlatformFromHints,
  applyKeywordHints,
  getKaliciOnlem,
  isValidOpenValue,
  isValidKokNedenGrubu,
  isValidKokNedenDetay,
  isValidCozumTipi,
  isValidKaliciOnlem,
  type OpenFieldsResult,
  type CloseFieldsResult,
} from "./taxonomy-v2";

const SYSTEM = `
Sen bir çağrı merkezi açılış sınıflandırıcısısın. Görevin: gelen sorun metnini
verilen 5 alanlı taksonomi içinden seçimlerle etiketlemektir.

Kurallar (mutlak):
- ASLA yeni değer uydurma; SADECE listede geçen string'leri kullan.
- Bir alan için uygun değer yoksa null bırak (boş string değil).
- 5 alan ZORUNLU sıralamada: urun, is_sureci, islem_tipi, etkilenen_nesne, etki.
- Confidence 0-1 — emin değilsen düşür ve ilgili alanı null bırak.
- 1 cümlelik "reason" alanı (Türkçe, neden bu seçim).
- Yanıtı KESİNLİKLE JSON ver, başka metin EKLEME.
`.trim();

const Output = z.object({
  urun: z.string().nullable(),
  platform: z.string().nullable(),
  is_sureci: z.string().nullable(),
  islem_tipi: z.string().nullable(),
  etkilenen_nesne: z.string().nullable(),
  etki: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type CategorizationV2Result = OpenFieldsResult & {
  confidence: number;
  reason: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type CategorizeV2Input = {
  description: string;
  project?: string | null;
  customerName?: string | null;
};

function extractJson(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s.trim();
}

export async function categorizeV2(
  input: CategorizeV2Input,
): Promise<CategorizationV2Result> {
  // Tek prompt'u ORİJİNALLE BİREBİR kur, sonra cache sınırından slice ile böl.
  // cachePrefix = "SORUN BİLGİSİ:" öncesi (taksonomi + hints + few-shot — her
  // çağrıda DEĞİŞMEZ) → ayrı cache_control'lü bloğa konur (system + önek
  // cache'lenir). userPrompt = "SORUN BİLGİSİ:"'den itibaren (değişken).
  // slice garanti eder: cachePrefix + userPrompt === fullPrompt (byte-identical;
  // yalnız caching eklenir). Tekrarlı etiketlemede ~%90 input tasarrufu.
  const fullPrompt = [
    "TAKSONOMİ — 6 AÇILIŞ ALANI:",
    formatOpenForPrompt(),
    "",
    formatHintsForPrompt(),
    "",
    "GERÇEK ETİKETLENMİŞ ÖRNEKLER (insan uzman doğruladı — aynı mantıkla etiketle):",
    formatGoldForPrompt("open"),
    "",
    "SORUN BİLGİSİ:",
    input.project ? `Proje: ${input.project}` : null,
    input.customerName ? `Müşteri: ${input.customerName}` : null,
    `Açıklama: ${input.description.slice(0, 4000)}`,
    "",
    `Çıktı JSON şeması (sadece JSON):`,
    `{`,
    `  "urun": string | null,            // taksonomideki Ürün değerlerinden biri`,
    `  "platform": string | null,        // Platform değerlerinden biri (Backoffice/Mobil)`,
    `  "is_sureci": string | null,       // İş Süreci değerlerinden biri`,
    `  "islem_tipi": string | null,      // İşlem Tipi değerlerinden biri`,
    `  "etkilenen_nesne": string | null, // Etkilenen Nesne değerlerinden biri (ekran adı olabilir)`,
    `  "etki": string | null,            // Etki değerlerinden biri`,
    `  "confidence": number,             // 0..1`,
    `  "reason": string                  // 1 cümle Türkçe gerekçe`,
    `}`,
  ]
    .filter(Boolean)
    .join("\n");
  const splitAt = fullPrompt.indexOf("SORUN BİLGİSİ:");
  const cachePrefix = splitAt > 0 ? fullPrompt.slice(0, splitAt) : undefined;
  const userPrompt = splitAt > 0 ? fullPrompt.slice(splitAt) : fullPrompt;

  const res: GenerateResult = await generate(SYSTEM, userPrompt, {
    temperature: 0,
    maxOutputTokens: 600,
    responseMimeType: "application/json",
    tier: "fast", // sınıflandırma tek-shot, Haiku yeterli ve ucuz
    cachePrefix,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(res.text));
  } catch {
    return emptyResult(res, "LLM JSON parse edilemedi");
  }
  const v = Output.safeParse(parsed);
  if (!v.success) {
    return emptyResult(res, "LLM çıktısı şemaya uymadı");
  }

  const out = v.data;

  // Strict validation — uymayan değerleri null'a düşür (silently drop yerine
  // override etmek tehlikeli; ajan görsün ve elle düzeltsin).
  let urun = isValidOpenValue("urun", out.urun) ? out.urun : null;
  let platform = isValidOpenValue("platform", out.platform) ? out.platform : null;
  const is_sureci = isValidOpenValue("is_sureci", out.is_sureci) ? out.is_sureci : null;
  const islem_tipi = isValidOpenValue("islem_tipi", out.islem_tipi) ? out.islem_tipi : null;
  const etkilenen_nesne = isValidOpenValue("etkilenen_nesne", out.etkilenen_nesne) ? out.etkilenen_nesne : null;
  const etki = isValidOpenValue("etki", out.etki) ? out.etki : null;

  // Hint enforcement #1 — Etkilenen nesne / işlem tipi tabanlı:
  // Mobil-kesin / Backoffice-kesin listede ise platform zorlanır.
  const hintReasons: string[] = [];
  const enforced = enforcePlatformFromHints(platform, etkilenen_nesne, islem_tipi);
  if (enforced.overridden) {
    platform = enforced.platform;
    if (enforced.reason) hintReasons.push(enforced.reason);
  }

  // Hint enforcement #2 — Açıklama metnindeki keyword tabanlı:
  // Örn. "panorama" geçerse platform=Backoffice + urun=EnRoute.
  // Etkilenen-nesne hint'i çakışırsa o galip gelir; keyword hints ürün'ü
  // dolduran ana yol (LLM ürün adı direkt geçmediğinde tahmin etmiyor).
  const kwApplied = applyKeywordHints(input.description, platform, urun);
  if (kwApplied.appliedReasons.length > 0) {
    platform = kwApplied.platform;
    urun = kwApplied.urun;
    hintReasons.push(...kwApplied.appliedReasons);
  }

  return {
    urun,
    platform,
    is_sureci,
    islem_tipi,
    etkilenen_nesne,
    etki,
    confidence: out.confidence,
    reason:
      hintReasons.length > 0
        ? `${out.reason} [Hint: ${hintReasons.join("; ")}]`
        : out.reason,
    modelUsed: res.modelUsed,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: res.costUsd,
  };
}

function emptyResult(res: GenerateResult, reason: string): CategorizationV2Result {
  return {
    urun: null,
    platform: null,
    is_sureci: null,
    islem_tipi: null,
    etkilenen_nesne: null,
    etki: null,
    confidence: 0,
    reason: `Otomatik sınıflandırma başarısız: ${reason}`,
    modelUsed: res.modelUsed,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: res.costUsd,
  };
}

// ─── Kapanış önericisi ──────────────────────────────────────────────────
//
// Çözüm taslağı + sorun açıklaması verilince 4 kapanış alanını öner:
//   kok_neden_grubu, kok_neden_detayi, cozum_tipi, kalici_onlem
//
// Ajan formda "AI ile Önerle" butonuna basınca tetiklenir; dropdown'ları
// pre-fill eder. Ajan onaylar/değiştirir, sonra "Çöz ve Kapat" basar.

const CLOSE_SYSTEM = `
Sen bir çağrı merkezi KAPANIŞ sınıflandırıcısısın. Görevin: çözüm yapılmış
ticket için destek dilinde 4 kapanış alanını seçmek.

Kurallar (mutlak):
- ASLA yeni değer uydurma; SADECE verilen taksonomide geçen string'leri kullan.
- "kok_neden_grubu" ve "kok_neden_detayi" BAĞIMSIZ seçilir; detay herhangi bir gruba ait olabilir — tüm detay listesinden uygun olanı seç.
- Uygun değer yoksa null bırak (boş string değil).
- kalici_onlem opsiyonel — emin değilsen veya gereksizse null bırak.
- Confidence 0-1 — kararsızsan düşür.
- 1 cümlelik Türkçe "reason" alanı yaz.
- Yanıtı KESİNLİKLE JSON ver, başka metin EKLEME.
`.trim();

const CloseOutput = z.object({
  kok_neden_grubu: z.string().nullable(),
  kok_neden_detayi: z.string().nullable(),
  cozum_tipi: z.string().nullable(),
  kalici_onlem: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type CloseSuggestionResult = CloseFieldsResult & {
  confidence: number;
  reason: string;
  // P1.2 — AI emin değilse (boş alan / düşük güven): etiket basmadan ÖNCE bunları sor.
  // Operatör cevaplayınca suggestClose tekrar (clarifyingAnswers ile) çağrılır.
  needsClarification: boolean;
  clarifyingQuestions: string[];
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type SuggestCloseInput = {
  description: string;       // Müşteri sorunu (ticket.description)
  resolution: string;        // Çözüm taslağı (ajan yazıyor)
  // Açılış sınıflandırması varsa bağlam — etkilemiyor ama ipucu olur
  open_urun?: string | null;
  open_is_sureci?: string | null;
  open_islem_tipi?: string | null;
  // FAZ 1 retrieval — çağıran corpus'tan benzer çözülmüş vakaları biçimlenmiş
  // few-shot bloğu olarak geçer (boşsa retrieval'sız). Kaynak-bağımsız.
  closeExamples?: string;
  // P1.2 — operatörün clarifying sorulara verdiği cevap. Verilirse prompt'a eklenir
  // (zenginleşmiş girdi → daha iyi etiket) ve tekrar soru SORULMAZ.
  clarifyingAnswers?: string;
};

// P1.2 — Clarifying sorular. Kapanışın 4 alanını elicit eder (kök neden / çözüm / önlem).
// CLOSE_CLARIFY_THRESHOLD ile düşük-güven eşiği ayarlanır (default 0.8).
const CLOSE_CLARIFY_QUESTIONS = [
  "Sorunun KÖK NEDENİ neydi? (ör. yanlış/eksik parametre · eksik veri/kart · yetki · entegratör servisi · donanım/cihaz · sunucu/altyapı)",
  "Çözüm için tam olarak NE YAPILDI? (ör. parametre değişikliği · veri/kart düzeltme · script/DB güncelleme · entegratöre yönlendirme · kullanıcı bilgilendirme)",
  "Aynı sorunun TEKRARINI önlemek için ne gerekir? (ör. eğitim/doküman · kontrol/validasyon · parametre sihirbazı · log/izleme)",
];
const CLOSE_CLARIFY_THRESHOLD = Number(process.env.CLOSE_CLARIFY_THRESHOLD || 0.8);

export async function suggestClose(
  input: SuggestCloseInput,
): Promise<CloseSuggestionResult> {
  const ctxLines: string[] = [];
  if (input.open_urun) ctxLines.push(`Açılış · Ürün: ${input.open_urun}`);
  if (input.open_is_sureci) ctxLines.push(`Açılış · İş Süreci: ${input.open_is_sureci}`);
  if (input.open_islem_tipi) ctxLines.push(`Açılış · İşlem Tipi: ${input.open_islem_tipi}`);

  // FAZ 1 — Kapanışa retrieval: benzer çözülmüş vakaları few-shot olarak ver.
  // Çağıran (route/eval) corpus'tan retrieval yapıp input.closeExamples geçer →
  // suggestClose corpus-agnostik kalır (kaynak bağımsız). Değişken → cache'li
  // öneğe DEĞİL, TICKET BAĞLAMI sonrasına eklenir (caching bozulmaz). Boşsa
  // eski davranış (regresyon yok).
  const retrievalBlock = input.closeExamples || "";

  // Tek prompt'u ORİJİNALLE BİREBİR kur, sonra cache sınırından slice ile böl.
  // cachePrefix = "TICKET BAĞLAMI:" öncesi (kapanış taksonomileri + few-shot —
  // her çağrıda DEĞİŞMEZ) → ayrı cache_control'lü bloğa konur. userPrompt =
  // "TICKET BAĞLAMI:"'den itibaren (değişken). slice garanti eder: cachePrefix
  // + userPrompt === fullPrompt (byte-identical; yalnız caching). ~%90 tasarruf.
  // v4 CASCADE — grup → detay → izinli çözüm tipleri ağaç halinde sunulur.
  // Model önce grubu, sonra YALNIZ o grubun detayını, sonra o detayın izinli
  // çözüm tipini seçer. (Kapanış gold few-shot cold-start'ta kapalı.)
  const cascadeBlock = getKokNedenGroups()
    .map((g) => {
      const dets = g.details
        .map((d) => `    - ${d.label}   [çözüm: ${d.cozum_tipleri.join(" | ")}]`)
        .join("\n");
      return `■ ${g.group}\n${dets}`;
    })
    .join("\n\n");
  const fullPrompt = [
    "KÖK NEDEN — GRUP › DETAY › İZİNLİ ÇÖZÜM TİPLERİ (CASCADE):",
    "Kural: önce bir GRUP seç; sonra YALNIZ o grubun altındaki detaylardan birini;",
    "sonra o detayın köşeli parantezdeki İZİNLİ çözüm tiplerinden birini. Grup dışı",
    "detay ya da detayın izin vermediği çözüm tipi ASLA seçme.",
    "",
    cascadeBlock,
    "",
    "TAKSONOMİ — KALICI ÖNLEM (opsiyonel, gruptan bağımsız):",
    getKaliciOnlem().values.map((v) => `  • ${v}`).join("\n"),
    "",
    "TICKET BAĞLAMI:",
    ctxLines.join("\n") || "(açılış sınıflandırması yok)",
    "",
    ...(retrievalBlock ? [retrievalBlock, ""] : []),
    `Sorun açıklaması: ${input.description.slice(0, 2000)}`,
    "",
    `Çözüm taslağı (ajan yazdı): ${input.resolution.slice(0, 3000)}`,
    "",
    ...(input.clarifyingAnswers
      ? [`OPERATÖR EK BİLGİ (clarifying sorulara cevap — etiketlerken KULLAN): ${input.clarifyingAnswers.slice(0, 1500)}`, ""]
      : []),
    `Çıktı JSON şeması (sadece JSON):`,
    `{`,
    `  "kok_neden_grubu": string | null,   // 9 gruptan biri`,
    `  "kok_neden_detayi": string | null,  // SEÇİLEN grubun altındaki detaylardan biri`,
    `  "cozum_tipi": string | null,        // SEÇİLEN detayın izinli çözüm tiplerinden biri`,
    `  "kalici_onlem": string | null,      // kalıcı önlemlerden biri, opsiyonel`,
    `  "confidence": number,`,
    `  "reason": string                    // 1 cümle gerekçe`,
    `}`,
  ].join("\n");
  const splitAt = fullPrompt.indexOf("TICKET BAĞLAMI:");
  const cachePrefix = splitAt > 0 ? fullPrompt.slice(0, splitAt) : undefined;
  const userPrompt = splitAt > 0 ? fullPrompt.slice(splitAt) : fullPrompt;

  const res: GenerateResult = await generate(CLOSE_SYSTEM, userPrompt, {
    temperature: 0,
    maxOutputTokens: 600,
    responseMimeType: "application/json",
    tier: "fast",
    cachePrefix,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(res.text));
  } catch {
    return emptyCloseResult(res, "LLM JSON parse edilemedi");
  }
  const v = CloseOutput.safeParse(parsed);
  if (!v.success) {
    return emptyCloseResult(res, "LLM çıktısı şemaya uymadı");
  }

  const out = v.data;
  // v4 STRICT CASCADE — geçersizleri null'a düşür:
  //  - grup geçerli değilse detay & çözüm de null (zincir kırık).
  //  - detay YALNIZ seçilen grubun altında geçerliyse kabul.
  //  - çözüm YALNIZ seçilen (grup, detay)'ın izinli setindeyse kabul.
  const kok_neden_grubu = isValidKokNedenGrubu(out.kok_neden_grubu) ? out.kok_neden_grubu : null;
  const kok_neden_detayi =
    kok_neden_grubu && isValidKokNedenDetay(out.kok_neden_detayi, kok_neden_grubu)
      ? out.kok_neden_detayi
      : null;
  const cozum_tipi =
    kok_neden_grubu &&
    kok_neden_detayi &&
    isValidCozumTipi(out.cozum_tipi, kok_neden_grubu, kok_neden_detayi)
      ? out.cozum_tipi
      : null;
  const kalici_onlem = isValidKaliciOnlem(out.kalici_onlem) ? out.kalici_onlem : null;

  // P1.2 — emin değil mi? Kök neden grubu/detayı boş VEYA güven eşik altı → etiket
  // yerine clarifying sorular. Operatör zaten cevap verdiyse (clarifyingAnswers)
  // tekrar sorma — o turda en iyi etiketi döndür.
  const uncertain =
    !input.clarifyingAnswers &&
    (kok_neden_grubu === null ||
      kok_neden_detayi === null ||
      out.confidence < CLOSE_CLARIFY_THRESHOLD);

  return {
    kok_neden_grubu,
    kok_neden_detayi,
    cozum_tipi,
    kalici_onlem,
    confidence: out.confidence,
    reason: out.reason,
    needsClarification: uncertain,
    clarifyingQuestions: uncertain ? CLOSE_CLARIFY_QUESTIONS : [],
    modelUsed: res.modelUsed,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: res.costUsd,
  };
}

function emptyCloseResult(res: GenerateResult, reason: string): CloseSuggestionResult {
  return {
    kok_neden_grubu: null,
    kok_neden_detayi: null,
    cozum_tipi: null,
    kalici_onlem: null,
    confidence: 0,
    reason: `Otomatik kapanış önerisi başarısız: ${reason}`,
    needsClarification: false,
    clarifyingQuestions: [],
    modelUsed: res.modelUsed,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: res.costUsd,
  };
}
