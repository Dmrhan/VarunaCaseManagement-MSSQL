// Faz 0 — AloTech baglanti/token testi. node --env-file=.env scripts/alotech-ping.mjs
import { getAccessToken, alotechConfig } from '../server/integrations/alotech/client.js';
console.log('Config:', { BASE_URL: alotechConfig.BASE_URL, TENANT: alotechConfig.TENANT || '(BOS)', hasCreds: alotechConfig.hasCreds });
if (!alotechConfig.TENANT || !alotechConfig.hasCreds) { console.log('\n.env eksik — ALOTECH_TENANT / ALOTECH_CLIENT_ID / ALOTECH_SECRET_KEY ekleyin.'); process.exit(0); }
try {
  const t = await getAccessToken();
  console.log('\n✓ TOKEN ALINDI (ilk 12 karakter):', String(t).slice(0, 12) + '...');
  console.log('Token uzunlugu:', String(t).length);
} catch (e) { console.error('\n✗ HATA:', e.message); process.exit(1); }
