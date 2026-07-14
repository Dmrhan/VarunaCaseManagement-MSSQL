/**
 * smoke-business-time.js — SLA iş-saati motoru fixture testleri. 2026-07-14
 *
 * Onaylı takvimle (Pzt-Cu 08:30-18:00, mola 12:00-13:00 → net 8,5 sa/gün)
 * TAM BEKLENEN DEĞERLİ senaryolar. DB'ye dokunmaz (saf fonksiyonlar).
 * Tarih çıpaları: 2026-07-13 = Pazartesi (bilinen).
 */
import {
  normalizeCalendar,
  dayIntervals,
  addBusinessMinutes,
  businessMinutesBetween,
  nextBusinessStart,
} from '../server/lib/sla/businessTime.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };

const TR = 3 * 60 * 60 * 1000;
/** TR-yerel an → UTC ms. ms('2026-07-14', 9, 0) = Salı 09:00 TR. */
const ms = (d, h, m = 0) => Date.parse(`${d}T00:00:00Z`) + (h * 60 + m) * 60000 - TR;
const fmt = (v) => (v == null ? 'null' : new Date(v + TR).toISOString().slice(0, 16).replace('T', ' '));
const eq = (name, got, want) => {
  const okv = got === want;
  if (!okv) console.log(`   beklenen ${fmt(want)}  gelen ${fmt(got)}`);
  ok(name, okv);
};

// Onaylı Univera takvimi — workDays STRING JSON (DB'den geldiği hali)
const cal = normalizeCalendar({
  isActive: true,
  workDays: JSON.stringify([1, 2, 3, 4, 5].map((day) => ({ day, startMin: 510, endMin: 1080 }))),
  breakStartMin: 720,
  breakEndMin: 780,
  holidays: [
    { date: '2026-07-15', isHalfDay: false },                      // Çarşamba — tam tatil
    { date: '2026-07-16', isHalfDay: true, halfDayEndMin: 780 },   // Perşembe — arife (13:00)
  ],
});

// ── Normalizasyon ──
ok('1 takvim normalize: 5 gün + mola parse edildi',
  cal !== null && cal.byDay.size === 5 && cal.breakStartMin === 720 && cal.holidays.size === 2);
ok('2 dürüst geri çekilme: null / pasif / bozuk JSON / boş günler → null',
  normalizeCalendar(null) === null
  && normalizeCalendar({ isActive: false, workDays: '[]' }) === null
  && normalizeCalendar({ workDays: 'BOZUK{' }) === null
  && normalizeCalendar({ workDays: '[]' }) === null
  && addBusinessMinutes(ms('2026-07-14', 9), 60, null) === null
  && businessMinutesBetween(0, 1, null) === null);

// ── Gün aralıkları ──
ok('3 normal gün: mola pencereyi ikiye böler [510-720]+[780-1080] = 510 dk (8,5 sa)',
  JSON.stringify(dayIntervals(Date.parse('2026-07-14T00:00:00Z') - TR, cal))
  === JSON.stringify([[510, 720], [780, 1080]]));
ok('4 hafta sonu + tam tatil: aralık yok',
  dayIntervals(Date.parse('2026-07-18T00:00:00Z') - TR, cal).length === 0   // Cumartesi
  && dayIntervals(Date.parse('2026-07-15T00:00:00Z') - TR, cal).length === 0); // tam tatil
ok('5 arife + mola çakışması: 13:00 bitişli yarım gün fiilen [510,720] (08:30-12:00)',
  JSON.stringify(dayIntervals(Date.parse('2026-07-16T00:00:00Z') - TR, cal))
  === JSON.stringify([[510, 720]]));

// ── addBusinessMinutes ──
eq('6 basit: Salı 09:00 + 60dk → 10:00',
  addBusinessMinutes(ms('2026-07-14', 9), 60, cal), ms('2026-07-14', 10));
eq('7 öğleni kesen (mockup örneği): Salı 11:30 + 240dk → 16:30 (mola atlandı)',
  addBusinessMinutes(ms('2026-07-14', 11, 30), 240, cal), ms('2026-07-14', 16, 30));
eq('8 tam-aralık-sonu: Salı 09:00 + 180dk → 12:00 (mola başlangıcı)',
  addBusinessMinutes(ms('2026-07-14', 9), 180, cal), ms('2026-07-14', 12));
eq('9 mola içinde açılış: Salı 12:15 + 30dk → 13:30',
  addBusinessMinutes(ms('2026-07-14', 12, 15), 30, cal), ms('2026-07-14', 13, 30));
eq('10 gün taşması + hafta sonu: Cuma 17:50 + 30dk → Pazartesi 08:50',
  addBusinessMinutes(ms('2026-07-17', 17, 50), 30, cal), ms('2026-07-20', 8, 50));
eq('11 tam tatil atlama: Salı 17:00 + 120dk → Çarşamba (tam tatil) atlanır → arife Perşembe 09:30',
  addBusinessMinutes(ms('2026-07-14', 17), 120, cal), ms('2026-07-16', 9, 30));
eq('12 arife yarımı taşırır: Perşembe(arife) 11:00 + 120dk → Cuma 09:30',
  addBusinessMinutes(ms('2026-07-16', 11), 120, cal), ms('2026-07-17', 9, 30));
eq('13 mesai dışı gece açılış: Salı 02:00 → sonraki iş anı Salı 08:30',
  nextBusinessStart(ms('2026-07-14', 2), cal), ms('2026-07-14', 8, 30));
eq('14 hafta sonu açılış: Cumartesi 10:00 → Pazartesi 08:30',
  nextBusinessStart(ms('2026-07-18', 10), cal), ms('2026-07-20', 8, 30));

// ── businessMinutesBetween ──
ok('15 öğle sayılmaz: Salı 11:30 → 13:30 arası = 60 iş-dk',
  businessMinutesBetween(ms('2026-07-14', 11, 30), ms('2026-07-14', 13, 30), cal) === 60);
ok('16 hafta sonu sayılmaz: Cuma 18:00 → Pazartesi 08:30 arası = 0',
  businessMinutesBetween(ms('2026-07-17', 18), ms('2026-07-20', 8, 30), cal) === 0);
ok('17 add ↔ between simetrisi: +500dk sonra aradaki iş-dk = 500 (gün taşmalı)',
  (() => {
    const a = ms('2026-07-14', 9);
    const b = addBusinessMinutes(a, 500, cal);
    return businessMinutesBetween(a, b, cal) === 500;
  })());
ok('18 ters sıra negatif simetrik',
  businessMinutesBetween(ms('2026-07-14', 13, 30), ms('2026-07-14', 11, 30), cal) === -60);
ok('19 tatil haftası toplamı: Pzt-Paz (13-19 Tem) tam hafta = Pzt 510 + Salı 510 + Çarş 0(tatil) + Perş 210(arife) + Cuma 510 = 1740 iş-dk',
  businessMinutesBetween(ms('2026-07-13', 0), ms('2026-07-20', 0), cal) === 1740);

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
