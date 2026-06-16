/*
 * Menü yolu doğrulayıcısı (deterministik post-processor).
 *
 * Analyst çıktısındaki "X → Y → Z" şeklindeki menü yollarını panorama
 * kılavuzundaki gerçek `menuStep` değerleriyle eşler. Eşleşme yoksa LLM
 * halüsine etmiş demek — [tahmin] etiketi koyup rationale'a not düşeriz.
 *
 * Niye gerek var: prompt seviyesinde "menü yolunu kopyala, üretme" diye
 * net kural yazmamıza rağmen Claude'un menü adlarını başka modüllerle
 * karıştırdığı gözlemlendi (örn. "Siparişten Araç Yükleme" gerçekte
 * "Dağıtım ve Stok İşlemleri" modülünde iken model "Satış ve Alış" altına
 * koyabiliyor). Bu modül, prompt kuralları başarısız olduğunda kullanıcıyı
 * yanlış yere yönlendirmenin önüne geçer.
 */

import { loadAllScreens, detectMentionedScreens, type PanoramaScreen } from "./panorama-docs";

/**
 * "X → Y → Z" şeklindeki menü yolu pattern'i.
 * Her segment Büyük harfle başlamalı (cümle başı tipik), arada → ayracı.
 * "menüsüne git", "ekranını aç" gibi imperative trailing'leri pattern'in dışında
 * tutmak için stripTrailingVerb ayrıca uygulanır.
 */
const MENU_PATH_REGEX = /([A-ZÇĞİÖŞÜ][\p{L}\p{N} .'/\-]*(?:\s*→\s*[A-ZÇĞİÖŞÜ][\p{L}\p{N} .'/\-]*){1,5})/gu;

/**
 * "Dağıtım ... → Siparişten Araç Yükleme menüsüne git" → "... → Siparişten Araç Yükleme"
 * Son segmentten "menüsüne git/aç", "ekranını aç" gibi imperative kuyruğu sil.
 */
function stripTrailingVerb(path: string): string {
  const segments = path.split("→").map((s) => s.trim());
  const last = segments[segments.length - 1] ?? "";
  // NOT: \b kullanılmıyor çünkü Türkçe ç/ş/ğ ASCII'de non-word; "aç" gibi
  // sonu Türkçe karakterli verb'lerde \b tetiklenmiyor. Bunun yerine açık
  // sınır karakteri (whitespace/punctuation/end) kullanılır.
  const BOUND = "(?:\\s|[\\.,;:!?'\"\\)]|$)";
  const cleaned = last
    // "X menüsüne git", "Y ekranını aç" gibi kombolar (her şey eklerini yer)
    .replace(
      new RegExp(
        `\\s+(menüsüne|menüsünü|menüsü|menüsünden|ekranına|ekranını|ekranı|ekranından|sayfasına|sayfasını|sayfası|sayfasından|tab'ına|tab'ını)\\s+(git|aç|gir|tıkla|geç|yönlen|açıl(?:ır|ın)?)${BOUND}.*$`,
        "iu",
      ),
      "",
    )
    // Standalone "X menüsüne / ekranını" (verb yoksa da)
    .replace(
      new RegExp(
        `\\s+(menüsüne|menüsünü|menüsü|ekranına|ekranını|ekranı|sayfasına|sayfasını|sayfası)\\.?\\s*$`,
        "iu",
      ),
      "",
    )
    // Tek başına imperative kuyruk: "git", "aç" sonu
    .replace(
      new RegExp(`\\s+(git|aç|gir|tıkla|geç|yönlen)\\s*\\.?\\s*$`, "iu"),
      "",
    )
    .replace(/[\.,;:]+$/u, "")
    .trim();
  segments[segments.length - 1] = cleaned;
  return segments.join(" → ");
}

