/**
 * smoke-customer360-commit-rollback.js — WR-A8 Phase 2b
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-customer360-commit-rollback.js
 *
 * Customer 360 commit + rollback BFF testleri. Phase 2a foundation üzerine.
 *
 * Scenarios:
 *   1.  Commit requires entities OR jobId (400 entities_or_jobid_required)
 *   2.  Stale schema version rejected (manipulated targetSchemaVersion)
 *   3.  skipErrors=false blocks if any validation error
 *   4.  skipErrors=true commits valid rows + skips invalid
 *   5.  Commit creates Account before children
 *   6.  Commit binds AccountCompany to selected company only
 *   7.  Commit creates AccountContact
 *   8.  Commit creates Address (with companyId = selected)
 *   9.  Commit creates AccountProject scoped to AccountCompany
 *  10.  Invalid parent prevents child creation (parent error → children error)
 *  11.  AccountCompany missing → dependent project gets parent_account_company_unresolved
 *  12.  Retry commit does not duplicate (idempotent by jobId resume)
 *  13.  ImportJob persisted with entityCountsJson per-entity breakdown
 *  14.  ImportJobRow beforeJson/afterJson recorded per entity
 *  15.  Rollback restores updated Account fields
 *  16.  Rollback restores updated AccountCompany.externalCustomerCode
 *  17.  Rollback restores updated AccountContact.fullName
 *  18.  Rollback restores updated Address.line1
 *  19.  Rollback restores updated AccountProject.name
 *  20.  Rollback soft-deactivates created child rows (reverse dependency order)
 *  21.  Rollback failure surfaced not swallowed (induced AC delete before rollback)
 *  22.  Cross-tenant: source companyId cannot override selected (Phase 2a guard
 *       still holds; commit honors selected)
 *  23.  selected-company mismatch cannot commit (accountCompany.companyCode=other)
 *  24.  Phase 2a dry-run no-mutation contract preserved (commit path does NOT
 *       run when caller stops after dry-run)
 *  25.  Schema constants stable
 */

import { prisma } from '../server/db/client.js';
import { CUSTOMER_360_VERSION } from '../server/lib/import/targetSchemas/customer360TargetSchemas/index.js';

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
const VKN_A = genVkn(`100${stamp.slice(0, 6)}`);
const VKN_B = genVkn(`110${stamp.slice(0, 6)}`); // for tenant-mismatch test
const VKN_RB = genVkn(`120${stamp.slice(0, 6)}`); // rollback fixture
const VKN_FAIL = genVkn(`130${stamp.slice(0, 6)}`); // rollback failure fixture

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
      await prisma.accountProject.deleteMany({ where: { accountCompany: { accountId: id } } }).catch(() => {});
      await prisma.address.deleteMany({ where: { accountId: id } }).catch(() => {});
      await prisma.accountContact.deleteMany({ where: { accountId: id } }).catch(() => {});
      await prisma.accountCompany.deleteMany({ where: { accountId: id } }).catch(() => {});
      await prisma.account.delete({ where: { id } }).catch(() => {});
    }
    for (const id of preexistingAccountIds) {
      await prisma.accountProject.deleteMany({ where: { accountCompany: { accountId: id } } }).catch(() => {});
      await prisma.address.deleteMany({ where: { accountId: id } }).catch(() => {});
      await prisma.accountContact.deleteMany({ where: { accountId: id } }).catch(() => {});
      await prisma.accountCompany.deleteMany({ where: { accountId: id } }).catch(() => {});
      await prisma.account.delete({ where: { id } }).catch(() => {});
    }
  } catch (err) {
    console.error('[cleanup]', err?.message);
  }
}

function mappingFor(entity) {
  const M = {
    account: [
      { source: 'name', targetKey: 'name' },
      { source: 'vkn', targetKey: 'vkn' },
      { source: 'email', targetKey: 'email' },
    ],
    accountCompany: [
      { source: 'accountKey', targetKey: 'accountKey' },
      { source: 'companyCode', targetKey: 'companyCode' },
      { source: 'externalCustomerCode', targetKey: 'externalCustomerCode' },
    ],
    accountContact: [
      { source: 'accountKey', targetKey: 'accountKey' },
      { source: 'fullName', targetKey: 'fullName' },
      { source: 'email', targetKey: 'email' },
      { source: 'isPrimary', targetKey: 'isPrimary' },
    ],
    accountAddress: [
      { source: 'accountKey', targetKey: 'accountKey' },
      { source: 'type', targetKey: 'type' },
      { source: 'label', targetKey: 'label' },
      { source: 'line1', targetKey: 'line1' },
      { source: 'country', targetKey: 'country' },
    ],
    accountProject: [
      { source: 'accountKey', targetKey: 'accountKey' },
      { source: 'accountCompanyKey', targetKey: 'accountCompanyKey' },
      { source: 'projectCode', targetKey: 'projectCode' },
      { source: 'projectName', targetKey: 'projectName' },
    ],
  };
  return M[entity];
}

