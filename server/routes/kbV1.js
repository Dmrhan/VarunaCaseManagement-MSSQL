import { Router } from 'express';
import { z } from 'zod';
import {
  ask,
  retrieve,
  kbStats,
  getKbDb,
  categorize,
  categorizeV2,
  suggestClose,
  runAnalysis,
  AnalyzeBodySchema,
  CustomerSearchBlockedError,
  env as kbEnv,
} from '../kb/kbCore.js';

/**
 * KB v1 API (Faz KB) — ticket-analiz'in /api/v1 sözleşmesinin in-process hali.
 *
 * ticket-analiz (Next.js) ayrı çalışmak zorunda kalmasın diye KB/RAG çekirdeği
 * (server/kb/kbCore.js — esbuild bundle) CSM sürecine gömüldü. Bu router aynı
 * endpoint sözleşmesini sunar; CSM'in mevcut externalKbClient/ExternalKbSetting
 * katmanı HİÇ değişmeden baseUrl=http://127.0.0.1:<PORT> ile buraya bağlanır.
 *
 * Auth: Bearer API key (env API_KEYS="key:tenant,..."), orijinaldeki gibi.
 * verifyJwt YOK — bu yüzeyin tüketicisi BFF'in kendisi (externalKbClient);
 * kullanıcı-rol kontrolü zaten routes/externalKb.js + smartTicket.js'te yapılır.
 *
 * Endpoint envanteri (VARUNA_API_DOCS.md ile birebir):
 *   GET  /health        — public sağlık (auth yok)
 *   GET  /stats         — tenant KB istatistikleri
 *   POST /kb/ask        — RAG cevap (Claude generation + sitasyon + doğrulama)
 *   POST /kb/search     — yalnız retrieval (hybrid BM25+vektör+RRF)
 *   POST /categorize    — eski taksonomi sınıflandırma
 *   POST /categorize-v2 — Smart Ticket açılış sınıflandırması (6 alan)
 *   POST /suggest-close — Smart Ticket kapanış önerisi (4 alan)
 *   POST /analyze       — tam analiz pipeline'ı (~120-180s)
 */

const router = Router();

class ApiAuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

function authenticate(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) throw new ApiAuthError('Authorization header eksik.');
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) throw new ApiAuthError("Authorization header 'Bearer <token>' formatında olmalı.");
  const apiKey = m[1].trim();
  const tenantId = kbEnv().API_KEYS[apiKey];
  if (!tenantId) throw new ApiAuthError('Geçersiz API key.');
  return { tenantId, keyHint: `${apiKey.slice(0, 8)}…` };
}

function errorBody(message, status, details) {
  return { error: { message, status, ...(details ? { details } : {}) } };
}

/** auth + ortak hata yakalama (orijinal v1Endpoint karşılığı). */
function v1(handler) {
  return async (req, res) => {
    let caller;
    try {
      caller = authenticate(req);
    } catch (err) {
      return res.status(err.status ?? 401).json(errorBody(err.message, err.status ?? 401));
    }
    try {
      await handler(req, res, caller);
    } catch (err) {
      console.error(`[kb-v1] handler error (tenant=${caller.tenantId}):`, err?.message ?? err);
      res.status(500).json(errorBody(err?.message ?? 'Bilinmeyen sunucu hatası', 500));
    }
  };
}

