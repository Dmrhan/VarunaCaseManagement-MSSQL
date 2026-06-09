/**
 * smoke-smart-ticket-kb-wrapped-error.js — Codex P2 (main #447 review) fixes.
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-kb-wrapped-error.js
 *
 * Static grep smoke — DB/HTTP gerektirmez. Üç Codex P2 fix'ini koruma altına
 * alır:
 *
 *   #1 categorize-v2 → analyze fallback yalnız thrown error'a değil
 *      `kbResponse.ok === false` wrapped response'una da düşer
 *   #2 suggest-close `ok: false` döndüğünde route 502'ye map'ler
 *      (eski impl boş payload'la 200 dönüyordu — Stage 3 sessiz fail)
 *   #3 closure rootCauseGroup useEffect rootCauseDetail'i koşulsuz clear
 *      etmiyor — yeni grubun rcdList'inde varsa preserve eder
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ROUTE = resolve(ROOT, 'server/routes/smartTicket.js');
const CASES_ROUTE = resolve(ROOT, 'server/routes/cases.js');
const PAGE = resolve(ROOT, 'src/features/smart-ticket/SmartTicketNewPage.tsx');
const KB_SETTING = resolve(ROOT, 'server/db/externalKbSettingRepository.js');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

if (!existsSync(ROUTE)) { bad('server/routes/smartTicket.js YOK'); process.exit(1); }
if (!existsSync(CASES_ROUTE)) { bad('server/routes/cases.js YOK'); process.exit(1); }
if (!existsSync(PAGE)) { bad('SmartTicketNewPage.tsx YOK'); process.exit(1); }
if (!existsSync(KB_SETTING)) { bad('externalKbSettingRepository.js YOK'); process.exit(1); }
const route = readFileSync(ROUTE, 'utf8');
const casesRoute = readFileSync(CASES_ROUTE, 'utf8');
const page = readFileSync(PAGE, 'utf8');
const kbSetting = readFileSync(KB_SETTING, 'utf8');

// 1) categorize-v2 wrapped ok:false → analyze fallback.
//    v2.ok === false kontrolü VEYA kbResponse.ok === false kontrolü
//    suggest-classification path'inde mevcut olmalı.
const classBlock = route.match(/suggest-classification[\s\S]*?suggest-closure/);
if (
  classBlock &&
  /v2\.ok\s*===\s*false|\.ok\s*===\s*false[\s\S]{0,300}?analyzeFallback|\.ok\s*===\s*false[\s\S]{0,300}?analyze/.test(classBlock[0])
) {
  ok('1) categorize-v2 wrapped ok:false → analyze fallback kontrolü var');
} else {
  bad('1) categorize-v2 wrapped ok:false fallback kontrolü eksik');
}

// 2) suggest-close wrapped ok:false → 502 map.
const closureBlock = route.match(/suggest-closure[\s\S]*$/);
if (
  closureBlock &&
  /kbResponse\.ok\s*===\s*false[\s\S]{0,300}?502/.test(closureBlock[0])
) {
  ok('2) suggest-close wrapped ok:false → 502 map kontrolü var');
} else {
  bad('2) suggest-close wrapped ok:false → 502 map eksik');
}

// 3) closure rootCauseDetail preserve — rcdList.some kontrolü ile yeni grupta
//    geçerli detail koruma.
if (
  /closureLists\.rcdList\.some\([\s\S]{0,100}?rootCauseDetail/.test(page) ||
  /rcdList\.some\([\s\S]{0,100}?stillValid/.test(page)
) {
  ok('3) closure rootCauseDetail preserve (rcdList.some kontrolü)');
} else {
  bad('3) closure rootCauseDetail preserve kontrolü eksik');
}

// 4) Koşulsuz clear pattern KALDIRILDI: tek başına
//    `setClosure((c) => ({ ...c, rootCauseDetail: '' }))` kaynakta yalnız
//    koşullu branch içinde olmalı (return { ...c, ... } pattern korunur).
const unconditionalClear =
  /useEffect\(\(\)\s*=>\s*\{\s*setClosure\(\(c\)\s*=>\s*\(\{\s*\.\.\.c,\s*rootCauseDetail:\s*['"]['"]\s*\}\)\);?\s*\},\s*\[closure\.rootCauseGroup\]\)/.test(page);
if (!unconditionalClear) {
  ok('4) Koşulsuz rootCauseDetail clear useEffect kaldırıldı');
} else {
  bad('4) Eski koşulsuz clear hala kaynakta');
}

// ─── PR-fix: Smart Ticket AI suggested steps silent fail ──────────────

// 5) import-ai-suggested route wrapped ok:false → 502 (Codex P2 pattern).
const importBlock = casesRoute.match(/'\/:id\/solution-steps\/import-ai-suggested'[\s\S]*?\}\),?\s*\);?/);
if (
  importBlock &&
  /kbResult\.ok\s*===\s*false[\s\S]{0,300}?502/.test(importBlock[0])
) {
  ok('5) import-ai-suggested wrapped ok:false → 502 kontrolü var');
} else {
  bad('5) import-ai-suggested ok:false kontrolü eksik');
}

// 6) externalKbSettingRepository default timeoutMs >= 60000 (analyze ~180sn
//    KB v2 doc'una göre 30s default her zaman timeout'a düşüyordu).
const defaultMatch = kbSetting.match(/timeoutMs:\s*(\d+)/);
if (defaultMatch && Number(defaultMatch[1]) >= 60000) {
  ok(`6) Tenant default timeoutMs >= 60000 (analyze için yeterli) — ${defaultMatch[1]}`);
} else {
  bad(`6) timeoutMs default <60000 — ${defaultMatch?.[1] ?? 'yok'}`);
}

// 7) TIMEOUT_MAX KB v2'nin analyze ~180sn'sini kapsayacak şekilde >=180000.
const maxMatch = kbSetting.match(/TIMEOUT_MAX\s*=\s*(\d+)/);
if (maxMatch && Number(maxMatch[1]) >= 180000) {
  ok(`7) TIMEOUT_MAX KB v2 analyze tavanını destekliyor — ${maxMatch[1]}`);
} else {
  bad(`7) TIMEOUT_MAX <180000 — ${maxMatch?.[1] ?? 'yok'}`);
}

// 8) Frontend handleCreateAndContinue importedCount===0 durumunda info
//    toast — "Vaka açıldı" sessiz fail yerine "KB cevabında öneri
//    bulunamadı — manuel adım ekleyebilirsiniz" mesajı.
if (/type:\s*['"]info['"][\s\S]{0,200}?KB cevab[\s\S]{0,40}?manuel/.test(page)) {
  ok('8) importedCount===0 toast info\'ya çevrildi (sessiz fail önlendi)');
} else {
  bad('8) importedCount===0 info toast eksik');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
