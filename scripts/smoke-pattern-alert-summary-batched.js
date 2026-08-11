/**
 * smoke-pattern-alert-summary-batched.js — statik guard.
 *
 * Bug: queryPatternAlertSummary (server/analytics/operationsAggregator.js),
 * "Performans" panosu / RUNA AI ops uçları / Aylık Bülten açıldığında her
 * AKTİF örüntü alarmı için AYRI bir prisma.case.count() atıyordu
 * (Promise.all ile paralel). 255 aktif alarmda bu 255 eşzamanlı sorguya
 * denk geliyordu — hepsi Case tablosunun yakın tarihli bölgesine düşüp
 * PAGELATCH_UP kilitlenmesi yaratıyordu (canlıda yakalandı: 20+ sorgu
 * birbirini kilitleyip başka bir sistemin — Power BI refresh — sorgusunu
 * bile 29sn bekletti).
 *
 * Fix: tüm alarmların pencerelerini (detectedAt - windowMinutes .. detectedAt)
 * kapsayan TEK bir aralıkla adaylar bir kere çekiliyor, sayım bellekte
 * (companyId, category) anahtarıyla gruplanıp her alarmın kendi dar
 * penceresine göre yapılıyor. Doğrulama: aynı veri üzerinde eski/yeni
 * sonuçlar birebir aynı çıktı (255/255 eşleşme), süre 7977ms → 761ms.
 *
 * Çalıştır: node scripts/smoke-pattern-alert-summary-batched.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = readFileSync(path.resolve(root, 'server/analytics/operationsAggregator.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(label, pattern) {
  const ok = pattern.test(src);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

check(
  'Eski N+1 deseni (Promise.all + alerts.map + prisma.case.count) KALDIRILDI',
  /^(?![\s\S]*await Promise\.all\(alerts\.map\(async \(a\) => \{[\s\S]{0,50}prisma\.case\.count)[\s\S]*$/,
);
check(
  'Tüm alarm pencerelerini kapsayan TEK aralık hesaplanıyor (earliestWindowStart/latestDetectedAt)',
  /const earliestWindowStart = new Date\(Math\.min\(\.\.\.windowStartMs\)\);\s*const latestDetectedAt = new Date\(Math\.max\(\.\.\.alerts\.map\(\(a\) => a\.detectedAt\.getTime\(\)\)\)\);/,
);
check(
  'Adaylar TEK prisma.case.findMany ile çekiliyor (companyId/isArchived/createdAt aralığı + narrowed filtreler)',
  /const candidates = await prisma\.case\.findMany\(\{\s*where: \{\s*companyId: \{ in: scope\.companyIds \},\s*isArchived: false,[\s\S]{0,80}createdAt: \{ gte: earliestWindowStart, lte: latestDetectedAt \},/,
);
check(
  'Adaylar (companyId, category) anahtarıyla Map\'e gruplanıyor',
  /const candidatesByKey = new Map\(\);\s*for \(const c of candidates\) \{\s*const key = `\$\{c\.companyId\}\|\$\{c\.category\}`;/,
);
check(
  'Her alarm için sayım bellekte (senkron .map, artık await/Promise.all YOK) yapılıyor',
  /const counted = alerts\.map\(\(a\) => \{\s*const windowStart = a\.detectedAt\.getTime\(\) - \(a\.windowMinutes \?\? 60\) \* 60 \* 1000;\s*const windowEnd = a\.detectedAt\.getTime\(\);\s*const times = candidatesByKey\.get\(`\$\{a\.companyId\}\|\$\{a\.category\}`\) \?\? \[\];\s*const liveCount = times\.reduce/,
);
check(
  'narrowed (takım/kişi/müşteri daraltma) filtreleri korunuyor — TEK sorguda uygulanıyor',
  /\.\.\.\(narrowed && scope\.teamIds && scope\.teamIds\.length > 0 \? \{ assignedTeamId: \{ in: scope\.teamIds \} \} : \{\}\),\s*\.\.\.\(narrowed && scope\.personIds && scope\.personIds\.length > 0 \? \{ assignedPersonId: \{ in: scope\.personIds \} \} : \{\}\),\s*\.\.\.\(narrowed && filters\?\.accountId \? \{ accountId: filters\.accountId \} : \{\}\),/,
);
check(
  'visible/largest hesaplaması (dönüş sözleşmesi) değişmedi',
  /const visible = counted\.filter\(\(a\) => a\.liveCount > 0\);\s*const largest = visible\.reduce\(\(a, b\) => \(b\.liveCount > \(a\?\.liveCount \?\? -1\) \? b : a\), null\);/,
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
