/**
 * 'YYYY-MM-DD' (saatsiz) tarih girişini Europe/Istanbul (sabit UTC+3, DST
 * yok) gün sınırına çeviren paylaşılan yardımcı.
 *
 * Neden gerekli: `new Date('YYYY-MM-DD')` ECMAScript spesifikasyonu
 * gereği HER ZAMAN UTC gece yarısı üretir — sunucunun çalıştığı saat
 * dilimi ayarından bağımsız. UTC+3 uygulanmadan bu değer doğrudan
 * gte/lte sınırı olarak kullanılırsa:
 *   - Alt sınır (gte) HER ZAMAN 3 saat ileri kayar → TR gününün ilk 3
 *     saati (00:00-02:59 TRT) yanlışlıkla dışlanır.
 *   - Üst sınır (lte) `.setHours()` (yerel saat, UTC değil) ile
 *     hesaplanırsa, sunucu UTC'de çalışıyorsa (bulut ortamlarında
 *     yaygın, fiziksel konumdan bağımsız) bir sonraki TR gününün ilk 3
 *     saati yanlışlıkla dahil edilir.
 *
 * Bu desen server/lib/caseReport/buildWhere.js'te (Rapor Studyosu) daha
 * önce ayrı bir düzeltmeyle doğru uygulanmıştı; bu modül aynı mantığı
 * tekrar yazmak yerine paylaşılan tek noktaya taşır — caseRepository.js
 * gibi başka çağıranların aynı hatayı kopyalamasını önler (nitekim
 * resolvedDateFrom/resolvedDateTo filtresi tam olarak bu şekilde,
 * dateFrom/dateTo'daki mevcut hatayı kopyalayarak eklenmişti).
 */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * @param {string|Date|null|undefined} v
 * @param {{ endOfDay?: boolean }} [opts] endOfDay=true → TR gününün SONU
 *   (ertesi TR gününün gece yarısından 1ms önce). Varsayılan: gün başlangıcı.
 * @returns {Date|null}
 */
export function parseIstanbulDateBound(v, { endOfDay = false } = {}) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  if (DATE_ONLY_RE.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    if (endOfDay) {
      const nextDayStartMs = Date.UTC(year, month - 1, day + 1) - TR_OFFSET_MS;
      return new Date(nextDayStartMs - 1);
    }
    return new Date(Date.UTC(year, month - 1, day) - TR_OFFSET_MS);
  }
  // Saat içeren ISO giriş (kullanıcı zaten saati seçmişse) — dokunma.
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}
