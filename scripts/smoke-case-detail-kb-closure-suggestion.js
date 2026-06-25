/**
 * smoke-case-detail-kb-closure-suggestion.js — PR-8 static guard.
 *
 * Çalıştır:
 *   node scripts/smoke-case-detail-kb-closure-suggestion.js
 *
 * Business review Madde 7 — Case Detail close akışında KB kapanış
 * önerisi (klasik vakada info-only; Smart Ticket vakada dropdown
 * pre-fill, kullanıcı onayıyla).
 *
 * Korunan invariant'lar:
 *   - KbClosureSuggestionPanel bileşeni tanımlı
 *   - handleKbSuggest: Smart Ticket caseId / klasik legacy body
 *   - handleAppendSuggestionToNote: klasik için "Çözüm Notuna Ekle"
 *   - "Cozuldu" pending iken render (Çözüm Notu Field'ının altında)
 *   - resolutionNote >= 5 char iken buton aktif
 *   - Smart Ticket pre-fill yalnız boş dropdown'lar
 *   - Klasik vakada persist YOK; sadece info-only kart
 *   - Approval / checklist guard'ları dokunulmadı
 *   - Auto-close YOK
 *   - Raw KB response UI/DB'de tutulmadı (yalnız normalized suggestions)
 *   - item.id reset effect'inde KB state'leri sıfırlanıyor
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PANEL = resolve(ROOT, 'src/features/cases/StatusTransitionPanel.tsx');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

if (!existsSync(PANEL)) { bad('StatusTransitionPanel.tsx YOK'); process.exit(1); }
const src = readFileSync(PANEL, 'utf8');

// 1) KbClosureSuggestionPanel bileşeni tanımlı.
if (/function\s+KbClosureSuggestionPanel\s*\(/.test(src)) {
  ok('1) KbClosureSuggestionPanel bileşeni tanımlı');
} else {
  bad('1) Panel bileşeni eksik');
}

// 2) State'ler ve item.id reset.
if (
  /const\s*\[kbSuggesting,\s*setKbSuggesting\]/.test(src) &&
  /const\s*\[kbSuggestion,\s*setKbSuggestion\]/.test(src) &&
  /const\s*\[kbSuggestionError,\s*setKbSuggestionError\]/.test(src)
) {
  ok('2) KB state\'leri (kbSuggesting + kbSuggestion + kbSuggestionError)');
} else {
  bad('2) KB state\'leri eksik');
}

// 3) item.id reset effect'inde KB state'leri sıfırlanıyor.
if (
  /\}, \[item\.id\]\);[\s\S]{0,3000}?setKbSuggesting\(false\)[\s\S]{0,200}?setKbSuggestion\(null\)/.test(src) ||
  /useEffect\(\(\)[\s\S]{0,1500}?setKbSuggestion\(null\)[\s\S]{0,500}?\}, \[item\.id\]\)/.test(src)
) {
  ok('3) item.id reset effect KB state\'lerini sıfırlıyor');
} else {
  bad('3) item.id reset KB state\'leri eksik');
}

// 4) handleKbSuggest fonksiyonu tanımlı.
if (/async function handleKbSuggest\(\)/.test(src)) {
  ok('4) handleKbSuggest fonksiyonu tanımlı');
} else {
  bad('4) handleKbSuggest eksik');
}

// 5) Smart Ticket: suggestSmartTicketClosure caseId tabanlı (targetCaseId
//    snapshot stale guard ile).
if (
  /isSmartTicket[\s\S]{0,400}?suggestSmartTicketClosure\(\s*\{\s*caseId:\s*(?:item\.id|targetCaseId)/.test(src)
) {
  ok('5) Smart Ticket: caseId body (opening context server-side fetch)');
} else {
  bad('5) Smart Ticket caseId body eksik');
}

// 6) Klasik: legacy body (companyId + description + resolution).
if (
  /suggestSmartTicketClosure\(\s*\{[\s\S]{0,300}?companyId:\s*item\.companyId[\s\S]{0,200}?description:\s*item\.description[\s\S]{0,200}?resolution:\s*resolutionNote\.trim\(\)/.test(src)
) {
  ok('6) Klasik: legacy body (companyId + description + resolution)');
} else {
  bad('6) Legacy body shape eksik');
}

// 7) resolutionNote.trim().length < 5 → 'En az 5 karakter' hata mesajı.
if (
  /resolutionNote\.trim\(\)\.length\s*<\s*5[\s\S]{0,200}?En az 5 karakter/.test(src)
) {
  ok('7) Çözüm notu min 5 karakter guard');
} else {
  bad('7) Min char guard eksik');
}

// 8) Smart Ticket pre-fill yalnız boş dropdown'lar (closureRcg / Rcd /
//    Rt / Pp).
if (
  /s\.rootCauseGroup\s*&&\s*!closureRcg[\s\S]{0,400}?setClosureRcg/.test(src) &&
  /s\.resolutionType\s*&&\s*!closureRt[\s\S]{0,100}?setClosureRt/.test(src) &&
  /s\.permanentPrevention\s*&&\s*!closurePp[\s\S]{0,100}?setClosurePp/.test(src)
) {
  ok('8) Smart Ticket pre-fill yalnız boş dropdown\'lar (override yok)');
} else {
  bad('8) Pre-fill override guard eksik');
}

// 9) handleAppendSuggestionToNote: persist YOK, yalnız resolutionNote'a
//    append.
if (
  /function handleAppendSuggestionToNote\(\)[\s\S]{0,800}?setResolutionNote/.test(src) &&
  !/handleAppendSuggestionToNote[\s\S]{0,800}?transitionStatus/.test(src) &&
  !/handleAppendSuggestionToNote[\s\S]{0,800}?caseRepository/.test(src)
) {
  ok('9) Append handler yalnız resolutionNote\'a yazar (persist YOK)');
} else {
  bad('9) Append handler persist içeriyor');
}

// 10) "Çözüm Notuna Ekle" buton sadece klasik vakada (!isSmartTicket) +
//     suggestionCount > 0.
if (
  /\{!isSmartTicket\s*&&\s*suggestionCount\s*>\s*0[\s\S]{0,400}?onAppendToNote/.test(src)
) {
  ok('10) "Çözüm Notuna Ekle" yalnız klasik vakada render');
} else {
  bad('10) Append buton condition eksik');
}

// 11) Smart Ticket için bilgi notu: "boş alanlar otomatik dolduruldu".
if (
  /\{isSmartTicket\s*&&\s*suggestionCount\s*>\s*0[\s\S]{0,400}?otomatik dolduruldu/.test(src)
) {
  ok('11) Smart Ticket bilgi notu (otomatik pre-fill hint)');
} else {
  bad('11) Smart Ticket hint eksik');
}

// 12) Approval / checklist / ResolutionApprovalPolicy guard'ları
//     dokunulmadı (requiredChecklistPending ve approvalState referansları
//     intact).
if (
  /requiredChecklistPending/.test(src) &&
  /approvalState/.test(src)
) {
  ok('12) Approval / checklist guard\'ları intact');
} else {
  bad('12) Approval / checklist guard\'ları dokunulmuş');
}

// 13) Auto-close YOK: handleKbSuggest içinde transitionStatus çağrısı
//     OLMAMALI.
const handlerBlock = src.match(/async function handleKbSuggest[\s\S]+?\n  \}/);
if (handlerBlock && !/transitionStatus/.test(handlerBlock[0])) {
  ok('13) handleKbSuggest auto-close ÇAĞRISI YOK');
} else if (!handlerBlock) {
  bad('13) handleKbSuggest match edilemedi');
} else {
  bad('13) handleKbSuggest transitionStatus çağırıyor (yanlış)');
}

// 14) Raw KB response UI'da YOK — yalnız normalized `suggestions` +
//     `unmatched` + `meta` field'ları render ediliyor.
//     "_raw" veya "rawResponse" alanları kullanılmamalı.
if (
  !/_raw|rawResponse|kbResponse\.data/.test(src)
) {
  ok('14) Raw KB response UI\'da YOK (yalnız normalized field\'lar)');
} else {
  bad('14) Raw KB referansı tespit edildi');
}

// 15) Persist YOK (klasik vakada): handleAppendSuggestionToNote
//     transitionStatus / caseRepository çağrısı yapmıyor (smoke #9 ile
//     simetrik kontrol). Ayrıca KbClosureSuggestionPanel component'i
//     içinde de persist çağrısı yok.
const panelComponentBlock = src.match(/function KbClosureSuggestionPanel[\s\S]+?^\}/m);
if (
  panelComponentBlock &&
  !/transitionStatus|caseRepository\./.test(panelComponentBlock[0])
) {
  ok('15) KbClosureSuggestionPanel persist YOK (sadece görüntüleme + onAppend callback)');
} else {
  bad('15) Panel component persist içeriyor');
}

// ─── Codex P2 fixes (PR #469 review) ─────────────────────────────

// 16) Kapanış decouple — rootCauseDetail artık grup değişiminde sıfırlanmaz.
//     Eski reset useEffect + closureRcdResetSuppressRef KALDIRILDI ve detay
//     listesi flat (closureTax.rootCauseDetail) okunur.
if (
  !/closureRcdResetSuppressRef/.test(src) &&
  /closureRcdList[^\n]*=\s*closureTax\?\.rootCauseDetail/.test(src)
) {
  ok('16) Kapanış decouple — rcd flat + reset suppress ref kaldırıldı');
} else {
  bad('16) decouple — suppress ref hâlâ var ya da rcd flat değil');
}

// 17) Codex P2 — KB stale promise guard: kbSuggestReqIdRef snapshot
//     ve case değişimi kontrolü.
if (
  /kbSuggestReqIdRef\s*=\s*useRef\(0\)/.test(src) &&
  /reqId\s*!==\s*kbSuggestReqIdRef\.current\s*\|\|\s*item\.id\s*!==\s*targetCaseId/.test(src)
) {
  ok('17) Codex P2 — KB stale promise guard (reqId + targetCaseId)');
} else {
  bad('17) Stale guard pattern eksik');
}

// ─── resolutionOverride bağlam bug fix + kapanış telemetry ───────

// 18) resolutionOverride bug fix — Smart Ticket suggest çağrısı operatörün
//     YAZDIĞI resolutionNote'u resolutionOverride olarak gönderir. Eski hâl
//     yalnız { caseId } gönderiyordu → backend solution-step'lerden compose
//     ediyor, operatörün gerçek çözüm metni AI'ya ulaşmıyordu (accuracy bug).
if (
  /isSmartTicket[\s\S]{0,600}?suggestSmartTicketClosure\(\s*\{[\s\S]{0,200}?resolutionOverride:\s*resolutionNote\.trim\(\)/.test(src)
) {
  ok('18) Smart Ticket suggest resolutionOverride gönderiyor (bağlam bug fix)');
} else {
  bad('18) resolutionOverride gönderilmiyor (bağlam bug fix eksik)');
}

// 19) Empty override gönderilmez — resolutionOverride yalnız ≥5 char guard'dan
//     sonra set ediliyor (handleKbSuggest başındaki <5 erken return korunmuş).
if (/resolutionNote\.trim\(\)\.length\s*<\s*5[\s\S]{0,200}?return;/.test(src)) {
  ok('19) Empty override koruması (handleKbSuggest <5 char erken return intact)');
} else {
  bad('19) <5 char guard kaldırılmış (empty override riski)');
}

// 20) Kapanış telemetry — ai_suggested / human_applied attribution. Submit'te
//     closureSuggestion meta buildClosureSuggestionTelemetry ile kurulur.
if (
  src.includes('buildClosureSuggestionTelemetry(') &&
  /\.closureSuggestion\s*=\s*buildClosureSuggestionTelemetry/.test(src)
) {
  ok('20) Kapanış telemetry (ai_suggested / human_applied) persist ediliyor');
} else {
  bad('20) closure telemetry (buildClosureSuggestionTelemetry) eksik');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
