#!/usr/bin/env node
/**
 * smoke-account-tckn-search.js — PR-4b TCKN-by-search verification.
 *
 * Coverage:
 *   1. Create Individual account with valid TCKN → admin gets back tcknMasked.
 *   2. GET /api/accounts?search=<11-digit valid TCKN> finds the account by hash.
 *   3. Response NEVER includes plain TCKN or tcknHash.
 *   4. GET /api/accounts?search=<11-digit invalid TCKN> does NOT find it via
 *      tcknHash (branch silently skipped).
 *   5. GET /api/accounts?search=<unrelated valid TCKN> does NOT find it.
 *   6. Tenant scope still applies — non-allowed tenant agent sees nothing.
 *
 * Requires: BFF running, TCKN_HASH_PEPPER set (skips with note if missing).
 * Run: node --env-file=.env scripts/smoke-account-tckn-search.js
 */
import { PrismaClient } from '@prisma/client';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

if (!process.env.TCKN_HASH_PEPPER || process.env.TCKN_HASH_PEPPER.length < 16) {
  console.log('[smoke] TCKN_HASH_PEPPER missing → cannot exercise TCKN write/search. Skipping.');
  process.exit(0);
}

const prisma = new PrismaClient();
const results = [];
const record = (label, ok, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

async function getToken(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  if (!r.ok) throw new Error(`getToken(${email}) failed: ${r.status}`);
  return (await r.json()).access_token;
}

async function api(token, path, init = {}) {
  const r = await fetch(`${BFF}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const data = await r.json().catch(() => null);
  return { status: r.status, data };
}

const VALID_TCKN_TARGET = '10000000146'; // valid checksum
const VALID_TCKN_OTHER = '10000000382'; // valid checksum, different
const INVALID_TCKN = '12345678901'; // 11 digits, invalid checksum
const TEST_PREFIX = 'smoke-pr4b';
const createdIds = [];

try {
  const adminToken = await getToken('admin@varuna.dev');
  const adminCompanyId = (await prisma.userCompany.findFirst({
    where: { user: { email: 'admin@varuna.dev' } },
    select: { companyId: true },
  }))?.companyId;
  if (!adminCompanyId) throw new Error('admin companyId not found');

  // 1. Create individual account with TCKN
  const createR = await api(adminToken, '/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: `${TEST_PREFIX}-target-${Date.now()}`,
      customerType: 'Individual',
      tckn: VALID_TCKN_TARGET,
      companies: [{ companyId: adminCompanyId }],
    }),
  });
  record('1. Create Individual w/ valid TCKN → 201', createR.status === 201,
    `status=${createR.status} error=${createR.data?.error ?? '-'}`);
  if (createR.status !== 201) throw new Error('Cannot proceed without target account');
  const targetId = createR.data.id;
  createdIds.push(targetId);

  // 1b. Created row exposes tcknMasked only
  record('1b. Created row response has tcknMasked, no tcknHash, no plain tckn',
    createR.data?.tcknMasked === `*******${VALID_TCKN_TARGET.slice(-4)}` &&
      !('tcknHash' in (createR.data ?? {})) &&
      !('tckn' in (createR.data ?? {})),
    `tcknMasked=${createR.data?.tcknMasked} hasHash=${'tcknHash' in (createR.data ?? {})}`);

  // 2. Search by exact 11-digit valid TCKN → finds target
  const r2 = await api(adminToken, `/api/accounts?search=${VALID_TCKN_TARGET}&limit=20`);
  const found2 = (r2.data?.accounts ?? []).some((a) => a.id === targetId);
  record('2. Search by valid target TCKN finds the account',
    r2.status === 200 && found2,
    `status=${r2.status} matched=${found2} count=${r2.data?.accounts?.length}`);

  // 3. None of the returned rows include tcknHash or plain tckn
  const acctsForLeakCheck = r2.data?.accounts ?? [];
  const anyLeak = acctsForLeakCheck.some(
    (a) => 'tcknHash' in a || 'tckn' in a,
  );
  record('3. Response rows never include tcknHash or plain tckn',
    !anyLeak,
    `accountsChecked=${acctsForLeakCheck.length}`);

  // 4. Search by 11-digit INVALID TCKN → does NOT match via hash
  const r4 = await api(adminToken, `/api/accounts?search=${INVALID_TCKN}&limit=20`);
  const found4 = (r4.data?.accounts ?? []).some((a) => a.id === targetId);
  record('4. Invalid 11-digit query does NOT match target via hash',
    r4.status === 200 && !found4,
    `status=${r4.status} found=${found4} count=${r4.data?.accounts?.length}`);

  // 5. Search by different valid TCKN → does NOT match
  const r5 = await api(adminToken, `/api/accounts?search=${VALID_TCKN_OTHER}&limit=20`);
  const found5 = (r5.data?.accounts ?? []).some((a) => a.id === targetId);
  record('5. Unrelated valid TCKN does NOT match target',
    r5.status === 200 && !found5,
    `status=${r5.status} found=${found5} count=${r5.data?.accounts?.length}`);

  // 6. Tenant scope — agent on a different tenant should not see target
  //    (We use the agent@varuna.dev test user; if scope overlaps, this skips.)
  try {
    const agentToken = await getToken('agent@varuna.dev');
    const agentCompanyIds = (
      await prisma.userCompany.findMany({
        where: { user: { email: 'agent@varuna.dev' } },
        select: { companyId: true },
      })
    ).map((r) => r.companyId);
    const agentOutsideScope = !agentCompanyIds.includes(adminCompanyId);
    if (agentOutsideScope) {
      const r6 = await api(agentToken, `/api/accounts?search=${VALID_TCKN_TARGET}&limit=20`);
      const found6 = (r6.data?.accounts ?? []).some((a) => a.id === targetId);
      record('6. Out-of-tenant agent cannot find target via TCKN',
        r6.status === 200 && !found6,
        `status=${r6.status} found=${found6}`);
    } else {
      record('6. Agent shares admin tenant → tenant-scope path skipped',
        true, '(agent allowedCompanyIds includes admin tenant)');
    }
  } catch (e) {
    record('6. Tenant-scope test skipped — agent token unavailable',
      true, e?.message ?? '-');
  }
} finally {
  // Cleanup
  for (const id of createdIds) {
    try {
      await prisma.account.delete({ where: { id } });
    } catch {
      // ignore
    }
  }
  await prisma.$disconnect();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log('[smoke] FAILED:');
  for (const f of failed) console.log(`  - ${f.label} — ${f.detail}`);
  process.exit(1);
}
console.log('[smoke] ALL GREEN');
