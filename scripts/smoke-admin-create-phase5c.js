#!/usr/bin/env node
/**
 * smoke-admin-create-phase5c.js — Phase 5C admin create coverage.
 *
 * Half-Shipped Audit candidate PC-110: four admin create flows (Teams,
 * SLA, Checklists, Categories) were suspect for `400 companyId required`
 * regressions after the multi-tenant companyId picker landed. This smoke
 * exercises each POST happy path + the negative "missing companyId"
 * guard so that future routing/handler changes can't silently break them.
 *
 * Run:
 *   node --env-file=.env scripts/smoke-admin-create-phase5c.js
 *
 * Side effects: creates 4 rows then deletes them. No leftover state.
 *
 * Coverage (positive + negative):
 *   1. POST /api/admin/teams w/ companyId         → 201
 *   2. POST /api/admin/teams w/o companyId        → 4xx
 *   3. POST /api/admin/sla-policies w/ companyId  → 201
 *   4. POST /api/admin/sla-policies w/o companyId → 4xx
 *   5. POST /api/admin/checklists w/ companyId    → 201
 *   6. POST /api/admin/checklists w/o companyId   → 4xx
 *   7. POST /api/admin/categories w/ companyId    → 201
 *   8. POST /api/admin/categories w/o companyId   → 4xx (non-SystemAdmin)
 */
import { PrismaClient } from '@prisma/client';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

