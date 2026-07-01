#!/usr/bin/env node
/**
 * seed-closure-taxonomy-v4.mjs
 *
 * Yeni KAPANIŞ taksonomisini (v4 — 9 grup / 75 detay / cascade) TaxonomyDef'e
 * yükler. Kaynak: data/closure-taxonomy-v4.json (DUZELTILMIS Excel'den üretildi).
 *
 * Model:
 *   - rootCauseGroup   : 9 grup
 *   - rootCauseDetail  : 75 detay, parentId ile grubuna bağlı (CASCADE)
 *                        + metadata.allowedResolutionTypes[] = geçerli çözüm kodları
 *   - resolutionType   : 15 çözüm tipi (düz liste)
 *   - permanentPrevention : 9 kalıcı önlem (düz liste, global)
 *
 * Davranış (idempotent, geri alınabilir):
 *   1. v4 satırları upsert edilir (create/update), isActive=true, metadata.taxVersion="v4".
 *   2. Bu 4 tipteki, v4'te OLMAYAN eski aktif satırlar isActive=false yapılır
 *      (SİLİNMEZ → eski Case'ler tarihsel görünür).
 *
 * CLI:
 *   --company <id|name>   default "COMP-UNIVERA"
 *   --dry-run             (VARSAYILAN) yazma yapmaz, planı raporlar
 *   --execute             gerçekten yazar
 *
 * Çalıştır:
 *   node --env-file=.env scripts/seed-closure-taxonomy-v4.mjs           # dry-run
 *   node --env-file=.env scripts/seed-closure-taxonomy-v4.mjs --execute # yazar
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const COMPANY = val('company', 'COMP-UNIVERA');
const EXECUTE = flag('execute');
const TYPES = ['rootCauseGroup', 'rootCauseDetail', 'resolutionType', 'permanentPrevention'];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(path.join(root, 'data/closure-taxonomy-v4.json'), 'utf8'));

function metaStr(obj) {
  return JSON.stringify(obj);
}

async function resolveCompanyId(v) {
  // Önce id olarak dene, olmazsa name.
  const byId = await prisma.company.findUnique({ where: { id: v }, select: { id: true, name: true } });
  if (byId) return byId;
  const byName = await prisma.company.findFirst({ where: { name: v }, select: { id: true, name: true } });
  return byName;
}

async function main() {
  const company = await resolveCompanyId(COMPANY);
  if (!company) {
    console.error(`❌ Şirket bulunamadı: ${COMPANY}`);
    process.exit(1);
  }
  const CID = company.id;
  console.log(`Şirket: ${company.name} (${CID})`);
  console.log(`Mod: ${EXECUTE ? '🔴 EXECUTE (yazacak)' : '🟢 DRY-RUN (yazmaz)'}\n`);

  // ── Yeni v4 kod setleri ──
  const newGroups = data.groups.map((g) => ({ code: g.code, label: g.label, sortOrder: g.sortOrder }));
  const newDetails = data.groups.flatMap((g) =>
    g.details.map((d) => ({ code: d.code, label: d.label, sortOrder: d.sortOrder, groupCode: g.code, allowed: d.allowedResolutionTypes })),
  );
  const newRes = data.resolutionTypes;
  const newPrev = data.permanentPreventions;
  const newCodes = {
    rootCauseGroup: new Set(newGroups.map((x) => x.code)),
    rootCauseDetail: new Set(newDetails.map((x) => x.code)),
    resolutionType: new Set(newRes.map((x) => x.code)),
    permanentPrevention: new Set(newPrev.map((x) => x.code)),
  };

  // ── Mevcut durum ──
  const existing = await prisma.taxonomyDef.findMany({
    where: { companyId: CID, taxonomyType: { in: TYPES } },
    select: { id: true, taxonomyType: true, code: true, isActive: true },
  });
  const existByTypeCode = new Map(existing.map((r) => [`${r.taxonomyType}:${r.code}`, r]));
  const toDeactivate = existing.filter(
    (r) => r.isActive !== false && !newCodes[r.taxonomyType].has(r.code),
  );

  // ── Plan raporu ──
  const plan = { rootCauseGroup: newGroups.length, rootCauseDetail: newDetails.length, resolutionType: newRes.length, permanentPrevention: newPrev.length };
  console.log('YENİ v4 (upsert edilecek):');
  for (const t of TYPES) {
    const existing_v4 = [...newCodes[t]].filter((c) => existByTypeCode.has(`${t}:${c}`)).length;
    console.log(`  ${t}: ${plan[t]} (yeni: ${plan[t] - existing_v4}, güncellenecek: ${existing_v4})`);
  }
  console.log('\nPASİFLEŞTİRİLECEK (v4 dışı eski aktif satırlar, SİLİNMEZ):');
  const deacByType = {};
  for (const r of toDeactivate) deacByType[r.taxonomyType] = (deacByType[r.taxonomyType] || 0) + 1;
  for (const t of TYPES) console.log(`  ${t}: ${deacByType[t] || 0}`);

  if (!EXECUTE) {
    console.log('\n🟢 DRY-RUN — hiçbir şey yazılmadı. Gerçekten uygulamak için: --execute');
    await prisma.$disconnect();
    return;
  }

  // ── EXECUTE ──
  console.log('\n🔴 Yazılıyor...');
  // 1) Gruplar
  const groupIdByCode = {};
  for (const g of newGroups) {
    const row = await prisma.taxonomyDef.upsert({
      where: { companyId_taxonomyType_code: { companyId: CID, taxonomyType: 'rootCauseGroup', code: g.code } },
      create: { companyId: CID, taxonomyType: 'rootCauseGroup', code: g.code, label: g.label, sortOrder: g.sortOrder, isActive: true, metadata: metaStr({ taxVersion: 'v4' }) },
      update: { label: g.label, sortOrder: g.sortOrder, isActive: true, parentId: null, metadata: metaStr({ taxVersion: 'v4' }) },
      select: { id: true },
    });
    groupIdByCode[g.code] = row.id;
  }
  // 2) Detaylar (parentId + allowedResolutionTypes)
  for (const d of newDetails) {
    await prisma.taxonomyDef.upsert({
      where: { companyId_taxonomyType_code: { companyId: CID, taxonomyType: 'rootCauseDetail', code: d.code } },
      create: { companyId: CID, taxonomyType: 'rootCauseDetail', code: d.code, label: d.label, sortOrder: d.sortOrder, isActive: true, parentId: groupIdByCode[d.groupCode], metadata: metaStr({ taxVersion: 'v4', allowedResolutionTypes: d.allowed }) },
      update: { label: d.label, sortOrder: d.sortOrder, isActive: true, parentId: groupIdByCode[d.groupCode], metadata: metaStr({ taxVersion: 'v4', allowedResolutionTypes: d.allowed }) },
    });
  }
  // 3) Çözüm tipleri + 4) Kalıcı önlemler
  for (const [type, list] of [['resolutionType', newRes], ['permanentPrevention', newPrev]]) {
    for (const x of list) {
      await prisma.taxonomyDef.upsert({
        where: { companyId_taxonomyType_code: { companyId: CID, taxonomyType: type, code: x.code } },
        create: { companyId: CID, taxonomyType: type, code: x.code, label: x.label, sortOrder: x.sortOrder, isActive: true, metadata: metaStr({ taxVersion: 'v4' }) },
        update: { label: x.label, sortOrder: x.sortOrder, isActive: true, parentId: null, metadata: metaStr({ taxVersion: 'v4' }) },
      });
    }
  }
  // 5) v4 dışı eskileri pasifleştir
  if (toDeactivate.length) {
    await prisma.taxonomyDef.updateMany({
      where: { id: { in: toDeactivate.map((r) => r.id) } },
      data: { isActive: false },
    });
  }
  console.log(`✅ Bitti. Upsert: ${newGroups.length + newDetails.length + newRes.length + newPrev.length}, pasifleştirilen: ${toDeactivate.length}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
