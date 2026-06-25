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
} from './authorizationRegistry.js';

/**
 * Authorization Policy MVP-1.
 *
 * Pure shadow-mode helpers for menu visibility. This module intentionally does
 * not call DB, Express, auth middleware, or UI code. Runtime enforcement will
 * be wired in later phases after the registry/policy vocabulary stabilizes.
 */

export const POLICY_EFFECTS = Object.freeze(['allow', 'deny']);

export const DEFAULT_FIELD_STATE = Object.freeze({
  visible: true,
  readable: true,
  editable: true,
  required: false,
  masked: false,
});

function normalizeRole(role) {
  return typeof role === 'string' ? role.trim() : '';
}

function resolveMenu(menuKeyOrViewKey) {
  if (!menuKeyOrViewKey) return null;
  return (
    MENU_REGISTRY.find((m) => m.key === menuKeyOrViewKey) ??
    findMenuByViewKey(menuKeyOrViewKey)
  );
}

function resolveResource(resourceKey) {
  if (!resourceKey) return null;
  return findResource(resourceKey);
}

function isFeatureEnabled(featureFlags, flagName) {
  if (!flagName) return true;
  return featureFlags?.[flagName] === true;
}

function actionAllowedByResource(resource, action) {
  return (
    RESOURCE_ACTIONS.includes(action) &&
    Array.isArray(resource?.actions) &&
    resource.actions.includes(action)
  );
}

function findResourceOverrideDecision(resource, action, user, overrides) {
  if (!Array.isArray(overrides) || overrides.length === 0) return null;
  const matches = overrides.filter((o) => {
    if (!o || o.target !== 'resource') return false;
    if (!POLICY_EFFECTS.includes(o.effect)) return false;
    if (o.resourceKey !== resource.key) return false;
    if (o.action !== action && o.action !== '*') return false;
    return principalMatchesUser(o.principal, user);
  });
  if (matches.some((o) => o.effect === 'deny')) return 'deny';
  if (matches.some((o) => o.effect === 'allow')) return 'allow';
  return null;
}

function normalizeFieldKey(fieldKey) {
  return typeof fieldKey === 'string' ? fieldKey.trim() : '';
}

function isValidFieldScope(scope) {
  return FIELD_POLICY_SCOPES.includes(scope);
}

function isValidFieldAction(action) {
  return FIELD_ACTIONS.includes(action);
}

function isKnownSecurityToken(value) {
  return typeof value === 'string' && value.startsWith('@')
    ? SECURITY_FILTER_TOKENS.includes(value)
    : true;
}

function validateSecurityOperand(errors, path, name, value) {
  if (typeof value !== 'string') {
    errors.push(`${path}.${name}: must be a string`);
    return;
  }
  if (!value.trim()) {
    errors.push(`${path}.${name}: cannot be blank`);
    return;
  }
  if (!isKnownSecurityToken(value)) {
    errors.push(`${path}.${name}: unknown token ${value}`);
  }
}

function findFieldOverrideDecision({ scope, resourceKey, fieldKey, action, user, overrides }) {
  if (!Array.isArray(overrides) || overrides.length === 0) return null;
  const matches = overrides.filter((o) => {
    if (!o || o.target !== 'field') return false;
    if (!POLICY_EFFECTS.includes(o.effect)) return false;
    if (o.scope !== scope) return false;
    if (o.resourceKey !== resourceKey) return false;
    if (o.fieldKey !== fieldKey && o.fieldKey !== '*') return false;
    if (o.action !== action && o.action !== '*') return false;
    return principalMatchesUser(o.principal, user);
  });
  if (matches.some((o) => o.effect === 'deny')) return 'deny';
  if (matches.some((o) => o.effect === 'allow')) return 'allow';
  return null;
}

function principalMatchesUser(principal, user) {
  if (!principal || !user) return false;
  if (!PRINCIPAL_TYPES.includes(principal.type)) return false;
  if (principal.type === 'systemRole') return principal.key === user.role;
  if (principal.type === 'user') return principal.key === user.id;
  if (principal.type === 'team') return principal.key === user.teamId;
  if (principal.type === 'companyRole') {
    return Array.isArray(user.companyRoles) && user.companyRoles.includes(principal.key);
  }
  return false;
}