function bundleForAccount(vkn, name, opts = {}) {
  return {
    account: { columns: ['name','vkn','email'], mapping: mappingFor('account'),
      rows: [{ name, vkn, email: opts.email ?? '' }] },
    accountCompany: { columns: ['accountKey','companyCode','externalCustomerCode'], mapping: mappingFor('accountCompany'),
      rows: [{ accountKey: vkn, companyCode: opts.companyCode ?? COMP, externalCustomerCode: opts.code ?? '88001' }] },
    accountContact: { columns: ['accountKey','fullName','email','isPrimary'], mapping: mappingFor('accountContact'),
      rows: [{ accountKey: vkn, fullName: opts.contactName ?? 'P 1', email: opts.contactEmail ?? `c1-${stamp}@x.demo`, isPrimary: 'Evet' }] },
    accountAddress: { columns: ['accountKey','type','label','line1','country'], mapping: mappingFor('accountAddress'),
      rows: [{ accountKey: vkn, type: 'Billing', label: opts.addrLabel ?? 'Merkez', line1: opts.line1 ?? 'Demo Cad. 1', country: 'TR' }] },
    accountProject: { columns: ['accountKey','accountCompanyKey','projectCode','projectName'], mapping: mappingFor('accountProject'),
      rows: [{ accountKey: vkn, accountCompanyKey: COMP, projectCode: opts.projectCode ?? `P-${stamp}`, projectName: opts.projectName ?? 'Demo Project' }] },
  };
}

async function commit(entities, options = {}, jobId = null, companyId = COMP) {
  return api(adminToken, '/api/admin/imports/customer360/commit', {
    method: 'POST',
    body: JSON.stringify({ companyId, entities, sourceMeta: { sourceType: 'file', fileName: 'smoke.xlsx' }, options, jobId }),
  });
}

// 1) Commit requires entities OR jobId
{
  const r = await api(adminToken, '/api/admin/imports/customer360/commit', {
    method: 'POST', body: JSON.stringify({ companyId: COMP }),
  });
  record('1) Commit requires entities OR jobId', r.status === 400 && r.data?.error === 'entities_or_jobid_required');
}

// 2) Stale schema version rejected (fabricate by mutating a job's targetSchemaVersion).
{
  const job = await prisma.importJob.create({
    data: {
      companyId: COMP, targetType: 'customer360', sourceType: 'file',
      targetSchemaVersion: '2020-01-01.customer360.v0',
      status: 'running', totalRows: 0,
    },
    select: { id: true },
  });
  createdJobIds.add(job.id);
  const r = await commit(null, {}, job.id);
  record('2) Stale schema version rejected (import_schema_changed)', r.status === 409 && r.data?.error === 'import_schema_changed');
}

// 3) skipErrors=false + error → 400 import_has_errors
{
  const e = bundleForAccount(VKN_A, ''); // empty name → error
  const r = await commit(e, { skipErrors: false });
  record('3) skipErrors=false blocks if errors exist', r.status === 400 && r.data?.error === 'import_has_errors');
}

