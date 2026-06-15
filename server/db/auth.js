import { prisma } from './client.js';
import { withDbRetry } from './retry.js';
import { verifyAccessToken } from '../lib/authTokens.js';

/**
 * BFF auth — local JWT doğrulama + DB'deki User satırına çözümleme (Faz 3).
 *
 * Frontend her isteğe `Authorization: Bearer <access_token>` ekler.
 * verifyJwt middleware token imzasını lokal doğrular (JWT_SECRET), sonra
 * DB'den User'ı çekip `req.user`'a koyar. requireRole(...roles) bunun
 * üstüne katlanır.
 *
 * Supabase dönemine göre değişenler:
 *  - Token Supabase API'ye sorulmaz; HS256 imza lokal doğrulanır.
 *  - OAuth auto-provision yok — kullanıcılar yalnız admin panelinden açılır.
 *  - req.user shape'i AYNEN korunur (+ mustChangePassword eklendi);
 *    allowedCompanyIds / companyRoles / isActive bariyeri değişmedi.
 */

/**
 * Express middleware — Bearer token okur, lokal doğrular,
 * DB'den User satırını çekip req.user'a koyar.
 *
 * 401: token yok/geçersiz/expired veya kullanıcı silinmiş
 * 403: token geçerli ama isActive=false
 */
export async function verifyJwt(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const m = /^Bearer (.+)$/i.exec(auth);
    if (!m) {
      return res.status(401).json({ error: 'unauthenticated', message: 'Giriş gerekli.' });
    }

    const payload = verifyAccessToken(m[1]);
    if (!payload?.sub) {
      return res.status(401).json({ error: 'invalid_token', message: 'Oturum geçersiz, tekrar giriş yap.' });
    }

    // Geçici DB aksaklıklarında 1x retry (300ms). User lookup idempotent.
    const user = await withDbRetry(
      () => prisma.user.findUnique({ where: { id: payload.sub } }),
      { retries: 1, delayMs: 300, label: 'auth' },
    );
    if (!user) {
      return res.status(401).json({ error: 'invalid_token', message: 'Oturum geçersiz, tekrar giriş yap.' });
    }

    if (!user.isActive) {
      return res.status(403).json({
        error: 'inactive',
        message: 'Hesabınız pasif. Yöneticinize başvurun.',
      });
    }

    // Multi-tenant izolasyon (Phase 2):
    //  - allowedCompanyIds: tüm liste sorguları bu set ile filtrelenir.
    //  - companyRoles: per-company yetki kararları (admin endpoint'leri için).
    //  - SystemAdmin: UserCompany kaydı olmasa bile tüm aktif şirketlere erişir
    //    (yeni şirket eklenince otomatik kapsanır — UserCompany seed gerekmez).
    let allowedCompanyIds;
    let companyRoles;
    if (user.role === 'SystemAdmin') {
      const all = await prisma.company.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      allowedCompanyIds = all.map((c) => c.id);
      companyRoles = allowedCompanyIds.map((companyId) => ({ companyId, role: 'SystemAdmin' }));
    } else {
      const links = await prisma.userCompany.findMany({
        where: { userId: user.id, isActive: true },
        select: { companyId: true, role: true },
      });
      allowedCompanyIds = links.map((l) => l.companyId);
      companyRoles = links;
    }

    // passwordHash'i req.user'a TAŞIMA — route handler'lara sızmasın.
    const { passwordHash: _ph, ...safeUser } = user;
    req.user = { ...safeUser, allowedCompanyIds, companyRoles };
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
