/**
 * smoke-release-regression.js — Release-level regression orchestrator.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-release-regression.js
 *
 * Skopa: son birkaç günde inen değişikliklerin uçtan uca davranışını doğrula.
 * Tek bir smoke içinde 20 senaryo; her senaryo focused smoke'ları YERINE GEÇMEZ,
 * yalnız release-okay sinyali sağlar. Bu smoke fail ederse focused smoke'a düş.
 *
 * Senaryolar:
 *   1.  Normal müşterili vaka oluştur → 201
 *   2.  Customerless vaka (şirket izinli) → 201 + customerMatchPending=true
 *   3.  Customerless vaka (requireCustomerOnCaseCreate=true) → 400 customer_required
 *   4.  Requester context customerless'ta DB'ye yazıldı + privacy (analytics scope dışı)
 *   5.  AccountProject compatible create → 201 + project denorm
 *   6.  Product compatible (catalog) create → 201 + productName denorm
 *   7.  Package + product PackageItem üyesi → 201 (DI.3 happy path)
 *   8.  Package + product UYUMSUZ (PackageItem'da yok) → 400 package_product_mismatch
 *   9.  Customerless + packageId → 400 package_requires_account (DI.4)
 *   10. Case.packageId !== AccountCompany.packageId → 400 package_account_company_mismatch (DI.5)
 *   11. Cross-tenant product → 400 product_company_mismatch (DI.2)
 *   12. supportLevel cascade: Product.supportLevel → Case.supportLevel (D-A7BI.7)
 *   13. Transfer manuel: team-only (AI atlandı) → 200 + transferCount++
 *   14. Transfer cross-tenant team → 400 invalid_team
 *   15. Claim unassigned (PARAM agent) → 200 (varolan davranış)
 *   16. Lookup catalog scope guard: empty allowedCompanyIds → 403 (review fix)
 *   17. Lookup catalog cross-tenant → 403
 *   18. TCKN privacy — listAccounts response'unda raw TCKN/tcknHash YOK
 *   19. Customerless requester context — listAccounts response'unda görünmez
 *       (privacy: müşterisiz vakanın iletişim bilgileri Account'a sızmaz)
 *   20. Data contracts orchestrator: tüm contract group'ları PASS
 */

import { prisma } from '../server/db/client.js';
import { lookupRepository } from '../server/db/lookupRepository.js';
import { spawnSync } from 'node:child_process';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function getToken(email) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  const j = await r.json();
  return j.access_token || null;
}

async function api(token, path, init = {}) {
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers || {}),
  };
  const r = await fetch(`${BFF}${path}`, { ...init, headers });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

const STAMP = `RELREG${Date.now()}`;
const createdCaseIds = [];
let originalRequireCustomer = null;
let originalAcPackageId = null;
let uniAcId = null;

const adminToken = await getToken('admin@varuna.dev');
const agentToken = await getToken('agent@varuna.dev');
const supervisorToken = await getToken('supervisor@varuna.dev');

if (!adminToken || !supervisorToken) {
  console.log('SKIP — token yok');
  await prisma.$disconnect();
  process.exit(0);
}

const COMP_UNI = 'COMP-UNIVERA';
const COMP_PAR = 'COMP-PARAM';

// Setup
const uniAc = await prisma.accountCompany.findFirst({
  where: { companyId: COMP_UNI, status: 'active' },
  select: { id: true, accountId: true, packageId: true },
});
const uniPackage = await prisma.package.findUnique({
  where: { companyId_code: { companyId: COMP_UNI, code: 'WHITE_PKG' } },
  select: { id: true, name: true },
});
const uniRedPackage = await prisma.package.findUnique({
  where: { companyId_code: { companyId: COMP_UNI, code: 'RED_PKG' } },
  select: { id: true, name: true },
});
const uniProductInWhite = await prisma.product.findFirst({
  where: { companyId: COMP_UNI, code: 'ENROUTE', isActive: true },
  select: { id: true, name: true, supportLevel: true },
});
const uniProductNotInWhite = await prisma.product.findFirst({
  where: { companyId: COMP_UNI, code: 'STOKBAR', isActive: true },
  select: { id: true, name: true },
});
const parProduct = await prisma.product.findFirst({
  where: { companyId: COMP_PAR, isActive: true },
  select: { id: true },
});
const uniTeams = await prisma.team.findMany({
  where: { companyId: COMP_UNI, isActive: true },
  take: 3,
});
const parTeam = await prisma.team.findFirst({
  where: { companyId: COMP_PAR, isActive: true },
});

