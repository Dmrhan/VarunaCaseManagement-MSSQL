import { Router } from 'express';
import { runPatternDetect } from '../cron/patternDetect.js';

/**
 * /api/cron/* — uzaktan tetiklenen periyodik işler.
 *
 * Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}` veya UptimeRobot/
 * GitHub Actions `x-uptime-secret: ${CRON_SECRET}` header. Snooze cron ile
 * aynı dual-auth pattern (docs/INCIDENTS.md §5.1).
 *
 * NOT: Snooze wakeup cron tarihsel sebeplerle /api/cases/cron/snooze-wakeup
 * altında kaldı; yeni cron'lar bu router'a (app-level /api/cron prefix)
 * eklenir.
 */

const router = Router();

function checkCronSecret(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(503).json({ error: 'cron_disabled', message: 'CRON_SECRET tanımlı değil.' });
    return false;
  }
  const bearerMatch = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  const bearerOk = bearerMatch && bearerMatch[1] === expected;
  const uptimeOk = req.headers['x-uptime-secret'] === expected;
  if (!bearerOk && !uptimeOk) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

router.post('/pattern-detect', async (req, res) => {
  if (!checkCronSecret(req, res)) return;
  try {
    const result = await runPatternDetect();
    res.json(result);
  } catch (err) {
    console.error('[cron:pattern-detect]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

export default router;
