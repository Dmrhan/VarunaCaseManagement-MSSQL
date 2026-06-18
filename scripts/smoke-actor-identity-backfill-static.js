/**
 * smoke-actor-identity-backfill-static.js
 *
 * Actor Identity Faz 2 backfill scripti için DB-bağımsız static smoke.
 *
 * Senaryolar:
 *   1) Default mode dry-run (EXECUTE flag varsayılan false)
 *   2) --execute olmadan UPDATE call YOK (sadece EXECUTE branch'inde)
 *   3) UPDATE'ler $transaction içinde
 *   4) Sentinel set: 'Mock User', 'mock-user', 'mock_user'
 *   5) 4 tablo + 3 kolon eşleştirmesi doğru:
 *      - CaseActivity.actor → actorUserId
 *      - CaseNote.authorName → authorId
 *      - CaseAttachment.uploadedBy → uploadedByUserId
 *      - CaseCallLog.callerId='mock-user' (otomatik backfill yok)
 *   6) FK NULL satırlar UPDATE'e DAHİL EDİLMEZ (unresolved)
 *   7) FK orphan (User silinmiş) satırlar UPDATE'e DAHİL EDİLMEZ (unresolved)
 *   8) prisma.$disconnect script sonunda çağrılır
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
    /if \(!EXECUTE\)[\s\S]{0,200}process\.exit\(0\)/.test(src), true);
}

console.log('\n── 2) UPDATE call yalnız EXECUTE branch\'inde ────────────');
{
  // 2.1 — applyUpdates helper var ve sadece EXECUTE branch'ten çağrılır
  expect('2.1 applyUpdates helper tanımlı',
    /async function applyUpdates\(model, displayField, ok\)/.test(src), true);

  // 2.2 — applyUpdates çağrıları SADECE EXECUTE branch'inde
  // Pattern: `if (!EXECUTE) { ... process.exit(0) }` öncesi applyUpdates çağrısı YOK
  const dryRunExitIdx = src.indexOf('process.exit(0)');
  const preExit = dryRunExitIdx > 0 ? src.slice(0, dryRunExitIdx) : '';
  const postExit = dryRunExitIdx > 0 ? src.slice(dryRunExitIdx) : '';
  expect('2.2 applyUpdates dry-run branch\'inde çağrılmaz',
    preExit.includes('await applyUpdates'), false);
  expect('2.3 applyUpdates EXECUTE branch\'inde çağrılır (3 tablo)',
    (postExit.match(/await applyUpdates\(/g) || []).length, 3);

  // 2.4 — Helper tanımı dışında standalone prisma.X.update / updateMany çağrısı YOK
  // (applyUpdates içindeki tanım hariç tüm dosyada başka write yok demek)
  const standaloneUpdateCalls = (src.match(/await\s+prisma\.\w+\.(update|updateMany|delete|deleteMany|create|createMany)\(/g) || []).length;
  expect('2.4 standalone prisma.X.write çağrısı yok (applyUpdates dışında)',
    standaloneUpdateCalls, 0);
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

console.log('\n── 4) Sentinel set ───────────────────────────────────────');
{
  expect('4.1 MOCK_USER_SENTINELS = [Mock User, mock-user, mock_user]',
    src.includes("['Mock User', 'mock-user', 'mock_user']"), true);
}

console.log('\n── 5) Tablo + FK eşleştirmesi ────────────────────────────');
{
  // 5.1-5.3 — 3 auto-fixable tablo
  expect('5.1 CaseActivity.actor → actorUserId collectRows çağrısı',
    src.includes("collectRows('caseActivity', 'actor', 'actorUserId')"), true);
  expect('5.2 CaseNote.authorName → authorId collectRows çağrısı',
    src.includes("collectRows('caseNote', 'authorName', 'authorId')"), true);
  expect('5.3 CaseAttachment.uploadedBy → uploadedByUserId collectRows çağrısı',
    src.includes("collectRows('caseAttachment', 'uploadedBy', 'uploadedByUserId')"), true);

  // 5.4 — CaseCallLog ayrı rapor (otomatik backfill yok)
  expect('5.4 CaseCallLog.callerId="mock-user" reportCallLogUnresolved',
    /async function reportCallLogUnresolved\(\)/.test(src), true);
  expect('5.5 CaseCallLog auto-fixable = 0',
    src.includes('autoFixable: 0,  // gerçek caller bilinmiyor') ||
    src.includes('autoFixable: 0  (gerçek caller bilinmiyor)') ||
    /reportCallLogUnresolved[\s\S]{0,2500}autoFixable:\s*0/.test(src), true);

  // 5.6 — CaseCallLog için prisma.$transaction UPDATE YOK
  expect('5.6 CaseCallLog için update branch yok',
    /caseCallLog\.update\(/.test(src), false);
}

console.log('\n── 6) FK NULL + FK orphan unresolved (UPDATE\'e dahil değil) ──');
{
  // 6.1 — FK NULL satırlar collectRows içinde "unresolvedNullFkCount" olarak sayılır
  expect('6.1 FK NULL count sorgusu',
    /\[fkField\]:\s*null/.test(src), true);
  // 6.2 — FK orphan (User yok) "fkOrphan" listesine düşer
  expect('6.2 FK orphan ayrı listede',
    src.includes('const fkOrphan = []'), true);
  // 6.3 — ok listesi sadece userMap.has(fkUserId) olanları içerir
  expect('6.3 ok listesi User varsa eklenir',
    src.includes('const u = userMap.get(r[fkField]);'), true);
  // 6.4 — applyUpdates SADECE result.ok'i UPDATE'ler (fkOrphan ve unresolvedSamples'e dokunmaz)
  expect('6.4 applyUpdates yalnız ok listesi',
    /applyUpdates\([^)]+,\s*\w+\.ok\)/.test(src), true);
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
  // 8.1 — prisma.$disconnect dry-run sonunda
  expect('8.1 prisma.$disconnect dry-run branch',
    /if \(!EXECUTE\)[\s\S]{0,400}await prisma\.\$disconnect\(\)/.test(src), true);
  // 8.2 — prisma.$disconnect execute sonunda
  expect('8.2 prisma.$disconnect execute branch',
    /✅ Toplam[\s\S]{0,400}await prisma\.\$disconnect\(\)/.test(src) ||
    /Toplam[\s\S]{0,400}await prisma\.\$disconnect\(\)/.test(src), true);
  // 8.3 — Fatal catch'te disconnect
  expect('8.3 fatal catch disconnect + exit',
    /catch\s*\(\s*async\s*\(err\)\s*=>|main\(\)\.catch\([\s\S]{0,300}await prisma\.\$disconnect\(\)/.test(src), true);
}

console.log('\n── 9) Schema migration YOK ───────────────────────────────');
{
  // 9.1 — Script içinde executeRawUnsafe / $executeRaw / migration komutu YOK
  expect('9.1 $executeRaw kullanmıyor',
    src.includes('$executeRaw'), false);
  expect('9.2 prisma migrate çağrısı yok',
    /prisma migrate|migrateDeploy/.test(src), false);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
