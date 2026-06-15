#!/usr/bin/env node
/**
 * seed-univera-smart-ticket-taxonomies.js
 *
 * Reads the UNIVERA Smart Ticket taxonomy XLSX and inserts the values
 * into the TaxonomyDef table for the chosen tenant (default: company
 * name "UNIVERA"). Idempotent — re-runnable without producing
 * duplicates (uses upsert on (companyId, taxonomyType, code)).
 *
 *   - Source XLSX: `Konum | Grup Adı | Grup içerik | Grup İçerik`
 *   - Konum=Açılış → taxonomyType ∈ {platform, businessProcess,
 *                                    operationType, affectedObject, impact}
 *   - Konum=Kapanış → taxonomyType ∈ {rootCauseGroup, rootCauseDetail,
 *                                     resolutionType, permanentPrevention}
 *
 *   - Kök Neden Grubu (Kapanış) hierarchy: XLSX has two value columns —
 *     `Grup içerik` (küçük i) holds the parent label (rootCauseGroup) and
 *     `Grup İçerik` (büyük İ) holds the child label (rootCauseDetail).
 *     Each row = one (parent, child) pair; parents repeat across rows
 *     and are deduped by code.
 *
 * CLI:
 *   --xlsx <path>         path to xlsx (default: UNIVERA GDrive shared path)
 *   --company <name|id>   default "UNIVERA"
 *   --dry-run             default mode; reports plan without DB writes
 *   --execute             actually upsert
 *
 * Run:
 *   node --env-file=.env scripts/seed-univera-smart-ticket-taxonomies.js
 *   node --env-file=.env scripts/seed-univera-smart-ticket-taxonomies.js --execute
 */
import XLSX from 'xlsx';
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

// On-prem: xlsx yolu zorunlu argüman/env (eski hardcoded Google Drive yolu kaldırıldı).
//   node scripts/seed-univera-smart-ticket-taxonomies.js --xlsx "C:\path\to\kategoriler.xlsx"
const XLSX_PATH = val('xlsx', process.env.TAXONOMY_XLSX_PATH ?? null);
if (!XLSX_PATH) {
  console.error('❌ --xlsx <dosya yolu> argümanı (veya TAXONOMY_XLSX_PATH env) zorunlu.');
  process.exit(1);
}
const COMPANY = val('company', 'UNIVERA');
const EXECUTE = flag('execute');

// ─── Taxonomy type map (XLSX Grup Adı → TaxonomyDef.taxonomyType) ─────────

