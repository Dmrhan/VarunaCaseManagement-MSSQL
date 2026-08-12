/**
 * Açılış/kapanış taksonomi tanımlarının görüntülenme sırası.
 *
 * 2026-07-16 — kullanıcı kararı: içerikler alfabetik gelsin, TEK istisna
 * "impact" (Etki) — bu alan şiddet sırasına göre kasıtlı kürate edilmiş
 * ("İş tamamen durdu" → "Geçici çözüm yok"), alfabetik olursa bu anlamlı
 * azalan-önem akışı kaybolur. impact eski davranışına (sortOrder ASC)
 * geri döndürüldü; diğer 8 tip alfabetik (label, tr locale) kalıyor.
 */
const NON_ALPHABETICAL_TAXONOMY_TYPES = new Set(['impact']);

/**
 * @param {Array<{ taxonomyType: string, label: string, sortOrder?: number }>} rows
 * @returns sıralanmış YENİ dizi (in-place değil).
 */
export function sortTaxonomyDefs(rows) {
  return [...rows].sort((a, b) => {
    if (a.taxonomyType !== b.taxonomyType) {
      return a.taxonomyType < b.taxonomyType ? -1 : a.taxonomyType > b.taxonomyType ? 1 : 0;
    }
    if (NON_ALPHABETICAL_TAXONOMY_TYPES.has(a.taxonomyType)) {
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    }
    return a.label.localeCompare(b.label, 'tr');
  });
}
