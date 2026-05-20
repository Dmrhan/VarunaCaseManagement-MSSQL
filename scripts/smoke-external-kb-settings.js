/**
 * smoke-external-kb-settings.js — WR-KB1
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-external-kb-settings.js
 *
 * Backend dev server (port 3101) ayakta olmalı. db:seed + db:seed:auth +
 * seed-full-demo-scenarios.js çalışmış olmalı.
 *
 * SADECE configuration ekranı için CRUD smoke'u. Hiçbir senaryo dış API
 * çağırmaz, secret depolamaz, NewCaseForm/CaseDetail/AI flow'u etkilemez.
 *
 * Senaryolar:
 *  1. Admin own-company default settings okuyabilir (enabled=false defaults)
 *  2. Admin enabled=false minimal config kaydedebilir
 *  3. Admin enabled=true + providerName/baseUrl/secret reference kaydedebilir
 *  4. Invalid timeoutMs (< 1000) → 400 invalid_timeout
 *  5. Invalid defaultTopK (> 20) → 400 invalid_top_k
 *  6. authType=apiKey ama apiKeySecretName boş → 400 secret_name_required
 *  7. Non-admin company role (Agent token) PATCH → 403
 *  8. SystemAdmin başka şirketi PATCH'leyebilir
 *  9. Cross-tenant companyId (admin scope dışı şirket) → 403
 * 10. DB veya response'ta raw API key alanı YOK (privacy)
 */

import { prisma } from '../server/db/client.js';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function getToken(email) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  const j = await r.json();
  return j.access_token || null;
}

async function api(token, path, init = {}) {
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers || {}),
  };
  const r = await fetch(`${BFF}${path}`, { ...init, headers });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

const adminToken      = await getToken('admin@varuna.dev');
const sysAdminToken   = await getToken('sysadmin@varuna.dev');
const agentToken      = await getToken('agent@varuna.dev');
if (!adminToken || !sysAdminToken) {
  console.log('SKIP — admin/sysadmin token yok');
  await prisma.$disconnect();
  process.exit(0);
}

const COMP_UNI = 'COMP-UNIVERA';
const COMP_PAR = 'COMP-PARAM';

// Cleanup: smoke sonrası UNIVERA + PARAM ExternalKbSetting'lerini sil.
const cleanupCompanyIds = [];

// ─────────────────────────────────────────────────────────────────
// 1) Admin own-company default settings reads → enabled=false defaults
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(adminToken, `/api/admin/external-kb-settings?companyId=${COMP_PAR}`);
  const ok = r.status === 200 &&
    r.data?.companyId === COMP_PAR &&
    r.data?.enabled === false &&
    r.data?.authType === 'none' &&
    r.data?.timeoutMs === 15000 &&
    r.data?.defaultTopK === 5 &&
    r.data?.showCitations === true;
  record(
    '1. Admin GET defaults → enabled=false, authType=none, timeout=15000, topK=5',
    ok,
    `status=${r.status} enabled=${r.data?.enabled} authType=${r.data?.authType}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 2) Admin saves enabled=false minimal config
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(adminToken, `/api/admin/external-kb-settings/${COMP_PAR}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false, providerName: 'Test Minimal' }),
  });
  cleanupCompanyIds.push(COMP_PAR);
  const ok = r.status === 200 &&
    r.data?.enabled === false &&
    r.data?.providerName === 'Test Minimal' &&
    !!r.data?.id;
  record(
    '2. Admin PATCH enabled=false minimal → 200',
    ok,
    `status=${r.status} providerName=${r.data?.providerName}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 3) Admin saves enabled=true + providerName + baseUrl + secret ref
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(adminToken, `/api/admin/external-kb-settings/${COMP_PAR}`, {
    method: 'PATCH',
    body: JSON.stringify({
      enabled: true,
      providerName: 'External Vector DB',
      baseUrl: 'https://kb.example.com',
      askEndpointPath: '/v1/ask',
      searchEndpointPath: '/v1/search',
      authType: 'apiKey',
      apiKeySecretName: 'EXTERNAL_KB_API_KEY',
      timeoutMs: 20000,
      defaultTopK: 8,
      showCitations: true,
      allowAgentUse: true,
      allowSupervisorUse: true,
      allowCsmUse: true,
      notes: 'Smoke test config',
    }),
  });
  const ok = r.status === 200 &&
    r.data?.enabled === true &&
    r.data?.providerName === 'External Vector DB' &&
    r.data?.baseUrl === 'https://kb.example.com' &&
    r.data?.authType === 'apiKey' &&
    r.data?.apiKeySecretName === 'EXTERNAL_KB_API_KEY' &&
    r.data?.timeoutMs === 20000 &&
    r.data?.defaultTopK === 8;
  record(
    '3. Admin PATCH full config → 200 + denorm',
    ok,
    `status=${r.status} authType=${r.data?.authType} timeout=${r.data?.timeoutMs} topK=${r.data?.defaultTopK}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 4) Invalid timeoutMs (< 1000) → 400 invalid_timeout
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(adminToken, `/api/admin/external-kb-settings/${COMP_PAR}`, {
    method: 'PATCH',
    body: JSON.stringify({ timeoutMs: 500 }),
  });
  record(
    '4. timeoutMs < 1000 → 400 invalid_timeout',
    r.status === 400 && r.data?.error === 'invalid_timeout',
    `status=${r.status} code=${r.data?.error}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 5) Invalid defaultTopK (> 20) → 400 invalid_top_k
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(adminToken, `/api/admin/external-kb-settings/${COMP_PAR}`, {
    method: 'PATCH',
    body: JSON.stringify({ defaultTopK: 999 }),
  });
  record(
    '5. defaultTopK > 20 → 400 invalid_top_k',
    r.status === 400 && r.data?.error === 'invalid_top_k',
    `status=${r.status} code=${r.data?.error}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 6) authType=apiKey ama apiKeySecretName boş → 400 secret_name_required
