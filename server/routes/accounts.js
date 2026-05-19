import { Router } from 'express';
import { verifyJwt, requireRole } from '../db/auth.js';
import {
  accountRepository,
  AccountAccessError,
  AccountValidationError,
} from '../db/accountRepository.js';

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
const DETAIL_READ_ROLES = ['Supervisor', 'CSM', 'Admin', 'SystemAdmin'];
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
    const result = await accountRepository.listAccounts({
      search,
      companyId,
      status,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json(result);
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
    const account = await accountRepository.getAccount(req.params.id, {
      allowedCompanyIds: req.user.allowedCompanyIds,
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
    const created = await accountRepository.createAccount({ data: req.body, user: req.user });
    res.status(201).json(created);
  }),
);

/** PATCH /api/accounts/:id — update (Account fieldları) */
router.patch(
  '/:id',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
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

/** POST /api/accounts/:id/companies — yeni şirket ilişkisi */
router.post(
  '/:id/companies',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
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
    const out = await accountRepository.listProducts({
      accountId: req.params.id,
      companyId: typeof req.query.companyId === 'string' ? req.query.companyId : undefined,
      user: req.user,
    });
    res.json(out);
  }),
);

/** POST /api/accounts/:id/products */
router.post(
  '/:id/products',
  requireRole(...WRITE_ROLES),
  asyncRoute(async (req, res) => {
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
    const detail = await accountRepository.getAccount(req.params.id, {
      allowedCompanyIds: req.user.allowedCompanyIds,
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