// 4-9) Full successful Customer 360 commit with one of each entity.
let job1;
{
  const e = bundleForAccount(VKN_A, 'C360 Smoke A');
  const r = await commit(e, { skipErrors: true });
  job1 = r.data?.job;
  if (job1?.id) createdJobIds.add(job1.id);
  const ec = r.data?.entityCounts ?? {};
  record('4) skipErrors=true commits valid rows', r.status === 200 && r.data?.ok && job1?.status === 'completed', `status=${job1?.status}`);
  record('5) Account created', ec.account?.created === 1, JSON.stringify(ec.account));
  record('6) AccountCompany created for selected company only', ec.accountCompany?.created === 1, JSON.stringify(ec.accountCompany));
  record('7) AccountContact created', ec.accountContact?.created === 1, JSON.stringify(ec.accountContact));
  record('8) Address created', ec.accountAddress?.created === 1, JSON.stringify(ec.accountAddress));
  record('9) AccountProject created (scoped to AC)', ec.accountProject?.created === 1, JSON.stringify(ec.accountProject));

  // Collect created accountId for cleanup
  const acct = await prisma.account.findUnique({ where: { vkn: VKN_A }, select: { id: true } });
  if (acct?.id) createdAccountIds.add(acct.id);
  // Verify scope: address.companyId === selected COMP
  const addr = acct?.id ? await prisma.address.findFirst({ where: { accountId: acct.id }, select: { companyId: true } }) : null;
  record('8a) Address.companyId == selected', addr?.companyId === COMP, `companyId=${addr?.companyId}`);
  // Verify project bound to correct AC
  const proj = acct?.id ? await prisma.accountProject.findFirst({
    where: { accountCompany: { accountId: acct.id, companyId: COMP } },
    select: { id: true, code: true },
  }) : null;
  record('9a) Project under (account, selected) AC', !!proj, `proj=${proj?.code}`);
}

// 10) Invalid parent (account error) prevents child creation.
{
  const vkn = genVkn(`200${stamp.slice(0,6)}`);
  const e = bundleForAccount(vkn, ''); // invalid (empty name)
  // Also add a child contact under same accountKey
  e.accountContact.rows = [{ accountKey: vkn, fullName: 'Orphan Child', email: `oc-${stamp}@x.demo`, isPrimary: 'Hayır' }];
  const r = await commit(e, { skipErrors: true });
  if (r.data?.job?.id) createdJobIds.add(r.data.job.id);
  const ec = r.data?.entityCounts;
  // Account row erred + contact row also erred because parent_account_unresolved
  record('10) Invalid parent prevents child creation',
    (ec?.account?.error ?? 0) >= 1 && (ec?.accountContact?.error ?? 0) >= 1,
    `account.error=${ec?.account?.error} contact.error=${ec?.accountContact?.error}`);
}

// 11) AccountCompany missing → project gets parent_account_company_unresolved.
{
  const vkn = genVkn(`300${stamp.slice(0,6)}`);
  const e = bundleForAccount(vkn, 'C360 NoAC');
  // Drop accountCompany row so project has no parent AC
  e.accountCompany.rows = [];
  const r = await commit(e, { skipErrors: true });
  if (r.data?.job?.id) createdJobIds.add(r.data.job.id);
  const ec = r.data?.entityCounts;
  // Project should error (no AC). Account created.
  const projErrorOk = (ec?.accountProject?.error ?? 0) === 1 && (ec?.accountProject?.created ?? 0) === 0;
  record('11) AccountCompany missing → Project parent_account_company_unresolved', projErrorOk,
    JSON.stringify(ec?.accountProject));
  const acct = await prisma.account.findUnique({ where: { vkn }, select: { id: true } });
  if (acct?.id) createdAccountIds.add(acct.id);
}

// 12) Retry commit (resume) does not duplicate.
{
  const e = bundleForAccount(genVkn(`400${stamp.slice(0,6)}`), 'C360 Resume');
  const r1 = await commit(e, { skipErrors: true });
  if (r1.data?.job?.id) createdJobIds.add(r1.data.job.id);
  const acct = await prisma.account.findUnique({ where: { vkn: e.account.rows[0].vkn }, select: { id: true } });
  if (acct?.id) createdAccountIds.add(acct.id);
  const acsBefore = await prisma.accountCompany.count({ where: { accountId: acct?.id ?? 'none' } });
  // Retry with same jobId
  const r2 = await commit(null, { skipErrors: true }, r1.data?.job?.id);
  const acsAfter = await prisma.accountCompany.count({ where: { accountId: acct?.id ?? 'none' } });
  record('12) Retry commit by jobId does not duplicate',
    r2.status === 200 && acsBefore === acsAfter,
    `acsBefore=${acsBefore} acsAfter=${acsAfter}`);
}

// 13) ImportJob persisted with entityCountsJson
{
  if (job1?.id) {
    const persisted = await prisma.importJob.findUnique({ where: { id: job1.id }, select: { entityCountsJson: true, targetType: true } });
    const ok = persisted?.targetType === 'customer360' && persisted?.entityCountsJson
      && persisted.entityCountsJson.account
      && persisted.entityCountsJson.accountCompany
      && persisted.entityCountsJson.accountProject;
    record('13) ImportJob.entityCountsJson persisted per-entity', !!ok);
  } else {
    skip('13) entityCountsJson persisted', 'no job1');
  }
}

