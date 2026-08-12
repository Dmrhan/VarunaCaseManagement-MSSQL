/**
 * SLA İzleme — Açılış Tarihi aralığı + kolonu. Statik smoke: DB'ye
 * dokunmaz, kaynak kodda beklenen desenlerin varlığını kontrol eder.
 *
 * Çalıştır: node scripts/smoke-sla-dashboard-created-range-static.js
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
  if (ok) pass += 1;
  else fail += 1;
}

check('slaDashboardDateRange.js — saf fonksiyon export', 'server/lib/slaDashboardDateRange.js', /export function resolveSlaDashboardCreatedRange/);
check('slaDashboard.js — resolver import', 'server/analytics/slaDashboard.js', /import \{ resolveSlaDashboardCreatedRange \} from '\.\.\/lib\/slaDashboardDateRange\.js'/);
check('slaDashboard.js — where.createdAt resolver kullanıyor', 'server/analytics/slaDashboard.js', /if \(createdRange\) where\.createdAt = createdRange;/);
check('slaDashboard.js — row çıktısında createdAt', 'server/analytics/slaDashboard.js', /createdAt: c\.createdAt\.toISOString\(\)/);

check('analytics.js route — createdFrom/createdTo pass-through', 'server/routes/analytics.js', /createdFrom: q\.createdFrom,\s*\n\s*createdTo: q\.createdTo,/);

check('analyticsService.ts — SlaDashboardFilters.createdFrom/createdTo', 'src/services/analyticsService.ts', /createdFrom\?: string \| null;\s*\n\s*createdTo\?: string \| null;/);
check('analyticsService.ts — SlaDashboardRow.createdAt', 'src/services/analyticsService.ts', /createdAt: string;/);

check('CsSlaDashboardPage.tsx — DateRangeFilter bileşeni', 'src/features/analytics/CsSlaDashboardPage.tsx', /function DateRangeFilter/);
check('CsSlaDashboardPage.tsx — filtre gridine yerleşim', 'src/features/analytics/CsSlaDashboardPage.tsx', /<DateRangeFilter/);
check('CsSlaDashboardPage.tsx — Yıl seçilince aralık temizleniyor', 'src/features/analytics/CsSlaDashboardPage.tsx', /createdFrom: null,\s*\n\s*createdTo: null,/);
check('CsSlaDashboardPage.tsx — aralık seçilince Yıl/Ay temizleniyor', 'src/features/analytics/CsSlaDashboardPage.tsx', /set\(\{ \.\.\.patch, year: null, month: null \}\)/);
check('CsSlaDashboardPage.tsx — normalizeF createdFrom/createdTo dahil', 'src/features/analytics/CsSlaDashboardPage.tsx', /cf: f\.createdFrom \?\? null, ct: f\.createdTo \?\? null,/);
check('CsSlaDashboardPage.tsx — activeFilterCount createdFrom/createdTo dahil', 'src/features/analytics/CsSlaDashboardPage.tsx', /draft\.createdFrom \|\| draft\.createdTo \? 1 : 0/);
check('CsSlaDashboardPage.tsx — appliedChips Açılış chip', 'src/features/analytics/CsSlaDashboardPage.tsx', /chips\.push\(`Açılış: /);
check('CsSlaDashboardPage.tsx — thead Açılış Tarihi kolonu', 'src/features/analytics/CsSlaDashboardPage.tsx', /<th className="px-2\.5 py-2">Açılış Tarihi<\/th>/);
// P2 fix — createdAt görüntülemesi artık timeZone: 'Europe/Istanbul' ile
// sabitlenmiş fmtOpeningDate() helper'ından geçiyor (tarayıcı yerel saat
// dilimi kaymasını önlemek için); eski çıplak toLocaleDateString('tr-TR')
// deseni bilinçli olarak KALDIRILDI.
check('CsSlaDashboardPage.tsx — fmtOpeningDate TR timezone sabitlemesi', 'src/features/analytics/CsSlaDashboardPage.tsx', /toLocaleDateString\('tr-TR', \{ timeZone: 'Europe\/Istanbul' \}\)/);
check('CsSlaDashboardPage.tsx — tbody Açılış Tarihi hücresi', 'src/features/analytics/CsSlaDashboardPage.tsx', /\{fmtOpeningDate\(r\.createdAt\)\}/);
check('CsSlaDashboardPage.tsx — Excel export Açılış Tarihi kolonu', 'src/features/analytics/CsSlaDashboardPage.tsx', /'Açılış Tarihi': fmtOpeningDate\(r\.createdAt\),/);

// Self-updating: sabit sayı hardcode etmek yerine <th> sayısıyla kıyaslar —
// yeni kolon eklendikçe bu kontrol elle güncellenmeden doğru kalır.
{
  const pageSrc = readFileSync(path.resolve(root, 'src/features/analytics/CsSlaDashboardPage.tsx'), 'utf8');
  const theadMatch = pageSrc.match(/<thead>[\s\S]*?<\/thead>/);
  const thCount = theadMatch ? (theadMatch[0].match(/<th /g) ?? []).length : 0;
  const colSpanValues = [...pageSrc.matchAll(/colSpan=\{(\d+)\}/g)].map((m) => Number(m[1]));
  const ok = colSpanValues.length === 4 && colSpanValues.every((v) => v === thCount);
  console.log(`${ok ? '✔' : '✘'} CsSlaDashboardPage.tsx — 4 colSpan placeholder satırı, hepsi <th> sayısıyla (${thCount}) eşleşiyor`);
  if (ok) pass += 1; else fail += 1;
}

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
