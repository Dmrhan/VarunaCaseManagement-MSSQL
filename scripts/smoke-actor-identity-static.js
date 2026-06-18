/**
 * smoke-actor-identity-static.js
 *
 * PR-1 — Server-authoritative actor for critical case flows için
 * DB-bağımsız static smoke.
 *
 * Senaryolar:
 *   1) server/lib/actor.js requireActor / getActorDisplayName / buildActorContext
 *      - happy path + edge cases (null, trim, fallback chain)
 *      - 401 throw eksik auth
 *   2) Source code level assertion: kritik 4 method'da 'Mock User' /
 *      'mock-user' YOK
 *   3) Source code level: routes 4 endpoint requireActor() çağrısı YAPIYOR
 *   4) caseRepository signature: 4 method actor parametresi alıyor
 *
 * Çalıştır:
 *   node scripts/smoke-actor-identity-static.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  requireActor,
  getActorDisplayName,
  buildActorContext,
  ActorRequiredError,
} from '../server/lib/actor.js';

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
function expectThrows(name, fn, errorName) {
  try {
    fn();
    bad(name, 'beklenen throw oluşmadı');
  } catch (err) {
    if (errorName && err?.name !== errorName) {
      bad(name, `err.name=${err?.name} expected=${errorName}`);
    } else {
      ok(name);
    }
  }
}
function readFile(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

// ── 1) requireActor / getActorDisplayName / buildActorContext ────
console.log('── 1) Actor helper happy path ────────────────────────────');
{
  const req = {
    user: { id: 'u_1', fullName: 'Demir Han', email: 'demir@test.local', role: 'Admin', personId: 'p_1' },
  };
  const a = requireActor(req);
  expect('1.1 userId', a.userId, 'u_1');
  expect('1.2 displayName = fullName', a.displayName, 'Demir Han');
  expect('1.3 personId', a.personId, 'p_1');
  expect('1.4 role', a.role, 'Admin');

  // 1.5 — fullName boş → email fallback
  const a2 = requireActor({ user: { id: 'u_2', fullName: '  ', email: 'sa@test.local', role: 'SystemAdmin' } });
  expect('1.5 fullName boş → email', a2.displayName, 'sa@test.local');

  // 1.6 — fullName + email yok → id fallback
  const a3 = requireActor({ user: { id: 'u_3' } });
  expect('1.6 hiç ad/email yok → userId', a3.displayName, 'u_3');

  // 1.7 — personId yok → null
  expect('1.7 personId null defansif', a3.personId, null);

  // 1.8 — displayName ASLA 'Mock User' DEĞİL
  expect('1.8 displayName ≠ "Mock User"', a.displayName === 'Mock User', false);
  expect('1.9 displayName ≠ "mock-user"', a.displayName === 'mock-user', false);
}

console.log('\n── 2) requireActor: eksik auth → ActorRequiredError ─────');
{
  expectThrows('2.1 req.user yok', () => requireActor({}), 'ActorRequiredError');
  expectThrows('2.2 req.user null', () => requireActor({ user: null }), 'ActorRequiredError');
  expectThrows('2.3 req.user.id eksik', () => requireActor({ user: { fullName: 'x' } }), 'ActorRequiredError');
  expectThrows('2.4 req.user.id boş', () => requireActor({ user: { id: '' } }), 'ActorRequiredError');
  expectThrows('2.5 req.user.id number', () => requireActor({ user: { id: 123 } }), 'ActorRequiredError');
  expectThrows('2.6 buildActorContext null user', () => buildActorContext(null), 'ActorRequiredError');

  // 2.7 — ActorRequiredError.status = 401
  try { requireActor({}); }
  catch (err) { expect('2.7 status=401', err.status, 401); }
}

console.log('\n── 3) getActorDisplayName direct ─────────────────────────');
{
  expect('3.1 null user → null', getActorDisplayName(null), null);
  expect('3.2 trim fullName', getActorDisplayName({ id: 'u', fullName: '  X  ' }), 'X');
  expect('3.3 email fallback (fullName boş)',
    getActorDisplayName({ id: 'u', fullName: '', email: 'a@b' }), 'a@b');
  expect('3.4 trim email',
    getActorDisplayName({ id: 'u', email: '  a@b  ' }), 'a@b');
  expect('3.5 id son çare',
    getActorDisplayName({ id: 'u_only' }), 'u_only');
  expect('3.6 boş user → null',
    getActorDisplayName({}), null);
}

// ── 4) Source code: 'Mock User' kritik flow'larda YOK ────────
console.log('\n── 4) caseRepository.js: \'Mock User\'/\'mock-user\' kritik akışlarda yok ──');
{
  const src = readFile('server/db/caseRepository.js');

  // Kritik 4 method'un blok'larını izole et — bir sonraki "async " başlangıcına kadar.
  // 4000-karakter slice diğer method'lardaki 'Mock User' string'lerini yanlış yakalıyordu
  // (toggleChecklistItem/snooze/removeFile/transitionStatus PR-2 scope).
  const slice = (re) => {
    const m = src.match(re);
    if (!m) return '';
    const start = m.index;
    const next = src.indexOf('\n  async ', start + 50);
    return next > start ? src.slice(start, next) : src.slice(start);
  };

  const createBlock = slice(/async\s+create\s*\(input,\s*actor\)/);
  expect('4.1 create() actor parametresi alıyor', createBlock.length > 0, true);
  expect('4.2 create() bloğunda "Mock User" yok',
    createBlock.includes("'Mock User'"), false);

  const callLogBlock = slice(/async\s+addCallLog\s*\(id,\s*input,\s*allowedCompanyIds,\s*actor\)/);
  expect('4.3 addCallLog() actor parametresi alıyor', callLogBlock.length > 0, true);
  expect('4.4 addCallLog() bloğunda "Mock User" yok',
    callLogBlock.includes("'Mock User'"), false);
  expect('4.5 addCallLog() bloğunda "mock-user" yok',
    callLogBlock.includes("'mock-user'"), false);
  // 4.6 — callerId artık actor.userId
  expect('4.6 callerId: actor.userId pattern',
    callLogBlock.includes('callerId: actor.userId'), true);

  const activityBlock = slice(/async\s+addActivity\s*\(caseId,\s*input,\s*allowedCompanyIds,\s*actor\)/);
  expect('4.7 addActivity() actor parametresi alıyor', activityBlock.length > 0, true);
  expect('4.8 addActivity() bloğunda "Mock User" yok',
    activityBlock.includes("'Mock User'"), false);
  expect('4.9 addActivity() actor: actor.displayName',
    activityBlock.includes('actor: actor.displayName'), true);

  const finalizeBlock = slice(/async\s+finalizeUpload\s*\(id,\s*input,\s*allowedCompanyIds,\s*actor\)/);
  expect('4.10 finalizeUpload() actor parametresi alıyor', finalizeBlock.length > 0, true);
  expect('4.11 finalizeUpload() bloğunda "Mock User" yok',
    finalizeBlock.includes("'Mock User'"), false);

  // 4.12 — Kritik 4 method'un toplam dilimi içinde 'Mock User' veya
  // 'mock-user' string'i geçmiyor (her birinin kendi izolasyonu ek olarak
  // doğrulandı 4.1-4.11). Bu, regression koruyucusudur.
  const blocks = [createBlock, callLogBlock, activityBlock, finalizeBlock].join('\n');
  expect('4.12 4 kritik bloğun toplamında "Mock User" yok',
    blocks.includes("'Mock User'"), false);
  expect('4.13 4 kritik bloğun toplamında "mock-user" yok',
    blocks.includes("'mock-user'"), false);
}

// ── 5) Source code: routes 4 endpoint requireActor() kullanıyor ──
console.log('\n── 5) routes/cases.js: 4 endpoint requireActor() kullanıyor ──');
{
  const src = readFile('server/routes/cases.js');
  expect('5.1 requireActor import',
    src.includes("import { requireActor } from '../lib/actor.js'"), true);
  // 4 farklı requireActor(req) çağrısı bekleniyor (4 endpoint)
  const calls = (src.match(/requireActor\(req\)/g) || []).length;
  expect('5.2 requireActor(req) en az 4 çağrı', calls >= 4, true);

  // 5.3-5.6: her endpoint'in body'sinde requireActor + actor pass var mı?
  function endpointHasActor(needle) {
    const idx = src.indexOf(needle);
    if (idx < 0) return false;
    const window = src.slice(idx, idx + 800);
    return window.includes('requireActor(req)') && window.includes('actor');
  }
  expect('5.3 POST /api/cases (create)',
    endpointHasActor("/** POST /api/cases — yeni vaka."), true);
  expect('5.4 POST /api/cases/:id/call-logs',
    endpointHasActor('/** POST /api/cases/:id/call-logs */'), true);
  expect('5.5 POST /api/cases/:id/activity',
    endpointHasActor('/** POST /api/cases/:id/activity'), true);
  expect('5.6 POST /api/cases/:id/files/finalize',
    src.indexOf("'/:id/files/finalize'") > 0 &&
    src.slice(src.indexOf("'/:id/files/finalize'"), src.indexOf("'/:id/files/finalize'") + 800).includes('requireActor(req)'),
    true);
}

