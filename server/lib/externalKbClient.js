import { prisma } from '../db/client.js';

/**
 * WR-KB3 — External KB / AI service proxy client (server-side only).
 *
 * Tasarım kuralları:
 *  - API key raw değeri SADECE bu modülde `process.env[apiKeySecretName]`
 *    lookup'ı ile resolve edilir; frontend'e veya log'lara DÖKÜLMEZ.
 *  - Dış response'u olabildiğince ham (raw) döner; sadece UI tutarlılığı için
 *    `{ ok, endpoint, rawSource, data, meta }` zarfı kullanılır.
 *  - Hiçbir external response Case alanlarına map'lenmez (root_cause_id,
 *    category_id, suggestedSteps vb. agent UI'ya AYNEN ulaşır; backend
 *    yorumlamaz).
 *  - AIUsageLog YAZMAZ. CaseActivity oluşturmaz. Hiçbir DB satırı mutate edilmez.
 *  - Timeout & error handling: external API down/timeout/HTTP-error → wrapped
 *    `{ ok: false, error: { code, message, status } }` döner. BFF route bunu
 *    200 ile geri verir (UI proxied error olarak görür) ya da repository
 *    layer kullanıcıya 502'yi tercih ederse. Burada: route 200 + ok:false döner.
 */

const RAW_SOURCE = 'enroute-kb';

export class ExternalKbDisabledError extends Error {
  constructor(message = 'Dış Bilgi Bankası bu şirkette aktif değil.') {
    super(message);
    this.status = 400;
    this.code = 'external_kb_disabled';
  }
}

export class ExternalKbConfigError extends Error {
  constructor(message, { code = 'external_kb_config_error', status = 400 } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class ExternalKbForbiddenError extends Error {
  constructor(message = 'Bu şirkete dış Bilgi Bankası erişim yetkin yok.') {
    super(message);
    this.status = 403;
    this.code = 'external_kb_forbidden';
  }
}

/**
 * Şirket için aktif setting'i yükle. Disabled veya satır yoksa
 * ExternalKbDisabledError. baseUrl boşsa config error.
 */
export async function loadEnabledSetting(companyId) {
  const row = await prisma.externalKbSetting.findUnique({ where: { companyId } });
  if (!row || !row.enabled) {
    throw new ExternalKbDisabledError();
  }
  if (!row.baseUrl) {
    throw new ExternalKbConfigError(
      'baseUrl tanımlı değil.',
      { code: 'external_kb_base_url_missing' },
    );
  }
  return row;
}

/**
 * Role-based access check. UserCompany.role ve setting.allow* flag'lerini
 * birleştirir. Admin/SystemAdmin her zaman geçer (config sahibi).
 *
 * @param {{ role: string, companyRoles?: Array<{companyId:string, role:string}> }} user
 * @param {string} companyId
 * @param {{ allowAgentUse: boolean, allowSupervisorUse: boolean, allowCsmUse: boolean }} setting
 */
export function assertRoleAllowed(user, companyId, setting) {
  // SystemAdmin sistem rolü her şirkete tam yetkiyle bağlı.
  if (user.role === 'SystemAdmin') return;

  const link = user.companyRoles?.find((r) => r.companyId === companyId);
  if (!link) {
    throw new ExternalKbForbiddenError();
  }

  // Per-company Admin: setting sahibi → her zaman erişebilir.
  if (link.role === 'Admin' || link.role === 'SystemAdmin') return;

  // Sistem rolü Agent / Backoffice → allowAgentUse
  // Supervisor → allowSupervisorUse
  // CSM → allowCsmUse
  const sys = user.role;
  if ((sys === 'Agent' || sys === 'Backoffice') && !setting.allowAgentUse) {
    throw new ExternalKbForbiddenError('Bu şirkette Agent rolü için dış Bilgi Bankası kapalı.');
  }
  if (sys === 'Supervisor' && !setting.allowSupervisorUse) {
    throw new ExternalKbForbiddenError('Bu şirkette Supervisor rolü için dış Bilgi Bankası kapalı.');
  }
  if (sys === 'CSM' && !setting.allowCsmUse) {
    throw new ExternalKbForbiddenError('Bu şirkette CSM rolü için dış Bilgi Bankası kapalı.');
  }
}

/**
 * Resolve env secret. Raw değeri yalnız bu fonksiyondan çıkar; logger'a veya
 * response'a sızdırılmaz.
 */
function resolveSecret(setting) {
  if (setting.authType === 'none') return null;
  const name = setting.apiKeySecretName;
  if (!name) {
    throw new ExternalKbConfigError(
      'apiKeySecretName tanımlı değil.',
      { code: 'external_kb_secret_name_missing' },
    );
  }
  const value = process.env[name];
  if (!value) {
    throw new ExternalKbConfigError(
      `Environment secret "${name}" tanımlı değil.`,
      { code: 'external_kb_secret_missing' },
    );
  }
  return value;
}

function buildAuthHeader(setting) {
  if (setting.authType === 'none') return null;
  const secret = resolveSecret(setting);
  if (setting.authType === 'apiKey') return { 'X-API-Key': secret };
  if (setting.authType === 'bearerToken') return { Authorization: `Bearer ${secret}` };
  throw new ExternalKbConfigError(
    `Desteklenmeyen authType "${setting.authType}".`,
    { code: 'external_kb_unsupported_auth' },
  );
}

function joinUrl(base, path) {
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedPath = String(path || '').replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}

/**
 * Düşük seviye proxy. Method + path + body alır; external API'yi çağırır;
 * wrapped response döner. Hiçbir DB write yapmaz.
 *
 * NOT: External response 200 olsa bile içeriğini parse edip uyumlu olup
 * olmadığına bakmaz — raw data UI'a iletilir.
 */
export async function proxy({ setting, endpoint, method, path, body }) {
  const url = joinUrl(setting.baseUrl, path);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    // ngrok ücretsiz tier'da reverse-proxy "warning" sayfası dönmesini
    // engeller. Production KB host'unda harmless: bilinmeyen header
    // server tarafından ignore edilir.
    'ngrok-skip-browser-warning': '1',
  };
  const authHeader = buildAuthHeader(setting);
  if (authHeader) Object.assign(headers, authHeader);

  const controller = new AbortController();
  // Default fallback — setting.timeoutMs eksikse 120sn (analyze ~180sn,
  // categorize-v2 ~60sn). Eski 30sn default analyze çağrılarını
  // her zaman timeout'a düşürüyordu. Bkz. externalKbSettingRepository
  // defaults; bu sadece setting null/undefined kaldığında etkili.
  const timeoutMs = Number.isFinite(setting.timeoutMs) ? setting.timeoutMs : 120000;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  const proxiedAt = new Date().toISOString();
  const t0 = Date.now();

  try {
    const init = {
      method,
      headers,
      signal: controller.signal,
    };
    if (body !== undefined && method !== 'GET') {
      init.body = JSON.stringify(body);
    }
    const resp = await fetch(url, init);
    const latencyMs = Date.now() - t0;
    let data = null;
    const text = await resp.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // Non-JSON response → keep raw text
        data = { _rawText: text };
      }
    }

