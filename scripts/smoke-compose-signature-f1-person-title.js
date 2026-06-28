#!/usr/bin/env node
/**
 * Compose-Signature F1 — Person.title (additive) smoke.
 *
 *  (1) Schema kolonu var (migration 21 uygulanmış)
 *  (2) personRepo.create title kabul eder (trimmed)
 *  (3) personRepo.update title set/clear (null kabul + boş string → null)
 *  (4) Geri uyum: title vermeyen create/update mevcut davranışı bozmuyor
 *  (5) Person fetch satırı title ile birlikte dönüyor
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import { personRepo, teamRepo } from '../server/db/adminRepository.js';

const PREFIX = `cs-f1-${randomUUID().slice(0, 8)}`;
const COMP = `${PREFIX}-comp`;
const TEAM = `${PREFIX}-team`;

let pass = 0; let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}

async function reset() {
  await prisma.person.deleteMany({ where: { teamId: TEAM } }).catch(() => {});
  await prisma.team.deleteMany({ where: { id: TEAM } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: COMP } }).catch(() => {});
}

async function setup() {
  await reset();
  await prisma.company.create({ data: { id: COMP, name: `${PREFIX}-comp` } });
  await prisma.team.create({ data: { id: TEAM, name: `${PREFIX}-team`, companyId: COMP } });
}

(async () => {
  try {
    await setup();

    console.log('\n=== (1) Schema kolon var (raw query) ===');
    const cols = await prisma.$queryRawUnsafe(
      `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('Person') AND name = 'title'`,
    );
    expect('Person.title kolonu DB\'de var', Array.isArray(cols) && cols.length === 1, true);

    console.log('\n=== (2) Create with title (trimmed) ===');
    const p1 = await personRepo.create({
      name: 'Ali Veli',
      teamId: TEAM,
      title: '  Ürün Direktörü  ',
    });
    expect('p1.name', p1.name, 'Ali Veli');
    expect('p1.title trimmed', p1.title, 'Ürün Direktörü');

    console.log('\n=== (3) Update title set + clear ===');
    const p1u1 = await personRepo.update(p1.id, { title: 'Kıdemli Mühendis' });
    expect('update set title', p1u1.title, 'Kıdemli Mühendis');

    // Empty string → null (temizleme)
    const p1u2 = await personRepo.update(p1.id, { title: '' });
    expect('empty string → null', p1u2.title, null);

    // Explicit null → null
    const p1u3 = await personRepo.update(p1.id, { title: 'Yeni Unvan' });
    expect('set tekrar', p1u3.title, 'Yeni Unvan');
    const p1u4 = await personRepo.update(p1.id, { title: null });
    expect('null kabul', p1u4.title, null);

    console.log('\n=== (4) Geri uyum: title vermeden create/update ===');
    const p2 = await personRepo.create({
      name: 'Ahmet Yılmaz',
      teamId: TEAM,
    });
    expect('p2 create title yokken default null', p2.title, null);
    expect('p2.name korundu', p2.name, 'Ahmet Yılmaz');

    // Update title field'ı patch'te yoksa korunur
    await personRepo.update(p2.id, { title: 'Test Title' });
    const p2u = await personRepo.update(p2.id, { name: 'Ahmet Yılmaz Updated' });
    expect('update title patch\'te yoksa korunur', p2u.title, 'Test Title');
    expect('update name patch\'i geçti', p2u.name, 'Ahmet Yılmaz Updated');

    console.log('\n=== (5) list/fetch title döner ===');
    const list = await personRepo.list();
    const found = list.find((p) => p.id === p2.id);
    expect('list satırı title field içeriyor', found?.title, 'Test Title');
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
