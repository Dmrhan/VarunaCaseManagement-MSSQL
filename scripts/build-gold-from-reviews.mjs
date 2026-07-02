// Kontrol edilmiş vakaları (CaseTaggingReview) gold few-shot'a besler.
// Ground-truth kuralı (alan bazlı):
//   Verdict=Yanlış → CorrectedLabel (insan düzeltmesi — en değerli sinyal)
//   Verdict=Doğru/Belirsiz/boş → OriginalLabel
// Üretilen örnekler GÜNCEL taksonomiye (cc-taxonomy-v2.json) karşı doğrulanır;
// pasif/geçersiz etiketli alanlar elenir. Mevcut gold ile Vaka No bazında merge.
//
// Kullanım:
//   node --env-file=.env scripts/build-gold-from-reviews.mjs            (dry-run)
//   node --env-file=.env scripts/build-gold-from-reviews.mjs --commit   (yazar)
import { prisma } from '../server/db/client.js';
import fs from 'node:fs';

const commit = process.argv.includes('--commit');
const GOLD = new URL('../data/cc-gold-examples.json', import.meta.url);
const TAX = new URL('../data/cc-taxonomy-v2.json', import.meta.url);

// ── güncel taksonomi değer setleri ──
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
  // v4: details artık {label, cozum_tipleri} nesnesi → label'ları çıkar.
  kokNedenDetayi: c.kok_neden.groups.flatMap((g) => g.details.map((d) => d.label)),
  cozumTipi: c.cozum_tipi.values,
  kaliciOnlem: c.kalici_onlem.values,
};
const normalize = (s) =>
  String(s || '').toLowerCase()
    .replaceAll('ç', 'c').replaceAll('ş', 's').replaceAll('ı', 'i')
    .replaceAll('ğ', 'g').replaceAll('ü', 'u').replaceAll('ö', 'o').replaceAll('i̇', 'i')
    .replace(/[\s/\\().-]+/g, '');
const NORMMAP = {};
for (const [f, vals] of Object.entries(SETS)) {
  NORMMAP[f] = {};
  for (const v of vals) NORMMAP[f][normalize(v)] = v;
}
/** Değeri güncel taksonomiye eşle; geçerli değilse null (eler). */
function valid(field, val) {
  if (!val) return null;
  const set = SETS[field];
  if (set.includes(val)) return val;
  return NORMMAP[field][normalize(val)] || null;
}

// ── v4 CASCADE haritaları — detay yalnız grubun altında, çözüm yalnız detayın
//    izinli setinde geçerli. formatGoldForPrompt("close") ile birebir aynı kural.
const GRP_DETAILS = {}; // group -> { normLabel: label }
const DET_COZUM = {};   // `${group}|${detail}` -> { normLabel: label }
for (const g of c.kok_neden.groups) {
  GRP_DETAILS[g.group] = {};
  for (const d of g.details) {
    GRP_DETAILS[g.group][normalize(d.label)] = d.label;
    const key = `${g.group}|${d.label}`;
    DET_COZUM[key] = {};
    for (const cz of d.cozum_tipleri || []) DET_COZUM[key][normalize(cz)] = cz;
  }
}
/** val'ı kapsam (scope) haritasında normalize eşleştir; yoksa ''. */
function scopeMatch(map, val) {
  if (!val || !map) return '';
  return map[normalize(val)] || '';
}

// ── alan → CaseTaggingReview kolon ön eki ──
const FIELD_PREFIX = {
  platform: 'openingPlatform',
  isSureci: 'openingBusinessProcess',
  islemTipi: 'openingOperationType',
  etkilenenNesne: 'openingAffectedObject',
  etki: 'openingImpact',
  kokNedenGrubu: 'closingRootCauseGroup',
  kokNedenDetayi: 'closingRootCauseDetail',
  cozumTipi: 'closingResolutionType',
  kaliciOnlem: 'closingPermanentPrevention',
};
/** Ground-truth label: Yanlış→Corrected, aksi→Original. */
function groundTruth(row, prefix) {
  const verdict = row[`${prefix}Verdict`];
  const corrected = row[`${prefix}CorrectedLabel`];
  const original = row[`${prefix}OriginalLabel`];
  if (verdict && /yanl[iı]s/i.test(verdict) && corrected) return corrected;
  return original || null;
}

const rows = await prisma.$queryRawUnsafe(`
  SELECT r.*, c.caseNumber AS caseNumber, c.description AS description, c.resolutionNote AS resolutionNote
  FROM CaseTaggingReview r
  JOIN [Case] c ON r.caseId = c.id
`);

