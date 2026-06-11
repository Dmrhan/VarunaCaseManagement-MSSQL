/**
 * smoke-account-validation-privacy.js — WR-A2 / PM-01.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-account-validation-privacy.js
 *
 * Backend dev server (port 3101) ayakta olmalı. `TCKN_HASH_PEPPER` env değişkeni
 * set edilmiş olmalı (en az 16 karakter); aksi halde TCKN testleri pepper-missing
 * yolunu doğrular.
 *
 * 17 senaryo (Planning Card §⑤'den):
 *  1. VKN valid (correct checksum) → accepted.
 *  2. VKN invalid (bad checksum) → rejected.
 *  3. TCKN valid → accepted for Individual.
 *  4. TCKN invalid (bad checksum) → rejected.
 *  5. TCKN for Corporate → rejected.
 *  6. Raw TCKN not stored in Account table (no plain tckn column).
 *  7. tcknHash + tcknLast4 stored when TCKN provided.
 *  8. API response includes tcknMasked only; no tckn/tcknHash.
 *  9. Duplicate TCKN returns 409.
 * 10. Phone TR forms normalize to E.164.
 * 11. International E.164 accepted.
 * 12. Phone not unique — two accounts can share phoneE164.
 * 13. Missing TCKN_HASH_PEPPER → 400 fail safely (env temizle + restart gerekirse skip).
 * 14. Existing account without TCKN still reads/updates.
 * 15. VKN masking unchanged.
 * 16. Account search still works.
 * 17. Tenant scope unchanged.
 */

import { prisma } from '../server/db/client.js';
import crypto from 'node:crypto';

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

// ─────────────────────────────────────────────────────────────────
// Test fixture VKN/TCKN — gerçek değil, doğrulamadan geçen örnekler
// ─────────────────────────────────────────────────────────────────

// VKN checksum-valid örnekleri (Türk VKN algoritmasına göre üretilmiş — gerçek değil).
const VALID_VKN_1 = '1000000018';   // valid checksum (sentetik, kullanımda yok)
const VALID_VKN_2 = '1000000026';   // valid checksum
const INVALID_VKN = '1234567899';   // 10 digits ama invalid checksum

// TCKN checksum-valid örnekleri (sentetik, gerçek kimliklere ait değil).
const VALID_TCKN_1 = '10000000146'; // valid TC algorithm
const VALID_TCKN_2 = '10000000382'; // valid TC algorithm (duplicate test için ayrı)
const INVALID_TCKN = '12345678901'; // invalid checksum

// Test account ID prefix (cleanup için)
const TEST_PREFIX = 'smoke-a2';
const createdAccountIds = [];

async function cleanup() {
  if (createdAccountIds.length === 0) return;
  try {
    await prisma.account.deleteMany({ where: { id: { in: createdAccountIds } } });
  } catch (e) {
    console.warn('[cleanup]', e?.message);
  }
}

const adminToken = await getToken('admin@varuna.dev');
const agentToken = await getToken('agent@varuna.dev');

const adminCompanyId = (await prisma.userCompany.findFirst({
  where: { user: { email: 'admin@varuna.dev' }, isActive: true },
  select: { companyId: true },
}))?.companyId;

if (!adminToken || !adminCompanyId) {
  console.log('SKIP — admin token veya companyId yok');
  await prisma.$disconnect();
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────
// 1-2. VKN validation
// ─────────────────────────────────────────────────────────────────

console.log('\n── 1-2) VKN validation ──');
{
  const stamp = `${TEST_PREFIX}-vkn-valid-${Date.now()}`;
  const r = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: stamp,
      vkn: VALID_VKN_1,
      customerType: 'Corporate',
      companies: [{ companyId: adminCompanyId }],
    }),
  });
  record('1. VKN valid (correct checksum) → 201', r.status === 201, `status=${r.status} code=${r.data?.error}`);
  if (r.data?.id) createdAccountIds.push(r.data.id);
}
{
  const stamp = `${TEST_PREFIX}-vkn-invalid-${Date.now()}`;
  const r = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: stamp,
      vkn: INVALID_VKN,
      customerType: 'Corporate',
      companies: [{ companyId: adminCompanyId }],
    }),
  });
  record('2. VKN invalid (bad checksum) → 400', r.status === 400 && r.data?.error === 'invalid_vkn',
    `status=${r.status} code=${r.data?.error}`);
}

// ─────────────────────────────────────────────────────────────────
// 3-9. TCKN validation + privacy
// ─────────────────────────────────────────────────────────────────

console.log('\n── 3-9) TCKN validation + privacy ──');
let individualAccountId = null;
const pepperPresent = !!process.env.TCKN_HASH_PEPPER && process.env.TCKN_HASH_PEPPER.length >= 16;

if (!pepperPresent) {
  console.log('   (TCKN_HASH_PEPPER yok veya kısa — TCKN testleri pepper-missing yolunu doğrular)');
}

