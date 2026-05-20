/**
 * smoke-external-kb-console.js — WR-KB3
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-external-kb-console.js
 *
 * Bilgi Bankası external proxy console'unun BFF tarafını test eder.
 *
 * Senaryolar:
 *   1. Admin tüm endpoint path'leri kaydedebilir (incl. health/stats/categorize/analyze)
 *   2. settings-status response'unda raw secret YOK (sadece apiKeySecretName + boolean)
 *   3. Missing env secret → ask çağrısı external_kb_secret_missing
 *   4. enabled=false → ask çağrısı external_kb_disabled
 *   5. Agent denied if allowAgentUse=false
 *   6. Agent allowed if allowAgentUse=true (route 200 geçer; live çağrı atlanabilir)
 *   7. ask missing query → 400 invalid_query
 *   8. search missing query → 400 invalid_query
 *   9. categorize missing description → 400 invalid_description
 *  10. analyze missing freeText → 400 invalid_free_text
 *  11. ask invalid strictness → 400 invalid_strictness
 *  12. ask invalid sourceTypes → 400 invalid_source_types
 *  13. health live call returns wrapped {ok,...} or SKIP if tunnel unavailable
 *  14. stats live call returns wrapped {ok,...} or SKIP
 *  15. ask live call returns wrapped raw data or SKIP
 *  16. search live call returns wrapped raw data or SKIP
 *  17. categorize live call returns wrapped raw data or SKIP
 *  18. analyze live call returns wrapped raw data or SKIP
 *  19. Case row count unchanged before/after ask/categorize/analyze (no mutation)
 *  20. Source-level: CaseDetailPage/NewCaseForm/TransferModal/cases route untouched
 *
 * Live çağrılar için EXTERNAL_KB_SMOKE_LIVE=1 env flag gerekli. Aksi halde
 * 13-18 SKIP olur (P0/P1 smoke gerekli değil, kontrat onayı yeterli).
 */

import { readFileSync } from 'node:fs';
import { prisma } from '../server/db/client.js';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';
const LIVE = process.env.EXTERNAL_KB_SMOKE_LIVE === '1';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}
function skip(name, detail = '') {
  results.push({ name, ok: true, skipped: true, detail });
  console.log(`⊘ SKIP ${name}${detail ? ' — ' + detail : ''}`);
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

const adminToken = await getToken('admin@varuna.dev');
const agentToken = await getToken('agent@varuna.dev');
if (!adminToken) {
  console.log('SKIP — admin token yok');
  await prisma.$disconnect();
  process.exit(0);
}

const COMP_PAR = 'COMP-PARAM';

// Cleanup: smoke sonrası ExternalKbSetting'i sıfır state'e döndür.
const cleanupCompanyIds = [COMP_PAR];

// ─────────────────────────────────────────────────────────────────
// 1) Admin saves all endpoint paths + new fields
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(adminToken, `/api/admin/external-kb-settings/${COMP_PAR}`, {
    method: 'PATCH',
    body: JSON.stringify({
      enabled: false,
      providerName: 'Smoke EnRoute KB',
      baseUrl: 'https://example.invalid',
      askEndpointPath: '/api/v1/kb/ask',
      searchEndpointPath: '/api/v1/kb/search',
      healthEndpointPath: '/api/v1/health',
      statsEndpointPath: '/api/v1/stats',
      categorizeEndpointPath: '/api/v1/categorize',
      analyzeEndpointPath: '/api/v1/analyze',
      authType: 'apiKey',
      apiKeySecretName: 'EXTERNAL_KB_SMOKE_KEY',
      timeoutMs: 30000,
      defaultTopK: 8,
      defaultStrictness: 'lenient',
      defaultRerank: true,
      defaultVerify: true,
      allowAgentUse: true,
      allowSupervisorUse: true,
      allowCsmUse: true,
      notes: 'smoke',
    }),
  });
  const ok =
    r.status === 200 &&
    r.data?.healthEndpointPath === '/api/v1/health' &&
    r.data?.statsEndpointPath === '/api/v1/stats' &&
    r.data?.categorizeEndpointPath === '/api/v1/categorize' &&
    r.data?.analyzeEndpointPath === '/api/v1/analyze' &&
    r.data?.defaultStrictness === 'lenient' &&
    r.data?.defaultRerank === true &&
    r.data?.defaultVerify === true;
  record('1. Admin saves all endpoint paths + flags', ok, `status=${r.status}`);
}

