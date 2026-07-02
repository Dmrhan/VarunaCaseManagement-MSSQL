import { Router } from 'express';
import { verifyJwt, requireRole } from '../db/auth.js';
import {
  accountRepository,
  AccountAccessError,
  AccountValidationError,
} from '../db/accountRepository.js';
import {
  AuthorizationRuntimeError,
} from '../lib/authorizationRuntime.js';
import {
  assertAccountResourcePolicy,
  assertCompanyResourcePolicy,
  filterAccountCompanyIdsByResourcePolicy,
  filterAllowedCompanyIdsByResourcePolicy,
} from '../lib/authorizationRouteGuards.js';

/**
 * /api/accounts route.
 *
 * Role matrix (P1 hotfix sonrası):
 *  - LIST_ROLES: tüm authenticated case-opening roller GET /api/accounts list/search
 *    çağırabilir. Agent vaka açma akışında AccountSearchPicker kullanır;
 *    Müşteriler modülüne giremez (sidebar + route guard frontend).
 *  - DETAIL_READ_ROLES: GET /api/accounts/:id ve sub-resource GET'leri
 *    yalnız Supervisor/CSM/Admin/SystemAdmin'e açık (Agent'a Account detayı
 *    sızmaz — notes/segment yok).
 *  - WRITE_ROLES: Tüm mutasyonlar Admin/SystemAdmin only.
 *
 * Scope: req.user.allowedCompanyIds üzerinden AccountCompany veya legacy
 * Account.companyId. Detay erişimi için accountRepository.assertAccountInScope().
 */

const router = Router();
router.use(verifyJwt);

const LIST_ROLES = ['Agent', 'Backoffice', 'Supervisor', 'CSM', 'Admin', 'SystemAdmin'];
const DETAIL_READ_ROLES = ['Agent', 'Backoffice', 'Supervisor', 'CSM', 'Admin', 'SystemAdmin'];
const WRITE_ROLES = ['Admin', 'SystemAdmin'];

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof AccountAccessError) {
        return res.status(403).json({ error: 'forbidden', message: err.message });
      }
      if (err instanceof AccountValidationError) {
        return res
          .status(err.status ?? 400)
          .json({ error: err.code ?? 'validation_error', message: err.message });
      }
      if (err instanceof AuthorizationRuntimeError) {
        return res
          .status(err.status ?? 403)
          .json({ error: err.code ?? 'authorization_forbidden', message: err.message });
      }
      // VKN gibi hassas alanları log'a almamak için sadece message + code basıyoruz.
      console.error('[accounts]', err?.code ?? err?.name ?? 'error', err?.message);
      res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
    }
  };
}

/**
 * GET /api/accounts — list/search
 *
 * P1 hotfix: Tüm case-opening rolleri (Agent dahil) AccountSearchPicker'ı
 * vaka açma akışında kullanabilmeli. Müşteriler modülünün sidebar/route
 * guard'ı Agent'a kapalı kalır (canReadAccounts === false).
 *
 * Response shape: internal notes/segment hiçbir zaman dahil edilmez (zaten
 * accountRepository.shapeAccountRow yalnız company chip + meta döndürür).
 */
router.get(
  '/',
  requireRole(...LIST_ROLES),
  asyncRoute(async (req, res) => {
    const { search, companyId, status, page, limit } = req.query;
    const VALID_SEARCH_FIELDS = new Set(['name', 'vkn', 'phone', 'code', 'contact']);
    const rawSearchFields = typeof req.query.searchFields === 'string' ? req.query.searchFields : '';
    const parsedSearchFields = rawSearchFields.split(',').map((s) => s.trim()).filter((s) => VALID_SEARCH_FIELDS.has(s));
    const scopedAllowedCompanyIds = typeof companyId === 'string' && companyId
      ? await filterAllowedCompanyIdsByResourcePolicy(req, {
          resourceKey: 'account',
          action: 'read',
          throwIfEmpty: true,
          companyIds: [companyId],
        })
      : await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'account', action: 'read' });
    // C2 recents revalidation: ?ids=a,b,c — explicit id filter combined with
    // tenant scope. The repo drops out-of-scope ids via buildScopeWhere so a
    // stale localStorage cache cannot surface forbidden accounts.
    const rawIds = typeof req.query.ids === 'string' ? req.query.ids : '';
    const parsedIds = rawIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const result = await accountRepository.listAccounts({
      search,
      companyId,
      status,
      ids: rawIds ? parsedIds : undefined,
      searchFields: parsedSearchFields.length > 0 ? parsedSearchFields : undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      allowedCompanyIds: scopedAllowedCompanyIds,
    });
    res.json(result);
  }),
);

