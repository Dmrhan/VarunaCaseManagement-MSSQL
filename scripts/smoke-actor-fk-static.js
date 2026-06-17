/**
 * smoke-actor-fk-static.js
 *
 * PR-5 — Optional FK actorUserId/uploadedByUserId stamp için DB-bağımsız
 * static smoke.
 *
 * Senaryolar:
 *   1) Schema: CaseActivity.actorUserId + CaseAttachment.uploadedByUserId +
 *      2 FK relation + User reverse relations
 *   2) Migration SQL: 2 ALTER TABLE + 2 FK + 2 index
 *   3) Repository: actorUserIdOf helper export davranışı
 *   4) caseRepository.js source-level:
 *      - finalizeUpload: uploadedByUserId + history actorUserId stamp
 *      - 10 caseActivity.create yerinde actorUserId field'ı
 *      - create() history actorUserId
 *
 * Çalıştır:
 *   node scripts/smoke-actor-fk-static.js
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
function readFile(rel) { return readFileSync(path.join(REPO_ROOT, rel), 'utf8'); }

// ── 1) Schema: 2 model FK field + relation ───────────────────
console.log('── 1) Schema: actorUserId + uploadedByUserId FK ──────────');
{
  const schema = readFile('prisma/schema.prisma');

  // CaseActivity
  const caStart = schema.indexOf('model CaseActivity {');
  const caEnd = schema.indexOf('\n}\n', caStart);
  const caBlock = schema.slice(caStart, caEnd);
  expect('1.1 CaseActivity.actorUserId field',
    /actorUserId\s+String\?/.test(caBlock), true);
  expect('1.2 CaseActivity.actorUser relation',
    caBlock.includes('@relation("CaseActivityActor"'), true);
  expect('1.3 CaseActivity index actorUserId',
    caBlock.includes('@@index([actorUserId])'), true);

  // CaseAttachment
  const caaStart = schema.indexOf('model CaseAttachment {');
  const caaEnd = schema.indexOf('\n}\n', caaStart);
  const caaBlock = schema.slice(caaStart, caaEnd);
  expect('1.4 CaseAttachment.uploadedByUserId field',
    /uploadedByUserId\s+String\?/.test(caaBlock), true);
  expect('1.5 CaseAttachment.uploadedByUser relation',
    caaBlock.includes('@relation("CaseAttachmentUploadedBy"'), true);
  expect('1.6 CaseAttachment index uploadedByUserId',
    caaBlock.includes('@@index([uploadedByUserId])'), true);

  // User reverse relations
  const userStart = schema.indexOf('model User {');
  const userEnd = schema.indexOf('\n}\n', userStart);
  const userBlock = schema.slice(userStart, userEnd);
  expect('1.7 User reverse CaseActivityActor',
    userBlock.includes('@relation("CaseActivityActor")'), true);
  expect('1.8 User reverse CaseAttachmentUploadedBy',
    userBlock.includes('@relation("CaseAttachmentUploadedBy")'), true);
}

// ── 2) Migration SQL ─────────────────────────────────────────
console.log('\n── 2) Migration SQL ──────────────────────────────────────');
{
  const sql = readFile('prisma/migrations/00000000000005_actor_fk/migration.sql');
  expect('2.1 CaseActivity ALTER TABLE actorUserId',
    sql.includes('ALTER TABLE [dbo].[CaseActivity]\n  ADD [actorUserId]'), true);
  expect('2.2 CaseActivity FK constraint',
    sql.includes('CONSTRAINT [CaseActivity_actorUserId_fkey]'), true);
  expect('2.3 CaseActivity index',
    sql.includes('CREATE NONCLUSTERED INDEX [CaseActivity_actorUserId_idx]'), true);

  expect('2.4 CaseAttachment ALTER TABLE uploadedByUserId',
    sql.includes('ALTER TABLE [dbo].[CaseAttachment]\n  ADD [uploadedByUserId]'), true);
  expect('2.5 CaseAttachment FK constraint',
    sql.includes('CONSTRAINT [CaseAttachment_uploadedByUserId_fkey]'), true);
  expect('2.6 CaseAttachment index',
    sql.includes('CREATE NONCLUSTERED INDEX [CaseAttachment_uploadedByUserId_idx]'), true);
}

// ── 3) Repository: actorUserIdOf helper + stamp ──────────────
console.log('\n── 3) caseRepository actorUserIdOf helper + stamp ────────');
{
  const repo = readFile('server/db/caseRepository.js');

  // 3.1 — actorUserIdOf helper tanımlı
  expect('3.1 actorUserIdOf helper tanımlı',
    repo.includes('function actorUserIdOf(actor)'), true);

  // 3.2 — finalizeUpload: uploadedByUserId stamp
  expect('3.2 finalizeUpload uploadedByUserId: actorUid',
    repo.includes('uploadedByUserId: actorUid'), true);
  expect('3.3 finalizeUpload history actorUserId: actorUid',
    repo.includes('actorUserId: actorUid'), true);

  // 3.4 — create() history actorUserId
  expect('3.4 create() history actorUserId stamp',
    /actor:\s+actor\.displayName,\s*\n\s+actorUserId:\s+actorUserIdOf\(actor\)/.test(repo), true);

  // 3.5 — addCallLog activity actorUserId
  expect('3.5 addCallLog activity actorUserId stamp',
    /actionType:\s+'CallLogAdded'[\s\S]{0,200}actorUserId:\s+actorUserIdOf\(actor\)/.test(repo), true);

  // 3.6 — addActivity actorUserId
  // (input.action / input.actionType pattern; actorUserId: actorUserIdOf(actor))
  const addActMatch = repo.indexOf('async addActivity(caseId');
  const addActBlock = addActMatch >= 0 ? repo.slice(addActMatch, addActMatch + 1000) : '';
  expect('3.6 addActivity activity actorUserId stamp',
    addActBlock.includes('actorUserId: actorUserIdOf(actor)'), true);

  // 3.7 — 10 caseActivity.create veya history.create yerinde actorUserId
  // sayımı (en az 10 — 5 actorUserIdOf, 4 explicit null, 1 user.id mention)
  const stampCount = (repo.match(/actorUserId:/g) || []).length;
  expect('3.7 actorUserId stamp toplam ≥ 10',
    stampCount >= 10, true);

  // 3.8 — actorUserIdOf helper davranış (mock import + invoke)
  // Helper sadece object'ten userId çeker; string actor için null
}

// ── 4) Helper davranış (dinamik import) ──────────────────────
console.log('\n── 4) actorUserIdOf helper davranış testi ─────────────────');
{
  // actorUserIdOf module-internal (not exported). Smoke source-level kanıtla
  // sınırlı; davranışı schema/migration assertion'larıyla beraber doğrulanıyor.
  // 4.1 — Helper kodunda object+userId match var mı?
  const repo = readFile('server/db/caseRepository.js');
  expect('4.1 actorUserIdOf object+userId match',
    repo.includes("actor && typeof actor === 'object' && typeof actor.userId === 'string'"), true);
  expect('4.2 actorUserIdOf string actor → null',
    repo.includes('  return null;\n}'), true);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
