/**
 * Diagnostic: Demo Agent MyHome dashboard 0-count audit.
 * Sadece sayım, mutasyon yok.
 */

import { prisma } from '../server/db/client.js';

async function main() {
  console.log('🔍 Demo Agent MyHome diagnostics\n');

  const user = await prisma.user.findUnique({
    where: { email: 'agent@varuna.dev' },
    select: { id: true, email: true, role: true, personId: true, isActive: true },
  });
  console.log('User:', JSON.stringify(user, null, 2));

  if (!user) return;

  const links = await prisma.userCompany.findMany({
    where: { userId: user.id, isActive: true },
    select: { companyId: true, role: true },
  });
  const allowedCompanyIds = links.map((l) => l.companyId);
  console.log('UserCompany:', JSON.stringify(links, null, 2));
  console.log('allowedCompanyIds:', allowedCompanyIds);

  // Person
  if (user.personId) {
    const person = await prisma.person.findUnique({
      where: { id: user.personId },
      select: { id: true, name: true, email: true, teamId: true, isActive: true },
    });
    console.log('\nPerson:', JSON.stringify(person, null, 2));
  } else {
    console.log('\nPerson: User.personId NULL');
  }

  // Case counts
  console.log('\n--- Case counts ---');
  const inAllowed = await prisma.case.count({ where: { companyId: { in: allowedCompanyIds } } });
  console.log(`Cases in allowedCompanyIds: ${inAllowed}`);

  if (user.personId) {
    const assignedById = await prisma.case.count({
      where: { assignedPersonId: user.personId, companyId: { in: allowedCompanyIds } },
    });
    console.log(`Cases assignedPersonId=${user.personId} (scope): ${assignedById}`);
  }

  const assignedByName = await prisma.case.count({
    where: { assignedPersonName: 'Demo Agent', companyId: { in: allowedCompanyIds } },
  });
  console.log(`Cases assignedPersonName='Demo Agent' (scope): ${assignedByName}`);

  const unassigned = await prisma.case.count({
    where: { assignedPersonId: null, companyId: { in: allowedCompanyIds } },
  });
  console.log(`Cases unassigned (scope): ${unassigned}`);

  // Assigned distribution
  console.log('\n--- Assigned distribution (scope) ---');
  const dist = await prisma.case.groupBy({
    by: ['assignedPersonId', 'assignedPersonName'],
    where: { companyId: { in: allowedCompanyIds } },
    _count: { _all: true },
  });
  for (const r of dist) {
    console.log(`  ${r.assignedPersonName ?? '(unassigned)'} [${r.assignedPersonId ?? '-'}]: ${r._count._all}`);
  }

  // Open statuses + today resolved + snooze + today calls
  console.log('\n--- KPI snapshot (Agent expected metrics) ---');
  const OPEN = ['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi'];
  if (user.personId) {
    const openAssignedMe = await prisma.case.count({
      where: {
        assignedPersonId: user.personId,
        companyId: { in: allowedCompanyIds },
        status: { in: OPEN },
      },
    });
    console.log(`Bana atanan (open): ${openAssignedMe}`);
  }
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  if (user.personId) {
    const resolvedToday = await prisma.case.count({
      where: {
        assignedPersonId: user.personId,
        companyId: { in: allowedCompanyIds },
        status: 'Cozuldu',
        resolvedAt: { gte: todayStart, lt: todayEnd },
      },
    });
    console.log(`Bugün çözdüm: ${resolvedToday}`);
    const snoozed = await prisma.case.count({
      where: {
        assignedPersonId: user.personId,
        companyId: { in: allowedCompanyIds },
        status: 'Acik', // snooze case prefix model — yine de bakalım
        slaPausedAt: { not: null },
      },
    });
    console.log(`Ertelenenler (paused): ${snoozed}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('diag error:', err);
  process.exit(1);
});
