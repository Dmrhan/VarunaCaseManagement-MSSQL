import fs from 'node:fs';
import path from 'node:path';
import {
  assertRequiredFieldsPresent,
  listRequiredFields,
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
  id: 'user-agent',
  role: 'Agent',
  teamId: 'team-l1',
  companyRoles: ['COMP-UNIVERA:Agent'],
  allowedCompanyIds: ['COMP-UNIVERA'],
};

const overrides = [
  {
    target: 'field',
    scope: 'case.close',
    resourceKey: 'case',
    fieldKey: 'resolutionNote',
    action: 'required',
    effect: 'allow',
    principal: { type: 'team', key: 'team-l1' },
  },
  {
    target: 'field',
    scope: 'case.close',
    resourceKey: 'case',
    fieldKey: 'rootCauseGroup',
    action: 'required',
    effect: 'allow',
    principal: { type: 'systemRole', key: 'Agent' },
  },
];

const required = listRequiredFields({
  scope: 'case.close',
  resourceKey: 'case',
  fields: ['resolutionNote', 'cancellationReason', 'rootCauseGroup'],
  user,
  overrides,
});
expect('1.1 required fields include team-required resolutionNote', required.includes('resolutionNote'), true);
expect('1.2 required fields include role-required rootCauseGroup', required.includes('rootCauseGroup'), true);
expect('1.3 required fields do not include untouched cancellationReason', required.includes('cancellationReason'), false);

expect('1.4 present required fields pass', assertRequiredFieldsPresent({
  scope: 'case.close',
  resourceKey: 'case',
  fields: ['resolutionNote', 'rootCauseGroup'],
  values: { resolutionNote: 'Çözüldü', rootCauseGroup: 'rcg.config' },
  user,
  overrides,
}).missing.length, 0);
expectThrows('1.5 blank required field throws validation error', () => assertRequiredFieldsPresent({
  scope: 'case.close',
  resourceKey: 'case',
  fields: ['resolutionNote', 'rootCauseGroup'],
  values: { resolutionNote: '   ', rootCauseGroup: 'rcg.config' },
  user,
  overrides,
}), 'authorization_required_field_missing');

const casesRoute = read('server/routes/cases.js');
const runtime = read('server/lib/authorizationRuntime.js');
const adminPage = read('src/features/admin/AdminAuthorizationPoliciesPage.tsx');
const envExample = read('.env.example');
const pkg = JSON.parse(read('package.json'));

expect('2.1 runtime imports resolveFieldState', /resolveFieldState/.test(runtime), true);
expect('2.2 runtime exports listRequiredFields', /export function listRequiredFields/.test(runtime), true);
expect('2.3 runtime exports assertRequiredFieldsPresent', /export function assertRequiredFieldsPresent/.test(runtime), true);
expect('2.4 runtime reports required-field error code', /authorization_required_field_missing/.test(runtime), true);

expect('3.1 cases route imports assertRequiredFieldsPresent', /assertRequiredFieldsPresent/.test(casesRoute), true);
expect('3.2 cases route has field enforcement flag', /AUTHORIZATION_FIELD_ENFORCEMENT_ENABLED/.test(casesRoute), true);
expect('3.3 field flag defaults off unless true', /process\.env\.AUTHORIZATION_FIELD_ENFORCEMENT_ENABLED === 'true'/.test(casesRoute), true);
expect('3.4 transition route calls required-field guard before repository transition', /assertCaseCloseRequiredFields\(req, \{ nextStatus, payload \}\)[\s\S]*caseRepository\.transitionStatus/.test(casesRoute), true);
expect('3.5 close candidates include resolutionNote', /resolutionNote/.test(casesRoute), true);
expect('3.6 close candidates include Smart Ticket closure fields', /rootCauseGroup[\s\S]*rootCauseDetail[\s\S]*resolutionType[\s\S]*permanentPrevention/.test(casesRoute), true);
expect('3.7 cancel candidates include cancellationReason', /nextStatus === 'İptal Edildi'[\s\S]*cancellationReason/.test(casesRoute), true);
expect('3.8 field pilot uses case.close scope', /scope: 'case\.close'/.test(casesRoute), true);

expect('4.1 admin page marks field as pilot', /Alan zorunluluğu pilot/.test(adminPage), true);
expect('4.2 admin page documents case.close pilot', /case\.close kapsamındaki seçili kapanış/.test(adminPage), true);
expect('4.3 env documents field enforcement flag', /AUTHORIZATION_FIELD_ENFORCEMENT_ENABLED=false/.test(envExample), true);
expect('4.4 env documents close field candidates', /resolutionNote, cancellationReason ve Smart Ticket closure alanları/.test(envExample), true);
expect('4.5 smoke script registered', pkg.scripts['smoke:authorization-field-enforcement'], 'node scripts/smoke-authorization-field-enforcement-pilot-static.js');

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
