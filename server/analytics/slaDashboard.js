/**
 * slaDashboard.js — CS Yönetim Panosu (SLA İzleme) agregatörü. 2026-07-13
 *
 * n4b dönemindeki Power BI panosunun Varuna içi karşılığı: vaka-satırı
 * bazında çözüm + müdahale SLA hedef/geçen/kalan süreleri, türetilmiş
 * "Bekleyen Bölüm", KPI özetleri ve sunucu tarafı sayfalama.
 *
 * Tasarım kararları (kullanıcı onayları 2026-07-13):
 *  - "Proje" kolonu = Account (müşteri firması); ayrıca ŞİRKET (tenant)
 *    filtresi var — çok-şirket görenler (SystemAdmin vb.) ayrıştırabilsin.
 *  - Bekleyen Bölüm türetimi (öncelik sırası):
 *      terminal (Cozuldu/IptalEdildi)         → '—'
 *      ThirdPartyWaiting                      → thirdPartyName ?? '3. Parti'
 *      atanmamış (takım+kişi yok)             → 'Havuzda'
 *      pendingCustomerReply=false + son mail  → 'Müşteri'
 *        bizden (outbound > inbound)            (top müşteride)
 *      aksi halde                             → assignedTeamName
 *    DİKKAT: pendingCustomerReply=true = top AJANDA (ajan yanıt borçlu) —
 *    ters okuma YASAK (reference_pending_customer_reply_semantics).
 *  - Bildirim Tipi = Case.requestType; Support seviyesi = Case.supportLevel
 *    (yaratılışta damgalanan KALICI kolon — Codex #530 P2).
 *  - Terminal vakada çözüm VE müdahale sayaçları resolvedAt'te donar
 *    (İptal'de de damgalanır — Codex #530 P2).
 *  - FİLTRE SEÇENEKLERİ KASKAD + KENDİNİ-DIŞLA (saha feedback 2026-07-13):
 *    her dropdown'un listesi DİĞER filtrelerle daralır (Power BI slicer
 *    davranışı) ama KENDİ seçimiyle ASLA daralmaz — yoksa çoklu seçimde
 *    2./3. şık listeden kaybolur. Bunun için tüm facet filtreleri JS'te
 *    uygulanır; DB where yalnız tenant kapsamı + arşiv + yıl/ay taşır.
 *  - PRIVACY: requester kişi alanları (customerContact*) payload'a GİRMEZ;
 *    yalnız Account.name (firma) döner.
 *
 * Ölçek notu: base set tek sorguda çekilir (~10k vakaya kadar kabul; üstü
 * için denormalize kolon gerekir — bilinçli v1 sınırı).
 */
import { prisma } from '../db/client.js';
import { M_STATUS, M_REQUEST } from '../db/enumMap.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
export const SLA_DASH_MAX_PAGE_SIZE = 100;
export const SLA_DASH_DEFAULT_PAGE_SIZE = 20;
// Excel export tavanı — tek istekte dönebilecek satır (bellek guard'ı).
export const SLA_DASH_EXPORT_CAP = 20000;

const TERMINAL = new Set(['Cozuldu', 'IptalEdildi']);

/** Tekil değer ya da dizi → temiz string listesi (çoklu filtre desteği). */
function toList(v) {
  return (v == null ? [] : Array.isArray(v) ? v : [v]).map(String).filter(Boolean);
}

/** Görünen → saklanan; bilinmeyen görünen değer null döner (sessiz 0 tuzağına karşı). */
function storedStatus(display) {
  if (!display) return null;
  if (Object.values(M_STATUS).includes(display)) return display; // zaten saklanan
  return M_STATUS[display] ?? null;
}
function storedRequestType(display) {
  if (!display) return null;
  if (Object.values(M_REQUEST).includes(display)) return display;
  return M_REQUEST[display] ?? null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** customFields JSON'undan devops work item id listesi (yoksa []). */
export function extractDevopsIds(customFieldsRaw) {
  if (!customFieldsRaw) return [];
  let obj = customFieldsRaw;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return [];
    }
  }
  const arr = Array.isArray(obj?.devops) ? obj.devops : [];
  return arr.map((e) => e?.id).filter((id) => id != null).map(String);
}

