/**
 * smoke-smart-ticket-solution-steps-ui.js — WR-Smart-Ticket Phase 2c.
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-solution-steps-ui.js
 *
 * Pure static guard. CaseSolutionStepsPanel.tsx ve CaseDetailPage.tsx
 * üzerinde grep tabanlı invariant testleri yapar — DB veya HTTP
 * gerektirmez. UI sözleşmesini garanti altına alır:
 *
 *   1.  CaseSolutionStepsPanel dosyası mevcut
 *   2.  3 outcome action UI'da yer alır (İşe yaradı, İşe yaramadı, Uygun değil)
 *   3.  "Denedim" butonu UI'da YOKTUR (Phase 2c business kararı)
 *   4.  Outcome → status mapping doğru
 *       (worked / not_worked / skipped — backend whitelist'ine uyumlu)
 *   5.  AI import button mevcut + caseService.importAiSuggestedSolutionSteps
 *       çağırıyor
 *   6.  Manuel adım formu createSolutionStep çağırıyor
 *   7.  Status update setSolutionStepStatus çağırıyor
 *   8.  Smart Ticket gating CaseDetailPage'de mevcut (item.customFields.smartTicket)
 *   9.  Panel L1CaseResolutionConsole'a EKLENMEDİ (PR scope: yalnız klasik
 *       CaseDetailPage)
 *  10.  Auto-close / auto-transfer kodu YOK (transitionStatus veya transfer
 *       çağrısı panel içinde aranır)
 *  11.  Raw KB / root cause / customer reply / handoff / similar render YOK
 *  12.  Empty / loading / error state mesajları mevcut (helper copy spec'i)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const PANEL_PATH = resolve(PROJECT_ROOT, 'src/features/cases/CaseSolutionStepsPanel.tsx');
const DETAIL_PATH = resolve(PROJECT_ROOT, 'src/features/cases/CaseDetailPage.tsx');
const L1_PATH = resolve(PROJECT_ROOT, 'src/features/cases/L1CaseResolutionConsole.tsx');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

// 1) Panel dosyası mevcut.
if (existsSync(PANEL_PATH)) ok('1) CaseSolutionStepsPanel.tsx mevcut');
else { bad('1) panel dosyası yok'); process.exit(1); }

const panelSrc = readFileSync(PANEL_PATH, 'utf8');
const detailSrc = readFileSync(DETAIL_PATH, 'utf8');

// 2) 3 outcome action — exact label match.
const has = (text, needle) => text.includes(needle);
if (has(panelSrc, 'İşe yaradı') && has(panelSrc, 'İşe yaramadı') && has(panelSrc, 'Uygun değil')) {
  ok('2) 3 outcome action UI\'da yer alır');
} else {
  bad('2) outcome action eksik');
}

// 3) "Denedim" butonu YOK — Button label seviyesinde.
// (Backend hala 'tried' status'unu destekler; UI'da kullanıcıya gösterilmiyor.)
// Sadece kullanıcıya görünen Button JSX literal'inde aranır.
const buttonLiterals = [...panelSrc.matchAll(/<Button[\s\S]*?>([\s\S]*?)<\/Button>/g)].map((m) =>
  m[1].replace(/\s+/g, ' ').trim(),
);
const deniedimAsButton = buttonLiterals.some((b) => /Denedim/i.test(b));
if (!deniedimAsButton) ok('3) "Denedim" UI butonu YOK (business kararı)');
else bad('3) Denedim butonu UI\'da bulundu', buttonLiterals.find((b) => /Denedim/i.test(b)) ?? '');

// 4) Outcome → status mapping doğru.
const mappingChecks = [
  // worked: "İşe yaradı" intent → setSolutionStepStatus(... 'worked' ...)
  { needle: /['"]worked['"]/, label: '4a) worked status kullanılıyor' },
  { needle: /['"]not_worked['"]/, label: '4b) not_worked status kullanılıyor' },
  { needle: /['"]skipped['"]/, label: '4c) skipped status kullanılıyor' },
];
for (const c of mappingChecks) {
  if (c.needle.test(panelSrc)) ok(c.label);
  else bad(c.label);
}

// 5) AI import wrapper kullanılıyor.
if (panelSrc.includes('importAiSuggestedSolutionSteps(')) {
  ok('5) AI import button → importAiSuggestedSolutionSteps wrapper');
} else {
  bad('5) importAiSuggestedSolutionSteps çağrısı yok');
}
if (has(panelSrc, 'AI Önerilen Adımlar Al')) ok('5b) AI button label "AI Önerilen Adımlar Al"');
else bad('5b) AI button label eksik');

// 6) Manuel adım createSolutionStep çağırıyor.
if (panelSrc.includes('createSolutionStep(')) ok('6) Manuel adım → createSolutionStep wrapper');
else bad('6) createSolutionStep çağrısı yok');
if (has(panelSrc, 'Manuel Adım Ekle')) ok('6b) Manuel button label mevcut');
else bad('6b) manuel button label eksik');

// 7) Status update setSolutionStepStatus çağırıyor.
if (panelSrc.includes('setSolutionStepStatus(')) ok('7) Outcome → setSolutionStepStatus wrapper');
else bad('7) setSolutionStepStatus çağrısı yok');

// 8) Smart Ticket gating CaseDetailPage'de.
if (
  detailSrc.includes('isSmartTicket') &&
  detailSrc.includes('customFields') &&
  detailSrc.includes('smartTicket') &&
  detailSrc.includes('<CaseSolutionStepsPanel')
) {
  ok('8) Smart Ticket gating CaseDetailPage\'de + panel mount');
} else {
  bad('8) Smart Ticket gating veya panel mount eksik');
}

// 9) L1CaseResolutionConsole dokunulmadı (panel orada YOK).
if (existsSync(L1_PATH)) {
  const l1Src = readFileSync(L1_PATH, 'utf8');
  if (!l1Src.includes('CaseSolutionStepsPanel')) {
    ok('9) L1CaseResolutionConsole\'da panel YOK (PR scope korundu)');
  } else {
    bad('9) L1Console\'a panel sızdı');
  }
} else {
  ok('9) L1CaseResolutionConsole dosyası yok (SKIP-as-pass)');
}

// 10) Auto-close / auto-transfer kodu YOK.
// transitionStatus ve transferTo gibi otomatik mutator'ları panel içinde aramamalıyız.
if (!panelSrc.includes('transitionStatus(') && !panelSrc.includes('transferTo(')) {
  ok('10) Panel auto-close veya auto-transfer YAPMIYOR');
} else {
  bad('10) Auto-close/transfer kodu panel içinde bulundu');
}

// 11) Yasaklı raw KB / root cause / customer reply / handoff / similar UI YOK.
const FORBIDDEN_LABELS = [
  'Kök Neden Hipotezleri',
  'Müşteriye Yanıt Taslağı',
  'Mühendis Aktarımı',
  'Benzer Kayıtlar',
  'Ham Yanıtlar',
];
const leaked = FORBIDDEN_LABELS.filter((l) => panelSrc.includes(l));
if (leaked.length === 0) {
  ok('11) Yasaklı bölüm label\'ları panelde YOK (root cause/customer reply/handoff/similar/raw)');
} else {
  bad('11) Forbidden labels leaked', leaked.join(', '));
}

// 12) Empty / loading / error mesajları mevcut.
const emptyMsg = 'Henüz çözüm adımı yok';
const loadingMsg = 'yükleniyor';
if (panelSrc.toLowerCase().includes(emptyMsg.toLowerCase())) ok('12a) Empty state mesajı mevcut');
else bad('12a) empty state mesajı eksik');
if (panelSrc.toLowerCase().includes(loadingMsg)) ok('12b) Loading mesajı mevcut');
else bad('12b) loading mesajı eksik');

// 13) Helper copy panel başlığı + alt yazı.
if (panelSrc.includes('Çözüm Adımları') && panelSrc.includes('Müşteriye denenen')) {
  ok('13) Panel başlığı + helper copy spec\'iyle eşleşiyor');
} else {
  bad('13) panel başlığı/helper copy eksik');
}

// 14) İnline yorum kutusu label'ları (worked + not_worked spec).
const commentLabels = ['Bu adım nasıl çözdü?', 'Ne denendi, neden işe yaramadı?'];
const okLabels = commentLabels.every((l) => panelSrc.includes(l));
if (okLabels) ok('14) İnline yorum kutusu label\'ları spec\'le uyumlu');
else bad('14) comment label eksik', commentLabels.filter((l) => !panelSrc.includes(l)).join(' / '));

// 15-18) Codex PR-2c P2 fix — stale async response guard invariant'ları.

// 15) reqIdRef + caseIdRef useRef'leri mevcut.
if (panelSrc.includes('reqIdRef') && panelSrc.includes('caseIdRef') && panelSrc.includes('useRef')) {
  ok('15) Stale guard ref\'leri (reqIdRef, caseIdRef) tanımlı');
} else {
  bad('15) stale guard ref\'leri eksik');
}

// 16) refresh() içinde reqId snapshot + setState öncesi token kontrolü.
//     Pattern: `const reqId = ++reqIdRef.current;` + `if (reqId !== reqIdRef.current ... ) return;`
const hasReqSnapshot = /const\s+reqId\s*=\s*\+\+reqIdRef\.current/.test(panelSrc);
const hasStaleSkip = /reqId\s*!==\s*reqIdRef\.current/.test(panelSrc);
if (hasReqSnapshot && hasStaleSkip) {
  ok('16) refresh() reqId snapshot + stale skip pattern mevcut');
} else {
  bad('16) refresh stale guard pattern eksik');
}

// 17) item.id useEffect'i case değişiminde state'i sıfırlıyor + ref bumple.
//     Aramada: useEffect closure'ında setSteps([]) + reqIdRef.current += 1 + caseIdRef.current = item.id.
const idEffectRegion = panelSrc.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[item\.id\]\)/g) ?? [];
const resetRegionOk = idEffectRegion.some(
  (block) =>
    block.includes('setSteps([])') &&
    block.includes('caseIdRef.current = item.id') &&
    block.includes('reqIdRef.current += 1'),
);
if (resetRegionOk) {
  ok('17) item.id değişiminde steps clear + ref bumple + caseIdRef update');
} else {
  bad('17) item.id reset pattern eksik');
}

// 18) Mutation handler'ları (handleImportAi / handleAddManual / saveOutcome)
//     targetCaseId snapshot ile caseIdRef.current karşılaştırması yapıyor.
const handlerCount = (panelSrc.match(/const\s+targetCaseId\s*=\s*item\.id/g) ?? []).length;
const compareCount = (panelSrc.match(/caseIdRef\.current\s*!==\s*targetCaseId/g) ?? []).length;
if (handlerCount >= 3 && compareCount >= 3) {
  ok(`18) Mutation handler'ları stale guard'lı (targetCaseId snapshot=${handlerCount}, compare=${compareCount})`);
} else {
  bad('18) handler stale guard eksik', `snapshot=${handlerCount}, compare=${compareCount}`);
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
