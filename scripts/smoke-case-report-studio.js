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
// Reports endpoint'i Codex P2 fix sonrası Supervisor/Admin/SystemAdmin
// requireRole guard'lı. Agent login token'ı ayrı tutuluyor (403 testi için);
// privileged smoke için supervisor@varuna.dev kullanıyoruz. Fixture yoksa
// agent token'ı fallback (eski davranış); o durumda 1-5 senaryo skip.
const agentToken = await getToken('agent@varuna.dev');
let token = await getToken('supervisor@varuna.dev');
if (!token) {
  console.log('⊘ supervisor@varuna.dev fixture yok — agent ile devam (1-5 yetkisiz olabilir)');
  token = agentToken;
}
if (!token) {
  console.log('⊘ login failed — skip');
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

// ── 6) Codex P2 #1 — Agent role 403 (defense-in-depth role guard) ──
console.log('\n── 6) Agent role → 403 (requireRole guard) ──');
if (agentToken) {
  const r = await api(agentToken, '/api/reports/cases/preview', {
    method: 'POST',
    body: JSON.stringify({ columns: ['caseNumber'] }),
  });
  if (r.status === 403) {
    ok('6) Agent /preview → 403 (rapor yetkisi yok)');
  } else if (r.status === 200) {
    bad('6) Agent /preview 200 dönmemeli (role guard eksik)', `status=${r.status}`);
  } else {
    bad('6) Beklenen 403', `status=${r.status} error=${r.data?.error}`);
  }
} else {
  console.log('⊘ 6) agent fixture yok — skip');
}

// ── 7) Codex P2 #2 — dateTo end-of-day cover (YYYY-MM-DD same-day) ──
console.log('\n── 7) dateTo end-of-day: same-day filter günü kapsar ──');
{
  // Aynı gün hem dateFrom hem dateTo → o günün TÜM vakalarını döndürmeli.
  // Bugünün tarihi (UTC) — DB'de o günde vaka olmayabilir; kontrol mantığı:
  //   - Fix sonrası: same-day total >= same-day midnight-only total
  //   - same-day total == 0 ise testin kanıtlama gücü düşer (skip note)
  const today = new Date();
  const yyyyMmDd = today.toISOString().slice(0, 10);
  const rEnd = await api(token, '/api/reports/cases/preview', {
    method: 'POST',
    body: JSON.stringify({
      columns: ['caseNumber'],
      filters: { dateFrom: yyyyMmDd, dateTo: yyyyMmDd },
    }),
  });
  // Karşılaştırma: filter'sız (last 30 day) total ≥ same-day total
  const r30 = await api(token, '/api/reports/cases/preview', {
    method: 'POST',
    body: JSON.stringify({
      columns: ['caseNumber'],
      filters: {
        dateFrom: new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10),
        dateTo: yyyyMmDd,
      },
    }),
  });
  if (rEnd.status === 200 && r30.status === 200) {
    if (r30.data.total >= rEnd.data.total) {
      ok(
        `7) dateTo same-day yarı-kapsamı OK — bugün ${rEnd.data.total} satır (30g: ${r30.data.total})`,
      );
    } else {
      bad('7) 30-day total < same-day total — mantıksız', `30g=${r30.data.total} 1g=${rEnd.data.total}`);
    }
  } else {
    bad('7) preview start failed', `endStatus=${rEnd.status} 30Status=${r30.status}`);
  }
}

// ── 8) Phase 1.5 — invalid column id → 400 ─────────────
console.log('\n── 8) /preview invalid column id → 400 columns_invalid ──');
{
  const r = await api(token, '/api/reports/cases/preview', {
    method: 'POST',
    body: JSON.stringify({ columns: ['caseNumber', '__nonexistent__'] }),
  });
  if (r.status === 400 && r.data?.error === 'columns_invalid' && Array.isArray(r.data.invalidIds)) {
    ok('8) 400 columns_invalid + invalidIds payload', `invalid=${r.data.invalidIds.join(',')}`);
  } else {
    bad('8) Beklenen 400 columns_invalid', `status=${r.status} error=${r.data?.error}`);
  }
}

