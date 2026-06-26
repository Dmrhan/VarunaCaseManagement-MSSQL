import { prisma } from './client.js';
import { assertActorObject } from '../lib/actor.js';
import {
  AuthorizationPolicyValidationError,
  authorizationPolicyRowToOverride,
  normalizeAuthorizationPolicyInput,
} from '../lib/authorizationPolicyRows.js';

export class AuthorizationPolicyAccessError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.status = status;
    this.code = 'authorization_policy_forbidden';
  }
}

function assertCompanyScope(companyId, allowedCompanyIds) {
  if (!companyId) {
    throw new AuthorizationPolicyValidationError('companyId gerekli.');
  }
  if (Array.isArray(allowedCompanyIds) && !allowedCompanyIds.includes(companyId)) {
    throw new AuthorizationPolicyAccessError('Bu şirket için yetkin yok.');
  }
}

async function getScopedPolicy(id, allowedCompanyIds) {
  const row = await prisma.authorizationPolicy.findUnique({ where: { id } });
  if (!row) throw new AuthorizationPolicyValidationError('Policy bulunamadı.', 'authorization_policy_not_found', 404);
  assertCompanyScope(row.companyId, allowedCompanyIds);
  return row;
}

export const authorizationPolicyRepository = {
  async getById(id, allowedCompanyIds) {
    return getScopedPolicy(id, allowedCompanyIds);
  },

  async list({ companyId, target, isActive } = {}, allowedCompanyIds) {
    if (companyId) assertCompanyScope(companyId, allowedCompanyIds);
    const where = {
      ...(companyId ? { companyId } : Array.isArray(allowedCompanyIds) ? { companyId: { in: allowedCompanyIds } } : {}),
      ...(target ? { target } : {}),
      ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
    };
    return prisma.authorizationPolicy.findMany({
      where,
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        updatedBy: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: [
        { companyId: 'asc' },
        { target: 'asc' },
        { priority: 'asc' },
        { createdAt: 'desc' },
      ],
    });
  },

  async listOverrides(companyId, allowedCompanyIds) {
    assertCompanyScope(companyId, allowedCompanyIds);
    const rows = await prisma.authorizationPolicy.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(authorizationPolicyRowToOverride).filter(Boolean);
  },

  async create(input, allowedCompanyIds, actor) {
    assertActorObject(actor, 'authorizationPolicyRepository.create');
    assertCompanyScope(input?.companyId, allowedCompanyIds);
    const normalized = normalizeAuthorizationPolicyInput(input);
    return prisma.authorizationPolicy.create({
      data: {
        companyId: input.companyId,
        ...normalized,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
  },

  async update(id, patch, allowedCompanyIds, actor) {
    assertActorObject(actor, 'authorizationPolicyRepository.update');
    const current = await getScopedPolicy(id, allowedCompanyIds);
    const normalized = normalizeAuthorizationPolicyInput({
      ...current,
      ...patch,
      companyId: current.companyId,
    });
    return prisma.authorizationPolicy.update({
      where: { id },
      data: {
        ...normalized,
        updatedByUserId: actor.userId,
      },
    });
  },

  async setActive(id, isActive, allowedCompanyIds, actor) {
    assertActorObject(actor, 'authorizationPolicyRepository.setActive');
    await getScopedPolicy(id, allowedCompanyIds);
    return prisma.authorizationPolicy.update({
      where: { id },
      data: {
        isActive: Boolean(isActive),
        updatedByUserId: actor.userId,
      },
    });
  },

  async remove(id, allowedCompanyIds, actor) {
    return this.setActive(id, false, allowedCompanyIds, actor);
  },
};
