import express from 'express';
import cors from 'cors';
import casesRouter from './routes/cases.js';
import aiRouter from './routes/ai.js';
import lookupsRouter from './routes/lookups.js';
import adminRouter from './routes/admin.js';
import analyticsRouter from './routes/analytics.js';
import authRouter from './routes/auth.js';
import cronRouter from './routes/cron.js';
import myRouter from './routes/my.js';
import accountsRouter from './routes/accounts.js';
import externalKbRouter from './routes/externalKb.js';
import smartTicketRouter from './routes/smartTicket.js';
import importsRouter from './routes/imports.js';
import approvalsRouter from './routes/approvals.js';
import actionCenterRouter from './routes/action-center.js';
import kbV1Router from './routes/kbV1.js';
import reportsRouter from './routes/reports.js';
import { prisma } from './db/client.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Express app factory — listen yok (server/index.js çağırır).
 *
 * Faz 5 (on-prem): aynı Express süreci hem /api'yi hem build edilmiş
 * frontend'i (dist/) servis eder — tek servis, tek port.
 */
const app = express();

// Reverse proxy (IIS ARR / nginx) loopback'ten bağlanır; X-Forwarded-For'u
// yalnız o durumda dikkate al ki req.ip (auth/ai rate limiting) gerçek
// istemci IP'si olsun. Doğrudan erişimde davranış değişmez.
app.set('trust proxy', 'loopback');

// CORS: dev'de Vite (5273) ↔ BFF (3101) ayrı origin'de — gerekli.
// On-prem production'da dist/ aynı süreçten servis edildiği için normalde
// gereksiz; frontend ayrı bir origin'den sunulacaksa CORS_ORIGIN set edilir.
const corsOrigin =
  process.env.CORS_ORIGIN ||
  (process.env.NODE_ENV !== 'production' ? 'http://localhost:5273' : null);
if (corsOrigin) {
  app.use(cors({ origin: corsOrigin }));
}

// Faz 4 — dosya upload endpoint'i raw body bekler; global json parser
// .json dosya yüklemelerini (Content-Type: application/json) yutmasın diye
// bu path atlanır (route kendi express.raw parser'ını kullanır).
const jsonParser = express.json({ limit: '2mb' });
app.use((req, res, next) => {
  if (req.method === 'PUT' && /^\/api\/cases\/[^/]+\/files\/upload$/.test(req.path)) {
    return next();
  }
  return jsonParser(req, res, next);
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'varuna-case-management-bff',
    time: new Date().toISOString(),
  });
});

// DB-touching health probe. UptimeRobot/cron-job.org buraya 5dk ping atar:
// (1) Supabase auto-pause'u tetiklemez (hareket sayılır),
// (2) Pooler aksaklığını biz fark etmeden 5dk içinde alarm üretir.
// Auth yok — public endpoint, sadece "DB erişilebilir mi" kontrolü.
app.get('/api/health/deep', async (_req, res) => {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'reachable', latencyMs: Date.now() - t0 });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      db: 'unreachable',
      latencyMs: Date.now() - t0,
      error: err?.message?.split('\n')[0],
    });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/cases', casesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/lookups', lookupsRouter);
// WR-A8: imports router admin router'dan ÖNCE mount edilir; aksi halde
// '/api/admin' prefix'i match olur, verifyJwt iki kez koşar.
app.use('/api/admin/imports', importsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/cron', cronRouter);
app.use('/api/my', myRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/external-kb', externalKbRouter);
app.use('/api/smart-ticket', smartTicketRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/action-center', actionCenterRouter);
// Faz KB — ticket-analiz'in KB/RAG çekirdeği in-process (Bearer API key auth;
// ExternalKbSetting.baseUrl bu sürecin kendisine işaret eder).
app.use('/api/v1', kbV1Router);
app.use('/api/reports', reportsRouter);

// API 404 — bilinmeyen /api/* yolları JSON döner (SPA fallback'ine düşmesin).
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ─────────────────────────────────────────────────────────────────
// Faz 5 — Static frontend (dist/) + SPA fallback.
// `npm run build` çıktısı varsa servis edilir; yoksa (salt-API dev modu,
// vite dev server frontend'i ayrıca sunar) sessizce atlanır.
// ─────────────────────────────────────────────────────────────────
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir, { index: 'index.html', maxAge: '1h' }));
  // SPA fallback: bilinmeyen GET yolları index.html'e düşer (client routing).
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
}

// Body-parser 413 → structured JSON. express.json yukarıda body'yi parse
// ederken size limit aşılırsa next(err) ile error-handling middleware'e
// düşer; default davranış HTML "PayloadTooLargeError" sayfasıdır ve
// frontend (apiFetch) onu jeneirk "Sunucu hatası" olarak gösterirdi.
// Burada error code/maxBytes/receivedBytes ile structured JSON döner,
// apiFetch bunu doğrudan kullanıcıya yansıtabilir.
//
// Not: Hotfix A — sadece truthful error response. Body limit'in kendisi
// (2mb global vs 24mb router override) bu PR'da değiştirilmiyor. Sebep:
// import dışı tüm endpoint'ler 2mb için tasarlandı; global'i toptan
// büyütmek attack-surface artırır. C360 büyük dosya akışı için Phase B
// (multipart upload + sunucu-tarafı parse) ayrı PR'a saklanıyor.
app.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    const maxBytes = typeof err.limit === 'number' ? err.limit : 2 * 1024 * 1024;
    const receivedBytes = typeof err.length === 'number' ? err.length : null;
    return res.status(413).json({
      code: 'payload_too_large',
      message:
        'İstek gövdesi sunucu sınırının üstünde. Müşteri 360 büyük dosyaları parçalara bölüp yeniden deneyin.',
      maxBytes,
      receivedBytes,
    });
  }
  return next(err);
});

export default app;
