/**
 * Vaka Etiket Doğrulama Ekranı — tarih filtresi Açılış Tarihi'nden
 * (Case.createdAt) Çözüm Tarihi'ne (Case.resolvedAt) geçirildi.
 *
 * Kullanıcı bulgusu: "Statü: Çözüldü + bugünün tarihi" seçince, bugün
 * gerçekten çözülmüş vakalar listede görünmüyordu — çünkü tarih filtresi
 * Açılış Tarihi'ne bakıyordu (vaka geçen hafta açılıp bugün çözülmüş
 * olabilir). Alan adları bilerek yeni: resolvedDateFrom/resolvedDateTo —
 * mevcut dateFrom/dateTo (createdAt, CasesListPage vb. diğer ekranlarda
 * hâlâ kullanılıyor) ile KARIŞMASIN diye.
 *
 * Gerçek veriyle doğrulandı — ekran görüntüsündeki birebir senaryo
 * (19.08.2026-19.08.2026, Statü=Çözüldü, Takım=Univera L2): eski mantık
 * 0 sonuç, yeni mantık 17 sonuç (hepsi geçen günlerde açılıp bugün
 * çözülmüş vakalar).
 *
 * Statik smoke: DB'ye dokunmaz, kaynak kodda beklenen desenlerin varlığını
 * kontrol eder.
 *
 * Çalıştır: node scripts/smoke-tagging-review-resolved-date.js
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

check(
  'caseRepository.js — resolvedDateFrom/To Case.resolvedAt\'e uygulanıyor (createdAt DEĞİL)',
  'server/db/caseRepository.js',
  /if \(f\.resolvedDateFrom\) where\.resolvedAt = \{ \.\.\.\(where\.resolvedAt \?\? \{\}\), gte: new Date\(f\.resolvedDateFrom\) \};/,
);
check(
  'caseRepository.js — mevcut dateFrom/dateTo (createdAt) davranışı korunuyor',
  'server/db/caseRepository.js',
  /if \(f\.dateFrom\) where\.createdAt = \{ \.\.\.\(where\.createdAt \?\? \{\}\), gte: new Date\(f\.dateFrom\) \};/,
);
check(
  'routes/cases.js — /tagging-review resolvedDateFrom/To kullanıyor (dateFrom/dateTo DEĞİL)',
  'server/routes/cases.js',
  (content) => {
    const listRoute = content.slice(content.indexOf("'/tagging-review',"), content.indexOf("'/tagging-review',") + 700);
    return /resolvedDateFrom: f\.resolvedDateFrom/.test(listRoute) && !/dateFrom: f\.dateFrom/.test(listRoute);
  },
);
check(
  'routes/cases.js — /tagging-review/export de resolvedDateFrom/To kullanıyor',
  'server/routes/cases.js',
  /resolvedDateFrom: f\.resolvedDateFrom,\s*\n\s*resolvedDateTo: f\.resolvedDateTo,\s*\n\s*teamId: f\.teamId \|\| undefined,\s*\n\s*\};\s*\n\s*const securityWhere = await buildCaseListSecurityWhere\(req\);\s*\n\s*const \{ items \} = await caseRepository\.list/,
);
check(
  'CaseTaggingReviewPage.tsx — state resolvedDateFrom/resolvedDateTo olarak yeniden adlandırıldı',
  'src/features/analytics/CaseTaggingReviewPage.tsx',
  /const \[resolvedDateFrom, setResolvedDateFrom\] = useState/,
);
check(
  'CaseTaggingReviewPage.tsx — arayüz etiketleri "Çözüm Başlangıç"/"Çözüm Bitiş"',
  'src/features/analytics/CaseTaggingReviewPage.tsx',
  /<Field label="Çözüm Başlangıç"[\s\S]{0,300}<Field label="Çözüm Bitiş"/,
);
check(
  'CaseTaggingReviewPage.tsx — localStorage FILTER_KEY v3\'e bumplandı',
  'src/features/analytics/CaseTaggingReviewPage.tsx',
  /varuna:tagging-review-filters-v3/,
);
check(
  'caseService.ts — listTaggingReviews/exportTaggingReviews resolvedDateFrom/To parametreleri',
  'src/services/caseService.ts',
  (content) => {
    const matches = content.match(/resolvedDateFrom\?: string; resolvedDateTo\?: string;/g);
    return Array.isArray(matches) && matches.length === 2;
  },
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
