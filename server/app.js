import express from 'express';
import cors from 'cors';
import casesRouter from './routes/cases.js';
import aiRouter from './routes/ai.js';
import lookupsRouter from './routes/lookups.js';
import adminRouter from './routes/admin.js';
import authRouter from './routes/auth.js';

/**
 * Express app factory — listen yok.
 * Hem local dev (server/index.js) hem Vercel serverless (api/[...slug].js)
 * tarafından kullanılır.
 */
const app = express();

// CORS yalnızca local dev'de gerekli (frontend port 5273, BFF port 3101).
// Vercel production'da frontend ve API aynı origin'de — CORS gereksiz.
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: 'http://localhost:5273' }));
}

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'varuna-case-management-bff',
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/cases', casesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/lookups', lookupsRouter);
app.use('/api/admin', adminRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

export default app;
