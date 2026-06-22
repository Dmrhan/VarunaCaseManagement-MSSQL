// Taksonomi yeniden yapılanması — vaka migrasyonu (FAZ 1: relabel + clear).
//
//  A) RELABEL (DB-only, KB gerekmez) — label snapshot'ı güncel taksonomiye çek:
//     - resolutionType "Versiyon geçişi"(rt.versiyon_gecisi) → rt.dll_gecisi
//       label "DLL Geçişi / Versiyon geçişi"
//     - resolutionType "DLL Geçişi" → label "DLL Geçişi / Versiyon geçişi"
//     - rootCauseDetail "Cihaz bağlantısı / eşleştirme" → "Cihaz bağlantı bilgileri"
//
//  B) CLEAR (yeniden KB sınıflandırması için pasif etiketi boşalt):
//     - rootCauseGroup "Kullanım/Bilgi Eksikliği" → grup+detay alanlarını sil
//     - resolutionType "Bilgilendirme" → çözüm tipi alanlarını sil
//   Boşalan alanlar fill-vk-kb ile yeni taksonomiden yeniden doldurulacak.
//
// Kullanım:
//   node --env-file=.env scripts/migrate-restructure-cases.mjs            (dry-run)
//   node --env-file=.env scripts/migrate-restructure-cases.mjs --commit   (yazar)
import { prisma } from '../server/db/client.js';

const commit = process.argv.includes('--commit');

const cases = await prisma.case.findMany({
  where: { caseNumber: { startsWith: 'VK-' }, customFields: { not: null } },
  select: { id: true, caseNumber: true, customFields: true },
});

const stat = { relabelVer: 0, relabelDll: 0, relabelDetay: 0, clearGroup: 0, clearRT: 0 };
let touched = 0;

for (const c of cases) {
  let cf;
  try {
    cf = typeof c.customFields === 'string' ? JSON.parse(c.customFields) : c.customFields;
  } catch {
    continue;
  }
  const cl = cf?.smartTicket?.closure;
  if (!cl) continue;
  let dirty = false;

  // A) RELABEL
  if (cl.resolutionTypeLabel === 'Versiyon geçişi') {
    cl.resolutionType = 'rt.dll_gecisi';
    cl.resolutionTypeLabel = 'DLL Geçişi / Versiyon geçişi';
    stat.relabelVer += 1; dirty = true;
  } else if (cl.resolutionTypeLabel === 'DLL Geçişi') {
    cl.resolutionTypeLabel = 'DLL Geçişi / Versiyon geçişi';
    stat.relabelDll += 1; dirty = true;
  }
  if (cl.rootCauseDetailLabel === 'Cihaz bağlantısı / eşleştirme') {
    cl.rootCauseDetailLabel = 'Cihaz bağlantı bilgileri';
    stat.relabelDetay += 1; dirty = true;
  }

  // B) CLEAR (pasifleşen etiketler → yeniden KB)
  if (cl.rootCauseGroupLabel === 'Kullanım/Bilgi Eksikliği') {
    delete cl.rootCauseGroup; delete cl.rootCauseGroupLabel;
    delete cl.rootCauseDetail; delete cl.rootCauseDetailLabel;
    stat.clearGroup += 1; dirty = true;
  }
  if (cl.resolutionTypeLabel === 'Bilgilendirme') {
    delete cl.resolutionType; delete cl.resolutionTypeLabel;
    stat.clearRT += 1; dirty = true;
  }

  if (dirty) {
    touched += 1;
    if (commit) await prisma.case.update({ where: { id: c.id }, data: { customFields: cf } });
  }
}

console.log(`=== ${commit ? 'COMMIT' : 'DRY-RUN'} — etkilenen vaka: ${touched} ===`);
console.log('  RELABEL Versiyon geçişi → DLL/Versiyon:', stat.relabelVer);
console.log('  RELABEL DLL Geçişi → DLL/Versiyon:', stat.relabelDll);
console.log('  RELABEL Cihaz bağlantısı/eşleştirme → Cihaz bağlantı bilgileri:', stat.relabelDetay);
console.log('  CLEAR Kullanım/Bilgi Eksikliği grubu (yeniden KB):', stat.clearGroup);
console.log('  CLEAR Bilgilendirme çözüm tipi (yeniden KB):', stat.clearRT);
console.log(commit ? '\n✓ DB güncellendi — sıradaki: fill-vk-kb ile boşalan alanları doldur' : '\n(dry-run — yazmak için --commit)');
process.exit(0);
