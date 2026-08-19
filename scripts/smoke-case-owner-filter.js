/**
 * Vakalar listesi — "Vaka Sahibi" filtresi (Tarih bölmesinin üstündeki
 * boş alan; Kişi filtresinden AYRI kavram: Case.createdByUserId, vakayı
 * açan kullanıcı, atamadan bağımsız).
 *
 * Statik smoke: DB'ye dokunmaz, kaynak kodda beklenen desenlerin varlığını
 * kontrol eder.
 *
 * Çalıştır: node scripts/smoke-case-owner-filter.js
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

check('lookups.js — /case-creators endpoint tanımlı', 'server/routes/lookups.js', /router\.get\('\/case-creators'/);
check('lookups.js — boş allowedCompanyIds → boş liste (sızıntı yok, WR-A7b P1 pattern)', 'server/routes/lookups.js', /if \(!allowed\.length\) return res\.json\(\[\]\);/);
check('lookups.js — distinct createdByUserId sorgusu', 'server/routes/lookups.js', /distinct: \['createdByUserId'\]/);
check('cases.js — createdByUserId query param filters\'a geçiyor', 'server/routes/cases.js', /createdByUserId: typeof f\.createdByUserId === 'string' \? f\.createdByUserId : undefined,/);
check('caseRepository.js — createdByUserId where clause\'a uygulanıyor (personId ile aynı yerde)', 'server/db/caseRepository.js', /if \(f\.personId\) where\.assignedPersonId = f\.personId;\s*\n[\s\S]{0,200}if \(f\.createdByUserId\) where\.createdByUserId = f\.createdByUserId;/);
check('types.ts — CaseFilters.createdByUserId eklendi', 'src/features/cases/types.ts', /createdByUserId\?: string;/);
check('caseService.ts — lookupService.caseCreators() eklendi', 'src/services/caseService.ts', /async caseCreators\(\): Promise<\{ id: string; name: string \}\[\]> \{/);
check('caseService.ts — list() createdByUserId query param olarak gönderiyor', 'src/services/caseService.ts', /params\.set\('createdByUserId', filters\.createdByUserId\)/);
check('CasesListPage.tsx — Vaka Sahibi bölümü Kişi ile Tarih arasında render ediliyor', 'src/features/cases/CasesListPage.tsx', /<FilterPanelSection label="Vaka Sahibi">[\s\S]{0,900}<FilterPanelSection label="Tarih">/);
check('CasesListPage.tsx — Vaka Sahibi seçimi filters.createdByUserId\'a yazıyor', 'src/features/cases/CasesListPage.tsx', /setFilters\(\(f\) => \(\{ \.\.\.f, createdByUserId: e\.target\.value \|\| undefined \}\)\)/);
check('CasesListPage.tsx — aktif filtre sayacı createdByUserId\'ı kapsıyor', 'src/features/cases/CasesListPage.tsx', /\(filters\.createdByUserId \? 1 : 0\)/);
check('CasesListPage.tsx — initialFilters reset createdByUserId\'ı sıfırlıyor', 'src/features/cases/CasesListPage.tsx', /personId: '',\s*\n\s*createdByUserId: '',/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
