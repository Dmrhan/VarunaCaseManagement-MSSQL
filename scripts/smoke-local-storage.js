/**
 * Local disk storage E2E smoke (Faz 4) — gerçek Express sunucusunu spawn edip
 * dosya upload/finalize/download/silme akışını HTTP üzerinden doğrular.
 *
 * Önkoşul: npm run db:seed:auth (agent@varuna.dev) ve seed (COMP-PARAM).
 * Çalıştırma: node --env-file=.env scripts/smoke-local-storage.js
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3198;
const BASE = `http://localhost:${PORT}/api`;
const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT || path.join(root, 'data', 'attachments'));

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
const api = (p, opts = {}, token) =>
  fetch(`${BASE}${p}`, {
    ...opts,
    headers: {
      ...(opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

let caseId = null;
let accessToken = null;

try {
  await waitForServer();
  check('server up', true);

  // login (agent — case create yetkisi var)
  const login = await j(await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'agent@varuna.dev', password: 'Test1234!' }) }));
  accessToken = login.accessToken;
  check('login', Boolean(accessToken));

  // test vakası aç
  const created = await j(await api('/cases', {
    method: 'POST',
    body: JSON.stringify({
      title: 'storage smoke case',
      description: 'faz4 local disk',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Web',
      requestType: 'Bilgi',
      companyId: 'COMP-PARAM',
      companyName: 'PARAM',
      category: 'Yazılım',
      subCategory: 'Genel',
    }),
  }, accessToken));
  caseId = created?.id;
  check('case create', Boolean(caseId), caseId ?? JSON.stringify(created).slice(0, 120));

  // 1) upload-url al
  const fileBytes = Buffer.from(`merhaba türkçe içerik ${Date.now()} — şğüöçİı`, 'utf8');
  const up = await j(await api(`/cases/${caseId}/files/upload-url`, {
    method: 'POST',
    body: JSON.stringify({ fileName: 'rapor özeti.txt', fileSize: fileBytes.length, mimeType: 'text/plain' }),
  }, accessToken));
  check('upload-url döner (token\'lı BFF yolu)', typeof up.uploadUrl === 'string' && up.uploadUrl.includes('/files/upload?token='), up.uploadUrl?.slice(0, 60));

  // 2) raw PUT — PR-4 follow-up sonrası JWT auth zorunlu (Codex P2 fix).
  // Authorization header taşımak frontend XHR ile aynı sözleşme.
  const putR = await fetch(`http://localhost:${PORT}${up.uploadUrl}`, {
    method: 'PUT',
    headers: {
      'content-type': 'text/plain',
      authorization: `Bearer ${accessToken}`,
    },
    body: fileBytes,
  });
  check('raw PUT 200', putR.status === 200, `status=${putR.status}`);

  // tampered token reddedilir (JWT auth ile)
  const badPut = await fetch(`http://localhost:${PORT}${up.uploadUrl}x`, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain', authorization: `Bearer ${accessToken}` },
    body: fileBytes,
  });
  check('bozuk token PUT 401', badPut.status === 401, `status=${badPut.status}`);

  // 3) finalize — PR-4 follow-up sonrası token zorunlu (backend match yapar).
  const fin = await j(await api(`/cases/${caseId}/files/finalize`, {
    method: 'POST',
    body: JSON.stringify({
      attachmentId: up.attachmentId,
      path: up.path,
      fileName: 'rapor özeti.txt',
      fileSize: fileBytes.length,
      mimeType: 'text/plain',
      token: up.token,
    }),
  }, accessToken));
  check('finalize DB satırı', fin?.file?.id === up.attachmentId, JSON.stringify(fin?.file ?? {}).slice(0, 100));

  // diskte gerçekten var mı
  const absPath = path.join(STORAGE_ROOT, up.path);
  check('dosya diskte', fs.existsSync(absPath), absPath);

  // 4) download URL + raw stream içerik doğrulama
  const dl = await j(await api(`/cases/${caseId}/files/${up.attachmentId}/download`, {}, accessToken));
  check('download URL döner', typeof dl.url === 'string' && dl.url.includes('/raw?token='));
  const rawR = await fetch(`http://localhost:${PORT}${dl.url}`); // header YOK — <a> tıklaması simülasyonu
  const body = Buffer.from(await rawR.arrayBuffer());
  check('raw indirme 200 + bytes eşit', rawR.status === 200 && body.equals(fileBytes), `len=${body.length}`);
  const cd = rawR.headers.get('content-disposition') ?? '';
  check('Content-Disposition filename* (TR)', cd.includes("filename*=UTF-8''"), cd.slice(0, 80));

  // bozuk token raw 401
  const badRaw = await fetch(`http://localhost:${PORT}${dl.url.replace('token=', 'token=x')}`);
  check('bozuk token raw 401', badRaw.status === 401);

  // 5) sil — DB satırı + disk dosyası
  const delR = await api(`/cases/${caseId}/files/${up.attachmentId}`, { method: 'DELETE' }, accessToken);
  check('dosya silme 200', delR.status === 200);
  check('disk dosyası silindi', !fs.existsSync(absPath));
} catch (e) {
  console.error('SMOKE ERROR', e);
  fail++;
} finally {
  // temizlik: test vakasını sil (cascade çocukları götürür)
  if (caseId) {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      await prisma.case.delete({ where: { id: caseId } });
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
