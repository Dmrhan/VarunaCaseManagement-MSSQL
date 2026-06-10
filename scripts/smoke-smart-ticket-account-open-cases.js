/**
 * smoke-smart-ticket-account-open-cases.js — Madde 1 static guard.
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-account-open-cases.js
 *
 * SmartTicketNewPage + App.tsx üzerinde grep tabanlı invariant testleri.
 *
 * Korunan invariant'lar:
 *   - AccountOpenCasesPanel bileşeni tanımlı
 *   - Koşullu render: form.accountId varsa
 *   - caseService.findByAccount çağrılıyor (yeni endpoint YOK)
 *   - statusNotIn ile Çözüldü + İptalEdildi hariç tutuluyor
 *   - Stale guard (reqIdRef + accountIdRef)
 *   - App.tsx onOpenExistingCase bind ediyor
 *   - Klasik akış bozulmamış (Stage 1/2/3 hala mevcut)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = resolve(ROOT, 'src/features/smart-ticket/SmartTicketNewPage.tsx');
const APP = resolve(ROOT, 'src/App.tsx');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

for (const p of [PAGE, APP]) {
  if (!existsSync(p)) { bad(`${p} YOK`); process.exit(1); }
}
const page = readFileSync(PAGE, 'utf8');
const app = readFileSync(APP, 'utf8');

// 1) AccountOpenCasesPanel bileşeni tanımlı.
if (/function\s+AccountOpenCasesPanel\s*\(/.test(page)) {
  ok('1) AccountOpenCasesPanel bileşeni tanımlı');
} else {
  bad('1) AccountOpenCasesPanel eksik');
}

// 2) Koşullu render: form.accountId varsa.
if (/\{form\.accountId\s*&&\s*\(\s*<AccountOpenCasesPanel/.test(page)) {
  ok('2) Panel koşullu render (form.accountId varsa)');
} else {
  bad('2) Koşullu render guard eksik');
}

// 3) caseService.findByAccount çağrılıyor (mevcut endpoint reuse).
if (/caseService\s*[\r\n\s]*\.findByAccount\(/.test(page)) {
  ok('3) caseService.findByAccount çağrısı var (yeni endpoint YOK)');
} else {
  bad('3) findByAccount çağrısı eksik');
}

// 4) statusNotIn ile Çözüldü + İptalEdildi hariç tutuluyor.
if (/statusNotIn:\s*\[['"]Çözüldü['"],\s*['"]İptalEdildi['"]\]/.test(page)) {
  ok('4) statusNotIn ile Çözüldü + İptalEdildi hariç (açık vakalar filtresi)');
} else {
  bad('4) statusNotIn filtre eksik');
}

// 5) Stale guard ref'leri.
if (
  /accountOpenCasesReqIdRef/.test(page) &&
  /accountOpenCasesAccountIdRef/.test(page)
) {
  ok('5) Stale guard ref\'leri (reqId + accountId) tanımlı');
} else {
  bad('5) Stale guard ref\'leri eksik');
}

// 6) Stale guard kontrol pattern'i: reqId mismatch veya accountId değişimi
//    → setState atla.
if (
  /reqId\s*!==\s*accountOpenCasesReqIdRef\.current[\s\S]{0,200}?return/.test(page)
) {
  ok('6) Stale guard mismatch sonrası setState skip pattern\'i');
} else {
  bad('6) Stale guard kontrol pattern\'i eksik');
}

// 7) Loading + error + empty branch'ler render edilmiş.
if (
  /Açık vakalar kontrol ediliyor/.test(page) &&
  /Bu müşterinin açık vakası yok/.test(page) &&
  /Bu müşterinin .{0,20}açık vakası var/.test(page)
) {
  ok('7) Loading + empty + count durumları render');
} else {
  bad('7) Render durumları eksik');
}

// 8) SLA breach rozeti opsiyonel.
if (/SLA ihlal/.test(page)) {
  ok('8) SLA breach rozeti mevcut');
} else {
  bad('8) SLA breach rozeti eksik');
}

// 9) StatusPill kullanımı (mevcut UI komponentinin reuse'u).
if (/<StatusPill\s+status=\{c\.status\}/.test(page)) {
  ok('9) StatusPill mevcut komponent reuse');
} else {
  bad('9) StatusPill kullanımı eksik');
}

// 10) onOpenExistingCase prop opsiyonel, callback verilmezse satır pasif.
if (
  /onOpenExistingCase\?\s*:\s*\(caseId:\s*string\)\s*=>\s*void/.test(page)
) {
  ok('10) onOpenExistingCase prop opsiyonel tanımlı');
} else {
  bad('10) onOpenExistingCase prop tanımı eksik');
}

// 11) App.tsx'te onOpenExistingCase prop'u openCase'e bind edilmiş.
if (
  /<SmartTicketNewPage[\s\S]{0,400}?onOpenExistingCase=\{[\s\S]{0,200}?openCase/.test(app)
) {
  ok('11) App.tsx onOpenExistingCase → openCase bind');
} else {
  bad('11) App.tsx bind eksik');
}

// 12) Klasik Stage 1/2/3 akışı korunmuş.
if (
  page.includes('Stage1Placeholder') ||
  page.includes('Stage2Solution') ||
  page.includes('Stage3Closure')
) {
  ok('12) Klasik Stage bileşenleri korunmuş');
} else {
  bad('12) Stage bileşenleri eksik');
}

// 13) Yeni endpoint EKLENMEDİ — sadece findByAccount reuse.
if (
  !/POST\s+\/api\/cases\/.*open-cases/.test(page) &&
  !/\/api\/accounts\/.*open-cases/.test(page)
) {
  ok('13) Yeni endpoint eklenmedi (findByAccount reuse)');
} else {
  bad('13) Yeni endpoint referansı tespit edildi');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
