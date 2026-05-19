/**
 * smoke-account-addresses.js — WR-A3 / PM-02.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-account-addresses.js
 *
 * Backend dev server (port 3101) ayakta olmalı. db:seed + db:seed:auth +
 * seed-full-demo-scenarios.js çalışmış olmalı (UNIVERA hesap + AccountCompany
 * referans alınır).
 *
 * 14 senaryo:
 *  1. Admin creates Billing address with country=TR → 201
 *  2. Admin creates HQ address with country=DE → 201
 *  3. Admin edits address (label + line1) → 200
 *  4. Admin soft-deletes address → 200, isActive=false in DB
 *  5. List addresses (Supervisor) → 200, only this account's addresses
 *  6. Agent attempts POST → 403
 *  7. Backoffice attempts PATCH → 403
 *  8. Cross-tenant: companyId mismatch (not in account's AccountCompany) → 400
 *  9. country="tr" lowercase → backend normalizes to "TR" + 201
 * 10. country="USA" (3 char) → 400 address_country_invalid
 * 11. country missing in create → defaults to "TR"
 * 12. line1 empty → 400 address_line1_required
 * 13. isDefault=true → previous default for same (account, company, type) cleared
 * 14. Account detail response includes addresses[] array; no leakage of other
 *     accounts' addresses
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

const STAMP = `smoke-a3-${Date.now()}`;
const createdAddressIds = [];

async function cleanup() {
  try {
    if (createdAddressIds.length) {
      await prisma.address.deleteMany({ where: { id: { in: createdAddressIds } } });
    }
  } catch (e) {
    console.warn('[cleanup]', e?.message);
  }
}

const adminToken = await getToken('admin@varuna.dev');
const agentToken = await getToken('agent@varuna.dev');
const supervisorToken = await getToken('supervisor@varuna.dev');
const backofficeToken = await getToken('backoffice@varuna.dev');
if (!adminToken) {
  console.log('SKIP — admin token yok');
  await prisma.$disconnect();
  process.exit(0);
}

// UNIVERA + PARAM hesaplarını ve AccountCompany'lerini al.
const univeraAC = await prisma.accountCompany.findFirst({
  where: { companyId: 'COMP-UNIVERA' },
  include: { account: true },
  orderBy: { createdAt: 'asc' },
});
const paramAC = await prisma.accountCompany.findFirst({
  where: { companyId: 'COMP-PARAM' },
  include: { account: true },
  orderBy: { createdAt: 'asc' },
});
if (!univeraAC || !paramAC) {
  console.log('SKIP — UNIVERA/PARAM AccountCompany yok. seed-full-demo-scenarios çalıştır.');
  await prisma.$disconnect();
  process.exit(0);
}

const acct = univeraAC.account;
const cid = univeraAC.companyId;

// ─────────────────────────────────────────────────────────────────
// 1) Admin creates Billing address with country=TR
// ─────────────────────────────────────────────────────────────────

console.log('\n── 1) Admin creates Billing TR ──');
let addr1 = null;
{
  const r = await api(adminToken, `/api/accounts/${acct.id}/addresses`, {
    method: 'POST',
    body: JSON.stringify({
      companyId: cid,
      type: 'Billing',
      label: `${STAMP} Billing TR`,
      line1: 'Cumhuriyet Cad. No: 1',
      city: 'İstanbul',
      country: 'TR',
    }),
  });
  const ok = r.status === 201 && !!r.data?.id;
  record('1. Create Billing TR → 201', ok, `status=${r.status} id=${r.data?.id}`);
  if (ok) { addr1 = r.data; createdAddressIds.push(r.data.id); }
}

// ─────────────────────────────────────────────────────────────────
// 2) Admin creates HQ address with country=DE
// ─────────────────────────────────────────────────────────────────

console.log('\n── 2) Admin creates HQ DE ──');
let addr2 = null;
{
  const r = await api(adminToken, `/api/accounts/${acct.id}/addresses`, {
    method: 'POST',
    body: JSON.stringify({
      companyId: cid,
      type: 'Headquarters',
      label: `${STAMP} EU HQ`,
      line1: 'Friedrichstraße 68',
      city: 'Berlin',
      country: 'DE',
    }),
  });
  const ok = r.status === 201 && !!r.data?.id;
  record('2. Create HQ DE → 201', ok, `status=${r.status} id=${r.data?.id}`);
  if (ok) { addr2 = r.data; createdAddressIds.push(r.data.id); }
}

// ─────────────────────────────────────────────────────────────────
// 3) Admin edits address
// ─────────────────────────────────────────────────────────────────

console.log('\n── 3) Admin edits address ──');
if (addr1) {
  const r = await api(adminToken, `/api/accounts/${acct.id}/addresses/${addr1.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ label: `${STAMP} Billing TR (updated)`, line1: 'Cumhuriyet Cad. No: 2' }),
  });
  const row = await prisma.address.findUnique({ where: { id: addr1.id }, select: { label: true, line1: true } });
  const ok = r.status === 200 && row?.line1 === 'Cumhuriyet Cad. No: 2';
  record('3. Edit address → 200 + updated fields', ok, `status=${r.status} line1=${row?.line1}`);
}

// ─────────────────────────────────────────────────────────────────
// 4) Admin soft-deletes address
// ─────────────────────────────────────────────────────────────────

console.log('\n── 4) Admin soft-deletes address ──');
// Önce silinecek ayrı bir adres yarat — addr1/2 sonraki testlerde gerekiyor.
let addrDel = null;
{
  const r = await api(adminToken, `/api/accounts/${acct.id}/addresses`, {
    method: 'POST',
    body: JSON.stringify({
      companyId: cid,
      type: 'Branch',
      label: 'To be deleted',
      line1: 'Test line',
    }),
  });
  if (r.status === 201) { addrDel = r.data; createdAddressIds.push(r.data.id); }
}
if (addrDel) {
  const r = await api(adminToken, `/api/accounts/${acct.id}/addresses/${addrDel.id}`, {
    method: 'DELETE',
  });
  const row = await prisma.address.findUnique({ where: { id: addrDel.id }, select: { isActive: true, isDefault: true } });
  const ok = r.status === 200 && row?.isActive === false && row?.isDefault === false;
  record('4. Soft-delete → 200 + isActive=false', ok, `status=${r.status} isActive=${row?.isActive}`);
}

// ─────────────────────────────────────────────────────────────────
// 5) Supervisor lists addresses
// ─────────────────────────────────────────────────────────────────

console.log('\n── 5) Supervisor lists addresses ──');
if (supervisorToken) {
  const r = await api(supervisorToken, `/api/accounts/${acct.id}/addresses`);
  const list = r.data?.value ?? [];
  const allOurs = list.every((a) => a.companyId === cid);
  record('5. Supervisor list → 200, only this account scope', r.status === 200 && allOurs && list.length >= 1, `status=${r.status} count=${list.length}`);
}

// ─────────────────────────────────────────────────────────────────
// 6) Agent attempts POST → 403
// ─────────────────────────────────────────────────────────────────

console.log('\n── 6) Agent attempts POST ──');
if (agentToken) {
  const r = await api(agentToken, `/api/accounts/${acct.id}/addresses`, {
    method: 'POST',
    body: JSON.stringify({ companyId: cid, type: 'Visit', line1: 'rbac test' }),
  });
  record('6. Agent POST → 403', r.status === 403, `status=${r.status}`);
}

// ─────────────────────────────────────────────────────────────────
// 7) Backoffice attempts PATCH → 403
// ─────────────────────────────────────────────────────────────────

console.log('\n── 7) Backoffice attempts PATCH ──');
if (backofficeToken && addr1) {
  const r = await api(backofficeToken, `/api/accounts/${acct.id}/addresses/${addr1.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ label: 'should fail' }),
  });
  record('7. Backoffice PATCH → 403', r.status === 403, `status=${r.status}`);
}

// ─────────────────────────────────────────────────────────────────
// 8) Cross-tenant — companyId not in account's AccountCompany set
// ─────────────────────────────────────────────────────────────────

console.log('\n── 8) Cross-tenant companyId mismatch ──');
{
  // UNIVERA hesabına COMP-PARAM companyId ile adres eklemeye çalış.
  // (Admin scope'unda her iki şirket de var — bu özellikle account ↔ company
  // mismatch'i test eder, RBAC değil.)
  const r = await api(adminToken, `/api/accounts/${acct.id}/addresses`, {
    method: 'POST',
    body: JSON.stringify({
      companyId: 'COMP-PARAM',
      type: 'Billing',
      line1: 'cross-tenant attempt',
      country: 'TR',
    }),
  });
  const ok = r.status === 400 && r.data?.error === 'address_company_mismatch';
  record('8. Cross-tenant companyId → 400 address_company_mismatch', ok, `status=${r.status} error=${r.data?.error}`);
  if (r.data?.id) createdAddressIds.push(r.data.id);
}

// ─────────────────────────────────────────────────────────────────
// 9) country lowercase → backend uppercases
// ─────────────────────────────────────────────────────────────────

console.log('\n── 9) country=tr lowercase → 201 normalized to TR ──');
{
  const r = await api(adminToken, `/api/accounts/${acct.id}/addresses`, {
    method: 'POST',
    body: JSON.stringify({
      companyId: cid,
      type: 'Shipping',
      line1: 'lowercase test',
      country: 'tr',
    }),
  });
  const ok = r.status === 201 && !!r.data?.id;
  record('9. country=tr → 201 (normalize uppercase)', ok, `status=${r.status}`);
  if (r.data?.id) {
    createdAddressIds.push(r.data.id);
    const row = await prisma.address.findUnique({ where: { id: r.data.id }, select: { country: true } });
    record('9b. DB country=TR (uppercase)', row?.country === 'TR', `country=${row?.country}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// 10) country=USA (3 char) → 400
// ─────────────────────────────────────────────────────────────────

console.log('\n── 10) country=USA (3 char) → 400 ──');
{
  const r = await api(adminToken, `/api/accounts/${acct.id}/addresses`, {
    method: 'POST',
    body: JSON.stringify({
      companyId: cid,
      type: 'Billing',
      line1: '3char test',
      country: 'USA',
    }),
  });
  const ok = r.status === 400 && r.data?.error === 'address_country_invalid';
  record('10. country=USA → 400 address_country_invalid', ok, `status=${r.status} error=${r.data?.error}`);
  if (r.data?.id) createdAddressIds.push(r.data.id);
}

// ─────────────────────────────────────────────────────────────────
// 11) country missing → defaults to "TR"
// ─────────────────────────────────────────────────────────────────

console.log('\n── 11) country missing → defaults to TR ──');
{
  const r = await api(adminToken, `/api/accounts/${acct.id}/addresses`, {
    method: 'POST',
    body: JSON.stringify({
      companyId: cid,
      type: 'Visit',
      label: `${STAMP} default-country`,
      line1: 'no country',
    }),
  });
  const ok = r.status === 201 && !!r.data?.id;
  record('11. No country → 201', ok, `status=${r.status}`);
  if (r.data?.id) {
    createdAddressIds.push(r.data.id);
    const row = await prisma.address.findUnique({ where: { id: r.data.id }, select: { country: true } });
    record('11b. Default country=TR', row?.country === 'TR', `country=${row?.country}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// 12) line1 empty → 400
// ─────────────────────────────────────────────────────────────────

console.log('\n── 12) line1 empty → 400 ──');
{
  const r = await api(adminToken, `/api/accounts/${acct.id}/addresses`, {
    method: 'POST',
    body: JSON.stringify({ companyId: cid, type: 'Billing', line1: '   ', country: 'TR' }),
  });
  const ok = r.status === 400 && r.data?.error === 'address_line1_required';
  record('12. line1 empty → 400 address_line1_required', ok, `status=${r.status} error=${r.data?.error}`);
  if (r.data?.id) createdAddressIds.push(r.data.id);
}

// ─────────────────────────────────────────────────────────────────
// 13) isDefault=true clears previous default for same (account, company, type)
// ─────────────────────────────────────────────────────────────────

console.log('\n── 13) isDefault transaction clear ──');
// İki sıralı Billing+TR yarat: 1. isDefault=true, 2. isDefault=true.
let defA = null;
let defB = null;
{
  const ra = await api(adminToken, `/api/accounts/${acct.id}/addresses`, {
    method: 'POST',
    body: JSON.stringify({
      companyId: cid,
      type: 'Headquarters',
      label: `${STAMP} default-A`,
      line1: 'first default',
      country: 'TR',
      isDefault: true,
    }),
  });
  if (ra.status === 201 && ra.data?.id) { defA = ra.data; createdAddressIds.push(defA.id); }
}
{
  const rb = await api(adminToken, `/api/accounts/${acct.id}/addresses`, {
    method: 'POST',
    body: JSON.stringify({
      companyId: cid,
      type: 'Headquarters',
      label: `${STAMP} default-B`,
      line1: 'second default',
      country: 'TR',
      isDefault: true,
    }),
  });
  if (rb.status === 201 && rb.data?.id) { defB = rb.data; createdAddressIds.push(defB.id); }
}
if (defA && defB) {
  // After second create, defA.isDefault should be false; defB.isDefault should be true.
  const rowA = await prisma.address.findUnique({ where: { id: defA.id }, select: { isDefault: true } });
  const rowB = await prisma.address.findUnique({ where: { id: defB.id }, select: { isDefault: true } });
  const ok = rowA?.isDefault === false && rowB?.isDefault === true;
  record('13. isDefault clear on duplicate → only one true', ok, `A.isDefault=${rowA?.isDefault} B.isDefault=${rowB?.isDefault}`);
}

// ─────────────────────────────────────────────────────────────────
// 14) Account detail response includes addresses; no leakage
// ─────────────────────────────────────────────────────────────────

console.log('\n── 14) Account detail addresses leak check ──');
{
  // PARAM hesap detayını UNIVERA admin (allowedCompanyIds: PARAM dahil) ile çek.
  // Adresler sadece bu account'a + scope'a ait olmalı.
  const r = await api(adminToken, `/api/accounts/${acct.id}`);
  const list = r.data?.addresses ?? [];
  const allOurs = list.every((a) => a.companyId === cid);
  const ok = r.status === 200 && Array.isArray(list) && allOurs && list.length >= 1;
  record('14. Detail.addresses only this account + scope', ok, `count=${list.length} allInScope=${allOurs}`);
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
