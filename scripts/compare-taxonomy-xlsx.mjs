/**
 * SALT-OKUNUR analiz: Downloads'taki taksonomi Excel'i ile KB tarafındaki
 * kategori sistemini (data/cc-taxonomy-v2.json + DB'deki TaxonomyDef)
 * karşılaştırır. HİÇBİR yere yazmaz.
 *
 * Excel formatı (Sheet1): Konum (Açılış/Kapanış) | Grup Adı | Grup içerik | Grup İçerik
 *   - "Grup içerik"  = değer (ya da Kök Neden'de GRUP adı)
 *   - "Grup İçerik" = ikinci seviye (Kök Neden DETAYI)
 *
 * Çalıştırma: node --env-file=.env scripts/compare-taxonomy-xlsx.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const dlDir = 'C:/Users/univera/Downloads';
const xlsxName = fs.readdirSync(dlDir).find((f) => f.includes('20260604') && f.endsWith('.xlsx'));
if (!xlsxName) { console.error('Excel bulunamadı'); process.exit(1); }
const wb = XLSX.readFile(path.join(dlDir, xlsxName));
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
console.log(`Excel: ${xlsxName} — ${rows.length} satır\n`);

const norm = (s) => String(s ?? '').trim();
const cols = Object.keys(rows[0]);
const C_KONUM = cols.find((c) => /konum/i.test(c));
const C_GRUP = cols.find((c) => /grup ad/i.test(c));
const contentCols = cols.filter((c) => /i[çc]erik/i.test(c)); // 'Grup içerik' + 'Grup İçerik'

// Grup bazında topla: grupAdı -> { values:Set, details:Set (2. kolon doluysa) }
const excel = {};
for (const r of rows) {
  const grup = norm(r[C_GRUP]);
  if (!grup) continue;
  const e = (excel[grup] ??= { konum: norm(r[C_KONUM]), values: new Set(), details: new Set() });
  const v1 = norm(r[contentCols[0]]);
  const v2 = norm(r[contentCols[1]]);
  if (v1) e.values.add(v1);
  if (v2) e.details.add(v2);
}

console.log('=== EXCEL grupları ===');
for (const [g, e] of Object.entries(excel)) {
  console.log(`  [${e.konum}] ${g}: ${e.values.size} değer${e.details.size ? ` + ${e.details.size} detay` : ''}`);
}

// ─── KB kanonik taksonomisi ───────────────────────────────────────────────
const kb = JSON.parse(fs.readFileSync('data/cc-taxonomy-v2.json', 'utf8'));
const kbSets = {
  'Ürün': new Set((kb.open?.urun?.values ?? []).map(norm)),
  'Platform': new Set((kb.open?.platform?.values ?? []).map(norm)),
  'İş Süreci': new Set((kb.open?.is_sureci?.values ?? []).map(norm)),
  'İşlem Tipi': new Set((kb.open?.islem_tipi?.values ?? []).map(norm)),
  'Etkilenen Nesne': new Set((kb.open?.etkilenen_nesne?.values ?? []).map(norm)),
  'Etki': new Set((kb.open?.etki?.values ?? []).map(norm)),
  'Kök Neden Grubu': new Set((kb.close?.kok_neden?.groups ?? []).map((g) => norm(g.group))),
  'Kök Neden Detayı': new Set((kb.close?.kok_neden?.groups ?? []).flatMap((g) => (g.details ?? []).map(norm))),
  'Çözüm Tipi': new Set((kb.close?.cozum_tipi?.values ?? []).map(norm)),
  'Kalıcı Önlem': new Set((kb.close?.kalici_onlem?.values ?? []).map(norm)),
};

const foldTr = (s) => s.toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
  .replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
  .replace(/[^a-z0-9]+/g, '');

function diff(name, excelSet, kbSet) {
  const eF = new Map([...excelSet].map((v) => [foldTr(v), v]));
  const kF = new Map([...kbSet].map((v) => [foldTr(v), v]));
  const onlyE = [...eF.keys()].filter((f) => !kF.has(f)).map((f) => eF.get(f));
  const onlyK = [...kF.keys()].filter((f) => !eF.has(f)).map((f) => kF.get(f));
  const status = !onlyE.length && !onlyK.length ? '✓ BİREBİR AYNI' : '≠ FARK VAR';
  console.log(`\n■ ${name}  [Excel:${excelSet.size} / KB:${kbSet.size}]  ${status}`);
  if (onlyE.length) console.log(`   Yalnız EXCEL'de (${onlyE.length}):\n     - ${onlyE.join('\n     - ')}`);
  if (onlyK.length) console.log(`   Yalnız KB'de (${onlyK.length}):\n     - ${onlyK.join('\n     - ')}`);
}

console.log('\n================ FARK RAPORU: Excel ↔ KB (cc-taxonomy-v2.json) ================');
const kbKeyByFold = Object.fromEntries(Object.keys(kbSets).map((k) => [foldTr(k), k]));
const matched = new Set();
for (const [grup, e] of Object.entries(excel)) {
  const kbKey = kbKeyByFold[foldTr(grup)];
  if (!kbKey) {
    console.log(`\n■ Excel grubu "${grup}" (${e.values.size}) → KB'de karşılığı YOK`);
    continue;
  }
  matched.add(kbKey);
  diff(`"${grup}" ↔ KB.${kbKey}`, e.values, kbSets[kbKey]);
  // Kök Neden: detay kolonu varsa onu da KB detaylarıyla kıyasla
  if (e.details.size && kbSets['Kök Neden Detayı'] && /kök neden/i.test(grup)) {
    matched.add('Kök Neden Detayı');
    diff(`"${grup} → detaylar" ↔ KB.Kök Neden Detayı`, e.details, kbSets['Kök Neden Detayı']);
  }
}
const unmatchedKb = Object.keys(kbSets).filter((k) => !matched.has(k) && kbSets[k].size > 0);
if (unmatchedKb.length) console.log(`\n■ Excel'de grubu olmayan KB kümeleri: ${unmatchedKb.join(', ')}`);
console.log('\n(Salt-okunur analiz — hiçbir değişiklik yapılmadı.)');
