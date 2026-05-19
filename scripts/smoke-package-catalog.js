/**
 * smoke-package-catalog.js — WR-A7 / PM-05 Package Catalog foundation.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-package-catalog.js
 *
 * Backend dev server (port 3101) ayakta olmalı. db:seed + db:seed:auth +
 * seed-full-demo-scenarios.js çalışmış olmalı.
 *
 * 13 senaryo:
 *  1. Admin creates Package → 201
 *  2. Admin updates Package supportLevel → 200
 *  3. PUT items with 3 productIds → 200 + items returned
 *  4. PUT items with duplicate productIds → deduped, success
 *  5. PUT items with cross-company productId → 400 package_product_company_mismatch
 *  6. PUT items with unknown productId → 400 package_product_invalid
 *  7. Duplicate package code same company → 409
 *  8. Same package code different company → 201
 *  9. Soft deactivate (PATCH isActive=false) → 200, DB isActive=false
 * 10. Agent POST package → 403
 * 11. Backoffice PATCH package → 403
 * 12. Cross-tenant: out-of-scope companyId → 403
 * 13. Seed coverage: PARAM/UNIVERA/FINROTA each ≥2 packages; UNIVERA WhitePackage+RedPackage Package, NOT Product
 */

import { prisma } from '../server/db/client.js';

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

const STAMP = `SMOKEA7${Date.now()}`;
const createdPackageIds = [];

async function cleanup() {
  try {
    if (createdPackageIds.length) {
      await prisma.packageItem.deleteMany({ where: { packageId: { in: createdPackageIds } } });
      await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
    }
  } catch (e) {
    console.warn('[cleanup]', e?.message);
  }
}

const adminToken = await getToken('admin@varuna.dev');
const agentToken = await getToken('agent@varuna.dev');
const backofficeToken = await getToken('backoffice@varuna.dev');
if (!adminToken) {
  console.log('SKIP — admin token yok');
  await prisma.$disconnect();
  process.exit(0);
}

const COMP_A = 'COMP-UNIVERA';
const COMP_B = 'COMP-PARAM';
const FAKE_COMPANY_ID = 'COMP-DOES-NOT-EXIST-XYZ';

// Fetch 3 active UNIVERA products for item tests.
const univeraProducts = await prisma.product.findMany({
  where: { companyId: COMP_A, isActive: true },
  select: { id: true, code: true },
  take: 5,
});
const paramProduct = await prisma.product.findFirst({
  where: { companyId: COMP_B, isActive: true },
  select: { id: true, code: true },
});

// ─────────────────────────────────────────────────────────────────
// 1) Admin creates Package
// ─────────────────────────────────────────────────────────────────

console.log('\n── 1) Admin creates Package ──');
let pkgA = null;
{
  const r = await api(adminToken, '/api/admin/packages', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_A,
      code: `${STAMP}_PKG_A`,
      name: `${STAMP} Package A`,
      supportLevel: 'L1',
      description: 'smoke test',
    }),
  });
  const ok = r.status === 201 && !!r.data?.id;
  record('1. POST package → 201', ok, `status=${r.status} id=${r.data?.id}`);
  if (ok) { pkgA = r.data; createdPackageIds.push(r.data.id); }
}

// ─────────────────────────────────────────────────────────────────
// 2) Admin updates Package supportLevel
// ─────────────────────────────────────────────────────────────────

