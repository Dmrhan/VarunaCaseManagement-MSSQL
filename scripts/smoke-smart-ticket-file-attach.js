/**
 * smoke-smart-ticket-file-attach.js — PR-5 static guard.
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-file-attach.js
 *
 * Business review Madde 2 — Akıllı Ticket Stage 1'de dosya attach.
 * QuickCaseModal pendingFiles pattern reuse + create sonrası sequential
 * upload + fail tolerant (Case açık kalır).
 *
 * Korunan invariant'lar:
 *   - PendingFile tipi tanımlı (queued/uploading/done/error)
 *   - pendingFiles state + handlePickFiles + handleRemovePendingFile
 *   - CASE_FILE_MAX_COUNT + CASE_FILE_MAX_SIZE limit reuse
 *   - Stage1FileAttach bileşeni stage==='opening' iken render
 *   - Case create sonrası caseService.addFile sıralı çağrı
 *   - Upload fail durumunda warn toast + Case açık kalır
 *   - QuickCaseModal davranışı dokunulmadı (regression)
 *   - CaseFiles tab (Case Detail) dokunulmadı
 *   - Yeni storage / endpoint YOK (mevcut addFile reuse)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = resolve(ROOT, 'src/features/smart-ticket/SmartTicketNewPage.tsx');
const QCM = resolve(ROOT, 'src/features/cases/QuickCaseModal.tsx');
const FILES = resolve(ROOT, 'src/features/cases/components/CaseFiles.tsx');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

for (const p of [PAGE, QCM, FILES]) {
  if (!existsSync(p)) { bad(`${p} YOK`); process.exit(1); }
}
const page = readFileSync(PAGE, 'utf8');
const qcm = readFileSync(QCM, 'utf8');
const files = readFileSync(FILES, 'utf8');

// 1) PendingFile tipi tanımlı (4 status + percent + errorMessage opsiyonel).
if (
  /interface\s+PendingFile\s*\{[\s\S]{0,400}?status:\s*['"]queued['"]\s*\|\s*['"]uploading['"]\s*\|\s*['"]done['"]\s*\|\s*['"]error['"]/.test(page)
) {
  ok('1) PendingFile tipi tanımlı (queued/uploading/done/error)');
} else {
  bad('1) PendingFile tipi eksik');
}

// 2) pendingFiles state.
if (/useState<PendingFile\[\]>\(\[\]\)/.test(page)) {
  ok('2) pendingFiles useState<PendingFile[]> tanımlı');
} else {
  bad('2) pendingFiles state eksik');
}

// 3) handlePickFiles helper count + size validation.
if (
  /function handlePickFiles\(filesList:\s*FileList\s*\|\s*File\[\]\)/.test(page) &&
  /CASE_FILE_MAX_COUNT\s*-\s*pendingFiles\.length/.test(page) &&
  /f\.size\s*>\s*CASE_FILE_MAX_SIZE/.test(page)
) {
  ok('3) handlePickFiles count + size validation (CASE_FILE_MAX_COUNT/SIZE reuse)');
} else {
  bad('3) handlePickFiles validation eksik');
}

// 4) handleRemovePendingFile queue'dan çıkarır.
if (/function handleRemovePendingFile\(id:\s*string\)[\s\S]{0,200}?filter\(\(p\)\s*=>\s*p\.id\s*!==\s*id\)/.test(page)) {
  ok('4) handleRemovePendingFile pending queue\'dan çıkarır');
} else {
  bad('4) handleRemovePendingFile eksik');
}

// 5) Stage1FileAttach bileşeni tanımlı + stage==='opening' iken render.
if (
  /function\s+Stage1FileAttach\s*\(/.test(page) &&
  /\{stage === 'opening' && \(\s*<Stage1FileAttach/.test(page)
) {
  ok('5) Stage1FileAttach bileşeni + stage===opening koşullu mount');
} else {
  bad('5) Stage1FileAttach mount eksik');
}

// 6) Case create sonrası sıralı upload loop (addFile).
if (
  /caseService\.addFile\(uploadedCase\.id,\s*pf\.file/.test(page) &&
  /for\s*\(const pf of pendingFiles\)/.test(page)
) {
  ok('6) Case create sonrası caseService.addFile sıralı upload loop');
} else {
  bad('6) Upload loop eksik');
}

// 7) Fail tolerant: filesFail varsa warn toast + "Vaka Detayı → Dosyalar"
//    yönlendirmesi; Case açık kalır (return YOK fail branch'inde).
if (
  /filesFail\s*>\s*0[\s\S]{0,400}?Vaka Detayı.{0,5}Dosyalar/.test(page)
) {
  ok('7) Fail durumunda warn toast + Vaka Detayı → Dosyalar yönlendirmesi');
} else {
  bad('7) Fail tolerant toast eksik');
}

// 8) Mevcut limit constants reuse (yeni constant tanımlamak yerine).
if (
  /import\s*\{[\s\S]{0,200}?CASE_FILE_MAX_COUNT[\s\S]{0,200}?CASE_FILE_MAX_SIZE/.test(page)
) {
  ok('8) CASE_FILE_MAX_COUNT + CASE_FILE_MAX_SIZE import edildi (reuse)');
} else {
  bad('8) Constant reuse eksik');
}

// 9) QuickCaseModal davranışı dokunulmadı (regression).
//    pendingFiles + caseService.addFile pattern'i intact.
if (
  /pendingFiles[\s\S]{0,800}?caseService\.addFile/.test(qcm)
) {
  ok('9) QuickCaseModal pendingFiles + addFile pattern intact (regression)');
} else {
  bad('9) QuickCaseModal pattern bozulmuş');
}

// 10) CaseFiles (Case Detail Files tab) dokunulmadı.
if (
  /export function (?:CaseFiles|FilesTab)|export default function/.test(files)
) {
  ok('10) CaseFiles tab bileşeni intact (regression)');
} else {
  bad('10) CaseFiles tab değişmiş');
}

// 11) Yeni endpoint EKLENMEDİ — mevcut addFile reuse.
if (
  !/POST\s+\/api\/.*smart-ticket\/.*upload/.test(page) &&
  !/POST\s+\/api\/.*pending-file/.test(page)
) {
  ok('11) Yeni endpoint EKLENMEDİ (mevcut addFile reuse)');
} else {
  bad('11) Yeni endpoint referansı bulundu');
}

// 12) Yeni Case yaratımı YOK — yalnız 1 caseService.create çağrısı
//     (handleCreateAndContinue'deki).
const createCalls = (page.match(/caseService\.create\(/g) ?? []).length;
if (createCalls === 1) {
  ok('12) Yalnız 1 caseService.create çağrısı (yeni Case yaratımı yok)');
} else {
  bad(`12) caseService.create çoklu — count=${createCalls}`);
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
