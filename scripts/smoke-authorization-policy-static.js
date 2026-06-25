import fs from 'node:fs';
import path from 'node:path';
import {
  MENU_REGISTRY,
  RESOURCE_REGISTRY,
} from '../server/lib/authorizationRegistry.js';
import {
  canAccessResource,
  canSeeMenu,
  explainResourceAccess,
  explainMenuAccess,
  listResourceActions,
  listVisibleMenus,
} from '../server/lib/authorizationPolicy.js';

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

function expectIncludes(name, list, value) {
  expect(name, Array.isArray(list) && list.includes(value), true);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const policySource = read('server/lib/authorizationPolicy.js');
const registrySource = read('server/lib/authorizationRegistry.js');

const agent = {
  id: 'user-agent',
  role: 'Agent',
  teamId: 'team-l1',
  companyRoles: ['UNIVERA:Agent'],
};
const supervisor = {
  id: 'user-supervisor',
  role: 'Supervisor',
  teamId: 'team-l2',
  companyRoles: ['UNIVERA:Supervisor'],
};
const admin = {
  id: 'user-admin',
  role: 'Admin',
  teamId: 'team-admin',
  companyRoles: ['UNIVERA:Admin'],
};
const sysadmin = {
  id: 'user-system',
  role: 'SystemAdmin',
  teamId: null,
  companyRoles: ['UNIVERA:SystemAdmin'],
};

expect('1.1 no user cannot see cases', canSeeMenu({ viewKey: 'cases', user: null }), false);
expect('1.2 unknown view denied', canSeeMenu({ viewKey: 'missing-view', user: sysadmin }), false);
expect('1.3 cases visible to Agent', canSeeMenu({ viewKey: 'cases', user: agent }), true);
expect('1.4 my-home visible to Agent', canSeeMenu({ viewKey: 'my-home', user: agent }), true);
expect('1.5 my-home hidden from Admin', canSeeMenu({ viewKey: 'my-home', user: admin }), false);
expect('1.6 accounts hidden from Agent', canSeeMenu({ viewKey: 'accounts', user: agent }), false);
expect('1.7 accounts visible to Supervisor', canSeeMenu({ viewKey: 'accounts', user: supervisor }), true);
expect('1.8 admin users hidden from Supervisor', canSeeMenu({ viewKey: 'admin-users', user: supervisor }), false);
expect('1.9 admin users visible to Admin', canSeeMenu({ viewKey: 'admin-users', user: admin }), true);
expect('1.10 admin users visible to SystemAdmin', canSeeMenu({ viewKey: 'admin-users', user: sysadmin }), true);

expect('2.1 smart ticket hidden when flag false',
  canSeeMenu({ viewKey: 'smart-ticket-new', user: agent, featureFlags: { smartTicketIntakeEnabled: false } }),
  false);
expect('2.2 smart ticket visible when flag true',
  canSeeMenu({ viewKey: 'smart-ticket-new', user: agent, featureFlags: { smartTicketIntakeEnabled: true } }),
  true);
expect('2.3 smart ticket disabled reason',
  explainMenuAccess({ viewKey: 'smart-ticket-new', user: agent, featureFlags: {} }).reason,
  'feature_disabled');

expect('3.1 override deny beats default allow',
  canSeeMenu({
    viewKey: 'cases',
    user: agent,
    overrides: [{
      target: 'menu',
      viewKey: 'cases',
      effect: 'deny',
      principal: { type: 'systemRole', key: 'Agent' },
    }],
  }),
  false);
expect('3.2 override allow can open default denied menu',
  canSeeMenu({
    viewKey: 'accounts',
    user: agent,
    overrides: [{
      target: 'menu',
      viewKey: 'accounts',
      effect: 'allow',
      principal: { type: 'systemRole', key: 'Agent' },
    }],
  }),
  true);
expect('3.3 override deny beats override allow',
  canSeeMenu({
    viewKey: 'cases',
    user: agent,
    overrides: [
      {
        target: 'menu',
        viewKey: 'cases',
        effect: 'allow',
        principal: { type: 'systemRole', key: 'Agent' },
      },
      {
        target: 'menu',
        viewKey: 'cases',
        effect: 'deny',
        principal: { type: 'user', key: 'user-agent' },
      },
    ],
  }),
  false);
expect('3.4 non-matching override ignored',
  canSeeMenu({
    viewKey: 'accounts',
    user: agent,
    overrides: [{
      target: 'menu',
      viewKey: 'accounts',
      effect: 'allow',
      principal: { type: 'team', key: 'other-team' },
    }],
  }),
  false);

const visibleForSupervisor = listVisibleMenus({ user: supervisor, featureFlags: { smartTicketIntakeEnabled: true } });
const supervisorViewKeys = visibleForSupervisor.map((m) => m.viewKey);
expectIncludes('4.1 supervisor sees cases in listVisibleMenus', supervisorViewKeys, 'cases');
expectIncludes('4.2 supervisor sees report studio in listVisibleMenus', supervisorViewKeys, 'case-report-studio');
expectIncludes('4.3 supervisor sees smart ticket when flag true', supervisorViewKeys, 'smart-ticket-new');
expect('4.4 group filter returns only reports group',
  listVisibleMenus({ user: supervisor, group: 'reports' }).every((m) => m.group === 'reports'),
  true);
expect('4.5 all visible menus are registry members',
  visibleForSupervisor.every((m) => MENU_REGISTRY.some((r) => r.key === m.key)),
  true);

expect('5.1 missing menu reason', explainMenuAccess({ viewKey: 'missing', user: agent }).reason, 'menu_not_found');
expect('5.2 no user reason', explainMenuAccess({ viewKey: 'cases', user: null }).reason, 'no_user');
expect('5.3 default allow reason', explainMenuAccess({ viewKey: 'cases', user: agent }).reason, 'default_role_allow');
expect('5.4 default deny reason', explainMenuAccess({ viewKey: 'accounts', user: agent }).reason, 'default_role_deny');
expect('5.5 override allow reason',
  explainMenuAccess({
    viewKey: 'accounts',
    user: agent,
    overrides: [{
      target: 'menu',
      viewKey: 'accounts',
      effect: 'allow',
      principal: { type: 'user', key: 'user-agent' },
    }],
  }).reason,
  'override_allow');

expect('6.1 policy does not import Prisma', /from ['"]@?prisma|from ['"].*client\.js/.test(policySource), false);
expect('6.2 policy does not import Express', /from ['"]express['"]/.test(policySource), false);
expect('6.3 policy has no router wiring', /router\.|app\.use|verifyJwt|requireRole/.test(policySource), false);
expect('6.4 policy does not eval filters', /eval\s*\(|new Function\s*\(/.test(policySource), false);
expect('6.5 registry still static side-effect free', /from ['"]@?prisma|from ['"]express['"]|router\./.test(registrySource), false);

expect('7.1 unknown resource denied', canAccessResource({ resourceKey: 'missing', action: 'read', user: sysadmin }), false);
expect('7.2 unsupported action denied', canAccessResource({ resourceKey: 'case.note', action: 'close', user: agent }), false);
expect('7.3 no user denied for resource', canAccessResource({ resourceKey: 'case', action: 'read', user: null }), false);
expect('7.4 registered case close action allowed in shadow mode',
  canAccessResource({ resourceKey: 'case', action: 'close', user: supervisor }),
  true);
expect('7.5 registered report export action allowed in shadow mode',
  canAccessResource({ resourceKey: 'report.caseStudio', action: 'export', user: supervisor }),
  true);
expect('7.6 resource missing reason',
  explainResourceAccess({ resourceKey: 'missing', action: 'read', user: agent }).reason,
  'resource_not_found');
expect('7.7 unsupported action reason',
  explainResourceAccess({ resourceKey: 'case.note', action: 'close', user: agent }).reason,
  'action_not_supported');
expect('7.8 registered action reason',
  explainResourceAccess({ resourceKey: 'case.attachment', action: 'delete', user: agent }).reason,
  'registered_action');
expect('7.9 resource override deny beats registered action',
  canAccessResource({
    resourceKey: 'case',
    action: 'transfer',
    user: supervisor,
    overrides: [{
      target: 'resource',
      resourceKey: 'case',
      action: 'transfer',
      effect: 'deny',
      principal: { type: 'systemRole', key: 'Supervisor' },
    }],
  }),
  false);
expect('7.10 resource wildcard deny works',
  canAccessResource({
    resourceKey: 'case',
    action: 'read',
    user: supervisor,
    overrides: [{
      target: 'resource',
      resourceKey: 'case',
      action: '*',
      effect: 'deny',
      principal: { type: 'user', key: 'user-supervisor' },
    }],
  }),
  false);
expect('7.11 resource override allow can open registered action',
  explainResourceAccess({
    resourceKey: 'case',
    action: 'assign',
    user: agent,
    overrides: [{
      target: 'resource',
      resourceKey: 'case',
      action: 'assign',
      effect: 'allow',
      principal: { type: 'user', key: 'user-agent' },
    }],
  }).reason,
  'override_allow');
const resourceActions = listResourceActions({ user: supervisor });
expect('7.12 listResourceActions includes case read',
  resourceActions.some((r) => r.resourceKey === 'case' && r.action === 'read'),
  true);
expect('7.13 listResourceActions only returns registered actions',
  resourceActions.every((r) => RESOURCE_REGISTRY.some((resource) => resource.key === r.resourceKey && resource.actions.includes(r.action))),
  true);

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
