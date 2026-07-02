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
import { prisma } from '../db/client.js';
import { externalKbSettingRepo } from '../db/externalKbSettingRepository.js';
import { externalDevOpsSettingRepo } from '../db/externalDevOpsSettingRepository.js';
import { authorizationPolicyRepository } from '../db/authorizationPolicyRepository.js';
import { devopsClient } from '../lib/devopsClient.js';
import { externalMailSettingRepo } from '../db/externalMailSettingRepository.js';
import { externalMailFromAliasRepo } from '../db/externalMailFromAliasRepository.js';
import { externalMailInboxRepo } from '../db/externalMailInboxRepository.js';
import { caseEmailTemplateRepo } from '../db/caseEmailTemplateRepository.js';
import { sendMail as mailProviderSendMail } from '../lib/mailProvider.js';
import { pollMailbox as imapPollMailbox, testInboxConnection } from '../lib/imapPoller.js';
import { verifyJwt, requireRole } from '../db/auth.js';
import { requireActor } from '../lib/actor.js';
import { buildAuthorizationEffectivePreview } from '../lib/authorizationEffectivePreview.js';

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
      // Faz 2.1 followup — sistem hataları (örn. SecretCipherError
      // 'devops_enc_key_missing' 503) status + code + message taşıyorsa
      // generic 500'e DÜŞÜRME; net mesajı admin UI toast'ında göster.
      // AdminError dışındaki tüm "yapılı" hatalar için duck-type kontrol.
      if (
        err &&
        typeof err.status === 'number' &&
        err.status >= 400 &&
        err.status < 600 &&
        typeof err.code === 'string'
      ) {
        return res
          .status(err.status)
          .json({ error: err.code, message: err.message });
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

// ─────────────────────────────────────────────────────────────────
// Third Parties — şirket kapsamlı (SystemAdmin tüm şirketleri yönetir)
// ─────────────────────────────────────────────────────────────────
router.get('/third-parties', asyncRoute(async (req, res) => {
  requireSystemAdminOnly(req);
  const companyId = req.query.companyId || undefined;
  const items = await thirdPartyRepo.list(companyId);
  res.json({ value: items });
}));
router.post('/third-parties', asyncRoute(async (req, res) => {
  requireSystemAdminOnly(req);
  const item = await thirdPartyRepo.create(req.body ?? {});
  res.status(201).json(item);
}));
router.patch('/third-parties/:id', asyncRoute(async (req, res) => {
  requireSystemAdminOnly(req);
  const item = await thirdPartyRepo.update(req.params.id, req.body ?? {});
  res.json(item);
}));
router.delete('/third-parties/:id', asyncRoute(async (req, res) => {
  requireSystemAdminOnly(req);
  const result = await thirdPartyRepo.remove(req.params.id);
  res.json(result);
}));

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
  const actor = requireActor(req);
  const item = await teamRepo.create(body, req.user.allowedCompanyIds, actor);
  res.status(201).json(item);
}));
router.patch('/teams/:id', asyncRoute(async (req, res) => {
  const actor = requireActor(req);
  const item = await teamRepo.update(req.params.id, req.body ?? {}, req.user.allowedCompanyIds, actor);
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
  const actor = requireActor(req);
  const item = await slaPolicyRepo.create(body, actor);
  res.status(201).json(item);
}));
router.patch('/sla-policies/:id', asyncRoute(async (req, res) => {
  // Repo'da target companyId scope guard yok — burada manuel kontrol
  const target = await slaPolicyRepo.list();
  const cur = target.find((p) => p.id === req.params.id);
  if (cur) assertCompanyAdmin(req, cur.companyId);
  const body = req.body ?? {};
  if (body.companyId) assertCompanyAdmin(req, body.companyId); // şirket değişikliği
  const actor = requireActor(req);
  const item = await slaPolicyRepo.update(req.params.id, body, actor);
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
  const actor = requireActor(req);
  const item = await checklistRepo.create(body, actor);
  res.status(201).json(item);
}));
router.patch('/checklists/:id', asyncRoute(async (req, res) => {
  const all = await checklistRepo.list();
  const cur = all.find((c) => c.id === req.params.id);
  if (cur) assertCompanyAdmin(req, cur.companyId);
  const body = req.body ?? {};
  if (body.companyId) assertCompanyAdmin(req, body.companyId);
  const actor = requireActor(req);
  const item = await checklistRepo.update(req.params.id, body, actor);
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
  const actor = requireActor(req);
  const item = await fieldDefinitionRepo.create(body, actor);
  res.status(201).json(item);
}));
router.patch('/field-definitions/:id', asyncRoute(async (req, res) => {
  // Mevcut kaydın companyId'sini al, scope verify
  const all = await fieldDefinitionRepo.list();
  const cur = all.find((f) => f.id === req.params.id);
  if (cur) assertCompanyAdmin(req, cur.companyId);
  const body = req.body ?? {};
  if (body.companyId) assertCompanyAdmin(req, body.companyId);
  const actor = requireActor(req);
  const item = await fieldDefinitionRepo.update(req.params.id, body, actor);
  res.json(item);
}));
router.delete('/field-definitions/:id', asyncRoute(async (req, res) => {
  const all = await fieldDefinitionRepo.list();
  const cur = all.find((f) => f.id === req.params.id);
  if (cur) assertCompanyAdmin(req, cur.companyId);
  const actor = requireActor(req);
  const item = await fieldDefinitionRepo.remove(req.params.id, actor);
  res.json(item);
}));

