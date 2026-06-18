/**
 * smoke-smart-ticket-account-open-cases.js — Madde 1 static guard.
 *
 * NOT: Faz 1 (Customer Context Drawer) sonrası AccountOpenCasesPanel kaldırıldı;
 * yerine sol panelde CustomerContextBanner + sayfa root'unda
 * CustomerContextDrawer geldi. Bu smoke artık banner+drawer invariant'larını
 * korur. Detay smoke: scripts/smoke-smart-ticket-customer-context-static.js
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-account-open-cases.js
 *
 * SmartTicketNewPage + App.tsx üzerinde grep tabanlı invariant testleri.
 *
 * Korunan invariant'lar:
 *   - Müşteri seçildiğinde sol panelde context banner render
 *   - caseService.findByAccount çağrılıyor (yeni endpoint YOK)
 *   - statusNotIn ile Çözüldü + İptalEdildi hariç (açık vaka fetch)
 *   - Stale guard (reqIdRef + accountIdRef)
 *   - App.tsx onOpenExistingCase bind ediyor
 *   - Klasik Stage 1/2/3 akışı korunmuş
 *   - AccountOpenCasesPanel tipinin tamamı silinmiş (regression guard)
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

// 1) Faz 1 sonrası: AccountOpenCasesPanel function tanımı KALDIRILDI.
if (!/function\s+AccountOpenCasesPanel\s*\(/.test(page)) {
  ok('1) AccountOpenCasesPanel function silindi (Faz 1)');
} else {
  bad('1) AccountOpenCasesPanel halen tanımlı (Faz 1 ile silinmeliydi)');
}

// 2) Sol panelde banner koşullu render: form.accountId varsa.
if (/\{form\.accountId\s*&&\s*\(\s*<CustomerContextBanner/.test(page)) {
  ok('2) CustomerContextBanner koşullu render (form.accountId varsa)');
} else {
  bad('2) Banner koşullu render guard eksik');
}

// 3) caseService.findByAccount çağrılıyor (mevcut endpoint reuse).
if (/caseService\s*[\r\n\s]*\.findByAccount\(/.test(page)) {
  ok('3) caseService.findByAccount çağrısı var (yeni endpoint YOK)');
} else {
  bad('3) findByAccount çağrısı eksik');
}

// 4) statusNotIn ile Çözüldü + İptalEdildi hariç (açık vakalar fetch).
if (/statusNotIn:\s*\[['"]Çözüldü['"],\s*['"]İptalEdildi['"]\]/.test(page)) {
  ok('4) statusNotIn ile Çözüldü + İptalEdildi hariç (açık vakalar filtresi)');
} else {
  bad('4) statusNotIn filtre eksik');
}

// 5) Stale guard ref'leri (açık vaka fetch için).
if (
  /accountOpenCasesReqIdRef/.test(page) &&
  /accountOpenCasesAccountIdRef/.test(page)
) {
  ok('5) Stale guard ref\'leri (reqId + accountId) tanımlı');
} else {
  bad('5) Stale guard ref\'leri eksik');
}

// 6) Stale guard kontrol pattern'i.
if (
  /reqId\s*!==\s*accountOpenCasesReqIdRef\.current[\s\S]{0,200}?return/.test(page)
) {
  ok('6) Stale guard mismatch sonrası setState skip pattern\'i');
} else {
  bad('6) Stale guard kontrol pattern\'i eksik');
}

// 7) Banner mount sırasında count-only resolvedCount fetch (Codex P2-2).
if (/countByAccount\(targetAccountId,\s*\{ statusIn: \['Çözüldü'\] \}\)/.test(page)) {
  ok('7) Banner resolvedCount count-only fetch (statusIn=Çözüldü, Codex P2-2)');
} else {
  bad('7) ResolvedCount count fetch eksik');
}

// 8) Drawer root'ta render edilmiş.
if (/<CustomerContextDrawer/.test(page)) {
  ok('8) CustomerContextDrawer page root\'ta render');
} else {
  bad('8) CustomerContextDrawer render eksik');
}

// 9) onOpenExistingCase prop opsiyonel tanımlı (sözleşme korundu).
if (
  /onOpenExistingCase\?\s*:\s*\(caseId:\s*string\)\s*=>\s*void/.test(page)
) {
  ok('9) onOpenExistingCase prop opsiyonel tanımlı');
} else {
  bad('9) onOpenExistingCase prop tanımı eksik');
}

// 10) App.tsx'te onOpenExistingCase prop'u openCase'e bind edilmiş.
if (
  /<SmartTicketNewPage[\s\S]{0,400}?onOpenExistingCase=\{[\s\S]{0,200}?openCase/.test(app)
) {
  ok('10) App.tsx onOpenExistingCase → openCase bind');
} else {
  bad('10) App.tsx bind eksik');
}

// 11) Klasik Stage 1/2/3 akışı korunmuş.
if (
  page.includes('Stage1Placeholder') ||
  page.includes('Stage2Solution') ||
  page.includes('Stage3Closure')
) {
  ok('11) Klasik Stage bileşenleri korunmuş');
} else {
  bad('11) Stage bileşenleri eksik');
}

// 12) Yeni endpoint EKLENMEDİ — sadece findByAccount reuse.
if (
  !/POST\s+\/api\/cases\/.*open-cases/.test(page) &&
  !/\/api\/accounts\/.*open-cases/.test(page)
) {
  ok('12) Yeni endpoint eklenmedi (findByAccount reuse)');
} else {
  bad('12) Yeni endpoint referansı tespit edildi');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
