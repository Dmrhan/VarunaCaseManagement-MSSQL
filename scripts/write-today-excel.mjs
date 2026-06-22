// Bugun cozulen vakalar: mevcut | duzeltilmis kategoriler yan yana, degisenler SARI.
import ExcelJS from 'exceljs';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const root = process.cwd();
const data = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'today-data.json'), 'utf8'));
const tax = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'taxonomy-options.json'), 'utf8'));
const strip = (s) => s.replace(/\s*\(grup:.*$/, '').trim();
const valid = {
  platform: new Set(tax.platform), isSureci: new Set(tax.businessProcess), islemTipi: new Set(tax.operationType),
  etkilenenNesne: new Set(tax.affectedObject), etki: new Set(tax.impact),
  kokNedenGrubu: new Set(tax.rootCauseGroup), kokNedenDetayi: new Set(tax.rootCauseDetail.map(strip)),
  cozumTipi: new Set(tax.resolutionType), kaliciOnlem: new Set(tax.permanentPrevention),
};

// Insan kontrolu sonrasi duzeltmeler (sadece degisen alanlar)
const CORR = {
  'VK-MQI0FMHK': { kapanis: { kokNedenGrubu: 'Kullanım / Eğitim', kokNedenDetayi: 'Bilgi / nasıl yapılır' } },
  'VK-MQI0434L': { kapanis: { kaliciOnlem: 'Bilgi bankası yazısı hazırlanacak' } },
  'VK-MQHZYOBI': { kapanis: { kaliciOnlem: 'Kontrol / validasyon eklenecek' } },
  'VK-MQHZWL6C': { acilis: { platform: 'Backoffice' } },
  'VK-MQHZKHLI': { acilis: { etkilenenNesne: 'Web Servis / Aktarım' } },
  'VK-MQHYWEQ2': { acilis: { platform: 'Backoffice', etkilenenNesne: 'Ticari Pakete Aktarim' }, kapanis: { kokNedenGrubu: 'Kullanım / Eğitim', kokNedenDetayi: 'Bilgi / nasıl yapılır', cozumTipi: 'Bilgilendirme', kaliciOnlem: 'Bilgi bankası yazısı hazırlanacak' } },
  'VK-MQHYKRGC': { acilis: { islemTipi: 'Düzeltme' } },
  'VK-MQHYAHIC': { acilis: { isSureci: 'E-Belge (e-fatura / e-arşiv)' } },
  'VK-MQHY2U83': { kapanis: { kokNedenDetayi: 'Bozuk kayıt (stok tipi / belge detayı)', cozumTipi: 'Veri / kart düzeltme', kaliciOnlem: 'Kontrol / validasyon eklenecek' } },
  'VK-MQHXZEC9': { acilis: { islemTipi: 'Görünüm problemi' } },
};

const FIELDS = [
  ['Platform', 'acilis', 'platform'], ['İş Süreci', 'acilis', 'isSureci'], ['İşlem Tipi', 'acilis', 'islemTipi'],
  ['Etkilenen Nesne', 'acilis', 'etkilenenNesne'], ['Etki', 'acilis', 'etki'],
  ['Kök Neden Grubu', 'kapanis', 'kokNedenGrubu'], ['Kök Neden Detayı', 'kapanis', 'kokNedenDetayi'],
  ['Çözüm Tipi', 'kapanis', 'cozumTipi'], ['Kalıcı Önlem', 'kapanis', 'kaliciOnlem'],
];

const invalid = [];
const recs = data.map((d) => {
  const c = CORR[d.no] || {};
  const cells = FIELDS.map(([lbl, grp, key]) => {
    const mevcut = d[grp][key] || '';
    const duz = (c[grp] && c[grp][key] != null) ? c[grp][key] : mevcut;
    if (duz && !valid[key].has(duz)) invalid.push(`${d.no} ${key}="${duz}"`);
    return { lbl, mevcut, duz, fark: duz !== mevcut };
  });
  return { d, cells, farkSayisi: cells.filter((x) => x.fark).length };
});
recs.sort((a, b) => b.farkSayisi - a.farkSayisi);
if (invalid.length) { console.log('GECERSIZ duzeltme:'); invalid.forEach((x) => console.log('  ! ' + x)); }

const wb = new ExcelJS.Workbook();
const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE08A' } };
const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
const ws = wb.addWorksheet('Bugun Duzeltme');
const head = ['Vaka No', 'Şirket', 'Düzeltme Sayısı', 'Sorun', 'Çözüm'];
for (const [lbl] of FIELDS) head.push(`${lbl} (Mevcut)`, `${lbl} (Düzeltilmiş)`);
ws.addRow(head);
ws.getRow(1).eachCell((c) => { c.fill = HEAD; c.font = { bold: true }; });
ws.getRow(1).height = 26;
for (const r of recs) {
  const row = [r.d.no, r.d.sirket, r.farkSayisi, r.d.sorun.slice(0, 300), r.d.cozum.slice(0, 300)];
  for (const c of r.cells) row.push(c.mevcut, c.duz);
  const xr = ws.addRow(row);
  r.cells.forEach((c, i) => { if (c.fark) xr.getCell(7 + i * 2).fill = YELLOW; });
  if (r.farkSayisi > 0) xr.getCell(3).fill = YELLOW;
}
ws.columns.forEach((col, i) => { col.width = i < 2 ? 14 : i === 2 ? 10 : i < 5 ? 46 : 20; });
ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } };

const desk = path.join(os.homedir(), 'Desktop');
let out = null;
for (const name of ['VK-bugun-duzeltilmis.xlsx', 'VK-bugun-duzeltilmis-v2.xlsx']) {
  try { await wb.xlsx.writeFile(path.join(desk, name)); out = path.join(desk, name); break; }
  catch (e) { if (e.code !== 'EBUSY') throw e; console.log('(kilitli: ' + name + ')'); }
}
console.log(`Vaka: ${recs.length} | duzeltilen vaka: ${recs.filter((r) => r.farkSayisi > 0).length} | toplam degisen alan: ${recs.reduce((s, r) => s + r.farkSayisi, 0)}`);
console.log(`Excel: ${out}`);
