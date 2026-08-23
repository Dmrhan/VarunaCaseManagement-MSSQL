/**
 * Vaka Etiket Doğrulama ekranına "Vaka No" arama alanı eklendi.
 *
 * Mimari kararı: caseRepository.js'in buildWhere() fonksiyonunda zaten bir
 * `f.search` filtresi var ama title/caseNumber/accountName üçünde birden
 * arıyor — bu ekran için istenen SADECE Vaka No. Paylaşılan f.search'ü
 * genişletmek CasesListPage gibi diğer ekranlarda istenmeyen başlık/müşteri
 * eşleşmeleri getirirdi. Bu yüzden yeni, ayrı ve additive bir filtre
 * (`caseNumberSearch`) eklendi — resolvedDateFrom/resolvedDateTo ile aynı
 * prensip (2026-08-19 fix).
 *
 * Statik + fonksiyonel karma smoke: wiring statik regex ile, filtre mantığı
 * gerçek DB'ye karşı çalıştırılarak doğrulanır (mevcut f.search'ün
 * DEĞİŞMEDİĞİ de ayrıca doğrulanır — regresyon guard'ı).
 *
 * Çalıştır: node scripts/smoke-tagging-review-case-number-search.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function check(label, ok) {
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}
function checkSrc(label, filePath, predicate) {
  const content = readFileSync(path.resolve(root, filePath), 'utf8');
  const ok = predicate instanceof RegExp ? predicate.test(content) : predicate(content);
  check(label, ok);
}

// ── Statik — wiring ──
checkSrc('caseRepository.js — caseNumberSearch filtresi, f.search bloğundan AYRI', 'server/db/caseRepository.js',
  (content) => content.includes('if (f.caseNumberSearch) {')
    && content.includes('{ caseNumber: { contains: q } }'));
checkSrc('caseRepository.js — mevcut f.search bloğu (title/caseNumber/accountName) hâlâ orada, değişmemiş', 'server/db/caseRepository.js',
  /const orClauses = \[\s*\n\s*\{ title: \{ contains: q \} \},\s*\n\s*\{ caseNumber: \{ contains: q \} \},\s*\n\s*\{ accountName: \{ contains: q \} \},/);
checkSrc('cases.js — /tagging-review route\'u search\'ü caseNumberSearch\'e map\'liyor', 'server/routes/cases.js',
  (content) => {
    const start = content.indexOf("'/tagging-review',");
    const body = content.slice(start, start + 700);
    return /caseNumberSearch: f\.search \|\| undefined,/.test(body);
  });
checkSrc('cases.js — /tagging-review/export route\'u da search\'ü caseNumberSearch\'e map\'liyor', 'server/routes/cases.js',
  (content) => {
    const start = content.indexOf("'/tagging-review/export',");
    const body = content.slice(start, start + 900);
    return /caseNumberSearch: f\.search \|\| undefined,/.test(body);
  });
checkSrc('caseService.ts — listTaggingReviews/exportTaggingReviews search parametresi', 'src/services/caseService.ts',
  (content) => (content.match(/teamId\?: string; search\?: string \}/g) || []).length === 2);
checkSrc('CaseTaggingReviewPage.tsx — search state + "Vaka No" filtre alanı eklendi', 'src/features/analytics/CaseTaggingReviewPage.tsx',
  (content) => content.includes("const [search, setSearch]     = useState(() => loadSavedFilters()?.search ?? '');")
    && content.includes('<Field label="Vaka No" className="w-40">'));
checkSrc('CaseTaggingReviewPage.tsx — FILTER_KEY v4\'e bumplandı', 'src/features/analytics/CaseTaggingReviewPage.tsx',
  /varuna:tagging-review-filters-v4/);

// ── Fonksiyonel — gerçek DB'ye karşı ──
{
  const url = process.env.DATABASE_URL;
  if (url) {
    const prisma = new PrismaClient();
    try {
      const { caseRepository } = await import('../server/db/caseRepository.js');

      const sample = await prisma.case.findFirst({ where: { companyId: 'COMP-UNIVERA' }, select: { caseNumber: true } });
      if (sample) {
        const full = await caseRepository.list({
          filters: { caseNumberSearch: sample.caseNumber },
          pagination: { page: 1, pageSize: 10 },
          allowedCompanyIds: ['COMP-UNIVERA'],
        });
        check(`Tam Vaka No (${sample.caseNumber}) ile arama doğru sonucu buluyor`,
          full.items.some((c) => c.caseNumber === sample.caseNumber));

        const partial = sample.caseNumber.slice(-5);
        const partialRes = await caseRepository.list({
          filters: { caseNumberSearch: partial },
          pagination: { page: 1, pageSize: 20 },
          allowedCompanyIds: ['COMP-UNIVERA'],
        });
        check(`Kısmi Vaka No ("${partial}") ile arama hedef vakayı buluyor`,
          partialRes.items.some((c) => c.caseNumber === sample.caseNumber));
      } else {
        console.log('⚠ COMP-UNIVERA\'da örnek vaka bulunamadı — fonksiyonel kontroller atlandı.');
      }

      // Regresyon guard — mevcut f.search (title/accountName/caseNumber) davranışı DEĞİŞMEDİ.
      const existingSearch = await caseRepository.list({
        filters: { search: 'Efes' },
        pagination: { page: 1, pageSize: 5 },
        allowedCompanyIds: ['COMP-UNIVERA'],
      });
      check('Mevcut f.search (CasesListPage yolu) hâlâ çalışıyor, regresyon yok',
        existingSearch.total > 0 && existingSearch.items.every((c) => /efes/i.test(c.accountName ?? '') || /efes/i.test(c.title ?? '') || /efes/i.test(c.caseNumber ?? '')));
    } finally {
      await prisma.$disconnect();
    }
  } else {
    console.log('⚠ DATABASE_URL yok — gerçek veri kontrolleri atlandı.');
  }
}

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