    if (!resp.ok) {
      return {
        ok: false,
        endpoint,
        rawSource: RAW_SOURCE,
        error: {
          code: 'external_kb_http_error',
          message: `Dış API HTTP ${resp.status}`,
          status: resp.status,
        },
        data,
        meta: { proxiedAt, latencyMs },
      };
    }

    return {
      ok: true,
      endpoint,
      rawSource: RAW_SOURCE,
      data,
      meta: { proxiedAt, latencyMs },
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const isAbort = err?.name === 'AbortError';
    return {
      ok: false,
      endpoint,
      rawSource: RAW_SOURCE,
      error: {
        code: isAbort ? 'external_kb_timeout' : 'external_kb_network_error',
        message: isAbort
          ? `Dış API zaman aşımı (${timeoutMs} ms).`
          : (err?.message ?? 'Dış API erişilemedi.'),
        status: null,
      },
      meta: { proxiedAt, latencyMs },
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/** High-level helpers used by routes — `endpoint` is the symbolic label. */
export const externalKbClient = {
  async health(setting) {
    return proxy({
      setting,
      endpoint: 'health',
      method: 'GET',
      path: setting.healthEndpointPath,
    });
  },
  async stats(setting) {
    return proxy({
      setting,
      endpoint: 'stats',
      method: 'GET',
      path: setting.statsEndpointPath,
    });
  },
  async ask(setting, body) {
    return proxy({
      setting,
      endpoint: 'ask',
      method: 'POST',
      path: setting.askEndpointPath,
      body,
    });
  },
  async search(setting, body) {
    return proxy({
      setting,
      endpoint: 'search',
      method: 'POST',
      path: setting.searchEndpointPath,
      body,
    });
  },
  async categorize(setting, body) {
    return proxy({
      setting,
      endpoint: 'categorize',
      method: 'POST',
      path: setting.categorizeEndpointPath,
      body,
    });
  },
  /**
   * WR-KB-v2 doc §6 — 6-alan açılış sınıflandırma (urun/platform/is_sureci/
   * islem_tipi/etkilenen_nesne/etki). KB kullanmaz, ~60sn. Smart Ticket
   * "KB ile Analiz Et" tercih edilen uç.
   */
  async categorizeV2(setting, body) {
    return proxy({
      setting,
      endpoint: 'categorize-v2',
      method: 'POST',
      path: setting.categorizeV2EndpointPath || '/api/v1/categorize-v2',
      body,
    });
  },
  /**
   * WR-KB-v2 doc §7 — 4-alan kapanış önerisi (kok_neden_grubu/
   * kok_neden_detayi/cozum_tipi/kalici_onlem). Stage 3 closure'da
   * opsiyonel "AI Önerisi" buton tetikler.
   */
  async suggestClose(setting, body) {
    return proxy({
      setting,
      endpoint: 'suggest-close',
      method: 'POST',
      path: setting.suggestCloseEndpointPath || '/api/v1/suggest-close',
      body,
    });
  },
  async analyze(setting, body) {
    return proxy({
      setting,
      endpoint: 'analyze',
      method: 'POST',
      path: setting.analyzeEndpointPath,
      body,
    });
  },
};
