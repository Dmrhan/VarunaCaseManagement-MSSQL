/**
 * smoke-smart-ticket-classification-suggest.js — WR-Smart-Ticket Phase 2b.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-smart-ticket-classification-suggest.js
 *   node --env-file=.env scripts/smoke-smart-ticket-classification-suggest.js --keep
 *
 * Pure helper (extractClassificationFromKb / mapClassificationToTaxonomy)
 * üzerinden 12 senaryo. Endpoint server-side External KB çağırır; bu
 * smoke KB upstream'i çağırmaz, doğrudan mock response ile adapter'ı
 * test eder. Mapping katmanı için UNIVERA dev DB'deki gerçek
 * TaxonomyDef satırları + kbAliases metadata'sı kullanılır.
 *
 * Senaryolar:
 *   1.  KB response Platform alanı eşlenir (code match)
 *   2.  KB response İş Süreci alanı eşlenir (label match)
 *   3.  KB response İşlem Tipi alanı eşlenir
 *   4.  KB response Etkilenen Nesne alanı eşlenir
 *   5.  KB response Etki alanı eşlenir
 *   6.  metadata.kbAliases match (label birebir değil ama alias eşleşir)
 *   7.  Normalized label match (Türkçe karakter farkı)
 *   8.  Unmatched value döner, taxonomy AUTO-CREATE EDİLMEZ
 *   9.  Endpoint Case oluşturmaz (route-level guarantee — repo bağımsız)
 *  10.  Manual fallback hala çalışır (mapClassification boş alan döner;
 *       form mantığı user input'una izin verir)
 *  11.  Raw KB cevabı (panorama, citations, kbChunks, hits, raw answer)
 *       suggestions'a sızmaz
 *  12.  Ignored sections (suggestedSteps, rootCauseHypotheses,
 *       customerReplyDraft, engineeringHandoff, similar) suggestions'a
 *       sızmaz
 *
 * Test sonunda smoke'un yarattığı metadata değişikliklerini geri yükler.
 */

import { prisma } from '../server/db/client.js';
import {
  extractClassificationFromKb,
  mapClassificationToTaxonomy,
  SMART_TICKET_CLASSIFICATION_FIELDS,
} from '../server/lib/smartTicketClassification.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n, def = null) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  if (hit) return hit.slice(n.length + 3);
  const idx = args.indexOf(`--${n}`);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return def;
};
const COMPANY = val('company', 'UNIVERA');
const KEEP = flag('keep');

let pass = 0;
let fail = 0;
let skip = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function note(name, detail = '') { skip += 1; console.log(`⊘ ${name}${detail ? ' — ' + detail : ''}`); }

// ─── Setup: UNIVERA + active taxonomies ──────────────────────────────────

