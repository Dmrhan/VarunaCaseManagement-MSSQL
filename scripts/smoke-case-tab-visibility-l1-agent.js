/**
 * smoke-case-tab-visibility-l1-agent.js — L1 Agent sekme bazlı görünürlük +
 * read-only aksiyon kuralı smoke harness (F1-F4).
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-case-tab-visibility-l1-agent.js
 *
 * Backend dev server ayakta olmalı (BFF_URL env ile port override edilebilir).
 *
 * Doğrulanan kontrat:
 *   1. Tümü (inboxTab=all): şirket scope'taki hem kendine hem başkasına
 *      atanmış vakalar görünür (read-only geniş görünürlük).
 *   2. Açık (inboxTab=open): yalnız assignedPersonId=kendisi olan açık
 *      vakalar görünür; başkasına atanmış açık vaka görünmez.
 *   3. Kapalı (inboxTab=closed): kendine atanmış + actorUserId kendisi olan
 *      + mentionedUserId kendisi olan kapalı vakalar görünür; ilişkisiz
 *      kapalı vaka görünmez.
 *   4. Transfer: kendine atanmış vakayı devredebilir; başkasına atanmış
 *      vakayı devretmeye çalışırsa 403.
 *   5. Regresyon: Supervisor listesi hâlâ çalışıyor.
 */

import { prisma } from '../server/db/client.js';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

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

const cleanupCaseIds = [];