console.log('\n── 2) Update supportLevel ──');
if (pkgA) {
  const r = await api(adminToken, `/api/admin/packages/${pkgA.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ supportLevel: 'L2' }),
  });
  const row = await prisma.package.findUnique({ where: { id: pkgA.id }, select: { supportLevel: true } });
  const ok = r.status === 200 && row?.supportLevel === 'L2';
  record('2. PATCH supportLevel=L2 → 200 + DB updated', ok, `status=${r.status} supportLevel=${row?.supportLevel}`);
}

// ─────────────────────────────────────────────────────────────────
// 3) Assign 3 product items
// ─────────────────────────────────────────────────────────────────

console.log('\n── 3) PUT items with 3 productIds ──');
if (pkgA && univeraProducts.length >= 3) {
  const ids = univeraProducts.slice(0, 3).map((p) => p.id);
  const r = await api(adminToken, `/api/admin/packages/${pkgA.id}/items`, {
    method: 'PUT',
    body: JSON.stringify({ productIds: ids }),
  });
  const items = r.data?.value ?? [];
  const ok = r.status === 200 && items.length === 3;
  record('3. PUT 3 items → 200 + 3 items returned', ok, `status=${r.status} count=${items.length}`);
}

// ─────────────────────────────────────────────────────────────────
// 4) Duplicate productIds deduped
// ─────────────────────────────────────────────────────────────────

console.log('\n── 4) PUT items with duplicates → deduped ──');
if (pkgA && univeraProducts.length >= 2) {
  const dup = [univeraProducts[0].id, univeraProducts[0].id, univeraProducts[1].id];
  const r = await api(adminToken, `/api/admin/packages/${pkgA.id}/items`, {
    method: 'PUT',
    body: JSON.stringify({ productIds: dup }),
  });
  const items = r.data?.value ?? [];
  const ok = r.status === 200 && items.length === 2;
  record('4. Duplicate productIds → deduped (2 unique)', ok, `status=${r.status} count=${items.length}`);
}

// ─────────────────────────────────────────────────────────────────
// 5) Cross-company product → 400
// ─────────────────────────────────────────────────────────────────

console.log('\n── 5) Cross-company product → 400 ──');
if (pkgA && paramProduct) {
  const r = await api(adminToken, `/api/admin/packages/${pkgA.id}/items`, {
    method: 'PUT',
    body: JSON.stringify({ productIds: [paramProduct.id] }),
  });
  const ok = r.status === 400 && r.data?.error === 'package_product_company_mismatch';
  record('5. Cross-company product → 400 package_product_company_mismatch', ok, `status=${r.status} error=${r.data?.error}`);
}

// ─────────────────────────────────────────────────────────────────
// 6) Unknown product → 400
// ─────────────────────────────────────────────────────────────────

console.log('\n── 6) Unknown productId → 400 ──');
if (pkgA) {
  const r = await api(adminToken, `/api/admin/packages/${pkgA.id}/items`, {
    method: 'PUT',
    body: JSON.stringify({ productIds: ['DOES_NOT_EXIST_xyz'] }),
  });
  const ok = r.status === 400 && r.data?.error === 'package_product_invalid';
  record('6. Unknown productId → 400 package_product_invalid', ok, `status=${r.status} error=${r.data?.error}`);
}

// ─────────────────────────────────────────────────────────────────
// 7) Duplicate package code same company → 409
// ─────────────────────────────────────────────────────────────────

console.log('\n── 7) Duplicate code same company → 409 ──');
if (pkgA) {
  const r = await api(adminToken, '/api/admin/packages', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_A,
      code: `${STAMP}_PKG_A`,
      name: 'duplicate',
    }),
  });
  record('7. Duplicate code → 409', r.status === 409, `status=${r.status}`);
}

// ─────────────────────────────────────────────────────────────────
// 8) Same code different company → 201
// ─────────────────────────────────────────────────────────────────

console.log('\n── 8) Same code in COMP-PARAM → 201 ──');
{
  const r = await api(adminToken, '/api/admin/packages', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_B,
      code: `${STAMP}_PKG_A`,
      name: 'multi-tenant isolation',
    }),
  });
  const ok = r.status === 201;
  record('8. Same code different company → 201', ok, `status=${r.status}`);
  if (r.data?.id) createdPackageIds.push(r.data.id);
}

// ─────────────────────────────────────────────────────────────────
// 9) Soft deactivate
// ─────────────────────────────────────────────────────────────────

console.log('\n── 9) Soft deactivate ──');
if (pkgA) {
  const r = await api(adminToken, `/api/admin/packages/${pkgA.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive: false }),
  });
  const row = await prisma.package.findUnique({ where: { id: pkgA.id }, select: { isActive: true } });
  const ok = r.status === 200 && row?.isActive === false;
  record('9. PATCH isActive=false → DB isActive=false', ok, `status=${r.status} isActive=${row?.isActive}`);
}

// ─────────────────────────────────────────────────────────────────
// 10) Agent POST package → 403
// ─────────────────────────────────────────────────────────────────

console.log('\n── 10) Agent POST → 403 ──');
if (agentToken) {
  const r = await api(agentToken, '/api/admin/packages', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_A, code: `${STAMP}_RBAC`, name: 'rbac' }),
  });
  record('10. Agent POST → 403', r.status === 403, `status=${r.status}`);
}

