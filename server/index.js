import express from 'express';
import cors from 'cors';
import casesRouter from './routes/cases.js';
import aiRouter from './routes/ai.js';

const app = express();
const PORT = process.env.PORT ?? 3101;

app.use(cors({ origin: 'http://localhost:5273' }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'varuna-case-management-bff', time: new Date().toISOString() });
});

app.use('/api/cases', casesRouter);
app.use('/api/ai', aiRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`[bff] Varuna Case Management BFF listening on http://localhost:${PORT}`);
});
