// Yeni doğru-etiketli Excel'i mevcut gold few-shot ile birleştirir + GÜNCEL
// taksonomiye (cc-taxonomy-v2.json) göre tüm değerleri doğrular/düzeltir.
//
// - Vaka No ile dedup (Excel = "en son doğru", önceliklidir)
// - "(M)" gibi suffix işaretlerini temizler
// - field-aware eski->güncel label dönüşümü (DB TaxonomyDef ile birebir)
// - her alanı güncel taksonomi değer setine karşı doğrular; küçük farkları
//   (boşluk/slash/büyük-küçük/Türkçe) normalize ederek canonical değere çeker
// - eşleşmeyenleri (invalid) raporlar
//
// Kullanım:
//   node scripts/merge-gold-examples.mjs "<xlsx>"            (dry-run)
//   node scripts/merge-gold-examples.mjs "<xlsx>" --commit   (yazar)
import XLSX from 'xlsx';
import fs from 'fs';

const xlsxPath = process.argv[2];
const commit = process.argv.includes('--commit');
const GOLD = new URL('../data/cc-gold-examples.json', import.meta.url);
const TAX = new URL('../data/cc-taxonomy-v2.json', import.meta.url);

const renameRCG = {
  'Cihaz / Mobil Ortam': 'Donanım/Cihaz',
  'Yazılım Hatası': 'Uygulama Hatası',
  'E-Belge / Entegratör (3. parti)': 'Entegratör (3.parti)',
  'Kullanım / Eğitim': 'Kullanım/Bilgi Eksikliği',
};
const renameCT = {
  'Eğitim': 'Kullanıcı Eğitim',
  'Ürün geliştirme': 'Geliştirme / değişiklik talebi',
};

// semantik alias — eski/serbest girilmiş değerleri güncel taksonomiye eşler
const ALIAS = {
  isSureci: {
    'Müşteri / Cari Kart ve Gruplama İşlemleri': 'Müşteri / Cari Kartı ve Gruplama İşlemleri',
    'Belge Dizayn / Matbu': 'Belge Dizaynı / Matbu',
  },
  islemTipi: {
    'Oluşturma problemi': 'Oluşturma',
    'Yazdırma problemi': 'Yazdırma',
    'Düzeltme problemi': 'Düzeltme',
    'Güncelleme problemi': 'Güncelleme',
    'Bilgi gönderme problemi': 'Bilgi gönderme',
    'Bilgi alma problemi': 'Bilgi Alma',
    'E-Belge gönderme problemi': 'E-Belge gönderme',
    'Giriş problemi': 'Giriş yapma',
    'Bağlantı problemi': 'Bağlantı kurma',
    'Basım problemi': 'Basım yapma',
    'Raporda veri tutarsızlığı': 'Rapor alma',
    'Bilgi alabilir miyim': 'Bilgi talebi',
  },
  etkilenenNesne: {
    'Müşteri İzleme': 'Saha Izleme',
    'Tahsilat': 'Nakit',
  },
};

// --- güncel taksonomi değer setleri ---
const t = JSON.parse(fs.readFileSync(TAX, 'utf8'));
const o = t.open;
const c = t.close;
const SETS = {
  platform: o.platform.values,
  isSureci: o.is_sureci.values,
  islemTipi: o.islem_tipi.values,
  etkilenenNesne: o.etkilenen_nesne.values,
  etki: o.etki.values,
  kokNedenGrubu: c.kok_neden.groups.map((g) => g.group),
  kokNedenDetayi: c.kok_neden.groups.flatMap((g) => g.details),
  cozumTipi: c.cozum_tipi.values,
  kaliciOnlem: c.kalici_onlem.values,
};

const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replaceAll('ç', 'c').replaceAll('ş', 's').replaceAll('ı', 'i')
    .replaceAll('ğ', 'g').replaceAll('ü', 'u').replaceAll('ö', 'o').replaceAll('i̇', 'i')
    .replace(/[\s/\\().-]+/g, '');

// normalize -> canonical map (her alan için)
const NORMMAP = {};
for (const [field, vals] of Object.entries(SETS)) {
  NORMMAP[field] = {};
  for (const v of vals) NORMMAP[field][normalize(v)] = v;
}

const report = { ok: 0, cleaned: 0, renamed: 0, normalized: 0, empty: 0 };
const invalid = [];

