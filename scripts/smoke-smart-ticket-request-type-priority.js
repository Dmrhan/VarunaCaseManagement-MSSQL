/**
 * smoke-smart-ticket-request-type-priority.js — PR-3 static guard.
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-request-type-priority.js
 *
 * Business review Madde 3 — Stage 1'de Talep Türü + Öncelik alanları.
 *
 * Korunan invariant'lar:
 *   - Form state'e requestType + priority + priorityManual eklendi
 *   - emptyForm default'ları: priority='Medium', priorityManual=false,
 *     requestType='' (boş = mapping derive eder)
 *   - Stage 1 Talep Türü Select + Öncelik Select render edildi
 *   - "Otomatik" option requestType için (kullanıcı seçmedi durumu)
 *   - CASE_REQUEST_TYPES + CASE_PRIORITIES reuse (yeni enum yok)
 *   - handleCreateAndContinue override mantığı:
 *       finalRequestType = form.requestType || mapping.requestType
 *       finalPriority = priorityManual ? form.priority : 'Medium'
 *   - Payload Case.create'e finalPriority + finalRequestType geçer
 *   - customFields.smartTicket.requestTypeSource + prioritySource yazılır
 *   - Mapping derive davranışı korundu (mapping.ts dokunulmadı)
 *   - Mevcut transfer priority + closure resolutionNote akışı bozulmadı
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = resolve(ROOT, 'src/features/smart-ticket/SmartTicketNewPage.tsx');
const MAP = resolve(ROOT, 'src/features/smart-ticket/mapping.ts');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

if (!existsSync(PAGE)) { bad('SmartTicketNewPage.tsx YOK'); process.exit(1); }
if (!existsSync(MAP)) { bad('mapping.ts YOK'); process.exit(1); }
const page = readFileSync(PAGE, 'utf8');
const mapping = readFileSync(MAP, 'utf8');

// 1) Form state genişletildi.
if (
  /priority:\s*CasePriority;[\s\S]{0,200}?priorityManual:\s*boolean;[\s\S]{0,200}?requestType:\s*CaseRequestType\s*\|\s*''/.test(page)
) {
  ok('1) SmartTicketFormState: priority + priorityManual + requestType eklendi');
} else {
  bad('1) Form state genişletme eksik');
}

// 2) emptyForm default'ları doğru.
if (
  /priority:\s*['"]Medium['"][\s\S]{0,200}?priorityManual:\s*false[\s\S]{0,200}?requestType:\s*['"]['"]/.test(page)
) {
  ok('2) emptyForm defaults: Medium + false + \'\' (mapping derive olur)');
} else {
  bad('2) emptyForm defaults yanlış');
}

// 3) Talep Türü Select render edildi + "Otomatik" option.
if (
  /<Field\s+label="Talep Türü"[\s\S]{0,1500}?<Select[\s\S]{0,500}?— Otomatik —/.test(page) &&
  /CASE_REQUEST_TYPES\.map/.test(page)
) {
  ok('3) Talep Türü Select + "— Otomatik —" + CASE_REQUEST_TYPES.map');
} else {
  bad('3) Talep Türü field render eksik');
}

// 4) Öncelik Select render edildi.
if (
  /<Field\s+label="Öncelik"[\s\S]{0,1500}?<Select[\s\S]{0,500}?CASE_PRIORITIES\.map[\s\S]{0,300}?CASE_PRIORITY_LABELS/.test(page)
) {
  ok('4) Öncelik Select + CASE_PRIORITIES.map + label reuse');
} else {
  bad('4) Öncelik field render eksik');
}

// 5) Priority change manual flag set ediyor.
if (/priorityManual:\s*true/.test(page)) {
  ok('5) Priority onChange priorityManual=true (kullanıcı override işareti)');
} else {
  bad('5) priorityManual=true flag eksik');
}

// 6) Override mantığı handleCreateAndContinue içinde.
if (
  /finalRequestType\s*=\s*form\.requestType\s*\|\|\s*mapping\.requestType/.test(page) &&
  /finalPriority[\s\S]{0,80}?form\.priorityManual\s*\?\s*form\.priority\s*:\s*['"]Medium['"]/.test(page)
) {
  ok('6) Override mantığı: user > mapping > fallback (Medium)');
} else {
  bad('6) Override mantığı eksik');
}

// 7) Source meta customFields.smartTicket'a yazılıyor.
if (
  /smartTicket\.requestTypeSource\s*=\s*requestTypeSource/.test(page) &&
  /smartTicket\.prioritySource\s*=\s*prioritySource/.test(page)
) {
  ok('7) customFields.smartTicket.requestTypeSource + prioritySource yazılıyor');
} else {
  bad('7) Source meta yazımı eksik');
}

// 8) Payload Case.create'e finalPriority + finalRequestType geçer
//    (hard-code 'Medium' ve mapping.requestType eski paylaşımı KALDIRILMIŞ
//    olmalı — yalnız transfer formundaki "Medium" string'i kalabilir).
const createCallBlock = page.match(/caseService\.create\([\s\S]{0,1500}?customFields:\s*\{\s*smartTicket\s*\}/);
if (
  createCallBlock &&
  /priority:\s*finalPriority/.test(createCallBlock[0]) &&
  /requestType:\s*finalRequestType/.test(createCallBlock[0])
) {
  ok('8) Payload finalPriority + finalRequestType ile gidiyor');
} else {
  bad('8) Payload override eksik');
}

// 9) mapping.ts dokunulmadı (resolveSmartTicketMapping intact).
if (/export function resolveSmartTicketMapping/.test(mapping)) {
  ok('9) mapping.ts resolveSmartTicketMapping intact');
} else {
  bad('9) mapping.ts dokunulmuş');
}

// 10) Mevcut transfer formu priority akışı dokunulmadı.
if (
  /transferPriority/.test(page) &&
  /setTransferPriority\(createdCase\.priority/.test(page)
) {
  ok('10) Transfer priority akışı intact (regression korundu)');
} else {
  bad('10) Transfer priority akışı bozulmuş (regression)');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
