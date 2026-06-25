import {
  MENU_REGISTRY,
  PRINCIPAL_TYPES,
  RESOURCE_ACTIONS,
  RESOURCE_REGISTRY,
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
