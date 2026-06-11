/**
 * Tek seferlik (Faz 5): API smoke'larındaki Supabase token alma desenini
 * local auth login'e çevirir.
 *
 *   eski: fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, ...)
 *   yeni: fetch(`${BFF}/api/auth/login`, ...) → { accessToken }
 *
 * Kullanım: node scripts/convert-smokes-local-auth.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

let converted = 0;
for (const f of files) {
  const p = path.join(dir, f);
  let src = fs.readFileSync(p, 'utf8');
  if (!src.includes('auth/v1/token?grant_type=password')) continue;

  const hasTestPassword = /const TEST_PASSWORD\b/.test(src);
  const pwExpr = hasTestPassword ? 'TEST_PASSWORD' : "process.env.TEST_USER_PASSWORD || 'Test1234!'";

  // getToken fonksiyonunu komple değiştir (top-level — kapanış `}` satır başında)
  const fnRe = /async function getToken\(([^)]*)\)\s*\{[\s\S]*?\n\}/;
  if (!fnRe.test(src)) {
    console.warn(`SKIP (getToken bulunamadı): ${f}`);
    continue;
  }
  src = src.replace(fnRe, (_m, params) => {
    const firstParam = (params.split(',')[0] || 'email').trim() || 'email';
    return `async function getToken(${params}) {
  // Faz 5 — local auth: BFF /api/auth/login (Supabase token akışı kaldırıldı)
  const authBase = process.env.BFF_URL || process.env.BASE_URL || 'http://localhost:3101';
  const r = await fetch(\`\${authBase}/api/auth/login\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ${firstParam}, password: ${pwExpr} }),
  });
  const j = await r.json().catch(() => ({}));
  return j.accessToken || null;
}`;
  });

  // Artık kullanılmayan Supabase sabitlerini kaldır
  src = src.replace(/const SUPABASE_URL = process\.env\.SUPABASE_URL;\r?\n/g, '');
  src = src.replace(/const SUPABASE_ANON_KEY = process\.env\.(VITE_)?SUPABASE_ANON_KEY;\r?\n/g, '');

  fs.writeFileSync(p, src, 'utf8');
  converted++;
  console.log(`converted: ${f}`);
}
console.log(`done. converted: ${converted}`);
