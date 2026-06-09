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

// ─── 6) Resolution composer — worked step + diğer outcomes ──────────────

console.log('');
console.log('── 6) Resolution composer ─────────────────────────────');

// Endpoint route'undaki composeResolutionFromSteps pure replica.
const SOLUTION_STEP_STATUS_LABEL = {
  suggested: 'Önerildi', tried: 'Denendi', worked: 'İşe yaradı',
  not_worked: 'İşe yaramadı', skipped: 'Uygun değil',
};
function composeResolution(workedStep, allSteps) {
  const lines = [];
  if (workedStep) {
    const parts = [`[ÇÖZÜLEN ADIM] ${workedStep.title}`];
    if (workedStep.description) parts.push(workedStep.description);
    if (workedStep.note) parts.push(`Not: ${workedStep.note}`);
    lines.push(parts.join(' — '));
  }
  const others = (allSteps || []).filter((s) => !workedStep || s.id !== workedStep.id);
  if (others.length > 0) {
    lines.push('');
    lines.push('Diğer denenen adımlar:');
    for (const s of others) {
      const statusLabel = SOLUTION_STEP_STATUS_LABEL[s.status] ?? s.status;
      const noteSuffix = s.note ? ` (Not: ${s.note})` : '';
      lines.push(`- ${s.title} — ${statusLabel}${noteSuffix}`);
    }
  }
  return lines.join('\n');
}

const worked = { id: 'w', title: 'Cache temizlendi', description: 'Tarayıcı önbelleği', note: 'Müşteri F5 ile çalıştı', status: 'worked' };
const others = [
  { id: 'a', title: 'Rol kontrol', status: 'not_worked', note: 'Yetki vardı' },
  { id: 'b', title: 'F5', status: 'skipped' },
];
const composed = composeResolution(worked, [worked, ...others]);
if (
  composed.includes('[ÇÖZÜLEN ADIM] Cache temizlendi') &&
  composed.includes('Tarayıcı önbelleği') &&
  composed.includes('Not: Müşteri F5 ile çalıştı') &&
  composed.includes('Diğer denenen adımlar:') &&
  composed.includes('Rol kontrol — İşe yaramadı (Not: Yetki vardı)') &&
  composed.includes('F5 — Uygun değil')
) {
  ok('6) composeResolution — worked + 2 diğer + Türkçe status label + note');
} else {
  bad('6) composer', composed);
}

// worked yokken: yalnız diğer step'ler listelenir.
const noneWorked = composeResolution(null, others);
if (
  !noneWorked.includes('[ÇÖZÜLEN ADIM]') &&
  noneWorked.includes('Diğer denenen adımlar:') &&
  noneWorked.includes('Rol kontrol — İşe yaramadı')
) {
  ok('7) composer — worked yokken yalnız "diğer denenen" listesi');
} else {
  bad('7) composer no worked', noneWorked);
}

// ─── 8) Codex P2 — open_urun platform label fallback ────────────────────
//
// Smart Ticket UI customFields.smartTicket'a label'ları
// `${field}Label` formatında yazıyor (platformLabel/businessProcessLabel
// vs.). Eski impl yalnız `urunLabel` okuyordu → mevcut tüm Smart Ticket
// case'leri için open_urun KB'ye gönderilmiyordu. Düzeltme: pure replica
// ile öncelik sırası test edilir.

console.log('');
console.log('── 8) open_urun label fallback (Codex P2) ─────────────');

function resolveOpenUrun(stOpening) {
  if (!stOpening || typeof stOpening !== 'object') return undefined;
  if (typeof stOpening.urunLabel === 'string' && stOpening.urunLabel.trim()) return stOpening.urunLabel.trim();
  if (typeof stOpening.platformLabel === 'string' && stOpening.platformLabel.trim()) return stOpening.platformLabel.trim();
  if (typeof stOpening.platform === 'string' && stOpening.platform.trim()) return stOpening.platform.trim();
  return undefined;
}

// Tipik UI persist'i: platform + platformLabel (urunLabel YOK).
const uiPersist = { platform: 'plat.mobil', platformLabel: 'Mobil' };
const r1 = resolveOpenUrun(uiPersist);
if (r1 === 'Mobil') ok('8a) UI persist (platformLabel) → open_urun=platformLabel');
else bad('8a) platformLabel fallback', String(r1));

// Geri uyumluluk: ileride bir yazıcı urunLabel eklerse onu kullan.
const futureUrun = { platform: 'plat.mobil', platformLabel: 'Mobil', urunLabel: 'UNIVERA Mobil' };
const r2 = resolveOpenUrun(futureUrun);
if (r2 === 'UNIVERA Mobil') ok('8b) urunLabel öncelikli (forward-compat)');
else bad('8b) urunLabel priority', String(r2));

// Hiçbir label yoksa: ham platform code'a düş.
const codeOnly = { platform: 'plat.mobil' };
const r3 = resolveOpenUrun(codeOnly);
if (r3 === 'plat.mobil') ok('8c) Label yoksa ham platform code\'a düş');
else bad('8c) raw platform fallback', String(r3));

// Empty/missing opening
const r4 = resolveOpenUrun({});
const r5 = resolveOpenUrun(null);
if (r4 === undefined && r5 === undefined) ok('8d) Boş opening → undefined');
else bad('8d) empty opening', JSON.stringify({ r4, r5 }));

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
await prisma.$disconnect().catch(() => {});
process.exit(fail > 0 ? 1 : 0);
