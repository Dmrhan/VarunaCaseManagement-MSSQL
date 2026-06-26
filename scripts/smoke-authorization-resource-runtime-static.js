import fs from 'node:fs';
import path from 'node:path';
import {
  assertDenyOnlyResourceAccess,
  buildAuthorizationPrincipalCandidates,
  buildCurrentAuthorizationUser,
  chooseAuthorizationPrincipal,
  explainDenyOnlyResourceAccess,
  resolveAuthorizationCompany,
} from '../server/lib/authorizationRuntime.js';
import { explainResourceAccess } from '../server/lib/authorizationPolicy.js';

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

function expectThrows(name, fn, expectedCode) {
  try {
    fn();
    fail += 1;
    console.error(`✗ ${name}`);
    console.error('  expected throw');
  } catch (err) {
    const ok = err?.code === expectedCode;
    if (ok) {
      pass += 1;
      console.log(`✓ ${name}`);
    } else {
      fail += 1;
      console.error(`✗ ${name}`);
      console.error(`  expected code: ${expectedCode}`);
      console.error(`  actual code:   ${err?.code}`);
    }
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const user = {
  id: 'user-1',
  role: 'Agent',
  personId: 'person-1',
  fullName: 'Test Agent',
  email: 'agent@example.test',
  allowedCompanyIds: ['COMP-UNIVERA'],
  companyRoles: [{ companyId: 'COMP-UNIVERA', role: 'Agent' }],
};

const policyUser = buildCurrentAuthorizationUser(user, 'COMP-UNIVERA', 'team-l1');
expect('1.1 current policy user keeps user id', policyUser.id, 'user-1');
expect('1.2 current policy user keeps system role', policyUser.role, 'Agent');
expect('1.3 current policy user keeps team id', policyUser.teamId, 'team-l1');
expect('1.4 current policy user uses company-role key shape', policyUser.companyRoles[0], 'COMP-UNIVERA:Agent');
expect('1.5 current policy user keeps allowed companies', policyUser.allowedCompanyIds[0], 'COMP-UNIVERA');
expect('1.6 current policy user keeps person id for security filters', policyUser.personId, 'person-1');

const candidates = buildAuthorizationPrincipalCandidates(user, 'COMP-UNIVERA', 'team-l1');
expect('2.1 principal candidates include system role', candidates.some((c) => c.type === 'systemRole' && c.key === 'Agent'), true);
expect('2.2 principal candidates include concrete user', candidates.some((c) => c.type === 'user' && c.key === 'user-1'), true);
expect('2.3 principal candidates include company role', candidates.some((c) => c.type === 'companyRole' && c.key === 'COMP-UNIVERA:Agent'), true);
expect('2.4 principal candidates include team', candidates.some((c) => c.type === 'team' && c.key === 'team-l1'), true);
expect('2.5 default principal means all current-user rules', chooseAuthorizationPrincipal(user, 'COMP-UNIVERA', 'team-l1')?.type, 'user');
expect('2.6 explicit team principal supported', chooseAuthorizationPrincipal(user, 'COMP-UNIVERA', 'team-l1', 'team')?.key, 'team-l1');

expect('3.1 allowed company resolves requested company', resolveAuthorizationCompany(user, 'COMP-UNIVERA'), 'COMP-UNIVERA');
expectThrows('3.2 out-of-scope company rejected', () => resolveAuthorizationCompany(user, 'COMP-FINROTA'), 'company_forbidden');
expectThrows('3.3 empty user scope rejected', () => resolveAuthorizationCompany({ allowedCompanyIds: [] }, ''), 'company_scope_empty');

const noPolicy = explainDenyOnlyResourceAccess({
  resourceKey: 'case',
  action: 'update',
  user: policyUser,
  overrides: [],
  baselineAllowed: true,
});
expect('4.1 baseline-allowed registered action remains allowed', noPolicy.allowed, true);
expect('4.2 baseline-allowed reason normalized', noPolicy.reason, 'baseline_allow');

const allowOverride = [{
  target: 'resource',
  resourceKey: 'account',
  action: 'delete',
  effect: 'allow',
  principal: { type: 'systemRole', key: 'Agent' },
}];
const pureAllow = explainResourceAccess({
  resourceKey: 'account',
  action: 'delete',
  user: policyUser,
  overrides: allowOverride,
});
const denyOnlyAllow = explainDenyOnlyResourceAccess({
  resourceKey: 'account',
  action: 'delete',
  user: policyUser,
  overrides: allowOverride,
  baselineAllowed: false,
});
expect('4.3 pure policy can still compute allow', pureAllow.reason, 'override_allow');
expect('4.4 deny-only helper does not widen baseline role guard', denyOnlyAllow.allowed, false);
expect('4.5 deny-only baseline denial reason', denyOnlyAllow.reason, 'baseline_denied');

const denyOverride = [{
  target: 'resource',
  resourceKey: 'case',
  action: 'update',
  effect: 'deny',
  principal: { type: 'team', key: 'team-l1' },
}];
const denied = explainDenyOnlyResourceAccess({
  resourceKey: 'case',
  action: 'update',
  user: policyUser,
  overrides: denyOverride,
  baselineAllowed: true,
});
expect('4.6 team deny can narrow baseline-allowed action', denied.allowed, false);
expect('4.7 team deny keeps policy reason', denied.policyReason, 'override_deny');

expect('4.8 unknown resource denied', explainDenyOnlyResourceAccess({
  resourceKey: 'missing',
  action: 'read',
  user: policyUser,
  baselineAllowed: true,
}).allowed, false);
expect('4.9 unsupported action denied', explainDenyOnlyResourceAccess({
  resourceKey: 'case',
  action: 'launch',
  user: policyUser,
  baselineAllowed: true,
}).reason, 'action_not_supported');
expectThrows('4.10 assert helper throws 403-style code', () => assertDenyOnlyResourceAccess({
  resourceKey: 'case',
  action: 'update',
  user: policyUser,
  overrides: denyOverride,
  baselineAllowed: true,
}), 'override_deny');

const route = read('server/routes/authorization.js');
const runtime = read('server/lib/authorizationRuntime.js');
const pkg = JSON.parse(read('package.json'));
expect('5.1 authorization route imports runtime helper', /authorizationRuntime\.js/.test(route), true);
expect('5.2 route uses shared current-user builder', /buildCurrentAuthorizationUser/.test(route), true);
expect('5.3 route no longer defines local current-user builder', /function buildCurrentPolicyUser/.test(route), false);
expect('5.4 runtime helper does not import Express', /from 'express'|from "express"/.test(runtime), false);
expect('5.5 runtime helper does not import Prisma client singleton', /from '\.\.\/db\/client\.js'|from "\.\.\/db\/client\.js"/.test(runtime), false);
expect('5.6 smoke script registered', pkg.scripts['smoke:authorization-resource-runtime'], 'node scripts/smoke-authorization-resource-runtime-static.js');

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
