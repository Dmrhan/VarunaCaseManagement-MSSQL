/**
 * Vercel serverless catch-all — tüm /api/* istekleri Express app'e yönlendirilir.
 *
 * Vercel'de `api/[...slug].js` dosya adı /api/* için otomatik catch-all yapar
 * (vercel.json rewrite'a gerek yok). Express app server/app.js'ten import edilir.
 *
 * Production'da:
 *   - frontend Vite static build (dist/) → Vercel CDN
 *   - /api/* istekleri → bu function → Express → routes/cases.js & routes/ai.js
 *
 * Environment variables (Vercel dashboard → Settings → Environment Variables):
 *   - OPENAI_API_KEY (zorunlu, RUNA AI için)
 *   - NODE_ENV=production (CORS dev-only kapatma)
 */
import app from '../server/app.js';

// Vercel handler signature'ına net match: (req, res). Express app otomatik
// uyumlu ama wrapper bazı runtime farklılıklarında daha güvenli.
export default function handler(req, res) {
  return app(req, res);
}
