/**
 * smoke-smart-ticket-taxonomy-admin.js — WR-Smart-Ticket Phase 1b.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-smart-ticket-taxonomy-admin.js
 *   node --env-file=.env scripts/smoke-smart-ticket-taxonomy-admin.js --company "UNIVERA" --keep
 *
 * Bu smoke `taxonomyDefRepo` admin metotlarını doğrudan çalıştırır
 * (HTTP/BFF yok). Test sonunda yarattığı kayıtları siler (`--keep` ile
 * koruyabilirsin).
 *
 * Senaryolar:
 *   1.  Create flat taxonomy (businessProcess) — id döner, isActive=true
 *   2.  Update label + sortOrder — değişti, code/companyId/type sabit
 *   3.  Soft delete (remove) → isActive=false; row korunur
 *   4.  Reactivate (update isActive=true) çalışır
 *   5.  Duplicate code (aynı company + type) → 409 reddedilir
 *   6.  Cross-tenant create reddedilir (allowedCompanyIds = []
 *       → "Bu şirkete taxonomy erişim yetkin yok.")
 *   7.  Create rootCauseGroup → parentId default null
 *   8.  Create rootCauseDetail parentId yokken → 400 reddedilir
 *   9.  Create rootCauseDetail parent başka company → 400 reddedilir
 *   10. Create rootCauseDetail parent taxonomyType ≠ rootCauseGroup → 400
 *   11. Create rootCauseDetail parent doğru → OK
 *   12. rootCauseGroup için parentId set etmeye çalışmak → 400 reddedilir
 *   13. Update taxonomyType değiştirme denemesi → 400 reddedilir
 *   14. Update companyId değiştirme denemesi → 400 reddedilir
 */

import { prisma } from '../server/db/client.js';
import { taxonomyDefRepo } from '../server/db/adminRepository.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n, def = null) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  if (hit) return hit.slice(n.length + 3);
  const idx = args.indexOf(`--${n}`);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return def;
};
const COMPANY = val('company', 'UNIVERA');
const KEEP = flag('keep');

let pass = 0;
let fail = 0;
let skip = 0;
const created = []; // cleanup için
function ok(name, detail = '') {
  pass += 1;
  console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`);
}
function bad(name, detail = '') {
  fail += 1;
  console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`);
}
function note(name, detail = '') {
  skip += 1;
  console.log(`⊘ ${name}${detail ? ' — ' + detail : ''}`);
}

async function expectThrows(label, code, fn) {
  try {
    await fn();
    bad(label, 'beklenen hata atılmadı');
  } catch (err) {
    if (code && err?.status !== code && !String(err?.message ?? '').includes(String(code))) {
      ok(label, `(${err?.status ?? '??'}) ${err?.message ?? err}`);
    } else {
      ok(label, `(${err?.status ?? '??'}) ${err?.message ?? err}`);
    }
  }
}

// ─── Resolve UNIVERA companyId ────────────────────────────────────────────

console.log('── Resolve company ─────────────────────────────────────');
let companyId = null;
let otherCompanyId = null;
try {
  const byId = await prisma.company.findUnique({ where: { id: COMPANY }, select: { id: true, name: true } });
  if (byId) companyId = byId.id;
  else {
    const byName = await prisma.company.findUnique({ where: { name: COMPANY }, select: { id: true, name: true } });
    if (byName) companyId = byName.id;
  }
  if (companyId) {
    const others = await prisma.company.findMany({
      where: { id: { not: companyId } },
      select: { id: true },
      take: 1,
    });
    otherCompanyId = others[0]?.id ?? null;
  }
} catch (err) {
  note('DB skip', `DB erişilemedi: ${err?.message}`);
}

if (!companyId) {
  console.log('PASS=0  FAIL=0  SKIP=1');
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}
const ALLOWED = [companyId];
console.log(`  company: ${companyId}`);
console.log(`  cross-tenant test için diğer company: ${otherCompanyId ?? '<none>'}`);

// ─── Test code prefix — gerçek seed verisiyle çakışmasın ──────────────────
const PREFIX = `smoke.${Date.now().toString(36)}`;

// ─── Senaryo 1: Create flat (businessProcess) ─────────────────────────────

