import { validateSecurityFilterExpression } from './authorizationPolicy.js';

/**
 * Pure compiler for AuthorizationPolicy.securityFilter expressions.
 *
 * This module intentionally does not import Prisma, Express, auth middleware,
 * or route code. It only turns the validated policy vocabulary into a Prisma
 * where fragment that future runtime pilots can compose into case queries.
 */

const RECORD_FIELD_BY_TOKEN = Object.freeze({
  '@record.companyId': 'companyId',
  '@record.assignedPersonId': 'assignedPersonId',
  '@record.assignedTeamId': 'assignedTeamId',
  '@record.createdByUserId': 'createdByUserId',
});

const USER_VALUE_RESOLVERS = Object.freeze({
  '@user.id': (user) => user?.id,
  '@user.personId': (user) => user?.personId,
  '@user.role': (user) => user?.role,
  '@user.allowedCompanyIds': (user) => user?.allowedCompanyIds,
  '@user.teamId': (user) => user?.teamId,
});

const SAFE_RECORD_FIELDS = Object.freeze(new Set(Object.values(RECORD_FIELD_BY_TOKEN)));

export class AuthorizationSecurityFilterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AuthorizationSecurityFilterError';
    this.code = code;
    this.details = details;
  }
}

function assertPlainObject(value, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthorizationSecurityFilterError(code, message);
  }
}

export function resolveSecurityField(field) {
  if (RECORD_FIELD_BY_TOKEN[field]) return RECORD_FIELD_BY_TOKEN[field];
  if (typeof field === 'string' && SAFE_RECORD_FIELDS.has(field)) return field;
  throw new AuthorizationSecurityFilterError(
    'authorization_security_filter_unsafe_field',
    `Security filter field is not allowed: ${field}`,
    { field },
  );
}

export function resolveSecurityValue(value, { user } = {}) {
  if (typeof value === 'string' && value.startsWith('@')) {
    const resolver = USER_VALUE_RESOLVERS[value];
    if (!resolver) {
      throw new AuthorizationSecurityFilterError(
        'authorization_security_filter_unsupported_value_token',
        `Security filter value token is not supported here: ${value}`,
        { value },
      );
    }
    return resolver(user);
  }
  return value;
}

function assertArrayValue(value, op) {
  if (!Array.isArray(value)) {
    throw new AuthorizationSecurityFilterError(
      'authorization_security_filter_array_required',
      `Security filter operator ${op} requires an array value`,
      { op },
    );
  }
  return value;
}

function compactConditions(conditions) {
  return conditions.filter((condition) => (
    condition &&
    typeof condition === 'object' &&
    !Array.isArray(condition) &&
    Object.keys(condition).length > 0
  ));
}

export function compileSecurityFilterWhere(expr, { user } = {}) {
  const validation = validateSecurityFilterExpression(expr);
  if (!validation.ok) {
    throw new AuthorizationSecurityFilterError(
      'authorization_security_filter_invalid',
      'Security filter expression is invalid',
      { errors: validation.errors },
    );
  }
  return compileValidatedExpression(expr, { user });
}

function compileValidatedExpression(expr, { user }) {
  assertPlainObject(expr, 'authorization_security_filter_invalid', 'Security filter expression is invalid');

  if (expr.op === 'and' || expr.op === 'or') {
    const compiled = compactConditions(
      expr.conditions.map((child) => compileValidatedExpression(child, { user })),
    );
    if (compiled.length === 0) return {};
    if (compiled.length === 1) return compiled[0];
    return expr.op === 'and' ? { AND: compiled } : { OR: compiled };
  }

  const field = resolveSecurityField(expr.field);

  if (expr.op === 'exists') {
    return { [field]: { not: null } };
  }

  const value = Array.isArray(expr.value)
    ? expr.value.map((item) => resolveSecurityValue(item, { user }))
    : resolveSecurityValue(expr.value, { user });

  if (expr.op === 'eq') return { [field]: value };
  if (expr.op === 'ne') return { [field]: { not: value } };
  if (expr.op === 'in') return { [field]: { in: assertArrayValue(value, expr.op) } };
  if (expr.op === 'notIn') return { [field]: { notIn: assertArrayValue(value, expr.op) } };
  if (expr.op === 'contains') {
    if (typeof value !== 'string') {
      throw new AuthorizationSecurityFilterError(
        'authorization_security_filter_string_required',
        'Security filter contains operator requires a string value',
        { field, value },
      );
    }
    return { [field]: { contains: value } };
  }

  throw new AuthorizationSecurityFilterError(
    'authorization_security_filter_unsupported_operator',
    `Security filter operator is not supported: ${expr.op}`,
    { op: expr.op },
  );
}

export function mergeSecurityFilterWhere(filters = []) {
  const compiled = compactConditions(filters);
  if (compiled.length === 0) return {};
  if (compiled.length === 1) return compiled[0];
  return { AND: compiled };
}

export const __securityFilterInternal = Object.freeze({
  RECORD_FIELD_BY_TOKEN,
  USER_VALUE_RESOLVERS,
  SAFE_RECORD_FIELDS,
});
