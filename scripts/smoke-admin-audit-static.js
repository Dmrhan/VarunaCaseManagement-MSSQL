/**
 * smoke-admin-audit-static.js
 *
 * PR-3 — Admin taxonomy createdByUserId/updatedByUserId audit için
 * DB-bağımsız static smoke.
 *
 * Senaryolar:
 *   1) Schema: 6 model'de createdByUserId + updatedByUserId field'ı + FK relation
 *   2) Migration SQL: 6 model'e ALTER TABLE + FK constraint
 *   3) Repository: 6 model'in create/update method'unda assertActorObject
 *      + createdByUserId/updatedByUserId stamp
 *   4) Routes: 13 mutation endpoint'inde requireActor(req) + actor pass
 *   5) actor.js: assertActorObject helper'ı export edildi + sentinel reject
 *
 * Çalıştır:
 *   node scripts/smoke-admin-audit-static.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertActorObject, __internal as actorInternals } from '../server/lib/actor.js';

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
function expectThrows(name, fn) {
  try { fn(); bad(name, 'beklenen throw oluşmadı'); }
  catch { ok(name); }
}
function readFile(rel) { return readFileSync(path.join(REPO_ROOT, rel), 'utf8'); }

const MODELS_6 = [
  'Team',
  'CategoryDef',
  'SLAPolicy',
  'FieldDefinition',
  'TaxonomyDef',
  'ChecklistTemplate',
];

// ── 1) Schema: 6 model'de audit field + FK ───────────────────
console.log('── 1) Schema: 6 model audit field + FK relation ──────────');
{
  const schema = readFile('prisma/schema.prisma');
  let i = 1;
  for (const m of MODELS_6) {
    // Model bloğunu izole et
    const start = schema.indexOf(`model ${m} {`);
    const end = schema.indexOf('\n}\n', start);
    const block = start >= 0 ? schema.slice(start, end) : '';

    expect(`1.${i}a ${m} createdByUserId`, /createdByUserId\s+String\?/.test(block), true);
    expect(`1.${i}b ${m} updatedByUserId`, /updatedByUserId\s+String\?/.test(block), true);
    expect(`1.${i}c ${m} createdBy relation`, block.includes(`@relation("${m}CreatedBy"`), true);
    expect(`1.${i}d ${m} updatedBy relation`, block.includes(`@relation("${m}UpdatedBy"`), true);
    i += 1;
  }
  // User'da 12 reverse relation
  const userStart = schema.indexOf('model User {');
  const userEnd = schema.indexOf('\n}\n', userStart);
  const userBlock = schema.slice(userStart, userEnd);
  for (const m of MODELS_6) {
    expect(`1.7-${m} User reverse "${m}CreatedBy"`,
      userBlock.includes(`@relation("${m}CreatedBy")`), true);
    expect(`1.8-${m} User reverse "${m}UpdatedBy"`,
      userBlock.includes(`@relation("${m}UpdatedBy")`), true);
  }
}

// ── 2) Migration SQL: 6 ALTER TABLE + 12 FK constraint ───────
console.log('\n── 2) Migration SQL: ALTER + FK constraints ──────────────');
{
  const sql = readFile('prisma/migrations/00000000000004_admin_audit/migration.sql');
  let i = 1;
  for (const m of MODELS_6) {
    expect(`2.${i}a ${m} ALTER TABLE`,
      sql.includes(`ALTER TABLE [dbo].[${m}]\n  ADD [createdByUserId] NVARCHAR(450) NULL`), true);
    expect(`2.${i}b ${m} createdBy FK`,
      sql.includes(`CONSTRAINT [${m}_createdByUserId_fkey]`), true);
    expect(`2.${i}c ${m} updatedBy FK`,
      sql.includes(`CONSTRAINT [${m}_updatedByUserId_fkey]`), true);
    i += 1;
  }
}

// ── 3) Repository: 6 model assertActorObject + audit stamp ────
console.log('\n── 3) adminRepository: assertActorObject + stamp ─────────');
{
  const repo = readFile('server/db/adminRepository.js');
  expect('3.1 import assertActorObject',
    repo.includes("import { assertActorObject } from '../lib/actor.js'"), true);

  const where = [
    'teamRepo.create', 'teamRepo.update',
    'categoryRepo.createParent', 'categoryRepo.createSub', 'categoryRepo.update',
    'slaPolicyRepo.create', 'slaPolicyRepo.update',
    'checklistRepo.create', 'checklistRepo.update',
    'fieldDefinitionRepo.create', 'fieldDefinitionRepo.update', 'fieldDefinitionRepo.remove',
    'taxonomyDefRepo.create', 'taxonomyDefRepo.update', 'taxonomyDefRepo.remove',
  ];
  let i = 2;
  for (const w of where) {
    expect(`3.${i} ${w} assertActorObject`,
      repo.includes(`assertActorObject(actor, '${w}')`), true);
    i += 1;
  }

  // createdByUserId stamp en az 6 create method'unda
  const createdStamps = (repo.match(/createdByUserId: actor\.userId,?\s*\n\s*updatedByUserId: actor\.userId/g) || []).length;
  expect('3.17 createdByUserId+updatedByUserId stamp 6+ method',
    createdStamps >= 6, true);

  // updatedByUserId stamp her update'te
  const updatedOnlyStamps = (repo.match(/updatedByUserId: actor\.userId/g) || []).length;
  expect('3.18 updatedByUserId stamp toplam (create+update+remove) 15+',
    updatedOnlyStamps >= 15, true);
}

// ── 4) Routes: 13 mutation endpoint requireActor + actor pass ─
console.log('\n── 4) routes/admin.js: requireActor + actor pass ─────────');
{
  const route = readFile('server/routes/admin.js');
  expect('4.1 import requireActor',
    route.includes("import { requireActor } from '../lib/actor.js'"), true);

  // 14+ kullanım (her endpoint ayrı bir requireActor çağrısı)
  const calls = (route.match(/const actor = requireActor\(req\)/g) || []).length;
  expect('4.2 requireActor(req) çağrı sayısı ≥ 13', calls >= 13, true);

  // Spot-check: her endpoint'in actor pass ettiği
  function endpointHasActor(needle, methodName) {
    const idx = route.indexOf(needle);
    if (idx < 0) return false;
    const window = route.slice(idx, idx + 700);
    return window.includes('requireActor(req)') && window.includes(`${methodName}`) && window.includes(', actor');
  }
  expect('4.3 POST /teams',     endpointHasActor("router.post('/teams'",          'teamRepo.create'), true);
  expect('4.4 PATCH /teams/:id', endpointHasActor("router.patch('/teams/:id'",     'teamRepo.update'), true);
  expect('4.5 POST /sla-policies', endpointHasActor("router.post('/sla-policies'",   'slaPolicyRepo.create'), true);
  expect('4.6 POST /checklists',  endpointHasActor("router.post('/checklists'",    'checklistRepo.create'), true);
  expect('4.7 POST /field-definitions',
    endpointHasActor("router.post('/field-definitions'", 'fieldDefinitionRepo.create'), true);
  expect('4.8 POST /categories',  endpointHasActor("router.post('/categories'",    'categoryRepo.createParent'), true);
  expect('4.9 POST /categories/:parentId/sub',
    endpointHasActor("router.post('/categories/:parentId/sub'", 'categoryRepo.createSub'), true);
  expect('4.10 POST /taxonomy-defs',
    endpointHasActor("router.post('/taxonomy-defs'", 'taxonomyDefRepo.create'), true);
}

// ── 5) actor.js assertActorObject helper davranış testi ──────
console.log('\n── 5) assertActorObject helper davranışı ─────────────────');
{
  const goodActor = { userId: 'u_1', displayName: 'Demir Han' };
  expect('5.1 valid actor (geçer)',
    (() => { try { assertActorObject(goodActor, 'test'); return true; } catch { return false; } })(),
    true);

  expectThrows('5.2 null actor throws', () => assertActorObject(null, 'test'));
  expectThrows('5.3 string actor throws (object zorunlu)', () => assertActorObject('Demir', 'test'));
  expectThrows('5.4 userId yok', () => assertActorObject({ displayName: 'X' }, 'test'));
  expectThrows('5.5 displayName yok', () => assertActorObject({ userId: 'u' }, 'test'));
  expectThrows('5.6 sentinel "Mock User" displayName reddedilir',
    () => assertActorObject({ userId: 'u', displayName: 'Mock User' }, 'test'));
  expectThrows('5.7 sentinel "mock-user" displayName reddedilir',
    () => assertActorObject({ userId: 'u', displayName: 'mock-user' }, 'test'));

  // MOCK_USER_SENTINELS export
  expect('5.8 MOCK_USER_SENTINELS Set tanımlı',
    actorInternals.MOCK_USER_SENTINELS instanceof Set, true);
  expect('5.9 sentinel "Mock User" set\'te',
    actorInternals.MOCK_USER_SENTINELS.has('Mock User'), true);
}

// ── 6) Codex P2 follow-up: stripAuditFields + smoke fixture ──
console.log('\n── 6) Codex P2 follow-up: audit strip + smoke fixture ────');
{
  const repo = readFile('server/db/adminRepository.js');
  // 6.1 — stripAuditFields helper tanımlı
  expect('6.1 stripAuditFields helper',
    repo.includes('function stripAuditFields(obj)'), true);

  // 6.2 — SLA update'te stripAuditFields uygulanıyor
  expect('6.2 sLAPolicy update stripAuditFields',
    repo.includes('const dbPatch = stripAuditFields(toDb(patch))'), true);

  // 6.3 — SLA create'te de strip (safeInput pattern)
  expect('6.3 sLAPolicy create safeInput',
    repo.includes('const safeInput = stripAuditFields(input)'), true);

  // 6.4 — Smoke fixture taxonomyDefRepo wrapped
  const fixture = readFile('scripts/_actor-fixture.js');
  expect('6.4 fixture taxonomyDefRepo export',
    fixture.includes('export const taxonomyDefRepo'), true);
  expect('6.5 fixture taxonomyDefRepo create wrap',
    fixture.includes('create: (input, allowedCompanyIds, actor = TEST_ACTOR)'), true);

  // 6.6 — Taxonomy smoke fixture'a yönlendirildi
  const taxSmoke = readFile('scripts/smoke-smart-ticket-taxonomy-admin.js');
  expect('6.6 taxonomy smoke import _actor-fixture',
    taxSmoke.includes("import { taxonomyDefRepo } from './_actor-fixture.js'"), true);
  expect('6.7 eski adminRepository import kaldırıldı',
    taxSmoke.includes("from '../server/db/adminRepository.js'"), false);
}

// ── 7) PR-5 follow-up: update/transition/bulkUpdate actorObject ──
console.log('\n── 7) PR-5 follow-up: actorObject signature + route ─────');
{
  const repo = readFile('server/db/caseRepository.js');
  const route = readFile('server/routes/cases.js');

  // 7.1-3 — Repository signature'larında actorObject parametresi
  expect('7.1 update() actorObject parametresi',
    repo.includes('async update(id, patch, actor, allowedCompanyIds, actorRole, actorPersonId = null, actorObject = null)'), true);
  expect('7.2 transitionStatus() actorObject parametresi',
    repo.includes('async transitionStatus(id, nextStatus, payload = {}, actor, allowedCompanyIds, actorObject = null)'), true);
  expect('7.3 bulkUpdate() actorObject parametresi',
    repo.includes('async bulkUpdate({ caseIds, updates }, actor, allowedCompanyIds, actorObject = null)'), true);

  // 7.4-6 — Routes actorObject pass ediyor
  // PATCH /:id, transition, bulk-update — her birinde requireActor + actorObj pass
  const patchIdx = route.indexOf('PATCH /api/cases/:id');
  const patchBlock = route.slice(patchIdx, patchIdx + 600);
  expect('7.4 PATCH /:id requireActor + actorObj',
    patchBlock.includes('requireActor(req)') && patchBlock.includes('actorObj'), true);

  const bulkIdx = route.indexOf("'/bulk-update'");
  const bulkBlock = route.slice(bulkIdx, bulkIdx + 600);
  expect('7.5 POST /bulk-update requireActor + actorObj',
    bulkBlock.includes('requireActor(req)') && bulkBlock.includes('actorObj'), true);

  const transIdx = route.indexOf("'/:id/transition'");
  const transBlock = route.slice(transIdx, transIdx + 700);
  expect('7.6 POST /:id/transition requireActor + actorObj',
    transBlock.includes('requireActor(req)') && transBlock.includes('actorObj'), true);

  // 7.7-9 — Repository historyEntries actorUserId stamp
  expect('7.7 update historyEntries actorUserId stamp',
    repo.includes('actorUserId: actorUserIdOf(actorObject), // PR-5 follow-up'), true);
  expect('7.8 transitionStatus stampUid',
    repo.includes('const stampUid = actorUserIdOf(actorObject)'), true);
  expect('7.9 bulkUpdate actorUserId stamp',
    /historyEntries\.push\(\{[\s\S]{0,500}actorUserId:\s+actorUserIdOf\(actorObject\),\s+\/\/\s+PR-5 follow-up/.test(repo), true);
}

// ── 7b) Codex P2 follow-up: fixture DB-resolved real user ────
console.log('\n── 7b) Fixture resolves real user (no FK violation) ──────');
{
  const fixture = readFile('scripts/_actor-fixture.js');
  // 7b.1 — prisma import edildi (DB resolve için)
  expect('7b.1 fixture prisma import',
    fixture.includes("import { prisma } from '../server/db/client.js'"), true);
  // 7b.2 — resolveActorFromSeed async helper tanımlı
  expect('7b.2 resolveActorFromSeed async helper',
    fixture.includes('async function resolveActorFromSeed()'), true);
  // 7b.3 — prisma.user.findFirst kullanılıyor
  expect('7b.3 prisma.user.findFirst seeded user',
    fixture.includes('prisma.user.findFirst'), true);
  // 7b.4 — top-level await resolveActorFromSeed
  expect('7b.4 TEST_ACTOR top-level await resolve',
    fixture.includes('export const TEST_ACTOR = await resolveActorFromSeed()'), true);
  // 7b.5 — eski sentinel TEST_ACTOR object'inde DEĞİL (yorum referansı OK)
  expect('7b.5 userId: \'smoke-test-actor\' static literal yok',
    /userId:\s+['"]smoke-test-actor['"]/.test(fixture), false);
  // 7b.6 — fixture seed olmadığında açık throw (Error message)
  expect('7b.6 user yoksa açık throw (Error message)',
    fixture.includes("throw new Error"), true);
}

// ── 8) smoke-local-storage.js auth header ────────────────────
console.log('\n── 8) smoke-local-storage.js Authorization header ────────');
{
  const storage = readFile('scripts/smoke-local-storage.js');
  // 8.1 — raw PUT'ta Authorization Bearer
  expect('8.1 PUT Authorization Bearer accessToken',
    /method: 'PUT'[\s\S]{0,300}authorization: `Bearer \$\{accessToken\}`/.test(storage), true);
  // 8.2 — finalize body'sine token eklendi
  expect('8.2 finalize body token: up.token',
    storage.includes('token: up.token'), true);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
