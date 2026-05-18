/**
 * Calendar closed-case filter smoke (Recommendation B hotfix).
 *
 * Verifies that SLA / snooze / followup events are hidden for closed/cancelled
 * cases (Cozuldu, IptalEdildi), while reminders survive intentionally.
 *
 * Çalıştır: node --env-file=.env scripts/smoke-calendar-closed-case-filter.js
 *
 * Mutasyon: yarattığı vakaları + reminder'ı sonunda siler. Demo seed'e
 * dokunmaz; gerçek demo persona'nın personId/userId'sini kullanır.
 *
 * Senaryolar:
 *   1. Open Acik vaka + SLA today → sla_response + sla_resolution görünmeli
 *   2. Cozuldu vaka + SLA today → ASLA görünmemeli
 *   3. IptalEdildi vaka + SLA today → ASLA görünmemeli
 *   4. Cozuldu vaka için explicit CaseReminder → reminder görünmeli (intent korunur)
 *   5. Cozuldu vaka + snoozeUntil today → snooze ASLA görünmemeli
 *   6. Cozuldu vaka + nextFollowupDate today → followup ASLA görünmemeli
 */

import { prisma } from '../server/db/client.js';
import { listCalendarEvents } from '../server/db/myRepository.js';

const stamp = Date.now();
const PREFIX = `ccf-${stamp}`;
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const csm = await prisma.user.findUnique({
  where: { email: 'csm@varuna.dev' },
  select: { id: true, personId: true },
});
if (!csm?.personId) {
  console.error('csm@varuna.dev / personId not seeded');
  process.exit(1);
}
const csmLinks = await prisma.userCompany.findMany({
  where: { userId: csm.id, isActive: true },
  select: { companyId: true },
});
const scope = csmLinks.map((l) => l.companyId);
const companyId = scope[0];
if (!companyId) {
  console.error('csm has no UserCompany rows');
  process.exit(1);
}

// Bugün'ün ortasında bir SLA hedef saati.
const today = new Date();
today.setHours(0, 0, 0, 0);
const slaTime = new Date(today.getTime() + 12 * 60 * 60 * 1000); // bugün 12:00
const from = new Date(today.getTime() - 86400000).toISOString();
const to = new Date(today.getTime() + 86400000).toISOString();

