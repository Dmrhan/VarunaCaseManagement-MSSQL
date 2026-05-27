import { Router } from 'express';
import { verifyJwt } from '../db/auth.js';
import {
  ActionItemAccessError,
  ActionItemValidationError,
  dismiss,
  listForUser,
  markDone,
  snooze,
  summaryForUser,
  unsnooze,
} from '../db/actionItemRepository.js';

/**
 * /api/action-center — WR-ACTION-CENTER Phase 1 Approval Visibility MVP.
 *
 * Five endpoints:
 *   GET    /                    — list user's ActionItems (filtered by view/state/kind)
 *   GET    /summary             — three counters (actionRequired / fyi / snoozed)
 *   POST   /:id/done            — mark done (outcome optional)
 *   POST   /:id/snooze          — push to snoozedUntil
 *   POST   /:id/dismiss         — dismiss (closeNote optional)
 *
 * Authority:
 *  - All routes verifyJwt.
 *  - Mutations require owner (`actionItem.userId === req.user.id`).
 *  - Tenant scope via `req.user.allowedCompanyIds` always enforced.
 *  - SystemAdmin cross-tenant aggregate via explicit ?companyId= filter.
 *
 * Out of scope (Phase 1):
 *  - No bulk endpoints.
 *  - No admin "read someone else's inbox" path.
 *  - No realtime push.
 */

const router = Router();
router.use(verifyJwt);

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ActionItemAccessError) {
        return res.status(err.status ?? 403).json({
          error: err.code ?? 'forbidden',
          message: err.message,
        });
      }
      if (err instanceof ActionItemValidationError) {
        return res.status(err.status ?? 400).json({
          error: err.code ?? 'validation_error',
          message: err.message,
        });
      }
      console.error('[action-center]', err?.code ?? err?.name ?? 'error', err?.message);
      res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
    }
  };
}

/**
 * GET /api/action-center
 * Query: view=action|fyi|snoozed|done, state, kind, limit, offset, companyId
 */
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const view = typeof req.query.view === 'string' ? req.query.view : 'action';
    const out = await listForUser({
      userId: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
      view,
      state: typeof req.query.state === 'string' ? req.query.state : null,
      kind: typeof req.query.kind === 'string' ? req.query.kind : null,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
      companyId: typeof req.query.companyId === 'string' ? req.query.companyId : null,
    });
    res.json(out);
  }),
);

/**
 * GET /api/action-center/summary
 * Returns { actionRequired, fyi, snoozed }.
 */
router.get(
  '/summary',
  asyncRoute(async (req, res) => {
    const out = await summaryForUser({
      userId: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
      companyId: typeof req.query.companyId === 'string' ? req.query.companyId : null,
    });
    res.json(out);
  }),
);

/**
 * POST /api/action-center/:id/done
 * Body: { outcome?: string, closeNote?: string }
 */
router.post(
  '/:id/done',
  asyncRoute(async (req, res) => {
    const updated = await markDone({
      id: req.params.id,
      userId: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
      payload: req.body ?? {},
    });
    res.json(updated);
  }),
);

/**
 * POST /api/action-center/:id/snooze
 * Body: { snoozedUntil: ISO }
 */
router.post(
  '/:id/snooze',
  asyncRoute(async (req, res) => {
    const updated = await snooze({
      id: req.params.id,
      userId: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
      payload: req.body ?? {},
    });
    res.json(updated);
  }),
);

/**
 * POST /api/action-center/:id/dismiss
 * Body: { closeNote?: string }
 */
router.post(
  '/:id/dismiss',
  asyncRoute(async (req, res) => {
    const updated = await dismiss({
      id: req.params.id,
      userId: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
      payload: req.body ?? {},
    });
    res.json(updated);
  }),
);

/**
 * POST /api/action-center/:id/unsnooze
 *
 * WR-NOTIFICATION-CENTER Phase 2C P0 — manual undo of an existing
 * snooze before snoozedUntil lapses. No body required. Owner-only +
 * tenant-scoped via shared loadOwnedItemOr403. Returns the updated
 * ActionItem (state=Pending, snoozedUntil=null). 409 with
 * action_item_not_snoozed when the row is not currently Snoozed.
 */
router.post(
  '/:id/unsnooze',
  asyncRoute(async (req, res) => {
    const updated = await unsnooze({
      id: req.params.id,
      userId: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json(updated);
  }),
);

export default router;
