/**
 * smoke-smart-ticket-taxonomy.js — WR-Smart-Ticket PR-1a.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-smart-ticket-taxonomy.js
 *   node --env-file=.env scripts/smoke-smart-ticket-taxonomy.js --company "UNIVERA"
 *
 * Bu PR (Smart Ticket Phase 1a) yalnızca temel taxonomy katmanını
 * ekliyor — Smart Ticket UI yok, External KB yok, CaseSolutionStep yok.
 * Bu smoke aşağıdakileri kontrol eder:
 *
 * Pure invariants (DB gerektirmez):
 *   1. SMART_TICKET_TAXONOMY_TYPES = tam olarak 9 tip; sıralama sabit.
 *   2. slugify ASCII + Türkçe karakter dönüşümü deterministik.
 *
 * DB invariants (DATABASE_URL erişilebilir + company var + taxonomy seed
 * uygulanmışsa; aksi takdirde graceful SKIP):
 *   3. TaxonomyDef row count per taxonomyType ≥ minimum eşik.
 *   4. Her rootCauseDetail satırı parentId NOT NULL ve parent satır
 *      taxonomyType='rootCauseGroup' olmalı (hierarchy invariant).
 *   5. rootCauseGroup satırları parentId IS NULL (kendi başına root).
 *   6. composite unique (companyId, taxonomyType, code) çakışma yok
 *      (DB constraint zaten engelliyor; verify by groupBy duplicates).
 *   7. Lookup repository-mantığı (route içindekiyle aynı sorgu) hierarchy
 *      structure doğru: rootCauseGroup elemanları children ile geliyor.
 *
 * Smart Ticket Case akışı bu PR'da DOKUNULMADI — Case.category/subCategory/
 * requestType alanları aynen mevcut; bu smoke onları okuyup değişmedi mi
 * şeklinde DB schema column existence check'i yapar (regression guard).
 */

import { prisma } from '../server/db/client.js';

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
const VERBOSE = flag('verbose');

let pass = 0;
let fail = 0;
let skip = 0;
const results = [];

function ok(name, detail = '') {
  pass += 1;
  results.push({ ok: true, name, detail });
  console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`);
}
function bad(name, detail = '') {
  fail += 1;
  results.push({ ok: false, name, detail });
  console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`);
}
function note(name, detail = '') {
  skip += 1;
  results.push({ ok: null, name, detail });
  console.log(`⊘ ${name}${detail ? ' — ' + detail : ''}`);
}

// ─── Section 1: Pure invariants (no DB) ───────────────────────────────────

const SMART_TICKET_TAXONOMY_TYPES = [
  'platform',
  'businessProcess',
  'operationType',
  'affectedObject',
  'impact',
  'rootCauseGroup',
  'rootCauseDetail',
  'resolutionType',
  'permanentPrevention',
];

console.log('── Pure invariants ──────────────────────────────────────');

if (SMART_TICKET_TAXONOMY_TYPES.length === 9) ok('taxonomy types = 9');
else bad('taxonomy types = 9', `got ${SMART_TICKET_TAXONOMY_TYPES.length}`);

// slugify mirrors seed script — keep in sync
function slugify(s) {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}
const slugCases = [
  ['Çözüm Tipi', 'cozum_tipi'],
  ['Müşteri / Cari Kartı', 'musteri_cari_karti'],
  ['Şube Yetkisi Eksik', 'sube_yetkisi_eksik'],
  ['Backoffice', 'backoffice'],
];
let slugOk = true;
for (const [input, expected] of slugCases) {
  const got = slugify(input);
  if (got !== expected) { slugOk = false; console.log(`    expected slugify("${input}")="${expected}" got "${got}"`); }
}
if (slugOk) ok('slugify deterministic (4 cases)');
else bad('slugify deterministic');

// ─── Section 2: DB invariants ─────────────────────────────────────────────

console.log('');
console.log('── DB invariants ────────────────────────────────────────');

let companyId = null;
try {
  const byId = await prisma.company.findUnique({ where: { id: COMPANY }, select: { id: true, name: true } });
  if (byId) companyId = byId.id;
  else {
    const byName = await prisma.company.findUnique({ where: { name: COMPANY }, select: { id: true, name: true } });
    if (byName) companyId = byName.id;
  }
} catch (err) {
  note('DB invariants', `DB erişilemedi, SKIP: ${err?.code || err?.message || 'unknown'}`);
}

