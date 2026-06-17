/**
 * Test actor fixture — sadece smoke scripts için.
 *
 * PR-1 (Codex P1 follow-up) sonrası caseRepository.create / addCallLog /
 * addActivity / finalizeUpload defansif throw atıyor — actor zorunlu.
 * Smoke scripts direct caller olduğundan production'daki req.user yerine
 * bu sabit fixture'ı kullanır.
 *
 * Kullanım: smoke'larda
 *   import { caseRepository } from '../server/db/caseRepository.js';
 * yerine
 *   import { caseRepository } from './_actor-fixture.js';
 *
 * wrapped caseRepository default TEST_ACTOR'ü her create-class çağrısında
 * pass eder. Smoke explicit actor verirse onu kullanır (override).
 *
 * Diğer named exports (mentionRepo, watcherRepo, reactionRepo, error
 * class'ları) pass-through re-export edilir.
 *
 * ASLA production code path'inden import edilmez.
 */

import {
  caseRepository as _caseRepository,
  mentionRepo,
  watcherRepo,
  linkRepo,
  reactionRepo,
  notificationRepo,
  CaseAccessError,
  CaseValidationError,
} from '../server/db/caseRepository.js';

export const TEST_ACTOR = Object.freeze({
  userId: 'smoke-test-actor',
  personId: null,
  fullName: 'Smoke Test Actor',
  email: 'smoke@test.local',
  role: 'SystemAdmin',
  displayName: 'Smoke Test Actor',
});

// wrapped caseRepository — 4 method default actor ile, gerisi pass-through.
export const caseRepository = {
  ..._caseRepository,
  create: (input, actor = TEST_ACTOR) => _caseRepository.create(input, actor),
  addCallLog: (id, input, allowedCompanyIds, actor = TEST_ACTOR) =>
    _caseRepository.addCallLog(id, input, allowedCompanyIds, actor),
  addActivity: (caseId, input, allowedCompanyIds, actor = TEST_ACTOR) =>
    _caseRepository.addActivity(caseId, input, allowedCompanyIds, actor),
  finalizeUpload: (id, input, allowedCompanyIds, actor = TEST_ACTOR) =>
    _caseRepository.finalizeUpload(id, input, allowedCompanyIds, actor),
};

export {
  mentionRepo,
  watcherRepo,
  linkRepo,
  reactionRepo,
  notificationRepo,
  CaseAccessError,
  CaseValidationError,
};
