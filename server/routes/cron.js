import { Router } from 'express';
import { runPatternDetect } from '../cron/patternDetect.js';
import { runQaScoreBatch, runScoreCase } from '../cron/qaScoreBatch.js';
import { runNotificationCleanup } from '../cron/notificationCleanup.js';
import { runActionItemArchive } from '../cron/actionItemArchive.js';

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

/**
 * QA score batch — Faz 1.5 Madde 4. Her gece 02:00 UTC GitHub Actions
 * tarafından tetiklenir. Tek run'da max 10 kapalı vaka skor.
 */
router.post('/qa-score-batch', async (req, res) => {
  if (!checkCronSecret(req, res)) return;
  try {
    const result = await runQaScoreBatch();
    res.json(result);
  } catch (err) {
    console.error('[cron:qa-score-batch]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * Notification retention cleanup — readAt NOT NULL + 30g+ satirlari siler.
 * Okunmamis bildirimleri korur. Onerilen periyot: gunluk.
 */
router.post('/notification-cleanup', async (req, res) => {
  if (!checkCronSecret(req, res)) return;
  try {
    const result = await runNotificationCleanup();
    if (!result.ok) return res.status(500).json(result);
    res.json(result);
  } catch (err) {
    console.error('[cron:notification-cleanup]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * ActionItem soft archive (OD-073 / Half-Shipped Audit PR-3).
 *
 * Terminal state'teki (Done/Dismissed/Expired) ve `updatedAt` 30 gunden
 * eski olan satirlara `archivedAt = now()` set eder. **Hicbir satir
 * DELETE edilmez.** Aktif inbox queries `archivedAt: null` filtresiyle
 * archived satirlari gizler. Onerilen periyot: gunluk 03:20 UTC.
 */
router.post('/actionitem-archive', async (req, res) => {
  if (!checkCronSecret(req, res)) return;
  try {
    const result = await runActionItemArchive();
    if (!result.ok) return res.status(500).json(result);
    res.json(result);
  } catch (err) {
    console.error('[cron:actionitem-archive]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * Tek vaka skor — manuel/test için. Auth: x-uptime-secret veya Bearer.
 * Body: { caseId }
 */
router.post('/qa-score', async (req, res) => {
  if (!checkCronSecret(req, res)) return;
  const caseId = req.body?.caseId;
  if (!caseId) return res.status(400).json({ error: 'caseId gerekli.' });
  try {
    const result = await runScoreCase(caseId);
    if (result?.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[cron:qa-score]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

export default router;