/**
 * Faz B-temel — GET /api/accounts/central?companyId=...
 *
 * AccountProject editor "Ana Firma" dropdown için: yalnız customerRole='Central'
 * (Merkez Müşteri) olan account'ları döndürür.
 *
 * Scope: req.user.allowedCompanyIds (filterAllowedCompanyIdsByResourcePolicy)
 *   - SystemAdmin: tüm aktif şirketler
 *   - Diğer: user'ın allowed companyIds'i
 *
 * `companyId` query param: belirli bir tenant'a daraltır (project editor'da
 * bayinin companyId'si). User'ın o tenant'a erişimi yoksa boş liste.
 *
 * CR zorunlu test: başka tenant'ın Central account'u ASLA gözükmesin
 * (smoke-customer-role-cross-tenant-denial davranış testi).
 *
 * NOT: '/:id' route'undan ÖNCE tanımlandı; aksi halde `central` id olarak
 * yorumlanır.
 */
router.get(
  '/central',
  requireRole(...DETAIL_READ_ROLES),
  asyncRoute(async (req, res) => {
    const companyIdRaw = req.query.companyId;
    const targetCompanyId = typeof companyIdRaw === 'string' && companyIdRaw
      ? companyIdRaw
      : null;
    // Defense-in-depth — kullanıcının bu companyId'ye erişim yetkisi
    // kontrolü (cross-tenant guard). targetCompanyId yoksa user'ın tüm
    // allowed tenant'ları kullanılır.
    if (targetCompanyId) {
      const scoped = await filterAllowedCompanyIdsByResourcePolicy(req, {
        resourceKey: 'account',
        action: 'read',
        companyIds: [targetCompanyId],
        throwIfEmpty: false,
      });
      if (!scoped.includes(targetCompanyId)) {
        // Sessiz boş — kullanıcı bu tenant'a erişemiyor
        return res.json({ items: [] });
      }
    }
    const items = await accountRepository.listCentralAccounts({
      user: req.user,
      targetCompanyId,
    });
    res.json({ items });
  }),
);

/**
 * GET /api/accounts/:id — full detail (notes/segment dahil)
 *
 * Agent + Backoffice 403. Detayı sadece müşteri yöneticileri görür.
 */
router.get(
  '/:id',
  requireRole(...DETAIL_READ_ROLES),
  asyncRoute(async (req, res) => {
    const scopedAllowedCompanyIds = await filterAccountCompanyIdsByResourcePolicy(req, {
      accountId: req.params.id,
      action: 'read',
    });
    const account = await accountRepository.getAccount(req.params.id, {
      allowedCompanyIds: scopedAllowedCompanyIds,
    });
    if (!account) {
      return res.status(404).json({ error: 'not_found', message: 'Müşteri bulunamadı.' });
    }
    res.json(account);
  }),
);

/** POST /api/accounts — create */
router.post(
  '/',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    const companies = Array.isArray(req.body?.companies) ? req.body.companies : [];
    for (const c of companies) {
      if (typeof c?.companyId === 'string' && c.companyId) {
        await assertCompanyResourcePolicy(req, { companyId: c.companyId, resourceKey: 'account', action: 'create' });
      }
    }
    const created = await accountRepository.createAccount({ data: req.body, user: req.user });
    res.status(201).json(created);
  }),
);

/** PATCH /api/accounts/:id — update (Account fieldları) */
router.patch(
  '/:id',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, action: 'update' });
    const updated = await accountRepository.updateAccount({
      accountId: req.params.id,
      data: req.body,
      user: req.user,
    });
    if (!updated) {
      return res.status(404).json({ error: 'not_found', message: 'Müşteri bulunamadı.' });
    }
    res.json(updated);
  }),
);

/* ---------- Phase C1 — AccountCompany mutations ---------- */

/** POST /api/accounts/:id/companies — yeni şirket ilişkisi
 *
 * Codex review fix (2b936c7 P1) — HEDEF companyId policy check.
 * assertAccountResourcePolicy account'un MEVCUT şirketleri üzerinden çalışır;
 * yeni eklenen companyId (req.body.companyId) için policy kontrolü yoktu →
 * AUTHORIZATION_RESOURCE_ENFORCEMENT_ENABLED=true iken kullanıcı izinsiz
 * tenant'a account-company ilişkisi ekleyebiliyordu.
 *
 * Düzeltme: addCompanyRelation öncesi req.body.companyId için
 * assertCompanyResourcePolicy çağrısı; eksikse 400, izinsizse 403.
 */
