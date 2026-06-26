import fs from 'node:fs';
import path from 'node:path';

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

const routePath = 'server/routes/authorization.js';
const servicePath = 'src/services/authorizationService.ts';
const route = read(routePath);
const service = read(servicePath);
const runtime = read('server/lib/authorizationRuntime.js');
const app = read('server/app.js');
const appTsx = read('src/App.tsx');
const pkg = JSON.parse(read('package.json'));

expect('1.1 authorization route exists', exists(routePath), true);
expect('1.2 authorization route uses verifyJwt', /router\.use\(verifyJwt\)/.test(route), true);
expect('1.3 route exposes effective-menus endpoint', /router\.get\('\/effective-menus'/.test(route), true);
expect('1.3b route exposes read-only registry endpoint', /router\.get\('\/registry'/.test(route), true);
expect('1.3c route returns static authorization registry', /getAuthorizationRegistry/.test(route), true);
expect('1.4 route resolves allowed company scope', /resolveRequestedCompany/.test(route), true);
expect('1.5 route rejects out-of-scope company', /company_forbidden/.test(runtime), true);
expect('1.6 route resolves teamId from Person', /prismaClient\.person\.findUnique/.test(runtime), true);
expect('1.7 route loads active policy overrides', /authorizationPolicyRepository\.listOverrides/.test(route), true);
expect('1.8 route uses effective preview builder', /buildAuthorizationEffectivePreview/.test(route), true);
expect('1.9 route returns menus only, not full field matrix', /menus: preview\.menus/.test(route), true);
expect('1.10 route builds current policy user for all principal types', /buildCurrentAuthorizationUser/.test(route), true);
expect('1.11 route uses current user context when principalType is absent',
  /requestedPrincipalType[\s\S]*\? \{ principalType: principal\.type, principalKey: principal\.key \}[\s\S]*: \{ user: buildCurrentAuthorizationUser/.test(route),
  true);
expect('1.12 route still supports explicit single-principal preview',
  /requestedPrincipalType[\s\S]*principalType: principal\.type/.test(route),
  true);

expect('2.1 app imports authorization router', /authorizationRouter/.test(app), true);
expect('2.2 app mounts authorization router', /app\.use\('\/api\/authorization', authorizationRouter\)/.test(app), true);

expect('3.1 frontend authorization service exists', exists(servicePath), true);
expect('3.2 frontend service exports authorizationService', /export const authorizationService/.test(service), true);
expect('3.3 frontend service calls effective-menus', /\/api\/authorization\/effective-menus/.test(service), true);
expect('3.4 frontend service documents current-user menu API', /Current-user effective menu snapshot/.test(service), true);
expect('3.5 frontend service calls registry endpoint', /\/api\/authorization\/registry/.test(service), true);
expect('3.6 frontend service defines AuthorizationRegistry type', /export interface AuthorizationRegistry/.test(service), true);

expect('4.1 App imports authorizationService', /import \{ authorizationService \}/.test(appTsx), true);
expect('4.2 App stores effective menu access state', /setEffectiveMenuAccess/.test(appTsx), true);
expect('4.3 App calls effectiveMenus behind feature flag', /authorizationService\.effectiveMenus\(\)/.test(appTsx), true);
expect('4.4 App uses authorization menu feature flag', /featureFlags\.authorizationMenuEnforcementEnabled/.test(appTsx), true);
expect('4.5 App keeps fail-open behavior on endpoint failure', /Fail-open[\s\S]*setEffectiveMenuFailed\(true\)/.test(appTsx), true);
expect('4.6 canShowView checks effectiveMenuFailed', /function canShowView[\s\S]*effectiveMenuFailed/.test(appTsx), true);
expect('4.7 canShowView checks effective menu allowed flag in deny-only mode',
  /menu \? fallback && menu\.allowed : fallback/.test(appTsx),
  true);
expect('4.8 handleNavSelect blocks hidden menu keys', /function handleNavSelect[\s\S]*canShowView\(key, true\)/.test(appTsx), true);
expect('4.9 NAV list is filtered by canShowView', /NAV\.filter\(\(item\) => canShowView\(item\.key, item\.available\)\)\.map/.test(appTsx), true);
expect('4.10 Workspace buttons are policy-gated', /showCalendar[\s\S]*showWatching[\s\S]*showKbViewer/.test(appTsx), true);
expect('4.11 Report buttons are policy-gated', /showReportsSection[\s\S]*showAiUsage[\s\S]*showQaScores[\s\S]*showPatterns/.test(appTsx), true);
expect('4.12 canShowView does not short-circuit default-denied menus before policy result',
  /function canShowView[\s\S]*if \(!fallback\) return false/.test(appTsx),
  false);
expect('4.13 canShowView cannot widen access beyond legacy role fallback',
  /cannot open pages whose APIs still reject the user's role/.test(appTsx),
  true);

expect('5.1 feature flag registered', /authorizationMenuEnforcementEnabled/.test(read('src/config/featureFlags.ts')), true);
expect('5.2 smoke script registered', pkg.scripts['smoke:authorization-current-user'], 'node scripts/smoke-authorization-current-user-static.js');
expect('5.3 resource runtime smoke script registered', pkg.scripts['smoke:authorization-resource-runtime'], 'node scripts/smoke-authorization-resource-runtime-static.js');

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
