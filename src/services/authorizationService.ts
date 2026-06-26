import { apiFetch } from './caseService';

export type AuthorizationPrincipalType = 'systemRole' | 'companyRole' | 'team' | 'user';

export interface AuthorizationRegistry {
  principalTypes: AuthorizationPrincipalType[];
  resourceActions: string[];
  fieldActions: string[];
  securityFilterOperators: string[];
  securityFilterTokens: string[];
  menus: Array<{
    key: string;
    label: string;
    viewKey: string;
    group: string;
    defaultRoles: string[];
    featureFlag?: string;
    entryPointOnly?: boolean;
  }>;
  resources: Array<{
    key: string;
    label: string;
    category: string;
    actions: string[];
    currentEnforcement?: string;
  }>;
  fieldPolicyScopes: string[];
}

export interface EffectiveMenuAccess {
  companyId: string;
  principal: {
    type: AuthorizationPrincipalType;
    key: string;
    label: string;
  };
  candidates: Array<{
    type: AuthorizationPrincipalType;
    key: string;
    label: string;
  }>;
  summary: {
    menuAllowed: number;
    menuDenied: number;
    resourceAllowed: number;
    resourceDenied: number;
    securityFilterCount: number;
  };
  menus: Array<{
    key: string;
    viewKey: string;
    label: string;
    group: string;
    allowed: boolean;
    reason: string;
  }>;
}

export interface AuthorizationFieldState {
  visible: boolean;
  readable: boolean;
  editable: boolean;
  required: boolean;
  masked: boolean;
}

export interface AuthorizationFieldStateItem {
  fieldKey: string;
  state: AuthorizationFieldState;
}

export interface EffectiveFieldStates {
  companyId: string;
  scope: string;
  resourceKey: string;
  fields: AuthorizationFieldStateItem[];
}

export const authorizationService = {
  /**
   * Static policy vocabulary used by admin selector UIs. This is read-only and
   * intentionally auth-protected so internal menu/resource keys are not exposed
   * publicly.
   */
  async registry(): Promise<AuthorizationRegistry> {
    const data = await apiFetch<AuthorizationRegistry>(
      '/api/authorization/registry',
      undefined,
      'Yetki sözlüğü alınamadı',
    );
    if (!data) throw new Error('Yetki sözlüğü alınamadı');
    return data;
  },

  /**
   * Current-user effective menu snapshot. This is intentionally not wired into
   * App navigation yet; runtime menu enforcement will be a separate PR after
   * UAT confirms the policy matrix.
   */
  async effectiveMenus(input: {
    companyId?: string;
    principalType?: AuthorizationPrincipalType;
  } = {}): Promise<EffectiveMenuAccess> {
    const qs = new URLSearchParams();
    if (input.companyId) qs.set('companyId', input.companyId);
    if (input.principalType) qs.set('principalType', input.principalType);
    const data = await apiFetch<EffectiveMenuAccess>(
      `/api/authorization/effective-menus${qs.toString() ? `?${qs}` : ''}`,
      undefined,
      'Yetki menüleri alınamadı',
    );
    if (!data) throw new Error('Yetki menüleri alınamadı');
    return data;
  },

  async fieldStates(input: {
    companyId?: string;
    scope: string;
    resourceKey?: string;
    fields: string[];
  }): Promise<EffectiveFieldStates> {
    const qs = new URLSearchParams();
    if (input.companyId) qs.set('companyId', input.companyId);
    qs.set('scope', input.scope);
    qs.set('resourceKey', input.resourceKey ?? 'case');
    qs.set('fields', input.fields.join(','));
    const data = await apiFetch<EffectiveFieldStates>(
      `/api/authorization/field-states?${qs}`,
      undefined,
      'Alan yetkileri alınamadı',
    );
    if (!data) throw new Error('Alan yetkileri alınamadı');
    return data;
  },
};
