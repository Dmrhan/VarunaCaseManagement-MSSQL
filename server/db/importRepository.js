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
import { generateUniqueAccountId } from '../utils/accountId.js';
import {
  ACCOUNT_TARGET_VERSION,
  describeAccountTargetSchema,
  autoMapAccountColumns,
  validateMapping,
  normalizeRow,
} from '../lib/import/targetSchemas/accountTargetSchema.js';
import { maskVkn } from './accountRepository.js';

const MAX_ROWS = 5000;

/**
 * Display-friendly snapshot — VKN maskelenir, TCKN dokunulmaz.
 *
 * WR-A8 review fix (Issue 2) — snapshot artık AccountCompany detayını da
 * taşır. `accountCompany`: bu import'un işlediği tenant scope'undaki
 * AccountCompany ilişkisi (null = ilişki yok / yeni yaratıldı).
 * `accountCompanyCreated`: true ise commit bu satır için yeni AccountCompany
 * row'u yarattı (rollback bu durumda soft-deactivate eder).
 */
function snapshotAccount(account, accountCompany = null, accountCompanyCreated = false) {
  if (!account) return null;
  return {
    id: account.id,
    name: account.name,
    vkn: account.vkn,
    vknMasked: maskVkn(account.vkn),
    phone: account.phone ?? null,
    phoneE164: account.phoneE164 ?? null,
    // Phase 2 + Phase 3 — slot 1 metadata + slot 2/3 + primary
    phoneType: account.phoneType ?? null,
    phoneExtension: account.phoneExtension ?? null,
    phone2: account.phone2 ?? null,
    phone2E164: account.phone2E164 ?? null,
    phone2Type: account.phone2Type ?? null,
    phone2Extension: account.phone2Extension ?? null,
    phone3: account.phone3 ?? null,
    phone3E164: account.phone3E164 ?? null,
    phone3Type: account.phone3Type ?? null,
    phone3Extension: account.phone3Extension ?? null,
    primaryPhoneSlot: account.primaryPhoneSlot ?? null,
    email: account.email ?? null,
    customerType: account.customerType,
    legalName: account.legalName ?? null,
    taxOffice: account.taxOffice ?? null,
    registrationNo: account.registrationNo ?? null,
    isActive: account.isActive,
    accountCompany: accountCompany
      ? {
          id: accountCompany.id,
          companyId: accountCompany.companyId ?? null,
          externalCustomerCode: accountCompany.externalCustomerCode ?? null,
          status: accountCompany.status ?? null,
        }
      : null,
    accountCompanyCreated,
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
          phoneType: true,
          phoneExtension: true,
          phone2: true,
          phone2E164: true,
          phone2Type: true,
          phone2Extension: true,
          phone3: true,
          phone3E164: true,
          phone3Type: true,
          phone3Extension: true,
          primaryPhoneSlot: true,
          email: true,
          customerType: true,
          legalName: true,
          registrationNo: true,
          taxOffice: true,
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

  // Phase 2c — Customer code stabilization (Phase 1 import). Pre-resolve
  // accounts by AccountCompany.externalCustomerCode within the SELECTED
  // company. This is a tenant-scoped, more specific match key than VKN
  // and takes PRIORITY. When the same row has both externalCustomerCode
  // AND a VKN/TCKN that conflicts with the linked Account's identity,
  // we emit an error rather than silently update — preventing account
  // merge / overwrite via the import.
  const codeKeys = [];
  for (const r of normalizedRows) {
    const c = r.normalized?.externalCustomerCode;
    if (c) codeKeys.push(c);
  }
  const existingAcsByCode = codeKeys.length
    ? await prisma.accountCompany.findMany({
        where: { companyId, externalCustomerCode: { in: [...new Set(codeKeys)] } },
        select: { id: true, accountId: true, externalCustomerCode: true, packageName: true },
      })
    : [];
  const acByCode = new Map(existingAcsByCode.map((ac) => [ac.externalCustomerCode, ac]));
  const codeMatchedAccountIds = existingAcsByCode.map((ac) => ac.accountId);
  const codeMatchedAccounts = codeMatchedAccountIds.length
    ? await prisma.account.findMany({
        where: { id: { in: codeMatchedAccountIds } },
        select: {
          id: true, name: true, vkn: true, phone: true, phoneE164: true, email: true,
          customerType: true, legalName: true, registrationNo: true, taxOffice: true, isActive: true,
          tcknHash: true,
        },
      })
    : [];
  const accountById = new Map(codeMatchedAccounts.map((a) => [a.id, a]));

  let createCount = 0;
  let updateCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  let missingTaxIdCount = 0;

  const resultRows = normalizedRows.map((r) => {
    let action = 'skip';
    let matchedAccountName = null;
    let matchedAccountVknMasked = null;
    let fieldDiff = null;

    // Phase 2c — Customer code stabilization helper
    const code = r.normalized?.externalCustomerCode;
    const codeAc = code ? acByCode.get(code) : null;
    const codeMatchedAccount = codeAc ? accountById.get(codeAc.accountId) : null;

    if (r.errors.length > 0) {
      action = 'error';
      errorCount += 1;
    } else if (codeMatchedAccount) {
      // (1) externalCustomerCode match path — tenant-scoped, highest priority
      // Conflict: incoming VKN/TCKN differs from linked Account's identity?
      const vknConflict =
        r.normalized.vkn && codeMatchedAccount.vkn && r.normalized.vkn !== codeMatchedAccount.vkn;
      // TCKN ingestion is privacy-blocked in Phase 1 (no plain TCKN field);
      // we still check hash if a future field is added. Today: pre-existing
      // tcknHash on the matched Account vs. incoming has no overlap.
      if (vknConflict) {
        r.errors.push({
          targetKey: 'externalCustomerCode',
          label: 'Dış Müşteri Kodu',
          code: 'external_customer_code_identity_conflict',
          message: `Müşteri kodu ${code} mevcut müşteriyle eşleşti ancak VKN/TCKN farklı.`,
        });
        action = 'error';
        errorCount += 1;
      } else {
        action = 'update';
        matchedAccountName = codeMatchedAccount.name;
        matchedAccountVknMasked = maskVkn(codeMatchedAccount.vkn);
        fieldDiff = computeFieldDiff(codeMatchedAccount, codeAc, r.normalized);
        const hasAccountChange = Object.keys(fieldDiff.account).length > 0;
        const hasAcChange = Object.keys(fieldDiff.accountCompany).length > 0;
        if (!hasAccountChange && !hasAcChange) {
          action = 'skip';
          skippedCount += 1;
        } else {
          updateCount += 1;
        }
      }
    } else if (r.normalized.vkn && existingByVkn.has(r.normalized.vkn)) {
      // (2) VKN match path — existing fallback behavior
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
    // Count only rows that will actually be inserted/updated without a tax
    // id. Rows that error out for other reasons won't reach the DB, so
    // including them would inflate the operator-facing count.
    if (action !== 'error' && r.warnings.some((w) => w.code === 'no_tax_id')) {
      missingTaxIdCount += 1;
    }

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
      // Rows that lacked VKN (and therefore TCKN — TCKN ingestion stays
      // privacy-blocked separately). Surfaced so the wizard summary can
      // tell operators "X rows will be created without an official tax id."
      missingTaxIdCount,
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
  const accountKeys = [
    'name', 'vkn',
    'phone', 'phoneType', 'phoneExtension',
    // Phase 3 — slot 2/3 + primary
    'phone2', 'phone2Type', 'phone2Extension',
    'phone3', 'phone3Type', 'phone3Extension',
    'primaryPhoneSlot',
    'email', 'customerType', 'legalName', 'registrationNo', 'taxOffice', 'isActive',
  ];
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

  // WR-A8 review fix (Issue 3) — skipErrors=false ve hatalı satır varsa commit
  // bloklanır. Daha önce flag yok sayılıyordu; UI checkbox sahte güvenlik
  // veriyordu. errorCount kontrolü ImportJobRow.status='error' bazlı yapılır.
  const skipErrors = options?.skipErrors === true;
  if (!skipErrors) {
    const errorCount = await prisma.importJobRow.count({
      where: { importJobId: jobId, status: 'error' },
    });
    if (errorCount > 0) {
      const err = new Error(
        "Hatalı satırlar varken içe aktarım başlatılamaz. Hatalı satırları düzeltin veya 'Hatalı satırları atla' seçeneğini işaretleyin.",
      );
      err.status = 400;
      err.code = 'import_has_errors';
      err.errorCount = errorCount;
      throw err;
    }
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
  // Phase 2 + Phase 3 — slot 1 metadata + slot 2/3 (paralel) + primary.
  const phoneType = normalized.phoneType ?? null;
  const phoneExtension = normalized.phoneExtension ?? null;
  const phone2Raw = normalized._rawPhone2 ?? null;
  const phone2E164 = normalized.phone2 ?? null;
  const phone2Type = normalized.phone2Type ?? null;
  const phone2Extension = normalized.phone2Extension ?? null;
  const phone3Raw = normalized._rawPhone3 ?? null;
  const phone3E164 = normalized.phone3 ?? null;
  const phone3Type = normalized.phone3Type ?? null;
  const phone3Extension = normalized.phone3Extension ?? null;
  // primaryPhoneSlot: caller verirse onu kullan, aksi halde ilk dolu slot.
  let primaryPhoneSlot = normalized.primaryPhoneSlot ?? null;
  if (primaryPhoneSlot === null) {
    if (phoneE164) primaryPhoneSlot = 1;
    else if (phone2E164) primaryPhoneSlot = 2;
    else if (phone3E164) primaryPhoneSlot = 3;
  }
  const externalCustomerCode = normalized.externalCustomerCode ?? null;

  // Phase 1 import — yeni Account standart `cus_<22>` formatında.
  const newId = await generateUniqueAccountId();
  const created = await prisma.account.create({
    data: {
      id: newId,
      name,
      vkn: normalized.vkn ?? null,
      phone: phoneRaw,
      phoneE164,
      phoneType,
      phoneExtension,
      phone2: phone2Raw,
      phone2E164,
      phone2Type,
      phone2Extension,
      phone3: phone3Raw,
      phone3E164,
      phone3Type,
      phone3Extension,
      primaryPhoneSlot,
      email: normalized.email ?? null,
      customerType: normalized.customerType ?? 'Corporate',
      legalName: normalized.legalName ?? null,
      registrationNo: normalized.registrationNo ?? null,
      taxOffice: normalized.taxOffice ?? null,
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
      phoneType: true,
      phoneExtension: true,
      phone2: true,
      phone2E164: true,
      phone2Type: true,
      phone2Extension: true,
      phone3: true,
      phone3E164: true,
      phone3Type: true,
      phone3Extension: true,
      primaryPhoneSlot: true,
      email: true,
      customerType: true,
      legalName: true,
      registrationNo: true,
      taxOffice: true,
      isActive: true,
      companies: {
        where: { companyId },
        select: { id: true, companyId: true, externalCustomerCode: true, status: true },
        take: 1,
      },
    },
  });
  const createdAc = created.companies?.[0] ?? null;

  return {
    accountId: created.id,
    // create yolunda accountCompany her zaman bu commit tarafından yaratılmıştır.
    afterJson: snapshotAccount(created, createdAc, /* accountCompanyCreated */ true),
  };
}

async function updateFromRow({ companyId, normalized }) {
  // Phase 2c — Customer code stabilization. Allow update by AccountCompany
  // (companyId, externalCustomerCode) when VKN is absent. The dry-run
  // determines action='update' on this same key; the commit must locate
  // the existing Account through the same path.
  const accountSelect = {
    id: true, name: true, vkn: true, phone: true, phoneE164: true, email: true,
    customerType: true, legalName: true, registrationNo: true, taxOffice: true, isActive: true,
  };
  let existing = null;
  if (normalized?.vkn) {
    existing = await prisma.account.findUnique({
      where: { vkn: normalized.vkn },
      select: accountSelect,
    });
  } else if (normalized?.externalCustomerCode) {
    const ac = await prisma.accountCompany.findUnique({
      where: { companyId_externalCustomerCode: { companyId, externalCustomerCode: normalized.externalCustomerCode } },
      select: { accountId: true },
    });
    if (ac) {
      existing = await prisma.account.findUnique({
        where: { id: ac.accountId },
        select: accountSelect,
      });
    }
  } else {
    const err = new Error('Update için VKN veya externalCustomerCode gerekli.');
    err.code = 'missing_match_key';
    throw err;
  }
  if (!existing) {
    const err = new Error('Güncellenecek müşteri bulunamadı (VKN/externalCustomerCode değişmiş olabilir).');
    err.code = 'account_not_found';
    throw err;
  }
  // Phase 2c — defense in depth. Even if dry-run skipped the conflict
  // check, refuse to silently overwrite identity at commit time.
  if (normalized?.vkn && existing.vkn && normalized.vkn !== existing.vkn) {
    const err = new Error(`Müşteri kodu mevcut müşteriyle eşleşti ancak VKN/TCKN farklı.`);
    err.code = 'external_customer_code_identity_conflict';
    throw err;
  }

  // WR-A8 review fix (Issue 2) — AccountCompany'nin commit öncesi snapshot'ı.
  // Rollback bu satırdan eski externalCustomerCode'u geri yükler. Eğer hiç
  // ilişki yoksa null kalır; bu durumda update path AccountCompany yaratacak
  // ve rollback yeni satırı soft-deactivate edecek.
  const existingAcBefore = await prisma.accountCompany.findUnique({
    where: { accountId_companyId: { accountId: existing.id, companyId } },
    select: { id: true, companyId: true, externalCustomerCode: true, status: true },
  });
  const beforeJson = snapshotAccount(existing, existingAcBefore, /* created */ false);

  // Sadece getirilen alanları (null değil) update et — boş alan eskiyi silmesin
  const patch = {};
  if (normalized.name !== undefined && normalized.name !== null) patch.name = normalized.name;
  if (normalized.email !== undefined && normalized.email !== null) patch.email = normalized.email;
  if (normalized.customerType !== undefined && normalized.customerType !== null) patch.customerType = normalized.customerType;
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
  // Phase 3 — slot 2 (phone+E164+Type+Extension)
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
  // primaryPhoneSlot: dolu/boş slot'lara göre sanity. Backend Account
  // updateAccount kuralları aynısı — boş slotu işaret edemez.
  if (normalized.primaryPhoneSlot !== undefined && normalized.primaryPhoneSlot !== null) {
    patch.primaryPhoneSlot = normalized.primaryPhoneSlot;
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
      phoneType: true,
      phoneExtension: true,
      phone2: true,
      phone2E164: true,
      phone2Type: true,
      phone2Extension: true,
      phone3: true,
      phone3E164: true,
      phone3Type: true,
      phone3Extension: true,
      primaryPhoneSlot: true,
      email: true,
      customerType: true,
      legalName: true,
      registrationNo: true,
      taxOffice: true,
      isActive: true,
    },
  });

  // AccountCompany upsert (selected companyId).
  // WR-A8 review fix (Issue 2) — `accountCompanyCreated` flag rollback'in
  // yeni yaratılan AccountCompany'yi soft-deactivate etmesi için taşınır.
  let accountCompanyCreated = false;
  if (normalized.externalCustomerCode !== undefined && normalized.externalCustomerCode !== null) {
    if (existingAcBefore) {
      if (existingAcBefore.externalCustomerCode !== normalized.externalCustomerCode) {
        await prisma.accountCompany.update({
          where: { id: existingAcBefore.id },
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
      accountCompanyCreated = true;
    }
  } else if (!existingAcBefore) {
    // Hiç AccountCompany yoksa kod olmadan da bağ kur — Account selected
    // company'de görülsün.
    await prisma.accountCompany.create({
      data: { accountId: existing.id, companyId, status: 'active' },
    });
    accountCompanyCreated = true;
  }

  // Sonraki snapshot için güncel AccountCompany'yi tekrar oku.
  const accountCompanyAfter = await prisma.accountCompany.findUnique({
    where: { accountId_companyId: { accountId: existing.id, companyId } },
    select: { id: true, companyId: true, externalCustomerCode: true, status: true },
  });

  return {
    accountId: updated.id,
    beforeJson,
    afterJson: snapshotAccount(updated, accountCompanyAfter, accountCompanyCreated),
  };
}

/**
 * Stack/multi-line trace içermeden kısa, kullanıcıya gösterilebilir hata mesajı.
 */
function safeErrorMessage(err) {
  const msg = err?.message ?? err?.code ?? 'bilinmeyen hata';
  return String(msg).split('\n')[0].slice(0, 240);
}

/** ImportJobRow.errorsJson'a yeni bir kayıt ekle (varsa array, yoksa yarat). */
function appendRowErrors(existing, additions) {
  const base = Array.isArray(existing) ? existing : [];
  return [...base, ...additions];
}

/**
 * Rollback:
 *  - status=created → Account.isActive=false (+ AccountCompany.status='inactive')
 *  - status=updated → beforeJson'dan Account alanlarını + AccountCompany.externalCustomerCode geri yükle
 *  - status=skipped/error → atlanır
 *
 * Row status:
 *  - 'rolled_back': Account + AccountCompany tam geri alındı.
 *  - 'rollback_error': bir veya daha fazla restore başarısız oldu (errorsJson detay verir).
 *
 * Job status:
 *  - failedCount=0 → 'rolled_back'
 *  - bazı satırlar başarılı, bazıları başarısız → 'rollback_partial'
 *  - hiçbir satır başarılı değilse mevcut job statüsüne (completed/partial) dokunulmaz
 *    yerine 'rollback_partial' işaretlenir; operator UI'da hata sayısını görür.
 *
 * WR-A8 review fix (Issue 2):
 *   Önceden yalnız Account alanları geri yüklüyordu; commit'in yazdığı
 *   AccountCompany.externalCustomerCode değişikliği rollback sonrası "NEW"
 *   değerinde kalıyordu. Şimdi `beforeJson.accountCompany` taşınır ve restore
 *   edilir; commit'in yarattığı yeni AccountCompany row'u rollback sırasında
 *   soft-deactivate olur (status='inactive').
 *
 * WR-A8 review fix (Rollback no-swallow):
 *   Önceki sürüm AccountCompany restore'larını `.catch(() => {})` ile
 *   yutuyordu; başarısız restore sessizce kayboluyor, başarı sayacı yine
 *   artıyordu. Bu sürümde her restore (Account + AccountCompany) ayrı
 *   try/catch'te koşar; başarısızlık satırı `rollback_error` yapar, sayaç
 *   YALNIZ tam başarıda artar. Job seviyesi `failedCount` + `failedRows`
 *   üzerinden operator'a yansır.
 */
export async function rollbackImportJob({ jobId, user, expectedTargetType = null }) {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: { id: true, companyId: true, status: true, targetType: true },
  });
  if (!job) {
    const err = new Error('Import job bulunamadı.');
    err.status = 404;
    throw err;
  }
  // Defense-in-depth: even if the route already filtered by targetType via
  // getImportJob, refuse to touch ImportJobRows of a wrong-type job. This
  // is the rollback's last barrier against rolling back a Customer 360 job
  // through the Phase 1 endpoint (or vice versa) when called from another
  // call site.
  if (expectedTargetType && job.targetType !== expectedTargetType) {
    const err = new Error('Job hedef türü beklenenden farklı.');
    err.status = 400;
    err.code = 'wrong_target_type';
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
    select: {
      id: true,
      rowNumber: true,
      status: true,
      accountId: true,
      beforeJson: true,
      afterJson: true,
      errorsJson: true,
    },
  });

  let rolledBackCreated = 0;
  let rolledBackUpdated = 0;
  let rolledBackAccountCompany = 0;
  let failedCount = 0;
  const failedRows = [];

  for (const r of rows) {
    const rowErrors = [];

    if (!r.accountId) {
      const e = {
        code: 'rollback_missing_account_id',
        targetKey: null,
        label: null,
        message: 'Rollback için accountId yok.',
      };
      rowErrors.push(e);
      await prisma.importJobRow.update({
        where: { id: r.id },
        data: {
          status: 'rollback_error',
          errorsJson: appendRowErrors(r.errorsJson, rowErrors),
          updatedAt: new Date(),
        },
      });
      failedCount += 1;
      failedRows.push({ rowNumber: r.rowNumber, errors: rowErrors });
      continue;
    }

    // ─── Step 1: Account restore ──────────────────────────────────
    let accountOk = false;
    try {
      if (r.status === 'created') {
        await prisma.account.update({
          where: { id: r.accountId },
          data: { isActive: false },
        });
      } else if (r.status === 'updated') {
        const before = r.beforeJson ?? {};
        const restore = {};
        // Codex P2 — Phase 1 rollback eski phone slot metadata + slot 2/3
        // + primaryPhoneSlot + taxOffice alanlarını restore etmiyordu;
        // import bunları yazdığı için rollback de yansıtmalı.
        const restoreKeys = [
          'name', 'email',
          'phone', 'phoneE164', 'phoneType', 'phoneExtension',
          'phone2', 'phone2E164', 'phone2Type', 'phone2Extension',
          'phone3', 'phone3E164', 'phone3Type', 'phone3Extension',
          'primaryPhoneSlot',
          'customerType', 'legalName', 'registrationNo', 'taxOffice',
          'isActive',
        ];
        for (const k of restoreKeys) {
          if (before[k] !== undefined) restore[k] = before[k];
        }
        // VKN'yi rollback ETMİYORUZ — import VKN değiştirmemeli, match key buydu.
        await prisma.account.update({
          where: { id: r.accountId },
          data: restore,
        });
      }
      accountOk = true;
    } catch (err) {
      rowErrors.push({
        code: 'account_rollback_failed',
        targetKey: null,
        label: 'Account',
        message: `Account geri alınamadı: ${safeErrorMessage(err)}`,
      });
    }

    // ─── Step 2: AccountCompany restore (ayrı try/catch) ──────────
    // Account başarısız olsa bile AC için ayrıca dene; biri yutmasın diğerini.
    // AC hatası `account_company_rollback_failed` koduyla raporlanır.
    let acAttempted = false;
    let acOk = false;
    try {
      if (r.status === 'created') {
        const afterAc = r.afterJson?.accountCompany;
        if (afterAc?.id) {
          acAttempted = true;
          await prisma.accountCompany.update({
            where: { id: afterAc.id },
            data: { status: 'inactive' },
          });
          acOk = true;
        }
      } else if (r.status === 'updated') {
        const before = r.beforeJson ?? {};
        const after = r.afterJson ?? {};
        const acBefore = before.accountCompany ?? null;
        const acAfter = after.accountCompany ?? null;
        const acCreated = !!after.accountCompanyCreated;
        if (acBefore?.id) {
          const acRestore = {};
          if (acBefore.externalCustomerCode !== undefined) {
            acRestore.externalCustomerCode = acBefore.externalCustomerCode;
          }
          if (acBefore.status !== undefined) acRestore.status = acBefore.status;
          if (Object.keys(acRestore).length > 0) {
            acAttempted = true;
            await prisma.accountCompany.update({
              where: { id: acBefore.id },
              data: acRestore,
            });
            acOk = true;
          }
        } else if (acCreated && acAfter?.id) {
          acAttempted = true;
          await prisma.accountCompany.update({
            where: { id: acAfter.id },
            data: { status: 'inactive' },
          });
          acOk = true;
        }
      }
    } catch (err) {
      rowErrors.push({
        code: 'account_company_rollback_failed',
        targetKey: 'externalCustomerCode',
        label: 'AccountCompany',
        message: `AccountCompany geri alınamadı: ${safeErrorMessage(err)}`,
      });
    }

    // ─── Step 3: Outcome aggregation ──────────────────────────────
    const hasErrors = rowErrors.length > 0;
    if (hasErrors) {
      await prisma.importJobRow.update({
        where: { id: r.id },
        data: {
          status: 'rollback_error',
          errorsJson: appendRowErrors(r.errorsJson, rowErrors),
          updatedAt: new Date(),
        },
      });
      failedCount += 1;
      failedRows.push({ rowNumber: r.rowNumber, errors: rowErrors });
      // Başarı sayacı arttırılmaz — kısmi başarı da olsa "tam başarı" raporlamayız.
    } else {
      await prisma.importJobRow.update({
        where: { id: r.id },
        data: { status: 'rolled_back', updatedAt: new Date() },
      });
      if (r.status === 'created') rolledBackCreated += 1;
      else if (r.status === 'updated') rolledBackUpdated += 1;
      if (acAttempted && acOk) rolledBackAccountCompany += 1;
    }
    // accountOk YALNIZ debugging amaçlı — counter'ları kontrol etmiyor.
    void accountOk;
  }

  const totalAttempted = rows.length;
  const newStatus = failedCount === 0 ? 'rolled_back' : 'rollback_partial';

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
      rolledBackAccountCompanyCount: rolledBackAccountCompany,
      failedCount,
      errorCount: failedCount,
      totalAttempted,
      failedRows,
    },
  };
}

/**
 * Job listesi (allowedCompanyIds scope).
 */
export async function listImportJobs({ allowedCompanyIds, companyId = null, targetType = null, limit = 50 }) {
  const allowed = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
  if (allowed.length === 0) return [];
  const where = {
    companyId: companyId ? companyId : { in: allowed },
  };
  // Optional targetType filter — Phase 1 history must not show Customer 360
  // jobs and vice-versa. Callers that omit it keep legacy behavior.
  if (targetType) where.targetType = targetType;
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

export async function getImportJob({ jobId, allowedCompanyIds, expectedTargetType = null }) {
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
  // Cross-target guard: a Phase 1 caller must not be able to load a
  // Customer 360 job by id (and vice versa). Mirrors getCustomer360Job in
  // server/lib/import/customer360CommitEngine.js. Returns null so the
  // route surfaces the same `job_not_found` response.
  if (expectedTargetType && job.targetType !== expectedTargetType) return null;
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
