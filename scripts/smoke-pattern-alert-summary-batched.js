/**
 * smoke-pattern-alert-summary-batched.js — statik guard.
 *
 * Bug 1: queryPatternAlertSummary (server/analytics/operationsAggregator.js),
 * "Performans" panosu / RUNA AI ops uçları / Aylık Bülten açıldığında her
 * AKTİF örüntü alarmı için AYRI, SINIRSIZ eşzamanlı bir prisma.case.count()
 * atıyordu. 255+ aktif alarmda bu 255+ eşzamanlı sorguya denk geliyordu —
 * hepsi Case tablosunun yakın tarihli bölgesine düşüp PAGELATCH_UP
 * kilitlenmesi yaratıyordu (canlıda yakalandı: 20+ sorgu birbirini
 * kilitleyip başka bir sistemin — Power BI refresh — sorgusunu bile 29sn
 * bekletti).
 *
 * İlk düzeltme (tüm alarm pencerelerini kapsayan TEK geniş aralıkla adayları
 * bir kerede çekip bellekte gruplamak) geri alındı — code review bulgusu:
 * alarmlar otomatik süresi dolmuyor, yalnız elle dismiss ediliyor; eski/
 * dismiss edilmemiş bir alarm aralığı aylara kadar genişletip TÜM o
 * dönemin (alarmla ilgisiz kategoriler dahil) vakalarını belleğe çekme
 * riski taşıyordu — düzelttiğimiz N+1'den daha ağır bir tam-tablo
 * aktarımına dönüşebilirdi.
 *
 * Fix: her alarm YİNE kendi dar penceresiyle ayrı sayılıyor (indeksli,
 * hafif, sınırsız bellek riski yok) — ama SINIRLI eşzamanlılıkla (aynı
 * anda en fazla 10 tanesi), sırayla küçük gruplar hâlinde. Doğrulama:
 * aynı veri üzerinde sınırsız/sınırlı sonuçlar birebir aynı (258/258).
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
  'Eski SINIRSIZ N+1 deseni (tüm alarmlar tek Promise.all içinde) KALDIRILDI',
  /^(?![\s\S]*await Promise\.all\(alerts\.map\(async \(a\) => \{[\s\S]{0,50}prisma\.case\.count)[\s\S]*$/,
);
check(
  'İlk (geri alınan) düzeltmenin "tek geniş aralık" deseni de YOK — candidatesByKey/findMany tüm aralık taraması yok',
  /^(?![\s\S]*const candidatesByKey = new Map)[\s\S]*$/,
);
check(
  'Sınırlı eşzamanlılık sabiti tanımlı (PATTERN_ALERT_COUNT_CONCURRENCY)',
  /const PATTERN_ALERT_COUNT_CONCURRENCY = 10;/,
);
check(
  'Alarmlar küçük gruplar (chunk) hâlinde, sırayla işleniyor (for + slice)',
  /for \(let i = 0; i < alerts\.length; i \+= PATTERN_ALERT_COUNT_CONCURRENCY\) \{\s*const chunk = alerts\.slice\(i, i \+ PATTERN_ALERT_COUNT_CONCURRENCY\);/,
);
check(
  'Her chunk içinde Promise.all ile paralel, ama chunk\'lar arası await ile sıralı',
  /const chunkResults = await Promise\.all\(chunk\.map\(async \(a\) => \{[\s\S]{0,150}prisma\.case\.count\(/,
);
check(
  'Her alarm hâlâ KENDİ dar penceresiyle sayılıyor (windowStart/detectedAt, tek alarm bazlı)',
  /const windowStart = new Date\(a\.detectedAt\.getTime\(\) - \(a\.windowMinutes \?\? 60\) \* 60 \* 1000\);\s*const liveCount = await prisma\.case\.count\(\{\s*where: \{\s*companyId: a\.companyId,\s*category: a\.category,\s*createdAt: \{ gte: windowStart, lte: a\.detectedAt \},/,
);
check(
  'narrowed (takım/kişi/müşteri daraltma) filtreleri korunuyor',
  /\.\.\.\(narrowed && scope\.teamIds && scope\.teamIds\.length > 0 \? \{ assignedTeamId: \{ in: scope\.teamIds \} \} : \{\}\),\s*\.\.\.\(narrowed && scope\.personIds && scope\.personIds\.length > 0 \? \{ assignedPersonId: \{ in: scope\.personIds \} \} : \{\}\),\s*\.\.\.\(narrowed && filters\?\.accountId \? \{ accountId: filters\.accountId \} : \{\}\),/,
);
check(
  'Sonuçlar chunk\'lar arası birikiyor (counted.push(...chunkResults))',
  /counted\.push\(\.\.\.chunkResults\);/,
);
check(
  'visible/largest hesaplaması (dönüş sözleşmesi) değişmedi',
  /const visible = counted\.filter\(\(a\) => a\.liveCount > 0\);\s*const largest = visible\.reduce\(\(a, b\) => \(b\.liveCount > \(a\?\.liveCount \?\? -1\) \? b : a\), null\);/,
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
