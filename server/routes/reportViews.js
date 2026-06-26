/**
 * Phase 4 — Saved Views endpoints.
 *
 *   GET    /api/reports/views      → kullanıcının görebileceği tüm view'lar
 *                                     (kendi private + tenant'taki shared)
 *   POST   /api/reports/views      → yeni view kaydet
 *   GET    /api/reports/views/:id  → tek view detayı (load için)
 *   PATCH  /api/reports/views/:id  → düzenle (yalnız owner)
 *   DELETE /api/reports/views/:id  → sil (yalnız owner)
 *
 * Multi-tenant + role guard:
 *   verifyJwt + Supervisor/Admin/SystemAdmin (REPORT_ROLES). Tüm queryler
 *   companyId ∈ req.user.allowedCompanyIds ile sınırlı; cross-tenant
 *   sızıntı yok.
 *
 * Sahiplik:
 *   - Read: kendi (private+shared) + diğerlerinin shared'ları
 *   - Mutate (PATCH/DELETE): yalnız owner. Tenant başka kullanıcının
 *     view'ını düzenleyemez.
 */
import { Router } from 'express';
import { verifyJwt, requireRole } from '../db/auth.js';
import { prisma } from '../db/client.js';
import { AuthorizationRuntimeError } from '../lib/authorizationRuntime.js';
import {
  assertCompanyResourcePolicy,
  filterAllowedCompanyIdsByResourcePolicy,
} from '../lib/authorizationRouteGuards.js';
import {
  validateReportViewPayload,
  serializeForDb,
  parseFromDb,
  filterViewForRole,
} from '../lib/caseReport/reportViewSchema.js';

const router = Router();
router.use(verifyJwt);
const REPORT_ROLES = requireRole('Supervisor', 'Admin', 'SystemAdmin');
router.use(REPORT_ROLES);

function userScope(req) {
  return {
    userId: req.user?.id,
    role: req.user?.role ?? null,
    allowedCompanyIds: Array.isArray(req.user?.allowedCompanyIds) ? req.user.allowedCompanyIds : [],
  };
}

function badRequest(res, message, extra) {
  return res.status(400).json({ error: 'bad_request', message, ...(extra || {}) });
}

function handleAuthorizationRuntimeError(res, err) {
  if (err instanceof AuthorizationRuntimeError) {
    res.status(err.status ?? 403).json({
      error: err.code ?? 'authorization_forbidden',
      message: err.message,
    });
    return true;
  }
  return false;
}

/**
 * GET /api/reports/views
 *
 * Kullanıcının görebileceği view listesi:
 *   - Kendi tüm view'ları (private + shared)
 *   - Aynı tenant'taki BAŞKA kullanıcıların shared view'ları
 *
 * Sorgu: companyId ∈ allowedCompanyIds AND (ownerId = userId OR isShared = true)
 *
 * Order: name asc (UI tutarlı sıralama).
 */
router.get('/', async (req, res) => {
  const { userId, role, allowedCompanyIds } = userScope(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });
  if (allowedCompanyIds.length === 0) return res.json({ views: [] });

  try {
    const visibleCompanyIds = await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'report.view', action: 'read' });
    if (visibleCompanyIds.length === 0) return res.json({ views: [] });
    const rows = await prisma.reportView.findMany({
      where: {
        companyId: { in: visibleCompanyIds },
        OR: [
          { ownerId: userId },
          { isShared: true },
        ],
      },
      orderBy: [{ name: 'asc' }],
      take: 500, // makul cap; ileride ihtiyaç olursa pagination
    });
    // Codex P2 — Role gate bypass fix: paylaşımlı view'larda kolon rol kısıtı
    // honour edilir. Owner kendi view'unu tam görür.
    const views = rows
      .map(parseFromDb)
      .filter(Boolean)
      .map((v) => filterViewForRole(v, role, userId));
    return res.json({ views });
  } catch (err) {
    if (handleAuthorizationRuntimeError(res, err)) return;
    console.error('[reportViews][list]', err);
    return res.status(500).json({ error: 'list_failed' });
  }
});

/**
 * POST /api/reports/views
 *
 * Body: { name, description?, mode, companyId, columns[], filters{}, pivotConfig?, isShared? }
 *
 * Sahiplik: ownerId = req.user.id (otomatik). Tenant: companyId
 * allowedCompanyIds içinde olmalı.
 *
 * Uniqueness: (companyId, ownerId, name) — aynı kullanıcı aynı isimde 2
 * view kaydederse 409 conflict.
 */
