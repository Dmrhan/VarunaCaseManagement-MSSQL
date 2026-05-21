/**
 * WR-A8 — Data Integration Studio: Account import audit + execution.
 *
 * Tüm import operasyonu (parse/sample dışında) bu modülden geçer. Tenant
 * izolasyonu, Account create/update, AccountCompany upsert ve rollback için
 * gereken before/after snapshot'ları burada üretilir.
 *
 * Önemli:
 *  - Bir batch içinde N. satırı işlemek diğer satırı durdurmaz; her satır
 *    kendi try/catch'inde çalışır. Bir satır error olsa bile job devam eder.
 *  - Hard delete YOK. Rollback: oluşturulanlar isActive=false; güncellenenler
 *    beforeJson'dan eski değerlere döner.
 *  - companyId import komutuna gelen `companyId`'dir; satırdaki herhangi bir
 *    "companyId" alanı KESİNLİKLE kullanılmaz (cross-tenant koruma).
 */

import { prisma } from './client.js';
import {
  ACCOUNT_TARGET_VERSION,
  describeAccountTargetSchema,
  autoMapAccountColumns,
  validateMapping,
  normalizeRow,
} from '../lib/import/targetSchemas/accountTargetSchema.js';
import { maskVkn } from './accountRepository.js';

const MAX_ROWS = 5000;

/** Display-friendly snapshot — VKN maskelenir, TCKN dokunulmaz. */
function snapshotAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    name: account.name,
    vkn: account.vkn,
    vknMasked: maskVkn(account.vkn),
    phone: account.phone ?? null,
    phoneE164: account.phoneE164 ?? null,
    email: account.email ?? null,
    customerType: account.customerType,
    legalName: account.legalName ?? null,
    registrationNo: account.registrationNo ?? null,
    isActive: account.isActive,
  };
}

/**
 * Mapping doğrula + her satır için action/errors/warnings hesapla.
 * DB mutation YOK.
 */
