/**
 * WR-A8 Phase 2a — Customer 360 dry-run engine.
 *
 * In-memory only. No DB writes. No ImportJob/ImportJobRow persistence.
 * Returns per-entity counts, orphan child detection, completeness score,
 * and skipErrors preview (what would happen on commit if commit existed).
 *
 * Phase 2b will add commit + persistence + rollback. This file MUST keep
 * its zero-mutation invariant — smoke #13 asserts it.
 */

import { prisma } from '../../db/client.js';
import {
  CUSTOMER_360_VERSION,
  CUSTOMER_360_ENTITIES,
  CUSTOMER_360_RELATIONSHIPS,
  normalizeEntityRow,
  validateEntityMapping,
  detectTcknHeader,
} from './targetSchemas/customer360TargetSchemas/index.js';

// Per-entity row caps (Phase 2a; planning card §⑥).
export const MAX_ROWS_PER_ENTITY = {
  account: 5000,
  accountCompany: 10000,
  accountContact: 10000,
  accountAddress: 10000,
  accountProject: 10000,
};

const PARENT_ENTITIES = ['accountCompany', 'accountContact', 'accountAddress', 'accountProject'];

/**
 * Run dry-run for a Customer 360 import. Returns the full structured
 * response. Side effects: NONE (no DB writes; only one read for VKN match
 * lookup is performed via prisma.account.findMany — read-only).
 *
 * @param {Object} input
 * @param {string} input.companyId — selected wizard company (tenant scope)
 * @param {Array<string>} input.allowedCompanyIds — per req.user
 * @param {Object} input.entities — { account: { mapping, rows },
 *                                     accountCompany: { mapping, rows }, ... }
 * @param {Object} input.sourceMeta — { sourceType, fileName, sourceUrlMasked, dataPath }
 * @returns {Promise<Object>}
 */
