/**
 * routes/system.js — 2026-07-10 (Sistem Sağlığı Faz 1)
 *
 * GET /api/system/health — uygulama sağlık payload'ı (salt-okur, PII yok).
 *
 * ÇİFT KİMLİK modeli:
 *   a) X-Health-Token header'ı — Zabbix HTTP-agent için (JWT akışı yok).
 *      Yalnız HEALTH_TOKEN env tanımlı VE eşleşiyorsa (timing-safe) geçer.
 *      Env tanımsızsa bu yol TAMAMEN KAPALIDIR (fail-closed) — yanlışlıkla
 *      tokensız açık endpoint bırakılamaz.
 *   b) SystemAdmin JWT — Faz 2 panosu ve elle kontrol için
 *      (Case Soft Archive ile aynı rol kapısı).
 *
 * Payload'da gizli değer yoktur (sayı/yaş/boolean) ama yine de sistem
 * topolojisi anlattığından iki kapıdan biri şarttır.
 */
import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { verifyJwt, requireRole } from '../db/auth.js';
import { collectHealth } from '../lib/systemHealth.js';

const router = Router();

function healthTokenMatches(req) {
  const expected = process.env.HEALTH_TOKEN ?? '';
  if (!expected) return false; // fail-closed: env yoksa token yolu kapalı
  const got = String(req.get('x-health-token') ?? '');
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

router.get('/health', async (req, res, next) => {
  if (healthTokenMatches(req)) {
    try {
      return res.json(await collectHealth());
    } catch (err) {
      return res.status(500).json({ error: 'health_collect_failed', message: String(err?.message ?? err).slice(0, 200) });
    }
  }
  // Token yolu geçmedi → SystemAdmin JWT zinciri devralır.
  return verifyJwt(req, res, (err) => {
    if (err) return next(err);
    return requireRole('SystemAdmin')(req, res, async (err2) => {
      if (err2) return next(err2);
      try {
        res.json(await collectHealth());
      } catch (e) {
        res.status(500).json({ error: 'health_collect_failed', message: String(e?.message ?? e).slice(0, 200) });
      }
    });
  });
});

export default router;
