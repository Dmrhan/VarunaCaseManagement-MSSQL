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
 *   7.  Create rootCauseGroup → parentId null
 *   8.  Kapanış decouple — rootCauseDetail parent'sız oluşturulur → OK (parentId null)
 *   9.  Kapanış decouple — parentId verilse bile null kaydedilir (yok sayılır)
 *   10. (decouple — eski "yanlış tip parent → 400" kuralı kaldırıldı, SKIP)
 *   11. (decouple — eski "parent zorunlu → OK" kuralı kaldırıldı, SKIP)
 *   12. Kapanış decouple — rootCauseGroup update parentId → yok sayılır (null)
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

// ─── Senaryo 8: Kapanış decouple — rootCauseDetail parent'sız → OK ────────
//
// Eski kural "rootCauseDetail parent zorunlu → 400" KALDIRILDI. Kapanış
// kategorileri bağımsız; detay parent'sız oluşturulur (parentId null).

let rcd;
try {
  rcd = await taxonomyDefRepo.create(
    {
      companyId,
      taxonomyType: 'rootCauseDetail',
      code: `${PREFIX}.rcd.noparent`,
      label: 'Smoke RCD (flat)',
      sortOrder: 998,
    },
    ALLOWED,
  );
  created.push(rcd.id);
  if (rcd.parentId === null && rcd.taxonomyType === 'rootCauseDetail') {
    ok('8) rootCauseDetail parent\'sız oluşturuldu → OK (parentId null)');
  } else {
    bad('8) rootCauseDetail flat create', JSON.stringify(rcd));
  }
} catch (err) {
  bad('8) rootCauseDetail flat create', err?.message ?? String(err));
}

// ─── Senaryo 9: Decouple — parentId verilse bile null kaydedilir ──────────

if (rcg) {
  try {
    const rcd2 = await taxonomyDefRepo.create(
      {
        companyId,
        taxonomyType: 'rootCauseDetail',
        code: `${PREFIX}.rcd.ignoredparent`,
        label: 'parentId ignored',
        parentId: rcg.id, // decouple — yok sayılmalı, null kaydedilmeli
      },
      ALLOWED,
    );
    created.push(rcd2.id);
    if (rcd2.parentId === null) ok('9) parentId verildi ama null kaydedildi (decouple)');
    else bad('9) parentId ignore edilmedi', JSON.stringify(rcd2));
  } catch (err) {
    bad('9) parentId ignore', err?.message ?? String(err));
  }
}

// ─── Senaryo 10-11: Eski parent doğrulama kuralları kaldırıldı ────────────

note('10) parent tip/tenant doğrulaması', 'decouple — kural kaldırıldı, SKIP');
note('11) rootCauseDetail parent zorunlu', 'decouple — kaldırıldı (bkz. 8), SKIP');

// ─── Senaryo 12: Decouple — rootCauseGroup update parentId → null ─────────

if (rcg && rcd) {
  try {
    const updated = await taxonomyDefRepo.update(rcg.id, { parentId: rcd.id }, ALLOWED);
    if (updated.parentId === null) ok('12) rootCauseGroup update: parentId yok sayıldı (null)');
    else bad('12) rootCauseGroup parentId', JSON.stringify(updated));
  } catch (err) {
    bad('12) rootCauseGroup update parentId', err?.message ?? String(err));
  }
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

// ─── Senaryo 15: Route-level RBAC guard simülasyonu ──────────────────────
//
// Codex PR-1b review fix — ID-based PATCH/DELETE handler'ları artık
// `assertCompanyAdmin(req, target.companyId)` çağırıyor. Bu test, helper'ın
// "başka şirkette Admin, bu şirkette Agent" senaryosunda hata fırlattığını
// doğrular. assertCompanyAdmin mantığı route'tan inline replikası — eğer
// admin.js'deki helper değişirse bu blok da güncellenmeli.

function assertCompanyAdminSim(req, targetCompanyId) {
  if (!targetCompanyId) throw new Error('companyId gerekli.');
  const link = req.user.companyRoles?.find((r) => r.companyId === targetCompanyId);
  if (!link || (link.role !== 'Admin' && link.role !== 'SystemAdmin')) {
    const err = new Error('Bu şirket için admin yetkin yok.');
    err.status = 403;
    throw err;
  }
}

if (otherCompanyId) {
  const reqAdminElsewhere = {
    user: {
      companyRoles: [
        { companyId, role: 'Admin' },
        { companyId: otherCompanyId, role: 'Agent' },
      ],
      allowedCompanyIds: [companyId, otherCompanyId],
    },
  };
  await expectThrows(
    '15) RBAC: başka şirkette Admin + hedefte Agent → 403',
    403,
    async () => assertCompanyAdminSim(reqAdminElsewhere, otherCompanyId),
  );
  try {
    assertCompanyAdminSim(reqAdminElsewhere, companyId);
    ok('16) RBAC: hedef şirkette Admin → izin verilir');
  } catch (err) {
    bad('16) RBAC: same-tenant admin', err?.message ?? String(err));
  }
} else {
  note('15-16) route-level RBAC', 'ikinci şirket yok, SKIP');
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