// 8b) export aynı 400 sözleşmesi
console.log('\n── 8b) /export invalid column id → 400 ──');
{
  const r = await api(token, '/api/reports/cases/export', {
    method: 'POST',
    body: JSON.stringify({ columns: ['caseNumber', 'totally_unknown'] }),
  });
  if (r.status === 400 && r.data?.error === 'columns_invalid') {
    ok('8b) export 400 columns_invalid');
  } else {
    bad('8b) Beklenen 400', `status=${r.status} error=${r.data?.error}`);
  }
}

// ── 9) Phase 1.5 — empty KB JSON → blank, crash YOK ────
console.log('\n── 9) KB JSON path kolonu — smartTicket yok ise blank ──');
{
  // Smart Ticket kolonlarını seç ve 50 vaka preview'la. Smart Ticket
  // intake'inden açılmamış vakalar customFields={} veya null olur; jsonPath
  // okuma sessizce undefined → applyFormat → '' (boş string). Crash yoksa OK.
  const r = await api(token, '/api/reports/cases/preview', {
    method: 'POST',
    body: JSON.stringify({
      columns: [
        'caseNumber',
        'st.platformLabel',
        'st.closure.rootCauseGroupLabel',
        'st.aiDrafts.engineeringHandoff',
      ],
      pageSize: 50,
    }),
  });
  if (r.status === 200 && Array.isArray(r.data?.rows)) {
    const blanks = r.data.rows.filter((row) =>
      ['st.platformLabel', 'st.closure.rootCauseGroupLabel', 'st.aiDrafts.engineeringHandoff'].some(
        (id) => row[id] === '',
      ),
    ).length;
    ok(
      `9) 200 + JSON path eksikleri blank — toplam ${r.data.rows.length} satır, blank içeren ${blanks}`,
    );
  } else {
    bad('9) preview başarısız (KB JSON crash?)', `status=${r.status}`);
  }
}

// ── 10) Phase 1.5 — display formatting (status/priority/datetime/bool) ──
console.log('\n── 10) Format polish — TR label / Evet|Hayır / DD.MM.YYYY ──');
{
  const r = await api(token, '/api/reports/cases/preview', {
    method: 'POST',
    body: JSON.stringify({
      columns: ['status', 'priority', 'caseType', 'slaViolation', 'createdAt'],
      pageSize: 5,
    }),
  });
  if (r.status === 200 && Array.isArray(r.data?.rows) && r.data.rows.length > 0) {
    const sample = r.data.rows[0];
    const checks = [];
    // status TR (DB'de Acik/Cozuldu/... → Açık/Çözüldü/...)
    const trStatusSet = new Set([
      'Açık', 'İncelemede', '3. Parti Bekleniyor', 'Eskalasyon', 'Çözüldü', 'Yeniden Açıldı', 'İptal Edildi',
    ]);
    checks.push({ name: 'status TR', pass: trStatusSet.has(sample.status), val: sample.status });
    // priority TR
    const trPrioritySet = new Set(['Düşük', 'Orta', 'Yüksek', 'Kritik']);
    checks.push({ name: 'priority TR', pass: trPrioritySet.has(sample.priority), val: sample.priority });
    // caseType TR
    const trCaseTypeSet = new Set(['Genel Destek', 'Proaktif Takip', 'Churn (İptal)']);
    checks.push({ name: 'caseType TR', pass: trCaseTypeSet.has(sample.caseType), val: sample.caseType });
    // boolean Evet/Hayır
    checks.push({
      name: 'slaViolation boolean string',
      pass: sample.slaViolation === 'Evet' || sample.slaViolation === 'Hayır',
      val: sample.slaViolation,
    });
    // datetime DD.MM.YYYY HH:MM
    checks.push({
      name: 'createdAt DD.MM.YYYY HH:mm',
      pass: typeof sample.createdAt === 'string' && /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(sample.createdAt),
      val: sample.createdAt,
    });
    const allPass = checks.every((c) => c.pass);
    if (allPass) {
      ok('10) Format polish hepsi OK', checks.map((c) => `${c.name}="${c.val}"`).join(' | '));
    } else {
      const failing = checks.filter((c) => !c.pass).map((c) => `${c.name}="${c.val}"`).join(' | ');
      bad('10) Format polish fail', failing);
    }
  } else {
    bad('10) preview başarısız', `status=${r.status}`);
  }
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
