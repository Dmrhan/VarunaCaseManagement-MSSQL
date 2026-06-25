import { apiFetch } from './caseService';

export type AuthorizationPrincipalType = 'systemRole' | 'companyRole' | 'team' | 'user';

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

export const authorizationService = {
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
};
