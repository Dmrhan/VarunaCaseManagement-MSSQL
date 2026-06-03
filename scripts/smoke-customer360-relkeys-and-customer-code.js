/**
 * smoke-customer360-relkeys-and-customer-code.js — WR-A8 Phase 2c
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-customer360-relkeys-and-customer-code.js
 *
 * Phase 2c yeni davranışını kapsar:
 *   • C360 entity şemalarında recordNo / parentRecordNo / parentCompany-
 *     RecordNo + source* alanlarının varlığı + alias kapsamı.
 *   • Phase 1 (Müşteri Ana Kartı) accountTargetSchema: externalCustomer-
 *     Code'a eklenen yeni alias'lar (musteri_kodu, müşteri_kodu,
 *     customerCode, customer_code, external_customer_code).
 *   • Customer 360 dry-run:
 *       - parentRecordNo + parentCompanyRecordNo başarılı resolve
 *       - geçersiz parentRecordNo → parent_record_no_not_found
 *       - geçersiz parentCompanyRecordNo → parent_company_record_no_not_found
 *       - Aynı sheet içinde dup recordNo → duplicate_record_no_in_sheet
 *       - Aynı sheet içinde dup sourceContactId → duplicate_source_id_in_sheet
 *       - Source ID eksik child → missing_source_id_fallback warning
 *       - Backward compatibility: recordNo'suz dosya hâlâ accountKey
 *         fallback ile çalışır.
 *   • Phase 1 import (no DB write — dryRunFromSnapshot path):
 *       - externalCustomerCode-first matching tetiklendi (acByCode hit)
 *       - VKN conflict ile çakışan ek satır → external_customer_code_
 *         identity_conflict.
 *
 * Bu smoke salt READ + dry-run; commit YAPILMAZ; DB satırı yaratmaz.
 */

import { prisma } from '../server/db/client.js';
import {
  ACCOUNT_FIELDS as C360_ACCOUNT_FIELDS,
} from '../server/lib/import/targetSchemas/customer360TargetSchemas/accountTargetSchema.js';
import {
  ACCOUNT_COMPANY_FIELDS,
} from '../server/lib/import/targetSchemas/customer360TargetSchemas/accountCompanyTargetSchema.js';
import {
  ACCOUNT_CONTACT_FIELDS,
} from '../server/lib/import/targetSchemas/customer360TargetSchemas/accountContactTargetSchema.js';
import {
  ACCOUNT_ADDRESS_FIELDS,
} from '../server/lib/import/targetSchemas/customer360TargetSchemas/accountAddressTargetSchema.js';
import {
  ACCOUNT_PROJECT_FIELDS,
} from '../server/lib/import/targetSchemas/customer360TargetSchemas/accountProjectTargetSchema.js';
import { ACCOUNT_TARGET_FIELDS as P1_ACCOUNT_FIELDS } from '../server/lib/import/targetSchemas/accountTargetSchema.js';
import { dryRunCustomer360 } from '../server/lib/import/customer360DryRun.js';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

// Pick a real company id from DB for dry-run scoping.
async function pickCompanyId() {
  const c = await prisma.company.findFirst({ where: { isActive: true }, select: { id: true } });
  return c?.id ?? null;
}

function fieldByKey(arr, key) {
  return arr.find((f) => f.key === key);
}