// ─────────────────────────────────────────────────────────────────
// 11) Backoffice PATCH → 403
// ─────────────────────────────────────────────────────────────────

console.log('\n── 11) Backoffice PATCH → 403 ──');
if (backofficeToken && pkgA) {
  const r = await api(backofficeToken, `/api/admin/packages/${pkgA.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'rbac attempt' }),
  });
  record('11. Backoffice PATCH → 403', r.status === 403, `status=${r.status}`);
}

// ─────────────────────────────────────────────────────────────────
// 12) Cross-tenant out-of-scope companyId → 403
// ─────────────────────────────────────────────────────────────────

console.log('\n── 12) Out-of-scope companyId → 403 ──');
{
  const r = await api(adminToken, '/api/admin/packages', {
    method: 'POST',
    body: JSON.stringify({ companyId: FAKE_COMPANY_ID, code: `${STAMP}_X`, name: 'oob' }),
  });
  record('12. Out-of-scope companyId → 403', r.status === 403, `status=${r.status}`);
}

// ─────────────────────────────────────────────────────────────────
// 13) Seed coverage + WhitePackage/RedPackage as Package not Product
// ─────────────────────────────────────────────────────────────────

console.log('\n── 13) Seed coverage + WhitePackage/RedPackage typing ──');
{
  for (const cid of ['COMP-PARAM', 'COMP-UNIVERA', 'COMP-FINROTA']) {
    const n = await prisma.package.count({ where: { companyId: cid, isActive: true } });
    record(`13. ${cid}: ≥2 active packages`, n >= 2, `count=${n}`);
  }
  // UNIVERA WhitePackage + RedPackage in Package table
  const wpInPkg = await prisma.package.count({ where: { companyId: 'COMP-UNIVERA', code: 'WHITE_PKG' } });
  const rpInPkg = await prisma.package.count({ where: { companyId: 'COMP-UNIVERA', code: 'RED_PKG' } });
  record(
    '13. UNIVERA WhitePackage + RedPackage exist as Package rows',
    wpInPkg >= 1 && rpInPkg >= 1,
    `WhitePackage=${wpInPkg} RedPackage=${rpInPkg}`,
  );
  // … and NOT in Product table (defensive — A6 seed never created these as products)
  const wpInProd = await prisma.product.count({
    where: { companyId: 'COMP-UNIVERA', OR: [{ code: 'WHITE_PKG' }, { name: { contains: 'WhitePackage' } }] },
  });
  const rpInProd = await prisma.product.count({
    where: { companyId: 'COMP-UNIVERA', OR: [{ code: 'RED_PKG' }, { name: { contains: 'RedPackage' } }] },
  });
  record(
    '13. UNIVERA WhitePackage + RedPackage NOT in Product table',
    wpInProd === 0 && rpInProd === 0,
    `Product hits: White=${wpInProd} Red=${rpInProd}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 14-18) WR-A7 review fix — per-company admin gate on ID routes
// ─────────────────────────────────────────────────────────────────

console.log('\n── 14-18) ID-route company-admin gate ──');

const sysadminToken = await getToken('sysadmin@varuna.dev');

// Demote admin@varuna.dev's UserCompany role for COMP-PARAM to Supervisor
// (still in allowedCompanyIds, but NOT company-admin). Restore at the end.
const adminUser = await prisma.user.findUnique({ where: { email: 'admin@varuna.dev' }, select: { id: true } });
const originalParamLink = adminUser
  ? await prisma.userCompany.findFirst({
      where: { userId: adminUser.id, companyId: 'COMP-PARAM' },
      select: { role: true, isActive: true },
    })
  : null;

// Create a fresh PARAM package owned by sysadmin (deterministic ID for cleanup).
let paramPkg = null;
if (sysadminToken) {
  const r = await api(sysadminToken, '/api/admin/packages', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_B,
      code: `${STAMP}_PARAM_GATE`,
      name: `${STAMP} Param gate test`,
      supportLevel: 'L1',
    }),
  });
  if (r.status === 201 && r.data?.id) { paramPkg = r.data; createdPackageIds.push(r.data.id); }
}

