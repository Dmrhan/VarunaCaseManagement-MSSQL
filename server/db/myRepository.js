import { prisma } from './client.js';

/**
 * /my/* — kişisel ekranlar için repository (Takvim, Hatırlatıcılar).
 *
 * Hepsi req.user.id ve req.user.allowedCompanyIds üzerinden user-scoped.
 * Companywise denormalize edilmiş çocuk tablo pattern'ini izliyor — JOIN'siz
 * multi-tenant scope filter (Faz 1.5 child denorm).
 */

const MAX_RANGE_DAYS = 90; // performans guard'ı: çok geniş aralıklı istekler reddedilir

const ALL_EVENT_TYPES = ['reminder', 'snooze', 'sla_response', 'sla_resolution', 'followup'];

// Closed/cancelled statuses — calendar SLA/snooze/followup eventleri
// non-actionable olduğu için bu vakaların case-bağlı olaylarını gizleriz.
// Reminder hariç (kullanıcının explicit oluşturduğu hatırlatıcı kapalı vakada
// bile görünür kalır — bilinçli niyeti korumak için).
const CLOSED_CASE_STATUSES = ['Cozuldu', 'IptalEdildi'];

/**
 * Tarih aralığı içindeki kişisel takvim olaylarını derle.
 *
 * @param types — istenen olay türleri set'i. Verilmezse hepsi çekilir.
 *   Boş array verilirse hiç sorgu çalıştırılmaz (lazy load için).
 *
 * Olay türleri:
 *   - reminder        → CaseReminder (userId = me)
 *   - snooze          → Case.snoozeUntil (assignedPersonId = me.personId)
 *   - sla_response    → Case.slaResponseDueAt (yalnız ihlal yok + assignedPersonId = me)
 *   - sla_resolution  → Case.slaResolutionDueAt (aynı kural)
 *   - followup        → CaseCallLog.nextFollowupDate (case'in assignedPersonId = me)
 *
 * Not: CaseCallLog.callerId şu an dummy ('mock-user') olduğu için spec'teki
 * "callerId = me" filtresi yerine vakanın atanan kişisi üzerinden filtreliyoruz —
 * pratikte daha anlamlı (benim takip etmem gereken vakaların followup'ları).
 */
