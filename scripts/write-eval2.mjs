// vk-eval-data.json (vaka + mevcut etiket) + eval2-part-1..6.json (onerilen kategori)
// + taxonomy-options.json (gecerlilik) -> "Mevcut | Oneri" yan yana Excel.
import XLSX from 'xlsx';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const root = process.cwd();
const data = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'vk-eval-data.json'), 'utf8'));
const tax = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'taxonomy-options.json'), 'utf8'));
const strip = (s) => s.replace(/\s*\(grup:.*$/, '').trim();
const validSets = {
  platform: new Set(tax.platform), isSureci: new Set(tax.businessProcess),
  islemTipi: new Set(tax.operationType), etkilenenNesne: new Set(tax.affectedObject), etki: new Set(tax.impact),
  kokNedenGrubu: new Set(tax.rootCauseGroup), kokNedenDetayi: new Set(tax.rootCauseDetail.map(strip)),
  cozumTipi: new Set(tax.resolutionType), kaliciOnlem: new Set(tax.permanentPrevention),
};

const oneri = [];
for (let i = 1; i <= 7; i++) {
  const p = path.join(root, 'scripts', `eval2-part-${i}.json`);
  if (!fs.existsSync(p)) { console.log(`UYARI: eval2-part-${i}.json yok`); continue; }
  let raw = fs.readFileSync(p, 'utf8').trim().replace(/^```(json)?/i, '').replace(/```$/i, '').trim();
  try { oneri.push(...JSON.parse(raw)); } catch (e) { console.log(`HATA part-${i}: ${e.message}`); }
}
const omap = new Map(oneri.map((o) => [o.no, o]));
console.log(`Vaka: ${data.length} | oneri: ${oneri.length} | eslesen: ${data.filter((d) => omap.has(d.no)).length}`);

// Gecersiz oneri kontrolu
const invalid = [];
for (const o of oneri) {
  for (const [k, v] of Object.entries({ ...o.acilis, ...o.kapanis })) {
    if (v && !validSets[k]?.has(v)) invalid.push(`${o.no} ${k}="${v}"`);
  }
}
console.log(`Taksonomide OLMAYAN oneri degeri: ${invalid.length}`);
if (invalid.length) invalid.slice(0, 25).forEach((x) => console.log('  ! ' + x));

// Gecersiz (taksonomide olmayan) oneri degerini Excel'e yazma — bosalt.
const clip = (f, v) => (v && validSets[f]?.has(v)) ? v : '';
const A = (o, f) => clip(f, o?.acilis?.[f] ?? '');
const K = (o, f) => clip(f, o?.kapanis?.[f] ?? '');
const rows = data.map((d) => {
  const o = omap.get(d.no);
  return {
    'Vaka No': d.no, 'Durum': d.durum,
    'Sorun Açıklaması': d.sorun, 'Çözüm Açıklaması': d.cozum,
    'Platform (Mevcut)': d.acilis.platform, 'Platform (Öneri)': A(o, 'platform'),
    'İş Süreci (Mevcut)': d.acilis.isSureci, 'İş Süreci (Öneri)': A(o, 'isSureci'),
    'İşlem Tipi (Mevcut)': d.acilis.islemTipi, 'İşlem Tipi (Öneri)': A(o, 'islemTipi'),
    'Etkilenen Nesne (Mevcut)': d.acilis.etkilenenNesne, 'Etkilenen Nesne (Öneri)': A(o, 'etkilenenNesne'),
    'Etki (Mevcut)': d.acilis.etki, 'Etki (Öneri)': A(o, 'etki'),
    'Kök Neden Grubu (Mevcut)': d.kapanis.kokNedenGrubu, 'Kök Neden Grubu (Öneri)': K(o, 'kokNedenGrubu'),
    'Kök Neden Detayı (Mevcut)': d.kapanis.kokNedenDetayi, 'Kök Neden Detayı (Öneri)': K(o, 'kokNedenDetayi'),
    'Çözüm Tipi (Mevcut)': d.kapanis.cozumTipi, 'Çözüm Tipi (Öneri)': K(o, 'cozumTipi'),
    'Kalıcı Önlem (Mevcut)': d.kapanis.kaliciOnlem, 'Kalıcı Önlem (Öneri)': K(o, 'kaliciOnlem'),
  };
});

const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = Object.keys(rows[0]).map((k) =>
  ({ wch: k.includes('Açıklama') ? 50 : k.includes('Nesne') ? 24 : k.includes('(') ? 20 : 14 }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'VK Mevcut vs Oneri');
const desk = path.join(os.homedir(), 'Desktop');
let out = null;
for (const name of ['VK-kapali-kategori-oneri.xlsx', 'VK-kapali-kategori-oneri-v2.xlsx', 'VK-kapali-kategori-oneri-v3.xlsx']) {
  try { XLSX.writeFile(wb, path.join(desk, name)); out = path.join(desk, name); break; }
  catch (e) { if (e.code !== 'EBUSY') throw e; console.log(`(kilitli: ${name})`); }
}
console.log(`Excel: ${out}`);
