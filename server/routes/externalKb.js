import { Router } from 'express';
import { verifyJwt } from '../db/auth.js';
import {
  externalKbClient,
  loadEnabledSetting,
  assertRoleAllowed,
  ExternalKbDisabledError,
  ExternalKbForbiddenError,
  ExternalKbConfigError,
} from '../lib/externalKbClient.js';
import { prisma } from '../db/client.js';

/**
 * WR-KB3 — External KB / AI service proxy routes.
 *
 * Bu router'daki HİÇBİR endpoint Case mutate etmez, CaseActivity yazmaz,
 * AIUsageLog yazmaz, Runa AI çağırmaz. Görevi tek: external API'yi proxy'le,
 * raw response'u UI'a ilet. Yorumlama (category_id → Varuna kategorisi vb.)
 * future PR'da Operations Intelligence ekibi tarafından yapılacak; bu
 * console yalnız "external response viewer" sağlar.
 */

const router = Router();
router.use(verifyJwt);

const STRICTNESS_VALUES = new Set(['lenient', 'normal', 'strict']);
const SOURCE_TYPE_ALLOWLIST = new Set([
  // WR-KB4 — Yalnız EnRoute KB API tarafından desteklenen tipler:
  //   pdf                — Belge / dokümantasyon
  //   panorama_screen    — Panorama ekranı referansı
  //   ticket_resolution  — Geçmiş ticket çözümleri
  'pdf',
  'panorama_screen',
  'ticket_resolution',
]);

function jsonError(res, status, code, message) {
  return res.status(status).json({
    ok: false,
    error: { code, message, status },
  });
}

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ExternalKbForbiddenError) {
        return jsonError(res, 403, err.code, err.message);
      }
      if (err instanceof ExternalKbDisabledError) {
        return res.status(200).json({
          ok: false,
          endpoint: req.params?.endpoint ?? null,
          rawSource: 'enroute-kb',
          error: { code: err.code, message: err.message, status: err.status },
        });
      }
      if (err instanceof ExternalKbConfigError) {
        return res.status(200).json({
          ok: false,
          endpoint: req.params?.endpoint ?? null,
          rawSource: 'enroute-kb',
          error: { code: err.code, message: err.message, status: err.status },
        });
      }
      console.error('[external-kb]', err);
      return jsonError(res, 500, 'external_kb_internal', err?.message ?? 'Sunucu hatası');
    }
  };
}

/**
 * Resolve companyId + tenant scope. body veya query'den okur; allowedCompanyIds
 * içinde olmalı.
 */
function resolveCompanyId(req) {
  const fromQuery = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  const fromBody = typeof req.body?.companyId === 'string' ? req.body.companyId : '';
  const cid = fromQuery || fromBody;
  if (!cid) {
    const err = new ExternalKbConfigError('companyId gerekli.', {
      code: 'company_required',
      status: 400,
    });
    throw err;
  }
  const allowed = Array.isArray(req.user.allowedCompanyIds) ? req.user.allowedCompanyIds : [];
  if (!allowed.includes(cid)) {
    throw new ExternalKbForbiddenError('Bu şirkete erişim yetkin yok.');
  }
  return cid;
}

// ─────────────────────────────────────────────────────────────────
// GET /api/external-kb/settings-status?companyId=...
// UI ilk açılışta enabled + allow*Use görmek ister. Secret/path döner
// fakat secret VALUE döndürmez.
// ─────────────────────────────────────────────────────────────────
router.get('/settings-status', asyncRoute(async (req, res) => {
  const companyId = resolveCompanyId(req);
  const row = await prisma.externalKbSetting.findUnique({
    where: { companyId },
    select: {
      enabled: true,
      providerName: true,
      baseUrl: true,
      authType: true,
      apiKeySecretName: true,
      defaultTopK: true,
      defaultStrictness: true,
      defaultRerank: true,
      defaultVerify: true,
      showCitations: true,
      allowAgentUse: true,
      allowSupervisorUse: true,
      allowCsmUse: true,
    },
  });
  if (!row) {
    return res.json({
      companyId,
      enabled: false,
      configured: false,
    });
  }
  // Secret VALUE asla burada görünmez — sadece referans ismi (apiKeySecretName)
  // ve "secret tanımlı mı" booleanı.
  const secretConfigured =
    row.authType === 'none' ||
    (!!row.apiKeySecretName && !!process.env[row.apiKeySecretName]);
  return res.json({
    companyId,
    configured: true,
    enabled: row.enabled,
    providerName: row.providerName,
    baseUrl: row.baseUrl,
    authType: row.authType,
    apiKeySecretName: row.apiKeySecretName,
    secretConfigured,
    defaultTopK: row.defaultTopK,
    defaultStrictness: row.defaultStrictness,
    defaultRerank: row.defaultRerank,
    defaultVerify: row.defaultVerify,
    showCitations: row.showCitations,
    allowAgentUse: row.allowAgentUse,
    allowSupervisorUse: row.allowSupervisorUse,
    allowCsmUse: row.allowCsmUse,
  });
}));

