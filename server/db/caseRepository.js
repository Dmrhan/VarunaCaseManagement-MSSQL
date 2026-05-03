import { prisma } from './client.js';
import { fromDb, toDb, toDbFilters } from './enumMap.js';
import { createUploadUrl, createDownloadUrl, removeObject } from './storage.js';
import crypto from 'node:crypto';

// Snooze sebebi → CaseActivity log'unda görünen TR etiket.
const SNOOZE_REASON_LABEL = {
  CustomerWillCall: 'Müşteri tekrar arayacak',
  WaitingThirdParty: '3. taraf bekleniyor',
  Reminder: 'Hatırlatıcı',
};

const TR_DATETIME = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * Case repository — vaka CRUD + ilişkili tablolar (notes, files, history, callLogs).
 *
 * Frontend caseService.ts USE_MOCK=false dalında bu repository'e karşılık gelen
 * BFF endpoint'lerini çağıracak. Bu katmanın iki amacı var:
 *  1. Prisma çağrılarını route handler'lardan soyutla → MSSQL'e geçiş tek
 *     katmanı etkiler.
 *  2. Frontend'in beklediği denormalized Case shape'i (companyName, accountName,
 *     notes/files/history/callLogs ilişkili dizileri) ile DB'nin normalized
 *     yapısını birleştir.
 */

// Frontend Case shape'i tek bir SELECT'te hazırla — ilişkili tabloları include et
// History desc: yeni en üstte (uzun yaşayan vakada scroll etmeden son durumu gör)
const CASE_INCLUDE = {
  notes:        { orderBy: { createdAt: 'desc' } },
  attachments:  { orderBy: { uploadedAt: 'desc' } },
  history:      { orderBy: { at: 'desc' } },
  callLogs:     { orderBy: { callDate: 'desc' } },
};

// DB'den gelen Case'i frontend Case tipine çevir:
//  - attachments → files
//  - enum identifier'larını TR string'e geri map'le
//  - callLog'lardaki enum'ları da TR'ye çevir
function shape(c) {
  if (!c) return null;
  const { attachments, callLogs, ...rest } = c;
  const baseShape = fromDb(rest);
  return {
    ...baseShape,
    files: attachments ?? [],
    callLogs: (callLogs ?? []).map((cl) => fromDb(cl)),
  };
}

