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
  watcherRepo as _watcherRepo,
  linkRepo as _linkRepo,
  reactionRepo,
  notificationRepo,
  CaseAccessError,
  CaseValidationError,
} from '../server/db/caseRepository.js';
import { taxonomyDefRepo as _taxonomyDefRepo } from '../server/db/adminRepository.js';

export const TEST_ACTOR = Object.freeze({
  userId: 'smoke-test-actor',
  personId: null,
  fullName: 'Smoke Test Actor',
  email: 'smoke@test.local',
  role: 'SystemAdmin',
  displayName: 'Smoke Test Actor',
});

// wrapped caseRepository — PR-1 + PR-2 + PR-4 default actor inject.
// PR-1: create, addCallLog, addActivity, finalizeUpload
// PR-2: update, toggleChecklistItem, removeFile, bulkUpdate, transitionStatus,
//       snoozeCase, unsnoozeCase
// PR-4: requestUpload (actor.userId token binding için)
export const caseRepository = {
  ..._caseRepository,
  // PR-1 actor-object methods
  create: (input, actor = TEST_ACTOR) => _caseRepository.create(input, actor),
  addCallLog: (id, input, allowedCompanyIds, actor = TEST_ACTOR) =>
    _caseRepository.addCallLog(id, input, allowedCompanyIds, actor),
  addActivity: (caseId, input, allowedCompanyIds, actor = TEST_ACTOR) =>
    _caseRepository.addActivity(caseId, input, allowedCompanyIds, actor),
  finalizeUpload: (id, input, allowedCompanyIds, actor = TEST_ACTOR) =>
    _caseRepository.finalizeUpload(id, input, allowedCompanyIds, actor),
  // PR-2 string-actor methods (route layer req.user.fullName pass eder)
  update: (id, patch, actor = TEST_ACTOR.displayName, allowedCompanyIds, actorRole, actorPersonId = null) =>
    _caseRepository.update(id, patch, actor, allowedCompanyIds, actorRole, actorPersonId),
  toggleChecklistItem: (caseId, itemId, checked, actor = TEST_ACTOR.displayName, allowedCompanyIds) =>
    _caseRepository.toggleChecklistItem(caseId, itemId, checked, actor, allowedCompanyIds),
  removeFile: (id, fileId, actor = TEST_ACTOR.displayName, allowedCompanyIds) =>
    _caseRepository.removeFile(id, fileId, actor, allowedCompanyIds),
  bulkUpdate: (args, actor = TEST_ACTOR.displayName, allowedCompanyIds) =>
    _caseRepository.bulkUpdate(args, actor, allowedCompanyIds),
  transitionStatus: (id, nextStatus, payload = {}, actor = TEST_ACTOR.displayName, allowedCompanyIds) =>
    _caseRepository.transitionStatus(id, nextStatus, payload, actor, allowedCompanyIds),
  snoozeCase: (id, snoozeArgs, actor = TEST_ACTOR.displayName, allowedCompanyIds) =>
    _caseRepository.snoozeCase(id, snoozeArgs, actor, allowedCompanyIds),
  unsnoozeCase: (id, actor = TEST_ACTOR.displayName, allowedCompanyIds) =>
    _caseRepository.unsnoozeCase(id, actor, allowedCompanyIds),
  // PR-4 requestUpload — actor object zorunlu (token userId binding)
  requestUpload: (id, input, allowedCompanyIds, actor = TEST_ACTOR) =>
    _caseRepository.requestUpload(id, input, allowedCompanyIds, actor),
};

// PR-2 wrapped watcherRepo / linkRepo — actor zorunlu (string, default'tan
// kaldırıldı). Smoke fixture'da TEST_ACTOR.displayName ile fallback.
export const watcherRepo = {
  ..._watcherRepo,
  add: ({ caseId, userId, addedBy, allowedCompanyIds, actor = TEST_ACTOR.displayName }) =>
    _watcherRepo.add({ caseId, userId, addedBy, allowedCompanyIds, actor }),
  remove: ({ caseId, userId, allowedCompanyIds, actor = TEST_ACTOR.displayName }) =>
    _watcherRepo.remove({ caseId, userId, allowedCompanyIds, actor }),
};

export const linkRepo = {
  ..._linkRepo,
  add: ({ caseId, linkedCaseId, linkType, createdBy, allowedCompanyIds, actor = TEST_ACTOR.displayName }) =>
    _linkRepo.add({ caseId, linkedCaseId, linkType, createdBy, allowedCompanyIds, actor }),
  remove: ({ caseId, linkId, allowedCompanyIds, actor = TEST_ACTOR.displayName }) =>
    _linkRepo.remove({ caseId, linkId, allowedCompanyIds, actor }),
};

// PR-3 wrapped taxonomyDefRepo — smoke fixture default TEST_ACTOR.
// adminRepository.taxonomyDefRepo.create/update/remove actor object zorunlu.
export const taxonomyDefRepo = {
  ..._taxonomyDefRepo,
  create: (input, allowedCompanyIds, actor = TEST_ACTOR) =>
    _taxonomyDefRepo.create(input, allowedCompanyIds, actor),
  update: (id, patch, allowedCompanyIds, actor = TEST_ACTOR) =>
    _taxonomyDefRepo.update(id, patch, allowedCompanyIds, actor),
  remove: (id, allowedCompanyIds, actor = TEST_ACTOR) =>
    _taxonomyDefRepo.remove(id, allowedCompanyIds, actor),
};

export {
  mentionRepo,
  reactionRepo,
  notificationRepo,
  CaseAccessError,
  CaseValidationError,
};
