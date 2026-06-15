/**
 * smoke-case-title-edit.js — feature/case-title-edit (Vaka Adı inline edit).
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-case-title-edit.js
 *
 * Backend dev server (port 3101) ve seed user'lar gerekli:
 *   - agent@varuna.dev          (Agent, personId dolu)
 *   - other-agent@varuna.dev    (Agent, başka kişi)
 *   - supervisor@varuna.dev     (Supervisor)
 *   - admin@varuna.dev          (Admin)
 *
 * Doğrulanan kontrat:
 *   1. Atanan agent kendi vakasının title'ını edit eder → 200, history'de FieldUpdate
 *   2. Başka agent edit → 403 title_forbidden
 *   3. Supervisor başkasının vakasını edit → 200
 *   4. Admin başkasının vakasını edit → 200
 *   5. Kapanmış vaka (status=Cozuldu) edit → 403 title_case_closed
 *   6. Boş title → 400 title_empty
 *   7. 201 karakter title → 400 title_too_long
 */

import { prisma } from '../server/db/client.js';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

let pass = 0;
let fail = 0;
const cleanupCaseIds = [];

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
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

async function pickAgentForEmail(email) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, personId: true, fullName: true },
  });
  if (!user) return null;
  const links = await prisma.userCompany.findMany({
    where: { userId: user.id, isActive: true },
    select: { companyId: true },
  });
  return { ...user, scope: links.map((l) => l.companyId) };
}

async function createCase({ companyId, assignedPersonId, status = 'Acik', title = '[smoke-title] başlangıç' }) {
  // assignedPersonName için person.name çek
  let assignedPersonName = null;
  if (assignedPersonId) {
    const p = await prisma.person.findUnique({ where: { id: assignedPersonId }, select: { name: true } });
    assignedPersonName = p?.name ?? null;
  }
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  const c = await prisma.case.create({
    data: {
      caseNumber: `SMOKE-TITLE-${Date.now().toString(36)}`,
      title,
      description: 'Vaka adı edit smoke fixture.',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Web',
      companyId,
      companyName: company?.name ?? companyId,
      category: 'Genel',
      subCategory: 'Genel',
      requestType: 'Talep',
      status,
      assignedPersonId,
      assignedPersonName,
    },
    select: { id: true, caseNumber: true, title: true, status: true, assignedPersonId: true },
  });
  cleanupCaseIds.push(c.id);
  return c;
}

