/**
 * smoke-account-product-catalog-link.js — WR-A8 AccountProduct ↔ Product Catalog
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-account-product-catalog-link.js
 *
 * Scenarios:
 *  1. Create AccountProduct with valid productId → success; response includes
 *     productId + productGroupName + productSupportLevel.
 *  2. Create AccountProduct with cross-company productId → 400
 *     product_company_mismatch.
 *  3. Create AccountProduct with inactive catalog product → 400 product_inactive.
 *  4. Create AccountProduct with unknown productId → 404 product_not_found.
 *  5. Legacy free-text create (no productId) still succeeds; productId=null in
 *     response.
 *  6. List products returns catalog snapshot fields for catalog-linked row
 *     and null for legacy row.
 *  7. Update legacy row → link productId; row becomes catalog-linked.
 *  8. Update catalog row → clear productId; row becomes legacy.
 *  9. Account detail (getAccount) response: AccountCompany.products includes
 *     productId + productSupportLevel + productGroupName.
 */

import { prisma } from '../server/db/client.js';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function getToken(email) {
  // Faz 5 — local auth: BFF /api/auth/login (Supabase token akışı kaldırıldı)
  const authBase = process.env.BFF_URL || process.env.BASE_URL || 'http://localhost:3101';
  const r = await fetch(`${authBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: TEST_PASSWORD }),
  });
  const j = await r.json().catch(() => ({}));
  return j.accessToken || null;
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

const adminToken = await getToken('admin@varuna.dev');
if (!adminToken) {
  console.log('SKIP — admin token yok');
  await prisma.$disconnect();
  process.exit(0);
}

const stamp = Date.now().toString().slice(-6);

// Pick UNIVERA account-company pair (a global Account that exists across PARAM + UNIVERA)
const univeraAc = await prisma.accountCompany.findFirst({
  where: { companyId: 'COMP-UNIVERA' },
  select: { id: true, accountId: true, companyId: true },
});
const paramAc = await prisma.accountCompany.findFirst({
  where: { companyId: 'COMP-PARAM' },
  select: { id: true, accountId: true, companyId: true },
});
if (!univeraAc || !paramAc) {
  console.log('SKIP — UNIVERA veya PARAM AccountCompany seed yok');
  await prisma.$disconnect();
  process.exit(0);
}

// Pick an active UNIVERA Product
const univeraProduct = await prisma.product.findFirst({
  where: { companyId: 'COMP-UNIVERA', isActive: true },
  select: { id: true, code: true, name: true, productGroup: { select: { name: true } } },
});
const paramProduct = await prisma.product.findFirst({
  where: { companyId: 'COMP-PARAM', isActive: true },
  select: { id: true, code: true, name: true },
});
if (!univeraProduct || !paramProduct) {
  console.log('SKIP — UNIVERA veya PARAM aktif Product yok');
  await prisma.$disconnect();
  process.exit(0);
}

// Create an inactive product for #3
const inactiveProduct = await prisma.product.findFirst({
  where: { companyId: 'COMP-UNIVERA', isActive: false },
  select: { id: true },
});

const createdProductIds = new Set();
async function cleanup() {
  for (const id of createdProductIds) {
    await prisma.accountProduct.delete({ where: { id } }).catch(() => {});
  }
}

// 1) Create with valid productId
let goodId;
{
  const r = await api(adminToken, `/api/accounts/${univeraAc.accountId}/products`, {
    method: 'POST',
    body: JSON.stringify({
      accountCompanyId: univeraAc.id,
      productId: univeraProduct.id,
      productCode: `XT-1-${stamp}`,
    }),
  });
  goodId = r.data?.id;
  if (goodId) createdProductIds.add(goodId);
  // Verify via account.detail in same response
  const acProducts = (r.data?.account?.companies ?? [])
    .flatMap((c) => c.products ?? [])
    .find((p) => p.id === goodId);
  record(
    '1) Create AccountProduct with valid productId',
    r.status === 201 && acProducts && acProducts.productId === univeraProduct.id,
    `status=${r.status} productId=${acProducts?.productId} groupName=${acProducts?.productGroupName} supportLevel=${acProducts?.productSupportLevel}`,
  );
}

// 2) Cross-company productId → 400 product_company_mismatch
{
  const r = await api(adminToken, `/api/accounts/${univeraAc.accountId}/products`, {
    method: 'POST',
    body: JSON.stringify({
      accountCompanyId: univeraAc.id,
      productId: paramProduct.id, // PARAM product into UNIVERA AC
      productCode: `XT-2-${stamp}`,
    }),
  });
  record(
    '2) Cross-company productId → product_company_mismatch',
    r.status === 400 && r.data?.error === 'product_company_mismatch',
    `status=${r.status} error=${r.data?.error}`,
  );
}

// 3) Inactive productId → 400 product_inactive (skip if no inactive product available)
if (inactiveProduct) {
  const r = await api(adminToken, `/api/accounts/${univeraAc.accountId}/products`, {
    method: 'POST',
    body: JSON.stringify({
      accountCompanyId: univeraAc.id,
      productId: inactiveProduct.id,
      productCode: `XT-3-${stamp}`,
    }),
  });
  record(
    '3) Inactive productId → product_inactive',
    r.status === 400 && r.data?.error === 'product_inactive',
    `status=${r.status} error=${r.data?.error}`,
  );
} else {
  console.log('⊘ SKIP 3) Inactive productId test — no inactive UNIVERA product');
}

// 4) Unknown productId → 404 product_not_found
{
  const r = await api(adminToken, `/api/accounts/${univeraAc.accountId}/products`, {
    method: 'POST',
    body: JSON.stringify({
      accountCompanyId: univeraAc.id,
      productId: 'nonexistent-product-id-zzz',
      productCode: `XT-4-${stamp}`,
    }),
  });
  record(
    '4) Unknown productId → product_not_found',
    r.status === 404 && r.data?.error === 'product_not_found',
    `status=${r.status} error=${r.data?.error}`,
  );
}

// 5) Legacy free-text create still works
let legacyId;
{
  const r = await api(adminToken, `/api/accounts/${univeraAc.accountId}/products`, {
    method: 'POST',
    body: JSON.stringify({
      accountCompanyId: univeraAc.id,
      productName: 'Legacy Manual Product',
      productCode: `XT-5-${stamp}`,
    }),
  });
  legacyId = r.data?.id;
  if (legacyId) createdProductIds.add(legacyId);
  const acProducts = (r.data?.account?.companies ?? [])
    .flatMap((c) => c.products ?? [])
    .find((p) => p.id === legacyId);
  record(
    '5) Legacy free-text create succeeds; productId=null',
    r.status === 201 && acProducts && acProducts.productId === null,
    `productId=${acProducts?.productId} productName=${acProducts?.productName}`,
  );
}

// 6) List products returns snapshot fields
{
  const r = await api(adminToken, `/api/accounts/${univeraAc.accountId}/products?companyId=${univeraAc.companyId}`);
  const fromList = (r.data?.products ?? []).find((p) => p.id === goodId);
  const legacyFromList = (r.data?.products ?? []).find((p) => p.id === legacyId);
  record(
    '6) List exposes catalog snapshot for linked + null for legacy',
    fromList?.productId === univeraProduct.id &&
      !!fromList?.productGroupName &&
      !!fromList?.productSupportLevel &&
      legacyFromList?.productId === null &&
      legacyFromList?.productGroupName === null,
  );
}

// 7) Update legacy → link productId
{
  const r = await api(adminToken, `/api/accounts/${univeraAc.accountId}/products/${legacyId}`, {
    method: 'PATCH',
    body: JSON.stringify({ productId: univeraProduct.id }),
  });
  const fromAccount = (r.data?.account?.companies ?? [])
    .flatMap((c) => c.products ?? [])
    .find((p) => p.id === legacyId);
  record(
    '7) Update legacy → link productId works',
    r.status === 200 && fromAccount?.productId === univeraProduct.id,
    `now productId=${fromAccount?.productId}`,
  );
}

// 8) Update catalog → clear productId
{
  const r = await api(adminToken, `/api/accounts/${univeraAc.accountId}/products/${goodId}`, {
    method: 'PATCH',
    body: JSON.stringify({ productId: null, productName: 'Manual override after clear' }),
  });
  const fromAccount = (r.data?.account?.companies ?? [])
    .flatMap((c) => c.products ?? [])
    .find((p) => p.id === goodId);
  record(
    '8) Update catalog → clear productId works (productId null)',
    r.status === 200 && fromAccount?.productId === null && fromAccount?.productName === 'Manual override after clear',
    `productId=${fromAccount?.productId} name=${fromAccount?.productName}`,
  );
}

// 9) Account detail (getAccount) exposes catalog fields
{
  const r = await api(adminToken, `/api/accounts/${univeraAc.accountId}`);
  const allProducts = (r.data?.companies ?? []).flatMap((c) => c.products ?? []);
  const hasCatalogShape = allProducts.some(
    (p) => 'productId' in p && 'productGroupName' in p && 'productSupportLevel' in p,
  );
  record(
    '9) Account detail products expose productId + group + supportLevel fields',
    hasCatalogShape,
    `sample keys=${Object.keys(allProducts[0] ?? {}).join(',')}`,
  );
}

await cleanup();
await prisma.$disconnect();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
