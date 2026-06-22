// Taksonomi yeniden yapılanması (TaxonomyDef DB).
//  - Pasifleştir: Kullanım/Bilgi Eksikliği (grup), Koşul Yakalanmadı (grup),
//    Bilgilendirme (çözüm tipi), Versiyon geçişi (çözüm tipi → DLL ile birleşiyor)
//  - Relabel: DLL Geçişi → "DLL Geçişi / Versiyon geçişi";
//    "Cihaz bağlantısı / eşleştirme" → "Cihaz bağlantı bilgileri"
//  - Ekle: Veri Tabanı İsteği (grup), Koşul Yakalanmadı (çözüm tipi),
//    Toplu işlem talebi (kök-neden detayı, bağımsız / parentId=null)
//
// İdempotent. Kullanım:
//   node --env-file=.env scripts/restructure-taxonomy.mjs            (dry-run)
//   node --env-file=.env scripts/restructure-taxonomy.mjs --commit   (yazar)
import { prisma } from '../server/db/client.js';

const commit = process.argv.includes('--commit');
const CO = 'COMP-UNIVERA';

const DEACTIVATE = ['rcg.kullanim_egitim', 'rcg.kosul_yakalanmadi', 'rt.bilgilendirme', 'rt.versiyon_gecisi'];
const RELABEL = [
  ['rt.dll_gecisi', 'DLL Geçişi / Versiyon geçişi'],
  ['rcd.cihaz_baglantisi_eslestirme', 'Cihaz bağlantı bilgileri'],
];
const CREATE = [
  { taxonomyType: 'rootCauseGroup', code: 'rcg.veri_tabani_istegi', label: 'Veri Tabanı İsteği' },
  { taxonomyType: 'resolutionType', code: 'rt.kosul_yakalanmadi', label: 'Koşul Yakalanmadı' },
  { taxonomyType: 'rootCauseDetail', code: 'rcd.toplu_islem_talebi', label: 'Toplu işlem talebi', parentId: null },
];

const log = [];
async function run() {
  // 1) pasifleştir
  for (const code of DEACTIVATE) {
    const row = await prisma.taxonomyDef.findFirst({ where: { companyId: CO, code } });
    if (!row) { log.push(`(yok, atlandı) pasifleştir ${code}`); continue; }
    if (!row.isActive) { log.push(`(zaten pasif) ${code}`); continue; }
    log.push(`PASİFLEŞTİR ${code} "${row.label}"`);
    if (commit) await prisma.taxonomyDef.update({ where: { id: row.id }, data: { isActive: false } });
  }

  // 2) relabel
  for (const [code, label] of RELABEL) {
    const row = await prisma.taxonomyDef.findFirst({ where: { companyId: CO, code } });
    if (!row) { log.push(`(yok, atlandı) relabel ${code}`); continue; }
    if (row.label === label) { log.push(`(zaten "${label}") ${code}`); continue; }
    log.push(`RELABEL ${code}: "${row.label}" -> "${label}"`);
    if (commit) await prisma.taxonomyDef.update({ where: { id: row.id }, data: { label } });
  }

  // 3) ekle (yoksa)
  for (const c of CREATE) {
    const exists = await prisma.taxonomyDef.findFirst({ where: { companyId: CO, code: c.code } });
    if (exists) {
      // varsa ve pasifse tekrar aktif et
      if (!exists.isActive) {
        log.push(`(vardı, AKTİF EDİLDİ) ${c.code} "${c.label}"`);
        if (commit) await prisma.taxonomyDef.update({ where: { id: exists.id }, data: { isActive: true, label: c.label } });
      } else log.push(`(zaten var) ${c.code} "${c.label}"`);
      continue;
    }
    const maxSort = await prisma.taxonomyDef.aggregate({
      where: { companyId: CO, taxonomyType: c.taxonomyType },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxSort._max.sortOrder ?? 0) + 1;
    log.push(`EKLE ${c.taxonomyType} ${c.code} "${c.label}" (sortOrder ${sortOrder}${c.parentId === null ? ', parentId=null bağımsız' : ''})`);
    if (commit) {
      await prisma.taxonomyDef.create({
        data: {
          companyId: CO,
          taxonomyType: c.taxonomyType,
          code: c.code,
          label: c.label,
          isActive: true,
          sortOrder,
          parentId: c.parentId ?? null,
        },
      });
    }
  }

  console.log(`=== ${commit ? 'COMMIT' : 'DRY-RUN'} ===`);
  log.forEach((l) => console.log('  ' + l));
  console.log(commit ? '\n✓ TaxonomyDef güncellendi' : '\n(dry-run — yazmak için --commit)');
  process.exit(0);
}
run().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
