// Taksonomi yeniden yapılanması sonrası gold few-shot'ı temizler:
//  - relabel: cozumTipi "Versiyon geçişi"/"DLL Geçişi" → "DLL Geçişi / Versiyon geçişi";
//    kokNedenDetayi "Cihaz bağlantısı / eşleştirme" → "Cihaz bağlantı bilgileri"
//  - çıkar: pasifleşen etiketleri içeren örnekler (kokNedenGrubu Kullanım/Bilgi
//    Eksikliği veya Koşul Yakalanmadı; cozumTipi Bilgilendirme) — yoksa LLM
//    bu örneklerden öğrenip pasif etiketleri önermeye devam eder.
//
// Kullanım:
//   node scripts/update-gold-for-restructure.mjs            (dry-run)
//   node scripts/update-gold-for-restructure.mjs --commit   (yazar)
import fs from 'node:fs';

const commit = process.argv.includes('--commit');
const GOLD = new URL('../data/cc-gold-examples.json', import.meta.url);

const REMOVE_GROUPS = ['Kullanım/Bilgi Eksikliği', 'Koşul Yakalanmadı'];
const REMOVE_RT = ['Bilgilendirme'];
const RELABEL_RT = {
  'Versiyon geçişi': 'DLL Geçişi / Versiyon geçişi',
  'DLL Geçişi': 'DLL Geçişi / Versiyon geçişi',
};
const RELABEL_DETAY = {
  'Cihaz bağlantısı / eşleştirme': 'Cihaz bağlantı bilgileri',
};

const gold = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
let removed = 0;
let relabeled = 0;
const removedReasons = {};
const kept = [];

for (const ex of gold) {
  // relabel (çıkarmadan önce)
  if (RELABEL_RT[ex.cozumTipi]) { ex.cozumTipi = RELABEL_RT[ex.cozumTipi]; relabeled += 1; }
  if (RELABEL_DETAY[ex.kokNedenDetayi]) { ex.kokNedenDetayi = RELABEL_DETAY[ex.kokNedenDetayi]; relabeled += 1; }

  // çıkar
  let reason = null;
  if (REMOVE_GROUPS.includes(ex.kokNedenGrubu)) reason = `grup:${ex.kokNedenGrubu}`;
  else if (REMOVE_RT.includes(ex.cozumTipi)) reason = `cozumTipi:${ex.cozumTipi}`;
  if (reason) {
    removed += 1;
    removedReasons[reason] = (removedReasons[reason] || 0) + 1;
    continue;
  }
  kept.push(ex);
}

console.log(`gold: ${gold.length} -> ${kept.length}  | çıkarılan: ${removed} | relabel: ${relabeled}`);
console.log('çıkarma nedenleri:', JSON.stringify(removedReasons));

// kalan dağılım
const dist = {};
for (const ex of kept) dist[ex.kokNedenGrubu] = (dist[ex.kokNedenGrubu] || 0) + 1;
console.log('\n=== kalan kök neden grubu dağılımı ===');
Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(3)}  ${k}`));

if (commit) {
  fs.writeFileSync(GOLD, JSON.stringify(kept, null, 1), 'utf8');
  console.log(`\n✓ YAZILDI: data/cc-gold-examples.json (${kept.length} örnek)`);
} else {
  console.log('\n(dry-run — yazmak için --commit)');
}