/** Açık kalma süresi (gün) → filtre kovası anahtarı. */
export function openAgeBucket(days) {
  if (days < 1) return '0-1';
  if (days < 3) return '1-3';
  if (days < 7) return '3-7';
  return '7+';
}

/**
 * Bekleyen Bölüm türetimi — sıra önemli (yukarıdaki modül yorumuna bak).
 * mail: { lastOutboundAt, lastInboundAt } | undefined
 */
export function deriveWaitingDept(c, mail) {
  if (TERMINAL.has(c.status)) return '—';
  if (c.status === 'ThirdPartyWaiting') return c.thirdPartyName?.trim() || '3. Parti';
  if (!c.assignedTeamId && !c.assignedPersonId) return 'Havuzda';
  const lastOut = mail?.lastOutboundAt ? mail.lastOutboundAt.getTime() : 0;
  const lastIn = mail?.lastInboundAt ? mail.lastInboundAt.getTime() : 0;
  if (!c.pendingCustomerReply && lastOut > 0 && lastOut > lastIn) return 'Müşteri';
  return c.assignedTeamName?.trim() || 'Havuzda';
}

/**
 * Ana hesap. params: { year, month, companyId, waitingDept, supportLevel,
 * status, accountId, openAge, requestType, page, pageSize, exportAll }
 * (facet'ler tekil ya da liste). allowedCompanyIds: verifyJwt tenant kapsamı.
 */
