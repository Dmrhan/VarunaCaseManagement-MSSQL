import fs from 'node:fs';
import path from 'node:path';
import {
  FIELD_ACTIONS,
  FIELD_POLICY_SCOPES,
  MENU_REGISTRY,
  PRINCIPAL_TYPES,
  RESOURCE_ACTIONS,
  RESOURCE_REGISTRY,
  SECURITY_FILTER_OPERATORS,
  SECURITY_FILTER_TOKENS,
  findMenuByViewKey,
  findResource,
} from '../server/lib/authorizationRegistry.js';

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

function uniqueBy(items, field) {
  return new Set(items.map((it) => it[field])).size === items.length;
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const registrySource = read('server/lib/authorizationRegistry.js');
const appSource = read('src/App.tsx');
const adminLayoutSource = read('src/features/admin/AdminLayout.tsx');

expect('1.1 principal type count', PRINCIPAL_TYPES.length >= 4, true);
expectIncludes('1.2 principal supports systemRole', PRINCIPAL_TYPES, 'systemRole');
expectIncludes('1.3 principal supports companyRole', PRINCIPAL_TYPES, 'companyRole');
expectIncludes('1.4 principal supports team', PRINCIPAL_TYPES, 'team');
expectIncludes('1.5 principal supports user', PRINCIPAL_TYPES, 'user');

expectIncludes('2.1 resource action create', RESOURCE_ACTIONS, 'create');
expectIncludes('2.2 resource action read', RESOURCE_ACTIONS, 'read');
expectIncludes('2.3 resource action update', RESOURCE_ACTIONS, 'update');
expectIncludes('2.4 resource action delete', RESOURCE_ACTIONS, 'delete');
expectIncludes('2.5 resource action transfer', RESOURCE_ACTIONS, 'transfer');
expectIncludes('2.6 resource action close', RESOURCE_ACTIONS, 'close');

expectIncludes('3.1 field action visible', FIELD_ACTIONS, 'visible');
expectIncludes('3.2 field action editable', FIELD_ACTIONS, 'editable');
expectIncludes('3.3 field action required', FIELD_ACTIONS, 'required');
expectIncludes('3.4 field action masked', FIELD_ACTIONS, 'masked');

expect('4.1 menu keys unique', uniqueBy(MENU_REGISTRY, 'key'), true);
expect('4.2 menu view keys unique', uniqueBy(MENU_REGISTRY, 'viewKey'), true);
expect('4.3 resource keys unique', uniqueBy(RESOURCE_REGISTRY, 'key'), true);
expect('4.4 every menu has defaultRoles', MENU_REGISTRY.every((m) => Array.isArray(m.defaultRoles) && m.defaultRoles.length > 0), true);
expect('4.5 every resource has currentEnforcement note', RESOURCE_REGISTRY.every((r) => typeof r.currentEnforcement === 'string' && r.currentEnforcement.length > 0), true);

expect('5.1 registry includes cases menu', !!findMenuByViewKey('cases'), true);
expect('5.2 registry includes accounts menu', !!findMenuByViewKey('accounts'), true);
expect('5.3 registry includes smart-ticket feature flag', findMenuByViewKey('smart-ticket-new')?.featureFlag, 'smartTicketIntakeEnabled');
expect('5.4 registry includes report studio menu', !!findMenuByViewKey('case-report-studio'), true);
expect('5.5 registry includes admin users menu', !!findMenuByViewKey('admin-users'), true);
expect('5.6 registry includes admin taxonomy menu', !!findMenuByViewKey('admin-taxonomy-defs'), true);

expect('6.1 registry includes case resource', !!findResource('case'), true);
expect('6.2 case resource supports close', findResource('case')?.actions.includes('close'), true);
expect('6.3 case resource supports transfer', findResource('case')?.actions.includes('transfer'), true);
expect('6.4 registry includes account resource', !!findResource('account'), true);
expect('6.5 registry includes case notes resource', !!findResource('case.note'), true);
expect('6.6 registry includes case attachments resource', !!findResource('case.attachment'), true);
expect('6.7 registry includes report views resource', !!findResource('report.view'), true);
expect('6.8 registry includes field definitions resource', !!findResource('admin.fieldDefinition'), true);

expectIncludes('7.1 security operator eq', SECURITY_FILTER_OPERATORS, 'eq');
expectIncludes('7.2 security operator and', SECURITY_FILTER_OPERATORS, 'and');
expectIncludes('7.3 security token user id', SECURITY_FILTER_TOKENS, '@user.id');
expectIncludes('7.4 security token user allowedCompanyIds', SECURITY_FILTER_TOKENS, '@user.allowedCompanyIds');
expectIncludes('7.5 security token record companyId', SECURITY_FILTER_TOKENS, '@record.companyId');
expect('7.6 registry does not mention raw eval', /eval\s*\(|new Function\s*\(/.test(registrySource), false);

expectIncludes('8.1 field scope open', FIELD_POLICY_SCOPES, 'case.open');
expectIncludes('8.2 field scope close', FIELD_POLICY_SCOPES, 'case.close');
expectIncludes('8.3 field scope transfer', FIELD_POLICY_SCOPES, 'case.transfer');
expectIncludes('8.4 field scope smart ticket closure', FIELD_POLICY_SCOPES, 'smartTicket.stage3Closure');

const appViewMatch = appSource.match(/type View = ([\s\S]*?);/);
const appViews = appViewMatch ? [...appViewMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
const menuViewKeys = new Set(MENU_REGISTRY.map((m) => m.viewKey));
const expectedUnlistedViews = new Set(['case-detail', 'account-detail']);
const missingAppViews = appViews.filter((v) => !menuViewKeys.has(v) && !expectedUnlistedViews.has(v));
expect('9.1 all App views are cataloged or intentionally detail-only', missingAppViews.join(','), '');

const adminViewMatch = adminLayoutSource.match(/export type AdminView =([\s\S]*?);/);
const adminViews = adminViewMatch ? [...adminViewMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
const missingAdminViews = adminViews.filter((v) => !menuViewKeys.has(v));
expect('9.2 all Admin views are cataloged', missingAdminViews.join(','), '');

expect('10.1 registry does not import Prisma', /from ['"]@?prisma|from ['"].*client\.js/.test(registrySource), false);
expect('10.2 registry does not import Express', /from ['"]express['"]/.test(registrySource), false);
expect('10.3 registry has no runtime middleware export', /function\s+require|function\s+canAccess|router\./.test(registrySource), false);

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
