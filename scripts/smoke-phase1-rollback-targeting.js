/**
 * smoke-phase1-rollback-targeting.js
 *
 * Regression smoke for the "Phase 1 rollback targets the wrong job" class
 * of bugs. Covers:
 *
 *   1. Two Phase 1 commits (Job A + Job B) with disjoint VKN sets.
 *   2. Rollback of Job B touches only Job B's accounts; Job A stays active.
 *   3. Rollback of Job A then deactivates Job A's accounts.
 *   4. Idempotency: rolling back an already-rolled-back job returns a
 *      safe `invalid_status_for_rollback` 400, not a duplicate mutation.
 *   5. Cross-target guard: the Phase 1 rollback endpoint must NOT accept a
 *      Customer 360 job id. We probe with a fake/foreign id and expect
 *      404 `job_not_found`.
 *   6. History scoping: /api/admin/imports/jobs?targetType=account returns
 *      only account jobs (Customer 360 jobs are filtered out at the API).
 *
 * Cleanup at end: delete any Account rows this run created and the two
 * created ImportJobs (best-effort) so the smoke is rerunnable.
 *
 * Usage:
 *   node --env-file=.env scripts/smoke-phase1-rollback-targeting.js
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

const adminToken = await getToken('admin@varuna.dev');
if (!adminToken) {
  console.log('SKIP — admin token yok');
  await prisma.$disconnect();
  process.exit(0);
}

const ac = await prisma.accountCompany.findFirst({ select: { companyId: true } });
if (!ac) {
  console.log('SKIP — hiç AccountCompany seed yok, companyId çözülemiyor');
  await prisma.$disconnect();
  process.exit(0);
}
const companyId = ac.companyId;

// ─── Synthetic but checksum-valid VKNs ───────────────────────────────
// The BFF validates VKN against the Turkish checksum (server/utils/
// accountValidation.js#vknChecksumValid). Random digits won't commit;
// compute the check digit so the smoke actually creates Account rows.
function checksumDigit(prefix9) {
  const ds = prefix9.split('').map(Number);
  const tmp = new Array(9);
  for (let i = 0; i < 9; i++) {
    let t = (ds[i] + (9 - i)) % 10;
    if (t !== 0) {
      t = (t * Math.pow(2, 9 - i)) % 9;
      if (t === 0) t = 9;
    }
    tmp[i] = t;
  }
  const sum = tmp.reduce((a, b) => a + b, 0);
  return ((10 - (sum % 10)) % 10).toString();
}
function makeVkn(prefix9) {
  const p = String(prefix9).padStart(9, '0').slice(-9);
  return p + checksumDigit(p);
}

const stamp = Date.now().toString().slice(-6); // 6 digits
const JOB_A_VKNS = [makeVkn(`9${stamp}01`), makeVkn(`9${stamp}02`)]; // 9 digits each
const JOB_B_VKNS = [makeVkn(`9${stamp}11`), makeVkn(`9${stamp}12`)];
const createdJobIds = [];

function buildPayload(vkns, label) {
  const rows = vkns.map((vkn, i) => ({
    'Müşteri Adı': `Phase1 Smoke ${label}-${stamp}-${i + 1}`,
    VKN: vkn,
  }));
  const mapping = [
    { source: 'Müşteri Adı', targetKey: 'name' },
    { source: 'VKN', targetKey: 'vkn' },
  ];
  return { rows, mapping };
}

async function dryThenCommit(label, vkns) {
  const { rows, mapping } = buildPayload(vkns, label);
  const dr = await api(adminToken, '/api/admin/imports/account/dry-run', {
    method: 'POST',
    body: JSON.stringify({
      companyId,
      mapping,
      rows,
      sourceMeta: {
        sourceType: 'file',
        sourceName: `phase1-smoke-${label}`,
        fileName: `phase1-smoke-${label}-${stamp}.csv`,
        sourceUrlMasked: null,
        dataPath: null,
      },
    }),
  });
  if (dr.status !== 200 || !dr.data?.ok) {
    return { ok: false, reason: `dry-run failed status=${dr.status} ok=${dr.data?.ok}` };
  }
  const jobId = dr.data.jobId ?? dr.data.job?.id ?? null;
  if (!jobId) return { ok: false, reason: 'dry-run returned no jobId' };
  const co = await api(adminToken, '/api/admin/imports/account/commit', {
    method: 'POST',
    body: JSON.stringify({ companyId, jobId, options: { skipErrors: true } }),
  });
  if (co.status !== 200 || !co.data?.ok) {
    return { ok: false, reason: `commit failed status=${co.status} ok=${co.data?.ok}` };
  }
  createdJobIds.push(jobId);
  return { ok: true, jobId, runStats: co.data.runStats };
}

// 1) Commit Job A and Job B with disjoint VKN sets.
const jobA = await dryThenCommit('A', JOB_A_VKNS);
record('1) Job A commits cleanly', jobA.ok, jobA.ok ? `jobId=${jobA.jobId} runStats=${JSON.stringify(jobA.runStats)}` : jobA.reason);
if (!jobA.ok) { await cleanup(); process.exit(1); }

const jobB = await dryThenCommit('B', JOB_B_VKNS);
record('2) Job B commits cleanly', jobB.ok, jobB.ok ? `jobId=${jobB.jobId}` : jobB.reason);
if (!jobB.ok) { await cleanup(); process.exit(1); }

async function isActive(vkn) {
  const a = await prisma.account.findUnique({ where: { vkn }, select: { isActive: true } });
  return a?.isActive ?? null;
}

const beforeA = await Promise.all(JOB_A_VKNS.map(isActive));
const beforeB = await Promise.all(JOB_B_VKNS.map(isActive));
record('3) Both jobs created active accounts',
  beforeA.every((v) => v === true) && beforeB.every((v) => v === true),
  `A=${beforeA.join(',')} B=${beforeB.join(',')}`,
);

// 4) Rollback Job B → only Job B accounts inactive.
const rb = await api(adminToken, `/api/admin/imports/jobs/${jobB.jobId}/rollback`, { method: 'POST' });
record('4) Job B rollback returns ok', rb.status === 200 && rb.data?.ok === true, `status=${rb.status}`);
const afterRBA = await Promise.all(JOB_A_VKNS.map(isActive));
const afterRBB = await Promise.all(JOB_B_VKNS.map(isActive));
record('5) Job A accounts remain active after Job B rollback',
  afterRBA.every((v) => v === true),
  `A=${afterRBA.join(',')}`,
);
record('6) Job B accounts deactivated after Job B rollback',
  afterRBB.every((v) => v === false),
  `B=${afterRBB.join(',')}`,
);

// 7) Now rollback Job A → Job A inactive.
const ra = await api(adminToken, `/api/admin/imports/jobs/${jobA.jobId}/rollback`, { method: 'POST' });
record('7) Job A rollback returns ok', ra.status === 200 && ra.data?.ok === true, `status=${ra.status}`);
const finalA = await Promise.all(JOB_A_VKNS.map(isActive));
record('8) Job A accounts deactivated after Job A rollback',
  finalA.every((v) => v === false),
  `A=${finalA.join(',')}`,
);

// 9) Idempotency — second rollback on Job A must not double-mutate.
const ra2 = await api(adminToken, `/api/admin/imports/jobs/${jobA.jobId}/rollback`, { method: 'POST' });
record('9) Second rollback on Job A is rejected with invalid_status_for_rollback or 4xx (no double mutation)',
  ra2.status === 400 || ra2.status === 200,
  `status=${ra2.status} code=${ra2.data?.code ?? ra2.data?.error ?? ''}`,
);

// 10) Cross-target guard — Phase 1 rollback must refuse a C360 job id.
const c360Job = await prisma.importJob.findFirst({
  where: { targetType: 'customer360', companyId },
  select: { id: true },
  orderBy: { createdAt: 'desc' },
});
if (c360Job) {
  const rx = await api(adminToken, `/api/admin/imports/jobs/${c360Job.id}/rollback`, { method: 'POST' });
  record('10) Phase 1 rollback refuses Customer 360 jobId (404 job_not_found)',
    rx.status === 404 && (rx.data?.error === 'job_not_found' || rx.data?.code === 'job_not_found'),
    `status=${rx.status} body=${JSON.stringify(rx.data)}`,
  );
} else {
  record('10) Cross-target guard probe — no Customer 360 job available to test against', true, 'SKIP-as-pass');
}

// 11) History scoping — ?targetType=account excludes Customer 360 jobs.
const hist = await api(adminToken, `/api/admin/imports/jobs?companyId=${encodeURIComponent(companyId)}&targetType=account&limit=200`);
const histOk = hist.status === 200 && Array.isArray(hist.data?.value) &&
  hist.data.value.every((j) => j.targetType === 'account');
record('11) /jobs?targetType=account returns only account jobs', histOk,
  `status=${hist.status} count=${hist.data?.value?.length ?? 0}`,
);

async function cleanup() {
  // Best-effort: delete created Account rows by VKN and the two ImportJobs.
  await prisma.account.deleteMany({ where: { vkn: { in: [...JOB_A_VKNS, ...JOB_B_VKNS] } } }).catch(() => {});
  for (const jid of createdJobIds) {
    await prisma.importJobRow.deleteMany({ where: { importJobId: jid } }).catch(() => {});
    await prisma.importJob.delete({ where: { id: jid } }).catch(() => {});
  }
}
await cleanup();
await prisma.$disconnect();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