if (!sysadminToken) {
  record('14-18. company-admin gate suite', false, 'sysadmin token unavailable');
} else if (!paramPkg) {
  record('14-18. company-admin gate suite', false, 'failed to create PARAM test package');
} else if (!adminUser || !originalParamLink) {
  record('14-18. company-admin gate suite', false, 'admin user or PARAM UserCompany link missing');
} else {
  // Sanity: existing Admin for company can do all 3 operations.
  {
    const r = await api(adminToken, `/api/admin/packages/${paramPkg.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'pre-demote sanity' }),
    });
    record('Admin (proper role) PATCH → 200 (pre-demote sanity)', r.status === 200, `status=${r.status}`);
  }
  {
    const r = await api(adminToken, `/api/admin/packages/${paramPkg.id}/items`);
    record('Admin (proper role) GET items → 200 (pre-demote sanity)', r.status === 200, `status=${r.status}`);
  }
  {
    const r = await api(adminToken, `/api/admin/packages/${paramPkg.id}/items`, {
      method: 'PUT',
      body: JSON.stringify({ productIds: [] }),
    });
    record('Admin (proper role) PUT items → 200 (pre-demote sanity)', r.status === 200, `status=${r.status}`);
  }

  // Demote admin to Supervisor in COMP-PARAM only.
  await prisma.userCompany.update({
    where: { userId_companyId: { userId: adminUser.id, companyId: 'COMP-PARAM' } },
    data: { role: 'Supervisor' },
  });

  try {
    // 14) Demoted admin PATCH /packages/:id → 403
    {
      const r = await api(adminToken, `/api/admin/packages/${paramPkg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: 'should be blocked' }),
      });
      record('14. Demoted admin (Supervisor role) PATCH → 403', r.status === 403, `status=${r.status}`);
    }

    // 15) Demoted admin GET /packages/:id/items → 403
    {
      const r = await api(adminToken, `/api/admin/packages/${paramPkg.id}/items`);
      record('15. Demoted admin GET /items → 403', r.status === 403, `status=${r.status}`);
    }

    // 16) Demoted admin PUT /packages/:id/items → 403
    {
      const r = await api(adminToken, `/api/admin/packages/${paramPkg.id}/items`, {
        method: 'PUT',
        body: JSON.stringify({ productIds: [] }),
      });
      record('16. Demoted admin PUT /items → 403', r.status === 403, `status=${r.status}`);
    }

    // 17) SystemAdmin still works (effective company role 'SystemAdmin' for all)
    {
      const r = await api(sysadminToken, `/api/admin/packages/${paramPkg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: 'sysadmin path' }),
      });
      const r2 = await api(sysadminToken, `/api/admin/packages/${paramPkg.id}/items`);
      const r3 = await api(sysadminToken, `/api/admin/packages/${paramPkg.id}/items`, {
        method: 'PUT',
        body: JSON.stringify({ productIds: [] }),
      });
      record(
        '17. SystemAdmin PATCH + GET items + PUT items → all 200',
        r.status === 200 && r2.status === 200 && r3.status === 200,
        `PATCH=${r.status} GET=${r2.status} PUT=${r3.status}`,
      );
    }
  } finally {
    // Restore admin role.
    await prisma.userCompany.update({
      where: { userId_companyId: { userId: adminUser.id, companyId: 'COMP-PARAM' } },
      data: { role: originalParamLink.role },
    });
  }

  // 18) Re-promoted admin → all 3 succeed again (also covers contract case
  //     "Existing Admin for company can still PATCH / GET items / PUT items").
  {
    const r = await api(adminToken, `/api/admin/packages/${paramPkg.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'restored admin' }),
    });
    const r2 = await api(adminToken, `/api/admin/packages/${paramPkg.id}/items`);
    const r3 = await api(adminToken, `/api/admin/packages/${paramPkg.id}/items`, {
      method: 'PUT',
      body: JSON.stringify({ productIds: [] }),
    });
    record(
      '18. Restored Admin PATCH + GET items + PUT items → all 200',
      r.status === 200 && r2.status === 200 && r3.status === 200,
      `PATCH=${r.status} GET=${r2.status} PUT=${r3.status}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// Summary + cleanup
// ─────────────────────────────────────────────────────────────────

await cleanup();
await prisma.$disconnect();

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Sonuç: ${passed} ✓ / ${failed} ✗`);
if (failed > 0) {
  console.log('Başarısız:');
  results.filter((r) => !r.ok).forEach((r) => console.log(`  ✗ ${r.name} — ${r.detail}`));
  process.exit(1);
}
process.exit(0);
