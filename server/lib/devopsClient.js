/**
 * Azure DevOps / TFS REST client (server-side only).
 *
 * Spec: docs/DEVOPS_INTEGRATION.md (PR-D1).
 *
 * Tasarım kuralları:
 *  - PAT raw değeri SADECE bu modülde `process.env.TFS_PAT` lookup'ı ile
 *    resolve edilir; frontend'e veya log'lara DÖKÜLMEZ. Hata mesajlarında
 *    bile maskelidir (maskPat helper).
 *  - externalKbClient.js pattern'i izlenir: native fetch + AbortController
 *    timeout + wrapped response { ok, data/error, meta }. KB modülü
 *    DOKUNULMAZ — DevOps ayrı bir lib.
 *  - Auth: Basic + PAT. `Authorization: Basic ${base64(':' + PAT)}`.
 *  - Hiçbir DB write yapmaz. AIUsageLog/CaseActivity yazmaz. Sadece HTTP
 *    proxy + alan normalize.
 *
 * Config (.env):
 *   TFS_BASE_URL       — https://unitfs.univera.com.tr/tfs/DefaultCollection/Sirius/_apis
 *   TFS_PAT            — Personal Access Token (Basic auth secret)
 *   TFS_API_VERSION    — TFS REST api-version (default "6.0")
 *   TFS_TIMEOUT_MS     — request timeout ms (default 15000)
 *
 * MVP: tek tenant (.env). Faz 2: per-tenant DevOpsSetting model.
 */

const RAW_SOURCE = 'tfs-devops';
const DEFAULT_TIMEOUT_MS = 15000;
// On-prem TFS (test edilen sürüm) 4.1 — connectivity testinde doğrulandı.
const DEFAULT_API_VERSION = '4.1';

/**
 * Tüm hedef gösterim alanları → TFS reference adı haritası.
 *
 * PR-D1 connectivity testi sonrası gerçek dump ile DOĞRULANDI (Univera org).
 * Standart alanlar (System.*, Microsoft.VSTS.*) + 6 custom alan
 * (Univera.* prefix'li).
 *
 * KRİTİK GÜVENLİK: normalizeWorkItem() YALNIZ bu 16 allowlist alanını
 * döndürür. System.Description, Microsoft.VSTS.TCM.ReproSteps ve
 * tüm diğer serbest-metin gövdeler ASLA çekilmez/saklanmaz/loglanmaz —
 * canlı work item'larda kullanıcı parolası gibi sırlar gözlemlendi.
 */
export const FIELD_MAP = {
  id:              'System.Id',                          // standart
  state:           'System.State',                       // standart
  project:         'Univera.ProjectName',                // CUSTOM (System.TeamProject yerine)
  type:            'System.WorkItemType',                // standart
  title:           'System.Title',                       // standart
  assignee:        'System.AssignedTo',                  // standart (displayName parse — bkz. parseAssignedTo)
  createdDate:     'System.CreatedDate',                 // standart
  resolvedDate:    'Microsoft.VSTS.Common.ResolvedDate', // standart
  closedDate:      'Microsoft.VSTS.Common.ClosedDate',   // standart
  rootCause:       'Microsoft.VSTS.CMMI.RootCause',      // standart
  foundIn:         'Microsoft.VSTS.Build.FoundIn',       // standart
  packageType:     'Univera.PackageType',                // CUSTOM
  projectLayer:    'Univera.MobileLayer',                // CUSTOM (UI'da ProjectLayer olarak gösterilir)
  extraField4:     'Univera.Resource',                   // CUSTOM (UI'da ExtraField4 olarak gösterilir)
  foundInRelease:  'Univera.FoundInRelease',             // CUSTOM
  bugGroup:        'Univera.BugGroup',                   // CUSTOM
};

/**
 * UI'da gösterilen friendly etiketler (debug/log için). normalizeWorkItem
 * çıktı anahtarları DEĞİL — bunlar sadece operatöre yansıyan TR/EN ad.
 */
