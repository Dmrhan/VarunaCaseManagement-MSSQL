/*
 * Müşteri-anonimizasyon katmanı.
 *
 * Tehdit: kullanıcı "Pernod Ricard'ın en çok şikayet ettiği konu" gibi
 * müşteri ADI üzerinden arama yapamamalı. PII maskelemenin (redactor.ts)
 * ötesinde, müşteri tanımlayıcılarının ne sorgu vektöründe ne çıktı metninde
 * görünmesi gerekiyor.
 *
 * İki ana API:
 *  - detectCustomerNames(text)  → sorguda müşteri adı varsa hangi(ler)i
 *  - anonymizeCustomers(text)   → ham metni `<MUSTERI>` placeholder'larıyla
 *                                  değiştir
 *
 * Blocklist scripts/build-customer-blocklist.mjs ile üretilir; loader
 * runtime'da JSON'ı okur ve regex'leri bir kez kurar.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

type CustomerEntry = {
  canonical: string;
  normalized: string;
  tokens: string[];
};

type Blocklist = {
  generatedAt: string;
  customers: CustomerEntry[];
  companySuffixes: string[];
};

let cache: {
  list: Blocklist;
  // Tüm "kelime ya da kelime grubu" normalize halleri. Tek-token müşteriler
  // (Brisa, Nestle...) ve çok-tokenlı tam adlar burada birlikte.
  needles: Array<{ canonical: string; pattern: RegExp }>;
  suffixPattern: RegExp | null;
} | null = null;

function blocklistPath(): string {
  return path.resolve(process.cwd(), "data/customer-blocklist.json");
}

// build-customer-blocklist.mjs ile aynı normalize fonksiyonu — replikasyondan
// kaçınmak için TS tarafa kopyalandı.
export function normalizeForMatch(s: string): string {
  return s
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
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function load(): NonNullable<typeof cache> {
  if (cache) return cache;
  const p = blocklistPath();
  if (!existsSync(p)) {
    throw new Error(
      "Müşteri blocklist'i yok. Çalıştır: node scripts/build-customer-blocklist.mjs",
    );
  }
  const list = JSON.parse(readFileSync(p, "utf8")) as Blocklist;

  // Her müşteri için word-boundary'li regex kur. Çok-token isimler (örn
  // "pernod ricard") iki kelimenin yan yana gelmesini bekler; tek-token isim
  // (örn "nestle") tek kelime eşleşir. Esnek aralıkları (\s+) kullan.
  const needles: Array<{ canonical: string; pattern: RegExp }> = [];
  for (const c of list.customers) {
    // Çok kısa normalize'ları (≤2) atla; "as", "ab" gibi false positive
    // riski yüksek. 3+ karakter zorunlu.
    if (c.normalized.length < 3) continue;
    const escaped = c.normalized.split(" ").map(escapeRegex).join("\\s+");
    needles.push({
      canonical: c.canonical,
      // \b ASCII word-boundary; normalize edilmiş metin zaten ASCII.
      pattern: new RegExp(`\\b${escaped}\\b`, "i"),
    });
  }

  // Şirket sonek pattern'i (output maskeleme için ek koruma).
  let suffixPattern: RegExp | null = null;
  if (list.companySuffixes?.length) {
    // "X A.Ş." gibi → 1-4 başı kelime + sonek
    const sufAlt = list.companySuffixes
      .map((s) => escapeRegex(s.replace(/\s+/g, " ").trim()))
      .join("|");
    suffixPattern = new RegExp(
      `\\b(?:[A-ZÇĞİÖŞÜ][\\wÇĞİÖŞÜçğıöşü\\.]+\\s+){0,4}(?:${sufAlt})\\b`,
      "g",
    );
  }

  cache = { list, needles, suffixPattern };
  return cache;
}

export type CustomerDetection = {
  hit: boolean;
  matches: string[]; // canonical adlar
};

/**
 * Sorguda müşteri adı(ları) var mı? Sert reddetme akışı için kullanılır.
 */
export function detectCustomerNames(input: string | null | undefined): CustomerDetection {
  if (!input || !input.trim()) return { hit: false, matches: [] };
  const { needles } = load();
  const norm = normalizeForMatch(input);
  const matches: string[] = [];
  for (const n of needles) {
    if (n.pattern.test(norm)) matches.push(n.canonical);
  }
  return { hit: matches.length > 0, matches };
}

/**
 * Metinde geçen müşteri adlarını `<MUSTERI>` placeholder'ı ile değiştir.
 *
 * Strateji: normalize edilmiş ASCII metin üzerinde işlem yap; çıktı da
 * normalize ASCII döner. Embedding hesaplamasında bu yeterli ve Türkçe
 * karakterlerden bağımsız tutarlılık sağlar. UI'da ham metni göstermek
 * istersek `anonymizeForDisplay` ayrı API olarak eklenmeli (gelecek iş).
 */
export function anonymizeCustomers(input: string | null | undefined): {
  text: string;
  redactions: Array<{ kind: "musteri"; raw: string }>;
} {
  if (!input) return { text: "", redactions: [] };
  const { needles } = load();
  const redactions: Array<{ kind: "musteri"; raw: string }> = [];

  // Normalize: tüm Türkçe karakterler ASCII, lowercase, sembollerden arınmış.
  // needles regex'leri zaten normalize edilmiş metin için kuruldu.
  let text = normalizeForMatch(input);

  for (const n of needles) {
    // Her bir müşteri için global regex aç (load() tek-match için 'i' flag'li
    // kurmuştu; anonymize'da multi-occurrence gerekir).
    const gre = new RegExp(n.pattern.source, "gi");
    text = text.replace(gre, (m) => {
      redactions.push({ kind: "musteri", raw: m });
      return "<MUSTERI>";
    });
  }

  return { text, redactions };
}

/**
 * Tek noktadan kontrol — sorguyu reddetmek isteyen API katmanı bu fırlatılan
 * hatayı yakalayıp 400 dönmeli.
 */
export class CustomerSearchBlockedError extends Error {
  readonly matches: string[];
  constructor(matches: string[]) {
    super("Müşteri bazlı arama desteklenmiyor.");
    this.name = "CustomerSearchBlockedError";
    this.matches = matches;
  }
}

/**
 * Sorgu girişinde sert kontrol. Eşleşme varsa fırlatır.
 */
export function assertNoCustomerName(text: string | null | undefined): void {
  const d = detectCustomerNames(text);
  if (d.hit) throw new CustomerSearchBlockedError(d.matches);
}
