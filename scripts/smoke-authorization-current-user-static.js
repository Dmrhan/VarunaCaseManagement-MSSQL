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
const app = read('server/app.js');
const appTsx = read('src/App.tsx');
const pkg = JSON.parse(read('package.json'));

expect('1.1 authorization route exists', exists(routePath), true);
expect('1.2 authorization route uses verifyJwt', /router\.use\(verifyJwt\)/.test(route), true);
expect('1.3 route exposes effective-menus endpoint', /router\.get\('\/effective-menus'/.test(route), true);
expect('1.4 route resolves allowed company scope', /resolveRequestedCompany/.test(route), true);
expect('1.5 route rejects out-of-scope company', /company_forbidden/.test(route), true);
expect('1.6 route resolves teamId from Person', /prisma\.person\.findUnique/.test(route), true);
expect('1.7 route loads active policy overrides', /authorizationPolicyRepository\.listOverrides/.test(route), true);
expect('1.8 route uses effective preview builder', /buildAuthorizationEffectivePreview/.test(route), true);
expect('1.9 route returns menus only, not full field matrix', /menus: preview\.menus/.test(route), true);

expect('2.1 app imports authorization router', /authorizationRouter/.test(app), true);
expect('2.2 app mounts authorization router', /app\.use\('\/api\/authorization', authorizationRouter\)/.test(app), true);

expect('3.1 frontend authorization service exists', exists(servicePath), true);
expect('3.2 frontend service exports authorizationService', /export const authorizationService/.test(service), true);
expect('3.3 frontend service calls effective-menus', /\/api\/authorization\/effective-menus/.test(service), true);
expect('3.4 frontend service documents not wired into App yet', /not wired into[\s\S]*App navigation/.test(service), true);

expect('4.1 App does not import authorizationService yet', /authorizationService/.test(appTsx), false);
expect('4.2 App does not runtime-filter NAV by effective menus yet', /effectiveMenus\(/.test(appTsx), false);

expect('5.1 smoke script registered', pkg.scripts['smoke:authorization-current-user'], 'node scripts/smoke-authorization-current-user-static.js');

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
