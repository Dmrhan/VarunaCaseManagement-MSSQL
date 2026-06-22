// 12-17 Haziran cozulen vakalar: yeni sisteme gore kategoriler (tek tablo).
import XLSX from 'xlsx';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const root = process.cwd();
const data = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'period-data.json'), 'utf8'));
const tax = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'taxonomy-options.json'), 'utf8'));
const strip = (s) => s.replace(/\s*\(grup:.*$/, '').trim();
const valid = {
  platform: new Set(tax.platform), isSureci: new Set(tax.businessProcess), islemTipi: new Set(tax.operationType),
  etkilenenNesne: new Set(tax.affectedObject), etki: new Set(tax.impact),
  kokNedenGrubu: new Set(tax.rootCauseGroup), kokNedenDetayi: new Set(tax.rootCauseDetail.map(strip)),
  cozumTipi: new Set(tax.resolutionType), kaliciOnlem: new Set(tax.permanentPrevention),
};
const kat = [];
for (let i = 1; i <= 7; i++) {
  const p = path.join(root, 'scripts', `eval4-part-${i}.json`);
  if (!fs.existsSync(p)) { console.log('YOK: eval4-part-' + i); continue; }
  let raw = fs.readFileSync(p, 'utf8').trim().replace(/^```(json)?/i, '').replace(/```$/i, '').trim();
  try { kat.push(...JSON.parse(raw)); } catch (e) { console.log('part' + i + ' parse hata: ' + e.message); }
}
const km = new Map(kat.map((k) => [k.no, k]));
const eslesen = data.filter((d) => km.has(d.no)).length;
console.log(`Vaka:${data.length} | kategori:${kat.length} | eslesen:${eslesen}`);
const eksik = data.filter((d) => !km.has(d.no)).map((d) => d.no);
if (eksik.length) console.log('EKSIK: ' + eksik.join(','));
const seen = {}; kat.forEach((k) => seen[k.no] = (seen[k.no] || 0) + 1);
const muk = Object.entries(seen).filter(([, c]) => c > 1).map(([n]) => n);
if (muk.length) console.log('MUKERRER: ' + muk.join(','));
const inv = [];
for (const k of kat) for (const [f, v] of Object.entries({ ...k.acilis, ...k.kapanis })) if (v && !valid[f]?.has(v)) inv.push(`${k.no} ${f}="${v}"`);
console.log('GECERSIZ: ' + inv.length); inv.slice(0, 20).forEach((x) => console.log('  ! ' + x));

const A = (k, f) => { const v = k?.acilis?.[f] ?? ''; return (v && valid[f].has(v)) ? v : ''; };
const K = (k, f) => { const v = k?.kapanis?.[f] ?? ''; return (v && valid[f].has(v)) ? v : ''; };
const rows = data.map((d) => {
  const k = km.get(d.no);
  return {
    'Vaka No': d.no, 'Şirket': d.sirket, 'Sorun': d.sorun, 'Çözüm': d.cozum,
    'Platform': A(k, 'platform'), 'İş Süreci': A(k, 'isSureci'), 'İşlem Tipi': A(k, 'islemTipi'),
    'Etkilenen Nesne': A(k, 'etkilenenNesne'), 'Etki': A(k, 'etki'),
    'Kök Neden Grubu': K(k, 'kokNedenGrubu'), 'Kök Neden Detayı': K(k, 'kokNedenDetayi'),
    'Çözüm Tipi': K(k, 'cozumTipi'), 'Kalıcı Önlem': K(k, 'kaliciOnlem'),
  };
});
const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = Object.keys(rows[0]).map((c) => ({ wch: c === 'Sorun' || c === 'Çözüm' ? 50 : c.includes('Nesne') ? 24 : 18 }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '12-17 Haziran Kategori');
const desk = path.join(os.homedir(), 'Desktop');
let out = null;
for (const name of ['VK-12-17Haziran-kategori.xlsx', 'VK-12-17Haziran-kategori-v2.xlsx']) {
  try { XLSX.writeFile(wb, path.join(desk, name)); out = path.join(desk, name); break; }
  catch (e) { if (e.code !== 'EBUSY') throw e; console.log('(kilitli: ' + name + ')'); }
}
console.log('Excel: ' + out);