// 14) ImportJobRow beforeJson/afterJson recorded per entity (for updated entities,
//     beforeJson must be set). We'll trigger by re-importing same data → update path.
let rbJobId;
{
  // Pre-create an account that will be UPDATED by the import.
  const existingAcct = await prisma.account.create({
    data: {
      name: 'Old Name', vkn: VKN_RB, customerType: 'Corporate',
      companies: { create: [{ companyId: COMP, externalCustomerCode: 'OLD-RB', status: 'active' }] },
    },
    select: { id: true, companies: { where: { companyId: COMP }, select: { id: true } } },
  });
  preexistingAccountIds.add(existingAcct.id);

  // Pre-create an address for update
  await prisma.address.create({
    data: {
      accountId: existingAcct.id, companyId: COMP, type: 'Billing',
      label: 'HQ', line1: 'OLD Line 1', country: 'TR',
    },
  });
  await prisma.accountContact.create({
    data: {
      accountId: existingAcct.id, fullName: 'Old Contact',
      email: `rb-${stamp}@x.demo`, isPrimary: true,
    },
  });
  await prisma.accountProject.create({
    data: {
      accountCompanyId: existingAcct.companies[0].id,
      code: `RB-${stamp}`, name: 'Old Project Name', status: 'Active',
    },
  });

  // Now run import which UPDATES all of them
  const e = bundleForAccount(VKN_RB, 'New Name', {
    code: 'NEW-RB', contactEmail: `rb-${stamp}@x.demo`, contactName: 'New Contact',
    addrLabel: 'HQ', line1: 'NEW Line 1',
    projectCode: `RB-${stamp}`, projectName: 'New Project Name',
  });
  const r = await commit(e, { skipErrors: true });
  rbJobId = r.data?.job?.id;
  if (rbJobId) createdJobIds.add(rbJobId);

  // Verify a row with status='updated' has beforeJson + afterJson populated.
  const updatedRow = await prisma.importJobRow.findFirst({
    where: { importJobId: rbJobId, entityType: 'accountContact', status: 'updated' },
    select: { beforeJson: true, afterJson: true },
  });
  record('14) Updated ImportJobRow has beforeJson + afterJson',
    !!updatedRow?.beforeJson && !!updatedRow?.afterJson,
    `before=${!!updatedRow?.beforeJson} after=${!!updatedRow?.afterJson}`);
}

