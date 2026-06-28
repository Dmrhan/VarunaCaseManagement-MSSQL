/**
 * Mail M5 — Per-tenant SMTP/IMAP integration repository.
 *
 * SADECE CRUD + secret encrypt/decrypt orchestration. Hiçbir metot
 * SMTP/IMAP'e doğrudan çağırmaz, AIUsageLog/CaseActivity yazmaz.
 *
 * KRİTİK GÜVENLİK (DevOps Faz 2.1 repository deseninin aynası):
 *  - SELECTABLE_PUBLIC listesinde secretCiphertext/secretIv/secretAuthTag
 *    YOK; bunlar yalnız internal `resolveActiveConfig()` / `getDecryptedSecret()`
 *    çağrılarında raw select edilir, asla GET response'una konmaz.
 *  - getByCompany() çıktısında plain secret yok — sadece `secretIsSet: boolean`
 *    + `secretSetAt`. UI bu iki sinyalle "Secret ayarlı ✓" durumunu render eder.
 *  - upsert() body'sinde `secret` field'ı varsa encrypt edilip persistlenir;
 *    yoksa mevcut secret'a dokunulmaz (rotate semantiği).
 *  - Plain secret bellekte mümkün olduğunca kısa kalır; encrypt sonrası
 *    referans bırakılmaz.
 *
 * Per-company admin gate route layer'da (`assertCompanyAdmin`) uygulanır;
 * burada `companyId` zorunluluğu defense-in-depth.
 *
 * REUSE notu (yeni model/cipher yazılmadı):
 *  - server/db/externalDevOpsSettingRepository.js (desen aynası)
 *  - server/lib/secretCipher.js (AES-256-GCM; DEVOPS_PAT_ENC_KEY env reuse —
 *    DevOps PAT için doğdu, M5'te mail secret'larını da bu key şifreliyor)
 */

import { prisma } from './client.js';
import { AdminError } from './adminRepository.js';
import { encrypt, decrypt } from '../lib/secretCipher.js';

const VALID_AUTH_MODES = new Set(['password', 'oauth2']);
const PORT_MIN = 1;
const PORT_MAX = 65535;

/**
 * GET response'una yansıyacak alanlar. Secret ciphertext/iv/authTag
 * BURADA YOK — defansif. Plain secret zaten plain saklanmıyor.
 */
