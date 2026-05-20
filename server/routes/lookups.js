import { Router } from 'express';
import { lookupRepository } from '../db/lookupRepository.js';
import { verifyJwt } from '../db/auth.js';
import { validateVkn, validateTckn } from '../utils/accountValidation.js';

const router = Router();

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

export default router;
