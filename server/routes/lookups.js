import { Router } from 'express';
import { lookupRepository } from '../db/lookupRepository.js';

const router = Router();

/**
 * GET /api/lookups/bootstrap
 * Frontend uygulama açılışında tek istekle tüm lookup verilerini çeker.
 * Cevap React Context'e cache'lenir; sayfa içi `lookupService.X()` sync kalır.
 */
router.get('/bootstrap', async (_req, res) => {
  try {
    const data = await lookupRepository.bootstrap();
    res.json(data);
  } catch (err) {
    console.error('[lookups]', err);
    res.status(500).json({ error: 'internal', message: err?.message });
  }
});

export default router;