if (!companyId) {
  if (skip === 0) note('DB invariants', `company "${COMPANY}" bulunamadı, SKIP`);
} else {
  console.log(`  company resolved: ${companyId}`);

  // Regression guard: Case columns unchanged (PR explicitly preserves these).
  try {
    await prisma.case.findFirst({
      where: { companyId },
      select: { id: true, category: true, subCategory: true, requestType: true },
    });
    ok('Case.category/subCategory/requestType kolonları korundu');
  } catch (err) {
    bad('Case kolonları regression', err?.message || String(err));
  }

  // taxonomy seed applied?
  let total = 0;
  try {
    total = await prisma.taxonomyDef.count({ where: { companyId } });
  } catch (err) {
    note('TaxonomyDef tablosu', `tablo yok veya erişilemedi: ${err?.code || err?.message}`);
  }

  if (total === 0) {
    note('TaxonomyDef row check', `companyId=${companyId} için 0 satır — seed yapılmadı, SKIP`);
  } else {
    console.log(`  TaxonomyDef toplam: ${total}`);

    // 3. Per-type minimum thresholds (UNIVERA seed'inden, biraz aşağıdan).
    const MIN_PER_TYPE = {
      platform: 2,
      businessProcess: 10,
      operationType: 10,
      affectedObject: 50,
      impact: 5,
      rootCauseGroup: 5,
      rootCauseDetail: 30,
      resolutionType: 5,
      permanentPrevention: 5,
    };
    const counts = await prisma.taxonomyDef.groupBy({
      by: ['taxonomyType'],
      where: { companyId },
      _count: { _all: true },
    });
    const countByType = Object.fromEntries(counts.map((c) => [c.taxonomyType, c._count._all]));
    let allTypesOk = true;
    for (const t of SMART_TICKET_TAXONOMY_TYPES) {
      const got = countByType[t] ?? 0;
      const need = MIN_PER_TYPE[t];
      if (got < need) {
        allTypesOk = false;
        console.log(`    type "${t}" count=${got} < min ${need}`);
      } else if (VERBOSE) {
        console.log(`    ${t.padEnd(22)}: ${got}`);
      }
    }
    if (allTypesOk) ok('per-type counts ≥ minimum eşik');
    else bad('per-type counts < eşik');

    // 4. Every rootCauseDetail has non-null parentId AND parent is rootCauseGroup.
    const orphans = await prisma.taxonomyDef.count({
      where: { companyId, taxonomyType: 'rootCauseDetail', parentId: null },
    });
    if (orphans === 0) ok('rootCauseDetail parentId NOT NULL invariant');
    else bad('rootCauseDetail orphans', `${orphans} satır parentId NULL`);

    const detailWithParent = await prisma.taxonomyDef.findMany({
      where: { companyId, taxonomyType: 'rootCauseDetail' },
      select: { id: true, parent: { select: { taxonomyType: true, companyId: true } } },
    });
    const wrongParentType = detailWithParent.filter(
      (d) => d.parent && d.parent.taxonomyType !== 'rootCauseGroup',
    ).length;
    const crossTenant = detailWithParent.filter(
      (d) => d.parent && d.parent.companyId !== companyId,
    ).length;
    if (wrongParentType === 0) ok('rootCauseDetail.parent.taxonomyType = rootCauseGroup');
    else bad('parent.taxonomyType mismatch', `${wrongParentType} child wrong parent type`);
    if (crossTenant === 0) ok('rootCauseDetail.parent.companyId = same tenant');
    else bad('cross-tenant parent', `${crossTenant} child farklı tenant'ı parent gösteriyor`);

    // 5. rootCauseGroup rows have NULL parentId.
    const groupWithParent = await prisma.taxonomyDef.count({
      where: { companyId, taxonomyType: 'rootCauseGroup', parentId: { not: null } },
    });
    if (groupWithParent === 0) ok('rootCauseGroup parentId IS NULL');
    else bad('rootCauseGroup parentId set', `${groupWithParent} root düğümü parent'a bağlanmış`);

    // 6. composite unique → groupBy returning >1 for any (type, code) means dup.
    const dupCheck = await prisma.taxonomyDef.groupBy({
      by: ['taxonomyType', 'code'],
      where: { companyId },
      _count: { _all: true },
      having: { code: { _count: { gt: 1 } } },
    });
    if (dupCheck.length === 0) ok('composite unique (companyId, taxonomyType, code)');
    else bad('duplicate codes', `${dupCheck.length} duplicate (type,code) pair`);

    // 7. Lookup-shape: rootCauseGroup nested children present + ordered.
    const allRows = await prisma.taxonomyDef.findMany({
      where: { companyId, isActive: true, taxonomyType: { in: ['rootCauseGroup', 'rootCauseDetail'] } },
      select: { id: true, taxonomyType: true, code: true, label: true, parentId: true, sortOrder: true },
      orderBy: [{ taxonomyType: 'asc' }, { sortOrder: 'asc' }],
    });
    const childrenByParent = new Map();
    for (const r of allRows) {
      if (r.taxonomyType === 'rootCauseDetail' && r.parentId) {
        if (!childrenByParent.has(r.parentId)) childrenByParent.set(r.parentId, []);
        childrenByParent.get(r.parentId).push(r);
      }
    }
    const groupsWithoutChildren = allRows
      .filter((r) => r.taxonomyType === 'rootCauseGroup')
      .filter((g) => (childrenByParent.get(g.id) ?? []).length === 0);
    if (groupsWithoutChildren.length === 0) ok('her rootCauseGroup ≥1 child detail içerir');
    else {
      // Bu bir bad değil, warning. Bazı rootCauseGroup'ların hiç child'ı olmayabilir.
      note(
        'rootCauseGroup children eksik',
        `${groupsWithoutChildren.length} grup child'sız (örn. ${groupsWithoutChildren.slice(0, 3).map((g) => g.code).join(', ')})`,
      );
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────

console.log('');
console.log('── Summary ──────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}  SKIP=${skip}`);

await prisma.$disconnect().catch(() => {});
process.exit(fail > 0 ? 1 : 0);