// ─────────────────────────────────────────────────────────────────
// Authorization Policies — foundation only; runtime enforcement is not
// wired here. Admin UI will use these endpoints to manage menu/resource/
// field/security-filter rows per company.
// ─────────────────────────────────────────────────────────────────
router.get('/authorization-policies', asyncRoute(async (req, res) => {
  const companyId = req.query.companyId;
  if (!companyId) throw new AdminError('companyId query parametresi gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const items = await authorizationPolicyRepository.list(
    {
      companyId,
      target: req.query.target,
      ...(req.query.isActive !== undefined && { isActive: req.query.isActive === 'true' || req.query.isActive === '1' }),
    },
    req.user.allowedCompanyIds,
  );
  res.json({ value: items });
}));

router.post('/authorization-policies', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  assertCompanyAdmin(req, body.companyId);
  const actor = requireActor(req);
  const item = await authorizationPolicyRepository.create(body, req.user.allowedCompanyIds, actor);
  res.status(201).json(item);
}));

router.post('/authorization-policies/effective-preview', asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  assertCompanyAdmin(req, body.companyId);
  const overrides = await authorizationPolicyRepository.listOverrides(
    body.companyId,
    req.user.allowedCompanyIds,
  );
  const preview = buildAuthorizationEffectivePreview({
    companyId: body.companyId,
    principalType: body.principalType,
    principalKey: body.principalKey,
    featureFlags: body.featureFlags ?? {},
    overrides,
  });
  res.json(preview);
}));

async function assertAuthorizationPolicyCompanyAdmin(req, id) {
  const row = await authorizationPolicyRepository.getById(
    id,
    req.user.allowedCompanyIds,
  );
  assertCompanyAdmin(req, row.companyId);
  return row;
}

router.patch('/authorization-policies/:id', asyncRoute(async (req, res) => {
  await assertAuthorizationPolicyCompanyAdmin(req, req.params.id);
  const actor = requireActor(req);
  const item = await authorizationPolicyRepository.update(
    req.params.id,
    req.body ?? {},
    req.user.allowedCompanyIds,
    actor,
  );
  res.json(item);
}));

