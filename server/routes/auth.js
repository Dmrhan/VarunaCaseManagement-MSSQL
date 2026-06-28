import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { verifyJwt } from '../db/auth.js';
import { prisma } from '../db/client.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../lib/authTokens.js';

const router = Router();

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// IP basina dakikada N login denemesi — basit sliding window (in-memory).
// Multi-instance deploy'da best-effort; on-prem tek instance icin yeterli.
const LOGIN_RATE_LIMIT_PER_MIN = 10;
const _ipBuckets = new Map();

function loginRateLimit(req, res, next) {
  const ip = req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';
  const now = Date.now();
  const windowStart = now - 60_000;
  const bucket = (_ipBuckets.get(ip) ?? []).filter((t) => t > windowStart);
  if (bucket.length >= LOGIN_RATE_LIMIT_PER_MIN) {
    return res.status(429).json({
      error: 'rate_limited',
      message: 'Çok fazla deneme. Lütfen birkaç dakika sonra tekrar dene.',
    });
  }
  bucket.push(now);
  _ipBuckets.set(ip, bucket);
  next();
}

function userPayload(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    isActive: user.isActive,
    personId: user.personId ?? null,
    mustChangePassword: user.mustChangePassword ?? false,
  };
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 *
 * Başarıda: { accessToken, refreshToken, user }
 * Hatalı e-posta/şifre ayrımı yapılmaz (account enumeration koruması) — 401.
 */
router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!email || !EMAIL_RX.test(email) || !password) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'E-posta veya şifre hatalı.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // passwordHash yoksa (şifre hiç atanmamış) login mümkün değil — aynı generic 401.
    if (!user?.passwordHash) {
      // Timing farkını kapatmak için dummy compare
      await bcrypt.compare(password, '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7ZbRBQ0NQ4u0aXyU3a6S1n6c6dG0q1u');
      return res.status(401).json({ error: 'invalid_credentials', message: 'E-posta veya şifre hatalı.' });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'E-posta veya şifre hatalı.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ error: 'inactive', message: 'Hesabınız pasif. Yöneticinize başvurun.' });
    }

    return res.json({
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken(user),
      user: userPayload(user),
    });
  } catch (err) {
    console.error('[auth] login', err);
    return res.status(500).json({ error: 'auth_error', message: 'Giriş sırasında hata oluştu.' });
  }
});

/**
 * POST /api/auth/refresh
 * Body: { refreshToken }
 *
 * Geçerli refresh token → yeni access + refresh (sliding expiry).
 * isActive bariyeri burada da uygulanır.
 */
router.post('/refresh', async (req, res) => {
  try {
    const payload = verifyRefreshToken(String(req.body?.refreshToken ?? ''));
    if (!payload?.sub) {
      return res.status(401).json({ error: 'invalid_token', message: 'Oturum geçersiz, tekrar giriş yap.' });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      return res.status(401).json({ error: 'invalid_token', message: 'Oturum geçersiz, tekrar giriş yap.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ error: 'inactive', message: 'Hesabınız pasif. Yöneticinize başvurun.' });
    }
    return res.json({
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken(user),
      user: userPayload(user),
    });
  } catch (err) {
    console.error('[auth] refresh', err);
    return res.status(500).json({ error: 'auth_error', message: 'Oturum yenilenemedi.' });
  }
});

/**
 * POST /api/auth/logout
 *
 * Stateless JWT — sunucuda saklanan oturum yok; client token'ları siler.
 * Endpoint, frontend akışının simetrisi için var (ve ileride token
 * blacklist'i eklenirse yeri hazır).
 */
router.post('/logout', (_req, res) => {
  res.status(204).end();
});

/**
 * GET /api/auth/me
 * Authorization: Bearer <token>
 *
 * Frontend AuthContext bunu çağırır → kullanıcı + rol bilgisini alır.
 */
router.get('/me', verifyJwt, (req, res) => {
  res.json(userPayload(req.user));
});

/**
 * Mail M6.3b Faz 2 — Per-agent imza self-service endpoint'leri.
 *
 *  GET   /api/auth/me/signature     → { signatureHtml: string | null }
 *  PATCH /api/auth/me/signature     → body { signatureHtml: string | null }
 *
 * Guard:
 *  - verifyJwt (kardeş /me ile parite)
 *  - actor = req.user (self-service; admin başkasının imzasını
 *    değiştiremez; admin profil endpoint'i ileride ayrı eklenir)
 *
 * Save öncesi:
 *  - sanitize-html allowlist (M6.1 deseni — sanitizeOutgoingEmailHtml).
 *    XSS engelleme + tutarlı render path.
 *  - null/empty → signatureHtml=NULL set (kaldır).
 *
 * Response: güncel signatureHtml + sade payload (token rotate YOK —
 * password change'den farklı).
 */
router.get('/me/signature', verifyJwt, async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { signatureHtml: true },
  });
  res.json({ signatureHtml: u?.signatureHtml ?? null });
});

router.patch('/me/signature', verifyJwt, async (req, res) => {
  const raw = req.body?.signatureHtml;
  let next = null;
  if (typeof raw === 'string' && raw.trim()) {
    const { sanitizeOutgoingEmailHtml } = await import('../lib/htmlSanitizer.js');
    next = sanitizeOutgoingEmailHtml(raw);
  }
  await prisma.user.update({
    where: { id: req.user.id },
    data: { signatureHtml: next },
  });
  res.json({ signatureHtml: next });
});

/**
 * POST /api/auth/change-password (auth gerekli)
 * Body: { currentPassword, newPassword }
 *
 * Kullanıcının kendi şifresini değiştirmesi (ayarlar ekranı + admin'in
 * atadığı geçici şifre sonrası zorunlu değişim). Başarıda mustChangePassword
 * temizlenir ve YENİ token çifti döner (eski token'lar da geçerli kalır —
 * stateless; UI yenilerini saklar).
 */
router.post('/change-password', verifyJwt, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: 'weak_password',
        message: `Yeni şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`,
      });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({
        error: 'same_password',
        message: 'Yeni şifre mevcut şifreyle aynı olamaz.',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.passwordHash) {
      return res.status(400).json({ error: 'no_password', message: 'Hesapta şifre tanımlı değil. Yöneticinize başvurun.' });
    }
    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Mevcut şifre hatalı.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, passwordUpdatedAt: new Date() },
    });

    return res.json({
      success: true,
      message: 'Şifre güncellendi.',
      accessToken: signAccessToken(updated),
      refreshToken: signRefreshToken(updated),
      user: userPayload(updated),
    });
  } catch (err) {
    console.error('[auth] change-password', err);
    return res.status(500).json({ error: 'auth_error', message: 'Şifre güncellenemedi.' });
  }
});

/**
 * POST /api/auth/forgot-password
 *
 * On-prem kurulumda e-posta servisi yok — şifre sıfırlama admin panelinden
 * yapılır (admin yeni geçici şifre atar). Endpoint, eski UI çağrıları için
 * yönlendirici mesaj döner.
 */
router.post('/forgot-password', (_req, res) => {
  res.json({
    success: true,
    message: 'Şifre sıfırlama yöneticiniz tarafından yapılır. Lütfen sistem yöneticinize başvurun.',
  });
});

export default router;
