/**
 * Mail M5-extension (K1) — Per-company FromAlias repository.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 4.4.
 *
 * Sorumluluk:
 *  - list(companyId)           — admin yönetimi + composer dropdown
 *  - listActive(companyId)     — sadece aktif; composer lookup endpoint
 *  - upsert(companyId, draft)  — admin CRUD; setDefault otomatik
 *    handle (yeni default → diğerlerinin default false)
 *  - remove(companyId, id)     — admin sil
 *  - setDefault(companyId, id) — explicit default değişimi
 *  - findByAddress(companyId, address)
 *  - validateOutboundFrom(companyId, address) — gönderim öncesi
 *    helper. Composer'ın seçtiği "from" o şirketin aktif alias'larından
 *    biri olmalı (spoof önleme).
 *
 * REUSE: prisma client. Admin route'lar assertCompanyAdmin uygular;
 * repo sadece companyId-scoped işlem yapar.
 *
 * Normalize: address app-layer trim. Karşılaştırma trim + lowercase
 * (case-insensitive). Persistence ham trim edilmiş hali saklanır
 * (display korunsun).
 */

import { prisma } from './client.js';

const MAX_ADDRESS_LEN = 320; // RFC 5321 envelope; schema NVarChar(450)

export function normalizeAddress(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.length > MAX_ADDRESS_LEN) return null;
  return s;
}