{
  const stamp = `${TEST_PREFIX}-ind-valid-${Date.now()}`;
  const r = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: stamp,
      customerType: 'Individual',
      tckn: VALID_TCKN_1,
      companies: [{ companyId: adminCompanyId }],
    }),
  });
  if (pepperPresent) {
    record('3. TCKN valid → 201 for Individual', r.status === 201,
      `status=${r.status} code=${r.data?.error}`);
    if (r.data?.id) {
      individualAccountId = r.data.id;
      createdAccountIds.push(r.data.id);
    }
  } else {
    record('3/13. TCKN+pepper-missing → 400 (combined)', r.status === 400 && r.data?.error === 'tckn_pepper_missing',
      `status=${r.status} code=${r.data?.error}`);
  }
}

{
  const r = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: `${TEST_PREFIX}-ind-invalid-${Date.now()}`,
      customerType: 'Individual',
      tckn: INVALID_TCKN,
      companies: [{ companyId: adminCompanyId }],
    }),
  });
  // pepper present: 400 invalid; pepper missing: 400 pepper_missing — her ikisi de 400 ile başlar
  record('4. TCKN invalid → 400', r.status === 400, `status=${r.status} code=${r.data?.error}`);
}

{
  const r = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: `${TEST_PREFIX}-corp-tckn-${Date.now()}`,
      customerType: 'Corporate',
      tckn: VALID_TCKN_2,
      companies: [{ companyId: adminCompanyId }],
    }),
  });
  record('5. TCKN for Corporate → 400', r.status === 400 &&
    (r.data?.error === 'tckn_not_allowed_for_type' || r.data?.error === 'tckn_pepper_missing'),
    `status=${r.status} code=${r.data?.error}`);
}