export const FIELD_LABELS = {
  id:              'ID',
  state:           'State',
  project:         'Proje',
  type:            'Work Item Type',
  title:           'Title',
  assignee:        'Assigned To',
  createdDate:     'Created Date',
  resolvedDate:    'Resolved Date',
  closedDate:      'Closed Date',
  rootCause:       'Root Cause',
  foundIn:         'Found In',
  packageType:     'PackageType',
  projectLayer:    'ProjectLayer',
  extraField4:     'ExtraField4',
  foundInRelease:  'FoundInRelease',
  bugGroup:        'BugGroup',
};

export class DevOpsConfigError extends Error {
  constructor(message, { code = 'devops_config_error', status = 400 } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Ham id veya TFS web URL'inden numeric work item id çıkar.
 *
 * Kabul edilen formatlar:
 *   - "324813"                                              → 324813
 *   - 324813 (number)                                       → 324813
 *   - ".../_workitems/edit/324813"                           → 324813
 *   - ".../_workitems/edit/324813?..."                       → 324813
 *   - ".../_workitems?id=324813"                             → 324813
 *   - ".../workItems/324813"                                 → 324813
 *   - ".../wit/workitems/324813"                             → 324813
 *
 * Negatif id, 0, NaN, string-trimmed-empty → null.
 *
 * Not: PR-D2. UI input'unda hem id hem URL yapıştırma desteklenir.
 */
export function parseWorkItemId(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    return Number.isInteger(input) && input > 0 ? input : null;
  }
  const s = String(input).trim();
  if (!s) return null;

  // Düz sayı.
  if (/^\d+$/.test(s)) {
    const n = Number.parseInt(s, 10);
    return n > 0 ? n : null;
  }

  // URL pattern'leri — id query string'de veya path'in sonunda.
  const patterns = [
    /[?&]id=(\d+)\b/i,                       // ?id=324813
    /\/_workitems\/edit\/(\d+)\b/i,          // /_workitems/edit/324813
    /\/workitems\/(\d+)\b/i,                 // /workitems/324813 veya /workItems/324813
    /\/wit\/workitems\/(\d+)\b/i,            // /wit/workitems/324813 (API)
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (n > 0) return n;
    }
  }
  return null;
}

/**
 * PAT'i log mesajlarında maskele. İlk 4 + son 2 char + '***'.
 * Hata mesajlarında bile PAT raw çıkmasın.
 */
export function maskPat(pat) {
  if (!pat || typeof pat !== 'string') return '<empty>';
  if (pat.length <= 8) return '***';
  return `${pat.slice(0, 4)}***${pat.slice(-2)}`;
}

