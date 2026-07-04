/**
 * smoke-pr2-r13-communication-fixes.js — 2026-07-04
 *
 * R13 4 madde:
 *   M1 — Okuma-alanı-öncelikli liste yüksekliği (sekme-içi). Az mesajda
 *        liste=içerik, kalan reader'a; çok mesajda splitRatio cap; divider
 *        yalnız cap'te. Tam-ekran sol listeye DOKUNULMADI.
 *   M2 — Reader konu: normalizeSubject(..., {stripCaseToken:true}); ham konu
 *        tooltip + "ayrıntılar ▾" içinde. Composer subject'e DOKUNULMADI.
 *   M3 — buildReplyContext direction-aware: outbound satıra doğrudan yanıtta
 *        to = o mailin alıcıları (self değil). Codex P2 "outbound→son inbound"
 *        sessiz fallback KALDIRILDI.
 *   M4 — R11.1 tipografi kaçak temizliği zaten HEAD'de (commit 3e428a2).
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTrue(name, cond) { expect(name, !!cond, true); }
function read(p) { return readFileSync(p, 'utf8'); }

const listPane = read('src/features/cases/components/MailThreadListPane.tsx');
const reader = read('src/features/cases/components/MailThreadReader.tsx');
const tab = read('src/features/cases/components/CommunicationTab.tsx');
const composer = read('src/features/cases/components/MailComposer.tsx');
const backend = read('server/lib/caseEmailSender.js');

console.log('── 1) M1 — Okuma-alanı-öncelikli liste yüksekliği ─');
expectTrue('1.1 ListPane onContentHeightChange prop',
  /onContentHeightChange\?:\s*\(px:\s*number\)\s*=>\s*void/.test(listPane));
expectTrue('1.2 ListPane useLayoutEffect + ResizeObserver + measure(header+body.scrollHeight)',
  /useLayoutEffect/.test(listPane)
  && /new ResizeObserver/.test(listPane)
  && /header\.offsetHeight \+ body\.scrollHeight/.test(listPane));
expectTrue('1.3 data-mail-list-header + data-mail-list-body query selector\'ları',
  /data-mail-list-header/.test(listPane) && /data-mail-list-body/.test(listPane));

expectTrue('1.4 Tab: containerH + listContentH state (ölçüm)',
  /const \[containerH, setContainerH\]\s*=\s*useState\(0\)[\s\S]{0,200}const \[listContentH, setListContentH\]\s*=\s*useState\(0\)/.test(tab));
expectTrue('1.5 Tab: container ResizeObserver ölçümü — containerRef + setContainerH(clientHeight)',
  /containerRef\.current/.test(tab)
  && /new ResizeObserver/.test(tab)
  && /setContainerH\(el\.clientHeight\)/.test(tab));
expectTrue('1.6 Tab: capPx/atCap/listPx türetilmiş',
  /const capPx = containerH \* splitRatio[\s\S]{0,300}const atCap = [\s\S]{0,200}listContentH >= capPx - 1[\s\S]{0,150}const listPx = atCap \? capPx : listContentH/.test(tab));
expectTrue('1.7 R13.1: Liste style — listSizeMeasured ? listPx px : splitRatio% (savunma guard)',
  /selectedEmail\s*\?\s*\(listSizeMeasured\s*\?\s*\{ height: `\$\{listPx\}px`, flexShrink: 0 \}\s*:\s*\{ height: `\$\{splitRatio \* 100\}%`, flexShrink: 0 \}\)/.test(tab));
expectTrue('1.8 R14 M3: Divider koşulu selectedEmail && listSizeMeasured && atCap',
  /\{selectedEmail && listSizeMeasured && atCap && \(\s*<>[\s\S]{0,600}role="separator"/.test(tab));
expectTrue('1.9 Tab: reader SEPARATE conditional (atCap değilse de görünür — kalan alanı doldurur)',
  /\{selectedEmail && \(\s*<div className="min-h-0 flex-1 bg-white/.test(tab));
expectTrue('1.10 Tab: sekme-içi ListPane onContentHeightChange={setListContentH}',
  /<MailThreadListPane[\s\S]{0,600}onContentHeightChange=\{setListContentH\}/.test(tab));
expectTrue('1.11 Fs listPane onContentHeightChange VERİLMEZ (fs sol listeye dokunulmaz)',
  (tab.match(/onContentHeightChange=\{setListContentH\}/g) ?? []).length === 1);

console.log('\n── 2) M1 davranış simülasyonu (cap/atCap/divider) ─');

function deriveLayout({ containerH, splitRatio, listContentH }) {
  const capPx = containerH * splitRatio;
  const atCap = containerH === 0 || listContentH === 0 || listContentH >= capPx - 1;
  const listPx = atCap ? capPx : listContentH;
  return { capPx, atCap, listPx, dividerShown: atCap };
}

// 2.1 1 mesajlı vaka — liste ~80px, container 700, cap ~245 → altında → atCap=false
const r1 = deriveLayout({ containerH: 700, splitRatio: 0.35, listContentH: 80 });
expect('2.1 1 mesaj (80px) < cap 245 → listPx=80 (içerik)', r1.listPx, 80);
expect('2.1b divider GİZLİ (atCap=false)', r1.dividerShown, false);

// 2.2 20 mesajlı vaka — liste ~1050px, container 700, cap ~245 → cap davranışı
const r2 = deriveLayout({ containerH: 700, splitRatio: 0.35, listContentH: 1050 });
expectTrue('2.2 20 mesaj (1050px) > cap 245 → listPx ≈ cap 245 (float toleransı ±0.01)',
  Math.abs(r2.listPx - 245) < 0.01);
expect('2.2b divider görünür (atCap=true)', r2.dividerShown, true);

// 2.3 cap'e denk (fark ≤1px) → cap say
const r3 = deriveLayout({ containerH: 700, splitRatio: 0.35, listContentH: 244.5 });
expect('2.3 Sınıra çok yakın (244.5, cap 245) → atCap true (drag akışı hazır)',
  r3.dividerShown, true);

// 2.4 Ölçüm henüz gelmedi (listContentH=0) → cap (mevcut davranış korunur)
const r4 = deriveLayout({ containerH: 700, splitRatio: 0.35, listContentH: 0 });
expect('2.4 Ölçüm gelmedi → atCap default (regresyonsuz)', r4.dividerShown, true);

// 2.5 Container henüz ölçülmedi → yine cap davranışı (guard)
const r5 = deriveLayout({ containerH: 0, splitRatio: 0.35, listContentH: 100 });
expect('2.5 containerH=0 → atCap default', r5.dividerShown, true);

// 2.6 Farklı splitRatio (drag ile artırılmış) → cap orantılı
const r6 = deriveLayout({ containerH: 700, splitRatio: 0.5, listContentH: 200 });
expect('2.6 splitRatio 0.5 + 200px içerik → içerik < cap 350 → listPx=200', r6.listPx, 200);

console.log('\n── 3) M2 — Reader konu token gizle + ayrıntılara ham ─');
expectTrue('3.1 Reader başlık normalizeSubject(email.subject, {stripCaseToken:true})',
  /normalizeSubject\(email\.subject,\s*\{\s*stripCaseToken:\s*true\s*\}\)/.test(reader));
expectTrue('3.2 REGRESYON: eski normalizeSubject(email.subject) (stripsiz) KALKMIŞ',
  !/normalizeSubject\(email\.subject\)\s*\|\| '\(konusuz\)'/.test(reader));
expectTrue('3.3 Ham konu title (tooltip) hâlâ mevcut',
  /title=\{email\.subject\}/.test(reader));
expectTrue('3.4 ayrıntılar içinde "Konu:" satırı ham hâli gösterir',
  /Konu:<\/span> \{email\.subject \|\| '\(konusuz\)'\}/.test(reader));
expectTrue('3.5 Composer subject initializer DOKUNULMADI (outbound threading token korunur)',
  /const \[subject, setSubject\]\s*=\s*useState<string>\(\(\)\s*=>\s*\{[\s\S]{0,400}normalizeSubject\(raw\)[\s\S]{0,400}return clean/.test(composer)
  && !/normalizeSubject\(raw,\s*\{\s*stripCaseToken/.test(composer));

console.log('\n── 4) M3 — buildReplyContext direction-aware ─');
expectTrue('4.1 REPLY_FIELDS "direction: true" içerir (fetch\'te direction alınır)',
  /REPLY_FIELDS = \{[\s\S]{0,200}direction:\s*true/.test(backend));
expectTrue('4.2 emailId verildiğinde direction FİLTRESİZ ref al (outbound da geçerli)',
  /if \(emailId\) \{\s*refRow = await prisma\.caseEmail\.findFirst\(\{\s*where:\s*\{ id:\s*emailId,\s*caseId \},\s*select:\s*REPLY_FIELDS,?\s*\}\);/.test(backend));
expectTrue('4.3 Ref yok → son inbound fallback',
  /if \(!refRow\)[\s\S]{0,300}direction:\s*'inbound'[\s\S]{0,300}orderBy:\s*\{ receivedAt:\s*'desc'/.test(backend));
expectTrue('4.4 Inbound da yok → son outbound fallback (R13 outbound-only thread)',
  /if \(!refRow\)[\s\S]{0,600}direction:\s*'outbound'[\s\S]{0,300}orderBy:\s*\[\{ sentAt:\s*'desc'/.test(backend));
expectTrue('4.5 refRow.direction === "inbound" → K6 reply-all (from + to birleşimi)',
  /if \(refRow\.direction === 'inbound'\) \{[\s\S]{0,400}senderEntry[\s\S]{0,200}uniq\(\[senderEntry, \.\.\.refTo\]\)/.test(backend));
expectTrue('4.6 outbound ref: to = o mailin alıcıları (self entry EKLENMEZ)',
  /\} else \{[\s\S]{0,400}to = filterAlias\(uniq\(refTo\)\);\s*cc = filterAlias\(uniq\(refCc\)\)/.test(backend));
expectTrue('4.7 REGRESYON: eski "direction: \'inbound\'" strict emailId query KALKMIŞ',
  !/id:\s*emailId,\s*caseId,\s*direction:\s*'inbound'/.test(backend));
expectTrue('4.8 REGRESYON: eski "lastInbound" değişkeni KALKMIŞ (yeniden adlandırıldı refRow)',
  !/let lastInbound/.test(backend));

console.log('\n── 5) M3 backend davranış simülasyonu ────────');

function pickRefRow({ emailId, threadEmails }) {
  if (emailId) {
    const r = threadEmails.find((e) => e.id === emailId);
    if (r) return r;
  }
  const lastIn = [...threadEmails].reverse().find((e) => e.direction === 'inbound');
  if (lastIn) return lastIn;
  return [...threadEmails].reverse().find((e) => e.direction === 'outbound') ?? null;
}
function buildTo(refRow) {
  if (!refRow) return { to: [], cc: [], subject: '' };
  const refTo = refRow.toAddresses ?? [];
  const refCc = refRow.ccAddresses ?? [];
  const to = refRow.direction === 'inbound'
    ? [{ address: refRow.fromAddress }, ...refTo]
    : refTo;
  const base = refRow.subject ?? '';
  const subject = /^re:\s*/i.test(base) ? base : `Re: ${base}`;
  return { to, cc: refCc, subject };
}

