/**
 * Monitoring panosu — filtre çubuğuna Takım filtresi (Proje dropdown'ının
 * yanı, boş bırakılan alan).
 *
 * Statik smoke: DB'ye dokunmaz, kaynak kodda beklenen desenlerin varlığını
 * kontrol eder.
 *
 * Çalıştır: node scripts/smoke-monitoring-takim-filter.js
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

check('monitoring.js — buildWhere Takim filtresi uyguluyor', 'server/routes/monitoring.js', /if \(typeof qp\.takim === 'string' && qp\.takim\) w\.push\(`Takim = \$\{esc\(qp\.takim\)\}`\);/);
check('monitoring.js — /filters endpoint takimlar listesi dönüyor', 'server/routes/monitoring.js', /SELECT Takim AS \[key\], COUNT\(\*\) AS c \$\{base\} AND Takim IS NOT NULL AND Takim <> N''/);
check('monitoring.js — takimlar response\'a eklendi', 'server/routes/monitoring.js', /takimlar: takimlar\.map\(serialize\),/);
check('types.ts — MonitoringFilters.takim eklendi', 'src/features/monitoring/types.ts', /takim\?: string;/);
check('types.ts — FiltersResponse.takimlar eklendi', 'src/features/monitoring/types.ts', /takimlar: \{ key: string; c: number \}\[\];/);
check('MonitoringPage.tsx — Takım dropdown Proje dropdown\'ının hemen yanında', 'src/features/monitoring/MonitoringPage.tsx', /<\/select>\s*\n\s*<select\s*\n\s*value=\{filters\.takim/);
check('MonitoringPage.tsx — Takım dropdown opts\.takimlar\'ı okuyor', 'src/features/monitoring/MonitoringPage.tsx', /opts\?\.takimlar\.map\(\(t\) =>/);
check('MonitoringPage.tsx — CHIP_LABEL.takim eklendi (aktif filtre çipi + temizle otomatik çalışır)', 'src/features/monitoring/MonitoringPage.tsx', /takim: 'Takım'/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
