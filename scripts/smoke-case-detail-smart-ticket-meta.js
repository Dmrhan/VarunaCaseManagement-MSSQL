/**
 * smoke-case-detail-smart-ticket-meta.js — PR-4 static guard.
 *
 * Çalıştır:
 *   node scripts/smoke-case-detail-smart-ticket-meta.js
 *
 * Business review Madde 4 — Case Detail Detay sekmesinde Smart Ticket
 * açılış kategorileri compact chip görünümü.
 *
 * Korunan invariant'lar:
 *   - SmartTicketMetaSection bileşeni tanımlı
 *   - Detay sekmesinde Açıklama Section'ından SONRA mount edildi
 *   - 5 alan kontrolü: platform, businessProcess, operationType,
 *     affectedObject, impact
 *   - Label suffix tercihi (platformLabel > platform), pick helper
 *   - customFields.smartTicket yoksa null döner (klasik koruma)
 *   - Tüm alanlar boşsa null (boş Section header görünmesin)
 *   - L1 Devir Özeti kartı (Çözüm Adımları tabı, PR-T3) dokunulmadı
 *   - KbDraftSection (PR-T3 KB drafts) dokunulmadı
 *   - Yeni endpoint / schema yok
 *   - Activity / Solution Steps akışları dokunulmadı
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DETAIL = resolve(ROOT, 'src/features/cases/CaseDetailPage.tsx');
const PANEL = resolve(ROOT, 'src/features/cases/CaseSolutionStepsPanel.tsx');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

for (const p of [DETAIL, PANEL]) {
  if (!existsSync(p)) { bad(`${p} YOK`); process.exit(1); }
}
const detail = readFileSync(DETAIL, 'utf8');
const panel = readFileSync(PANEL, 'utf8');

// 1) SmartTicketMetaSection bileşeni tanımlı.
if (/function\s+SmartTicketMetaSection\s*\(/.test(detail)) {
  ok('1) SmartTicketMetaSection bileşeni tanımlı');
} else {
  bad('1) SmartTicketMetaSection eksik');
}

// 2) Açıklama Section'ından sonra mount edildi.
//    Pattern: Section title="Açıklama" ... </Section> sonra
//    <SmartTicketMetaSection item={item} />
if (
  /<Section title="Açıklama">[\s\S]{0,2000}?<\/Section>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<SmartTicketMetaSection\s+item=\{item\}\s*\/>/.test(detail)
) {
  ok('2) SmartTicketMetaSection Açıklama Section\'ından SONRA mount');
} else {
  bad('2) Mount sırası yanlış veya eksik');
}

// 3) 5 taxonomy alanı tek arrayde tanımlı.
const TAX_KEYS = ['platform', 'businessProcess', 'operationType', 'affectedObject', 'impact'];
const allFound = TAX_KEYS.every((k) => new RegExp(`key:\\s*['"]${k}['"]`).test(detail));
if (allFound) {
  ok('3) 5 taxonomy alanı tek arrayde tanımlı (platform / businessProcess / operationType / affectedObject / impact)');
} else {
  const missing = TAX_KEYS.filter((k) => !new RegExp(`key:\\s*['"]${k}['"]`).test(detail));
  bad('3) Eksik alanlar', missing.join(', '));
}

// 4) Label suffix tercihi: pick(codeKey, labelKey) helper, label dolu ise
//    onu döner.
if (
  /const\s+pick\s*=\s*\(codeKey:\s*string,\s*labelKey:\s*string\)/.test(detail) &&
  /pick\(['"]platform['"],\s*['"]platformLabel['"]\)/.test(detail)
) {
  ok('4) pick(code, label) helper + platformLabel tercihi');
} else {
  bad('4) Label tercih pattern\'i eksik');
}

// 5) customFields.smartTicket yoksa null döner.
if (
  /if\s*\(!st\s*\|\|\s*typeof\s+st\s*!==\s*['"]object['"]\)\s*return\s+null/.test(detail)
) {
  ok('5) customFields.smartTicket yoksa null döner (klasik vakalar etkilenmez)');
} else {
  bad('5) Smart Ticket guard eksik');
}

// 6) Visible.length===0 ise null (boş Section header görünmez).
if (/if\s*\(visible\.length\s*===\s*0\)\s*return\s+null/.test(detail)) {
  ok('6) Tüm alanlar boşsa null (empty Section header görünmez)');
} else {
  bad('6) Empty-fields guard eksik');
}

// 7) KbDraftSection (PR-T3) dokunulmadı — aynen var.
if (
  /function\s+KbDraftSection\s*\([\s\S]{0,400}?aiDrafts/.test(detail) &&
  /<KbDraftSection\s+item=\{item\}\s*\/>/.test(detail)
) {
  ok('7) KbDraftSection (PR-T3) intact');
} else {
  bad('7) KbDraftSection (PR-T3) dokunulmuş');
}

// 8) L1 Devir Özeti kartı (Çözüm Adımları sekmesinde) dokunulmadı.
//    CaseSolutionStepsPanel'de L1TransferSummaryCard intact.
if (
  /function\s+L1TransferSummaryCard\s*\(/.test(panel) &&
  /<L1TransferSummaryCard\s+item=\{item\}\s*\/>/.test(panel)
) {
  ok('8) L1 Devir Özeti kartı (PR-T3) intact — duplicate riski yok (farklı tab)');
} else {
  bad('8) L1 Devir Özeti kartı bozulmuş');
}

// 9) Yeni endpoint EKLENMEDİ.
if (
  !/POST\s+\/api\/.*smart-ticket-meta/.test(detail) &&
  !/caseService\.smartTicketMeta/.test(detail)
) {
  ok('9) Yeni endpoint EKLENMEDİ (item prop\'undan veri okur)');
} else {
  bad('9) Yeni endpoint referansı bulundu');
}

// 10) Activity / Solution Steps akışları dokunulmadı — ActivityTab ve
//     CaseSolutionStepsPanel'e SmartTicketMetaSection mount EDİLMEDİ.
//     Yalnız Detay sekmesinde tek mount noktası.
const mountCount = (detail.match(/<SmartTicketMetaSection\s+item=\{item\}\s*\/>/g) ?? []).length;
if (mountCount === 1) {
  ok('10) SmartTicketMetaSection yalnız Detay sekmesinde (tek mount)');
} else {
  bad(`10) Çoklu mount tespit edildi — count=${mountCount}`);
}

// 11) Section tint="violet" — RUNA AI brand uyumu.
if (
  /<Section\s+title="Akıllı Ticket Kategorileri"\s+tint="violet">/.test(detail)
) {
  ok('11) Section "Akıllı Ticket Kategorileri" violet tint (RUNA AI brand uyumlu)');
} else {
  bad('11) Section başlığı / tint eksik');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