router.delete('/authorization-policies/:id', asyncRoute(async (req, res) => {
  await assertAuthorizationPolicyCompanyAdmin(req, req.params.id);
  const actor = requireActor(req);
  const item = await authorizationPolicyRepository.remove(
    req.params.id,
    req.user.allowedCompanyIds,
    actor,
  );
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
  const actor = requireActor(req);
  const item = await categoryRepo.createParent(body, actor);
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
  const actor = requireActor(req);
  const item = await categoryRepo.createSub(req.params.parentId, req.body ?? {}, actor);
  res.status(201).json(item);
}));
router.patch('/categories/:id', asyncRoute(async (req, res) => {
  const all = await categoryRepo.list();
  const cur = all.find((c) => c.id === req.params.id);
  if (cur) {
    if (cur.companyId) assertCompanyAdmin(req, cur.companyId);
    else requireSystemAdminOnly(req);
  }
  const actor = requireActor(req);
  const item = await categoryRepo.update(req.params.id, req.body ?? {}, actor);
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
 * POST /api/admin/users — Faz 3: Admin'den kullanıcı oluşturma (local auth).
 * Body: { email, fullName?, role, companyId, companyRole, password }
 *  - role           — Sistem rolu (User.role): Agent | Backoffice | Supervisor | CSM | Admin
 *  - companyRole    — UserCompany.role: Agent | Supervisor | Admin
 *  - companyId      — Hedef sirket; Admin yalnizca kendi sirketlerine, SystemAdmin tum sirketlere
 *  - password       — Baslangic sifresi (min 8); kullanici ilk giriste degistirmek zorunda
 *
 * E-posta gonderimi YOK (on-prem). Admin sifreyi kullaniciya kendisi iletir.
 */
router.post('/users', asyncRoute(async (req, res) => {
  const { email, fullName, role, companyId, companyRole, password } = req.body ?? {};
  assertCompanyAdmin(req, companyId);
  const allowedScope = req.user.role === 'SystemAdmin' ? undefined : req.user.allowedCompanyIds;
  const result = await userRepo.createUser(
    { email, fullName, role, companyId, companyRole, password },
    allowedScope,
  );
  res.status(201).json(result);
}));

/**
 * POST /api/admin/users/:id/reset-password — Faz 3: admin'den gecici sifre atama
 * ("sifremi unuttum"un on-prem karsiligi; e-posta yok).
 * Body: { password }
 *
 * Yetki:
 *  - Auth: Admin + SystemAdmin (router-level requireRole)
 *  - Admin sadece kendi allowedCompanyIds icindeki kullaniciya
 *  - SystemAdmin tum kullanicilara
 */
router.post('/users/:id/reset-password', asyncRoute(async (req, res) => {
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
      throw new AdminError('Bu kullanıcının şifresini sıfırlama yetkin yok.', 403);
    }
  }
  const result = await userRepo.resetPassword(req.params.id, req.body?.password, req.user);
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
/**
 * PATCH /api/admin/users/:id/system-role — Sistem rolünü değiştir.
 * Body: { role: 'Agent' | 'Backoffice' | 'Supervisor' | 'CSM' | 'Admin' }
 *
 * Guards (route + repo):
 *  - Yalnız SystemAdmin (Admin yetkili değil — repo guard)
 *  - Kendi rolünü değiştiremez (repo guard)
 *  - Hedef SystemAdmin ise değiştirme yasak (repo guard)
 *  - Geçersiz rol 400
 *  - Hedef bulunamazsa 404
 *
 * UserCompany.role'e dokunulmaz — yalnız User.role değişir. Üst bar ve
 * global menü davranışı kullanıcı yeniden login/refresh sonrası güncellenir.
 */
router.patch('/users/:id/system-role', asyncRoute(async (req, res) => {
  const role = req.body?.role;
  const result = await userRepo.updateSystemRole(req.params.id, role, req.user);
  res.json(result);
}));

/**
 * Compose-Signature F1 IA rework —
 * PATCH /api/admin/users/:id/title  body: { title: string | null }
 *
 * Bağlı Person'ın title'ını günceller (mail imzasında {{agent.title}}
 * placeholder render kaynağı). Person'ı olmayan user'larda 409.
 *
 * Guards:
 *  - assertCompanyAdmin: hedef kullanıcının atandığı şirketlerden en az
 *    BİRİNDE caller Admin/SystemAdmin olmalı. Person paylaşılan kaynak
 *    olduğu için bu kontrol "kart yönetim yetkisi" semantiğini tutar.
 *  - Empty string / null → title temizleme
 */
router.patch('/users/:id/title', asyncRoute(async (req, res) => {
  const userId = req.params.id;
  // Codex P2 round 2 fix — body validation SIDE-EFFECT'TEN ÖNCE.
  // Önceki kontrol `req.body?.title` undefined olduğunda setPersonTitle'ı
  // çağırıyordu; repo normalize non-string/empty'i null'a düşürdüğü için
  // `{}` body sessizce title'ı SİLİYORDU. Explicit clear semantiği
  // null OLMALI; missing key 400 dönmeli.
  const body = req.body ?? {};
  if (!Object.prototype.hasOwnProperty.call(body, 'title')) {
    throw new AdminError('title alanı gerekli (string veya null).', 400);
  }
  const title = body.title;
  if (title !== null && typeof title !== 'string') {
    throw new AdminError('title string veya null olmalı.', 400);
  }

  // Codex P1 fix — prisma modül-level import (üst kısımda). Önceki
  // sürümde dynamic import yoktu → ReferenceError fırlatıyordu.
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { companies: { where: { isActive: true }, select: { companyId: true } } },
  });
  if (!target) throw new AdminError('Kullanıcı bulunamadı.', 404);
  // Codex P2 fix — Yetki: hedef kullanıcının şirketlerinden EN AZ BİRİNDE
  // caller'ın per-company rolü Admin VEYA SystemAdmin OLMALI. Önceki
  // kontrol yalnız companyId match arıyordu → caller'ın o şirkette Agent
  // veya Supervisor olması başkasının Person.title'ını değiştirmesine
  // izin veriyordu. assertCompanyAdmin role kontrolü ile birebir hizalı.
  if (req.user.role !== 'SystemAdmin') {
    const adminCompanyIds = new Set(
      (req.user.companyRoles ?? [])
        .filter((r) => r.role === 'Admin' || r.role === 'SystemAdmin')
        .map((r) => r.companyId),
    );
    const hasAdminAccess = target.companies.some((tc) => adminCompanyIds.has(tc.companyId));
    if (!hasAdminAccess) {
      throw new AdminError('Bu kullanıcı için admin yetkin yok.', 403);
    }
  }
  const result = await userRepo.setPersonTitle(userId, title);
  res.json(result);
}));

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
 * DB User.isActive=false (idempotent). verifyJwt'nin isActive bariyeri,
 * kullanicinin elindeki token'lari pratikte gecersiz kilar.
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
  const result = await userRepo.deactivate(req.params.id, {}, req.user);
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
// DevOps Faz 2.1 — Per-tenant TFS/Azure DevOps entegrasyon ayarları.
// Pattern: external-kb-settings ile birebir (assertCompanyAdmin gate).
//
// KRİTİK GÜVENLİK:
//  - GET response'unda PAT (plain VEYA ciphertext) ASLA gözükmez; sadece
//    patIsSet boolean + patSetAt. Repository SELECTABLE_PUBLIC sıkı tutar.
//  - PATCH body'sinde `pat` field'ı varsa encrypt edilip persistlenir;
//    yoksa mevcut PAT'a dokunulmaz (rotate semantiği).
//  - POST /test saklı PAT'ı decrypt edip devopsClient.getWorkItem ile
//    bağlantı denemesi yapar; PAT response'a inmez.
// ─────────────────────────────────────────────────────────────────

router.get('/external-devops-settings', asyncRoute(async (req, res) => {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const item = await externalDevOpsSettingRepo.getByCompany(companyId);
  res.json(item);
}));

router.patch('/external-devops-settings/:companyId', asyncRoute(async (req, res) => {
  const companyId = req.params.companyId;
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const patch = { ...(req.body ?? {}) };
  delete patch.companyId;
  delete patch.id;
  delete patch.createdAt;
  delete patch.updatedAt;
  // Server-side derived alanları client override edemez.
  delete patch.patIsSet;
  delete patch.patSetAt;
  delete patch.patCiphertext;
  delete patch.patIv;
  delete patch.patAuthTag;
  delete patch.createdByUserId;
  delete patch.updatedByUserId;
  const actor = requireActor(req);
  const item = await externalDevOpsSettingRepo.upsert(companyId, patch, actor.userId ?? null);
  res.json(item);
}));

/**
 * POST /external-devops-settings/:companyId/test
 *
 * Saklı PAT'ı decrypt edip devopsClient.getWorkItem ile bir test
 * çağrısı yapar. Body: { testWorkItemId?: number } — opsiyonel, yoksa
 * env'deki TFS_TEST_WORKITEM_ID kullanılır.
 *
 * Dönen: { ok: boolean, error?: { code, message, status } }
 * PAT response'a inmez, log'a basılmaz.
 *
 * NOT: devopsClient şu an process.env'den config çeker. Adım 4 wiring'i
 * tamamlandığında DB config aktif olacak; bu test endpoint zaten DB'den
 * PAT'ı decrypt edip env'i geçici override etmeden devopsClient'ı
 * companyId-aware çağırır.
 */
router.post('/external-devops-settings/:companyId/test', asyncRoute(async (req, res) => {
  const companyId = req.params.companyId;
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const body = req.body ?? {};
  const testIdRaw = body.testWorkItemId ?? process.env.TFS_TEST_WORKITEM_ID;
  if (!testIdRaw) {
    return res.json({
      ok: false,
      error: {
        code: 'test_workitem_id_missing',
        message: 'Test için bir work item id gerekli (body.testWorkItemId veya TFS_TEST_WORKITEM_ID).',
      },
    });
  }
  const testId = Number.parseInt(testIdRaw, 10);
  if (!Number.isInteger(testId) || testId <= 0) {
    return res.json({
      ok: false,
      error: {
        code: 'test_workitem_id_invalid',
        message: 'Test work item id geçersiz.',
      },
    });
  }
  // devopsClient companyId scope'lu çağrı yapar; resolveActiveConfig
  // ile DB'den decrypt edilen PAT veya env fallback kullanılır.
  const result = await devopsClient.getWorkItem(testId, { companyId });
  if (!result.ok) {
    return res.json({
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        status: result.error.status,
      },
    });
  }
  // Başarı: minimum cevap — PAT/ham response sızdırmadan.
  return res.json({
    ok: true,
    workItem: {
      id: result.data.normalized?.id ?? testId,
      title: result.data.normalized?.title ?? null,
      state: result.data.normalized?.state ?? null,
    },
    meta: { apiVersion: result.meta?.apiVersion, latencyMs: result.meta?.latencyMs },
  });
}));

// ─────────────────────────────────────────────────────────────────
// Mail M5 — Per-tenant SMTP/IMAP entegrasyon ayarları.
// DevOps Faz 2.1 desenin aynası (yukarıdaki external-devops-settings).
//
// KRİTİK GÜVENLİK:
//  - GET response'unda secret (plain VEYA ciphertext) ASLA gözükmez;
//    sadece secretIsSet boolean + secretSetAt (repository
//    SELECTABLE_PUBLIC sıkı tutar).
//  - PATCH body'sinde `secret` field'ı varsa encrypt edilip persistlenir;
//    yoksa mevcut secret'a dokunulmaz (rotate semantiği).
//  - POST /test mailProvider.sendMail companyId-aware çağrısıyla bağlantı
//    doğrular; secret response'a inmez.
// ─────────────────────────────────────────────────────────────────

router.get('/external-mail-settings', asyncRoute(async (req, res) => {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const item = await externalMailSettingRepo.getByCompany(companyId);
  res.json(item);
}));

router.patch('/external-mail-settings/:companyId', asyncRoute(async (req, res) => {
  const companyId = req.params.companyId;
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const patch = { ...(req.body ?? {}) };
  delete patch.companyId;
  delete patch.id;
  delete patch.createdAt;
  delete patch.updatedAt;
  // Server-side derived alanları client override edemez.
  delete patch.secretIsSet;
  delete patch.secretSetAt;
  delete patch.secretCiphertext;
  delete patch.secretIv;
  delete patch.secretAuthTag;
  delete patch.createdByUserId;
  delete patch.updatedByUserId;
  const actor = requireActor(req);
  const item = await externalMailSettingRepo.upsert(companyId, patch, actor.userId ?? null);
  res.json(item);
}));

/**
 * POST /external-mail-settings/:companyId/test
 *
 * Saklı secret'ı decrypt edip mailProvider.sendMail ile bir test gönderim
 * çağrısı yapar. Body: { testTo?: string } — opsiyonel; yoksa
 * fromAddress (kendi kendine) kullanılır.
 *
 * Dönen: { ok, messageId?, previewUrl?, meta?, error? }
 * Secret response'a inmez, log'a basılmaz.
 */
router.post('/external-mail-settings/:companyId/test', asyncRoute(async (req, res) => {
  const companyId = req.params.companyId;
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const body = req.body ?? {};
  const setting = await externalMailSettingRepo.getByCompany(companyId);
  const testTo = (typeof body.testTo === 'string' && body.testTo.trim())
    ? body.testTo.trim()
    : setting?.fromAddress || null;
  if (!testTo) {
    return res.json({
      ok: false,
      error: {
        code: 'test_to_missing',
        message: 'Test için bir hedef adres gerekli (body.testTo veya kayıtlı fromAddress).',
      },
    });
  }
  // mailProvider companyId-aware: ExternalMailSetting'i DB'den okur,
  // secret decrypt eder. Env fallback satır yoksa devreye girer.
  const result = await mailProviderSendMail(
    {
      to: testTo,
      subject: 'Varuna Mail Connection Test',
      text: 'Bu bir bağlantı testidir. Bu maili gördüyseniz mail entegrasyonu çalışıyor.',
    },
    { companyId },
  );
  if (!result.ok) {
    return res.json({
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        status: result.error.status,
      },
    });
  }
  // Başarı: minimum cevap — secret/ham response sızdırmadan.
  return res.json({
    ok: true,
    messageId: result.messageId,
    previewUrl: result.previewUrl,
    meta: {
      transport: result.meta?.transport,
      source: result.meta?.source,
    },
  });
}));

