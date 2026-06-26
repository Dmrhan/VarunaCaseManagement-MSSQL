import fs from 'node:fs';
import path from 'node:path';
import {
  compileSecurityFilterOverrides,
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

function expectJson(name, actual, expected) {
  expect(name, JSON.stringify(actual), JSON.stringify(expected));
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const user = {
  id: 'user-1',
  personId: 'person-1',
  role: 'Agent',
  teamId: 'team-l1',
  allowedCompanyIds: ['COMP-UNIVERA'],
  companyRoles: ['COMP-UNIVERA:Agent'],
};

const overrides = [
  {
    target: 'securityFilter',
    resourceKey: 'case',
    effect: 'allow',
    principal: { type: 'team', key: 'team-l1' },
    filter: { op: 'eq', field: '@record.assignedTeamId', value: '@user.teamId' },
  },
  {
    target: 'securityFilter',
    resourceKey: 'case',
    effect: 'deny',
    principal: { type: 'systemRole', key: 'Agent' },
    filter: { op: 'eq', field: '@record.createdByUserId', value: 'blocked-user' },
  },
  {
    target: 'securityFilter',
    resourceKey: 'account',
    effect: 'allow',
    principal: { type: 'team', key: 'team-l1' },
    filter: { op: 'eq', field: '@record.companyId', value: 'COMP-UNIVERA' },
  },
  {
    target: 'securityFilter',
    resourceKey: 'case',
    effect: 'allow',
    principal: { type: 'team', key: 'other-team' },
    filter: { op: 'eq', field: '@record.assignedTeamId', value: 'other-team' },
  },
];

expectJson('1.1 matching allow + deny filters compile as AND', compileSecurityFilterOverrides({
  resourceKey: 'case',
  user,
  overrides,
}), {
  AND: [
    { assignedTeamId: 'team-l1' },
    { NOT: { createdByUserId: 'blocked-user' } },
  ],
});
expectJson('1.2 non-matching resource returns empty where', compileSecurityFilterOverrides({
  resourceKey: 'report.caseStudio',
  user,
  overrides,
}), {});
expectJson('1.3 non-matching principal returns empty where', compileSecurityFilterOverrides({
  resourceKey: 'case',
  user: { ...user, teamId: 'no-policy', role: 'Backoffice', companyRoles: [] },
  overrides,
}), {});
expectJson('1.4 assigned-to-me preset keeps concrete personId (Codex P1)', compileSecurityFilterOverrides({
  resourceKey: 'case',
  user,
  overrides: [{
    target: 'securityFilter',
    resourceKey: 'case',
    effect: 'allow',
    principal: { type: 'systemRole', key: 'Agent' },
    filter: { op: 'eq', field: '@record.assignedPersonId', value: '@user.personId' },
  }],
}), {
  assignedPersonId: 'person-1',
});

const casesRoute = read('server/routes/cases.js');
const repo = read('server/db/caseRepository.js');
const runtime = read('server/lib/authorizationRuntime.js');
const envExample = read('.env.example');
const pkg = JSON.parse(read('package.json'));

expect('2.1 cases route imports compileSecurityFilterOverrides', /compileSecurityFilterOverrides/.test(casesRoute), true);
expect('2.2 cases route has security filter env flag', /AUTHORIZATION_SECURITY_FILTER_ENFORCEMENT_ENABLED/.test(casesRoute), true);
expect('2.3 security filter flag defaults off unless true', /process\.env\.AUTHORIZATION_SECURITY_FILTER_ENFORCEMENT_ENABLED === 'true'/.test(casesRoute), true);
expect('2.4 route has buildCaseListSecurityWhere helper', /async function buildCaseListSecurityWhere/.test(casesRoute), true);
expect('2.5 route computes team id once for security where', /const teamId = await resolveAuthorizationTeamId\(prisma, req\.user\)/.test(casesRoute), true);
expect('2.6 route loads active overrides per company', /authorizationPolicyRepository\.listOverrides\(\s*companyId,\s*req\.user\.allowedCompanyIds/s.test(casesRoute), true);
expect('2.7 route scopes compiled filters by companyId', /scopedClauses\.push\(\{ AND: \[\{ companyId \}, compiled\] \}\)/.test(casesRoute), true);
expect('2.8 route preserves companies without matching filters', /scopedClauses\.push\(\{ companyId \}\)/.test(casesRoute), true);
expect('2.9 route returns null when no filter matched', /if \(!hasAnySecurityFilter\) return null/.test(casesRoute), true);
expect('2.10 main case list passes securityWhere to repository', /const securityWhere = await buildCaseListSecurityWhere\(req\)[\s\S]*caseRepository\.list\(\{[\s\S]*securityWhere/s.test(casesRoute), true);
expect('2.11 tagging export passes securityWhere', /tagging-review\/export[\s\S]*const securityWhere = await buildCaseListSecurityWhere\(req\)[\s\S]*securityWhere/s.test(casesRoute), true);
expect('2.12 tagging-review list passes securityWhere', /GET \/api\/cases\/tagging-review[\s\S]*const securityWhere = await buildCaseListSecurityWhere\(req\)[\s\S]*securityWhere/s.test(casesRoute), true);
expect('2.13 route has direct case security-filter helper', /async function assertCaseSecurityFilterAccess/.test(casesRoute), true);
expect('2.14 direct helper checks record with compiled where', /assertCaseSecurityFilterAccess[\s\S]*compileSecurityFilterOverrides[\s\S]*prisma\.case\.findFirst\(\{[\s\S]*AND: \[compiled\]/.test(casesRoute), true);
expect('2.15 resource policy enforces security filter before writes', /async function assertCaseResourcePolicy[\s\S]*await assertCaseSecurityFilterAccess\(req, \{ caseId: req\.params\.id, companyId: c\.companyId \}\)/.test(casesRoute), true);
expect('2.16 case detail enforces security filter before response', /GET \/api\/cases\/:id[\s\S]*await assertCaseSecurityFilterAccess\(req, \{ caseId: req\.params\.id, companyId: c\.companyId \}\)[\s\S]*res\.json\(c\)/.test(casesRoute), true);
expect('2.17 detail helper endpoints enforce security filter', (casesRoute.match(/await assertCaseSecurityFilterAccess\(req\);/g) ?? []).length >= 10, true);
expect('2.18 resource policy does not disable security-filter writes', /const resourceEnabled = isAuthorizationResourceEnforcementEnabled\(\)[\s\S]*const securityFilterEnabled = isAuthorizationSecurityFilterEnforcementEnabled\(\)[\s\S]*if \(!resourceEnabled && !securityFilterEnabled\) return null[\s\S]*if \(!resourceEnabled\) return null/.test(casesRoute), true);

expect('3.1 repository list accepts securityWhere', /async list\(\{ filters, pagination, allowedCompanyIds, securityWhere \} = \{\}\)/.test(repo), true);
expect('3.2 buildWhere accepts securityWhere param', /function buildWhere\(f, allowedCompanyIds, securityWhere = null\)/.test(repo), true);
expect('3.3 securityWhere is ANDed with baseline tenant scope', /andClauses\.push\(securityWhere\)/.test(repo), true);
expect('3.4 repository still uses one where for count and findMany', /const total = await prisma\.case\.count\(\{ where \}\)[\s\S]*prisma\.case\.findMany\(\{[\s\S]*where/s.test(repo), true);

expect('4.1 runtime exports compileSecurityFilterOverrides', /export function compileSecurityFilterOverrides/.test(runtime), true);
expect('4.2 runtime compiles deny filters as NOT', /if \(override\.effect === 'deny'\) return \{ NOT: compiled \}/.test(runtime), true);
expect('4.3 runtime uses shared compiler', /compileSecurityFilterWhere/.test(runtime), true);
expect('4.4 runtime does not import Prisma client singleton', /@prisma\/client|db\/client/.test(runtime), false);
expect('4.5 runtime preserves user.personId for compiler tokens', /personId: user\.personId \?\? null/.test(runtime), true);

expect('5.1 env documents security filter flag', /AUTHORIZATION_SECURITY_FILTER_ENFORCEMENT_ENABLED=false/.test(envExample), true);
expect('5.2 env docs say enforcement narrows scope', /DARALTAN ek\s+#\s+where koşulu/.test(envExample), true);
expect('5.3 env docs list pilot endpoints', /GET \/api\/cases, tagging-review list\/export, GET \/api\/cases\/:id/.test(envExample), true);
expect('5.4 smoke script registered', pkg.scripts['smoke:authorization-security-filter-enforcement'], 'node scripts/smoke-authorization-security-filter-enforcement-pilot-static.js');

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
