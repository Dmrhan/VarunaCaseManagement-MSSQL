import { Router } from 'express';
import { caseRepository } from '../db/caseRepository.js';

const router = Router();

/**
 * Hata wrapper'ı — async route'lardaki throw'ları 500'e çevirir.
 * caseRepository null/undefined dönerse 404 gönderilir.
 */
function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error('[cases]', err);
      res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
    }
  };
}

/**
 * GET /api/cases — list + filter + pagination
 * Query params: search, statuses (CSV), caseType, priorities (CSV), teamId, personId, dateFrom, dateTo, page, pageSize
 */
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const f = req.query;
    const filters = {
      search: f.search,
      statuses: f.statuses ? f.statuses.split(',') : undefined,
      caseType: f.caseType,
      priorities: f.priorities ? f.priorities.split(',') : undefined,
      teamId: f.teamId,
      personId: f.personId,
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
    };
    const pagination = f.page
      ? { page: Number(f.page), pageSize: Number(f.pageSize ?? 25) }
      : undefined;
    const { items, total } = await caseRepository.list({ filters, pagination });
    res.json({ value: items, '@odata.count': total });
  }),
);

/** GET /api/cases/duplicate-check?accountId=...&caseType=... */
router.get(
  '/duplicate-check',
  asyncRoute(async (req, res) => {
    const { accountId, caseType } = req.query;
    if (!accountId || !caseType) {
      return res.status(400).json({ error: 'accountId ve caseType gerekli' });
    }
    const found = await caseRepository.findOpenCaseFor(accountId, caseType);
    res.json({ case: found });
  }),
);

/** GET /api/cases/by-account?accountId=...&excludeId=...&statusIn=... */
router.get(
  '/by-account',
  asyncRoute(async (req, res) => {
    const { accountId, excludeId, statusIn, statusNotIn } = req.query;
    if (!accountId) return res.status(400).json({ error: 'accountId gerekli' });
    const cases = await caseRepository.findByAccount(accountId, {
      excludeId,
      statusIn: statusIn ? statusIn.split(',') : undefined,
      statusNotIn: statusNotIn ? statusNotIn.split(',') : undefined,
    });
    res.json({ value: cases });
  }),
);

/** GET /api/cases/:id */
router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const c = await caseRepository.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı', id: req.params.id });
    res.json(c);
  }),
);

/** POST /api/cases — yeni vaka */
router.post(
  '/',
  asyncRoute(async (req, res) => {
    const created = await caseRepository.create(req.body ?? {});
    res.status(201).json(created);
  }),
);

/** PATCH /api/cases/:id — kısmi güncelleme (otomatik history log) */
router.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const updated = await caseRepository.update(req.params.id, req.body ?? {});
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * POST /api/cases/:id/transition — statü geçişi
 * Body: { nextStatus, resolutionNote?, cancellationReason?, thirdPartyId?, thirdPartyName?, escalationLevel?, escalationReason? }
 */
router.post(
  '/:id/transition',
  asyncRoute(async (req, res) => {
    const { nextStatus, ...payload } = req.body ?? {};
    if (!nextStatus) return res.status(400).json({ error: 'nextStatus gerekli' });
    const updated = await caseRepository.transitionStatus(req.params.id, nextStatus, payload);
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/** POST /api/cases/:id/notes */
router.post(
  '/:id/notes',
  asyncRoute(async (req, res) => {
    const note = await caseRepository.addNote(req.params.id, req.body ?? {});
    res.status(201).json(note);
  }),
);

/** POST /api/cases/:id/call-logs */
router.post(
  '/:id/call-logs',
  asyncRoute(async (req, res) => {
    const result = await caseRepository.addCallLog(req.params.id, req.body ?? {});
    res.status(201).json(result);
  }),
);

/** POST /api/cases/:id/activity — manuel aktivite (Transfer vb.) */
router.post(
  '/:id/activity',
  asyncRoute(async (req, res) => {
    const updated = await caseRepository.addActivity(req.params.id, req.body ?? {});
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/** PATCH /api/cases/:id/checklist/:itemId — checklist toggle */
router.patch(
  '/:id/checklist/:itemId',
  asyncRoute(async (req, res) => {
    const { checked } = req.body ?? {};
    const updated = await caseRepository.toggleChecklistItem(
      req.params.id,
      req.params.itemId,
      Boolean(checked),
    );
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * Adım 1 — POST /api/cases/:id/files/upload-url
 * Body: { fileName, fileSize, mimeType }
 * Yanıt: { uploadUrl, path, attachmentId }
 */
router.post(
  '/:id/files/upload-url',
  asyncRoute(async (req, res) => {
    const result = await caseRepository.requestUpload(req.params.id, req.body ?? {});
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    if ('error' in result) return res.status(400).json(result);
    res.json(result);
  }),
);

/**
 * Adım 2 — POST /api/cases/:id/files/finalize
 * Body: { attachmentId, path, fileName, fileSize, mimeType, uploadedBy? }
 */
router.post(
  '/:id/files/finalize',
  asyncRoute(async (req, res) => {
    const result = await caseRepository.finalizeUpload(req.params.id, req.body ?? {});
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.status(201).json(result);
  }),
);

/** GET /api/cases/:id/files/:fileId/download — kısa ömürlü signed URL */
router.get(
  '/:id/files/:fileId/download',
  asyncRoute(async (req, res) => {
    const result = await caseRepository.getDownloadUrl(req.params.id, req.params.fileId);
    if (!result) return res.status(404).json({ error: 'Dosya bulunamadı' });
    res.json(result);
  }),
);

/** DELETE /api/cases/:id/files/:fileId */
router.delete(
  '/:id/files/:fileId',
  asyncRoute(async (req, res) => {
    const updated = await caseRepository.removeFile(req.params.id, req.params.fileId);
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

export default router;
