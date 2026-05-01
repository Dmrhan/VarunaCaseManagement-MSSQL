import { Router } from 'express';
import {
  AdminError,
  categoryRepo,
  checklistRepo,
  companySettingsRepo,
  documentTypeRepo,
  fieldDefinitionRepo,
  offeredSolutionRepo,
  personRepo,
  slaPolicyRepo,
  teamRepo,
  thirdPartyRepo,
} from '../db/adminRepository.js';
import { verifyJwt, requireRole } from '../db/auth.js';

const router = Router();

// Tüm admin endpoint'leri sadece SystemAdmin rolüne açık.
// Admin rolü §13 operasyonel akışlar için kalır (supervisor onayı vb.).
router.use(verifyJwt, requireRole('SystemAdmin'));

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof AdminError) {
        return res.status(err.status).json({ error: 'admin', message: err.message });
      }
      console.error('[admin]', err);
      res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
    }
  };
}

// ─────────────────────────────────────────────────────────────────
// Generic CRUD route factory
// ─────────────────────────────────────────────────────────────────
function mountCrud(path, repo) {
  router.get(`/${path}`, asyncRoute(async (_req, res) => {
    const items = await repo.list();
    res.json({ value: items });
  }));
  router.post(`/${path}`, asyncRoute(async (req, res) => {
    const item = await repo.create(req.body ?? {});
    res.status(201).json(item);
  }));
  router.patch(`/${path}/:id`, asyncRoute(async (req, res) => {
    const item = await repo.update(req.params.id, req.body ?? {});
    res.json(item);
  }));
  router.delete(`/${path}/:id`, asyncRoute(async (req, res) => {
    const result = await repo.remove(req.params.id);
    res.json(result);
  }));
}

mountCrud('third-parties',     thirdPartyRepo);
mountCrud('document-types',    documentTypeRepo);
mountCrud('teams',             teamRepo);
mountCrud('persons',           personRepo);
mountCrud('sla-policies',      slaPolicyRepo);
mountCrud('checklists',        checklistRepo);
mountCrud('offered-solutions', offeredSolutionRepo);

// ─────────────────────────────────────────────────────────────────
// Categories — parent + sub ayrı endpoint'ler
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// Field Definitions (Custom Fields)
// ─────────────────────────────────────────────────────────────────
router.get('/field-definitions', asyncRoute(async (req, res) => {
  const items = await fieldDefinitionRepo.list(req.query.companyId);
  res.json({ value: items });
}));
router.post('/field-definitions', asyncRoute(async (req, res) => {
  const item = await fieldDefinitionRepo.create(req.body ?? {});
  res.status(201).json(item);
}));
router.patch('/field-definitions/:id', asyncRoute(async (req, res) => {
  const item = await fieldDefinitionRepo.update(req.params.id, req.body ?? {});
  res.json(item);
}));
router.delete('/field-definitions/:id', asyncRoute(async (req, res) => {
  const item = await fieldDefinitionRepo.remove(req.params.id);
  res.json(item);
}));

// ─────────────────────────────────────────────────────────────────
// Company Settings (per-company branding)
// ─────────────────────────────────────────────────────────────────
router.get('/company-settings/:companyId', asyncRoute(async (req, res) => {
  const settings = await companySettingsRepo.get(req.params.companyId);
  res.json(settings ?? null);
}));
router.put('/company-settings/:companyId', asyncRoute(async (req, res) => {
  const item = await companySettingsRepo.upsert(req.params.companyId, req.body ?? {});
  res.json(item);
}));

router.get('/categories', asyncRoute(async (_req, res) => {
  const items = await categoryRepo.list();
  res.json({ value: items });
}));
router.post('/categories', asyncRoute(async (req, res) => {
  const item = await categoryRepo.createParent(req.body ?? {});
  res.status(201).json(item);
}));
router.post('/categories/:parentId/sub', asyncRoute(async (req, res) => {
  const item = await categoryRepo.createSub(req.params.parentId, req.body ?? {});
  res.status(201).json(item);
}));
router.patch('/categories/:id', asyncRoute(async (req, res) => {
  const item = await categoryRepo.update(req.params.id, req.body ?? {});
  res.json(item);
}));
router.delete('/categories/:id', asyncRoute(async (req, res) => {
  const result = await categoryRepo.remove(req.params.id);
  res.json(result);
}));

export default router;
