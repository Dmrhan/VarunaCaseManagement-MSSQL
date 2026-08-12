/**
 * SLA İzleme — Proje filtresi + kolonu. Statik smoke: DB'ye dokunmaz,
 * kaynak kodda beklenen desenlerin varlığını kontrol eder.
 *
 * Çalıştır: node scripts/smoke-sla-dashboard-project-filter-static.js
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

// Proje filtresi ADI bazlı (ID değil) — aynı proje adı birden çok bayide
// (farklı AccountProject kaydı) tekrarlanabildiği için, filtrede tek satır
// olarak listelenmesi gerekiyor (kullanıcı geri bildirimi). Bu yüzden
// dedup key ID değil accountProjectName.
// P2 fix — canlı AccountProject.name ilişkisi DEĞİL, Case'in kendi
// denormalize accountProjectName kolonu kullanılmalı; bootstrap dropdown
// (optionsOnly dalı) da aynı kolonu groupBy ediyor. Proje sonradan yeniden
// adlandırılırsa canlı isim eski snapshot'la eşleşmez, filtre 0 satır
// dönerdi — ikisi AYNI kaynaktan (Case.accountProjectName) beslenmeli.
check('slaDashboard.js — accountProjectName scalar select (canlı join YOK)', 'server/analytics/slaDashboard.js', /accountProjectName: true,/);
check('slaDashboard.js — row çıktısında Case snapshot kullanılıyor', 'server/analytics/slaDashboard.js', /accountProjectName: c\.accountProjectName \?\? null,/);
{
  const src = readFileSync(path.resolve(root, 'server/analytics/slaDashboard.js'), 'utf8');
  const ok = !/accountProject:\s*\{\s*select/.test(src) && !/c\.accountProject\?\.name/.test(src);
  console.log(`${ok ? '✔' : '✘'} slaDashboard.js — canlı accountProject join KALDIRILDI`);
  if (ok) pass += 1; else fail += 1;
}
check('slaDashboard.js — sel.accountProjectName', 'server/analytics/slaDashboard.js', /accountProjectName: new Set\(toList\(params\.accountProjectName\)\)/);
check('slaDashboard.js — FACETS accountProjectName', 'server/analytics/slaDashboard.js', /\['accountProjectName', \(r\) => r\.accountProjectName\]/);
check('slaDashboard.js — options.projects', 'server/analytics/slaDashboard.js', /accounts,\s*\n\s*projects,/);
check('slaDashboard.js — projects ADI bazlı dedup (id yok)', 'server/analytics/slaDashboard.js', /\.map\(\(\[name\]\) => name\)/);
check('slaDashboard.js — optionsOnly topProjects ADI bazlı groupBy', 'server/analytics/slaDashboard.js', /by: \['accountProjectName'\]/);
check('slaDashboard.js — emptyResult projects: []', 'server/analytics/slaDashboard.js', /projects: \[\], requestTypes/);

check('analytics.js route — accountProjectName pass-through', 'server/routes/analytics.js', /accountProjectName: q\.accountProjectName \?\? null,/);

check('analyticsService.ts — SlaDashboardFilters.accountProjectName', 'src/services/analyticsService.ts', /accountProjectName\?: string\[\];/);
check('analyticsService.ts — SlaDashboardRow.accountProjectName (id YOK)', 'src/services/analyticsService.ts', /accountProjectName: string \| null;/);
check('analyticsService.ts — options.projects string\\[\\] (id YOK)', 'src/services/analyticsService.ts', /projects: string\[\];/);

check('CsSlaDashboardPage.tsx — Proje filterDef (accountProjectName)', 'src/features/analytics/CsSlaDashboardPage.tsx', /key: 'accountProjectName',\s*\n\s*label: 'Proje',/);
check('CsSlaDashboardPage.tsx — Müşteri label düzeltildi', 'src/features/analytics/CsSlaDashboardPage.tsx', /label: 'Müşteri',/);
check('CsSlaDashboardPage.tsx — proje seçenekleri v=name l=name (id yok)', 'src/features/analytics/CsSlaDashboardPage.tsx', /options: \(options\?\.projects \?\? \[\]\)\.map\(\(name\) => \(\{ v: name, l: name \}\)\),/);
check('CsSlaDashboardPage.tsx — thead Proje kolonu', 'src/features/analytics/CsSlaDashboardPage.tsx', /<th className="px-2\.5 py-2">Proje<\/th>/);
check('CsSlaDashboardPage.tsx — tbody Proje hücresi', 'src/features/analytics/CsSlaDashboardPage.tsx', /\{r\.accountProjectName \?\? '—'\}/);
check('CsSlaDashboardPage.tsx — Excel export Proje kolonu', 'src/features/analytics/CsSlaDashboardPage.tsx', /'Proje': r\.accountProjectName \?\? '',/);
check('CsSlaDashboardPage.tsx — normalizeF accountProjectName dahil', 'src/features/analytics/CsSlaDashboardPage.tsx', /p: \[\.\.\.\(f\.accountProjectName \?\? \[\]\)\]\.sort\(\),/);
check('CsSlaDashboardPage.tsx — activeFilterCount accountProjectName dahil', 'src/features/analytics/CsSlaDashboardPage.tsx', /draft\.accountProjectName\?\.length \?\? 0/);
check('CsSlaDashboardPage.tsx — appliedChips Proje chip (doğrudan join, id resolve YOK)', 'src/features/analytics/CsSlaDashboardPage.tsx', /chips\.push\(`Proje: \$\{applied\.accountProjectName\.join\(', '\)\}`\);/);
{
  const pageSrc = readFileSync(path.resolve(root, 'src/features/analytics/CsSlaDashboardPage.tsx'), 'utf8');
  const ok = !/accountProjectId/.test(pageSrc);
  console.log(`${ok ? '✔' : '✘'} CsSlaDashboardPage.tsx — accountProjectId artık kullanılmıyor (ADI bazlı geçiş tam)`);
  if (ok) pass += 1; else fail += 1;
}

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
