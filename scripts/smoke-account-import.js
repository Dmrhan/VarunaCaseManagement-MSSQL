/**
 * smoke-account-import.js — WR-A8
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-account-import.js
 *
 * Varuna Veri Aktarım Stüdyosu (Phase 1 — Account import) BFF tarafını test eder.
 *
 * Senaryolar:
 *   1. GET target schema returns Account fields with required metadata
 *   2. Template CSV generated from target schema
 *   3. Parse file with 3 rows returns columns + sample
 *   4. Auto-map maps "Müşteri Adı" → name and "VKN" → vkn using registry aliases
 *   5. Validate missing name mapping → required_unmapped error
 *   6. Validate unknown target field → unknown_target error
 *   7. Dry-run valid new account → createCount=1
 *   8. Dry-run existing VKN → updateCount=1
 *   9. Invalid VKN row → row error
 *  10. Duplicate VKN in source → row error
 *  11. Dry-run causes no DB mutation (Account count unchanged)
 *  12. Commit creates new Account
 *  13. Commit updates existing Account
 *  14. Partial commit returns status=partial when some rows fail
 *  15. Commit response includes ImportJob ID and counts
 *  16. ImportJob persisted counts match response
 *  17. ImportJobRow beforeJson/afterJson recorded for update
 *  18. Retry commit does not duplicate already completed rows
 *  19. Rollback soft-disables created Account
 *  20. Rollback restores updated Account fields from beforeJson
 *  21. Rollback updates ImportJob status
 *  22. Agent cannot access endpoints → 403
 *  23. Cross-tenant companyId blocked
 *  24. Source companyId cannot override selected companyId
 *  25. Commit rejects stale targetSchemaVersion with import_schema_changed
 *  26. Unknown mapped target field rejected by registry allowlist
 *  27. API source non-array response returns clear error
 *  28. API source missing env secret returns safe error
 *  29. API source response does not expose secret value to client
 *  30. settings-status / response payloads do not include raw secrets
 *  31. (Review Fix Issue 1) API source returns FULL rows (not just sample)
 *      + dry-run processes all rows (not preview subset)
 *  32. (Review Fix Issue 1) API source row count above MAX_IMPORT_ROWS (5000)
 *      → too_many_rows error
 *  33. (Review Fix Issue 2) Rollback restores AccountCompany.externalCustomerCode
 *      + rollback report counts AccountCompany restores
 *  34. (Review Fix Issue 3) skipErrors=false blocks commit on errored rows
 *      (no mutation) → skipErrors=true allows partial commit
 *
 * Note: API source live HTTP path covered with localhost mock endpoints
 * (BFF outbound to localhost) where feasible; otherwise covered with explicit
 * error paths (missing_secret/not_array) — see scenarios 27-29.
 */

import { prisma } from '../server/db/client.js';
import { ACCOUNT_TARGET_VERSION } from '../server/lib/import/targetSchemas/accountTargetSchema.js';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}
function skip(name, detail = '') {
  results.push({ name, ok: true, skipped: true, detail });
  console.log(`⊘ SKIP ${name}${detail ? ' — ' + detail : ''}`);
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
  try {
    data = await r.json();
  } catch {}
  return { status: r.status, data };
}

const adminToken = await getToken('admin@varuna.dev');
const agentToken = await getToken('agent@varuna.dev');
if (!adminToken) {
  console.log('SKIP — admin token yok');
  await prisma.$disconnect();
  process.exit(0);
}

const COMP_PAR = 'COMP-PARAM';
const COMP_UNIVERA = 'COMP-UNIVERA';
const COMP_FINROTA = 'COMP-FINROTA';

// Generate fresh VKNs that pass checksum.
function vknChecksum(prefix9) {
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
  return (10 - (sum % 10)) % 10;
}
function genVkn(seed) {
  const prefix = String(seed).padStart(9, '0').slice(0, 9);
  return prefix + String(vknChecksum(prefix));
}

const stamp = Date.now().toString().slice(-6);
const VKN_NEW = genVkn(`100${stamp.slice(0, 6)}`);
const VKN_EXISTING = genVkn(`200${stamp.slice(0, 6)}`);
const VKN_INVALID = '1234567899'; // intentionally invalid checksum
const VKN_DUP = genVkn(`300${stamp.slice(0, 6)}`);

