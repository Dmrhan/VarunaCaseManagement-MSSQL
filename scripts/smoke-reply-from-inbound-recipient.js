/**
 * smoke-reply-from-inbound-recipient.js — 2026-07-02.
 *
 * Reply default From = mailin GELDİĞİ adres.
 * Feature freeze uyumlu minor: backend endpoint zenginleştirme +
 * composer default seçim sıralaması. Schema YOK.
 *
 * Kapsam:
 *  1. Backend: /api/cases/:id/from-aliases response'una suggestedFromId
 *     eklendi (son inbound toAddresses+ccAddresses ∩ aktif alias set).
 *     Reuse: caseEmailSender.js:432-440 parse pattern + :429 aliasKeys.
 *  2. TS service: FromAliasesResult tipi + { items, suggestedFromId } dönüş.
 *  3. MailComposer: reply/reply-all default = suggestedFromId ?? isDefault ??
 *     items[0]. Compose-new/forward eski davranış. UI hint + change reset.
 *  4. Davranış: destek@ vs cagri.merkezi@ eşleşme senaryoları, kenar
 *     durumları (inbound yok, eşleşme yok, çoklu, pasif, harf farkı).
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

const cases = read('server/routes/cases.js');
const casesCode = strip(cases);
const svc = read('src/services/caseEmailService.ts');
const composer = read('src/features/cases/components/MailComposer.tsx');

console.log('── 1) Backend endpoint — suggestedFromId hesaplama ─');
expect('1.1 suggestedFromId null başlangıç (compose-new default)',
  /let suggestedFromId = null/.test(casesCode), true);
expect('1.2 lastInbound fetch — direction=inbound + receivedAt desc',
  /prisma\.caseEmail\.findFirst\(\{[\s\S]{0,300}direction: 'inbound'[\s\S]{0,200}orderBy: \{ receivedAt: 'desc' \}/.test(casesCode), true);
expect('1.3 lastInbound select toAddresses + ccAddresses (PII sızıntı yok)',
  /select: \{ toAddresses: true, ccAddresses: true \}/.test(casesCode), true);
expect('1.4 parseAddresses helper — JSON string → array',
  /const parseAddresses = \(s\) =>[\s\S]{0,400}JSON\.parse\(s\)/.test(casesCode), true);
expect('1.5 parse defansif — bozuk JSON → []',
  /try \{[\s\S]{0,200}JSON\.parse\(s\)[\s\S]{0,200}\} catch \{[\s\S]{0,100}return \[\]/.test(casesCode), true);
expect('1.6 normalize — trim + toLowerCase (case-insensitive kontratı)',
  /String\(r\?\.address \?\? ''\)\.trim\(\)\.toLowerCase\(\)/.test(casesCode), true);
expect('1.7 inboundKeys Set — to + cc birleşimi',
  /new Set\([\s\S]{0,300}parseAddresses\(lastInbound\.toAddresses\)[\s\S]{0,200}parseAddresses\(lastInbound\.ccAddresses\)/.test(casesCode), true);
expect('1.8 items sırasında ilk eşleşen (deterministic)',
  /for \(const a of items\)[\s\S]{0,400}inboundKeys\.has\(key\)[\s\S]{0,200}suggestedFromId = a\.id[\s\S]{0,100}break/.test(casesCode), true);
expect('1.9 response — suggestedFromId eklendi',
  /res\.json\(\{[\s\S]{0,400}suggestedFromId,?\s*\}\)/.test(casesCode), true);

console.log('\n── 2) Guard pariteti — mevcut scope korundu ────');
expect('2.1 caseRepository.get + allowedCompanyIds',
  /caseRepository\.get\([\s\S]{0,200}req\.user\.allowedCompanyIds/.test(casesCode), true);
expect('2.2 assertCaseSecurityFilterAccess korundu',
  /assertCaseSecurityFilterAccess\(req, \{[\s\S]{0,100}caseId: req\.params\.id[\s\S]{0,100}companyId: c\.companyId/.test(casesCode), true);
expect('2.3 listActiveWithSettingFallback korundu (kontrat tutarlılık)',
  /externalMailFromAliasRepo\.listActiveWithSettingFallback\(c\.companyId\)/.test(casesCode), true);

console.log('\n── 3) TS service — FromAliasesResult type ─────────');
expect('3.1 FromAliasesResult interface',
  /export interface FromAliasesResult \{[\s\S]{0,300}items: FromAliasOption\[\];[\s\S]{0,100}suggestedFromId: string \| null;/.test(svc), true);
expect('3.2 getFromAliases return Promise<FromAliasesResult>',
  /export async function getFromAliases\(caseId: string\): Promise<FromAliasesResult>/.test(svc), true);
expect('3.3 apiFetch response type suggestedFromId',
  /apiFetch<\{[\s\S]{0,200}suggestedFromId: string \| null/.test(svc), true);
expect('3.4 fallback — items ?? [] + suggestedFromId ?? null',
  /items: Array\.isArray\(out\?\.items\)[\s\S]{0,200}suggestedFromId: out\?\.suggestedFromId \?\? null/.test(svc), true);

console.log('\n── 4) MailComposer — reply/reply-all default seq ──');
expect('4.1 fromWasSuggested state eklendi',
  /const \[fromWasSuggested, setFromWasSuggested\] = useState\(false\)/.test(composer), true);
expect('4.2 destructure { items, suggestedFromId }',
  /getFromAliases\(item\.id\)\.then\(\(\{ items, suggestedFromId \}\)/.test(composer), true);
expect('4.3 isReplyFlow = !!initialReplyContext',
  /const isReplyFlow = !!initialReplyContext/.test(composer), true);
expect('4.4 reply akışında suggestedFromId önce dener',
  /if \(isReplyFlow && suggestedFromId\)[\s\S]{0,400}items\.find\(\(a\) => a\.id === suggestedFromId\)/.test(composer), true);
expect('4.5 fallback zinciri — isDefault ?? items[0]',
  /if \(!def\) def = items\.find\(\(a\) => a\.isDefault\) \?\? items\[0\] \?\? null/.test(composer), true);
expect('4.6 dependency array — initialReplyContext eklendi (reply mode değişince yeniden değerlendir)',
  /\}, \[item\.id, initialReplyContext\]\)/.test(composer), true);

console.log('\n── 5) MailComposer — UI hint + agent değiştirince reset ──');
expect('5.1 dropdown onChange — setFromWasSuggested(false) (agent seçti)',
  /onChange=\{\(e\) => \{[\s\S]{0,200}setFromId\(e\.target\.value\);[\s\S]{0,200}setFromWasSuggested\(false\);/.test(composer), true);
expect('5.2 hint metni "Mailin geldiği adres" görünür',
  /Mailin geldiği adres/.test(composer), true);
expect('5.3 hint sadece fromWasSuggested true iken',
  /\{fromWasSuggested &&[\s\S]{0,500}Mailin geldiği adres/.test(composer), true);
expect('5.4 tooltip — agent değiştirebilir açıklaması',
  /Son gelen mailin adres bilgisiyle otomatik eşlendi\. Dropdown'dan değiştirebilirsin/.test(composer), true);

console.log('\n── 6) Davranış — normalize (case-insensitive + trim) ─');

function normalize(s) {
  return String(s ?? '').trim().toLowerCase();
}
expect('6.1 Destek@ vs destek@ → eşit', normalize('Destek@Univera.com') === normalize('destek@univera.com'), true);
expect('6.2 boşluklu vs trimli → eşit', normalize('  destek@univera.com  ') === normalize('destek@univera.com'), true);
expect('6.3 null → boş', normalize(null), '');
expect('6.4 undefined → boş', normalize(undefined), '');

console.log('\n── 7) Davranış — suggestedFromId hesaplama simülasyonu ─');

function computeSuggestedFromId(lastInbound, aliases) {
  if (!aliases.length) return null;
  if (!lastInbound) return null;
  const parseAddresses = (s) => {
    if (!s || typeof s !== 'string') return [];
    try { const arr = JSON.parse(s); return Array.isArray(arr) ? arr : []; } catch { return []; }
  };
  const inboundKeys = new Set(
    [...parseAddresses(lastInbound.toAddresses), ...parseAddresses(lastInbound.ccAddresses)]
      .map((r) => String(r?.address ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (inboundKeys.size === 0) return null;
  for (const a of aliases) {
    const key = String(a?.address ?? '').trim().toLowerCase();
    if (key && inboundKeys.has(key)) return a.id;
  }
  return null;
}

const aliases = [
  { id: 'A1', address: 'destek@univera.com' },
  { id: 'A2', address: 'cagri.merkezi@univera.com' },
  { id: 'A3', address: 'satis@univera.com' },
];

// Scenario 1: destek@'e gelen mail
const s1 = {
  toAddresses: JSON.stringify([{ address: 'destek@univera.com', name: 'Destek' }]),
  ccAddresses: null,
};
expect('7.1 destek@ inbound → suggested A1',
  computeSuggestedFromId(s1, aliases), 'A1');

// Scenario 2: cagri.merkezi@'ye gelen mail
const s2 = {
  toAddresses: JSON.stringify([{ address: 'cagri.merkezi@univera.com' }]),
  ccAddresses: null,
};
expect('7.2 cagri.merkezi@ inbound → suggested A2',
  computeSuggestedFromId(s2, aliases), 'A2');

// Scenario 3: BÜYÜK/küçük harf farkı
const s3 = {
  toAddresses: JSON.stringify([{ address: 'Destek@Univera.COM' }]),
  ccAddresses: null,
};
expect('7.3 Destek@Univera.COM (harf farkı) → suggested A1',
  computeSuggestedFromId(s3, aliases), 'A1');

// Scenario 4: elle açılmış vaka (inbound yok)
expect('7.4 inbound yok → null (compose-new)',
  computeSuggestedFromId(null, aliases), null);

// Scenario 5: alias eşleşmesi yok (CC/BCC ile gelmiş, farklı bir kutuya)
const s5 = {
  toAddresses: JSON.stringify([{ address: 'baska@musteri.com' }]),
  ccAddresses: null,
};
expect('7.5 alias eşleşmesi yok → null (compose-new default)',
  computeSuggestedFromId(s5, aliases), null);

// Scenario 6: çoklu eşleşme — ilk items sırasında
const s6 = {
  toAddresses: JSON.stringify([
    { address: 'cagri.merkezi@univera.com' },
    { address: 'destek@univera.com' },
  ]),
  ccAddresses: null,
};
// aliases order: destek → A1 ilk, sonra cagri.merkezi → A2. Items sırasında ilk eşleşen A1.
expect('7.6 çoklu eşleşme — items sırasında ilk (A1)',
  computeSuggestedFromId(s6, aliases), 'A1');

// Scenario 7: cc'de eşleşme (to'da yok)
const s7 = {
  toAddresses: JSON.stringify([{ address: 'baska@musteri.com' }]),
  ccAddresses: JSON.stringify([{ address: 'satis@univera.com' }]),
};
expect('7.7 CC\'de alias eşleşmesi → suggested (A3)',
  computeSuggestedFromId(s7, aliases), 'A3');

// Scenario 8: alias listesi boş
expect('7.8 alias listesi boş → null',
  computeSuggestedFromId(s1, []), null);

// Scenario 9: bozuk JSON
const s9 = { toAddresses: 'bozuk-json{{{', ccAddresses: null };
expect('7.9 bozuk JSON → null (defansif catch)',
  computeSuggestedFromId(s9, aliases), null);

console.log('\n── 8) Davranış — default seçim sırası (composer) ─');

function pickDefault(items, suggestedFromId, isReplyFlow) {
  if (isReplyFlow && suggestedFromId) {
    const match = items.find((a) => a.id === suggestedFromId);
    if (match) return { id: match.id, bySuggestion: true };
  }
  const fallback = items.find((a) => a.isDefault) ?? items[0] ?? null;
  return fallback ? { id: fallback.id, bySuggestion: false } : null;
}

const items = [
  { id: 'A1', address: 'destek@univera.com', isDefault: false },
  { id: 'A2', address: 'cagri.merkezi@univera.com', isDefault: true },
  { id: 'A3', address: 'satis@univera.com', isDefault: false },
];

const r1 = pickDefault(items, 'A1', true);
expect('8.1 reply + suggested A1 → A1 seçildi', r1?.id, 'A1');
expect('8.2 reply + suggested A1 → bySuggestion true', r1?.bySuggestion, true);

const r2 = pickDefault(items, null, true);
expect('8.3 reply + suggested null → isDefault A2', r2?.id, 'A2');
expect('8.4 reply + suggested null → bySuggestion false', r2?.bySuggestion, false);

const r3 = pickDefault(items, 'A1', false);
expect('8.5 compose-new/forward + suggested A1 → isDefault A2 (mevcut davranış)', r3?.id, 'A2');
expect('8.6 compose-new + suggested → bySuggestion false (öneri devrede değil)', r3?.bySuggestion, false);

const r4 = pickDefault(items, 'BILINMEYEN_ID', true);
expect('8.7 reply + suggested silinmiş alias → isDefault fallback', r4?.id, 'A2');
expect('8.8 reply + suggested silinmiş → bySuggestion false', r4?.bySuggestion, false);

const noDefault = [
  { id: 'X1', address: 'x@y.com', isDefault: false },
];
const r5 = pickDefault(noDefault, null, true);
expect('8.9 isDefault yok → items[0]', r5?.id, 'X1');

const r6 = pickDefault([], null, true);
expect('8.10 items boş → null', r6, null);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