if (!uniAc || !uniPackage || !uniRedPackage || !uniProductInWhite || !uniProductNotInWhite || !parProduct || uniTeams.length < 2 || !parTeam) {
  console.log('SKIP — seed verisi eksik (UNIVERA package/product/team).');
  await prisma.$disconnect();
  process.exit(0);
}
uniAcId = uniAc.id;
originalAcPackageId = uniAc.packageId;

const uniSettings = await prisma.companySettings.findUnique({
  where: { companyId: COMP_UNI },
  select: { requireCustomerOnCaseCreate: true },
});
originalRequireCustomer = uniSettings?.requireCustomerOnCaseCreate ?? false;

// Garantiye al: AC.packageId = WHITE_PKG (test 7/8/10 için tutarlı baseline).
await prisma.accountCompany.update({
  where: { id: uniAcId },
  data: { packageId: uniPackage.id },
});

function baseCase(suffix, overrides = {}) {
  return {
    title: `${STAMP}-${suffix}`,
    description: `Release regression smoke vakası — ${suffix}`,
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Telefon',
    companyId: COMP_UNI,
    companyName: 'UNIVERA',
    accountId: uniAc.accountId,
    accountName: 'demo',
    category: 'Genel',
    subCategory: 'Diğer',
    requestType: 'Talep',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// 1) Normal customer case → 201
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(supervisorToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify(baseCase('T1')),
  });
  record('1. Normal customer case → 201', r.status === 201, `status=${r.status}`);
  if (r.data?.id) createdCaseIds.push(r.data.id);
}

// ─────────────────────────────────────────────────────────────────
// 2) Customerless allowed → 201 + customerMatchPending=true
// ─────────────────────────────────────────────────────────────────
await prisma.companySettings.upsert({
  where: { companyId: COMP_UNI },
  update: { requireCustomerOnCaseCreate: false },
  create: { companyId: COMP_UNI, requireCustomerOnCaseCreate: false },
});
{
  const r = await api(supervisorToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({ ...baseCase('T2'), accountId: undefined, accountName: undefined }),
  });
  const ok = r.status === 201 && r.data?.customerMatchPending === true;
  record('2. Customerless allowed → 201 + pending', ok,
    `status=${r.status} pending=${r.data?.customerMatchPending}`);
  if (r.data?.id) createdCaseIds.push(r.data.id);
}

// ─────────────────────────────────────────────────────────────────
// 3) Customerless forbidden by company setting → 400 customer_required
// ─────────────────────────────────────────────────────────────────
await prisma.companySettings.update({
  where: { companyId: COMP_UNI },
  data: { requireCustomerOnCaseCreate: true },
});
{
  const r = await api(supervisorToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({ ...baseCase('T3'), accountId: undefined, accountName: undefined }),
  });
  record('3. Strict require customer → 400 customer_required',
    r.status === 400 && r.data?.error === 'customer_required',
    `status=${r.status} code=${r.data?.error}`);
}
// Restore: false (customerless izinli) — kalan testlerin çoğu accountId ile gönderiyor.
await prisma.companySettings.update({
  where: { companyId: COMP_UNI },
  data: { requireCustomerOnCaseCreate: false },
});

// ─────────────────────────────────────────────────────────────────
// 4) Requester context persistence (customerless'ta yazılır)
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(supervisorToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({
      ...baseCase('T4'),
      accountId: undefined,
      accountName: undefined,
      customerContactName: 'Test Caller',
      customerContactPhone: '+90 555 555 0000',
      customerContactEmail: 'test@example.com',
      customerCompanyName: 'Test Co',
    }),
  });
  if (r.data?.id) createdCaseIds.push(r.data.id);
  // DB'den oku — privacy: BFF response'unda return ediliyor mu sadece analytics scope dışı.
  const dbCase = await prisma.case.findUnique({
    where: { id: r.data?.id },
    select: { customerContactName: true, customerContactEmail: true, customerMatchPending: true },
  });
  const ok = r.status === 201 && dbCase?.customerContactName === 'Test Caller' && dbCase?.customerMatchPending === true;
  record('4. Requester context persisted (DB)', ok,
    `name=${dbCase?.customerContactName} email=${dbCase?.customerContactEmail}`);
}

