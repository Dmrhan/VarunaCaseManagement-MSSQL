import { Router } from 'express';
import {
  AdminError,
  categoryRepo,
  checklistRepo,
  companyRepo,
  companySettingsRepo,
  documentTypeRepo,
  fieldDefinitionRepo,
  knowledgeSourceRepo,
  offeredSolutionRepo,
  personRepo,
  slaPolicyRepo,
  teamRepo,
  thirdPartyRepo,
  userRepo,
} from '../db/adminRepository.js';
import { verifyJwt, requireRole } from '../db/auth.js';

const router = Router();

// Phase 4 — Multi-tenant admin yetkisi.
// Admin VEYA SystemAdmin (sistem rolü) admin endpoint'lerine girebilir.
// Per-company endpoint'lerde ek olarak companyId scope kontrolü uygulanır
// (assertCompanyAdmin) — kullanıcının o şirkette Admin/SystemAdmin rolü olmalı.
router.use(verifyJwt, requireRole('Admin', 'SystemAdmin'));

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

/**
 * Sistem-geneli endpoint'ler için (third-parties, document-types, persons,
 * offered-solutions): yalnızca SystemAdmin sistem rolü erişebilir.
 */
function requireSystemAdminOnly(req) {
  if (req.user.role !== 'SystemAdmin') {
    throw new AdminError('Bu işlem için SystemAdmin yetkisi gerekli.', 403);
  }
}

/**
 * Per-company endpoint'ler için: kullanıcının o şirkette Admin veya
 * SystemAdmin rolü olduğunu doğrular. SystemAdmin (sistem rolü) verifyJwt
 * tarafından zaten tüm aktif şirketlere her birinde 'SystemAdmin' rolüyle
 * eklenmiş olur (Phase 2).
 */
function assertCompanyAdmin(req, companyId) {
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  const link = req.user.companyRoles?.find((r) => r.companyId === companyId);
  if (!link || (link.role !== 'Admin' && link.role !== 'SystemAdmin')) {
    throw new AdminError('Bu şirket için admin yetkin yok.', 403);
  }
}

// ─────────────────────────────────────────────────────────────────
// Sistem-geneli kayıtlar — yalnızca SystemAdmin
// ─────────────────────────────────────────────────────────────────
function mountSystemCrud(path, repo) {
  router.get(`/${path}`, asyncRoute(async (req, res) => {
    requireSystemAdminOnly(req);
    const items = await repo.list();
    res.json({ value: items });
  }));
  router.post(`/${path}`, asyncRoute(async (req, res) => {
    requireSystemAdminOnly(req);
    const item = await repo.create(req.body ?? {});
    res.status(201).json(item);
  }));
  router.patch(`/${path}/:id`, asyncRoute(async (req, res) => {
    requireSystemAdminOnly(req);
    const item = await repo.update(req.params.id, req.body ?? {});
    res.json(item);
  }));
  router.delete(`/${path}/:id`, asyncRoute(async (req, res) => {
    requireSystemAdminOnly(req);
    const result = await repo.remove(req.params.id);
    res.json(result);
  }));
}

mountSystemCrud('third-parties',     thirdPartyRepo);
mountSystemCrud('document-types',    documentTypeRepo);
mountSystemCrud('persons',           personRepo);
mountSystemCrud('offered-solutions', offeredSolutionRepo);

// ─────────────────────────────────────────────────────────────────
// Teams — multi-tenant: query/body companyId zorunlu, scope verify
// ─────────────────────────────────────────────────────────────────
router.get('/teams', asyncRoute(async (req, res) => {
  const filterCompanyId = req.query.companyId;
  if (filterCompanyId) assertCompanyAdmin(req, filterCompanyId);
  const items = await teamRepo.list(filterCompanyId, req.user.allowedCompanyIds);
  res.json({ value: items });
}));
router.post('/teams', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  assertCompanyAdmin(req, body.companyId); // body.companyId zorunlu + scope
  const item = await teamRepo.create(body, req.user.allowedCompanyIds);
  res.status(201).json(item);
}));
router.patch('/teams/:id', asyncRoute(async (req, res) => {
  const item = await teamRepo.update(req.params.id, req.body ?? {}, req.user.allowedCompanyIds);
  res.json(item);
}));
router.delete('/teams/:id', asyncRoute(async (req, res) => {
  const result = await teamRepo.remove(req.params.id, req.user.allowedCompanyIds);
  res.json(result);
}));

