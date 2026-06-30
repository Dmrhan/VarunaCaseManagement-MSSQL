/**
 * smoke-customer-role-ana-firma-pr3-cross-tenant.js
 *
 * CR ZORUNLU DAVRANIŞ TESTİ:
 *   "PR-3 cross-tenant guard'ı için GERÇEK denial smoke: başka tenant'ın
 *    'Merkez Müşteri' account'u ne dropdown'da ne endpoint'te ASLA
 *    gözükmesin (regex değil, davranış testi)."
 *
 * Strateji:
 *   listCentralAccounts içindeki SCOPE KARARI ayrı pure helper'a
 *   (decideCentralListScope) çıkarıldı. Bu helper'ı runtime'da farklı
 *   user/companyId senaryolarıyla çağırıp dönüş değerini KANITLA.
 *   Prisma çağrısı bu helper'dan SONRA; helper deny=true verirse Prisma
 *   asla query atılmaz (CROSS-TENANT veriyi DB'den bile çekmez).
 *
 * Senaryo matrisi:
 *   1. Agent COMP_A → targetCompanyId=COMP_B → DENY (cross-tenant)
 *   2. Agent COMP_A → targetCompanyId=COMP_A → OK ([COMP_A] filter)
 *   3. SystemAdmin → targetCompanyId=COMP_B → OK (kısıt yok)
 *   4. SystemAdmin → targetCompanyId yok → OK (tüm şirketler, filtre yok)
 *   5. CSM COMP_A,COMP_B → targetCompanyId yok → OK ([COMP_A, COMP_B] filter)
 *   6. Boş allowed user → targetCompanyId yok → DENY
 *   7. Agent yetkisiz role + boş allowed → DENY
 *   8. CSM çoklu tenant + targetCompanyId allowed dışı → DENY
 *
 * Repository ve endpoint'in BU helper'a tam uyduğu ayrıca regex ile teyit.
 *
 * KAPSAM DIŞI:
 *   Gerçek HTTP roundtrip (DB lazım; lokal offline). Yukarıdaki davranış
 *   testleri scope kararını gerçek runtime'da çalıştırıyor; Prisma layer
 *   sadece "if deny return []" ile yutuyor; cross-tenant veriyi DB'ye
 *   sızdırma olasılığı YOK.
 */

import { readFileSync } from 'node:fs';
import { decideCentralListScope } from '../server/db/accountRepository.js';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}\n    actual=${JSON.stringify(actual)}\n    expected=${JSON.stringify(expected)}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

// ─── 1) Cross-tenant DENY davranışı (KRİTİK) ──────────────────────
console.log('── 1) Cross-tenant DENY (CR zorunlu davranış testi) ──');

expect('1.1 Agent COMP_A → targetCompanyId=COMP_B (BAŞKA TENANT) → DENY',
  decideCentralListScope({
    user: { role: 'Agent', allowedCompanyIds: ['COMP_A'] },
    targetCompanyId: 'COMP_B',
  }),
  { deny: true });

expect('1.2 CSM çoklu tenant [COMP_A,COMP_B] → COMP_C (yetkisiz) → DENY',
  decideCentralListScope({
    user: { role: 'CSM', allowedCompanyIds: ['COMP_A', 'COMP_B'] },
    targetCompanyId: 'COMP_C',
  }),
  { deny: true });

expect('1.3 Supervisor [COMP_A] → boş targetCompanyId, allowed boş user → DENY',
  decideCentralListScope({
    user: { role: 'Supervisor', allowedCompanyIds: [] },
    targetCompanyId: null,
  }),
  { deny: true });

expect('1.4 User undefined → DENY (defansif)',
  decideCentralListScope({ user: undefined, targetCompanyId: null }),
  { deny: true });

expect('1.5 allowedCompanyIds undefined → DENY',
  decideCentralListScope({
    user: { role: 'Agent' },
    targetCompanyId: 'COMP_A',
  }),
  { deny: true });

// ─── 2) ALLOW davranışı (user scope içi) ──────────────────────────
console.log('\n── 2) ALLOW (user scope içi) ─────────────────────');

expect('2.1 Agent COMP_A → targetCompanyId=COMP_A (KENDİ TENANT\'I) → OK',
  decideCentralListScope({
    user: { role: 'Agent', allowedCompanyIds: ['COMP_A'] },
    targetCompanyId: 'COMP_A',
  }),
  { deny: false, companyIdsToConsider: ['COMP_A'] });

expect('2.2 CSM çoklu tenant → targetCompanyId yok → tüm allowed',
  decideCentralListScope({
    user: { role: 'CSM', allowedCompanyIds: ['COMP_A', 'COMP_B'] },
    targetCompanyId: null,
  }),
  { deny: false, companyIdsToConsider: ['COMP_A', 'COMP_B'] });

expect('2.3 Admin tek tenant + targetCompanyId allowed → tek tenant',
  decideCentralListScope({
    user: { role: 'Admin', allowedCompanyIds: ['COMP_A'] },
    targetCompanyId: 'COMP_A',
  }),
  { deny: false, companyIdsToConsider: ['COMP_A'] });

// ─── 3) SystemAdmin — kısıtsız (tüm tenant'lar) ───────────────────
console.log('\n── 3) SystemAdmin — kısıtsız ─────────────────────');