// 15-19) Rollback restores per-entity updates.
{
  // Snapshot DB BEFORE rollback (post-commit "NEW" values)
  const beforeRb = await prisma.account.findUnique({ where: { vkn: VKN_RB }, select: { name: true } });
  const r = await api(adminToken, `/api/admin/imports/customer360/jobs/${rbJobId}/rollback`, {
    method: 'POST', body: JSON.stringify({}),
  });
  // After rollback: account.name restored to OLD
  const afterRb = await prisma.account.findUnique({ where: { vkn: VKN_RB }, select: { id: true, name: true } });
  record('15) Rollback restores Account name (NEW → OLD)',
    beforeRb?.name === 'New Name' && afterRb?.name === 'Old Name',
    `before=${beforeRb?.name} after=${afterRb?.name}`);

  // AccountCompany.externalCustomerCode
  const ac = afterRb?.id ? await prisma.accountCompany.findUnique({
    where: { accountId_companyId: { accountId: afterRb.id, companyId: COMP } },
    select: { externalCustomerCode: true },
  }) : null;
  record('16) Rollback restores AccountCompany.externalCustomerCode (NEW-RB → OLD-RB)',
    ac?.externalCustomerCode === 'OLD-RB', `current=${ac?.externalCustomerCode}`);

  // Contact.fullName
  const contact = afterRb?.id ? await prisma.accountContact.findFirst({
    where: { accountId: afterRb.id, email: `rb-${stamp}@x.demo` }, select: { fullName: true },
  }) : null;
  record('17) Rollback restores AccountContact.fullName',
    contact?.fullName === 'Old Contact', `current=${contact?.fullName}`);

  // Address.line1
  const addr = afterRb?.id ? await prisma.address.findFirst({
    where: { accountId: afterRb.id, type: 'Billing', label: 'HQ' }, select: { line1: true },
  }) : null;
  record('18) Rollback restores Address.line1',
    addr?.line1 === 'OLD Line 1', `current=${addr?.line1}`);

  // Project.name
  const proj = afterRb?.id ? await prisma.accountProject.findFirst({
    where: { accountCompany: { accountId: afterRb.id, companyId: COMP }, code: `RB-${stamp}` },
    select: { name: true, status: true },
  }) : null;
  record('19) Rollback restores AccountProject.name',
    proj?.name === 'Old Project Name', `current=${proj?.name}`);

  // 20) Reverse-order soft-deactivate: in scenario 4-9 we CREATED all entities.
  //     Rollback that job → child rows isActive=false / status=inactive.
  if (job1?.id) {
    const rbR = await api(adminToken, `/api/admin/imports/customer360/jobs/${job1.id}/rollback`, {
      method: 'POST', body: JSON.stringify({}),
    });
    const rbAcct = await prisma.account.findUnique({ where: { vkn: VKN_A }, select: { id: true, isActive: true } });
    const rbAc = rbAcct?.id ? await prisma.accountCompany.findFirst({ where: { accountId: rbAcct.id }, select: { status: true } }) : null;
    const rbContact = rbAcct?.id ? await prisma.accountContact.findFirst({ where: { accountId: rbAcct.id }, select: { isActive: true } }) : null;
    const rbAddr = rbAcct?.id ? await prisma.address.findFirst({ where: { accountId: rbAcct.id }, select: { isActive: true } }) : null;
    const rbProj = rbAcct?.id ? await prisma.accountProject.findFirst({
      where: { accountCompany: { accountId: rbAcct.id } }, select: { isActive: true, status: true },
    }) : null;
    record('20) Rollback soft-deactivates created child rows reverse-order',
      rbAcct?.isActive === false && rbAc?.status === 'inactive' &&
      rbContact?.isActive === false && rbAddr?.isActive === false &&
      rbProj?.isActive === false,
      `acct.isActive=${rbAcct?.isActive} ac.status=${rbAc?.status} contact.isActive=${rbContact?.isActive} addr.isActive=${rbAddr?.isActive} proj.isActive=${rbProj?.isActive}`);
  } else {
    skip('20) Rollback soft-deactivates created child rows reverse-order', 'no job1');
  }
}

// 21) Rollback failure surfaced (induce by deleting a created Address before rollback).
{
  const e = bundleForAccount(VKN_FAIL, 'C360 FailRb', { code: 'FAIL', projectCode: `PF-${stamp}`, addrLabel: 'FailHQ' });
  const r = await commit(e, { skipErrors: true });
  const jobId = r.data?.job?.id;
  if (jobId) createdJobIds.add(jobId);
  const acct = await prisma.account.findUnique({ where: { vkn: VKN_FAIL }, select: { id: true } });
  if (acct?.id) createdAccountIds.add(acct.id);

  // Induce failure: find created Project's recordId and delete it FROM DB before rollback
  // so the rollback restore step throws (recordId no longer exists).
  const projRow = await prisma.importJobRow.findFirst({
    where: { importJobId: jobId, entityType: 'accountProject', status: 'created' },
    select: { recordId: true },
  });
  if (projRow?.recordId) {
    await prisma.accountProject.delete({ where: { id: projRow.recordId } }).catch(() => {});
  }
  const rbR = await api(adminToken, `/api/admin/imports/customer360/jobs/${jobId}/rollback`, {
    method: 'POST', body: JSON.stringify({}),
  });
  const failed = rbR.data?.report?.failedCount ?? rbR.data?.report?.errorCount ?? 0;
  const isPartial = rbR.data?.job?.status === 'rollback_partial';
  record('21) Rollback failure surfaced (status=rollback_partial, errorCount≥1)', failed >= 1 && isPartial,
    `failed=${failed} status=${rbR.data?.job?.status}`);
}

// 22) Source companyId field in row cannot override selected (Phase 2a guard).
{
  const vkn = genVkn(`500${stamp.slice(0,6)}`);
  // Unique externalCustomerCode (other scenarios use '88001' default — (companyId, externalCustomerCode) is unique).
  const e = bundleForAccount(vkn, 'Tenant Test', { code: `T22-${stamp}`, projectCode: `T22P-${stamp}`, contactEmail: `t22-${stamp}@x.demo`, addrLabel: 'T22-HQ' });
  // Add a phantom companyId field to account rows
  e.account.columns = ['name','vkn','email','companyId'];
  e.account.rows[0].companyId = 'COMP-PARAM';
  const r = await commit(e, { skipErrors: true });
  if (r.data?.job?.id) createdJobIds.add(r.data.job.id);
  // Verify only selected company's AC exists
  const acct = await prisma.account.findUnique({ where: { vkn }, select: { id: true } });
  if (acct?.id) createdAccountIds.add(acct.id);
  const acs = acct?.id ? await prisma.accountCompany.findMany({ where: { accountId: acct.id }, select: { companyId: true } }) : [];
  record('22) Source companyId yok sayılır; AC yalnız selected company',
    acs.length === 1 && acs[0].companyId === COMP,
    `acs=${JSON.stringify(acs.map(a => a.companyId))}`);
}

