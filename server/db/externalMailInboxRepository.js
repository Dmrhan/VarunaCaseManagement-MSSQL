/**
 * Mail Multi-Inbox (Faz A) — Per-company ExternalMailInbox repository.
 *
 * İhtiyaç: Bir tenant birden fazla mail adresinden gelen vakaları AYRI
 * takımlara yönlendirebilir (örn. yazilimdestek@ → Yazılım Takımı,
 * satis@ → Satış Takımı). Her inbox AYRI IMAP hesabı (kendi credential'ı).
 *
 * Sorumluluk (FromAlias/ExternalMailSetting repo desenlerinin birleşimi):
 *   - list(companyId)              — admin yönetimi
 *   - listEnabled()                — IMAP polling (cross-tenant; tüm enabled inbox'lar)
 *   - listEnabledByCompany(id)     — admin testi / debug
 *   - findById(companyId, id)      — scope check'li detail
 *   - findByAddress(companyId, addr)
 *   - upsert(companyId, draft, actorUserId)
 *   - remove(companyId, id)
 *   - getDecryptedSecret(companyId, id) — IMAP polling için raw password
 *
 * KRİTİK GÜVENLİK:
 *   - SELECTABLE_PUBLIC listesinde secretCiphertext/Iv/AuthTag YOK.
 *     Sadece `secretIsSet: boolean` + `secretSetAt` dış API'ya gider.
 *   - Plain secret yalnız `upsert` body'sinde geçici, encrypt sonrası
 *     referans bırakılmaz.
 *   - assignedTeamId — set edilirken AYNI companyId'deki Team olmalı
 *     (cross-tenant routing engeli).
 *
 * REUSE (yeni motor yazılmadı):
 *   - server/db/externalMailSettingRepository.js (secret encrypt deseni)
 *   - server/db/externalMailFromAliasRepository.js (CRUD/scope deseni)
 *   - server/lib/secretCipher.js (AES-256-GCM, DEVOPS_PAT_ENC_KEY env reuse)
 *
 * Per-company admin gate route layer'da (`assertCompanyAdmin`) uygulanır;
 * burada `companyId` zorunluluğu defense-in-depth.
 */

import { prisma } from './client.js';
import { AdminError } from './adminRepository.js';
import { encrypt, decrypt } from '../lib/secretCipher.js';

const MAX_ADDRESS_LEN = 320; // RFC 5321 envelope; schema NVarChar(450)
const PORT_MIN = 1;
const PORT_MAX = 65535;

// Dışa açılan public select — secret raw alanları İÇERMEZ.
const SELECTABLE_PUBLIC = {
  id: true,
  companyId: true,
  address: true,
  displayName: true,
  imapHost: true,
  imapPort: true,
  imapSecure: true,
  username: true,
  secretSetAt: true, // secretIsSet = !!secretSetAt + ciphertext üzerinden türetilir
  secretCiphertext: true, // shape'te public'e dökülmez; "set mi?" sinyali için iç kullanım
  assignedTeamId: true,
  enabled: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
};

export function normalizeAddress(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.length > MAX_ADDRESS_LEN) return null;
  return s;
}

function normalizeOptionalText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length === 0 ? null : t;
}

function shapeForPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    address: row.address,
    displayName: row.displayName ?? null,
    imapHost: row.imapHost ?? null,
    imapPort: row.imapPort ?? null,
    imapSecure: row.imapSecure ?? true,
    username: row.username ?? null,
    secretIsSet: !!row.secretCiphertext,
    secretSetAt: row.secretSetAt ?? null,
    assignedTeamId: row.assignedTeamId ?? null,
    enabled: !!row.enabled,
    isActive: row.isActive !== false,
    sortOrder: row.sortOrder ?? 100,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

function validatePatch(patch, { isCreate } = { isCreate: false }) {
  if (isCreate || patch.address !== undefined) {
    const norm = normalizeAddress(patch.address);
    if (!norm) {
      throw new AdminError('address geçerli mail adresi olmalı.', 400);
    }
  }
  if (patch.displayName !== undefined && patch.displayName !== null) {
    if (typeof patch.displayName !== 'string') {
      throw new AdminError('displayName string olmalı.', 400);
    }
    if (patch.displayName.length > 200) {
      throw new AdminError('displayName en fazla 200 karakter olabilir.', 400);
    }
  }
  if (patch.imapHost !== undefined && patch.imapHost !== null) {
    if (typeof patch.imapHost !== 'string') {
      throw new AdminError('imapHost string olmalı.', 400);
    }
  }
  if (patch.imapPort !== undefined && patch.imapPort !== null) {
    const v = Number(patch.imapPort);
    if (!Number.isInteger(v) || v < PORT_MIN || v > PORT_MAX) {
      throw new AdminError(`imapPort ${PORT_MIN}-${PORT_MAX} arasında integer olmalı.`, 400);
    }
  }
  if (patch.username !== undefined && patch.username !== null) {
    if (typeof patch.username !== 'string') {
      throw new AdminError('username string olmalı.', 400);
    }
    if (patch.username.length > 256) {
      throw new AdminError('username en fazla 256 karakter olabilir.', 400);
    }
  }
  if (patch.secret !== undefined && patch.secret !== null) {
    if (typeof patch.secret !== 'string') {
      throw new AdminError('secret string olmalı.', 400);
    }
    if (patch.secret.trim().length < 4) {
      throw new AdminError('secret en az 4 karakter olmalı.', 400);
    }
  }
  if (patch.sortOrder !== undefined && patch.sortOrder !== null) {
    const v = Number(patch.sortOrder);
    if (!Number.isFinite(v) || v < 0) {
      throw new AdminError('sortOrder pozitif sayı olmalı.', 400);
    }
  }
}

