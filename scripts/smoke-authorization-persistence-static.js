import fs from 'node:fs';
import path from 'node:path';
import {
  AuthorizationPolicyValidationError,
  authorizationPolicyRowToOverride,
  normalizeAuthorizationPolicyInput,
} from '../server/lib/authorizationPolicyRows.js';

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

function throwsValidation(fn) {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof AuthorizationPolicyValidationError;
  }
}

const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/00000000000012_authorization_policy/migration.sql');
const repo = read('server/db/authorizationPolicyRepository.js');
const rows = read('server/lib/authorizationPolicyRows.js');
const adminRoute = read('server/routes/admin.js');

expect('1.1 schema has AuthorizationPolicy model', /model AuthorizationPolicy\s*\{/.test(schema), true);
expect('1.2 schema has Company relation', /authorizationPolicies\s+AuthorizationPolicy\[\]/.test(schema), true);
expect('1.3 schema has User created relation', /authorizationPoliciesCreated\s+AuthorizationPolicy\[\]/.test(schema), true);
expect('1.4 schema has User updated relation', /authorizationPoliciesUpdated\s+AuthorizationPolicy\[\]/.test(schema), true);
expect('1.5 schema stores filterJson as nvarchar max', /filterJson\s+String\?\s+@db\.NVarChar\(Max\)/.test(schema), true);
expect('1.6 schema has target index', /@@index\(\[companyId, target, isActive\]\)/.test(schema), true);
expect('1.7 schema has principal index', /@@index\(\[companyId, principalType, principalKey\]\)/.test(schema), true);

expect('2.1 migration creates table', /CREATE TABLE \[dbo\]\.\[AuthorizationPolicy\]/.test(migration), true);
expect('2.2 migration company FK cascade', /AuthorizationPolicy_companyId_fkey[\s\S]*ON DELETE CASCADE ON UPDATE NO ACTION/.test(migration), true);
expect('2.3 migration createdBy FK no action', /AuthorizationPolicy_createdByUserId_fkey[\s\S]*ON DELETE NO ACTION ON UPDATE NO ACTION/.test(migration), true);
expect('2.4 migration has rollback catch', /BEGIN CATCH[\s\S]*ROLLBACK TRAN/.test(migration), true);
expect('2.5 migration is additive create-only', /DROP TABLE|ALTER TABLE \[dbo\]\.\[(?!AuthorizationPolicy\])/.test(migration), false);

const menuPolicy = normalizeAuthorizationPolicyInput({
  target: 'menu',
  principalType: 'systemRole',
  principalKey: 'Agent',
  effect: 'deny',
  viewKey: 'accounts',
});
expect('3.1 menu normalizer resolves menuKey', menuPolicy.menuKey, 'main.accounts');
expect('3.2 menu normalizer preserves viewKey', menuPolicy.viewKey, 'accounts');

const resourcePolicy = normalizeAuthorizationPolicyInput({
  target: 'resource',
  principalType: 'team',
  principalKey: 'team-l1',
  effect: 'allow',
  resourceKey: 'case',
  action: 'transfer',
});
expect('3.3 resource normalizer preserves action', resourcePolicy.action, 'transfer');
expect('3.4 resource normalizer clears menuKey', resourcePolicy.menuKey, null);

const fieldPolicy = normalizeAuthorizationPolicyInput({
  target: 'field',
  principalType: 'companyRole',
  principalKey: 'UNIVERA:Supervisor',
  effect: 'allow',
  scope: 'case.close',
  resourceKey: 'case',
  fieldKey: 'resolutionNote',
  action: 'required',
});
expect('3.5 field normalizer preserves scope', fieldPolicy.scope, 'case.close');
expect('3.6 field normalizer preserves fieldKey', fieldPolicy.fieldKey, 'resolutionNote');

const filterPolicy = normalizeAuthorizationPolicyInput({
  target: 'securityFilter',
  principalType: 'systemRole',
  principalKey: 'Agent',
  effect: 'allow',
  resourceKey: 'case',
  filterJson: {
    op: 'in',
    field: '@record.companyId',
    value: '@user.allowedCompanyIds',
  },
});
expect('3.7 filter normalizer stringifies JSON', typeof filterPolicy.filterJson, 'string');
expect('3.8 filter normalizer keeps op', JSON.parse(filterPolicy.filterJson).op, 'in');

expect('4.1 invalid target rejected', throwsValidation(() => normalizeAuthorizationPolicyInput({ target: 'x' })), true);
expect('4.2 invalid principal rejected', throwsValidation(() => normalizeAuthorizationPolicyInput({
  target: 'menu',
  principalType: 'role',
  principalKey: 'Agent',
  viewKey: 'cases',
})), true);
expect('4.3 invalid menu rejected', throwsValidation(() => normalizeAuthorizationPolicyInput({
  target: 'menu',
  principalType: 'systemRole',
  principalKey: 'Agent',
  viewKey: 'missing',
})), true);
expect('4.4 invalid resource action rejected', throwsValidation(() => normalizeAuthorizationPolicyInput({
  target: 'resource',
  principalType: 'systemRole',
  principalKey: 'Agent',
  resourceKey: 'case.note',
  action: 'close',
})), true);
expect('4.5 invalid filter JSON rejected', throwsValidation(() => normalizeAuthorizationPolicyInput({
  target: 'securityFilter',
  principalType: 'systemRole',
  principalKey: 'Agent',
  resourceKey: 'case',
  filterJson: '{bad',
})), true);

expect('5.1 menu row converts to override', authorizationPolicyRowToOverride({
  target: 'menu',
  menuKey: 'main.accounts',
  viewKey: 'accounts',
  effect: 'deny',
  principalType: 'systemRole',
  principalKey: 'Agent',
  priority: 100,
  isActive: true,
}).target, 'menu');
expect('5.2 inactive row ignored', authorizationPolicyRowToOverride({ isActive: false }), null);
expect('5.3 filter row parses JSON', authorizationPolicyRowToOverride({
  target: 'securityFilter',
  resourceKey: 'case',
  effect: 'allow',
  principalType: 'systemRole',
  principalKey: 'Agent',
  priority: 100,
  isActive: true,
  filterJson: '{"op":"exists","field":"@record.companyId"}',
}).filter.op, 'exists');

expect('6.1 repository imports prisma', /import \{ prisma \} from '\.\/client\.js';/.test(repo), true);
expect('6.2 repository asserts actor on create', /assertActorObject\(actor, 'authorizationPolicyRepository\.create'\)/.test(repo), true);
expect('6.3 repository asserts actor on update', /assertActorObject\(actor, 'authorizationPolicyRepository\.update'\)/.test(repo), true);
expect('6.4 repository checks company scope', /assertCompanyScope\(input\?\.companyId, allowedCompanyIds\)/.test(repo), true);
expect('6.5 repository soft disables remove', /async remove\(id, allowedCompanyIds, actor\)[\s\S]*setActive\(id, false/.test(repo), true);
expect('6.6 rows module does not import prisma', /from ['"]@?prisma|from ['"]\.\.\/db\/client/.test(rows), false);

expect('7.1 admin route imports authorization repository',
  /import \{ authorizationPolicyRepository \} from '\.\.\/db\/authorizationPolicyRepository\.js';/.test(adminRoute),
  true);
expect('7.2 admin route GET authorization-policies exists',
  /router\.get\('\/authorization-policies'/.test(adminRoute),
  true);
expect('7.3 admin route POST authorization-policies exists',
  /router\.post\('\/authorization-policies'/.test(adminRoute),
  true);
expect('7.4 admin route PATCH authorization-policies exists',
  /router\.patch\('\/authorization-policies\/:id'/.test(adminRoute),
  true);
expect('7.5 admin route DELETE authorization-policies exists',
  /router\.delete\('\/authorization-policies\/:id'/.test(adminRoute),
  true);
expect('7.6 admin route list requires companyId',
  /companyId query parametresi gerekli/.test(adminRoute),
  true);
expect('7.7 admin route checks company admin on list',
  /router\.get\('\/authorization-policies'[\s\S]*assertCompanyAdmin\(req, companyId\)/.test(adminRoute),
  true);
expect('7.8 admin route checks company admin on create',
  /router\.post\('\/authorization-policies'[\s\S]*assertCompanyAdmin\(req, body\.companyId\)/.test(adminRoute),
  true);
expect('7.9 admin route uses requireActor on create',
  /router\.post\('\/authorization-policies'[\s\S]*const actor = requireActor\(req\)/.test(adminRoute),
  true);
expect('7.10 admin route uses requireActor on update',
  /router\.patch\('\/authorization-policies\/:id'[\s\S]*const actor = requireActor\(req\)/.test(adminRoute),
  true);
expect('7.11 admin route delete calls repository remove',
  /router\.delete\('\/authorization-policies\/:id'[\s\S]*authorizationPolicyRepository\.remove/.test(adminRoute),
  true);
expect('7.12 admin route effective preview exists before id route',
  adminRoute.indexOf("router.post('/authorization-policies/effective-preview'") > -1 &&
    adminRoute.indexOf("router.post('/authorization-policies/effective-preview'") <
      adminRoute.indexOf("router.patch('/authorization-policies/:id'"),
  true);
expect('7.13 admin route preview checks company admin',
  /router\.post\('\/authorization-policies\/effective-preview'[\s\S]*assertCompanyAdmin\(req, body\.companyId\)/.test(adminRoute),
  true);
expect('7.14 admin route preview uses active overrides',
  /router\.post\('\/authorization-policies\/effective-preview'[\s\S]*authorizationPolicyRepository\.listOverrides/.test(adminRoute),
  true);

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
