/**
 * Subject/Title normalize — görüntü katmanı utility (PR-2 UX FIX PAKETİ).
 *
 * Kullanıcı direktifi (2026-07-04): "Ham konu VERİDE AYNEN KALIR
 * (threading token'ına DOKUNMA; yalnız görüntü temizlenir). Tooltip'te
 * ham konu. Kenar: konu yalnız öneklerden ibaretse son anlamlı parça;
 * [UNV-xxx] token'ı görüntüde KORUNUR (agent referans için kullanıyor)."
 *
 * Kullanım noktaları:
 *   - Vaka başlığı gösterimi (CaseTitleEditable) — DÜZENLEME modu ham
 *   - CasesListPage satırı
 *   - CommunicationTab kompakt liste
 *   - MailMessageCard subject başlığı
 *
 * Pure function; input mutasyona uğramaz. Boş/null → boş string.
 */

// Case-insensitive prefix: Re:/Fw:/Fwd:/Ynt:/Yanıt: (tekrarlı, whitespace tolerant)
const PREFIX_RE = /^\s*(?:re|fw|fwd|ynt|yanıt|yanit)\s*:\s*/i;

// Bracket noise: [EXTERNAL] / [EXT] / [DIŞ] / [DIS] / [HARİCİ] — dış-mail
// uyarı etiketleri. Türkçe karakter class'leri (dotless I / dotted İ +
// Ş/S) — `i` flag JS ASCII i↔I eşler, Türkçe karakterler için character
// class şart.
// (Not: [XXX-NNNN] formatı case token → ayrı guard ile korunur)
const BRACKET_NOISE_RE = /^\s*\[(?:external|ext|d[ıi][şs]|har[ıi]c[ıi])\]\s*/i;

// Case token formatı: [UNV-1000042], [PRM-100], [FR-999999] gibi (2-5 harf + tire + rakam)
const CASE_TOKEN_RE = /^\s*(\[[A-Z]{2,5}-\d+\])\s*/;

/**
 * Görüntülenecek konu string'ini üretir. Ham input değişmez.
 *
 * Algoritma:
 *  1. Baştaki [XXX-NNNN] case token'ını (varsa) yakala, ayrı tut
 *  2. Kalan kısımdan Re:/Fw:/Fwd:/Ynt:/[EXTERNAL] gibi tekrarlı gürültüyü temizle
 *  3. Sonuç boş kalırsa → orijinal (ham) döndür (agent bilgisi kaybolmasın)
 *  4. Token varsa: `${token} ${cleaned}` şeklinde geri koy
 *     (stripCaseToken=true ise token da atlanır — vaka-içi mod)
 *
 * @param raw — CaseEmail.subject veya Case.title
 * @param options — {stripCaseToken?: boolean} vaka-içi listelerde token gürültüsü.
 *   R9 (2026-07-04): İletişim listesinde ve subject-changed karşılaştırmasında
 *   token'ı gizlemek için.
 * @returns görüntü katmanına uygun temizlenmiş string
 */
export function normalizeSubject(
  raw: string | null | undefined,
  options?: { stripCaseToken?: boolean },
): string {
  if (raw == null) return '';
  const input = String(raw);
  if (!input.trim()) return input;

  // 1) Case token'ı önden yakala
  const tokenMatch = input.match(CASE_TOKEN_RE);
  let token = '';
  let rest = input;
  if (tokenMatch) {
    token = tokenMatch[1];
    rest = input.slice(tokenMatch[0].length);
  }

  // 2) Tekrarlı Re/Fw/Ynt + [EXTERNAL] gürültüsünü temizle (loop — herhangi bir
  //    kombinasyonu, herhangi bir sırada)
  let prev = '';
  let cleaned = rest;
  const MAX_ITER = 32; // patolojik input guard
  let iter = 0;
  while (cleaned !== prev && iter < MAX_ITER) {
    prev = cleaned;
    cleaned = cleaned.replace(PREFIX_RE, '').replace(BRACKET_NOISE_RE, '');
    iter += 1;
  }
  cleaned = cleaned.trim();

  const strip = options?.stripCaseToken === true;

  // 3) Sonuç boş kalırsa → orijinali döndür (anlamlı içerik yoktu)
  if (!cleaned) {
    if (strip) return rest.trim();
    return token ? `${token} ${rest.trim()}`.trim() : input.trim();
  }

  // 4) Token varsa geri koy (stripCaseToken=true ise token atlanır)
  if (strip) return cleaned;
  return token ? `${token} ${cleaned}` : cleaned;
}

/**
 * Ham ve normalize edilmiş versiyon farklı mı? Tooltip göstermek için.
 */
export function isSubjectNormalized(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const s = String(raw);
  return s.trim() !== normalizeSubject(s);
}
