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
import {
  NotificationAccessError,
  NotificationValidationError,
  createRule,
  createTemplate,
  getRule,
  getTemplate,
  listDispatches,
  listDispatchesForCase,
  resolveCustomerCommunication,
  listRules,
  listTemplates,
  manualConfirmDispatch,
  previewTemplate,
  updateRule,
  updateTemplate,
} from '../db/notificationRepository.js';
import { prisma } from '../db/client.js';

/**
 * /api/approvals — WR-D4/D3 Approval + Notification surface.
 *
 * Single mount point (not nested under /cases or /admin) — tenant scope +
 * role guards live in one place.
 *
 * Phase 1 (approval):
 *   GET    /policies                  — admin list
 *   POST   /policies                  — admin create
 *   GET    /policies/:id              — admin read
 *   PATCH  /policies/:id              — admin update
 *   GET    /cases/:caseId             — case-scoped approval list + matched policy
 *   POST   /cases/:caseId/submit      — submit resolution for approval
 *   POST   /:approvalId/approve       — approve
 *   POST   /:approvalId/reject        — reject
 *
 * Phase 2 (notification — log-only / manual):
 *   GET    /notification-templates              — admin list
 *   POST   /notification-templates              — admin create
 *   GET    /notification-templates/:id          — admin read
 *   PATCH  /notification-templates/:id          — admin update
 *   POST   /notification-templates/:id/preview  — admin preview render
 *   GET    /notification-rules                  — admin list
 *   POST   /notification-rules                  — admin create
 *   GET    /notification-rules/:id              — admin read
 *   PATCH  /notification-rules/:id              — admin update
 *   GET    /notification-dispatches             — admin viewer (filter list)
 *   GET    /cases/:caseId/dispatches            — case-scoped dispatch list
 *   POST   /dispatches/:id/manual-confirm       — operator manual-confirm
 *
 * No external sending — Phase 4 (active provider) adds delivery.
 */

const router = Router();
router.use(verifyJwt);

const POLICY_ADMIN_ROLES = ['Admin', 'SystemAdmin'];
const SUBMIT_ROLES = ['Agent', 'Backoffice', 'CSM', 'Supervisor', 'Admin', 'SystemAdmin'];
const DECIDE_ROLES = ['Supervisor', 'CSM', 'Admin', 'SystemAdmin'];
// WR-D4 Phase 2 — viewer roles per product decision: Supervisor+CSM+Admin+SystemAdmin.
const DISPATCH_VIEWER_ROLES = ['Supervisor', 'CSM', 'Admin', 'SystemAdmin'];
// Manual confirm = any operator working the case (case detail access).
const DISPATCH_MANUAL_CONFIRM_ROLES = SUBMIT_ROLES;

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ApprovalAccessError || err instanceof NotificationAccessError) {
        return res.status(err.status ?? 403).json({ error: err.code ?? 'forbidden', message: err.message });
      }
      if (err instanceof ApprovalValidationError || err instanceof NotificationValidationError) {
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

// ─────────────────────────────────────────────────────────────────
// WR-D4 Phase 2 — Notification Templates (admin CRUD)
// ─────────────────────────────────────────────────────────────────

router.get(
  '/notification-templates',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : null;
    const items = await listTemplates({ allowedCompanyIds: req.user.allowedCompanyIds, companyId });
    res.json({ value: items });
  }),
);

router.post(
  '/notification-templates',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const created = await createTemplate({
      data: req.body ?? {},
      user: req.user,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.status(201).json(created);
  }),
);

router.get(
  '/notification-templates/:id',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const row = await getTemplate({ id: req.params.id, allowedCompanyIds: req.user.allowedCompanyIds });
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Şablon bulunamadı.' });
    res.json(row);
  }),
);

router.patch(
  '/notification-templates/:id',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const updated = await updateTemplate({
      id: req.params.id,
      data: req.body ?? {},
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json(updated);
  }),
);