function compareKey(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    externalMailSettingId: row.externalMailSettingId,
    address: row.address,
    displayName: row.displayName,
    isDefault: row.isDefault,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function list(companyId) {
  if (!companyId) return [];
  const rows = await prisma.externalMailSettingFromAlias.findMany({
    where: { companyId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(shape);
}

async function listActive(companyId) {
  if (!companyId) return [];
  const rows = await prisma.externalMailSettingFromAlias.findMany({
    where: { companyId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(shape);
}

async function findById(companyId, id) {
  if (!companyId || !id) return null;
  const row = await prisma.externalMailSettingFromAlias.findUnique({ where: { id } });
  if (!row || row.companyId !== companyId) return null;
  return shape(row);
}

async function findByAddress(companyId, address) {
  if (!companyId) return null;
  const norm = normalizeAddress(address);
  if (!norm) return null;
  const row = await prisma.externalMailSettingFromAlias.findUnique({
    where: { companyId_address: { companyId, address: norm } },
  });
  return shape(row);
}

/**
 * Composer/sender VALIDATION — agent'ın seçtiği From o şirketin AKTİF
 * alias'larından biri olmalı.
 *
 * @returns {Promise<{ ok: true, alias: object } | { ok: false, code: string }>}
 */
async function validateOutboundFrom(companyId, address) {
  if (!companyId) return { ok: false, code: 'company_missing' };
  const norm = normalizeAddress(address);
  if (!norm) return { ok: false, code: 'address_invalid' };
  const targetKey = compareKey(norm);
  const rows = await prisma.externalMailSettingFromAlias.findMany({
    where: { companyId, isActive: true },
    select: { id: true, address: true, displayName: true, isDefault: true },
  });
  const match = rows.find((r) => compareKey(r.address) === targetKey);
  if (!match) return { ok: false, code: 'address_not_allowed' };
  return { ok: true, alias: match };
}

/**
 * Admin CRUD upsert.
 *
 * @param {string} companyId
 * @param {Object} draft - { id? (varsa update), address, displayName?, isDefault?, isActive?, sortOrder?, externalMailSettingId? }
 * @param {string|null} actorUserId
 * @returns {Promise<{ ok: true, alias: object } | { ok: false, code: string }>}
 */
async function upsert(companyId, draft, actorUserId = null) {
  if (!companyId) return { ok: false, code: 'company_missing' };
  if (!draft || typeof draft !== 'object') return { ok: false, code: 'draft_missing' };

  // Codex review fix — address zorunluluğu YALNIZ create'te.
  // Update (toggle isActive vb. partial) için draft.address yoksa mevcut
  // satırın address'ini koru. Önceden upsert tüm güncellemelerde
  // address_invalid atıyordu → admin UI'da aktif/pasif toggle 400 alıyordu.
  const isUpdate = !!draft.id;
  let address = null;
  if (draft.address !== undefined && draft.address !== null) {
    address = normalizeAddress(draft.address);
    if (!address) return { ok: false, code: 'address_invalid' };
  } else if (!isUpdate) {
    // Create + address yok → invalid.
    return { ok: false, code: 'address_invalid' };
  }
  const displayName = draft.displayName !== undefined
    ? (typeof draft.displayName === 'string' ? draft.displayName.trim() || null : null)
    : undefined; // undefined → değişiklik yok
  const isActive = draft.isActive !== undefined ? !!draft.isActive : undefined;
  const isDefault = draft.isDefault !== undefined ? !!draft.isDefault : undefined;
  const sortOrder = draft.sortOrder !== undefined && Number.isFinite(draft.sortOrder)
    ? Math.max(0, Math.floor(draft.sortOrder))
    : undefined;

  // setting FK — varsa o tenant'ın ExternalMailSetting'i ile eşleşmeli.
  let externalMailSettingId; // undefined → değişiklik yok
  if (draft.externalMailSettingId !== undefined) {
    if (typeof draft.externalMailSettingId === 'string' && draft.externalMailSettingId) {
      const ems = await prisma.externalMailSetting.findUnique({
        where: { id: draft.externalMailSettingId },
        select: { companyId: true },
      });
      if (!ems || ems.companyId !== companyId) return { ok: false, code: 'setting_scope_mismatch' };
      externalMailSettingId = draft.externalMailSettingId;
    } else {
      externalMailSettingId = null;
    }
  }

  // setDefault otomatiği — yeni satır default true ise diğerlerini false yap
  // (atomic transaction içinde). Update durumunda da geçerli.
  const result = await prisma.$transaction(async (tx) => {
    // upsert için ya id ile update ya address ile create.
    let row;
    if (isUpdate) {
      const existing = await tx.externalMailSettingFromAlias.findUnique({ where: { id: draft.id } });
      if (!existing || existing.companyId !== companyId) {
        return { ok: false, code: 'not_found' };
      }
      // Partial update — sadece açıkça verilen alanları yaz.
      const updateData = { updatedByUserId: actorUserId };
      if (address !== null) updateData.address = address;
      if (displayName !== undefined) updateData.displayName = displayName;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (isDefault !== undefined) updateData.isDefault = isDefault;
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
      if (externalMailSettingId !== undefined) updateData.externalMailSettingId = externalMailSettingId;
      row = await tx.externalMailSettingFromAlias.update({
        where: { id: draft.id },
        data: updateData,
      });
    } else {
      // address unique scope: companyId + address.
      const existing = await tx.externalMailSettingFromAlias.findUnique({
        where: { companyId_address: { companyId, address } },
      });
      if (existing) {
        return { ok: false, code: 'address_already_exists' };
      }
      row = await tx.externalMailSettingFromAlias.create({
        data: {
          companyId,
          address,
          displayName: displayName ?? null,
          isActive: isActive !== undefined ? isActive : true,
          isDefault: isDefault !== undefined ? isDefault : false,
          sortOrder: sortOrder ?? 100,
          externalMailSettingId: externalMailSettingId ?? null,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        },
      });
    }

    if (isDefault) {
      await tx.externalMailSettingFromAlias.updateMany({
        where: { companyId, id: { not: row.id } },
        data: { isDefault: false },
      });
    }

    return { ok: true, alias: shape(row) };
  });
  return result;
}

async function remove(companyId, id) {
  if (!companyId || !id) return { ok: false, code: 'missing' };
  const existing = await prisma.externalMailSettingFromAlias.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) return { ok: false, code: 'not_found' };
  await prisma.externalMailSettingFromAlias.delete({ where: { id } });
  return { ok: true };
}

async function setDefault(companyId, id) {
  if (!companyId || !id) return { ok: false, code: 'missing' };
  const existing = await prisma.externalMailSettingFromAlias.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) return { ok: false, code: 'not_found' };
  if (!existing.isActive) return { ok: false, code: 'inactive' };

  await prisma.$transaction([
    prisma.externalMailSettingFromAlias.updateMany({
      where: { companyId, id: { not: id } },
      data: { isDefault: false },
    }),
    prisma.externalMailSettingFromAlias.update({
      where: { id },
      data: { isDefault: true },
    }),
  ]);
  return { ok: true };
}

export const externalMailFromAliasRepo = {
  list,
  listActive,
  findById,
  findByAddress,
  validateOutboundFrom,
  upsert,
  remove,
  setDefault,
};

export const _internal = { normalizeAddress, compareKey };