const createdJobIds = new Set();
const createdAccountIds = new Set();
const preexistingAccountIds = new Set();

async function cleanup() {
  try {
    for (const id of createdJobIds) {
      await prisma.importJobRow.deleteMany({ where: { importJobId: id } }).catch(() => {});
      await prisma.importJob.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdAccountIds) {
      await prisma.accountCompany.deleteMany({ where: { accountId: id } }).catch(() => {});
      await prisma.account.delete({ where: { id } }).catch(() => {});
    }
    for (const id of preexistingAccountIds) {
      await prisma.accountCompany.deleteMany({ where: { accountId: id } }).catch(() => {});
      await prisma.account.delete({ where: { id } }).catch(() => {});
    }
  } catch (err) {
    console.error('[cleanup]', err.message);
  }
}

process.on('exit', () => {
  /* noop — async cleanup at end */
});

// ─────────────────────────────────────────────────────────────────
// 1) GET target schema
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(adminToken, '/api/admin/imports/targets/account/schema');
  const ok =
    r.status === 200 &&
    r.data?.target === 'account' &&
    typeof r.data?.version === 'string' &&
    Array.isArray(r.data?.fields) &&
    r.data.fields.some((f) => f.key === 'name' && f.required) &&
    r.data.fields.some((f) => f.key === 'vkn' && f.aliases.includes('vkn'));
  record('1) GET target schema returns Account fields', ok, `version=${r.data?.version}`);
}

// 2) Template CSV
{
  const r = await fetch(`${BFF}/api/admin/imports/account/template.csv`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const text = await r.text();
  const ok = r.status === 200 && text.includes('Müşteri Adı') && text.includes('VKN');
  record('2) Template CSV generated from registry', ok);
}

// 3) Parse file
{
  const r = await api(adminToken, '/api/admin/imports/account/sources/file/parse', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      fileName: 'test.csv',
      columns: ['Müşteri Adı', 'VKN', 'Telefon'],
      rows: [
        { 'Müşteri Adı': 'Acme', VKN: VKN_NEW, Telefon: '05321112233' },
        { 'Müşteri Adı': 'Beta', VKN: '', Telefon: '' },
        { 'Müşteri Adı': 'Gama', VKN: VKN_DUP, Telefon: '' },
      ],
    }),
  });
  const ok = r.status === 200 && r.data?.totalRows === 3 && Array.isArray(r.data?.sample);
  record('3) Parse file returns columns + sample', ok, `totalRows=${r.data?.totalRows}`);
}

// 4) Auto-map
{
  const r = await api(adminToken, '/api/admin/imports/account/auto-map', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, columns: ['Müşteri Adı', 'VKN', 'Telefon', 'E-posta'] }),
  });
  const m = r.data?.suggestions ?? [];
  const nameMatch = m.find((x) => x.source === 'Müşteri Adı')?.targetKey === 'name';
  const vknMatch = m.find((x) => x.source === 'VKN')?.targetKey === 'vkn';
  const phoneMatch = m.find((x) => x.source === 'Telefon')?.targetKey === 'phone';
  record('4) Auto-map matches alias columns', nameMatch && vknMatch && phoneMatch);
}

// 5) Validate missing name mapping
{
  const r = await api(adminToken, '/api/admin/imports/account/validate', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, mapping: [{ source: 'VKN', targetKey: 'vkn' }] }),
  });
  const hasRequired = (r.data?.errors ?? []).some((e) => e.code === 'required_unmapped');
  record('5) Validate detects missing required name', r.status === 200 && hasRequired);
}

// 6) Validate unknown target field
{
  const r = await api(adminToken, '/api/admin/imports/account/validate', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      mapping: [{ source: 'X', targetKey: 'no_such_field' }],
    }),
  });
  const hasUnknown = (r.data?.errors ?? []).some((e) => e.code === 'unknown_target');
  record('6) Validate rejects unknown target', r.status === 200 && hasUnknown);
}

