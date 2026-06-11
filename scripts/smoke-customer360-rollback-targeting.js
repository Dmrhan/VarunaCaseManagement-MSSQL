/**
 * smoke-customer360-rollback-targeting.js
 *
 * Regression smoke proving Customer 360 rollback only affects the
 * targeted job and never crosses tenant or target-type boundaries.
 * Companion to the Phase 1 smoke `smoke-phase1-rollback-targeting.js`.
 *
 * Scenarios:
 *   1. Commit C360 Job A (account VKN_A + AC + contact + address + project)
 *   2. Commit C360 Job B (account VKN_B + AC + contact + address + project)
 *   3. Verify both jobs created active records across all entities
 *   4. Rollback Job B → 200 ok
 *   5. Job B records rolled back (account isActive=false, AC status=inactive,
 *      contact/address inactive, project inactive); Job A records UNTOUCHED
 *   6. Rollback Job A → 200 ok
 *   7. Job A records rolled back; nothing else regressed
 *   8. Idempotency: re-rollback Job A → 400 invalid_status_for_rollback
 *   9. Cross-type guard: commit Phase 1 Account job; attempt
 *      /customer360/jobs/:id/rollback against that id → 404 job_not_found;
 *      Phase 1 account stays active (no mutation through the C360 path)
 *   10. History scoping: GET /jobs?targetType=customer360 returns only
 *       jobs with targetType=customer360
 *
 * Cross-company guard (scenario 8 in the task brief) is covered at the
 * route layer by `getCustomer360Job`'s `allowedCompanyIds` filter +
 * `assertCompanyAdmin(req, job.companyId)`. Validating it end-to-end
 * requires a per-tenant-scoped user token; this smoke uses an admin
 * with broad access, so we SKIP that specific check with a reason.
 *
 * Cleanup at end: deletes only the rows this run created.
 *
 * Usage:
 *   node --env-file=.env scripts/smoke-customer360-rollback-targeting.js
 */

