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
  productGroupRepo,
  productRepo,
  packageRepo,
  slaPolicyRepo,
  taxonomyDefRepo,
  teamRepo,
  thirdPartyRepo,
  userRepo,
} from '../db/adminRepository.js';
import { externalKbSettingRepo } from '../db/externalKbSettingRepository.js';
import { verifyJwt, requireRole, getSupabaseAdminClient } from '../db/auth.js';

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
        // WR-B1 review fix — surface optional `code` for client-friendly
        // identification (e.g. team_lead_requires_team). Default 'admin'.
        return res
          .status(err.status)
          .json({ error: err.code ?? 'admin', message: err.message });
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

/**
 * POST /api/admin/users/invite — Phase 5C: Admin'den davet akisi.
 * Body: { email, role, companyId, companyRole }
 *  - role           — Sistem rolu (User.role): Agent | Backoffice | Supervisor | CSM | Admin
 *  - companyRole    — UserCompany.role: Agent | Supervisor | Admin
 *  - companyId      — Davet edilen sirket; Admin yalnizca kendi sirketlerine, SystemAdmin tum sirketlere
 *
 * Akis: Supabase Auth `inviteUserByEmail` ile e-posta gonderilir; Donen
 * supabase user id ile placeholder DB User + UserCompany yaratilir. DB hata
 * verirse Supabase user geri alinir (best-effort compensation).
 */
router.post('/users/invite', asyncRoute(async (req, res) => {
  const { email, role, companyId, companyRole } = req.body ?? {};
  assertCompanyAdmin(req, companyId);
  const allowedScope = req.user.role === 'SystemAdmin' ? undefined : req.user.allowedCompanyIds;
  const supabaseAdmin = getSupabaseAdminClient();
  // Redirect URL: kullanici davet e-postasindaki linke tikladiginda nereye
  // gidecek. Varsayilan: SUPABASE_INVITE_REDIRECT_URL env, fallback APP_URL,
  // son fallback localhost.
  const redirectTo =
    process.env.SUPABASE_INVITE_REDIRECT_URL ||
    process.env.APP_URL ||
    'http://localhost:5273';
  const result = await userRepo.invite(
    { email, role, companyId, companyRole },
    { supabaseAdmin, redirectTo },
    allowedScope,
  );
  res.status(201).json(result);
}));

/**
 * In-memory per-target rate limit: ayni kullaniciya 60 saniye icinde 1 resend.
 * Admin'in yanlislikla 2-3 kez tikladigi durumda Supabase email rate-limit'ine
 * vurmadan once UI'da rejekte ederiz. Multi-instance deploy'da bu garanti
 * "best-effort"; gercek koruma Supabase tarafinda zaten var.
 */
const _resendBuckets = new Map(); // userId -> lastTs
const RESEND_COOLDOWN_MS = 60_000;
function checkResendCooldown(userId) {
  const now = Date.now();
  const last = _resendBuckets.get(userId);
  if (last && now - last < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - last)) / 1000);
    throw new AdminError(`Çok sık yeniden gönderme. ${wait} saniye bekle.`, 429);
  }
  _resendBuckets.set(userId, now);
}

/**
 * POST /api/admin/users/:id/resend-invite — Phase 5C-resend: davet mailini
 * yeniden gonder. Supabase Auth user yeniden yaratilmaz; resetPasswordForEmail
 * kullanilarak prod redirect URL'iyle taze magic-link gonderilir.
 *
 * Eligibility (repo katmaninda): User var + isActive=true + fullName===email.
 * Aksi halde 400/404 mesajlari.
 *
 * Yetki:
 *  - Auth: Admin + SystemAdmin (router-level requireRole)
 *  - Admin sadece kendi allowedCompanyIds icindeki kullaniciya
 *  - SystemAdmin tum kullanicilara
 *  - Per-user 60s cooldown spam korumasi
 */
