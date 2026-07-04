/**
 * smoke-pr2-mail-thread-reader.js — 2026-07-04
 *
 * PR-2 FAZ 2 — MailThreadReader (TEK bileşen iki boyutta).
 *
 * Kullanıcı direktifi: "TEK bileşen iki boyutta — kod çatallaması YASAK".
 * Reader'ın iç yapısı SABİT, sadece dış wrapper değişir.
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

const r = read('src/features/cases/components/MailThreadReader.tsx');

console.log('── 1) Component API ──────────────────────────');
expectTrue('1.1 MailThreadReaderMode export ("inline"|"fullscreen")',
  /export type MailThreadReaderMode\s*=\s*'inline'\s*\|\s*'fullscreen'/.test(r));
expectTrue('1.2 Props: mode + onExpand + onCollapse + onReply + onForward + onQuickReply',
  /mode:\s*MailThreadReaderMode[\s\S]{0,400}onExpand:[\s\S]{0,200}onCollapse:[\s\S]{0,200}onReply:[\s\S]{0,200}onForward:[\s\S]{0,200}onQuickReply:/.test(r));

console.log('\n── 2) TEK bileşen — readerBody sabit, wrapper PARENT yönetir (R4) ─');
// R4 refactor: reader kendi wrapper'ını yönetmiyor; parent (CommunicationTab)
// hem inline hem fullscreen dış layout'u yönetir. Reader iç yapısı sabit.
expectTrue('2.1 readerBody const — mode\'dan bağımsız (kod çatallaması YOK)',
  /const readerBody\s*=\s*\(/.test(r));
expectTrue('2.2 Reader tek wrapper div (parent yönetir; kendi overlay YOK)',
  /<div className="flex h-full min-h-0 flex-col bg-white[\s\S]{0,200}\{readerBody\}/.test(r));
expectTrue('2.3 REGRESYON: eski mode-switch (rounded-md border VS fixed inset-0) KALKMIŞ',
  !/mode === 'inline' \? \(\s*<div[\s\S]{0,200}rounded-md border[\s\S]{0,200}\) : \(\s*<div[\s\S]{0,200}fixed inset-0/.test(r));

console.log('\n── 3) Aksiyon barı — R2: header sağında (üstte) + alt yalnız hızlı-yanıt ─');
expectTrue('3.1 Yanıtla button → onReply(email)',
  /onClick=\{\(\)\s*=>\s*onReply\(email\)\}/.test(r));
expectTrue('3.2 İlet button → onForward(email)',
  /onClick=\{\(\)\s*=>\s*onForward\(email\)\}/.test(r));
expectTrue('3.3 Genişlet inline modda → onExpand',
  /mode === 'inline'[\s\S]{0,600}onClick=\{onExpand\}/.test(r));
expectTrue('3.4 Küçült fullscreen modda → onCollapse',
  /onClick=\{onCollapse\}[\s\S]{0,300}Küçült/.test(r));
expectTrue('3.5 Hızlı-yanıt çubuğu → onQuickReply(email)',
  /onClick=\{\(\)\s*=>\s*onQuickReply\(email\)\}[\s\S]{0,300}Hızlı yanıt yaz/.test(r));

// R2: aksiyon barı ÜST başlığa taşındı; alt kenarda YALNIZ hızlı-yanıt
expectTrue('3.6 R2: Yanıtla button header sağında (Genişlet ile aynı flex row)',
  /R2[\s\S]{0,600}Yanıtla[\s\S]{0,400}İlet[\s\S]{0,400}Genişlet/.test(r));
expectTrue('3.7 R2 REGRESYON: alt kenar yorumu "YALNIZ hızlı-yanıt"',
  /R2[\s\S]{0,300}YALNIZ hızlı-yanıt/.test(r));
expectTrue('3.8 R2 REGRESYON: alt kenar Yanıtla/İlet BUTONLARI KALKMIŞ',
  // Alt bar bloğunda "Yanıtla" bulunmamalı — sadece "Hızlı yanıt yaz"
  !/border-t border-slate-200 bg-white px-3 py-2[\s\S]{0,400}Yanıtla/.test(r));
expectTrue('3.9 Header shrink-0 → uzun mail scroll\'da sabit görünür',
  /Header[\s\S]{0,50}subject[\s\S]{0,50}ayrıntılar[\s\S]{0,200}shrink-0 border-b/.test(r));

console.log('\n── 4) Hit target ≥36px (aksiyon) / ≥40px (hızlı-yanıt) ─');
expectTrue('4.1 Aksiyon butonları min-h-[36px]',
  (r.match(/min-h-\[36px\]/g) ?? []).length >= 3);
expectTrue('4.2 Hızlı-yanıt çubuğu min-h-[40px] + Hızlı yanıt yaz metni',
  /min-h-\[40px\][\s\S]{0,500}Hızlı yanıt yaz/.test(r));

console.log('\n── 5) ESC kapanış (fullscreen) ─────────────────');
expectTrue('5.1 ESC listener sadece fullscreen modda',
  /if \(mode !== 'fullscreen'\) return[\s\S]{0,200}e\.key === 'Escape' && onCollapse\(\)/.test(r));
expectTrue('5.2 keydown add/remove cleanup',
  /window\.addEventListener\('keydown', onKey\)[\s\S]{0,200}return \(\)\s*=>\s*window\.removeEventListener\('keydown', onKey\)/.test(r));

console.log('\n── 6) ayrıntılar ▾ toggle (CC/BCC/tam adresler) ─');
expectTrue('6.1 detailsOpen state',
  /const \[detailsOpen, setDetailsOpen\]\s*=\s*useState\(false\)/.test(r));
expectTrue('6.2 Toggle button aria-expanded',
  /aria-expanded=\{detailsOpen\}[\s\S]{0,200}ayrıntılar/.test(r));
expectTrue('6.3 CC/BCC/Kimden expanded panel',
  /detailsOpen && \([\s\S]{0,600}Cc:[\s\S]{0,200}Bcc:[\s\S]{0,200}Kimden:/.test(r));

console.log('\n── 7) Body render — max-w-[680px] + sanitize + rewrite ─');
expectTrue('7.1 Body max-w-[680px] wrapper',
  /max-w-\[680px\][\s\S]{0,300}prose prose-sm/.test(r));
expectTrue('7.2 sanitizeMailHtml uygulanır (defense-in-depth)',
  /sanitizeMailHtml\(renderedHtml\)/.test(r));
expectTrue('7.3 processBodyHtml — cid rewrite (helper module-scope)',
  /async function processBodyHtml\(/.test(r));

console.log('\n── 8) Ek chip\'leri — HoverPreview + Lightbox reuse ─');
expectTrue('8.1 HoverPreview import from PR-1',
  /from '@\/components\/attachments\/HoverPreview'/.test(r));
expectTrue('8.2 Lightbox import from PR-1',
  /from '@\/components\/attachments\/Lightbox'/.test(r));
expectTrue('8.3 Ek chip render — HoverPreview wrap + Lightbox activeId',
  /<HoverPreview[\s\S]{0,400}getPreviewUrl=\{getAttachmentPreviewUrlHover\}/.test(r));
expectTrue('8.4 openAttachment helper — görsel setLightboxActiveId, aksi downloadAttachment',
  /const openAttachment\s*=[\s\S]{0,200}if \(isImage\) setLightboxActiveId\(attId\)[\s\S]{0,200}else void downloadAttachment\(attId\)/.test(r));

console.log('\n── 9) RUNA slot (yapısal, boş) ────────────────');
expectTrue('9.1 data-runa-slot="reader-actions" (header)',
  /data-runa-slot="reader-actions"/.test(r));
expectTrue('9.2 data-runa-slot="quick-reply-suggestions" (aksiyon barı)',
  /data-runa-slot="quick-reply-suggestions"/.test(r));

console.log('\n── 10) subject normalize entegrasyonu ─────────');
expectTrue('10.1 normalizeSubject import',
  /import \{ normalizeSubject \} from '@\/lib\/subjectNormalizer'/.test(r));
expectTrue('10.2 Reader header subject → normalize',
  /normalizeSubject\(email\.subject\)/.test(r));
expectTrue('10.3 title\'da ham subject (tooltip)',
  /title=\{email\.subject\}[\s\S]{0,200}normalizeSubject/.test(r));

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