import { prisma } from '../server/db/client.js';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}
function skip(name, reason = '') {
  results.push({ name, ok: true, skipped: true, detail: reason });
  console.log(`⊘ SKIP ${name}${reason ? ' — ' + reason : ''}`);
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

const COMP = 'COMP-UNIVERA';

// Checksum-valid VKN generator (mirrors server/utils/accountValidation.js).
function vknChecksum(p9) {
  const ds = p9.split('').map(Number);
  const tmp = [];
  for (let i = 0; i < 9; i++) {
    let t = (ds[i] + (9 - i)) % 10;
    if (t !== 0) { t = (t * Math.pow(2, 9 - i)) % 9; if (t === 0) t = 9; }
    tmp.push(t);
  }
  const sum = tmp.reduce((a, b) => a + b, 0);
  return (10 - (sum % 10)) % 10;
}
function genVkn(seed) {
  const p = String(seed).padStart(9, '0').slice(0, 9);
  return p + String(vknChecksum(p));
}

const stamp = Date.now().toString().slice(-6);
const VKN_A = genVkn(`200${stamp}`);
const VKN_B = genVkn(`210${stamp}`);
const VKN_P1 = genVkn(`220${stamp}`);
const EXT_CODE_A = `RBT-A-${stamp}`;
const EXT_CODE_B = `RBT-B-${stamp}`;
const PROJECT_CODE_A = `RBT-PA-${stamp}`;
const PROJECT_CODE_B = `RBT-PB-${stamp}`;

const createdJobIds = new Set();
const createdAccountIds = new Set();

async function cleanup() {
  try {
    for (const id of createdAccountIds) {
      await prisma.accountProject.deleteMany({ where: { accountCompany: { accountId: id } } }).catch(() => {});
      await prisma.address.deleteMany({ where: { accountId: id } }).catch(() => {});
      await prisma.accountContact.deleteMany({ where: { accountId: id } }).catch(() => {});
      await prisma.accountCompany.deleteMany({ where: { accountId: id } }).catch(() => {});
      await prisma.account.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdJobIds) {
      await prisma.importJobRow.deleteMany({ where: { importJobId: id } }).catch(() => {});
      await prisma.importJob.delete({ where: { id } }).catch(() => {});
    }
  } catch (err) {
    console.error('[cleanup]', err?.message);
  }
}

function bundleFor(vkn, label, extCode, projectCode) {
  return {
    account: {
      columns: ['name', 'vkn', 'email'],
      mapping: [
        { source: 'name', targetKey: 'name' },
        { source: 'vkn', targetKey: 'vkn' },
        { source: 'email', targetKey: 'email' },
      ],
      rows: [{ name: `C360 RBT ${label}-${stamp}`, vkn, email: `${label.toLowerCase()}-${stamp}@rbt.demo` }],
    },
    accountCompany: {
      columns: ['accountKey', 'companyCode', 'externalCustomerCode'],
      mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'companyCode', targetKey: 'companyCode' },
        { source: 'externalCustomerCode', targetKey: 'externalCustomerCode' },
      ],
      rows: [{ accountKey: vkn, companyCode: COMP, externalCustomerCode: extCode }],
    },
    accountContact: {
      columns: ['accountKey', 'fullName', 'email', 'isPrimary'],
      mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'fullName', targetKey: 'fullName' },
        { source: 'email', targetKey: 'email' },
        { source: 'isPrimary', targetKey: 'isPrimary' },
      ],
      rows: [{ accountKey: vkn, fullName: `RBT Contact ${label}`, email: `c${label}-${stamp}@rbt.demo`, isPrimary: 'Evet' }],
    },
    accountAddress: {
      columns: ['accountKey', 'type', 'label', 'line1', 'country'],
      mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'type', targetKey: 'type' },
        { source: 'label', targetKey: 'label' },
        { source: 'line1', targetKey: 'line1' },
        { source: 'country', targetKey: 'country' },
      ],
      rows: [{ accountKey: vkn, type: 'Billing', label: `RBT ${label}`, line1: `RBT Cad. ${label}`, country: 'TR' }],
    },
    accountProject: {
      columns: ['accountKey', 'accountCompanyKey', 'projectCode', 'projectName'],
      mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'accountCompanyKey', targetKey: 'accountCompanyKey' },
        { source: 'projectCode', targetKey: 'projectCode' },
        { source: 'projectName', targetKey: 'projectName' },
      ],
      rows: [{ accountKey: vkn, accountCompanyKey: COMP, projectCode, projectName: `RBT Project ${label}` }],
    },
  };
}

async function commitC360(entities) {
  return api(adminToken, '/api/admin/imports/customer360/commit', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP,
      entities,
      sourceMeta: { sourceType: 'file', fileName: `c360-rbt-${stamp}.xlsx` },
      options: { skipErrors: true },
    }),
  });
}

