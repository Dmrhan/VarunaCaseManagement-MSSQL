import fs from 'node:fs';
import path from 'node:path';
import {
  resolveFieldStatesForUser,
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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const user = {
  id: 'user-agent',
  role: 'Agent',
  personId: 'person-1',
  teamId: 'team-l1',
  companyRoles: ['COMP-UNIVERA:Agent'],
  allowedCompanyIds: ['COMP-UNIVERA'],
};

const states = resolveFieldStatesForUser({
  scope: 'case.detail',
  resourceKey: 'case',
  fields: ['description', 'resolutionNote', 'requestType'],
  user,
  overrides: [
    {
      target: 'field',
      scope: 'case.detail',
      resourceKey: 'case',
      fieldKey: 'description',
      action: 'masked',
      effect: 'allow',
      principal: { type: 'team', key: 'team-l1' },
    },
    {
      target: 'field',
      scope: 'case.detail',
      resourceKey: 'case',
      fieldKey: 'requestType',
      action: 'editable',
      effect: 'deny',
      principal: { type: 'systemRole', key: 'Agent' },
    },
    {
      target: 'field',
      scope: 'case.detail',
      resourceKey: 'case',
      fieldKey: 'resolutionNote',
      action: 'visible',
      effect: 'deny',
      principal: { type: 'team', key: 'team-l1' },
    },
  ],
});

const byField = Object.fromEntries(states.map((x) => [x.fieldKey, x.state]));
expect('1.1 field-state helper returns all requested fields', states.length, 3);
expect('1.2 masked policy applies', byField.description.masked, true);
expect('1.3 editable deny applies', byField.requestType.editable, false);
expect('1.4 visible deny applies', byField.resolutionNote.visible, false);

const authRoute = read('server/routes/authorization.js');
const runtime = read('server/lib/authorizationRuntime.js');
const service = read('src/services/authorizationService.ts');
const page = read('src/features/cases/CaseDetailPage.tsx');
const flags = read('src/config/featureFlags.ts');
const adminPage = read('src/features/admin/AdminAuthorizationPoliciesPage.tsx');
const envExample = read('.env.example');
const pkg = JSON.parse(read('package.json'));

expect('2.1 runtime imports listFieldStates', /import \{ listFieldStates, resolveFieldState/.test(runtime), true);
expect('2.2 runtime exports resolveFieldStatesForUser', /export function resolveFieldStatesForUser/.test(runtime), true);
expect('2.3 runtime helper is pure no Prisma import', /@prisma\/client|db\/client/.test(runtime), false);

expect('3.1 authorization route exposes field-states endpoint', /router\.get\('\/field-states'/.test(authRoute), true);
expect('3.2 endpoint resolves current company', /const companyId = resolveRequestedCompany\(req\)/.test(authRoute), true);
expect('3.3 endpoint resolves current team', /const teamId = await resolveTeamId\(req\.user\)/.test(authRoute), true);
expect('3.4 endpoint loads policy overrides', /authorizationPolicyRepository\.listOverrides/.test(authRoute), true);
expect('3.5 endpoint returns field-state items', /res\.json\(\{ companyId, scope, resourceKey, fields: items \}\)/.test(authRoute), true);

expect('4.1 service defines AuthorizationFieldState', /export interface AuthorizationFieldState/.test(service), true);
expect('4.2 service has fieldStates wrapper', /async fieldStates/.test(service), true);
expect('4.3 service calls field-states endpoint', /\/api\/authorization\/field-states/.test(service), true);

expect('5.1 frontend field UI flag exists', /authorizationFieldUiEnforcementEnabled/.test(flags), true);
expect('5.2 env documents frontend field UI flag', /VITE_AUTHORIZATION_FIELD_UI_ENFORCEMENT_ENABLED=false/.test(envExample), true);
expect('5.3 CaseDetail imports authorizationService', /authorizationService/.test(page), true);
expect('5.4 CaseDetail fetches case.detail field states', /scope: 'case\.detail'/.test(page), true);
expect('5.5 CaseDetail fail-opens field states on error', /catch\(\(\) => \{[\s\S]*setFieldStates\(\{\}\)/.test(page), true);
expect('5.6 CaseDetail has selected field list', /CASE_DETAIL_AUTHZ_FIELDS/.test(page), true);
expect('5.7 CaseDetail applies visible hide', /canShowField\('description'\)/.test(page), true);
expect('5.8 CaseDetail applies masked display', /const maskedDisplay = <span/.test(page), true);
expect('5.9 CaseDetail disables edit for non-editable field', /disabled=\{!canEditField\('requestType'\)/.test(page), true);
expect('5.10 CaseDetail gates Smart Ticket meta', /canShowField\('smartTicketMeta'\)/.test(page), true);

expect('6.1 admin page mentions field UI pilot', /Case Detail Detay sekmesinde/.test(adminPage), true);
expect('6.2 smoke script registered', pkg.scripts['smoke:authorization-field-ui'], 'node scripts/smoke-authorization-field-ui-pilot-static.js');

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