// 5.1 UNV-1000111 repro — outbound-only, Otomatik ACK; Yanıtla emailId=out1
const thread1 = [{ id: 'out1', direction: 'outbound', fromAddress: 'destek@x.com',
  toAddresses: [{ address: 'musteri@y.com' }], ccAddresses: [], subject: 'ACK' }];
const r_1 = buildTo(pickRefRow({ emailId: 'out1', threadEmails: thread1 }));
expect('5.1 UNV-1000111 (outbound-only + ACK) → to = musteri@y.com',
  r_1.to[0].address, 'musteri@y.com');
expect('5.1b Subject Re: ACK', r_1.subject, 'Re: ACK');

// 5.2 Klasik inbound → K6 reply-all (from + to)
const thread2 = [{ id: 'in1', direction: 'inbound', fromAddress: 'a@x.com',
  toAddresses: [{ address: 'destek@my.com' }], ccAddresses: [{ address: 'b@x.com' }],
  subject: 'Soru' }];
const r_2 = buildTo(pickRefRow({ emailId: 'in1', threadEmails: thread2 }));
expect('5.2 Inbound emailId → to[0] = from (a@x.com)', r_2.to[0].address, 'a@x.com');
expect('5.2b to[1] = inbound.to (destek@my.com)', r_2.to[1].address, 'destek@my.com');

