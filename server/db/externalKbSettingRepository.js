import { prisma } from './client.js';
import { AdminError } from './adminRepository.js';

/**
 * WR-KB1 — Dış Bilgi Bankası entegrasyon tanımları için repository.
 *
 * SADECE CRUD. Hiçbir metot dış API çağırmaz, secret materyali OKUMAZ,
 * AIUsageLog yazmaz. Yalnız configuration tablosunu yönetir.
 *
 * Per-company admin gate route layer'da (`assertCompanyAdmin`) uygulanır;
 * burada companyId zorunluluğunu ve scope-ihlali kontrollerini de yapıyoruz
 * (defense-in-depth, route bypass durumunda).
 *
 * `apiKeySecretName` yalnız env var referans ismi (örn `EXTERNAL_KB_API_KEY`).
 * Gerçek secret deploy ortamı seviyesinde tutulur; DB'ye plain key yazılmaz.
 */

const AUTH_TYPES = new Set(['none', 'apiKey', 'bearerToken']);
const TIMEOUT_MIN = 1000;
const TIMEOUT_MAX = 60000;
const TOPK_MIN = 1;
const TOPK_MAX = 20;

const SELECTABLE = {
  id: true,
  companyId: true,
  enabled: true,
  providerName: true,
  baseUrl: true,
  askEndpointPath: true,
  searchEndpointPath: true,
  authType: true,
  apiKeySecretName: true,
  timeoutMs: true,
  defaultTopK: true,
  showCitations: true,
  allowAgentUse: true,
  allowSupervisorUse: true,
  allowCsmUse: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
};

/** Defaults for a company that has no row yet — UI shows these as initial state. */
function defaultShape(companyId) {
  return {
    id: null,
    companyId,
    enabled: false,
    providerName: null,
    baseUrl: null,
    askEndpointPath: '/ask',
    searchEndpointPath: '/search',
    authType: 'none',
    apiKeySecretName: null,
    timeoutMs: 15000,
    defaultTopK: 5,
    showCitations: true,
    allowAgentUse: true,
    allowSupervisorUse: true,
    allowCsmUse: true,
    notes: null,
    createdAt: null,
    updatedAt: null,
  };
}

function normalizeOptionalText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validatePatch(patch) {
  // authType validation
  if (patch.authType !== undefined) {
    if (!AUTH_TYPES.has(patch.authType)) {
      const err = new AdminError(
        'Geçersiz authType. Beklenen: none | apiKey | bearerToken.',
        400,
      );
      err.code = 'invalid_auth_type';
      throw err;
    }
  }

  // timeoutMs validation
  if (patch.timeoutMs !== undefined) {
    const n = Number(patch.timeoutMs);
    if (!Number.isInteger(n) || n < TIMEOUT_MIN || n > TIMEOUT_MAX) {
      const err = new AdminError(
        `timeoutMs ${TIMEOUT_MIN}-${TIMEOUT_MAX} arasında bir tamsayı olmalı.`,
        400,
      );
      err.code = 'invalid_timeout';
      throw err;
    }
  }

  // defaultTopK validation
  if (patch.defaultTopK !== undefined) {
    const n = Number(patch.defaultTopK);
    if (!Number.isInteger(n) || n < TOPK_MIN || n > TOPK_MAX) {
      const err = new AdminError(
        `defaultTopK ${TOPK_MIN}-${TOPK_MAX} arasında bir tamsayı olmalı.`,
        400,
      );
      err.code = 'invalid_top_k';
      throw err;
    }
  }
}

export const externalKbSettingRepo = {
  /**
   * GET — Şirket için ayarları döner. Satır yoksa varsayılan şekli döner
   * (id null) — UI ilk açılışta default'larla form'u doldurabilsin.
   */
  async getByCompany(companyId) {
    if (!companyId) throw new AdminError('companyId gerekli.', 400);
    const row = await prisma.externalKbSetting.findUnique({
      where: { companyId },
      select: SELECTABLE,
    });
    if (!row) return defaultShape(companyId);
    return row;
  },

  /**
   * PATCH — Tek satır upsert (companyId @unique). Tüm alanlar opsiyonel
   * payload; yalnız set edilenler patch'lenir.
   *
   * authType=apiKey|bearerToken iken apiKeySecretName boş olamaz (UI ve
   * BFF birlikte enforce eder).
   */
  async upsert(companyId, patch = {}) {
    if (!companyId) throw new AdminError('companyId gerekli.', 400);
    validatePatch(patch);

    // Effective authType ile apiKeySecretName uyumunu kontrol et.
    const existing = await prisma.externalKbSetting.findUnique({
      where: { companyId },
      select: { authType: true, apiKeySecretName: true },
    });
    const effectiveAuthType = patch.authType ?? existing?.authType ?? 'none';
    let effectiveSecretName =
      patch.apiKeySecretName !== undefined
        ? normalizeOptionalText(patch.apiKeySecretName)
        : existing?.apiKeySecretName ?? null;

    if (effectiveAuthType !== 'none' && !effectiveSecretName) {
      const err = new AdminError(
        'authType apiKey/bearerToken seçiliyse apiKeySecretName zorunlu.',
        400,
      );
      err.code = 'secret_name_required';
      throw err;
    }
    // authType=none ise secret referansını temizle (tutarlılık).
    if (effectiveAuthType === 'none') {
      effectiveSecretName = null;
    }

    // Build clean update/create data.
    const data = {};
    if (patch.enabled !== undefined) data.enabled = !!patch.enabled;
    if (patch.providerName !== undefined) data.providerName = normalizeOptionalText(patch.providerName);
    if (patch.baseUrl !== undefined) data.baseUrl = normalizeOptionalText(patch.baseUrl);
    if (patch.askEndpointPath !== undefined) data.askEndpointPath = String(patch.askEndpointPath || '/ask');
    if (patch.searchEndpointPath !== undefined) data.searchEndpointPath = String(patch.searchEndpointPath || '/search');
    if (patch.authType !== undefined) data.authType = effectiveAuthType;
    if (patch.timeoutMs !== undefined) data.timeoutMs = Number(patch.timeoutMs);
    if (patch.defaultTopK !== undefined) data.defaultTopK = Number(patch.defaultTopK);
    if (patch.showCitations !== undefined) data.showCitations = !!patch.showCitations;
    if (patch.allowAgentUse !== undefined) data.allowAgentUse = !!patch.allowAgentUse;
    if (patch.allowSupervisorUse !== undefined) data.allowSupervisorUse = !!patch.allowSupervisorUse;
    if (patch.allowCsmUse !== undefined) data.allowCsmUse = !!patch.allowCsmUse;
    if (patch.notes !== undefined) data.notes = normalizeOptionalText(patch.notes);
    // Always normalize secret name (may have been cleared above).
    data.apiKeySecretName = effectiveSecretName;
    // authType may be implicit from existing — ensure consistency on first create.
    if (!('authType' in data)) data.authType = effectiveAuthType;

    const row = await prisma.externalKbSetting.upsert({
      where: { companyId },
      update: data,
      create: { companyId, ...data },
      select: SELECTABLE,
    });
    return row;
  },
};