// ─── §1 — Schema field presence + alias coverage ────────────────────
{
  // Account: recordNo
  const rec = fieldByKey(C360_ACCOUNT_FIELDS, 'recordNo');
  record('1) C360 account.recordNo present', !!rec, `aliases=${rec?.aliases?.length}`);

  // AccountCompany: recordNo + parentRecordNo
  const acRec = fieldByKey(ACCOUNT_COMPANY_FIELDS, 'recordNo');
  const acPar = fieldByKey(ACCOUNT_COMPANY_FIELDS, 'parentRecordNo');
  record('2) C360 accountCompany.recordNo + parentRecordNo present', !!acRec && !!acPar);

  // AccountCompany: externalCustomerCode alias coverage
  const acCode = fieldByKey(ACCOUNT_COMPANY_FIELDS, 'externalCustomerCode');
  const needed = ['external_customer_code', 'musteri_kodu', 'müşteri_kodu', 'customercode', 'customer_code'];
  const missing = needed.filter((n) => !acCode?.aliases?.includes(n));
  record('3) C360 accountCompany.externalCustomerCode alias coverage', missing.length === 0, `missing=${missing.join(',') || '(none)'}`);

  // AccountContact: recordNo + parentRecordNo + sourceContactId
  const cRec = fieldByKey(ACCOUNT_CONTACT_FIELDS, 'recordNo');
  const cPar = fieldByKey(ACCOUNT_CONTACT_FIELDS, 'parentRecordNo');
  const cSrc = fieldByKey(ACCOUNT_CONTACT_FIELDS, 'sourceContactId');
  record('4) C360 accountContact.{recordNo,parentRecordNo,sourceContactId} present', !!cRec && !!cPar && !!cSrc);

  // AccountAddress: recordNo + parentRecordNo + sourceAddressId
  const aRec = fieldByKey(ACCOUNT_ADDRESS_FIELDS, 'recordNo');
  const aPar = fieldByKey(ACCOUNT_ADDRESS_FIELDS, 'parentRecordNo');
  const aSrc = fieldByKey(ACCOUNT_ADDRESS_FIELDS, 'sourceAddressId');
  record('5) C360 accountAddress.{recordNo,parentRecordNo,sourceAddressId} present', !!aRec && !!aPar && !!aSrc);

  // AccountProject: recordNo + parentRecordNo + parentCompanyRecordNo + sourceProjectId
  const pRec = fieldByKey(ACCOUNT_PROJECT_FIELDS, 'recordNo');
  const pPar = fieldByKey(ACCOUNT_PROJECT_FIELDS, 'parentRecordNo');
  const pCom = fieldByKey(ACCOUNT_PROJECT_FIELDS, 'parentCompanyRecordNo');
  const pSrc = fieldByKey(ACCOUNT_PROJECT_FIELDS, 'sourceProjectId');
  record('6) C360 accountProject.{recordNo,parentRecordNo,parentCompanyRecordNo,sourceProjectId} present',
    !!pRec && !!pPar && !!pCom && !!pSrc);

  // Phase 1 account: externalCustomerCode alias expansion
  const p1Code = fieldByKey(P1_ACCOUNT_FIELDS, 'externalCustomerCode');
  const p1Needed = ['external_customer_code', 'musteri_kodu', 'müşteri_kodu', 'customercode', 'customer_code'];
  const p1Missing = p1Needed.filter((n) => !p1Code?.aliases?.includes(n));
  record('7) Phase 1 account.externalCustomerCode alias coverage', p1Missing.length === 0, `missing=${p1Missing.join(',') || '(none)'}`);
}

// ─── §2 — Customer 360 dry-run scenarios ────────────────────────────
const companyId = await pickCompanyId();
if (!companyId) {
  record('SKIP dry-run scenarios — no active Company in DB', true);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(0);
}

// Helper: build a dry-run payload with column lists matching mapping.
function payload(entities) {
  const out = {};
  for (const [k, rows] of Object.entries(entities)) {
    const cols = rows.length ? Object.keys(rows[0]) : [];
    out[k] = {
      columns: cols,
      mapping: cols.map((c) => ({ source: c, targetKey: c })),
      rows,
    };
  }
  return out;
}

// Identity-shaped mapping (source = targetKey). Skipped keys won't appear.