// 5.3 Reply-all cc'li — cc korunur
expect('5.3 cc = inbound.cc (b@x.com)', r_2.cc[0].address, 'b@x.com');

// 5.4 emailId yok + inbound var → fallback son inbound
const thread3 = [
  { id: 'in1', direction: 'inbound', fromAddress: 'a@x.com', toAddresses: [], ccAddresses: [], subject: 'S1' },
  { id: 'in2', direction: 'inbound', fromAddress: 'b@x.com', toAddresses: [], ccAddresses: [], subject: 'S2' },
];
const r_4 = buildTo(pickRefRow({ emailId: undefined, threadEmails: thread3 }));
expect('5.4 emailId yok → son inbound (in2 → b@x.com)', r_4.to[0].address, 'b@x.com');

// 5.5 emailId yok + hiç inbound yok → son outbound fallback
const thread4 = [
  { id: 'out1', direction: 'outbound', fromAddress: 'destek@x.com',
    toAddresses: [{ address: 'first@y.com' }], ccAddresses: [], subject: 'M1' },
  { id: 'out2', direction: 'outbound', fromAddress: 'destek@x.com',
    toAddresses: [{ address: 'last@y.com' }], ccAddresses: [], subject: 'M2' },
];
const r_5 = buildTo(pickRefRow({ emailId: undefined, threadEmails: thread4 }));
expect('5.5 emailId yok + outbound-only → son outbound → last@y.com',
  r_5.to[0].address, 'last@y.com');

