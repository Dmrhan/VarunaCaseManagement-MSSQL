/**
 * Monitoring panosu — "Çözüldü" KPI kartı (Açılan'ın yanına).
 *
 * Kaynak view iki farklı Durum sözlüğü birleştiriyor: canlı (Varuna)
 * Case.status enum'ı 'Cozuldu', geçmiş (next4biz) ise 'Kapatıldı' yazıyor —
 * ikisi de "bilet nihai/çözümlü durumda" anlamına geliyor. cozuldu metriği
 * ikisini de saymalı, yoksa 149K'lık geçmiş veri sessizce dışlanır.
 *
 * Statik smoke: DB'ye dokunmaz, kaynak kodda beklenen desenlerin varlığını
 * kontrol eder.
 *
 * Çalıştır: node scripts/smoke-monitoring-cozuldu-kpi.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

function check(label, filePath, pattern) {
  const content = readFileSync(path.resolve(root, filePath), 'utf8');
  const ok = pattern.test(content);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

check(
  'monitoring.js — cozuldu iki kaynağı da sayıyor (Cozuldu + Kapatıldı)',
  'server/routes/monitoring.js',
  /WHEN Kaynak = N'Canlı \(Varuna\)'\s+AND Durum = N'Cozuldu'\s+THEN 1\s*\n\s*WHEN Kaynak = N'Geçmiş \(next4biz\)' AND Durum = N'Kapatıldı'\s+THEN 1/,
);
check(
  'monitoring.js — cozuldu METRICS şablonunda (summary/timeseries/breakdown hepsi paylaşır)',
  'server/routes/monitoring.js',
  /END\) AS cozuldu`;/,
);
check('types.ts — FunnelMetrics.cozuldu eklendi (Summary/TimeseriesPoint/BreakdownRow otomatik kapsar)', 'src/features/monitoring/types.ts', /cozuldu: number;/);
check('MonitoringPage.tsx — Çözüldü kartı Açılan\'ın hemen yanında render ediliyor', 'src/features/monitoring/MonitoringPage.tsx', /<MetricTile label="Açılan"[^\n]*\/>\s*\n\s*<MetricTile label="Çözüldü"/);
check('MonitoringPage.tsx — 7 kart için grid genişletildi (lg:grid-cols-7)', 'src/features/monitoring/MonitoringPage.tsx', /lg:grid-cols-7/);
check('MonitoringPage.tsx — Çözüldü kartı summary.cozuldu\'yu okuyor', 'src/features/monitoring/MonitoringPage.tsx', /nf\(summary\?\.cozuldu\)/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