export async function dryRunAccountImport({ companyId, mapping, rows }) {
  if (!Array.isArray(rows)) {
    const err = new Error('rows array zorunlu.');
    err.status = 400;
    throw err;
  }
  if (rows.length > MAX_ROWS) {
    const err = new Error(`Satır sayısı ${MAX_ROWS} sınırını aştı.`);
    err.status = 400;
    err.code = 'too_many_rows';
    throw err;
  }

  const mappingCheck = validateMapping(mapping);
  if (!mappingCheck.ok) {
    return {
      ok: false,
      reason: 'mapping_invalid',
      mapping: mappingCheck,
      targetSchemaVersion: ACCOUNT_TARGET_VERSION,
    };
  }

  // VKN listesi — DB'de aynı VKN var mı kontrolü için.
  const vkns = [];
  const normalizedRows = rows.map((rawRow, idx) => {
    const { normalized, errors, warnings, hasVkn } = normalizeRow(rawRow, mapping);
    if (hasVkn && normalized.vkn) vkns.push(normalized.vkn);
    return { rowNumber: idx + 1, rawRow, normalized, errors, warnings, hasVkn };
  });

  // Dosya/source içi VKN duplikasyon kontrolü
  const vknSeen = new Map();
  for (const r of normalizedRows) {
    const v = r.normalized.vkn;
    if (!v) continue;
    vknSeen.set(v, (vknSeen.get(v) ?? 0) + 1);
  }
  for (const r of normalizedRows) {
    const v = r.normalized.vkn;
    if (v && vknSeen.get(v) > 1) {
      r.errors.push({
        targetKey: 'vkn',
        label: 'VKN',
        message: 'Bu VKN dosyada birden fazla satırda geçiyor.',
      });
    }
  }

  // DB lookup: VKN ile mevcut account?
  const existing = vkns.length
    ? await prisma.account.findMany({
        where: { vkn: { in: [...new Set(vkns)] } },
        select: {
          id: true,
          name: true,
          vkn: true,
          phone: true,
          phoneE164: true,
          email: true,
          customerType: true,
          legalName: true,
          registrationNo: true,
          isActive: true,
        },
      })
    : [];
  const existingByVkn = new Map(existing.map((a) => [a.vkn, a]));

  // AccountCompany lookup — sadece selected companyId scope'unda
  const existingAccountIds = existing.map((a) => a.id);
  const existingAcs = existingAccountIds.length
    ? await prisma.accountCompany.findMany({
        where: { companyId, accountId: { in: existingAccountIds } },
        select: { id: true, accountId: true, externalCustomerCode: true, packageName: true },
      })
    : [];
  const acByAccountId = new Map(existingAcs.map((ac) => [ac.accountId, ac]));

  let createCount = 0;
  let updateCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let warningCount = 0;

  const resultRows = normalizedRows.map((r) => {
    let action = 'skip';
    let matchedAccountName = null;
    let matchedAccountVknMasked = null;
    let fieldDiff = null;

    if (r.errors.length > 0) {
      action = 'error';
      errorCount += 1;
    } else if (r.normalized.vkn && existingByVkn.has(r.normalized.vkn)) {
      action = 'update';
      const existingAcc = existingByVkn.get(r.normalized.vkn);
      matchedAccountName = existingAcc.name;
      matchedAccountVknMasked = maskVkn(existingAcc.vkn);
      // Field diff hesapla
      fieldDiff = computeFieldDiff(existingAcc, acByAccountId.get(existingAcc.id), r.normalized);
      // Eğer hiç değişen alan yoksa skip yap
      const hasAccountChange = Object.keys(fieldDiff.account).length > 0;
      const hasAcChange = Object.keys(fieldDiff.accountCompany).length > 0;
      if (!hasAccountChange && !hasAcChange) {
        action = 'skip';
        skippedCount += 1;
      } else {
        updateCount += 1;
      }
    } else {
      action = 'create';
      createCount += 1;
    }

    if (r.warnings.length > 0) warningCount += 1;

    return {
      rowNumber: r.rowNumber,
      action,
      status: action === 'error' ? 'error' : 'pending',
      errors: r.errors,
      warnings: r.warnings,
      raw: r.rawRow,
      normalized: r.normalized,
      matchedAccountName,
      matchedAccountVknMasked,
      fieldDiff,
    };
  });

  const totalRows = resultRows.length;
  const qualityScore = totalRows === 0
    ? 0
    : Math.round(((totalRows - errorCount) / totalRows) * 100);

  return {
    ok: true,
    targetSchemaVersion: ACCOUNT_TARGET_VERSION,
    mapping: mappingCheck,
    summary: {
      totalRows,
      createCount,
      updateCount,
      skippedCount,
      errorCount,
      warningCount,
      qualityScore,
    },
    rows: resultRows,
  };
}

/**
 * Mevcut Account/AccountCompany vs yeni normalize sonucu farkı.
 * Sadece değer farklılığı olan alanları döner.
 */
function computeFieldDiff(existingAccount, existingAc, normalized) {
  const accountKeys = ['name', 'vkn', 'phone', 'email', 'customerType', 'legalName', 'registrationNo', 'isActive'];
  const out = { account: {}, accountCompany: {} };
  for (const k of accountKeys) {
    if (normalized[k] === undefined) continue;
    if (normalized[k] === null) continue; // null → "değiştirme" anlamında; boş alan update etmez
    const oldVal = existingAccount[k] ?? null;
    const newVal = normalized[k];
    if (oldVal !== newVal) {
      out.account[k] = { from: oldVal, to: newVal };
    }
  }
  // Phone değişikliği → phoneE164 da değişir; phoneE164'yı da yazacağız ama diff'i sadeleştirmek için
  // phone alanından implies edilmiş sayılır.
  // externalCustomerCode (AccountCompany)
  if (normalized.externalCustomerCode !== undefined && normalized.externalCustomerCode !== null) {
    const oldCode = existingAc?.externalCustomerCode ?? null;
    if (oldCode !== normalized.externalCustomerCode) {
      out.accountCompany.externalCustomerCode = { from: oldCode, to: normalized.externalCustomerCode };
    }
  }
  return out;
}

/**
 * ImportJob yarat — dry-run sonuçlarını ImportJobRow olarak persist eder.
 * Status: validated. Commit ayrı endpoint'ten tetiklenir.
 */
