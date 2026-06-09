/**
 * smoke-smart-ticket-closure-suggest.js — WR-KB-v2 doc §7 closure önerisi.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-smart-ticket-closure-suggest.js
 *
 * Endpoint mantığının pure replica'sı (route içinde inline matchByLabel):
 * KB suggest-close cevabındaki 4 alanı UNIVERA closure taxonomy'sine label
 * match ile bağlar. rcd, eşleşen rcg'nin children'ı içinde aranır.
 *
 * Senaryolar:
 *   1. Setup — UNIVERA closure taxonomy yüklendi
 *   2. KB cevabı 4 alanlı → 4 eşleşme
 *   3. rcd parent (rcg) ile uyumlu satıra eşler — başka grubun child'ı seçilmez
 *   4. Türkçe label normalize (büyük/küçük + boşluk) eşleşir
 *   5. Bilinmeyen alanlar unmatched listesine düşer
 */

import { prisma } from '../server/db/client.js';

const args = process.argv.slice(2);
const COMPANY = args.includes('--company') ? args[args.indexOf('--company') + 1] : 'UNIVERA';

let pass = 0;
let fail = 0;
let skip = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function note(name, detail = '') { skip += 1; console.log(`⊘ ${name}${detail ? ' — ' + detail : ''}`); }

// ─── Setup ──────────────────────────────────────────────────────────────

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

const rows = await prisma.taxonomyDef.findMany({
  where: {
    companyId,
    isActive: true,
    taxonomyType: { in: ['rootCauseGroup', 'rootCauseDetail', 'resolutionType', 'permanentPrevention'] },
  },
  select: { id: true, taxonomyType: true, code: true, label: true, parentId: true },
});
const tax = { rootCauseGroup: [], rootCauseDetail: [], resolutionType: [], permanentPrevention: [] };
for (const r of rows) tax[r.taxonomyType].push(r);
ok('1) Setup — UNIVERA closure taxonomy yüklendi', `rcg=${tax.rootCauseGroup.length} rcd=${tax.rootCauseDetail.length} rt=${tax.resolutionType.length} pp=${tax.permanentPrevention.length}`);

// ─── Pure replica of route matchByLabel + parent-aware rcd ─────────────

function normalizeLabel(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFC')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchByLabel(list, rawLabel) {
  if (!rawLabel) return null;
  const target = normalizeLabel(rawLabel);
  if (!target) return null;
  return list.find((t) => normalizeLabel(t.label) === target) ?? null;
}

function mapClosure(payload) {
  const rcgMatch = matchByLabel(tax.rootCauseGroup, payload.kok_neden_grubu);
  const rcdCandidates = rcgMatch
    ? tax.rootCauseDetail.filter((d) => d.parentId === rcgMatch.id)
    : tax.rootCauseDetail;
  const rcdMatch = matchByLabel(rcdCandidates, payload.kok_neden_detayi);
  const rtMatch = matchByLabel(tax.resolutionType, payload.cozum_tipi);
  const ppMatch = matchByLabel(tax.permanentPrevention, payload.kalici_onlem);
  const suggestions = {};
  const unmatched = [];
  function add(key, match, raw) {
    if (match) suggestions[key] = { code: match.code, label: match.label };
    else if (raw) unmatched.push({ taxonomyType: key, rawValue: raw });
  }
  add('rootCauseGroup', rcgMatch, payload.kok_neden_grubu);
  add('rootCauseDetail', rcdMatch, payload.kok_neden_detayi);
  add('resolutionType', rtMatch, payload.cozum_tipi);
  add('permanentPrevention', ppMatch, payload.kalici_onlem);
  return { suggestions, unmatched };
}

// ─── 2) 4-field match (real KB sample) ──────────────────────────────────

console.log('');
console.log('── 2-5) Mapping invariants ────────────────────────────');

// Refs — UNIVERA seed'inde mevcut label'lar.
const rcgRef = tax.rootCauseGroup.find((g) => /yetki|cihaz|parametre/i.test(g.label));
if (!rcgRef) {
  note('2) rcgRef bulunamadı', 'closure smoke skip');
} else {
  const rcdRef = tax.rootCauseDetail.find((d) => d.parentId === rcgRef.id);
  const rtRef = tax.resolutionType[0];
  const ppRef = tax.permanentPrevention[0];
  const result = mapClosure({
    kok_neden_grubu: rcgRef.label,
    kok_neden_detayi: rcdRef?.label,
    cozum_tipi: rtRef?.label,
    kalici_onlem: ppRef?.label,
  });
  const expected = 4 - (rcdRef ? 0 : 1);
  if (Object.keys(result.suggestions).length === expected) {
    ok(`2) ${expected} alan eşleşti (rcg + ${rcdRef ? 'rcd + ' : ''}rt + pp)`);
  } else {
    bad('2) match count', JSON.stringify(result));
  }
}

// ─── 3) rcd parent-aware: yanlış grubun child'ı seçilmez ─────────────────

const rcg1 = tax.rootCauseGroup[0];
const rcg2 = tax.rootCauseGroup[1];
if (rcg1 && rcg2) {
  const rcdInRcg2 = tax.rootCauseDetail.find((d) => d.parentId === rcg2.id);
  if (rcdInRcg2) {
    // KB rcg=rcg1, rcd label rcg2'nin child'ı → adapter bunu rcg1'in
    // children listesinde bulamayıp unmatched listesine düşürmeli.
    const result = mapClosure({
      kok_neden_grubu: rcg1.label,
      kok_neden_detayi: rcdInRcg2.label,
    });
    if (
      result.suggestions.rootCauseGroup?.code === rcg1.code &&
      !result.suggestions.rootCauseDetail &&
      result.unmatched.some((u) => u.taxonomyType === 'rootCauseDetail')
    ) {
      ok('3) rcd parent-aware — yanlış grubun child\'ı unmatched\'e düşer');
    } else {
      bad('3) parent-aware rcd', JSON.stringify(result));
    }
  } else {
    note('3) parent-aware rcd', 'rcg2\'nin child\'ı yok, SKIP');
  }
}

// ─── 4) Türkçe normalize (büyük harf + boşluk) ───────────────────────────

if (rcg1) {
  const noisy = rcg1.label.toLocaleUpperCase('tr-TR') + '   ';
  const result = mapClosure({ kok_neden_grubu: noisy });
  if (result.suggestions.rootCauseGroup?.code === rcg1.code) {
    ok('4) Türkçe normalize — büyük harf + boşluk eşleşir');
  } else {
    bad('4) normalize', JSON.stringify(result));
  }
}

// ─── 5) Bilinmeyen label → unmatched ─────────────────────────────────────

const unknownResult = mapClosure({
  kok_neden_grubu: 'Hiç olmayan bir kök neden grubu (smoke)',
  cozum_tipi: 'Olmayan çözüm tipi',
});
if (
  !unknownResult.suggestions.rootCauseGroup &&
  !unknownResult.suggestions.resolutionType &&
  unknownResult.unmatched.length === 2
) {
  ok('5) Bilinmeyen label → unmatched listesine düşer');
} else {
  bad('5) unmatched', JSON.stringify(unknownResult));
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
await prisma.$disconnect().catch(() => {});
process.exit(fail > 0 ? 1 : 0);