router.post(
  '/:id/companies',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    const targetCompanyId = typeof req.body?.companyId === 'string' ? req.body.companyId.trim() : '';
    if (!targetCompanyId) {
      return res.status(400).json({ error: 'validation_error', message: 'companyId zorunlu.' });
    }
    await assertAccountResourcePolicy(req, { accountId: req.params.id, action: 'update' });
    // Codex P1 — HEDEF tenant policy check (deny-only enforcement).
    await assertCompanyResourcePolicy(req, {
      companyId: targetCompanyId,
      resourceKey: 'account',
      action: 'create',
    });
    const updated = await accountRepository.addCompanyRelation({
      accountId: req.params.id,
      data: req.body,
      user: req.user,
    });
    if (!updated) {
      return res.status(404).json({ error: 'not_found', message: 'Müşteri bulunamadı.' });
    }
    res.status(201).json(updated);
  }),
);

/** PATCH /api/accounts/:id/companies/:accountCompanyId — şirket ilişkisi güncelle */
router.patch(
  '/:id/companies/:accountCompanyId',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, action: 'update' });
    const updated = await accountRepository.updateCompanyRelation({
      accountId: req.params.id,
      accountCompanyId: req.params.accountCompanyId,
      data: req.body,
      user: req.user,
    });
    if (!updated) {
      return res.status(404).json({ error: 'not_found', message: 'Şirket ilişkisi bulunamadı.' });
    }
    res.json(updated);
  }),
);

/** DELETE /api/accounts/:id/companies/:accountCompanyId — şirket ilişkisini kaldır */
router.delete(
  '/:id/companies/:accountCompanyId',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, action: 'update' });
    const updated = await accountRepository.removeCompanyRelation({
      accountId: req.params.id,
      accountCompanyId: req.params.accountCompanyId,
      user: req.user,
    });
    if (!updated) {
      return res.status(404).json({ error: 'not_found', message: 'Şirket ilişkisi bulunamadı.' });
    }
    res.json(updated);
  }),
);

/* ---------- Phase C1 — AccountContact mutations ---------- */

/** POST /api/accounts/:id/contacts — yeni kontak */
router.post(
  '/:id/contacts',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, resourceKey: 'account.contact', action: 'create' });
    const updated = await accountRepository.addContact({
      accountId: req.params.id,
      data: req.body,
      user: req.user,
    });
    if (!updated) {
      return res.status(404).json({ error: 'not_found', message: 'Müşteri bulunamadı.' });
    }
    res.status(201).json(updated);
  }),
);

/** PATCH /api/accounts/:id/contacts/:contactId — kontak güncelle */
router.patch(
  '/:id/contacts/:contactId',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, resourceKey: 'account.contact', action: 'update' });
    const updated = await accountRepository.updateContact({
      accountId: req.params.id,
      contactId: req.params.contactId,
      data: req.body,
      user: req.user,
    });
    if (!updated) {
      return res.status(404).json({ error: 'not_found', message: 'Kontak bulunamadı.' });
    }
    res.json(updated);
  }),
);

/** DELETE /api/accounts/:id/contacts/:contactId — kontak pasifleştir (soft delete) */
router.delete(
  '/:id/contacts/:contactId',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, resourceKey: 'account.contact', action: 'delete' });
    const updated = await accountRepository.removeContact({
      accountId: req.params.id,
      contactId: req.params.contactId,
      user: req.user,
    });
    if (!updated) {
      return res.status(404).json({ error: 'not_found', message: 'Kontak bulunamadı.' });
    }
    res.json(updated);
  }),
);

/* ---------- Phase C2 — AccountProduct ---------- */

/** GET /api/accounts/:id/products — read scope (companyId optional filter) */
router.get(
  '/:id/products',
  requireRole(...DETAIL_READ_ROLES),
  asyncRoute(async (req, res) => {
    const scopedAllowedCompanyIds = await filterAccountCompanyIdsByResourcePolicy(req, {
      accountId: req.params.id,
      action: 'read',
    });
    const out = await accountRepository.listProducts({
      accountId: req.params.id,
      companyId: typeof req.query.companyId === 'string' ? req.query.companyId : undefined,
      user: { ...req.user, allowedCompanyIds: scopedAllowedCompanyIds },
    });
    res.json(out);
  }),
);

/** POST /api/accounts/:id/products */
router.post(
  '/:id/products',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, action: 'update' });
    const created = await accountRepository.addProduct({
      accountId: req.params.id,
      data: req.body,
      user: req.user,
    });
    // Detay olarak güncel müşteriyi de vermek tutarlı UX sağlar.
    const detail = await accountRepository.getAccount(req.params.id, {
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.status(201).json({ ...created, account: detail });
  }),
);

/** PATCH /api/accounts/:id/products/:productId */
router.patch(
  '/:id/products/:productId',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, action: 'update' });
    const updated = await accountRepository.updateProduct({
      accountId: req.params.id,
      productId: req.params.productId,
      data: req.body,
      user: req.user,
    });
    if (!updated) {
      return res.status(404).json({ error: 'not_found', message: 'Ürün bulunamadı.' });
    }
    const detail = await accountRepository.getAccount(req.params.id, {
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json({ ...updated, account: detail });
  }),
);

