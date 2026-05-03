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
    want('snooze') && personId
      ? prisma.case.findMany({
          where: {
            ...companyScope,
            assignedPersonId: personId,
            snoozeUntil: { not: null, ...dateRange },
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

    // 3) SLA yanıt tarihi — me'nin atanan vakaları, henüz ihlal yok
    want('sla_response') && personId
      ? prisma.case.findMany({
          where: {
            ...companyScope,
            assignedPersonId: personId,
            slaResponseDueAt: { not: null, ...dateRange },
            slaViolation: false,
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

    // 4) SLA çözüm tarihi — aynı kural
    want('sla_resolution') && personId
      ? prisma.case.findMany({
          where: {
            ...companyScope,
            assignedPersonId: personId,
            slaResolutionDueAt: { not: null, ...dateRange },
            slaViolation: false,
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
    // olduğu için case'in assigned person'ı üzerinden filtreliyoruz.
    want('followup') && personId
      ? prisma.caseCallLog.findMany({
          where: {
            ...companyScope,
            nextFollowupDate: { not: null, ...dateRange },
            case: { assignedPersonId: personId },
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