// 23) accountCompany.companyCode mismatch cannot commit.
{
  const vkn = genVkn(`600${stamp.slice(0,6)}`);
  const e = bundleForAccount(vkn, 'Mismatch', { companyCode: 'COMP-PARAM' });
  const r = await commit(e, { skipErrors: false });
  record('23) accountCompany mismatch → blocks commit (or partial with error)',
    r.status === 400 && r.data?.error === 'import_has_errors',
    `status=${r.status} error=${r.data?.error}`);
}

// 24) Phase 2a dry-run no-mutation contract (smoke regression check):
//     run a dry-run and verify Account count Δ=0.
{
  const before = await prisma.account.count();
  const e = bundleForAccount(genVkn(`700${stamp.slice(0,6)}`), 'DryNoMutate');
  await api(adminToken, '/api/admin/imports/customer360/dry-run', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP, entities: e, sourceMeta: { sourceType: 'file' },
    }),
  });
  const after = await prisma.account.count();
  record('24) Phase 2a dry-run still no-mutation', before === after, `Δ=${after - before}`);
}

// 25) Schema constants stable
record('25) Customer 360 schema version stable',
  typeof CUSTOMER_360_VERSION === 'string' && CUSTOMER_360_VERSION.length > 0,
  CUSTOMER_360_VERSION);

// ─────────────────────────────────────────────────────────────────
// WR-A8 Phase 2b HOTFIX (Codex review #210):
//   26)  P1: Address upsert tenant scope — Customer 360 commit for company A
//        must not touch company B address of the same global Account.
//   27)  P1: Default demotion scoped — demoting selected company's default
//        must not affect other company's default.
//   28)  P1: Rollback restores only selected-company address.
//   29)  P2: ImportJobRow.parentRowNumber populated for child entities.
// ─────────────────────────────────────────────────────────────────

// 26-28) Multi-tenant Address isolation
const VKN_XT = genVkn(`910${stamp.slice(0,6)}`);
let xtAccountId = null;
let xtUniveraAddrId = null;
let xtParamAddrId = null;
{
  // Build a global Account with two Addresses for the SAME type+label, one per company.
  const acct = await prisma.account.create({
    data: {
      name: 'XTenant Addr Fixture',
      vkn: VKN_XT,
      customerType: 'Corporate',
      companies: {
        create: [
          { companyId: COMP, status: 'active' },        // UNIVERA
          { companyId: 'COMP-PARAM', status: 'active' }, // PARAM
        ],
      },
    },
    select: { id: true },
  });
  xtAccountId = acct.id;
  preexistingAccountIds.add(acct.id);

  const univeraAddr = await prisma.address.create({
    data: {
      accountId: acct.id, companyId: COMP, type: 'Billing',
      label: 'HQ', line1: 'UNIVERA-OLD line', country: 'TR', isDefault: true,
    },
    select: { id: true },
  });
  const paramAddr = await prisma.address.create({
    data: {
      accountId: acct.id, companyId: 'COMP-PARAM', type: 'Billing',
      label: 'HQ', line1: 'PARAM-untouched', country: 'TR', isDefault: true,
    },
    select: { id: true },
  });
  xtUniveraAddrId = univeraAddr.id;
  xtParamAddrId = paramAddr.id;

  // Commit Customer 360 (selected company = UNIVERA) that updates the address
  // with same type+label → MUST hit UNIVERA address only.
  const e = bundleForAccount(VKN_XT, 'XTenant Addr Fixture', {
    code: `XT-${stamp}`, projectCode: `XTP-${stamp}`,
    contactEmail: `xt-${stamp}@x.demo`,
    addrLabel: 'HQ', line1: 'UNIVERA-NEW line',
  });
  const r = await commit(e, { skipErrors: true });
  if (r.data?.job?.id) createdJobIds.add(r.data.job.id);

  const univeraAfter = await prisma.address.findUnique({ where: { id: xtUniveraAddrId }, select: { line1: true, isDefault: true } });
  const paramAfter = await prisma.address.findUnique({ where: { id: xtParamAddrId }, select: { line1: true, isDefault: true } });

  record(
    '26) Address upsert scope: UNIVERA address updated (line1 NEW)',
    univeraAfter?.line1 === 'UNIVERA-NEW line',
    `univera.line1=${univeraAfter?.line1}`,
  );
  record(
    '26b) Address upsert scope: PARAM address untouched',
    paramAfter?.line1 === 'PARAM-untouched',
    `param.line1=${paramAfter?.line1}`,
  );

  // 27) Default demotion scoped — both rows had isDefault=true initially.
  //     After commit, UNIVERA default should remain (1 default per company),
  //     PARAM should NOT have been demoted.
  record(
    '27) Default demotion scoped: PARAM isDefault still true (not demoted by UNIVERA import)',
    paramAfter?.isDefault === true,
    `param.isDefault=${paramAfter?.isDefault}`,
  );

  // 28) Rollback restores UNIVERA, leaves PARAM alone.
  const rbR = await api(adminToken, `/api/admin/imports/customer360/jobs/${r.data.job.id}/rollback`, {
    method: 'POST', body: JSON.stringify({}),
  });
  const univeraAfterRb = await prisma.address.findUnique({ where: { id: xtUniveraAddrId }, select: { line1: true } });
  const paramAfterRb = await prisma.address.findUnique({ where: { id: xtParamAddrId }, select: { line1: true } });
  record(
    '28) Rollback restores UNIVERA address',
    univeraAfterRb?.line1 === 'UNIVERA-OLD line',
    `univera.line1=${univeraAfterRb?.line1}`,
  );
  record(
    '28b) Rollback leaves PARAM address untouched',
    paramAfterRb?.line1 === 'PARAM-untouched',
    `param.line1=${paramAfterRb?.line1}`,
  );
}