// ─────────────────────────────────────────────────────────────────
// 5) AccountProject compatible create
// ─────────────────────────────────────────────────────────────────
{
  const project = await prisma.accountProject.findFirst({
    where: { accountCompany: { accountId: uniAc.accountId, companyId: COMP_UNI }, isActive: true },
  });
  if (project) {
    const r = await api(supervisorToken, '/api/cases', {
      method: 'POST',
      body: JSON.stringify({
        ...baseCase('T5'),
        accountProjectId: project.id,
        accountProjectName: project.name,
      }),
    });
    const ok = r.status === 201 && r.data?.accountProjectId === project.id;
    record('5. AccountProject compatible create → 201', ok,
      `status=${r.status} pid=${r.data?.accountProjectId}`);
    if (r.data?.id) createdCaseIds.push(r.data.id);
  } else {
    record('5. AccountProject create (no project seed for this account)', true, 'skipped');
  }
}

// ─────────────────────────────────────────────────────────────────
// 6) Product compatible create
// ─────────────────────────────────────────────────────────────────
let case6 = null;
{
  const r = await api(supervisorToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({ ...baseCase('T6'), productId: uniProductInWhite.id }),
  });
  const ok = r.status === 201 && r.data?.productId === uniProductInWhite.id && r.data?.productName === uniProductInWhite.name;
  record('6. Product compatible → 201 + denorm', ok,
    `status=${r.status} pid=${r.data?.productId} pname=${r.data?.productName}`);
  if (r.data?.id) {
    case6 = r.data;
    createdCaseIds.push(r.data.id);
  }
}

// ─────────────────────────────────────────────────────────────────
// 7) Package + product PackageItem üyesi → 201 (DI.3 happy)
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(supervisorToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({
      ...baseCase('T7'),
      packageId: uniPackage.id,
      productId: uniProductInWhite.id,
    }),
  });
  record('7. Pkg + product (PackageItem üyesi) → 201',
    r.status === 201 && r.data?.packageId === uniPackage.id && r.data?.productId === uniProductInWhite.id,
    `status=${r.status} pkg=${r.data?.packageId} prod=${r.data?.productId}`);
  if (r.data?.id) createdCaseIds.push(r.data.id);
}

// ─────────────────────────────────────────────────────────────────
// 8) Package + product UYUMSUZ → 400 package_product_mismatch (DI.3)
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(supervisorToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({
      ...baseCase('T8'),
      packageId: uniPackage.id,
      productId: uniProductNotInWhite.id, // WHITE'da yok
    }),
  });
  record('8. DI.3 productId ∉ PackageItem → 400',
    r.status === 400 && r.data?.error === 'package_product_mismatch',
    `status=${r.status} code=${r.data?.error}`);
}

// ─────────────────────────────────────────────────────────────────
// 9) Customerless + packageId → 400 (DI.4)
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(supervisorToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({
      ...baseCase('T9'),
      accountId: undefined,
      accountName: undefined,
      packageId: uniPackage.id,
    }),
  });
  record('9. Customerless + packageId → 400 package_requires_account',
    r.status === 400 && r.data?.error === 'package_requires_account',
    `status=${r.status} code=${r.data?.error}`);
}

// ─────────────────────────────────────────────────────────────────
// 10) Case.packageId !== AC.packageId → 400 (DI.5)
// ─────────────────────────────────────────────────────────────────
{
  // AC.packageId = uniPackage; biz uniRedPackage göndereceğiz.
  const r = await api(supervisorToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({ ...baseCase('T10'), packageId: uniRedPackage.id }),
  });
  record('10. DI.5 Case.packageId !== AC.packageId → 400',
    r.status === 400 && r.data?.error === 'package_account_company_mismatch',
    `status=${r.status} code=${r.data?.error}`);
}

