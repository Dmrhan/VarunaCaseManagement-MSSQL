import {
  FIELD_POLICY_SCOPES,
  MENU_REGISTRY,
  RESOURCE_REGISTRY,
} from './authorizationRegistry.js';
import {
  explainFieldAccess,
  explainMenuAccess,
  explainResourceAccess,
  resolveFieldState,
} from './authorizationPolicy.js';

const DEFAULT_PREVIEW_FIELDS = Object.freeze([
  'title',
  'description',
  'priority',
  'requestType',
  'assignedPersonId',
  'assignedTeamId',
  'resolutionNote',
  'rootCauseGroup',
  'rootCauseDetail',
  'transferNote',
]);

function buildSyntheticUser({ principalType, principalKey, companyId }) {
  const key = typeof principalKey === 'string' ? principalKey.trim() : '';
  const role = principalType === 'systemRole' ? key : 'Agent';
  const teamId = principalType === 'team' ? key : null;
  const id = principalType === 'user' ? key : `preview:${principalType}:${key}`;
  const companyRoles = principalType === 'companyRole'
    ? [key]
    : [`${companyId}:${role}`];
  return {
    id,
    role,
    teamId,
    companyRoles,
    allowedCompanyIds: companyId ? [companyId] : [],
  };
}

function principalMatchesUser(principal, user) {
  if (!principal || !user) return false;
  if (principal.type === 'systemRole') return principal.key === user.role;
  if (principal.type === 'user') return principal.key === user.id;
  if (principal.type === 'team') return principal.key === user.teamId;
  if (principal.type === 'companyRole') {
    return Array.isArray(user.companyRoles) && user.companyRoles.includes(principal.key);
  }
  return false;
}

function listSecurityFiltersForUser(overrides, user) {
  return overrides
    .filter((o) => o?.target === 'securityFilter' && principalMatchesUser(o.principal, user))
    .map((o) => ({
      resourceKey: o.resourceKey,
      effect: o.effect,
      priority: o.priority,
      filter: o.filter,
    }));
}

function collectPreviewFields(overrides) {
  const fields = new Set(DEFAULT_PREVIEW_FIELDS);
  overrides
    .filter((o) => o?.target === 'field' && typeof o.fieldKey === 'string' && o.fieldKey !== '*')
    .forEach((o) => fields.add(o.fieldKey));
  return [...fields].sort((a, b) => a.localeCompare(b, 'tr-TR'));
}

export function buildAuthorizationEffectivePreview({
  companyId,
  principalType,
  principalKey,
  overrides = [],
  featureFlags = {},
} = {}) {
  const user = buildSyntheticUser({ principalType, principalKey, companyId });
  const menus = MENU_REGISTRY.map((menu) => {
    const decision = explainMenuAccess({
      menuKey: menu.key,
      user,
      featureFlags,
      overrides,
    });
    return {
      key: menu.key,
      viewKey: menu.viewKey,
      label: menu.label,
      group: menu.group,
      allowed: decision.allowed,
      reason: decision.reason,
    };
  });

  const resources = RESOURCE_REGISTRY.map((resource) => ({
    key: resource.key,
    label: resource.label,
    category: resource.category,
    actions: resource.actions.map((action) => {
      const decision = explainResourceAccess({
        resourceKey: resource.key,
        action,
        user,
        overrides,
      });
      return {
        action,
        allowed: decision.allowed,
        reason: decision.reason,
      };
    }),
  }));

  const previewFields = collectPreviewFields(overrides);
  const fields = FIELD_POLICY_SCOPES.map((scope) => ({
    scope,
    fields: previewFields.map((fieldKey) => ({
      fieldKey,
      state: resolveFieldState({
        scope,
        resourceKey: 'case',
        fieldKey,
        user,
        overrides,
      }),
      reasons: ['visible', 'editable', 'required', 'masked'].reduce((acc, action) => {
        acc[action] = explainFieldAccess({
          scope,
          resourceKey: 'case',
          fieldKey,
          action,
          user,
          overrides,
        }).reason;
        return acc;
      }, {}),
    })),
  }));

  const securityFilters = listSecurityFiltersForUser(overrides, user);

  return {
    principal: {
      type: principalType,
      key: principalKey,
      syntheticUser: user,
    },
    summary: {
      menuAllowed: menus.filter((m) => m.allowed).length,
      menuDenied: menus.filter((m) => !m.allowed).length,
      resourceAllowed: resources.reduce(
        (sum, r) => sum + r.actions.filter((a) => a.allowed).length,
        0,
      ),
      resourceDenied: resources.reduce(
        (sum, r) => sum + r.actions.filter((a) => !a.allowed).length,
        0,
      ),
      securityFilterCount: securityFilters.length,
    },
    menus,
    resources,
    fields,
    securityFilters,
  };
}