// ─────────────────────────────────────────────────────────────────
// SLA / Checklists / Categories — companyId zorunlu (body.companyId scope)
// Liste endpoint'leri filterCompanyId verilmişse scope verify; yoksa
// kullanıcının erişebildiği tüm şirketler için repo döndürülür (repo şu an
// allowedCompanyIds desteklemiyor — Phase 4 ek not, bootstrap üzerinden
// aynı veri gelir, admin UI'sı companyId belirleyerek çağırır).
// ─────────────────────────────────────────────────────────────────
router.get('/sla-policies', asyncRoute(async (req, res) => {
  if (req.query.companyId) assertCompanyAdmin(req, req.query.companyId);
  const items = await slaPolicyRepo.list();
  // Liste-seviye filter: kullanıcının erişebildiği şirketlerin SLA'larını döndür.
  const scoped = items.filter((p) => req.user.allowedCompanyIds.includes(p.companyId));
  res.json({ value: scoped });
}));
router.post('/sla-policies', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  assertCompanyAdmin(req, body.companyId);
  const item = await slaPolicyRepo.create(body);
  res.status(201).json(item);
}));
router.patch('/sla-policies/:id', asyncRoute(async (req, res) => {
  // Repo'da target companyId scope guard yok — burada manuel kontrol
  const target = await slaPolicyRepo.list();
  const cur = target.find((p) => p.id === req.params.id);
  if (cur) assertCompanyAdmin(req, cur.companyId);
  const body = req.body ?? {};
  if (body.companyId) assertCompanyAdmin(req, body.companyId); // şirket değişikliği
  const item = await slaPolicyRepo.update(req.params.id, body);
  res.json(item);
}));
router.delete('/sla-policies/:id', asyncRoute(async (req, res) => {
  const target = await slaPolicyRepo.list();
  const cur = target.find((p) => p.id === req.params.id);
  if (cur) assertCompanyAdmin(req, cur.companyId);
  const result = await slaPolicyRepo.remove(req.params.id);
  res.json(result);
}));

router.get('/checklists', asyncRoute(async (req, res) => {
  if (req.query.companyId) assertCompanyAdmin(req, req.query.companyId);
  const items = await checklistRepo.list();
  const scoped = items.filter((c) => req.user.allowedCompanyIds.includes(c.companyId));
  res.json({ value: scoped });
}));
router.post('/checklists', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  assertCompanyAdmin(req, body.companyId);
  const item = await checklistRepo.create(body);
  res.status(201).json(item);
}));
router.patch('/checklists/:id', asyncRoute(async (req, res) => {
  const all = await checklistRepo.list();
  const cur = all.find((c) => c.id === req.params.id);
  if (cur) assertCompanyAdmin(req, cur.companyId);
  const body = req.body ?? {};
  if (body.companyId) assertCompanyAdmin(req, body.companyId);
  const item = await checklistRepo.update(req.params.id, body);
  res.json(item);
}));
router.delete('/checklists/:id', asyncRoute(async (req, res) => {
  const all = await checklistRepo.list();
  const cur = all.find((c) => c.id === req.params.id);
  if (cur) assertCompanyAdmin(req, cur.companyId);
  const result = await checklistRepo.remove(req.params.id);
  res.json(result);
}));

