/**
 * TaxonomyDef (DB, arayüzden yönetilen) → cc-taxonomy-v2.json (KB öneri motoru)
 * senkronizasyonu.
 *
 * Akıllı Ticket tanımları ekranında yapılan düzenlemeler DB'ye yazılır; ama
 * KB'nin Claude'a verdiği aday listeleri data/cc-taxonomy-v2.json'dan gelir.
 * İkisi ayrışırsa KB eski etiketi önerir ve eşleşme düşer. Bu script DB'deki
 * AKTİF tanımları tek doğruluk kaynağı kabul edip json'ı günceller:
 *
 *   platform / businessProcess / operationType / affectedObject / impact
 *     → open.{platform,is_sureci,islem_tipi,etkilenen_nesne,etki}.values
 *   rootCauseGroup(+rootCauseDetail children) → close.kok_neden.groups
 *   resolutionType → close.cozum_tipi.values
 *   permanentPrevention → close.kalici_onlem.values
 *   (open.urun DB'de yönetilmiyor — dokunulmaz)
 *
 * Hem CSM'in data/ kopyası hem ticket-analiz kaynak kopyası güncellenir.
 * Sonrasında uygulama restart edilmeli (dosya modül yüklemede okunur):
 *   pm2 restart varuna-cm
 *
 * Çalıştırma: node --env-file=.env scripts/sync-kb-taxonomy-from-db.mjs [--company COMP-UNIVERA]
 */

import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const COMPANY = args[args.indexOf('--company') + 1] && args.includes('--company')
  ? args[args.indexOf('--company') + 1]
  : 'COMP-UNIVERA';

const TARGETS = [
  'data/cc-taxonomy-v2.json',
  'C:/apps/ticket-analiz/data/cc-taxonomy-v2.json',
];

const rows = await prisma.taxonomyDef.findMany({
  where: { companyId: COMPANY, isActive: true },
  orderBy: [{ taxonomyType: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
  select: { id: true, taxonomyType: true, label: true, parentId: true },
});
await prisma.$disconnect();

const byType = {};
for (const r of rows) (byType[r.taxonomyType] ??= []).push(r);
const labels = (t) => (byType[t] ?? []).map((r) => r.label);

const OPEN_MAP = {
  platform: 'platform',
  is_sureci: 'businessProcess',
  islem_tipi: 'operationType',
  etkilenen_nesne: 'affectedObject',
  etki: 'impact',
};

for (const target of TARGETS) {
  if (!fs.existsSync(target)) {
    console.warn(`atlandı (yok): ${target}`);
    continue;
  }
  const doc = JSON.parse(fs.readFileSync(target, 'utf8'));
  const changes = [];

  for (const [jsonKey, dbType] of Object.entries(OPEN_MAP)) {
    if (!doc.open?.[jsonKey] || !byType[dbType]) continue;
    const next = labels(dbType);
    const prev = doc.open[jsonKey].values ?? [];
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      doc.open[jsonKey].values = next;
      changes.push(`open.${jsonKey}: ${prev.length} → ${next.length}`);
    }
  }

  if (doc.close?.kok_neden && byType.rootCauseGroup) {
    const groups = byType.rootCauseGroup.map((g) => ({
      group: g.label,
      details: (byType.rootCauseDetail ?? []).filter((d) => d.parentId === g.id).map((d) => d.label),
    }));
    if (JSON.stringify(doc.close.kok_neden.groups) !== JSON.stringify(groups)) {
      doc.close.kok_neden.groups = groups;
      changes.push(`close.kok_neden: ${groups.length} grup senkronlandı`);
    }
  }
  for (const [jsonKey, dbType] of [['cozum_tipi', 'resolutionType'], ['kalici_onlem', 'permanentPrevention']]) {
    if (!doc.close?.[jsonKey] || !byType[dbType]) continue;
    const next = labels(dbType);
    if (JSON.stringify(doc.close[jsonKey].values ?? []) !== JSON.stringify(next)) {
      doc.close[jsonKey].values = next;
      changes.push(`close.${jsonKey}: ${next.length}`);
    }
  }

  doc.syncedFromDbAt = new Date().toISOString();
  fs.writeFileSync(target, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log(`✓ ${target}`);
  for (const c of changes) console.log(`    ${c}`);
  if (!changes.length) console.log('    (değişiklik yok)');
}

console.log('\nBitti. Etkili olması için: pm2 restart varuna-cm');
