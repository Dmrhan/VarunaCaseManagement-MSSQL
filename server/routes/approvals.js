import { Router } from 'express';
import { verifyJwt, requireRole } from '../db/auth.js';
import {
  ApprovalAccessError,
  ApprovalValidationError,
  approveApproval,
  createPolicy,
  getPolicy,
  listApprovalsForCase,
  listPolicies,
  matchPolicyForCase,
  rejectApproval,
  resolveApprover,
  submitApproval,
  updatePolicy,
} from '../db/approvalRepository.js';
import { prisma } from '../db/client.js';

/**
 * /api/approvals — WR-D4 Phase 1 Resolution Approval surface.
 *
 * Mounted as a single sibling router (NOT nested under /cases or /admin) so
 * tenant scope + role guards live in one place and there is no risk of
 * shadow-matching paths in the cases/admin routers.
 *
 * Path map:
 *   GET    /policies                    — admin list (companyId optional filter)
 *   POST   /policies                    — admin create
 *   GET    /policies/:id                — admin read one
 *   PATCH  /policies/:id                — admin update
 *
 *   GET    /cases/:caseId               — case-scoped approval list + matched policy snapshot
 *   POST   /cases/:caseId/submit        — submit current resolution for approval
 *   POST   /:approvalId/approve         — approve a pending row
 *   POST   /:approvalId/reject          — reject a pending row (applies rejectionBehavior)
 *
 * Phase 1 NO external sending — see planning card §16. Approval lifecycle
 * hooks intentionally do NOT call NotificationDispatch (table not yet
 * created); Phase 2 (D3) adds it.
 */

const router = Router();
router.use(verifyJwt);

const POLICY_ADMIN_ROLES = ['Admin', 'SystemAdmin'];
const SUBMIT_ROLES = ['Agent', 'Backoffice', 'CSM', 'Supervisor', 'Admin', 'SystemAdmin'];
const DECIDE_ROLES = ['Supervisor', 'CSM', 'Admin', 'SystemAdmin'];

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ApprovalAccessError) {
        return res.status(err.status ?? 403).json({ error: err.code ?? 'forbidden', message: err.message });
      }
      if (err instanceof ApprovalValidationError) {
        return res
          .status(err.status ?? 400)
          .json({ error: err.code ?? 'validation_error', message: err.message });
      }
      console.error('[approvals]', err?.code ?? err?.name ?? 'error', err?.message);
      res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
    }
  };
}

// ─────────────────────────────────────────────────────────────────
// Policy CRUD (admin surface)
// ─────────────────────────────────────────────────────────────────

router.get(
  '/policies',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : null;
    const items = await listPolicies({
      allowedCompanyIds: req.user.allowedCompanyIds,
      companyId,
    });
    res.json({ value: items });
  }),
);

router.post(
  '/policies',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const created = await createPolicy({
      data: req.body ?? {},
      user: req.user,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.status(201).json(created);
  }),
);

router.get(
  '/policies/:id',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const row = await getPolicy({
      id: req.params.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Politika bulunamadı.' });
    res.json(row);
  }),
);

router.patch(
  '/policies/:id',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const updated = await updatePolicy({
      id: req.params.id,
      data: req.body ?? {},
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json(updated);
  }),
);

// ─────────────────────────────────────────────────────────────────
// Case-scoped read (CaseDetail right pane)
// ─────────────────────────────────────────────────────────────────

/**
 * GET /api/approvals/cases/:caseId
 *
 * Returns the approval history of a case plus the currently matched policy
 * snapshot (so the UI can decide whether to surface "Çözüm Onayına Gönder"
 * vs. plain "Kapat"). Returns 404 only when the case itself is missing or
 * out-of-scope; an in-scope case with no approvals returns
 * `{ approvals: [], matchedPolicy: null|policy }`.
 */
router.get(
  '/cases/:caseId',
  asyncRoute(async (req, res) => {
    const approvals = await listApprovalsForCase({
      caseId: req.params.caseId,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    if (approvals === null) {
      return res.status(404).json({ error: 'not_found', message: 'Vaka bulunamadı.' });
    }
    // Re-fetch case fields needed for policy match (avoids leaking caseRow
    // shape through the repo's listApprovalsForCase contract).
    const caseRow = await prisma.case.findUnique({
      where: { id: req.params.caseId },
      select: {
        id: true,
        companyId: true,
        status: true,
        category: true,
        subCategory: true,
        priority: true,
        supportLevel: true,
        assignedTeamId: true,
        approvalState: true,
      },
    });
    const matchedPolicy = caseRow ? await matchPolicyForCase(caseRow) : null;
    let expectedApprover = null;
    if (matchedPolicy && caseRow) {
      const resolved = await resolveApprover({ policy: matchedPolicy, caseRow });
      expectedApprover = resolved ? { personId: resolved.personId } : null;
    }
    res.json({
      approvals,
      matchedPolicy,
      expectedApprover,
      approvalState: caseRow?.approvalState ?? null,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────
// Submit / Approve / Reject
// ─────────────────────────────────────────────────────────────────

router.post(
  '/cases/:caseId/submit',
  requireRole(...SUBMIT_ROLES),
  asyncRoute(async (req, res) => {
    const approval = await submitApproval({
      caseId: req.params.caseId,
      payload: req.body ?? {},
      user: req.user,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.status(201).json(approval);
  }),
);

router.post(
  '/:approvalId/approve',
  requireRole(...DECIDE_ROLES),
  asyncRoute(async (req, res) => {
    const updated = await approveApproval({
      approvalId: req.params.approvalId,
      payload: req.body ?? {},
      user: req.user,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json(updated);
  }),
);

router.post(
  '/:approvalId/reject',
  requireRole(...DECIDE_ROLES),
  asyncRoute(async (req, res) => {
    const updated = await rejectApproval({
      approvalId: req.params.approvalId,
      payload: req.body ?? {},
      user: req.user,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json(updated);
  }),
);

export default router;
