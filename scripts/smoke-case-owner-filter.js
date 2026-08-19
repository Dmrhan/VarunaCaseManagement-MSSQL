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

function check(label, filePath, predicate) {
  const content = readFileSync(path.resolve(root, filePath), 'utf8');
  const ok = predicate instanceof RegExp ? predicate.test(content) : predicate(content);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

check('lookups.js — /case-creators endpoint tanımlı', 'server/routes/lookups.js', /router\.get\('\/case-creators'/);
check('lookups.js — boş allowedCompanyIds → boş liste (sızıntı yok, WR-A7b P1 pattern)', 'server/routes/lookups.js', /if \(!allowed\.length\) return res\.json\(\[\]\);/);
// 2026-08-19 review fix — Prisma SQL Server'da findMany({distinct}) gerçek
// bir SQL DISTINCT üretmiyor (in-memory post-processing, take sınırı yok);
// groupBy ise gerçekten GROUP BY'a çevriliyor (doğrulandı: sorgu logunda).
check('lookups.js — SQL seviyesinde gerçek tekilleştirme (groupBy, findMany+distinct DEĞİL)', 'server/routes/lookups.js', /prisma\.case\.groupBy\(\{\s*\n\s*by: \['createdByUserId'\],/);
check('lookups.js — eski findMany+distinct deseni kalmamış', 'server/routes/lookups.js', (content) => !/distinct: \['createdByUserId'\]/.test(content));
check('schema.prisma — desteleyici index (companyId, createdByUserId) eklendi', 'prisma/schema.prisma', /@@index\(\[companyId, createdByUserId\]\)/);
check('migration — index oluşturma dosyası mevcut', 'prisma/migrations/20260819c_case_created_by_index/migration.sql', /CREATE NONCLUSTERED INDEX \[Case_companyId_createdByUserId_idx\]/);
check('cases.js — createdByUserId query param filters\'a geçiyor', 'server/routes/cases.js', /createdByUserId: typeof f\.createdByUserId === 'string' \? f\.createdByUserId : undefined,/);
check('caseRepository.js — createdByUserId where clause\'a uygulanıyor (personId ile aynı yerde)', 'server/db/caseRepository.js', /if \(f\.personId\) where\.assignedPersonId = f\.personId;\s*\n[\s\S]{0,200}if \(f\.createdByUserId\) where\.createdByUserId = f\.createdByUserId;/);
check('types.ts — CaseFilters.createdByUserId eklendi', 'src/features/cases/types.ts', /createdByUserId\?: string;/);
check('caseService.ts — lookupService.caseCreators() eklendi', 'src/services/caseService.ts', /async caseCreators\(\): Promise<\{ id: string; name: string \}\[\]> \{/);
check('caseService.ts — list() createdByUserId query param olarak gönderiyor', 'src/services/caseService.ts', /params\.set\('createdByUserId', filters\.createdByUserId\)/);
check('CasesListPage.tsx — Vaka Sahibi bölümü Kişi ile Tarih arasında render ediliyor', 'src/features/cases/CasesListPage.tsx', /<FilterPanelSection label="Vaka Sahibi">[\s\S]{0,900}<FilterPanelSection label="Tarih">/);
check('CasesListPage.tsx — Vaka Sahibi seçimi filters.createdByUserId\'a yazıyor', 'src/features/cases/CasesListPage.tsx', /setFilters\(\(f\) => \(\{ \.\.\.f, createdByUserId: e\.target\.value \|\| undefined \}\)\)/);
check('CasesListPage.tsx — aktif filtre sayacı createdByUserId\'ı kapsıyor', 'src/features/cases/CasesListPage.tsx', /\(filters\.createdByUserId \? 1 : 0\)/);
check('CasesListPage.tsx — initialFilters reset createdByUserId\'ı sıfırlıyor', 'src/features/cases/CasesListPage.tsx', /personId: '',\s*\n\s*createdByUserId: '',/);
// 2026-08-19 review fix — filters.createdByUserId liste-yükleme effect'inin
// dependency listesinde YOKTU: seçim state'i güncelliyordu (çip/sayaç
// görünüyordu) ama gerçek fetch hiç tetiklenmiyordu, başka bir filtre/
// sayfa/sıralama değişene kadar eski sonuçlar ekranda kalıyordu.
check('CasesListPage.tsx — filters.createdByUserId liste-yükleme effect\'inin dependency\'sinde', 'src/features/cases/CasesListPage.tsx', /filters\.personId,\s*\n\s*filters\.createdByUserId,\s*\n\s*filters\.dateFrom,/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
