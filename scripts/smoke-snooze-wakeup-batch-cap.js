/**
 * smoke-snooze-wakeup-batch-cap.js — statik guard.
 *
 * processSnoozeWakeups (server/db/caseRepository.js), 5 dk'da bir çalışan
 * cron ile vadesi gelen "erteleme" (snooze) kayıtlarını Açık'a döndürüyor.
 * Fetch sorgusunda üst sınır yoktu — aynı saate çok sayıda vaka snooze
 * edilirse (örn. "Pazartesi 09:00" toplu deseni), tek cron turu vaka
 * başına SIRALI update+history yazdığı için uzayabilirdi.
 *
 * Fix: SNOOZE_WAKEUP_BATCH_CAP (200) ile bir turda işlenecek kayıt
 * sınırlanıyor; en eski snoozeUntil önce işlenir (orderBy asc), kalan
 * kayıtlar bir sonraki turda işlenir — veri kaybı yok, sadece gecikme.
 *
 * Çalıştır: node scripts/smoke-snooze-wakeup-batch-cap.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = readFileSync(path.resolve(root, 'server/db/caseRepository.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(label, pattern) {
  const ok = pattern.test(src);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

const fnStart = src.indexOf('async processSnoozeWakeups()');
const fnEnd = src.indexOf('\n  },', fnStart);
const fnBody = fnStart >= 0 && fnEnd > fnStart ? src.slice(fnStart, fnEnd) : '';
console.log(`${fnBody ? '✔' : '✘'} processSnoozeWakeups fonksiyon gövdesi bulundu`);
if (fnBody) pass += 1; else fail += 1;

check(
  'Batch cap sabiti tanımlı (SNOOZE_WAKEUP_BATCH_CAP = 200)',
  /const SNOOZE_WAKEUP_BATCH_CAP = 200;/,
);
check(
  'findMany çağrısında take: SNOOZE_WAKEUP_BATCH_CAP var',
  /take: SNOOZE_WAKEUP_BATCH_CAP,/,
);
check(
  'En eski snoozeUntil önce işlenir (orderBy asc) — açlık/starvation önlenir',
  /orderBy: \{ snoozeUntil: 'asc' \},/,
);
check(
  'where koşulları (snoozeUntil lte now + NOT null) korunuyor',
  /snoozeUntil: \{ lte: new Date\(\) \},\s*NOT: \{ snoozeUntil: null \},/,
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
