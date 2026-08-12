/**
 * smoke-pattern-insight-bounded-concurrency.js — statik guard.
 *
 * Bug: GET /api/analytics/patterns (server/routes/analytics.js), Örüntü
 * Alarmları sayfası açıldığında TÜM aktif alarmlar (take:100) için
 * SINIRSIZ eşzamanlı enrichPatternAlert() çağırıyordu. Her çağrı
 * server/lib/patternInsight.js içinde 4-5 Case sorgusu içeriyor (findMany +
 * 2x count, biri 7 günlük baseline taraması) — 100 alarımda ~400-500
 * eşzamanlı sorgu, Case tablosunda PAGELATCH_UP kilitlenmesi yaratıyordu.
 * Bu, daha önce operationsAggregator.js'de düzeltilen queryPatternAlertSummary
 * N+1'i ile AYNI kök sebep, farklı bir çağrı yeri — o fix bunu kapsamıyordu.
 *
 * Fix: aynı bounded-concurrency deseni (en fazla 10 alarm aynı anda, küçük
 * gruplar hâlinde sırayla) burada da uygulandı.
 *
 * Çalıştır: node scripts/smoke-pattern-insight-bounded-concurrency.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = readFileSync(path.resolve(root, 'server/routes/analytics.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(label, pattern) {
  const ok = pattern.test(src);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

check(
  'Eski SINIRSIZ desen (items.map(async...) doğrudan Promise.all içinde) KALDIRILDI',
  /^(?![\s\S]*await Promise\.all\(\s*items\.map\(async \(alert\) => \{)[\s\S]*$/,
);
check(
  'Sınırlı eşzamanlılık sabiti tanımlı (PATTERN_INSIGHT_CONCURRENCY)',
  /const PATTERN_INSIGHT_CONCURRENCY = 10;/,
);
check(
  'Alarmlar küçük gruplar (chunk) hâlinde, sırayla işleniyor (for + slice)',
  /for \(let i = 0; i < items\.length; i \+= PATTERN_INSIGHT_CONCURRENCY\) \{\s*const chunk = items\.slice\(i, i \+ PATTERN_INSIGHT_CONCURRENCY\);/,
);
check(
  'Her chunk içinde Promise.all ile paralel enrichPatternAlert çağrısı korunuyor',
  /const chunkResults = await Promise\.all\(\s*chunk\.map\(async \(alert\) => \{[\s\S]{0,300}enrichPatternAlert\(alert, \{ allowedCompanyIds \}\)/,
);
check(
  'insight hatası hâlâ graceful degrade ediyor (insight: null, catch bloğu korunuyor)',
  /catch \(insightErr\) \{\s*console\.warn\('\[analytics:patterns\] insight failed for', alert\.id, insightErr\?\.message\);\s*return \{ \.\.\.alert, insight: null \};/,
);
check(
  'Sonuçlar chunk\'lar arası birikiyor (enriched.push(...chunkResults))',
  /enriched\.push\(\.\.\.chunkResults\);/,
);
check(
  'Dönüş sözleşmesi değişmedi (value + @odata.count)',
  /res\.json\(\{ value: enriched, '@odata\.count': enriched\.length \}\);/,
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
