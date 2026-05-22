/**
 * WR-A8 Phase 2b — Customer 360 commit + rollback engine.
 *
 * Flow:
 *   commitCustomer360({ user, companyId, entities, sourceMeta, options, jobId? }):
 *     1. Re-validate using dryRunCustomer360 (deterministic re-check).
 *     2. Schema version freshness (composite CUSTOMER_360_VERSION).
 *     3. skipErrors policy:
 *        - skipErrors=false + any error  → 400 import_has_errors, no persistence.
 *        - skipErrors=true               → proceeds; invalid rows persisted as error.
 *     4. If no jobId: create ImportJob (status='running') + ImportJobRows.
 *        If jobId: load existing job, schema version match, only re-process pending rows.
 *     5. Process rows in dependency order:
 *          account → accountCompany → accountContact → accountAddress → accountProject
 *     6. Per row, separate try/catch; row.status moves
 *        pending → processing → created|updated|skipped|error.
 *     7. Update ImportJob status to completed | partial (errors present) | failed.
 *
 *   rollbackCustomer360({ jobId, user }):
 *     1. Load ImportJob; status must be completed | partial.
 *     2. Process committed rows in REVERSE dependency order:
 *          accountProject → accountAddress → accountContact → accountCompany → account
 *     3. Each entity restore in its own try/catch (no swallow).
 *     4. created  → soft deactivate (isActive=false; status='inactive' for AC).
 *        updated  → restore beforeJson values.
 *     5. row.status → rolled_back | rollback_error.
 *     6. report.errorCount + report.failedRows[] surface failures (mirrors Phase 1).
 *
 * MSSQL-portable: no PG-specific SQL, no JSONB operators, no ON CONFLICT.
 * All filters use scalar columns (entityType, status, importJobId).
 */

import { prisma } from '../../db/client.js';
import { CUSTOMER_360_VERSION } from './targetSchemas/customer360TargetSchemas/index.js';
import { dryRunCustomer360 } from './customer360DryRun.js';

const ENTITY_ORDER = ['account', 'accountCompany', 'accountContact', 'accountAddress', 'accountProject'];
const ROLLBACK_ORDER = [...ENTITY_ORDER].reverse();