export async function persistDryRun({ user, companyId, sourceMeta, dryRunResult }) {
  const job = await prisma.importJob.create({
    data: {
      companyId,
      targetType: 'account',
      sourceType: sourceMeta.sourceType,
      sourceName: sourceMeta.sourceName ?? null,
      sourceUrlMasked: sourceMeta.sourceUrlMasked ?? null,
      fileName: sourceMeta.fileName ?? null,
      dataPath: sourceMeta.dataPath ?? null,
      targetSchemaVersion: dryRunResult.targetSchemaVersion,
      status: 'validated',
      totalRows: dryRunResult.summary.totalRows,
      createCount: dryRunResult.summary.createCount,
      updateCount: dryRunResult.summary.updateCount,
      skippedCount: dryRunResult.summary.skippedCount,
      errorCount: dryRunResult.summary.errorCount,
      warningCount: dryRunResult.summary.warningCount,
      summaryJson: {
        mapping: sourceMeta.mapping ?? null,
        qualityScore: dryRunResult.summary.qualityScore,
      },
      createdByUserId: user?.id ?? null,
    },
    select: { id: true, status: true, createdAt: true },
  });

  // Row'ları toplu insert
  const rowData = dryRunResult.rows.map((r) => ({
    importJobId: job.id,
    rowNumber: r.rowNumber,
    action: r.action,
    status: r.action === 'error' ? 'error' : 'pending',
    matchKey: r.normalized?.vkn ?? null,
    errorsJson: r.errors,
    warningsJson: r.warnings,
    rawJson: r.raw,
    normalizedJson: r.normalized,
  }));
  // Prisma createMany ile toplu insert (Postgres'te limit 65535 param; bizde 5000 satır × ~10 col = OK)
  if (rowData.length > 0) {
    await prisma.importJobRow.createMany({ data: rowData });
  }
  return job;
}

/**
 * Commit: action'a göre Account create / update + AccountCompany upsert.
 * Tek atomik tx KULLANMIYORUZ — kısmi başarı kabul edilir; her satır kendi tx'inde.
 *
 * options.skipErrors: hatalı satırları atla; sadece valid olanları işle.
 */
export async function commitImportJob({ jobId, user, options = {} }) {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      companyId: true,
      targetType: true,
      targetSchemaVersion: true,
      status: true,
    },
  });
  if (!job) {
    const err = new Error('Import job bulunamadı.');
    err.status = 404;
    throw err;
  }

  // Şema versiyonu güncel mi?
  if (job.targetSchemaVersion !== ACCOUNT_TARGET_VERSION) {
    const err = new Error('Hedef alan şeması değişti. Lütfen eşleştirmeyi yeniden doğrulayın.');
    err.status = 409;
    err.code = 'import_schema_changed';
    throw err;
  }

  // İdempotency: commit etmeye uygun statüler
  if (!['validated', 'running', 'partial'].includes(job.status)) {
    const err = new Error(`Bu durumdaki job commit edilemez: ${job.status}`);
    err.status = 400;
    err.code = 'invalid_status';
    throw err;
  }

  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: 'running', startedAt: new Date() },
  });

  // Pending row'ları çek
  const where = { importJobId: jobId, status: 'pending' };
  const pendingRows = await prisma.importJobRow.findMany({
    where,
    orderBy: { rowNumber: 'asc' },
  });

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const row of pendingRows) {
    try {
      if (row.action === 'skip') {
        await prisma.importJobRow.update({
          where: { id: row.id },
          data: { status: 'skipped', updatedAt: new Date() },
        });
        skippedCount += 1;
        continue;
      }
      if (row.action === 'error') {
        // Pending olamaz ama defansif
        continue;
      }
      if (row.action === 'create') {
        const result = await createFromRow({ companyId: job.companyId, normalized: row.normalizedJson });
        await prisma.importJobRow.update({
          where: { id: row.id },
          data: {
            status: 'created',
            accountId: result.accountId,
            afterJson: result.afterJson,
            updatedAt: new Date(),
          },
        });
        createdCount += 1;
      } else if (row.action === 'update') {
        const result = await updateFromRow({ companyId: job.companyId, normalized: row.normalizedJson });
        await prisma.importJobRow.update({
          where: { id: row.id },
          data: {
            status: 'updated',
            accountId: result.accountId,
            beforeJson: result.beforeJson,
            afterJson: result.afterJson,
            updatedAt: new Date(),
          },
        });
        updatedCount += 1;
      }
    } catch (err) {
      // Satır başarısız — diğerini bozma
      errorCount += 1;
      await prisma.importJobRow.update({
        where: { id: row.id },
        data: {
          status: 'error',
          errorsJson: [
            ...(Array.isArray(row.errorsJson) ? row.errorsJson : []),
            {
              targetKey: null,
              label: null,
              message: err.message ?? 'Bilinmeyen hata.',
              code: err.code ?? 'commit_error',
            },
          ],
          updatedAt: new Date(),
        },
      });
    }
  }

  // Final counts — DB'den güncelle
  const finalCounts = await prisma.importJobRow.groupBy({
    by: ['status'],
    where: { importJobId: jobId },
    _count: { _all: true },
  });
  const byStatus = Object.fromEntries(finalCounts.map((c) => [c.status, c._count._all]));
  const finalCreate = byStatus.created ?? 0;
  const finalUpdate = byStatus.updated ?? 0;
  const finalSkipped = byStatus.skipped ?? 0;
  const finalError = byStatus.error ?? 0;

  const hasError = finalError > 0;
  const status = hasError ? 'partial' : 'completed';

  const final = await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status,
      completedAt: new Date(),
      createCount: finalCreate,
      updateCount: finalUpdate,
      skippedCount: finalSkipped,
      errorCount: finalError,
    },
    select: {
      id: true,
      status: true,
      totalRows: true,
      createCount: true,
      updateCount: true,
      skippedCount: true,
      errorCount: true,
      warningCount: true,
      startedAt: true,
      completedAt: true,
    },
  });

  return {
    job: final,
    runStats: { createdCount, updatedCount, skippedCount, errorCount },
  };
}

