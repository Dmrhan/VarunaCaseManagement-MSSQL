import { Router } from 'express';
import { verifyJwt, getSupabaseAdminClient } from '../db/auth.js';

const router = Router();

/**
 * GET /api/auth/me
 * Authorization: Bearer <token>
 *
 * Frontend AuthContext bunu çağırır → kullanıcı + rol bilgisini alır.
 */
router.get('/me', verifyJwt, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    fullName: req.user.fullName,
    role: req.user.role,
    isActive: req.user.isActive,
    personId: req.user.personId ?? null,
  });
});

// ----------------------------------------------------------------
// Forgot password — generic response + rate limit (Phase: password UX)
// ----------------------------------------------------------------

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// IP basina dakikada N istek — basit sliding window (in-memory)
// ai.js'deki rateLimit ile ayni desen. Multi-instance deploy'da best-effort;
// gercek koruma Supabase'in kendi rate-limit'idir.
const FORGOT_RATE_LIMIT_PER_MIN = 5;
const _ipBuckets = new Map();

function forgotRateLimit(req, res, next) {
  const ip = req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';
  const now = Date.now();
  const windowStart = now - 60_000;
  const bucket = (_ipBuckets.get(ip) ?? []).filter((t) => t > windowStart);
  if (bucket.length >= FORGOT_RATE_LIMIT_PER_MIN) {
    // Generic response — IP rate limit'inde bile account enumeration acmiyoruz.
    return res.status(429).json({
      success: false,
      message: 'Çok fazla istek. Lütfen birkaç dakika sonra tekrar dene.',
    });
  }
  bucket.push(now);
  _ipBuckets.set(ip, bucket);
  next();
}

/**
 * POST /api/auth/forgot-password
 *
 * Body: { email: string }
 *
 * Davranis:
 *  - Validate email format
 *  - Generic success doner — kullanici varligi acigi YAPMAZ
 *  - Supabase resetPasswordForEmail cagrisi (redirectTo prod URL)
 *  - Supabase hata verirse server-side log + yine generic success
 *  - IP basina dakikada 5 istek limit
 *
 * Security:
 *  - No account enumeration
 *  - No raw Supabase error to client
 *  - No service role key exposed (server-side only via getSupabaseAdminClient)
 *  - No passwords/tokens logged
 *
 * Kullanim: anonim — verifyJwt YOK.
 */
router.post('/forgot-password', forgotRateLimit, async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!email || !EMAIL_RX.test(email)) {
    // Validation hatasinda da generic doner (account enumeration korumasi
    // gereksiz olsa da tutarli davranis icin).
    return res.status(200).json({
      success: true,
      message: 'Eğer bu e-posta sistemde kayıtlıysa, şifre yenileme bağlantısı gönderildi.',
    });
  }

  // Supabase recovery mail (Supabase user yoksa kendisi sessizce no-op yapar;
  // bu zaten istedigimiz davranis — kullanici varligini sizdirmaz).
  try {
    const sb = getSupabaseAdminClient();
    const redirectTo =
      process.env.SUPABASE_INVITE_REDIRECT_URL ||
      process.env.APP_URL ||
      'http://localhost:5273';
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      // Server-side log — guvenli (email + status code; password/token yok)
      console.warn(
        `[forgot-password] Supabase resetPasswordForEmail hata (kullaniciya gosterilmedi):`,
        { email, status: error.status ?? null, message: error.message?.slice(0, 200) ?? null },
      );
      // Yine de generic success doneriz — account enumeration korumasi
    }
  } catch (err) {
    console.error('[forgot-password] beklenmeyen hata:', err?.message ?? err);
    // Halen generic success — kullaniciya internal error gostermeyiz
  }

  return res.json({
    success: true,
    message: 'Eğer bu e-posta sistemde kayıtlıysa, şifre yenileme bağlantısı gönderildi.',
  });
});

export default router;
