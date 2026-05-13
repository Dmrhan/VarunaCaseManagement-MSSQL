import crypto from 'node:crypto';

/**
 * Operations Intelligence — Scope Derivation (Phase 1)
 *
 * docs/OPERATIONS_DASHBOARD_DESIGN.md §2.2A
 *
 * **Mimari ilke:** Server her zaman scope'u req.user'dan turetir.
 * Body'deki filter alanlari sadece **scope icinde daraltma** yapar —
 * scope'u genisletemez. Frontend filter tenant scope icin asla otoriter
 * degildir.
 *
 * Phase 1 karar (kullanici onayli): Mevcut roller kullanilir;
 * CSLeadership/ProductManager/CustomerSuccessLead enum'a EKLENMEZ.
 *
 * Rol -> default scope:
 *   - Agent / Backoffice / CSM -> self (kendi atandigi vakalar)
 *   - Supervisor               -> company-level team analytics
 *                                  (allowedCompanyIds'deki tum takimlar)
 *   - Admin                    -> company-level (allowedCompanyIds)
 *   - SystemAdmin              -> cross-company (tum aktif sirketler)
 */

export const FORMULA_VERSION = 'v1';

/**
 * Bir scope objesi:
 * {
 *   scopeKind:           'self' | 'team' | 'company' | 'cross-company',
 *   companyIds:          string[],
 *   teamIds:             string[] | null,
 *   personIds:           string[] | null,
 *   canExport:           boolean,
 *   canCrossCompanyAgg:  boolean,
 *   narrowedFromBody:    boolean,
 *   effectiveScopeReason: string,
 * }
 */

/**
 * Derive analytics scope from req.user + body.
 *
 * @param {object} user - req.user (verifyJwt cikisi)
 *   { id, role, allowedCompanyIds, personId }
 * @param {object} body - request body (companies, teams gibi alanlari icerebilir)
 * @returns {object} scope objesi (yukarida)
 */
export function deriveAnalyticsScope(user, body = {}) {
  if (!user || !user.role) {
    throw new Error('deriveAnalyticsScope: req.user.role required');
  }

  const allowed = Array.isArray(user.allowedCompanyIds) ? user.allowedCompanyIds : [];
  if (allowed.length === 0 && user.role !== 'SystemAdmin') {
    // Kullanicinin hic yetkili sirketi yok -> empty scope (UI empty state gosterir)
    return {
      scopeKind: 'company',
      companyIds: [],
      teamIds: null,
      personIds: null,
      canExport: false,
      canCrossCompanyAgg: false,
      narrowedFromBody: false,
      effectiveScopeReason: 'no-allowed-companies',
    };
  }

  const role = user.role;

  // --- Agent / Backoffice / CSM: self scope ---
  if (role === 'Agent' || role === 'Backoffice' || role === 'CSM') {
    if (!user.personId) {
      // Person'a bagli olmayan agent -> dashboard'da hicbir sey gosterilemez
      return {
        scopeKind: 'self',
        companyIds: allowed.slice(0, 1), // sembolik
        teamIds: null,
        personIds: [], // empty -> aggregator sonuc bulamaz
        canExport: false,
        canCrossCompanyAgg: false,
        narrowedFromBody: false,
        effectiveScopeReason: 'agent-no-personId',
      };
    }
    return {
      scopeKind: 'self',
      companyIds: allowed,
      teamIds: null,
      personIds: [user.personId],
      canExport: false,
      canCrossCompanyAgg: false,
      narrowedFromBody: false,
      effectiveScopeReason: 'self',
    };
  }

  // --- SystemAdmin: cross-company ---
  if (role === 'SystemAdmin') {
    // Body'de istense de istenmese de SystemAdmin tum sirketleri gorur.
    // Body.companies daraltabilir (kullanici PARAM'a odaklanmak isteyebilir)
    // ama allowedCompanyIds'in disinda bir sey eklenemez.
    const requested = sanitizeIdList(body.companies);
    const companyIds = requested && requested.length > 0
      ? requested.filter((id) => allowed.includes(id))
      : allowed;
    const narrowed = !!(requested && requested.length > 0 && companyIds.length < requested.length);
    return {
      scopeKind: 'cross-company',
      companyIds,
      teamIds: sanitizeIdList(body.teams),
      personIds: null,
      canExport: true,
      canCrossCompanyAgg: true,
      narrowedFromBody: narrowed,
      effectiveScopeReason: 'systemadmin',
    };
  }

  // --- Admin: company-level (allowed icerisinde body ile daraltma) ---
  if (role === 'Admin') {
    const requested = sanitizeIdList(body.companies);
    const companyIds = requested && requested.length > 0
      ? requested.filter((id) => allowed.includes(id))
      : allowed;
    const narrowed = !!(requested && requested.length > 0 && companyIds.length < requested.length);
    return {
      scopeKind: 'company',
      companyIds,
      teamIds: sanitizeIdList(body.teams),
      personIds: null,
      canExport: true,
      canCrossCompanyAgg: false,
      narrowedFromBody: narrowed,
      effectiveScopeReason: 'admin-company',
    };
  }

  // --- Supervisor: company-level team analytics (broad rule, Phase 1) ---
  // Karar (Phase 1): Supervisor allowedCompanyIds'deki tum takimlari gorur.
  // Precise "supervisor -> yonettigi takim" eslemesi Phase 5+'da
  // Person/Team.supervisorId migration ile gelir.
  if (role === 'Supervisor') {
    const requested = sanitizeIdList(body.companies);
    const companyIds = requested && requested.length > 0
      ? requested.filter((id) => allowed.includes(id))
      : allowed;
    const narrowed = !!(requested && requested.length > 0 && companyIds.length < requested.length);
    return {
      scopeKind: 'team',
      companyIds,
      // teamIds null -> tum takimlar (broad rule); body.teams ile daraltabilir
      teamIds: sanitizeIdList(body.teams),
      personIds: null,
      canExport: false, // Phase 1: Supervisor export hakki yok
      canCrossCompanyAgg: false,
      narrowedFromBody: narrowed,
      effectiveScopeReason: 'supervisor-broad-company',
    };
  }

  // Fallback: bilinmeyen rol -> hicbir sey
  return {
    scopeKind: 'self',
    companyIds: [],
    teamIds: null,
    personIds: [],
    canExport: false,
    canCrossCompanyAgg: false,
    narrowedFromBody: false,
    effectiveScopeReason: 'unknown-role',
  };
}

