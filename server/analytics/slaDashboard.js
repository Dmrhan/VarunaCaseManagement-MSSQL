/**
 * slaDashboard.js — CS Yönetim Panosu (SLA İzleme) agregatörü. 2026-07-13
 *
 * n4b dönemindeki Power BI panosunun Varuna içi karşılığı: vaka-satırı
 * bazında çözüm + müdahale SLA hedef/geçen/kalan süreleri, türetilmiş
 * "Bekleyen Bölüm", KPI özetleri ve sunucu tarafı sayfalama.
 *
 * Tasarım kararları (kullanıcı onayı 2026-07-13, mockup üzerinden):
 *  - "Proje" kolonu = Account (müşteri firması). AccountProject %48 dolu
 *    olduğundan bilinçli olarak seçilmedi.
 *  - Bekleyen Bölüm türetimi (öncelik sırası):
 *      terminal (Cozuldu/IptalEdildi)         → '—'
 *      ThirdPartyWaiting                      → thirdPartyName ?? '3. Parti'
 *      atanmamış (takım+kişi yok)             → 'Havuzda'
 *      pendingCustomerReply=false + son mail  → 'Müşteri'
 *        bizden (outbound > inbound)            (top müşteride)
 *      aksi halde                             → assignedTeamName
 *    DİKKAT: pendingCustomerReply=true = top AJANDA (ajan yanıt borçlu) —
 *    ters okuma YASAK (reference_pending_customer_reply_semantics).
 *  - Bildirim Tipi = Case.requestType (saklanan: Bilgi/Oneri/Talep/Sikayet/Hata).
 *  - PRIVACY: requester kişi alanları (customerContact*) payload'a GİRMEZ;
 *    yalnız Account.name (firma) döner.
 *
 * Derived filtreler (bekleyen bölüm / L1-L2 / açık-kalma) DB'ye itilemediği
 * için base set çekilip JS'te süzülür; KPI'lar süzülmüş TÜM set üzerinden,
 * sayfalama en sonda. ~10k vakaya kadar tek sorgu kabul edilebilir; üstü
 * için ileride denormalize kolon gerekir (bilinçli v1 sınırı).
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

/** Tekil değer ya da dizi → temiz string listesi (çoklu filtre desteği). */
function toList(v) {
  return (v == null ? [] : Array.isArray(v) ? v : [v]).map(String).filter(Boolean);
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
 * Ana hesap. params: { year, month, waitingDept, supportLevel, status,
 * accountId, openAge, requestType, page, pageSize } (hepsi opsiyonel).
 * allowedCompanyIds: verifyJwt'nin doldurduğu tenant kapsamı (ZORUNLU).
 */
export async function computeSlaDashboard(params, allowedCompanyIds) {
  if (!Array.isArray(allowedCompanyIds) || allowedCompanyIds.length === 0) {
    return emptyResult(params);
  }
  const now = Date.now();

  // ── DB'ye itilebilen filtreler ─────────────────────────────────────
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
  // Çoklu seçim: her parametre tekil değer YA DA liste olabilir. Görünen
  // etiketler saklanana çevrilir; verilen listenin TAMAMI bilinmeyense
  // dürüst-boş (kısmen geçerliyse geçerli olanlarla süzülür).
  const stIn = toList(params.status);
  const stOk = stIn.map(storedStatus).filter(Boolean);
  if (stIn.length && !stOk.length) return emptyResult(params);
  if (stOk.length) where.status = { in: stOk };
  const rtIn = toList(params.requestType);
  const rtOk = rtIn.map(storedRequestType).filter(Boolean);
  if (rtIn.length && !rtOk.length) return emptyResult(params);
  if (rtOk.length) where.requestType = { in: rtOk };
  const accIn = toList(params.accountId);
  if (accIn.length) where.accountId = { in: accIn };

  // ── Base set — yalnız gereken kolonlar (PRIVACY: customerContact* YOK) ──
  const cases = await prisma.case.findMany({
    where,
    select: {
      id: true,
      caseNumber: true,
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
  });

  // ── Yardımcı haritalar (tenant-scoped; IN(caseIds) 2100-parametre
  //    tuzağından kaçınmak için bilinçli olarak geniş groupBy) ─────────
  const mailAgg = await prisma.caseEmail.groupBy({
    by: ['caseId', 'direction'],
    where: { companyId: { in: allowedCompanyIds } },
    _max: { sentAt: true, receivedAt: true },
  });
  const mailByCase = new Map();
  for (const m of mailAgg) {
    const e = mailByCase.get(m.caseId) ?? { lastOutboundAt: null, lastInboundAt: null };
    // direction saklanan değeri küçük harf ('inbound'/'outbound')
    if (m.direction === 'outbound') e.lastOutboundAt = m._max.sentAt ?? e.lastOutboundAt;
    if (m.direction === 'inbound') e.lastInboundAt = m._max.receivedAt ?? e.lastInboundAt;
    mailByCase.set(m.caseId, e);
  }
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
    // Codex #530 P2: Case.supportLevel yaratılışta damgalanan KALICI kolon
    // (ürün/explicit kuralları uygulanmış hali) — yeniden türetme yerine onu oku.
    const supportLevel = c.supportLevel ?? null;

    const openDays = (end - created) / DAY_MS;
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      accountId: c.account?.id ?? null,
      accountName: c.account?.name ?? null,
      priority: c.priority,
      requestType: c.requestType,
      status: c.status,
      teamName: c.assignedTeamName ?? null,
      ownerName: c.assignedPersonName ?? null,
      supportLevel,
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

  // ── Türetilmiş filtreler (JS) ──────────────────────────────────────
  let filtered = computed;
  const wdSet = new Set(toList(params.waitingDept));
  if (wdSet.size) filtered = filtered.filter((r) => wdSet.has(r.waitingDept));
  const lvlSet = new Set(toList(params.supportLevel));
  if (lvlSet.size) filtered = filtered.filter((r) => r.supportLevel != null && lvlSet.has(r.supportLevel));
  const ageSet = new Set(toList(params.openAge));
  if (ageSet.size) filtered = filtered.filter((r) => ageSet.has(r.openAgeBucket));

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

  // ── Sıralama (geciken önce) + sayfalama ────────────────────────────
  filtered.sort((a, b) => {
    const ar = a.resolutionRemainingDays;
    const br = b.resolutionRemainingDays;
    if (ar == null && br == null) return b.resolutionElapsedDays - a.resolutionElapsedDays;
    if (ar == null) return 1;
    if (br == null) return -1;
    return ar - br;
  });
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
      options: { waitingDepts: [], accounts: [], requestTypes: Object.keys(M_REQUEST), statuses: Object.keys(M_STATUS) },
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

  // ── Filtre seçenekleri (base set'ten; müşteri listesi 200 ile sınırlı) ──
  const accountOpt = new Map();
  const waitingOpt = new Set();
  for (const r of computed) {
    if (r.accountId && r.accountName && accountOpt.size < 200 && !accountOpt.has(r.accountId)) {
      accountOpt.set(r.accountId, r.accountName);
    }
    if (r.waitingDept !== '—') waitingOpt.add(r.waitingDept);
  }

  return {
    rows,
    page,
    pageSize,
    totalPages,
    kpis,
    options: {
      waitingDepts: [...waitingOpt].sort((a, b) => a.localeCompare(b, 'tr')),
      accounts: [...accountOpt.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
      requestTypes: Object.keys(M_REQUEST), // görünen etiketler
      statuses: Object.keys(M_STATUS),
    },
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
    options: { waitingDepts: [], accounts: [], requestTypes: Object.keys(M_REQUEST), statuses: Object.keys(M_STATUS) },
    generatedAt: new Date().toISOString(),
  };
}
