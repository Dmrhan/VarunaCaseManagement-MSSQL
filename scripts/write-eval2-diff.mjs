// Mevcut vs Oneri farklarini GORSEL gosterir:
//  Sheet 1 "Karsilastirma": oneri != mevcut hucreleri SARI; Fark Sayisi'na gore sirali.
//  Sheet 2 "Farklar": her degisiklik tek satir (Vaka, Alan, Mevcut, Oneri).
import ExcelJS from 'exceljs';
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
  if (!fs.existsSync(p)) continue;
  let raw = fs.readFileSync(p, 'utf8').trim().replace(/^```(json)?/i, '').replace(/```$/i, '').trim();
  try { oneri.push(...JSON.parse(raw)); } catch {}
}
const om = new Map(oneri.map((o) => [o.no, o]));
const clip = (f, v) => (v && validSets[f]?.has(v)) ? v : '';

const FIELDS = [
  ['Platform', 'acilis', 'platform'], ['İş Süreci', 'acilis', 'isSureci'],
  ['İşlem Tipi', 'acilis', 'islemTipi'], ['Etkilenen Nesne', 'acilis', 'etkilenenNesne'],
  ['Etki', 'acilis', 'etki'],
  ['Kök Neden Grubu', 'kapanis', 'kokNedenGrubu'], ['Kök Neden Detayı', 'kapanis', 'kokNedenDetayi'],
  ['Çözüm Tipi', 'kapanis', 'cozumTipi'], ['Kalıcı Önlem', 'kapanis', 'kaliciOnlem'],
];

// Her vaka icin mevcut/oneri/fark hesapla
const recs = data.map((d) => {
  const o = om.get(d.no);
  const cells = FIELDS.map(([lbl, grp, key]) => {
    const mevcut = d[grp][key] ?? '';
    const oneriV = clip(key, o?.[grp]?.[key] ?? '');
    const fark = oneriV !== '' && oneriV !== mevcut;
    return { lbl, mevcut, oneri: oneriV, fark };
  });
  return { d, cells, farkSayisi: cells.filter((c) => c.fark).length };
});
recs.sort((a, b) => b.farkSayisi - a.farkSayisi);

const wb = new ExcelJS.Workbook();
const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE08A' } };
const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

// ── Sheet 1: Karsilastirma ──
const s1 = wb.addWorksheet('Karsilastirma');
const head1 = ['Vaka No', 'Durum', 'Fark Sayısı', 'Sorun Açıklaması', 'Çözüm Açıklaması'];
for (const [lbl] of FIELDS) head1.push(`${lbl} (Mevcut)`, `${lbl} (Öneri)`);
s1.addRow(head1);
s1.getRow(1).eachCell((c) => { c.fill = HEAD; c.font = { bold: true }; });
s1.getRow(1).height = 28;
for (const r of recs) {
  const row = [r.d.no, r.d.durum, r.farkSayisi, r.d.sorun.slice(0, 400), r.d.cozum.slice(0, 400)];
  for (const c of r.cells) row.push(c.mevcut, c.oneri);
  const xr = s1.addRow(row);
  // oneri hucrelerini farkliysa sarila (kolon: 6 + i*2)
  r.cells.forEach((c, i) => { if (c.fark) xr.getCell(6 + i * 2).fill = YELLOW; });
  if (r.farkSayisi > 0) xr.getCell(3).fill = YELLOW;
}
s1.columns.forEach((col, i) => { col.width = i < 2 ? 13 : i === 2 ? 9 : i < 5 ? 50 : 20; });
s1.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
s1.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head1.length } };

// ── Sheet 2: Farklar (her degisiklik tek satir) ──
const s2 = wb.addWorksheet('Farklar');
s2.addRow(['Vaka No', 'Durum', 'Alan', 'Mevcut', 'Önerilen', 'Sorun (kısa)']);
s2.getRow(1).eachCell((c) => { c.fill = HEAD; c.font = { bold: true }; });
let diffCount = 0;
for (const r of recs) {
  for (const c of r.cells) {
    if (!c.fark) continue;
    diffCount++;
    const xr = s2.addRow([r.d.no, r.d.durum, c.lbl, c.mevcut || '(boş)', c.oneri, r.d.sorun.slice(0, 80)]);
    xr.getCell(5).fill = YELLOW;
  }
}
s2.columns = [{ width: 14 }, { width: 12 }, { width: 18 }, { width: 26 }, { width: 26 }, { width: 50 }];
s2.views = [{ state: 'frozen', ySplit: 1 }];
s2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };

const desk = path.join(os.homedir(), 'Desktop');
let out = null;
for (const name of ['VK-kapali-kategori-farklar.xlsx', 'VK-kapali-kategori-farklar-v2.xlsx', 'VK-kapali-kategori-farklar-v3.xlsx']) {
  try { await wb.xlsx.writeFile(path.join(desk, name)); out = path.join(desk, name); break; }
  catch (e) { if (e.code !== 'EBUSY') throw e; console.log(`(kilitli: ${name})`); }
}
const farkliVaka = recs.filter((r) => r.farkSayisi > 0).length;
console.log(`Vaka: ${recs.length} | en az 1 farkli: ${farkliVaka} | toplam farkli alan: ${diffCount}`);
console.log(`Excel: ${out}`);