//    (önce mevcut secret'i temizleyip yeniden gönderir.)
// ─────────────────────────────────────────────────────────────────
{
  // Önce authType=none yapalım ki secret null'a düşsün, sonra apiKey ile boş gönder.
  await api(adminToken, `/api/admin/external-kb-settings/${COMP_PAR}`, {
    method: 'PATCH',
    body: JSON.stringify({ authType: 'none', apiKeySecretName: '' }),
  });
  const r = await api(adminToken, `/api/admin/external-kb-settings/${COMP_PAR}`, {
    method: 'PATCH',
    body: JSON.stringify({ authType: 'apiKey', apiKeySecretName: '' }),
  });
  record(
    '6. authType=apiKey + no secret → 400 secret_name_required',
    r.status === 400 && r.data?.error === 'secret_name_required',
    `status=${r.status} code=${r.data?.error}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 7) Non-admin company role (Agent token) PATCH → 403
//    Agent verifyJwt'den geçer ama admin route'larda requireRole('Admin',
//    'SystemAdmin') ile 403 alır.
// ─────────────────────────────────────────────────────────────────
{
  if (agentToken) {
    const r = await api(agentToken, `/api/admin/external-kb-settings/${COMP_PAR}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    });
    record(
      '7. Agent PATCH → 403',
      r.status === 403,
      `status=${r.status}`,
    );
  } else {
    record('7. Agent PATCH (no token)', false, 'skipped');
  }
}

// ─────────────────────────────────────────────────────────────────
// 8) SystemAdmin başka şirket PATCH'leyebilir
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(sysAdminToken, `/api/admin/external-kb-settings/${COMP_UNI}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false, providerName: 'SysAdmin UNI Test' }),
  });
  cleanupCompanyIds.push(COMP_UNI);
  record(
    '8. SystemAdmin cross-company PATCH → 200',
    r.status === 200 && r.data?.providerName === 'SysAdmin UNI Test',
    `status=${r.status} providerName=${r.data?.providerName}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 9) Cross-tenant — admin'in admin olmadığı bir şirkete PATCH
//    admin@varuna.dev seedAuth'a göre tüm 3 şirkette Admin; gerçek cross-
//    tenant reject testi için var olmayan companyId kullanırız (companyRoles
//    içinde yok → assertCompanyAdmin 403 atar).
// ─────────────────────────────────────────────────────────────────
{
  const fakeCompanyId = 'COMP-DOES-NOT-EXIST-XYZ';
  const r = await api(adminToken, `/api/admin/external-kb-settings/${fakeCompanyId}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false }),
  });
  record(
    '9. Cross-tenant fake companyId → 403',
    r.status === 403,
    `status=${r.status}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 10) Privacy: DB ve API response'unda raw API key alanı YOK
//     Sadece `apiKeySecretName` (referans adı) saklanır.
// ─────────────────────────────────────────────────────────────────
{
  const dbRow = await prisma.externalKbSetting.findUnique({
    where: { companyId: COMP_PAR },
  });
  const forbidden = ['apiKey', 'rawSecret', 'secret', 'token', 'bearer'];
  const dbLeak = dbRow ? forbidden.find((k) => k in dbRow) : null;
  const r = await api(adminToken, `/api/admin/external-kb-settings?companyId=${COMP_PAR}`);
  const apiLeak = r.data ? forbidden.find((k) => k in r.data) : null;
  record(
    '10. Privacy — no raw API key/secret/token in DB or API response',
    !dbLeak && !apiLeak,
    `dbLeak=${dbLeak ?? 'none'} apiLeak=${apiLeak ?? 'none'}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────
try {
  if (cleanupCompanyIds.length) {
    await prisma.externalKbSetting.deleteMany({
      where: { companyId: { in: cleanupCompanyIds } },
    });
  }
} catch (e) {
  console.warn('[cleanup]', e?.message);
}

await prisma.$disconnect();

const failures = results.filter((r) => !r.ok);
console.log(`\nResults: ${results.length - failures.length}/${results.length} ok`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name} — ${f.detail}`);
  process.exit(1);
}
