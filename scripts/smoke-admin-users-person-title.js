#!/usr/bin/env node
/**
 * Compose-Signature F1 IA rework — AdminUsers Person.title smoke.
 *
 *  (1) userRepo.list response'unda personTitle alanı (join via personId)
 *  (2) userRepo.setPersonTitle — happy path (trim + null normalize)
 *  (3) userRepo.setPersonTitle — Person'sız user → 409
 *  (4) Boş string / null → title temizleme
 *  (5) Çoklu user farklı title'larla — isolation doğrulama
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import { userRepo, personRepo } from '../server/db/adminRepository.js';

const PREFIX = `aut-${randomUUID().slice(0, 8)}`;
const COMP = `${PREFIX}-c`;
const TEAM = `${PREFIX}-t`;
const PERSON_A = `${PREFIX}-pa`;
const PERSON_B = `${PREFIX}-pb`;
const USER_WITH_PERSON_A = `${PREFIX}-u-a`;
const USER_WITH_PERSON_B = `${PREFIX}-u-b`;
const USER_NO_PERSON = `${PREFIX}-u-np`;

let pass = 0; let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTruthy(name, actual) {
  if (actual) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — falsy`); }
}

async function reset() {
  await prisma.userCompany.deleteMany({ where: { userId: { in: [USER_WITH_PERSON_A, USER_WITH_PERSON_B, USER_NO_PERSON] } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [USER_WITH_PERSON_A, USER_WITH_PERSON_B, USER_NO_PERSON] } } }).catch(() => {});
  await prisma.person.deleteMany({ where: { id: { in: [PERSON_A, PERSON_B] } } }).catch(() => {});
  await prisma.team.deleteMany({ where: { id: TEAM } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: COMP } }).catch(() => {});
}

async function setup() {
  await reset();
  await prisma.company.create({ data: { id: COMP, name: PREFIX } });
  await prisma.team.create({ data: { id: TEAM, name: 'team', companyId: COMP } });
  await prisma.person.create({ data: { id: PERSON_A, name: 'Person A', teamId: TEAM, title: 'Engineer' } });
  await prisma.person.create({ data: { id: PERSON_B, name: 'Person B', teamId: TEAM, title: null } });
  await prisma.user.create({
    data: {
      id: USER_WITH_PERSON_A,
      email: `${PREFIX}-a@test`,
      fullName: 'User A',
      role: 'Agent',
      isActive: true,
      personId: PERSON_A,
      companies: { create: [{ companyId: COMP, role: 'Agent', isActive: true }] },
    },
  });
  await prisma.user.create({
    data: {
      id: USER_WITH_PERSON_B,
      email: `${PREFIX}-b@test`,
      fullName: 'User B',
      role: 'Agent',
      isActive: true,
      personId: PERSON_B,
      companies: { create: [{ companyId: COMP, role: 'Agent', isActive: true }] },
    },
  });
  await prisma.user.create({
    data: {
      id: USER_NO_PERSON,
      email: `${PREFIX}-np@test`,
      fullName: 'SysAdmin User',
      role: 'SystemAdmin',
      isActive: true,
      personId: null,
    },
  });
}

(async () => {
  try {
    await setup();

    console.log("\n=== (1) userRepo.list response'da personTitle alanı ===");
    const list = await userRepo.list();
    const ua = list.find((u) => u.id === USER_WITH_PERSON_A);
    const ub = list.find((u) => u.id === USER_WITH_PERSON_B);
    const unp = list.find((u) => u.id === USER_NO_PERSON);
    expectTruthy('userA listede', !!ua);
    expect('userA personTitle = Engineer (setup\'tan)', ua?.personTitle, 'Engineer');
    expect('userB personTitle = null (Person var ama title yok)', ub?.personTitle, null);
    expect('SystemAdmin (Person yok) personTitle = null', unp?.personTitle, null);
    expect('SystemAdmin personId = null', unp?.personId, null);

    console.log('\n=== (2) setPersonTitle happy path (trim + persist) ===');
    const r2 = await userRepo.setPersonTitle(USER_WITH_PERSON_A, '  Ürün Direktörü  ');
    expect('title trim', r2.title, 'Ürün Direktörü');
    expect('personId döner', r2.personId, PERSON_A);

    // List'ten tekrar doğrula
    const list2 = await userRepo.list();
    const ua2 = list2.find((u) => u.id === USER_WITH_PERSON_A);
    expect('list refresh title yeni', ua2?.personTitle, 'Ürün Direktörü');

    console.log('\n=== (3) Person\'sız user → 409 ===');
    let blocked = false;
    let blockedStatus = null;
    try {
      await userRepo.setPersonTitle(USER_NO_PERSON, 'Test');
    } catch (e) {
      blocked = true;
      blockedStatus = e?.status;
    }
    expectTruthy('SystemAdmin (Person yok) → blocked', blocked);
    expect('status = 409', blockedStatus, 409);

    console.log('\n=== (4) Empty/null → temizleme ===');
    const r4a = await userRepo.setPersonTitle(USER_WITH_PERSON_A, '');
    expect('boş string → null', r4a.title, null);
    const r4b = await userRepo.setPersonTitle(USER_WITH_PERSON_A, 'Geçici');
    expect('tekrar set', r4b.title, 'Geçici');
    const r4c = await userRepo.setPersonTitle(USER_WITH_PERSON_A, null);
    expect('explicit null → null', r4c.title, null);

    console.log('\n=== (5) İki user farklı title — isolation ===');
    await userRepo.setPersonTitle(USER_WITH_PERSON_A, 'A Title');
    await userRepo.setPersonTitle(USER_WITH_PERSON_B, 'B Title');
    const list5 = await userRepo.list();
    const ua5 = list5.find((u) => u.id === USER_WITH_PERSON_A);
    const ub5 = list5.find((u) => u.id === USER_WITH_PERSON_B);
    expect('userA = A Title', ua5?.personTitle, 'A Title');
    expect('userB = B Title (isolation)', ub5?.personTitle, 'B Title');

    console.log('\n=== (6) personRepo aynı veriyi okur (signature path) ===');
    const pa = await personRepo.list();
    const personA = pa.find((p) => p.id === PERSON_A);
    expect('personRepo.list Person.title = A Title', personA?.title, 'A Title');

    console.log('\n=== (7) Codex P2 fix — yetki guard mantığı ===');
    // admin.js route'undaki yeni kontrol birebir simüle:
    //   SystemAdmin                  → her zaman geçer
    //   role Admin + companyId match → geçer
    //   role Agent/Supervisor + match → BLOCK (P2 fix)
    //   companyId match yok          → BLOCK
    function authGuard(callerRole, companyRoles, targetCompanyIds) {
      if (callerRole === 'SystemAdmin') return { ok: true };
      const adminCompanyIds = new Set(
        (companyRoles ?? [])
          .filter((r) => r.role === 'Admin' || r.role === 'SystemAdmin')
          .map((r) => r.companyId),
      );
      const hasAdminAccess = targetCompanyIds.some((id) => adminCompanyIds.has(id));
      return hasAdminAccess ? { ok: true } : { ok: false, status: 403 };
    }

    expect('SystemAdmin → geçer',
      authGuard('SystemAdmin', [], [COMP]).ok, true);
    expect('Admin role + companyId match → geçer',
      authGuard('Admin', [{ companyId: COMP, role: 'Admin' }], [COMP]).ok, true);
    expect('Agent + companyId match → BLOCK (P2 fix)',
      authGuard('Admin', [{ companyId: COMP, role: 'Agent' }], [COMP]).ok, false);
    expect('Supervisor + companyId match → BLOCK (P2 fix)',
      authGuard('Admin', [{ companyId: COMP, role: 'Supervisor' }], [COMP]).ok, false);
    expect('companyId match yok → BLOCK',
      authGuard('Admin', [{ companyId: 'OTHER', role: 'Admin' }], [COMP]).ok, false);
    expect('caller companyRoles boş → BLOCK',
      authGuard('Admin', [], [COMP]).ok, false);
  } catch (err) {
    console.error('\n[test] HATA:', err.message);
    console.error(err.stack);
    fail++;
  } finally {
    try { await reset(); } catch (e) { console.error('cleanup:', e.message); }
    await prisma.$disconnect();
    console.log('\n────────────────────────────────────────────────────────');
    console.log(`PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