export async function dryRunCustomer360({ companyId, allowedCompanyIds, entities, sourceMeta }) {
  const entityKeys = CUSTOMER_360_ENTITIES.map((e) => e.entity);
  const mappingValidation = {};
  for (const ek of entityKeys) {
    const m = entities?.[ek]?.mapping ?? [];
    mappingValidation[ek] = validateEntityMapping(ek, m);
  }

  // If any required mapping invalid, return early — no row processing.
  const mappingHasError = Object.values(mappingValidation).some((mv) => !mv.ok);

  // TCKN header guard across all entity sheets (Privacy Guardrail #1).
  const tcknLeaks = [];
  for (const ek of entityKeys) {
    const cols = entities?.[ek]?.columns ?? [];
    const leaks = detectTcknHeader(cols);
    if (leaks.length > 0) tcknLeaks.push({ entity: ek, columns: leaks });
  }

  // Row count caps.
  const tooManyRows = [];
  for (const ek of entityKeys) {
    const rows = entities?.[ek]?.rows ?? [];
    if (rows.length > (MAX_ROWS_PER_ENTITY[ek] ?? 5000)) {
      tooManyRows.push({ entity: ek, count: rows.length, max: MAX_ROWS_PER_ENTITY[ek] });
    }
  }

  if (tcknLeaks.length > 0) {
    return {
      ok: false,
      commitAvailable: false,
      code: 'tckn_import_blocked',
      message: 'TCKN import yasak: kaynak verisinde TCKN benzeri sütun bulundu.',
      tcknLeaks,
      customer360SchemaVersion: CUSTOMER_360_VERSION,
    };
  }
  if (tooManyRows.length > 0) {
    return {
      ok: false,
      commitAvailable: false,
      code: 'too_many_rows',
      message: 'Bir veya daha fazla entity için satır limiti aşıldı.',
      tooManyRows,
      customer360SchemaVersion: CUSTOMER_360_VERSION,
    };
  }

  // Normalize every row per entity.
  const normalizedByEntity = {};
  for (const ek of entityKeys) {
    const block = entities?.[ek] ?? {};
    const mapping = block.mapping ?? [];
    const rows = block.rows ?? [];
    const out = rows.map((rawRow, idx) => {
      const { normalized, errors, warnings } = normalizeEntityRow(ek, rawRow, mapping);
      return { rowNumber: idx + 1, raw: rawRow, normalized, errors: [...errors], warnings: [...warnings] };
    });
    normalizedByEntity[ek] = out;
  }

  // Cross-tenant guard: any source row carrying a companyId field that
  // doesn't match the wizard companyId raises a guardrail warning. (For
  // companyCode resolution in accountCompany, see below.)
  for (const ek of entityKeys) {
    for (const r of normalizedByEntity[ek]) {
      const sourceCompanyId = r.raw?.companyId ?? r.raw?.company_id ?? null;
      if (sourceCompanyId && sourceCompanyId !== companyId) {
        // Soft warning — we ignore source companyId by design.
        r.warnings.push({
          entity: ek,
          targetKey: null,
          label: null,
          code: 'source_company_id_ignored',
          message: `Kaynak satırındaki companyId="${sourceCompanyId}" yok sayıldı; seçili hedef şirket kullanıldı.`,
        });
      }
    }
  }

  // Build parent index for account (relationship key resolution).
  // Phase 2a: accountKey is matched against (vkn || externalCustomerCode || name)
  // of the corresponding account row IN THIS IMPORT BATCH (not DB).
  const accountIndex = new Map(); // key → { rowNumber, normalized }
  for (const r of normalizedByEntity.account ?? []) {
    if (r.errors.length > 0) continue;
    const n = r.normalized;
    if (n.vkn) accountIndex.set(`vkn:${n.vkn}`, r);
    // externalCustomerCode lives on accountCompany; not used as account-level key here.
    if (n.name) accountIndex.set(`name:${n.name.toLowerCase()}`, r);
  }
  function resolveAccountKey(key) {
    if (!key) return null;
    const v = String(key).trim();
    if (!v) return null;
    return (
      accountIndex.get(`vkn:${v}`) ??
      accountIndex.get(`name:${v.toLowerCase()}`) ??
      null
    );
  }

  // Build accountCompany index for project parent resolution.
  // Key: `${accountKey}|${companyCode}` → accountCompany row
  const accountCompanyIndex = new Map();
  for (const r of normalizedByEntity.accountCompany ?? []) {
    if (r.errors.length > 0) continue;
    const n = r.normalized;
    if (n.accountKey && n.companyCode) {
      accountCompanyIndex.set(`${n.accountKey}|${n.companyCode}`, r);
    }
  }
  function resolveAccountCompanyKey(accountKey, companyCode) {
    if (!accountKey || !companyCode) return null;
    return accountCompanyIndex.get(`${accountKey}|${companyCode}`) ?? null;
  }

  // Orphan + relationship + duplicate checks per child entity.
  // Children: accountCompany / accountContact / accountAddress / accountProject
  const orphansByEntity = {
    accountCompany: [],
    accountContact: [],
    accountAddress: [],
    accountProject: [],
  };

  // accountCompany — needs accountKey + companyCode (already required by schema)
  for (const r of normalizedByEntity.accountCompany ?? []) {
    if (r.errors.length > 0) continue;
    const parent = resolveAccountKey(r.normalized.accountKey);
    if (!parent) {
      const err = {
        entity: 'accountCompany',
        targetKey: 'accountKey',
        label: 'Müşteri Anahtarı',
        code: 'orphan_child_row',
        message: `accountKey="${r.normalized.accountKey}" parent Account satırına eşleşmedi.`,
      };
      r.errors.push(err);
      orphansByEntity.accountCompany.push(r.rowNumber);
    }
    // Cross-tenant: if admin not allowed for companyCode → soft warn (Phase 2a
    // doesn't have full company-code → companyId lookup; we leave that to 2b).
    if (
      r.normalized.companyCode &&
      Array.isArray(allowedCompanyIds) &&
      !allowedCompanyIds.includes(r.normalized.companyCode)
    ) {
      r.errors.push({
        entity: 'accountCompany',
        targetKey: 'companyCode',
        label: 'Varuna Şirket Kodu',
        code: 'cross_tenant_company',
        message: `Bu şirkete (${r.normalized.companyCode}) erişim yetkin yok.`,
      });
    }
  }

  // accountContact — orphan + duplicate detection per account
  const contactDupTracker = new Map(); // `${accountKey}|${email}` → rowNumbers[]
  const primaryByAccount = new Map(); // accountKey → count
  for (const r of normalizedByEntity.accountContact ?? []) {
    if (r.errors.length > 0) continue;
    const parent = resolveAccountKey(r.normalized.accountKey);
    if (!parent) {
      r.errors.push({
        entity: 'accountContact',
        targetKey: 'accountKey',
        label: 'Müşteri Anahtarı',
        code: 'orphan_child_row',
        message: `accountKey="${r.normalized.accountKey}" parent Account satırına eşleşmedi.`,
      });
      orphansByEntity.accountContact.push(r.rowNumber);
      continue;
    }
    if (r.normalized.email) {
      const k = `${r.normalized.accountKey}|${r.normalized.email.toLowerCase()}`;
      const list = contactDupTracker.get(k) ?? [];
      list.push(r.rowNumber);
      contactDupTracker.set(k, list);
    }
    if (r.normalized.isPrimary === true) {
      primaryByAccount.set(r.normalized.accountKey, (primaryByAccount.get(r.normalized.accountKey) ?? 0) + 1);
    }
  }
  // Apply duplicates as warnings (not blocking; per planning card §⑦.C)
  for (const [k, list] of contactDupTracker.entries()) {
    if (list.length < 2) continue;
    for (const rn of list) {
      const r = normalizedByEntity.accountContact.find((x) => x.rowNumber === rn);
      if (r) {
        r.warnings.push({
          entity: 'accountContact',
          targetKey: 'email',
          label: 'E-posta',
          code: 'duplicate_contact_in_source',
          message: `Aynı müşteri+email içinde duplicate kontakt (satırlar: ${list.join(', ')}).`,
        });
      }
    }
  }
  // Multiple isPrimary=true → error on all marked primary rows for that account
  for (const [ak, count] of primaryByAccount.entries()) {
    if (count > 1) {
      for (const r of normalizedByEntity.accountContact) {
        if (r.normalized.accountKey === ak && r.normalized.isPrimary === true) {
          r.errors.push({
            entity: 'accountContact',
            targetKey: 'isPrimary',
            label: 'Birincil mi?',
            code: 'multiple_primary_contacts',
            message: 'Müşteri başına yalnız bir birincil iletişim olabilir.',
          });
        }
      }
    }
  }

  // accountAddress — orphan + isDefault uniqueness per (accountKey, type)
  const defaultByAccountType = new Map();
  for (const r of normalizedByEntity.accountAddress ?? []) {
    if (r.errors.length > 0) continue;
    const parent = resolveAccountKey(r.normalized.accountKey);
    if (!parent) {
      r.errors.push({
        entity: 'accountAddress',
        targetKey: 'accountKey',
        label: 'Müşteri Anahtarı',
        code: 'orphan_child_row',
        message: `accountKey="${r.normalized.accountKey}" parent Account satırına eşleşmedi.`,
      });
      orphansByEntity.accountAddress.push(r.rowNumber);
      continue;
    }
    if (r.normalized.isDefault === true) {
      const k = `${r.normalized.accountKey}|${r.normalized.type}`;
      defaultByAccountType.set(k, (defaultByAccountType.get(k) ?? 0) + 1);
    }
  }
  for (const [k, count] of defaultByAccountType.entries()) {
    if (count > 1) {
      const [ak, type] = k.split('|');
      for (const r of normalizedByEntity.accountAddress) {
        if (r.normalized.accountKey === ak && r.normalized.type === type && r.normalized.isDefault === true) {
          r.errors.push({
            entity: 'accountAddress',
            targetKey: 'isDefault',
            label: 'Varsayılan mı?',
            code: 'multiple_default_addresses',
            message: `Aynı müşteri ve adres tipi için (${type}) yalnız bir varsayılan adres olabilir.`,
          });
        }
      }
    }
  }

  // accountProject — orphan + AccountCompany resolution + projectCode uniqueness
  const projectCodeByCompany = new Map();
  for (const r of normalizedByEntity.accountProject ?? []) {
    if (r.errors.length > 0) continue;
    const parentAccount = resolveAccountKey(r.normalized.accountKey);
    if (!parentAccount) {
      r.errors.push({
        entity: 'accountProject',
        targetKey: 'accountKey',
        label: 'Müşteri Anahtarı',
        code: 'orphan_child_row',
        message: `accountKey="${r.normalized.accountKey}" parent Account satırına eşleşmedi.`,
      });
      orphansByEntity.accountProject.push(r.rowNumber);
      continue;
    }
    const parentAc = resolveAccountCompanyKey(r.normalized.accountKey, r.normalized.accountCompanyKey);
    if (!parentAc) {
      r.errors.push({
        entity: 'accountProject',
        targetKey: 'accountCompanyKey',
        label: 'Şirket İlişki Anahtarı',
        code: 'orphan_project_company',
        message: `accountKey="${r.normalized.accountKey}" + accountCompanyKey="${r.normalized.accountCompanyKey}" eşleşmedi.`,
      });
      orphansByEntity.accountProject.push(r.rowNumber);
      continue;
    }
    const k = `${r.normalized.accountKey}|${r.normalized.accountCompanyKey}|${r.normalized.projectCode}`;
    const seen = projectCodeByCompany.get(k);
    if (seen) {
      r.errors.push({
        entity: 'accountProject',
        targetKey: 'projectCode',
        label: 'Proje Kodu',
        code: 'duplicate_project_code',
        message: `AccountCompany içinde aynı projectCode birden fazla kez geçiyor (satırlar: ${seen}, ${r.rowNumber}).`,
      });
    } else {
      projectCodeByCompany.set(k, r.rowNumber);
    }
    // startDate ≤ endDate
    if (r.normalized.startDate && r.normalized.endDate) {
      if (new Date(r.normalized.startDate) > new Date(r.normalized.endDate)) {
        r.errors.push({
          entity: 'accountProject',
          targetKey: 'endDate',
          label: 'Bitiş',
          code: 'invalid_date_range',
          message: 'Başlangıç tarihi bitiş tarihinden sonra olamaz.',
        });
      }
    }
  }

  // DB read (read-only) — figure out create vs update for accounts via VKN.
  const vkns = (normalizedByEntity.account ?? [])
    .filter((r) => r.errors.length === 0 && r.normalized.vkn)
    .map((r) => r.normalized.vkn);
  let existingByVkn = new Map();
  if (vkns.length > 0) {
    const existing = await prisma.account.findMany({
      where: { vkn: { in: [...new Set(vkns)] } },
      select: { id: true, vkn: true, name: true },
    });
    existingByVkn = new Map(existing.map((a) => [a.vkn, a]));
  }

  // Compute action per row for each entity. Phase 2a doesn't commit;
  // action is informational ("would create" / "would update" / "would skip"
  // / "error"). Updates are detected for account via VKN match; child
  // entities are reported as "would create" (no DB match in Phase 2a since
  // children would key off the parent's eventual DB id).
  for (const r of normalizedByEntity.account ?? []) {
    if (r.errors.length > 0) {
      r.action = 'error';
    } else if (r.normalized.vkn && existingByVkn.has(r.normalized.vkn)) {
      r.action = 'update';
      r.matchedAccountName = existingByVkn.get(r.normalized.vkn).name;
    } else {
      r.action = 'create';
    }
  }
  for (const ek of PARENT_ENTITIES) {
    for (const r of normalizedByEntity[ek] ?? []) {
      if (r.errors.length > 0) {
        r.action = 'error';
      } else {
        // Phase 2a: child entities reported as "create" only (commit semantics
        // and DB-based update detection arrive in 2b).
        r.action = 'create';
      }
    }
  }

  // Per-entity summary.
  const byEntity = {};
  let totalRows = 0;
  let totalErrors = 0;
  let totalWarnings = 0;
  for (const ek of entityKeys) {
    const rows = normalizedByEntity[ek] ?? [];
    const summary = { total: 0, create: 0, update: 0, skip: 0, error: 0, warning: 0 };
    for (const r of rows) {
      summary.total += 1;
      summary[r.action] = (summary[r.action] ?? 0) + 1;
      if (r.warnings.length > 0) summary.warning += 1;
    }
    byEntity[ek] = summary;
    totalRows += summary.total;
    totalErrors += summary.error;
    totalWarnings += summary.warning;
  }

  // Completeness score (per planning card §⑬).
  const totalAccounts = byEntity.account.total;
  const accountsWithCompany = new Set();
  const accountsWithContact = new Set();
  const accountsWithAddress = new Set();
  const accountsWithProject = new Set();
  for (const r of normalizedByEntity.accountCompany ?? []) {
    if (r.errors.length === 0 && r.normalized.accountKey) accountsWithCompany.add(r.normalized.accountKey);
  }
  for (const r of normalizedByEntity.accountContact ?? []) {
    if (r.errors.length === 0 && r.normalized.accountKey) accountsWithContact.add(r.normalized.accountKey);
  }
  for (const r of normalizedByEntity.accountAddress ?? []) {
    if (r.errors.length === 0 && r.normalized.accountKey) accountsWithAddress.add(r.normalized.accountKey);
  }
  for (const r of normalizedByEntity.accountProject ?? []) {
    if (r.errors.length === 0 && r.normalized.accountKey) accountsWithProject.add(r.normalized.accountKey);
  }
  const completenessScore = {
    accountsWithCompany: { have: accountsWithCompany.size, total: totalAccounts, pct: totalAccounts > 0 ? Math.round((accountsWithCompany.size / totalAccounts) * 100) : 0 },
    accountsWithContact: { have: accountsWithContact.size, total: totalAccounts, pct: totalAccounts > 0 ? Math.round((accountsWithContact.size / totalAccounts) * 100) : 0 },
    accountsWithAddress: { have: accountsWithAddress.size, total: totalAccounts, pct: totalAccounts > 0 ? Math.round((accountsWithAddress.size / totalAccounts) * 100) : 0 },
    accountsWithProject: { have: accountsWithProject.size, total: totalAccounts, pct: totalAccounts > 0 ? Math.round((accountsWithProject.size / totalAccounts) * 100) : 0 },
  };

  // Preview: first 100 rows per entity (Phase 2a UI display).
  const preview = {};
  for (const ek of entityKeys) {
    const rows = normalizedByEntity[ek] ?? [];
    preview[ek] = rows.slice(0, 100).map((r) => ({
      rowNumber: r.rowNumber,
      action: r.action,
      errors: r.errors,
      warnings: r.warnings,
      normalized: r.normalized,
      matchedAccountName: r.matchedAccountName ?? null,
    }));
  }

  // skipErrors preview (what would happen on a hypothetical commit).
  // skipErrors=false → block when any error exists anywhere
  // skipErrors=true → cascading skip: invalid parent → all children skipped
  const skipErrorsPreview = {
    blockedIfSkipErrorsFalse: totalErrors > 0,
    cascadingSkipIfSkipErrorsTrue: computeCascadingSkip(normalizedByEntity, resolveAccountKey),
  };

  return {
    ok: !mappingHasError,
    commitAvailable: false, // Phase 2a — explicit
    message: 'Customer 360 Phase 2a yalnızca doğrulama ve dry-run sağlar. Gerçek aktarım Phase 2b\'de eklenecektir.',
    customer360SchemaVersion: CUSTOMER_360_VERSION,
    mappingValidation,
    summary: {
      totalRows,
      totalErrors,
      totalWarnings,
      byEntity,
      completenessScore,
      orphansByEntity,
    },
    skipErrorsPreview,
    preview,
    relationships: CUSTOMER_360_RELATIONSHIPS,
    sourceMeta: sourceMeta ?? null,
  };
}

function computeCascadingSkip(normalizedByEntity, resolveAccountKey) {
  const blockedAccounts = new Set();
  for (const r of normalizedByEntity.account ?? []) {
    if (r.errors.length > 0 && r.normalized.vkn) blockedAccounts.add(r.normalized.vkn);
    if (r.errors.length > 0 && r.normalized.name) blockedAccounts.add(r.normalized.name.toLowerCase());
  }
  const cascade = { account: 0, accountCompany: 0, accountContact: 0, accountAddress: 0, accountProject: 0 };
  cascade.account = normalizedByEntity.account?.filter((r) => r.errors.length > 0).length ?? 0;
  for (const ek of ['accountCompany', 'accountContact', 'accountAddress', 'accountProject']) {
    for (const r of normalizedByEntity[ek] ?? []) {
      const parent = resolveAccountKey(r.normalized.accountKey);
      if (!parent) cascade[ek] += 1;
      else if (parent.errors && parent.errors.length > 0) cascade[ek] += 1;
      else if (r.errors.length > 0) cascade[ek] += 1;
    }
  }
  return cascade;
}
