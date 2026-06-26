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
const accountsRoute = read('server/routes/accounts.js');
const reportsRoute = read('server/routes/reports.js');
const reportViewsRoute = read('server/routes/reportViews.js');
const routeGuards = read('server/lib/authorizationRouteGuards.js');
const authzRepo = read('server/db/authorizationPolicyRepository.js');
const adminPage = read('src/features/admin/AdminAuthorizationPoliciesPage.tsx');
const adminService = read('src/services/adminService.ts');
const envExample = read('.env.example');
const helpContents = read('src/features/admin/helpContents.ts');
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
expect('3.23 bulk assignment checks assign action', /function bulkResourceActions[\s\S]*const hasAssignment[\s\S]*assignedPersonId[\s\S]*assignedTeamId[\s\S]*if \(hasAssignment\) actions\.add\('assign'\)/.test(casesRoute), true);
expect('3.23b bulk update action only comes from priority/status', /function bulkResourceActions[\s\S]*const hasGeneralUpdate[\s\S]*updates\.priority[\s\S]*updates\.status[\s\S]*if \(hasGeneralUpdate\) actions\.add\('update'\)/.test(casesRoute), true);
expect('3.23c pure assignment does not seed update action', /const actions = new Set\(\)[\s\S]*if \(hasGeneralUpdate\) actions\.add\('update'\)[\s\S]*if \(hasAssignment\) actions\.add\('assign'\)/.test(casesRoute), true);
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

expect('6.1 shared route guard exports resource feature flag', /export function isAuthorizationResourceEnforcementEnabled/.test(routeGuards), true);
expect('6.2 shared route guard enforces company resource policy', /export async function assertCompanyResourcePolicy/.test(routeGuards), true);
expect('6.3 shared route guard supports company subset filtering', /export async function filterAllowedCompanyIdsByResourcePolicy/.test(routeGuards), true);
expect('6.4 shared route guard supports account-scoped policy checks', /export async function assertAccountResourcePolicy/.test(routeGuards), true);
expect('6.5 account helper treats shared account defensively', /Legacy shared account[\s\S]*for \(const companyId of allowedCompanyIds\)/.test(routeGuards), true);

expect('7.1 accounts route imports authz route guards', /authorizationRouteGuards/.test(accountsRoute), true);
expect('7.2 account list checks company-scoped read or filtered company subset', /assertCompanyResourcePolicy\(req, \{ companyId, resourceKey: 'account', action: 'read' \}\)[\s\S]*filterAllowedCompanyIdsByResourcePolicy\(req, \{ resourceKey: 'account', action: 'read' \}\)/.test(accountsRoute), true);
expect('7.3 account detail guarded by account read', /assertAccountResourcePolicy\(req, \{ accountId: req\.params\.id, action: 'read' \}\)[\s\S]*accountRepository\.getAccount/.test(accountsRoute), true);
expect('7.4 account create checks each target company', /req\.body\?\.companies[\s\S]*resourceKey: 'account', action: 'create'/.test(accountsRoute), true);
expect('7.5 account update guarded', /assertAccountResourcePolicy\(req, \{ accountId: req\.params\.id, action: 'update' \}\)[\s\S]*accountRepository\.updateAccount/.test(accountsRoute), true);
expect('7.6 contact create/update/delete guarded with account.contact', /resourceKey: 'account\.contact', action: 'create'[\s\S]*resourceKey: 'account\.contact', action: 'update'[\s\S]*resourceKey: 'account\.contact', action: 'delete'/.test(accountsRoute), true);
expect('7.7 project create/update/delete guarded with account.project', /resourceKey: 'account\.project', action: 'create'[\s\S]*resourceKey: 'account\.project', action: 'update'[\s\S]*resourceKey: 'account\.project', action: 'delete'/.test(accountsRoute), true);
expect('7.8 account route maps AuthorizationRuntimeError', /err instanceof AuthorizationRuntimeError/.test(accountsRoute), true);

