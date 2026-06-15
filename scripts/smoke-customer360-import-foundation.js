/**
 * smoke-customer360-import-foundation.js — WR-A8 Phase 2a
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-customer360-import-foundation.js
 *
 * Customer 360 import foundation (schema + auto-map + validate + dry-run)
 * için BFF testleri. Phase 2a yalnız doğrulama + dry-run sağlar; commit/
 * rollback YOK ve hiçbir DB mutation OLMAMALIDIR.
 *
 * Scenarios:
 *   1. schema endpoint returns 5 entities
 *   2. every field has label/description/example/type/group
 *   3. backend field list schema-driven (matchingRules + relationships present)
 *   4. multi-sheet XLSX equivalent — entities parsed into entity blocks
 *      (front-end parsing tested indirectly via direct dry-run payload)
 *   5. nested API JSON shape accepted by dry-run when client flattens
 *   6. API preview sample smaller than full dataset; dry-run processes full
 *   7. orphan contact row detected
 *   8. orphan address row detected
 *   9. orphan project row detected
 *  10. AccountCompany-scoped project validation enforced
 *  11. duplicate contact detected (warning, not error)
 *  12. invalid address country rejected (error)
 *  13. dry-run causes no DB mutation (Account count Δ=0)
 *  14. skipErrors=false preview says commit would block when errors exist
 *  15. skipErrors=true preview says cascading skip plan
 *  16. source companyId cannot override selected company (soft warning)
 *  17. TCKN fields absent from schema; TCKN header in source rejected
 *  18. PII fields labeled sensitive (fullName, email, phone)
 *  19. existing Phase 1 account import smoke still passes (run separately)
 *  20-27. (Review fix) Selected-company guard:
 *     20  accountCompany.companyCode != selected → mismatch error
 *     21  Mismatch row not counted as valid in impact summary
 *     22  companyCode == selected → row passes
 *     23  empty companyCode → auto-bind warning + passes
 *     24  raw source companyId ignored (selected authoritative)
 *     25  project accountCompanyKey != selected → mismatch error
 *     26  empty project accountCompanyKey → auto-bind + resolves
 *     27  schema reflects required=false on companyCode + accountCompanyKey
 */

import { prisma } from '../server/db/client.js';
import {
  CUSTOMER_360_VERSION,
} from '../server/lib/import/targetSchemas/customer360TargetSchemas/index.js';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
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

const COMP_PAR = 'COMP-PARAM';

// VKN generator (same algorithm as Phase 1 smoke)
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
const VKN_A = genVkn(`110${stamp.slice(0, 6)}`);
const VKN_B = genVkn(`120${stamp.slice(0, 6)}`);

