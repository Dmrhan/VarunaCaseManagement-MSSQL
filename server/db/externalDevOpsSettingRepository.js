/**
 * DevOps Faz 2.1 — Per-tenant TFS/Azure DevOps integration repository.
 *
 * SADECE CRUD + PAT encrypt/decrypt orchestration. Hiçbir metot
 * TFS'e doğrudan çağırmaz, AIUsageLog yazmaz, CaseActivity oluşturmaz.
 *
 * KRİTİK GÜVENLİK:
 *  - SELECTABLE listesinde patCiphertext/patIv/patAuthTag YOK; bunlar
 *    yalnız internal `getDecryptedPat()` çağrısında raw select edilir,
 *    asla GET response'una konmaz.
 *  - getByCompany() çıktısında plain PAT yok — sadece `patIsSet: boolean`
 *    + `patSetAt`. UI bu iki sinyalle "PAT ayarlı ✓" durumunu render eder.
 *  - upsert() body'sinde `pat` field'ı varsa encrypt edilip persistlenir;
 *    yoksa mevcut PAT'a dokunulmaz (rotate semantiği).
 *  - Plain PAT bellekte mümkün olduğunca kısa kalır; encrypt sonrası
 *    referans bırakılmaz.
 *
 * Per-company admin gate route layer'da (`assertCompanyAdmin`) uygulanır;
 * burada `companyId` zorunluluğu defense-in-depth.
 *
 * Spec: docs/DEVOPS_INTEGRATION.md Faz 2.1.
 */

import { prisma } from './client.js';
import { AdminError } from './adminRepository.js';
import { encrypt, decrypt } from '../lib/secretCipher.js';

const TIMEOUT_MIN = 1000;
const TIMEOUT_MAX = 300000;

/**
 * GET response'una yansıyacak alanlar. PAT ciphertext/iv/authTag BURADA
 * yok — defansif. Plain PAT da yok (zaten plain saklanmıyor).
 */
const SELECTABLE_PUBLIC = {
  id: true,
  companyId: true,
  enabled: true,
  baseUrl: true,
  apiVersion: true,
  timeoutMs: true,
  // Faz 2.1 follow-up — username SECRET DEĞİL (parola/PAT şifreli; username
  // plain). GET response'unda dönebilir (UI alanını doldurabilsin).
  username: true,
  patSetAt: true,
  createdByUserId: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Satır yokken UI'a dönen default şekil. id null → "henüz upsert edilmemiş".
 * `patIsSet: false` (PAT henüz yok).
 */
function defaultShape(companyId) {
  return {
    id: null,
    companyId,
    enabled: false,
    baseUrl: null,
    apiVersion: '4.1',
    timeoutMs: 15000,
    username: null,
    patIsSet: false,
    patSetAt: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: null,
    updatedAt: null,
  };
}

function normalizeOptionalText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length === 0 ? null : t;
}