export const caseRepository = {
  async list({ filters, pagination } = {}) {
    const where = buildWhere(toDbFilters(filters));
    const total = await prisma.case.count({ where });

    const orderBy = { createdAt: 'desc' };

    let items;
    if (pagination) {
      const skip = (pagination.page - 1) * pagination.pageSize;
      items = await prisma.case.findMany({
        where,
        include: CASE_INCLUDE,
        orderBy,
        skip,
        take: pagination.pageSize,
      });
    } else {
      items = await prisma.case.findMany({ where, include: CASE_INCLUDE, orderBy });
    }
    return { items: items.map(shape), total };
  },

  async get(id) {
    const c = await prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE });
    return shape(c);
  },

  async create(input) {
    // input: NewCaseInput shape (caseService.ts §142)
    const caseNumber = `VK-${Date.now().toString(36).toUpperCase()}`;
    // TR string enum'larını ASCII identifier'a çevir
    const m = toDb(input);
    const created = await prisma.case.create({
      data: {
        caseNumber,
        title: m.title,
        description: m.description,
        caseType: m.caseType,
        status: 'Acik',
        priority: m.priority,
        origin: m.origin,
        originDescription: m.originDescription,
        companyId: m.companyId,
        companyName: m.companyName,
        accountId: m.accountId,
        accountName: m.accountName,
        category: m.category,
        subCategory: m.subCategory,
        requestType: m.requestType,
        productGroup: m.productGroup,
        assignedTeamId: m.assignedTeamId,
        assignedTeamName: m.assignedTeamName,
        assignedPersonId: m.assignedPersonId,
        assignedPersonName: m.assignedPersonName,
        // ProactiveTracking
        financialStatus: m.financialStatus,
        productUsage: m.productUsage,
        usageChangeAlert: m.usageChangeAlert,
        responseLevel: m.responseLevel,
        // Churn
        cancellationRequest: m.cancellationRequest,
        offeredSolutions: m.offeredSolutions ?? undefined,
        offerExpiryDate: m.offerExpiryDate ? new Date(m.offerExpiryDate) : undefined,
        offerOutcome: m.offerOutcome,
        offerRejectionReason: m.offerRejectionReason,
        actionTaken: m.actionTaken,
        followUpDate: m.followUpDate ? new Date(m.followUpDate) : undefined,
        // AI
        aiGeneratedFlag: m.aiGeneratedFlag ?? false,
        aiCategoryPrediction: m.aiCategoryPrediction,
        aiPriorityPrediction: m.aiPriorityPrediction,
        aiConfidenceScore: m.aiConfidenceScore,
        aiRejectReason: m.aiRejectReason,
        // Custom Fields (şirket FieldDefinition'larına göre dinamik)
        customFields: m.customFields ?? undefined,
        // Açılış log'u
        history: {
          create: {
            action: 'Vaka oluşturuldu',
            actionType: 'CaseCreated',
            actor: m.createdBy ?? 'Mock User',
          },
        },
      },
      include: CASE_INCLUDE,
    });
    return shape(created);
  },

  async update(id, patch, actor = 'Mock User') {
    // Otomatik alan değişim log'u: değişen her alan için CaseActivity entry'si
    const before = await prisma.case.findUnique({ where: { id } });
    if (!before) return null;

    // Frontend TR string'leri → ASCII identifier
    const dbPatch = toDb(patch);
    // History log frontend ile aynı (TR) görünsün — patch'i orijinal haliyle logla
    const historyEntries = [];
    for (const [field, newVal] of Object.entries(patch)) {
      const oldVal = before[field];
      if (oldVal === dbPatch[field]) continue; // db karşılığı eşitse skip
      if (oldVal == null && newVal == null) continue;
      historyEntries.push({
        action: 'Alan güncellendi',
        actionType: 'FieldUpdate',
        fieldName: field,
        // Log'larda TR string görünsün; ihtiyaç varsa frontend ek format yapar
        fromValue: oldVal == null ? null : String(oldVal),
        toValue: newVal == null ? null : String(newVal),
        actor,
      });
    }

    const updated = await prisma.case.update({
      where: { id },
      data: {
        ...dbPatch,
        history: historyEntries.length > 0 ? { create: historyEntries } : undefined,
      },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  async addNote(id, note) {
    const created = await prisma.caseNote.create({
      data: {
        caseId: id,
        authorName: note.authorName,
        content: note.content,
        visibility: note.visibility,
      },
    });
    await prisma.case.update({ where: { id }, data: { updatedAt: new Date() } });
    return created;
  },

  async addCallLog(id, input) {
    const m = toDb(input);
    const log = await prisma.caseCallLog.create({
      data: {
        caseId: id,
        callDate: m.callDate ? new Date(m.callDate) : new Date(),
        durationMin: m.durationMin,
        callDisposition: m.callDisposition,
        callOutcome: m.callOutcome,
        description: m.description,
        callerId: m.callerId ?? 'mock-user',
        callerName: m.callerName,
        nextFollowupDate: m.nextFollowupDate ? new Date(m.nextFollowupDate) : null,
        lastInteractionDate: new Date(),
      },
    });
    const caseUpdated = await prisma.case.update({
      where: { id },
      data: { updatedAt: new Date() },
      include: CASE_INCLUDE,
    });
    return { caseUpdated: shape(caseUpdated), callLog: fromDb(log) };
  },

  async addActivity(caseId, input) {
    await prisma.caseActivity.create({
      data: {
        caseId,
        action: input.action,
        actionType: input.actionType,
        fieldName: input.fieldName,
        fromValue: input.oldValue,
        toValue: input.newValue,
        note: input.note,
        actor: input.actor ?? 'Mock User',
      },
    });
    const updated = await prisma.case.update({
      where: { id: caseId },
      data: { updatedAt: new Date() },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  async toggleChecklistItem(caseId, itemId, checked, actor = 'Mock User') {
    const c = await prisma.case.findUnique({ where: { id: caseId } });
    if (!c?.checklistItems) return shape(c);

    const items = c.checklistItems.map((it) => {
      if (it.id !== itemId) return it;
      return checked
        ? { ...it, checked: true, checkedAt: new Date().toISOString(), checkedBy: actor }
        : { ...it, checked: false, checkedAt: undefined, checkedBy: undefined };
    });

    const target = c.checklistItems.find((it) => it.id === itemId);
    const updated = await prisma.case.update({
      where: { id: caseId },
      data: {
        checklistItems: items,
        history: {
          create: {
            action: checked ? 'Kontrol maddesi işaretlendi' : 'Kontrol maddesi işareti kaldırıldı',
            actionType: 'ChecklistToggle',
            fieldName: 'checklist',
            toValue: target?.label ?? itemId,
            actor,
          },
        },
      },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  /**
   * Adım 1 — Upload talebi: limit kontrolü + storage'da signed PUT URL üret.
   * Frontend bu URL'e doğrudan PUT eder (Vercel 4.5MB body limiti bypass).
   * DB satırı henüz yazılmaz; finalize() ile yazılır.
   */
  async requestUpload(id, input) {
    const FILE_MAX_SIZE = 25 * 1024 * 1024;
    const FILE_MAX_COUNT = 20;

    const c = await prisma.case.findUnique({
      where: { id },
      include: { attachments: true },
    });
    if (!c) return null;
    if (c.attachments.length >= FILE_MAX_COUNT) {
      return { error: `Bu vakada en fazla ${FILE_MAX_COUNT} dosya olabilir.` };
    }
    if (input.fileSize > FILE_MAX_SIZE) {
      return { error: `Dosya boyutu üst sınırı ${Math.round(FILE_MAX_SIZE / (1024 * 1024))} MB.` };
    }

    // Önceden id üret — Storage path'i bunu kullanır (henüz DB'de yok).
    const attachmentId = `cmsa_${crypto.randomBytes(12).toString('hex')}`;
    const { signedUrl, path } = await createUploadUrl(id, attachmentId, input.fileName);
    return { uploadUrl: signedUrl, path, attachmentId };
  },

  /**
   * Adım 2 — Finalize: storage upload başarılı → DB satırını yaz + history log.
   * Frontend, requestUpload'tan dönen attachmentId/path'i geri gönderir.
   */
  async finalizeUpload(id, input) {
    const actor = input.uploadedBy ?? 'Mock User';
    const file = await prisma.caseAttachment.create({
      data: {
        id: input.attachmentId,
        caseId: id,
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        fileUrl: input.path, // Storage path — download'da signed URL'e dönüşür
        uploadedBy: actor,
      },
    });
    const caseUpdated = await prisma.case.update({
      where: { id },
      data: {
        updatedAt: new Date(),
        history: {
          create: {
            action: 'Dosya yüklendi',
            actionType: 'FileUploaded',
            fieldName: 'files',
            toValue: file.fileName,
            actor,
          },
        },
      },
      include: CASE_INCLUDE,
    });
    return { caseUpdated: shape(caseUpdated), file };
  },

  /** Download için kısa ömürlü signed URL üret. */
  async getDownloadUrl(caseId, fileId) {
    const target = await prisma.caseAttachment.findUnique({ where: { id: fileId } });
    if (!target || target.caseId !== caseId || !target.fileUrl) return null;
    const url = await createDownloadUrl(target.fileUrl);
    return { url, fileName: target.fileName };
  },

  async removeFile(id, fileId, actor = 'Mock User') {
    const target = await prisma.caseAttachment.findUnique({ where: { id: fileId } });
    if (!target || target.caseId !== id) {
      const c = await prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE });
      return shape(c);
    }
    // Önce Storage'dan sil — başarısız olursa DB satırı yine silinir, orphan log'lanır.
    if (target.fileUrl) {
      await removeObject(target.fileUrl);
    }
    await prisma.caseAttachment.delete({ where: { id: fileId } });
    const updated = await prisma.case.update({
      where: { id },
      data: {
        updatedAt: new Date(),
        history: {
          create: {
            action: 'Dosya silindi',
            actionType: 'FileRemoved',
            fieldName: 'files',
            fromValue: target.fileName,
            actor,
          },
        },
      },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  async findOpenCaseFor(accountId, caseType) {
    const found = await prisma.case.findFirst({
      where: {
        accountId,
        caseType,
        status: { notIn: ['Cozuldu', 'IptalEdildi'] },
      },
      include: CASE_INCLUDE,
    });
    return shape(found);
  },

  /**
   * Statü geçişi — SLA pause/resume + eskalasyon log'u + status change history.
   * Spec §6: 3rdPartyBekleniyor'a girilince slaPausedAt set edilir; çıkılınca
   * geçen süre slaPausedDurationMin'e eklenip slaResolutionDueAt ileri kaydırılır.
   */
  async transitionStatus(id, nextStatus, payload = {}, actor = 'Mock User') {
    const prev = await prisma.case.findUnique({ where: { id } });
    if (!prev) return null;

    // TR → ASCII (DB enum identifier)
    const dbNext = toDb({ status: nextStatus }).status;
    const prevStatusTr = fromDb({ status: prev.status }).status; // history'de TR görünsün

    const enteringPause = dbNext === 'ThirdPartyWaiting' && prev.status !== 'ThirdPartyWaiting';
    const leavingPause = prev.status === 'ThirdPartyWaiting' && dbNext !== 'ThirdPartyWaiting';

    let nextSlaPausedAt = prev.slaPausedAt;
    let nextPausedDurationMin = prev.slaPausedDurationMin;
    let nextThirdPartyWaitMin = prev.slaThirdPartyWaitMin;
    let nextResolutionDueAt = prev.slaResolutionDueAt;

    if (enteringPause) {
      nextSlaPausedAt = new Date();
    } else if (leavingPause && prev.slaPausedAt) {
      const pausedMin = Math.round((Date.now() - new Date(prev.slaPausedAt).getTime()) / 60000);
      nextPausedDurationMin += pausedMin;
      nextThirdPartyWaitMin += pausedMin;
      if (prev.slaResolutionDueAt) {
        nextResolutionDueAt = new Date(
          new Date(prev.slaResolutionDueAt).getTime() + pausedMin * 60000,
        );
      }
      nextSlaPausedAt = null;
    }

    const enteringEscalation = dbNext === 'Eskalasyon';
    const newEscalationLevel = enteringEscalation
      ? toDb({ escalationLevel: payload.escalationLevel }).escalationLevel ?? prev.escalationLevel
      : prev.escalationLevel;

    const historyEntries = [
      {
        action: 'Statü değişti',
        actionType: 'StatusChange',
        fromValue: prevStatusTr,
        toValue: nextStatus,
        actor,
      },
    ];

    if (enteringEscalation && payload.escalationLevel) {
      const prevLevelTr = fromDb({ escalationLevel: prev.escalationLevel }).escalationLevel;
      if (payload.escalationLevel !== prevLevelTr) {
        historyEntries.push({
          action: 'Eskalasyon seviyesi',
          actionType: 'FieldUpdate',
          fieldName: 'escalationLevel',
          fromValue: prevLevelTr,
          toValue: payload.escalationLevel,
          actor,
        });
      }
    }
    if (enteringEscalation && payload.escalationReason) {
      historyEntries.push({
        action: 'Eskalasyon gerekçesi',
        toValue: payload.escalationReason,
        actor,
      });
    }

    const updated = await prisma.case.update({
      where: { id },
      data: {
        status: dbNext,
        resolutionNote: payload.resolutionNote ?? prev.resolutionNote,
        cancellationReason: payload.cancellationReason ?? prev.cancellationReason,
        thirdPartyId: enteringPause ? payload.thirdPartyId ?? prev.thirdPartyId : prev.thirdPartyId,
        thirdPartyName: enteringPause ? payload.thirdPartyName ?? prev.thirdPartyName : prev.thirdPartyName,
        escalationLevel: newEscalationLevel,
        slaPausedAt: nextSlaPausedAt,
        slaPausedDurationMin: nextPausedDurationMin,
        slaThirdPartyWaitMin: nextThirdPartyWaitMin,
        slaResolutionDueAt: nextResolutionDueAt,
        resolvedAt: dbNext === 'Cozuldu' ? new Date() : prev.resolvedAt,
        history: { create: historyEntries },
      },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  /**
   * Vakayı ertele — snoozeUntil + snoozeReason + snoozePreviousStatus set,
   * status değişmez. unsnooze/cron-wakeup snoozePreviousStatus'a geri döner.
   */
  async snoozeCase(id, { snoozeUntil, snoozeReason }, actor = 'Mock User') {
    const target = new Date(snoozeUntil);
    if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) {
      return { error: 'snoozeUntil gelecek bir tarih olmalı.' };
    }
    if (!SNOOZE_REASON_LABEL[snoozeReason]) {
      return { error: 'snoozeReason geçersiz.' };
    }
    const exists = await prisma.case.findUnique({ where: { id } });
    if (!exists) return null;

    const reasonLabel = SNOOZE_REASON_LABEL[snoozeReason];
    const updated = await prisma.case.update({
      where: { id },
      data: {
        snoozeUntil: target,
        snoozeReason,
        // Mevcut statü tekrar açılırken geri yüklensin diye sakla.
        // Tekrar erteleme durumunda mevcut snoozePreviousStatus korunmalı:
        // status zaten ertelemeden beri değişmemiş olmalı.
        snoozePreviousStatus: exists.snoozePreviousStatus ?? exists.status,
        history: {
          create: {
            action: `Vaka ertelendi → ${TR_DATETIME.format(target)} — ${reasonLabel}`,
            actionType: 'FieldUpdate',
            fieldName: 'snoozeUntil',
            toValue: target.toISOString(),
            actor,
          },
        },
      },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  /**
   * Erteleme kaldır — snooze alanlarını temizle, snoozePreviousStatus'a dön.
   * Yoksa Acik fallback (yalnızca Cozuldu/IptalEdildi değilse).
   */
  async unsnoozeCase(id, actor = 'Mock User') {
    const exists = await prisma.case.findUnique({ where: { id } });
    if (!exists) return null;
    if (!exists.snoozeUntil) {
      return shape(await prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE }));
    }

    const restored = pickRestoreStatus(exists.snoozePreviousStatus, exists.status);
    const restoredTr = fromDb({ status: restored }).status;
    const updated = await prisma.case.update({
      where: { id },
      data: {
        snoozeUntil: null,
        snoozeReason: null,
        snoozePreviousStatus: null,
        status: restored,
        history: {
          create: {
            action: `Erteleme kaldırıldı → ${restoredTr}`,
            actionType: 'FieldUpdate',
            fieldName: 'snoozeUntil',
            fromValue: exists.snoozeUntil.toISOString(),
            toValue: restoredTr,
            actor,
          },
        },
      },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  /**
   * Inbox "Ertelendi" sekmesi — kullanıcının ertelediği vakalar (aktif + süresi
   * dolmuş ama cron tarafından henüz uyandırılmamış olanlar). Cron 5 dakikada
   * bir çalıştığı için 0-5 dakikalık bir aralıkta "expired" görünebilir; UI
   * bunu amber rozetle gösterir ve kullanıcının manuel kaldırmasını sağlar.
   *
   * Sıralama: expired olanlar önce (en eski uyanmış en üstte → aciliyet),
   * sonra aktif erteleler (en yakın uyanacak en üstte).
   */
  async listSnoozedForUser(personId) {
    if (!personId) return { items: [], total: 0 };
    const rows = await prisma.case.findMany({
      where: {
        assignedPersonId: personId,
        snoozeUntil: { not: null },
      },
      include: CASE_INCLUDE,
    });
    const now = Date.now();
    const items = rows.map((row) => {
      const expired = row.snoozeUntil && row.snoozeUntil.getTime() <= now;
      return { ...shape(row), expired: Boolean(expired) };
    });
    items.sort((a, b) => {
      if (a.expired !== b.expired) return a.expired ? -1 : 1;
      return new Date(a.snoozeUntil).getTime() - new Date(b.snoozeUntil).getTime();
    });
    return { items, total: items.length };
  },

  /**
   * Cron (her 5 dk) — snoozeUntil geçmiş vakaları Acik'e döndür, log üret.
   * Mutation idempotent: zaten snoozeUntil null olanlar where'de eşleşmez.
   * Bildirim tetikleme şu aşamada uygulama-içi log; Faz 2 §6 bildirim sistemi
   * canlı olunca CaseNotification kaydı buradan üretilir.
   */
  async processSnoozeWakeups() {
    const due = await prisma.case.findMany({
      where: {
        snoozeUntil: { lte: new Date() },
        NOT: { snoozeUntil: null },
      },
      select: { id: true, status: true, snoozeReason: true, snoozePreviousStatus: true },
    });
    if (due.length === 0) return { woken: 0, ids: [] };

    const woken = [];
    for (const c of due) {
      const restored = pickRestoreStatus(c.snoozePreviousStatus, c.status);
      const restoredTr = fromDb({ status: restored }).status;
      const reasonLabel = c.snoozeReason ? SNOOZE_REASON_LABEL[c.snoozeReason] : '—';
      await prisma.case.update({
        where: { id: c.id },
        data: {
          snoozeUntil: null,
          snoozeReason: null,
          snoozePreviousStatus: null,
          status: restored,
          history: {
            create: {
              action: `Erteleme süresi doldu → ${restoredTr} (${reasonLabel})`,
              actionType: 'FieldUpdate',
              fieldName: 'snoozeUntil',
              toValue: restoredTr,
              actor: 'Sistem (cron)',
            },
          },
        },
      });
      woken.push(c.id);
    }
    return { woken: woken.length, ids: woken };
  },

  async findByAccount(accountId, options = {}) {
    const where = { accountId };
    if (options.excludeId) where.NOT = { id: options.excludeId };
    const mapStatuses = (arr) => arr.map((s) => toDb({ status: s }).status);
    if (options.statusIn) where.status = { in: mapStatuses(options.statusIn) };
    if (options.statusNotIn) {
      where.status = { ...(where.status ?? {}), notIn: mapStatuses(options.statusNotIn) };
    }
    const items = await prisma.case.findMany({ where, include: CASE_INCLUDE });
    return items.map(shape);
  },
};

// ----- helpers -----

// Snooze sonrası dönüş statüsü kararı:
//  - snoozePreviousStatus varsa ona dön (3rdPartyBekleniyor gibi statüler korunsun)
//  - Yoksa: mevcut Cozuldu/IptalEdildi'yse oraya bırak, değilse Acik fallback
//  - Tüm değerler ASCII identifier (Prisma enum), TR mapping caller'ın işi.
function pickRestoreStatus(previous, current) {
  if (previous) return previous;
  if (['Cozuldu', 'IptalEdildi'].includes(current)) return current;
  return 'Acik';
}

function buildWhere(f) {
  if (!f) f = {};
  const where = {};
  const andClauses = [];
  // Default: snooze aktif vakalar (snoozeUntil > now) listede gizli — "Later"
  // sekmesi ayrı endpoint kullanıyor. includeSnoozed flag ile override edilir.
  if (!f.includeSnoozed) {
    andClauses.push({ OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: new Date() } }] });
  }
  if (f.search) {
    const q = f.search.trim();
    if (q) {
      andClauses.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { caseNumber: { contains: q, mode: 'insensitive' } },
          { accountName: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
  }
  if (andClauses.length) where.AND = andClauses;
  if (f.statuses?.length) where.status = { in: f.statuses };
  if (f.caseType && f.caseType !== 'Tümü') where.caseType = f.caseType;
  if (f.priorities?.length) where.priority = { in: f.priorities };
  if (f.teamId) where.assignedTeamId = f.teamId;
  if (f.personId) where.assignedPersonId = f.personId;
  if (f.dateFrom) where.createdAt = { ...(where.createdAt ?? {}), gte: new Date(f.dateFrom) };
  if (f.dateTo) {
    const to = new Date(f.dateTo);
    to.setHours(23, 59, 59, 999);
    where.createdAt = { ...(where.createdAt ?? {}), lte: to };
  }
  return where;
}