function normalize(s: string): string {
  return s
    .replaceAll("İ", "I").replaceAll("ı", "i")
    .replaceAll("Ğ", "G").replaceAll("ğ", "g")
    .replaceAll("Ü", "U").replaceAll("ü", "u")
    .replaceAll("Ş", "S").replaceAll("ş", "s")
    .replaceAll("Ö", "O").replaceAll("ö", "o")
    .replaceAll("Ç", "C").replaceAll("ç", "c")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*→\s*/g, " > ")
    .trim();
}

let pathIndexCache: { exact: Set<string>; byLeafTitle: Map<string, PanoramaScreen> } | null = null;

function getPathIndex(): { exact: Set<string>; byLeafTitle: Map<string, PanoramaScreen> } {
  if (pathIndexCache) return pathIndexCache;
  const screens = loadAllScreens();
  const exact = new Set<string>();
  const byLeafTitle = new Map<string, PanoramaScreen>();
  for (const s of screens) {
    if (s.menuStep) exact.add(normalize(s.menuStep));
    if (s.title) byLeafTitle.set(normalize(s.title), s);
  }
  pathIndexCache = { exact, byLeafTitle };
  return pathIndexCache;
}

export type MenuPathCheck = {
  raw: string;
  valid: boolean;
  // Eğer geçerli değilse ama "leaf" (son segment) gerçek bir ekran adıysa,
  // doğru menü yolunu öner.
  suggestion?: string | null;
};

export function checkMenuPath(claimedPath: string): MenuPathCheck {
  // İmperative trailing'i sil → normalize → exact match dene.
  const cleaned = stripTrailingVerb(claimedPath);
  const norm = normalize(cleaned);
  const idx = getPathIndex();
  if (idx.exact.has(norm)) {
    return { raw: claimedPath, valid: true };
  }
  // Son segmenti çıkar — bilinen bir ekran adıysa doğru yolu öner.
  const segments = norm.split(" > ");
  const leaf = segments[segments.length - 1] ?? "";
  const screen = idx.byLeafTitle.get(leaf);
  if (screen?.menuStep) {
    return { raw: claimedPath, valid: false, suggestion: screen.menuStep };
  }
  return { raw: claimedPath, valid: false, suggestion: null };
}

export type StepLike = { step: string; rationale?: string | null };

export type ValidationOutcome<S extends StepLike> = {
  fixed: S[];
  corrections: Array<{
    stepIndex: number;
    claimedPath: string;
    suggestion: string | null;
  }>;
};

/**
 * Verilen adımlarda geçen tüm menü yollarını kontrol et. Gerçek karşılığı
 * olmayan yolları `[tahmin]` etiketiyle işaretle, varsa doğru yolu rationale'a
 * ekle.
 */
export function validateAndAnnotateSteps<S extends StepLike>(
  steps: S[],
): ValidationOutcome<S> {
  const corrections: ValidationOutcome<S>["corrections"] = [];
  const fixed: S[] = steps.map((s, i) => {
    const stepText = s.step;
    const matches = [...stepText.matchAll(MENU_PATH_REGEX)];
    if (matches.length === 0) return s;

    let newStep = stepText;
    const noteParts: string[] = [];
    for (const m of matches) {
      const claimed = m[1];
      if (!claimed) continue;
      const segs = claimed.split("→").map((x) => x.trim());
      if (segs.length < 2) continue; // tek kelime — menü yolu sayma
      const check = checkMenuPath(claimed);
      if (check.valid) continue;
      // Halüsine etmiş. Halüsinasyonun PATH KISMI ile imperative trailing'i
      // ayır; "menüsüne git." gibi son kuyrukları koruyup yalnız path
      // segmentini değiştir.
      const cleanedClaimed = stripTrailingVerb(claimed);
      if (check.suggestion) {
        newStep = newStep.replace(cleanedClaimed, check.suggestion);
        noteParts.push(
          `(menü yolu düzeltildi: "${cleanedClaimed}" → "${check.suggestion}")`,
        );
      } else {
        newStep = newStep.replace(cleanedClaimed, `${cleanedClaimed} [tahmin]`);
        noteParts.push(`(menü yolu "${cleanedClaimed}" panorama kılavuzunda bulunamadı)`);
      }
      corrections.push({
        stepIndex: i,
        claimedPath: claimed.trim(),
        suggestion: check.suggestion ?? null,
      });
    }
    if (noteParts.length === 0) return s;
    const merged = [s.rationale ?? "", ...noteParts]
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .join(" ");
    return {
      ...s,
      step: newStep,
      rationale: merged.length > 0 ? merged : null,
    };
  });
  return { fixed, corrections };
}