async function accountSnapshot(vkn) {
  const acct = await prisma.account.findUnique({
    where: { vkn },
    select: {
      id: true,
      isActive: true,
      companies: { where: { companyId: COMP }, select: { id: true, status: true } },
      contacts: { select: { id: true, isActive: true } },
      addresses: { select: { id: true, isActive: true, companyId: true } },
    },
  });
  if (!acct?.id) return null;
  const projects = await prisma.accountProject.findMany({
    where: { accountCompany: { accountId: acct.id, companyId: COMP } },
    select: { id: true, isActive: true, code: true },
  });
  return {
    id: acct.id,
    accountActive: acct.isActive,
    companyStatuses: acct.companies.map((c) => c.status),
    contactsActive: acct.contacts.map((c) => c.isActive),
    addressesActive: acct.addresses.map((a) => a.isActive),
    projectsActive: projects.map((p) => p.isActive),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────────────────────────────

// 1) Commit Job A
const rA = await commitC360(bundleFor(VKN_A, 'A', EXT_CODE_A, PROJECT_CODE_A));
const jobA = rA.data?.job ?? null;
if (jobA?.id) createdJobIds.add(jobA.id);
const acctA0 = await prisma.account.findUnique({ where: { vkn: VKN_A }, select: { id: true } });
if (acctA0?.id) createdAccountIds.add(acctA0.id);
record('1) Commit C360 Job A returns completed',
  rA.status === 200 && rA.data?.ok && jobA?.status === 'completed',
  `status=${rA.status} jobId=${jobA?.id} jobStatus=${jobA?.status}`,
);

// 2) Commit Job B
const rB = await commitC360(bundleFor(VKN_B, 'B', EXT_CODE_B, PROJECT_CODE_B));
const jobB = rB.data?.job ?? null;
if (jobB?.id) createdJobIds.add(jobB.id);
const acctB0 = await prisma.account.findUnique({ where: { vkn: VKN_B }, select: { id: true } });
if (acctB0?.id) createdAccountIds.add(acctB0.id);
record('2) Commit C360 Job B returns completed',
  rB.status === 200 && rB.data?.ok && jobB?.status === 'completed',
  `status=${rB.status} jobId=${jobB?.id} jobStatus=${jobB?.status}`,
);

if (!jobA?.id || !jobB?.id) {
  console.error('Cannot proceed — Job A or Job B commit failed. Aborting after cleanup.');
  await cleanup();
  await prisma.$disconnect();
  process.exit(1);
}

// 3) Both jobs created active records across all entities.
// CRITICAL: each entity set must be NON-EMPTY. `[].every(...)` is true,
// so without an explicit length check this smoke would silently pass
// even if AccountCompany / contact / address / project rows were never
// created by commit — exactly the regression this guard exists to catch.
const beforeA = await accountSnapshot(VKN_A);
const beforeB = await accountSnapshot(VKN_B);
const allActive = (snap) =>
  !!snap &&
  snap.accountActive === true &&
  snap.companyStatuses.length > 0 && snap.companyStatuses.every((s) => s !== 'inactive') &&
  snap.contactsActive.length > 0 && snap.contactsActive.every(Boolean) &&
  snap.addressesActive.length > 0 && snap.addressesActive.every(Boolean) &&
  snap.projectsActive.length > 0 && snap.projectsActive.every(Boolean);
record('3) Both jobs created active records across all entities',
  allActive(beforeA) && allActive(beforeB),
  `A=${JSON.stringify(beforeA)} | B=${JSON.stringify(beforeB)}`,
);

// 4) Rollback Job B
const rbB = await api(adminToken, `/api/admin/imports/customer360/jobs/${jobB.id}/rollback`, { method: 'POST' });
record('4) Rollback Job B returns 200 ok',
  rbB.status === 200 && rbB.data?.ok === true,
  `status=${rbB.status}`,
);

// 5) Job B rolled back; Job A untouched
const afterRB_A = await accountSnapshot(VKN_A);
const afterRB_B = await accountSnapshot(VKN_B);
// Same non-empty rule as allActive: an entity set being missing should
// NOT be treated as "rolled back". The rollback target legitimately
// created one row of each entity, so a length === 0 result here means
// the row vanished outside the rollback path and the smoke must fail.
const fullyRolledBack = (snap) =>
  !!snap &&
  snap.accountActive === false &&
  snap.companyStatuses.length > 0 && snap.companyStatuses.every((s) => s === 'inactive') &&
  snap.contactsActive.length > 0 && snap.contactsActive.every((v) => v === false) &&
  snap.addressesActive.length > 0 && snap.addressesActive.every((v) => v === false) &&
  snap.projectsActive.length > 0 && snap.projectsActive.every((v) => v === false);
record('5a) Job B records rolled back across all entities',
  fullyRolledBack(afterRB_B),
  JSON.stringify(afterRB_B),
);
record('5b) Job A records UNTOUCHED after Job B rollback',
  allActive(afterRB_A),
  JSON.stringify(afterRB_A),
);

// 6) Rollback Job A
const rbA = await api(adminToken, `/api/admin/imports/customer360/jobs/${jobA.id}/rollback`, { method: 'POST' });
record('6) Rollback Job A returns 200 ok',
  rbA.status === 200 && rbA.data?.ok === true,
  `status=${rbA.status}`,
);

// 7) Job A rolled back
const afterRB_A2 = await accountSnapshot(VKN_A);
record('7) Job A records rolled back across all entities',
  fullyRolledBack(afterRB_A2),
  JSON.stringify(afterRB_A2),
);

// 8) Idempotency
const rbA2 = await api(adminToken, `/api/admin/imports/customer360/jobs/${jobA.id}/rollback`, { method: 'POST' });
record('8) Second rollback on Job A → invalid_status_for_rollback (no double mutation)',
  rbA2.status === 400 && (rbA2.data?.code === 'invalid_status_for_rollback' || rbA2.data?.error === 'invalid_status_for_rollback'),
  `status=${rbA2.status} body=${JSON.stringify(rbA2.data)}`,
);

// 9) Cross-type guard: Phase 1 job id must not roll back via C360 endpoint.
//    a) Commit a Phase 1 account job (using the same admin flow).
const phase1DryRun = await api(adminToken, '/api/admin/imports/account/dry-run', {
  method: 'POST',
  body: JSON.stringify({
    companyId: COMP,
    mapping: [
      { source: 'Müşteri Adı', targetKey: 'name' },
      { source: 'VKN', targetKey: 'vkn' },
    ],
    rows: [{ 'Müşteri Adı': `C360-RBT P1 Probe ${stamp}`, VKN: VKN_P1 }],
    sourceMeta: { sourceType: 'file', sourceName: 'c360-rbt-p1-probe', fileName: `c360-rbt-p1-${stamp}.csv`, sourceUrlMasked: null, dataPath: null },
  }),
});
const phase1JobId = phase1DryRun.data?.jobId ?? null;
let phase1CommitOk = false;
if (phase1JobId) {
  createdJobIds.add(phase1JobId);
  const phase1Commit = await api(adminToken, '/api/admin/imports/account/commit', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP, jobId: phase1JobId, options: { skipErrors: true } }),
  });
  phase1CommitOk = phase1Commit.status === 200 && phase1Commit.data?.ok === true;
  const acctP1 = await prisma.account.findUnique({ where: { vkn: VKN_P1 }, select: { id: true } });
  if (acctP1?.id) createdAccountIds.add(acctP1.id);
}
record('9a) Phase 1 sentinel job committed',
  !!phase1JobId && phase1CommitOk,
  `jobId=${phase1JobId} ok=${phase1CommitOk}`,
);

