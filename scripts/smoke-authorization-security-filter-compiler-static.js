import fs from 'node:fs';
import path from 'node:path';
import {
  AuthorizationSecurityFilterError,
  compileSecurityFilterWhere,
  mergeSecurityFilterWhere,
  resolveSecurityField,
  resolveSecurityValue,
} from '../server/lib/authorizationSecurityFilter.js';

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

function expectJson(name, actual, expected) {
  expect(name, JSON.stringify(actual), JSON.stringify(expected));
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
      console.error(`  error:         ${err?.message}`);
    }
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const user = {
  id: 'user-1',
  personId: 'person-1',
  role: 'Agent',
  allowedCompanyIds: ['COMP-UNIVERA', 'COMP-FINROTA'],
  teamId: 'team-l1',
};

expect('1.1 record token resolves to companyId', resolveSecurityField('@record.companyId'), 'companyId');
expect('1.2 raw safe record field resolves', resolveSecurityField('assignedTeamId'), 'assignedTeamId');
expectThrows('1.3 unsafe raw field rejected', () => resolveSecurityField('deletedAt'), 'authorization_security_filter_unsafe_field');
expect('1.4 user token resolves scalar', resolveSecurityValue('@user.personId', { user }), 'person-1');
expectJson('1.5 user allowedCompanyIds resolves array', resolveSecurityValue('@user.allowedCompanyIds', { user }), ['COMP-UNIVERA', 'COMP-FINROTA']);
expectThrows('1.6 record token cannot be a value token', () => resolveSecurityValue('@record.companyId', { user }), 'authorization_security_filter_unsupported_value_token');

expectJson('2.1 company scope preset compiles', compileSecurityFilterWhere({
  op: 'in',
  field: '@record.companyId',
  value: '@user.allowedCompanyIds',
}, { user }), {
  companyId: { in: ['COMP-UNIVERA', 'COMP-FINROTA'] },
});
expectJson('2.2 assigned-to-me compiles', compileSecurityFilterWhere({
  op: 'eq',
  field: '@record.assignedPersonId',
  value: '@user.personId',
}, { user }), {
  assignedPersonId: 'person-1',
});
expectJson('2.3 assigned-to-team compiles', compileSecurityFilterWhere({
  op: 'eq',
  field: '@record.assignedTeamId',
  value: '@user.teamId',
}, { user }), {
  assignedTeamId: 'team-l1',
});
expectJson('2.4 created-by-user compiles', compileSecurityFilterWhere({
  op: 'eq',
  field: '@record.createdByUserId',
  value: '@user.id',
}, { user }), {
  createdByUserId: 'user-1',
});

expectJson('3.1 ne compiles', compileSecurityFilterWhere({
  op: 'ne',
  field: '@record.assignedTeamId',
  value: '@user.teamId',
}, { user }), {
  assignedTeamId: { not: 'team-l1' },
});
expectJson('3.2 notIn compiles', compileSecurityFilterWhere({
  op: 'notIn',
  field: '@record.companyId',
  value: ['COMP-OLD'],
}, { user }), {
  companyId: { notIn: ['COMP-OLD'] },
});
expectJson('3.3 contains compiles without MSSQL-incompatible mode', compileSecurityFilterWhere({
  op: 'contains',
  field: '@record.assignedTeamId',
  value: 'team',
}, { user }), {
  assignedTeamId: { contains: 'team' },
});
expectJson('3.4 exists compiles', compileSecurityFilterWhere({
  op: 'exists',
  field: '@record.assignedPersonId',
}, { user }), {
  assignedPersonId: { not: null },
});

expectJson('4.1 and compiles', compileSecurityFilterWhere({
  op: 'and',
  conditions: [
    { op: 'in', field: '@record.companyId', value: '@user.allowedCompanyIds' },
    { op: 'eq', field: '@record.assignedTeamId', value: '@user.teamId' },
  ],
}, { user }), {
  AND: [
    { companyId: { in: ['COMP-UNIVERA', 'COMP-FINROTA'] } },
    { assignedTeamId: 'team-l1' },
  ],
});
expectJson('4.2 or compiles', compileSecurityFilterWhere({
  op: 'or',
  conditions: [
    { op: 'eq', field: '@record.assignedPersonId', value: '@user.personId' },
    { op: 'eq', field: '@record.assignedTeamId', value: '@user.teamId' },
  ],
}, { user }), {
  OR: [
    { assignedPersonId: 'person-1' },
    { assignedTeamId: 'team-l1' },
  ],
});
expectJson('4.3 single-child and flattens', compileSecurityFilterWhere({
  op: 'and',
  conditions: [
    { op: 'eq', field: '@record.assignedTeamId', value: '@user.teamId' },
  ],
}, { user }), {
  assignedTeamId: 'team-l1',
});
expectJson('4.4 merge empty filters returns empty', mergeSecurityFilterWhere([]), {});
expectJson('4.5 merge one filter returns itself', mergeSecurityFilterWhere([{ companyId: 'COMP-UNIVERA' }]), { companyId: 'COMP-UNIVERA' });
expectJson('4.6 merge multiple filters ANDs', mergeSecurityFilterWhere([{ companyId: 'COMP-UNIVERA' }, { assignedTeamId: 'team-l1' }]), {
  AND: [{ companyId: 'COMP-UNIVERA' }, { assignedTeamId: 'team-l1' }],
});

expectThrows('5.1 invalid expression rejected before compile', () => compileSecurityFilterWhere({
  op: 'eq',
  field: '@record.companyId',
}, { user }), 'authorization_security_filter_invalid');
expectThrows('5.2 unknown token rejected by validation', () => compileSecurityFilterWhere({
  op: 'eq',
  field: '@record.companyId',
  value: '@user.departmentId',
}, { user }), 'authorization_security_filter_invalid');
expectThrows('5.3 unsafe field rejected by compiler', () => compileSecurityFilterWhere({
  op: 'eq',
  field: 'accountId',
  value: 'acc-1',
}, { user }), 'authorization_security_filter_unsafe_field');
expectThrows('5.4 in requires array after token resolution', () => compileSecurityFilterWhere({
  op: 'in',
  field: '@record.assignedPersonId',
  value: '@user.personId',
}, { user }), 'authorization_security_filter_array_required');
expectThrows('5.5 contains requires string', () => compileSecurityFilterWhere({
  op: 'contains',
  field: '@record.assignedTeamId',
  value: 123,
}, { user }), 'authorization_security_filter_string_required');

const compiler = read('server/lib/authorizationSecurityFilter.js');
const pkg = JSON.parse(read('package.json'));

expect('6.1 compiler does not import Prisma', /from ['"]@prisma\/client['"]/.test(compiler), false);
expect('6.2 compiler does not import Express/routes', /from ['"].*routes/.test(compiler), false);
expect('6.3 compiler does not use eval', /\beval\s*\(/.test(compiler), false);
expect('6.4 compiler does not use Function constructor', /\bnew Function\b|\bFunction\s*\(/.test(compiler), false);
expect('6.5 compiler exports typed error', /export class AuthorizationSecurityFilterError/.test(compiler), true);
expect('6.6 compiler keeps record field allowlist', /SAFE_RECORD_FIELDS/.test(compiler), true);
expect('6.7 smoke script registered', pkg.scripts['smoke:authorization-security-filter'], 'node scripts/smoke-authorization-security-filter-compiler-static.js');

expect('7.1 compiler error is Error subclass', new AuthorizationSecurityFilterError('x', 'y') instanceof Error, true);

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