router.post('/', async (req, res) => {
  const { userId, allowedCompanyIds } = userScope(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const v = validateReportViewPayload(req.body);
  if (!v.ok) return badRequest(res, 'invalid payload', { details: v.errors });

  if (!allowedCompanyIds.includes(v.view.companyId)) {
    return res.status(403).json({ error: 'tenant_forbidden', message: 'companyId not in allowed scope' });
  }

  try {
    await assertCompanyResourcePolicy(req, { companyId: v.view.companyId, resourceKey: 'report.view', action: 'create' });
    const created = await prisma.reportView.create({
      data: {
        ...serializeForDb(v.view),
        ownerId: userId,
      },
    });
    return res.status(201).json({ view: parseFromDb(created) });
  } catch (err) {
    if (handleAuthorizationRuntimeError(res, err)) return;
    // Prisma unique constraint violation (P2002)
    if (err && err.code === 'P2002') {
      return res.status(409).json({
        error: 'duplicate_name',
        message: 'You already have a saved view with this name in this company.',
      });
    }
    console.error('[reportViews][create]', err);
    return res.status(500).json({ error: 'create_failed' });
  }
});

/**
 * GET /api/reports/views/:id
 *
 * Tek view detay — kullanıcı erişim yetkisi varsa (owner veya shared aynı
 * tenant). Tenant scope DAİMA enforce; bulunamazsa 404 (existence sızdırma).
 */
router.get('/:id', async (req, res) => {
  const { userId, role, allowedCompanyIds } = userScope(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  try {
    const row = await prisma.reportView.findFirst({
      where: {
        id: req.params.id,
        companyId: { in: allowedCompanyIds },
        OR: [{ ownerId: userId }, { isShared: true }],
      },
    });
    if (!row) return res.status(404).json({ error: 'not_found' });
    await assertCompanyResourcePolicy(req, { companyId: row.companyId, resourceKey: 'report.view', action: 'read' });
    // Codex P2 — Role gate bypass fix (list endpoint ile aynı semantik).
    const view = filterViewForRole(parseFromDb(row), role, userId);
    return res.json({ view });
  } catch (err) {
    if (handleAuthorizationRuntimeError(res, err)) return;
    console.error('[reportViews][get]', err);
    return res.status(500).json({ error: 'get_failed' });
  }
});

/**
 * PATCH /api/reports/views/:id
 *
 * Yalnız OWNER düzenleyebilir. Body partial olabilir; ama gönderilen
 * alanlar full validation'a tabi — yeni bir view nesnesi gibi.
 *
 * Sahiplik kontrolü: ownerId === req.user.id AND companyId ∈ allowedCompanyIds.
 * Başkasının shared view'ını düzenleme denemesi → 404 (existence sızdırma).
 */
router.patch('/:id', async (req, res) => {
  const { userId, allowedCompanyIds } = userScope(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  try {
    // Codex P2 fix — ownership lookup'ı try içine al. Express 4'te try
    // dışındaki await reject olursa otomatik 500'e dönüşmüyor; PATCH hang
    // veya unhandled rejection olarak yüzeye çıkıyordu (DB pool down vb.).
    const existing = await prisma.reportView.findFirst({
      where: { id: req.params.id, ownerId: userId, companyId: { in: allowedCompanyIds } },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    await assertCompanyResourcePolicy(req, { companyId: existing.companyId, resourceKey: 'report.view', action: 'update' });

    // Payload merge: gönderilen alanlar override, gönderilmeyenler korunur.
    // Validation için MERGE edilmiş payload'ı oluştur (full validation).
    const existingParsed = parseFromDb(existing);
    const mergedBody = {
      name: req.body?.name ?? existingParsed.name,
      description: req.body?.description !== undefined ? req.body.description : existingParsed.description,
      mode: req.body?.mode ?? existingParsed.mode,
      companyId: existingParsed.companyId, // değiştirilemez (tenant move yok)
      columns: req.body?.columns ?? existingParsed.columns,
      filters: req.body?.filters ?? existingParsed.filters,
      pivotConfig: req.body?.pivotConfig !== undefined ? req.body.pivotConfig : existingParsed.pivotConfig,
      isShared: req.body?.isShared !== undefined ? req.body.isShared : existingParsed.isShared,
    };

    const v = validateReportViewPayload(mergedBody);
    if (!v.ok) return badRequest(res, 'invalid payload', { details: v.errors });

    const updated = await prisma.reportView.update({
      where: { id: req.params.id },
      data: serializeForDb(v.view),
    });
    return res.json({ view: parseFromDb(updated) });
  } catch (err) {
    if (handleAuthorizationRuntimeError(res, err)) return;
    if (err && err.code === 'P2002') {
      return res.status(409).json({
        error: 'duplicate_name',
        message: 'You already have a saved view with this name in this company.',
      });
    }
    console.error('[reportViews][update]', err);
    return res.status(500).json({ error: 'update_failed' });
  }
});

/**
 * DELETE /api/reports/views/:id
 *
 * Yalnız OWNER silebilir. Başkasının view'ını silme → 404.
 */
router.delete('/:id', async (req, res) => {
  const { userId, allowedCompanyIds } = userScope(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  try {
    // Codex P2 fix — ownership lookup'ı try içine al (PATCH ile aynı pattern).
    const existing = await prisma.reportView.findFirst({
      where: { id: req.params.id, ownerId: userId, companyId: { in: allowedCompanyIds } },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    await assertCompanyResourcePolicy(req, { companyId: existing.companyId, resourceKey: 'report.view', action: 'delete' });

    await prisma.reportView.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch (err) {
    if (handleAuthorizationRuntimeError(res, err)) return;
    console.error('[reportViews][delete]', err);
    return res.status(500).json({ error: 'delete_failed' });
  }
});

export default router;