export async function computeSlaDashboard(params, allowedCompanyIds) {
  if (!Array.isArray(allowedCompanyIds) || allowedCompanyIds.length === 0) {
    return emptyResult(params);
  }
  const now = Date.now();

  // ── Facet seçimleri (görünen etiketler saklanana çevrilir) ─────────
  const stIn = toList(params.status);
  const stOk = stIn.map(storedStatus).filter(Boolean);
  if (stIn.length && !stOk.length) return emptyResult(params); // tümü bilinmeyen → dürüst boş
  const rtIn = toList(params.requestType);
  const rtOk = rtIn.map(storedRequestType).filter(Boolean);
  if (rtIn.length && !rtOk.length) return emptyResult(params);
  const sel = {
    companyId: new Set(toList(params.companyId)),
    status: new Set(stOk),
    requestType: new Set(rtOk),
    accountId: new Set(toList(params.accountId)),
    waitingDept: new Set(toList(params.waitingDept)),
    supportLevel: new Set(toList(params.supportLevel)),
    openAge: new Set(toList(params.openAge)),
  };

  // ── DB where: yalnız tenant kapsamı + arşiv + yıl/ay (facet'ler JS'te —
  //    kendini-dışla kaskad seçenekleri tek base set ister) ───────────
  const where = {
    companyId: { in: allowedCompanyIds },
    isArchived: false, // liste paritesi: arşivli default hariç
  };
  const year = Number(params.year) || null;
  const month = Number(params.month) || null; // 1-12
  if (year) {
    const from = new Date(Date.UTC(year, month ? month - 1 : 0, 1));
    const to = month
      ? new Date(Date.UTC(year, month, 1))
      : new Date(Date.UTC(year + 1, 0, 1));
    where.createdAt = { gte: from, lt: to };
  }

  // ── Base set — yalnız gereken kolonlar (PRIVACY: customerContact* YOK) ──
  const [cases, mailAgg, companyRows] = await Promise.all([
    prisma.case.findMany({
      where,
      select: {
        id: true,
        caseNumber: true,
        companyId: true,
        status: true,
        priority: true,
        requestType: true,
        createdAt: true,
        resolvedAt: true,
        slaResponseDueAt: true,
        slaResponseMetAt: true,
        slaResolutionDueAt: true,
        pendingCustomerReply: true,
        assignedTeamId: true,
        assignedTeamName: true,
        assignedPersonId: true,
        assignedPersonName: true,
        supportLevel: true,
        thirdPartyName: true,
        customFields: true,
        account: { select: { id: true, name: true } },
      },
    }),
    prisma.caseEmail.groupBy({
      by: ['caseId', 'direction'],
      where: { companyId: { in: allowedCompanyIds } },
      _max: { sentAt: true, receivedAt: true },
    }),
    prisma.company.findMany({
      where: { id: { in: allowedCompanyIds } },
      select: { id: true, name: true },
    }),
  ]);
  const mailByCase = new Map();
  for (const m of mailAgg) {
    const e = mailByCase.get(m.caseId) ?? { lastOutboundAt: null, lastInboundAt: null };
    // direction saklanan değeri küçük harf ('inbound'/'outbound')
    if (m.direction === 'outbound') e.lastOutboundAt = m._max.sentAt ?? e.lastOutboundAt;
    if (m.direction === 'inbound') e.lastInboundAt = m._max.receivedAt ?? e.lastInboundAt;
    mailByCase.set(m.caseId, e);
  }
  const companyName = new Map(companyRows.map((c) => [c.id, c.name]));

  // ── Satır hesapları ────────────────────────────────────────────────
  const computed = cases.map((c) => {
    const created = c.createdAt.getTime();
    // Codex #530 P2: resolvedAt her iki terminalde de damgalanır (transitionStatus
    // İptal'de de yazar) — sayaç ikisinde de kapanış anında durur.
    const resolved = TERMINAL.has(c.status) && c.resolvedAt ? c.resolvedAt.getTime() : null;
    const end = resolved ?? now;

    const resoDue = c.slaResolutionDueAt ? c.slaResolutionDueAt.getTime() : null;
    const respDue = c.slaResponseDueAt ? c.slaResponseDueAt.getTime() : null;
    const respMet = c.slaResponseMetAt ? c.slaResponseMetAt.getTime() : null;
    // Codex #530 P2: terminal vakada müdahale sayacı da durur (respMet yoksa
    // kapanış anı; legacy resolvedAt=null ise now'a düşer — bilinçli düşüş).
    const respEnd = respMet ?? resolved ?? now;

    const waitingDept = deriveWaitingDept(c, mailByCase.get(c.id));
    const openDays = (end - created) / DAY_MS;
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      companyId: c.companyId,
      accountId: c.account?.id ?? null,
      accountName: c.account?.name ?? null,
      priority: c.priority,
      requestType: c.requestType,
      status: c.status,
      teamName: c.assignedTeamName ?? null,
      ownerName: c.assignedPersonName ?? null,
      // Codex #530 P2: Case.supportLevel yaratılışta damgalanan KALICI kolon
      // (ürün/explicit kuralları uygulanmış hali) — yeniden türetme yerine onu oku.
      supportLevel: c.supportLevel ?? null,
      waitingDept,
      devopsIds: extractDevopsIds(c.customFields),
      openAgeBucket: openAgeBucket(openDays),
      // Çözüm SLA (gün)
      resolutionTargetDays: resoDue ? round2((resoDue - created) / DAY_MS) : null,
      resolutionElapsedDays: round2((end - created) / DAY_MS),
      resolutionRemainingDays: resoDue ? round2((resoDue - end) / DAY_MS) : null,
      resolutionOnTarget: resoDue ? end <= resoDue : null,
      // Müdahale SLA (dk)
      responseTargetMin: respDue ? Math.round((respDue - created) / MIN_MS) : null,
      responseElapsedMin: Math.round((respEnd - created) / MIN_MS),
      responseRemainingMin: respDue ? Math.round((respDue - respEnd) / MIN_MS) : null,
      responseOnTarget: respDue ? respEnd <= respDue : null,
    };
  });

  // ── Facet süzme: kendini-dışla desteğiyle ──────────────────────────
  // matches(r, excludeKey): excludeKey DIŞINDAKİ tüm seçili facet'leri uygular.
  // Seçenek listeleri excludeKey=kendisi ile hesaplanır → dropdown kendi
  // seçimiyle daralmaz, diğer filtrelerle kaskad daralır (Power BI davranışı).
  const FACETS = [
    ['companyId', (r) => r.companyId],
    ['status', (r) => r.status],
    ['requestType', (r) => r.requestType],
    ['accountId', (r) => r.accountId],
    ['waitingDept', (r) => r.waitingDept],
    ['supportLevel', (r) => r.supportLevel],
    ['openAge', (r) => r.openAgeBucket],
  ];
  const matches = (r, excludeKey) => {
    for (const [key, get] of FACETS) {
      if (key === excludeKey) continue;
      const set = sel[key];
      if (set.size && !set.has(get(r))) return false;
    }
    return true;
  };
  const filtered = computed.filter((r) => matches(r, null));

  // ── Seçenekler (kaskad + kendini-dışla) ────────────────────────────
  const waitingOpt = new Set();
  const companyOpt = new Map();
  const accountCount = new Map();
  for (const r of computed) {
    if (r.waitingDept !== '—' && matches(r, 'waitingDept')) waitingOpt.add(r.waitingDept);
    if (matches(r, 'companyId')) companyOpt.set(r.companyId, companyName.get(r.companyId) ?? r.companyId);
    if (r.accountId && r.accountName && matches(r, 'accountId')) {
      const e = accountCount.get(r.accountId) ?? { name: r.accountName, n: 0 };
      e.n += 1;
      accountCount.set(r.accountId, e);
    }
  }
  const accounts = [...accountCount.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 200)
    .map(([id, e]) => ({ id, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  // ── KPI'lar — süzülmüş TAM set üzerinden ───────────────────────────
  const kpi = (arr, key) => {
    let evet = 0;
    let hayir = 0;
    for (const r of arr) {
      if (r[key] === true) evet += 1;
      else if (r[key] === false) hayir += 1;
    }
    return { evet, hayir, withDue: evet + hayir };
  };
  const kpis = {
    totalCount: filtered.length,
    resolution: kpi(filtered, 'resolutionOnTarget'),
    response: kpi(filtered, 'responseOnTarget'),
  };

  // ── Sıralama (geciken önce) ────────────────────────────────────────
  filtered.sort((a, b) => {
    const ar = a.resolutionRemainingDays;
    const br = b.resolutionRemainingDays;
    if (ar == null && br == null) return b.resolutionElapsedDays - a.resolutionElapsedDays;
    if (ar == null) return 1;
    if (br == null) return -1;
    return ar - br;
  });

  const options = {
    companies: [...companyOpt.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    waitingDepts: [...waitingOpt].sort((a, b) => a.localeCompare(b, 'tr')),
    accounts,
    requestTypes: Object.keys(M_REQUEST), // görünen etiketler
    statuses: Object.keys(M_STATUS),
  };

  // Export modu: sayfalama yok — süzülmüş TÜM set (tavanlı) tek seferde
  // döner; FE xlsx üretir. exportTruncated dürüstlük bayrağı.
  if (params.exportAll) {
    const capped = filtered.slice(0, SLA_DASH_EXPORT_CAP);
    return {
      rows: capped,
      page: 1,
      pageSize: capped.length,
      totalPages: 1,
      exportTruncated: filtered.length > SLA_DASH_EXPORT_CAP,
      kpis,
      options,
      generatedAt: new Date().toISOString(),
    };
  }

  const pageSize = Math.min(
    Math.max(Number(params.pageSize) || SLA_DASH_DEFAULT_PAGE_SIZE, 1),
    SLA_DASH_MAX_PAGE_SIZE,
  );
  const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const page = Math.min(Math.max(Number(params.page) || 1, 1), totalPages);
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return {
    rows,
    page,
    pageSize,
    totalPages,
    kpis,
    options,
    generatedAt: new Date().toISOString(),
  };
}

function emptyResult(params) {
  const pageSize = Math.min(
    Math.max(Number(params?.pageSize) || SLA_DASH_DEFAULT_PAGE_SIZE, 1),
    SLA_DASH_MAX_PAGE_SIZE,
  );
  return {
    rows: [],
    page: 1,
    pageSize,
    totalPages: 1,
    kpis: { totalCount: 0, resolution: { evet: 0, hayir: 0, withDue: 0 }, response: { evet: 0, hayir: 0, withDue: 0 } },
    options: { companies: [], waitingDepts: [], accounts: [], requestTypes: Object.keys(M_REQUEST), statuses: Object.keys(M_STATUS) },
    generatedAt: new Date().toISOString(),
  };
}
