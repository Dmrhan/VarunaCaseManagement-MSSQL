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

import { randomUUID } from 'node:crypto';
import { prisma } from '../../db/client.js';
import { CUSTOMER_360_VERSION } from './targetSchemas/customer360TargetSchemas/index.js';
import { dryRunCustomer360 } from './customer360DryRun.js';
import { generateUniqueAccountId } from '../../utils/accountId.js';

const ENTITY_ORDER = ['account', 'accountCompany', 'accountContact', 'accountAddress', 'accountProject'];
const ROLLBACK_ORDER = [...ENTITY_ORDER].reverse();

// Phase C-light — commit roundtrip reduction.
//
// (1) Per-entity prefetch: scope-wide findMany ONCE before the row loop,
//     instead of per-row findUnique/findFirst. Net ~10k → ~5 lookup roundtrips
//     for a 1000-customer + 5-entity import.
// (2) Bounded concurrency per entity (within ENTITY_ORDER barriers): writes
//     still go to Supabase pooler but in parallel batches; wall-clock drops
//     from O(N×latency) toward O(N/concurrency × latency). 8 is a safe
//     ceiling for default Supabase pooler + Prisma client (≈10 connections).
// (3) Entity dependency order preserved (account → AC → contact/address/
//     project). Parent IDs map populated after each entity's barrier so child
//     entities never read stale data.
// (4) ImportJobRow audit semantics unchanged — each row still receives its
//     own status/recordId/beforeJson/afterJson update. Update calls run in
//     the same bounded-concurrency batch as the write so total roundtrips
//     halve in wall-clock terms.

const COMMIT_CONCURRENCY = Math.max(
  1,
  Math.min(16, Number(process.env.C360_COMMIT_CONCURRENCY) || 8),
);

async function runWithConcurrency(items, worker, concurrency = COMMIT_CONCURRENCY) {
  if (!items?.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  async function pump() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await worker(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, error: err };
      }
    }
  }
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, () => pump());
  await Promise.all(lanes);
  return results;
}

const TIMING_DEBUG = process.env.C360_IMPORT_DEBUG_TIMING === 'true';

// Phase D-tick — job-level lease.
//
// Concurrent-tick guard: only one tick at a time may process a given
// ImportJob. Acquired lease lives in ImportJob.{leaseTickId, leaseAt,
// heartbeatAt}; release/stale-TTL clears them. TTL=2dk is well above
// Hobby's 60s function ceiling.
//
// Resumable status set is INTENTIONALLY narrow: ['running', 'partial']
// only. `failed` jobs are NOT auto-resumable — they require explicit
// rollback or a new commit (would need a separate
// `job_failed_resumable` flag we don't store today).

const LEASE_TTL_MS = 2 * 60 * 1000;
const RESUMABLE_STATUSES = ['running', 'partial'];

async function acquireLease(jobId) {
  const tickId = randomUUID();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LEASE_TTL_MS);
  const result = await prisma.importJob.updateMany({
    where: {
      id: jobId,
      targetType: 'customer360',
      status: { in: RESUMABLE_STATUSES },
      OR: [
        { leaseTickId: null },
        { heartbeatAt: { lt: staleBefore } },
      ],
    },
    data: { leaseTickId: tickId, leaseAt: now, heartbeatAt: now },
  });
  if (result.count === 1) return tickId;

  // Diagnose why we couldn't acquire so callers see a truthful error code.
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: { status: true, leaseTickId: true, heartbeatAt: true, targetType: true },
  });
  if (!job) throw new CommitError('Job bulunamadı.', { status: 404, code: 'job_not_found' });
  if (job.targetType !== 'customer360') {
    throw new CommitError('Job customer360 targetType değil.', { status: 400, code: 'wrong_target_type' });
  }
  if (job.status === 'completed') {
    throw new CommitError('Bu içe aktarım zaten tamamlanmış.', { status: 400, code: 'job_already_completed' });
  }
  if (job.status === 'failed') {
    throw new CommitError(
      'Bu içe aktarım başarısız sonlandı; tick mode ile devam ettirilemez. Önce geri alın, sonra yeni bir içe aktarım başlatın.',
      { status: 400, code: 'job_failed_not_resumable' },
    );
  }
  if (job.status === 'rolled_back' || job.status === 'rollback_partial') {
    throw new CommitError('Geri alınmış içe aktarım yeniden başlatılamaz.', { status: 400, code: 'job_rolled_back' });
  }
  if (job.status === 'draft' || job.status === 'validated') {
    throw new CommitError(`Bu durumdaki job tick ile commit edilemez: ${job.status}.`, { status: 400, code: 'invalid_status' });
  }
  // Status resumable + lease held by another active tick.
  throw new CommitError(
    'Bu içe aktarım şu an başka bir sekme/işlem tarafından işleniyor.',
    { status: 409, code: 'job_already_processing' },
  );
}

async function releaseLease(jobId, tickId) {
  await prisma.importJob.updateMany({
    where: { id: jobId, leaseTickId: tickId },
    data: { leaseTickId: null, heartbeatAt: null },
  });
}

async function refreshHeartbeat(jobId, tickId) {
  const r = await prisma.importJob.updateMany({
    where: { id: jobId, leaseTickId: tickId },
    data: { heartbeatAt: new Date() },
  });
  if (r.count !== 1) {
    // Lease stolen (stale TTL elapsed mid-tick) → abort to avoid
    // double-processing under a stolen lease.
    throw new CommitError(
      'Tick lease başka bir tick tarafından devralındı; aktarım yarıda kesildi.',
      { status: 409, code: 'lease_lost' },
    );
  }
}

function makeTimer() {
  const t0 = process.hrtime.bigint();
  const marks = [];
  return {
    mark(label) {
      const t = process.hrtime.bigint();
      const ms = Number(t - t0) / 1e6;
      marks.push({ label, ms: Math.round(ms) });
    },
    summary() {
      const t = process.hrtime.bigint();
      const total = Math.round(Number(t - t0) / 1e6);
      return { totalMs: total, marks };
    },
    log(prefix = '[c360 commit]') {
      if (!TIMING_DEBUG) return;
      const s = this.summary();
      // eslint-disable-next-line no-console
      console.log(`${prefix} total=${s.totalMs}ms`, s.marks.map((m) => `${m.label}=${m.ms}ms`).join(' '));
    },
  };
}