// 29) parentRowNumber populated for child entities
{
  const vkn = genVkn(`920${stamp.slice(0,6)}`);
  const e = bundleForAccount(vkn, 'Parent Audit Fixture', {
    code: `PA-${stamp}`, projectCode: `PAP-${stamp}`, contactEmail: `pa-${stamp}@x.demo`, addrLabel: 'PA-HQ',
  });
  const r = await commit(e, { skipErrors: true });
  if (r.data?.job?.id) createdJobIds.add(r.data.job.id);
  const acct = await prisma.account.findUnique({ where: { vkn }, select: { id: true } });
  if (acct?.id) createdAccountIds.add(acct.id);

  const allRows = await prisma.importJobRow.findMany({
    where: { importJobId: r.data.job.id },
    select: { entityType: true, rowNumber: true, parentRowNumber: true, status: true },
    orderBy: [{ entityType: 'asc' }, { rowNumber: 'asc' }],
  });
  const acctRow = allRows.find((row) => row.entityType === 'account');
  const acCompanyRow = allRows.find((row) => row.entityType === 'accountCompany');
  const contactRow = allRows.find((row) => row.entityType === 'accountContact');
  const addressRow = allRows.find((row) => row.entityType === 'accountAddress');
  const projectRow = allRows.find((row) => row.entityType === 'accountProject');

  record(
    '29a) Account row parentRowNumber is null (no parent)',
    acctRow?.parentRowNumber === null,
    `account.parent=${acctRow?.parentRowNumber}`,
  );
  record(
    '29b) AccountCompany child points to Account row',
    acCompanyRow?.parentRowNumber === acctRow?.rowNumber,
    `accountCompany.parent=${acCompanyRow?.parentRowNumber} expected=${acctRow?.rowNumber}`,
  );
  record(
    '29c) AccountContact child points to Account row',
    contactRow?.parentRowNumber === acctRow?.rowNumber,
    `accountContact.parent=${contactRow?.parentRowNumber}`,
  );
  record(
    '29d) Address child points to Account row',
    addressRow?.parentRowNumber === acctRow?.rowNumber,
    `accountAddress.parent=${addressRow?.parentRowNumber}`,
  );
  record(
    '29e) Project child points to AccountCompany row (preferred parent)',
    projectRow?.parentRowNumber === acCompanyRow?.rowNumber,
    `accountProject.parent=${projectRow?.parentRowNumber} expected=${acCompanyRow?.rowNumber}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 30) Missing-VKN scenarios — no_tax_id warning, commit succeeds
// ─────────────────────────────────────────────────────────────────
// Customer 360 mirrors Phase 1: a row with a customer name but no VKN
// must commit successfully with a `no_tax_id` warning and no fake VKN
// inserted in DB. Operators must never be pushed to invent identity.
{
  const noVknName = `C360 NoVkn Smoke ${stamp}`;
  const noVknBundle = {
    account: {
      columns: ['name', 'vkn', 'email'],
      mapping: mappingFor('account'),
      rows: [{ name: noVknName, vkn: '', email: `novkn-${stamp}@smoke.demo` }],
    },
    // Children empty — keep the test focused on the account path.
    accountCompany: { columns: [], mapping: [], rows: [] },
    accountContact: { columns: [], mapping: [], rows: [] },
    accountAddress: { columns: [], mapping: [], rows: [] },
    accountProject: { columns: [], mapping: [], rows: [] },
  };
  const r = await commit(noVknBundle, { skipErrors: true });
  const job = r.data?.job;
  if (job?.id) createdJobIds.add(job.id);
  const created = await prisma.account.findFirst({
    where: { name: noVknName },
    select: { id: true, vkn: true, isActive: true },
  });
  if (created?.id) createdAccountIds.add(created.id);
  record('30a) Commit succeeds for account without VKN',
    r.status === 200 && r.data?.ok && job?.status === 'completed',
    `status=${r.status} jobStatus=${job?.status}`,
  );
  record('30b) Created Account has vkn=null (no fake VKN)',
    !!created && created.vkn === null && created.isActive === true,
    `vkn=${created?.vkn} isActive=${created?.isActive}`,
  );
}

// 31) Dry-run distinguishes blank VKN (warning) from malformed VKN (error)
//     and from 'NULL' sentinel (treated as missing, not malformed).
{
  const dr = await api(adminToken, '/api/admin/imports/customer360/dry-run', {
    method: 'POST',
    body: JSON.stringify({
      companyId: COMP,
      entities: {
        account: {
          columns: ['name', 'vkn', 'email'],
          mapping: mappingFor('account'),
          rows: [
            { name: `C360 DR NoVkn ${stamp}`,        vkn: '',          email: '' }, // blank → warning
            { name: `C360 DR Malformed ${stamp}`,    vkn: '123456789', email: '' }, // 9 digits → invalid VKN, NO warning
            { name: `C360 DR NullSentinel ${stamp}`, vkn: 'NULL',      email: '' }, // 'NULL' → treated as missing
          ],
        },
      },
      sourceMeta: { sourceType: 'file', fileName: 'novkn-dr.xlsx' },
    }),
  });
  const previewRows = dr.data?.preview?.account ?? [];
  const blank      = previewRows.find((p) => p.rowNumber === 1);
  const malformed  = previewRows.find((p) => p.rowNumber === 2);
  const nullSnt    = previewRows.find((p) => p.rowNumber === 3);
  const hasWarnOn = (r) => r?.warnings?.some((w) => w.code === 'no_tax_id');
  const hasVknErrOn = (r) => r?.errors?.some((e) => e.targetKey === 'vkn');

  record('31a) Row-1 (blank VKN) → no_tax_id warning + no error',
    hasWarnOn(blank) && !hasVknErrOn(blank) && blank?.action !== 'error',
    `warnings=${JSON.stringify(blank?.warnings)} action=${blank?.action}`,
  );
  record('31b) Row-2 (malformed VKN) → invalid VKN error, NO no_tax_id warning',
    hasVknErrOn(malformed) && !hasWarnOn(malformed) && malformed?.action === 'error',
    `errors=${JSON.stringify(malformed?.errors)} warnings=${JSON.stringify(malformed?.warnings)}`,
  );
  record('31c) Row-3 (VKN="NULL") → treated as missing: no_tax_id warning, no error',
    hasWarnOn(nullSnt) && !hasVknErrOn(nullSnt) && nullSnt?.action !== 'error',
    `warnings=${JSON.stringify(nullSnt?.warnings)} action=${nullSnt?.action}`,
  );
  // Expect 2 in missingTaxIdCount: blank + NULL sentinel. Malformed errors
  // out so it must NOT be counted.
  record('31d) summary.missingTaxIdCount === 2 (excludes malformed-VKN error row)',
    dr.data?.summary?.missingTaxIdCount === 2,
    `missingTaxIdCount=${dr.data?.summary?.missingTaxIdCount}`,
  );
}

await cleanup();
await prisma.$disconnect();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