function validatePatch(patch) {
  if (patch.timeoutMs !== undefined) {
    const v = Number(patch.timeoutMs);
    if (!Number.isFinite(v) || v < TIMEOUT_MIN || v > TIMEOUT_MAX) {
      throw new AdminError(
        `timeoutMs ${TIMEOUT_MIN}-${TIMEOUT_MAX} arasında olmalı.`,
        400,
      );
    }
  }
  if (patch.baseUrl !== undefined && patch.baseUrl !== null) {
    const s = String(patch.baseUrl).trim();
    if (s && !/^https?:\/\//i.test(s)) {
      throw new AdminError('baseUrl http(s):// ile başlamalı.', 400);
    }
  }
  if (patch.pat !== undefined && patch.pat !== null) {
    if (typeof patch.pat !== 'string') {
      throw new AdminError('pat string olmalı.', 400);
    }
    const trimmed = patch.pat.trim();
    if (trimmed.length < 8) {
      throw new AdminError('PAT en az 8 karakter olmalı.', 400);
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
}

/**
 * UI / route'a dönen şekle uyarla — patSetAt'tan patIsSet türetir.
 */
function shapeForPublic(row, companyId) {
  if (!row) return defaultShape(companyId);
  return {
    id: row.id,
    companyId: row.companyId,
    enabled: row.enabled,
    baseUrl: row.baseUrl ?? null,
    apiVersion: row.apiVersion ?? null,
    timeoutMs: row.timeoutMs,
    username: row.username ?? null,
    patIsSet: row.patSetAt !== null && row.patSetAt !== undefined,
    patSetAt: row.patSetAt ?? null,
    createdByUserId: row.createdByUserId ?? null,
    updatedByUserId: row.updatedByUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const externalDevOpsSettingRepo = {
  /**
   * GET — Public şekil (PAT raw/ciphertext DÖNMEZ). Satır yoksa default.
   */
  async getByCompany(companyId) {
    if (!companyId) throw new AdminError('companyId gerekli.', 400);
    const row = await prisma.externalDevOpsSetting.findUnique({
      where: { companyId },
      select: SELECTABLE_PUBLIC,
    });
    return shapeForPublic(row, companyId);
  },

  /**
   * INTERNAL — Aktif config'i devopsClient.getConfig() için döner.
   *
   * Return:
   *   - null: satır yok → caller env fallback'a düşmeli
   *   - { enabled: false, ... }: kayıt var ama disabled → caller env'e
   *     DÜŞMEMELİ (Q2 kuralı); "DevOps entegrasyonu kapalı" semantiği
   *   - { enabled: true, baseUrl, apiVersion, timeoutMs, pat }: kullan
   *
   * `pat` plain text — yalnız bu fonksiyondan ÇIKAR ve devopsClient
   * tarafından kısa süreli auth header inşası için kullanılır; log'a
   * basılmaz, başka bir yere persistlenmez.
   *
   * patCiphertext yoksa enabled olsa bile pat=null döner (admin baseUrl
   * set etmiş ama PAT henüz set etmemiş gibi geçiş durumu).
   */
  async resolveActiveConfig(companyId) {
    if (!companyId) return null;
    const row = await prisma.externalDevOpsSetting.findUnique({
      where: { companyId },
      select: {
        enabled: true,
        baseUrl: true,
        apiVersion: true,
        timeoutMs: true,
        username: true,
        patCiphertext: true,
        patIv: true,
        patAuthTag: true,
      },
    });
    if (!row) return null;
    if (!row.enabled) {
      return { enabled: false };
    }
    let pat = null;
    if (row.patCiphertext && row.patIv && row.patAuthTag) {
      // decrypt SecretCipherError fırlatabilir; caller (devopsClient)
      // ele alır.
      pat = decrypt({
        ciphertext: row.patCiphertext,
        iv: row.patIv,
        authTag: row.patAuthTag,
      });
    }
    return {
      enabled: true,
      baseUrl: row.baseUrl ?? null,
      apiVersion: row.apiVersion ?? null,
      timeoutMs: row.timeoutMs,
      username: row.username ?? null,
      pat,
    };
  },

  /**
   * INTERNAL — Test endpoint için decrypt edilmiş PAT döner. Sadece
   * "DB'de set ettiğim PAT geçerli mi" testi için. Log'a basılmaz.
   */
  async getDecryptedPat(companyId) {
    if (!companyId) throw new AdminError('companyId gerekli.', 400);
    const row = await prisma.externalDevOpsSetting.findUnique({
      where: { companyId },
      select: { patCiphertext: true, patIv: true, patAuthTag: true },
    });
    if (!row || !row.patCiphertext || !row.patIv || !row.patAuthTag) return null;
    return decrypt({
      ciphertext: row.patCiphertext,
      iv: row.patIv,
      authTag: row.patAuthTag,
    });
  },

  /**
   * PATCH — Tek satır upsert (companyId @unique).
   *
   * `pat` body'de varsa encrypt edilip ciphertext/iv/authTag + patSetAt
   * persistlenir. Yoksa mevcut PAT'a dokunulmaz (rotate semantiği:
   * "PAT'i değiştirmek istemiyorsan body'de gönderme").
   *
   * `actorUserId` (opsiyonel) — createdByUserId/updatedByUserId stamp.
   */
  async upsert(companyId, patch = {}, actorUserId = null) {
    if (!companyId) throw new AdminError('companyId gerekli.', 400);
    validatePatch(patch);

    const data = {};
    if (patch.enabled !== undefined) data.enabled = !!patch.enabled;
    if (patch.baseUrl !== undefined) data.baseUrl = normalizeOptionalText(patch.baseUrl);
    if (patch.apiVersion !== undefined) data.apiVersion = normalizeOptionalText(patch.apiVersion);
    if (patch.timeoutMs !== undefined) data.timeoutMs = Number(patch.timeoutMs);
    // Faz 2.1 follow-up — username plain saklanır (secret değil).
    if (patch.username !== undefined) data.username = normalizeOptionalText(patch.username);

    // PAT encrypt: yalnız body'de varsa.
    if (typeof patch.pat === 'string' && patch.pat.trim().length > 0) {
      const enc = encrypt(patch.pat.trim());
      data.patCiphertext = enc.ciphertext;
      data.patIv = enc.iv;
      data.patAuthTag = enc.authTag;
      data.patSetAt = new Date();
    }

    if (actorUserId) {
      data.updatedByUserId = actorUserId;
    }

    const createData = { companyId, ...data };
    if (actorUserId && !createData.createdByUserId) {
      createData.createdByUserId = actorUserId;
    }

    const row = await prisma.externalDevOpsSetting.upsert({
      where: { companyId },
      update: data,
      create: createData,
      select: SELECTABLE_PUBLIC,
    });
    return shapeForPublic(row, companyId);
  },
};
