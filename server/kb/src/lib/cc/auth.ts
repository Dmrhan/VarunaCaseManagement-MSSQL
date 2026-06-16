/*
 * CC auth — iron-session cookie + server-side session table.
 *
 * iron-session imzalı bir cookie tutar; içinde `sid` (server-side session
 * token) yer alır. Her istekte:
 *   1) cookie parse edilir
 *   2) sid → hash → cc_sessions tablosundan user_id alınır
 *   3) cc_users.active = 1 doğrulanır
 *   4) Kullanıcı request handler'a aktarılır
 *
 * Bu sayede logout/deactivate anında işler (cookie iptali için DB silinir).
 */

import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import bcrypt from "bcryptjs";
import { env } from "../env";
import {
  createSession,
  deleteSession,
  getSession,
  getUserById,
  purgeExpiredSessions,
  type CcRole,
  type CcUser,
} from "./db";

type CookiePayload = {
  sid?: string;
};

function sessionOptions(): SessionOptions {
  const cfg = env();
  return {
    cookieName: cfg.CC_SESSION_COOKIE_NAME,
    password: cfg.CC_SESSION_SECRET,
    cookieOptions: {
      // HTTP/LAN dağıtımında (HTTPS yok) secure çerez tarayıcıda saklanmaz.
      // CC_COOKIE_SECURE=false ile kapatılabilir; HTTPS eklenince true yapın (veya env'i kaldırın).
      secure:
        process.env.NODE_ENV === "production" &&
        process.env.CC_COOKIE_SECURE !== "false",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: cfg.CC_SESSION_TTL_SECONDS,
    },
  };
}

async function getCookieSession(): Promise<{
  data: CookiePayload;
  save: () => Promise<void>;
  destroy: () => Promise<void>;
}> {
  const cookieStore = await cookies();
  const session = await getIronSession<CookiePayload>(
    cookieStore,
    sessionOptions(),
  );
  return {
    data: session,
    save: async () => session.save(),
    destroy: async () => session.destroy(),
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Login: parola doğrulandıktan sonra çağrılır. Server-side session yaratır,
 * cookie'ye sid yazar.
 */
export async function startSession(
  userId: number,
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<void> {
  // Eski session'ları temizle (sadece expired olanlar; aktif diğer cihazları
  // koru).
  purgeExpiredSessions();

  const token = randomBytes(32).toString("hex");
  const token_hash = hashToken(token);

  const ttlMs = env().CC_SESSION_TTL_SECONDS * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  createSession({
    token_hash,
    user_id: userId,
    expires_at: expiresAt,
    user_agent: meta?.userAgent ?? null,
    ip: meta?.ip ?? null,
  });

  const cookieSession = await getCookieSession();
  cookieSession.data.sid = token;
  await cookieSession.save();
}

/**
 * Logout: server-side session'ı sil, cookie'yi düş.
 */
export async function endSession(): Promise<void> {
  const cookieSession = await getCookieSession();
  const sid = cookieSession.data.sid;
  if (sid) deleteSession(hashToken(sid));
  await cookieSession.destroy();
}

/**
 * Mevcut isteğin kullanıcısını döndür; auth yoksa null.
 */
export async function currentUser(): Promise<CcUser | null> {
  const cookieSession = await getCookieSession();
  const sid = cookieSession.data.sid;
  if (!sid) return null;

  const sess = getSession(hashToken(sid));
  if (!sess) return null;
  if (new Date(sess.expires_at) <= new Date()) {
    // Süresi geçmiş — temizle
    deleteSession(hashToken(sid));
    return null;
  }
  const user = getUserById(sess.user_id);
  if (!user || user.active !== 1) return null;
  return user;
}

/**
 * Route handler'larında kullanmak için: kullanıcı yoksa hata fırlat.
 * API route'larında yakalanıp 401 dönüşür.
 */
export class UnauthorizedError extends Error {
  constructor(msg = "Yetkisiz erişim — login gerekli.") {
    super(msg);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(msg = "Bu işlem için yetkiniz yok.") {
    super(msg);
    this.name = "ForbiddenError";
  }
}

export async function requireUser(): Promise<CcUser> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requireRole(roles: CcRole | CcRole[]): Promise<CcUser> {
  const user = await requireUser();
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(user.role)) {
    throw new ForbiddenError(
      `Bu işlem ${allowed.join("/")} rolü gerektirir, mevcut rol: ${user.role}.`,
    );
  }
  return user;
}

export async function requireSuperAdmin(): Promise<CcUser> {
  return requireRole("super_admin");
}

// ─── Role helpers ─────────────────────────────────────────────────────────

/** Bir rolün L1 takımına dahil olup olmadığı. */
export function isL1Role(role: CcRole): boolean {
  return role === "L1_agent" || role === "L1_lead";
}

/** Bir rolün L2 takımına dahil olup olmadığı. */
export function isL2Role(role: CcRole): boolean {
  return role === "L2_agent" || role === "L2_lead";
}

/** Lead role'ler (kendi takımının tüm queue'sunu görebilen). */
export function isLeadRole(role: CcRole): boolean {
  return role === "L1_lead" || role === "L2_lead" || role === "super_admin";
}
