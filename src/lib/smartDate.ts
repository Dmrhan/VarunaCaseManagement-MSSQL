/**
 * Akıllı tarih formatı — PR-2 R9 (2026-07-04).
 *
 * Kurallar (kullanıcı direktifi):
 *  - Bugün → "HH:mm"       (14:05)
 *  - Bu yıl → "d MMM (TR)" (3 Tem)
 *  - Daha eski → "dd.MM.yyyy" (03.07.2026)
 *
 * Paylaşılan util — İletişim listesi + Aktivite + gelecek listeler kullanır.
 * Türkçe ay kısaltmaları — hard-coded (Intl locale-agnostic; tarayıcı locale
 * kırıntısı önlenir).
 */

const TR_MONTHS_SHORT = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Gösterilecek kısa tarih. Geçersiz/null input → boş string.
 * @param iso ISO 8601 string (backend `createdAt`, `receivedAt`, `sentAt`)
 * @param now Karşılaştırma referansı (test için parametre; default new Date())
 */
export function formatSmartDate(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) {
    return `${d.getDate()} ${TR_MONTHS_SHORT[d.getMonth()]}`;
  }

  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Tooltip için tam tarih-saat (kullanıcı fare üzerine gelince).
 * Format: "03.07.2026 14:05"
 */
export function formatSmartDateFull(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
