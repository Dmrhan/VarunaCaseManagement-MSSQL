import {
  buildAuthorizationEffectivePreview,
} from '../server/lib/authorizationEffectivePreview.js';

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

function canShowViewLikeApp({
  key,
  fallback,
  enabled = true,
  failed = false,
  access,
}) {
  if (!enabled || failed) return fallback;
  if (!access) return fallback;
  const menu = access.menus.find((m) => m.viewKey === key);
  return menu ? fallback && menu.allowed : fallback;
}

function previewFor(user, overrides = []) {
  return buildAuthorizationEffectivePreview({
    companyId: 'COMP-UNIVERA',
    user,
    overrides,
    featureFlags: { smartTicketIntakeEnabled: true },
  });
}

const agent = {
  id: 'user-agent',
  role: 'Agent',
  teamId: 'team-l1',
  companyRoles: ['COMP-UNIVERA:Agent'],
  allowedCompanyIds: ['COMP-UNIVERA'],
};

const supervisor = {
  id: 'user-supervisor',
  role: 'Supervisor',
  teamId: 'team-l2',
  companyRoles: ['COMP-UNIVERA:Supervisor'],
  allowedCompanyIds: ['COMP-UNIVERA'],
};

const admin = {
  id: 'user-admin',
  role: 'Admin',
  teamId: null,
  companyRoles: ['COMP-UNIVERA:Admin'],
  allowedCompanyIds: ['COMP-UNIVERA'],
};

const agentDefault = previewFor(agent);
expect('1.1 Agent legacy-visible cases remains visible', canShowViewLikeApp({
  key: 'cases',
  fallback: true,
  access: agentDefault,
}), true);
expect('1.2 Agent legacy-hidden accounts remains hidden', canShowViewLikeApp({
  key: 'accounts',
  fallback: false,
  access: agentDefault,
}), false);
expect('1.3 flag off returns fallback true', canShowViewLikeApp({
  key: 'cases',
  fallback: true,
  enabled: false,
  access: agentDefault,
}), true);
expect('1.4 flag off returns fallback false', canShowViewLikeApp({
  key: 'accounts',
  fallback: false,
  enabled: false,
  access: agentDefault,
}), false);
expect('1.5 endpoint failure is fail-open to fallback', canShowViewLikeApp({
  key: 'cases',
  fallback: true,
  failed: true,
  access: null,
}), true);
expect('1.6 unknown menu returns fallback', canShowViewLikeApp({
  key: 'not-a-view',
  fallback: true,
  access: agentDefault,
}), true);

const agentWithCaseDeny = previewFor(agent, [{
  target: 'menu',
  menuKey: 'main.cases',
  viewKey: 'cases',
  effect: 'deny',
  principal: { type: 'systemRole', key: 'Agent' },
}]);
expect('2.1 menu deny hides legacy-visible page', canShowViewLikeApp({
  key: 'cases',
  fallback: true,
  access: agentWithCaseDeny,
}), false);
expect('2.2 deny decision appears in effective preview', agentWithCaseDeny.menus.find((m) => m.viewKey === 'cases')?.reason, 'override_deny');

const agentWithAccountsAllow = previewFor(agent, [{
  target: 'menu',
  menuKey: 'main.accounts',
  viewKey: 'accounts',
  effect: 'allow',
  principal: { type: 'systemRole', key: 'Agent' },
}]);
expect('3.1 policy engine can compute allow for default-hidden menu', agentWithAccountsAllow.menus.find((m) => m.viewKey === 'accounts')?.allowed, true);
expect('3.2 App deny-only enforcement does not widen legacy role fallback', canShowViewLikeApp({
  key: 'accounts',
  fallback: false,
  access: agentWithAccountsAllow,
}), false);

const supervisorWithTeamDeny = previewFor(supervisor, [{
  target: 'menu',
  menuKey: 'reports.caseStudio',
  viewKey: 'case-report-studio',
  effect: 'deny',
  principal: { type: 'team', key: 'team-l2' },
}]);
expect('4.1 team-target deny affects current user preview', supervisorWithTeamDeny.menus.find((m) => m.viewKey === 'case-report-studio')?.reason, 'override_deny');
expect('4.2 team-target deny hides supervisor report menu', canShowViewLikeApp({
  key: 'case-report-studio',
  fallback: true,
  access: supervisorWithTeamDeny,
}), false);

const adminDefault = previewFor(admin);
expect('5.1 Admin can see admin users by fallback and preview', canShowViewLikeApp({
  key: 'admin-users',
  fallback: true,
  access: adminDefault,
}), true);
expect('5.2 Admin can see authz management by fallback and preview', canShowViewLikeApp({
  key: 'admin-authorization-policies',
  fallback: true,
  access: adminDefault,
}), true);

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