console.log('\n── 6) M4 R11.1 kaçak temizliği KORUNDU (kontrol) ─');
expectTrue('6.1 Reader\'da text-[10px] literal kalmamış',
  !/text-\[10px\]/.test(reader));
expectTrue('6.2 Tab\'da text-[10px] literal kalmamış',
  !/text-\[10px\]/.test(tab));
expectTrue('6.3 Composer\'da text-[10px]/text-[11px] literal kalmamış',
  !/text-\[10px\]/.test(composer) && !/text-\[11px\]/.test(composer));

console.log('\n── 7) Prefill paritesi — 3 görünüm × 3 senaryo ─');
// Aynı composer instance (R8) + aynı openReply + aynı MailComposer prop\'ları
// → prefill iki görünümde ÖZDEŞ. Test: iki mount da tek MailComposer + aynı
// openReply çağırır (regresyon guard\'ı).
expectTrue('7.1 R8 KORUNDU: <MailComposer> = 1',
  (tab.match(/<MailComposer\b/g) ?? []).length === 1);
expectTrue('7.2 3 openReply çağrısı (Reader inline + Reader fs + hızlı-yanıt)',
  (tab.match(/openReply/g) ?? []).length >= 4);
expectTrue('7.3 Composer initialReplyContext={replyCtx} tek yerde',
  /initialReplyContext=\{replyCtx\}/.test(tab));
expectTrue('7.4 openReply setComposeKey artırır (yeni composer init)',
  /const openReply\s*=\s*useCallback[\s\S]{0,500}setComposeKey\(\(k\) => k \+ 1\)/.test(tab));

console.log('\n── 8) Regresyon — R11/R12/R10.x KORUNDU ────────');
expectTrue('8.1 R12: selectedId=null katlı başlangıç (auto-select yok)',
  /setSelectedId\(\(cur\) => \(cur && items\.some\(\(e\) => e\.id === cur\)\) \? cur : null\)/.test(tab));
expectTrue('8.2 R12: ListPane onNewEmail={openNew} 2 mount',
  (tab.match(/onNewEmail=\{openNew\}/g) ?? []).length === 2);
expectTrue('8.3 R11: MAIL_TYPE tokenle çalışır',
  /import \{ MAIL_TYPE \} from '\.\.\/lib\/mailTypography'/.test(tab)
  && /import \{ MAIL_TYPE \} from '\.\.\/lib\/mailTypography'/.test(reader));
expectTrue('8.4 R10.3: bar müşteri onShowCustomer',
  /onShowCustomer && item\.accountId/.test(tab));

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
