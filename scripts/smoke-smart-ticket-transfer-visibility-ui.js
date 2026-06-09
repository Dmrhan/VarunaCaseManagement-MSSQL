/**
 * smoke-smart-ticket-transfer-visibility-ui.js — PR-T3 static guard.
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-transfer-visibility-ui.js
 *
 * CaseSolutionStepsPanel + CaseDetailPage ActivityTab üzerindeki PR-T3
 * davranışını grep tabanlı korur. DB veya HTTP gerektirmez.
 *
 * Korunan invariant'lar:
 *   - L1 Devir Özeti kartı yalnız customFields.smartTicket.transferContext
 *     varken render edilir (koşullu, regressyon olmaz)
 *   - Klasik vakalar etkilenmez (kart null döner)
 *   - Ek API/fetch yok — kart sadece item prop'undan veri okur
 *   - Activity Transfer note whitespace-pre-wrap
 *   - Activity default render generic h.note (Smart Ticket açılış suffix)
 *   - Mevcut Çözüm Adımları panel davranışı korundu
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const PANEL = resolve(PROJECT_ROOT, 'src/features/cases/CaseSolutionStepsPanel.tsx');
const PAGE = resolve(PROJECT_ROOT, 'src/features/cases/CaseDetailPage.tsx');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

if (!existsSync(PANEL)) { bad('CaseSolutionStepsPanel.tsx YOK'); process.exit(1); }
if (!existsSync(PAGE)) { bad('CaseDetailPage.tsx YOK'); process.exit(1); }
const panel = readFileSync(PANEL, 'utf8');
const page = readFileSync(PAGE, 'utf8');

// 1) L1TransferSummaryCard bileşeni tanımlı.
if (/function\s+L1TransferSummaryCard\s*\(/.test(panel)) {
  ok('1) L1TransferSummaryCard bileşeni tanımlı');
} else {
  bad('1) L1TransferSummaryCard tanımı eksik');
}

// 2) Kart customFields.smartTicket.transferContext üzerinden veri okuyor.
if (/transferContext/.test(panel) && /smartTicket/.test(panel)) {
  ok('2) Kart customFields.smartTicket.transferContext\'i okuyor');
} else {
  bad('2) transferContext okuma eksik');
}

// 3) Koşullu render — context yoksa null döner.
if (/readTransferContext\(item\)/.test(panel) && /if\s*\(!ctx\)\s*return\s+null/.test(panel)) {
  ok('3) Kart koşullu render — context yoksa null (klasik vakalar etkilenmez)');
} else {
  bad('3) Koşullu render guard eksik');
}

// 4) Panel return'ünde <L1TransferSummaryCard item={item} /> mount edilmiş.
if (/<L1TransferSummaryCard\s+item=\{item\}\s*\/>/.test(panel)) {
  ok('4) Panel return\'ünde L1TransferSummaryCard mount edildi');
} else {
  bad('4) Card mount edilmedi');
}

// 5) Ek API/fetch YOK — kart hiçbir caseService çağrısı yapmıyor.
const cardMatch = panel.match(/function L1TransferSummaryCard[\s\S]*?\n\}/);
if (cardMatch && !/caseService\.|lookupService\.|fetch\(/.test(cardMatch[0])) {
  ok('5) Kart ek API çağrısı yapmıyor (yalnız item prop\'undan veri)');
} else if (!cardMatch) {
  bad('5) L1TransferSummaryCard match edilemedi');
} else {
  bad('5) Kart içinde API çağrısı bulundu');
}

// 6) Hard-code tenant/team adı yok.
const BANNED = ['"Univera L2"', "'Univera L2'", '"UNIVERA"', "'UNIVERA'"];
const leaked = BANNED.filter((s) => panel.includes(s));
if (leaked.length === 0) {
  ok('6) Hard-code tenant/team adı yok');
} else {
  bad('6) Hard-code literal sızdı', leaked.join(', '));
}

// 7) Multi-line render: pre-wrap transferNote + composedSummary alanlarında.
const preWrapMatches = (panel.match(/whitespace-pre-wrap/g) ?? []).length;
if (preWrapMatches >= 2) {
  ok('7) pre-wrap class transferNote + composedSummary için kullanılıyor', `count=${preWrapMatches}`);
} else {
  bad('7) pre-wrap eksik', `count=${preWrapMatches}`);
}

// 8) Outcome badge'leri (worked/notWorked/skipped/pending) render.
const BADGES = ['İşe yaradı', 'İşe yaramadı', 'Uygun değil', 'Beklemede'];
const missingBadges = BADGES.filter((b) => !panel.includes(b));
if (missingBadges.length === 0) {
  ok('8) Outcome badge\'leri (4 status) kartta render');
} else {
  bad('8) Outcome badge\'leri eksik', missingBadges.join(', '));
}

// 9) openingTaxonomySnapshot 5 alanı chip olarak göster.
const SNAP_FIELDS = ['platformLabel', 'businessProcessLabel', 'operationTypeLabel', 'affectedObjectLabel', 'impactLabel'];
const missingSnap = SNAP_FIELDS.filter((f) => !panel.includes(f));
if (missingSnap.length === 0) {
  ok('9) openingTaxonomySnapshot 5 alan label kartta');
} else {
  bad('9) snapshot label\'lar eksik', missingSnap.join(', '));
}

// 10) Mevcut Çözüm Adımları panel davranışı korundu — başlık + AI buton + manuel form.
if (
  panel.includes('Çözüm Adımları') &&
  panel.includes('AI Önerilen Adımlar Al') &&
  panel.includes('Manuel Adım Ekle')
) {
  ok('10) Mevcut Çözüm Adımları panel davranışı korundu');
} else {
  bad('10) Panel başlık/butonlar eksik');
}

// ─── CaseDetailPage ActivityTab ──────────────────────────────────

// 11) Transfer note whitespace-pre-wrap eklendi.
//     Mevcut Transfer block içinde "blue-800" + whitespace-pre-wrap birlikte
//     görünür.
if (/whitespace-pre-wrap[\s\S]{0,80}?text-blue-800|text-blue-800[\s\S]{0,80}?whitespace-pre-wrap/.test(page)) {
  ok('11) Activity Transfer note whitespace-pre-wrap');
} else {
  bad('11) Transfer note pre-wrap eksik');
}

// 12) Default render'da generic h.note (Smart Ticket açılış suffix vs.)
//     görünür. CaseCreated için özel branch yok — note alanı default
//     fallback'te render ediliyor.
const PR_T3_MARKER = 'PR-T3 — generic note render';
if (page.includes(PR_T3_MARKER) && /h\.note &&[\s\S]{0,200}?whitespace-pre-wrap/.test(page)) {
  ok('12) Default render h.note generic (Smart Ticket açılış suffix görünür)');
} else {
  bad('12) Generic note render eksik');
}

// 13) Schema migration YOK — ne CaseDetailPage ne panel'de prisma/schema değişikliği.
if (!/prisma\.|@@unique|migration\.sql/.test(panel + page)) {
  ok('13) Schema migration referansı yok (UI-only PR)');
} else {
  bad('13) Schema referansı sızdı');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
