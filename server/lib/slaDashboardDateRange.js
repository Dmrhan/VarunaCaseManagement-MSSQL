/**
 * slaDashboardDateRange.js — SLA İzleme panosu için Case.createdAt aralık
 * çözücü (saf fonksiyon, DB'siz test edilebilir).
 *
 * İki kaynak birbirini DIŞLAR (AND değil): createdFrom/createdTo verilmişse
 * Yıl/Ay sınırını EZER (aralık kazanır) — kullanıcı kararı. Sebep: Yıl/Ay
 * panonun varsayılan performans-güvenli penceresi; createdFrom/createdTo
 * girildiğinde kullanıcı zaten daha spesifik bir istek yapıyor demektir,
 * ikisinin kesişimini hesaplamak (AND) UI'da "hangisi geçerli" belirsizliği
 * yaratır. UI tarafı createdFrom/createdTo seçilince Yıl/Ay'ı temizler.
 *
 * Tüm gün sınırları TÜRKİYE gün sınırıyla (Europe/Istanbul, sabit UTC+3,
 * DST yok) hesaplanır — server/analytics/slaDashboard.js'teki mevcut yıl/ay
 * mantığıyla aynı TR_OFFSET_MS konvansiyonu (düz UTC sınırı yerel
 * geceyarısından 3 saat kayar).
 */
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' (input type=date formatı) parse eder. Geçersizse null. */
function parseDateOnly(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * @param {{ year?: unknown, month?: unknown, createdFrom?: unknown, createdTo?: unknown }} params
 * @returns {{ gte?: Date, lt?: Date } | null}
 *   null — hiçbir sınır uygulanmaz (tüm-zamanlar taraması; sadece year hiç
 *   verilmemişse VE createdFrom/createdTo de yoksa/geçersizse döner).
 */
export function resolveSlaDashboardCreatedRange({ year, month, createdFrom, createdTo } = {}) {
  const from = parseDateOnly(createdFrom);
  const to = parseDateOnly(createdTo);
  if (from || to) {
    const gte = from ? new Date(Date.UTC(from.year, from.month - 1, from.day) - TR_OFFSET_MS) : undefined;
    // "to" günü SONUNA kadar dahil → ertesi günün TR gece yarısı (lt, exclusive üst sınır).
    // Date.UTC gün taşmasını (örn. day+1 ayın son günündeyse) doğru şekilde bir sonraki aya taşır.
    const lt = to ? new Date(Date.UTC(to.year, to.month - 1, to.day + 1) - TR_OFFSET_MS) : undefined;
    return { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
  }

  const y = Number(year) || null;
  if (!y) return null;
  const m = Number(month) || null; // 1-12
  const rangeFrom = new Date(Date.UTC(y, m ? m - 1 : 0, 1) - TR_OFFSET_MS);
  const rangeTo = m
    ? new Date(Date.UTC(y, m, 1) - TR_OFFSET_MS)
    : new Date(Date.UTC(y + 1, 0, 1) - TR_OFFSET_MS);
  return { gte: rangeFrom, lt: rangeTo };
}