function baseCase(status, extras = {}) {
  return {
    caseNumber: `${PREFIX}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    title: `${PREFIX} smoke`,
    description: 'smoke',
    caseType: 'GeneralSupport',
    status,
    priority: 'Medium',
    origin: 'Telefon',
    companyId,
    companyName: 'smoke',
    accountName: null,
    customerMatchPending: true,
    category: 'Yazılım',
    subCategory: 'Genel',
    requestType: 'Talep',
    assignedPersonId: csm.personId,
    slaViolation: false,
    ...extras,
  };
}

const caseIds = [];
const reminderIds = [];

try {
  // 1) Open + SLA today (response + resolution)
  const open = await prisma.case.create({
    data: baseCase('Acik', { slaResponseDueAt: slaTime, slaResolutionDueAt: slaTime }),
  });
  caseIds.push(open.id);

  // 2) Cozuldu + SLA today
  const cozuldu = await prisma.case.create({
    data: baseCase('Cozuldu', { slaResponseDueAt: slaTime, slaResolutionDueAt: slaTime }),
  });
  caseIds.push(cozuldu.id);

  // 3) IptalEdildi + SLA today
  const iptal = await prisma.case.create({
    data: baseCase('IptalEdildi', { slaResponseDueAt: slaTime, slaResolutionDueAt: slaTime }),
  });
  caseIds.push(iptal.id);

  // 4) Cozuldu + explicit reminder (reminder MUST survive)
  const cozuldu2 = await prisma.case.create({ data: baseCase('Cozuldu') });
  caseIds.push(cozuldu2.id);
  const rem = await prisma.caseReminder.create({
    data: {
      caseId: cozuldu2.id,
      userId: csm.id,
      companyId,
      message: `${PREFIX} reminder on closed`,
      remindAt: slaTime,
    },
  });
  reminderIds.push(rem.id);

  // 5) Cozuldu + snoozeUntil today (must be hidden)
  const cozuldu3 = await prisma.case.create({
    data: baseCase('Cozuldu', { snoozeUntil: slaTime, snoozeReason: 'Reminder' }),
  });
  caseIds.push(cozuldu3.id);

  // 6) Cozuldu + nextFollowupDate today (must be hidden)
  const cozuldu4 = await prisma.case.create({ data: baseCase('Cozuldu') });
  caseIds.push(cozuldu4.id);
  await prisma.caseCallLog.create({
    data: {
      caseId: cozuldu4.id,
      companyId,
      callerId: csm.id,
      callerName: 'smoke',
      callDate: today,
      durationMin: 1,
      description: 'smoke followup',
      nextFollowupDate: slaTime,
      callDisposition: 'Cevapladi',
      callOutcome: 'Memnun',
    },
  });

  // Listele
  const events = await listCalendarEvents({
    userId: csm.id,
    personId: csm.personId,
    allowedCompanyIds: scope,
    from,
    to,
  });

  // Bizimkilere indir
  const ours = events.filter(
    (e) =>
      caseIds.includes(e.caseId) ||
      (e.type === 'reminder' && reminderIds.some((r) => e.id === `reminder:${r}`)),
  );

  // 1) Open vaka → sla_response + sla_resolution görünmeli
  const openResp = ours.some((e) => e.caseId === open.id && e.type === 'sla_response');
  const openReso = ours.some((e) => e.caseId === open.id && e.type === 'sla_resolution');
  record('1. Acik vaka SLA response calendar\'da görünür', openResp);
  record('1b. Acik vaka SLA resolution calendar\'da görünür', openReso);

  // 2) Cozuldu vaka → SLA hiç görünmemeli
  const cozulduSla = ours.some(
    (e) => e.caseId === cozuldu.id && (e.type === 'sla_response' || e.type === 'sla_resolution'),
  );
  record('2. Cozuldu vaka SLA gizli (response + resolution)', !cozulduSla);

  // 3) IptalEdildi vaka → SLA hiç görünmemeli
  const iptalSla = ours.some(
    (e) => e.caseId === iptal.id && (e.type === 'sla_response' || e.type === 'sla_resolution'),
  );
  record('3. IptalEdildi vaka SLA gizli', !iptalSla);

  // 4) Cozuldu vaka için reminder → görünmeli (intent korunur)
  const remHit = ours.some(
    (e) => e.type === 'reminder' && e.id === `reminder:${rem.id}`,
  );
  record('4. Cozuldu vaka için explicit reminder görünür (intent korundu)', remHit);

  // 5) Cozuldu vaka + snooze → gizli
  const snoozeHit = ours.some((e) => e.caseId === cozuldu3.id && e.type === 'snooze');
  record('5. Cozuldu vaka snooze gizli', !snoozeHit);

  // 6) Cozuldu vaka + followup → gizli
  const fuHit = ours.some((e) => e.caseId === cozuldu4.id && e.type === 'followup');
  record('6. Cozuldu vaka followup gizli', !fuHit);
} catch (err) {
  console.error('smoke fatal:', err);
  results.push({ name: 'fatal', ok: false, detail: err?.message });
} finally {
  await prisma.caseReminder.deleteMany({ where: { id: { in: reminderIds } } }).catch(() => {});
  await prisma.caseCallLog.deleteMany({ where: { caseId: { in: caseIds } } }).catch(() => {});
  await prisma.case.deleteMany({ where: { id: { in: caseIds } } }).catch(() => {});
  await prisma.$disconnect();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('[smoke] FAILED:');
  failed.forEach((f) => console.log(`  - ${f.name} ${f.detail ?? ''}`));
  process.exitCode = 1;
} else {
  console.log('[smoke] ALL GREEN');
}