const built = [];
let skippedNoText = 0;
let skippedNoClose = 0;
for (const row of rows) {
  const sorun = (row.description || '').trim();
  const cozum = (row.resolutionNote || '').trim();
  if (sorun.length < 5 || cozum.length < 5) { skippedNoText += 1; continue; }

  const ex = { no: row.caseNumber, sorun, cozum, platform: '', isSureci: '', islemTipi: '', etkilenenNesne: '', etki: '', kokNedenGrubu: '', kokNedenDetayi: '', cozumTipi: '', kaliciOnlem: '' };
  // Açılış (flat) + kök neden grubu + kalıcı önlem: düz doğrulama.
  ex.platform = valid('platform', groundTruth(row, FIELD_PREFIX.platform)) || '';
  ex.isSureci = valid('isSureci', groundTruth(row, FIELD_PREFIX.isSureci)) || '';
  ex.islemTipi = valid('islemTipi', groundTruth(row, FIELD_PREFIX.islemTipi)) || '';
  ex.etkilenenNesne = valid('etkilenenNesne', groundTruth(row, FIELD_PREFIX.etkilenenNesne)) || '';
  ex.etki = valid('etki', groundTruth(row, FIELD_PREFIX.etki)) || '';
  ex.kokNedenGrubu = valid('kokNedenGrubu', groundTruth(row, FIELD_PREFIX.kokNedenGrubu)) || '';
  ex.kaliciOnlem = valid('kaliciOnlem', groundTruth(row, FIELD_PREFIX.kaliciOnlem)) || '';
  // v4 CASCADE: detay yalnız SEÇİLEN grubun altında; çözüm yalnız SEÇİLEN detayın izinli setinde.
  ex.kokNedenDetayi = ex.kokNedenGrubu
    ? scopeMatch(GRP_DETAILS[ex.kokNedenGrubu], groundTruth(row, FIELD_PREFIX.kokNedenDetayi))
    : '';
  ex.cozumTipi = ex.kokNedenGrubu && ex.kokNedenDetayi
    ? scopeMatch(DET_COZUM[`${ex.kokNedenGrubu}|${ex.kokNedenDetayi}`], groundTruth(row, FIELD_PREFIX.cozumTipi))
    : '';
  // few-shot close mode için tam cascade şart: grup + detay + çözüm tipi.
  if (!ex.kokNedenGrubu || !ex.kokNedenDetayi || !ex.cozumTipi) { skippedNoClose += 1; continue; }
  built.push(ex);
}

// ── mevcut gold ile merge (Vaka No bazında; review ground-truth önceliklidir) ──
const gold = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
const byNo = new Map();
for (const g of gold) byNo.set(g.no, g);
let added = 0;
let overwritten = 0;
for (const ex of built) {
  if (byNo.has(ex.no)) {
    overwritten += 1;
    const prev = byNo.get(ex.no);
    // review'da boş kalan alanı mevcut gold'dan koru
    for (const k of Object.keys(prev)) if (!ex[k] && prev[k]) ex[k] = prev[k];
  } else {
    added += 1;
  }
  byNo.set(ex.no, ex);
}
const merged = [...byNo.values()];

console.log(`CaseTaggingReview: ${rows.length} | geçerli gold örneği: ${built.length}`);
console.log(`  atlanan (sorun/çözüm<5): ${skippedNoText} | atlanan (kök neden/çözüm tipi geçersiz): ${skippedNoClose}`);
console.log(`mevcut gold: ${gold.length} → YENİ: ${added} | güncellenen: ${overwritten} | >>> TOPLAM: ${merged.length}`);

// Bu run'da review'lardan üretilen v4-CASCADE-uyumlu close örnekleri (asıl sinyal).
const distV4 = {};
for (const ex of built) distV4[ex.kokNedenGrubu] = (distV4[ex.kokNedenGrubu] || 0) + 1;
console.log('\n=== v4-uyumlu kök neden grubu dağılımı (bu run, review kaynaklı) ===');
Object.entries(distV4).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(3)}  ${k}`));
// NOT: cc-gold-examples.json'da eski taksonomi örnekleri de kalır (açılış few-shot'u
// için geçerli); kapanış few-shot'unda formatGoldForPrompt("close") v4-filtreler.

if (commit) {
  fs.writeFileSync(GOLD, JSON.stringify(merged, null, 1), 'utf8');
  console.log(`\n✓ YAZILDI: data/cc-gold-examples.json (${merged.length} örnek)`);
} else {
  console.log('\n(dry-run — yazmak için --commit)');
}
process.exit(0);
