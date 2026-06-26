import fs from 'node:fs';
import path from 'node:path';
import {
  explainDenyOnlyResourceAccess,
} from '../server/lib/authorizationRuntime.js';

const root = process.cwd();
let pass = 0;
let fail = 0;

function expect(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (ok) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.error(`✗ ${name}`);
    console.error(`  expected: ${expected}`);
    console.error(`  actual:   ${actual}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function countNeedle(content, needle) {
  return content.split(needle).length - 1;
}

const casesRoute = read('server/routes/cases.js');
const adminPage = read('src/features/admin/AdminAuthorizationPoliciesPage.tsx');
const envExample = read('.env.example');
const pkg = JSON.parse(read('package.json'));

expect('1.1 cases route imports authorization repository', /authorizationPolicyRepository/.test(casesRoute), true);
expect('1.2 cases route imports runtime error', /AuthorizationRuntimeError/.test(casesRoute), true);
expect('1.3 cases route imports deny-only assert helper', /assertDenyOnlyResourceAccess/.test(casesRoute), true);
expect('1.4 cases route resolves policy user from current user', /buildCurrentAuthorizationUser/.test(casesRoute), true);
expect('1.5 cases route resolves team id for team policies', /resolveAuthorizationTeamId/.test(casesRoute), true);
expect('1.6 asyncRoute maps AuthorizationRuntimeError', /err instanceof AuthorizationRuntimeError/.test(casesRoute), true);

expect('2.1 server feature flag exists', /AUTHORIZATION_RESOURCE_ENFORCEMENT_ENABLED/.test(casesRoute), true);
expect('2.2 flag defaults to disabled unless true', /process\.env\.AUTHORIZATION_RESOURCE_ENFORCEMENT_ENABLED === 'true'/.test(casesRoute), true);
expect('2.3 helper no-ops when flag disabled', /if \(!isAuthorizationResourceEnforcementEnabled\(\)\) return null/.test(casesRoute), true);
expect('2.4 helper loads case to derive companyId', /caseRepository\.get\(req\.params\.id/.test(casesRoute), true);
expect('2.5 helper loads active policy overrides by case company', /authorizationPolicyRepository\.listOverrides\(\s*c\.companyId/.test(casesRoute), true);

expect('3.1 note create guarded', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.note', action: 'create' \}\)/.test(casesRoute), true);
expect('3.2 note reply create guarded', countNeedle(casesRoute, "resourceKey: 'case.note', action: 'create'") >= 2, true);
expect('3.3 note delete guarded', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.note', action: 'delete' \}\)/.test(casesRoute), true);
expect('3.4 attachment upload-url create guarded', countNeedle(casesRoute, "resourceKey: 'case.attachment', action: 'create'") >= 2, true);
expect('3.5 attachment delete guarded', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.attachment', action: 'delete' \}\)/.test(casesRoute), true);
expect('3.6 case create guarded by company policy', /assertCompanyResourcePolicy\(req,[\s\S]*resourceKey: 'case'[\s\S]*action: 'create'/.test(casesRoute), true);
expect('3.7 case patch guarded by update', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case', action: 'update' \}\)[\s\S]*caseRepository\.update/.test(casesRoute), true);
expect('3.8 claim guarded by assign', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case', action: 'assign' \}\)[\s\S]*caseRepository\.claim/.test(casesRoute), true);
expect('3.9 transition guarded by computed action', /transitionResourceAction\(nextStatus\)/.test(casesRoute), true);
expect('3.10 transfer guarded by transfer action', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case', action: 'transfer' \}\)[\s\S]*caseRepository\.transferCase/.test(casesRoute), true);
expect('3.11 archive guarded by archive action', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case', action: 'archive' \}\)[\s\S]*caseRepository\.archive/.test(casesRoute), true);
expect('3.12 restore guarded by restore action', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case', action: 'restore' \}\)[\s\S]*caseRepository\.restore/.test(casesRoute), true);
expect('3.13 link-account guarded by update action', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case', action: 'update' \}\)[\s\S]*caseRepository\.linkAccount/.test(casesRoute), true);
expect('3.14 snooze guarded by update action', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case', action: 'update' \}\)[\s\S]*caseRepository\.snoozeCase/.test(casesRoute), true);
expect('3.15 checklist guarded by update action', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case', action: 'update' \}\)[\s\S]*caseRepository\.toggleChecklistItem/.test(casesRoute), true);
expect('3.16 solution step create guarded', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.solutionStep', action: 'create' \}\)[\s\S]*solutionStepRepository\.createManual/.test(casesRoute), true);
expect('3.17 solution step update guarded', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.solutionStep', action: 'update' \}\)[\s\S]*solutionStepRepository\.update/.test(casesRoute), true);
expect('3.18 solution step status guarded', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.solutionStep', action: 'update' \}\)[\s\S]*solutionStepRepository\.setStatus/.test(casesRoute), true);
expect('3.19 AI suggested step import guarded', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.solutionStep', action: 'create' \}\)[\s\S]*solutionStepRepository\.importAiSuggested/.test(casesRoute), true);
expect('3.20 company resource helper validates allowed company', /function assertCompanyResourcePolicy[\s\S]*company_forbidden/.test(casesRoute), true);
expect('3.21 terminal transition maps to close', /function transitionResourceAction[\s\S]*'Çözüldü'[\s\S]*'İptal Edildi'[\s\S]*'close'/.test(casesRoute), true);
expect('3.22 bulk update has dedicated resource helper', /async function assertBulkCaseResourcePolicy/.test(casesRoute), true);
expect('3.23 bulk assignment checks assign action', /function bulkResourceActions[\s\S]*assignedPersonId[\s\S]*assignedTeamId[\s\S]*actions\.add\('assign'\)/.test(casesRoute), true);
expect('3.24 bulk update guarded before repository call', /assertBulkCaseResourcePolicy\(req,[\s\S]*caseRepository\.bulkUpdate/.test(casesRoute), true);
expect('3.25 devops link guarded as case.link create', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.link', action: 'create' \}\)[\s\S]*caseRepository\.linkDevops/.test(casesRoute), true);
expect('3.26 devops unlink guarded as case.link delete', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.link', action: 'delete' \}\)[\s\S]*caseRepository\.unlinkDevops/.test(casesRoute), true);
expect('3.27 watcher add guarded', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.watcher', action: 'create' \}\)[\s\S]*watcherRepo\.add/.test(casesRoute), true);
expect('3.28 watcher remove guarded', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.watcher', action: 'delete' \}\)[\s\S]*watcherRepo\.remove/.test(casesRoute), true);
expect('3.29 linked case add guarded', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.link', action: 'create' \}\)[\s\S]*linkRepo\.add/.test(casesRoute), true);
expect('3.30 linked case remove guarded', /assertCaseResourcePolicy\(req, \{ resourceKey: 'case\.link', action: 'delete' \}\)[\s\S]*linkRepo\.remove/.test(casesRoute), true);

const agent = {
  id: 'user-agent',
  role: 'Agent',
  teamId: 'team-l1',
  companyRoles: ['COMP-UNIVERA:Agent'],
  allowedCompanyIds: ['COMP-UNIVERA'],
};
const denyNote = [{
  target: 'resource',
  resourceKey: 'case.note',
  action: 'create',
  effect: 'deny',
  principal: { type: 'team', key: 'team-l1' },
}];
const allowAttachment = [{
  target: 'resource',
  resourceKey: 'case.attachment',
  action: 'delete',
  effect: 'allow',
  principal: { type: 'systemRole', key: 'Agent' },
}];
expect('4.1 deny policy narrows baseline-allowed note create', explainDenyOnlyResourceAccess({
  resourceKey: 'case.note',
  action: 'create',
  user: agent,
  overrides: denyNote,
  baselineAllowed: true,
}).allowed, false);
expect('4.2 allow policy cannot widen baseline-denied attachment delete', explainDenyOnlyResourceAccess({
  resourceKey: 'case.attachment',
  action: 'delete',
  user: agent,
  overrides: allowAttachment,
  baselineAllowed: false,
}).reason, 'baseline_denied');

expect('5.1 admin page marks resource action pilot', /Kayıt işlemi pilot/.test(adminPage), true);
expect('5.2 admin page documents expanded case operation pilot endpoints', /vaka ana işlemleri, çözüm adımı, vaka notu, dosya, izleyici, bağlantı ve toplu güncelleme uçlarında flag ile pilot/.test(adminPage), true);
expect('5.3 resource enforcement env documented', /AUTHORIZATION_RESOURCE_ENFORCEMENT_ENABLED=false/.test(envExample), true);
expect('5.4 env docs state allow cannot widen', /Policy allow mevcut role\/backend guard'larını GENİŞLETMEZ/.test(envExample), true);
expect('5.5 smoke script registered', pkg.scripts['smoke:authorization-resource-enforcement'], 'node scripts/smoke-authorization-resource-enforcement-pilot-static.js');

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