async function createFromRow({ companyId, normalized }) {
  if (!normalized || typeof normalized !== 'object') {
    const err = new Error('Normalize edilmiş satır boş.');
    err.code = 'empty_normalized';
    throw err;
  }
  const name = normalized.name;
  if (!name) {
    const err = new Error('Müşteri adı boş.');
    err.code = 'missing_name';
    throw err;
  }

  // VKN duplicate check (race safety) — eğer varsa zaten update path'inde olmalı,
  // ama dry-run sonrası başka bir job aynı VKN'yi yaratmış olabilir.
  if (normalized.vkn) {
    const dup = await prisma.account.findUnique({
      where: { vkn: normalized.vkn },
      select: { id: true },
    });
    if (dup) {
      const err = new Error('Bu VKN ile başka bir müşteri var (yarış koşulu).');
      err.code = 'race_duplicate_vkn';
      throw err;
    }
  }

  const phoneRaw = normalized._rawPhone ?? null;
  const phoneE164 = normalized.phone ?? null;
  const externalCustomerCode = normalized.externalCustomerCode ?? null;

  const created = await prisma.account.create({
    data: {
      name,
      vkn: normalized.vkn ?? null,
      phone: phoneRaw,
      phoneE164,
      email: normalized.email ?? null,
      customerType: normalized.customerType ?? 'Corporate',
      legalName: normalized.legalName ?? null,
      registrationNo: normalized.registrationNo ?? null,
      isActive: normalized.isActive ?? true,
      companyId, // legacy bağ — scope sorguları
      companies: {
        create: [
          {
            companyId,
            externalCustomerCode,
            status: 'active',
          },
        ],
      },
    },
    select: {
      id: true,
      name: true,
      vkn: true,
      phone: true,
      phoneE164: true,
      email: true,
      customerType: true,
      legalName: true,
      registrationNo: true,
      isActive: true,
    },
  });

  return {
    accountId: created.id,
    afterJson: snapshotAccount(created),
  };
}

