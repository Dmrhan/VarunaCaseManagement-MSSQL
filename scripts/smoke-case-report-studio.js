/**
 * smoke-case-report-studio.js — Phase 1 Report Studio HTTP smoke.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-case-report-studio.js
 *
 * Backend dev server (port 3101) ve seed agent gerekli:
 *   agent@varuna.dev / TEST_USER_PASSWORD
 *
 * Doğrulanan kontrat (5 senaryo):
 *   1. GET /api/reports/cases/columns: Core + Smart Ticket kategori dolu
 *   2. POST /preview: 3 kolon ile satır array'i + total döner
 *   3. POST /preview: columns boş → 400 columns_required
 *   4. POST /export: 200 + xlsx content type + Buffer (gz/zip imzası OK)
 *   5. POST /preview: filters.companyIds yetkisiz şirket → boş cevap (sızıntı yok)
 */

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

async function getToken(email) {
  const r = await fetch(`${BFF}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  const j = await r.json().catch(() => ({}));
  return j.accessToken || null;
}

async function api(token, path, init = {}) {
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers || {}),
  };
  const r = await fetch(`${BFF}${path}`, { ...init, headers });
  let data = null;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { data = await r.json(); } catch {}
  }
  return { status: r.status, headers: r.headers, data, raw: r };
}

console.log('── Setup ───────────────────────────────────────────────');
const token = await getToken('agent@varuna.dev');
if (!token) {
  console.log('⊘ agent login failed — skip');
  process.exit(0);
}

// ── 1) columns endpoint ─────────────────────────────────────
console.log('\n── 1) GET /api/reports/cases/columns ──');
{
  const r = await api(token, '/api/reports/cases/columns');
  if (r.status === 200 && Array.isArray(r.data?.columns) && r.data.columns.length > 0) {
    const ids = new Set(r.data.columns.map((c) => c.id));
    const coreOk = ids.has('caseNumber') && ids.has('title') && ids.has('status');
    const stOk = ids.has('st.platformLabel') && ids.has('st.closure.rootCauseGroupLabel');
    const draftOk = ids.has('st.aiDrafts.engineeringHandoff');
    if (coreOk && stOk && draftOk) {
      ok('1) columns Core + Smart Ticket + KB drafts içerir', `${r.data.columns.length} kolon`);
    } else {
      bad('1) Beklenen id eksik', `coreOk=${coreOk} stOk=${stOk} draftOk=${draftOk}`);
    }
  } else {
    bad('1) columns endpoint başarısız', `status=${r.status}`);
  }
}

// ── 2) preview 3 column ─────────────────────────────────────
console.log('\n── 2) POST /preview — 3 column ──');
{
  const r = await api(token, '/api/reports/cases/preview', {
    method: 'POST',
    body: JSON.stringify({
      columns: ['caseNumber', 'title', 'status'],
      page: 1,
      pageSize: 10,
    }),
  });
  if (
    r.status === 200 &&
    Array.isArray(r.data?.rows) &&
    typeof r.data?.total === 'number' &&
    Array.isArray(r.data?.columns) &&
    r.data.columns.length === 3
  ) {
    ok('2) preview 200 + rows + total + 3 column', `total=${r.data.total} rows=${r.data.rows.length}`);
  } else {
    bad('2) preview shape eksik', `status=${r.status} body=${JSON.stringify(r.data)?.slice(0, 100)}`);
  }
}

// ── 3) preview empty columns → 400 ──────────────────────────
console.log('\n── 3) POST /preview — empty columns 400 ──');
{
  const r = await api(token, '/api/reports/cases/preview', {
    method: 'POST',
    body: JSON.stringify({ columns: [] }),
  });
  if (r.status === 400 && r.data?.error === 'columns_required') {
    ok('3) 400 columns_required');
  } else {
    bad('3) Beklenen 400', `status=${r.status} error=${r.data?.error}`);
  }
}

// ── 4) export — xlsx content type + valid PK header ─────────
console.log('\n── 4) POST /export — xlsx download ──');
{
  const r = await fetch(`${BFF}/api/reports/cases/export`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ columns: ['caseNumber', 'title'] }),
  });
  const ct = r.headers.get('content-type') || '';
  if (r.status === 200 && ct.includes('spreadsheetml.sheet')) {
    const buf = Buffer.from(await r.arrayBuffer());
    // xlsx (zip) PK magic bytes: 50 4B
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      ok('4) xlsx Buffer + PK magic', `${buf.length} bytes`);
    } else {
      bad('4) xlsx Buffer magic eksik', `first2=${buf[0].toString(16)},${buf[1].toString(16)}`);
    }
  } else {
    bad('4) export başarısız', `status=${r.status} ct=${ct}`);
  }
}

// ── 5) yetkisiz company scope → boş cevap ───────────────────
console.log('\n── 5) POST /preview — yetkisiz companyIds → boş ──');
{
  const r = await api(token, '/api/reports/cases/preview', {
    method: 'POST',
    body: JSON.stringify({
      columns: ['caseNumber'],
      filters: { companyIds: ['__nonexistent_company__'] },
    }),
  });
  if (r.status === 200 && Array.isArray(r.data?.rows) && r.data.rows.length === 0 && r.data?.total === 0) {
    ok('5) Yetkisiz scope → 0 satır (sızıntı yok)');
  } else {
    bad('5) Beklenen boş cevap', `status=${r.status} rows=${r.data?.rows?.length} total=${r.data?.total}`);
  }
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