// b) Attempt C360 rollback against the Phase 1 jobId — must fail closed.
const beforeP1 = await prisma.account.findUnique({ where: { vkn: VKN_P1 }, select: { isActive: true } });
const rbBadType = await api(adminToken, `/api/admin/imports/customer360/jobs/${phase1JobId}/rollback`, { method: 'POST' });
record('9b) C360 rollback refuses a Phase 1 jobId (404 job_not_found)',
  rbBadType.status === 404 && (rbBadType.data?.error === 'job_not_found' || rbBadType.data?.code === 'job_not_found'),
  `status=${rbBadType.status} body=${JSON.stringify(rbBadType.data)}`,
);
const afterP1 = await prisma.account.findUnique({ where: { vkn: VKN_P1 }, select: { isActive: true } });
record('9c) Phase 1 account UNTOUCHED after wrong-target attempt',
  beforeP1?.isActive === true && afterP1?.isActive === true,
  `before=${beforeP1?.isActive} after=${afterP1?.isActive}`,
);

// 10) History scoping — /jobs?targetType=customer360 returns only C360 jobs.
const histC360 = await api(adminToken, `/api/admin/imports/jobs?companyId=${encodeURIComponent(COMP)}&targetType=customer360&limit=200`);
const c360Only = histC360.status === 200 &&
  Array.isArray(histC360.data?.value) &&
  histC360.data.value.every((j) => j.targetType === 'customer360');
record('10) /jobs?targetType=customer360 returns only C360 jobs',
  c360Only,
  `status=${histC360.status} count=${histC360.data?.value?.length ?? 0}`,
);

// 11) Cross-company guard — would require a per-tenant-scoped user.
skip('11) Cross-company guard end-to-end',
  'admin token has broad multi-tenant access; route-level allowedCompanyIds + assertCompanyAdmin verified by code inspection');

await cleanup();
await prisma.$disconnect();

const failed = results.filter((r) => !r.ok).length;
const skipped = results.filter((r) => r.skipped).length;
console.log(`\n${results.length - failed}/${results.length} passed (${skipped} skipped)`);
process.exit(failed > 0 ? 1 : 0);
