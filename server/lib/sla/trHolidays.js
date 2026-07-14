/**
 * trHolidays.js — Türkiye resmî tatil üretici (Çalışma Takvimi içe aktarma).
 * Faz 2 eklentisi, 2026-07-14 (kullanıcı önerisi: "TR tatillerini otomatik işle").
 *
 * İki kaynak:
 *  1. SABİT ulusal tatiller — her yıl aynı tarih (deterministik).
 *  2. DİNÎ bayramlar — hicri takvimle her yıl ~11 gün kayar; hesapla değil
 *     GÖMÜLÜ TABLO ile (Diyanet'in yayımladığı tarihler). Tablo dışı yıl
 *     dürüstçe reddedilir (yanlış tarih üretmekten iyidir).
 *
 * ⚠️ Dinî bayram tarihleri astronomik hesaba dayalı resmî ilanlardır —
 * içe aktarma sonrası admin ekranda gözden geçirir (UI bunu söyler);
 * tatiller tek tek silinebilir/elle düzeltilebilir. Yeni yıl eklemek =
 * aşağıdaki tabloya bir satır (yıllık bakım notu).
 */

/** Sabit ulusal tatiller — {ay, gün, ad, yarım(=arife 13:00)} */
const FIXED = [
  { m: 1, d: 1, name: 'Yılbaşı' },
  { m: 4, d: 23, name: 'Ulusal Egemenlik ve Çocuk Bayramı' },
  { m: 5, d: 1, name: 'Emek ve Dayanışma Günü' },
  { m: 5, d: 19, name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
  { m: 7, d: 15, name: 'Demokrasi ve Millî Birlik Günü' },
  { m: 8, d: 30, name: 'Zafer Bayramı' },
  { m: 10, d: 28, name: 'Cumhuriyet Bayramı Arifesi', half: true },
  { m: 10, d: 29, name: 'Cumhuriyet Bayramı' },
];

/**
 * Dinî bayramlar — yıl → [{ay, gün, ad, yarım}]. Ramazan: arife + 3 gün;
 * Kurban: arife + 4 gün. Kaynak: Diyanet dinî günler takvimi.
 */
const RELIGIOUS = {
  2025: [
    { m: 3, d: 29, name: 'Ramazan Bayramı Arifesi', half: true },
    { m: 3, d: 30, name: 'Ramazan Bayramı 1. Gün' },
    { m: 3, d: 31, name: 'Ramazan Bayramı 2. Gün' },
    { m: 4, d: 1, name: 'Ramazan Bayramı 3. Gün' },
    { m: 6, d: 5, name: 'Kurban Bayramı Arifesi', half: true },
    { m: 6, d: 6, name: 'Kurban Bayramı 1. Gün' },
    { m: 6, d: 7, name: 'Kurban Bayramı 2. Gün' },
    { m: 6, d: 8, name: 'Kurban Bayramı 3. Gün' },
    { m: 6, d: 9, name: 'Kurban Bayramı 4. Gün' },
  ],
  2026: [
    { m: 3, d: 19, name: 'Ramazan Bayramı Arifesi', half: true },
    { m: 3, d: 20, name: 'Ramazan Bayramı 1. Gün' },
    { m: 3, d: 21, name: 'Ramazan Bayramı 2. Gün' },
    { m: 3, d: 22, name: 'Ramazan Bayramı 3. Gün' },
    { m: 5, d: 26, name: 'Kurban Bayramı Arifesi', half: true },
    { m: 5, d: 27, name: 'Kurban Bayramı 1. Gün' },
    { m: 5, d: 28, name: 'Kurban Bayramı 2. Gün' },
    { m: 5, d: 29, name: 'Kurban Bayramı 3. Gün' },
    { m: 5, d: 30, name: 'Kurban Bayramı 4. Gün' },
  ],
  2027: [
    { m: 3, d: 8, name: 'Ramazan Bayramı Arifesi', half: true },
    { m: 3, d: 9, name: 'Ramazan Bayramı 1. Gün' },
    { m: 3, d: 10, name: 'Ramazan Bayramı 2. Gün' },
    { m: 3, d: 11, name: 'Ramazan Bayramı 3. Gün' },
    { m: 5, d: 15, name: 'Kurban Bayramı Arifesi', half: true },
    { m: 5, d: 16, name: 'Kurban Bayramı 1. Gün' },
    { m: 5, d: 17, name: 'Kurban Bayramı 2. Gün' },
    { m: 5, d: 18, name: 'Kurban Bayramı 3. Gün' },
    { m: 5, d: 19, name: 'Kurban Bayramı 4. Gün' },
  ],
  2028: [
    { m: 2, d: 25, name: 'Ramazan Bayramı Arifesi', half: true },
    { m: 2, d: 26, name: 'Ramazan Bayramı 1. Gün' },
    { m: 2, d: 27, name: 'Ramazan Bayramı 2. Gün' },
    { m: 2, d: 28, name: 'Ramazan Bayramı 3. Gün' },
    { m: 5, d: 4, name: 'Kurban Bayramı Arifesi', half: true },
    { m: 5, d: 5, name: 'Kurban Bayramı 1. Gün' },
    { m: 5, d: 6, name: 'Kurban Bayramı 2. Gün' },
    { m: 5, d: 7, name: 'Kurban Bayramı 3. Gün' },
    { m: 5, d: 8, name: 'Kurban Bayramı 4. Gün' },
  ],
};

export const TR_HOLIDAY_YEARS = Object.keys(RELIGIOUS).map(Number).sort();
const DEFAULT_HALF_DAY_END_MIN = 780; // 13:00 — arifelerde mesai bitişi (UI'da düzenlenebilir)

/**
 * Yılın TR resmî tatil listesi — [{date:'YYYY-MM-DD', name, isHalfDay,
 * halfDayEndMin}]. Tablo dışı yıl için null (dürüst ret — çağıran
 * kullanıcıya "bu yıl tabloda yok" der, uydurma tarih ÜRETİLMEZ).
 */
export function getTrHolidays(year) {
  const rel = RELIGIOUS[year];
  if (!rel) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return [...FIXED, ...rel]
    .map((h) => ({
      date: `${year}-${pad(h.m)}-${pad(h.d)}`,
      name: h.name,
      isHalfDay: !!h.half,
      halfDayEndMin: h.half ? DEFAULT_HALF_DAY_END_MIN : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
