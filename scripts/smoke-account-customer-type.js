/**
 * smoke-account-customer-type.js — WR-A1 / PM-01 smoke harness.
 *
 * Doğrulanan kontrat:
 *   - GET /api/accounts ve /api/accounts/:id response'unda customerType,
 *     legalName, registrationNo alanları döner.
 *   - POST /api/accounts (Admin) customerType=Individual/Corporate/Government/NonProfit
 *     ile çalışır; geçersiz tip → 400.
 *   - PATCH /api/accounts/:id customerType + legalName + registrationNo
 *     update eder.
 *   - Supervisor + Agent yazma → 403.
 *   - Tenant scope korunur (cross-company sızıntı yok).
 *   - Response'ta tckn / tcknHash YOK (WR-A1 / Modeling Guardrail #1 regression).
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-account-customer-type.js
 *
 * Backend dev server (port 3101) ayakta olmalı.
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

const createdAccountIds = [];

async function cleanup() {
  if (createdAccountIds.length === 0) return;
  // AccountCompany cascade ile silinir; manuel oluşturduğumuz testler için soft cleanup yeterli.
  try {
    await prisma.account.deleteMany({ where: { id: { in: createdAccountIds } } });
  } catch (e) {
    console.warn('[cleanup] account delete warning:', e?.message);
  }
}

const FORBIDDEN_FIELDS = ['tckn', 'tcknHash', 'tckn_hash', 'national_id'];

function hasForbiddenField(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const f of FORBIDDEN_FIELDS) {
    if (f in obj) return true;
  }
  return false;
}

// ── Section 1: DB invariants ──
console.log('\n── 1) DB invariants ──');
const allAccounts = await prisma.account.findMany({
  select: { id: true, customerType: true, legalName: true, registrationNo: true },
});
record('1a. All accounts have non-null customerType', allAccounts.every((a) => !!a.customerType), `n=${allAccounts.length}`);

const validTypes = new Set(['Individual', 'Corporate', 'Government', 'NonProfit']);
record('1b. customerType values are within enum', allAccounts.every((a) => validTypes.has(a.customerType)));

// Distribution check
const dist = allAccounts.reduce((m, a) => { m[a.customerType] = (m[a.customerType] ?? 0) + 1; return m; }, {});
record('1c. Seed dağılımı (info)', true, JSON.stringify(dist));

// ── Section 2: GET endpoints (read) ──
console.log('\n── 2) Read endpoints expose customerType ──');
const supToken = await getToken('supervisor@varuna.dev');
const adminToken = await getToken('admin@varuna.dev');
const agentToken = await getToken('agent@varuna.dev');

if (supToken) {
  const list = await api(supToken, '/api/accounts?limit=5');
  record('2a. GET /api/accounts → 200', list.status === 200, `status=${list.status}`);
  const first = list.data?.accounts?.[0];
  record('2b. List item exposes customerType', !!first?.customerType, `sample=${first?.customerType}`);
  record('2c. List item exposes legalName + registrationNo (nullable OK)',
    first ? ('legalName' in first && 'registrationNo' in first) : true);
  record('2d. List item has no tckn / tcknHash', !hasForbiddenField(first));

  if (first) {
    const detail = await api(supToken, `/api/accounts/${first.id}`);
    record('2e. GET /api/accounts/:id → 200', detail.status === 200, `status=${detail.status}`);
    record('2f. Detail exposes customerType', !!detail.data?.customerType);
    record('2g. Detail has no tckn / tcknHash', !hasForbiddenField(detail.data));
  }
}

// Agent list (LIST_ROLES includes Agent)
if (agentToken) {
  const list = await api(agentToken, '/api/accounts?limit=3');
  record('2h. Agent GET /api/accounts → 200', list.status === 200);
  const first = list.data?.accounts?.[0];
  record('2i. Agent list item exposes customerType', !!first?.customerType);
}

// ── Section 3: POST /api/accounts (Admin) — all 4 customer types ──
console.log('\n── 3) POST /api/accounts (Admin) ──');
const allowedCompanyId = (await prisma.userCompany.findFirst({
  where: { user: { email: 'admin@varuna.dev' }, isActive: true },
  select: { companyId: true },
}))?.companyId;

const types = ['Corporate', 'Individual', 'Government', 'NonProfit'];
for (const ct of types) {
  if (!adminToken || !allowedCompanyId) break;
  const stamp = `${ct.toUpperCase()}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const r = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: `WR-A1 Test ${ct} ${stamp}`,
      customerType: ct,
      legalName: ct === 'Individual' ? null : `WR-A1 ${ct} A.Ş.`,
      registrationNo: ct === 'Individual' ? null : `R-${stamp}`,
      phone: '+90 555 000 00 00',
      vkn: ct === 'Individual' ? null : null, // VKN test kapsamı dışı; Individual'da null
      companies: [{ companyId: allowedCompanyId }],
    }),
  });
  record(`3.${ct}.created`, r.status === 201, `status=${r.status} body=${JSON.stringify(r.data).slice(0, 120)}`);
  record(`3.${ct}.customerType echoes back`, r.data?.customerType === ct, `got=${r.data?.customerType}`);
  record(`3.${ct}.no tckn in response`, !hasForbiddenField(r.data));
  if (r.data?.id) createdAccountIds.push(r.data.id);
}

// 3.invalid — geçersiz customerType
if (adminToken && allowedCompanyId) {
  const r = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: 'WR-A1 Invalid Type',
      customerType: 'BogusType',
      companies: [{ companyId: allowedCompanyId }],
    }),
  });
  record('3.invalid → 400', r.status === 400, `status=${r.status} code=${r.data?.error}`);
}

// ── Section 4: PATCH /api/accounts/:id ──
console.log('\n── 4) PATCH customerType / legalName / registrationNo ──');
if (adminToken && createdAccountIds.length > 0) {
  const targetId = createdAccountIds[0]; // Corporate
  const r1 = await api(adminToken, `/api/accounts/${targetId}`, {
    method: 'PATCH',
    body: JSON.stringify({ customerType: 'Individual' }),
  });
  record('4a. PATCH Corporate → Individual', r1.status === 200 && r1.data?.customerType === 'Individual', `got=${r1.data?.customerType}`);

  const r2 = await api(adminToken, `/api/accounts/${targetId}`, {
    method: 'PATCH',
    body: JSON.stringify({ legalName: 'WR-A1 Updated Legal Name' }),
  });
  record('4b. PATCH legalName updated', r2.data?.legalName === 'WR-A1 Updated Legal Name');

  const r3 = await api(adminToken, `/api/accounts/${targetId}`, {
    method: 'PATCH',
    body: JSON.stringify({ registrationNo: 'R-NEW-999' }),
  });
  record('4c. PATCH registrationNo updated', r3.data?.registrationNo === 'R-NEW-999');

  const r4 = await api(adminToken, `/api/accounts/${targetId}`, {
    method: 'PATCH',
    body: JSON.stringify({ customerType: 'BogusType' }),
  });
  record('4d. PATCH invalid customerType → 400', r4.status === 400, `status=${r4.status}`);
}

// ── Section 5: RBAC ──
console.log('\n── 5) RBAC — Supervisor/Agent cannot write ──');
if (supToken && allowedCompanyId) {
  const r = await api(supToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ name: 'SupShouldFail', customerType: 'Corporate', companies: [{ companyId: allowedCompanyId }] }),
  });
  record('5a. Supervisor POST → 403', r.status === 403, `status=${r.status}`);
}
if (agentToken && allowedCompanyId) {
  const r = await api(agentToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ name: 'AgentShouldFail', customerType: 'Corporate', companies: [{ companyId: allowedCompanyId }] }),
  });
  record('5b. Agent POST → 403', r.status === 403, `status=${r.status}`);
}

// ── Section 6: Tenant scope (no cross-company leak via PATCH on out-of-scope account) ──
console.log('\n── 6) Tenant scope ──');
if (adminToken) {
  // Pick an account that belongs to a company NOT in admin's allowedCompanyIds.
  const admin = await prisma.user.findUnique({ where: { email: 'admin@varuna.dev' }, select: { id: true } });
  const adminCompanies = (await prisma.userCompany.findMany({
    where: { userId: admin.id, isActive: true },
    select: { companyId: true },
  })).map((c) => c.companyId);
  const outOfScopeAccount = await prisma.account.findFirst({
    where: {
      AND: [
        { companyId: { not: null } },
        { companyId: { notIn: adminCompanies } },
        { companies: { none: { companyId: { in: adminCompanies } } } },
      ],
    },
    select: { id: true },
  });
  if (outOfScopeAccount) {
    const r = await api(adminToken, `/api/accounts/${outOfScopeAccount.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ customerType: 'Individual' }),
    });
    record('6a. PATCH out-of-scope account → 403/404', [403, 404].includes(r.status), `status=${r.status}`);
  } else {
    record('6a. PATCH out-of-scope account → skipped (no candidate)', true, 'no out-of-scope account in DB');
  }
}

// ── Cleanup ──
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
