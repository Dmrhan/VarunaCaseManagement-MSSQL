import {
  FIELD_ACTIONS,
  FIELD_POLICY_SCOPES,
  MENU_REGISTRY,
  PRINCIPAL_TYPES,
  RESOURCE_ACTIONS,
  findMenuByViewKey,
  findResource,
} from './authorizationRegistry.js';
import {
  POLICY_EFFECTS,
  validateSecurityFilterExpression,
} from './authorizationPolicy.js';

export const AUTHORIZATION_POLICY_TARGETS = Object.freeze([
  'menu',
  'resource',
  'field',
  'securityFilter',
]);

export class AuthorizationPolicyValidationError extends Error {
  constructor(message, code = 'authorization_policy_invalid', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableString(value) {
  const cleaned = cleanString(value);
  return cleaned || null;
}

function requireOne(value, message) {
  const cleaned = cleanString(value);
  if (!cleaned) throw new AuthorizationPolicyValidationError(message);
  return cleaned;
}

function assertKnownPrincipal(type) {
  if (!PRINCIPAL_TYPES.includes(type)) {
    throw new AuthorizationPolicyValidationError('Geçersiz yetki hedef tipi.');
  }
}

function assertKnownEffect(effect) {
  if (!POLICY_EFFECTS.includes(effect)) {
    throw new AuthorizationPolicyValidationError('Geçersiz policy etkisi.');
  }
}

function assertKnownTarget(target) {
  if (!AUTHORIZATION_POLICY_TARGETS.includes(target)) {
    throw new AuthorizationPolicyValidationError('Geçersiz policy hedefi.');
  }
}

function resolveMenu(input) {
  const menuKey = nullableString(input.menuKey);
  const viewKey = nullableString(input.viewKey);
  const menu = menuKey
    ? MENU_REGISTRY.find((m) => m.key === menuKey)
    : findMenuByViewKey(viewKey);
  if (!menu) throw new AuthorizationPolicyValidationError('Menü kaydı bulunamadı.');
  return { menuKey: menu.key, viewKey: menu.viewKey };
}

function assertKnownResource(resourceKey, action) {
  const resource = findResource(resourceKey);
  if (!resource) throw new AuthorizationPolicyValidationError('Kaynak kaydı bulunamadı.');
  if (action && (!RESOURCE_ACTIONS.includes(action) || !resource.actions.includes(action))) {
    throw new AuthorizationPolicyValidationError('Bu kaynak için geçersiz aksiyon.');
  }
  return resource;
}

function normalizeFilterJson(value) {
  if (value === null || value === undefined || value === '') return null;
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new AuthorizationPolicyValidationError('Güvenlik filtresi geçerli JSON değil.');
  }
  const result = validateSecurityFilterExpression(parsed);
  if (!result.ok) {
    throw new AuthorizationPolicyValidationError(`Güvenlik filtresi geçersiz: ${result.errors.join('; ')}`);
  }
  return JSON.stringify(parsed);
}

export function normalizeAuthorizationPolicyInput(input = {}) {
  const target = requireOne(input.target, 'Policy hedefi gerekli.');
  assertKnownTarget(target);

  const principalType = requireOne(input.principalType, 'Principal tipi gerekli.');
  assertKnownPrincipal(principalType);
  const principalKey = requireOne(input.principalKey, 'Principal anahtarı gerekli.');

  const effect = cleanString(input.effect) || 'allow';
  assertKnownEffect(effect);

  const out = {
    target,
    principalType,
    principalKey,
    effect,
    menuKey: null,
    viewKey: null,
    resourceKey: null,
    action: null,
    scope: null,
    fieldKey: null,
    filterJson: null,
    priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 100,
    isActive: input.isActive !== undefined ? Boolean(input.isActive) : true,
    notes: nullableString(input.notes),
  };

  if (target === 'menu') {
    const menu = resolveMenu(input);
    out.menuKey = menu.menuKey;
    out.viewKey = menu.viewKey;
    return out;
  }

  if (target === 'resource') {
    out.resourceKey = requireOne(input.resourceKey, 'Kaynak anahtarı gerekli.');
    out.action = requireOne(input.action, 'Aksiyon gerekli.');
    assertKnownResource(out.resourceKey, out.action);
    return out;
  }

  if (target === 'field') {
    out.scope = requireOne(input.scope, 'Alan kapsamı gerekli.');
    if (!FIELD_POLICY_SCOPES.includes(out.scope)) {
      throw new AuthorizationPolicyValidationError('Geçersiz alan kapsamı.');
    }
    out.resourceKey = requireOne(input.resourceKey ?? 'case', 'Kaynak anahtarı gerekli.');
    assertKnownResource(out.resourceKey, null);
    out.fieldKey = requireOne(input.fieldKey, 'Alan anahtarı gerekli.');
    out.action = requireOne(input.action, 'Alan aksiyonu gerekli.');
    if (!FIELD_ACTIONS.includes(out.action)) {
      throw new AuthorizationPolicyValidationError('Geçersiz alan aksiyonu.');
    }
    return out;
  }

  out.resourceKey = requireOne(input.resourceKey, 'Kaynak anahtarı gerekli.');
  assertKnownResource(out.resourceKey, null);
  out.filterJson = normalizeFilterJson(input.filterJson);
  if (!out.filterJson) throw new AuthorizationPolicyValidationError('Güvenlik filtresi gerekli.');
  return out;
}

export function authorizationPolicyRowToOverride(row) {
  if (!row || row.isActive === false) return null;
  const principal = { type: row.principalType, key: row.principalKey };
  if (row.target === 'menu') {
    return {
      target: 'menu',
      menuKey: row.menuKey,
      viewKey: row.viewKey,
      effect: row.effect,
      principal,
      priority: row.priority,
    };
  }
  if (row.target === 'resource') {
    return {
      target: 'resource',
      resourceKey: row.resourceKey,
      action: row.action,
      effect: row.effect,
      principal,
      priority: row.priority,
    };
  }
  if (row.target === 'field') {
    return {
      target: 'field',
      scope: row.scope,
      resourceKey: row.resourceKey,
      fieldKey: row.fieldKey,
      action: row.action,
      effect: row.effect,
      principal,
      priority: row.priority,
    };
  }
  if (row.target === 'securityFilter') {
    return {
      target: 'securityFilter',
      resourceKey: row.resourceKey,
      filter: row.filterJson ? JSON.parse(row.filterJson) : null,
      effect: row.effect,
      principal,
      priority: row.priority,
    };
  }
  return null;
}
