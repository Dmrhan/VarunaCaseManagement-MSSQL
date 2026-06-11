/**
 * Smart Ticket taksonomilerini KB'nin kanonik taksonomisinden seed eder.
 *
 * Kaynak: data/cc-taxonomy-v2.json (ticket-analiz entegrasyonuyla geldi;
 * kendisi de "İş Süreçleri Kategorisi - 20260604.xlsx"ten üretilmiş).
 * Bu kaynağı kullanmak kritik: KB'nin categorize-v2 / suggest-close
 * cevaplarındaki etiketler BU listeden gelir → TaxonomyDef eşleşmesi birebir.
 *
 * Eşleme:
 *   open.platform        → platform
 *   open.is_sureci       → businessProcess
 *   open.islem_tipi      → operationType
 *   open.etkilenen_nesne → affectedObject
 *   open.etki            → impact
 *   open.urun            → SKIP (Product catalog'un işi; eski xlsx seed'iyle aynı karar)
 *   close.kok_neden      → rootCauseGroup (grup) + rootCauseDetail (parentId'li detay)
 *   close.cozum_tipi     → resolutionType
 *   close.kalici_onlem   → permanentPrevention
 *
 * Idempotent: (companyId, taxonomyType, code) unique anahtarına upsert.
 * Çalıştırma: node --env-file=.env scripts/seed-taxonomies-from-kb.js [--company COMP-UNIVERA] [--dry]
 *             (--company verilmezse TÜM aktif şirketlere uygulanır)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const companyArg = (() => {
  const i = args.indexOf('--company');
  return i >= 0 ? args[i + 1] : null;
})();

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

// ─── Plan oluştur ──────────────────────────────────────────────────────────

const taxonomy = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cc-taxonomy-v2.json'), 'utf8'));

const plan = [];
const perTypeSort = {};
const seen = new Set();

function emit(taxonomyType, label, parentCode = null) {
  const code = `${CODE_PREFIX[taxonomyType]}.${slugify(label)}`;
  const k = `${taxonomyType}|${code}`;
  if (seen.has(k)) return code;
  seen.add(k);
  perTypeSort[taxonomyType] = (perTypeSort[taxonomyType] ?? 0) + 10;
  plan.push({ taxonomyType, code, label, parentCode, sortOrder: perTypeSort[taxonomyType] });
  return code;
}

const OPEN_MAP = {
  platform: 'platform',
  is_sureci: 'businessProcess',
  islem_tipi: 'operationType',
  etkilenen_nesne: 'affectedObject',
  etki: 'impact',
};
for (const [srcKey, taxonomyType] of Object.entries(OPEN_MAP)) {
  for (const label of taxonomy.open?.[srcKey]?.values ?? []) emit(taxonomyType, label);
}

for (const g of taxonomy.close?.kok_neden?.groups ?? []) {
  const parentCode = emit('rootCauseGroup', g.group);
  for (const d of g.details ?? []) emit('rootCauseDetail', d, parentCode);
}
for (const label of taxonomy.close?.cozum_tipi?.values ?? []) emit('resolutionType', label);
for (const label of taxonomy.close?.kalici_onlem?.values ?? []) emit('permanentPrevention', label);

const byType = {};
for (const p of plan) byType[p.taxonomyType] = (byType[p.taxonomyType] ?? 0) + 1;
console.log(`Kaynak: cc-taxonomy-v2.json (${taxonomy.version}, source: ${taxonomy.source})`);
console.log('Plan:', JSON.stringify(byType), `toplam=${plan.length}`);

if (DRY) {
  console.log('DRY RUN — --dry kaldırınca upsert edilir.');
  process.exit(0);
}

// ─── Şirketleri çöz ve iki geçişte upsert et ──────────────────────────────

const companies = companyArg
  ? await prisma.company.findMany({ where: { id: companyArg }, select: { id: true, name: true } })
  : await prisma.company.findMany({ where: { isActive: true }, select: { id: true, name: true } });
if (companies.length === 0) {
  console.error('Şirket bulunamadı.');
  process.exit(1);
}

for (const company of companies) {
  // Pass 1 — parent'lar + hiyerarşisizler
  let n = 0;
  for (const p of plan.filter((x) => !x.parentCode)) {
    await prisma.taxonomyDef.upsert({
      where: { companyId_taxonomyType_code: { companyId: company.id, taxonomyType: p.taxonomyType, code: p.code } },
      update: { label: p.label, isActive: true, sortOrder: p.sortOrder },
      create: { companyId: company.id, taxonomyType: p.taxonomyType, code: p.code, label: p.label, sortOrder: p.sortOrder },
    });
    n++;
  }
  // Pass 2 — rootCauseDetail (parentId bağlamak için grup id'leri çek)
  const groups = await prisma.taxonomyDef.findMany({
    where: { companyId: company.id, taxonomyType: 'rootCauseGroup' },
    select: { id: true, code: true },
  });
  const parentIdByCode = new Map(groups.map((g) => [g.code, g.id]));
  for (const p of plan.filter((x) => x.parentCode)) {
    const parentId = parentIdByCode.get(p.parentCode) ?? null;
    await prisma.taxonomyDef.upsert({
      where: { companyId_taxonomyType_code: { companyId: company.id, taxonomyType: p.taxonomyType, code: p.code } },
      update: { label: p.label, isActive: true, sortOrder: p.sortOrder, parentId },
      create: { companyId: company.id, taxonomyType: p.taxonomyType, code: p.code, label: p.label, sortOrder: p.sortOrder, parentId },
    });
    n++;
  }
  console.log(`  ✓ ${company.id} (${company.name}): ${n} kayıt upsert edildi`);
}

await prisma.$disconnect();
console.log('✅ Tamamlandı.');