const ACILIS_GRUP_TO_TYPE = {
  Ürün: null, // mevcut Product catalog'a karşılık; SKIPPED bu seed'de
  Platform: 'platform',
  'İş Süreci': 'businessProcess',
  'İşlem Tipi': 'operationType',
  'Etkilenen Nesne': 'affectedObject',
  Etki: 'impact',
};
const KAPANIS_GRUP_TO_TYPE = {
  'Kök Neden Grubu': 'rootCauseGroup', // mixed list: parent + child rows
  'Çözüm Tipi': 'resolutionType',
  'Kalıcı Önlem': 'permanentPrevention',
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Slugify Turkish label → kebab-case code (ASCII-safe, deterministic).
 * Used for TaxonomyDef.code so seed re-runs hit the unique key.
 */
function slugify(s, fallback = 'x') {
  if (!s) return fallback;
  const ascii = s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return ascii || fallback;
}

function maskDb(url) { return url ? url.replace(/:\/\/[^@]*@/, '://***@') : '<unset>'; }

// ─── Banner ───────────────────────────────────────────────────────────────

console.log('🌱 seed-univera-smart-ticket-taxonomies');
console.log('   DB        :', maskDb(process.env.DATABASE_URL));
console.log('   NODE_ENV  :', process.env.NODE_ENV ?? '<unset>');
console.log('   VERCEL    :', process.env.VERCEL ?? '<unset>');
console.log('   XLSX      :', XLSX_PATH);
console.log('   Company   :', COMPANY);
console.log('   Mode      :', EXECUTE ? 'EXECUTE (will upsert)' : 'DRY RUN');
console.log('');

// ─── Read XLSX + extract rows ─────────────────────────────────────────────

let xlsxRows;
try {
  const wb = XLSX.readFile(XLSX_PATH);
  xlsxRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
} catch (err) {
  console.error('⛔  XLSX read failed:', err?.message || err);
  process.exit(2);
}
console.log(`Loaded ${xlsxRows.length} XLSX rows from sheet "${Object.keys(xlsxRows[0] ?? {})[0] ? 'Sheet1' : '?'}"`);

// ─── Build seed plan ──────────────────────────────────────────────────────
// Each plan entry: { taxonomyType, code, label, parentCode?, sortOrder }

const plan = [];
let perTypeIndex = {};

function nextSort(taxonomyType) {
  perTypeIndex[taxonomyType] = (perTypeIndex[taxonomyType] ?? 0) + 10;
  return perTypeIndex[taxonomyType];
}

const CODE_PREFIX = {
  platform: 'plat',
  businessProcess: 'bp',
  operationType: 'ot',
  affectedObject: 'ao',
  impact: 'imp',
  rootCauseGroup: 'rcg',
  rootCauseDetail: 'rcd',
  resolutionType: 'rt',
  permanentPrevention: 'pp',
};

const seen = new Set(); // dedupe by (type|code)

function emit({ taxonomyType, label, parentCode = null }) {
  const code = `${CODE_PREFIX[taxonomyType]}.${slugify(label)}`;
  const k = `${taxonomyType}|${code}`;
  if (seen.has(k)) return code; // already in plan; reuse code
  seen.add(k);
  plan.push({
    taxonomyType,
    code,
    label,
    parentCode,
    sortOrder: nextSort(taxonomyType),
  });
  return code;
}

for (const row of xlsxRows) {
  const konum = (row['Konum'] ?? '').trim();
  const grup = (row['Grup Adı'] ?? '').trim();
  const v1 = (row['Grup içerik'] ?? '').trim(); // küçük i → parent slot (or single value)
  const v2 = (row['Grup İçerik'] ?? '').trim(); // büyük İ → child slot (rootCauseGroup only)

  if (konum === 'Açılış') {
    const taxonomyType = ACILIS_GRUP_TO_TYPE[grup];
    if (taxonomyType === undefined) continue; // unknown group
    if (taxonomyType === null) continue; // Ürün skipped (mevcut Product catalog kullanılır)
    if (!v1) continue;
    emit({ taxonomyType, label: v1 });
  } else if (konum === 'Kapanış') {
    if (grup === 'Kök Neden Grubu') {
      // Row carries (parent label, child label). Emit parent first so the
      // child can reference its code; both are deduped by `seen`.
      if (!v1) continue;
      const parentCode = emit({ taxonomyType: 'rootCauseGroup', label: v1 });
      if (v2) emit({ taxonomyType: 'rootCauseDetail', label: v2, parentCode });
    } else {
      const taxonomyType = KAPANIS_GRUP_TO_TYPE[grup];
      if (!taxonomyType) continue;
      if (!v1) continue;
      emit({ taxonomyType, label: v1 });
    }
  }
}

// ─── Report plan ──────────────────────────────────────────────────────────

const byType = {};
for (const p of plan) byType[p.taxonomyType] = (byType[p.taxonomyType] ?? 0) + 1;

console.log('');
console.log('Seed plan (per taxonomyType):');
const orderedTypes = [
  'platform', 'businessProcess', 'operationType', 'affectedObject', 'impact',
  'rootCauseGroup', 'rootCauseDetail', 'resolutionType', 'permanentPrevention',
];
for (const t of orderedTypes) {
  console.log(`  ${t.padEnd(22)} : ${byType[t] ?? 0}`);
}
console.log(`  TOTAL                  : ${plan.length}`);
console.log('');

if (!EXECUTE) {
  console.log('Sample (first 8 entries):');
  for (const p of plan.slice(0, 8)) {
    console.log(`  [${p.taxonomyType}] code=${p.code}  label="${p.label.slice(0, 50)}"${p.parentCode ? ` parent=${p.parentCode}` : ''}`);
  }
  console.log('');
  console.log('ℹ️   DRY RUN — re-run with --execute to upsert into DB.');
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

// ─── Execute: resolve company, upsert in two passes ───────────────────────

let companyId = null;
try {
  const byId = await prisma.company.findUnique({ where: { id: COMPANY }, select: { id: true, name: true } });
  if (byId) {
    companyId = byId.id;
    console.log(`Company resolved by id : ${byId.id} (${byId.name})`);
  } else {
    const byName = await prisma.company.findUnique({ where: { name: COMPANY }, select: { id: true, name: true } });
    if (!byName) {
      console.error(`⛔  Company "${COMPANY}" not found.`);
      await prisma.$disconnect();
      process.exit(2);
    }
    companyId = byName.id;
    console.log(`Company resolved by name: ${byName.id} (${byName.name})`);
  }
} catch (err) {
  console.error('⛔  Company lookup failed:', err?.message || err);
  await prisma.$disconnect();
  process.exit(2);
}

console.log('');
console.log(`Upserting ${plan.length} TaxonomyDef rows for companyId=${companyId} …`);

// Pass 1: parents first (rootCauseGroup + all non-rootCauseDetail) so child
// FK lookup in pass 2 always finds an id.
const parents = plan.filter((p) => p.taxonomyType !== 'rootCauseDetail');
const children = plan.filter((p) => p.taxonomyType === 'rootCauseDetail');

let upsertCount = 0;
for (const p of parents) {
  await prisma.taxonomyDef.upsert({
    where: {
      companyId_taxonomyType_code: { companyId, taxonomyType: p.taxonomyType, code: p.code },
    },
    update: { label: p.label, isActive: true, sortOrder: p.sortOrder },
    create: {
      companyId,
      taxonomyType: p.taxonomyType,
      code: p.code,
      label: p.label,
      sortOrder: p.sortOrder,
    },
    select: { id: true },
  });
  upsertCount += 1;
}
console.log(`  ✓ Pass 1 (parents + non-hierarchy) : ${upsertCount}`);

// Build parent code → id map for pass 2.
const parentIdByCode = new Map();
const groupRows = await prisma.taxonomyDef.findMany({
  where: { companyId, taxonomyType: 'rootCauseGroup' },
  select: { id: true, code: true },
});
for (const g of groupRows) parentIdByCode.set(g.code, g.id);

let childCount = 0;
let childOrphan = 0;
for (const p of children) {
  const parentId = parentIdByCode.get(p.parentCode);
  if (!parentId) {
    childOrphan += 1;
    console.log(`  ⚠️   orphan child: ${p.code} (parent code ${p.parentCode} not found)`);
    continue;
  }
  await prisma.taxonomyDef.upsert({
    where: {
      companyId_taxonomyType_code: { companyId, taxonomyType: p.taxonomyType, code: p.code },
    },
    update: { label: p.label, isActive: true, sortOrder: p.sortOrder, parentId },
    create: {
      companyId,
      taxonomyType: p.taxonomyType,
      code: p.code,
      label: p.label,
      sortOrder: p.sortOrder,
      parentId,
    },
    select: { id: true },
  });
  childCount += 1;
}
console.log(`  ✓ Pass 2 (rootCauseDetail children) : ${childCount}${childOrphan ? `  (${childOrphan} orphan skipped)` : ''}`);

// ─── Post-execute verification ────────────────────────────────────────────

console.log('');
console.log('── Verification ─────────────────────────────────────────');
const finalCounts = await prisma.taxonomyDef.groupBy({
  by: ['taxonomyType'],
  where: { companyId },
  _count: { _all: true },
});
const finalByType = Object.fromEntries(finalCounts.map((c) => [c.taxonomyType, c._count._all]));
for (const t of orderedTypes) {
  console.log(`  ${t.padEnd(22)} : ${finalByType[t] ?? 0}`);
}

const orphanCheck = await prisma.taxonomyDef.count({
  where: { companyId, taxonomyType: 'rootCauseDetail', parentId: null },
});
console.log(`  orphan rootCauseDetail (parentId=null): ${orphanCheck}`);

console.log('');
console.log('✅  Seed complete.');
await prisma.$disconnect();