// ── 6) ActorRequiredError class shape ────────────────────────
console.log('\n── 6) ActorRequiredError ─────────────────────────────────');
{
  const err = new ActorRequiredError();
  expect('6.1 name', err.name, 'ActorRequiredError');
  expect('6.2 status=401', err.status, 401);
  expect('6.3 default message', err.message, 'unauthenticated');
  const err2 = new ActorRequiredError('custom');
  expect('6.4 custom message', err2.message, 'custom');
}

// ── 7) Codex P1 follow-up: defansif throw + fixture re-export ──
console.log('\n── 7) Defansif throw + smoke fixture (Codex P1) ──────────');
{
  // 7.1-7.5 — caseRepository.js: assertActor helper'ı 4 method'da çağrılıyor
  const repoSrc = readFile('server/db/caseRepository.js');
  expect('7.1 ActorRequiredError import',
    repoSrc.includes("import { ActorRequiredError } from '../lib/actor.js'"), true);
  expect('7.2 assertActor helper tanımlı',
    repoSrc.includes('function assertActor('), true);
  expect('7.3 create() assertActor çağrısı',
    repoSrc.includes("assertActor(actor, 'caseRepository.create')"), true);
  expect('7.4 addCallLog() assertActor + userId check',
    repoSrc.includes("assertActor(actor, 'caseRepository.addCallLog')") &&
      repoSrc.includes('actor.userId required'), true);
  expect('7.5 addActivity() + finalizeUpload() assertActor',
    repoSrc.includes("assertActor(actor, 'caseRepository.addActivity')") &&
      repoSrc.includes("assertActor(actor, 'caseRepository.finalizeUpload')"), true);

  // 7.6-7.8 — smoke fixture file mevcut + doğru shape
  const fixtureSrc = readFile('scripts/_actor-fixture.js');
  expect('7.6 TEST_ACTOR export',
    fixtureSrc.includes('export const TEST_ACTOR'), true);
  expect('7.7 wrapped caseRepository export',
    fixtureSrc.includes('export const caseRepository'), true);
  expect('7.8 4 method wrapped',
    fixtureSrc.includes('create: (input, actor = TEST_ACTOR)') &&
      fixtureSrc.includes('addCallLog:') &&
      fixtureSrc.includes('addActivity:') &&
      fixtureSrc.includes('finalizeUpload:'), true);

  // 7.9 — 16 smoke direct caller fixture'a yönlendirildi
  const smokeFiles = [
    'smoke-account-phase-c2.js', 'smoke-account-new-case-prefill.js',
    'smoke-action-center-phase1.js', 'smoke-case-note-safety.js',
    'smoke-customer-response-channel.js', 'smoke-customerless-case-flow.js',
    'smoke-generic-notification-flow.js', 'smoke-mention-inline-reply-flow.js',
    'smoke-mention-inbox-flow.js', 'smoke-notification-flow.js',
    'smoke-smart-ticket-closure.js', 'smoke-resolution-approval-flow.js',
    'smoke-smart-ticket-kb-drafts.js', 'smoke-smart-ticket-intake.js',
    'smoke-smart-ticket-solution-steps.js', 'smoke-smart-ticket-transfer.js',
  ];
  let migrated = 0;
  let oldPathLeft = 0;
  for (const f of smokeFiles) {
    const s = readFile(`scripts/${f}`);
    if (s.includes("from './_actor-fixture.js'")) migrated += 1;
    if (s.includes("from '../server/db/caseRepository.js'")) oldPathLeft += 1;
  }
  expect('7.9 16/16 smoke fixture\'a yönlendirildi', migrated, 16);
  expect('7.10 eski caseRepository import kalmamış',  oldPathLeft, 0);

  // 7.11 — Direct repository call (helpers'sız) actor=null ile throw atmalı
  // (functional behavior assertion — fixture wrapper'ı bypass ederek)
  // Bu test repo modülü dinamik import etmeyi gerektirir.
}