/**
 * Mail M3 — POST /external-mail-settings/:companyId/poll
 *
 * IMAP polling'i manuel tetikler (SystemAdmin guard — DevOps test rotası
 * deseni). Cron seam (interval) ek olarak; bu endpoint debug / acil
 * tetik için.
 *
 * Dönen: { ok, stats: { fetched, intaken, skipped, failed }, error? }
 * Secret/raw mesaj response'a inmez; sadece sayım istatistikleri.
 */
router.post('/external-mail-settings/:companyId/poll', asyncRoute(async (req, res) => {
  const companyId = req.params.companyId;
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  // SystemAdmin guard (DevOps test endpoint'inden farklı — IMAP polling
  // tüm tenant kapsamlı kaynak tüketir, SystemAdmin yetkisi şart).
  requireSystemAdminOnly(req);

  const result = await imapPollMailbox(companyId);
  if (!result.ok) {
    return res.json({
      ok: false,
      stats: result.stats,
      error: result.error,
    });
  }
  return res.json({
    ok: true,
    stats: result.stats,
    meta: result.meta,
  });
}));

// ─────────────────────────────────────────────────────────────────
// Mail M5-extension (K1) — Per-company FromAlias yönetimi.
//
// REUSE: assertCompanyAdmin guard + asyncRoute + requireActor patternleri.
// Admin UI (AdminExternalMailPage) bu endpoint'leri çağırır. Composer
// dropdown (M6.2) public lookup endpoint'inden besleniyor (case.js).
//
// Plan referansı: docs/M6-email-in-case-plan.md Bölüm 4.4.
// ─────────────────────────────────────────────────────────────────

