import fs from 'node:fs';
import path from 'node:path';
import { findMenuByViewKey } from '../server/lib/authorizationRegistry.js';

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

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

const pagePath = 'src/features/admin/AdminAuthorizationPoliciesPage.tsx';
const page = read(pagePath);
const adminService = read('src/services/adminService.ts');
const adminLayout = read('src/features/admin/AdminLayout.tsx');
const app = read('src/App.tsx');
const registry = read('server/lib/authorizationRegistry.js');
const pkg = JSON.parse(read('package.json'));

expect('1.1 authorization admin page exists', exists(pagePath), true);
expect('1.2 page uses AdminListLayout', /<AdminListLayout/.test(page), true);
expect('1.3 page uses adminService.authorizationPolicies', /adminService\.authorizationPolicies/.test(page), true);
expect('1.4 page has target filter', /Policy Tipi/.test(page), true);
expect('1.5 page supports security filter JSON textarea', /Güvenlik Filtresi JSON/.test(page), true);
expect('1.6 page documents shadow-mode boundary', /runtime enforcement ayrı fazda/.test(page), true);

expect('2.1 adminService has AuthorizationPolicy type', /export interface AuthorizationPolicy\s*\{/.test(adminService), true);
expect('2.2 adminService has list wrapper', /authorizationPolicies:[\s\S]*async list\(filter: AuthorizationPolicyListFilter\)/.test(adminService), true);
expect('2.3 adminService has create wrapper', /authorizationPolicies:[\s\S]*async create\(input: AuthorizationPolicyInput\)/.test(adminService), true);
expect('2.4 adminService has update wrapper', /authorizationPolicies:[\s\S]*async update\(/.test(adminService), true);
expect('2.5 adminService has deactivate wrapper', /authorizationPolicies:[\s\S]*async deactivate\(id: string\)/.test(adminService), true);

expect('3.1 AdminView includes authorization view', /'admin-authorization-policies'/.test(adminLayout), true);
expect('3.2 AdminLayout nav label present', /Yetkilendirme Yönetimi/.test(adminLayout), true);
expect('3.3 AdminLayout nav icon imported', /KeyRound/.test(adminLayout), true);

expect('4.1 App imports admin page', /AdminAuthorizationPoliciesPage/.test(app), true);
expect('4.2 App renders admin page by view key', /view === 'admin-authorization-policies'[\s\S]*<AdminAuthorizationPoliciesPage/.test(app), true);

expect('5.1 registry includes authz admin menu', !!findMenuByViewKey('admin-authorization-policies'), true);
expect('5.2 registry key stable', findMenuByViewKey('admin-authorization-policies')?.key, 'admin.authorizationPolicies');
expect('5.3 registry label stable', /admin\.authorizationPolicies[\s\S]*Yetkilendirme Yönetimi/.test(registry), true);

expect('6.1 smoke script registered', pkg.scripts['smoke:authorization-admin-ui'], 'node scripts/smoke-authorization-admin-ui-static.js');

// Guardrail: this UI PR must not wire runtime checks into case screens yet.
expect('7.1 page does not import runtime policy resolver', /authorizationPolicy\.js|canAccessResource|canSeeMenu/.test(page), false);
expect('7.2 App does not call canSeeMenu for this feature', /canSeeMenu\(/.test(app), false);

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
