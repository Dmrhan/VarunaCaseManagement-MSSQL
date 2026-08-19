/**
 * Vaka tarih filtreleri (Açılış Tarihi dateFrom/dateTo, Çözüm Tarihi
 * resolvedDateFrom/resolvedDateTo — server/db/caseRepository.js) TR gün
 * sınırına göre çalışsın.
 *
 * Kök neden: `new Date('YYYY-MM-DD')` ECMAScript spesifikasyonu gereği HER
 * ZAMAN UTC gece yarısı üretir (sunucu saat diliminden bağımsız). TR
 * (UTC+3) ofseti uygulanmadan doğrudan gte/lte'ye verilirse:
 *   - Alt sınır (gte) HER ZAMAN 3 saat ileri kayar → TR gününün ilk 3
 *     saati (00:00-02:59 TRT) yanlışlıkla dışlanır.
 *   - Üst sınır eski kodda `.setHours()` (yerel saat) kullanıyordu — sunucu
 *     UTC'de çalışıyorsa bir sonraki TR gününün ilk 3 saati dahil olurdu.
 *
 * Gerçek veriyle doğrulandı: "14 Ağustos" filtresi COMP-UNIVERA'da eski
 * mantıkla 300, yeni mantıkla 301 vaka döndürüyor — fark UNV-1012249
 * (createdAt 2026-08-13T23:42:51.870Z UTC = 2026-08-14 02:42 TRT), eski
 * mantıkta gün sınırının dışında kalıyordu.
 *
 * Fix, Rapor Studyosu'nda (server/lib/caseReport/buildWhere.js) daha önce
 * ayrı bir düzeltmeyle uygulanmış aynı deseni paylaşılan tek noktaya
 * (server/lib/istanbulDateBounds.js) taşıyor; caseRepository.js bu noktayı
 * kullanıyor.
 *
 * Çalıştır: node scripts/smoke-case-date-filter-tr-boundary.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIstanbulDateBound } from '../server/lib/istanbulDateBounds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function check(label, ok) {
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}
function checkSrc(label, filePath, predicate) {
  const content = readFileSync(path.resolve(root, filePath), 'utf8');
  const ok = predicate instanceof RegExp ? predicate.test(content) : predicate(content);
  check(label, ok);
}

// ── Fonksiyonel — parseIstanbulDateBound gerçekten çalıştırılıyor ──
check(
  'parseIstanbulDateBound("2026-08-14") → TR gün başlangıcı (2026-08-13T21:00:00.000Z)',
  parseIstanbulDateBound('2026-08-14')?.toISOString() === '2026-08-13T21:00:00.000Z',
);
check(
  'parseIstanbulDateBound("2026-08-14", {endOfDay:true}) → TR gün sonu (2026-08-14T20:59:59.999Z)',
  parseIstanbulDateBound('2026-08-14', { endOfDay: true })?.toISOString() === '2026-08-14T20:59:59.999Z',
);
check(
  'parseIstanbulDateBound(null) → null',
  parseIstanbulDateBound(null) === null,
);
check(
  'parseIstanbulDateBound("") → null',
  parseIstanbulDateBound('') === null,
);
check(
  'parseIstanbulDateBound(Date instance) → aynı Date, dokunulmaz',
  (() => {
    const d = new Date('2026-08-14T10:30:00.000Z');
    return parseIstanbulDateBound(d)?.getTime() === d.getTime();
  })(),
);
check(
  'parseIstanbulDateBound(saatli ISO string) → dokunulmaz (kullanıcı zaten saat seçmişse)',
  parseIstanbulDateBound('2026-08-14T10:30:00.000Z')?.toISOString() === '2026-08-14T10:30:00.000Z',
);
// Gerçek veri doğrulaması: eski mantık bu case'i kaçırıyordu, yeni yakalıyor.
check(
  'UNV-1012249 (createdAt 2026-08-13T23:42:51.870Z UTC = 14 Ağustos 02:42 TRT) TR gün başlangıcının İÇİNDE',
  (() => {
    const from = parseIstanbulDateBound('2026-08-14');
    const caseCreatedAt = new Date('2026-08-13T23:42:51.870Z');
    return caseCreatedAt.getTime() >= from.getTime();
  })(),
);

// ── Statik — caseRepository.js artık ham new Date(f.dateFrom) DEĞİL, ortak helper'ı kullanıyor ──
checkSrc(
  'caseRepository.js — istanbulDateBounds.js\'ten parseIstanbulDateBound import ediyor',
  'server/db/caseRepository.js',
  /import \{ parseIstanbulDateBound \} from '\.\.\/lib\/istanbulDateBounds\.js';/,
);
checkSrc(
  'caseRepository.js — dateFrom/dateTo artık parseIstanbulDateBound ile parse ediliyor',
  'server/db/caseRepository.js',
  /const dateFrom = parseIstanbulDateBound\(f\.dateFrom\);\s*\n\s*const dateTo = parseIstanbulDateBound\(f\.dateTo, \{ endOfDay: true \}\);/,
);
checkSrc(
  'caseRepository.js — resolvedDateFrom/resolvedDateTo artık parseIstanbulDateBound ile parse ediliyor',
  'server/db/caseRepository.js',
  /const resolvedDateFrom = parseIstanbulDateBound\(f\.resolvedDateFrom\);\s*\n\s*const resolvedDateTo = parseIstanbulDateBound\(f\.resolvedDateTo, \{ endOfDay: true \}\);/,
);
checkSrc(
  'caseRepository.js — eski ham new Date(f.dateFrom)/.setHours deseni kalmamış',
  'server/db/caseRepository.js',
  (content) => !/new Date\(f\.dateFrom\)|new Date\(f\.resolvedDateFrom\)|to\.setHours\(23, 59, 59, 999\)/.test(content),
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