/**
 * GET /external-mail-settings/:companyId/from-aliases — Admin liste.
 * Response: ExternalMailSettingFromAlias[] (sortOrder asc).
 */
router.get('/external-mail-settings/:companyId/from-aliases', asyncRoute(async (req, res) => {
  const { companyId } = req.params;
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const items = await externalMailFromAliasRepo.list(companyId);
  res.json({ items });
}));

/**
 * POST /external-mail-settings/:companyId/from-aliases — yeni alias.
 * Body: { address, displayName?, isDefault?, isActive?, sortOrder? }
 */
router.post('/external-mail-settings/:companyId/from-aliases', asyncRoute(async (req, res) => {
  const { companyId } = req.params;
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const actor = requireActor(req);
  // Setting FK opsiyonel — ExternalMailSetting varsa otomatik bağla.
  let externalMailSettingId = null;
  try {
    const ems = await externalMailSettingRepo.getByCompany(companyId);
    if (ems?.id) externalMailSettingId = ems.id;
  } catch { /* sessiz */ }
  const result = await externalMailFromAliasRepo.upsert(
    companyId,
    { ...(req.body ?? {}), externalMailSettingId },
    actor.userId ?? null,
  );
  if (!result.ok) {
    const code = result.code;
    const status = code === 'address_already_exists' ? 409
      : code === 'address_invalid' ? 400
      : 400;
    return res.status(status).json({ error: code });
  }
  res.json(result.alias);
}));