const SELECTABLE_PUBLIC = {
  id: true,
  companyId: true,
  enabled: true,
  fromAddress: true,
  inboundAddress: true,
  smtpHost: true,
  smtpPort: true,
  smtpSecure: true,
  imapHost: true,
  imapPort: true,
  authMode: true,
  // username SECRET DEĞİL (secret şifreli; username plain).
  username: true,
  // Compose-Signature F2 — şirket imza şablonu (placeholder'lı HTML).
  // Composer ve dispatch render anında {{agent.name}} + {{agent.title}}
  // Mustache placeholder'larıyla User → Person üzerinden interpolate edilir.
  signatureHtml: true,
  secretSetAt: true,
  createdByUserId: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Satır yokken UI'a dönen default şekil. id null → "henüz upsert edilmemiş".
 * `secretIsSet: false` (secret henüz yok).
 */
function defaultShape(companyId) {
  return {
    id: null,
    companyId,
    enabled: false,
    fromAddress: null,
    inboundAddress: null,
    smtpHost: null,
    smtpPort: 587,
    smtpSecure: false,
    imapHost: null,
    imapPort: 993,
    authMode: 'password',
    username: null,
    signatureHtml: null,
    secretIsSet: false,
    secretSetAt: null,
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
  if (patch.authMode !== undefined && patch.authMode !== null) {
    if (!VALID_AUTH_MODES.has(String(patch.authMode))) {
      throw new AdminError(
        `authMode geçersiz (${Array.from(VALID_AUTH_MODES).join('|')}).`,
        400,
      );
    }
  }
  for (const portField of ['smtpPort', 'imapPort']) {
    if (patch[portField] !== undefined && patch[portField] !== null) {
      const v = Number(patch[portField]);
      if (!Number.isInteger(v) || v < PORT_MIN || v > PORT_MAX) {
        throw new AdminError(
          `${portField} ${PORT_MIN}-${PORT_MAX} arasında integer olmalı.`,
          400,
        );
      }
    }
  }
  if (patch.fromAddress !== undefined && patch.fromAddress !== null) {
    if (typeof patch.fromAddress !== 'string') {
      throw new AdminError('fromAddress string olmalı.', 400);
    }
    if (patch.fromAddress.length > 320) {
      throw new AdminError('fromAddress en fazla 320 karakter olabilir.', 400);
    }
  }
  if (patch.inboundAddress !== undefined && patch.inboundAddress !== null) {
    if (typeof patch.inboundAddress !== 'string') {
      throw new AdminError('inboundAddress string olmalı.', 400);
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
  // Compose-Signature F2 — signatureHtml validation
  if (patch.signatureHtml !== undefined && patch.signatureHtml !== null) {
    if (typeof patch.signatureHtml !== 'string') {
      throw new AdminError('signatureHtml string olmalı.', 400);
    }
    // Defansif üst sınır — mail provider'lar HTML body için tipik 100KB
    // bant; imza tek başına bunun küçük bir parçası olmalı.
    if (patch.signatureHtml.length > 50_000) {
      throw new AdminError('signatureHtml en fazla 50.000 karakter olabilir.', 400);
    }
  }
}

/**
 * UI / route'a dönen şekle uyarla — secretSetAt'tan secretIsSet türetir.
 */
function shapeForPublic(row, companyId) {
  if (!row) return defaultShape(companyId);
  return {
    id: row.id,
    companyId: row.companyId,
    enabled: row.enabled,
    fromAddress: row.fromAddress ?? null,
    inboundAddress: row.inboundAddress ?? null,
    smtpHost: row.smtpHost ?? null,
    smtpPort: row.smtpPort ?? null,
    smtpSecure: row.smtpSecure ?? false,
    imapHost: row.imapHost ?? null,
    imapPort: row.imapPort ?? null,
    authMode: row.authMode ?? 'password',
    username: row.username ?? null,
    signatureHtml: row.signatureHtml ?? null,
    secretIsSet: row.secretSetAt !== null && row.secretSetAt !== undefined,
    secretSetAt: row.secretSetAt ?? null,
    createdByUserId: row.createdByUserId ?? null,
    updatedByUserId: row.updatedByUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const externalMailSettingRepo = {
  /**
   * GET — Public şekil (secret raw/ciphertext DÖNMEZ). Satır yoksa default.
   */
  async getByCompany(companyId) {
    if (!companyId) throw new AdminError('companyId gerekli.', 400);
    const row = await prisma.externalMailSetting.findUnique({
      where: { companyId },
      select: SELECTABLE_PUBLIC,
    });
    return shapeForPublic(row, companyId);
  },

  /**
   * INTERNAL — Aktif config'i mailProvider.sendMail() için döner.
   *
   * Return:
   *   - null: satır yok → caller env fallback'a düşmeli (M1 backward-compat)
   *   - { enabled: false, ... }: kayıt var ama disabled → caller env'e
   *     DÜŞMEMELİ (DevOps deseninin aynısı); "Mail entegrasyonu kapalı"
   *   - { enabled: true, ... }: kullan; secret decrypt edilir
   *
   * `secret` plain text — yalnız bu fonksiyondan ÇIKAR ve mailProvider
   * tarafından kısa süreli auth için kullanılır; log'a basılmaz,
   * başka bir yere persistlenmez.
   *
   * secretCiphertext yoksa enabled olsa bile secret=null döner (admin host
   * set etmiş ama secret henüz set etmemiş gibi geçiş durumu).
   */
  async resolveActiveConfig(companyId) {
    if (!companyId) return null;
    const row = await prisma.externalMailSetting.findUnique({
      where: { companyId },
      select: {
        enabled: true,
        fromAddress: true,
        inboundAddress: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        imapHost: true,
        imapPort: true,
        authMode: true,
        username: true,
        secretCiphertext: true,
        secretIv: true,
        secretAuthTag: true,
      },
    });
    if (!row) return null;
    if (!row.enabled) {
      return { enabled: false };
    }
    let secret = null;
    if (row.secretCiphertext && row.secretIv && row.secretAuthTag) {
      // decrypt SecretCipherError fırlatabilir; caller (mailProvider) ele alır.
      secret = decrypt({
        ciphertext: row.secretCiphertext,
        iv: row.secretIv,
        authTag: row.secretAuthTag,
      });
    }
    return {
      enabled: true,
      fromAddress: row.fromAddress ?? null,
      inboundAddress: row.inboundAddress ?? null,
      smtpHost: row.smtpHost ?? null,
      smtpPort: row.smtpPort ?? null,
      smtpSecure: row.smtpSecure ?? false,
      imapHost: row.imapHost ?? null,
      imapPort: row.imapPort ?? null,
      authMode: row.authMode ?? 'password',
      username: row.username ?? null,
      secret,
    };
  },

  /**
   * INTERNAL — Test endpoint için decrypt edilmiş secret döner. Sadece
   * "DB'de set ettiğim secret geçerli mi" testi için. Log'a basılmaz.
   */
  async getDecryptedSecret(companyId) {
    if (!companyId) throw new AdminError('companyId gerekli.', 400);
    const row = await prisma.externalMailSetting.findUnique({
      where: { companyId },
      select: { secretCiphertext: true, secretIv: true, secretAuthTag: true },
    });
    if (!row || !row.secretCiphertext || !row.secretIv || !row.secretAuthTag) return null;
    return decrypt({
      ciphertext: row.secretCiphertext,
      iv: row.secretIv,
      authTag: row.secretAuthTag,
    });
  },

  /**
   * PATCH — Tek satır upsert (companyId @unique).
   *
   * `secret` body'de varsa encrypt edilip ciphertext/iv/authTag + secretSetAt
   * persistlenir. Yoksa mevcut secret'a dokunulmaz (rotate semantiği).
   *
   * `actorUserId` (opsiyonel) — createdByUserId/updatedByUserId stamp.
   */
  async upsert(companyId, patch = {}, actorUserId = null) {
    if (!companyId) throw new AdminError('companyId gerekli.', 400);
    validatePatch(patch);

    const data = {};
    if (patch.enabled !== undefined) data.enabled = !!patch.enabled;
    if (patch.fromAddress !== undefined) data.fromAddress = normalizeOptionalText(patch.fromAddress);
    if (patch.inboundAddress !== undefined) data.inboundAddress = normalizeOptionalText(patch.inboundAddress);
    if (patch.smtpHost !== undefined) data.smtpHost = normalizeOptionalText(patch.smtpHost);
    if (patch.smtpPort !== undefined) data.smtpPort = patch.smtpPort === null ? null : Number(patch.smtpPort);
    if (patch.smtpSecure !== undefined) data.smtpSecure = !!patch.smtpSecure;
    if (patch.imapHost !== undefined) data.imapHost = normalizeOptionalText(patch.imapHost);
    if (patch.imapPort !== undefined) data.imapPort = patch.imapPort === null ? null : Number(patch.imapPort);
    if (patch.authMode !== undefined) data.authMode = String(patch.authMode);
    if (patch.username !== undefined) data.username = normalizeOptionalText(patch.username);

    // Compose-Signature F2 — şirket imza şablonu.
    // sanitize-html M6.1 allowlist save öncesi (XSS koruma; admin akışı
    // M6.3b CaseEmailTemplate ile aynı pattern).
    if (patch.signatureHtml !== undefined) {
      if (patch.signatureHtml === null || patch.signatureHtml === '') {
        data.signatureHtml = null;
      } else {
        const { sanitizeOutgoingEmailHtml } = await import('../lib/htmlSanitizer.js');
        data.signatureHtml = sanitizeOutgoingEmailHtml(patch.signatureHtml);
      }
    }

    // Secret encrypt: yalnız body'de varsa.
    if (typeof patch.secret === 'string' && patch.secret.trim().length > 0) {
      const enc = encrypt(patch.secret.trim());
      data.secretCiphertext = enc.ciphertext;
      data.secretIv = enc.iv;
      data.secretAuthTag = enc.authTag;
      data.secretSetAt = new Date();
    }

    if (actorUserId) {
      data.updatedByUserId = actorUserId;
    }

    const createData = { companyId, ...data };
    if (actorUserId && !createData.createdByUserId) {
      createData.createdByUserId = actorUserId;
    }

    const row = await prisma.externalMailSetting.upsert({
      where: { companyId },
      update: data,
      create: createData,
      select: SELECTABLE_PUBLIC,
    });
    return shapeForPublic(row, companyId);
  },
};
