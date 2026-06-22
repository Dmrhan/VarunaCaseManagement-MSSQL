// vk-eval-data.json (vaka verisi) + eval-part-1..6.json (denetci yorumlari)
// birlestirip yorum kolonlu Excel uretir. KB/DB cagrisi yok.
import XLSX from 'xlsx';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const root = process.cwd();
const data = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'vk-eval-data.json'), 'utf8'));

// Part dosyalarini topla (markdown fence varsa temizle)
const comments = [];
for (let i = 1; i <= 7; i++) {
  const p = path.join(root, 'scripts', `eval-part-${i}.json`);
  if (!fs.existsSync(p)) { console.log(`UYARI: eval-part-${i}.json yok`); continue; }
  let raw = fs.readFileSync(p, 'utf8').trim();
  raw = raw.replace(/^```(json)?/i, '').replace(/```$/i, '').trim();
  try { const arr = JSON.parse(raw); comments.push(...arr); }
  catch (e) { console.log(`HATA part-${i} parse: ${e.message}`); }
}
const cmap = new Map(comments.map((c) => [c.no, c]));
console.log(`Vaka: ${data.length} | toplanan yorum: ${comments.length} | eslesen: ${data.filter((d) => cmap.has(d.no)).length}`);
const missing = data.filter((d) => !cmap.has(d.no)).map((d) => d.no);
if (missing.length) console.log(`Yorumu olmayan: ${missing.join(', ')}`);

const rows = data.map((d) => {
  const c = cmap.get(d.no) ?? {};
  return {
    'Vaka No': d.no, 'Durum': d.durum, 'Şirket': d.sirket,
    'Sorun Açıklaması': d.sorun, 'Çözüm Açıklaması': d.cozum,
    'Açılış: Platform': d.acilis.platform, 'Açılış: İş Süreci': d.acilis.isSureci,
    'Açılış: İşlem Tipi': d.acilis.islemTipi, 'Açılış: Etkilenen Nesne': d.acilis.etkilenenNesne,
    'Açılış: Etki': d.acilis.etki,
    'Kapanış: Kök Neden Grubu': d.kapanis.kokNedenGrubu, 'Kapanış: Kök Neden Detayı': d.kapanis.kokNedenDetayi,
    'Kapanış: Çözüm Tipi': d.kapanis.cozumTipi, 'Kapanış: Kalıcı Önlem': d.kapanis.kaliciOnlem,
    'Açılış Değerlendirmesi': c.acilisYorum ?? '', 'Kapanış Değerlendirmesi': c.kapanisYorum ?? '',
    'Genel Not': c.genelNot ?? '',
  };
});

const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = Object.keys(rows[0] ?? { x: 1 }).map((k) =>
  ({ wch: k.includes('Açıklama') || k.includes('Değerlendirme') ? 55 : k === 'Genel Not' ? 32 : k.includes(':') ? 20 : 14 }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'VK Degerlendirme');
const desk = path.join(os.homedir(), 'Desktop');
let out = null;
for (const name of ['VK-kapali-degerlendirme.xlsx', 'VK-kapali-degerlendirme-v2.xlsx', 'VK-kapali-degerlendirme-v3.xlsx']) {
  try { XLSX.writeFile(wb, path.join(desk, name)); out = path.join(desk, name); break; }
  catch (e) { if (e.code !== 'EBUSY') throw e; console.log(`(kilitli: ${name})`); }
}
console.log(`Excel: ${out}`);

// Spot-check: ilk 2 + ornek bir 'yanlis' vaka
console.log('\n=== SPOT-CHECK ===');
for (const no of [data[0].no, data[1].no, 'VK-MQ9L2OGY', 'VK-MQ8445NI']) {
  const c = cmap.get(no); if (!c) continue;
  console.log(`\n[${no}] ${c.genelNot}`);
  console.log(`  Acilis: ${c.acilisYorum}`);
  console.log(`  Kapanis: ${c.kapanisYorum}`);
}