// ── 8) PR-2 — kalan 11 method'da default 'Mock User' kaldırıldı ─
console.log('\n── 8) PR-2: caseRepository.js 11 method default temizlendi ──');
{
  const repoSrc = readFile('server/db/caseRepository.js');
  // 8.1 — Tüm dosyada SADECE 2 yerde 'Mock User' string'i kalmalı:
  //   1) MOCK_USER_SENTINELS Set tanımında (reddetme listesi)
  //   2) Yorum açıklamasında
  // Hiçbir actor= default param'ında olmamalı.
  const defaultParamMatches = repoSrc.match(/actor\s*=\s*'Mock User'/g);
  expect('8.1 actor=\'Mock User\' default param sayısı 0',
    defaultParamMatches === null ? 0 : defaultParamMatches.length, 0);
  const defaultMockUser = repoSrc.match(/actor\s*=\s*'mock-user'/g);
  expect('8.2 actor=\'mock-user\' default param sayısı 0',
    defaultMockUser === null ? 0 : defaultMockUser.length, 0);

  // 8.3-8.13 — 11 method assertActor çağrısı
  const methods = [
    'caseRepository.update',
    'caseRepository.toggleChecklistItem',
    'caseRepository.removeFile',
    'caseRepository.bulkUpdate',
    'caseRepository.transitionStatus',
    'caseRepository.snoozeCase',
    'caseRepository.unsnoozeCase',
    'watcherRepo.add',
    'watcherRepo.remove',
    'linkRepo.add',
    'linkRepo.remove',
  ];
  let i = 3;
  for (const m of methods) {
    expect(`8.${i} ${m} assertActor çağrısı`,
      repoSrc.includes(`assertActor(actor, '${m}')`), true);
    i += 1;
  }

  // 8.14 — MOCK_USER_SENTINELS Set'i tanımlı
  expect('8.14 MOCK_USER_SENTINELS tanımlı',
    repoSrc.includes("const MOCK_USER_SENTINELS = new Set(['Mock User'"), true);

  // 8.15 — assertActor hybrid (string + object kabul)
  expect('8.15 assertActor hybrid string check',
    repoSrc.includes("if (typeof actor === 'string')"), true);
}

