import { prisma } from '../db/client.js';
import { authorizationPolicyRepository } from '../db/authorizationPolicyRepository.js';
import {
  AuthorizationRuntimeError,
  assertDenyOnlyResourceAccess,
  buildCurrentAuthorizationUser,
  resolveAuthorizationTeamId,
} from './authorizationRuntime.js';

export function isAuthorizationResourceEnforcementEnabled() {
  return process.env.AUTHORIZATION_RESOURCE_ENFORCEMENT_ENABLED === 'true';
}

function allowedCompanyIdsFor(req) {
  return Array.isArray(req.user?.allowedCompanyIds) ? req.user.allowedCompanyIds : [];
}

export async function assertCompanyResourcePolicy(req, {
  companyId,
  resourceKey,
  action,
  baselineAllowed = true,
}) {
  if (!isAuthorizationResourceEnforcementEnabled()) return null;
  if (!companyId || typeof companyId !== 'string') {
    throw new AuthorizationRuntimeError('Şirket bilgisi gerekli.', 400, 'company_required');
  }
  const allowedCompanyIds = allowedCompanyIdsFor(req);
  if (!allowedCompanyIds.includes(companyId)) {
    throw new AuthorizationRuntimeError('Bu şirket için yetkin yok.', 403, 'company_forbidden');
  }

  const teamId = await resolveAuthorizationTeamId(prisma, req.user);
  const policyUser = buildCurrentAuthorizationUser(req.user, companyId, teamId);
  const overrides = await authorizationPolicyRepository.listOverrides(
    companyId,
    allowedCompanyIds,
  );
  return assertDenyOnlyResourceAccess({
    resourceKey,
    action,
    user: policyUser,
    overrides,
    baselineAllowed,
  });
}

export async function assertAllAllowedCompaniesResourcePolicy(req, {
  resourceKey,
  action,
  baselineAllowed = true,
}) {
  if (!isAuthorizationResourceEnforcementEnabled()) return null;
  const allowedCompanyIds = allowedCompanyIdsFor(req);
  for (const companyId of allowedCompanyIds) {
    await assertCompanyResourcePolicy(req, {
      companyId,
      resourceKey,
      action,
      baselineAllowed,
    });
  }
  return null;
}

export async function filterAllowedCompanyIdsByResourcePolicy(req, {
  resourceKey,
  action,
  baselineAllowed = true,
  throwIfEmpty = false,
  companyIds,
} = {}) {
  const allowedCompanyIds = allowedCompanyIdsFor(req);
  const requestedCompanyIds = Array.isArray(companyIds)
    ? companyIds.filter((id) => typeof id === 'string' && allowedCompanyIds.includes(id))
    : allowedCompanyIds;
  if (!isAuthorizationResourceEnforcementEnabled()) return requestedCompanyIds;

  const permitted = [];
  for (const companyId of requestedCompanyIds) {
    try {
      await assertCompanyResourcePolicy(req, {
        companyId,
        resourceKey,
        action,
        baselineAllowed,
      });
      permitted.push(companyId);
    } catch {
      // List/report endpoints are multi-company surfaces. A deny in one
      // tenant narrows that tenant out instead of blocking unrelated tenants.
    }
  }
  if (throwIfEmpty && permitted.length === 0 && requestedCompanyIds.length > 0) {
    throw new AuthorizationRuntimeError('Bu işlem için yetkin yok.', 403, 'baseline_denied');
  }
  return permitted;
}

async function accountPolicyCompanyIds(accountId, allowedCompanyIds) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      companyId: true,
      companies: {
        select: { companyId: true },
      },
    },
  });
  if (!account) return [];

  const companyIds = new Set();
  for (const rel of account.companies ?? []) {
    if (allowedCompanyIds.includes(rel.companyId)) companyIds.add(rel.companyId);
  }
  if (account.companyId && allowedCompanyIds.includes(account.companyId)) {
    companyIds.add(account.companyId);
  }
  if (account.companyId === null) {
    // Legacy shared account. It can be reached through any allowed tenant, so
    // a single allowed tenant policy is enough to read/mutate it.
    for (const companyId of allowedCompanyIds) companyIds.add(companyId);
  }
  return Array.from(companyIds);
}

export async function assertAccountResourcePolicy(req, {
  accountId,
  resourceKey = 'account',
  action,
  baselineAllowed = true,
}) {
  if (!isAuthorizationResourceEnforcementEnabled()) return null;
  const allowedCompanyIds = allowedCompanyIdsFor(req);
  const companyIds = await accountPolicyCompanyIds(accountId, allowedCompanyIds);
  if (companyIds.length === 0) {
    throw new AuthorizationRuntimeError('Müşteri bulunamadı.', 404, 'account_not_found');
  }

  let lastError = null;
  let deniedCount = 0;
  for (const companyId of companyIds) {
    try {
      await assertCompanyResourcePolicy(req, {
        companyId,
        resourceKey,
        action,
        baselineAllowed,
      });
    } catch (err) {
      deniedCount += 1;
      lastError = err;
    }
  }
  if (deniedCount > 0) {
    throw lastError ?? new AuthorizationRuntimeError('Bu işlem için yetkin yok.');
  }
  return null;
}

export async function filterAccountCompanyIdsByResourcePolicy(req, {
  accountId,
  resourceKey = 'account',
  action,
  baselineAllowed = true,
  throwIfEmpty = true,
}) {
  const allowedCompanyIds = allowedCompanyIdsFor(req);
  const companyIds = await accountPolicyCompanyIds(accountId, allowedCompanyIds);
  if (companyIds.length === 0) {
    throw new AuthorizationRuntimeError('Müşteri bulunamadı.', 404, 'account_not_found');
  }
  return filterAllowedCompanyIdsByResourcePolicy(req, {
    resourceKey,
    action,
    baselineAllowed,
    throwIfEmpty,
    companyIds,
  });
}