expect('8.1 reports route imports shared guard', /authorizationRouteGuards/.test(reportsRoute), true);
expect('8.2 columns endpoint guarded as report read', /\/cases\/columns'[\s\S]*resourceKey: 'report\.caseStudio', action: 'read', throwIfEmpty: true/.test(reportsRoute), true);
expect('8.3 preview endpoint guarded as report read with subset filter', /\/cases\/preview'[\s\S]*resourceKey: 'report\.caseStudio', action: 'read', throwIfEmpty: true[\s\S]*filterAllowedCompanyIdsByResourcePolicy\(req, \{ resourceKey: 'report\.caseStudio', action: 'read' \}\)/.test(reportsRoute), true);
expect('8.4 export endpoint guarded as report export with subset filter', /\/cases\/export'[\s\S]*resourceKey: 'report\.caseStudio', action: 'export', throwIfEmpty: true[\s\S]*filterAllowedCompanyIdsByResourcePolicy\(req, \{ resourceKey: 'report\.caseStudio', action: 'export' \}\)/.test(reportsRoute), true);
expect('8.5 pivot read endpoints guarded', /\/cases\/pivot'[\s\S]*resourceKey: 'report\.caseStudio', action: 'read'[\s\S]*\/cases\/pivot\/drill'[\s\S]*resourceKey: 'report\.caseStudio', action: 'read'/.test(reportsRoute), true);
expect('8.6 pivot export guarded as report export', /\/cases\/pivot\/export'[\s\S]*resourceKey: 'report\.caseStudio', action: 'export'/.test(reportsRoute), true);
expect('8.7 reports route maps AuthorizationRuntimeError', /function handleAuthorizationRuntimeError/.test(reportsRoute), true);

expect('9.1 report views route imports shared guard', /authorizationRouteGuards/.test(reportViewsRoute), true);
expect('9.2 report view list filters visible companies by read policy', /router\.get\('\/'[\s\S]*filterAllowedCompanyIdsByResourcePolicy\(req, \{ resourceKey: 'report\.view', action: 'read' \}\)[\s\S]*companyId: \{ in: visibleCompanyIds \}/.test(reportViewsRoute), true);
expect('9.3 report view create guarded as create', /router\.post\('\/'[\s\S]*resourceKey: 'report\.view', action: 'create'/.test(reportViewsRoute), true);
expect('9.4 report view get guarded as read after row lookup', /router\.get\('\/:id'[\s\S]*resourceKey: 'report\.view', action: 'read'/.test(reportViewsRoute), true);
expect('9.5 report view update/delete guarded', /resourceKey: 'report\.view', action: 'update'[\s\S]*resourceKey: 'report\.view', action: 'delete'/.test(reportViewsRoute), true);
expect('9.6 report views route maps AuthorizationRuntimeError', /handleAuthorizationRuntimeError\(res, err\)/.test(reportViewsRoute), true);

expect('10.1 policy repository includes createdBy relation', /createdBy: \{ select: \{ id: true, fullName: true, email: true \} \}/.test(authzRepo), true);
expect('10.2 policy repository includes updatedBy relation', /updatedBy: \{ select: \{ id: true, fullName: true, email: true \} \}/.test(authzRepo), true);
expect('10.3 admin service exposes createdBy actor', /createdBy\?: \{ id: string; fullName\?: string \| null; email\?: string \| null \}/.test(adminService), true);
expect('10.4 admin UI has Son Değişiklik column', /<Th>Son Değişiklik<\/Th>/.test(adminPage), true);
expect('10.5 admin UI formats policy actor', /function formatPolicyActor/.test(adminPage), true);
expect('10.6 help mentions account/report resource pilot', /müşteri kartı\/kontak\/proje ve rapor stüdyosu\/kayıtlı görünüm/.test(helpContents), true);
expect('10.7 env docs mention account and report resources', /müşteri\/kontak\/proje ve rapor\/kayıtlı görünüm/.test(envExample), true);

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