function fixField(field, rawVal, caseNo) {
  if (rawVal == null || rawVal === '') {
    report.empty += 1;
    return rawVal;
  }
  let v = String(rawVal).replace(/\s*\((?:M|KB)\)\s*$/i, '').trim(); // (M)/(KB) işareti
  const suffixCleaned = v !== String(rawVal).trim();
  // field-aware rename
  const before = v;
  if (field === 'kokNedenGrubu' && renameRCG[v]) v = renameRCG[v];
  if (field === 'cozumTipi' && renameCT[v]) v = renameCT[v];
  // semantik alias (güncel taksonomiye eşle)
  if (ALIAS[field] && ALIAS[field][v]) v = ALIAS[field][v];
  const renamed = v !== before;

  const set = SETS[field];
  if (!set) return v; // doğrulanmayan alan (no/sorun/cozum)
  if (set.includes(v)) {
    if (renamed) report.renamed += 1;
    else if (suffixCleaned) report.cleaned += 1;
    else report.ok += 1;
    return v;
  }
  // normalize match
  const nm = NORMMAP[field][normalize(v)];
  if (nm) {
    report.normalized += 1;
    return nm;
  }
  invalid.push({ caseNo, field, raw: rawVal, after: v });
  return v;
}

const VALIDATED = ['platform', 'isSureci', 'islemTipi', 'etkilenenNesne', 'etki', 'kokNedenGrubu', 'kokNedenDetayi', 'cozumTipi', 'kaliciOnlem'];
function fixExample(ex) {
  for (const f of VALIDATED) ex[f] = fixField(f, ex[f], ex.no);
  return ex;
}

// 1) mevcut gold
const gold = JSON.parse(fs.readFileSync(GOLD, 'utf8')).map(fixExample);

// 2) Excel -> gold format
const wb = XLSX.readFile(xlsxPath);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
const mapRow = (r) =>
  fixExample({
    no: r['Vaka No'],
    sorun: r['Açıklama'],
    cozum: r['Çözüm Açıklaması'],
    platform: '',
    isSureci: r['İş Süreci'],
    islemTipi: r['İşlem Tipi'],
    etkilenenNesne: r['Etkilenen Nesne'],
    etki: r['Etki'],
    kokNedenGrubu: r['Kök Neden Grubu'],
    kokNedenDetayi: r['Kök Neden Detayı'],
    cozumTipi: r['Çözüm Tipi'],
    kaliciOnlem: r['Kalıcı Önlem'],
  });
const excel = rows.filter((r) => r['Vaka No'] && r['Kök Neden Grubu'] && r['Çözüm Açıklaması']).map(mapRow);
const skipped = rows.length - excel.length;

// 3) dedup (Vaka No) — Excel önceliklidir, boş alanları gold'dan koru
const byNo = new Map();
for (const ex of gold) byNo.set(ex.no, ex);
let added = 0;
let overwritten = 0;
for (const ex of excel) {
  const prev = byNo.get(ex.no);
  if (prev) {
    overwritten += 1;
    for (const k of Object.keys(prev)) if (!ex[k] && prev[k]) ex[k] = prev[k];
  } else {
    added += 1;
  }
  byNo.set(ex.no, ex);
}
const merged = [...byNo.values()];

console.log(`mevcut gold: ${gold.length}  | Excel geçerli: ${excel.length} (atlanan ${skipped})`);
console.log(`Excel'den YENİ: ${added}  | üzerine yazılan: ${overwritten}  | >>> TOPLAM: ${merged.length}`);
console.log(`\n=== doğrulama (tüm gold) ===`);
console.log(`  ok=${report.ok}  suffix-temizlenen=${report.cleaned}  rename=${report.renamed}  normalize-düzeltilen=${report.normalized}  boş=${report.empty}`);

if (invalid.length) {
  console.log(`\n!!! TAKSONOMİDE EŞLEŞMEYEN (${invalid.length}) — elle bakılmalı:`);
  invalid.forEach((i) => console.log(`  ${i.caseNo}  ${i.field}: "${i.raw}"`));
} else {
  console.log('\n✓ Tüm alanlar güncel taksonomiyle eşleşti — eşleşmeyen yok');
}

const dist = {};
for (const ex of merged) dist[ex.kokNedenGrubu] = (dist[ex.kokNedenGrubu] || 0) + 1;
console.log('\n=== kök neden grubu dağılımı ===');
Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(3)}x  ${k}`));

if (commit) {
  if (invalid.length) {
    console.log('\n⚠ eşleşmeyen değerler var — yine de yazılıyor (raporu kontrol et)');
  }
  fs.writeFileSync(GOLD, JSON.stringify(merged, null, 1), 'utf8');
  console.log(`\n✓ YAZILDI: data/cc-gold-examples.json (${merged.length} örnek)`);
} else {
  console.log('\n(dry-run — yazmak için --commit)');
}