/**
 * PATCH /external-mail-settings/:companyId/from-aliases/:aliasId — düzenle.
 * Body üzerinden alias güncellenir.
 */
router.patch('/external-mail-settings/:companyId/from-aliases/:aliasId', asyncRoute(async (req, res) => {
  const { companyId, aliasId } = req.params;
  if (!companyId || !aliasId) throw new AdminError('companyId+aliasId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const actor = requireActor(req);
  const result = await externalMailFromAliasRepo.upsert(
    companyId,
    { ...(req.body ?? {}), id: aliasId },
    actor.userId ?? null,
  );
  if (!result.ok) {
    const code = result.code;
    const status = code === 'not_found' ? 404
      : code === 'address_already_exists' ? 409
      : code === 'address_invalid' ? 400
      : 400;
    return res.status(status).json({ error: code });
  }
  res.json(result.alias);
}));

/**
 * DELETE /external-mail-settings/:companyId/from-aliases/:aliasId — sil.
 */
router.delete('/external-mail-settings/:companyId/from-aliases/:aliasId', asyncRoute(async (req, res) => {
  const { companyId, aliasId } = req.params;
  if (!companyId || !aliasId) throw new AdminError('companyId+aliasId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const result = await externalMailFromAliasRepo.remove(companyId, aliasId);
  if (!result.ok) {
    return res.status(result.code === 'not_found' ? 404 : 400).json({ error: result.code });
  }
  res.json({ ok: true });
}));

/**
 * POST /external-mail-settings/:companyId/from-aliases/:aliasId/set-default
 * — Default alias değişimi (diğerleri otomatik false).
 */
router.post('/external-mail-settings/:companyId/from-aliases/:aliasId/set-default', asyncRoute(async (req, res) => {
  const { companyId, aliasId } = req.params;
  if (!companyId || !aliasId) throw new AdminError('companyId+aliasId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const result = await externalMailFromAliasRepo.setDefault(companyId, aliasId);
  if (!result.ok) {
    const code = result.code;
    const status = code === 'not_found' ? 404
      : code === 'inactive' ? 409
      : 400;
    return res.status(status).json({ error: code });
  }
  res.json({ ok: true });
}));

// ─────────────────────────────────────────────────────────────────
// Mail Multi-Inbox (Faz A4) — ExternalMailInbox admin CRUD.
// Per-tenant; assertCompanyAdmin scope kontrolü her uçta (FromAlias desen).
// Routing: her inbox AYRI IMAP hesabı + AYRI takım (havuz).
// ─────────────────────────────────────────────────────────────────

/**
 * GET /external-mail-settings/:companyId/inboxes — Admin liste.
 * Response: ExternalMailInbox[] (sortOrder asc). secret raw alanları
 * RESPONSE'A GİRMEZ; secretIsSet/secretSetAt sinyalleri döner.
 */
router.get('/external-mail-settings/:companyId/inboxes', asyncRoute(async (req, res) => {
  const { companyId } = req.params;
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const items = await externalMailInboxRepo.list(companyId);
  res.json({ items });
}));

/**
 * POST /external-mail-settings/:companyId/inboxes — yeni inbox.
 * Body: { address, displayName?, imapHost?, imapPort?, imapSecure?,
 *         username?, secret?, assignedTeamId?, enabled?, isActive?, sortOrder? }
 * secret yalnız ilk set/rotation amacıyla body'de geçer; encrypt edilerek
 * ciphertext/iv/authTag persistlenir. Response'a düz secret İNMEZ.
 */
router.post('/external-mail-settings/:companyId/inboxes', asyncRoute(async (req, res) => {
  const { companyId } = req.params;
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const actor = requireActor(req);
  const result = await externalMailInboxRepo.upsert(
    companyId,
    req.body ?? {},
    actor.userId ?? null,
  );
  if (!result.ok) {
    const code = result.code;
    const status = code === 'address_already_exists' ? 409
      : code === 'team_scope_mismatch' ? 403
      : code === 'team_inactive' ? 409
      : 400;
    return res.status(status).json({ error: code });
  }
  // FAZ B (2026-07-02) — FromAlias auto-bridge. Yeni inbox adresi
  // composer dropdown'da görünsün + suggestedFromId eşleşmesi çalışsın.
  // Mevcut alias'a DOKUNMAZ (idempotent).
  await externalMailFromAliasRepo.ensureForInboxAddress(
    companyId,
    result.inbox.address,
    result.inbox.displayName,
    actor.userId ?? null,
  );
  res.json(result.inbox);
}));

/**
 * PATCH /external-mail-settings/:companyId/inboxes/:inboxId — düzenle.
 * Partial update; secret body'de YOK ise dokunulmaz (rotation semantiği).
 */
router.patch('/external-mail-settings/:companyId/inboxes/:inboxId', asyncRoute(async (req, res) => {
  const { companyId, inboxId } = req.params;
  if (!companyId || !inboxId) throw new AdminError('companyId+inboxId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const actor = requireActor(req);
  const result = await externalMailInboxRepo.upsert(
    companyId,
    { ...(req.body ?? {}), id: inboxId },
    actor.userId ?? null,
  );
  if (!result.ok) {
    const code = result.code;
    const status = code === 'not_found' ? 404
      : code === 'address_already_exists' ? 409
      : code === 'team_scope_mismatch' ? 403
      : code === 'team_inactive' ? 409
      : 400;
    return res.status(status).json({ error: code });
  }
  // FAZ B — Address değişse veya yeni displayName gelirse alias köprüsü
  // sağlansın (idempotent; mevcut alias'a dokunmaz).
  await externalMailFromAliasRepo.ensureForInboxAddress(
    companyId,
    result.inbox.address,
    result.inbox.displayName,
    actor.userId ?? null,
  );
  res.json(result.inbox);
}));

/**
 * POST /external-mail-settings/:companyId/inboxes/:inboxId/test — 2026-07-02
 *
 * Multi-Inbox v1'de eksikti; go-live öncesi acil minor. Admin yeni App
 * Password/host tanımladıktan sonra polling cron'unu beklemeden anlık
 * doğrulama yapabilsin diye. imapPoller.testInboxConnection REUSE — mail
 * ÇEKMEZ, hiçbir şey mutate etmez (connect + INBOX lock + logout).
 *
 * Dönen: { ok, code, message, meta? }
 *   code: 'ok' | 'auth_failed' | 'connection_failed' | 'config_incomplete'
 *       | 'inbox_disabled' | 'inbox_invalid'
 *
 * Secret hiçbir yerde response'a inmez; log'da da yok.
 *
 * Guard pariteti: assertCompanyAdmin (diğer mail-inbox endpoint'leri ile
 * aynı desen). Scope dışı inbox → 403.
 */
router.post('/external-mail-settings/:companyId/inboxes/:inboxId/test', asyncRoute(async (req, res) => {
  const { companyId, inboxId } = req.params;
  if (!companyId || !inboxId) throw new AdminError('companyId+inboxId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const inbox = await externalMailInboxRepo.findById(companyId, inboxId);
  if (!inbox) return res.status(404).json({ ok: false, code: 'not_found', message: 'Inbox bulunamadı.' });
  const result = await testInboxConnection(inbox);
  res.json(result);
}));

/**
 * DELETE /external-mail-settings/:companyId/inboxes/:inboxId — sil.
 * Hard delete (FromAlias paterni); inbox'a bağlı CaseEmail kayıtları YOK
 * (CaseEmail.companyId scope üzerinden tutulur, inboxId'siz). Polling
 * cron tick'inde otomatik düşer (listEnabled bu satırı dönmez).
 */
router.delete('/external-mail-settings/:companyId/inboxes/:inboxId', asyncRoute(async (req, res) => {
  const { companyId, inboxId } = req.params;
  if (!companyId || !inboxId) throw new AdminError('companyId+inboxId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const result = await externalMailInboxRepo.remove(companyId, inboxId);
  if (!result.ok) {
    return res.status(result.code === 'not_found' ? 404 : 400).json({ error: result.code });
  }
  res.json({ ok: true });
}));

// ─────────────────────────────────────────────────────────────────
// Mail M6.3b Faz 3 — CaseEmailTemplate admin CRUD.
// Per-tenant; assertCompanyAdmin scope kontrolü her uçta (M5-ext desen).
// ─────────────────────────────────────────────────────────────────

/**
 * GET /case-email-templates?companyId=... — admin list (active + inactive).
 */
router.get('/case-email-templates', asyncRoute(async (req, res) => {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const items = await caseEmailTemplateRepo.list(companyId);
  res.json({ items });
}));

/**
 * POST /case-email-templates — yeni template.
 * Body: { companyId, name, category?, subject?, bodyHtml, variables?, isActive? }
 */
router.post('/case-email-templates', asyncRoute(async (req, res) => {
  const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId : '';
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const actor = requireActor(req);

  // bodyHtml sanitize (M6.1 deseni — agent insert eder, ileride sanitize-html'den geçer).
  let bodyHtml = typeof req.body?.bodyHtml === 'string' ? req.body.bodyHtml : '';
  if (bodyHtml) {
    const { sanitizeOutgoingEmailHtml } = await import('../lib/htmlSanitizer.js');
    bodyHtml = sanitizeOutgoingEmailHtml(bodyHtml);
  }

  const draft = {
    name: req.body?.name,
    category: req.body?.category,
    subject: req.body?.subject,
    bodyHtml,
    variables: req.body?.variables,
    isActive: req.body?.isActive,
  };
  const result = await caseEmailTemplateRepo.upsert(companyId, draft, actor.userId ?? null);
  if (!result.ok) {
    const code = result.code;
    const status = code === 'name_already_exists' ? 409
      : code === 'name_required' || code === 'body_required' || code === 'name_too_long' ? 400
      : 400;
    return res.status(status).json({ error: code });
  }
  res.status(201).json(result.template);
}));

/**
 * GET /case-email-templates/:id?companyId=... — admin read tek satır.
 */
router.get('/case-email-templates/:id', asyncRoute(async (req, res) => {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const tpl = await caseEmailTemplateRepo.getById(companyId, req.params.id);
  if (!tpl) return res.status(404).json({ error: 'not_found' });
  res.json(tpl);
}));

/**
 * PATCH /case-email-templates/:id — düzenle.
 * Body: { companyId, ...partial fields }
 */
router.patch('/case-email-templates/:id', asyncRoute(async (req, res) => {
  const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId : '';
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const actor = requireActor(req);

  let bodyHtml = req.body?.bodyHtml;
  if (typeof bodyHtml === 'string' && bodyHtml) {
    const { sanitizeOutgoingEmailHtml } = await import('../lib/htmlSanitizer.js');
    bodyHtml = sanitizeOutgoingEmailHtml(bodyHtml);
  }

  const draft = {
    id: req.params.id,
    name: req.body?.name,
    category: req.body?.category,
    subject: req.body?.subject,
    bodyHtml,
    variables: req.body?.variables,
    isActive: req.body?.isActive,
  };
  const result = await caseEmailTemplateRepo.upsert(companyId, draft, actor.userId ?? null);
  if (!result.ok) {
    const code = result.code;
    const status = code === 'not_found' ? 404
      : code === 'name_already_exists' ? 409
      : 400;
    return res.status(status).json({ error: code });
  }
  res.json(result.template);
}));

/**
 * DELETE /case-email-templates/:id?companyId=... — sil.
 */
router.delete('/case-email-templates/:id', asyncRoute(async (req, res) => {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);
  const result = await caseEmailTemplateRepo.remove(companyId, req.params.id);
  if (!result.ok) {
    return res.status(result.code === 'not_found' ? 404 : 400).json({ error: result.code });
  }
  res.json({ ok: true });
}));

/**
 * POST /case-email-templates/:id/preview?companyId=...&caseId=... — placeholder render.
 * Body opsiyonel; varsa override variables.
 * Response: { subject, bodyHtml, missing }
 */
router.post('/case-email-templates/:id/preview', asyncRoute(async (req, res) => {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : '';
  if (!companyId) throw new AdminError('companyId gerekli.', 400);
  assertCompanyAdmin(req, companyId);

  const tpl = await caseEmailTemplateRepo.getById(companyId, req.params.id);
  if (!tpl) return res.status(404).json({ error: 'not_found' });

  // Preview için opsiyonel case context — eğer caseId verildiyse fetch et;
  // yoksa boş şablon değerleriyle render (admin preview).
  //
  // Codex P1 fix — caseRow lookup template'in companyId'sine scope'lu
  // OLMALI. Eski kod findUnique({ id: caseId }) global okuyordu →
  // şirket A admin'i, şirket B vaka id'sini biliyorsa title/accountName/
  // requesterContact alanlarını preview response'unda görebilirdi
  // (cross-tenant veri sızıntısı).
  const { prisma } = await import('../db/client.js');
  let caseRow = null;
  if (caseId) {
    caseRow = await prisma.case.findFirst({
      where: { id: caseId, companyId },
      select: {
        caseNumber: true, title: true, accountName: true,
        customerContactName: true, customerContactEmail: true,
      },
    });
  }
  const actor = requireActor(req);
  const { renderTemplate } = await import('../lib/emailTemplateRender.js');
  const out = renderTemplate(tpl, caseRow, { fullName: actor.fullName ?? '' });
  res.json(out);
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
  const actor = requireActor(req);
  const item = await taxonomyDefRepo.create(body, req.user.allowedCompanyIds, actor);
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
  const actor = requireActor(req);
  const item = await taxonomyDefRepo.update(
    req.params.id,
    req.body ?? {},
    req.user.allowedCompanyIds,
    actor,
  );
  res.json(item);
}));

router.delete('/taxonomy-defs/:id', asyncRoute(async (req, res) => {
  await assertTaxonomyDefCompanyAdmin(req, req.params.id);
  const actor = requireActor(req);
  const result = await taxonomyDefRepo.remove(req.params.id, req.user.allowedCompanyIds, actor);
  res.json(result);
}));

export default router;