/** DELETE /api/accounts/:id/products/:productId — soft (isActive=false) */
router.delete(
  '/:id/products/:productId',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, action: 'update' });
    const result = await accountRepository.removeProduct({
      accountId: req.params.id,
      productId: req.params.productId,
      user: req.user,
    });
    if (!result) {
      return res.status(404).json({ error: 'not_found', message: 'Ürün bulunamadı.' });
    }
    const detail = await accountRepository.getAccount(req.params.id, {
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json({ ...result, account: detail });
  }),
);

/* ---------- WR-A4 — AccountProject CRUD ---------- */

/**
 * POST /api/accounts/:id/companies/:accountCompanyId/projects
 * Admin/SystemAdmin only. Tenant scope via AccountCompany.companyId.
 */
router.post(
  '/:id/companies/:accountCompanyId/projects',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, resourceKey: 'account.project', action: 'create' });
    const created = await accountRepository.addProject({
      accountId: req.params.id,
      accountCompanyId: req.params.accountCompanyId,
      data: req.body,
      user: req.user,
    });
    const detail = await accountRepository.getAccount(req.params.id, {
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.status(201).json({ ...created, account: detail });
  }),
);

/** PATCH /api/accounts/:id/projects/:projectId */
router.patch(
  '/:id/projects/:projectId',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, resourceKey: 'account.project', action: 'update' });
    const updated = await accountRepository.updateProject({
      accountId: req.params.id,
      projectId: req.params.projectId,
      data: req.body,
      user: req.user,
    });
    if (!updated) return res.status(404).json({ error: 'not_found', message: 'Proje bulunamadı.' });
    const detail = await accountRepository.getAccount(req.params.id, {
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json({ ...updated, account: detail });
  }),
);

/** DELETE /api/accounts/:id/projects/:projectId — soft delete (isActive=false, status=Cancelled). */
router.delete(
  '/:id/projects/:projectId',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, resourceKey: 'account.project', action: 'delete' });
    const result = await accountRepository.removeProject({
      accountId: req.params.id,
      projectId: req.params.projectId,
      user: req.user,
    });
    if (!result) return res.status(404).json({ error: 'not_found', message: 'Proje bulunamadı.' });
    const detail = await accountRepository.getAccount(req.params.id, {
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json({ ...result, account: detail });
  }),
);

/* ---------- WR-A3 / PM-02 — Address CRUD ---------- */

/**
 * GET /api/accounts/:id/addresses
 * Read roles only. Adresler getAccount response'unda zaten geliyor; ayrı endpoint
 * advanced clients / future import path için.
 */
router.get(
  '/:id/addresses',
  requireRole(...DETAIL_READ_ROLES),
  asyncRoute(async (req, res) => {
    const scopedAllowedCompanyIds = await filterAccountCompanyIdsByResourcePolicy(req, {
      accountId: req.params.id,
      action: 'read',
    });
    const detail = await accountRepository.getAccount(req.params.id, {
      allowedCompanyIds: scopedAllowedCompanyIds,
    });
    if (!detail) return res.status(404).json({ error: 'not_found', message: 'Müşteri bulunamadı.' });
    res.json({ value: detail.addresses ?? [] });
  }),
);

/**
 * POST /api/accounts/:id/addresses
 * Admin/SystemAdmin only.
 */
router.post(
  '/:id/addresses',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, action: 'update' });
    const created = await accountRepository.addAddress({
      accountId: req.params.id,
      data: req.body,
      user: req.user,
    });
    res.status(201).json(created);
  }),
);

/** PATCH /api/accounts/:id/addresses/:addressId */
router.patch(
  '/:id/addresses/:addressId',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, action: 'update' });
    const updated = await accountRepository.updateAddress({
      accountId: req.params.id,
      addressId: req.params.addressId,
      data: req.body,
      user: req.user,
    });
    if (!updated) return res.status(404).json({ error: 'not_found', message: 'Adres bulunamadı.' });
    res.json(updated);
  }),
);

/** DELETE /api/accounts/:id/addresses/:addressId — soft delete. */
router.delete(
  '/:id/addresses/:addressId',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
    await assertAccountResourcePolicy(req, { accountId: req.params.id, action: 'update' });
    const result = await accountRepository.removeAddress({
      accountId: req.params.id,
      addressId: req.params.addressId,
      user: req.user,
    });
    if (!result) return res.status(404).json({ error: 'not_found', message: 'Adres bulunamadı.' });
    res.json(result);
  }),
);

export default router;
