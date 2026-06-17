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

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