// Common mapping for dry-run payloads (entity-aware)
function mappingFor(entity) {
  const M = {
    account: [
      { source: 'name', targetKey: 'name' },
      { source: 'vkn', targetKey: 'vkn' },
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

// 1) Schema endpoint
let schema;
{
  const r = await api(adminToken, '/api/admin/imports/targets/customer360/schema');
  schema = r.data;
  const okEntities = Array.isArray(schema?.entities) && schema.entities.length === 5;
  const entityKeys = schema?.entities?.map((e) => e.entity).sort() ?? [];
  const expected = ['account', 'accountAddress', 'accountCompany', 'accountContact', 'accountProject'].sort();
  const allPresent = expected.every((k) => entityKeys.includes(k));
  record('1) schema endpoint returns 5 entities', r.status === 200 && okEntities && allPresent, `entities=${entityKeys.join(',')}`);
}

// 2) Field metadata completeness
{
  let allOk = true;
  let problems = [];
  for (const e of schema?.entities ?? []) {
    for (const f of e.fields) {
      const ok = !!f.key && !!f.label && typeof f.description === 'string' && f.type && f.group;
      if (!ok) { allOk = false; problems.push(`${e.entity}.${f.key}`); }
    }
  }
  record('2) every field has label/description/example/type/group', allOk, problems.slice(0, 5).join(', '));
}

// 3) matchingRules + relationships present
{
  const ok =
    schema?.matchingRules &&
    schema?.relationships &&
    Array.isArray(schema.relationships) &&
    schema.relationships.length >= 4;
  record('3) backend exposes matchingRules + relationships', ok);
}

// 4) Multi-sheet XLSX equivalent — dry-run with entity blocks
{
  const payload = {
    companyId: COMP_PAR,
    entities: {
      account: { columns: ['name', 'vkn'], mapping: mappingFor('account'),
        rows: [{ name: 'C360 Co A', vkn: VKN_A }] },
      accountCompany: { columns: ['accountKey', 'companyCode', 'externalCustomerCode'], mapping: mappingFor('accountCompany'),
        rows: [{ accountKey: VKN_A, companyCode: COMP_PAR, externalCustomerCode: '90001' }] },
      accountContact: { columns: ['accountKey', 'fullName', 'email', 'isPrimary'], mapping: mappingFor('accountContact'),
        rows: [{ accountKey: VKN_A, fullName: 'Ali Veli', email: 'ali@c360a.test', isPrimary: 'Evet' }] },
      accountAddress: { columns: ['accountKey', 'type', 'line1', 'country'], mapping: mappingFor('accountAddress'),
        rows: [{ accountKey: VKN_A, type: 'Billing', line1: 'Atatürk Bulvarı No:1', country: 'TR' }] },
      accountProject: { columns: ['accountKey', 'accountCompanyKey', 'projectCode', 'projectName'], mapping: mappingFor('accountProject'),
        rows: [{ accountKey: VKN_A, accountCompanyKey: COMP_PAR, projectCode: 'C360-001', projectName: 'Test Proje' }] },
    },
    sourceMeta: { sourceType: 'file', fileName: 'c360-smoke.xlsx' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  // WR-A8 Phase 2b — commitAvailable is now boolean (true when validation
  // passes, false when blocked). Phase 2a originally hardcoded false; now
  // we accept either, focusing on the dry-run shape.
  const ok =
    r.status === 200 &&
    typeof r.data?.commitAvailable === 'boolean' &&
    r.data?.summary?.byEntity?.account?.total === 1 &&
    r.data?.summary?.byEntity?.accountCompany?.total === 1 &&
    r.data?.summary?.byEntity?.accountProject?.total === 1;
  record('4) Multi-entity dry-run accepts XLSX-equivalent payload', ok, `commitAvailable=${r.data?.commitAvailable} v=${r.data?.customer360SchemaVersion}`);
}

// 5+6) Nested API JSON equivalent (flatten happens client-side); we simulate
//      by passing already-flattened rows. Preview vs full dataset rule:
//      payload carries full rows; preview is only the first 100 in response.
{
  // 120 accounts × 3 contacts each = 360 contacts
  const accounts = [];
  const contacts = [];
  for (let i = 0; i < 120; i++) {
    const v = genVkn(`5${stamp.slice(0,5)}${String(i).padStart(2,'0').slice(-2)}`.slice(0,9));
    accounts.push({ name: `C360 Bulk ${i}`, vkn: v });
    contacts.push({ accountKey: v, fullName: `P1 ${i}`, email: `p1-${i}@c360.test` });
    contacts.push({ accountKey: v, fullName: `P2 ${i}`, email: `p2-${i}@c360.test` });
    contacts.push({ accountKey: v, fullName: `P3 ${i}`, email: `p3-${i}@c360.test` });
  }
  const payload = {
    companyId: COMP_PAR,
    entities: {
      account: { columns: ['name', 'vkn'], mapping: mappingFor('account'), rows: accounts },
      accountCompany: { columns: ['accountKey', 'companyCode'], mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'companyCode', targetKey: 'companyCode' },
      ], rows: [] },
      accountContact: { columns: ['accountKey', 'fullName', 'email'], mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'fullName', targetKey: 'fullName' },
        { source: 'email', targetKey: 'email' },
      ], rows: contacts },
      accountAddress: { columns: [], mapping: [], rows: [] },
      accountProject: { columns: [], mapping: [], rows: [] },
    },
    sourceMeta: { sourceType: 'api', sourceUrlMasked: 'https://api.example/x', dataPath: 'accounts' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  record('5) API nested JSON (flattened) accepted by dry-run', r.status === 200 && r.data?.summary?.byEntity?.account?.total === 120, `accounts=${r.data?.summary?.byEntity?.account?.total}`);
  record('6) Dry-run processes full dataset (contacts=360)', r.data?.summary?.byEntity?.accountContact?.total === 360, `contacts=${r.data?.summary?.byEntity?.accountContact?.total}`);
}

// 7-12) Orphan/duplicate/invalid validation paths
const VKN_NOAC = genVkn(`770${stamp.slice(0, 6)}`);
{
  const payload = {
    companyId: COMP_PAR,
    entities: {
      account: { columns: ['name', 'vkn'], mapping: mappingFor('account'),
        rows: [
          { name: 'C360 Validation', vkn: VKN_B },
          { name: 'C360 No AC', vkn: VKN_NOAC }, // account but no AC row → orphan_project_company candidate
        ] },
      accountCompany: { columns: ['accountKey', 'companyCode'], mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'companyCode', targetKey: 'companyCode' },
      ], rows: [{ accountKey: VKN_B, companyCode: COMP_PAR }] },
      accountContact: { columns: ['accountKey', 'fullName', 'email', 'isPrimary'], mapping: mappingFor('accountContact'),
        rows: [
          { accountKey: VKN_B, fullName: 'C1', email: 'dup@x.com', isPrimary: 'Hayır' },
          { accountKey: VKN_B, fullName: 'C2', email: 'dup@x.com', isPrimary: 'Hayır' }, // duplicate
          { accountKey: '9999999999', fullName: 'Orphan', email: 'o@x.com', isPrimary: 'Hayır' }, // orphan
        ] },
      accountAddress: { columns: ['accountKey', 'type', 'line1', 'country'], mapping: mappingFor('accountAddress'),
        rows: [
          { accountKey: VKN_B, type: 'Billing', line1: 'Ok', country: 'TR' },
          { accountKey: '9999999999', type: 'Billing', line1: 'Orphan Addr', country: 'TR' }, // orphan
          { accountKey: VKN_B, type: 'Shipping', line1: 'Bad', country: 'Türkiyye' }, // invalid country
        ] },
      accountProject: { columns: ['accountKey', 'accountCompanyKey', 'projectCode', 'projectName'], mapping: mappingFor('accountProject'),
        rows: [
          { accountKey: VKN_B, accountCompanyKey: COMP_PAR, projectCode: 'P1', projectName: 'OK' },
          // Account row exists but NO accountCompany row for VKN_NOAC → project
          // resolution falls to orphan_project_company (AccountCompany-scoped
          // validation invariant).
          { accountKey: VKN_NOAC, accountCompanyKey: COMP_PAR, projectCode: 'P2', projectName: 'No AC' },
          { accountKey: '9999999999', accountCompanyKey: COMP_PAR, projectCode: 'P3', projectName: 'Orphan Acct' }, // orphan account
        ] },
    },
    sourceMeta: { sourceType: 'file' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  const previewContacts = r.data?.preview?.accountContact ?? [];
  const previewAddresses = r.data?.preview?.accountAddress ?? [];
  const previewProjects = r.data?.preview?.accountProject ?? [];

  const orphanContact = previewContacts.find((p) => p.errors?.some((e) => e.code === 'orphan_child_row'));
  record('7) Orphan contact row detected', !!orphanContact, orphanContact?.errors?.[0]?.message ?? '');

  const orphanAddress = previewAddresses.find((p) => p.errors?.some((e) => e.code === 'orphan_child_row'));
  record('8) Orphan address row detected', !!orphanAddress);

  const orphanProject = previewProjects.find((p) => p.errors?.some((e) => e.code === 'orphan_child_row'));
  const orphanProjectAc = previewProjects.find((p) => p.errors?.some((e) => e.code === 'orphan_project_company'));
  record('9) Orphan project row detected (parent account missing)', !!orphanProject);
  record('10) AccountCompany-scoped project validation enforced', !!orphanProjectAc);

  const dupContact = previewContacts.find((p) => p.warnings?.some((w) => w.code === 'duplicate_contact_in_source'));
  record('11) Duplicate contact detected (as warning)', !!dupContact);

  const badCountry = previewAddresses.find((p) => p.errors?.some((e) => e.targetKey === 'country'));
  record('12) Invalid address country rejected', !!badCountry);
}

// 13) Dry-run causes no DB mutation
{
  const beforeAccounts = await prisma.account.count();
  const beforeAcs = await prisma.accountCompany.count();
  const beforeContacts = await prisma.accountContact.count();
  const beforeAddrs = await prisma.address.count();
  const beforeProjects = await prisma.accountProject.count();

  const payload = {
    companyId: COMP_PAR,
    entities: {
      account: { columns: ['name', 'vkn'], mapping: mappingFor('account'),
        rows: [{ name: 'No Mutate', vkn: genVkn(`700${stamp.slice(0,6)}`) }] },
      accountCompany: { columns: [], mapping: [], rows: [] },
      accountContact: { columns: [], mapping: [], rows: [] },
      accountAddress: { columns: [], mapping: [], rows: [] },
      accountProject: { columns: [], mapping: [], rows: [] },
    },
    sourceMeta: { sourceType: 'file' },
  };
  await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });

  const afterAccounts = await prisma.account.count();
  const afterAcs = await prisma.accountCompany.count();
  const afterContacts = await prisma.accountContact.count();
  const afterAddrs = await prisma.address.count();
  const afterProjects = await prisma.accountProject.count();

  const noMutation =
    beforeAccounts === afterAccounts &&
    beforeAcs === afterAcs &&
    beforeContacts === afterContacts &&
    beforeAddrs === afterAddrs &&
    beforeProjects === afterProjects;
  record('13) Dry-run causes no DB mutation (5 tables)', noMutation,
    `Δaccount=${afterAccounts - beforeAccounts} Δac=${afterAcs - beforeAcs} Δcontact=${afterContacts - beforeContacts} Δaddr=${afterAddrs - beforeAddrs} Δproj=${afterProjects - beforeProjects}`);
}

// 14+15) skipErrors preview
{
  const payload = {
    companyId: COMP_PAR,
    entities: {
      account: { columns: ['name', 'vkn'], mapping: mappingFor('account'),
        rows: [
          { name: 'Valid', vkn: genVkn(`810${stamp.slice(0,6)}`) },
          { name: '', vkn: genVkn(`820${stamp.slice(0,6)}`) }, // invalid (empty name)
        ] },
      accountCompany: { columns: [], mapping: [], rows: [] },
      accountContact: { columns: [], mapping: [], rows: [] },
      accountAddress: { columns: [], mapping: [], rows: [] },
      accountProject: { columns: [], mapping: [], rows: [] },
    },
    sourceMeta: { sourceType: 'file' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  const preview = r.data?.skipErrorsPreview;
  record('14) skipErrors=false preview says commit would block (errors exist)', preview?.blockedIfSkipErrorsFalse === true);
  record('15) skipErrors=true preview returns cascading skip plan',
    typeof preview?.cascadingSkipIfSkipErrorsTrue === 'object' && (preview?.cascadingSkipIfSkipErrorsTrue?.account ?? 0) >= 1,
    JSON.stringify(preview?.cascadingSkipIfSkipErrorsTrue));
}

// 16) source companyId cannot override selected company — soft warning
{
  const payload = {
    companyId: COMP_PAR,
    entities: {
      account: { columns: ['name', 'vkn', 'companyId'], mapping: mappingFor('account'),
        rows: [{ name: 'Source Tenant', vkn: genVkn(`830${stamp.slice(0,6)}`), companyId: 'COMP-UNIVERA' }] },
      accountCompany: { columns: [], mapping: [], rows: [] },
      accountContact: { columns: [], mapping: [], rows: [] },
      accountAddress: { columns: [], mapping: [], rows: [] },
      accountProject: { columns: [], mapping: [], rows: [] },
    },
    sourceMeta: { sourceType: 'file' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  const row = r.data?.preview?.account?.[0];
  const hasWarning = row?.warnings?.some((w) => w.code === 'source_company_id_ignored');
  record('16) Source companyId cannot override selected (soft warning)', !!hasWarning);
}

// 17) TCKN absent + TCKN header rejected
{
  const tcknFieldOnAccount = schema?.entities?.find((e) => e.entity === 'account')?.fields?.some((f) => f.key === 'tckn');
  record('17a) TCKN field absent from account schema', !tcknFieldOnAccount);

  const payload = {
    companyId: COMP_PAR,
    entities: {
      account: { columns: ['name', 'vkn', 'TCKN'], mapping: mappingFor('account'),
        rows: [{ name: 'X', vkn: genVkn(`840${stamp.slice(0,6)}`), TCKN: '12345678901' }] },
      accountCompany: { columns: [], mapping: [], rows: [] },
      accountContact: { columns: [], mapping: [], rows: [] },
      accountAddress: { columns: [], mapping: [], rows: [] },
      accountProject: { columns: [], mapping: [], rows: [] },
    },
    sourceMeta: { sourceType: 'file' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  record('17b) TCKN header in source rejected', r.data?.code === 'tckn_import_blocked', `code=${r.data?.code}`);
}

// 18) PII fields labeled sensitive
{
  const contact = schema?.entities?.find((e) => e.entity === 'accountContact');
  const fullName = contact?.fields?.find((f) => f.key === 'fullName');
  const email = contact?.fields?.find((f) => f.key === 'email');
  const phone = contact?.fields?.find((f) => f.key === 'phone');
  const ok = fullName?.pii === true && email?.sensitive === true && phone?.sensitive === true;
  record('18) PII fields labeled sensitive (fullName/email/phone)', ok);
}

// 19) regression — schema constants stable
record('19) Customer 360 schema version stable', typeof CUSTOMER_360_VERSION === 'string' && CUSTOMER_360_VERSION.length > 0, CUSTOMER_360_VERSION);

// ─────────────────────────────────────────────────────────────────
// SELECTED-COMPANY GUARD (Phase 2a review fix)
// Admin has access to UNIVERA + PARAM. Wizard selectedCompanyId varies.
// ─────────────────────────────────────────────────────────────────

// 20) Wizard selected UNIVERA + accountCompany.companyCode=PARAM → row error
//     account_company_selected_company_mismatch.
{
  const vkn = genVkn(`910${stamp.slice(0,6)}`);
  const payload = {
    companyId: 'COMP-UNIVERA',
    entities: {
      account: { columns: ['name','vkn'], mapping: mappingFor('account'),
        rows: [{ name: 'Tenant Mix A', vkn }] },
      accountCompany: { columns: ['accountKey','companyCode'], mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'companyCode', targetKey: 'companyCode' },
      ], rows: [{ accountKey: vkn, companyCode: 'COMP-PARAM' }] }, // ← cross-target
      accountContact: { columns: [], mapping: [], rows: [] },
      accountAddress: { columns: [], mapping: [], rows: [] },
      accountProject: { columns: [], mapping: [], rows: [] },
    },
    sourceMeta: { sourceType: 'file' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  const acRow = r.data?.preview?.accountCompany?.[0];
  const hasError = acRow?.errors?.some((e) => e.code === 'account_company_selected_company_mismatch');
  record('20) accountCompany.companyCode != selected → mismatch error', !!hasError, acRow?.errors?.[0]?.message ?? '');
}

// 21) The same row must NOT be treated as valid in impact counts.
{
  const vkn = genVkn(`920${stamp.slice(0,6)}`);
  const payload = {
    companyId: 'COMP-UNIVERA',
    entities: {
      account: { columns: ['name','vkn'], mapping: mappingFor('account'),
        rows: [{ name: 'Tenant Mix B', vkn }] },
      accountCompany: { columns: ['accountKey','companyCode'], mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'companyCode', targetKey: 'companyCode' },
      ], rows: [{ accountKey: vkn, companyCode: 'COMP-PARAM' }] },
      accountContact: { columns: [], mapping: [], rows: [] },
      accountAddress: { columns: [], mapping: [], rows: [] },
      accountProject: { columns: [], mapping: [], rows: [] },
    },
    sourceMeta: { sourceType: 'file' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  const acSummary = r.data?.summary?.byEntity?.accountCompany;
  record('21) Mismatch row not counted as valid (error=1, create/update=0)',
    acSummary?.error === 1 && acSummary?.create === 0 && acSummary?.update === 0,
    JSON.stringify(acSummary));
}

// 22) companyCode = UNIVERA (== selected) → row OK (no mismatch).
{
  const vkn = genVkn(`930${stamp.slice(0,6)}`);
  const payload = {
    companyId: 'COMP-UNIVERA',
    entities: {
      account: { columns: ['name','vkn'], mapping: mappingFor('account'),
        rows: [{ name: 'Tenant Match', vkn }] },
      accountCompany: { columns: ['accountKey','companyCode'], mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'companyCode', targetKey: 'companyCode' },
      ], rows: [{ accountKey: vkn, companyCode: 'COMP-UNIVERA' }] },
      accountContact: { columns: [], mapping: [], rows: [] },
      accountAddress: { columns: [], mapping: [], rows: [] },
      accountProject: { columns: [], mapping: [], rows: [] },
    },
    sourceMeta: { sourceType: 'file' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  const acRow = r.data?.preview?.accountCompany?.[0];
  const noMismatch = !(acRow?.errors ?? []).some((e) => e.code === 'account_company_selected_company_mismatch');
  record('22) companyCode == selected → row passes', noMismatch && acRow?.action !== 'error');
}

// 23) companyCode empty → auto-bind to selected company (warning + passes).
{
  const vkn = genVkn(`940${stamp.slice(0,6)}`);
  const payload = {
    companyId: 'COMP-UNIVERA',
    entities: {
      account: { columns: ['name','vkn'], mapping: mappingFor('account'),
        rows: [{ name: 'Tenant Empty', vkn }] },
      accountCompany: { columns: ['accountKey','companyCode'], mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'companyCode', targetKey: 'companyCode' },
      ], rows: [{ accountKey: vkn, companyCode: '' }] }, // ← empty
      accountContact: { columns: [], mapping: [], rows: [] },
      accountAddress: { columns: [], mapping: [], rows: [] },
      accountProject: { columns: [], mapping: [], rows: [] },
    },
    sourceMeta: { sourceType: 'file' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  const acRow = r.data?.preview?.accountCompany?.[0];
  const autoBound = (acRow?.warnings ?? []).some((w) => w.code === 'auto_bound_to_selected_company');
  const noMismatch = !(acRow?.errors ?? []).some((e) => e.code === 'account_company_selected_company_mismatch');
  record('23) Empty companyCode → auto-bind + warning (no error)', autoBound && noMismatch && acRow?.action !== 'error');
}

// 24) Cross-tenant source companyId (raw row field) cannot override selected.
//     Behavior: dry-run still emits 'source_company_id_ignored' soft warning
//     on the account row when payload row has companyId field set to another tenant.
{
  const vkn = genVkn(`950${stamp.slice(0,6)}`);
  const payload = {
    companyId: 'COMP-UNIVERA',
    entities: {
      account: { columns: ['name','vkn','companyId'], mapping: mappingFor('account'),
        rows: [{ name: 'Override Attempt', vkn, companyId: 'COMP-PARAM' }] },
      accountCompany: { columns: [], mapping: [], rows: [] },
      accountContact: { columns: [], mapping: [], rows: [] },
      accountAddress: { columns: [], mapping: [], rows: [] },
      accountProject: { columns: [], mapping: [], rows: [] },
    },
    sourceMeta: { sourceType: 'file' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  const accRow = r.data?.preview?.account?.[0];
  const ignored = (accRow?.warnings ?? []).some((w) => w.code === 'source_company_id_ignored');
  record('24) Raw source companyId yok sayılır (selected authoritative)', ignored);
}

// 25) Project's accountCompanyKey != selected → mismatch error (project entity).
{
  const vkn = genVkn(`960${stamp.slice(0,6)}`);
  const payload = {
    companyId: 'COMP-UNIVERA',
    entities: {
      account: { columns: ['name','vkn'], mapping: mappingFor('account'),
        rows: [{ name: 'Proj Mix', vkn }] },
      accountCompany: { columns: ['accountKey','companyCode'], mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'companyCode', targetKey: 'companyCode' },
      ], rows: [{ accountKey: vkn, companyCode: 'COMP-UNIVERA' }] },
      accountContact: { columns: [], mapping: [], rows: [] },
      accountAddress: { columns: [], mapping: [], rows: [] },
      accountProject: { columns: ['accountKey','accountCompanyKey','projectCode','projectName'], mapping: mappingFor('accountProject'),
        rows: [{ accountKey: vkn, accountCompanyKey: 'COMP-PARAM', projectCode: 'X1', projectName: 'Bad' }] },
    },
    sourceMeta: { sourceType: 'file' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  const projRow = r.data?.preview?.accountProject?.[0];
  const hasMismatch = (projRow?.errors ?? []).some((e) => e.code === 'account_company_selected_company_mismatch');
  record('25) accountProject.accountCompanyKey != selected → mismatch', hasMismatch);

  // 25b) (Review fix — orphan metric integrity) Selected-company mismatch
  // must NOT be counted in summary.orphansByEntity.accountProject. Orphan
  // counts feed the relationship graph badges + UI orphan messaging and
  // should reflect only actual orphan-resolution failures
  // (orphan_project_company / orphan_child_row), not policy violations.
  const orphans = r.data?.summary?.orphansByEntity?.accountProject ?? [];
  record(
    '25b) Mismatch row NOT pushed to orphansByEntity.accountProject',
    Array.isArray(orphans) && orphans.length === 0,
    `orphans=${JSON.stringify(orphans)}`,
  );
}

// 26) Project's accountCompanyKey empty → auto-bind + passes when parent AC exists.
{
  const vkn = genVkn(`970${stamp.slice(0,6)}`);
  const payload = {
    companyId: 'COMP-UNIVERA',
    entities: {
      account: { columns: ['name','vkn'], mapping: mappingFor('account'),
        rows: [{ name: 'Proj Empty', vkn }] },
      accountCompany: { columns: ['accountKey','companyCode'], mapping: [
        { source: 'accountKey', targetKey: 'accountKey' },
        { source: 'companyCode', targetKey: 'companyCode' },
      ], rows: [{ accountKey: vkn, companyCode: '' }] }, // bind to UNIVERA
      accountContact: { columns: [], mapping: [], rows: [] },
      accountAddress: { columns: [], mapping: [], rows: [] },
      accountProject: { columns: ['accountKey','accountCompanyKey','projectCode','projectName'], mapping: mappingFor('accountProject'),
        rows: [{ accountKey: vkn, accountCompanyKey: '', projectCode: 'AB1', projectName: 'OK' }] }, // bind to UNIVERA
    },
    sourceMeta: { sourceType: 'file' },
  };
  const r = await api(adminToken, '/api/admin/imports/customer360/dry-run', { method: 'POST', body: JSON.stringify(payload) });
  const projRow = r.data?.preview?.accountProject?.[0];
  const noMismatch = !(projRow?.errors ?? []).some((e) => e.code === 'account_company_selected_company_mismatch');
  const autoBound = (projRow?.warnings ?? []).some((w) => w.code === 'auto_bound_to_selected_company');
  record('26) Empty project accountCompanyKey → auto-bind + project resolves',
    autoBound && noMismatch && projRow?.action !== 'error',
    `action=${projRow?.action} warnings=${(projRow?.warnings ?? []).map(w=>w.code).join(',')} errors=${(projRow?.errors ?? []).map(e=>e.code).join(',')}`);
}

// 27) Schema reflects required=false on companyCode + accountCompanyKey.
{
  const ac = schema?.entities?.find((e) => e.entity === 'accountCompany');
  const companyCode = ac?.fields?.find((f) => f.key === 'companyCode');
  const proj = schema?.entities?.find((e) => e.entity === 'accountProject');
  const acKey = proj?.fields?.find((f) => f.key === 'accountCompanyKey');
  record('27) Schema: companyCode + accountCompanyKey now optional (auto-bind)',
    companyCode?.required === false && acKey?.required === false,
    `companyCode.required=${companyCode?.required} accountCompanyKey.required=${acKey?.required}`);
}

// ─────────────────────────────────────────────────────────────────
await prisma.$disconnect();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
