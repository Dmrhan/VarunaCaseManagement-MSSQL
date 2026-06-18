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
 * Codex P2 #2 fix — `dateTo` end-of-day normalize:
 *
 * UI date input'u 'YYYY-MM-DD' formatında gönderir. `new Date('YYYY-MM-DD')`
 * UTC midnight üretir; `lte: midnight` kullanılırsa o günkü (kullanıcının
 * "kapsasın" dediği gün) tüm vakalar drop edilir.
 *
 * Çözüm: `endOfDay=true` ile çağrı geldiğinde:
 *   - Sadece tarih (YYYY-MM-DD) ise: aynı günün 23:59:59.999 UTC noktasına çek
 *   - Saat içeren ISO ise (kullanıcı zaten saati seçmişse): dokunma
 *
 * `dateFrom` için inclusive midnight start zaten doğru (gte) — onu bozmuyoruz.
 */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(v, { endOfDay = false } = {}) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  const isDateOnly = DATE_ONLY_RE.test(trimmed);
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay && isDateOnly) {
    d.setUTCHours(23, 59, 59, 999);
  }
  return d;
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