function getConfig() {
  const baseUrl = process.env.TFS_BASE_URL;
  const pat = process.env.TFS_PAT;
  const apiVersion = process.env.TFS_API_VERSION || DEFAULT_API_VERSION;
  const timeoutMs = Number.parseInt(process.env.TFS_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;

  if (!baseUrl) {
    throw new DevOpsConfigError(
      'TFS_BASE_URL .env içinde tanımlı değil.',
      { code: 'tfs_base_url_missing' },
    );
  }
  if (!pat) {
    throw new DevOpsConfigError(
      'TFS_PAT .env içinde tanımlı değil (Basic auth için PAT zorunlu).',
      { code: 'tfs_pat_missing' },
    );
  }
  return { baseUrl, pat, apiVersion, timeoutMs };
}

function buildAuthHeader(pat) {
  // PAT için Basic auth: empty username + PAT password.
  // base64(':' + pat) — TFS standart.
  const token = Buffer.from(`:${pat}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

function joinUrl(base, path) {
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedPath = String(path || '').replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}

function withApiVersion(url, apiVersion) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}api-version=${encodeURIComponent(apiVersion)}`;
}

/**
 * Düşük seviye HTTP proxy. Wrapped response döner.
 * Hata mesajlarında PAT geçmez.
 */
async function tfsRequest({ path, method = 'GET', body }) {
  const config = getConfig();
  const url = withApiVersion(joinUrl(config.baseUrl, path), config.apiVersion);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...buildAuthHeader(config.pat),
  };

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.timeoutMs);

  const proxiedAt = new Date().toISOString();
  const t0 = Date.now();

  try {
    const init = { method, headers, signal: controller.signal };
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
        data = { _rawText: text };
      }
    }

    if (!resp.ok) {
      return {
        ok: false,
        rawSource: RAW_SOURCE,
        error: {
          code: resp.status === 401 || resp.status === 403
            ? 'tfs_auth_error'
            : resp.status === 404
              ? 'tfs_not_found'
              : 'tfs_http_error',
          message: `TFS HTTP ${resp.status}${resp.statusText ? ' ' + resp.statusText : ''}`,
          status: resp.status,
        },
        data,
        meta: { proxiedAt, latencyMs, apiVersion: config.apiVersion },
      };
    }

    return {
      ok: true,
      rawSource: RAW_SOURCE,
      data,
      meta: { proxiedAt, latencyMs, apiVersion: config.apiVersion },
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const isAbort = err?.name === 'AbortError';
    return {
      ok: false,
      rawSource: RAW_SOURCE,
      error: {
        code: isAbort ? 'tfs_timeout' : 'tfs_network_error',
        message: isAbort
          ? `TFS zaman aşımı (${config.timeoutMs} ms).`
          : (err?.message ?? 'TFS erişilemedi.'),
        status: null,
      },
      meta: { proxiedAt, latencyMs, apiVersion: config.apiVersion },
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * AssignedTo değerini parse et.
 *
 * On-prem TFS REST 4.1 AssignedTo'yu **string** formatında döner:
 *   "Ad Soyad <DOMAIN\user>"
 * veya bazı durumlarda obje formunda ({ displayName, uniqueName }).
 *
 * Sadece displayName ("Ad Soyad") döndürürüz — uniqueName/domain hesabını
 * UI'a sızdırmaz (PII minimization).
 */
function parseAssignedTo(raw) {
  if (raw === null || raw === undefined) return null;
  // Modern format: { displayName, uniqueName, ... }
  if (typeof raw === 'object') {
    if (typeof raw.displayName === 'string' && raw.displayName.trim()) {
      return raw.displayName.trim();
    }
    return null;
  }
  // Legacy/4.1 string format: "Ad Soyad <DOMAIN\user>"
  if (typeof raw === 'string') {
    const m = raw.match(/^\s*(.*?)\s*<[^>]+>\s*$/);
    if (m) return m[1].trim() || null;
    return raw.trim() || null;
  }
  return null;
}

/**
 * Ham TFS work item response'unu **allowlist** 16 alanlık gösterim şemasına
 * eşle.
 *
 * KRİTİK GÜVENLİK GUARDRAIL:
 *  - Çıktı YALNIZCA FIELD_MAP'teki 16 alan + url + id'yi içerir.
 *  - System.Description, Microsoft.VSTS.TCM.ReproSteps, History, Comments,
 *    AcceptanceCriteria gibi serbest-metin gövdeler ASLA dahil edilmez —
 *    canlı work item'larda kullanıcı parolaları gözlemlendi.
 *  - Bilinmeyen/yeni custom alan eklemek için BURASI güncellenmeli; spread
 *    veya `...raw.fields` kullanmak YASAK (sızıntı vektörü).
 *  - Boş alanlar `null` döner (UI graceful "—" gösterir).
 */
export function normalizeWorkItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const fields = raw.fields ?? {};
  const pick = (refName) => {
    if (!refName) return null;
    const v = fields[refName];
    return v === undefined || v === null || v === '' ? null : v;
  };

  // Allowlist — yalnız FIELD_MAP'teki 16 alan + url. Hiçbir başka alan
  // (description/repro/history/...) çıktıya konmaz.
  return {
    id:              raw.id ?? pick(FIELD_MAP.id) ?? null,
    state:           pick(FIELD_MAP.state),
    project:         pick(FIELD_MAP.project),
    type:            pick(FIELD_MAP.type),
    title:           pick(FIELD_MAP.title),
    assignee:        parseAssignedTo(fields[FIELD_MAP.assignee]),
    createdDate:     pick(FIELD_MAP.createdDate),
    resolvedDate:    pick(FIELD_MAP.resolvedDate),
    closedDate:      pick(FIELD_MAP.closedDate),
    rootCause:       pick(FIELD_MAP.rootCause),
    foundIn:         pick(FIELD_MAP.foundIn),
    packageType:     pick(FIELD_MAP.packageType),
    projectLayer:    pick(FIELD_MAP.projectLayer),
    extraField4:     pick(FIELD_MAP.extraField4),
    foundInRelease:  pick(FIELD_MAP.foundInRelease),
    bugGroup:        pick(FIELD_MAP.bugGroup),
    // Web UI link — TFS response içinde _links.html.href olarak gelir.
    url:             raw._links?.html?.href ?? null,
  };
}

/**
 * Tek bir work item çek.
 *  - Wrapped response döner: { ok, data: { raw, normalized }, error?, meta }
 *  - data.raw: TFS'ten dönen ham object (fields nesnesi tam dökümü için)
 *  - data.normalized: 16 alanlık gösterim şemasına eşlenmiş hâli
 */
export async function getWorkItem(id) {
  if (!id || (typeof id !== 'number' && typeof id !== 'string')) {
    throw new DevOpsConfigError(
      'workItemId gerekli (number veya numeric string).',
      { code: 'tfs_workitem_id_required' },
    );
  }
  // $expand=all → custom alanları dahil tüm fields'i döner.
  const result = await tfsRequest({
    path: `wit/workitems/${encodeURIComponent(id)}?$expand=all`,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    rawSource: RAW_SOURCE,
    data: {
      raw: result.data,
      normalized: normalizeWorkItem(result.data),
    },
    meta: result.meta,
  };
}

/**
 * Birden fazla work item çek (batch).
 *  - ids: number[] (en fazla 200 — TFS REST sınırı; daha fazlasını caller chunk'lasın)
 *  - Wrapped response: data.raw = { count, value: [...] }, data.normalized = [...]
 *  - D3 çoklu link UI'sında kullanılacak.
 */
export async function getWorkItems(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new DevOpsConfigError(
      'ids array gerekli (boş olamaz).',
      { code: 'tfs_workitem_ids_required' },
    );
  }
  if (ids.length > 200) {
    throw new DevOpsConfigError(
      'En fazla 200 work item tek seferde çekilebilir (TFS REST sınırı).',
      { code: 'tfs_workitem_ids_too_many' },
    );
  }
  const idsParam = ids.map((n) => encodeURIComponent(n)).join(',');
  const result = await tfsRequest({
    path: `wit/workitems?ids=${idsParam}&$expand=all`,
  });
  if (!result.ok) return result;
  const raw = result.data;
  const list = Array.isArray(raw?.value) ? raw.value : [];
  return {
    ok: true,
    rawSource: RAW_SOURCE,
    data: {
      raw,
      normalized: list.map(normalizeWorkItem),
    },
    meta: result.meta,
  };
}

/**
 * Diagnostic helper — config sağlığını rapor et. PAT raw asla içermez.
 */
export function diag() {
  try {
    const { baseUrl, pat, apiVersion, timeoutMs } = getConfig();
    return {
      ok: true,
      baseUrl,
      patMasked: maskPat(pat),
      apiVersion,
      timeoutMs,
    };
  } catch (e) {
    return {
      ok: false,
      error: { code: e.code ?? 'devops_config_error', message: e.message },
    };
  }
}

export const devopsClient = {
  getWorkItem,
  getWorkItems,
  diag,
  normalizeWorkItem,
  parseWorkItemId,
  FIELD_MAP,
  FIELD_LABELS,
};
