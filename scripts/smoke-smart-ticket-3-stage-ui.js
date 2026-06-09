/**
 * smoke-smart-ticket-3-stage-ui.js — Smart Ticket Primary UX (3-stage).
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-3-stage-ui.js
 *
 * Pure static guard. SmartTicketNewPage.tsx üzerinde grep tabanlı
 * invariant testleri yapar — DB veya HTTP gerektirmez.
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

// 1) Stage state machine mevcut.
if (/type\s+Stage\s*=\s*['"]opening['"]\s*\|\s*['"]solution['"]\s*\|\s*['"]closure['"]\s*\|\s*['"]transfer['"]/.test(src)) {
  ok('1) Stage type union tanımlı (opening | solution | closure | transfer)');
} else {
  bad('1) Stage type union eksik');
}

// 2) Stage state useState mevcut.
if (/useState<Stage>\(['"]opening['"]\)/.test(src) || /setStage\(/.test(src)) {
  ok('2) Stage state machine kullanılıyor');
} else {
  bad('2) stage state eksik');
}

// 3) 2-column layout: lg:grid-cols-3 + lg:col-span-1 + lg:col-span-2.
if (
  src.includes('lg:grid-cols-3') &&
  src.includes('lg:col-span-1') &&
  src.includes('lg:col-span-2')
) {
  ok('3) 2-column layout (1/3 sol + 2/3 sağ)');
} else {
  bad('3) 2-column grid layout eksik');
}

// 4) TEK user-facing analiz aksiyonu — "KB ile Analiz Et" buton var,
//    "AI Önerilen Adımlar Al" buton YOK.
if (src.includes('KB ile Analiz Et')) {
  ok('4) "KB ile Analiz Et" tek analiz aksiyonu');
} else {
  bad('4) "KB ile Analiz Et" eksik');
}
if (!src.includes('AI Önerilen Adımlar Al')) {
  ok('4b) "AI Önerilen Adımlar Al" buton YOK (SmartTicketNewPage\'de iki ayrı aksiyon değil)');
} else {
  bad('4b) "AI Önerilen Adımlar Al" buton hala var');
}

// 5) Eski "KB ile Sınıflandır" buton YOK (eski Phase 2b label\'ı).
if (!src.includes('KB ile Sınıflandır')) {
  ok('5) Eski "KB ile Sınıflandır" label kaldırıldı (yeni: "KB ile Analiz Et")');
} else {
  bad('5) eski "KB ile Sınıflandır" label hala var');
}

// 6) Stage 1 → 2 transition button: "Vaka Oluştur ve Çözüm Adımlarına Geç".
if (src.includes('Vaka Oluştur ve Çözüm Adımlarına Geç')) {
  ok('6) Stage 1→2 transition buton label spec\'le uyumlu');
} else {
  bad('6) transition buton label eksik');
}

// 7) Case create sonrası onCreated otomatik çağrılmıyor — kullanıcı stage 2\'de
//    kalır. handleCreateAndContinue içinde onCreated yok; ya da sadece secondary
//    escape (Vaka Detayına Git / closure success).
const createHandler = src.match(/async function handleCreateAndContinue[\s\S]*?\n  \}/);
if (createHandler && !createHandler[0].includes('onCreated(')) {
  ok('7) handleCreateAndContinue otomatik onCreated çağırmıyor (kullanıcı ekranda kalır)');
} else if (!createHandler) {
  bad('7) handleCreateAndContinue function bulunamadı');
} else {
  bad('7) handleCreateAndContinue içinde onCreated otomatik çağrılıyor');
}

// 8) Closure: transitionStatus 'Çözüldü' + smartTicketClosure payload.
if (
  src.includes("transitionStatus(createdCase.id, 'Çözüldü'") &&
  src.includes('smartTicketClosure')
) {
  ok('8) Stage 3 closure → transitionStatus + smartTicketClosure (PR-1e flow reuse)');
} else {
  bad('8) closure transitionStatus + smartTicketClosure eksik');
}

// 9) Stage 3 closure form alanları: rcg / rcd / rt / pp + resolutionNote.
const closureFields = [
  'Kök Neden Grubu',
  'Kök Neden Detayı',
  'Çözüm Tipi',
  'Kalıcı Önlem',
  'Çözüm Açıklaması',
];
const missing = closureFields.filter((f) => !src.includes(f));
if (missing.length === 0) {
  ok('9) Stage 3 closure 5 alan mevcut (rcg/rcd/rt/pp + resolution note)');
} else {
  bad('9) closure alanları eksik', missing.join(' / '));
}

// 10) "Çözüm Adımlarına Geri Dön" buton (Stage 3 → Stage 2).
if (src.includes('Çözüm Adımlarına Geri Dön')) {
  ok('10) "Çözüm Adımlarına Geri Dön" buton mevcut');
} else {
  bad('10) Stage 3 → 2 geri dön buton eksik');
}

// 11) Stage 2 navigation: Kapanışa Geç / L2'ye Devret / Vaka Detayına Git.
if (
  src.includes('Kapanışa Geç') &&
  src.includes("L2'ye Devret") &&
  src.includes('Vaka Detayına Git')
) {
  ok('11) Stage 2 navigation: 3 buton (Kapanış / L2 / Detay)');
} else {
  bad('11) stage 2 navigation eksik');
}

// 12) CaseSolutionStepsPanel reuse (duplicate panel yok).
if (
  src.includes("import { CaseSolutionStepsPanel }") &&
  src.includes('<CaseSolutionStepsPanel')
) {
  ok('12) CaseSolutionStepsPanel reuse — duplicate panel yok');
} else {
  bad('12) CaseSolutionStepsPanel reuse eksik');
}

// 13) importAiSuggestedSolutionSteps çağrısı (Case create sonrası).
if (src.includes('importAiSuggestedSolutionSteps(')) {
  ok('13) Case create sonrası importAiSuggestedSolutionSteps çağrılıyor');
} else {
  bad('13) importAiSuggestedSolutionSteps çağrısı yok');
}

// 14) suggestSmartTicketClassification çağrısı (classification analysis).
if (src.includes('suggestSmartTicketClassification(')) {
  ok('14) "KB ile Analiz Et" → suggestSmartTicketClassification çağrılıyor');
} else {
  bad('14) suggestSmartTicketClassification çağrısı yok');
}

// 15) Auto-close YOK — solution-step status setSolutionStepStatus
//     SmartTicketNewPage'den direkt çağrılmıyor (panel kendi yapıyor),
//     ama transitionStatus 'Çözüldü' kullanıcı confirm olmadan çağrılmaz.
//     handleCloseCase'in dışında 'Çözüldü' transitionStatus çağrısı YOK.
const closeCalls = (src.match(/transitionStatus[\s\S]*?'Çözüldü'/g) ?? []).length;
if (closeCalls === 1) {
  ok('15) Auto-close YOK — transitionStatus(\'Çözüldü\') yalnız handleCloseCase\'de (kullanıcı tıklamadıkça)');
} else {
  bad('15) close call count', `${closeCalls} (1 bekleniyor — handleCloseCase)`);
}

// 16) Auto-transfer YOK — caseService.transfer yahut benzeri çağrı YOK.
if (!/caseService\.transfer\(|transferToTeam\(/.test(src)) {
  ok('16) Auto-transfer YOK — caseService.transfer çağrısı SmartTicketNewPage\'de yok');
} else {
  bad('16) auto-transfer çağrısı bulundu');
}

// 17) Yasaklı KB section\'lar Stage 2'de render edilmiyor — panel zaten
//     ignore ediyor, sayfada bunlar referans bile edilmemeli.
const FORBIDDEN = [
  'Kök Neden Hipotezleri',
  'Müşteriye Yanıt Taslağı',
  'Mühendis Aktarımı',
  'Benzer Kayıtlar',
  'Ham Yanıtlar',
];
const leaked = FORBIDDEN.filter((l) => src.includes(l));
if (leaked.length === 0) {
  ok('17) Yasaklı KB section\'lar SmartTicketNewPage\'de YOK');
} else {
  bad('17) forbidden labels leaked', leaked.join(', '));
}

// 18) Stage 3 L2 transfer placeholder mevcut (gap raporu).
if (src.includes('Stage3TransferPlaceholder') || src.includes('L2 devir formu bu sürümde')) {
  ok('18) Stage 3 L2 transfer placeholder mevcut (PR scope: gap raporlandı)');
} else {
  bad('18) L2 placeholder eksik');
}

// 19) Codex PR-2c P1 fix — checklist gating Stage 3 closure'da uygulanıyor.
//     StatusTransitionPanel ile aynı koruma: requiredChecklistPending varken
//     "Vakayı Kapat" disabled olur ve banner gösterilir.
if (
  src.includes('requiredChecklistPending') &&
  /checklistItems\s*\?\?\s*\[\]/.test(src) &&
  /it\.required\s*&&\s*!it\.checked/.test(src)
) {
  ok('19) Checklist gating: requiredChecklistPending hesaplanıyor (StatusTransitionPanel pattern)');
} else {
  bad('19) checklist gating compute eksik');
}

// 20) canSave checklistBlocked kontrolü ile gating.
if (/checklistBlocked\s*=\s*requiredChecklistPending\.length\s*>\s*0/.test(src) && /!checklistBlocked/.test(src)) {
  ok('20) canSave checklistBlocked koşulu ile gate\'li (Vakayı Kapat disabled)');
} else {
  bad('20) canSave checklist gating eksik');
}

// 21) handleCloseCase içinde defense-in-depth: requiredChecklistPending > 0
//     ise erken return (kullanıcı disabled buton'u nasılsa tıklasa bile).
if (/requiredChecklistPending\.length\s*>\s*0[\s\S]{0,200}?setClosureError/.test(src)) {
  ok('21) handleCloseCase defense-in-depth: checklist pending varken transitionStatus çağrılmaz');
} else {
  bad('21) handleCloseCase checklist guard eksik');
}

// 22-24) WR-KB-Closure-Auto — Stage 3 auto-fetch + persist meta.

// 22) Stage 3 useEffect ile auto-fetch (stage === 'closure' → handleSuggestClosure).
if (
  /useEffect\(\(\)\s*=>\s*\{[\s\S]*?stage\s*!==\s*['"]closure['"][\s\S]*?handleSuggestClosure\(\)/.test(src)
) {
  ok('22) Stage 3 auto-fetch useEffect mevcut (stage===closure → handleSuggestClosure)');
} else {
  bad('22) Stage 3 auto-fetch effect eksik');
}

// 23) Service çağrısı caseId tabanlı (yeni body shape).
if (/suggestSmartTicketClosure\(\s*\{\s*[\s\S]*?caseId:\s*createdCase\.id/.test(src)) {
  ok('23) suggestSmartTicketClosure caseId tabanlı çağrılıyor');
} else {
  bad('23) caseId-based call eksik');
}

// 24) Closure persist: closurePayload.closureSuggestion + selectedWorkedStepId.
if (
  src.includes('closurePayload.closureSuggestion') ||
  /closureSuggestion:\s*\{[\s\S]*?source:\s*['"]external_kb['"]/.test(src)
) {
  ok('24) Closure persist payload\'a closureSuggestion meta eklendi');
} else {
  bad('24) closureSuggestion persist eksik');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