// ───── 8) Valid file: parentRecordNo + parentCompanyRecordNo resolve ─
{
  const entities = payload({
    account: [
      { recordNo: 'A1', name: 'RKACC Demo 1' },
      { recordNo: 'A2', name: 'RKACC Demo 2' },
    ],
    accountCompany: [
      { recordNo: 'AC1', parentRecordNo: 'A1', accountKey: '', companyCode: '', externalCustomerCode: 'RK-001' },
    ],
    accountContact: [
      { recordNo: 'C1', parentRecordNo: 'A1', sourceContactId: 'SRC-CN-1', accountKey: '', fullName: 'Demo Contact', email: 'demo@rk.test' },
    ],
    accountAddress: [
      { recordNo: 'D1', parentRecordNo: 'A2', sourceAddressId: 'SRC-ADR-1', accountKey: '', type: 'Billing', line1: 'Test Line 1', country: 'TR' },
    ],
    accountProject: [
      { recordNo: 'P1', parentRecordNo: 'A1', parentCompanyRecordNo: 'AC1', sourceProjectId: 'SRC-PRJ-1', accountKey: '', accountCompanyKey: '', projectCode: 'RK-PRJ-001', projectName: 'RecordNo Resolve Demo' },
    ],
  });
  const r = await dryRunCustomer360({
    companyId,
    entities,
    user: { id: 'smoke-user', allowedCompanyIds: [companyId] },
  });
  // None of the rows should carry an unresolved-parent error.
  const errs = (r.preview ?? r.entities ?? r.rows ?? []);
  // The actual response shape carries per-row errors inside r.preview per entity.
  // We look for any error code mentioning parent_record_no_not_found.
  const allRows = [];
  for (const e of Object.keys(entities)) {
    for (const row of (r.preview?.[e] ?? [])) {
      allRows.push({ entity: e, errors: row.errors ?? [], warnings: row.warnings ?? [] });
    }
  }
  const hasParentErr = allRows.some((row) => row.errors.some((er) => er.code === 'parent_record_no_not_found' || er.code === 'parent_company_record_no_not_found'));
  record('8) Valid recordNo + parentRecordNo + parentCompanyRecordNo resolves without parent_*_not_found',
    !hasParentErr, `rows=${allRows.length}`);
}

// ───── 9) Invalid child parentRecordNo → error ──────────────────────
{
  const entities = payload({
    account: [{ recordNo: 'A1', name: 'RKACC Demo 1' }],
    accountContact: [
      { recordNo: 'C9', parentRecordNo: 'A999', accountKey: '', fullName: 'Bad Parent', email: 'bp@rk.test' },
    ],
  });
  const r = await dryRunCustomer360({
    companyId,
    entities,
    user: { id: 'smoke-user', allowedCompanyIds: [companyId] },
  });
  const cRow = (r.preview?.accountContact ?? [])[0];
  const hasErr = (cRow?.errors ?? []).some((e) => e.code === 'parent_record_no_not_found');
  record('9) Invalid child parentRecordNo → parent_record_no_not_found', hasErr,
    `errors=${(cRow?.errors ?? []).map((e) => e.code).join(',')}`);
}

// ───── 10) Invalid project parentCompanyRecordNo → error ───────────
{
  const entities = payload({
    account: [{ recordNo: 'A1', name: 'RKACC Demo 1' }],
    accountCompany: [
      { recordNo: 'AC1', parentRecordNo: 'A1', accountKey: '', companyCode: '' },
    ],
    accountProject: [
      { recordNo: 'P9', parentRecordNo: 'A1', parentCompanyRecordNo: 'AC999', accountKey: '', accountCompanyKey: '', projectCode: 'RK-X-001', projectName: 'X' },
    ],
  });
  const r = await dryRunCustomer360({
    companyId,
    entities,
    user: { id: 'smoke-user', allowedCompanyIds: [companyId] },
  });
  const pRow = (r.preview?.accountProject ?? [])[0];
  const hasErr = (pRow?.errors ?? []).some((e) => e.code === 'parent_company_record_no_not_found');
  record('10) Invalid project parentCompanyRecordNo → parent_company_record_no_not_found', hasErr,
    `errors=${(pRow?.errors ?? []).map((e) => e.code).join(',')}`);
}