class CommitError extends Error {
  constructor(message, { status = 400, code = 'commit_error', extra = {} } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

function safeErrorMessage(err) {
  const msg = err?.message ?? err?.code ?? 'bilinmeyen hata';
  return String(msg).split('\n')[0].slice(0, 240);
}

function appendRowErrors(existing, additions) {
  const base = Array.isArray(existing) ? existing : [];
  return [...base, ...additions];
}

/**
 * Take dry-run result + selected company, persist ImportJob + ImportJobRows.
 * Returns { job, rowsByEntity } where rowsByEntity is a map of entity →
 * DB row records (with id + rowNumber) for downstream processing.
 */
async function persistJob({ user, companyId, dryRun, sourceMeta }) {
  const totalRows = dryRun.summary?.totalRows ?? 0;
  const totalErrors = dryRun.summary?.totalErrors ?? 0;
  const totalWarnings = dryRun.summary?.totalWarnings ?? 0;
  const entityCounts = dryRun.summary?.byEntity ?? {};

  const job = await prisma.importJob.create({
    data: {
      companyId,
      targetType: 'customer360',
      sourceType: sourceMeta?.sourceType === 'api' ? 'api' : 'file',
      sourceName: sourceMeta?.sourceName ?? null,
      sourceUrlMasked: sourceMeta?.sourceUrlMasked ?? null,
      fileName: sourceMeta?.fileName ?? null,
      dataPath: sourceMeta?.dataPath ?? null,
      targetSchemaVersion: CUSTOMER_360_VERSION,
      status: 'running',
      totalRows,
      // Per-entity scalar counts not aggregated for customer360 (see entityCountsJson);
      // keep top-level scalar `errorCount` + `warningCount` for sidebar history readability.
      errorCount: totalErrors,
      warningCount: totalWarnings,
      summaryJson: {
        completenessScore: dryRun.summary?.completenessScore ?? null,
        orphansByEntity: dryRun.summary?.orphansByEntity ?? null,
      },
      entityCountsJson: entityCounts,
      createdByUserId: user?.id ?? null,
      startedAt: new Date(),
    },
    select: { id: true, status: true, createdAt: true, startedAt: true },
  });

  // WR-A8 Phase 2b hotfix (P2) — Build source-row indexes for
  // parentRowNumber resolution BEFORE writing child entity rows. account
  // matches by VKN or name (same keys customer360DryRun.resolveAccountKey
  // uses); accountCompany matches by (accountKey, companyCode).
  const accountByKey = new Map();
  for (const r of dryRun.preview?.account ?? []) {
    if (r.errors?.length > 0) continue;
    const n = r.normalized ?? {};
    if (n.vkn) accountByKey.set(`vkn:${n.vkn}`, r.rowNumber);
    if (n.name) accountByKey.set(`name:${String(n.name).toLowerCase()}`, r.rowNumber);
  }
  function lookupAccountRowNumber(accountKey) {
    if (!accountKey) return null;
    const v = String(accountKey).trim();
    if (!v) return null;
    return (
      accountByKey.get(`vkn:${v}`) ??
      accountByKey.get(`name:${v.toLowerCase()}`) ??
      null
    );
  }
  const accountCompanyByKey = new Map();
  for (const r of dryRun.preview?.accountCompany ?? []) {
    if (r.errors?.length > 0) continue;
    const n = r.normalized ?? {};
    if (n.accountKey && n.companyCode) {
      accountCompanyByKey.set(`${n.accountKey}|${n.companyCode}`, r.rowNumber);
    }
  }
  function lookupAccountCompanyRowNumber(accountKey, companyCode) {
    if (!accountKey || !companyCode) return null;
    return accountCompanyByKey.get(`${accountKey}|${companyCode}`) ?? null;
  }

  // Insert rows in entity order so a deterministic rowNumber space exists
  // PER entity (1..N within each entity). parentRowNumber links child → parent
  // by accountKey resolution (and accountCompanyKey for projects).
  const rowsByEntity = {};
  for (const entity of ENTITY_ORDER) {
    const previewRows = dryRun.preview?.[entity] ?? [];
    rowsByEntity[entity] = [];
    if (previewRows.length === 0) continue;
    const inserts = previewRows.map((r) => {
      let parentRowNumber = null;
      if (entity !== 'account') {
        const accountKey = r.normalized?.accountKey;
        if (entity === 'accountProject') {
          // Project: prefer accountCompany parent (accountKey + companyCode);
          // fall back to account parent if AC not resolved.
          parentRowNumber =
            lookupAccountCompanyRowNumber(accountKey, r.normalized?.accountCompanyKey) ??
            lookupAccountRowNumber(accountKey);
        } else {
          parentRowNumber = lookupAccountRowNumber(accountKey);
        }
      }
      return {
        importJobId: job.id,
        rowNumber: r.rowNumber,
        entityType: entity,
        parentRowNumber,
        action: r.action,
        status: r.action === 'error' ? 'error' : (r.action === 'skip' ? 'skipped' : 'pending'),
        relationshipKey: r.normalized?.accountKey
          ? `accountKey:${r.normalized.accountKey}${
              r.normalized.accountCompanyKey ? `|companyCode:${r.normalized.accountCompanyKey}` : ''
            }`
          : null,
        matchKey: r.normalized?.vkn ?? null,
        errorsJson: r.errors ?? [],
        warningsJson: r.warnings ?? [],
        rawJson: r.raw ?? null,
        normalizedJson: r.normalized,
      };
    });
    if (inserts.length > 0) {
      await prisma.importJobRow.createMany({ data: inserts });
    }
    const persisted = await prisma.importJobRow.findMany({
      where: { importJobId: job.id, entityType: entity },
      orderBy: { rowNumber: 'asc' },
    });
    rowsByEntity[entity] = persisted;
  }

  return { job, rowsByEntity };
}

// ─────────────────────────────────────────────────────────────────
// Snapshot helpers — per entity (rollback uses them as ground truth)
// ─────────────────────────────────────────────────────────────────

function snapshotAccount(a) {
  if (!a) return null;
  return {
    id: a.id, name: a.name, vkn: a.vkn ?? null, phone: a.phone ?? null, phoneE164: a.phoneE164 ?? null,
    email: a.email ?? null, customerType: a.customerType,
    legalName: a.legalName ?? null, registrationNo: a.registrationNo ?? null, isActive: a.isActive,
  };
}
function snapshotAccountCompany(ac) {
  if (!ac) return null;
  return {
    id: ac.id, accountId: ac.accountId, companyId: ac.companyId,
    externalCustomerCode: ac.externalCustomerCode ?? null,
    packageName: ac.packageName ?? null, segment: ac.segment ?? null,
    contractStartAt: ac.contractStartAt ? new Date(ac.contractStartAt).toISOString() : null,
    contractEndAt: ac.contractEndAt ? new Date(ac.contractEndAt).toISOString() : null,
    status: ac.status,
  };
}
function snapshotContact(c) {
  if (!c) return null;
  return {
    id: c.id, accountId: c.accountId, fullName: c.fullName, title: c.title ?? null,
    email: c.email ?? null, phone: c.phone ?? null, phoneE164: c.phoneE164 ?? null,
    isPrimary: c.isPrimary, isActive: c.isActive,
  };
}
function snapshotAddress(a) {
  if (!a) return null;
  return {
    id: a.id, accountId: a.accountId, companyId: a.companyId, type: a.type,
    label: a.label ?? null, line1: a.line1, line2: a.line2 ?? null,
    district: a.district ?? null, city: a.city ?? null, state: a.state ?? null,
    postalCode: a.postalCode ?? null, country: a.country, isDefault: a.isDefault, isActive: a.isActive,
  };
}
function snapshotProject(p) {
  if (!p) return null;
  return {
    id: p.id, accountCompanyId: p.accountCompanyId, code: p.code, name: p.name,
    status: p.status, startDate: p.startDate ? new Date(p.startDate).toISOString() : null,
    endDate: p.endDate ? new Date(p.endDate).toISOString() : null,
    description: p.description ?? null, isActive: p.isActive,
  };
}

// ─────────────────────────────────────────────────────────────────
// Per-entity write functions (each returns recordId + before/after)
// ─────────────────────────────────────────────────────────────────

async function writeAccount(row, normalized) {
  // VKN exact match. If VKN missing → always create new account.
  let existing = null;
  if (normalized.vkn) {
    existing = await prisma.account.findUnique({
      where: { vkn: normalized.vkn },
      select: {
        id: true, name: true, vkn: true, phone: true, phoneE164: true, email: true,
        customerType: true, legalName: true, registrationNo: true, isActive: true,
      },
    });
  }
  if (existing) {
    const beforeJson = snapshotAccount(existing);
    const patch = {};
    if (normalized.name && normalized.name !== existing.name) patch.name = normalized.name;
    if (normalized.email !== undefined && normalized.email !== null) patch.email = normalized.email;
    if (normalized.customerType !== undefined && normalized.customerType !== null) patch.customerType = normalized.customerType;
    if (normalized.legalName !== undefined && normalized.legalName !== null) patch.legalName = normalized.legalName;
    if (normalized.registrationNo !== undefined && normalized.registrationNo !== null) patch.registrationNo = normalized.registrationNo;
    if (normalized.isActive !== undefined && normalized.isActive !== null) patch.isActive = normalized.isActive;
    if (normalized.phone !== undefined && normalized.phone !== null) {
      patch.phone = normalized._rawPhone ?? normalized.phone;
      patch.phoneE164 = normalized.phone;
    }
    const updated = Object.keys(patch).length > 0
      ? await prisma.account.update({
          where: { id: existing.id },
          data: patch,
          select: {
            id: true, name: true, vkn: true, phone: true, phoneE164: true, email: true,
            customerType: true, legalName: true, registrationNo: true, isActive: true,
          },
        })
      : existing;
    return { kind: 'updated', recordId: existing.id, beforeJson, afterJson: snapshotAccount(updated) };
  }
  // Create
  const created = await prisma.account.create({
    data: {
      name: normalized.name,
      vkn: normalized.vkn ?? null,
      phone: normalized._rawPhone ?? null,
      phoneE164: normalized.phone ?? null,
      email: normalized.email ?? null,
      customerType: normalized.customerType ?? 'Corporate',
      legalName: normalized.legalName ?? null,
      registrationNo: normalized.registrationNo ?? null,
      isActive: normalized.isActive ?? true,
    },
    select: {
      id: true, name: true, vkn: true, phone: true, phoneE164: true, email: true,
      customerType: true, legalName: true, registrationNo: true, isActive: true,
    },
  });
  return { kind: 'created', recordId: created.id, beforeJson: null, afterJson: snapshotAccount(created) };
}

async function writeAccountCompany({ companyId, accountId, normalized }) {
  const existing = await prisma.accountCompany.findUnique({
    where: { accountId_companyId: { accountId, companyId } },
    select: {
      id: true, accountId: true, companyId: true, externalCustomerCode: true,
      packageName: true, segment: true, contractStartAt: true, contractEndAt: true, status: true,
    },
  });
  if (existing) {
    const beforeJson = snapshotAccountCompany(existing);
    const patch = {};
    if (normalized.externalCustomerCode !== undefined && normalized.externalCustomerCode !== null) patch.externalCustomerCode = normalized.externalCustomerCode;
    if (normalized.packageName !== undefined && normalized.packageName !== null) patch.packageName = normalized.packageName;
    if (normalized.segment !== undefined && normalized.segment !== null) patch.segment = normalized.segment;
    if (normalized.contractStartAt) patch.contractStartAt = new Date(normalized.contractStartAt);
    if (normalized.contractEndAt) patch.contractEndAt = new Date(normalized.contractEndAt);
    if (normalized.status) patch.status = normalized.status;
    const updated = Object.keys(patch).length > 0
      ? await prisma.accountCompany.update({
          where: { id: existing.id },
          data: patch,
          select: {
            id: true, accountId: true, companyId: true, externalCustomerCode: true,
            packageName: true, segment: true, contractStartAt: true, contractEndAt: true, status: true,
          },
        })
      : existing;
    return { kind: 'updated', recordId: existing.id, beforeJson, afterJson: snapshotAccountCompany(updated) };
  }
  const created = await prisma.accountCompany.create({
    data: {
      accountId,
      companyId,
      externalCustomerCode: normalized.externalCustomerCode ?? null,
      packageName: normalized.packageName ?? null,
      segment: normalized.segment ?? null,
      contractStartAt: normalized.contractStartAt ? new Date(normalized.contractStartAt) : null,
      contractEndAt: normalized.contractEndAt ? new Date(normalized.contractEndAt) : null,
      status: normalized.status ?? 'active',
    },
    select: {
      id: true, accountId: true, companyId: true, externalCustomerCode: true,
      packageName: true, segment: true, contractStartAt: true, contractEndAt: true, status: true,
    },
  });
  return { kind: 'created', recordId: created.id, beforeJson: null, afterJson: snapshotAccountCompany(created) };
}

async function writeContact({ accountId, normalized }) {
  // Match by (accountId, email) when email present; fallback (accountId, phoneE164).
  let existing = null;
  if (normalized.email) {
    existing = await prisma.accountContact.findFirst({
      where: { accountId, email: normalized.email },
      select: {
        id: true, accountId: true, fullName: true, title: true, email: true, phone: true,
        phoneE164: true, isPrimary: true, isActive: true,
      },
    });
  }
  if (!existing && normalized.phone) {
    existing = await prisma.accountContact.findFirst({
      where: { accountId, phoneE164: normalized.phone },
      select: {
        id: true, accountId: true, fullName: true, title: true, email: true, phone: true,
        phoneE164: true, isPrimary: true, isActive: true,
      },
    });
  }
  if (existing) {
    const beforeJson = snapshotContact(existing);
    const patch = {};
    if (normalized.fullName && normalized.fullName !== existing.fullName) patch.fullName = normalized.fullName;
    if (normalized.title !== undefined && normalized.title !== null) patch.title = normalized.title;
    if (normalized.email !== undefined && normalized.email !== null) patch.email = normalized.email;
    if (normalized.phone !== undefined && normalized.phone !== null) {
      patch.phone = normalized._rawPhone ?? normalized.phone;
      patch.phoneE164 = normalized.phone;
    }
    if (normalized.isPrimary !== undefined && normalized.isPrimary !== null) patch.isPrimary = normalized.isPrimary;
    if (normalized.isActive !== undefined && normalized.isActive !== null) patch.isActive = normalized.isActive;
    const updated = Object.keys(patch).length > 0
      ? await prisma.accountContact.update({
          where: { id: existing.id },
          data: patch,
          select: {
            id: true, accountId: true, fullName: true, title: true, email: true, phone: true,
            phoneE164: true, isPrimary: true, isActive: true,
          },
        })
      : existing;
    // isPrimary uniqueness: if this update set isPrimary=true, demote others.
    if (patch.isPrimary === true) {
      await prisma.accountContact.updateMany({
        where: { accountId, id: { not: existing.id }, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return { kind: 'updated', recordId: existing.id, beforeJson, afterJson: snapshotContact(updated) };
  }
  // Create
  const created = await prisma.accountContact.create({
    data: {
      accountId,
      fullName: normalized.fullName,
      title: normalized.title ?? null,
      email: normalized.email ?? null,
      phone: normalized._rawPhone ?? null,
      phoneE164: normalized.phone ?? null,
      isPrimary: normalized.isPrimary ?? false,
      isActive: normalized.isActive ?? true,
    },
    select: {
      id: true, accountId: true, fullName: true, title: true, email: true, phone: true,
      phoneE164: true, isPrimary: true, isActive: true,
    },
  });
  if (created.isPrimary === true) {
    await prisma.accountContact.updateMany({
      where: { accountId, id: { not: created.id }, isPrimary: true },
      data: { isPrimary: false },
    });
  }
  return { kind: 'created', recordId: created.id, beforeJson: null, afterJson: snapshotContact(created) };
}

async function writeAddress({ companyId, accountId, normalized }) {
  // Soft uniqueness: (accountId, companyId, type, label) when label present,
  // else (accountId, companyId, type, line1). No DB constraint; app-layer
  // findFirst. WR-A8 Phase 2b hotfix (P1): companyId is REQUIRED in the
  // resolution criteria — Account can be global and span multiple tenants,
  // so a Customer 360 import for company A must NEVER update or demote a
  // company B address even when (type, label, line1) collide.
  const where = {
    accountId,
    companyId,
    type: normalized.type,
    ...(normalized.label
      ? { label: normalized.label }
      : { line1: normalized.line1 }),
  };
  const existing = await prisma.address.findFirst({
    where,
    select: {
      id: true, accountId: true, companyId: true, type: true, label: true, line1: true,
      line2: true, district: true, city: true, state: true, postalCode: true, country: true,
      isDefault: true, isActive: true,
    },
  });
  if (existing) {
    // Defense in depth: existing.companyId must equal selected companyId.
    // The findFirst above already filters by companyId; this check guards
    // against future refactor errors.
    if (existing.companyId !== companyId) {
      const err = new Error(`Address selected company guard ihlali (record companyId=${existing.companyId}, selected=${companyId}).`);
      err.code = 'address_cross_tenant_guard';
      throw err;
    }
    const beforeJson = snapshotAddress(existing);
    const patch = {};
    if (normalized.line1 && normalized.line1 !== existing.line1) patch.line1 = normalized.line1;
    if (normalized.line2 !== undefined && normalized.line2 !== null) patch.line2 = normalized.line2;
    if (normalized.district !== undefined && normalized.district !== null) patch.district = normalized.district;
    if (normalized.city !== undefined && normalized.city !== null) patch.city = normalized.city;
    if (normalized.state !== undefined && normalized.state !== null) patch.state = normalized.state;
    if (normalized.postalCode !== undefined && normalized.postalCode !== null) patch.postalCode = normalized.postalCode;
    if (normalized.country && normalized.country !== existing.country) patch.country = normalized.country;
    if (normalized.isDefault !== undefined && normalized.isDefault !== null) patch.isDefault = normalized.isDefault;
    if (normalized.isActive !== undefined && normalized.isActive !== null) patch.isActive = normalized.isActive;
    if (normalized.label !== undefined && normalized.label !== null && normalized.label !== existing.label) patch.label = normalized.label;
    const updated = Object.keys(patch).length > 0
      ? await prisma.address.update({
          where: { id: existing.id },
          data: patch,
          select: {
            id: true, accountId: true, companyId: true, type: true, label: true, line1: true,
            line2: true, district: true, city: true, state: true, postalCode: true, country: true,
            isDefault: true, isActive: true,
          },
        })
      : existing;
    if (patch.isDefault === true) {
      // WR-A8 Phase 2b hotfix (P1) — default demotion MUST be scoped to
      // selected companyId. Without it, demoting one company's default
      // would clear another company's default for the same Account.
      await prisma.address.updateMany({
        where: { accountId, companyId, type: normalized.type, id: { not: existing.id }, isDefault: true },
        data: { isDefault: false },
      });
    }
    return { kind: 'updated', recordId: existing.id, beforeJson, afterJson: snapshotAddress(updated) };
  }
  const created = await prisma.address.create({
    data: {
      accountId,
      companyId,
      type: normalized.type,
      label: normalized.label ?? null,
      line1: normalized.line1,
      line2: normalized.line2 ?? null,
      district: normalized.district ?? null,
      city: normalized.city ?? null,
      state: normalized.state ?? null,
      postalCode: normalized.postalCode ?? null,
      country: normalized.country ?? 'TR',
      isDefault: normalized.isDefault ?? false,
      isActive: normalized.isActive ?? true,
    },
    select: {
      id: true, accountId: true, companyId: true, type: true, label: true, line1: true,
      line2: true, district: true, city: true, state: true, postalCode: true, country: true,
      isDefault: true, isActive: true,
    },
  });
  if (created.isDefault === true) {
    // WR-A8 Phase 2b hotfix (P1) — same tenant-scoped demotion as above.
    await prisma.address.updateMany({
      where: { accountId, companyId, type: normalized.type, id: { not: created.id }, isDefault: true },
      data: { isDefault: false },
    });
  }
  return { kind: 'created', recordId: created.id, beforeJson: null, afterJson: snapshotAddress(created) };
}

async function writeProject({ accountCompanyId, normalized }) {
  // (accountCompanyId, code) is @@unique.
  const code = normalized.projectCode;
  const existing = await prisma.accountProject.findUnique({
    where: { accountCompanyId_code: { accountCompanyId, code } },
    select: {
      id: true, accountCompanyId: true, code: true, name: true, status: true,
      startDate: true, endDate: true, description: true, isActive: true,
    },
  });
  if (existing) {
    const beforeJson = snapshotProject(existing);
    const patch = {};
    if (normalized.projectName && normalized.projectName !== existing.name) patch.name = normalized.projectName;
    if (normalized.status) patch.status = normalized.status;
    if (normalized.startDate) patch.startDate = new Date(normalized.startDate);
    if (normalized.endDate) patch.endDate = new Date(normalized.endDate);
    if (normalized.description !== undefined && normalized.description !== null) patch.description = normalized.description;
    if (normalized.isActive !== undefined && normalized.isActive !== null) patch.isActive = normalized.isActive;
    const updated = Object.keys(patch).length > 0
      ? await prisma.accountProject.update({
          where: { id: existing.id },
          data: patch,
          select: {
            id: true, accountCompanyId: true, code: true, name: true, status: true,
            startDate: true, endDate: true, description: true, isActive: true,
          },
        })
      : existing;
    return { kind: 'updated', recordId: existing.id, beforeJson, afterJson: snapshotProject(updated) };
  }
  const created = await prisma.accountProject.create({
    data: {
      accountCompanyId,
      code,
      name: normalized.projectName,
      status: normalized.status ?? 'Active',
      startDate: normalized.startDate ? new Date(normalized.startDate) : null,
      endDate: normalized.endDate ? new Date(normalized.endDate) : null,
      description: normalized.description ?? null,
      isActive: normalized.isActive ?? true,
    },
    select: {
      id: true, accountCompanyId: true, code: true, name: true, status: true,
      startDate: true, endDate: true, description: true, isActive: true,
    },
  });
  return { kind: 'created', recordId: created.id, beforeJson: null, afterJson: snapshotProject(created) };
}

// ─────────────────────────────────────────────────────────────────
// Main commit
// ─────────────────────────────────────────────────────────────────

export async function commitCustomer360({ user, companyId, entities, sourceMeta, options = {}, jobId = null }) {
  // ─── Resume path (jobId provided): load existing job + re-process pending rows ───
  if (jobId) {
    return resumeCommit({ user, companyId, jobId, options });
  }

  // ─── Fresh commit: re-validate, then persist + process ───
  const dryRun = await dryRunCustomer360({
    companyId,
    allowedCompanyIds: user?.allowedCompanyIds ?? [],
    entities,
    sourceMeta,
  });

  if (dryRun.code === 'tckn_import_blocked') {
    throw new CommitError(dryRun.message, { status: 400, code: 'tckn_import_blocked', extra: { tcknLeaks: dryRun.tcknLeaks } });
  }
  if (dryRun.code === 'too_many_rows') {
    throw new CommitError(dryRun.message, { status: 400, code: 'too_many_rows', extra: { tooManyRows: dryRun.tooManyRows } });
  }
  if (dryRun.customer360SchemaVersion !== CUSTOMER_360_VERSION) {
    throw new CommitError('Customer 360 hedef alan şeması değişti. Lütfen eşleştirmeyi yeniden doğrulayın.', {
      status: 409, code: 'import_schema_changed',
    });
  }
  if (!dryRun.ok) {
    // Mapping invalid (unmapped required / unknown_target).
    throw new CommitError('Eşleştirme geçersiz; commit edilemez.', {
      status: 400, code: 'mapping_invalid',
      extra: { mappingValidation: dryRun.mappingValidation },
    });
  }

  const skipErrors = options.skipErrors === true;
  const totalErrors = dryRun.summary?.totalErrors ?? 0;
  if (totalErrors > 0 && !skipErrors) {
    throw new CommitError(
      "Hatalı satırlar varken içe aktarım başlatılamaz. Hatalı satırları düzeltin veya 'Hatalı satırları atla' seçeneğini işaretleyin.",
      { status: 400, code: 'import_has_errors', extra: { errorCount: totalErrors } },
    );
  }

  const persisted = await persistJob({ user, companyId, dryRun, sourceMeta });
  return processJob({ user, companyId, job: persisted.job, rowsByEntity: persisted.rowsByEntity });
}

async function resumeCommit({ user, companyId, jobId, options }) {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: {
      id: true, companyId: true, targetType: true, status: true,
      targetSchemaVersion: true, sourceType: true, sourceName: true, fileName: true,
    },
  });
  if (!job) throw new CommitError('Job bulunamadı.', { status: 404, code: 'job_not_found' });
  if (job.targetType !== 'customer360') throw new CommitError('Job customer360 targetType değil.', { status: 400, code: 'wrong_target_type' });
  if (job.companyId !== companyId) throw new CommitError('Job başka şirkete ait.', { status: 403, code: 'forbidden' });
  if (job.targetSchemaVersion !== CUSTOMER_360_VERSION) {
    throw new CommitError('Customer 360 hedef alan şeması değişti. Lütfen eşleştirmeyi yeniden doğrulayın.', {
      status: 409, code: 'import_schema_changed',
    });
  }
  if (!['running', 'partial', 'failed'].includes(job.status)) {
    throw new CommitError(`Bu durumdaki job tekrar commit edilemez: ${job.status}`, { status: 400, code: 'invalid_status' });
  }
  // Load all rows grouped by entity (status='pending' will be processed).
  const rowsByEntity = {};
  for (const entity of ENTITY_ORDER) {
    rowsByEntity[entity] = await prisma.importJobRow.findMany({
      where: { importJobId: jobId, entityType: entity },
      orderBy: { rowNumber: 'asc' },
    });
  }
  await prisma.importJob.update({ where: { id: jobId }, data: { status: 'running' } });
  return processJob({ user, companyId, job: { id: jobId }, rowsByEntity, resume: true });
}

async function processJob({ user, companyId, job, rowsByEntity, resume = false }) {
  void user;
  // Index of (entity, rowNumber) → recordId for parent resolution by child entities.
  // We populate `account` after writing accounts; then accountCompany; etc.
  // Maps source `accountKey` (normalized) → DB Account.id.
  const accountIdByKey = new Map();
  // Maps (accountKey, companyCode) → AccountCompany.id.
  const accountCompanyIdByKey = new Map();

  // Build initial maps from pre-existing rows in DB (resume case).
  if (resume) {
    for (const r of rowsByEntity.account ?? []) {
      if ((r.status === 'created' || r.status === 'updated') && r.accountId) {
        const key = r.normalizedJson?.vkn ?? r.normalizedJson?.name;
        if (key) accountIdByKey.set(String(key).toLowerCase(), r.accountId);
        if (r.normalizedJson?.vkn) accountIdByKey.set(String(r.normalizedJson.vkn), r.accountId);
        if (r.normalizedJson?.name) accountIdByKey.set(String(r.normalizedJson.name).toLowerCase(), r.accountId);
      }
    }
    for (const r of rowsByEntity.accountCompany ?? []) {
      if ((r.status === 'created' || r.status === 'updated') && r.recordId && r.normalizedJson?.accountKey && r.normalizedJson?.companyCode) {
        accountCompanyIdByKey.set(`${r.normalizedJson.accountKey}|${r.normalizedJson.companyCode}`, r.recordId);
      }
    }
  }

  function rememberAccount(normalized, accountId) {
    if (!accountId) return;
    if (normalized?.vkn) accountIdByKey.set(String(normalized.vkn), accountId);
    if (normalized?.name) accountIdByKey.set(String(normalized.name).toLowerCase(), accountId);
  }
  function resolveAccountId(accountKey) {
    if (!accountKey) return null;
    return accountIdByKey.get(String(accountKey)) ?? accountIdByKey.get(String(accountKey).toLowerCase()) ?? null;
  }

  let totals = { created: 0, updated: 0, skipped: 0, error: 0 };
  const entityCounts = {};

  for (const entity of ENTITY_ORDER) {
    const rows = rowsByEntity[entity] ?? [];
    const eStats = { created: 0, updated: 0, skipped: 0, error: 0, total: rows.length };
    for (const row of rows) {
      // Idempotent retry: skip rows already in a terminal state.
      if (row.status === 'created' || row.status === 'updated' || row.status === 'rolled_back') {
        // Still propagate parent map for subsequent children.
        if (entity === 'account' && row.accountId) rememberAccount(row.normalizedJson, row.accountId);
        if (entity === 'accountCompany' && row.recordId && row.normalizedJson?.accountKey && row.normalizedJson?.companyCode) {
          accountCompanyIdByKey.set(`${row.normalizedJson.accountKey}|${row.normalizedJson.companyCode}`, row.recordId);
        }
        if (row.status === 'created') eStats.created += 1;
        if (row.status === 'updated') eStats.updated += 1;
        continue;
      }
      if (row.status === 'skipped') { eStats.skipped += 1; continue; }
      if (row.status === 'error') { eStats.error += 1; continue; }
      if (row.action === 'skip') {
        await prisma.importJobRow.update({ where: { id: row.id }, data: { status: 'skipped', updatedAt: new Date() } });
        eStats.skipped += 1;
        continue;
      }

      const normalized = row.normalizedJson ?? {};
      try {
        if (entity === 'account') {
          const r = await writeAccount(row, normalized);
          await prisma.importJobRow.update({
            where: { id: row.id },
            data: { status: r.kind, accountId: r.recordId, recordId: r.recordId, beforeJson: r.beforeJson, afterJson: r.afterJson, updatedAt: new Date() },
          });
          rememberAccount(normalized, r.recordId);
          if (r.kind === 'created') eStats.created += 1; else eStats.updated += 1;
          continue;
        }

        // Resolve parent account for child entities
        const accountKey = normalized.accountKey;
        const parentAccountId = resolveAccountId(accountKey);
        if (!parentAccountId) {
          await prisma.importJobRow.update({
            where: { id: row.id },
            data: {
              status: 'error',
              errorsJson: appendRowErrors(row.errorsJson, [{
                entity, targetKey: 'accountKey', label: 'Müşteri Anahtarı',
                code: 'parent_account_unresolved',
                message: `Parent Account ${entity} satırı için resolve edilemedi (accountKey="${accountKey}"). Parent satır skipErrors veya hatalı olabilir.`,
              }]),
              updatedAt: new Date(),
            },
          });
          eStats.error += 1;
          continue;
        }

        if (entity === 'accountCompany') {
          const r = await writeAccountCompany({ companyId, accountId: parentAccountId, normalized });
          await prisma.importJobRow.update({
            where: { id: row.id },
            data: { status: r.kind, recordId: r.recordId, beforeJson: r.beforeJson, afterJson: r.afterJson, updatedAt: new Date() },
          });
          // Map (accountKey, companyCode) → AC.id for downstream projects.
          if (normalized.accountKey && normalized.companyCode) {
            accountCompanyIdByKey.set(`${normalized.accountKey}|${normalized.companyCode}`, r.recordId);
          }
          if (r.kind === 'created') eStats.created += 1; else eStats.updated += 1;
          continue;
        }

        if (entity === 'accountContact') {
          const r = await writeContact({ accountId: parentAccountId, normalized });
          await prisma.importJobRow.update({
            where: { id: row.id },
            data: { status: r.kind, recordId: r.recordId, beforeJson: r.beforeJson, afterJson: r.afterJson, updatedAt: new Date() },
          });
          if (r.kind === 'created') eStats.created += 1; else eStats.updated += 1;
          continue;
        }

        if (entity === 'accountAddress') {
          const r = await writeAddress({ companyId, accountId: parentAccountId, normalized });
          await prisma.importJobRow.update({
            where: { id: row.id },
            data: { status: r.kind, recordId: r.recordId, beforeJson: r.beforeJson, afterJson: r.afterJson, updatedAt: new Date() },
          });
          if (r.kind === 'created') eStats.created += 1; else eStats.updated += 1;
          continue;
        }

        if (entity === 'accountProject') {
          // accountCompanyKey was bound to selected companyId in dry-run.
          const acKey = `${normalized.accountKey}|${normalized.accountCompanyKey}`;
          const accountCompanyId = accountCompanyIdByKey.get(acKey);
          if (!accountCompanyId) {
            // Try to look up an existing AccountCompany for (parentAccountId, companyId)
            // — when the source had no accountCompany row but the relation exists in DB.
            const existingAc = await prisma.accountCompany.findUnique({
              where: { accountId_companyId: { accountId: parentAccountId, companyId } },
              select: { id: true },
            });
            if (!existingAc) {
              await prisma.importJobRow.update({
                where: { id: row.id },
                data: {
                  status: 'error',
                  errorsJson: appendRowErrors(row.errorsJson, [{
                    entity, targetKey: 'accountCompanyKey', label: 'Şirket İlişki Anahtarı',
                    code: 'parent_account_company_unresolved',
                    message: `Parent AccountCompany resolve edilemedi (accountKey="${normalized.accountKey}").`,
                  }]),
                  updatedAt: new Date(),
                },
              });
              eStats.error += 1;
              continue;
            }
            accountCompanyIdByKey.set(acKey, existingAc.id);
          }
          const finalAcId = accountCompanyIdByKey.get(acKey);
          const r = await writeProject({ accountCompanyId: finalAcId, normalized });
          await prisma.importJobRow.update({
            where: { id: row.id },
            data: { status: r.kind, recordId: r.recordId, beforeJson: r.beforeJson, afterJson: r.afterJson, updatedAt: new Date() },
          });
          if (r.kind === 'created') eStats.created += 1; else eStats.updated += 1;
          continue;
        }
      } catch (err) {
        await prisma.importJobRow.update({
          where: { id: row.id },
          data: {
            status: 'error',
            errorsJson: appendRowErrors(row.errorsJson, [{
              entity, targetKey: null, label: null,
              code: err?.code ?? 'commit_error',
              message: safeErrorMessage(err),
            }]),
            updatedAt: new Date(),
          },
        });
        eStats.error += 1;
      }
    }
    entityCounts[entity] = eStats;
    totals.created += eStats.created;
    totals.updated += eStats.updated;
    totals.skipped += eStats.skipped;
    totals.error += eStats.error;
  }

  const hasError = totals.error > 0;
  const status = hasError ? 'partial' : 'completed';

  const finalJob = await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status,
      completedAt: new Date(),
      createCount: totals.created,
      updateCount: totals.updated,
      skippedCount: totals.skipped,
      errorCount: totals.error,
      entityCountsJson: entityCounts,
    },
    select: {
      id: true, status: true, totalRows: true, createCount: true, updateCount: true,
      skippedCount: true, errorCount: true, warningCount: true, startedAt: true, completedAt: true,
      entityCountsJson: true,
    },
  });

  return { job: finalJob, runStats: totals, entityCounts };
}

// ─────────────────────────────────────────────────────────────────
// Rollback
// ─────────────────────────────────────────────────────────────────

export async function rollbackCustomer360({ jobId, user }) {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: { id: true, companyId: true, targetType: true, status: true },
  });
  if (!job) throw new CommitError('Job bulunamadı.', { status: 404, code: 'job_not_found' });
  if (job.targetType !== 'customer360') {
    throw new CommitError('Job customer360 targetType değil.', { status: 400, code: 'wrong_target_type' });
  }
  if (!['completed', 'partial'].includes(job.status)) {
    throw new CommitError('Bu durumdaki job geri alınamaz.', { status: 400, code: 'invalid_status_for_rollback' });
  }

  let rolledBackByEntity = {};
  let failedCount = 0;
  const failedRows = [];

  for (const entity of ROLLBACK_ORDER) {
    const stats = { rolledBack: 0, failed: 0, skipped: 0 };
    const rows = await prisma.importJobRow.findMany({
      where: { importJobId: jobId, entityType: entity, status: { in: ['created', 'updated'] } },
      orderBy: { rowNumber: 'desc' }, // reverse insertion order within entity
    });
    for (const r of rows) {
      const rowErrors = [];
      try {
        if (entity === 'account') {
          // Created → isActive=false; Updated → restore beforeJson account fields (excluding vkn).
          if (r.status === 'created' && r.recordId) {
            await prisma.account.update({ where: { id: r.recordId }, data: { isActive: false } });
          } else if (r.status === 'updated' && r.recordId && r.beforeJson) {
            const before = r.beforeJson;
            const restore = {};
            for (const k of ['name', 'phone', 'phoneE164', 'email', 'customerType', 'legalName', 'registrationNo', 'isActive']) {
              if (before[k] !== undefined) restore[k] = before[k];
            }
            await prisma.account.update({ where: { id: r.recordId }, data: restore });
          }
        } else if (entity === 'accountCompany') {
          if (r.status === 'created' && r.recordId) {
            await prisma.accountCompany.update({ where: { id: r.recordId }, data: { status: 'inactive' } });
          } else if (r.status === 'updated' && r.recordId && r.beforeJson) {
            const before = r.beforeJson;
            const restore = {};
            if (before.externalCustomerCode !== undefined) restore.externalCustomerCode = before.externalCustomerCode;
            if (before.packageName !== undefined) restore.packageName = before.packageName;
            if (before.segment !== undefined) restore.segment = before.segment;
            if (before.status !== undefined) restore.status = before.status;
            if (before.contractStartAt !== undefined) restore.contractStartAt = before.contractStartAt ? new Date(before.contractStartAt) : null;
            if (before.contractEndAt !== undefined) restore.contractEndAt = before.contractEndAt ? new Date(before.contractEndAt) : null;
            if (Object.keys(restore).length > 0) {
              await prisma.accountCompany.update({ where: { id: r.recordId }, data: restore });
            }
          }
        } else if (entity === 'accountContact') {
          if (r.status === 'created' && r.recordId) {
            await prisma.accountContact.update({ where: { id: r.recordId }, data: { isActive: false } });
          } else if (r.status === 'updated' && r.recordId && r.beforeJson) {
            const before = r.beforeJson;
            const restore = {};
            for (const k of ['fullName', 'title', 'email', 'phone', 'phoneE164', 'isPrimary', 'isActive']) {
              if (before[k] !== undefined) restore[k] = before[k];
            }
            await prisma.accountContact.update({ where: { id: r.recordId }, data: restore });
          }
        } else if (entity === 'accountAddress') {
          // WR-A8 Phase 2b hotfix (P1) — selected-company guard on rollback.
          // The recordId was written under job.companyId at commit time; if
          // it somehow refers to a different tenant now (DB drift), refuse
          // the restore. updateMany guards include companyId.
          if (r.status === 'created' && r.recordId) {
            const um = await prisma.address.updateMany({
              where: { id: r.recordId, companyId: job.companyId },
              data: { isActive: false },
            });
            if (um.count === 0) {
              const err = new Error('Address rollback: kayıt bu şirkete ait değil.');
              err.code = 'address_cross_tenant_rollback';
              throw err;
            }
          } else if (r.status === 'updated' && r.recordId && r.beforeJson) {
            const before = r.beforeJson;
            const restore = {};
            for (const k of ['label', 'line1', 'line2', 'district', 'city', 'state', 'postalCode', 'country', 'isDefault', 'isActive']) {
              if (before[k] !== undefined) restore[k] = before[k];
            }
            const um = await prisma.address.updateMany({
              where: { id: r.recordId, companyId: job.companyId },
              data: restore,
            });
            if (um.count === 0) {
              const err = new Error('Address rollback: kayıt bu şirkete ait değil.');
              err.code = 'address_cross_tenant_rollback';
              throw err;
            }
          }
        } else if (entity === 'accountProject') {
          if (r.status === 'created' && r.recordId) {
            await prisma.accountProject.update({ where: { id: r.recordId }, data: { status: 'Passive', isActive: false } });
          } else if (r.status === 'updated' && r.recordId && r.beforeJson) {
            const before = r.beforeJson;
            const restore = {};
            if (before.name !== undefined) restore.name = before.name;
            if (before.status !== undefined) restore.status = before.status;
            if (before.startDate !== undefined) restore.startDate = before.startDate ? new Date(before.startDate) : null;
            if (before.endDate !== undefined) restore.endDate = before.endDate ? new Date(before.endDate) : null;
            if (before.description !== undefined) restore.description = before.description;
            if (before.isActive !== undefined) restore.isActive = before.isActive;
            if (Object.keys(restore).length > 0) {
              await prisma.accountProject.update({ where: { id: r.recordId }, data: restore });
            }
          }
        }
      } catch (err) {
        rowErrors.push({
          entity,
          code: `${entity}_rollback_failed`,
          targetKey: null,
          label: null,
          message: `${entity} geri alınamadı: ${safeErrorMessage(err)}`,
        });
      }

      if (rowErrors.length > 0) {
        await prisma.importJobRow.update({
          where: { id: r.id },
          data: {
            status: 'rollback_error',
            errorsJson: appendRowErrors(r.errorsJson, rowErrors),
            updatedAt: new Date(),
          },
        });
        stats.failed += 1;
        failedCount += 1;
        failedRows.push({ rowNumber: r.rowNumber, entity, errors: rowErrors });
      } else {
        await prisma.importJobRow.update({
          where: { id: r.id },
          data: { status: 'rolled_back', updatedAt: new Date() },
        });
        stats.rolledBack += 1;
      }
    }
    rolledBackByEntity[entity] = stats;
  }

  const finalStatus = failedCount === 0 ? 'rolled_back' : 'rollback_partial';
  const updated = await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: finalStatus,
      rolledBackAt: new Date(),
      rolledBackByUserId: user?.id ?? null,
    },
    select: { id: true, status: true, rolledBackAt: true },
  });

  return {
    job: updated,
    report: {
      rolledBackByEntity,
      failedCount,
      errorCount: failedCount,
      failedRows,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Job + rows readers (for UI status/audit)
// ─────────────────────────────────────────────────────────────────

export async function getCustomer360Job({ jobId, allowedCompanyIds }) {
  const allowed = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: {
      id: true, companyId: true, targetType: true, sourceType: true, sourceName: true,
      sourceUrlMasked: true, fileName: true, dataPath: true, targetSchemaVersion: true,
      status: true, totalRows: true, createCount: true, updateCount: true,
      skippedCount: true, errorCount: true, warningCount: true, summaryJson: true,
      entityCountsJson: true, createdByUserId: true, createdAt: true, startedAt: true,
      completedAt: true, rolledBackAt: true, rolledBackByUserId: true,
    },
  });
  if (!job) return null;
  if (job.targetType !== 'customer360') return null;
  if (!allowed.includes(job.companyId)) return null;
  return job;
}

export async function listCustomer360JobRows({ jobId, entity = null, status = null, limit = 500, offset = 0 }) {
  const where = { importJobId: jobId };
  if (entity) where.entityType = entity;
  if (status) where.status = status;
  return prisma.importJobRow.findMany({
    where,
    orderBy: [{ entityType: 'asc' }, { rowNumber: 'asc' }],
    take: Math.min(Math.max(1, limit), 2000),
    skip: Math.max(0, offset),
    select: {
      id: true, rowNumber: true, entityType: true, parentRowNumber: true,
      relationshipKey: true, action: true, status: true, accountId: true, recordId: true,
      matchKey: true, errorsJson: true, warningsJson: true, normalizedJson: true,
      beforeJson: true, afterJson: true,
    },
  });
}