// ─────────────────────────────────────────────────────────────────
// 2) settings-status response: no raw secret value
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(adminToken, `/api/external-kb/settings-status?companyId=${COMP_PAR}`);
  const forbidden = ['apiKey', 'rawSecret', 'secret', 'token', 'bearer'];
  const leak = r.data ? forbidden.find((k) => k in r.data) : null;
  // apiKeySecretName isim alanı OK (raw secret değil); ama process.env değeri response'a hiç sızmamalı
  record(
    '2. settings-status no raw secret',
    r.status === 200 && !leak,
    `leak=${leak ?? 'none'} secretConfigured=${r.data?.secretConfigured}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 3) Missing env secret → enabled true ile ask → external_kb_secret_missing
// ─────────────────────────────────────────────────────────────────
{
  // Setting'i enabled=true yapalım fakat EXTERNAL_KB_SMOKE_KEY env yok.
  await prisma.externalKbSetting.update({
    where: { companyId: COMP_PAR },
    data: { enabled: true },
  });
  // Env'de bu key olmadığını assume ediyoruz; LIVE flag açıkken bile bu özel
  // smoke key'i process.env'de yoksa missing dönmeli.
  delete process.env.EXTERNAL_KB_SMOKE_KEY;
  const r = await api(adminToken, '/api/external-kb/ask', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, query: 'smoke test query' }),
  });
  // Wrapped error 200 döndüğü için status=200 ve ok:false bekleriz.
  record(
    '3. Missing env secret → external_kb_secret_missing',
    r.status === 200 && r.data?.ok === false && r.data?.error?.code === 'external_kb_secret_missing',
    `status=${r.status} code=${r.data?.error?.code}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 4) enabled=false → ask returns disabled response
// ─────────────────────────────────────────────────────────────────
{
  await prisma.externalKbSetting.update({
    where: { companyId: COMP_PAR },
    data: { enabled: false },
  });
  const r = await api(adminToken, '/api/external-kb/ask', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, query: 'smoke test query' }),
  });
  record(
    '4. enabled=false → external_kb_disabled',
    r.status === 200 && r.data?.ok === false && r.data?.error?.code === 'external_kb_disabled',
    `status=${r.status} code=${r.data?.error?.code}`,
  );
}

// Setting'i tekrar enabled yap ki sonraki testler çalışsın.
await prisma.externalKbSetting.update({
  where: { companyId: COMP_PAR },
  data: { enabled: true, authType: 'none' },
});

// ─────────────────────────────────────────────────────────────────
// 5) Agent denied if allowAgentUse=false
// ─────────────────────────────────────────────────────────────────
{
  await prisma.externalKbSetting.update({
    where: { companyId: COMP_PAR },
    data: { allowAgentUse: false },
  });
  if (agentToken) {
    const r = await api(agentToken, '/api/external-kb/ask', {
      method: 'POST',
      body: JSON.stringify({ companyId: COMP_PAR, query: 'smoke test query' }),
    });
    record(
      '5. Agent denied when allowAgentUse=false',
      r.status === 403 && r.data?.error?.code === 'external_kb_forbidden',
      `status=${r.status} code=${r.data?.error?.code}`,
    );
  } else {
    skip('5. Agent denied (no agent token)');
  }
}

// ─────────────────────────────────────────────────────────────────
// 6) Agent allowed if allowAgentUse=true
//    (gerçek upstream çağrı olmadığı için route 200/wrapped-error iki taraflı kabul)
// ─────────────────────────────────────────────────────────────────
{
  await prisma.externalKbSetting.update({
    where: { companyId: COMP_PAR },
    data: { allowAgentUse: true },
  });
  if (agentToken) {
    const r = await api(agentToken, '/api/external-kb/ask', {
      method: 'POST',
      body: JSON.stringify({ companyId: COMP_PAR, query: 'smoke test query' }),
    });
    // 403 KULLANILAMAZ; gerçek API olmadığı için ya 200 (proxy başlamış + connect fail
    // → wrapped ok:false) ya da 200 (proxy + 200 + data). Önemli olan 403 OLMAMASI.
    record(
      '6. Agent allowed when allowAgentUse=true (route geçti)',
      r.status === 200 && r.data?.error?.code !== 'external_kb_forbidden',
      `status=${r.status} code=${r.data?.error?.code ?? 'ok'}`,
    );
  } else {
    skip('6. Agent allowed (no agent token)');
  }
}