// ─────────────────────────────────────────────────────────────────
// Field Definitions (Custom Fields) — companyId ZORUNLU (Phase 4c)
// ─────────────────────────────────────────────────────────────────
router.get('/field-definitions', asyncRoute(async (req, res) => {
  // companyId artık zorunlu (Phase 4c: optional değil).
  if (!req.query.companyId) {
    throw new AdminError('companyId query parametresi gerekli.', 400);
  }
  assertCompanyAdmin(req, req.query.companyId);
  const items = await fieldDefinitionRepo.list(req.query.companyId);
  res.json({ value: items });
}));
router.post('/field-definitions', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  assertCompanyAdmin(req, body.companyId);
  const item = await fieldDefinitionRepo.create(body);
  res.status(201).json(item);
}));
router.patch('/field-definitions/:id', asyncRoute(async (req, res) => {
  // Mevcut kaydın companyId'sini al, scope verify
  const all = await fieldDefinitionRepo.list();
  const cur = all.find((f) => f.id === req.params.id);
  if (cur) assertCompanyAdmin(req, cur.companyId);
  const body = req.body ?? {};
  if (body.companyId) assertCompanyAdmin(req, body.companyId);
  const item = await fieldDefinitionRepo.update(req.params.id, body);
  res.json(item);
}));
router.delete('/field-definitions/:id', asyncRoute(async (req, res) => {
  const all = await fieldDefinitionRepo.list();
  const cur = all.find((f) => f.id === req.params.id);
  if (cur) assertCompanyAdmin(req, cur.companyId);
  const item = await fieldDefinitionRepo.remove(req.params.id);
  res.json(item);
}));

// ─────────────────────────────────────────────────────────────────
// Company Settings (per-company branding) — Phase 4b
// URL :companyId scope verify zorunlu
// ─────────────────────────────────────────────────────────────────
router.get('/company-settings/:companyId', asyncRoute(async (req, res) => {
  assertCompanyAdmin(req, req.params.companyId);
  const settings = await companySettingsRepo.get(req.params.companyId);
  res.json(settings ?? null);
}));
router.put('/company-settings/:companyId', asyncRoute(async (req, res) => {
  assertCompanyAdmin(req, req.params.companyId);
  const item = await companySettingsRepo.upsert(req.params.companyId, req.body ?? {});
  res.json(item);
}));

// ─────────────────────────────────────────────────────────────────
// Categories — companyId nullable (null = sistem geneli, SystemAdmin)
// Şirket-bağlı kategoriler için scope verify
// ─────────────────────────────────────────────────────────────────
router.get('/categories', asyncRoute(async (req, res) => {
  if (req.query.companyId) assertCompanyAdmin(req, req.query.companyId);
  const items = await categoryRepo.list();
  // Liste filtreleme: null companyId (sistem geneli) + kullanıcının şirketleri
  const scoped = items.filter(
    (c) => c.companyId === null || req.user.allowedCompanyIds.includes(c.companyId),
  );
  res.json({ value: scoped });
}));
router.post('/categories', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  if (body.companyId) {
    assertCompanyAdmin(req, body.companyId);
  } else {
    // null companyId = sistem geneli kategori → yalnızca SystemAdmin
    requireSystemAdminOnly(req);
  }
  const item = await categoryRepo.createParent(body);
  res.status(201).json(item);
}));
router.post('/categories/:parentId/sub', asyncRoute(async (req, res) => {
  // Sub kategori: parent'ın companyId'sini al, scope verify
  const all = await categoryRepo.list();
  const parent = all.find((c) => c.id === req.params.parentId);
  if (parent) {
    if (parent.companyId) assertCompanyAdmin(req, parent.companyId);
    else requireSystemAdminOnly(req);
  }
  const item = await categoryRepo.createSub(req.params.parentId, req.body ?? {});
  res.status(201).json(item);
}));
router.patch('/categories/:id', asyncRoute(async (req, res) => {
  const all = await categoryRepo.list();
  const cur = all.find((c) => c.id === req.params.id);
  if (cur) {
    if (cur.companyId) assertCompanyAdmin(req, cur.companyId);
    else requireSystemAdminOnly(req);
  }
  const item = await categoryRepo.update(req.params.id, req.body ?? {});
  res.json(item);
}));
router.delete('/categories/:id', asyncRoute(async (req, res) => {
  const all = await categoryRepo.list();
  const cur = all.find((c) => c.id === req.params.id);
  if (cur) {
    if (cur.companyId) assertCompanyAdmin(req, cur.companyId);
    else requireSystemAdminOnly(req);
  }
  const result = await categoryRepo.remove(req.params.id);
  res.json(result);
}));