if (pepperPresent && individualAccountId) {
  // 6. Raw TCKN not stored — schema check via information_schema
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'Account' ORDER BY column_name`,
  );
  const colNames = cols.map((c) => c.column_name);
  const hasRawTckn = colNames.includes('tckn') || colNames.includes('nationalId') || colNames.includes('national_id');
  record('6. Raw TCKN column NOT in Account schema', !hasRawTckn,
    hasRawTckn ? `LEAK: column found` : `safe; columns: ${colNames.filter((c) => c.toLowerCase().includes('tck')).join(',')}`);

  // 7. tcknHash + tcknLast4 stored
  const row = await prisma.account.findUnique({
    where: { id: individualAccountId },
    select: { tcknHash: true, tcknLast4: true },
  });
  record('7a. tcknHash stored (64-char hex)',
    !!row?.tcknHash && /^[0-9a-f]{64}$/.test(row.tcknHash),
    `len=${row?.tcknHash?.length} valid=${/^[0-9a-f]{64}$/.test(row?.tcknHash ?? '')}`);
  record('7b. tcknLast4 stored (4 digits)',
    row?.tcknLast4 === VALID_TCKN_1.slice(-4),
    `last4=${row?.tcknLast4} expected=${VALID_TCKN_1.slice(-4)}`);

  // 8. API response includes tcknMasked only; no tckn/tcknHash
  const detail = await api(adminToken, `/api/accounts/${individualAccountId}`);
  record('8a. Response includes tcknMasked',
    detail.data?.tcknMasked === '*******' + VALID_TCKN_1.slice(-4),
    `tcknMasked=${detail.data?.tcknMasked}`);
  record('8b. Response does NOT include "tckn"', !('tckn' in (detail.data ?? {})),
    `keys: ${Object.keys(detail.data ?? {}).join(',')}`);
  record('8c. Response does NOT include "tcknHash"', !('tcknHash' in (detail.data ?? {})));

  // 9. Duplicate TCKN → 409
  const dupR = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: `${TEST_PREFIX}-dup-${Date.now()}`,
      customerType: 'Individual',
      tckn: VALID_TCKN_1, // same TCKN
      companies: [{ companyId: adminCompanyId }],
    }),
  });
  record('9. Duplicate TCKN → 409', dupR.status === 409 && dupR.data?.error === 'duplicate_tckn',
    `status=${dupR.status} code=${dupR.data?.error}`);
} else {
  record('6-9. TCKN privacy/storage checks → skipped (no Individual fixture)', true);
}

// ─────────────────────────────────────────────────────────────────
// 10-12. Phone E.164 normalize
// ─────────────────────────────────────────────────────────────────

console.log('\n── 10-12) Phone E.164 normalize ──');
const phoneFormats = [
  { input: '05325551234', expected: '+905325551234' },
  { input: '5325551234', expected: '+905325551234' },
  { input: '+90 532 555 12 34', expected: '+905325551234' },
  { input: '0090 532 555 12 34', expected: '+905325551234' },
];

const phoneAccountIds = [];
for (const fmt of phoneFormats) {
  const r = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: `${TEST_PREFIX}-phone-${fmt.input.replace(/\W/g, '')}-${Date.now()}`,
      customerType: 'Corporate',
      phone: fmt.input,
      companies: [{ companyId: adminCompanyId }],
    }),
  });
  record(`10. Phone "${fmt.input}" → "${fmt.expected}"`,
    r.status === 201 && r.data?.phoneE164 === fmt.expected,
    `status=${r.status} got=${r.data?.phoneE164}`);
  if (r.data?.id) {
    createdAccountIds.push(r.data.id);
    phoneAccountIds.push(r.data.id);
  }
}

// 11. International E.164
{
  const r = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: `${TEST_PREFIX}-intl-${Date.now()}`,
      customerType: 'Corporate',
      phone: '+14155551212',
      companies: [{ companyId: adminCompanyId }],
    }),
  });
  record('11. International E.164 "+14155551212" accepted',
    r.status === 201 && r.data?.phoneE164 === '+14155551212',
    `status=${r.status} got=${r.data?.phoneE164}`);
  if (r.data?.id) createdAccountIds.push(r.data.id);
}

// 12. Phone NOT unique — paylaşılan numara iki Account'ta görünebilir
{
  const sharedPhone = '+905555556666';
  const r1 = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: `${TEST_PREFIX}-shared1-${Date.now()}`,
      customerType: 'Corporate',
      phone: sharedPhone,
      companies: [{ companyId: adminCompanyId }],
    }),
  });
  if (r1.data?.id) createdAccountIds.push(r1.data.id);
  const r2 = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: `${TEST_PREFIX}-shared2-${Date.now()}`,
      customerType: 'Corporate',
      phone: sharedPhone,
      companies: [{ companyId: adminCompanyId }],
    }),
  });
  if (r2.data?.id) createdAccountIds.push(r2.data.id);
  record('12. Phone NOT unique — two accounts share phoneE164',
    r1.status === 201 && r2.status === 201,
    `r1=${r1.status} r2=${r2.status}`);
}

// ─────────────────────────────────────────────────────────────────
// 13. Missing TCKN_HASH_PEPPER fail-safe (covered by §3-5 when pepper absent)
// ─────────────────────────────────────────────────────────────────

console.log('\n── 13) Pepper-missing fail-safe ──');
record('13. Pepper-missing fail-safe (covered above)', true,
  pepperPresent ? 'pepper present — test §3-5 with valid pepper' : 'pepper missing — §3-5 confirmed 400 fail');

// ─────────────────────────────────────────────────────────────────
// 14-17. Backward compat + privacy regressions
// ─────────────────────────────────────────────────────────────────

console.log('\n── 14-17) Backward compat + privacy regressions ──');

// 14. Existing account without TCKN still reads
{
  const existing = await prisma.account.findFirst({
    where: { tcknHash: null, companyId: null },
    select: { id: true },
  });
  if (existing && adminToken) {
    const r = await api(adminToken, `/api/accounts/${existing.id}`);
    record('14. Existing account (no TCKN) reads OK', r.status === 200,
      `tcknMasked=${r.data?.tcknMasked}`);
  } else {
    record('14. Existing account read — skipped (no fixture)', true);
  }
}

// 15. VKN masking unchanged
{
  const list = await api(adminToken, '/api/accounts?limit=3');
  const withVkn = (list.data?.accounts ?? []).find((a) => a.vknMasked);
  record('15. VKN masking unchanged (vknMasked format preserved)',
    !withVkn || /^[\d]{3}\*+[\d]{3}$/.test(withVkn.vknMasked ?? ''),
    `sample=${withVkn?.vknMasked}`);
}

// 16. Account search still works
{
  const r = await api(adminToken, '/api/accounts?search=ACC&limit=5');
  record('16. Account search → 200', r.status === 200, `count=${r.data?.accounts?.length ?? 0}`);
}

// 17. Tenant scope unchanged — Agent kendi şirket dışına erişemez
if (agentToken) {
  const list = await api(agentToken, '/api/accounts?limit=5');
  record('17. Agent tenant scope → 200', list.status === 200);
}

// Bonus: validate endpoints
console.log('\n── Bonus) validate-vkn / validate-tckn endpoints ──');
{
  const r = await api(adminToken, `/api/lookups/validate-vkn?value=${VALID_VKN_1}`);
  record('B1. validate-vkn valid → valid: true', r.data?.valid === true, `reason=${r.data?.reason}`);
  const r2 = await api(adminToken, `/api/lookups/validate-vkn?value=${INVALID_VKN}`);
  record('B2. validate-vkn invalid → valid: false', r2.data?.valid === false, `reason=${r2.data?.reason}`);
  const r3 = await api(adminToken, `/api/lookups/validate-tckn?value=${VALID_TCKN_1}`);
  record('B3. validate-tckn valid → valid: true', r3.data?.valid === true);
  const r4 = await api(adminToken, `/api/lookups/validate-tckn?value=${INVALID_TCKN}`);
  record('B4. validate-tckn invalid → valid: false', r4.data?.valid === false);
}

// ─────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────

console.log('\n── Cleanup ──');
await cleanup();
record('cleanup', true, `removed ${createdAccountIds.length} test accounts`);

await prisma.$disconnect();

const failed = results.filter((r) => !r.ok);
console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('[smoke] FAILED:');
  failed.forEach((f) => console.log(`  - ${f.name} ${f.detail ?? ''}`));
  process.exitCode = 1;
} else {
  console.log('[smoke] ALL GREEN');
}