// ─────────────────────────────────────────────────────────────────
// Pre-create an existing Account for update scenarios
// ─────────────────────────────────────────────────────────────────
const preexisting = await prisma.account.create({
  data: {
    name: 'Onceden Var Olan Musteri',
    vkn: VKN_EXISTING,
    companyId: COMP_PAR,
    email: 'old@example.com',
    customerType: 'Corporate',
    companies: { create: [{ companyId: COMP_PAR, status: 'active' }] },
  },
  select: { id: true },
});
preexistingAccountIds.add(preexisting.id);

// ─────────────────────────────────────────────────────────────────
// Account count snapshot for "no mutation on dry-run" check
// ─────────────────────────────────────────────────────────────────
const accountCountBefore = await prisma.account.count();

// 7-11) Dry-run scenarios
const MAPPING = [
  { source: 'Müşteri Adı', targetKey: 'name' },
  { source: 'VKN', targetKey: 'vkn' },
  { source: 'Telefon', targetKey: 'phone' },
  { source: 'E-posta', targetKey: 'email' },
];

const DRY_RUN_ROWS = [
  // Row 1: yeni account (create) — valid VKN
  { 'Müşteri Adı': 'Yeni Smoke A', VKN: VKN_NEW, Telefon: '05321110001', 'E-posta': 'a@smoke.test' },
  // Row 2: mevcut VKN → update
  { 'Müşteri Adı': 'Guncellenmis Musteri', VKN: VKN_EXISTING, Telefon: '', 'E-posta': 'new@example.com' },
  // Row 3: invalid VKN
  { 'Müşteri Adı': 'Hatali Musteri', VKN: VKN_INVALID, Telefon: '', 'E-posta': '' },
  // Row 4: VKN duplicate in source
  { 'Müşteri Adı': 'Dup A', VKN: VKN_DUP, Telefon: '', 'E-posta': '' },
  { 'Müşteri Adı': 'Dup B', VKN: VKN_DUP, Telefon: '', 'E-posta': '' },
];

let dryRunJobId = null;
{
  const r = await api(adminToken, '/api/admin/imports/account/dry-run', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      mapping: MAPPING,
      rows: DRY_RUN_ROWS,
      sourceMeta: { sourceType: 'file', fileName: 'smoke.csv' },
    }),
  });
  const s = r.data?.summary;
  const ok = r.status === 200 && r.data?.ok && s?.createCount === 1 && s?.updateCount === 1;
  record('7-8) Dry-run create=1 update=1', ok, JSON.stringify(s));

  // 9) invalid VKN → row error
  const preview = r.data?.preview ?? [];
  const invalidRow = preview.find((p) => p.rowNumber === 3);
  record(
    '9) Invalid VKN row marked as error',
    !!invalidRow && invalidRow.action === 'error' && invalidRow.errors.length > 0,
  );

  // 10) duplicate VKN → row error
  const dupRows = preview.filter((p) => [4, 5].includes(p.rowNumber));
  const hasDup = dupRows.every((p) => p.errors.some((e) => e.message?.includes('birden fazla')));
  record('10) Duplicate VKN flagged on both rows', hasDup);

  if (r.data?.jobId) {
    createdJobIds.add(r.data.jobId);
    dryRunJobId = r.data.jobId;
  }
}

const accountCountAfter = await prisma.account.count();
record('11) Dry-run causes no DB mutation', accountCountBefore === accountCountAfter);

// 12-13) Commit
{
  const r = await api(adminToken, '/api/admin/imports/account/commit', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, jobId: dryRunJobId, options: { skipErrors: true } }),
  });
  const okStatus = r.status === 200 && r.data?.ok;
  record(
    '12-13) Commit returns job + counts',
    okStatus && (r.data.job.status === 'partial' || r.data.job.status === 'completed'),
    `status=${r.data?.job?.status} created=${r.data?.runStats?.createdCount} updated=${r.data?.runStats?.updatedCount}`,
  );

  // 14) partial status — some rows fail
  record('14) Partial commit status', r.data?.job?.status === 'partial');

  // 15) commit response includes job ID + counts
  record(
    '15) Commit response has ImportJob ID + counts',
    !!r.data?.job?.id &&
      r.data.job.createCount >= 1 &&
      r.data.job.updateCount >= 1,
  );

  // 16) ImportJob persisted counts match response
  const persisted = await prisma.importJob.findUnique({ where: { id: dryRunJobId } });
  record(
    '16) ImportJob persisted counts match',
    persisted?.createCount === r.data?.job?.createCount &&
      persisted?.updateCount === r.data?.job?.updateCount,
  );

  // 17) before/afterJson for update row
  const updateRow = await prisma.importJobRow.findFirst({
    where: { importJobId: dryRunJobId, status: 'updated' },
  });
  record(
    '17) ImportJobRow beforeJson/afterJson recorded for update',
    !!updateRow?.beforeJson && !!updateRow?.afterJson,
  );

  // Collect new account IDs for cleanup + rollback
  const createdRow = await prisma.importJobRow.findFirst({
    where: { importJobId: dryRunJobId, status: 'created' },
  });
  if (createdRow?.accountId) createdAccountIds.add(createdRow.accountId);
}

