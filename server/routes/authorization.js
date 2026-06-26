import { Router } from 'express';
import { prisma } from '../db/client.js';
import { verifyJwt } from '../db/auth.js';
import { authorizationPolicyRepository } from '../db/authorizationPolicyRepository.js';
import { buildAuthorizationEffectivePreview } from '../lib/authorizationEffectivePreview.js';
import { getAuthorizationRegistry } from '../lib/authorizationRegistry.js';
import {
  buildAuthorizationPrincipalCandidates,
  buildCurrentAuthorizationUser,
  chooseAuthorizationPrincipal,
  resolveAuthorizationCompany,
  resolveAuthorizationTeamId,
  resolveFieldStatesForUser,
} from '../lib/authorizationRuntime.js';

const router = Router();

router.use(verifyJwt);

router.get('/registry', (_req, res) => {
  res.json(getAuthorizationRegistry());
});

function resolveRequestedCompany(req) {
  return resolveAuthorizationCompany(
    req.user,
    typeof req.query.companyId === 'string' ? req.query.companyId : '',
  );
}

async function resolveTeamId(user) {
  return resolveAuthorizationTeamId(prisma, user);
}

function getServerFeatureFlags() {
  return {
    smartTicketIntakeEnabled:
      process.env.VITE_SMART_TICKET_INTAKE_ENABLED === 'true' ||
      (process.env.VITE_SMART_TICKET_INTAKE_ENABLED == null && process.env.NODE_ENV !== 'production'),
  };
}

function choosePrincipal(user, companyId, teamId, requestedType) {
  return chooseAuthorizationPrincipal(user, companyId, teamId, requestedType);
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
        : { user: buildCurrentAuthorizationUser(req.user, companyId, teamId) }),
      overrides,
      featureFlags: getServerFeatureFlags(),
    });

    res.json({
      companyId,
      principal,
      candidates: buildAuthorizationPrincipalCandidates(req.user, companyId, teamId),
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

router.get('/field-states', async (req, res) => {
  try {
    const companyId = resolveRequestedCompany(req);
    const teamId = await resolveTeamId(req.user);
    const fields = typeof req.query.fields === 'string'
      ? req.query.fields.split(',').map((x) => x.trim()).filter(Boolean)
      : [];
    const scope = typeof req.query.scope === 'string' ? req.query.scope : '';
    const resourceKey = typeof req.query.resourceKey === 'string' ? req.query.resourceKey : 'case';
    const overrides = await authorizationPolicyRepository.listOverrides(
      companyId,
      req.user.allowedCompanyIds,
    );
    const items = resolveFieldStatesForUser({
      scope,
      resourceKey,
      fields,
      user: buildCurrentAuthorizationUser(req.user, companyId, teamId),
      overrides,
    });
    res.json({ companyId, scope, resourceKey, fields: items });
  } catch (err) {
    if (err?.status) {
      return res.status(err.status).json({
        error: err.code ?? 'authorization_error',
        message: err.message,
      });
    }
    console.error('[authorization] field-states', err);
    return res.status(500).json({ error: 'internal', message: 'Alan yetkileri hesaplanamadı.' });
  }
});

export default router;
