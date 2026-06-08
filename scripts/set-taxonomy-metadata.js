#!/usr/bin/env node
/**
 * set-taxonomy-metadata.js — WR-Smart-Ticket Phase 1d.
 *
 * TaxonomyDef.metadata alanını güncelleyen CLI helper. Admin CRUD ekranı
 * şu an metadata edit etmediği için (PR-1b kapsam dışı bırakılmıştı)
 * mapping verisini yüklemek için bu script kullanılır.
 *
 * CLI:
 *   node --env-file=.env scripts/set-taxonomy-metadata.js \
 *     --company UNIVERA \
 *     --taxonomyType businessProcess \
 *     --code bp.crm_islemleri \
 *     --case-category "CRM" \
 *     --case-sub-category "İşlemler" \
 *     --case-request-type "Talep"
 *
 *   # operationType için sadece requestType önerisi:
 *   node --env-file=.env scripts/set-taxonomy-metadata.js \
 *     --company UNIVERA \
 *     --taxonomyType operationType \
 *     --code ot.giremiyorum \
 *     --case-request-type "Hata"
 *
 *   # Mevcut metadata'yı temizle:
 *   node --env-file=.env scripts/set-taxonomy-metadata.js \
 *     --company UNIVERA --taxonomyType businessProcess --code bp.foo --clear
 *
 * Default: DRY RUN. --execute ile gerçek update.
 *
 * Bu script ÜRETIM verisi MUTATE eder; --execute kullanırken DB host
 * banner'ını oku, dev/staging'de olduğundan emin ol.
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

const COMPANY = val('company');
const TAXONOMY_TYPE = val('taxonomyType');
const CODE = val('code');
const CASE_CATEGORY = val('case-category');
const CASE_SUB_CATEGORY = val('case-sub-category');
const CASE_REQUEST_TYPE = val('case-request-type');
const CLEAR = flag('clear');
const EXECUTE = flag('execute');

const REQUEST_TYPE_WHITELIST = new Set(['Bilgi', 'Öneri', 'Talep', 'Şikayet', 'Hata']);

function maskDb(url) { return url ? url.replace(/:\/\/[^@]*@/, '://***@') : '<unset>'; }

if (!COMPANY || !TAXONOMY_TYPE || !CODE) {
  console.error('❌ Eksik argüman. --company, --taxonomyType ve --code zorunlu.');
  process.exit(2);
}
if (!CLEAR && !CASE_CATEGORY && !CASE_SUB_CATEGORY && !CASE_REQUEST_TYPE) {
  console.error('❌ En az bir alan vermelisin: --case-category, --case-sub-category, --case-request-type veya --clear');
  process.exit(2);
}
if (CASE_REQUEST_TYPE && !REQUEST_TYPE_WHITELIST.has(CASE_REQUEST_TYPE)) {
  console.error(`❌ --case-request-type geçersiz. Geçerli: ${[...REQUEST_TYPE_WHITELIST].join(', ')}`);
  process.exit(2);
}

console.log('🛠  set-taxonomy-metadata');
console.log('   DB        :', maskDb(process.env.DATABASE_URL));
console.log('   NODE_ENV  :', process.env.NODE_ENV ?? '<unset>');
console.log('   VERCEL    :', process.env.VERCEL ?? '<unset>');
console.log('   Company   :', COMPANY);
console.log('   Type      :', TAXONOMY_TYPE);
console.log('   Code      :', CODE);
console.log('   Mode      :', EXECUTE ? 'EXECUTE (will write)' : 'DRY RUN');
console.log('');

// Resolve companyId
let companyId = null;
try {
  const byId = await prisma.company.findUnique({ where: { id: COMPANY }, select: { id: true, name: true } });
  if (byId) companyId = byId.id;
  else {
    const byName = await prisma.company.findUnique({ where: { name: COMPANY }, select: { id: true, name: true } });
    if (byName) companyId = byName.id;
  }
} catch (err) {
  console.error('⛔ Company lookup hatası:', err?.message ?? err);
  await prisma.$disconnect();
  process.exit(2);
}
if (!companyId) {
  console.error(`⛔ Company "${COMPANY}" bulunamadı.`);
  await prisma.$disconnect();
  process.exit(2);
}

const existing = await prisma.taxonomyDef.findUnique({
  where: { companyId_taxonomyType_code: { companyId, taxonomyType: TAXONOMY_TYPE, code: CODE } },
  select: { id: true, label: true, metadata: true },
});
if (!existing) {
  console.error(`⛔ Taxonomy bulunamadı: ${TAXONOMY_TYPE}:${CODE} (company=${companyId})`);
  await prisma.$disconnect();
  process.exit(2);
}

console.log(`Mevcut metadata: ${JSON.stringify(existing.metadata ?? null)}`);
console.log(`Label: ${existing.label}`);

let nextMetadata;
if (CLEAR) {
  nextMetadata = null;
} else {
  const base = (existing.metadata && typeof existing.metadata === 'object') ? { ...existing.metadata } : {};
  if (CASE_CATEGORY !== null) base.caseCategory = CASE_CATEGORY;
  if (CASE_SUB_CATEGORY !== null) base.caseSubCategory = CASE_SUB_CATEGORY;
  if (CASE_REQUEST_TYPE !== null) base.caseRequestType = CASE_REQUEST_TYPE;
  nextMetadata = base;
}

console.log(`Yeni metadata    : ${JSON.stringify(nextMetadata)}`);
console.log('');

if (!EXECUTE) {
  console.log('ℹ️  DRY RUN — yazma yapılmadı. --execute ile çalıştır.');
  await prisma.$disconnect();
  process.exit(0);
}

const updated = await prisma.taxonomyDef.update({
  where: { id: existing.id },
  data: { metadata: nextMetadata ?? null },
  select: { id: true, code: true, metadata: true },
});
console.log(`✅ Güncellendi: ${updated.code}`);
console.log(`   metadata = ${JSON.stringify(updated.metadata)}`);
await prisma.$disconnect();