const prisma = new PrismaClient();
const results = [];
const record = (label, ok, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

async function getToken(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  if (!r.ok) throw new Error(`getToken(${email}) failed: ${r.status}`);
  return (await r.json()).access_token;
}

async function api(token, path, init = {}) {
  const r = await fetch(`${BFF}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const data = await r.json().catch(() => null);
  return { status: r.status, data };
}

const TEST_PREFIX = `smoke-pc5c-${Date.now()}`;
const cleanup = {
  teamIds: [],
  slaIds: [],
  checklistIds: [],
  categoryIds: [],
};

try {
  // Use a Company Admin (Univera) — Phase 5C is the per-tenant admin path.
  // SystemAdmin has a separate code branch for categories.
  const adminToken = await getToken('admin@varuna.dev');
  const userRow = await prisma.user.findUnique({
    where: { email: 'admin@varuna.dev' },
    select: { id: true },
  });
  if (!userRow) throw new Error('admin@varuna.dev user not found');
  const allowed = await prisma.userCompany.findMany({
    where: { userId: userRow.id },
    select: { companyId: true, company: { select: { name: true } } },
  });
  if (allowed.length === 0) throw new Error('admin has no allowed companies');
  const companyId = allowed[0].companyId;
  const companyName = allowed[0].company.name;
  console.log(`[smoke] using companyId=${companyId} (${companyName})`);

  // ─── 1) Teams ─────────────────────────────────────────────────────
  console.log('\n── Teams ──');
  const teamR1 = await api(adminToken, '/api/admin/teams', {
    method: 'POST',
    body: JSON.stringify({
      companyId,
      name: `${TEST_PREFIX}-team`,
      description: 'PR-5 coverage smoke',
    }),
  });
  record('1. POST /admin/teams w/ companyId → 201',
    teamR1.status === 201,
    `status=${teamR1.status} error=${teamR1.data?.error ?? '-'}`);
  if (teamR1.status === 201) cleanup.teamIds.push(teamR1.data.id);

  const teamR2 = await api(adminToken, '/api/admin/teams', {
    method: 'POST',
    body: JSON.stringify({ name: `${TEST_PREFIX}-team-orphan` }),
  });
  record('2. POST /admin/teams w/o companyId → 4xx',
    teamR2.status >= 400 && teamR2.status < 500,
    `status=${teamR2.status} error=${teamR2.data?.error ?? '-'}`);

  // ─── 3) SLA Policies ──────────────────────────────────────────────
  console.log('\n── SLA Policies ──');
  const slaR1 = await api(adminToken, '/api/admin/sla-policies', {
    method: 'POST',
    body: JSON.stringify({
      companyId,
      companyName,
      productGroup: `${TEST_PREFIX}-pg`,
      categoryName: `${TEST_PREFIX}-cat`,
      subCategoryName: `${TEST_PREFIX}-sub`,
      requestType: 'Talep',
      responseHours: 4,
      resolutionHours: 24,
    }),
  });
  record('3. POST /admin/sla-policies w/ companyId → 201',
    slaR1.status === 201,
    `status=${slaR1.status} error=${slaR1.data?.error ?? '-'}`);
  if (slaR1.status === 201) cleanup.slaIds.push(slaR1.data.id);

  const slaR2 = await api(adminToken, '/api/admin/sla-policies', {
    method: 'POST',
    body: JSON.stringify({
      companyName,
      productGroup: `${TEST_PREFIX}-pg`,
      categoryName: `${TEST_PREFIX}-cat`,
      subCategoryName: `${TEST_PREFIX}-sub-orphan`,
      requestType: 'Talep',
      responseHours: 4,
      resolutionHours: 24,
    }),
  });
  record('4. POST /admin/sla-policies w/o companyId → 4xx',
    slaR2.status >= 400 && slaR2.status < 500,
    `status=${slaR2.status} error=${slaR2.data?.error ?? '-'}`);

  // ─── 5) Checklists ────────────────────────────────────────────────
  console.log('\n── Checklists ──');
  const chkR1 = await api(adminToken, '/api/admin/checklists', {
    method: 'POST',
    body: JSON.stringify({
      companyId,
      companyName,
      productGroup: `${TEST_PREFIX}-pg`,
      categoryName: `${TEST_PREFIX}-cat`,
      name: `${TEST_PREFIX}-checklist`,
      items: [{ id: 'i1', label: 'Step 1', required: true, isActive: true }],
    }),
  });
  record('5. POST /admin/checklists w/ companyId → 201',
    chkR1.status === 201,
    `status=${chkR1.status} error=${chkR1.data?.error ?? '-'}`);
  if (chkR1.status === 201) cleanup.checklistIds.push(chkR1.data.id);

  const chkR2 = await api(adminToken, '/api/admin/checklists', {
    method: 'POST',
    body: JSON.stringify({
      companyName,
      productGroup: `${TEST_PREFIX}-pg`,
      categoryName: `${TEST_PREFIX}-cat-orphan`,
      name: `${TEST_PREFIX}-checklist-orphan`,
      items: [],
    }),
  });
  record('6. POST /admin/checklists w/o companyId → 4xx',
    chkR2.status >= 400 && chkR2.status < 500,
    `status=${chkR2.status} error=${chkR2.data?.error ?? '-'}`);

  // ─── 7) Categories (per-tenant; null companyId requires SystemAdmin) ──
  console.log('\n── Categories ──');
  const catR1 = await api(adminToken, '/api/admin/categories', {
    method: 'POST',
    body: JSON.stringify({
      companyId,
      name: `${TEST_PREFIX}-cat`,
      description: 'PR-5 coverage smoke',
    }),
  });
  record('7. POST /admin/categories w/ companyId → 201',
    catR1.status === 201,
    `status=${catR1.status} error=${catR1.data?.error ?? '-'}`);
  if (catR1.status === 201) cleanup.categoryIds.push(catR1.data.id);

  const catR2 = await api(adminToken, '/api/admin/categories', {
    method: 'POST',
    body: JSON.stringify({ name: `${TEST_PREFIX}-cat-orphan` }),
  });
  record('8. POST /admin/categories w/o companyId (non-SystemAdmin) → 4xx',
    catR2.status >= 400 && catR2.status < 500,
    `status=${catR2.status} error=${catR2.data?.error ?? '-'}`);
} finally {
  // Cleanup
  for (const id of cleanup.teamIds) {
    try { await prisma.team.delete({ where: { id } }); } catch { /* ignore */ }
  }
  for (const id of cleanup.slaIds) {
    try { await prisma.sLAPolicy.delete({ where: { id } }); } catch { /* ignore */ }
  }
  for (const id of cleanup.checklistIds) {
    try { await prisma.checklistTemplate.delete({ where: { id } }); } catch { /* ignore */ }
  }
  for (const id of cleanup.categoryIds) {
    try { await prisma.categoryDef.delete({ where: { id } }); } catch { /* ignore */ }
  }
  await prisma.$disconnect();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log('[smoke] FAILED:');
  for (const f of failed) console.log(`  - ${f.label} — ${f.detail}`);
  process.exit(1);
}
console.log('[smoke] ALL GREEN');