// ─────────────────────────────────────────────────────────────────
// Companies — Phase 5A
// list:   tüm Admin/SystemAdmin (kendi allowedCompanyIds'iyle)
// create: SystemAdmin only
// update: o şirketin Admin'i (assertCompanyAdmin)
// delete: SystemAdmin only (soft delete)
// ─────────────────────────────────────────────────────────────────
router.get('/companies', asyncRoute(async (req, res) => {
  // SystemAdmin tüm şirketleri görür; Admin sadece allowedCompanyIds'ini.
  const scope = req.user.role === 'SystemAdmin' ? undefined : req.user.allowedCompanyIds;
  const items = await companyRepo.list(scope);
  res.json({ value: items });
}));

router.post('/companies', asyncRoute(async (req, res) => {
  requireSystemAdminOnly(req); // yeni şirket yaratmak yalnızca SystemAdmin
  const item = await companyRepo.create(req.body ?? {});
  res.status(201).json(item);
}));

router.patch('/companies/:id', asyncRoute(async (req, res) => {
  // Admin sadece kendi şirketini düzenleyebilir; SystemAdmin hepsi.
  assertCompanyAdmin(req, req.params.id);
  const item = await companyRepo.update(req.params.id, req.body ?? {});
  res.json(item);
}));

router.delete('/companies/:id', asyncRoute(async (req, res) => {
  requireSystemAdminOnly(req); // pasifleştirmek yalnızca SystemAdmin
  const result = await companyRepo.remove(req.params.id);
  res.json(result);
}));

// ─────────────────────────────────────────────────────────────────
// Users — Phase 5B
// list:    Admin/SystemAdmin (Admin sadece allowedCompanyIds'indekileri)
// assign:  Hedef tüm companyId'lere requesting user'ın yetkisi olmalı
// ─────────────────────────────────────────────────────────────────
router.get('/users', asyncRoute(async (req, res) => {
  // SystemAdmin tüm kullanıcıları görür; Admin sadece kendi şirketlerinde
  // assignment'ı olanları + tüm SystemAdmin'leri (UI'da salt-okunur).
  const scope = req.user.role === 'SystemAdmin' ? undefined : req.user.allowedCompanyIds;
  const items = await userRepo.list(scope);
  res.json({ value: items });
}));

router.put('/users/:id/companies', asyncRoute(async (req, res) => {
  const assignments = Array.isArray(req.body?.assignments)
    ? req.body.assignments
    : Array.isArray(req.body)
    ? req.body
    : null;
  if (!assignments) {
    throw new AdminError('Body assignments dizisi gerekli.', 400);
  }
  // Yetki: requesting user'ın hedef tüm companyId'lerin Admin/SystemAdmin'i olmalı
  for (const a of assignments) {
    assertCompanyAdmin(req, a?.companyId);
  }
  const allowedScope = req.user.role === 'SystemAdmin' ? undefined : req.user.allowedCompanyIds;
  const result = await userRepo.replaceCompanies(req.params.id, assignments, allowedScope);
  res.json(result);
}));

// ─────────────────────────────────────────────────────────────────
// Knowledge Sources — Faz 1.5 Madde 6
// ─────────────────────────────────────────────────────────────────
router.get('/knowledge-sources', asyncRoute(async (req, res) => {
  const items = await knowledgeSourceRepo.list(req.user.allowedCompanyIds);
  res.json({ value: items });
}));

router.post('/knowledge-sources', asyncRoute(async (req, res) => {
  // companyId body'den ya da kullanıcının allowedCompanyIds[0]'ından
  const companyId = req.body?.companyId || req.user.allowedCompanyIds?.[0];
  assertCompanyAdmin(req, companyId);
  const item = await knowledgeSourceRepo.create(
    { ...(req.body ?? {}), companyId },
    req.user.allowedCompanyIds,
  );
  res.status(201).json(item);
}));

router.patch('/knowledge-sources/:id', asyncRoute(async (req, res) => {
  // assertCompanyAdmin: target.companyId üzerinden — repo yapıyor
  const item = await knowledgeSourceRepo.update(
    req.params.id,
    req.body ?? {},
    req.user.allowedCompanyIds,
  );
  res.json(item);
}));

export default router;
