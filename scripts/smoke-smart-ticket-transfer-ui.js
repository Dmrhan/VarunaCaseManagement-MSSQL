/**
 * smoke-smart-ticket-transfer-ui.js — PR-T2 static guard.
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-transfer-ui.js
 *
 * SmartTicketNewPage.tsx üzerinde grep tabanlı invariant testleri.
 * DB veya HTTP gerektirmez. Yalnız PR-T2 davranışını koruma altına alır.
 *
 * Korunan invariant'lar:
 *   - Tenant-safe target selection (hard-code "Univera L2" yasak)
 *   - L2 takım filtreleme yalnız Team.defaultSupportLevel === 'L2'
 *   - Çoklu L2 ekipte auto-select yok
 *   - Tek L2 ekipte preselect var
 *   - Devir notu zorunlu
 *   - Auto-fetch brief (PR-T1 endpoint reuse)
 *   - PR-T1 backend kontratı: smartTicketTransfer payload
 *   - Auto-close YOK, yeni Case yaratma YOK, SLA dokunma YOK
 *   - Mevcut "Çözümle kapat" akışı korundu
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const PAGE = resolve(PROJECT_ROOT, 'src/features/smart-ticket/SmartTicketNewPage.tsx');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

if (!existsSync(PAGE)) {
  bad('SmartTicketNewPage.tsx YOK');
  process.exit(1);
}
const src = readFileSync(PAGE, 'utf8');

// 1) Stage3Transfer bileşeni var; eski Stage3TransferPlaceholder YOK.
if (src.includes('function Stage3Transfer(') && !src.includes('Stage3TransferPlaceholder')) {
  ok('1) Stage3Transfer bileşeni tanımlı (placeholder kaldırıldı)');
} else {
  bad('1) Stage3Transfer eksik veya placeholder hala duruyor');
}

// 2) Hedef takım select'i Team.defaultSupportLevel === 'L2' bazlı filter.
if (/defaultSupportLevel\s*===\s*['"]L2['"]/.test(src)) {
  ok('2) L2 filter Team.defaultSupportLevel === "L2" üzerinden');
} else {
  bad('2) defaultSupportLevel L2 filter eksik');
}

// 3) Hard-code yasak: tenant/takım adı string olarak ekrana sızmamalı.
const BANNED_HARDCODE = [
  '"Univera L2"',
  "'Univera L2'",
  '"UNIVERA"',
  "'UNIVERA'",
  '"Univera"',
  "'Univera'",
];
const leakedHardcode = BANNED_HARDCODE.filter((s) => src.includes(s));
if (leakedHardcode.length === 0) {
  ok('3) Hard-code tenant/team adı yok (Univera/UNIVERA literal\'leri sızmamış)');
} else {
  bad('3) Hard-code literal bulundu', leakedHardcode.join(', '));
}

// 4) Çoklu L2 ekipte auto-select YOK: preselect koşulu l2.length === 1.
if (/transferTeamOptions\.l2\.length\s*===\s*1/.test(src)) {
  ok('4) Tek L2 ekip varsa preselect (auto-select yalnız length === 1)');
} else {
  bad('4) Tek-L2 preselect koşulu eksik');
}

// 5) Sıfır L2 ekipte calm warning ekrandadır (blocking değil).
if (
  src.includes('L2 olarak işaretli takım bulunamadı') ||
  src.includes('L2 olarak işaretli takım yok')
) {
  ok('5) Sıfır L2 ekip uyarısı var (calm warning)');
} else {
  bad('5) Sıfır L2 uyarısı eksik');
}

// 6) Devir notu zorunlu — submit guard.
if (/Devir notu zorunlu/.test(src) && /transferNote\.trim\(\)/.test(src)) {
  ok('6) Devir notu zorunlu (transferNote.trim() guard)');
} else {
  bad('6) Devir notu zorunluluk guard eksik');
}

// 7) caseService.transferCase çağrısı + smartTicketTransfer payload.
if (
  /caseService\.transferCase\(createdCase\.id/.test(src) &&
  src.includes('smartTicketTransfer:')
) {
  ok('7) caseService.transferCase çağrısı + smartTicketTransfer payload');
} else {
  bad('7) PR-T1 backend contract eksik');
}

// 8) PR-T1 payload alanları: transferNote + composedSummary + attemptedStepIds +
//    stepOutcomesSummary.
const PAYLOAD_KEYS = ['transferNote', 'composedSummary', 'attemptedStepIds', 'stepOutcomesSummary'];
const missingKeys = PAYLOAD_KEYS.filter((k) => !src.includes(k));
if (missingKeys.length === 0) {
  ok('8) PR-T1 payload alanları kullanılıyor (transferNote/composedSummary/attemptedStepIds/stepOutcomesSummary)');
} else {
  bad('8) PR-T1 payload alanları eksik', missingKeys.join(', '));
}

// 9) Auto-fetch brief: smartTicketTransferBrief çağrısı + Stage 'transfer'
//    useEffect tetiklemesi.
if (
  src.includes('smartTicketTransferBrief(') &&
  /useEffect\(\(\)\s*=>\s*\{[\s\S]*?stage\s*!==\s*['"]transfer['"][\s\S]*?handleFetchTransferBrief\(\)/.test(src)
) {
  ok('9) Stage 3 transfer auto-fetch (smartTicketTransferBrief)');
} else {
  bad('9) auto-fetch effect eksik');
}

// 10) Stale guard + queued re-fetch (closure pattern simetrisi).
if (
  src.includes('transferBriefReqIdRef') &&
  src.includes('transferBriefQueuedRef')
) {
  ok('10) Transfer brief stale-guard + queued re-fetch (reqId + queued ref\'leri)');
} else {
  bad('10) stale guard / queued ref eksik');
}

// 11) Composer editable — kullanıcı düzenlemesi auto-fetch'i ezmez
//     (dirtyRef ile flag).
if (src.includes('transferSummaryDirtyRef')) {
  ok('11) Composer editable koruması var (dirtyRef ile user override korunur)');
} else {
  bad('11) dirtyRef flag eksik');
}

// 12) Auto-close YOK: transferCase çağrısı transitionStatus('Çözüldü') ile
//     birlikte gelmiyor. Devret akışında close call YOK.
const transferHandler = src.match(/async function handleSubmitTransfer[\s\S]*?\n  \}/);
if (transferHandler && !/transitionStatus[\s\S]*?Çözüldü/.test(transferHandler[0])) {
  ok('12) Devret akışında auto-close YOK (transitionStatus("Çözüldü") çağrısı yok)');
} else if (!transferHandler) {
  bad('12) handleSubmitTransfer function bulunamadı');
} else {
  bad('12) Devret akışında transitionStatus("Çözüldü") çağrısı bulundu');
}

// 13) Yeni Case yaratma YOK: handleSubmitTransfer içinde caseService.create YOK.
if (transferHandler && !/caseService\.create\(/.test(transferHandler[0])) {
  ok('13) Devret akışında yeni Case yaratılmıyor (caseService.create yok)');
} else {
  bad('13) Devret akışında caseService.create bulundu');
}

// 14) SLA dokunma YOK: sla* alanlarına UI'dan PATCH yok.
if (
  !/setSla|patch.*sla|slaResponseDueAt:|slaResolutionDueAt:|slaPausedAt:/.test(src)
) {
  ok('14) SLA alanlarına UI dokunmuyor');
} else {
  bad('14) UI SLA alanlarına yazıyor');
}

// 15) supportLevel mutation YOK: UI bu alanı patch etmiyor.
if (!/supportLevel:\s*['"]L/.test(src)) {
  ok('15) supportLevel UI tarafından mutate edilmiyor');
} else {
  bad('15) UI supportLevel set ediyor (yasak)');
}

// 16) Mevcut "Çözümle kapat" akışı KORUNDU — handleCloseCase hala var,
//     Stage3Closure render ediliyor, smartTicketClosure payload kullanılıyor.
if (
  src.includes('async function handleCloseCase') &&
  src.includes('<Stage3Closure') &&
  src.includes('smartTicketClosure')
) {
  ok('16) Mevcut closure ("Çözümle kapat") akışı korundu');
} else {
  bad('16) closure akışı bozulmuş');
}

// 17) Required checklist gating (PR-2c P1 fix) korundu — closure submit
//     hala requiredChecklistPending üzerinden gate'leniyor.
if (src.includes('requiredChecklistPending')) {
  ok('17) Checklist gating closure tarafında korundu');
} else {
  bad('17) requiredChecklistPending kayboldu');
}

// 18) Hedef kişi opsiyonel ve takıma göre filter.
if (
  src.includes('lookupService.personsByTeam(') ||
  /transferPersonOptions[\s\S]{0,100}?teamId/.test(src)
) {
  ok('18) Hedef kişi takıma göre filter (lookupService.personsByTeam)');
} else {
  bad('18) Person team filter eksik');
}

// 19) Hedef takım select <optgroup> ile "Önerilen L2 ekipleri" gruplaması.
if (src.includes('Önerilen L2 ekipleri') && src.includes('<optgroup')) {
  ok('19) Hedef takım select <optgroup label="Önerilen L2 ekipleri">');
} else {
  bad('19) optgroup gruplaması eksik');
}

// 20) Submit success sonrası onCreated(updated.id) ile Case Detail'e gidiş.
if (transferHandler && /onCreated\(updated\.id\)/.test(transferHandler[0])) {
  ok('20) Devret başarılı → onCreated(updated.id) ile Case Detail\'e yönlendirme');
} else {
  bad('20) Success navigation eksik');
}

// 21) Devret buton metni doğru. JSX string'inde apostrof `\'` escape edilmiş
//     olabilir; literal substring veya escape'li varyant kabul edilir.
if (/Devret ve L2(['\\]'?)?ye Gönder/.test(src)) {
  ok('21) "Devret ve L2\'ye Gönder" buton metni mevcut');
} else {
  bad('21) Submit buton metni eksik');
}

// 22) Stage 2 navigation: "L2'ye Devret" buton hala var (mode entry point).
if (src.includes("L2'ye Devret")) {
  ok('22) Stage 2 "L2\'ye Devret" buton mevcut');
} else {
  bad('22) Stage 2 transfer entry buton eksik');
}

// 23) Codex P2 fix — canSubmit transferBriefLoading koşulunu içeriyor olmalı.
//     Aksi halde brief fetch bitmeden submit edilirse attemptedStepIds boş
//     ve composedSummary fallback metniyle gönderilir → L1 context kaybı.
if (/canSubmit\s*=[\s\S]{0,200}?!transferBriefLoading/.test(src)) {
  ok('23) Codex P2 — canSubmit transferBriefLoading kilidi mevcut');
} else {
  bad('23) canSubmit transferBriefLoading guard eksik');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
