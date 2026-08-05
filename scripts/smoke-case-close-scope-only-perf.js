/**
 * smoke-case-close-scope-only-perf.js — statik guard.
 *
 * Bug: "İptal Et" / "Çözüldü" (close aksiyonu) transition'ında route
 * assertCaseResourcePolicy + assertCaseCloseRequiredFields ARKA ARKAYA
 * çalışıyor, ikisi de eskiden caseRepository.get() (notes/attachments/
 * history/callLogs dahil TAM CASE_INCLUDE) çağırıyordu — aynı vaka aynı
 * istekte 2 kez ağır şekilde çekiliyordu (ölçüm: hafif bir vakada bile
 * ~556ms sadece bu tekrar için). Bu iki fonksiyon döndürülen case'ten
 * yalnız companyId okuyor, o yüzden tam include hiç gerekmiyor.
 *
 * Fix: caseRepository.getScopeOnly() — get() ile AYNI kapsam/erişim
 * kontrolü (allowedCompanyIds + isArchived guard) ama yalnız
 * {id, companyId, isArchived} select ile. Ölçüm: aynı vakada ~49ms
 * (11x hızlanma).
 *
 * Çalıştır: node scripts/smoke-case-close-scope-only-perf.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function check(label, pattern, src) {
  const ok = pattern.test(src);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

const repo = readFileSync(path.resolve(root, 'server/db/caseRepository.js'), 'utf8');
const routes = readFileSync(path.resolve(root, 'server/routes/cases.js'), 'utf8');

check(
  'caseRepository.getScopeOnly tanımlı',
  /async getScopeOnly\(id, allowedCompanyIds, actorRole\) \{/,
  repo,
);
check(
  'getScopeOnly — get() ile AYNI scope guard (allowedCompanyIds)',
  /getScopeOnly\(id, allowedCompanyIds, actorRole\) \{[\s\S]{0,200}allowedCompanyIds && !allowedCompanyIds\.includes\(c\.companyId\)/,
  repo,
);
check(
  'getScopeOnly — get() ile AYNI arşiv guard (isArchived + SystemAdmin)',
  /getScopeOnly\(id, allowedCompanyIds, actorRole\) \{[\s\S]{0,400}isArchived && actorRole !== 'SystemAdmin'/,
  repo,
);
check(
  'getScopeOnly — yalnız id/companyId/isArchived select edilir (tam include YOK)',
  /getScopeOnly\(id, allowedCompanyIds, actorRole\) \{[\s\S]{0,150}select: \{ id: true, companyId: true, isArchived: true \}/,
  repo,
);

check(
  'assertCaseResourcePolicy artık getScopeOnly kullanıyor (get() DEĞİL)',
  /const c = await caseRepository\.getScopeOnly\(req\.params\.id, req\.user\.allowedCompanyIds, req\.user\.role\);\s*\n\s*if \(!c\) \{\s*\n\s*throw new AuthorizationRuntimeError\('Vaka bulunamadı\.', 404, 'case_not_found'\);\s*\n\s*\}\s*\n\s*await assertCaseSecurityFilterAccess/,
  routes,
);
check(
  'assertCaseCloseRequiredFields artık getScopeOnly kullanıyor (get() DEĞİL)',
  /const fields = closeFieldCandidatesFor\(nextStatus\);\s*\n\s*if \(fields\.length === 0\) return null;[\s\S]{0,150}caseRepository\.getScopeOnly\(req\.params\.id, req\.user\.allowedCompanyIds, req\.user\.role\)/,
  routes,
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