// Hoisted select constants — used by both write functions and prefetch.
const ACCOUNT_SELECT = {
  id: true, name: true, vkn: true,
  phone: true, phoneE164: true, phoneType: true, phoneExtension: true,
  phone2: true, phone2E164: true, phone2Type: true, phone2Extension: true,
  phone3: true, phone3E164: true, phone3Type: true, phone3Extension: true,
  primaryPhoneSlot: true,
  // Faz B-temel — customerRole snapshot için (rollback)
  email: true, customerType: true, customerRole: true,
  legalName: true, registrationNo: true, taxOffice: true, isActive: true,
};
const ACCOUNT_COMPANY_SELECT = {
  id: true, accountId: true, companyId: true, externalCustomerCode: true,
  packageName: true, segment: true, contractStartAt: true, contractEndAt: true, status: true,
};
const CONTACT_SELECT = {
  id: true, accountId: true, fullName: true, title: true, email: true, phone: true,
  phoneE164: true, isPrimary: true, isActive: true, sourceExternalId: true,
};
const ADDRESS_SELECT = {
  id: true, accountId: true, companyId: true, type: true, label: true, line1: true,
  line2: true, district: true, city: true, state: true, postalCode: true, country: true,
  isDefault: true, isActive: true, sourceExternalId: true,
};
const PROJECT_SELECT = {
  id: true, accountCompanyId: true, code: true, name: true, status: true,
  startDate: true, endDate: true, description: true, isActive: true, sourceExternalId: true,
  // Faz B-temel — anaFirmaAccountId snapshot için (rollback)
  anaFirmaAccountId: true,
};

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

  // **BUG FIX**: Previously this code read `dryRun.preview?.<entity>`,
  // which is intentionally capped at the first 100 rows for UI display
  // (customer360DryRun.js builds `preview` via `rows.slice(0, 100)`).
  // For any import with >100 rows in a given entity, persistJob silently
  // dropped the remainder, and commit/rollback only saw the first 100.
  // Source of truth for commit is now `dryRun.rowsForCommit` — the full
  // normalized row collection. `dryRun.preview` stays UI-only.
  const allRowsByEntity = dryRun.rowsForCommit ?? dryRun.preview ?? {};
  // (Fallback to preview kept for any legacy caller that hasn't been
  // updated yet; the new dry-run engine always emits rowsForCommit.)

  // WR-A8 Phase 2b hotfix (P2) — Build source-row indexes for
  // parentRowNumber resolution BEFORE writing child entity rows. account
  // matches by VKN or name (same keys customer360DryRun.resolveAccountKey
  // uses); accountCompany matches by (accountKey, companyCode).
  const accountByKey = new Map();
  for (const r of allRowsByEntity.account ?? []) {
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
  for (const r of allRowsByEntity.accountCompany ?? []) {
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
    const fullRows = allRowsByEntity[entity] ?? [];
    rowsByEntity[entity] = [];
    if (fullRows.length === 0) continue;
    const inserts = fullRows.map((r) => {
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
    // Phase 2 + Phase 3 — slot 1 metadata + slot 2/3 + primary
    phoneType: a.phoneType ?? null, phoneExtension: a.phoneExtension ?? null,
    phone2: a.phone2 ?? null, phone2E164: a.phone2E164 ?? null,
    phone2Type: a.phone2Type ?? null, phone2Extension: a.phone2Extension ?? null,
    phone3: a.phone3 ?? null, phone3E164: a.phone3E164 ?? null,
    phone3Type: a.phone3Type ?? null, phone3Extension: a.phone3Extension ?? null,
    primaryPhoneSlot: a.primaryPhoneSlot ?? null,
    email: a.email ?? null, customerType: a.customerType,
    // Faz B-temel — customerRole snapshot (rollback için)
    customerRole: a.customerRole ?? null,
    legalName: a.legalName ?? null, registrationNo: a.registrationNo ?? null,
    taxOffice: a.taxOffice ?? null,
    isActive: a.isActive,
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
    sourceExternalId: c.sourceExternalId ?? null,
  };
}
function snapshotAddress(a) {
  if (!a) return null;
  return {
    id: a.id, accountId: a.accountId, companyId: a.companyId, type: a.type,
    label: a.label ?? null, line1: a.line1, line2: a.line2 ?? null,
    district: a.district ?? null, city: a.city ?? null, state: a.state ?? null,
    postalCode: a.postalCode ?? null, country: a.country, isDefault: a.isDefault, isActive: a.isActive,
    sourceExternalId: a.sourceExternalId ?? null,
  };
}
function snapshotProject(p) {
  if (!p) return null;
  return {
    id: p.id, accountCompanyId: p.accountCompanyId, code: p.code, name: p.name,
    status: p.status, startDate: p.startDate ? new Date(p.startDate).toISOString() : null,
    endDate: p.endDate ? new Date(p.endDate).toISOString() : null,
    description: p.description ?? null, isActive: p.isActive,
    sourceExternalId: p.sourceExternalId ?? null,
    // Faz B-temel — Ana firma bağı snapshot (rollback için)
    anaFirmaAccountId: p.anaFirmaAccountId ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────
// Per-entity write functions (each returns recordId + before/after)
// ─────────────────────────────────────────────────────────────────

async function writeAccount(row, normalized, prefetched = undefined) {
  // VKN exact match. If VKN missing → always create new account.
  // Phase 3 — select all phone slots so snapshot/before captures them
  // and rollback can restore.
  //
  // Phase C-light: caller may pass `prefetched` (an Account row from a
  // pre-batch findMany({vkn: { in: ... }})). When supplied, we skip the
  // per-row findUnique entirely. Falls back to live find for safety if
  // prefetched is undefined and vkn is present.
  const accountSelect = ACCOUNT_SELECT;
  let existing = prefetched ?? null;
  if (existing === null && normalized.vkn && prefetched === undefined) {
    existing = await prisma.account.findUnique({
      where: { vkn: normalized.vkn },
      select: accountSelect,
    });
  }
  if (existing) {
    const beforeJson = snapshotAccount(existing);
    const patch = {};
    if (normalized.name && normalized.name !== existing.name) patch.name = normalized.name;
    if (normalized.email !== undefined && normalized.email !== null) patch.email = normalized.email;
    if (normalized.customerType !== undefined && normalized.customerType !== null) patch.customerType = normalized.customerType;
    // Faz B-temel — Codex P2 round 2 fix: customerRole import persist
    if (normalized.customerRole !== undefined && normalized.customerRole !== null) patch.customerRole = normalized.customerRole;
    if (normalized.legalName !== undefined && normalized.legalName !== null) patch.legalName = normalized.legalName;
    if (normalized.registrationNo !== undefined && normalized.registrationNo !== null) patch.registrationNo = normalized.registrationNo;
    if (normalized.taxOffice !== undefined && normalized.taxOffice !== null) patch.taxOffice = normalized.taxOffice;
    if (normalized.isActive !== undefined && normalized.isActive !== null) patch.isActive = normalized.isActive;
    if (normalized.phone !== undefined && normalized.phone !== null) {
      patch.phone = normalized._rawPhone ?? normalized.phone;
      patch.phoneE164 = normalized.phone;
    }
    // Phase 2 — slot 1 metadata
    if (normalized.phoneType !== undefined && normalized.phoneType !== null) patch.phoneType = normalized.phoneType;
    if (normalized.phoneExtension !== undefined && normalized.phoneExtension !== null) patch.phoneExtension = normalized.phoneExtension;
    // Phase 3 — slot 2
    if (normalized.phone2 !== undefined && normalized.phone2 !== null) {
      patch.phone2 = normalized._rawPhone2 ?? normalized.phone2;
      patch.phone2E164 = normalized.phone2;
    }
    if (normalized.phone2Type !== undefined && normalized.phone2Type !== null) patch.phone2Type = normalized.phone2Type;
    if (normalized.phone2Extension !== undefined && normalized.phone2Extension !== null) patch.phone2Extension = normalized.phone2Extension;
    // Phase 3 — slot 3
    if (normalized.phone3 !== undefined && normalized.phone3 !== null) {
      patch.phone3 = normalized._rawPhone3 ?? normalized.phone3;
      patch.phone3E164 = normalized.phone3;
    }
    if (normalized.phone3Type !== undefined && normalized.phone3Type !== null) patch.phone3Type = normalized.phone3Type;
    if (normalized.phone3Extension !== undefined && normalized.phone3Extension !== null) patch.phone3Extension = normalized.phone3Extension;
    if (normalized.primaryPhoneSlot !== undefined && normalized.primaryPhoneSlot !== null) {
      patch.primaryPhoneSlot = normalized.primaryPhoneSlot;
    }
    // Codex P2 (commit-time defense in depth) — effective state cross-slot
    // duplicate. Patch'te değişen slot ile existing slotlar birleştirilir;
    // duplicate olursa commit fail (atomic). Dry-run zaten yakalar; bu
    // savunma katmanı doğrudan API tüketicilerini de korur.
    {
      const eff1 = Object.prototype.hasOwnProperty.call(patch, 'phoneE164') ? patch.phoneE164 : existing.phoneE164 ?? null;
      const eff2 = Object.prototype.hasOwnProperty.call(patch, 'phone2E164') ? patch.phone2E164 : existing.phone2E164 ?? null;
      const eff3 = Object.prototype.hasOwnProperty.call(patch, 'phone3E164') ? patch.phone3E164 : existing.phone3E164 ?? null;
      const filled = [eff1, eff2, eff3].filter((v) => typeof v === 'string' && v);
      if (filled.length > 0 && new Set(filled).size !== filled.length) {
        const err = new Error('Bu telefon numarası mevcut müşteride başka bir slotta zaten kayıtlı.');
        err.code = 'duplicate_phone_across_slots';
        throw err;
      }
    }
    // Faz B-temel — Codex P2 release-review fix: Central downgrade ana-firma
    // cleanup (import yolu).
    //
    // Bulgu: writeAccount.customerRole = ... patch'i updateAccount()'taki
    // downgrade WARN/transaction guard'ını ATLATIR. Import'tan bir Central
    // account başka role çekildiğinde:
    //   - patch yazılır (customerRole değişir)
    //   - AccountProject.anaFirmaAccountId=accountId kayıtları KORUNUR
    //   - Bu kayıtlar artık "ana_firma_not_central" rolündeki account'a
    //     işaret eder (raporlar yetim/yanlış).
    //
    // Çözüm: import scenariosu interaktif ack için uygun değil (toplu
    // commit); bu yüzden Codex önerisinin 2. ayağını uygula — aynı
    // transaction'da bağlı projeleri NULL'la + account update.
    //
    // ROLLBACK CARE (Codex P2 round 2 fix): nullify edilen projelerin eski
    // anaFirmaAccountId'lerini sideEffects ile döndür. Caller bu listeyi
    // synthetic importJobRow'a yazsın (entityType='accountProject',
    // beforeJson.anaFirmaAccountId=previousValue). rollbackCustomer360
    // accountProject path'i bu alanı restore edebilsin.
    const isCentralDowngradeImport =
      existing.customerRole === 'Central'
      && patch.customerRole !== undefined
      && patch.customerRole !== 'Central';

    let updated;
    let nullifiedAnaFirmaProjects = [];
    if (Object.keys(patch).length === 0) {
      updated = existing;
    } else if (isCentralDowngradeImport) {
      // Atomic: önce etkilenen projeleri capture et + NULL'la + account update.
      // findMany transaction'ın DIŞINDA (snapshot için); aynı microtask'ta
      // updateMany'i etkilemez (T+1 anlık tutarsızlık ihmal — rollback için
      // beforeJson dolu olması yeterli).
      const affected = await prisma.accountProject.findMany({
        where: { anaFirmaAccountId: existing.id },
        select: { id: true, anaFirmaAccountId: true },
      });
      nullifiedAnaFirmaProjects = affected.map((p) => ({
        id: p.id,
        previousAnaFirmaAccountId: p.anaFirmaAccountId,
      }));

      const [, accountAfter] = await prisma.$transaction([
        prisma.accountProject.updateMany({
          where: { anaFirmaAccountId: existing.id },
          data: { anaFirmaAccountId: null },
        }),
        prisma.account.update({
          where: { id: existing.id },
          data: patch,
          select: accountSelect,
        }),
      ]);
      updated = accountAfter;
    } else {
      updated = await prisma.account.update({
        where: { id: existing.id },
        data: patch,
        select: accountSelect,
      });
    }
    return {
      kind: 'updated',
      recordId: existing.id,
      beforeJson,
      afterJson: snapshotAccount(updated),
      sideEffects: nullifiedAnaFirmaProjects.length > 0
        ? { nullifiedAnaFirmaProjects }
        : undefined,
    };
  }
  // Create — Phase 1 standardization: Account.id `cus_<22>` formatında.
  // Slot 1/2/3 alanları ve primaryPhoneSlot da burada yazılır. Caller
  // primaryPhoneSlot vermezse ilk dolu slot birincil sayılır.
  let primaryPhoneSlot = normalized.primaryPhoneSlot ?? null;
  if (primaryPhoneSlot === null) {
    if (normalized.phone) primaryPhoneSlot = 1;
    else if (normalized.phone2) primaryPhoneSlot = 2;
    else if (normalized.phone3) primaryPhoneSlot = 3;
  }
  const newId = await generateUniqueAccountId();
  const created = await prisma.account.create({
    data: {
      id: newId,
      name: normalized.name,
      vkn: normalized.vkn ?? null,
      phone: normalized._rawPhone ?? null,
      phoneE164: normalized.phone ?? null,
      phoneType: normalized.phoneType ?? null,
      phoneExtension: normalized.phoneExtension ?? null,
      phone2: normalized._rawPhone2 ?? null,
      phone2E164: normalized.phone2 ?? null,
      phone2Type: normalized.phone2Type ?? null,
      phone2Extension: normalized.phone2Extension ?? null,
      phone3: normalized._rawPhone3 ?? null,
      phone3E164: normalized.phone3 ?? null,
      phone3Type: normalized.phone3Type ?? null,
      phone3Extension: normalized.phone3Extension ?? null,
      primaryPhoneSlot,
      email: normalized.email ?? null,
      customerType: normalized.customerType ?? 'Corporate',
      // Faz B-temel — Codex P2 round 2 fix: customerRole import persist (create path)
      customerRole: normalized.customerRole ?? null,
      legalName: normalized.legalName ?? null,
      registrationNo: normalized.registrationNo ?? null,
      taxOffice: normalized.taxOffice ?? null,
      isActive: normalized.isActive ?? true,
    },
    select: accountSelect,
  });
  return { kind: 'created', recordId: created.id, beforeJson: null, afterJson: snapshotAccount(created) };
}

async function writeAccountCompany({ companyId, accountId, normalized, prefetched = undefined }) {
  // Phase C-light: per-row findUnique avoided when prefetched is provided
  // (caller did one findMany({ accountId: { in: [...] }, companyId }) and
  // built a Map<accountId, row>). Live find still runs when prefetched is
  // undefined (safety net for resume / partial paths).
  let existing = prefetched ?? null;
  if (existing === null && prefetched === undefined) {
    existing = await prisma.accountCompany.findUnique({
      where: { accountId_companyId: { accountId, companyId } },
      select: ACCOUNT_COMPANY_SELECT,
    });
  }
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
          select: ACCOUNT_COMPANY_SELECT,
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
    select: ACCOUNT_COMPANY_SELECT,
  });
  return { kind: 'created', recordId: created.id, beforeJson: null, afterJson: snapshotAccountCompany(created) };
}

async function writeContact({ accountId, normalized, prefetched = undefined }) {
  // Phase 2c — sourceContactId TRY FIRST. Persistent external/ERP id —
  // second import with same value updates the same row instead of
  // creating a duplicate. Fall back to email then phoneE164 only when
  // sourceContactId is empty or no match found.
  //
  // Phase C-light: caller may pass `prefetched` = the FULL list of existing
  // AccountContact rows for the parent accountId (one findMany ahead of
  // the batch). We resolve the three-alternative match in memory in the
  // same priority order (source → email → phoneE164). Falls back to live
  // findFirst calls when prefetched is undefined.
  const contactSelect = CONTACT_SELECT;
  let existing = null;
  if (Array.isArray(prefetched)) {
    if (normalized.sourceContactId) {
      existing = prefetched.find((c) => c.sourceExternalId === normalized.sourceContactId) ?? null;
    }
    if (!existing && normalized.email) {
      existing = prefetched.find((c) => c.email === normalized.email) ?? null;
    }
    if (!existing && normalized.phone) {
      existing = prefetched.find((c) => c.phoneE164 === normalized.phone) ?? null;
    }
  } else {
    if (normalized.sourceContactId) {
      existing = await prisma.accountContact.findFirst({
        where: { accountId, sourceExternalId: normalized.sourceContactId },
        select: contactSelect,
      });
    }
    if (!existing && normalized.email) {
      existing = await prisma.accountContact.findFirst({
        where: { accountId, email: normalized.email },
        select: contactSelect,
      });
    }
    if (!existing && normalized.phone) {
      existing = await prisma.accountContact.findFirst({
        where: { accountId, phoneE164: normalized.phone },
        select: contactSelect,
      });
    }
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
    if (normalized.sourceContactId && normalized.sourceContactId !== existing.sourceExternalId) {
      patch.sourceExternalId = normalized.sourceContactId;
    }
    const updated = Object.keys(patch).length > 0
      ? await prisma.accountContact.update({
          where: { id: existing.id },
          data: patch,
          select: contactSelect,
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
      sourceExternalId: normalized.sourceContactId ?? null,
    },
    select: contactSelect,
  });
  if (created.isPrimary === true) {
    await prisma.accountContact.updateMany({
      where: { accountId, id: { not: created.id }, isPrimary: true },
      data: { isPrimary: false },
    });
  }
  return { kind: 'created', recordId: created.id, beforeJson: null, afterJson: snapshotContact(created) };
}

async function writeAddress({ companyId, accountId, normalized, prefetched = undefined }) {
  // Phase 2c — sourceAddressId TRY FIRST. Persistent external/ERP id —
  // tenant-scoped (companyId enforced). Fall back to soft (accountId,
  // companyId, type, label||line1) only when sourceAddressId empty or no
  // match. WR-A8 Phase 2b hotfix (P1) tenant guard preserved on both paths.
  //
  // Phase C-light: `prefetched` = list of existing Address rows already
  // scoped to (accountId, companyId). In-memory match runs the same
  // priority order. Live findFirst calls only when prefetched is undefined.
  const addressSelect = ADDRESS_SELECT;
  let existing = null;
  if (Array.isArray(prefetched)) {
    if (normalized.sourceAddressId) {
      existing = prefetched.find((a) => a.sourceExternalId === normalized.sourceAddressId) ?? null;
    }
    if (!existing) {
      existing = prefetched.find((a) => {
        if (a.type !== normalized.type) return false;
        if (normalized.label) return a.label === normalized.label;
        return a.line1 === normalized.line1;
      }) ?? null;
    }
  } else {
    if (normalized.sourceAddressId) {
      existing = await prisma.address.findFirst({
        where: { accountId, companyId, sourceExternalId: normalized.sourceAddressId },
        select: addressSelect,
      });
    }
    if (!existing) {
      const where = {
        accountId,
        companyId,
        type: normalized.type,
        ...(normalized.label
          ? { label: normalized.label }
          : { line1: normalized.line1 }),
      };
      existing = await prisma.address.findFirst({ where, select: addressSelect });
    }
  }
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
    if (normalized.sourceAddressId && normalized.sourceAddressId !== existing.sourceExternalId) {
      patch.sourceExternalId = normalized.sourceAddressId;
    }
    const updated = Object.keys(patch).length > 0
      ? await prisma.address.update({
          where: { id: existing.id },
          data: patch,
          select: addressSelect,
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
      sourceExternalId: normalized.sourceAddressId ?? null,
    },
    select: addressSelect,
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

async function writeProject({ accountCompanyId, normalized, prefetched = undefined }) {
  // Phase 2c — sourceProjectId TRY FIRST. Fall back to (accountCompanyId,
  // code) unique match only when sourceProjectId empty or no match.
  //
  // Phase C-light: `prefetched` = list of existing AccountProject rows for
  // this accountCompanyId; in-memory match runs the same priority order.
  const projectSelect = PROJECT_SELECT;
  const code = normalized.projectCode;

  // Faz B-temel — Codex P2 round 2 fix: anaFirmaKey → anaFirmaAccountId resolve.
  //
  // Mevcut accountKey paterni mirror:
  //   1. anaFirmaKey set → Account.vkn match + customerRole='Central'
  //   2. Cross-tenant guard: AccountCompany aynı tenant'a bağlı olmalı
  //   3. Bulunamazsa SESSİZ null (warning UI tarafına; mevcut isim-eşleme
  //      enrichment Faz B ayrı iş)
  let resolvedAnaFirmaAccountId = null;
  if (normalized.anaFirmaKey) {
    // Target tenant'ı bul (AccountCompany.companyId)
    const ac = await prisma.accountCompany.findUnique({
      where: { id: accountCompanyId },
      select: { companyId: true },
    });
    if (ac?.companyId) {
      const anaFirma = await prisma.account.findFirst({
        where: {
          vkn: normalized.anaFirmaKey,
          customerRole: 'Central',
          companies: { some: { companyId: ac.companyId } },
        },
        select: { id: true },
      });
      if (anaFirma) {
        resolvedAnaFirmaAccountId = anaFirma.id;
      }
      // bulunamazsa null bırak — mevcut accountKey paterni (warningIfMissing
      // dry-run'da sinyal verir; commit-time sessiz null + log)
    }
  }
  let existing = null;
  if (Array.isArray(prefetched)) {
    if (normalized.sourceProjectId) {
      existing = prefetched.find((p) => p.sourceExternalId === normalized.sourceProjectId) ?? null;
    }
    if (!existing) {
      existing = prefetched.find((p) => p.code === code) ?? null;
    }
  } else {
    if (normalized.sourceProjectId) {
      existing = await prisma.accountProject.findFirst({
        where: { accountCompanyId, sourceExternalId: normalized.sourceProjectId },
        select: projectSelect,
      });
    }
    if (!existing) {
      existing = await prisma.accountProject.findUnique({
        where: { accountCompanyId_code: { accountCompanyId, code } },
        select: projectSelect,
      });
    }
  }
  if (existing) {
    const beforeJson = snapshotProject(existing);
    const patch = {};
    if (normalized.projectName && normalized.projectName !== existing.name) patch.name = normalized.projectName;
    if (normalized.status) patch.status = normalized.status;
    if (normalized.startDate) patch.startDate = new Date(normalized.startDate);
    if (normalized.endDate) patch.endDate = new Date(normalized.endDate);
    if (normalized.description !== undefined && normalized.description !== null) patch.description = normalized.description;
    if (normalized.isActive !== undefined && normalized.isActive !== null) patch.isActive = normalized.isActive;
    if (normalized.sourceProjectId && normalized.sourceProjectId !== existing.sourceExternalId) {
      patch.sourceExternalId = normalized.sourceProjectId;
    }
    // Faz B-temel — Codex P2 round 2 fix: anaFirmaAccountId persist (update).
    // anaFirmaKey verildiyse VE resolve başarılıysa update; resolve null ise
    // mevcut bağ KORUNUR (sessiz; isim-eşleme enrichment ayrı PR).
    if (normalized.anaFirmaKey && resolvedAnaFirmaAccountId) {
      patch.anaFirmaAccountId = resolvedAnaFirmaAccountId;
    }
    const updated = Object.keys(patch).length > 0
      ? await prisma.accountProject.update({
          where: { id: existing.id },
          data: patch,
          select: projectSelect,
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
      sourceExternalId: normalized.sourceProjectId ?? null,
      // Faz B-temel — Codex P2 round 2 fix: anaFirmaAccountId persist (create)
      anaFirmaAccountId: resolvedAnaFirmaAccountId,
    },
    select: projectSelect,
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
  // Fresh job is created with status='running' inside persistJob → safe
  // to acquire the lease immediately.
  const tickId = await acquireLease(persisted.job.id);
  try {
    return await processJob({
      user,
      companyId,
      job: persisted.job,
      rowsByEntity: persisted.rowsByEntity,
      maxRowsPerCall: options.maxRowsPerCall ?? null,
      tickId,
    });
  } finally {
    await releaseLease(persisted.job.id, tickId);
  }
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
  // Phase D-tick — resume status set narrowed. `failed` is no longer
  // auto-resumable here; acquireLease() below also rejects with a
  // truthful code (job_failed_not_resumable). `completed` / `rolled_back`
  // similarly rejected by acquireLease.
  if (!RESUMABLE_STATUSES.includes(job.status)) {
    if (job.status === 'failed') {
      throw new CommitError(
        'Bu içe aktarım başarısız sonlandı; tick mode ile devam ettirilemez. Önce geri alın, sonra yeni bir içe aktarım başlatın.',
        { status: 400, code: 'job_failed_not_resumable' },
      );
    }
    if (job.status === 'completed') {
      throw new CommitError('Bu içe aktarım zaten tamamlanmış.', { status: 400, code: 'job_already_completed' });
    }
    if (job.status === 'rolled_back' || job.status === 'rollback_partial') {
      throw new CommitError('Geri alınmış içe aktarım yeniden başlatılamaz.', { status: 400, code: 'job_rolled_back' });
    }
    throw new CommitError(`Bu durumdaki job tekrar commit edilemez: ${job.status}`, { status: 400, code: 'invalid_status' });
  }
  // Atomic claim — concurrent tick / stale-TTL handled inside helper.
  const tickId = await acquireLease(jobId);
  try {
    const rowsByEntity = {};
    for (const entity of ENTITY_ORDER) {
      rowsByEntity[entity] = await prisma.importJobRow.findMany({
        where: { importJobId: jobId, entityType: entity },
        orderBy: { rowNumber: 'asc' },
      });
    }
    await prisma.importJob.update({ where: { id: jobId }, data: { status: 'running' } });
    return await processJob({
      user,
      companyId,
      job: { id: jobId },
      rowsByEntity,
      resume: true,
      maxRowsPerCall: options.maxRowsPerCall ?? null,
      tickId,
    });
  } finally {
    await releaseLease(jobId, tickId);
  }
}

async function processJob({ user, companyId, job, rowsByEntity, resume = false, maxRowsPerCall = null, tickId = null }) {
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
  const timer = makeTimer();

  // Phase D-tick — Hobby plan 60s function ceiling'i için: tick-mode.
  // maxRowsPerCall verilirse o tick içinde EN FAZLA bu kadar "writeable"
  // satır işlenir; geri kalan 'pending' olarak DB'de durmaya devam eder
  // ve job status='running' kalır. Frontend bir sonraki tick'i jobId ile
  // çağırır. maxRowsPerCall=null → mevcut tek seferde tüm satırları işle
  // davranışı (Pro plan / küçük dosyalar).
  const tickEnabled = typeof maxRowsPerCall === 'number' && maxRowsPerCall > 0;
  let processedThisTick = 0;
  let tickStoppedEarly = false;
  const tickStoppedEntities = new Set();

  for (const entity of ENTITY_ORDER) {
    if (tickStoppedEarly) {
      // Tick budget exhausted before reaching this entity — leave its
      // rows as pending; the next call (resume path) will load them.
      tickStoppedEntities.add(entity);
      continue;
    }
    const rows = rowsByEntity[entity] ?? [];
    const eStats = { created: 0, updated: 0, skipped: 0, error: 0, total: rows.length };

    // Pass 1 — drain terminal-state / skipped rows synchronously (no DB
    // hit; just stats and parent-map propagation). Collect writeable rows
    // for the prefetch + concurrent pass.
    const writeable = [];
    for (const row of rows) {
      if (row.status === 'created' || row.status === 'updated' || row.status === 'rolled_back') {
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
      writeable.push(row);
    }

    // Tick budget — cap writeable to remaining quota. Deferred rows stay
    // 'pending' in DB; next tick (resume) loads them.
    let deferredCount = 0;
    if (tickEnabled) {
      const remaining = maxRowsPerCall - processedThisTick;
      if (remaining <= 0) {
        // Budget already exhausted — defer entire entity.
        tickStoppedEarly = true;
        tickStoppedEntities.add(entity);
        entityCounts[entity] = eStats;
        totals.created += eStats.created;
        totals.updated += eStats.updated;
        totals.skipped += eStats.skipped;
        totals.error += eStats.error;
        continue;
      }
      if (writeable.length > remaining) {
        deferredCount = writeable.length - remaining;
        writeable.length = remaining;
      }
    }

    // Pass 2 — Phase C-light prefetch. Single findMany per entity slashes
    // per-row findUnique/findFirst calls (~10k → 5 lookup roundtrips for a
    // 1000-customer × 5-entity import). Prefetch maps fed into write
    // functions via the new `prefetched` argument.
    let prefetchByVkn = null;
    let prefetchAcByAccountId = null;
    let contactPrefetchByAccountId = null;
    let addressPrefetchByAccountId = null;
    let projectPrefetchByAcId = null;
    let acFallbackByAccountId = null;
    let resolvedParentIds = null;

    if (entity === 'account') {
      const vkns = [];
      for (const row of writeable) {
        if (row.action === 'skip') continue;
        const v = row.normalizedJson?.vkn;
        if (v) vkns.push(v);
      }
      if (vkns.length > 0) {
        const found = await prisma.account.findMany({
          where: { vkn: { in: [...new Set(vkns)] } },
          select: ACCOUNT_SELECT,
        });
        prefetchByVkn = new Map(found.map((a) => [a.vkn, a]));
      }
      timer.mark('prefetch:account');
    } else if (entity === 'accountCompany' || entity === 'accountContact' || entity === 'accountAddress' || entity === 'accountProject') {
      // Resolve parent account IDs for this batch (in memory; uses the
      // already-populated accountIdByKey).
      resolvedParentIds = new Map(); // row.id → parentAccountId|null
      const ids = new Set();
      for (const row of writeable) {
        if (row.action === 'skip') { resolvedParentIds.set(row.id, null); continue; }
        const pid = resolveAccountId(row.normalizedJson?.accountKey);
        resolvedParentIds.set(row.id, pid);
        if (pid) ids.add(pid);
      }
      if (entity === 'accountCompany' && ids.size > 0) {
        const found = await prisma.accountCompany.findMany({
          where: { accountId: { in: [...ids] }, companyId },
          select: ACCOUNT_COMPANY_SELECT,
        });
        prefetchAcByAccountId = new Map(found.map((ac) => [ac.accountId, ac]));
      } else if (entity === 'accountContact' && ids.size > 0) {
        const found = await prisma.accountContact.findMany({
          where: { accountId: { in: [...ids] } },
          select: CONTACT_SELECT,
        });
        contactPrefetchByAccountId = new Map();
        for (const c of found) {
          const arr = contactPrefetchByAccountId.get(c.accountId);
          if (arr) arr.push(c); else contactPrefetchByAccountId.set(c.accountId, [c]);
        }
      } else if (entity === 'accountAddress' && ids.size > 0) {
        const found = await prisma.address.findMany({
          where: { accountId: { in: [...ids] }, companyId },
          select: ADDRESS_SELECT,
        });
        addressPrefetchByAccountId = new Map();
        for (const a of found) {
          const arr = addressPrefetchByAccountId.get(a.accountId);
          if (arr) arr.push(a); else addressPrefetchByAccountId.set(a.accountId, [a]);
        }
      } else if (entity === 'accountProject' && ids.size > 0) {
        // For projects we need AC IDs first. Read from already-populated
        // accountCompanyIdByKey and prefetch AC fallback for any (accountId,
        // companyId) pairs missing from the in-batch map.
        const acIds = new Set();
        const missingAcParents = new Set();
        for (const row of writeable) {
          if (row.action === 'skip') continue;
          const n = row.normalizedJson;
          if (!n?.accountKey || !n?.accountCompanyKey) continue;
          const key = `${n.accountKey}|${n.accountCompanyKey}`;
          const acId = accountCompanyIdByKey.get(key);
          if (acId) acIds.add(acId);
          else {
            const pid = resolvedParentIds.get(row.id);
            if (pid) missingAcParents.add(pid);
          }
        }
        if (missingAcParents.size > 0) {
          const fallback = await prisma.accountCompany.findMany({
            where: { accountId: { in: [...missingAcParents] }, companyId },
            select: { id: true, accountId: true },
          });
          acFallbackByAccountId = new Map(fallback.map((ac) => [ac.accountId, ac.id]));
          for (const ac of fallback) acIds.add(ac.id);
        }
        if (acIds.size > 0) {
          const found = await prisma.accountProject.findMany({
            where: { accountCompanyId: { in: [...acIds] } },
            select: PROJECT_SELECT,
          });
          projectPrefetchByAcId = new Map();
          for (const p of found) {
            const arr = projectPrefetchByAcId.get(p.accountCompanyId);
            if (arr) arr.push(p); else projectPrefetchByAcId.set(p.accountCompanyId, [p]);
          }
        }
      }
      timer.mark(`prefetch:${entity}`);
    }

    // Pass 3 — bounded concurrent writes. Within an entity, rows are
    // independent (parent maps already populated). Across entities the
    // outer for-of preserves account → AC → siblings ordering.
    await runWithConcurrency(writeable, async (row) => {
      if (row.action === 'skip') {
        await prisma.importJobRow.update({ where: { id: row.id }, data: { status: 'skipped', updatedAt: new Date() } });
        // In-memory status da güncellenir; tick sonundaki pendingTotal sayımı
        // bu objeler üzerinden yapılıyor (güncellenmezse hasMore bir tick geç
        // false olur ve fazladan no-op tick oluşur).
        row.status = 'skipped';
        eStats.skipped += 1;
        return;
      }
      const normalized = row.normalizedJson ?? {};
      try {
        if (entity === 'account') {
          const prefetched = prefetchByVkn && normalized.vkn ? (prefetchByVkn.get(normalized.vkn) ?? null) : (prefetchByVkn ? null : undefined);
          const r = await writeAccount(row, normalized, prefetched);
          await prisma.importJobRow.update({
            where: { id: row.id },
            data: { status: r.kind, accountId: r.recordId, recordId: r.recordId, beforeJson: r.beforeJson, afterJson: r.afterJson, updatedAt: new Date() },
          });
          // Faz B-temel — Codex P2 round 2 fix: Central downgrade side effect
          // bilgi kaydı. nullifiedAnaFirmaProjects varsa her biri için
          // synthetic importJobRow yarat (entityType='accountProject',
          // beforeJson.anaFirmaAccountId=prev). rollbackCustomer360 bu
          // satırları görür ve restore eder.
          //
          // rowNumber: account row'un rowNumber'ını paylaş (UNIQUE değil;
          // sadece index). parentRowNumber ile audit/UI bağlantı kur.
          // status='updated' — rollback Updated path'inden geçer.
          if (r.sideEffects?.nullifiedAnaFirmaProjects?.length) {
            for (const p of r.sideEffects.nullifiedAnaFirmaProjects) {
              await prisma.importJobRow.create({
                data: {
                  importJobId: row.importJobId,
                  rowNumber: row.rowNumber,
                  action: 'update',
                  status: 'updated',
                  entityType: 'accountProject',
                  parentRowNumber: row.rowNumber,
                  recordId: p.id,
                  beforeJson: { anaFirmaAccountId: p.previousAnaFirmaAccountId },
                  afterJson: { anaFirmaAccountId: null },
                  matchKey: `sideEffect:centralDowngrade:${r.recordId}`,
                },
              });
            }
          }
          row.status = r.kind;
          rememberAccount(normalized, r.recordId);
          if (r.kind === 'created') eStats.created += 1; else eStats.updated += 1;
          return;
        }

        const parentAccountId = resolvedParentIds.get(row.id);
        if (!parentAccountId) {
          await prisma.importJobRow.update({
            where: { id: row.id },
            data: {
              status: 'error',
              errorsJson: appendRowErrors(row.errorsJson, [{
                entity, targetKey: 'accountKey', label: 'Müşteri Anahtarı',
                code: 'parent_account_unresolved',
                message: `Parent Account ${entity} satırı için resolve edilemedi (accountKey="${normalized.accountKey}"). Parent satır skipErrors veya hatalı olabilir.`,
              }]),
              updatedAt: new Date(),
            },
          });
          row.status = 'error';
          eStats.error += 1;
          return;
        }

        if (entity === 'accountCompany') {
          const prefetched = prefetchAcByAccountId ? (prefetchAcByAccountId.get(parentAccountId) ?? null) : undefined;
          const r = await writeAccountCompany({ companyId, accountId: parentAccountId, normalized, prefetched });
          await prisma.importJobRow.update({
            where: { id: row.id },
            data: { status: r.kind, recordId: r.recordId, beforeJson: r.beforeJson, afterJson: r.afterJson, updatedAt: new Date() },
          });
          row.status = r.kind;
          if (normalized.accountKey && normalized.companyCode) {
            accountCompanyIdByKey.set(`${normalized.accountKey}|${normalized.companyCode}`, r.recordId);
          }
          if (r.kind === 'created') eStats.created += 1; else eStats.updated += 1;
          return;
        }

        if (entity === 'accountContact') {
          const prefetched = contactPrefetchByAccountId ? (contactPrefetchByAccountId.get(parentAccountId) ?? []) : undefined;
          const r = await writeContact({ accountId: parentAccountId, normalized, prefetched });
          await prisma.importJobRow.update({
            where: { id: row.id },
            data: { status: r.kind, recordId: r.recordId, beforeJson: r.beforeJson, afterJson: r.afterJson, updatedAt: new Date() },
          });
          row.status = r.kind;
          if (r.kind === 'created') eStats.created += 1; else eStats.updated += 1;
          return;
        }

        if (entity === 'accountAddress') {
          const prefetched = addressPrefetchByAccountId ? (addressPrefetchByAccountId.get(parentAccountId) ?? []) : undefined;
          const r = await writeAddress({ companyId, accountId: parentAccountId, normalized, prefetched });
          await prisma.importJobRow.update({
            where: { id: row.id },
            data: { status: r.kind, recordId: r.recordId, beforeJson: r.beforeJson, afterJson: r.afterJson, updatedAt: new Date() },
          });
          row.status = r.kind;
          if (r.kind === 'created') eStats.created += 1; else eStats.updated += 1;
          return;
        }

        if (entity === 'accountProject') {
          const acKey = `${normalized.accountKey}|${normalized.accountCompanyKey}`;
          let accountCompanyId = accountCompanyIdByKey.get(acKey);
          if (!accountCompanyId && acFallbackByAccountId) {
            const fid = acFallbackByAccountId.get(parentAccountId);
            if (fid) { accountCompanyId = fid; accountCompanyIdByKey.set(acKey, fid); }
          }
          if (!accountCompanyId) {
            // Last-resort live lookup (preserves prior behavior for paths
            // not covered by the batched prefetch — e.g. resume).
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
              row.status = 'error';
              eStats.error += 1;
              return;
            }
            accountCompanyId = existingAc.id;
            accountCompanyIdByKey.set(acKey, existingAc.id);
          }
          const prefetched = projectPrefetchByAcId ? (projectPrefetchByAcId.get(accountCompanyId) ?? []) : undefined;
          const r = await writeProject({ accountCompanyId, normalized, prefetched });
          await prisma.importJobRow.update({
            where: { id: row.id },
            data: { status: r.kind, recordId: r.recordId, beforeJson: r.beforeJson, afterJson: r.afterJson, updatedAt: new Date() },
          });
          row.status = r.kind;
          if (r.kind === 'created') eStats.created += 1; else eStats.updated += 1;
          return;
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
        row.status = 'error';
        eStats.error += 1;
      }
    });
    timer.mark(`commit:${entity}`);

    entityCounts[entity] = eStats;
    totals.created += eStats.created;
    totals.updated += eStats.updated;
    totals.skipped += eStats.skipped;
    totals.error += eStats.error;

    if (tickEnabled) {
      processedThisTick += writeable.length;
      if (deferredCount > 0) {
        tickStoppedEarly = true;
        tickStoppedEntities.add(entity);
      }
    }
    // Refresh lease heartbeat between entities. Lease lost → 409 thrown,
    // outer try/finally still releases gracefully (releaseLease no-ops
    // when leaseTickId mismatches).
    if (tickId) await refreshHeartbeat(job.id, tickId);
  }
  timer.log('[c360 commit]');

  // Tick mode — if budget cut us off OR any pending rows remain across
  // entities, DON'T finalize. Job stays 'running'; counters persisted so
  // the next tick (and the UI) see incremental progress.
  let pendingTotal = 0;
  if (tickEnabled) {
    for (const entity of ENTITY_ORDER) {
      const rows = rowsByEntity[entity] ?? [];
      for (const row of rows) {
        if (row.status === 'pending' || row.status === 'processing') pendingTotal += 1;
      }
    }
    // Anything we deferred this tick is still 'pending' in DB.
    if (tickStoppedEarly || pendingTotal > 0) {
      const partialJob = await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: 'running',
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
      return {
        job: partialJob,
        runStats: totals,
        entityCounts,
        progress: {
          tickMode: true,
          processedThisTick,
          hasMore: true,
          pendingRowsRemaining: pendingTotal,
          stoppedAtEntities: [...tickStoppedEntities],
        },
      };
    }
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

  return {
    job: finalJob,
    runStats: totals,
    entityCounts,
    progress: tickEnabled
      ? { tickMode: true, processedThisTick, hasMore: false, pendingRowsRemaining: 0, stoppedAtEntities: [] }
      : undefined,
  };
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
            for (const k of [
              'name', 'phone', 'phoneE164', 'email', 'customerType', 'legalName', 'registrationNo', 'taxOffice', 'isActive',
              // Phase 2 + Phase 3 — slot 1 metadata + slot 2/3 + primary
              'phoneType', 'phoneExtension',
              'phone2', 'phone2E164', 'phone2Type', 'phone2Extension',
              'phone3', 'phone3E164', 'phone3Type', 'phone3Extension',
              'primaryPhoneSlot',
            ]) {
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
            // Faz B-temel — Codex P2 round 2 fix: Central downgrade side
            // effect rollback. writeAccount transaction'ında NULL'lanan
            // projeler synthetic importJobRow yazar (matchKey starts with
            // "sideEffect:centralDowngrade:"); beforeJson.anaFirmaAccountId
            // dolu olur. Burada restore et — proje yeniden eski ana firmaya
            // bağlanır.
            if (before.anaFirmaAccountId !== undefined) {
              restore.anaFirmaAccountId = before.anaFirmaAccountId;
            }
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