// GET /health — public (orijinalde de auth yok)
router.get('/health', (_req, res) => {
  try {
    const stats = kbStats();
    res.json({
      ok: true,
      version: 'v1',
      kb: {
        documents: stats.documents,
        chunks: stats.chunks,
        embeddings: stats.embeddings,
        vec_available: stats.vecAvailable,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message, timestamp: new Date().toISOString() });
  }
});

// GET /stats — tenant-scoped istatistikler
router.get('/stats', v1(async (_req, res, caller) => {
  const db = getKbDb();
  const docs = db.prepare('SELECT COUNT(*) AS n FROM kb_documents WHERE tenant_id = ?').get(caller.tenantId);
  const chunks = db.prepare('SELECT COUNT(*) AS n FROM kb_chunks WHERE tenant_id = ?').get(caller.tenantId);
  const embeds = db.prepare(
    `SELECT COUNT(*) AS n FROM kb_embeddings e
     JOIN kb_chunks c ON c.chunk_id = e.chunk_id
     WHERE c.tenant_id = ?`,
  ).get(caller.tenantId);
  const byType = db.prepare(
    'SELECT source_type, COUNT(*) AS n FROM kb_documents WHERE tenant_id = ? GROUP BY source_type',
  ).all(caller.tenantId);
  const lastIngest = db.prepare(
    'SELECT MAX(ingested_at) AS t FROM kb_documents WHERE tenant_id = ?',
  ).get(caller.tenantId);

  res.json({
    tenant: caller.tenantId,
    documents: docs.n,
    chunks: chunks.n,
    embeddings: embeds.n,
    embedding_coverage: chunks.n > 0 ? embeds.n / chunks.n : 0,
    by_type: Object.fromEntries(byType.map((r) => [r.source_type, r.n])),
    last_ingest_at: lastIngest.t,
  });
}));

const SOURCE_TYPES = ['pdf', 'panorama_screen', 'ticket_resolution'];

const AskBody = z.object({
  query: z.string().min(3).max(2000),
  topK: z.number().int().min(1).max(20).optional(),
  rerank: z.boolean().optional(),
  verify: z.boolean().optional(),
  strictness: z.enum(['lenient', 'normal', 'strict']).optional(),
  sourceTypes: z.array(z.enum(SOURCE_TYPES)).optional(),
});

router.post('/kb/ask', v1(async (req, res, caller) => {
  const parsed = AskBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(errorBody('Geçersiz girdi', 400, parsed.error.issues));
  const result = await ask(parsed.data.query, {
    topK: parsed.data.topK ?? 8,
    rerank: parsed.data.rerank ?? true,
    verify: parsed.data.verify ?? true,
    strictness: parsed.data.strictness ?? 'normal',
    sourceTypes: parsed.data.sourceTypes,
    tenantId: caller.tenantId,
  });
  res.json(result);
}));

const SearchBody = z.object({
  query: z.string().min(2).max(2000),
  topK: z.number().int().min(1).max(50).optional(),
  rerank: z.boolean().optional(),
  sourceTypes: z.array(z.enum(SOURCE_TYPES)).optional(),
});

router.post('/kb/search', v1(async (req, res, caller) => {
  const parsed = SearchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(errorBody('Geçersiz girdi', 400, parsed.error.issues));
  const hits = await retrieve(parsed.data.query, {
    topK: parsed.data.topK ?? 10,
    rerank: parsed.data.rerank ?? false,
    sourceTypes: parsed.data.sourceTypes,
    tenantId: caller.tenantId,
  });
  res.json({ query: parsed.data.query, hits });
}));

const CategorizeBody = z.object({
  description: z.string().min(5).max(8000),
  project: z.string().max(200).optional(),
  customer_name: z.string().max(200).optional(),
});

router.post('/categorize', v1(async (req, res) => {
  const parsed = CategorizeBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(errorBody('Geçersiz girdi', 400, parsed.error.issues));
  const result = await categorize({
    description: parsed.data.description,
    project: parsed.data.project ?? null,
    customerName: parsed.data.customer_name ?? null,
  });
  res.json(result);
}));

router.post('/categorize-v2', v1(async (req, res) => {
  const parsed = CategorizeBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(errorBody('Geçersiz girdi', 400, parsed.error.issues));
  const result = await categorizeV2({
    description: parsed.data.description,
    project: parsed.data.project ?? null,
    customerName: parsed.data.customer_name ?? null,
  });
  res.json(result);
}));

const SuggestCloseBody = z.object({
  description: z.string().min(5).max(8000),
  resolution: z.string().min(5).max(20000),
  open_urun: z.string().max(100).nullable().optional(),
  open_is_sureci: z.string().max(200).nullable().optional(),
  open_islem_tipi: z.string().max(200).nullable().optional(),
});

router.post('/suggest-close', v1(async (req, res) => {
  const parsed = SuggestCloseBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(errorBody('Geçersiz girdi', 400, parsed.error.issues));
  const result = await suggestClose({
    description: parsed.data.description,
    resolution: parsed.data.resolution,
    open_urun: parsed.data.open_urun ?? null,
    open_is_sureci: parsed.data.open_is_sureci ?? null,
    open_islem_tipi: parsed.data.open_islem_tipi ?? null,
  });
  res.json(result);
}));

router.post('/analyze', v1(async (req, res) => {
  const parsed = AnalyzeBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(errorBody('Geçersiz girdi', 400, parsed.error.issues));
  try {
    const result = await runAnalysis(parsed.data);
    res.json(result);
  } catch (err) {
    if (err instanceof CustomerSearchBlockedError) {
      return res.status(400).json(errorBody(
        'Müşteri bazlı arama desteklenmiyor. Lütfen sorunu teknik terimlerle ifade edin.',
        400,
        { blockedMatches: err.matches },
      ));
    }
    throw err;
  }
}));

export default router;
