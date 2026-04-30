/**
 * Vercel serverless catch-all — tüm /api/* istekleri Express app'e yönlendirilir.
 *
 * Vercel'de bu dosya `/api/(.*)` route'unu yakalayan tek serverless function olarak
 * deploy edilir. Express app `server/app.js`'ten import edilir (listen yok).
 *
 * Production'da:
 *   - frontend Vite static build (dist/) → Vercel CDN
 *   - /api/* istekleri → bu function → Express → routes/cases.js & routes/ai.js
 *
 * Environment variables (Vercel dashboard → Settings → Environment Variables):
 *   - OPENAI_API_KEY (zorunlu, RUNA AI için)
 */
import app from '../server/app.js';

export default app;
