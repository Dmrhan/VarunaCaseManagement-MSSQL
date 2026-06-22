// 12-17 Haziran kategoriler + hazir ANALIZ sheet'i (pivot gerektirmez).
import ExcelJS from 'exceljs';
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
  if (!fs.existsSync(p)) continue;
  let raw = fs.readFileSync(p, 'utf8').trim().replace(/^```(json)?/i, '').replace(/```$/i, '').trim();
  try { kat.push(...JSON.parse(raw)); } catch {}
}
const km = new Map(kat.map((k) => [k.no, k]));
const cv = (k, grp, f) => { const v = k?.[grp]?.[f] ?? ''; return (v && valid[f].has(v)) ? v : ''; };
const recs = data.map((d) => ({ d, k: km.get(d.no) }));
const total = recs.length;

function freq(grp, f) {
  const m = {};
  for (const { k } of recs) { const v = cv(k, grp, f) || '(boş)'; m[v] = (m[v] || 0) + 1; }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

const wb = new ExcelJS.Workbook();
const BLUE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
const LITE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

// ── Sheet 1: Kategoriler ──
const s1 = wb.addWorksheet('Kategoriler');
const FIELDS = [['Platform', 'acilis', 'platform'], ['İş Süreci', 'acilis', 'isSureci'], ['İşlem Tipi', 'acilis', 'islemTipi'], ['Etkilenen Nesne', 'acilis', 'etkilenenNesne'], ['Etki', 'acilis', 'etki'], ['Kök Neden Grubu', 'kapanis', 'kokNedenGrubu'], ['Kök Neden Detayı', 'kapanis', 'kokNedenDetayi'], ['Çözüm Tipi', 'kapanis', 'cozumTipi'], ['Kalıcı Önlem', 'kapanis', 'kaliciOnlem']];
const head = ['Vaka No', 'Şirket', 'Sorun', 'Çözüm', ...FIELDS.map((x) => x[0])];
s1.addRow(head);
s1.getRow(1).eachCell((c) => { c.fill = LITE; c.font = { bold: true }; });
for (const { d, k } of recs) {
  s1.addRow([d.no, d.sirket, d.sorun.slice(0, 300), d.cozum.slice(0, 300), ...FIELDS.map(([, g, f]) => cv(k, g, f))]);
}
s1.columns.forEach((c, i) => { c.width = i < 2 ? 14 : i < 4 ? 48 : i === 7 ? 24 : 18; });
s1.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
s1.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } };

// ── Sheet 2: Analiz ──
const s2 = wb.addWorksheet('Analiz');
s2.getCell(1, 1).value = `ANALİZ — 12-17 Haziran Çözülen Vakalar (Toplam: ${total})`;
s2.getCell(1, 1).font = { bold: true, size: 14 };
s2.mergeCells(1, 1, 1, 8);

function block(r0, c0, title, entries, topN) {
  const list = topN ? entries.slice(0, topN) : entries;
  const t = s2.getCell(r0, c0); t.value = title; t.font = { bold: true, color: { argb: 'FFFFFFFF' } }; t.fill = BLUE;
  s2.mergeCells(r0, c0, r0, c0 + 2);
  ['Değer', 'Adet', '%'].forEach((h, i) => { const x = s2.getCell(r0 + 1, c0 + i); x.value = h; x.font = { bold: true }; x.fill = LITE; });
  let r = r0 + 2;
  for (const [val, cnt] of list) {
    s2.getCell(r, c0).value = val;
    s2.getCell(r, c0 + 1).value = cnt;
    s2.getCell(r, c0 + 2).value = Math.round((cnt / total) * 100) + '%';
    r++;
  }
  return r;
}

// Yan yana ciftler: (sol col=1, sag col=5)
let row = 3;
const pair = (titleL, fL, titleR, fR, topN) => {
  const eL = block(row, 1, titleL, freq(fL[0], fL[1]), topN);
  const eR = block(row, 5, titleR, freq(fR[0], fR[1]), topN);
  row = Math.max(eL, eR) + 1;
};
pair('KÖK NEDEN GRUBU', ['kapanis', 'kokNedenGrubu'], 'ÇÖZÜM TİPİ', ['kapanis', 'cozumTipi']);
pair('KALICI ÖNLEM', ['kapanis', 'kaliciOnlem'], 'ETKİ', ['acilis', 'etki']);
pair('PLATFORM', ['acilis', 'platform'], 'İŞLEM TİPİ', ['acilis', 'islemTipi'], 15);
pair('KÖK NEDEN DETAYI (Top 15)', ['kapanis', 'kokNedenDetayi'], 'ETKİLENEN NESNE (Top 15)', ['acilis', 'etkilenenNesne'], 15);
pair('İŞ SÜRECİ (Top 15)', ['acilis', 'isSureci'], 'İŞLEM TİPİ (devam)', ['acilis', 'islemTipi'], 15);

s2.getColumn(1).width = 34; s2.getColumn(2).width = 7; s2.getColumn(3).width = 6;
s2.getColumn(4).width = 2; s2.getColumn(5).width = 34; s2.getColumn(6).width = 7; s2.getColumn(7).width = 6;

const desk = path.join(os.homedir(), 'Desktop');
let out = null;
for (const name of ['VK-12-17Haziran-analiz.xlsx', 'VK-12-17Haziran-analiz-v2.xlsx']) {
  try { await wb.xlsx.writeFile(path.join(desk, name)); out = path.join(desk, name); break; }
  catch (e) { if (e.code !== 'EBUSY') throw e; console.log('(kilitli: ' + name + ')'); }
}
console.log('Vaka: ' + total + ' | 2 sheet (Kategoriler + Analiz)');
console.log('Excel: ' + out);
