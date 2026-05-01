import { Router } from 'express';
import { verifyJwt } from '../db/auth.js';

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
  });
});

export default router;