async function updateFromRow({ companyId, normalized }) {
  if (!normalized?.vkn) {
    const err = new Error('Update için VKN gerekli.');
    err.code = 'missing_vkn';
    throw err;
  }
  const existing = await prisma.account.findUnique({
    where: { vkn: normalized.vkn },
    select: {
      id: true,
      name: true,
      vkn: true,
      phone: true,
      phoneE164: true,
      email: true,
      customerType: true,
      legalName: true,
      registrationNo: true,
      isActive: true,
    },
  });
  if (!existing) {
    const err = new Error('Güncellenecek müşteri bulunamadı (VKN değişmiş olabilir).');
    err.code = 'account_not_found';
    throw err;
  }

  const beforeJson = snapshotAccount(existing);

  // Sadece getirilen alanları (null değil) update et — boş alan eskiyi silmesin
  const patch = {};
  if (normalized.name !== undefined && normalized.name !== null) patch.name = normalized.name;
  if (normalized.email !== undefined && normalized.email !== null) patch.email = normalized.email;
  if (normalized.customerType !== undefined && normalized.customerType !== null) patch.customerType = normalized.customerType;
  if (normalized.legalName !== undefined && normalized.legalName !== null) patch.legalName = normalized.legalName;
  if (normalized.registrationNo !== undefined && normalized.registrationNo !== null) patch.registrationNo = normalized.registrationNo;
  if (normalized.isActive !== undefined && normalized.isActive !== null) patch.isActive = normalized.isActive;
  if (normalized.phone !== undefined && normalized.phone !== null) {
    patch.phone = normalized._rawPhone ?? normalized.phone;
    patch.phoneE164 = normalized.phone;
  }

  const updated = await prisma.account.update({
    where: { id: existing.id },
    data: patch,
    select: {
      id: true,
      name: true,
      vkn: true,
      phone: true,
      phoneE164: true,
      email: true,
      customerType: true,
      legalName: true,
      registrationNo: true,
      isActive: true,
    },
  });

  // AccountCompany upsert (selected companyId)
  if (normalized.externalCustomerCode !== undefined && normalized.externalCustomerCode !== null) {
    const existingAc = await prisma.accountCompany.findUnique({
      where: { accountId_companyId: { accountId: existing.id, companyId } },
      select: { id: true, externalCustomerCode: true },
    });
    if (existingAc) {
      if (existingAc.externalCustomerCode !== normalized.externalCustomerCode) {
        await prisma.accountCompany.update({
          where: { id: existingAc.id },
          data: { externalCustomerCode: normalized.externalCustomerCode },
        });
      }
    } else {
      await prisma.accountCompany.create({
        data: {
          accountId: existing.id,
          companyId,
          externalCustomerCode: normalized.externalCustomerCode,
          status: 'active',
        },
      });
    }
  } else {
    // Eğer hiç AccountCompany yoksa selected companyId için, yine upsert et (kod olmadan)
    const existingAc = await prisma.accountCompany.findUnique({
      where: { accountId_companyId: { accountId: existing.id, companyId } },
      select: { id: true },
    });
    if (!existingAc) {
      await prisma.accountCompany.create({
        data: { accountId: existing.id, companyId, status: 'active' },
      });
    }
  }

  return {
    accountId: updated.id,
    beforeJson,
    afterJson: snapshotAccount(updated),
  };
}

/**
 * Rollback:
 *  - status=created → Account.isActive=false
 *  - status=updated → beforeJson'dan eski değerlere döndür
 *  - status=skipped/error → atlanır
 *  - ImportJob.status → rolled_back (hepsi geri alındıysa) veya rollback_partial.
 */
