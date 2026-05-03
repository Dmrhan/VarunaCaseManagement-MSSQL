import { createClient } from '@supabase/supabase-js';
import { prisma } from './client.js';
import { withDbRetry } from './retry.js';

/**
 * BFF auth — Supabase JWT doğrulama + DB'deki User satırına çözümleme.
 *
 * Frontend her isteğe `Authorization: Bearer <access_token>` ekler.
 * verifyJwt middleware token'ı Supabase'e doğrulatır, sonra DB'den User'ı
 * çekip `req.user`'a koyar. requireRole(...roles) bunun üstüne katlanır.
 *
 * MSSQL geçişinde: Supabase Auth yerine başka IdP gelirse, sadece
 * verifyJwt değişir; route handler'lar req.user shape'ini görmeye devam eder.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY .env\'de yok.');
  }
  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return _client;
}

/**
 * Express middleware — Bearer token okur, Supabase'e doğrulatır,
 * DB'den User satırını çekip req.user'a koyar.
 *
 * 401: token yok/geçersiz/expired
 * 403: token geçerli ama User tablosunda kayıt yok ya da isActive=false
 */
export async function verifyJwt(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const m = /^Bearer (.+)$/i.exec(auth);
    if (!m) {
      return res.status(401).json({ error: 'unauthenticated', message: 'Giriş gerekli.' });
    }
    const token = m[1];

    const sb = getClient();
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'invalid_token', message: 'Oturum geçersiz, tekrar giriş yap.' });
    }

    // Geçici pooler aksaklıklarında 1x retry (300ms). User lookup idempotent.
    let user = await withDbRetry(
      () => prisma.user.findUnique({ where: { id: data.user.id } }),
      { retries: 1, delayMs: 300, label: 'auth' },
    );

    // Auto-provision: Supabase Auth (örn. Google OAuth) ile ilk kez giren
    // kullanıcı için DB'de User satırı yoksa default Agent rolüyle oluştur.
    // Person bridging: aynı e-posta ile Person varsa otomatik bağla — Inbox
    // "Later", "Atandıklarım" gibi me-filter akışları için gerekli. Eşleşme
    // yoksa personId null kalır (kullanıcı admin tarafından sonradan bağlanır).
    // Production'da: domain whitelist (örn. @univera.com.tr) burada uygulanır.
    if (!user) {
      const fullName =
        data.user.user_metadata?.full_name ??
        data.user.user_metadata?.fullName ??
        data.user.user_metadata?.name ??
        data.user.email?.split('@')[0] ??
        'Yeni Kullanıcı';
      let matchedPersonId = null;
      if (data.user.email) {
        const person = await prisma.person.findFirst({
          where: { email: data.user.email, isActive: true },
          select: { id: true },
        });
        matchedPersonId = person?.id ?? null;
      }
      try {
        user = await prisma.user.create({
          data: {
            id: data.user.id,
            email: data.user.email ?? '',
            fullName,
            role: 'Agent',
            isActive: true,
            personId: matchedPersonId,
          },
        });
        console.log(
          `[auth] Auto-provisioned: ${user.email} (Agent)` +
            (matchedPersonId ? ` → Person ${matchedPersonId}` : ' [no Person match]'),
        );
      } catch (err) {
        console.error('[auth] auto-provision failed', err);
        return res.status(500).json({
          error: 'provision_failed',
          message: 'Hesap kaydı oluşturulamadı.',
        });
      }
    }

    if (!user.isActive) {
      return res.status(403).json({
        error: 'inactive',
        message: 'Hesabınız pasif. Yöneticinize başvurun.',
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('[auth] verifyJwt', err);
    res.status(500).json({ error: 'auth_error', message: 'Yetkilendirme hatası.' });
  }
}

/**
 * verifyJwt'den sonra zincirlenir. İzinli rollerden değilse 403.
 *
 * Örn: router.post('/admin/x', verifyJwt, requireRole('Admin'), handler)
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'unauthenticated', message: 'Giriş gerekli.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'forbidden',
        message: `Bu işlem için yetkiniz yok (gerekli rol: ${roles.join(' / ')}).`,
      });
    }
    next();
  };
}

/** Sadece auth kontrolü, rol fark etmez. */
export const requireAuth = verifyJwt;