// ─────────────────────────────────────────────────────────────────
// 11) Cross-tenant product → 400 (DI.2)
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(supervisorToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({ ...baseCase('T11'), productId: parProduct.id }),
  });
  record('11. Cross-tenant product → 400 product_company_mismatch',
    r.status === 400 && r.data?.error === 'product_company_mismatch',
    `status=${r.status} code=${r.data?.error}`);
}

// ─────────────────────────────────────────────────────────────────
// 12) supportLevel cascade from Product (case6'dan)
// ─────────────────────────────────────────────────────────────────
if (case6 && uniProductInWhite.supportLevel) {
  record('12. supportLevel cascade Product → Case',
    case6.supportLevel === uniProductInWhite.supportLevel,
    `case=${case6.supportLevel} product=${uniProductInWhite.supportLevel}`);
} else {
  record('12. supportLevel cascade', false, 'case6 or product.supportLevel missing');
}

// ─────────────────────────────────────────────────────────────────
// 13) Transfer manuel (team-only, AI atlandı)
// ─────────────────────────────────────────────────────────────────
{
  const xferCase = await api(supervisorToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({
      ...baseCase('T13'),
      assignedTeamId: uniTeams[0].id,
      assignedTeamName: uniTeams[0].name,
    }),
  });
  if (xferCase.data?.id) createdCaseIds.push(xferCase.data.id);
  const r = await api(supervisorToken, `/api/cases/${xferCase.data?.id}/transfer`, {
    method: 'POST',
    body: JSON.stringify({
      toTeamId: uniTeams[1].id,
      reason: 'Manuel takım atama (AI önerisi olmadan)',
      reasonCode: 'expertise',
    }),
  });
  const after = await prisma.case.findUnique({
    where: { id: xferCase.data?.id },
    select: { assignedTeamId: true, assignedPersonId: true, transferCount: true },
  });
  const ok = r.status === 200 && after?.assignedTeamId === uniTeams[1].id && after?.transferCount === 1;
  record('13. Transfer manuel team-only → 200 + count++', ok,
    `status=${r.status} team=${after?.assignedTeamId === uniTeams[1].id} count=${after?.transferCount}`);
}

// ─────────────────────────────────────────────────────────────────
// 14) Transfer cross-tenant team → 400 invalid_team
// ─────────────────────────────────────────────────────────────────
{
  const xferCase = await api(supervisorToken, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({
      ...baseCase('T14'),
      assignedTeamId: uniTeams[0].id,
      assignedTeamName: uniTeams[0].name,
    }),
  });
  if (xferCase.data?.id) createdCaseIds.push(xferCase.data.id);
  const r = await api(supervisorToken, `/api/cases/${xferCase.data?.id}/transfer`, {
    method: 'POST',
    body: JSON.stringify({
      toTeamId: parTeam.id, // PARAM team
      reason: 'Cross-tenant deneme',
      reasonCode: 'other',
    }),
  });
  record('14. Transfer cross-tenant team → 400 invalid_team',
    r.status === 400 && r.data?.error === 'invalid_team',
    `status=${r.status} code=${r.data?.error}`);
}

