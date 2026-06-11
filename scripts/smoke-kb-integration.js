/**
 * KB entegrasyon E2E smoke (Faz KB) — ticket-analiz çekirdeğinin in-process
 * çalıştığını uçtan uca doğrular:
 *
 *   1. /api/v1/health (auth'suz) — sqlite + vec yüklemesi
 *   2. /api/v1/stats (Bearer) — tenant istatistikleri
 *   3. ExternalKbSetting'i self-process'e upsert eder (tüm aktif şirketler)
 *   4. /api/external-kb/health + search (JWT'li kullanıcı → BFF proxy → in-process v1)
 *   5. /api/external-kb/ask — gerçek RAG (Claude generation + sitasyon)
 *   6. /api/smart-ticket/suggest-classification — categorize-v2 zinciri
 *
 * Çalıştırma: node --env-file=.env scripts/smoke-kb-integration.js
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3197;
const BASE = `http://localhost:${PORT}`;

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fail++;
};

const apiKey = (process.env.API_KEYS ?? '').split(',')[0]?.split(':')[0];
if (!apiKey) {
  console.error('API_KEYS env yok'); process.exit(1);
}

const server = spawn(process.execPath, ['--env-file=.env', 'server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server açılmadı');
}

const j = (r) => r.json();

try {
  await waitForServer();

  // 1) in-process v1 health (auth yok)
  const h = await j(await fetch(`${BASE}/api/v1/health`));
  check('v1/health ok + kb sayıları', h.ok === true && h.kb.documents > 0,
    `docs=${h.kb?.documents} chunks=${h.kb?.chunks} embeds=${h.kb?.embeddings} vec=${h.kb?.vec_available}`);
  check('sqlite-vec yüklü', h.kb?.vec_available === true);

  // 2) v1/stats Bearer auth
  const noAuth = await fetch(`${BASE}/api/v1/stats`);
  check('stats auth\'suz 401', noAuth.status === 401);
  const stats = await j(await fetch(`${BASE}/api/v1/stats`, { headers: { authorization: `Bearer ${apiKey}` } }));
  check('stats tenant verisi', stats.tenant === 'varuna' && stats.documents > 0,
    `tenant=${stats.tenant} docs=${stats.documents} coverage=${(stats.embedding_coverage * 100).toFixed(1)}%`);

  // 3) ExternalKbSetting → self-process
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const companies = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
  for (const c of companies) {
    await prisma.externalKbSetting.upsert({
      where: { companyId: c.id },
      update: {
        enabled: true,
        providerName: 'Varuna KB (in-process)',
        baseUrl: `http://127.0.0.1:${process.env.PORT ?? 3101}`,
        authType: 'bearerToken',
        apiKeySecretName: 'EXTERNAL_KB_API_KEY',
      },
      create: {
        companyId: c.id,
        enabled: true,
        providerName: 'Varuna KB (in-process)',
        baseUrl: `http://127.0.0.1:${process.env.PORT ?? 3101}`,
        authType: 'bearerToken',
        apiKeySecretName: 'EXTERNAL_KB_API_KEY',
      },
    });
  }
  await prisma.$disconnect();
  check(`ExternalKbSetting ${companies.length} şirket için self-process'e ayarlandı`, true);

  // Bu smoke'un spawn ettiği süreç 3197'de — setting'i geçici olarak ona yönlendir
  // (proxy testi için). Gerçek üretim değeri yukarıda 3101 olarak yazıldı;
  // test sonunda geri 3101'e döner (zaten upsert öyle bıraktı → burada override).
  const prisma2 = new (await import('@prisma/client')).PrismaClient();
  await prisma2.externalKbSetting.updateMany({ data: { baseUrl: `http://127.0.0.1:${PORT}` } });

  // 4) JWT login → BFF external-kb proxy → in-process v1
  const login = await j(await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'sysadmin@varuna.dev', password: 'Test1234!' }),
  }));
  const tok = login.accessToken;
  const kbHealth = await j(await fetch(`${BASE}/api/external-kb/health?companyId=COMP-UNIVERA`, {
    headers: { authorization: `Bearer ${tok}` },
  }));
  check('external-kb/health proxy zinciri', kbHealth.ok === true && kbHealth.data?.kb?.documents > 0,
    JSON.stringify(kbHealth.error ?? kbHealth.data?.kb ?? {}).slice(0, 100));

  const search = await j(await fetch(`${BASE}/api/external-kb/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: JSON.stringify({ companyId: 'COMP-UNIVERA', query: 'fatura iptal etme', topK: 5 }),
  }));
  check('external-kb/search hibrit retrieval', search.ok === true && Array.isArray(search.data?.hits) && search.data.hits.length > 0,
    `hits=${search.data?.hits?.length} ilk="${(search.data?.hits?.[0]?.title ?? '').slice(0, 50)}"`);

  // 5) Gerçek RAG ask (Claude çağrısı — 1 adet)
  const askR = await j(await fetch(`${BASE}/api/external-kb/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: JSON.stringify({ companyId: 'COMP-UNIVERA', query: 'Panorama uygulamasında fatura nasıl iptal edilir?', topK: 5 }),
  }));
  const askOk = askR.ok === true && (askR.data?.refused === true || (typeof askR.data?.answer === 'string' && askR.data.answer.length > 20));
  check('external-kb/ask RAG cevabı (veya gerekçeli red)', askOk,
    askR.data?.refused ? `refused: ${askR.data?.reason?.slice(0, 80)}` : `answer ${askR.data?.answer?.length} kr, ${askR.data?.citations?.length} sitasyon`);

  // 6) Smart Ticket sınıflandırma zinciri (categorize-v2 → taxonomy map)
  const cls = await fetch(`${BASE}/api/smart-ticket/suggest-classification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: JSON.stringify({ companyId: 'COMP-UNIVERA', description: 'Panorama mobil satış ekranında sipariş kaydederken stok hatası alıyoruz, sipariş kaydedilemiyor.' }),
  });
  const clsBody = await j(cls);
  check('smart-ticket/suggest-classification (categorize-v2)', cls.status === 200 && clsBody.source === 'external_kb',
    cls.status === 200
      ? `öneri+unmatched=${Object.keys(clsBody.suggestions ?? {}).length}+${clsBody.unmatched?.length ?? 0}`
      : JSON.stringify(clsBody).slice(0, 120));

  // setting'i kalıcı üretim değerine geri çek (3101)
  await prisma2.externalKbSetting.updateMany({ data: { baseUrl: 'http://127.0.0.1:3101' } });
  await prisma2.$disconnect();
  check('setting üretim baseUrl\'üne (3101) geri alındı', true);
} catch (e) {
  console.error('SMOKE ERROR', e);
  fail++;
} finally {
  server.kill();
  console.log(fail === 0 ? '\nALL GREEN' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
}
