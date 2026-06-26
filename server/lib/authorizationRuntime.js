import { listFieldStates, resolveFieldState, explainResourceAccess } from './authorizationPolicy.js';
import {
  compileSecurityFilterWhere,
  mergeSecurityFilterWhere,
} from './authorizationSecurityFilter.js';

export class AuthorizationRuntimeError extends Error {
  constructor(message, status = 403, code = 'authorization_forbidden') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function resolveAuthorizationCompany(user, requestedCompanyId = '') {
  const requested = typeof requestedCompanyId === 'string' ? requestedCompanyId.trim() : '';
  const allowed = Array.isArray(user?.allowedCompanyIds) ? user.allowedCompanyIds : [];
  const companyId = requested || allowed[0] || '';
  if (!companyId) {
    throw new AuthorizationRuntimeError('Yetkili şirket bulunamadı.', 403, 'company_scope_empty');
  }
  if (!allowed.includes(companyId)) {
    throw new AuthorizationRuntimeError('Bu şirket için yetkin yok.', 403, 'company_forbidden');
  }
  return companyId;
}

export async function resolveAuthorizationTeamId(prismaClient, user) {
  if (!user?.personId) return null;
  const person = await prismaClient.person.findUnique({
    where: { id: user.personId },
    select: { teamId: true },
  });
  return person?.teamId ?? null;
}

export function buildAuthorizationPrincipalCandidates(user, companyId, teamId) {
  const candidates = [
    { type: 'systemRole', key: user.role, label: `Sistem rolü: ${user.role}` },
    { type: 'user', key: user.id, label: `Kullanıcı: ${user.fullName ?? user.email ?? user.id}` },
  ];
  const companyRole = user.companyRoles?.find((r) => r.companyId === companyId);
  if (companyRole) {
    candidates.push({
      type: 'companyRole',
      key: `${companyRole.companyId}:${companyRole.role}`,
      label: `Şirket rolü: ${companyRole.role}`,
    });
  }
  if (teamId) {
    candidates.push({ type: 'team', key: teamId, label: `Takım: ${teamId}` });
  }
  return candidates;
}

export function chooseAuthorizationPrincipal(user, companyId, teamId, requestedType = '') {
  const candidates = buildAuthorizationPrincipalCandidates(user, companyId, teamId);
  if (requestedType) {
    const found = candidates.find((c) => c.type === requestedType);
    if (found) return found;
  }
  return { type: 'user', key: user.id, label: 'Geçerli kullanıcı (tüm hedef kuralları)' };
}

export function buildCurrentAuthorizationUser(user, companyId, teamId) {
  const companyRole = user.companyRoles?.find((r) => r.companyId === companyId);
  return {
    id: user.id,
    personId: user.personId ?? null,
    role: user.role,
    teamId: teamId ?? null,
    companyRoles: companyRole ? [`${companyRole.companyId}:${companyRole.role}`] : [],
    allowedCompanyIds: Array.isArray(user.allowedCompanyIds) ? user.allowedCompanyIds : [],
  };
}

function principalMatchesAuthorizationUser(principal, user) {
  if (!principal || !user) return false;
  if (principal.type === 'systemRole') return principal.key === user.role;
  if (principal.type === 'user') return principal.key === user.id;
  if (principal.type === 'team') return principal.key === user.teamId;
  if (principal.type === 'companyRole') {
    return Array.isArray(user.companyRoles) && user.companyRoles.includes(principal.key);
  }
  return false;
}

export function compileSecurityFilterOverrides({
  resourceKey = 'case',
  user,
  overrides = [],
} = {}) {
  const filters = overrides
    .filter((override) => (
      override?.target === 'securityFilter' &&
      override.resourceKey === resourceKey &&
      override.filter &&
      principalMatchesAuthorizationUser(override.principal, user)
    ))
    .map((override) => {
      const compiled = compileSecurityFilterWhere(override.filter, { user });
      if (override.effect === 'deny') return { NOT: compiled };
      return compiled;
    });
  return mergeSecurityFilterWhere(filters);
}

export function explainDenyOnlyResourceAccess({
  resourceKey,
  action,
  user,
  overrides = [],
  baselineAllowed = true,
} = {}) {
  if (!baselineAllowed) {
    return {
      allowed: false,
      reason: 'baseline_denied',
      policyReason: null,
      resource: null,
    };
  }

  const decision = explainResourceAccess({
    resourceKey,
    action,
    user,
    overrides,
  });
  if (decision.reason === 'override_deny') {
    return {
      ...decision,
      allowed: false,
      policyReason: decision.reason,
    };
  }
  if (!decision.allowed && decision.reason !== 'override_allow') {
    return {
      ...decision,
      policyReason: decision.reason,
    };
  }
  return {
    ...decision,
    allowed: true,
    reason: decision.reason === 'override_allow' ? 'baseline_allow_with_policy_allow' : 'baseline_allow',
    policyReason: decision.reason,
  };
}

export function assertDenyOnlyResourceAccess(args = {}) {
  const result = explainDenyOnlyResourceAccess(args);
  if (!result.allowed) {
    throw new AuthorizationRuntimeError('Bu işlem için yetkin yok.', 403, result.reason);
  }
  return result;
}

export function listRequiredFields({
  scope,
  resourceKey = 'case',
  fields = [],
  user,
  overrides = [],
} = {}) {
  return fields.filter((fieldKey) => resolveFieldState({
    scope,
    resourceKey,
    fieldKey,
    user,
    overrides,
  }).required === true);
}

function isBlankValue(value) {
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return value == null;
}

export function assertRequiredFieldsPresent({
  scope,
  resourceKey = 'case',
  fields = [],
  values = {},
  user,
  overrides = [],
} = {}) {
  const required = listRequiredFields({
    scope,
    resourceKey,
    fields,
    user,
    overrides,
  });
  const missing = required.filter((fieldKey) => isBlankValue(values[fieldKey]));
  if (missing.length > 0) {
    throw new AuthorizationRuntimeError(
      `Zorunlu alan eksik: ${missing.join(', ')}`,
      400,
      'authorization_required_field_missing',
    );
  }
  return { required, missing: [] };
}

export function resolveFieldStatesForUser({
  scope,
  resourceKey = 'case',
  fields = [],
  user,
  overrides = [],
} = {}) {
  return listFieldStates({
    scope,
    resourceKey,
    fields,
    user,
    overrides,
  });
}
