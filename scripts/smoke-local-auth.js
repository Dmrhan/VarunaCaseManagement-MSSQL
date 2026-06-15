/**
 * Local auth E2E smoke (Faz 3) — gerçek Express sunucusunu spawn edip
 * HTTP üzerinden login/me/refresh/change-password/admin akışlarını doğrular.
 *
 * Önkoşul: npm run db:seed:auth (demo personalar) çalıştırılmış olmalı.
 * Çalıştırma: node --env-file=.env scripts/smoke-local-auth.js
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3199; // dev sunucusuyla çakışmasın
const BASE = `http://localhost:${PORT}/api`;

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fail++;
};

const server = spawn(process.execPath, ['--env-file=.env', 'server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* henüz açılmadı */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server 20s içinde açılmadı');
}

const j = (r) => r.json();
const post = (p, body, token) =>
  fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
const get = (p, token) =>
  fetch(`${BASE}${p}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

const SUF = Math.random().toString(36).slice(2, 8);
let createdUserId = null;

try {
  await waitForServer();
  check('server up (/api/health)', true);

  // 1) Yanlış şifre → 401 generic
  const bad = await post('/auth/login', { email: 'agent@varuna.dev', password: 'yanlis-sifre' });
  check('yanlış şifre 401', bad.status === 401, `status=${bad.status}`);

  // 2) Doğru login → token + user
  const loginR = await post('/auth/login', { email: 'agent@varuna.dev', password: 'Test1234!' });
  const login = await j(loginR);
  check('login 200 + tokenlar', loginR.status === 200 && !!login.accessToken && !!login.refreshToken);
  check('login user payload', login.user?.email === 'agent@varuna.dev' && login.user?.role === 'Agent');

  // 3) /me — token ile
  const me = await j(await get('/auth/me', login.accessToken));
  check('/me kimliği döner', me.id === login.user.id && me.mustChangePassword === false);

  // 4) token'sız korumalı endpoint → 401
  const noTok = await get('/auth/me');
  check('tokensız /me 401', noTok.status === 401);

  // 5) refresh → yeni tokenlar
  const refR = await post('/auth/refresh', { refreshToken: login.refreshToken });
  const ref = await j(refR);
  check('refresh 200 + yeni access', refR.status === 200 && !!ref.accessToken);

  // 6) korumalı iş endpoint'i (cases listesi) — verifyJwt + tenant scope zinciri
  const casesR = await get('/cases?pageSize=1', ref.accessToken);
  check('GET /cases auth zinciri çalışıyor', casesR.status === 200, `status=${casesR.status}`);

  // 7) Admin: kullanıcı oluştur (sysadmin ile)
  const sysLogin = await j(await post('/auth/login', { email: 'sysadmin@varuna.dev', password: 'Test1234!' }));
  const createR = await post('/admin/users', {
    email: `smoke-auth-${SUF}@varuna.dev`,
    fullName: 'Smoke Auth User',
    role: 'Agent',
    companyId: 'COMP-PARAM',
    companyRole: 'Agent',
    password: 'GeciciSifre1!',
  }, sysLogin.accessToken);
  const created = await j(createR);
  createdUserId = created.userId ?? null;
  check('admin kullanıcı oluşturma 201', createR.status === 201 && !!created.userId, JSON.stringify(created).slice(0, 120));

  // 8) Yeni kullanıcı geçici şifreyle girer; mustChangePassword=true
  const newLogin = await j(await post('/auth/login', { email: `smoke-auth-${SUF}@varuna.dev`, password: 'GeciciSifre1!' }));
  check('yeni kullanıcı login + mustChangePassword', newLogin.user?.mustChangePassword === true);

  // 9) change-password → bayrak temizlenir, yeni şifreyle girilir
  const chR = await post('/auth/change-password', { currentPassword: 'GeciciSifre1!', newPassword: 'YeniSifre2@' }, newLogin.accessToken);
  const ch = await j(chR);
  check('change-password 200 + bayrak temiz', chR.status === 200 && ch.user?.mustChangePassword === false);
  const relogin = await post('/auth/login', { email: `smoke-auth-${SUF}@varuna.dev`, password: 'YeniSifre2@' });
  check('yeni şifreyle login', relogin.status === 200);
  const oldPw = await post('/auth/login', { email: `smoke-auth-${SUF}@varuna.dev`, password: 'GeciciSifre1!' });
  check('eski şifre artık reddedilir', oldPw.status === 401);

  // 10) Admin reset-password → mustChangePassword tekrar true
  const resetR = await post(`/admin/users/${created.userId}/reset-password`, { password: 'ResetSifre3#' }, sysLogin.accessToken);
  check('admin reset-password 200', resetR.status === 200);
  const afterReset = await j(await post('/auth/login', { email: `smoke-auth-${SUF}@varuna.dev`, password: 'ResetSifre3#' }));
  check('reset sonrası geçici şifre + bayrak', afterReset.user?.mustChangePassword === true);

  // 11) Deactivate bariyeri: pasif kullanıcının token'ı 403
  const deact = await fetch(`${BASE}/admin/users/${created.userId}/deactivate`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${sysLogin.accessToken}` },
  });
  check('deactivate 200', deact.status === 200);
  const blocked = await get('/auth/me', afterReset.accessToken);
  check('pasif kullanıcının cached token\'ı 403', blocked.status === 403, `status=${blocked.status}`);
  const blockedLogin = await post('/auth/login', { email: `smoke-auth-${SUF}@varuna.dev`, password: 'ResetSifre3#' });
  check('pasif kullanıcı login 403', blockedLogin.status === 403);

  // 12) Agent admin endpoint'ine erişemez (requireRole)
  const forbidden = await post('/admin/users', { email: 'x@y.dev' }, login.accessToken);
  check('Agent /admin/users 403', forbidden.status === 403);
} catch (e) {
  console.error('SMOKE ERROR', e);
  fail++;
} finally {
  // temizlik: oluşturulan kullanıcıyı sil
  if (createdUserId) {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      await prisma.userCompany.deleteMany({ where: { userId: createdUserId } });
      await prisma.user.delete({ where: { id: createdUserId } });
      await prisma.$disconnect();
      check('cleanup', true);
    } catch (e) {
      check('cleanup', false, e.message);
    }
  }
  server.kill();
  console.log(fail === 0 ? '\nALL GREEN' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
}
