/*
 * PII redaction — analiz LLM'ine giden metinde duyarlı bilgileri maskeler.
 *
 * Maskelenenler:
 *   - TC Kimlik No (11 hane, 1 ile başlar)
 *   - IBAN (TR..)
 *   - Kredi kartı (13-19 hane, Luhn değil basit format)
 *   - Telefon (TR formatları: +90, 05XX, vs.)
 *   - E-posta
 *   - 4 hane'den uzun saf sayı dizileri (sipariş/fatura no risk olabilir;
 *     ihtiyatlı maskeleme)
 *
 * Yaklaşım: false-positive olabilir; LLM yanıt taslağında müşteri adı veya
 * sipariş no görünmemesi tercih edilir. Görünür olması istenen alanlar
 * (örn. Bildirim_No) redact pipeline'ından geçirilmez.
 */

export type Redaction = {
  kind: "tckn" | "iban" | "card" | "phone" | "email" | "longnum";
  raw: string;
  placeholder: string;
};

// Sıra önemli: önce gelen pattern eşleştiği bölgeyi tüketir. TCKN ve kart
// gibi sabit-uzunluk hassas kalıplar telefon ve longnum'dan önce uygulanır.
const PATTERNS: Array<{ kind: Redaction["kind"]; re: RegExp; mask: string }> = [
  { kind: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, mask: "<EMAIL>" },
  { kind: "iban", re: /\bTR\d{2}[\s-]?(?:\d{4}[\s-]?){5}\d{2}\b/gi, mask: "<IBAN>" },
  { kind: "card", re: /\b(?:\d[\s-]?){12,18}\d\b/g, mask: "<CARD>" },
  { kind: "tckn", re: /\b[1-9]\d{10}\b/g, mask: "<TCKN>" },
  {
    kind: "phone",
    // +90 5XX XXX XX XX  |  +90 (0XXX) XXX XX XX  |  05XX XXX XX XX
    re: /(?:\+?90[\s.-]?)?(?:\(0\d{3}\)|0?\d{3})[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/g,
    mask: "<TEL>",
  },
  // 5+ haneli düz sayı dizileri (sipariş/fatura no riski)
  { kind: "longnum", re: /\b\d{5,}\b/g, mask: "<NUM>" },
];

export function redact(input: string | null | undefined): {
  text: string;
  redactions: Redaction[];
} {
  if (!input) return { text: "", redactions: [] };
  let text = input;
  const redactions: Redaction[] = [];
  for (const { kind, re, mask } of PATTERNS) {
    text = text.replace(re, (m) => {
      redactions.push({ kind, raw: m, placeholder: mask });
      return mask;
    });
  }
  return { text, redactions };
}