expect('3.1 SystemAdmin → targetCompanyId yok → companyIdsToConsider=null (tüm şirketler)',
  decideCentralListScope({
    user: { role: 'SystemAdmin', allowedCompanyIds: ['COMP_A'] },
    targetCompanyId: null,
  }),
  { deny: false, companyIdsToConsider: null });

expect('3.2 SystemAdmin → targetCompanyId BAŞKA tenant → o tenant filter (yetki var)',
  decideCentralListScope({
    user: { role: 'SystemAdmin', allowedCompanyIds: [] },
    targetCompanyId: 'COMP_Z',
  }),
  { deny: false, companyIdsToConsider: ['COMP_Z'] });

// ─── 4) Repository ve endpoint helper'a TAM uyumlu mu? ────────────
const repoCode = strip(read('server/db/accountRepository.js'));
const routesCode = strip(read('server/routes/accounts.js'));

console.log('\n── 4) listCentralAccounts helper kullanımı ────────');
expect('4.1 listCentralAccounts decideCentralListScope\'a çağırır',
  /async function listCentralAccounts[\s\S]{0,800}decideCentralListScope\(\{ user, targetCompanyId \}\)/.test(repoCode), true);
expect('4.2 deny=true erken return ([] döner; Prisma SORGUSU YAPILMAZ)',
  /listCentralAccounts[\s\S]{0,1000}decision\.deny\) return \[\]/.test(repoCode), true);
expect('4.3 Prisma where.companies.some companyIdsToConsider ile',
  /listCentralAccounts[\s\S]{0,1500}where\.companies = \{[\s\S]{0,200}some: \{ companyId: \{ in: decision\.companyIdsToConsider \} \}/.test(repoCode), true);
expect('4.4 customerRole=Central + isActive filter',
  /listCentralAccounts[\s\S]{0,1500}customerRole: 'Central'[\s\S]{0,100}isActive: true/.test(repoCode), true);

// ─── 5) Endpoint GET /central ─────────────────────────────────────
console.log('\n── 5) Endpoint GET /api/accounts/central ─────────');
expect('5.1 Route /central mount (DETAIL_READ_ROLES)',
  /router\.get\(\s*'\/central',\s*requireRole\(\.\.\.DETAIL_READ_ROLES\)/.test(routesCode), true);
expect('5.2 /central route /:id\'den ÖNCE mount (sıralama kritik)',
  routesCode.indexOf(`router.get(
  '/central'`) < routesCode.indexOf(`router.get(
  '/:id'`), true);
expect('5.3 Defense-in-depth: filterAllowedCompanyIdsByResourcePolicy targetCompanyId için',
  /\/central[\s\S]{0,1500}targetCompanyId[\s\S]{0,500}filterAllowedCompanyIdsByResourcePolicy/.test(routesCode), true);
expect('5.4 Cross-tenant fail → boş items (sessiz)',
  /\/central[\s\S]{0,1500}!scoped\.includes\(targetCompanyId\)[\s\S]{0,200}res\.json\(\{ items: \[\] \}\)/.test(routesCode), true);
expect('5.5 accountRepository.listCentralAccounts çağrısı',
  /\/central[\s\S]{0,2000}accountRepository\.listCentralAccounts\(\{[\s\S]{0,200}user: req\.user,[\s\S]{0,200}targetCompanyId/.test(routesCode), true);

// ─── 6) AccountProjectEditor UI entegrasyonu ─────────────────────
const editorCode = read('src/features/accounts/AccountProjectEditor.tsx');
console.log('\n── 6) AccountProjectEditor — Ana Firma dropdown ──');
expect('6.1 accountService.listCentral çağrısı (selectedCompany.companyId ile)',
  /accountService\.listCentral\(selectedCompany\.companyId\)/.test(editorCode), true);
expect('6.2 anaFirmaAccountId state',
  /const \[anaFirmaAccountId, setAnaFirmaAccountId\] = useState<string>/.test(editorCode), true);
expect('6.3 Dropdown disabled (centralLoading veya company yok)',
  /disabled=\{!selectedCompany \|\| centralLoading\}/.test(editorCode), true);
expect('6.4 Empty state — "Merkez Müşteri rolünde account yok"',
  /Bu şirkette "Merkez Müşteri" rolünde account yok/.test(editorCode), true);
expect('6.5 Submit body\'sinde anaFirmaAccountId',
  /anaFirmaAccountId: anaFirmaAccountId \|\| null/.test(editorCode), true);

// ─── 7) accountService.listCentral ─────────────────────────────
const svcCode = read('src/services/accountService.ts');
console.log('\n── 7) Frontend service listCentral ───────────────');
expect('7.1 listCentral method export\'lu',
  /async listCentral\(companyId: string \| null = null\)/.test(svcCode), true);
expect('7.2 GET /api/accounts/central?companyId=...',
  /\/api\/accounts\/central\$\{qs\}/.test(svcCode), true);
expect('7.3 CentralAccountRow type',
  /export interface CentralAccountRow \{/.test(svcCode), true);
expect('7.4 AccountProjectMutationInput.anaFirmaAccountId',
  /AccountProjectMutationInput[\s\S]{0,300}anaFirmaAccountId\?: string \| null/.test(svcCode), true);
expect('7.5 AccountProjectSummary.anaFirmaAccountId + anaFirmaName',
  /AccountProjectSummary[\s\S]{0,400}anaFirmaAccountId\?: string \| null[\s\S]{0,200}anaFirmaName\?: string \| null/.test(svcCode), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
