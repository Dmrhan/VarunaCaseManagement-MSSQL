/**
 * WR-A8 — External API source client (manual pull).
 *
 * Browser → BFF → external API. Browser asla harici API'ye doğrudan
 * bağlanmaz. Secret değeri yalnızca BFF'te resolve edilir
 * (process.env[secretName]) ve istek dışında bir yere aktarılmaz.
 *
 * Phase 1 desteklenenler:
 *   - method: GET | POST
 *   - authType: none | bearerToken | apiKeyHeader
 *   - headersJson: ekstra header'lar (Content-Type override hariç)
 *   - bodyJson: POST için body (JSON-serialize edilir)
 *   - dataPath: response içinde array yolu (örn. "data", "items.records")
 *   - sampleLimit: dönen örnek satır sayısı
 *
 * Desteklenmeyenler: scheduled sync, webhook, OAuth, pagination, SOAP/XML, SFTP.
 */

const DEFAULT_SAMPLE_LIMIT = 50;
const MAX_SAMPLE_LIMIT = 500;
const REQUEST_TIMEOUT_MS = 30000;

function resolveSecret(secretName) {
  if (!secretName || typeof secretName !== 'string') return null;
  const raw = process.env[secretName.trim()];
  if (!raw || typeof raw !== 'string') return null;
  return raw;
}

function digInto(obj, path) {
  if (!path) return obj;
  const segments = String(path).split('.').map((s) => s.trim()).filter(Boolean);
  let cur = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

function maskUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Sample fetch — ham örnek veri çek + sütunları çıkar.
 *
 * Returns:
 *   {
 *     ok: true,
 *     sourceUrlMasked, columns, sampleRows, totalRows,
 *   }
 *   | { ok: false, code, message }
 */
export async function sampleFromApi(input) {
  const {
    url,
    method = 'GET',
    authType = 'none',
    secretName,
    headersJson,
    bodyJson,
    dataPath,
    sampleLimit,
  } = input ?? {};

  if (!url || typeof url !== 'string') {
    return { ok: false, code: 'invalid_url', message: 'URL gerekli.' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: 'invalid_url', message: 'URL geçersiz.' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, code: 'invalid_protocol', message: 'Yalnızca HTTP/HTTPS desteklenir.' };
  }
  if (!['GET', 'POST'].includes(method)) {
    return { ok: false, code: 'invalid_method', message: 'Yalnızca GET ve POST destekleniyor.' };
  }

  // Header'ları topla — secret hariç
  const headers = { Accept: 'application/json' };
  if (headersJson && typeof headersJson === 'object' && !Array.isArray(headersJson)) {
    for (const [k, v] of Object.entries(headersJson)) {
      if (typeof k !== 'string' || !k.trim()) continue;
      if (v === null || v === undefined) continue;
      headers[k] = String(v);
    }
  }

  // Auth header
  if (authType === 'bearerToken' || authType === 'apiKeyHeader') {
    const secret = resolveSecret(secretName);
    if (!secret) {
      return {
        ok: false,
        code: 'missing_secret',
        message: `Secret env değişkeni bulunamadı: ${secretName ?? '(belirtilmedi)'}.`,
      };
    }
    if (authType === 'bearerToken') {
      headers['Authorization'] = `Bearer ${secret}`;
    } else {
      headers['X-API-Key'] = secret;
    }
  }

  let bodyText;
  if (method === 'POST') {
    if (bodyJson !== undefined && bodyJson !== null) {
      try {
        bodyText = JSON.stringify(bodyJson);
        headers['Content-Type'] = 'application/json';
      } catch {
        return { ok: false, code: 'invalid_body', message: 'Body JSON çevirilemedi.' };
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(parsed.toString(), {
      method,
      headers,
      body: bodyText,
      signal: controller.signal,
    });
  } catch (err) {
    return {
      ok: false,
      code: err?.name === 'AbortError' ? 'timeout' : 'network_error',
      message: err?.name === 'AbortError'
        ? `API yanıtı ${REQUEST_TIMEOUT_MS}ms içinde alınamadı.`
        : 'API çağrısı başarısız.',
    };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let bodyPreview = '';
    try {
      const text = await response.text();
      bodyPreview = text.slice(0, 200);
    } catch {}
    return {
      ok: false,
      code: 'upstream_error',
      message: `API ${response.status} döndü.`,
      status: response.status,
      bodyPreview,
    };
  }

  let json;
  try {
    json = await response.json();
  } catch {
    return { ok: false, code: 'invalid_json', message: 'API yanıtı JSON değil.' };
  }

  const arrayCandidate = digInto(json, dataPath);
  if (!Array.isArray(arrayCandidate)) {
    return {
      ok: false,
      code: 'not_array',
      message: 'API yanıtında aktarılabilir satır listesi bulunamadı. dataPath alanını kontrol edin.',
    };
  }

  const limit = Math.min(
    Math.max(1, Number(sampleLimit) || DEFAULT_SAMPLE_LIMIT),
    MAX_SAMPLE_LIMIT,
  );
  const sampleRows = arrayCandidate.slice(0, limit).map((r) => {
    if (r && typeof r === 'object' && !Array.isArray(r)) return r;
    return { value: r };
  });

  const columnSet = new Set();
  for (const r of sampleRows) {
    for (const k of Object.keys(r)) columnSet.add(k);
  }

  return {
    ok: true,
    sourceUrlMasked: maskUrl(url),
    columns: [...columnSet],
    sampleRows,
    totalRows: arrayCandidate.length,
  };
}