export async function rollbackImportJob({ jobId, user }) {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: { id: true, companyId: true, status: true },
  });
  if (!job) {
    const err = new Error('Import job bulunamadı.');
    err.status = 404;
    throw err;
  }
  if (!['completed', 'partial'].includes(job.status)) {
    const err = new Error('Bu durumdaki job geri alınamaz.');
    err.status = 400;
    err.code = 'invalid_status_for_rollback';
    throw err;
  }

  const rows = await prisma.importJobRow.findMany({
    where: { importJobId: jobId, status: { in: ['created', 'updated'] } },
    select: { id: true, status: true, accountId: true, beforeJson: true, afterJson: true },
  });

  let rolledBackCreated = 0;
  let rolledBackUpdated = 0;
  let failedCount = 0;

  for (const r of rows) {
    if (!r.accountId) {
      failedCount += 1;
      continue;
    }
    try {
      if (r.status === 'created') {
        await prisma.account.update({
          where: { id: r.accountId },
          data: { isActive: false },
        });
        rolledBackCreated += 1;
      } else if (r.status === 'updated') {
        const before = r.beforeJson ?? {};
        const restore = {};
        if (before.name !== undefined) restore.name = before.name;
        if (before.email !== undefined) restore.email = before.email;
        if (before.phone !== undefined) restore.phone = before.phone;
        if (before.phoneE164 !== undefined) restore.phoneE164 = before.phoneE164;
        if (before.customerType !== undefined) restore.customerType = before.customerType;
        if (before.legalName !== undefined) restore.legalName = before.legalName;
        if (before.registrationNo !== undefined) restore.registrationNo = before.registrationNo;
        if (before.isActive !== undefined) restore.isActive = before.isActive;
        // VKN'yi rollback ETMİYORUZ — import VKN değiştirmemeli, match key buydu.
        await prisma.account.update({
          where: { id: r.accountId },
          data: restore,
        });
        rolledBackUpdated += 1;
      }
      await prisma.importJobRow.update({
        where: { id: r.id },
        data: { status: 'rolled_back', updatedAt: new Date() },
      });
    } catch (err) {
      failedCount += 1;
    }
  }

  const totalSucceeded = rolledBackCreated + rolledBackUpdated;
  const totalAttempted = rows.length;
  const newStatus = failedCount === 0 ? 'rolled_back' : (totalSucceeded === 0 ? 'partial' : 'rollback_partial');

  const updated = await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: newStatus,
      rolledBackAt: new Date(),
      rolledBackByUserId: user?.id ?? null,
    },
    select: {
      id: true,
      status: true,
      createCount: true,
      updateCount: true,
      rolledBackAt: true,
    },
  });

  return {
    job: updated,
    report: {
      rolledBackCreatedCount: rolledBackCreated,
      rolledBackUpdatedCount: rolledBackUpdated,
      failedCount,
      totalAttempted,
    },
  };
}

/**
 * Job listesi (allowedCompanyIds scope).
 */
export async function listImportJobs({ allowedCompanyIds, companyId = null, limit = 50 }) {
  const allowed = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
  if (allowed.length === 0) return [];
  const where = {
    companyId: companyId ? companyId : { in: allowed },
  };
  if (companyId && !allowed.includes(companyId)) return [];
  return prisma.importJob.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(1, limit), 200),
    select: {
      id: true,
      companyId: true,
      targetType: true,
      sourceType: true,
      sourceName: true,
      fileName: true,
      status: true,
      totalRows: true,
      createCount: true,
      updateCount: true,
      skippedCount: true,
      errorCount: true,
      warningCount: true,
      createdByUserId: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      rolledBackAt: true,
    },
  });
}

export async function getImportJob({ jobId, allowedCompanyIds }) {
  const allowed = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      companyId: true,
      targetType: true,
      sourceType: true,
      sourceName: true,
      sourceUrlMasked: true,
      fileName: true,
      dataPath: true,
      targetSchemaVersion: true,
      status: true,
      totalRows: true,
      createCount: true,
      updateCount: true,
      skippedCount: true,
      errorCount: true,
      warningCount: true,
      summaryJson: true,
      createdByUserId: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      rolledBackAt: true,
      rolledBackByUserId: true,
    },
  });
  if (!job) return null;
  if (!allowed.includes(job.companyId)) return null;
  return job;
}

export async function listImportJobRows({ jobId, status = null, limit = 200, offset = 0 }) {
  const where = { importJobId: jobId };
  if (status) where.status = status;
  return prisma.importJobRow.findMany({
    where,
    orderBy: { rowNumber: 'asc' },
    take: Math.min(Math.max(1, limit), 1000),
    skip: Math.max(0, offset),
    select: {
      id: true,
      rowNumber: true,
      action: true,
      status: true,
      accountId: true,
      matchKey: true,
      errorsJson: true,
      warningsJson: true,
      rawJson: true,
      normalizedJson: true,
      beforeJson: true,
      afterJson: true,
    },
  });
}

export { autoMapAccountColumns, describeAccountTargetSchema };
