import { Router } from 'express';
import { prisma } from '../db/client.js';
import { verifyJwt } from '../db/auth.js';
import { authorizationPolicyRepository } from '../db/authorizationPolicyRepository.js';
import { buildAuthorizationEffectivePreview } from '../lib/authorizationEffectivePreview.js';

const router = Router();

router.use(verifyJwt);

function resolveRequestedCompany(req) {
  const requested = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
  const allowed = Array.isArray(req.user?.allowedCompanyIds) ? req.user.allowedCompanyIds : [];
  const companyId = requested || allowed[0] || '';
  if (!companyId) {
    const err = new Error('Yetkili şirket bulunamadı.');
    err.status = 403;
    err.code = 'company_scope_empty';
    throw err;
  }
  if (!allowed.includes(companyId)) {
    const err = new Error('Bu şirket için yetkin yok.');
    err.status = 403;
    err.code = 'company_forbidden';
    throw err;
  }
  return companyId;
}

async function resolveTeamId(user) {
  if (!user?.personId) return null;
  const person = await prisma.person.findUnique({
    where: { id: user.personId },
    select: { teamId: true },
  });
  return person?.teamId ?? null;
}

function getServerFeatureFlags() {
  return {
    smartTicketIntakeEnabled:
      process.env.VITE_SMART_TICKET_INTAKE_ENABLED === 'true' ||
      (process.env.VITE_SMART_TICKET_INTAKE_ENABLED == null && process.env.NODE_ENV !== 'production'),
  };
}

function buildPrincipalCandidates(user, companyId, teamId) {
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

function choosePrincipal(user, companyId, teamId, requestedType) {
  const candidates = buildPrincipalCandidates(user, companyId, teamId);
  if (requestedType) {
    const found = candidates.find((c) => c.type === requestedType);
    if (found) return found;
  }
  return { type: 'user', key: user.id, label: 'Geçerli kullanıcı (tüm principal kuralları)' };
}

function buildCurrentPolicyUser(user, companyId, teamId) {
  const companyRole = user.companyRoles?.find((r) => r.companyId === companyId);
  return {
    id: user.id,
    role: user.role,
    teamId: teamId ?? null,
    companyRoles: companyRole ? [`${companyRole.companyId}:${companyRole.role}`] : [],
    allowedCompanyIds: Array.isArray(user.allowedCompanyIds) ? user.allowedCompanyIds : [],
  };
}

router.get('/effective-menus', async (req, res) => {
  try {
    const companyId = resolveRequestedCompany(req);
    const teamId = await resolveTeamId(req.user);
    const principal = choosePrincipal(
      req.user,
      companyId,
      teamId,
      typeof req.query.principalType === 'string' ? req.query.principalType : '',
    );
    const overrides = await authorizationPolicyRepository.listOverrides(
      companyId,
      req.user.allowedCompanyIds,
    );
    const requestedPrincipalType = typeof req.query.principalType === 'string' ? req.query.principalType : '';
    const preview = buildAuthorizationEffectivePreview({
      companyId,
      ...(requestedPrincipalType
        ? { principalType: principal.type, principalKey: principal.key }
        : { user: buildCurrentPolicyUser(req.user, companyId, teamId) }),
      overrides,
      featureFlags: getServerFeatureFlags(),
    });

    res.json({
      companyId,
      principal,
      candidates: buildPrincipalCandidates(req.user, companyId, teamId),
      summary: preview.summary,
      menus: preview.menus,
    });
  } catch (err) {
    if (err?.status) {
      return res.status(err.status).json({
        error: err.code ?? 'authorization_error',
        message: err.message,
      });
    }
    console.error('[authorization] effective-menus', err);
    return res.status(500).json({ error: 'internal', message: 'Yetki menüleri hesaplanamadı.' });
  }
});

export default router;