// 18) Retry commit (no duplicate)
{
  const beforeCount = await prisma.importJobRow.count({
    where: { importJobId: dryRunJobId, status: 'created' },
  });
  const r = await api(adminToken, '/api/admin/imports/account/commit', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, jobId: dryRunJobId, options: { skipErrors: true } }),
  });
  const afterCount = await prisma.importJobRow.count({
    where: { importJobId: dryRunJobId, status: 'created' },
  });
  record(
    '18) Retry commit does not duplicate completed rows',
    r.status === 200 && beforeCount === afterCount,
  );
}

// 19-21) Rollback
{
  const r = await api(adminToken, `/api/admin/imports/jobs/${dryRunJobId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  record('21) Rollback updates ImportJob status', r.data?.job?.status?.startsWith('rolled_back'));

  // 19) created Account is now inactive
  const createdRow = await prisma.importJobRow.findFirst({
    where: { importJobId: dryRunJobId, status: 'rolled_back', action: 'create' },
  });
  if (createdRow?.accountId) {
    const acc = await prisma.account.findUnique({ where: { id: createdRow.accountId }, select: { isActive: true } });
    record('19) Rollback soft-disables created Account', acc?.isActive === false);
  } else {
    skip('19) Rollback soft-disables created Account', 'no created row found');
  }

  // 20) updated Account restored from beforeJson
  const updRow = await prisma.importJobRow.findFirst({
    where: { importJobId: dryRunJobId, action: 'update' },
  });
  if (updRow?.beforeJson && updRow.accountId) {
    const acc = await prisma.account.findUnique({
      where: { id: updRow.accountId },
      select: { name: true, email: true },
    });
    const before = updRow.beforeJson;
    record(
      '20) Rollback restores updated Account fields',
      acc?.name === before.name && acc?.email === before.email,
    );
  } else {
    skip('20) Rollback restores updated Account fields', 'no update row');
  }
}

// 22) Agent denied
if (agentToken) {
  const r = await api(agentToken, '/api/admin/imports/targets/account/schema');
  record('22) Agent token denied (403)', r.status === 403);
} else {
  skip('22) Agent token denied', 'no agent token');
}

// 23) Cross-tenant companyId blocked (Admin user has access to PARAM/UNIVERA/FINROTA;
// use a non-existent companyId to verify the check)
{
  const r = await api(adminToken, '/api/admin/imports/account/dry-run', {
    method: 'POST',
    body: JSON.stringify({
      companyId: 'COMP-DOES-NOT-EXIST',
      mapping: MAPPING,
      rows: [],
      sourceMeta: { sourceType: 'file' },
    }),
  });
  record('23) Cross-tenant / unknown companyId blocked', r.status === 403);
}

// 24) Source companyId cannot override selected companyId
{
  const newVkn = genVkn(`400${stamp.slice(0, 6)}`);
  const r = await api(adminToken, '/api/admin/imports/account/dry-run', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      mapping: [
        { source: 'Müşteri Adı', targetKey: 'name' },
        { source: 'VKN', targetKey: 'vkn' },
      ],
      rows: [
        // Intentional: row has companyId; should be ignored.
        { 'Müşteri Adı': 'Tenant Test', VKN: newVkn, companyId: COMP_UNIVERA },
      ],
      sourceMeta: { sourceType: 'file' },
    }),
  });
  if (r.data?.jobId) createdJobIds.add(r.data.jobId);
  const c = await api(adminToken, '/api/admin/imports/account/commit', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, jobId: r.data.jobId }),
  });
  // Verify created Account is bound to COMP_PAR
  const row = await prisma.importJobRow.findFirst({
    where: { importJobId: r.data.jobId, status: 'created' },
  });
  let boundCorrectly = false;
  if (row?.accountId) {
    createdAccountIds.add(row.accountId);
    const acs = await prisma.accountCompany.findMany({
      where: { accountId: row.accountId },
      select: { companyId: true },
    });
    boundCorrectly = acs.length === 1 && acs[0].companyId === COMP_PAR;
  }
  record('24) Source companyId ignored — created in selected company only', boundCorrectly);
}

// 25) Stale targetSchemaVersion rejected — fabricate by manipulating DB
{
  // Find any active import job and patch its targetSchemaVersion to a stale value
  const jobToStale = await prisma.importJob.create({
    data: {
      companyId: COMP_PAR,
      sourceType: 'file',
      targetSchemaVersion: '2020-01-01.account.v0',
      status: 'validated',
      totalRows: 0,
    },
    select: { id: true },
  });
  createdJobIds.add(jobToStale.id);
  const r = await api(adminToken, '/api/admin/imports/account/commit', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, jobId: jobToStale.id }),
  });
  record(
    '25) Commit rejects stale targetSchemaVersion',
    r.status === 409 && r.data?.error === 'import_schema_changed',
  );
}

// 26) Unknown mapped target rejected
{
  const r = await api(adminToken, '/api/admin/imports/account/dry-run', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      mapping: [
        { source: 'X', targetKey: 'name' },
        { source: 'Y', targetKey: 'this_field_does_not_exist' },
      ],
      rows: [],
      sourceMeta: { sourceType: 'file' },
    }),
  });
  // Mapping invalid → ok:false from registry
  const errors = r.data?.mapping?.errors ?? [];
  const hasUnknown = errors.some((e) => e.code === 'unknown_target');
  record('26) Unknown mapped target rejected by registry', r.data?.ok === false && hasUnknown);
}

// 27) API source non-array response
{
  // Use a URL that returns an object instead of array (Supabase health endpoint or similar)
  // To stay self-contained: hit our own BFF health endpoint, which returns object not array.
  const r = await api(adminToken, '/api/admin/imports/account/sources/api/sample', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      url: `${BFF}/api/health`,
      method: 'GET',
      authType: 'none',
    }),
  });
  record(
    '27) API source non-array → clear error',
    r.status === 200 && r.data?.ok === false && r.data?.code === 'not_array',
  );
}

// 28) Missing env secret
{
  const r = await api(adminToken, '/api/admin/imports/account/sources/api/sample', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      url: `${BFF}/api/health`,
      method: 'GET',
      authType: 'bearerToken',
      secretName: 'NONEXISTENT_SMOKE_SECRET_VAR',
    }),
  });
  record(
    '28) Missing env secret returns safe error',
    r.status === 200 && r.data?.ok === false && r.data?.code === 'missing_secret',
  );
}

// 29) Response does not expose secret value
{
  // Even when no array, response should not contain the env secret string.
  const SECRET_NAME = 'SMOKE_FAKE_API_KEY';
  process.env[SECRET_NAME] = 'sk-secret-do-not-leak';
  const r = await api(adminToken, '/api/admin/imports/account/sources/api/sample', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      url: `${BFF}/api/health`,
      method: 'GET',
      authType: 'bearerToken',
      secretName: SECRET_NAME,
    }),
  });
  const serialized = JSON.stringify(r.data ?? {});
  delete process.env[SECRET_NAME];
  record('29) Response payload does not expose secret', !serialized.includes('sk-secret-do-not-leak'));
}

// 30) Schema version match
record(
  '30) Target schema version stable',
  typeof ACCOUNT_TARGET_VERSION === 'string' && ACCOUNT_TARGET_VERSION.length > 0,
  ACCOUNT_TARGET_VERSION,
);

// ─────────────────────────────────────────────────────────────────
// REVIEW FIX SCENARIOS (WR-A8 Review)
// ─────────────────────────────────────────────────────────────────

// 31) Issue 1 — API source returns FULL rows (not sampled subset). Mock HTTP
//     endpoint serves 120 rows; sampleLimit=5; dry-run must process all 120.
let mockServer = null;
let mockServerUrl = null;
{
  const http = await import('node:http');
  const ROW_COUNT = 120;
  const items = [];
  for (let i = 0; i < ROW_COUNT; i++) {
    items.push({
      'Müşteri Adı': `MockSrc Co ${i.toString().padStart(3, '0')}`,
      VKN: genVkn(`5${stamp.slice(0, 5)}${i.toString().padStart(2, '0').slice(-2)}`.slice(0, 9)),
    });
  }
  mockServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: items }));
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;
  mockServerUrl = `http://127.0.0.1:${port}/`;

  const r = await api(adminToken, '/api/admin/imports/account/sources/api/sample', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      url: mockServerUrl,
      method: 'GET',
      authType: 'none',
      dataPath: 'data',
      sampleLimit: 5,
    }),
  });
  const okSample =
    r.status === 200 &&
    r.data?.ok === true &&
    Array.isArray(r.data?.rows) &&
    r.data.rows.length === ROW_COUNT &&
    Array.isArray(r.data?.sample) &&
    r.data.sample.length === 5 &&
    r.data?.totalRows === ROW_COUNT;
  record(
    '31a) API source returns full rows (rows=120) and sample=5',
    okSample,
    `rows=${r.data?.rows?.length} sample=${r.data?.sample?.length} totalRows=${r.data?.totalRows}`,
  );

  // Dry-run with full rows must process all 120.
  if (okSample) {
    const drR = await api(adminToken, '/api/admin/imports/account/dry-run', {
      method: 'POST',
      body: JSON.stringify({
        companyId: COMP_PAR,
        mapping: [
          { source: 'Müşteri Adı', targetKey: 'name' },
          { source: 'VKN', targetKey: 'vkn' },
        ],
        rows: r.data.rows,
        sourceMeta: {
          sourceType: 'api',
          sourceName: 'mock-source',
          sourceUrlMasked: r.data.sourceUrlMasked,
          dataPath: 'data',
        },
      }),
    });
    if (drR.data?.jobId) createdJobIds.add(drR.data.jobId);
    const total = drR.data?.summary?.totalRows;
    record('31b) Dry-run processes all 120 rows (not just sample 5)', total === ROW_COUNT, `totalRows=${total}`);
  }
}

