/**
 * Rapor Stüdyosu — Excel export kayıt sınırı 5.000 → 20.000.
 *
 * Sabit "Phase 1" olarak konmuştu; gerçek kullanım hacmi (aylık/çeyreklik
 * export'lar 14K+ satır) rahatça bunu aşıyordu ve export hiç başlamadan
 * 400 (export_limit_exceeded) ile reddediliyordu. Veritabanı tarafı bu
 * hacmi saniyeler içinde karşılıyor — darboğaz yalnız bu sabitti.
 *
 * Statik smoke: DB'ye dokunmaz, kaynak kodda beklenen değerin varlığını
 * kontrol eder.
 *
 * Çalıştır: node scripts/smoke-report-export-limit-20k.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FILE = 'server/routes/reports.js';
const src = readFileSync(path.resolve(root, FILE), 'utf8');

let pass = 0;
let fail = 0;

function check(label, predicate) {
  const ok = predicate instanceof RegExp ? predicate.test(src) : predicate();
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

check('EXPORT_MAX_ROWS = 20000', /const EXPORT_MAX_ROWS = 20000;/);
check('Eski 5000 sabiti kalmamış', (() => !/const EXPORT_MAX_ROWS = 5000;/.test(src)));
check('Hata mesajı dinamik olarak yeni sınırı yansıtıyor (literal string değil)', /Excel export sınırı \$\{EXPORT_MAX_ROWS\}/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