export async function listCalendarEvents({ userId, personId, allowedCompanyIds, from, to, types }) {
  if (!from || !to) {
    throw new Error('from ve to gerekli');
  }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new Error('from/to geçerli ISO tarih olmalı');
  }
  if (toDate.getTime() < fromDate.getTime()) {
    throw new Error('to, from sonrası olmalı');
  }
  const rangeDays = (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000);
  if (rangeDays > MAX_RANGE_DAYS) {
    throw new Error(`Aralık ${MAX_RANGE_DAYS} günden fazla olamaz`);
  }

  // Tür filtresi — boş array verilirse hiç fetch yok (lazy load).
  // null/undefined → hepsini al (geri uyumluluk).
  const wantedTypes = Array.isArray(types) ? new Set(types) : new Set(ALL_EVENT_TYPES);
  if (wantedTypes.size === 0) {
    return [];
  }
  const want = (t) => wantedTypes.has(t);

  const companyScope = { companyId: { in: allowedCompanyIds } };
  const dateRange = { gte: fromDate, lte: toDate };

  // Defensive cap — bir kullanıcının takvimine binlerce SLA/snooze etiketi düşebilir
  // (özellikle aylık görünümde 42 günlük aralıkta). UI 5x cap aşıldığında
  // kullanışsız zaten; client-side take ile hem payload'u hem render maliyetini sınırla.
  const TAKE_CAP = 200;

  // İstenen türler için paralel sorgu — istenmeyenler boş Promise.
  const [reminders, snoozedCases, slaResponseCases, slaResolutionCases, followupLogs] = await Promise.all([
    // 1) Hatırlatıcılar — user'a özel
    want('reminder')
      ? prisma.caseReminder.findMany({
          where: {
            userId,
            ...companyScope,
            remindAt: dateRange,
          },
          include: {
            case: { select: { id: true, caseNumber: true, accountName: true, priority: true } },
          },
          orderBy: { remindAt: 'asc' },
          take: TAKE_CAP,
        })
      : Promise.resolve([]),

    // 2) Snooze — assignedPersonId = me.personId. personId yoksa skip.
    //    Kapalı/iptal vakalarda snooze hedefi yok; gizle.
    want('snooze') && personId
      ? prisma.case.findMany({
          where: {
            ...companyScope,
            assignedPersonId: personId,
            snoozeUntil: { not: null, ...dateRange },
            status: { notIn: CLOSED_CASE_STATUSES },
          },
          select: {
            id: true,
            caseNumber: true,
            accountName: true,
            priority: true,
            snoozeUntil: true,
            snoozeReason: true,
          },
          orderBy: { snoozeUntil: 'asc' },
          take: TAKE_CAP,
        })
      : Promise.resolve([]),

    // 3) SLA yanıt tarihi — me'nin atanan vakaları, henüz ihlal yok.
    //    Kapalı/iptal vakaların SLA'sı non-actionable; gizle.
    want('sla_response') && personId
      ? prisma.case.findMany({
          where: {
            ...companyScope,
            assignedPersonId: personId,
            slaResponseDueAt: { not: null, ...dateRange },
            slaViolation: false,
            status: { notIn: CLOSED_CASE_STATUSES },
          },
          select: {
            id: true,
            caseNumber: true,
            accountName: true,
            priority: true,
            slaResponseDueAt: true,
            title: true,
          },
          orderBy: { slaResponseDueAt: 'asc' },
          take: TAKE_CAP,
        })
      : Promise.resolve([]),

    // 4) SLA çözüm tarihi — aynı kural; kapalı/iptal gizli.
    want('sla_resolution') && personId
      ? prisma.case.findMany({
          where: {
            ...companyScope,
            assignedPersonId: personId,
            slaResolutionDueAt: { not: null, ...dateRange },
            slaViolation: false,
            status: { notIn: CLOSED_CASE_STATUSES },
          },
          select: {
            id: true,
            caseNumber: true,
            accountName: true,
            priority: true,
            slaResolutionDueAt: true,
            title: true,
          },
          orderBy: { slaResolutionDueAt: 'asc' },
          take: TAKE_CAP,
        })
      : Promise.resolve([]),

    // 5) Followup — vakanın atanan kişisi me. CaseCallLog.callerId şu an mock-user
    //    olduğu için case'in assigned person'ı üzerinden filtreliyoruz.
    //    Kapalı/iptal vakalar için takip araması anlamsız; gizle.
    want('followup') && personId
      ? prisma.caseCallLog.findMany({
          where: {
            ...companyScope,
            nextFollowupDate: { not: null, ...dateRange },
            case: { assignedPersonId: personId, status: { notIn: CLOSED_CASE_STATUSES } },
          },
          include: {
            case: { select: { id: true, caseNumber: true, accountName: true, priority: true } },
          },
          orderBy: { nextFollowupDate: 'asc' },
          take: TAKE_CAP,
        })
      : Promise.resolve([]),
  ]);

  const events = [];

  for (const r of reminders) {
    events.push({
      id: `reminder:${r.id}`,
      type: 'reminder',
      title: r.message ?? 'Hatırlatıcı',
      caseId: r.caseId,                                 // null olabilir (vakasız reminder)
      caseNumber: r.case?.caseNumber ?? null,
      customerName: r.case?.accountName ?? null,
      priority: r.case?.priority ?? null,
      date: r.remindAt.toISOString(),
      notes: r.message ?? null,
    });
  }

  for (const c of snoozedCases) {
    events.push({
      id: `snooze:${c.id}`,
      type: 'snooze',
      title: 'Vaka uyanacak',
      caseId: c.id,
      caseNumber: c.caseNumber,
      customerName: c.accountName,
      priority: c.priority,
      date: c.snoozeUntil.toISOString(),
      notes: c.snoozeReason ?? null,
    });
  }

  for (const c of slaResponseCases) {
    events.push({
      id: `sla_response:${c.id}`,
      type: 'sla_response',
      title: 'SLA yanıt tarihi',
      caseId: c.id,
      caseNumber: c.caseNumber,
      customerName: c.accountName,
      priority: c.priority,
      date: c.slaResponseDueAt.toISOString(),
      notes: c.title,
    });
  }

  for (const c of slaResolutionCases) {
    events.push({
      id: `sla_resolution:${c.id}`,
      type: 'sla_resolution',
      title: 'SLA çözüm tarihi',
      caseId: c.id,
      caseNumber: c.caseNumber,
      customerName: c.accountName,
      priority: c.priority,
      date: c.slaResolutionDueAt.toISOString(),
      notes: c.title,
    });
  }

  for (const log of followupLogs) {
    events.push({
      id: `followup:${log.id}`,
      type: 'followup',
      title: 'Takip araması',
      caseId: log.caseId,
      caseNumber: log.case?.caseNumber ?? null,
      customerName: log.case?.accountName ?? null,
      priority: log.case?.priority ?? null,
      date: log.nextFollowupDate.toISOString(),
      notes: log.description ?? null,
    });
  }

  // Tarih sırasına göre sırala — UI günlük/haftalık görünümler için tek pass yeter.
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return events;
}