/**
 * Scope narrative — UI uzerinde "Kapsam: PARAM · Destek Takimi" rozeti icin.
 */
export function describeScope(scope, lookups = {}) {
  // lookups: { companies: { [id]: name }, teams: { [id]: name } }
  const companyNames = scope.companyIds
    .map((id) => lookups.companies?.[id] ?? id)
    .join(', ');
  const teamNames = scope.teamIds && scope.teamIds.length > 0
    ? scope.teamIds.map((id) => lookups.teams?.[id] ?? id).join(', ')
    : null;

  switch (scope.scopeKind) {
    case 'self':
      return 'Kendi vakalarim';
    case 'team':
      return teamNames
        ? `${teamNames} (${companyNames})`
        : `Tum takimlar (${companyNames})`;
    case 'company':
      return companyNames || 'Yetki yok';
    case 'cross-company':
      return scope.companyIds.length === 0
        ? 'Tum aktif sirketler'
        : companyNames;
    default:
      return 'Bilinmeyen kapsam';
  }
}

/**
 * Scope fingerprint — MetricQueryAudit + cache key icin.
 * Stable hash; ayni scope ayni hash.
 */
export function scopeFingerprint(scope) {
  const payload = JSON.stringify({
    kind: scope.scopeKind,
    companies: [...(scope.companyIds ?? [])].sort(),
    teams: scope.teamIds ? [...scope.teamIds].sort() : null,
    persons: scope.personIds ? [...scope.personIds].sort() : null,
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Filter fingerprint — appliedFilters'i hash'ler. Cache key.
 */
export function filterFingerprint(filters) {
  const normalized = {
    from: filters.from ?? null,
    to: filters.to ?? null,
    companies: filters.companies ? [...filters.companies].sort() : null,
    teams: filters.teams ? [...filters.teams].sort() : null,
    productGroups: filters.productGroups ? [...filters.productGroups].sort() : null,
    caseTypes: filters.caseTypes ? [...filters.caseTypes].sort() : null,
    statuses: filters.statuses ? [...filters.statuses].sort() : null,
    granularity: filters.granularity ?? 'day',
    bucket: filters.bucket ?? null,
    page: filters.page ?? null,
    pageSize: filters.pageSize ?? null,
    sortBy: filters.sortBy ?? null,
    sortDir: filters.sortDir ?? null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 16);
}

// ---------- yardimcilar ----------

function sanitizeIdList(value) {
  if (!Array.isArray(value)) return null;
  const clean = value
    .filter((id) => typeof id === 'string' && id.length > 0)
    .slice(0, 100); // panic cap
  return clean.length > 0 ? clean : null;
}