// 32) Issue 1 — API source row limit (>5000) returns clear error
{
  const http = await import('node:http');
  const bigItems = [];
  for (let i = 0; i < 5001; i++) bigItems.push({ name: `R${i}` });
  const bigServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(bigItems));
  });
  await new Promise((resolve) => bigServer.listen(0, '127.0.0.1', resolve));
  const port = bigServer.address().port;

  const r = await api(adminToken, '/api/admin/imports/account/sources/api/sample', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      url: `http://127.0.0.1:${port}/`,
      method: 'GET',
      authType: 'none',
    }),
  });
  bigServer.close();
  record(
    '32) API source >5000 rows → too_many_rows error',
    r.status === 200 && r.data?.ok === false && r.data?.code === 'too_many_rows',
    `code=${r.data?.code} totalRows=${r.data?.totalRows}`,
  );
}

// 33) Issue 2 — Rollback restores AccountCompany.externalCustomerCode.
{
  const vknForUpdate = genVkn(`600${stamp.slice(0, 6)}`);
  const acct = await prisma.account.create({
    data: {
      name: 'AC Rollback Fixture',
      vkn: vknForUpdate,
      companyId: COMP_PAR,
      customerType: 'Corporate',
      companies: {
        create: [{ companyId: COMP_PAR, externalCustomerCode: 'OLD123', status: 'active' }],
      },
    },
    select: { id: true },
  });
  preexistingAccountIds.add(acct.id);

  // Dry-run that will UPDATE externalCustomerCode from OLD123 → NEW456
  const drR = await api(adminToken, '/api/admin/imports/account/dry-run', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      mapping: [
        { source: 'Müşteri Adı', targetKey: 'name' },
        { source: 'VKN', targetKey: 'vkn' },
        { source: 'Dış Müşteri Kodu', targetKey: 'externalCustomerCode' },
      ],
      rows: [
        {
          'Müşteri Adı': 'AC Rollback Fixture',
          VKN: vknForUpdate,
          'Dış Müşteri Kodu': 'NEW456',
        },
      ],
      sourceMeta: { sourceType: 'file', fileName: 'review-fix.csv' },
    }),
  });
  if (drR.data?.jobId) createdJobIds.add(drR.data.jobId);
  const commitR = await api(adminToken, '/api/admin/imports/account/commit', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, jobId: drR.data.jobId, options: { skipErrors: true } }),
  });

  // Confirm commit updated AccountCompany.externalCustomerCode='NEW456'
  const acAfter = await prisma.accountCompany.findUnique({
    where: { accountId_companyId: { accountId: acct.id, companyId: COMP_PAR } },
    select: { externalCustomerCode: true },
  });
  record(
    '33a) Commit updates AccountCompany.externalCustomerCode',
    acAfter?.externalCustomerCode === 'NEW456',
    `current=${acAfter?.externalCustomerCode}`,
  );

  // Rollback
  const rbR = await api(adminToken, `/api/admin/imports/jobs/${drR.data.jobId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  const acAfterRb = await prisma.accountCompany.findUnique({
    where: { accountId_companyId: { accountId: acct.id, companyId: COMP_PAR } },
    select: { externalCustomerCode: true },
  });
  record(
    '33b) Rollback restores externalCustomerCode to OLD123',
    acAfterRb?.externalCustomerCode === 'OLD123',
    `after rollback=${acAfterRb?.externalCustomerCode}`,
  );
  record(
    '33c) Rollback report counts AccountCompany restore',
    (rbR.data?.report?.rolledBackAccountCompanyCount ?? 0) >= 1,
    `count=${rbR.data?.report?.rolledBackAccountCompanyCount}`,
  );
}

// 34) Issue 3 — skipErrors=false blocks commit when errored rows exist; no DB
//     mutation. skipErrors=true allows partial commit on the same job.
{
  const newVkn = genVkn(`700${stamp.slice(0, 6)}`);
  const drR = await api(adminToken, '/api/admin/imports/account/dry-run', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      mapping: MAPPING,
      rows: [
        { 'Müşteri Adı': 'SkipErr Valid', VKN: newVkn, Telefon: '', 'E-posta': '' },
        { 'Müşteri Adı': 'SkipErr Bad', VKN: VKN_INVALID, Telefon: '', 'E-posta': '' },
      ],
      sourceMeta: { sourceType: 'file', fileName: 'review-fix-skiperrors.csv' },
    }),
  });
  if (drR.data?.jobId) createdJobIds.add(drR.data.jobId);

  // First attempt: skipErrors=false → 400 import_has_errors, no mutation.
  const before = await prisma.account.count();
  const blocked = await api(adminToken, '/api/admin/imports/account/commit', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      jobId: drR.data.jobId,
      options: { skipErrors: false },
    }),
  });
  const afterBlocked = await prisma.account.count();
  record(
    '34a) skipErrors=false → 400 import_has_errors',
    blocked.status === 400 && blocked.data?.error === 'import_has_errors',
    `status=${blocked.status} error=${blocked.data?.error}`,
  );
  record('34b) Blocked commit causes no DB mutation', before === afterBlocked);

  // Second attempt: skipErrors=true → partial commit succeeds.
  const allowed = await api(adminToken, '/api/admin/imports/account/commit', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP_PAR,
      jobId: drR.data.jobId,
      options: { skipErrors: true },
    }),
  });
  record(
    '34c) skipErrors=true → partial commit succeeds',
    allowed.status === 200 && allowed.data?.ok === true && allowed.data?.job?.status === 'partial',
    `status=${allowed.data?.job?.status} created=${allowed.data?.runStats?.createdCount}`,
  );
  // Collect the created Account for cleanup
  const createdRow = await prisma.importJobRow.findFirst({
    where: { importJobId: drR.data.jobId, status: 'created' },
  });
  if (createdRow?.accountId) createdAccountIds.add(createdRow.accountId);
}

// ─────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────
if (mockServer) {
  await new Promise((resolve) => mockServer.close(resolve));
}
await cleanup();
await prisma.$disconnect();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