function findOverrideDecision(menu, user, overrides) {
  if (!Array.isArray(overrides) || overrides.length === 0) return null;
  const matches = overrides.filter((o) => {
    if (!o || o.target !== 'menu') return false;
    if (!POLICY_EFFECTS.includes(o.effect)) return false;
    if (o.menuKey !== menu.key && o.viewKey !== menu.viewKey) return false;
    return principalMatchesUser(o.principal, user);
  });
  if (matches.some((o) => o.effect === 'deny')) return 'deny';
  if (matches.some((o) => o.effect === 'allow')) return 'allow';
  return null;
}

export function explainMenuAccess({
  menuKey,
  viewKey,
  user,
  featureFlags = {},
  overrides = [],
} = {}) {
  const menu = resolveMenu(menuKey ?? viewKey);
  if (!menu) {
    return { allowed: false, reason: 'menu_not_found', menu: null };
  }
  if (!user) {
    return { allowed: false, reason: 'no_user', menu };
  }
  if (!isFeatureEnabled(featureFlags, menu.featureFlag)) {
    return { allowed: false, reason: 'feature_disabled', menu };
  }

  const override = findOverrideDecision(menu, user, overrides);
  if (override === 'deny') {
    return { allowed: false, reason: 'override_deny', menu };
  }
  if (override === 'allow') {
    return { allowed: true, reason: 'override_allow', menu };
  }

  const role = normalizeRole(user.role);
  const allowed = Array.isArray(menu.defaultRoles) && menu.defaultRoles.includes(role);
  return {
    allowed,
    reason: allowed ? 'default_role_allow' : 'default_role_deny',
    menu,
  };
}

export function canSeeMenu(args = {}) {
  return explainMenuAccess(args).allowed;
}

export function listVisibleMenus({
  user,
  featureFlags = {},
  overrides = [],
  group,
} = {}) {
  return MENU_REGISTRY.filter((menu) => {
    if (group && menu.group !== group) return false;
    return explainMenuAccess({
      menuKey: menu.key,
      user,
      featureFlags,
      overrides,
    }).allowed;
  });
}

export function explainResourceAccess({
  resourceKey,
  action,
  user,
  overrides = [],
} = {}) {
  const resource = resolveResource(resourceKey);
  if (!resource) {
    return { allowed: false, reason: 'resource_not_found', resource: null };
  }
  if (!actionAllowedByResource(resource, action)) {
    return { allowed: false, reason: 'action_not_supported', resource };
  }
  if (!user) {
    return { allowed: false, reason: 'no_user', resource };
  }

  const override = findResourceOverrideDecision(resource, action, user, overrides);
  if (override === 'deny') {
    return { allowed: false, reason: 'override_deny', resource };
  }
  if (override === 'allow') {
    return { allowed: true, reason: 'override_allow', resource };
  }

  // Shadow-mode default: a listed action is allowed by the current route-layer
  // enforcement documented in RESOURCE_REGISTRY.currentEnforcement. Future
  // persisted policies will narrow/expand this via overrides.
  return { allowed: true, reason: 'registered_action', resource };
}

export function canAccessResource(args = {}) {
  return explainResourceAccess(args).allowed;
}

export function listResourceActions({
  user,
  overrides = [],
} = {}) {
  return RESOURCE_REGISTRY.flatMap((resource) => resource.actions.map((action) => ({
    resourceKey: resource.key,
    action,
    allowed: explainResourceAccess({
      resourceKey: resource.key,
      action,
      user,
      overrides,
    }).allowed,
  })));
}

export function explainFieldAccess({
  scope,
  resourceKey = 'case',
  fieldKey,
  action,
  user,
  overrides = [],
  defaultState = DEFAULT_FIELD_STATE,
} = {}) {
  const normalizedFieldKey = normalizeFieldKey(fieldKey);
  if (!isValidFieldScope(scope)) {
    return { allowed: false, reason: 'scope_not_supported', fieldKey: normalizedFieldKey };
  }
  if (!normalizedFieldKey) {
    return { allowed: false, reason: 'field_not_provided', fieldKey: normalizedFieldKey };
  }
  if (!isValidFieldAction(action)) {
    return { allowed: false, reason: 'field_action_not_supported', fieldKey: normalizedFieldKey };
  }
  if (!user) {
    return { allowed: false, reason: 'no_user', fieldKey: normalizedFieldKey };
  }

  const override = findFieldOverrideDecision({
    scope,
    resourceKey,
    fieldKey: normalizedFieldKey,
    action,
    user,
    overrides,
  });
  if (override === 'deny') {
    return { allowed: false, reason: 'override_deny', fieldKey: normalizedFieldKey };
  }
  if (override === 'allow') {
    return { allowed: true, reason: 'override_allow', fieldKey: normalizedFieldKey };
  }

  const allowed = defaultState?.[action] === true;
  return {
    allowed,
    reason: allowed ? 'default_field_allow' : 'default_field_deny',
    fieldKey: normalizedFieldKey,
  };
}