async function loadAndGate(req) {
  const companyId = resolveCompanyId(req);
  const setting = await loadEnabledSetting(companyId);
  assertRoleAllowed(req.user, companyId, setting);
  return { companyId, setting };
}

// ─────────────────────────────────────────────────────────────────
// GET /api/external-kb/health?companyId=...
// ─────────────────────────────────────────────────────────────────
router.get('/health', asyncRoute(async (req, res) => {
  const { setting } = await loadAndGate(req);
  const r = await externalKbClient.health(setting);
  return res.json(r);
}));

// ─────────────────────────────────────────────────────────────────
// GET /api/external-kb/stats?companyId=...
// ─────────────────────────────────────────────────────────────────
router.get('/stats', asyncRoute(async (req, res) => {
  const { setting } = await loadAndGate(req);
  const r = await externalKbClient.stats(setting);
  return res.json(r);
}));

// ─────────────────────────────────────────────────────────────────
// POST /api/external-kb/ask
// body: { companyId, query, topK?, strictness?, rerank?, verify?, sourceTypes? }
// ─────────────────────────────────────────────────────────────────
router.post('/ask', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query || query.length < 3 || query.length > 2000) {
    return jsonError(res, 400, 'invalid_query', 'query 3-2000 karakter arası olmalı.');
  }
  const strictness = body.strictness;
  if (strictness !== undefined && !STRICTNESS_VALUES.has(strictness)) {
    return jsonError(res, 400, 'invalid_strictness', 'strictness lenient|normal|strict olmalı.');
  }
  if (body.sourceTypes !== undefined) {
    if (!Array.isArray(body.sourceTypes)) {
      return jsonError(res, 400, 'invalid_source_types', 'sourceTypes array olmalı.');
    }
    for (const s of body.sourceTypes) {
      if (!SOURCE_TYPE_ALLOWLIST.has(s)) {
        return jsonError(res, 400, 'invalid_source_types', `Bilinmeyen sourceType: ${s}`);
      }
    }
  }
  if (body.topK !== undefined) {
    const n = Number(body.topK);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      return jsonError(res, 400, 'invalid_top_k', 'topK 1-20 arası tamsayı olmalı.');
    }
  }
  const { setting } = await loadAndGate(req);
  const payload = {
    query,
    top_k: body.topK ?? setting.defaultTopK,
    strictness: strictness ?? setting.defaultStrictness,
    rerank: body.rerank ?? setting.defaultRerank,
    verify: body.verify ?? setting.defaultVerify,
    ...(body.sourceTypes !== undefined ? { source_types: body.sourceTypes } : {}),
  };
  const r = await externalKbClient.ask(setting, payload);
  return res.json(r);
}));

// ─────────────────────────────────────────────────────────────────
// POST /api/external-kb/search
// body: { companyId, query, topK?, sourceTypes? }
// ─────────────────────────────────────────────────────────────────
router.post('/search', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query || query.length < 3 || query.length > 2000) {
    return jsonError(res, 400, 'invalid_query', 'query 3-2000 karakter arası olmalı.');
  }
  if (body.sourceTypes !== undefined) {
    if (!Array.isArray(body.sourceTypes)) {
      return jsonError(res, 400, 'invalid_source_types', 'sourceTypes array olmalı.');
    }
    for (const s of body.sourceTypes) {
      if (!SOURCE_TYPE_ALLOWLIST.has(s)) {
        return jsonError(res, 400, 'invalid_source_types', `Bilinmeyen sourceType: ${s}`);
      }
    }
  }
  if (body.topK !== undefined) {
    const n = Number(body.topK);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      return jsonError(res, 400, 'invalid_top_k', 'topK 1-20 arası tamsayı olmalı.');
    }
  }
  const { setting } = await loadAndGate(req);
  const payload = {
    query,
    top_k: body.topK ?? setting.defaultTopK,
    ...(body.sourceTypes !== undefined ? { source_types: body.sourceTypes } : {}),
  };
  const r = await externalKbClient.search(setting, payload);
  return res.json(r);
}));

// ─────────────────────────────────────────────────────────────────
// POST /api/external-kb/categorize
// body: { companyId, description }
// ─────────────────────────────────────────────────────────────────
router.post('/categorize', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description || description.length < 5 || description.length > 8000) {
    return jsonError(res, 400, 'invalid_description', 'description 5-8000 karakter arası olmalı.');
  }
  const { setting } = await loadAndGate(req);
  const r = await externalKbClient.categorize(setting, { description });
  return res.json(r);
}));

// ─────────────────────────────────────────────────────────────────
// POST /api/external-kb/analyze
// body: { companyId, freeText, context? }
// ─────────────────────────────────────────────────────────────────
router.post('/analyze', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  const freeText = typeof body.freeText === 'string' ? body.freeText.trim() : '';
  if (!freeText || freeText.length < 3 || freeText.length > 8000) {
    return jsonError(res, 400, 'invalid_free_text', 'freeText 3-8000 karakter arası olmalı.');
  }
  const { setting } = await loadAndGate(req);
  const payload = {
    free_text: freeText,
    ...(body.context !== undefined ? { context: body.context } : {}),
  };
  const r = await externalKbClient.analyze(setting, payload);
  return res.json(r);
}));

export default router;
