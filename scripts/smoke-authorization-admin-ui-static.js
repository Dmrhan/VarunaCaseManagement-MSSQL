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
expect('1.4 page has target filter', /Kural Tipi/.test(page), true);
expect('1.5 page supports security filter JSON textarea', /Güvenlik Filtresi JSON/.test(page), true);
expect('1.6 page documents controlled rollout boundary', /kontrollü devreye alın/.test(page), true);
expect('1.7 page has effective preview panel', /Etkili Yetki Önizlemesi/.test(page), true);
expect('1.8 page calls effectivePreview wrapper', /authorizationPolicies\.effectivePreview/.test(page), true);
expect('1.9 page renders security filter count', /securityFilterCount/.test(page), true);
expect('1.10 page has menu selector catalog', /const MENU_OPTIONS/.test(page), true);
expect('1.11 page has resource selector catalog', /const RESOURCE_OPTIONS/.test(page), true);
expect('1.12 page has field scope selector catalog', /const FIELD_SCOPE_OPTIONS/.test(page), true);
expect('1.13 page renders technical key hint instead of raw-only input', /function KeyHint/.test(page), true);
expect('1.14 principal target uses selectable options', /buildPrincipalOptions/.test(page), true);
expect('1.15 page reads registry through authorizationService', /authorizationService[\s\S]*\.registry\(\)/.test(page), true);
expect('1.16 page derives menu options from registry', /function menuOptionsFromRegistry/.test(page), true);
expect('1.17 page derives resource options from registry', /function resourceOptionsFromRegistry/.test(page), true);
expect('1.18 page has security filter presets', /SECURITY_FILTER_PRESETS/.test(page), true);
expect('1.19 page has assigned-to-me preset', /assigned_to_me/.test(page), true);
expect('1.20 page has team-assignment preset', /assigned_to_my_team/.test(page), true);
expect('1.21 page applies preset into JSON textarea', /applySecurityFilterPreset/.test(page), true);
expect('1.22 page shows enforcement status notice', /function EnforcementStatusNotice/.test(page), true);
expect('1.23 page marks menu as live', /Menü canlı/.test(page), true);
expect('1.24 page marks CRUD field filter as preview', /CRUD \/ Alan \/ Güvenlik filtresi önizleme/.test(page), true);
expect('1.25 table has enforcement column', />Uygulama</.test(page), true);

expect('2.1 adminService has AuthorizationPolicy type', /export interface AuthorizationPolicy\s*\{/.test(adminService), true);
expect('2.2 adminService has list wrapper', /authorizationPolicies:[\s\S]*async list\(filter: AuthorizationPolicyListFilter\)/.test(adminService), true);
expect('2.3 adminService has create wrapper', /authorizationPolicies:[\s\S]*async create\(input: AuthorizationPolicyInput\)/.test(adminService), true);
expect('2.4 adminService has update wrapper', /authorizationPolicies:[\s\S]*async update\(/.test(adminService), true);
expect('2.5 adminService has deactivate wrapper', /authorizationPolicies:[\s\S]*async deactivate\(id: string\)/.test(adminService), true);
expect('2.6 adminService has effectivePreview wrapper', /authorizationPolicies:[\s\S]*async effectivePreview\(input: \{/.test(adminService), true);
expect('2.7 adminService defines AuthorizationEffectivePreview type', /export interface AuthorizationEffectivePreview\s*\{/.test(adminService), true);

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
