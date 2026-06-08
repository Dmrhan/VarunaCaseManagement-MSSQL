import { Router } from 'express';
import { prisma } from '../db/client.js';
import { lookupRepository } from '../db/lookupRepository.js';
import { verifyJwt } from '../db/auth.js';
import { validateVkn, validateTckn } from '../utils/accountValidation.js';

const router = Router();

const SMART_TICKET_TAXONOMY_TYPES = [
  'platform',
  'businessProcess',
  'operationType',
  'affectedObject',
  'impact',
  'rootCauseGroup',
  'rootCauseDetail',
  'resolutionType',
  'permanentPrevention',
];

router.use(verifyJwt);

/**
 * GET /api/lookups/bootstrap
 * Frontend uygulama açılışında tek istekle tüm lookup verilerini çeker.
 * Cevap React Context'e cache'lenir; sayfa içi `lookupService.X()` sync kalır.
 */
router.get('/bootstrap', async (req, res) => {
  try {
    const data = await lookupRepository.bootstrap(req.user.allowedCompanyIds);
    res.json(data);
  } catch (err) {
    console.error('[lookups]', err);
    res.status(500).json({ error: 'internal', message: err?.message });
  }
});

/**
 * WR-A2 — Sync UX validation feedback endpoints.
 *
 * Auth: verifyJwt (authenticated all roles). Pure input validation; scope/tenant
 * gerekmez. Hash veya normalized değer **DÖNMEZ** — sadece valid/invalid + reason.
 *
 * GET /api/lookups/validate-vkn?value=1234567890
 * GET /api/lookups/validate-tckn?value=12345678901
 *
 * Response: { valid: boolean, reason: string | null }
 *
 * Privacy: Plain TCKN input query string'de gelir; HTTPS şarttır. Response'ta
 * normalize edilmiş değer veya hash YOKTUR.
 */
router.get('/validate-vkn', (req, res) => {
  const value = typeof req.query.value === 'string' ? req.query.value : '';
  const result = validateVkn(value);
  res.json({ valid: result.ok, reason: result.ok ? null : result.reason });
});

router.get('/validate-tckn', (req, res) => {
  const value = typeof req.query.value === 'string' ? req.query.value : '';
  const result = validateTckn(value);
  res.json({ valid: result.ok, reason: result.ok ? null : result.reason });
});

/**
 * WR-A7b / PM-05 — GET /api/lookups/catalog?companyId=&accountId=
 *
 * NewCaseForm + AccountCompanyEditor + CaseDetail inline edit kullanır.
 * Returns: { companyId, accountId, packages, products, packageItems, suggestedPackage }
 *
 * Auth: verifyJwt; allowedCompanyIds scope check repository içinde.
 */