// ─────────────────────────────────────────────────────────────────
// 15) Claim unassigned (PARAM agent claims kendi şirketindeki vakayı)
// ─────────────────────────────────────────────────────────────────
{
  // PARAM unassigned case yarat (Agent açabilir mi? Hayır — agent UserCompany write yok.
  // Bu yüzden Supervisor ile yaratıp Agent ile claim'leyelim).
  const supSrc = await getToken('supervisor@varuna.dev');
  const parCase = await api(supSrc, '/api/cases', {
    method: 'POST',
    body: JSON.stringify({
      ...baseCase('T15'),
      companyId: COMP_PAR,
      companyName: 'PARAM',
      accountId: undefined,
      accountName: undefined,
      // Customer non-required PARAM — set false geçici. Restore aşağıda.
    }),
  });
  if (parCase.data?.id) createdCaseIds.push(parCase.data.id);
  if (parCase.status === 201 && agentToken) {
    // Önce assigned person'ı temizle
    await prisma.case.update({
      where: { id: parCase.data.id },
      data: { assignedPersonId: null, assignedPersonName: null },
    });
    const r = await api(agentToken, `/api/cases/${parCase.data.id}/claim`, { method: 'POST' });
    record('15. Claim unassigned (Agent → PARAM)',
      r.status === 200 && !!r.data?.assignedPersonId,
      `status=${r.status} person=${r.data?.assignedPersonId}`);
  } else {
    record('15. Claim unassigned (precondition)', false,
      `parCase status=${parCase.status} agentToken=${!!agentToken}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// 16) Lookup catalog scope: empty allowedCompanyIds → 403
// ─────────────────────────────────────────────────────────────────
{
  let err = null;
  try {
    await lookupRepository.getCaseCatalog({ companyId: COMP_UNI, allowedCompanyIds: [] });
  } catch (e) { err = e; }
  record('16. getCaseCatalog empty scope → 403',
    err?.status === 403 && err?.code === 'forbidden',
    `status=${err?.status} code=${err?.code}`);
}

// ─────────────────────────────────────────────────────────────────
// 17) Lookup catalog cross-tenant → 403
// ─────────────────────────────────────────────────────────────────
{
  let err = null;
  try {
    await lookupRepository.getCaseCatalog({ companyId: COMP_UNI, allowedCompanyIds: [COMP_PAR] });
  } catch (e) { err = e; }
  record('17. getCaseCatalog cross-tenant → 403',
    err?.status === 403 && err?.code === 'forbidden',
    `status=${err?.status} code=${err?.code}`);
}

// ─────────────────────────────────────────────────────────────────
// 18) TCKN privacy — list response'unda raw TCKN/tcknHash YOK
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(adminToken, '/api/accounts?limit=3');
  const sample = r.data?.accounts ?? [];
  const leak = sample.find((a) => 'tckn' in a || 'tcknHash' in a);
  record('18. TCKN privacy — no raw/hash in list response',
    r.status === 200 && !leak,
    `accounts=${sample.length} leak=${!!leak}`);
}

// ─────────────────────────────────────────────────────────────────
// 19) Requester context — Account listing response'unda görünmez
//     (Case'in customer* alanları yalnız Case scope'unda; Account/listing'de leak yok)
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(adminToken, '/api/accounts?limit=3');
  const sample = r.data?.accounts ?? [];
  const leak = sample.find((a) =>
    'customerContactName' in a || 'customerContactPhone' in a || 'customerContactEmail' in a,
  );
  record('19. Requester context not in account list',
    r.status === 200 && !leak,
    `leak=${!!leak}`);
}

// ─────────────────────────────────────────────────────────────────
// 20) Data contracts (orchestrate via spawn — stdout + stderr birleştir)
// ─────────────────────────────────────────────────────────────────
{
  const r = spawnSync(process.execPath, ['--env-file=.env', 'scripts/smoke-data-contracts.js'], {
    encoding: 'utf-8',
    timeout: 120000,
    cwd: process.cwd(),
  });
  const combined = (r.stdout ?? '') + (r.stderr ?? '');
  const passMatch = combined.match(/PASS=(\d+)/);
  const failMatch = combined.match(/FAIL=(\d+)/);
  const passCount = passMatch ? Number(passMatch[1]) : 0;
  const failCount = failMatch ? Number(failMatch[1]) : -1;
  record('20. Data contracts orchestrator',
    failCount === 0 && passCount > 0,
    `pass=${passCount} fail=${failCount} exit=${r.status}`);
}

// ─────────────────────────────────────────────────────────────────
// Cleanup — restore state
// ─────────────────────────────────────────────────────────────────
try {
  if (createdCaseIds.length) {
    await prisma.case.deleteMany({ where: { id: { in: createdCaseIds } } });
  }
  if (uniAcId) {
    await prisma.accountCompany.update({
      where: { id: uniAcId },
      data: { packageId: originalAcPackageId },
    });
  }
  if (originalRequireCustomer !== null) {
    await prisma.companySettings.update({
      where: { companyId: COMP_UNI },
      data: { requireCustomerOnCaseCreate: originalRequireCustomer },
    });
  }
} catch (e) {
  console.warn('[cleanup]', e?.message);
}

await prisma.$disconnect();

const failures = results.filter((r) => !r.ok);
console.log(`\nResults: ${results.length - failures.length}/${results.length} ok`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name} — ${f.detail}`);
  process.exit(1);
}
