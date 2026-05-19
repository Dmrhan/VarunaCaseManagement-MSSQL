/**
 * smoke-product-catalog.js — WR-A6 / PM-05.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-product-catalog.js
 *
 * Backend dev server (port 3101) ayakta olmalı. db:seed + db:seed:auth +
 * seed-full-demo-scenarios.js çalışmış olmalı.
 *
 * 11 senaryo:
 *  1. Admin creates ProductGroup → 201
 *  2. Admin creates Product under that group → 201
 *  3. Duplicate code same company → 409
 *  4. Same code different company → 201 (multi-tenant izolasyon)
 *  5. Cross-company Product → ProductGroup mismatch → 400
 *  6. PATCH soft-deactivate (isActive=false) → 200, DB isActive=false
 *  7. PATCH `code` alanı → silently ignored (D-A6.2)
 *  8. Agent attempts POST product-group → 403
 *  9. Backoffice attempts POST product → 403
 * 10. Cross-tenant: admin scope dışı companyId → 403
 * 11. Seed verification: PARAM/UNIVERA/FINROTA her birinde ≥2 group + ≥5 product
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

const STAMP = `SMOKEA6${Date.now()}`;
const createdGroupIds = [];
const createdProductIds = [];

async function cleanup() {
  try {
    if (createdProductIds.length) {
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    }
    if (createdGroupIds.length) {
      await prisma.productGroup.deleteMany({ where: { id: { in: createdGroupIds } } });
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

// Tenant-only admin var mı? Demo admin@varuna.dev tüm 3 şirkette Admin —
// cross-tenant testi için var olmayan bir companyId kullanırız.
const FAKE_COMPANY_ID = 'COMP-DOES-NOT-EXIST-XYZ';

// ─────────────────────────────────────────────────────────────────
// 1) Admin creates ProductGroup
// ─────────────────────────────────────────────────────────────────

console.log('\n── 1) Admin creates ProductGroup ──');
let groupA = null;
{
  const r = await api(adminToken, '/api/admin/product-groups', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_A,
      code: `${STAMP}_GRP_A`,
      name: `${STAMP} Group A`,
      description: 'Smoke test group A',
    }),
  });
  const ok = r.status === 201 && !!r.data?.id;
  record('1. POST product-groups → 201', ok, `status=${r.status} id=${r.data?.id}`);
  if (ok) { groupA = r.data; createdGroupIds.push(r.data.id); }
}

// ─────────────────────────────────────────────────────────────────
// 2) Admin creates Product under group
// ─────────────────────────────────────────────────────────────────

console.log('\n── 2) Admin creates Product ──');
let productA = null;
if (groupA) {
  const r = await api(adminToken, '/api/admin/products', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_A,
      productGroupId: groupA.id,
      code: `${STAMP}_PRD_A`,
      name: `${STAMP} Product A`,
    }),
  });
  const ok = r.status === 201 && !!r.data?.id && r.data?.productGroup?.code === groupA.code;
  record('2. POST products → 201 + productGroup chip', ok, `status=${r.status} groupChip=${r.data?.productGroup?.code}`);
  if (r.data?.id) { productA = r.data; createdProductIds.push(r.data.id); }
}

// ─────────────────────────────────────────────────────────────────
// 3) Duplicate code same company → 409
// ─────────────────────────────────────────────────────────────────

console.log('\n── 3) Duplicate code same company → 409 ──');
if (groupA) {
  const r = await api(adminToken, '/api/admin/product-groups', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_A,
      code: `${STAMP}_GRP_A`,
      name: 'duplicate attempt',
    }),
  });
  record('3. Duplicate group code → 409', r.status === 409, `status=${r.status}`);
}

// ─────────────────────────────────────────────────────────────────
// 4) Same code different company → 201
// ─────────────────────────────────────────────────────────────────

console.log('\n── 4) Same code different company → 201 ──');
{
  const r = await api(adminToken, '/api/admin/product-groups', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_B,
      code: `${STAMP}_GRP_A`,    // aynı code
      name: 'multi-tenant isolation test',
    }),
  });
  const ok = r.status === 201;
  record('4. Same code in COMP-PARAM → 201', ok, `status=${r.status}`);
  if (r.data?.id) createdGroupIds.push(r.data.id);
}

// ─────────────────────────────────────────────────────────────────
// 5) Cross-company Product → ProductGroup mismatch → 400
// ─────────────────────────────────────────────────────────────────

console.log('\n── 5) Product companyId != group.companyId → 400 ──');
if (groupA) {
  // groupA UNIVERA'da; Product'ı COMP-PARAM ile yarat.
  const r = await api(adminToken, '/api/admin/products', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_B,
      productGroupId: groupA.id,
      code: `${STAMP}_CROSS`,
      name: 'cross-company test',
    }),
  });
  record('5. Cross-company productGroup → 400', r.status === 400, `status=${r.status}`);
  if (r.data?.id) createdProductIds.push(r.data.id);
}

// ─────────────────────────────────────────────────────────────────
// 6) PATCH soft-deactivate → DB isActive=false
// ─────────────────────────────────────────────────────────────────

console.log('\n── 6) PATCH soft-deactivate ──');
if (productA) {
  const r = await api(adminToken, `/api/admin/products/${productA.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive: false }),
  });
  const row = await prisma.product.findUnique({ where: { id: productA.id }, select: { isActive: true } });
  const ok = r.status === 200 && row?.isActive === false;
  record('6. PATCH isActive=false → DB isActive=false', ok, `status=${r.status} isActive=${row?.isActive}`);
}

// ─────────────────────────────────────────────────────────────────
// 7) PATCH `code` → silently ignored
// ─────────────────────────────────────────────────────────────────

console.log('\n── 7) PATCH code (immutable) — silently ignored ──');
if (productA) {
  const before = await prisma.product.findUnique({ where: { id: productA.id }, select: { code: true } });
  const r = await api(adminToken, `/api/admin/products/${productA.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ code: 'NEW_CODE_ATTEMPT' }),
  });
  const after = await prisma.product.findUnique({ where: { id: productA.id }, select: { code: true } });
  const ok = r.status === 200 && before?.code === after?.code;
  record('7. PATCH code → silently ignored', ok, `status=${r.status} code=${after?.code}`);
}

// ─────────────────────────────────────────────────────────────────
// 8) Agent attempts POST product-group → 403
// ─────────────────────────────────────────────────────────────────

console.log('\n── 8) Agent POST product-group → 403 ──');
if (agentToken) {
  const r = await api(agentToken, '/api/admin/product-groups', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_A, code: `${STAMP}_AGENT`, name: 'agent attempt' }),
  });
  record('8. Agent POST → 403', r.status === 403, `status=${r.status}`);
}

// ─────────────────────────────────────────────────────────────────
// 9) Backoffice attempts POST product → 403
// ─────────────────────────────────────────────────────────────────

console.log('\n── 9) Backoffice POST product → 403 ──');
if (backofficeToken) {
  const r = await api(backofficeToken, '/api/admin/products', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_A,
      productGroupId: groupA?.id ?? 'placeholder',
      code: `${STAMP}_BO`,
      name: 'backoffice attempt',
    }),
  });
  record('9. Backoffice POST → 403', r.status === 403, `status=${r.status}`);
}

// ─────────────────────────────────────────────────────────────────
// 10) Cross-tenant: admin scope dışı companyId → 403
// ─────────────────────────────────────────────────────────────────

console.log('\n── 10) Cross-tenant companyId → 403 ──');
{
  const r = await api(adminToken, '/api/admin/product-groups', {
    method: 'POST',
    body: JSON.stringify({ companyId: FAKE_COMPANY_ID, code: `${STAMP}_X`, name: 'cross-tenant attempt' }),
  });
  record('10. Out-of-scope companyId → 403', r.status === 403, `status=${r.status}`);
}

// ─────────────────────────────────────────────────────────────────
// 11) Seed verification: each company ≥2 groups + ≥5 products
// ─────────────────────────────────────────────────────────────────

console.log('\n── 11) Seed coverage per company ──');
for (const cid of ['COMP-PARAM', 'COMP-UNIVERA', 'COMP-FINROTA']) {
  const gCount = await prisma.productGroup.count({ where: { companyId: cid, isActive: true } });
  const pCount = await prisma.product.count({ where: { companyId: cid, isActive: true } });
  const ok = gCount >= 2 && pCount >= 5;
  record(`11. ${cid}: ≥2 groups + ≥5 products`, ok, `groups=${gCount} products=${pCount}`);
}

// ─────────────────────────────────────────────────────────────────
// 12-15) WR-A6 follow-up: Product.supportLevel
// ─────────────────────────────────────────────────────────────────

console.log('\n── 12-15) Product.supportLevel ──');

// Use the existing UNIVERA group from seed (PG-COMP-UNIVERA-SAHA).
const sahaGroup = await prisma.productGroup.findFirst({
  where: { companyId: COMP_A, code: 'SAHA' },
});

// 12) Create product with supportLevel=L2 → 201 + DB matches
let level2Product = null;
if (sahaGroup) {
  const r = await api(adminToken, '/api/admin/products', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_A,
      productGroupId: sahaGroup.id,
      code: `${STAMP}_SL_L2`,
      name: `${STAMP} L2 product`,
      supportLevel: 'L2',
    }),
  });
  const ok = r.status === 201 && r.data?.supportLevel === 'L2';
  record('12. Create supportLevel=L2 → 201 + DB matches', ok, `status=${r.status} supportLevel=${r.data?.supportLevel}`);
  if (r.data?.id) { level2Product = r.data; createdProductIds.push(r.data.id); }
}

// 13) Update product supportLevel=L3 → 200 + DB matches
if (level2Product) {
  const r = await api(adminToken, `/api/admin/products/${level2Product.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ supportLevel: 'L3' }),
  });
  const row = await prisma.product.findUnique({ where: { id: level2Product.id }, select: { supportLevel: true } });
  const ok = r.status === 200 && row?.supportLevel === 'L3';
  record('13. Update supportLevel=L3 → 200 + DB updated', ok, `status=${r.status} supportLevel=${row?.supportLevel}`);
}

// 14) Invalid supportLevel → 400 support_level_invalid
if (sahaGroup) {
  const r = await api(adminToken, '/api/admin/products', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_A,
      productGroupId: sahaGroup.id,
      code: `${STAMP}_SL_BAD`,
      name: 'invalid level',
      supportLevel: 'Z9',
    }),
  });
  const ok = r.status === 400 && r.data?.error === 'support_level_invalid';
  record('14. Invalid supportLevel="Z9" → 400 support_level_invalid', ok, `status=${r.status} error=${r.data?.error}`);
  if (r.data?.id) createdProductIds.push(r.data.id);
}

// 15) Seed coverage: each company has products with non-L1 supportLevel
{
  const univeraNonL1 = await prisma.product.count({
    where: { companyId: 'COMP-UNIVERA', isActive: true, supportLevel: { in: ['L2', 'L3', 'Expert'] } },
  });
  const paramNonL1 = await prisma.product.count({
    where: { companyId: 'COMP-PARAM', isActive: true, supportLevel: { in: ['L2', 'L3', 'Expert'] } },
  });
  const finrotaNonL1 = await prisma.product.count({
    where: { companyId: 'COMP-FINROTA', isActive: true, supportLevel: { in: ['L2', 'L3', 'Expert'] } },
  });
  record(
    '15. Seed coverage: UNIVERA + PARAM + FINROTA each has ≥1 non-L1 product',
    univeraNonL1 >= 1 && paramNonL1 >= 1 && finrotaNonL1 >= 1,
    `UNIVERA=${univeraNonL1} PARAM=${paramNonL1} FINROTA=${finrotaNonL1}`,
  );
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