router.post('/users/:id/resend-invite', asyncRoute(async (req, res) => {
  checkResendCooldown(req.params.id);
  const target = await userRepo.list(
    req.user.role === 'SystemAdmin' ? undefined : req.user.allowedCompanyIds,
  );
  const matched = target.find((u) => u.id === req.params.id);
  if (!matched) {
    throw new AdminError('Kullanıcı kapsamında değil veya bulunamadı.', 404);
  }
  if (req.user.role !== 'SystemAdmin') {
    const hasCompanyAdminRight = matched.assignments.some((a) =>
      req.user.companyRoles?.some(
        (cr) => cr.companyId === a.companyId && (cr.role === 'Admin' || cr.role === 'SystemAdmin'),
      ),
    );
    if (!hasCompanyAdminRight) {
      throw new AdminError('Bu kullanıcıya davet gönderme yetkin yok.', 403);
    }
  }
  const supabaseAdmin = getSupabaseAdminClient();
  const redirectTo =
    process.env.SUPABASE_INVITE_REDIRECT_URL ||
    process.env.APP_URL ||
    'http://localhost:5273';
  const result = await userRepo.resendInvite(
    req.params.id,
    { supabaseAdmin, redirectTo },
    req.user,
  );
  res.json(result);
}));

/**
 * PATCH /api/admin/users/:id/reactivate — Phase 5C: pasif kullaniciyi yeniden aktiflestir.
 * Guards:
 *  - Hedef DB'de bulunmali
 *  - SystemAdmin'i sadece SystemAdmin reactivate edebilir
 *  - Hedef en az bir companyId'sinde caller Admin/SystemAdmin olmali
 *
 * Idempotent: zaten aktifse 200 doner. UserCompany kayitlarinda dokunma yok
 * — onceki atamalar korunuyor.
 */
router.patch('/users/:id/reactivate', asyncRoute(async (req, res) => {
  const target = await userRepo.list(
    req.user.role === 'SystemAdmin' ? undefined : req.user.allowedCompanyIds,
  );
  const matched = target.find((u) => u.id === req.params.id);
  if (!matched) {
    throw new AdminError('Kullanıcı kapsamında değil veya bulunamadı.', 404);
  }
  if (req.user.role !== 'SystemAdmin') {
    const hasCompanyAdminRight = matched.assignments.some((a) =>
      req.user.companyRoles?.some(
        (cr) => cr.companyId === a.companyId && (cr.role === 'Admin' || cr.role === 'SystemAdmin'),
      ),
    );
    if (!hasCompanyAdminRight) {
      throw new AdminError('Bu kullanıcıyı yeniden aktifleştirme yetkin yok.', 403);
    }
  }
  const result = await userRepo.reactivate(req.params.id, {}, req.user);
  res.json(result);
}));

/**
 * DELETE /api/admin/users/:id/deactivate — Phase 5C: Kullaniciyi pasiflestir.
 * Guards:
 *  - Kendini pasiflestiremezsin
 *  - SystemAdmin kullaniciyi yalnizca SystemAdmin pasiflestirebilir
 *  - Hedef en az bir companyId'sinde caller Admin/SystemAdmin olmali
 *
 * DB User.isActive=false (idempotent) + Supabase global signOut (best-effort).
 * Supabase Auth user'i SILINMEZ — yeniden aktive edilebilsin.
 */
