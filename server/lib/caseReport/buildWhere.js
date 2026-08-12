/**
 * Case Report Studio — filter input → Prisma where clause.
 *
 * Multi-tenant guard:
 *   - companyId scope HER ZAMAN req.user.allowedCompanyIds ile intersect edilir.
 *   - Caller (route handler) allowedCompanyIds'i parametre olarak verir;
 *     buildReportWhere onsuz çağrılamaz.
 *   - Kullanıcı filters.companyIds gönderirse o set allowedCompanyIds ile
 *     intersect edilir; sonuç boşsa where 'imkansız bir koşul' (id: -1)
 *     ile döndürülür → hiç satır dönmez (sızıntı yerine boş cevap).
 *
 * Phase 1 desteklenen filtreler (TASK kapsamı):
 *   - dateFrom / dateTo  → Case.createdAt aralığı
 *   - resolvedFrom / resolvedTo → Case.resolvedAt aralığı. P2 fix: resolvedAt
 *     terminal (Çözüldü/İptal) statüye girişte damgalanır AMA reopen'da
 *     TEMİZLENMEZ (caseRepository.js transitionStatus — prev.resolvedAt
 *     korunur). Yani reopen edilmiş, ŞU AN AÇIK bir vakada da eski
 *     resolvedAt dolu olabilir. Bu yüzden bu filtre uygulanınca
 *     where.status da otomatik terminal statüye kısıtlanır (kullanıcının
 *     kendi statü seçimiyle kesişir) — yoksa açık/reopen vakalar sızar.
 *   - companyIds         → CSV veya string[]
 *   - statuses           → CSV veya string[] (TR enum → DB ASCII conversion)
 *   - priorities         → CSV veya string[] (zaten ASCII; conversion yok)
 *   - assignedTeamId     → tek değer
 *   - assignedPersonId   → tek değer
 *   - search             → caseNumber / title / accountName OR (contains)
 *
 * Bilinmeyen filter key'leri sessizce yok sayılır — UI ve backend birbirinden
 * bağımsız evrilebilir.
 *
 * 2026-06-18 bug fix — Frontend CASE_STATUSES TR ('Açık', 'Çözüldü', vb.)
 * gönderiyor ama DB ASCII identifier'larda saklıyor ('Acik', 'Cozuldu').
 * Phase 1'den beri sessiz bug: status filter verildiğinde rapor BOŞ
 * dönüyordu (match yok). toDb({ status }) ile çevriliyor.
 */
import { toDb } from '../../db/enumMap.js';

