/**
 * smoke-smart-ticket-project-code-search.js — PR-6 static guard.
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-project-code-search.js
 *
 * Business review Madde 4 — Smart Ticket proje seçiminde proje adı
 * YANINDA proje kodu da aranabilsin.
 *
 * Korunan invariant'lar:
 *   - SmartTicketProjectOption tipine code? eklendi
 *   - accountService.get sonrası map'te code geçiriliyor
 *   - projectFilter state + filteredProjects useMemo
 *   - name + code substring (case-insensitive, tr-TR lowercase)
 *   - Seçili proje filter dışına düşse bile listede tutulur
 *   - Müşteri/şirket değişince filter sıfırlanır
 *   - Search input yalnız 3+ proje varsa render
 *   - Select option label "CODE — NAME" formatında
 *   - Yeni endpoint EKLENMEDİ (mevcut accountService.get reuse)
 *   - Case create payload accountProjectId davranışı dokunulmadı
 *   - AccountProjectSummary.code field intact (accountService)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = resolve(ROOT, 'src/features/smart-ticket/SmartTicketNewPage.tsx');
const ACC = resolve(ROOT, 'src/services/accountService.ts');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

for (const p of [PAGE, ACC]) {
  if (!existsSync(p)) { bad(`${p} YOK`); process.exit(1); }
}
const page = readFileSync(PAGE, 'utf8');
const acc = readFileSync(ACC, 'utf8');

// 1) SmartTicketProjectOption tipine code? eklendi.
if (/interface\s+SmartTicketProjectOption\s*\{[\s\S]{0,400}?code\?:\s*string/.test(page)) {
  ok('1) SmartTicketProjectOption.code?: string eklendi');
} else {
  bad('1) code? field eksik');
}

// 2) accountService.get sonrası map'te code geçiriliyor.
if (
  /\.map\(\(p\)\s*=>\s*\(\{\s*id:\s*p\.id,\s*name:\s*p\.name,\s*code:\s*p\.code\s*\}\)\)/.test(page)
) {
  ok('2) projects map\'te code geçiriliyor');
} else {
  bad('2) projects map code geçirme eksik');
}

// 3) projectFilter state.
if (/const\s*\[projectFilter,\s*setProjectFilter\]\s*=\s*useState\(/.test(page)) {
  ok('3) projectFilter state mevcut');
} else {
  bad('3) projectFilter state eksik');
}

// 4) filteredProjects useMemo + name (tr-TR) + code (locale-neutral).
//    Codex P2 (PR #467 review) — code için ASCII toLowerCase; tr-TR
//    'I' → 'ı' yapardı, "INV-2026" arması "inv" ile bulunmazdı.
if (
  /filteredProjects\s*=\s*useMemo\(/.test(page) &&
  /qNeutral\s*=\s*raw\.toLowerCase\(\)/.test(page) &&
  /qTr\s*=\s*raw\.toLocaleLowerCase\(['"]tr-TR['"]\)/.test(page) &&
  /name\.includes\(qTr\)\s*\|\|\s*code\.includes\(qNeutral\)/.test(page)
) {
  ok('4) filteredProjects: name (tr-TR) + code (locale-neutral) ayrımı');
} else {
  bad('4) filter casing ayrımı eksik');
}

// 5) Seçili proje filter dışına düşse bile listede tutulur.
if (
  /form\.accountProjectId\s*===\s*p\.id[\s\S]{0,80}?return\s+true/.test(page)
) {
  ok('5) Seçili proje filter dışında olsa bile listede kalır');
} else {
  bad('5) Selected project keep guard eksik');
}

// 6) Müşteri / şirket değişince filter reset.
if (
  /setProjectFilter\(['"]['"]\)[\s\S]{0,200}?\[form\.accountId,\s*form\.companyId\]/.test(page)
) {
  ok('6) form.accountId / companyId değişiminde filter reset');
} else {
  bad('6) Filter reset effect eksik');
}

// 7) Search input yalnız 3+ proje varsa render.
if (
  /projects\.length\s*>=\s*3\s*&&\s*\(\s*<TextInput[\s\S]{0,300}?projectFilter/.test(page)
) {
  ok('7) Search input yalnız 3+ proje varsa render');
} else {
  bad('7) Conditional render guard eksik');
}

// 8) Select option label "CODE — NAME" formatında (code varsa).
if (
  /p\.code\s*\?\s*`\$\{p\.code\}\s*—\s*\$\{p\.name\}`\s*:\s*p\.name/.test(page)
) {
  ok('8) Select option label "CODE — NAME" (fallback: yalnız NAME)');
} else {
  bad('8) Option label format eksik');
}

// 9) filteredProjects.map (mevcut projects.map değil — filter reflect ediliyor).
if (/filteredProjects\.map\(\(p\)\s*=>/.test(page)) {
  ok('9) Select filteredProjects.map ile render (filter reflect)');
} else {
  bad('9) filteredProjects.map kullanılmıyor');
}

// 10) Empty state mesajı: filter dolu + filteredProjects boş → calm uyarı.
if (
  /projectFilter\.trim\(\)\s*&&\s*filteredProjects\.length\s*===\s*0/.test(page) &&
  /proje bulunamadı/.test(page)
) {
  ok('10) Filter sonuçsuzsa calm warning gösteriliyor');
} else {
  bad('10) Empty filter warning eksik');
}

// 11) Yeni endpoint EKLENMEDİ — accountService.get hala kullanılıyor.
if (
  /accountService\.get\(form\.accountId\)/.test(page) &&
  !/listProjects|findProjects|searchProjects/.test(page)
) {
  ok('11) Yeni endpoint YOK — mevcut accountService.get reuse');
} else {
  bad('11) Yeni endpoint referansı bulundu');
}

// 12) Case create payload davranışı korundu (accountProjectId intact).
if (
  /caseService\.create\([\s\S]{0,1500}?accountProjectId:\s*form\.accountProjectId/.test(page)
) {
  ok('12) Case create payload accountProjectId intact (davranış değişmedi)');
} else {
  bad('12) Payload accountProjectId değişmiş');
}

// 13) AccountProjectSummary.code field (backend kontrat) intact.
if (/interface\s+AccountProjectSummary[\s\S]{0,400}?code:\s*string/.test(acc)) {
  ok('13) AccountProjectSummary.code field intact');
} else {
  bad('13) AccountProjectSummary.code bozulmuş');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