async function main() {
  console.log('\n── 0) Fixture doğrulama ──');
  const agentUser = await prisma.user.findUnique({
    where: { email: 'agent@varuna.dev' },
    select: { id: true, personId: true, fullName: true, role: true },
  });
  const otherAgentUser = await prisma.user.findUnique({
    where: { email: 'other-agent@varuna.dev' },
    select: { id: true, personId: true, fullName: true },
  });
  record('0a. agent@varuna.dev bulundu + personId var', !!agentUser?.personId);
  record('0b. other-agent@varuna.dev bulundu + personId var', !!otherAgentUser?.personId);
  if (!agentUser?.personId || !otherAgentUser?.personId) {
    console.log('SKIP — fixture eksik, devam edilemiyor.');
    return;
  }

  const agentPerson = await prisma.person.findUnique({
    where: { id: agentUser.personId },
    select: { teamId: true, isTeamLead: true, supportLevel: true, team: { select: { companyId: true } } },
  });
  const canSeeTeamPool =
    agentPerson?.isTeamLead === true || ['L2', 'L3'].includes(agentPerson?.supportLevel ?? '');
  const isPlainL1 = !!agentPerson?.teamId && !canSeeTeamPool;
  record(
    '0c. agent@varuna.dev sıradan L1 (teamId var, isTeamLead=false, supportLevel L1)',
    isPlainL1,
    `teamId=${agentPerson?.teamId} isTeamLead=${agentPerson?.isTeamLead} supportLevel=${agentPerson?.supportLevel}`,
  );
  if (!isPlainL1) {
    console.log('SKIP — agent@varuna.dev artık "sıradan L1" değil, fixture güncellenmeli.');
    return;
  }

  const companyId = agentPerson.team.companyId;
  const agentToken = await getToken('agent@varuna.dev');
  record('0d. agent token alındı', !!agentToken);

  async function makeCase({ status, assignedPersonId, assignedPersonName, suffix }) {
    const c = await prisma.case.create({
      data: {
        caseNumber: `SMOKE-L1TAB-${suffix}-${Date.now().toString(36)}`,
        title: `L1 tab visibility smoke — ${suffix}`,
        description: 'Smoke fixture — smoke-case-tab-visibility-l1-agent.js',
        caseType: 'GeneralSupport',
        priority: 'Medium',
        origin: 'Web',
        companyId,
        companyName: companyId,
        category: 'Genel',
        subCategory: 'Genel',
        requestType: 'Talep',
        status,
        assignedPersonId,
        assignedPersonName,
      },
      select: { id: true, caseNumber: true },
    });
    cleanupCaseIds.push(c.id);
    return c;
  }

  const caseMine = await makeCase({ status: 'Acik', assignedPersonId: agentUser.personId, assignedPersonName: agentUser.fullName, suffix: 'mine-open' });
  const caseOtherOpen = await makeCase({ status: 'Acik', assignedPersonId: otherAgentUser.personId, assignedPersonName: otherAgentUser.fullName, suffix: 'other-open' });
  const caseMineClosed = await makeCase({ status: 'Cozuldu', assignedPersonId: agentUser.personId, assignedPersonName: agentUser.fullName, suffix: 'mine-closed' });
  const caseUnrelatedClosed = await makeCase({ status: 'Cozuldu', assignedPersonId: otherAgentUser.personId, assignedPersonName: otherAgentUser.fullName, suffix: 'unrelated-closed' });
  const caseActorClosed = await makeCase({ status: 'Cozuldu', assignedPersonId: otherAgentUser.personId, assignedPersonName: otherAgentUser.fullName, suffix: 'actor-closed' });
  await prisma.caseActivity.create({
    data: { caseId: caseActorClosed.id, companyId, action: 'Smoke fixture activity', actionType: 'FieldUpdate', actor: agentUser.fullName ?? 'agent', actorUserId: agentUser.id },
  });
  const caseMentionClosed = await makeCase({ status: 'Cozuldu', assignedPersonId: otherAgentUser.personId, assignedPersonName: otherAgentUser.fullName, suffix: 'mention-closed' });
  const smokeNote = await prisma.caseNote.create({
    data: { caseId: caseMentionClosed.id, companyId, body: 'Smoke fixture note — @agent mention.', authorUserId: agentUser.id, authorName: agentUser.fullName ?? 'agent' },
    select: { id: true },
  });
  await prisma.caseMention.create({
    data: { caseId: caseMentionClosed.id, noteId: smokeNote.id, companyId, mentionedUserId: agentUser.id, mentionedBy: otherAgentUser.id },
  });

  console.log('\n── 1) inboxTab=all ──');
  {
    const r = await api(agentToken, `/api/cases?inboxTab=all&pageSize=200`);
    const ids = (r.data?.value ?? []).map((c) => c.id);
    record('1a. 200 döner', r.status === 200, `status=${r.status}`);
    record('1b. Kendine atanmış vaka görünür', ids.includes(caseMine.id));
    record('1c. Başkasına atanmış vaka görünür (read-only geniş görünürlük)', ids.includes(caseOtherOpen.id));
  }

  console.log('\n── 2) inboxTab=open ──');
  {
    const r = await api(agentToken, `/api/cases?inboxTab=open&statuses=Acik&pageSize=200`);
    const ids = (r.data?.value ?? []).map((c) => c.id);
    record('2a. 200 döner', r.status === 200, `status=${r.status}`);
    record('2b. Kendine atanmış açık vaka görünür', ids.includes(caseMine.id));
    record('2c. Başkasına atanmış açık vaka GÖRÜNMEZ', !ids.includes(caseOtherOpen.id));
  }

  console.log('\n── 3) inboxTab=closed ──');
  {
    const r = await api(agentToken, `/api/cases?inboxTab=closed&statuses=Cozuldu&pageSize=200`);
    const ids = (r.data?.value ?? []).map((c) => c.id);
    record('3a. 200 döner', r.status === 200, `status=${r.status}`);
    record('3b. Kendine atanmış kapalı vaka görünür', ids.includes(caseMineClosed.id));
    record('3c. actorUserId=kendisi olan kapalı vaka görünür', ids.includes(caseActorClosed.id));
    record('3d. mentionedUserId=kendisi olan kapalı vaka görünür', ids.includes(caseMentionClosed.id));
    record('3e. İlişkisiz kapalı vaka GÖRÜNMEZ', !ids.includes(caseUnrelatedClosed.id));
  }

  console.log('\n── 4) Transfer ──');
  {
    const rMine = await api(agentToken, `/api/cases/${caseMine.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toTeamId: agentPerson.teamId, reason: 'Smoke — kendi vakamı devrediyorum' }),
    });
    record('4a. Kendine atanmış vakayı devredebilir (403 DEĞİL)', rMine.status !== 403, `status=${rMine.status}`);

    const rOther = await api(agentToken, `/api/cases/${caseOtherOpen.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toTeamId: agentPerson.teamId, reason: 'Smoke — başkasının vakasını devretmeye çalışıyorum' }),
    });
    record('4b. Başkasına atanmış vakayı devretmeye çalışınca 403', rOther.status === 403, `status=${rOther.status}`);
  }

  console.log('\n── 5) Regresyon ──');
  {
    const supToken = await getToken('supervisor@varuna.dev');
    if (supToken) {
      const r = await api(supToken, `/api/cases?pageSize=5`);
      record('5a. Supervisor listesi hâlâ 200 dönüyor', r.status === 200, `status=${r.status}`);
    } else {
      record('5a. Supervisor listesi hâlâ 200 dönüyor', false, 'supervisor token alınamadı — SKIP sayılmalı');
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    record('FATAL', false, e?.message);
  })
  .finally(async () => {
    try {
      if (cleanupCaseIds.length > 0) {
        await prisma.case.deleteMany({ where: { id: { in: cleanupCaseIds } } });
      }
    } catch (e) {
      console.warn('[cleanup]', e?.message);
    }
    await prisma.$disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed.`);
    if (failed.length > 0) {
      console.log('Failed:', failed.map((f) => f.name).join(', '));
      process.exitCode = 1;
    }
  });