async function patchTitle(token, caseId, title) {
  return api(token, `/api/cases/${caseId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────

console.log('── Setup ───────────────────────────────────────────────');
const agent = await pickAgentForEmail('agent@varuna.dev');
const otherAgent = await pickAgentForEmail('other-agent@varuna.dev');
const supervisor = await pickAgentForEmail('supervisor@varuna.dev');
const admin = await pickAgentForEmail('admin@varuna.dev');

if (!agent || !agent.personId || agent.scope.length === 0) {
  console.log('⊘ agent@varuna.dev fixture eksik — skip');
  process.exit(0);
}
const companyId = agent.scope[0];
const agentToken = await getToken('agent@varuna.dev');
const otherToken = otherAgent ? await getToken('other-agent@varuna.dev') : null;
const supervisorToken = supervisor ? await getToken('supervisor@varuna.dev') : null;
const adminToken = admin ? await getToken('admin@varuna.dev') : null;
if (!agentToken) { console.log('⊘ agent login failed — skip'); process.exit(0); }

// ─────────────────────────────────────────────────────────────
// Senaryolar
// ─────────────────────────────────────────────────────────────

console.log('\n── 1) Atanan agent kendi vakasının title\'ını edit eder ──');
{
  const c = await createCase({ companyId, assignedPersonId: agent.personId });
  const newTitle = '[smoke-title] yeni başlık ' + Date.now().toString(36);
  const r = await patchTitle(agentToken, c.id, newTitle);
  if (r.status === 200 && r.data?.title === newTitle) {
    const histCount = await prisma.caseActivity.count({
      where: { caseId: c.id, actionType: 'FieldUpdate', fieldName: 'title' },
    });
    if (histCount === 1) ok('1) PATCH 200 + FieldUpdate history yazıldı');
    else bad('1) History eksik', `count=${histCount}`);
  } else {
    bad('1) Title patch başarısız', `status=${r.status} title=${r.data?.title}`);
  }
}

console.log('\n── 2) Başka agent (atanmamış) edit → 403 ──');
if (otherToken && otherAgent?.personId) {
  const c = await createCase({ companyId, assignedPersonId: agent.personId });
  const r = await patchTitle(otherToken, c.id, '[smoke-title] yetkisiz girişim');
  if (r.status === 403 && r.data?.code === 'title_forbidden') ok('2) 403 title_forbidden');
  else bad('2) Beklenen 403', `status=${r.status} code=${r.data?.code}`);
} else {
  console.log('⊘ 2) other-agent fixture yok — skip');
}

console.log('\n── 3) Supervisor başkasının vakasını edit → 200 ──');
if (supervisorToken) {
  const c = await createCase({ companyId, assignedPersonId: agent.personId });
  const r = await patchTitle(supervisorToken, c.id, '[smoke-title] supervisor yazdı');
  if (r.status === 200) ok('3) Supervisor edit 200');
  else bad('3) Supervisor edit başarısız', `status=${r.status} code=${r.data?.code}`);
} else {
  console.log('⊘ 3) supervisor fixture yok — skip');
}

console.log('\n── 4) Admin başkasının vakasını edit → 200 ──');
if (adminToken) {
  const c = await createCase({ companyId, assignedPersonId: agent.personId });
  const r = await patchTitle(adminToken, c.id, '[smoke-title] admin yazdı');
  if (r.status === 200) ok('4) Admin edit 200');
  else bad('4) Admin edit başarısız', `status=${r.status} code=${r.data?.code}`);
} else {
  console.log('⊘ 4) admin fixture yok — skip');
}

console.log('\n── 5) Kapanmış vaka (Cozuldu) edit → 403 ──');
{
  const c = await createCase({
    companyId,
    assignedPersonId: agent.personId,
    status: 'Cozuldu',
  });
  const r = await patchTitle(agentToken, c.id, '[smoke-title] kapalıya yazma denemesi');
  if (r.status === 403 && r.data?.code === 'title_case_closed') ok('5) 403 title_case_closed');
  else bad('5) Beklenen 403 case_closed', `status=${r.status} code=${r.data?.code}`);
}

console.log('\n── 6) Boş title → 400 title_empty ──');
{
  const c = await createCase({ companyId, assignedPersonId: agent.personId });
  const r = await patchTitle(agentToken, c.id, '   ');
  if (r.status === 400 && r.data?.code === 'title_empty') ok('6) 400 title_empty');
  else bad('6) Beklenen 400 title_empty', `status=${r.status} code=${r.data?.code}`);
}

console.log('\n── 7) 201 karakter → 400 title_too_long ──');
{
  const c = await createCase({ companyId, assignedPersonId: agent.personId });
  const long = 'a'.repeat(201);
  const r = await patchTitle(agentToken, c.id, long);
  if (r.status === 400 && r.data?.code === 'title_too_long') ok('7) 400 title_too_long');
  else bad('7) Beklenen 400 title_too_long', `status=${r.status} code=${r.data?.code}`);
}

// ─────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────

console.log('\n── Cleanup ─────────────────────────────────────────────');
for (const id of cleanupCaseIds) {
  try {
    await prisma.caseActivity.deleteMany({ where: { caseId: id } });
    await prisma.case.delete({ where: { id } });
  } catch (err) {
    console.log(`⊘ cleanup ${id}: ${err?.message}`);
  }
}
console.log(`   ${cleanupCaseIds.length} case silindi`);

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
await prisma.$disconnect().catch(() => {});
process.exit(fail > 0 ? 1 : 0);