// ─────────────────────────────────────────────────────────────────
// 7-10) Validation errors
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(adminToken, '/api/external-kb/ask', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR }), // no query
  });
  record(
    '7. ask missing query → 400 invalid_query',
    r.status === 400 && r.data?.error?.code === 'invalid_query',
    `status=${r.status} code=${r.data?.error?.code}`,
  );
}
{
  const r = await api(adminToken, '/api/external-kb/search', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR }),
  });
  record(
    '8. search missing query → 400 invalid_query',
    r.status === 400 && r.data?.error?.code === 'invalid_query',
    `status=${r.status} code=${r.data?.error?.code}`,
  );
}
{
  const r = await api(adminToken, '/api/external-kb/categorize', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR }),
  });
  record(
    '9. categorize missing description → 400 invalid_description',
    r.status === 400 && r.data?.error?.code === 'invalid_description',
    `status=${r.status} code=${r.data?.error?.code}`,
  );
}
{
  const r = await api(adminToken, '/api/external-kb/analyze', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR }),
  });
  record(
    '10. analyze missing freeText → 400 invalid_free_text',
    r.status === 400 && r.data?.error?.code === 'invalid_free_text',
    `status=${r.status} code=${r.data?.error?.code}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 11-12) ask invalid strictness / sourceTypes
// ─────────────────────────────────────────────────────────────────
{
  const r = await api(adminToken, '/api/external-kb/ask', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, query: 'smoke test query', strictness: 'bogus' }),
  });
  record(
    '11. ask invalid strictness → 400 invalid_strictness',
    r.status === 400 && r.data?.error?.code === 'invalid_strictness',
    `status=${r.status} code=${r.data?.error?.code}`,
  );
}
{
  const r = await api(adminToken, '/api/external-kb/ask', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, query: 'smoke test query', sourceTypes: ['not_in_allowlist'] }),
  });
  record(
    '12. ask invalid sourceTypes → 400 invalid_source_types',
    r.status === 400 && r.data?.error?.code === 'invalid_source_types',
    `status=${r.status} code=${r.data?.error?.code}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 13-18) Live calls (LIVE env flag gerekli)
// ─────────────────────────────────────────────────────────────────
const liveScenarios = [
  ['13. health live', 'GET', '/api/external-kb/health?companyId=' + COMP_PAR, undefined],
  ['14. stats live',  'GET', '/api/external-kb/stats?companyId=' + COMP_PAR, undefined],
  ['15. ask live',         'POST', '/api/external-kb/ask',        { companyId: COMP_PAR, query: 'smoke kb ask' }],
  ['16. search live',      'POST', '/api/external-kb/search',     { companyId: COMP_PAR, query: 'smoke kb search' }],
  ['17. categorize live',  'POST', '/api/external-kb/categorize', { companyId: COMP_PAR, description: 'smoke categorize description' }],
  ['18. analyze live',     'POST', '/api/external-kb/analyze',    { companyId: COMP_PAR, freeText: 'smoke analyze text' }],
];
for (const [name, method, path, body] of liveScenarios) {
  if (!LIVE) {
    skip(name, 'EXTERNAL_KB_SMOKE_LIVE flag set değil');
    continue;
  }
  const r = await api(adminToken, path, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
  // Wrapped response (ok:true/false fark etmez; ÖNEMLİ olan envelop'ın gelmesi)
  const wrapped =
    r.status === 200 &&
    r.data &&
    typeof r.data.ok === 'boolean' &&
    r.data.rawSource === 'enroute-kb';
  record(name, wrapped, `status=${r.status} ok=${r.data?.ok}`);
}

// ─────────────────────────────────────────────────────────────────
// 19) No case mutation between ask/categorize/analyze
// ─────────────────────────────────────────────────────────────────
{
  const before = await prisma.case.count();
  await api(adminToken, '/api/external-kb/ask', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, query: 'no mutation smoke' }),
  });
  await api(adminToken, '/api/external-kb/categorize', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, description: 'no mutation smoke desc' }),
  });
  await api(adminToken, '/api/external-kb/analyze', {
    method: 'POST',
    body: JSON.stringify({ companyId: COMP_PAR, freeText: 'no mutation smoke text' }),
  });
  const after = await prisma.case.count();
  record(
    '19. Case row count unchanged before/after KB calls',
    before === after,
    `before=${before} after=${after}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// 20) Source-level guard: untouched files
// ─────────────────────────────────────────────────────────────────
{
  const untouched = [
    'src/features/cases/CaseDetailPage.tsx',
    'src/features/cases/NewCaseForm.tsx',
    'src/features/cases/components/TransferModal.tsx',
    'server/routes/cases.js',
  ];
  // Spot-check: KB feature kelimelerini bu dosyalarda aramayalım. Yalnız
  // konuyla doğrudan ilgili token'ları (externalKb, ExternalKb, kb-viewer)
  // bu dosyalarda görmek istemeyiz.
  const banned = ['externalKb', 'ExternalKb', 'KnowledgeBaseAsk'];
  let leaked = [];
  for (const path of untouched) {
    try {
      const text = readFileSync(path, 'utf-8');
      for (const b of banned) {
        if (text.includes(b)) leaked.push(`${path}:${b}`);
      }
    } catch (e) {
      // file missing — skip
      void e;
    }
  }
  record(
    '20. CaseDetail/NewCaseForm/TransferModal untouched (no KB token leakage)',
    leaked.length === 0,
    leaked.length === 0 ? 'clean' : leaked.join(', '),
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
const skipped = results.filter((r) => r.skipped);
console.log(`\nResults: ${results.length - failures.length - skipped.length} ok, ${skipped.length} skipped, ${failures.length} fail (of ${results.length})`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name} — ${f.detail}`);
  process.exit(1);
}
