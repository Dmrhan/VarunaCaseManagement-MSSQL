import { Router } from 'express';
import { lookupRepository } from '../db/lookupRepository.js';
import { verifyJwt } from '../db/auth.js';

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

export default router;