// ── 9) PR-4 — Upload two-step user binding ─────────────────
console.log('\n── 9) PR-4: storage token userId + finalize match ───────');
{
  const storageSrc = readFile('server/db/storage.js');
  const repoSrc = readFile('server/db/caseRepository.js');
  const routeSrc = readFile('server/routes/cases.js');
  const frontSrc = readFile('src/services/caseService.ts');

  // 9.1 — storage.createUploadUrl signature'a userId eklendi
  expect('9.1 createUploadUrl(caseId, attachmentId, fileName, userId)',
    storageSrc.includes('export async function createUploadUrl(caseId, attachmentId, fileName, userId)'), true);

  // 9.2 — token payload'ında userId
  expect('9.2 token payload userId field',
    storageSrc.includes("{ typ: 'upload', caseId, path: relPath, userId }"), true);

  // 9.3 — createUploadUrl userId varlık kontrolü
  expect('9.3 userId zorunlu (StorageError)',
    storageSrc.includes('createUploadUrl: userId required'), true);

  // 9.4-9.5 — caseRepository.requestUpload actor zorunlu + actor.userId ile binding
  expect('9.4 requestUpload(id, input, allowedCompanyIds, actor)',
    repoSrc.includes('async requestUpload(id, input, allowedCompanyIds, actor)'), true);
  expect('9.5 createUploadUrl(... , actor.userId) çağrısı',
    repoSrc.includes('createUploadUrl(id, attachmentId, input.fileName, actor.userId)'), true);

  // 9.6-9.8 — finalizeUpload token verify + userId match
  expect('9.6 verifyStorageToken import',
    repoSrc.includes("verifyStorageToken } from './storage.js'"), true);
  expect('9.7 finalize token verify',
    repoSrc.includes('const tokenPayload = verifyStorageToken(input.token)'), true);
  expect('9.8 finalize userId mismatch reddedilir',
    repoSrc.includes('tokenPayload.userId !== actor.userId'), true);

  // 9.9 — route /upload-url actor pass ediyor
  const uploadUrlRoute = routeSrc.indexOf("'/:id/files/upload-url'");
  const uploadUrlBlock = routeSrc.slice(uploadUrlRoute, uploadUrlRoute + 600);
  expect('9.9 /upload-url route actor pass ediyor',
    uploadUrlBlock.includes('requireActor(req)') && uploadUrlBlock.includes('actor,'), true);

  // 9.10 — requestUpload return shape token içeriyor
  expect('9.10 requestUpload response token içeriyor',
    repoSrc.includes("return { uploadUrl: signedUrl, path, attachmentId, token }"), true);

  // 9.11 — Frontend finalize body'sine token ekledi
  expect('9.11 frontend finalize body token: upload.token',
    frontSrc.includes('token: upload.token'), true);

  // 9.12 — Frontend upload-url response tipi token: string içeriyor
  expect('9.12 frontend upload response token: string',
    frontSrc.includes('attachmentId: string; token: string'), true);

  // ── 9.13+ — Codex P2 follow-up: PUT user binding enforcement ──
  // 9.13 — PUT route'unda inline verifyJwt middleware
  const putRoute = routeSrc.indexOf("router.put(\n  '/:id/files/upload'");
  const putBlock = putRoute >= 0 ? routeSrc.slice(putRoute, putRoute + 1500) : '';
  expect('9.13 PUT route inline verifyJwt middleware',
    /router\.put\(\s*['"]\/?:id\/files\/upload['"]\s*,\s*verifyJwt/.test(putBlock), true);

  // 9.14 — PUT handler payload.userId !== req.user?.id check
  expect('9.14 PUT handler userId mismatch reddedilir',
    putBlock.includes('payload.userId !== req.user?.id'), true);

  // 9.15 — PUT 403 user_mismatch
  expect('9.15 PUT 403 user_mismatch response',
    putBlock.includes("'user_mismatch'"), true);

  // 9.16 — Frontend XHR PUT Authorization header
  expect('9.16 frontend XHR PUT Authorization Bearer',
    frontSrc.includes("xhr.setRequestHeader('Authorization', `Bearer ${jwt}`)"), true);

  // 9.17 — Frontend getAccessToken çağrısı PUT'tan önce
  const xhrIdx = frontSrc.indexOf("xhr.open('PUT'");
  expect('9.17 frontend jwt PUT öncesi alınır',
    xhrIdx >= 0 && frontSrc.slice(0, xhrIdx).includes('const jwt = await getAccessToken()'), true);
}

// ── 10) PR-6 — addNote + addReply server-authoritative ─────
console.log('\n── 10) PR-6: notes + reply path server-authoritative ──────');
{
  const routeSrc = readFile('server/routes/cases.js');
  const repoSrc  = readFile('server/db/caseRepository.js');
  const svcSrc   = readFile('src/services/caseService.ts');

  // 10.1 — POST /:id/notes route requireActor + actor pass
  const notesRouteIdx = routeSrc.indexOf("'/:id/notes',");
  const notesRouteBlock = notesRouteIdx >= 0 ? routeSrc.slice(notesRouteIdx, notesRouteIdx + 1000) : '';
  expect('10.1 POST /:id/notes requireActor(req)',
    notesRouteBlock.includes('requireActor(req)'), true);
  expect('10.2 POST /:id/notes actor pass (5. arg)',
    /caseRepository\.addNote\(\s*req\.params\.id,[\s\S]{0,200}actor,/.test(notesRouteBlock), true);

  // 10.3 — POST /:id/notes/:noteId/reply route requireActor + actor pass
  const replyRouteIdx = routeSrc.indexOf("'/:id/notes/:noteId/reply'");
  const replyRouteBlock = replyRouteIdx >= 0 ? routeSrc.slice(replyRouteIdx, replyRouteIdx + 1200) : '';
  expect('10.3 POST /:id/notes/:noteId/reply requireActor(req)',
    replyRouteBlock.includes('requireActor(req)'), true);
  expect('10.4 POST /reply actor pass (6. arg)',
    /caseRepository\.addReply\([\s\S]{0,300}actor,/.test(replyRouteBlock), true);

  // 10.5 — caseRepository.addNote signature: actor opsiyonel param
  expect('10.5 addNote(id, note, allowedCompanyIds, mentionedBy, actor)',
    /async\s+addNote\s*\(id,\s*note,\s*allowedCompanyIds,\s*mentionedBy,\s*actor\)/.test(repoSrc), true);

  // 10.6 — caseRepository.addReply signature: actor opsiyonel param
  expect('10.6 addReply(caseId, noteId, reply, allowedCompanyIds, mentionedBy, actor)',
    /async\s+addReply\s*\(caseId,\s*noteId,\s*reply,\s*allowedCompanyIds,\s*mentionedBy,\s*actor\)/.test(repoSrc), true);

  // 10.7-10.9 — _addNoteWriteAndEmit body server-side actor override
  expect('10.7 _addNoteWriteAndEmit actor param alıyor',
    /async\s+function\s+_addNoteWriteAndEmit\s*\(\{[\s\S]{0,200}actor\s*\}\)/.test(repoSrc), true);
  expect('10.8 _addNoteWriteAndEmit effectiveAuthorName = actor?.displayName',
    repoSrc.includes('const effectiveAuthorName = actor?.displayName ?? note.authorName'), true);
  expect('10.9 _addNoteWriteAndEmit effectiveAuthorUserId = actor?.userId',
    repoSrc.includes('const effectiveAuthorUserId = actor?.userId ?? mentionedBy ?? null'), true);

  // 10.10 — addReply body server-side override pattern
  expect('10.10 addReply effectiveAuthorName = actor?.displayName',
    repoSrc.includes('const effectiveAuthorName = actor?.displayName ?? reply.authorName'), true);

  // 10.11 — Service tip: addNote / addReply authorName opsiyonel
  expect('10.11 caseService.addNote authorName opsiyonel',
    /addNote\([\s\S]{0,200}authorName\?:\s*string/.test(svcSrc), true);
  expect('10.12 caseService.addReply authorName opsiyonel',
    /addReply\([\s\S]{0,400}authorName\?:\s*string/.test(svcSrc), true);

  // 10.13 — FE runtime dosyalarında 'Mock User' literal yok (whitelist hariç)
  const runtimeFEFiles = [
    'src/components/ui/QuickNotePopover.tsx',
    'src/features/cases/StatusTransitionPanel.tsx',
    'src/features/cases/CaseDetailPage.tsx',
  ];
  for (const f of runtimeFEFiles) {
    const src = readFile(f);
    const hits = src.match(/'Mock User'/g);
    expect(`10.13 ${f}: 'Mock User' literal yok`,
      hits === null ? 0 : hits.length, 0);
  }

  // 10.14 — caseService USE_MOCK fallback acceptable (TEST-ONLY whitelist)
  // Production fetch path'inde body.authorName göndermek yasak değil; backend
  // ignore eder (Fix #2 _addNoteWriteAndEmit override). FE literal 'Mock User'
  // assertion'ı 10.13'te yapıldı.

  // 10.15 — Backend runtime'da "?? 'Mock User'" pattern YOK (audit guard)
  const repoMockFallback = repoSrc.match(/\?\?\s*'Mock User'/g);
  expect('10.15 caseRepository.js içinde "?? \'Mock User\'" fallback yok',
    repoMockFallback === null ? 0 : repoMockFallback.length, 0);
  const routeMockFallback = routeSrc.match(/\?\?\s*'Mock User'/g);
  expect('10.16 routes/cases.js içinde "?? \'Mock User\'" fallback yok',
    routeMockFallback === null ? 0 : routeMockFallback.length, 0);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