router.get('/catalog', async (req, res) => {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  const accountIdRaw = typeof req.query.accountId === 'string' ? req.query.accountId : '';
  const accountId = accountIdRaw ? accountIdRaw : null;
  try {
    const data = await lookupRepository.getCaseCatalog({
      companyId,
      accountId,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json(data);
  } catch (err) {
    if (err?.status) {
      res.status(err.status).json({ error: err.code ?? 'lookup_error', message: err.message });
      return;
    }
    console.error('[lookups/catalog]', err);
    res.status(500).json({ error: 'internal', message: err?.message });
  }
});

/**
 * WR-Smart-Ticket Phase 1a — GET /api/lookups/taxonomies
 *
 * Read-only per-tenant taxonomy lookup for Smart Ticket intake/closure
 * dropdowns. Smart Ticket UI henüz yok (PR-1b+); endpoint sözleşmesi
 * burada sabitleniyor ki UI ekibi paralel ilerleyebilsin.
 *
 * Query:
 *   ?companyId=<id>        (req — allowedCompanyIds içinde olmalı; tek
 *                          şirket görüyorsa optional, default oraya düşer)
 *   ?taxonomyType=<type>   (opsiyonel; tek tip döner; geçersiz tip → 400)
 *   ?includeInactive=true  (default false — sadece isActive=true döner)
 *
 * Response:
 *   {
 *     companyId,
 *     taxonomies: {
 *       platform: [{ code, label, sortOrder, metadata? }, ...],
 *       businessProcess: [...],
 *       ...
 *       rootCauseGroup: [{ code, label, sortOrder,
 *                          children: [{ code, label, sortOrder }, ...] }, ...]
 *     }
 *   }
 *
 * Notes:
 *   - rootCauseDetail değerleri parent'larının `children` dizisinde gömülü
 *     gelir; ayrıca ayrı bir `rootCauseDetail` listesi DÖNMEZ — UI parent
 *     seçimi sonrası child listesi parent'tan okur. (Flat ihtiyacı çıkarsa
 *     `?taxonomyType=rootCauseDetail` ile alınır.)
 *   - Smart Ticket businessProcess/etc. mevcut Case.category/subCategory/
 *     requestType ALANLARININ YERİNE GEÇMEZ — bu PR'da Case akışı dokunulmaz.
 */
router.get('/taxonomies', async (req, res) => {
  const allowed = Array.isArray(req.user?.allowedCompanyIds) ? req.user.allowedCompanyIds : [];

  let companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
  if (!companyId) {
    if (allowed.length === 1) {
      companyId = allowed[0];
    } else {
      res.status(400).json({
        error: 'companyId_required',
        message: 'companyId query parametresi zorunludur (birden fazla şirket görüyorsunuz).',
      });
      return;
    }
  }
  // SECURITY: Zero-scope kullanıcı (UserCompany linki yok) için empty
  // allowedCompanyIds **bypass değildir** — açık membership zorunlu. Eski
  // `allowed.length > 0 && …` short-circuit cross-tenant lookup'a izin
  // veriyordu; getCaseCatalog WR-A7b düzeltmesi ile aynı pattern.
  if (!allowed.includes(companyId)) {
    res.status(403).json({ error: 'forbidden_company', message: 'Bu şirkete erişim yok.' });
    return;
  }

  const taxonomyTypeRaw = typeof req.query.taxonomyType === 'string' ? req.query.taxonomyType.trim() : '';
  if (taxonomyTypeRaw && !SMART_TICKET_TAXONOMY_TYPES.includes(taxonomyTypeRaw)) {
    res.status(400).json({
      error: 'invalid_taxonomy_type',
      message: `taxonomyType desteklenmiyor. Geçerli değerler: ${SMART_TICKET_TAXONOMY_TYPES.join(', ')}`,
    });
    return;
  }
  const includeInactive = String(req.query.includeInactive ?? '').toLowerCase() === 'true';

  try {
    const where = { companyId };
    if (taxonomyTypeRaw === 'rootCauseGroup') {
      // Endpoint sözleşmesi rootCauseDetail rows'u parent rootCauseGroup
      // öğelerinin `children` dizisine gömüyor. Filter sadece
      // rootCauseGroup'a daraltırsa detay satırları çekilmez → her grup
      // children: [] döner ve closure dropdown'unda detay seçenekleri
      // kaybolur. Bu sebeple filter='rootCauseGroup' geldiğinde detail
      // satırlarını da çekip nesting'i kuruyoruz (detail flat listede
      // görünmez — byType'da rootCauseDetail listesi olmadığı için
      // aşağıdaki döngü `if (!list) continue` ile düşer).
      where.taxonomyType = { in: ['rootCauseGroup', 'rootCauseDetail'] };
    } else if (taxonomyTypeRaw) {
      where.taxonomyType = taxonomyTypeRaw;
    }
    if (!includeInactive) where.isActive = true;

    const rows = await prisma.taxonomyDef.findMany({
      where,
      select: {
        id: true,
        taxonomyType: true,
        code: true,
        label: true,
        parentId: true,
        sortOrder: true,
        isActive: includeInactive,
        metadata: true,
      },
      orderBy: [{ taxonomyType: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    });

    const byType = {};
    for (const type of SMART_TICKET_TAXONOMY_TYPES) {
      if (!taxonomyTypeRaw || type === taxonomyTypeRaw) byType[type] = [];
    }

    const groupChildrenByParentId = new Map();
    for (const r of rows) {
      if (r.taxonomyType === 'rootCauseDetail' && r.parentId) {
        if (!groupChildrenByParentId.has(r.parentId)) groupChildrenByParentId.set(r.parentId, []);
        groupChildrenByParentId.get(r.parentId).push({
          code: r.code,
          label: r.label,
          sortOrder: r.sortOrder,
          ...(r.metadata != null ? { metadata: r.metadata } : {}),
          ...(includeInactive ? { isActive: r.isActive } : {}),
        });
      }
    }

    for (const r of rows) {
      const list = byType[r.taxonomyType];
      if (!list) continue; // type filter excluded
      if (r.taxonomyType === 'rootCauseDetail' && !taxonomyTypeRaw) continue; // nested under parent
      const item = {
        code: r.code,
        label: r.label,
        sortOrder: r.sortOrder,
        ...(r.metadata != null ? { metadata: r.metadata } : {}),
        ...(includeInactive ? { isActive: r.isActive } : {}),
      };
      if (r.taxonomyType === 'rootCauseGroup') {
        item.children = groupChildrenByParentId.get(r.id) ?? [];
      }
      list.push(item);
    }

    res.json({ companyId, taxonomies: byType });
  } catch (err) {
    console.error('[lookups/taxonomies]', err);
    res.status(500).json({ error: 'internal', message: err?.message });
  }
});

export default router;
