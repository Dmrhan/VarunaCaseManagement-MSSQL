/**
 * Actor identity helper — PR-1 Server-authoritative actor for critical case flows.
 *
 * Audit (2026-06-17) sonrası: caseRepository.js içinde 13+ method
 * "?? 'Mock User'" pattern'iyle çalışıyordu. Body'den createdBy/uploadedBy/
 * callerId/actor alıp spoof riski oluşturuyordu. Bu helper, kritik write
 * path'lerin daima req.user'dan server-authoritative actor stamp atmasını
 * sağlar.
 *
 * Sözleşme:
 *   - requireActor(req)          → ActorContext veya throw (401)
 *   - getActorDisplayName(user)  → fullName → email → null (audit string)
 *   - buildActorContext(user)    → user'dan ActorContext (cron için req'siz)
 *
 * ActorContext shape:
 *   {
 *     userId: string,           // req.user.id (zorunlu, asla null)
 *     personId: string | null,  // SystemAdmin/Backoffice'te null
 *     fullName: string | null,
 *     email: string | null,
 *     role: string | null,
 *     displayName: string,      // audit trail için: fullName veya email veya userId
 *   }
 *
 * Kritik kural: displayName ASLA 'Mock User' veya 'mock-user' döndürmez.
 * req.user.id varsa en az userId fallback'i ile bir string döner.
 *
 * Cron / system paths bu helper'ı KULLANMAZ — kendi 'system' / `user:${id}`
 * convention'ı korunur.
 */

export class ActorRequiredError extends Error {
  constructor(message = 'unauthenticated') {
    super(message);
    this.name = 'ActorRequiredError';
    this.status = 401;
  }
}

/**
 * req.user kontrolü ve ActorContext döndürür.
 *
 * verifyJwt middleware'i req.user'ı yerleştiriyor. Bu helper, route handler'da
 * her DB write'tan önce çağrılmalı — eksik auth durumunda 401 fırlatır
 * (route'taki asyncRoute wrapper'ı bunu JSON 401'e çevirir).
 *
 * @throws {ActorRequiredError} req.user.id yoksa
 */
export function requireActor(req) {
  const user = req && typeof req === 'object' ? req.user : null;
  if (!user || typeof user !== 'object' || typeof user.id !== 'string' || user.id.length === 0) {
    throw new ActorRequiredError();
  }
  return buildActorContext(user);
}

/**
 * User objesinden display name (audit trail string'i) türetir.
 *
 * Öncelik:
 *   1) fullName (trim edilmiş, boş değilse)
 *   2) email (trim edilmiş, boş değilse)
 *   3) user.id (son çare; asla null/undefined döndürmez)
 *
 * Bu sıralama: human-readable bir şeyi öne çıkar. UI label'ı olarak
 * fullName her zaman daha iyi; email ikinci tercih (e-posta ile login yapan
 * SystemAdmin'in fullName'i olabilir veya olmayabilir); userId sondaki
 * defansif fallback.
 */
export function getActorDisplayName(user) {
  if (!user || typeof user !== 'object') return null;
  if (typeof user.fullName === 'string') {
    const trimmed = user.fullName.trim();
    if (trimmed.length > 0) return trimmed;
  }
  if (typeof user.email === 'string') {
    const trimmed = user.email.trim();
    if (trimmed.length > 0) return trimmed;
  }
  if (typeof user.id === 'string' && user.id.length > 0) return user.id;
  return null;
}

/**
 * User objesinden ActorContext oluştur. Cron / job / job-context için
 * (req olmadan) kullanılabilir; oradaki user objesi DB'den yüklenir.
 *
 * Live request akışında requireActor() tercih edilmelidir — 401 garantili.
 */
export function buildActorContext(user) {
  if (!user || typeof user !== 'object') {
    throw new ActorRequiredError('actor context: invalid user');
  }
  const userId = typeof user.id === 'string' ? user.id : null;
  if (!userId) {
    throw new ActorRequiredError('actor context: missing user id');
  }
  return {
    userId,
    personId: typeof user.personId === 'string' ? user.personId : null,
    fullName: typeof user.fullName === 'string' ? user.fullName : null,
    email: typeof user.email === 'string' ? user.email : null,
    role: typeof user.role === 'string' ? user.role : null,
    displayName: getActorDisplayName(user) ?? userId,
  };
}

/**
 * PR-3 — Repository write path'leri için shared defansif throw helper.
 *
 * caseRepository içindeki assertActor ile aynı semantik — paylaşımlı export.
 * Object actor (ActorContext) bekler; userId zorunlu. Mock User sentinel'leri
 * displayName'de reddedilir.
 */
const MOCK_USER_SENTINELS = new Set(['Mock User', 'mock-user', 'mock_user', '']);

export function assertActorObject(actor, where) {
  if (
    !actor ||
    typeof actor !== 'object' ||
    typeof actor.userId !== 'string' ||
    actor.userId.length === 0 ||
    typeof actor.displayName !== 'string' ||
    actor.displayName.length === 0 ||
    MOCK_USER_SENTINELS.has(actor.displayName)
  ) {
    throw new ActorRequiredError(
      `${where}: actor context required (userId + displayName); see server/lib/actor.js requireActor`,
    );
  }
}

// __internal: smoke test için string constant'ları paylaş
export const __internal = {
  ActorRequiredError,
  MOCK_USER_SENTINELS,
};