router.delete('/users/:id/deactivate', asyncRoute(async (req, res) => {
  // Yetki kontrolu: hedef user'in en az bir companyId'sinde caller Admin olmali
  const target = await userRepo.list(
    req.user.role === 'SystemAdmin' ? undefined : req.user.allowedCompanyIds,
  );
  const matched = target.find((u) => u.id === req.params.id);
  if (!matched) {
    throw new AdminError('Kullanıcı kapsamında değil veya bulunamadı.', 404);
  }
  // En az bir assignment companyId'sinde Admin/SystemAdmin olmali
  if (req.user.role !== 'SystemAdmin') {
    const hasCompanyAdminRight = matched.assignments.some((a) =>
      req.user.companyRoles?.some(
        (cr) => cr.companyId === a.companyId && (cr.role === 'Admin' || cr.role === 'SystemAdmin'),
      ),
    );
    if (!hasCompanyAdminRight) {
      throw new AdminError('Bu kullanıcıyı pasifleştirme yetkin yok.', 403);
    }
  }
  const supabaseAdmin = getSupabaseAdminClient();
  const result = await userRepo.deactivate(req.params.id, { supabaseAdmin }, req.user);
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

// ─────────────────────────────────────────────────────────────────
// WR-A6 / PM-05 — ProductGroup + Product catalog (foundation only)
// ─────────────────────────────────────────────────────────────────

router.get('/product-groups', asyncRoute(async (req, res) => {
  const filterCompanyId = req.query.companyId;
  if (filterCompanyId) assertCompanyAdmin(req, filterCompanyId);
  const items = await productGroupRepo.list({
    companyId: filterCompanyId,
    allowedCompanyIds: req.user.allowedCompanyIds,
    includeInactive: req.query.includeInactive === '1',
  });
  res.json({ value: items });
}));

router.post('/product-groups', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  assertCompanyAdmin(req, body.companyId);
  const item = await productGroupRepo.create(body, req.user.allowedCompanyIds);
  res.status(201).json(item);
}));

router.patch('/product-groups/:id', asyncRoute(async (req, res) => {
  // Product Catalog RBAC audit — load target group companyId and enforce
  // per-company admin gate (mirrors WR-A7 review fix for packages).
  const targetCompanyId = await productGroupRepo.getCompanyId(req.params.id);
  if (!targetCompanyId) throw new AdminError('Ürün grubu bulunamadı.', 404);
  assertCompanyAdmin(req, targetCompanyId);

  const item = await productGroupRepo.update(
    req.params.id,
    req.body ?? {},
    req.user.allowedCompanyIds,
  );
  res.json(item);
}));

router.get('/products', asyncRoute(async (req, res) => {
  const filterCompanyId = req.query.companyId;
  if (filterCompanyId) assertCompanyAdmin(req, filterCompanyId);
  const items = await productRepo.list({
    companyId: filterCompanyId,
    productGroupId: req.query.productGroupId,
    allowedCompanyIds: req.user.allowedCompanyIds,
    includeInactive: req.query.includeInactive === '1',
  });
  res.json({ value: items });
}));

router.post('/products', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  assertCompanyAdmin(req, body.companyId);
  const item = await productRepo.create(body, req.user.allowedCompanyIds);
  res.status(201).json(item);
}));

router.patch('/products/:id', asyncRoute(async (req, res) => {
  // Product Catalog RBAC audit — same per-company admin gate as
  // /product-groups/:id and /packages/:id (WR-A7 pattern).
  const targetCompanyId = await productRepo.getCompanyId(req.params.id);
  if (!targetCompanyId) throw new AdminError('Ürün bulunamadı.', 404);
  assertCompanyAdmin(req, targetCompanyId);

  const item = await productRepo.update(
    req.params.id,
    req.body ?? {},
    req.user.allowedCompanyIds,
  );
  res.json(item);
}));

// ─────────────────────────────────────────────────────────────────
// WR-A7 / PM-05 — Package + PackageItem catalog (foundation only)
// ─────────────────────────────────────────────────────────────────

router.get('/packages', asyncRoute(async (req, res) => {
  const filterCompanyId = req.query.companyId;
  if (filterCompanyId) assertCompanyAdmin(req, filterCompanyId);
  const items = await packageRepo.list({
    companyId: filterCompanyId,
    allowedCompanyIds: req.user.allowedCompanyIds,
    includeInactive: req.query.includeInactive === '1',
  });
  res.json({ value: items });
}));

router.post('/packages', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  assertCompanyAdmin(req, body.companyId);
  const item = await packageRepo.create(body, req.user.allowedCompanyIds);
  res.status(201).json(item);
}));

// WR-A7 review fix — ID-based package routes must enforce per-company admin
// permission for the target package's companyId, not just allowedCompanyIds
// scope. assertCompanyAdmin checks req.user.companyRoles for Admin/SystemAdmin
// in the target company.
async function assertPackageCompanyAdmin(req, packageId) {
  const companyId = await packageRepo.getCompanyId(packageId);
  if (!companyId) throw new AdminError('Paket bulunamadı.', 404);
  assertCompanyAdmin(req, companyId);
}

router.patch('/packages/:id', asyncRoute(async (req, res) => {
  await assertPackageCompanyAdmin(req, req.params.id);
  const item = await packageRepo.update(
    req.params.id,
    req.body ?? {},
    req.user.allowedCompanyIds,
  );
  res.json(item);
}));

router.get('/packages/:id/items', asyncRoute(async (req, res) => {
  await assertPackageCompanyAdmin(req, req.params.id);
  const items = await packageRepo.listItems(req.params.id, req.user.allowedCompanyIds);
  res.json({ value: items });
}));