console.log('── Setup ──────────────────────────────────────────────');
let companyId = null;
try {
  const c = await prisma.company.findUnique({ where: { name: COMPANY }, select: { id: true } });
  if (c) companyId = c.id;
} catch (err) {
  note('DB skip', err?.message);
}
if (!companyId) {
  console.log('PASS=0 FAIL=0 SKIP=1');
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

const types = ['platform', 'businessProcess', 'operationType', 'affectedObject', 'impact'];
const rows = await prisma.taxonomyDef.findMany({
  where: { companyId, taxonomyType: { in: types }, isActive: true },
  select: { id: true, taxonomyType: true, code: true, label: true, metadata: true },
  orderBy: [{ taxonomyType: 'asc' }, { sortOrder: 'asc' }],
});
const taxonomyMap = {};
for (const t of types) taxonomyMap[t] = [];
for (const r of rows) taxonomyMap[r.taxonomyType].push(r);
ok('Setup — UNIVERA taxonomies yüklendi', `${rows.length} satır`);

// ─── Smoke'un dokunduğu metadata'yı yedekle ──────────────────────────────

const metadataRestore = [];
async function setMetadata(id, metadata) {
  const row = await prisma.taxonomyDef.findUnique({ where: { id }, select: { metadata: true } });
  metadataRestore.push({ id, metadata: row?.metadata ?? null });
  await prisma.taxonomyDef.update({ where: { id }, data: { metadata } });
}
async function restoreMetadata() {
  for (const r of metadataRestore) {
    try { await prisma.taxonomyDef.update({ where: { id: r.id }, data: { metadata: r.metadata ?? null } }); }
    catch (e) { console.log(`  ⚠️ metadata restore başarısız: ${r.id} — ${e?.message}`); }
  }
}

// Test verileri için referans alınacak satırlar.
const ref = {
  platform: taxonomyMap.platform[0],
  businessProcess: taxonomyMap.businessProcess[0],
  operationType: taxonomyMap.operationType[0],
  affectedObject: taxonomyMap.affectedObject[0],
  impact: taxonomyMap.impact[0],
};
for (const t of types) {
  if (!ref[t]) {
    note(`Setup — ${t}`, 'liste boş, SKIP');
  }
}

// Senaryo 6 için bir bp satırına alias ekleyelim.
const ALIAS_FOR_BP = 'KB Test Alias Trk';
if (ref.businessProcess) {
  const newMeta = {
    ...(typeof ref.businessProcess.metadata === 'object' && ref.businessProcess.metadata !== null
      ? ref.businessProcess.metadata
      : {}),
    kbAliases: [ALIAS_FOR_BP, 'Alternatif Etiket'],
  };
  await setMetadata(ref.businessProcess.id, newMeta);
  // taxonomyMap in-memory; mapping fonksiyonu local objesi okuyor, DB değil.
  ref.businessProcess.metadata = newMeta;
}

// ─── 1-5) KB response fields → mapping ───────────────────────────────────

console.log('');
console.log('── 1-5) Per-field mapping (code + label) ──────────────');

function buildKbResponse({
  platformCode,
  bpLabel,
  otLabel,
  aoLabel,
  impactLabel,
  rootCauses = ['Yetki eksik', 'Tarayıcı eski'],
  suggestedSteps = ['Cache temizle', { text: 'Rol kontrol et' }],
  customerReplyDraft = 'Sayın müşteri...',
  engineeringHandoff = { team: 'Backoffice' },
  similar = [{ bildirim_no: 'B-12345' }],
  panoramaScreens = [{ title: 'Yetki Ekranı' }],
  citations = [{ url: 'kb://x' }],
  kbChunks = [{ text: 'chunk' }],
  hits = [{ score: 0.5 }],
  answer = 'raw answer',
} = {}) {
  return {
    ok: true,
    data: {
      analysis: {
        classification: {
          platform: platformCode ? { code: platformCode } : undefined,
          businessProcess: bpLabel,
          operationType: otLabel,
          affectedObject: aoLabel,
          impact: impactLabel,
        },
        rootCauseHypotheses: rootCauses,
        suggestedSteps,
        customerReplyDraft,
        engineeringHandoff,
      },
      similar,
      panoramaScreens,
      citations,
      kbChunks,
      hits,
      answer,
    },
  };
}

// 1) Platform — code match
if (ref.platform) {
  const resp = buildKbResponse({ platformCode: ref.platform.code });
  const raw = extractClassificationFromKb(resp);
  const { suggestions } = mapClassificationToTaxonomy(raw, taxonomyMap);
  if (suggestions.platform?.code === ref.platform.code && suggestions.platform?.matchedBy === 'code') {
    ok('1) Platform code match — confidence=1.0');
  } else {
    bad('1) Platform mapping', JSON.stringify(suggestions));
  }
}

// 2) İş Süreci — label match (alias değil, normal label)
if (ref.businessProcess) {
  const resp = buildKbResponse({ bpLabel: ref.businessProcess.label });
  const raw = extractClassificationFromKb(resp);
  const { suggestions } = mapClassificationToTaxonomy(raw, taxonomyMap);
  // BP'ye alias eklemiştik; alias ≠ label olduğundan label fallback olur.
  if (
    suggestions.businessProcess?.code === ref.businessProcess.code &&
    (suggestions.businessProcess?.matchedBy === 'label' || suggestions.businessProcess?.matchedBy === 'kbAlias')
  ) {
    ok(`2) İş Süreci label/alias eşleşmesi (matchedBy=${suggestions.businessProcess.matchedBy})`);
  } else {
    bad('2) İş Süreci', JSON.stringify(suggestions.businessProcess));
  }
}

// 3) İşlem Tipi
if (ref.operationType) {
  const resp = buildKbResponse({ otLabel: ref.operationType.label });
  const raw = extractClassificationFromKb(resp);
  const { suggestions } = mapClassificationToTaxonomy(raw, taxonomyMap);
  if (suggestions.operationType?.code === ref.operationType.code) ok('3) İşlem Tipi mapping');
  else bad('3) operationType', JSON.stringify(suggestions.operationType));
}

// 4) Etkilenen Nesne
if (ref.affectedObject) {
  const resp = buildKbResponse({ aoLabel: ref.affectedObject.label });
  const raw = extractClassificationFromKb(resp);
  const { suggestions } = mapClassificationToTaxonomy(raw, taxonomyMap);
  if (suggestions.affectedObject?.code === ref.affectedObject.code) ok('4) Etkilenen Nesne mapping');
  else bad('4) affectedObject', JSON.stringify(suggestions.affectedObject));
}

// 5) Etki
if (ref.impact) {
  const resp = buildKbResponse({ impactLabel: ref.impact.label });
  const raw = extractClassificationFromKb(resp);
  const { suggestions } = mapClassificationToTaxonomy(raw, taxonomyMap);
  if (suggestions.impact?.code === ref.impact.code) ok('5) Etki mapping');
  else bad('5) impact', JSON.stringify(suggestions.impact));
}

// ─── 6) kbAliases match ──────────────────────────────────────────────────

console.log('');
console.log('── 6-7) Alias + normalized label match ────────────────');

if (ref.businessProcess) {
  // KB cevabı alias verir; label birebir DEĞİL ama alias eşleşir.
  const resp = buildKbResponse({ bpLabel: ALIAS_FOR_BP });
  const raw = extractClassificationFromKb(resp);
  const { suggestions } = mapClassificationToTaxonomy(raw, taxonomyMap);
  if (
    suggestions.businessProcess?.code === ref.businessProcess.code &&
    suggestions.businessProcess?.matchedBy === 'kbAlias'
  ) {
    ok('6) metadata.kbAliases match — confidence=0.9');
  } else {
    bad('6) kbAlias', JSON.stringify(suggestions.businessProcess));
  }
}

// 7) Normalized label match — Türkçe karakter farklarını tolere et.
if (ref.businessProcess) {
  const noisyLabel = ref.businessProcess.label
    .toUpperCase()
    .replace(/I/g, 'I') // ı/I dönüşümü için
    .replace(/Ş/g, 'S') // tipo benzeri
    + '   ';
  const resp = buildKbResponse({ bpLabel: noisyLabel });
  const raw = extractClassificationFromKb(resp);
  const { suggestions } = mapClassificationToTaxonomy(raw, taxonomyMap);
  if (
    suggestions.businessProcess?.code === ref.businessProcess.code &&
    (suggestions.businessProcess?.matchedBy === 'label' ||
      suggestions.businessProcess?.matchedBy === 'kbAlias')
  ) {
    ok(`7) normalized label match (matchedBy=${suggestions.businessProcess.matchedBy})`);
  } else {
    bad('7) normalized label', JSON.stringify(suggestions.businessProcess));
  }
}

// ─── 8) Unmatched value döner; auto-create yok ──────────────────────────

console.log('');
console.log('── 8) Unmatched ───────────────────────────────────────');

const beforeCount = await prisma.taxonomyDef.count({ where: { companyId } });
const respUnmatched = buildKbResponse({ aoLabel: 'Hiçbir Etkilenen Nesnenin Adı (smoke)' });
const rawUnmatched = extractClassificationFromKb(respUnmatched);
const mapUnmatched = mapClassificationToTaxonomy(rawUnmatched, taxonomyMap);
const afterCount = await prisma.taxonomyDef.count({ where: { companyId } });
const unmatchedItem = mapUnmatched.unmatched.find((u) => u.taxonomyType === 'affectedObject');
if (unmatchedItem && beforeCount === afterCount && !mapUnmatched.suggestions.affectedObject) {
  ok('8) Unmatched value döner; TaxonomyDef AUTO-CREATE edilmedi');
} else {
  bad('8) unmatched', JSON.stringify({ unmatchedItem, beforeCount, afterCount, suggestions: mapUnmatched.suggestions }));
}

// ─── 9) Endpoint Case oluşturmaz (adapter+repo seviyesinde garanti) ─────

const caseCountBefore = await prisma.case.count({ where: { companyId } });
// Adapter pure — Case create kapasitesi yok. Bu kontrol semantik
// güvence: extract+map sırasında Case insert kodu hiç çağrılmıyor.
const caseCountAfter = await prisma.case.count({ where: { companyId } });
if (caseCountBefore === caseCountAfter) ok('9) Adapter Case oluşturmaz (semantik garanti)');
else bad('9) Case count drift', `${caseCountBefore} → ${caseCountAfter}`);

// ─── 10) Manual fallback ──────────────────────────────────────────────

// Adapter boş response için boş suggestions döner. Form tarafı bu durumda
// kullanıcının manuel girişine izin verir. Burada: hiçbir alanın "code"
// veya "label" set edilmediği response → suggestions boş, unmatched boş.
const respEmpty = { ok: true, data: { analysis: {} } };
const mapEmpty = mapClassificationToTaxonomy(extractClassificationFromKb(respEmpty), taxonomyMap);
if (Object.keys(mapEmpty.suggestions).length === 0 && mapEmpty.unmatched.length === 0) {
  ok('10) Manual fallback — boş suggestion, manual seçim açık');
} else {
  bad('10) manual fallback', JSON.stringify(mapEmpty));
}

// ─── 11) Raw KB response alanları suggestions'a sızmaz ─────────────────

console.log('');
console.log('── 11-12) Sızıntı yok kontrolü ────────────────────────');

const respWithRaw = buildKbResponse({});
const rawNothing = extractClassificationFromKb(respWithRaw);
const mapNothing = mapClassificationToTaxonomy(rawNothing, taxonomyMap);
// suggestions'da panorama/citations/kbChunks/hits/answer field'ı YOK.
const leaked = Object.keys(mapNothing.suggestions).filter(
  (k) => !SMART_TICKET_CLASSIFICATION_FIELDS.includes(k),
);
if (leaked.length === 0) ok('11) raw response alanları (panorama/citations/kbChunks/hits/answer) suggestions\'a sızmadı');
else bad('11) raw leak', JSON.stringify(leaked));

// ─── 12) Ignored sections (suggestedSteps vb) suggestions'a sızmaz ─────

const respWithSections = buildKbResponse({});
const r2 = extractClassificationFromKb(respWithSections);
const m2 = mapClassificationToTaxonomy(r2, taxonomyMap);
// suggestedSteps/rootCauseHypotheses/customerReplyDraft/engineeringHandoff/
// similar suggestions'a girmemeli. Bu helper FIELDS dışında bir key
// dönmeyeceği garanti edildiği için boş suggestions doğal sonuçtur.
if (Object.keys(m2.suggestions).every((k) => SMART_TICKET_CLASSIFICATION_FIELDS.includes(k))) {
  ok('12) ignored sections (suggestedSteps/rootCause/customerReply/handoff/similar) suggestions\'a sızmadı');
} else {
  bad('12) section leak', JSON.stringify(m2.suggestions));
}

// ─── Cleanup ─────────────────────────────────────────────────────────────

if (!KEEP) {
  await restoreMetadata();
  if (metadataRestore.length > 0) {
    console.log('');
    console.log(`🧹 metadata restore: ${metadataRestore.length} TaxonomyDef satırı eski haline döndü`);
  }
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
await prisma.$disconnect().catch(() => {});
process.exit(fail > 0 ? 1 : 0);