router.post(
  '/notification-templates/:id/preview',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const out = await previewTemplate({
      templateId: req.params.id,
      sampleCaseId: req.body?.sampleCaseId ?? null,
      vars: req.body?.vars ?? null,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json(out);
  }),
);

// ─────────────────────────────────────────────────────────────────
// WR-D4 Phase 2 — Notification Rules (admin CRUD)
// ─────────────────────────────────────────────────────────────────

router.get(
  '/notification-rules',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : null;
    const items = await listRules({ allowedCompanyIds: req.user.allowedCompanyIds, companyId });
    res.json({ value: items });
  }),
);

router.post(
  '/notification-rules',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const created = await createRule({
      data: req.body ?? {},
      user: req.user,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.status(201).json(created);
  }),
);

router.get(
  '/notification-rules/:id',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const row = await getRule({ id: req.params.id, allowedCompanyIds: req.user.allowedCompanyIds });
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Kural bulunamadı.' });
    res.json(row);
  }),
);

router.patch(
  '/notification-rules/:id',
  requireRole(...POLICY_ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const updated = await updateRule({
      id: req.params.id,
      data: req.body ?? {},
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json(updated);
  }),
);

// ─────────────────────────────────────────────────────────────────
// WR-D4 Phase 2 — Dispatch viewer + manual confirm
// ─────────────────────────────────────────────────────────────────

/**
 * GET /api/approvals/notification-dispatches
 * Audit viewer for Supervisor+CSM+Admin+SystemAdmin (per product decision).
 */
router.get(
  '/notification-dispatches',
  requireRole(...DISPATCH_VIEWER_ROLES),
  asyncRoute(async (req, res) => {
    const out = await listDispatches({
      allowedCompanyIds: req.user.allowedCompanyIds,
      companyId: typeof req.query.companyId === 'string' ? req.query.companyId : null,
      event: typeof req.query.event === 'string' ? req.query.event : null,
      state: typeof req.query.state === 'string' ? req.query.state : null,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json(out);
  }),
);

/**
 * GET /api/approvals/cases/:caseId/dispatches
 * Per-case dispatch list — visible to anyone with case-read access
 * (route layer relies on case scope guard in repo). Used by CaseDetail
 * communication card.
 */
router.get(
  '/cases/:caseId/dispatches',
  asyncRoute(async (req, res) => {
    const items = await listDispatchesForCase({
      caseId: req.params.caseId,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    if (items === null) {
      return res.status(404).json({ error: 'not_found', message: 'Vaka bulunamadı.' });
    }
    res.json({ value: items });
  }),
);

/**
 * GET /api/approvals/cases/:caseId/customer-channel
 *
 * WR-D4/D3 Phase 3 — returns the resolved customer communication target
 * for this case (channel + identifier + source + opt-out / no-channel
 * suppression hints). Used by the CaseDetail Communication card badge.
 */
router.get(
  '/cases/:caseId/customer-channel',
  asyncRoute(async (req, res) => {
    const caseRow = await prisma.case.findUnique({
      where: { id: req.params.caseId },
      select: {
        id: true,
        companyId: true,
        accountId: true,
        communicationChannelOverride: true,
      },
    });
    if (!caseRow) {
      return res.status(404).json({ error: 'not_found', message: 'Vaka bulunamadı.' });
    }
    if (!req.user.allowedCompanyIds.includes(caseRow.companyId)) {
      return res.status(403).json({ error: 'forbidden', message: 'Vaka erişimi yok.' });
    }
    const resolution = await resolveCustomerCommunication({ caseRow });
    res.json({
      caseOverride: caseRow.communicationChannelOverride,
      ...resolution,
    });
  }),
);

router.post(
  '/dispatches/:id/manual-confirm',
  requireRole(...DISPATCH_MANUAL_CONFIRM_ROLES),
  asyncRoute(async (req, res) => {
    const updated = await manualConfirmDispatch({
      dispatchId: req.params.id,
      payload: req.body ?? {},
      user: req.user,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json(updated);
  }),
);

export default router;