/**
 * Yeni hatırlatıcı oluştur.
 *  - caseId verilmişse: vaka companyId kullanıcının scope'unda olmalı; companyId Case'den çekilir.
 *  - caseId null/undefined: vakasız kişisel hatırlatıcı; companyId = allowedCompanyIds[0].
 *    (Çok şirketli supervisor/admin için ileride explicit companyId param gerekebilir.)
 *
 * Returns { id, ...} | { error: ... } | null (vaka istendi ama bulunamadı).
 */
export async function createReminder({ caseId, userId, allowedCompanyIds, remindAt, message }) {
  let companyId;
  if (caseId) {
    const found = await prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, companyId: true },
    });
    if (!found) return null;
    if (!allowedCompanyIds.includes(found.companyId)) {
      return { error: 'forbidden', message: 'Bu vakaya erişim yetkin yok.' };
    }
    companyId = found.companyId;
  } else {
    if (!allowedCompanyIds || allowedCompanyIds.length === 0) {
      return { error: 'forbidden', message: 'Hatırlatıcı oluşturmak için bir şirkete bağlı olmalısın.' };
    }
    companyId = allowedCompanyIds[0];
  }

  const target = new Date(remindAt);
  if (Number.isNaN(target.getTime())) {
    return { error: 'invalid', message: 'remindAt geçerli bir ISO tarih olmalı.' };
  }
  if (target.getTime() <= Date.now()) {
    return { error: 'invalid', message: 'remindAt gelecekte bir tarih olmalı.' };
  }
  // Vakasız reminder mesajsız anlamsız — note zorunlu kıl.
  const trimmedMessage = message?.trim() || null;
  if (!caseId && !trimmedMessage) {
    return { error: 'invalid', message: 'Vakasız hatırlatıcı için not zorunlu.' };
  }

  const created = await prisma.caseReminder.create({
    data: {
      caseId: caseId ?? null,
      userId,
      companyId,
      remindAt: target,
      message: trimmedMessage,
    },
  });
  return {
    id: created.id,
    caseId: created.caseId,
    remindAt: created.remindAt.toISOString(),
    message: created.message,
  };
}

/**
 * Tek bir hatırlatıcıyı oku — edit modal'ı için. Sahibi değilse 404 davran.
 */
export async function getReminder({ id, userId, allowedCompanyIds }) {
  const r = await prisma.caseReminder.findUnique({
    where: { id },
    include: {
      case: { select: { id: true, caseNumber: true, accountName: true } },
    },
  });
  if (!r) return null;
  if (r.userId !== userId) return null; // başkasının → 404 (yetki sızdırmama)
  if (!allowedCompanyIds.includes(r.companyId)) return null;
  return {
    id: r.id,
    caseId: r.caseId,
    case: r.case
      ? { id: r.case.id, caseNumber: r.case.caseNumber, accountName: r.case.accountName }
      : null,
    remindAt: r.remindAt.toISOString(),
    message: r.message,
  };
}