export function canAccessField(args = {}) {
  return explainFieldAccess(args).allowed;
}

export function resolveFieldState({
  scope,
  resourceKey = 'case',
  fieldKey,
  user,
  overrides = [],
  defaultState = DEFAULT_FIELD_STATE,
} = {}) {
  const normalizedFieldKey = normalizeFieldKey(fieldKey);
  return FIELD_ACTIONS.reduce((acc, action) => {
    acc[action] = explainFieldAccess({
      scope,
      resourceKey,
      fieldKey: normalizedFieldKey,
      action,
      user,
      overrides,
      defaultState,
    }).allowed;
    return acc;
  }, {});
}

export function listFieldStates({
  scope,
  resourceKey = 'case',
  fields = [],
  user,
  overrides = [],
  defaultState = DEFAULT_FIELD_STATE,
} = {}) {
  return fields.map((fieldKey) => ({
    fieldKey,
    state: resolveFieldState({
      scope,
      resourceKey,
      fieldKey,
      user,
      overrides,
      defaultState,
    }),
  }));
}

export function validateSecurityFilterExpression(expr, path = '$', depth = 0) {
  const errors = [];
  if (depth > 8) {
    return { ok: false, errors: [`${path}: max depth exceeded`] };
  }
  if (!expr || typeof expr !== 'object' || Array.isArray(expr)) {
    return { ok: false, errors: [`${path}: expression must be an object`] };
  }
  if (!SECURITY_FILTER_OPERATORS.includes(expr.op)) {
    return { ok: false, errors: [`${path}.op: unsupported operator`] };
  }

  if (expr.op === 'and' || expr.op === 'or') {
    if (!Array.isArray(expr.conditions) || expr.conditions.length === 0) {
      errors.push(`${path}.conditions: must be a non-empty array`);
    } else {
      expr.conditions.forEach((child, index) => {
        const childResult = validateSecurityFilterExpression(child, `${path}.conditions[${index}]`, depth + 1);
        errors.push(...childResult.errors);
      });
    }
    return { ok: errors.length === 0, errors };
  }

  validateSecurityOperand(errors, path, 'field', expr.field);

  if (expr.op === 'exists') {
    if ('value' in expr) errors.push(`${path}.value: not allowed for exists`);
    return { ok: errors.length === 0, errors };
  }

  if (expr.op === 'in' || expr.op === 'notIn') {
    if (!Array.isArray(expr.value) && typeof expr.value !== 'string') {
      errors.push(`${path}.value: must be an array or token`);
    } else if (Array.isArray(expr.value)) {
      expr.value.forEach((value, index) => {
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          errors.push(`${path}.value[${index}]: must be scalar`);
        }
        if (typeof value === 'string' && !isKnownSecurityToken(value)) {
          errors.push(`${path}.value[${index}]: unknown token ${value}`);
        }
      });
    } else if (!isKnownSecurityToken(expr.value)) {
      errors.push(`${path}.value: unknown token ${expr.value}`);
    }
    return { ok: errors.length === 0, errors };
  }

  if (!('value' in expr)) {
    errors.push(`${path}.value: required`);
  } else if (typeof expr.value === 'object' && expr.value !== null) {
    errors.push(`${path}.value: must be scalar or token`);
  } else if (typeof expr.value === 'string' && !isKnownSecurityToken(expr.value)) {
    errors.push(`${path}.value: unknown token ${expr.value}`);
  }

  return { ok: errors.length === 0, errors };
}

export function isSecurityFilterExpressionValid(expr) {
  return validateSecurityFilterExpression(expr).ok;
}