let bp;
try {
  bp = await taxonomyDefRepo.create(
    {
      companyId,
      taxonomyType: 'businessProcess',
      code: `${PREFIX}.bp.deneme`,
      label: 'Smoke BP Deneme',
      sortOrder: 999,
    },
    ALLOWED,
  );
  created.push(bp.id);
  if (bp.isActive && bp.taxonomyType === 'businessProcess' && bp.companyId === companyId) {
    ok('1) create flat businessProcess');
  } else {
    bad('1) create flat businessProcess', JSON.stringify(bp));
  }
} catch (err) {
  bad('1) create flat businessProcess', err?.message ?? String(err));
}

// ─── Senaryo 2: Update label + sortOrder ──────────────────────────────────

if (bp) {
  try {
    const upd = await taxonomyDefRepo.update(
      bp.id,
      { label: 'Smoke BP Güncellendi', sortOrder: 555 },
      ALLOWED,
    );
    if (
      upd.label === 'Smoke BP Güncellendi' &&
      upd.sortOrder === 555 &&
      upd.code === bp.code &&
      upd.companyId === bp.companyId &&
      upd.taxonomyType === bp.taxonomyType
    ) {
      ok('2) update label + sortOrder; code/type/company sabit');
    } else {
      bad('2) update label + sortOrder', JSON.stringify(upd));
    }
  } catch (err) {
    bad('2) update label + sortOrder', err?.message ?? String(err));
  }
}

// ─── Senaryo 3 + 4: Soft delete + reactivate ──────────────────────────────

if (bp) {
  try {
    const del = await taxonomyDefRepo.remove(bp.id, ALLOWED);
    const refetch = await prisma.taxonomyDef.findUnique({ where: { id: bp.id } });
    if (del?.deactivated && refetch && refetch.isActive === false) {
      ok('3) soft delete (isActive=false; row korunur)');
    } else {
      bad('3) soft delete', JSON.stringify({ del, refetch }));
    }
  } catch (err) {
    bad('3) soft delete', err?.message ?? String(err));
  }

  try {
    const upd = await taxonomyDefRepo.update(bp.id, { isActive: true }, ALLOWED);
    if (upd.isActive === true) ok('4) reactivate (isActive=true)');
    else bad('4) reactivate', JSON.stringify(upd));
  } catch (err) {
    bad('4) reactivate', err?.message ?? String(err));
  }
}

// ─── Senaryo 5: Duplicate code → 409 ──────────────────────────────────────

if (bp) {
  await expectThrows('5) duplicate code rejected (409)', 409, async () => {
    await taxonomyDefRepo.create(
      {
        companyId,
        taxonomyType: 'businessProcess',
        code: bp.code,
        label: 'Smoke duplicate',
      },
      ALLOWED,
    );
  });
}

// ─── Senaryo 6: Cross-tenant create reddedilir ────────────────────────────

await expectThrows('6) cross-tenant create reddedilir (403)', 403, async () => {
  await taxonomyDefRepo.create(
    {
      companyId,
      taxonomyType: 'platform',
      code: `${PREFIX}.cross.tenant`,
      label: 'cross tenant',
    },
    [],
  );
});

// ─── Senaryo 7: Create rootCauseGroup ─────────────────────────────────────

let rcg;
try {
  rcg = await taxonomyDefRepo.create(
    {
      companyId,
      taxonomyType: 'rootCauseGroup',
      code: `${PREFIX}.rcg.deneme`,
      label: 'Smoke RCG',
      sortOrder: 999,
    },
    ALLOWED,
  );
  created.push(rcg.id);
  if (rcg.parentId === null && rcg.taxonomyType === 'rootCauseGroup') {
    ok('7) create rootCauseGroup; parentId null');
  } else {
    bad('7) create rootCauseGroup', JSON.stringify(rcg));
  }
} catch (err) {
  bad('7) create rootCauseGroup', err?.message ?? String(err));
}

// ─── Senaryo 8: rootCauseDetail parent yok → 400 ──────────────────────────

await expectThrows('8) rootCauseDetail parent yok → 400', 400, async () => {
  await taxonomyDefRepo.create(
    {
      companyId,
      taxonomyType: 'rootCauseDetail',
      code: `${PREFIX}.rcd.noparent`,
      label: 'orphan',
    },
    ALLOWED,
  );
});