/**
 * Hatırlatıcıyı güncelle — sahibi sadece kendi reminder'ını günceller.
 * Yalnız remindAt, message ve caseId güncellenebilir (whitelist).
 *
 *  - caseId değişiyorsa yeni vakanın companyId scope'u kontrol edilir; companyId
 *    gerekirse o yeni vakaya göre güncellenir.
 *  - caseId null'a düşerse companyId'i değiştirmiyoruz (mevcut allowedCompanyIds[0]
 *    zaten valid).
 *
 * Returns updated row | { error } | null (yok / başkasının).
 */
export async function updateReminder({ id, userId, allowedCompanyIds, remindAt, message, caseId }) {
  const existing = await prisma.caseReminder.findUnique({
    where: { id },
    select: { id: true, userId: true, companyId: true, caseId: true },
  });
  if (!existing) return null;
  if (existing.userId !== userId) return null;
  if (!allowedCompanyIds.includes(existing.companyId)) return null;

  const data = {};

  if (remindAt !== undefined) {
    const target = new Date(remindAt);
    if (Number.isNaN(target.getTime())) {
      return { error: 'invalid', message: 'remindAt geçerli bir ISO tarih olmalı.' };
    }
    if (target.getTime() <= Date.now()) {
      return { error: 'invalid', message: 'remindAt gelecekte bir tarih olmalı.' };
    }
    data.remindAt = target;
  }

  if (message !== undefined) {
    data.message = message?.trim() || null;
  }

  // caseId update — yeni vaka companyId scope'unda mı?
  if (caseId !== undefined) {
    if (caseId) {
      const found = await prisma.case.findUnique({
        where: { id: caseId },
        select: { id: true, companyId: true },
      });
      if (!found) return { error: 'not_found', message: 'Vaka bulunamadı.' };
      if (!allowedCompanyIds.includes(found.companyId)) {
        return { error: 'forbidden', message: 'Bu vakaya erişim yetkin yok.' };
      }
      data.caseId = caseId;
      data.companyId = found.companyId;
    } else {
      data.caseId = null;
    }
  }

  // Vakasız + mesajsız reminder oluşmasın — final state kontrolü:
  const finalCaseId = data.caseId !== undefined ? data.caseId : existing.caseId;
  const finalMessage = data.message !== undefined ? data.message : null;
  if (!finalCaseId && data.message !== undefined && !finalMessage) {
    return { error: 'invalid', message: 'Vakasız hatırlatıcı için not zorunlu.' };
  }

  const updated = await prisma.caseReminder.update({
    where: { id },
    data,
  });
  return {
    id: updated.id,
    caseId: updated.caseId,
    remindAt: updated.remindAt.toISOString(),
    message: updated.message,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Dashboard — tek round-trip "Benim Sayfam" verisi.
// Tüm sorgular allowedCompanyIds + (gerekli yerlerde) personId scope.
// ──────────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi'];

function timeOfDay(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

// myTopCases için her vakaya tek bir "en acil" AI signal'ı seçer.
// Spec'teki sıraya göre öncelikli: SLA ihlal/yaklaşma → followup → sentiment(skip).
function deriveAiSignal(c) {
  if (c.slaViolation) return '⚡ SLA ihlal edildi';
  if (c.slaResolutionDueAt) {
    const remainingMs = new Date(c.slaResolutionDueAt).getTime() - Date.now();
    const remainingHours = remainingMs / (60 * 60 * 1000);
    if (remainingHours > 0 && remainingHours <= 4) {
      return `⚡ SLA ${Math.round(remainingHours)} saat kaldı`;
    }
  }
  return null;
}

export async function getDashboard({ user }) {
  const userId = user.id;
  const personId = user.personId;
  const allowedCompanyIds = user.allowedCompanyIds ?? [];
  const fullName = user.fullName ?? '';
  const now = new Date();
  const today0 = startOfToday();
  const today23 = endOfToday();
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (allowedCompanyIds.length === 0) {
    // Kullanıcı henüz şirkete atanmamış — boş ama valid shape döndür.
    return emptyDashboard({ fullName });
  }

  const companyScope = { companyId: { in: allowedCompanyIds } };
  const personScope = personId ? { ...companyScope, assignedPersonId: personId } : null;

  // Paralel sorgu seti — single round-trip esprisi (15 paralel query).
  const [
    // urgent signals
    slaRiskCount,
    unreadMentionsCount,
    activePatterns,
    // stats
    assignedToMeCount,
    resolvedTodayCount,
    snoozedCount,
    followupTodayLogs,
    // today calendar (next-7-day SLA + today snooze + today reminder + today followup)
    todayReminders,
    todaySnoozeCases,
    todaySlaCases,
    // pendingApprovals + myTopCases (rich Case rows for me)
    myActiveCases,
    // performance
    myQaScoredCases,
    teamQaScoredCases,
    // dailySummary
    newCasesToday,
    myResolvedTodayDetailed,
  ] = await Promise.all([
    // 1) sla_risk: bana atanan + (slaViolation OR slaResolutionDueAt < 24h).
    // count() yeterli — UI yalnız sayıyı gösteriyor (caseIds tüketici yok).
    personScope
      ? prisma.case.count({
          where: {
            ...personScope,
            status: { in: ACTIVE_STATUSES },
            OR: [
              { slaViolation: true },
              {
                slaResolutionDueAt: {
                  not: null,
                  lte: new Date(now.getTime() + 24 * 60 * 60 * 1000),
                  gte: now,
                },
              },
            ],
          },
        })
      : Promise.resolve(0),
    // 2) unread mentions
    prisma.caseMention.count({
      where: {
        mentionedUserId: userId,
        seenAt: null,
      },
    }),
    // 3) active patterns (Supervisor+ only — hata olursa boş array)
    ['Supervisor', 'Admin', 'SystemAdmin'].includes(user.role)
      ? prisma.patternAlert.findMany({
          where: { status: 'active', ...companyScope },
          orderBy: { detectedAt: 'desc' },
          take: 5,
        })
      : Promise.resolve([]),

    // stats
    personScope
      ? prisma.case.count({
          where: { ...personScope, status: { in: ACTIVE_STATUSES } },
        })
      : Promise.resolve(0),
    personScope
      ? prisma.case.count({
          where: {
            ...personScope,
            status: 'Cozuldu',
            resolvedAt: { gte: today0, lte: today23 },
          },
        })
      : Promise.resolve(0),
    personScope
      ? prisma.case.count({
          where: { ...personScope, snoozeUntil: { gt: now } },
        })
      : Promise.resolve(0),
    personScope
      ? prisma.caseCallLog.findMany({
          where: {
            ...companyScope,
            nextFollowupDate: { gte: today0, lte: today23 },
            case: { assignedPersonId: personId },
          },
          select: { id: true },
          take: 100,
        })
      : Promise.resolve([]),

    // todayCalendar — 4 paralel
    prisma.caseReminder.findMany({
      where: { userId, ...companyScope, remindAt: { gte: today0, lte: today23 } },
      include: { case: { select: { caseNumber: true, accountName: true } } },
      orderBy: { remindAt: 'asc' },
      take: 50,
    }),
    personScope
      ? prisma.case.findMany({
          where: {
            ...personScope,
            snoozeUntil: { gte: today0, lte: today23 },
          },
          select: { id: true, caseNumber: true, accountName: true, snoozeUntil: true },
          take: 50,
        })
      : Promise.resolve([]),
    personScope
      ? prisma.case.findMany({
          where: {
            ...personScope,
            slaResolutionDueAt: { gte: today0, lte: today23 },
            slaViolation: false,
          },
          select: { id: true, caseNumber: true, accountName: true, slaResolutionDueAt: true, title: true },
          take: 50,
        })
      : Promise.resolve([]),

    // myTopCases + pendingApprovals için zengin liste (ortak veri kaynağı)
    personScope
      ? prisma.case.findMany({
          where: { ...personScope, status: { in: ACTIVE_STATUSES } },
          select: {
            id: true,
            caseNumber: true,
            title: true,
            accountName: true,
            priority: true,
            status: true,
            slaViolation: true,
            slaResolutionDueAt: true,
            updatedAt: true,
            createdAt: true,
            snoozeUntil: true,
          },
          orderBy: [{ updatedAt: 'desc' }],
          take: 50,
        })
      : Promise.resolve([]),

    // performance — qaScoredAt son 30 gün, bana atanan
    personScope
      ? prisma.case.findMany({
          where: {
            ...personScope,
            qaScoredAt: { gte: day30Ago },
          },
          select: {
            qaEmpathyScore: true,
            qaClarityScore: true,
            qaSpeedScore: true,
            qaScoredAt: true,
          },
          take: 200,
        })
      : Promise.resolve([]),
    // team avg — eskiden findMany take:1000 + JS avg idi. Şimdi DB-side aggregate.
    // Semantik koruma: avgScores() yalnız 3 skor da non-null olan kayıtları sayardı;
    // aynı davranış için AND ile non-null guard uyguluyoruz. Aksi halde Prisma _avg
    // her sütunu bağımsız ortalardı (farklı semantik).
    prisma.case.aggregate({
      where: {
        ...companyScope,
        qaScoredAt: { gte: day30Ago },
        AND: [
          { qaEmpathyScore: { not: null } },
          { qaClarityScore: { not: null } },
          { qaSpeedScore: { not: null } },
        ],
      },
      _avg: {
        qaEmpathyScore: true,
        qaClarityScore: true,
        qaSpeedScore: true,
      },
      _count: { _all: true },
    }),

    // dailySummary
    prisma.case.count({
      where: { ...companyScope, createdAt: { gte: today0, lte: today23 } },
    }),
    personScope
      ? prisma.case.findMany({
          where: {
            ...personScope,
            status: 'Cozuldu',
            resolvedAt: { gte: today0, lte: today23 },
          },
          select: { createdAt: true, resolvedAt: true },
          take: 200,
        })
      : Promise.resolve([]),
  ]);

  // ─── urgentSignals derive ───
  const urgentSignals = [];
  if (slaRiskCount > 0) {
    // caseIds eskiden findMany'den dönüyordu — şimdi count() ile sadece sayı.
    // UI bu alanı kullanmıyordu (yalnız count gösteriliyor); type'a optional kaldı.
    urgentSignals.push({
      type: 'sla_risk',
      count: slaRiskCount,
    });
  }
  if (unreadMentionsCount > 0) {
    urgentSignals.push({ type: 'unread_mentions', count: unreadMentionsCount });
  }
  // awaiting_reply: schema'da author role yok (CaseNote yalnız authorName).
  // Bu sinyali şimdilik atlıyoruz; ileride CaseNote.authorType eklenince doldurulacak.
  if (activePatterns.length > 0) {
    urgentSignals.push({
      type: 'pattern_alert',
      count: activePatterns.length,
      category: activePatterns[0].category,
    });
  }

  // ─── todayCalendar (max ~6 göster, ama 20 dön — frontend kesebilir) ───
  const todayCalendar = [];
  for (const r of todayReminders) {
    todayCalendar.push({
      id: `reminder:${r.id}`,
      type: 'reminder',
      title: r.message ?? 'Hatırlatıcı',
      caseId: r.caseId,
      caseNumber: r.case?.caseNumber ?? null,
      customerName: r.case?.accountName ?? null,
      time: r.remindAt.toISOString(),
    });
  }
  for (const c of todaySnoozeCases) {
    todayCalendar.push({
      id: `snooze:${c.id}`,
      type: 'snooze',
      title: 'Vaka uyanacak',
      caseId: c.id,
      caseNumber: c.caseNumber,
      customerName: c.accountName,
      time: c.snoozeUntil.toISOString(),
    });
  }
  for (const c of todaySlaCases) {
    todayCalendar.push({
      id: `sla:${c.id}`,
      type: 'sla_resolution',
      title: 'SLA çözüm tarihi',
      caseId: c.id,
      caseNumber: c.caseNumber,
      customerName: c.accountName,
      time: c.slaResolutionDueAt.toISOString(),
    });
  }
  todayCalendar.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  // ─── myTopCases — slaViolation desc, priority desc, updatedAt asc → max 5 ───
  const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const sortedTopCases = [...myActiveCases].sort((a, b) => {
    if (a.slaViolation !== b.slaViolation) return a.slaViolation ? -1 : 1;
    const pa = PRIORITY_ORDER[a.priority] ?? 9;
    const pb = PRIORITY_ORDER[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  });
  const myTopCases = sortedTopCases.slice(0, 5).map((c) => ({
    caseId: c.id,
    caseNumber: c.caseNumber,
    title: c.title,
    customerName: c.accountName,
    priority: c.priority,
    status: c.status,
    slaViolation: c.slaViolation,
    aiSignal: deriveAiSignal(c),
  }));

  // ─── pendingApprovals: heuristik öneriler ───
  const pendingApprovals = [];
  // Tip 1 — sla: SLA 6 saatten az kaldıysa
  for (const c of myActiveCases) {
    if (pendingApprovals.length >= 5) break;
    if (!c.slaResolutionDueAt) continue;
    const remainingMs = new Date(c.slaResolutionDueAt).getTime() - now.getTime();
    const remainingHours = remainingMs / (60 * 60 * 1000);
    if (!c.slaViolation && remainingHours > 0 && remainingHours <= 6) {
      pendingApprovals.push({
        caseId: c.id,
        caseNumber: c.caseNumber,
        customerName: c.accountName,
        type: 'sla',
        reason: `SLA ${Math.round(remainingHours)} saat içinde dolacak`,
        suggestedTime: c.slaResolutionDueAt.toISOString(),
      });
    }
  }
  // Tip 2 — followup: bugün takip aramaları (zaten followupTodayLogs sayısı var)
  if (followupTodayLogs.length > 0 && pendingApprovals.length < 5) {
    pendingApprovals.push({
      caseId: null,
      caseNumber: null,
      customerName: null,
      type: 'followup',
      reason: `Bugün ${followupTodayLogs.length} takip araman var`,
      suggestedTime: today23.toISOString(),
    });
  }
  // Tip 3 — reminder: 3+ gün hareketsiz vakalar (kullanıcıya hatırlatıcı kurma önerisi)
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  for (const c of myActiveCases) {
    if (pendingApprovals.length >= 5) break;
    if (c.snoozeUntil && c.snoozeUntil > now) continue; // snoozed → atla
    if (new Date(c.updatedAt) < threeDaysAgo && !c.slaViolation) {
      pendingApprovals.push({
        caseId: c.id,
        caseNumber: c.caseNumber,
        customerName: c.accountName,
        type: 'reminder',
        reason: 'Vakada 3+ gündür hareket yok — hatırlatıcı kurmak ister misin?',
        suggestedTime: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }
  }

  // ─── stats ───
  const stats = {
    assignedToMe: assignedToMeCount,
    resolvedToday: resolvedTodayCount,
    snoozed: snoozedCount,
    followupToday: followupTodayLogs.length,
  };

  // ─── performance ───
  let performance = null;
  if (myQaScoredCases.length >= 3) {
    const myAvg = avgScores(myQaScoredCases);
    // teamQaScoredCases artık aggregate result (_avg + _count). Manuel avgScores
    // yapısına çeviriyoruz — null-safe + 1 desimal yuvarlama (eski JS davranışı).
    const teamA = teamQaScoredCases?._avg ?? {};
    const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
    const teamAvg = {
      empathy: round1(teamA.qaEmpathyScore),
      clarity: round1(teamA.qaClarityScore),
      speed:   round1(teamA.qaSpeedScore),
    };
    performance = {
      period: '30d',
      empathy: scoreDimension(myAvg.empathy, teamAvg.empathy),
      clarity: scoreDimension(myAvg.clarity, teamAvg.clarity),
      speed: scoreDimension(myAvg.speed, teamAvg.speed),
      aiCoachMessage: deriveCoachMessage(myAvg, teamAvg),
    };
  }

  // ─── dailySummary ───
  const totalResolveMs = myResolvedTodayDetailed.reduce((sum, c) => {
    if (!c.resolvedAt || !c.createdAt) return sum;
    return sum + (new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime());
  }, 0);
  const avgResolutionHours =
    myResolvedTodayDetailed.length > 0
      ? Math.round((totalResolveMs / myResolvedTodayDetailed.length / (60 * 60 * 1000)) * 10) / 10
      : 0;
  const dailySummary = {
    resolvedToday: myResolvedTodayDetailed.length,
    newCasesToday,
    avgResolutionHours,
  };

  return {
    greeting: {
      name: fullName.split(' ')[0] || fullName,
      timeOfDay: timeOfDay(now),
    },
    urgentSignals,
    stats,
    todayCalendar,
    pendingApprovals,
    myTopCases,
    performance,
    dailySummary,
  };
}

function avgScores(cases) {
  if (cases.length === 0) return { empathy: null, clarity: null, speed: null };
  let e = 0, cl = 0, sp = 0, n = 0;
  for (const c of cases) {
    if (c.qaEmpathyScore != null && c.qaClarityScore != null && c.qaSpeedScore != null) {
      e += c.qaEmpathyScore;
      cl += c.qaClarityScore;
      sp += c.qaSpeedScore;
      n++;
    }
  }
  if (n === 0) return { empathy: null, clarity: null, speed: null };
  return {
    empathy: Math.round((e / n) * 10) / 10,
    clarity: Math.round((cl / n) * 10) / 10,
    speed: Math.round((sp / n) * 10) / 10,
  };
}

function scoreDimension(myScore, teamScore) {
  if (myScore == null) return { score: null, trend: null, vsTeam: 0 };
  const vsTeam = teamScore != null ? Math.round((myScore - teamScore) * 10) / 10 : 0;
  // trend: ileride zaman serisi takibiyle doldurulacak — şimdilik null.
  return { score: myScore, trend: null, vsTeam };
}

function deriveCoachMessage(my, team) {
  // En düşük skorum hangisi? Buna göre koçluk mesajı.
  const dims = [
    { key: 'empathy', label: 'empati' },
    { key: 'clarity', label: 'açıklık' },
    { key: 'speed', label: 'yanıt hızı' },
  ];
  const filled = dims.filter((d) => my[d.key] != null);
  if (filled.length === 0) return 'Henüz yeterli skor birikmedi.';
  filled.sort((a, b) => my[a.key] - my[b.key]);
  const weakest = filled[0];
  const score = my[weakest.key];
  const teamScore = team[weakest.key];
  if (teamScore != null && score < teamScore) {
    return `${capitalize(weakest.label)} skorunda takım ortalamasının altındasın — bu boyuta odaklanmak iyi olur.`;
  }
  return `${capitalize(weakest.label)} skorun en zayıfın (${score}/5). Geliştirmek için fırsat var.`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function emptyDashboard({ fullName }) {
  return {
    greeting: {
      name: fullName.split(' ')[0] || fullName,
      timeOfDay: timeOfDay(),
    },
    urgentSignals: [],
    stats: { assignedToMe: 0, resolvedToday: 0, snoozed: 0, followupToday: 0 },
    todayCalendar: [],
    pendingApprovals: [],
    myTopCases: [],
    performance: null,
    dailySummary: { resolvedToday: 0, newCasesToday: 0, avgResolutionHours: 0 },
  };
}

/**
 * Hatırlatıcıyı sil — sahibi olan kullanıcı silebilir.
 * Returns true | null (yok / başkasının).
 */
export async function deleteReminder({ id, userId, allowedCompanyIds }) {
  const r = await prisma.caseReminder.findUnique({
    where: { id },
    select: { id: true, userId: true, companyId: true },
  });
  if (!r) return null;
  if (r.userId !== userId) return null; // sahibi değilse 404 göster (yetki sızdırma)
  if (!allowedCompanyIds.includes(r.companyId)) return null;
  await prisma.caseReminder.delete({ where: { id } });
  return true;
}