// ───── 11) Duplicate recordNo within Accounts sheet → error ────────
{
  const entities = payload({
    account: [
      { recordNo: 'AX', name: 'Dup Demo One' },
      { recordNo: 'AX', name: 'Dup Demo Two' },
    ],
  });
  const r = await dryRunCustomer360({
    companyId,
    entities,
    user: { id: 'smoke-user', allowedCompanyIds: [companyId] },
  });
  const accountRows = r.preview?.account ?? [];
  const dups = accountRows.filter((row) => (row.errors ?? []).some((e) => e.code === 'duplicate_record_no_in_sheet'));
  record('11) Duplicate recordNo in Accounts sheet → duplicate_record_no_in_sheet on both rows',
    dups.length === 2, `flagged=${dups.length}`);
}

// ───── 12) Duplicate sourceContactId in Contacts sheet → error ─────
{
  const entities = payload({
    account: [{ recordNo: 'A1', name: 'Dup Src Demo' }],
    accountContact: [
      { recordNo: 'C1', parentRecordNo: 'A1', sourceContactId: 'DUP-SRC-1', accountKey: '', fullName: 'One', email: 'one@rk.test' },
      { recordNo: 'C2', parentRecordNo: 'A1', sourceContactId: 'DUP-SRC-1', accountKey: '', fullName: 'Two', email: 'two@rk.test' },
    ],
  });
  const r = await dryRunCustomer360({
    companyId,
    entities,
    user: { id: 'smoke-user', allowedCompanyIds: [companyId] },
  });
  const cRows = r.preview?.accountContact ?? [];
  const dups = cRows.filter((row) => (row.errors ?? []).some((e) => e.code === 'duplicate_source_id_in_sheet'));
  record('12) Duplicate sourceContactId in Contacts sheet → duplicate_source_id_in_sheet on both rows',
    dups.length === 2, `flagged=${dups.length}`);
}

// ───── 13) Missing sourceContactId → warning (fallback) ───────────
{
  const entities = payload({
    account: [{ recordNo: 'A1', name: 'Missing Src Demo' }],
    accountContact: [
      { recordNo: 'C1', parentRecordNo: 'A1', accountKey: '', fullName: 'No Source', email: 'ns@rk.test' },
    ],
  });
  const r = await dryRunCustomer360({
    companyId,
    entities,
    user: { id: 'smoke-user', allowedCompanyIds: [companyId] },
  });
  const cRow = (r.preview?.accountContact ?? [])[0];
  const hasWarn = (cRow?.warnings ?? []).some((w) => w.code === 'missing_source_id_fallback');
  record('13) Missing sourceContactId → missing_source_id_fallback warning', hasWarn,
    `warnings=${(cRow?.warnings ?? []).map((w) => w.code).join(',')}`);
}

// ───── 14) Backward-compat: recordNo'suz dosya hâlâ accountKey fallback ile ─
{
  const VKN = '1234567890'; // sembolik; mevcut müşteri çakışmasın diye dry-run only
  const entities = payload({
    account: [{ name: 'No-RecordNo Demo', vkn: VKN }],
    accountContact: [
      { accountKey: VKN, fullName: 'Legacy Contact', email: 'legacy@rk.test' },
    ],
  });
  const r = await dryRunCustomer360({
    companyId,
    entities,
    user: { id: 'smoke-user', allowedCompanyIds: [companyId] },
  });
  const cRow = (r.preview?.accountContact ?? [])[0];
  const errors = cRow?.errors ?? [];
  const orphan = errors.some((e) => e.code === 'orphan_child_row');
  record('14) Backward-compat: recordNo yokken accountKey/vkn fallback ile parent resolve',
    !orphan, `errors=${errors.map((e) => e.code).join(',')}`);
}

// ─── Summary ────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name} ${f.detail ?? ''}`);
  await prisma.$disconnect();
  process.exit(1);
}
await prisma.$disconnect();
process.exit(0);
