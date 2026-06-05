/**
 * WR-A8 — Customer 360 dry-run engine.
 *
 * In-memory only. NO DB writes (the entity tables — Account /
 * AccountCompany / AccountContact / Address / AccountProject — are
 * untouched by this module). The downstream commit engine
 * (server/lib/import/customer360CommitEngine.js) is what mutates entities
 * and persists ImportJob/ImportJobRow audit. Smoke #13 asserts the
 * zero-entity-mutation invariant of this dry-run path.
 *
 * Returns per-entity counts, orphan child detection, completeness score,
 * and a skipErrors preview ("what would happen if this were committed").
 * The HTTP route layer computes the operator-facing `commitAvailable`
 * boolean from this response.
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
    const rows = entities?.[ek]?.rows ?? [];
    // WR-A8 Phase 2b — Empty entities pass mapping validation. An admin
    // importing only Account + AccountCompany shouldn't be forced to map
    // Contact/Address/Project fields. Validator only runs for non-empty
    // entity blocks.
    if (rows.length === 0) {
      mappingValidation[ek] = { ok: true, errors: [], warnings: [] };
      continue;
    }
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

  // ─── recordNo / parentRecordNo support (Phase 2c) ────────────────
  // Dosya İÇİNDEKİ parent-child anahtarı. Her sheet için recordNo
  // tekilliği kontrol edilir; child sheet'lerin parentRecordNo'ları
  // önce Accounts/Companies recordNo index'leri üzerinden çözülür,
  // sonra mevcut accountKey/companyCode fallback'ine düşülür.
  const accountByRecordNo = new Map();
  function indexAccountRecordNos() {
    accountByRecordNo.clear();
    const seen = new Map(); // recordNo → first rowNumber
    for (const r of normalizedByEntity.account ?? []) {
      const rec = r.normalized.recordNo;
      if (!rec) continue;
      if (seen.has(rec)) {
        r.errors.push({
          entity: 'account',
          targetKey: 'recordNo',
          label: 'Kayıt No (Dosya İçi)',
          code: 'duplicate_record_no_in_sheet',
          message: `recordNo="${rec}" Accounts sheet'inde tekil değil (satırlar: ${seen.get(rec)}, ${r.rowNumber}).`,
        });
        // mark previously-seen row too
        const prev = (normalizedByEntity.account ?? []).find((x) => x.rowNumber === seen.get(rec));
        if (prev && !prev.errors.some((e) => e.code === 'duplicate_record_no_in_sheet' && e.targetKey === 'recordNo')) {
          prev.errors.push({
            entity: 'account',
            targetKey: 'recordNo',
            label: 'Kayıt No (Dosya İçi)',
            code: 'duplicate_record_no_in_sheet',
            message: `recordNo="${rec}" Accounts sheet'inde tekil değil (satırlar: ${seen.get(rec)}, ${r.rowNumber}).`,
          });
        }
        continue;
      }
      seen.set(rec, r.rowNumber);
      // Always index by recordNo — including rows that themselves have
      // errors. Lookup-time (resolveParentForChild) decides between
      // "found-clean", "found-with-errors", and "missing", so child rows
      // never misreport an existing parent as not found. Prior to this
      // change, an Account with invalid VKN was excluded here, and child
      // sheets reported `parent_record_no_not_found` for a row that
      // clearly existed.
      accountByRecordNo.set(rec, r);
    }
  }
  indexAccountRecordNos();

  // Phase 3 — Account 3 phone slot row-level validation. primaryPhone-
  // Slot dolu olmayan slotu işaret edemez; aynı E.164 birden fazla
  // slotta yer alamaz.
  //
  // Effective-state check (Codex P2): Update senaryosunda mevcut Account
  // VKN match'i ile bulunabilir. Row body sadece phone2 verirse, mevcut
  // phoneE164 + yeni phone2 effective slot setini oluşturur; row-level
  // sample (yalnız row'daki dolu slot'lar) bunu kaçırıyordu.
  const accountVkns = (normalizedByEntity.account ?? [])
    .filter((r) => r.errors.length === 0 && r.normalized.vkn)
    .map((r) => r.normalized.vkn);
  let existingByVknForSlots = new Map();
  if (accountVkns.length > 0) {
    const existingRows = await prisma.account.findMany({
      where: { vkn: { in: [...new Set(accountVkns)] } },
      select: { vkn: true, phoneE164: true, phone2E164: true, phone3E164: true, primaryPhoneSlot: true },
    });
    existingByVknForSlots = new Map(existingRows.map((a) => [a.vkn, a]));
  }

  for (const r of normalizedByEntity.account ?? []) {
    if (r.errors.length > 0) continue;
    const n = r.normalized;
    const current = n.vkn ? existingByVknForSlots.get(n.vkn) : null;
    const isUpdate = !!current;
    // Update yolu: caller bir slot vermediyse mevcut DB değeri korunur;
    // create yolu: caller vermediği slot null kalır.
    const effE164 = [
      n.phone !== undefined ? n.phone ?? null : isUpdate ? current.phoneE164 ?? null : null,
      n.phone2 !== undefined ? n.phone2 ?? null : isUpdate ? current.phone2E164 ?? null : null,
      n.phone3 !== undefined ? n.phone3 ?? null : isUpdate ? current.phone3E164 ?? null : null,
    ];
    // primaryPhoneSlot empty-check de effective state'te.
    const primaryCandidate = n.primaryPhoneSlot ?? (isUpdate ? current.primaryPhoneSlot : null);
    if (primaryCandidate) {
      const idx = primaryCandidate - 1;
      if (!effE164[idx]) {
        r.errors.push({
          entity: 'account',
          targetKey: 'primaryPhoneSlot',
          label: 'Birincil Telefon Slot',
          code: 'primary_phone_slot_empty',
          message: `primaryPhoneSlot=${primaryCandidate} ama o slot boş.`,
        });
      }
    }
    const filled = effE164.filter(Boolean);
    if (filled.length > 0 && new Set(filled).size !== filled.length) {
      r.errors.push({
        entity: 'account',
        targetKey: 'phone',
        label: 'Telefon',
        code: 'duplicate_phone_across_slots',
        message: isUpdate
          ? 'Bu telefon numarası mevcut müşteride başka bir slotta zaten kayıtlı.'
          : 'Aynı telefon numarası birden fazla slotta yer alıyor.',
      });
    }
  }

  function resolveAccountByParentRecordNo(parentRecordNo) {
    if (!parentRecordNo) return null;
    return accountByRecordNo.get(String(parentRecordNo).trim()) ?? null;
  }

  // Helper used by all child entities: try parentRecordNo first; on
  // success, write resolved row's accountKey back into normalized so the
  // downstream existing fallback (accountKey → resolveAccountKey) keeps
  // working unchanged for commit-time parent linkage. Returns the parent
  // row or null. Emits no errors here — caller decides.
  function resolveParentForChild(childRow) {
    const n = childRow.normalized;
    if (n.parentRecordNo) {
      const parent = resolveAccountByParentRecordNo(n.parentRecordNo);
      if (parent) {
        // Parent found. But parent itself may carry errors (e.g., missing
        // required name). Distinguish "parent has errors" from "parent
        // missing" so the user fixes the right row. We still treat this
        // as an orphan from the child's perspective (caller routes the
        // child to orphansByEntity); only the error CODE differs.
        if (parent.errors.length > 0) {
          childRow.errors.push({
            entity: childRow.entityType ?? childRow.entity ?? null,
            targetKey: 'parentRecordNo',
            label: 'Üst Kayıt No (Account)',
            code: 'parent_record_no_parent_has_errors',
            message: `parentRecordNo="${n.parentRecordNo}" Accounts sheet'inde bulundu fakat o satırda hata var; child satırı bu nedenle aktarılamaz.`,
          });
          return { parent: null, source: 'parentRecordNo_invalid' };
        }
        // Promote parent's key (vkn||name) to accountKey if missing so the
        // rest of the engine (and commit-time persistJob) can resolve it
        // via the existing vkn/name path.
        if (!n.accountKey) {
          n.accountKey = parent.normalized.vkn ?? parent.normalized.name ?? null;
        }
        return { parent, source: 'parentRecordNo' };
      }
      // parentRecordNo present but truly not in the sheet → hard error
      childRow.errors.push({
        entity: childRow.entityType ?? childRow.entity ?? null,
        targetKey: 'parentRecordNo',
        label: 'Üst Kayıt No (Account)',
        code: 'parent_record_no_not_found',
        message: `parentRecordNo="${n.parentRecordNo}" Accounts sheet içinde bulunamadı.`,
      });
      return { parent: null, source: 'parentRecordNo_invalid' };
    }
    // Fallback to existing accountKey/vkn/name behavior
    const fallback = resolveAccountKey(n.accountKey);
    return { parent: fallback, source: fallback ? 'accountKey' : 'missing' };
  }

  // Sheet-level duplicate detection helper for source IDs (Contact /
  // Address / Project). Duplicate same-sheet source IDs are HARD errors.
  function flagDuplicateSourceIds(entity, sourceField, label) {
    const rows = normalizedByEntity[entity] ?? [];
    const seen = new Map();
    for (const r of rows) {
      if (r.errors.length > 0) continue;
      const v = r.normalized[sourceField];
      if (!v) continue;
      if (seen.has(v)) {
        const firstRn = seen.get(v);
        const firstRow = rows.find((x) => x.rowNumber === firstRn);
        const msg = `${label}="${v}" sheet içinde birden fazla kez geçiyor (satırlar: ${firstRn}, ${r.rowNumber}).`;
        r.errors.push({ entity, targetKey: sourceField, label, code: 'duplicate_source_id_in_sheet', message: msg });
        if (firstRow && !firstRow.errors.some((e) => e.code === 'duplicate_source_id_in_sheet' && e.targetKey === sourceField)) {
          firstRow.errors.push({ entity, targetKey: sourceField, label, code: 'duplicate_source_id_in_sheet', message: msg });
        }
      } else {
        seen.set(v, r.rowNumber);
      }
    }
  }

  // Build accountCompany index for project parent resolution.
  // Key: `${accountKey}|${companyCode}` → accountCompany row.
  // NOTE: This index is REBUILT after the accountCompany selected-company
  // guard below — because the guard auto-binds empty companyCode to the
  // wizard's selected company; the index must reflect post-bind keys so
  // project rows can resolve them.
  const accountCompanyIndex = new Map();
  function rebuildAccountCompanyIndex() {
    accountCompanyIndex.clear();
    for (const r of normalizedByEntity.accountCompany ?? []) {
      if (r.errors.length > 0) continue;
      const n = r.normalized;
      if (n.accountKey && n.companyCode) {
        accountCompanyIndex.set(`${n.accountKey}|${n.companyCode}`, r);
      }
    }
  }
  rebuildAccountCompanyIndex();
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

  // accountCompany — needs accountKey + must bind to wizard's selected company.
  // WR-A8 Phase 2a review fix (selected-company guard):
  //   - Önceki davranış: companyCode allowedCompanyIds içinde olması yeterliydi
  //     → birden fazla şirkete erişimi olan admin için dry-run preview
  //     tenant'ları karıştırabiliyordu.
  //   - Yeni davranış: SELECTED companyId tek geçerli hedeftir.
  //       • companyCode boş → selected company'ye otomatik bind.
  //       • companyCode == selected company → OK.
  //       • companyCode başka bir şirket (admin'in erişimi olsa bile)
  //         → account_company_selected_company_mismatch.
  //   allowedCompanyIds yalnız "kullanıcı selected company'ye erişebiliyor mu"
  //   sorusunun yanıtıdır; satır-bazlı kabul kuralı değildir.
  for (const r of normalizedByEntity.accountCompany ?? []) {
    if (r.errors.length > 0) continue;
    // Phase 2c — parentRecordNo öncelikli
    const { parent, source } = resolveParentForChild({ ...r, entity: 'accountCompany' });
    if (source === 'parentRecordNo_invalid') {
      orphansByEntity.accountCompany.push(r.rowNumber);
      continue;
    }
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
    // Selected-company guard
    if (!r.normalized.companyCode) {
      // Source company alanı boş → selected company'ye bind.
      r.normalized.companyCode = companyId;
      r.warnings.push({
        entity: 'accountCompany',
        targetKey: 'companyCode',
        label: 'Varuna Şirket Kodu',
        code: 'auto_bound_to_selected_company',
        message: `Şirket kodu belirtilmedi; seçili şirkete (${companyId}) bağlandı.`,
      });
    } else if (r.normalized.companyCode !== companyId) {
      r.errors.push({
        entity: 'accountCompany',
        targetKey: 'companyCode',
        label: 'Varuna Şirket Kodu',
        code: 'account_company_selected_company_mismatch',
        message: 'İlişkili şirket satırı seçili şirketten farklı bir şirkete işaret ediyor. Aktarım yalnızca seçili şirkete yapılabilir.',
      });
    }
  }
  // After bind+guard, indexes need to reflect new companyCode values
  // (auto-bound rows now carry selected companyId) — project resolution
  // depends on this.
  rebuildAccountCompanyIndex();

  // Phase 2c — AccountCompany recordNo index for Project.parentCompanyRecordNo.
  // Duplicate recordNo within Companies sheet → error.
  const accountCompanyByRecordNo = new Map();
  {
    const seen = new Map();
    for (const r of normalizedByEntity.accountCompany ?? []) {
      const rec = r.normalized.recordNo;
      if (!rec) continue;
      if (seen.has(rec)) {
        r.errors.push({
          entity: 'accountCompany',
          targetKey: 'recordNo',
          label: 'Kayıt No (Dosya İçi)',
          code: 'duplicate_record_no_in_sheet',
          message: `recordNo="${rec}" Companies sheet'inde tekil değil (satırlar: ${seen.get(rec)}, ${r.rowNumber}).`,
        });
        const prev = (normalizedByEntity.accountCompany ?? []).find((x) => x.rowNumber === seen.get(rec));
        if (prev && !prev.errors.some((e) => e.code === 'duplicate_record_no_in_sheet' && e.targetKey === 'recordNo')) {
          prev.errors.push({
            entity: 'accountCompany',
            targetKey: 'recordNo',
            label: 'Kayıt No (Dosya İçi)',
            code: 'duplicate_record_no_in_sheet',
            message: `recordNo="${rec}" Companies sheet'inde tekil değil (satırlar: ${seen.get(rec)}, ${r.rowNumber}).`,
          });
        }
        continue;
      }
      seen.set(rec, r.rowNumber);
      if (r.errors.length === 0) accountCompanyByRecordNo.set(rec, r);
    }
  }
  function resolveAccountCompanyByParentCompanyRecordNo(recordNo) {
    if (!recordNo) return null;
    return accountCompanyByRecordNo.get(String(recordNo).trim()) ?? null;
  }

  // accountContact — orphan + duplicate detection per account
  const contactDupTracker = new Map(); // `${accountKey}|${email}` → rowNumbers[]
  const primaryByAccount = new Map(); // accountKey → count
  // Phase 2c — dup sourceContactId within sheet (error)
  flagDuplicateSourceIds('accountContact', 'sourceContactId', 'Kaynak Contact ID');
  for (const r of normalizedByEntity.accountContact ?? []) {
    if (r.errors.length > 0) continue;
    const { parent, source } = resolveParentForChild({ ...r, entity: 'accountContact' });
    if (source === 'parentRecordNo_invalid') {
      orphansByEntity.accountContact.push(r.rowNumber);
      continue;
    }
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
    // Phase 2c — missing sourceContactId → warning ("fallback used")
    if (!r.normalized.sourceContactId) {
      r.warnings.push({
        entity: 'accountContact',
        targetKey: 'sourceContactId',
        label: 'Kaynak Contact ID',
        code: 'missing_source_id_fallback',
        message: 'Kalıcı kaynak ID yok; güncelleme için e-posta/telefon/ad fallback kullanılacak.',
      });
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
  // Phase 2c — dup sourceAddressId within sheet (error)
  flagDuplicateSourceIds('accountAddress', 'sourceAddressId', 'Kaynak Address ID');
  for (const r of normalizedByEntity.accountAddress ?? []) {
    if (r.errors.length > 0) continue;
    // Import-friendly: blank line1 → satırı tamamen skip et, Account'a
    // dokunma. (DB'de line1 NOT NULL; null ile fake adres oluşturmuyoruz.)
    if (!r.normalized.line1) {
      r.warnings.push({
        entity: 'accountAddress',
        targetKey: 'line1',
        label: 'Sokak/Cadde',
        code: 'address_line1_missing_skipped',
        message: 'Adres satırında Sokak/Cadde boş olduğu için adres oluşturulmadı. Müşteri kaydı etkilenmedi.',
      });
      r.shouldSkip = true;
      continue;
    }
    const { parent, source } = resolveParentForChild({ ...r, entity: 'accountAddress' });
    if (source === 'parentRecordNo_invalid') {
      orphansByEntity.accountAddress.push(r.rowNumber);
      continue;
    }
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
    if (!r.normalized.sourceAddressId) {
      r.warnings.push({
        entity: 'accountAddress',
        targetKey: 'sourceAddressId',
        label: 'Kaynak Address ID',
        code: 'missing_source_id_fallback',
        message: 'Kalıcı kaynak ID yok; güncelleme için tür+etiket+adres fallback kullanılacak.',
      });
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
  // Phase 2c — dup sourceProjectId within sheet (error)
  flagDuplicateSourceIds('accountProject', 'sourceProjectId', 'Kaynak Proje ID');
  for (const r of normalizedByEntity.accountProject ?? []) {
    if (r.errors.length > 0) continue;
    // Phase 2c — parentRecordNo (→ Account) first
    const parentInfo = resolveParentForChild({ ...r, entity: 'accountProject' });
    if (parentInfo.source === 'parentRecordNo_invalid') {
      orphansByEntity.accountProject.push(r.rowNumber);
      continue;
    }
    const parentAccount = parentInfo.parent;
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
    // Phase 2c — parentCompanyRecordNo (→ AccountCompany) before fallback
    if (r.normalized.parentCompanyRecordNo) {
      const parentCompany = resolveAccountCompanyByParentCompanyRecordNo(r.normalized.parentCompanyRecordNo);
      if (parentCompany) {
        if (!r.normalized.accountCompanyKey) {
          r.normalized.accountCompanyKey = parentCompany.normalized.companyCode ?? null;
        }
      } else {
        r.errors.push({
          entity: 'accountProject',
          targetKey: 'parentCompanyRecordNo',
          label: 'Üst Şirket Kayıt No (AccountCompany)',
          code: 'parent_company_record_no_not_found',
          message: `parentCompanyRecordNo="${r.normalized.parentCompanyRecordNo}" Companies sheet içinde bulunamadı.`,
        });
        orphansByEntity.accountProject.push(r.rowNumber);
        continue;
      }
    }
    if (!r.normalized.sourceProjectId) {
      r.warnings.push({
        entity: 'accountProject',
        targetKey: 'sourceProjectId',
        label: 'Kaynak Proje ID',
        code: 'missing_source_id_fallback',
        message: 'Kalıcı kaynak ID yok; güncelleme için proje adı/kodu fallback kullanılacak.',
      });
    }
    // WR-A8 Phase 2a review fix — Selected-company guard for project's
    // accountCompanyKey, mirroring accountCompany.companyCode rule:
    //   • boş → selected company'ye otomatik bind
    //   • dolu ve seçili şirket → OK (resolve aşağıdaki indekste)
    //   • dolu ve farklı şirket → mismatch error
    if (!r.normalized.accountCompanyKey) {
      r.normalized.accountCompanyKey = companyId;
      r.warnings.push({
        entity: 'accountProject',
        targetKey: 'accountCompanyKey',
        label: 'Şirket İlişki Anahtarı',
        code: 'auto_bound_to_selected_company',
        message: `Şirket ilişki anahtarı belirtilmedi; seçili şirkete (${companyId}) bağlandı.`,
      });
    } else if (r.normalized.accountCompanyKey !== companyId) {
      // WR-A8 Phase 2a review fix — selected-company mismatch is a POLICY
      // violation, not an orphan-resolution failure. Do NOT add to
      // orphansByEntity (which feeds UI orphan counts + RelationshipGraph
      // badges); error itself is enough to mark the row invalid.
      r.errors.push({
        entity: 'accountProject',
        targetKey: 'accountCompanyKey',
        label: 'Şirket İlişki Anahtarı',
        code: 'account_company_selected_company_mismatch',
        message: 'Proje satırı seçili şirketten farklı bir şirkete işaret ediyor. Aktarım yalnızca seçili şirkete yapılabilir.',
      });
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
      } else if (r.shouldSkip) {
        // Row deliberately skipped (e.g., address with blank line1).
        // Commit engine honors action==='skip' → no DB write.
        r.action = 'skip';
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
  let missingTaxIdCount = 0; // account rows lacking VKN; surfaced in summary.
  for (const ek of entityKeys) {
    const rows = normalizedByEntity[ek] ?? [];
    const summary = { total: 0, create: 0, update: 0, skip: 0, error: 0, warning: 0 };
    for (const r of rows) {
      summary.total += 1;
      summary[r.action] = (summary[r.action] ?? 0) + 1;
      if (r.warnings.length > 0) summary.warning += 1;
      // Only count rows that will actually be inserted/updated without a
      // tax id; rows that error out for other reasons won't reach the DB.
      // missingTaxIdCount accounts for BOTH truly missing (no_tax_id) and
      // invalid-and-dropped (invalid_vkn_ignored) VKN rows. Both reach the
      // DB without an official identifier, so they share the "create
      // without tax id" counter for UI surfacing.
      if (
        ek === 'account' &&
        r.action !== 'error' &&
        r.warnings?.some((w) => w.code === 'no_tax_id' || w.code === 'invalid_vkn_ignored')
      ) {
        missingTaxIdCount += 1;
      }
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

  // Note on `commitAvailable`: this engine returns a conservative default
  // (false). The route layer (server/routes/imports.js
  // POST /customer360/dry-run) computes the operator-facing
  // `commitAvailable` by re-evaluating ok + no blocking code + schema
  // version, and overrides this field. Keep this default false here so
  // any direct (non-routed) caller is safe-by-default.
  const messageForCommitReadiness = mappingHasError
    ? 'Commit için dry-run hataları giderilmeli.'
    : 'Dry-run tamamlandı. Uygun satırlar commit için hazır.';
  return {
    ok: !mappingHasError,
    commitAvailable: false,
    message: messageForCommitReadiness,
    customer360SchemaVersion: CUSTOMER_360_VERSION,
    mappingValidation,
    summary: {
      totalRows,
      totalErrors,
      totalWarnings,
      // Account rows lacking VKN — operator sees how many customers will
      // be created without an official tax id. TCKN ingestion is
      // privacy-blocked separately via detectTcknHeader.
      missingTaxIdCount,
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