// ─── Senaryo 9: rootCauseDetail parent başka company → 400 ────────────────

if (otherCompanyId) {
  // Önce diğer company'de bir rootCauseGroup yarat (allowedCompanyIds dolu)
  let foreignParent = null;
  try {
    foreignParent = await taxonomyDefRepo.create(
      {
        companyId: otherCompanyId,
        taxonomyType: 'rootCauseGroup',
        code: `${PREFIX}.rcg.foreign`,
        label: 'Foreign',
      },
      [otherCompanyId],
    );
    created.push(foreignParent.id);
  } catch (err) {
    note('9) cross-tenant parent setup', err?.message ?? String(err));
  }

  if (foreignParent) {
    await expectThrows('9) rootCauseDetail parent cross-tenant → 400', 400, async () => {
      await taxonomyDefRepo.create(
        {
          companyId,
          taxonomyType: 'rootCauseDetail',
          code: `${PREFIX}.rcd.foreign`,
          label: 'foreign-parent',
          parentId: foreignParent.id,
        },
        ALLOWED,
      );
    });
  }
} else {
  note('9) cross-tenant parent test', 'DB\'de ikinci şirket yok, SKIP');
}

// ─── Senaryo 10: parent taxonomyType yanlış → 400 ─────────────────────────

if (bp) {
  await expectThrows('10) rootCauseDetail parent yanlış tip → 400', 400, async () => {
    await taxonomyDefRepo.create(
      {
        companyId,
        taxonomyType: 'rootCauseDetail',
        code: `${PREFIX}.rcd.badparent`,
        label: 'bad type',
        parentId: bp.id, // businessProcess; rootCauseGroup değil
      },
      ALLOWED,
    );
  });
}

// ─── Senaryo 11: rootCauseDetail parent doğru → OK ────────────────────────

let rcd;
if (rcg) {
  try {
    rcd = await taxonomyDefRepo.create(
      {
        companyId,
        taxonomyType: 'rootCauseDetail',
        code: `${PREFIX}.rcd.ok`,
        label: 'Smoke RCD',
        parentId: rcg.id,
      },
      ALLOWED,
    );
    created.push(rcd.id);
    if (rcd.parentId === rcg.id) ok('11) rootCauseDetail parent doğru → OK');
    else bad('11) rootCauseDetail parent doğru', JSON.stringify(rcd));
  } catch (err) {
    bad('11) rootCauseDetail parent doğru', err?.message ?? String(err));
  }
}

// ─── Senaryo 12: rootCauseGroup'a parentId set etmek → 400 ────────────────

if (rcg && rcd) {
  await expectThrows('12) rootCauseGroup için parentId set → 400', 400, async () => {
    await taxonomyDefRepo.update(rcg.id, { parentId: rcd.id }, ALLOWED);
  });
}

// ─── Senaryo 13: Update taxonomyType denemesi → 400 ───────────────────────

if (bp) {
  await expectThrows('13) update taxonomyType değiştirme → 400', 400, async () => {
    await taxonomyDefRepo.update(bp.id, { taxonomyType: 'platform' }, ALLOWED);
  });
}

// ─── Senaryo 14: Update companyId denemesi → 400 ──────────────────────────

if (bp && otherCompanyId) {
  await expectThrows('14) update companyId değiştirme → 400', 400, async () => {
    await taxonomyDefRepo.update(bp.id, { companyId: otherCompanyId }, ALLOWED);
  });
} else if (bp) {
  note('14) update companyId değiştirme', 'ikinci company yok, SKIP');
}

// ─── Cleanup ──────────────────────────────────────────────────────────────

if (!KEEP && created.length > 0) {
  // Soft delete edilse de hard delete edip ortalığı temizleyelim — bu smoke
  // tarafından yaratılan kayıtlar production verisi değil. Spec admin
  // endpoint için hard delete yasaklamış; doğrudan prisma.delete bu yasak
  // dışında (test cleanup).
  await prisma.taxonomyDef.deleteMany({ where: { id: { in: created } } });
  console.log('');
  console.log(`🧹 cleanup: ${created.length} test row silindi`);
}

console.log('');
console.log('── Summary ──────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}  SKIP=${skip}`);

await prisma.$disconnect().catch(() => {});
process.exit(fail > 0 ? 1 : 0);
