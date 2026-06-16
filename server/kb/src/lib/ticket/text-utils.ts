/*
 * Türkçe metin normalize/tokenize yardımcıları — pattern sentezini
 * deterministik olarak üretmek için (LLM kullanmadan).
 */

/** Türkçe karakter alt-üst eşleştirme + lowercase. */
export function trLower(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLowerCase();
}

/** ASCII'leştir (token'ı dize karşılaştırması için). */
export function asciiFold(s: string): string {
  return trLower(s)
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/ü/g, "u");
}

// Düşük katkı sağlayan, neredeyse her cümlede görülen TR kelimeler.
// Listeyi minimal tutuyoruz; agresif filtreleme bilgi kaybeder.
export const STOPWORDS: ReadonlySet<string> = new Set([
  "ve", "veya", "ile", "icin", "için", "gibi", "bir", "bu", "su", "şu", "o",
  "ben", "sen", "biz", "siz", "onlar",
  "daha", "cok", "çok", "az", "en", "sonra", "once", "önce",
  "da", "de", "ki", "mi", "mı", "mu", "mü",
  "ne", "hangi", "kim", "ama", "ancak", "fakat", "cunku", "çünkü", "eger", "eğer", "yani",
  "ilgili", "uzerinde", "uzerine", "hakkinda", "hakkında", "kadar", "gore", "göre",
  "lutfen", "lütfen", "sayin", "sayın", "merhaba",
  "iyi", "calismalar", "çalışmalar", "tesekkur", "teşekkür",
  "tesekkurler", "teşekkürler", "ederim", "ederiz",
  "selam", "selamlar", "saygilarimla", "saygılarımla", "kolay",
  "olarak", "tarafindan", "tarafından",
  "var", "yok", "olur", "olmus", "olmuş",
  // E-posta forward / header artıkları (HTML entity, alıntı bloğu, tarih,
  // gün/ay adları). Bu tokenlar gerçek müşteri içeriği taşımaz.
  "lt", "gt", "amp", "nbsp", "quot",
  "subject", "sent", "from", "to", "cc", "bcc", "fw", "fwd", "re",
  "original", "message", "wrote", "date", "am", "pm",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "pazartesi", "sali", "salı", "carsamba", "çarşamba", "persembe", "perşembe",
  "cuma", "cumartesi", "pazar",
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
  "ocak", "subat", "şubat", "mart", "nisan", "mayis", "mayıs", "haziran",
  "temmuz", "agustos", "ağustos", "eylul", "eylül", "ekim", "kasim", "kasım", "aralik", "aralık",
  // Web/posta domain bileşenleri
  "com", "net", "org", "edu", "gov", "tr", "uk", "us",
  // Türkçe firma takıları (genelde Bildirim adresi/altyazılarda)
  "san", "tic", "ltd", "sti", "şti", "as", "anonim",
]);

/** Bir cümleyi token'lara böler — TR/ASCII ortak forma indirip noktalama atar. */
export function tokenize(s: string): string[] {
  return asciiFold(s)
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Çok kaba TR "stem" — Türkçe sondan eklemeli olduğu için kelimenin ilk 6
 * karakteri, çekimleri büyük ölçüde temizler. Lemmatize değil ama
 * Jaccard benzerliği için yeterli yakınsama sağlar.
 * Örn. "temsilcisinden", "temsilcisi", "temsilciye" → "temsil"
 */
export function stem(token: string): string {
  if (token.length <= 6) return token;
  return token.slice(0, 6);
}

export function tokenizeStemmed(s: string): string[] {
  return tokenize(s).map(stem);
}

/** Metni cümlelere böler — TR noktalama: .  !  ?  …  ; — yeni satır. */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  // Newline'ı cümle sınırı yap; ardışık boşlukları sıkıştır.
  const norm = text.replace(/\s+/g, " ").trim();
  if (!norm) return [];
  return norm
    .split(/(?<=[.!?…])\s+|;\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 400);
}

/**
 * Bir cümle için içerik fingerprint'i — sıralı, normalize edilmiş,
 * stopword'süz token sequence'in hash benzeri formu.
 * Aynı cümlenin farklı yazılışlarını eşit kabul eder (yaklaşık).
 */
export function sentenceKey(s: string): string {
  const toks = tokenize(s);
  if (toks.length === 0) return "";
  // Token'ları sırala — kelime sırası değişse de yakalansın.
  return toks.slice().sort().join(" ");
}

/** Jaccard benzerliği — küme tabanlı, [0..1]. */
export function jaccard(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

/**
 * N-gram (2..4) — DISTINCT döküman bazlı sayım. Aynı uzun mesajda aynı
 * ifade defalarca geçerse skoru şişmesin diye her gram, dökümanlardaki
 * distinct varlığıyla puanlanır. Sayısal tokenlar ve mask token'ları
 * (e-postanın `<EMAIL>`'den geleni vs.) atlanır.
 */
export function topNGrams(
  texts: string[],
  topK: number,
  minLen: 2 | 3 = 2,
): Array<{ phrase: string; count: number }> {
  const docCount = new Map<string, number>();
  const MASK_TOKENS = new Set(["email", "tel", "tckn", "iban", "card", "num"]);

  for (const t of texts) {
    const toks = tokenize(t).filter(
      (tk) => !/^\d+$/.test(tk) && !MASK_TOKENS.has(tk),
    );
    const seenInDoc = new Set<string>();
    for (let n = minLen; n <= 4; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const gram = toks.slice(i, i + n).join(" ");
        if (gram.length < 6) continue;
        seenInDoc.add(gram);
      }
    }
    for (const g of seenInDoc) {
      docCount.set(g, (docCount.get(g) ?? 0) + 1);
    }
  }
  return Array.from(docCount.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([phrase, count]) => ({ phrase, count }));
}