function toArray(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.filter((s) => typeof s === 'string' && s.trim().length > 0);
  if (typeof v === 'string') {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return null;
}

/**
 * Codex P2 #2 fix — `dateTo` end-of-day normalize + P2 TR gün sınırı fix:
 *
 * UI date input'u 'YYYY-MM-DD' formatında gönderir. Rapor zaman damgaları
 * Europe/Istanbul'da (sabit UTC+3, DST yok) gösteriliyor — ama `new
 * Date('YYYY-MM-DD')` UTC gece yarısı üretir. Düz UTC sınırı kullanılırsa
 * gece yarısına yakın (00:00–02:59 TRT) vakalar yanlış tarafta kalır:
 *   - `dateFrom`/`resolvedFrom` (gte): TR gününün ilk 3 saati YANLIŞLIKLA
 *     dışlanır (UTC gece yarısı henüz TR'de bir önceki günün 03:00'ü).
 *   - `dateTo`/`resolvedTo` (lte): bir sonraki TR gününün ilk 3 saati
 *     YANLIŞLIKLA dahil edilir.
 *
 * Çözüm: sadece tarih (YYYY-MM-DD, saatsiz) girişte TR_OFFSET_MS ile TR
 * gün sınırına anlanır (server/lib/slaDashboardDateRange.js'teki aynı
 * desen). Saat içeren ISO girişte (kullanıcı zaten saati seçmişse): dokunma.
 */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

// P2 fix — resolvedFrom/resolvedTo yalnız bu statülerde "gerçek" çözüm
// zamanı anlamına gelir (server/analytics/slaDashboard.js'teki TERMINAL
// Set'in ikizi — caseRepository.js transitionStatus reopen'da resolvedAt'i
// TEMİZLEMİYOR, bu yüzden açık/reopen vakalarda da eski değer dolu kalabilir).
const TERMINAL_STATUSES = ['Cozuldu', 'IptalEdildi'];

function parseDate(v, { endOfDay = false } = {}) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  if (DATE_ONLY_RE.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    if (endOfDay) {
      // TR gününün SONU dahil → ertesi TR gününün gece yarısından 1ms önce.
      const nextDayStartMs = Date.UTC(year, month - 1, day + 1) - TR_OFFSET_MS;
      return new Date(nextDayStartMs - 1);
    }
    return new Date(Date.UTC(year, month - 1, day) - TR_OFFSET_MS);
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function intersectCompanyScope(filtersCompanyIds, allowedCompanyIds) {
  const allowed = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
  const req = toArray(filtersCompanyIds);
  if (!req || req.length === 0) {
    return { ids: allowed, valid: allowed.length > 0 };
  }
  const inter = req.filter((c) => allowed.includes(c));
  return { ids: inter, valid: inter.length > 0 };
}

/**
 * @param {object} filters
 * @param {string[]} allowedCompanyIds
 * @returns {{ where: object, scopeValid: boolean }}
 */
export function buildReportWhere(filters, allowedCompanyIds) {
  const f = filters && typeof filters === 'object' ? filters : {};
  const scope = intersectCompanyScope(f.companyIds, allowedCompanyIds);
  if (!scope.valid) {
    // Boş scope → imkansız koşul. id NEVER === '__impossible__' guarantees
    // 0 row. Daha temiz bir "where false" ifadesi Prisma sözleşmesinde yok.
    return { where: { id: '__impossible_company_scope__' }, scopeValid: false };
  }
  const where = { companyId: { in: scope.ids } };

  const statuses = toArray(f.statuses);
  if (statuses && statuses.length > 0) {
    // Bug fix 2026-06-18 — TR enum → DB ASCII (örn. 'Açık' → 'Acik').
    // Bilinmeyen değer toDb tarafından olduğu gibi geri döner; defansif
    // olarak null/undefined filtrele (eşleşmeyen kayıt zaten dönmez).
    const dbStatuses = statuses
      .map((s) => toDb({ status: s }).status)
      .filter((s) => typeof s === 'string' && s.length > 0);
    if (dbStatuses.length > 0) where.status = { in: dbStatuses };
  }

  const priorities = toArray(f.priorities);
  if (priorities && priorities.length > 0) where.priority = { in: priorities };

  if (typeof f.assignedTeamId === 'string' && f.assignedTeamId.trim()) {
    where.assignedTeamId = f.assignedTeamId.trim();
  }
  if (typeof f.assignedPersonId === 'string' && f.assignedPersonId.trim()) {
    where.assignedPersonId = f.assignedPersonId.trim();
  }

  const dateFrom = parseDate(f.dateFrom);
  const dateTo = parseDate(f.dateTo, { endOfDay: true });
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = dateFrom;
    if (dateTo) where.createdAt.lte = dateTo;
  }

  const resolvedFrom = parseDate(f.resolvedFrom);
  const resolvedTo = parseDate(f.resolvedTo, { endOfDay: true });
  if (resolvedFrom || resolvedTo) {
    where.resolvedAt = {};
    if (resolvedFrom) where.resolvedAt.gte = resolvedFrom;
    if (resolvedTo) where.resolvedAt.lte = resolvedTo;
    // P2 fix — reopen edilmiş (şu an AÇIK) bir vakada da eski resolvedAt
    // dolu kalabildiği için, statüyü terminal'e kısıtlamadan bu filtre
    // yanlışlıkla açık vakaları da döndürür. Kullanıcı zaten bir statü
    // filtresi seçtiyse (where.status set) TERMINAL_STATUSES ile kesişir;
    // hiç seçmediyse doğrudan TERMINAL_STATUSES uygulanır.
    where.status = where.status?.in
      ? { in: where.status.in.filter((s) => TERMINAL_STATUSES.includes(s)) }
      : { in: TERMINAL_STATUSES };
  }

  if (typeof f.search === 'string' && f.search.trim().length > 0) {
    const q = f.search.trim();
    where.OR = [
      { caseNumber: { contains: q } },
      { title: { contains: q } },
      { accountName: { contains: q } },
    ];
  }

  return { where, scopeValid: true };
}