router.put('/packages/:id/items', asyncRoute(async (req, res) => {
  await assertPackageCompanyAdmin(req, req.params.id);
  const body = req.body ?? {};
  const items = await packageRepo.replaceItems(
    req.params.id,
    body.productIds,
    req.user.allowedCompanyIds,
  );
  res.json({ value: items });
}));

// ─────────────────────────────────────────────────────────────────
// WR-KB1 — External KB Integration Settings (per-company admin gate).
//
// SADECE configuration ekranı. Hiçbir uç dış API çağrısı yapmaz; raw
// API key saklamaz; AIUsageLog yazmaz. Per-company admin gate ile yönetilir.
// SystemAdmin (verifyJwt tüm aktif şirketler) tüm şirketleri görebilir.
// ─────────────────────────────────────────────────────────────────

router.get('/external-kb-settings', asyncRoute(async (req, res) => {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const item = await externalKbSettingRepo.getByCompany(companyId);
  res.json(item);
}));

router.patch('/external-kb-settings/:companyId', asyncRoute(async (req, res) => {
  const companyId = req.params.companyId;
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  // Body içinde companyId override olsa bile parametre kullanılır.
  const patch = { ...(req.body ?? {}) };
  delete patch.companyId;
  delete patch.id;
  delete patch.createdAt;
  delete patch.updatedAt;
  const item = await externalKbSettingRepo.upsert(companyId, patch);
  res.json(item);
}));

// ─────────────────────────────────────────────────────────────────
// WR-Smart-Ticket Phase 1b — TaxonomyDef admin CRUD.
// Per-tenant. Soft delete only (DELETE → isActive=false). companyId query
// zorunlu; assertCompanyAdmin scope kontrolü her uçta.
// ─────────────────────────────────────────────────────────────────

router.get('/taxonomy-defs', asyncRoute(async (req, res) => {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);

  const taxonomyType =
    typeof req.query.taxonomyType === 'string' && req.query.taxonomyType.length > 0
      ? req.query.taxonomyType
      : undefined;
  let isActive;
  if (req.query.isActive === 'true') isActive = true;
  else if (req.query.isActive === 'false') isActive = false;
  let parentId;
  if (req.query.parentId !== undefined) {
    parentId = req.query.parentId === '' || req.query.parentId === 'null' ? null : String(req.query.parentId);
  }

  const items = await taxonomyDefRepo.list(
    { companyId, taxonomyType, isActive, parentId },
    req.user.allowedCompanyIds,
  );
  res.json({ value: items });
}));

router.post('/taxonomy-defs', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  assertCompanyAdmin(req, body.companyId);
  const item = await taxonomyDefRepo.create(body, req.user.allowedCompanyIds);
  res.status(201).json(item);
}));

// Codex PR-1b review fix — ID-based PATCH/DELETE handler'ları yalnız
// `allowedCompanyIds` set'ine güveniyordu. Bu set kullanıcının HERHANGİ bir
// rolde aktif UserCompany linki olan tüm şirketleri içerir (Agent dahil)
// — yani başka şirkette Admin olup bu şirkette Agent olan kullanıcı taxonomy
// mutasyonu yapabiliyordu. Package routes'taki WR-A7 review fix pattern'ini
// uygula: target satırın companyId'si üzerinden assertCompanyAdmin.
async function assertTaxonomyDefCompanyAdmin(req, id) {
  const companyId = await taxonomyDefRepo.getCompanyId(id);
  if (!companyId) throw new AdminError('Taxonomy satırı bulunamadı.', 404);
  assertCompanyAdmin(req, companyId);
  return companyId;
}

router.patch('/taxonomy-defs/:id', asyncRoute(async (req, res) => {
  await assertTaxonomyDefCompanyAdmin(req, req.params.id);
  const item = await taxonomyDefRepo.update(
    req.params.id,
    req.body ?? {},
    req.user.allowedCompanyIds,
  );
  res.json(item);
}));

router.delete('/taxonomy-defs/:id', asyncRoute(async (req, res) => {
  await assertTaxonomyDefCompanyAdmin(req, req.params.id);
  const result = await taxonomyDefRepo.remove(req.params.id, req.user.allowedCompanyIds);
  res.json(result);
}));

export default router;