/**
 * Admin liste — bir tenant'ın TÜM inbox'ları (active + soft-deleted).
 */
async function list(companyId) {
  if (!companyId) return [];
  const rows = await prisma.externalMailInbox.findMany({
    where: { companyId },
    select: SELECTABLE_PUBLIC,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(shapeForPublic);
}

/**
 * IMAP polling cross-tenant — tüm enabled + active inbox'lar.
 * pollAllEnabledMailboxes (A2) bunu okuyacak.
 */
async function listEnabled() {
  const rows = await prisma.externalMailInbox.findMany({
    where: {
      enabled: true,
      isActive: true,
      imapHost: { not: null },
    },
    select: SELECTABLE_PUBLIC,
    orderBy: [{ companyId: 'asc' }, { sortOrder: 'asc' }],
  });
  return rows.map(shapeForPublic);
}

async function listEnabledByCompany(companyId) {
  if (!companyId) return [];
  const rows = await prisma.externalMailInbox.findMany({
    where: { companyId, enabled: true, isActive: true, imapHost: { not: null } },
    select: SELECTABLE_PUBLIC,
    orderBy: [{ sortOrder: 'asc' }],
  });
  return rows.map(shapeForPublic);
}

async function findById(companyId, id) {
  if (!companyId || !id) return null;
  const row = await prisma.externalMailInbox.findUnique({
    where: { id },
    select: SELECTABLE_PUBLIC,
  });
  if (!row || row.companyId !== companyId) return null;
  return shapeForPublic(row);
}

async function findByAddress(companyId, address) {
  if (!companyId) return null;
  const norm = normalizeAddress(address);
  if (!norm) return null;
  const row = await prisma.externalMailInbox.findUnique({
    where: { companyId_address: { companyId, address: norm } },
    select: SELECTABLE_PUBLIC,
  });
  return shapeForPublic(row);
}

/**
 * IMAP polling helper — inbox.id ile raw decrypted password çek.
 *
 * @returns {Promise<string|null>}
 */
async function getDecryptedSecret(companyId, id) {
  if (!companyId || !id) return null;
  const row = await prisma.externalMailInbox.findUnique({
    where: { id },
    select: {
      companyId: true,
      secretCiphertext: true,
      secretIv: true,
      secretAuthTag: true,
    },
  });
  if (!row || row.companyId !== companyId) return null;
  if (!row.secretCiphertext || !row.secretIv || !row.secretAuthTag) return null;
  return decrypt({
    ciphertext: row.secretCiphertext,
    iv: row.secretIv,
    authTag: row.secretAuthTag,
  });
}

/**
 * Admin upsert — create veya partial update.
 *
 * @param {string} companyId
 * @param {Object} draft - { id? (varsa update), address, displayName?, imapHost?, imapPort?, imapSecure?, username?, secret?, assignedTeamId?, enabled?, isActive?, sortOrder? }
 * @param {string|null} actorUserId
 * @returns {Promise<{ ok: true, inbox: object } | { ok: false, code: string }>}
 */
async function upsert(companyId, draft, actorUserId = null) {
  if (!companyId) return { ok: false, code: 'company_missing' };
  if (!draft || typeof draft !== 'object') return { ok: false, code: 'draft_missing' };

  const isUpdate = !!draft.id;
  validatePatch(draft, { isCreate: !isUpdate });

  // assignedTeamId — set ediliyorsa AYNI companyId'deki Team olmalı.
  if (draft.assignedTeamId !== undefined && draft.assignedTeamId !== null) {
    if (typeof draft.assignedTeamId !== 'string' || !draft.assignedTeamId) {
      return { ok: false, code: 'team_id_invalid' };
    }
    const team = await prisma.team.findUnique({
      where: { id: draft.assignedTeamId },
      select: { companyId: true, isActive: true },
    });
    if (!team || team.companyId !== companyId) {
      return { ok: false, code: 'team_scope_mismatch' };
    }
    if (!team.isActive) {
      return { ok: false, code: 'team_inactive' };
    }
  }

  const data = {};
  if (draft.address !== undefined) data.address = normalizeAddress(draft.address);
  if (draft.displayName !== undefined) data.displayName = normalizeOptionalText(draft.displayName);
  if (draft.imapHost !== undefined) data.imapHost = normalizeOptionalText(draft.imapHost);
  if (draft.imapPort !== undefined) {
    data.imapPort = draft.imapPort === null ? null : Number(draft.imapPort);
  }
  if (draft.imapSecure !== undefined) data.imapSecure = !!draft.imapSecure;
  if (draft.username !== undefined) data.username = normalizeOptionalText(draft.username);
  if (draft.assignedTeamId !== undefined) {
    data.assignedTeamId = draft.assignedTeamId || null;
  }
  if (draft.enabled !== undefined) data.enabled = !!draft.enabled;
  if (draft.isActive !== undefined) data.isActive = !!draft.isActive;
  if (draft.sortOrder !== undefined && draft.sortOrder !== null) {
    data.sortOrder = Math.max(0, Math.floor(Number(draft.sortOrder)));
  }

  // Secret encrypt — yalnız body'de explicit gönderilmişse.
  if (typeof draft.secret === 'string' && draft.secret.trim().length > 0) {
    const enc = encrypt(draft.secret.trim());
    data.secretCiphertext = enc.ciphertext;
    data.secretIv = enc.iv;
    data.secretAuthTag = enc.authTag;
    data.secretSetAt = new Date();
  }

  if (actorUserId) data.updatedByUserId = actorUserId;

  if (isUpdate) {
    const existing = await prisma.externalMailInbox.findUnique({ where: { id: draft.id } });
    if (!existing || existing.companyId !== companyId) {
      return { ok: false, code: 'not_found' };
    }
    // address değişimi varsa unique kontrolü (Prisma update unique-conflict
    // throws P2002; bunu kullanıcı-friendly hata olarak çevir).
    if (data.address && data.address !== existing.address) {
      const collision = await prisma.externalMailInbox.findUnique({
        where: { companyId_address: { companyId, address: data.address } },
        select: { id: true },
      });
      if (collision && collision.id !== draft.id) {
        return { ok: false, code: 'address_already_exists' };
      }
    }
    const row = await prisma.externalMailInbox.update({
      where: { id: draft.id },
      data,
      select: SELECTABLE_PUBLIC,
    });
    return { ok: true, inbox: shapeForPublic(row) };
  }

  // Create — address zorunlu (validatePatch geçtiyse normalize edilmiştir).
  if (!data.address) return { ok: false, code: 'address_invalid' };

  const collision = await prisma.externalMailInbox.findUnique({
    where: { companyId_address: { companyId, address: data.address } },
    select: { id: true },
  });
  if (collision) return { ok: false, code: 'address_already_exists' };

  const createData = {
    companyId,
    address: data.address,
    displayName: data.displayName ?? null,
    imapHost: data.imapHost ?? null,
    imapPort: data.imapPort ?? null,
    imapSecure: data.imapSecure !== undefined ? data.imapSecure : true,
    username: data.username ?? null,
    secretCiphertext: data.secretCiphertext ?? null,
    secretIv: data.secretIv ?? null,
    secretAuthTag: data.secretAuthTag ?? null,
    secretSetAt: data.secretSetAt ?? null,
    assignedTeamId: data.assignedTeamId ?? null,
    enabled: data.enabled !== undefined ? data.enabled : false,
    isActive: data.isActive !== undefined ? data.isActive : true,
    sortOrder: data.sortOrder ?? 100,
    createdByUserId: actorUserId,
    updatedByUserId: actorUserId,
  };
  const row = await prisma.externalMailInbox.create({
    data: createData,
    select: SELECTABLE_PUBLIC,
  });
  return { ok: true, inbox: shapeForPublic(row) };
}

async function remove(companyId, id) {
  if (!companyId || !id) return { ok: false, code: 'missing' };
  const existing = await prisma.externalMailInbox.findUnique({ where: { id } });
  if (!existing || existing.companyId !== companyId) {
    return { ok: false, code: 'not_found' };
  }
  await prisma.externalMailInbox.delete({ where: { id } });
  return { ok: true };
}

export const externalMailInboxRepo = {
  list,
  listEnabled,
  listEnabledByCompany,
  findById,
  findByAddress,
  getDecryptedSecret,
  upsert,
  remove,
};

export const _internal = { normalizeAddress, normalizeOptionalText, shapeForPublic };
