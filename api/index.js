/**
 * Vercel serverless entry — tüm /api/* istekleri Express app'e yönlendirilir.
 *
 * vercel.json'da `/api/(.*)` → `/api` rewrite kuralı bu dosyayı catch-all
 * yapar. Express app server/app.js'ten import edilir (listen yok).
 *
 * Production'da:
 *   - frontend Vite static build (dist/) → Vercel CDN
 *   - /api/* istekleri → rewrite → bu function → Express → routes/*
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