// ─── Step-1 reorderer ──────────────────────────────────────────────────────
// Sorun açıklamasında BİR PANORAMA EKRANI ADI BİREBİR GEÇİYORSA, analyst'in
// suggestedSteps[0]'ı o ekrana yönlendirmek ZORUNDADIR. LLM kuralı dinlemezse
// burada deterministik olarak müdahale edilir:
//
//   - Açıklamada geçen ekran adımlardan birine konu ise → o adım 1.'ye taşınır
//   - Hiçbir adımda yoksa → en başa yeni bir adım eklenir
//   - Açıklamada birden çok ekran geçerse → en uzun (en spesifik) önce
//
// Niye gerek var: kullanıcı "Siparişten araç yükleme ekranında belgeleştirme
// sırasında hata alıyorum" yazarken, LLM birinci adımı "İrsaliye Birleştirme"
// olarak verirse bu agent için utanç verici. Eski ekran zaten metinde adıyla
// geçtiği için ilk adım = o ekran kuralı tartışılmaz.

export type ReorderOutcome<S extends StepLike> = {
  steps: S[];
  changed: boolean;
  targetScreenTitle: string | null;
};

export function ensureMentionedScreenFirst<S extends StepLike>(
  steps: S[],
  description: string | null | undefined,
): ReorderOutcome<S> {
  if (!description || steps.length === 0) {
    return { steps, changed: false, targetScreenTitle: null };
  }
  const mentioned = detectMentionedScreens(description);
  if (mentioned.length === 0) {
    return { steps, changed: false, targetScreenTitle: null };
  }
  const target = mentioned[0]; // en spesifik (uzun) eşleşme
  if (!target) {
    return { steps, changed: false, targetScreenTitle: null };
  }
  const targetTitle = target.title ?? "";
  const targetMenu = target.menuStep ?? "";
  if (!targetTitle && !targetMenu) {
    return { steps, changed: false, targetScreenTitle: null };
  }

  const refersToTarget = (text: string): boolean => {
    if (!text) return false;
    if (targetMenu && text.includes(targetMenu)) return true;
    if (targetTitle && text.includes(targetTitle)) return true;
    return false;
  };

  // Adım 1 zaten doğru ekrana yönlendiriyorsa dokunma
  const firstStep = steps[0];
  if (firstStep && refersToTarget(firstStep.step)) {
    return { steps, changed: false, targetScreenTitle: targetTitle };
  }

  // Sonraki adımlarda doğru ekran var mı? Varsa öne taşı.
  const idx = steps.findIndex((s, i) => i > 0 && refersToTarget(s.step));
  if (idx > 0) {
    const moved = steps[idx];
    if (!moved) return { steps, changed: false, targetScreenTitle: targetTitle };
    const reordered = [
      moved,
      ...steps.filter((_, i) => i !== idx),
    ];
    return { steps: reordered, changed: true, targetScreenTitle: targetTitle };
  }

  // Hiçbir adımda yok — başa yeni adım ekle.
  const newFirst = {
    step: targetMenu
      ? `${targetMenu} menüsüne git.`
      : `${targetTitle} ekranını aç.`,
    rationale:
      "Sorun açıklamasında bu ekrandan doğrudan bahsedildi; ilk adım olarak hedef alındı.",
  } as unknown as S;
  return {
    steps: [newFirst, ...steps],
    changed: true,
    targetScreenTitle: targetTitle,
  };
}
