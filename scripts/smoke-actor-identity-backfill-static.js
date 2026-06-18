/**
 * smoke-actor-identity-backfill-static.js
 *
 * Actor Identity Faz 2 backfill scripti için DB-bağımsız static smoke.
 *
 * Senaryolar (v2 anonim etiket + CaseCallLog flag):
 *   1) Default mode dry-run (EXECUTE flag varsayılan false)
 *   2) --execute olmadan UPDATE call YOK (sadece EXECUTE branch'inde)
 *   3) UPDATE'ler $transaction içinde
 *   4) Sentinel set: 'Mock User', 'mock-user', 'mock_user'
 *   5) Anonim etiket sabit: 'Bilinmeyen kullanıcı'
 *   6) 4 tablo + 3 kolon eşleştirmesi doğru
 *   7) FK NULL + FK orphan → anonim etiket UPDATE (gerçek kişi tahmini yok)
 *   8) CaseCallLog: --include-calllog flag olmadan UPDATE yok
 *   9) Post-execute sentinel count raporu (idempotency kanıtı)
 *  10) prisma.$disconnect cleanup
 *
 * Çalıştır:
 *   node scripts/smoke-actor-identity-backfill-static.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function expect(name, actual, expected) {
  if (actual === expected || JSON.stringify(actual) === JSON.stringify(expected)) ok(name);
  else bad(name, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

const src = readFileSync(path.join(REPO_ROOT, 'scripts/backfill-actor-identity.js'), 'utf8');

console.log('── 1) Default mode dry-run ───────────────────────────────');
{
  expect('1.1 EXECUTE flag args.includes("--execute")',
    src.includes("const EXECUTE = args.includes('--execute');"), true);
  // 1.2 — EXECUTE false branch erken çıkar (UPDATE'e geçmez)
  expect('1.2 dry-run early exit branch',
    /if \(!EXECUTE\)\s*\{[\s\S]+?process\.exit\(0\)/.test(src), true);
}

console.log('\n── 2) UPDATE call yalnız EXECUTE branch\'inde ────────────');
{
  // 2.1 — applyUpdates helper var
  expect('2.1 applyUpdates helper tanımlı',
    /async function applyUpdates\(model, displayField, ok\)/.test(src), true);

  // 2.2 — applyUpdates çağrıları SADECE EXECUTE branch'inde (pre-exit içinde yok)
  const dryRunExitIdx = src.indexOf('process.exit(0)');
  const preExit = dryRunExitIdx > 0 ? src.slice(0, dryRunExitIdx) : '';
  const postExit = dryRunExitIdx > 0 ? src.slice(dryRunExitIdx) : '';
  expect('2.2 applyUpdates dry-run branch\'inde çağrılmaz',
    preExit.includes('await applyUpdates'), false);
  // 2.3 — EXECUTE branch'inde 6 applyUpdates çağrısı: 3 tablo × (fkOk + anonymous)
  expect('2.3 applyUpdates EXECUTE branch\'inde 6 çağrı (3 tablo × fkOk+anonymous)',
    (postExit.match(/await applyUpdates\(/g) || []).length, 6);

  // 2.4 — applyCallLogUpdate çağrısı sadece INCLUDE_CALLLOG branch'inde
  expect('2.4 applyCallLogUpdate INCLUDE_CALLLOG guard\'lı',
    /if \(INCLUDE_CALLLOG\)\s*\{[\s\S]{0,400}await applyCallLogUpdate\(\)/.test(src), true);
}

console.log('\n── 3) Transaction kullanımı ──────────────────────────────');
{
  // 3.1 — applyUpdates içinde prisma.$transaction çağrısı
  expect('3.1 prisma.$transaction içinde batch UPDATE',
    /prisma\.\$transaction\(ops\)/.test(src), true);
  // 3.2 — BATCH_SIZE sabiti
  expect('3.2 BATCH_SIZE sabiti',
    /const BATCH_SIZE = \d+;/.test(src), true);
}

console.log('\n── 4) Sentinel set + anonim etiket ───────────────────────');
{
  expect('4.1 MOCK_USER_SENTINELS = [Mock User, mock-user, mock_user]',
    src.includes("['Mock User', 'mock-user', 'mock_user']"), true);
  expect('4.2 ANONYMOUS_LABEL = "Bilinmeyen kullanıcı"',
    src.includes("const ANONYMOUS_LABEL = 'Bilinmeyen kullanıcı'"), true);
  expect('4.3 CALLLOG_UNKNOWN_VALUE = "unknown-user"',
    src.includes("const CALLLOG_UNKNOWN_VALUE = 'unknown-user'"), true);
  expect('4.4 INCLUDE_CALLLOG flag args.includes("--include-calllog")',
    src.includes("const INCLUDE_CALLLOG = args.includes('--include-calllog')"), true);
}

console.log('\n── 5) Tablo + FK eşleştirmesi ────────────────────────────');
{
  expect('5.1 CaseActivity.actor → actorUserId collectRows çağrısı',
    src.includes("collectRows('caseActivity', 'actor', 'actorUserId')"), true);
  expect('5.2 CaseNote.authorName → authorId collectRows çağrısı',
    src.includes("collectRows('caseNote', 'authorName', 'authorId')"), true);
  expect('5.3 CaseAttachment.uploadedBy → uploadedByUserId collectRows çağrısı',
    src.includes("collectRows('caseAttachment', 'uploadedBy', 'uploadedByUserId')"), true);
  expect('5.4 CaseCallLog rapor helper (reportCallLog)',
    /async function reportCallLog\(\)/.test(src), true);
  expect('5.5 applyCallLogUpdate helper ayrı (CaseCallLog için özel)',
    /async function applyCallLogUpdate\(\)/.test(src), true);
}

console.log('\n── 6) FK NULL + FK orphan → anonim etiket (gerçek kişi tahmini yok) ──');
{
  // 6.1 — FK NULL satırlar fkNullRows olarak toplanır
  expect('6.1 FK NULL satırlar fkNullRows query',
    /const fkNullRows = await prisma\[model\]\.findMany\(/.test(src), true);
  // 6.2 — FK orphan listesi ayrı
  expect('6.2 FK orphan ayrı listede',
    src.includes('const fkOrphan = []'), true);
  // 6.3 — fkOk: User.fullName + email + id fallback chain
  expect('6.3 fkOk: User.fullName → email → id fallback',
    /\(u\.fullName \?\? ''\)\.trim\(\)\s*\|\|\s*\(u\.email \?\? ''\)\.trim\(\)\s*\|\|\s*u\.id/.test(src), true);
  // 6.4 — anonymous = fkNullRows ∪ fkOrphan, HEPSİ ANONYMOUS_LABEL alır
  expect('6.4 anonymous batch fkNullRows ∪ fkOrphan, newVal=ANONYMOUS_LABEL',
    /const anonymous = \[[\s\S]{0,400}newVal: ANONYMOUS_LABEL[\s\S]{0,300}newVal: ANONYMOUS_LABEL/.test(src), true);
  // 6.5 — applyUpdates iki kez çağrılır: fkOk + anonymous (her tablo için)
  expect('6.5 applyUpdates(..., fkOk) + applyUpdates(..., anonymous) pattern',
    /applyUpdates\(\s*'\w+',[\s\S]{0,80}\.fkOk\)[\s\S]{0,800}applyUpdates\(\s*'\w+',[\s\S]{0,80}\.anonymous\)/.test(src), true);
}

console.log('\n── 7) Idempotency + display chain ────────────────────────');
{
  // 7.1 — User.fullName boşsa email fallback
  expect('7.1 User.fullName boşsa email fallback',
    /\(u\.fullName \?\? ''\)\.trim\(\)/.test(src) &&
    /\(u\.email \?\? ''\)\.trim\(\)/.test(src), true);
  // 7.2 — id son çare fallback
  expect('7.2 user.id son çare fallback',
    /\|\| u\.id;/.test(src), true);
  // 7.3 — Idempotency: newVal === oldVal ise skip (zaten doğru)
  expect('7.3 idempotency skip (zaten doğru)',
    /if \(newVal === r\[displayField\]\) continue/.test(src), true);
}

console.log('\n── 8) Cleanup ────────────────────────────────────────────');
{
  // 8.1 — prisma.$disconnect dry-run sonunda (en az 2 toplam $disconnect bekleniyor)
  const disconnectCalls = (src.match(/await prisma\.\$disconnect\(\)/g) || []).length;
  expect('8.1 toplam prisma.$disconnect çağrısı >= 2 (dry+execute)',
    disconnectCalls >= 2, true);
  // 8.2 — main fn body'sinde her iki branch'ten önce/sonra disconnect var
  expect('8.2 main fn body içinde en az 1 disconnect',
    /async function main\(\)[\s\S]+?await prisma\.\$disconnect\(\)/.test(src), true);
  // 8.3 — Fatal catch'te disconnect
  expect('8.3 fatal catch disconnect + exit',
    /main\(\)\.catch\([\s\S]+?await prisma\.\$disconnect\(\)/.test(src), true);
}

console.log('\n── 9) Schema migration YOK ───────────────────────────────');
{
  expect('9.1 $executeRaw kullanmıyor',
    src.includes('$executeRaw'), false);
  expect('9.2 prisma migrate çağrısı yok',
    /prisma migrate|migrateDeploy/.test(src), false);
}

console.log('\n── 10) Post-execute sentinel count (idempotency kanıtı) ──');
{
  expect('10.1 postExecuteSentinelCount helper tanımlı',
    /async function postExecuteSentinelCount\(\)/.test(src), true);
  // 10.2 — EXECUTE branch sonunda çağrı
  expect('10.2 EXECUTE sonu post-execute count çağrısı',
    /header\('Post-execute sentinel count[\s\S]{0,300}postExecuteSentinelCount\(\)/.test(src), true);
  // 10.3 — 4 tablo da sayılır
  expect('10.3 caseActivity + caseNote + caseAttachment + caseCallLog sayımı',
    /caseActivity\.count[\s\S]{0,200}caseNote\.count[\s\S]{0,200}caseAttachment\.count[\s\S]{0,200}caseCallLog\.count/.test(src), true);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
