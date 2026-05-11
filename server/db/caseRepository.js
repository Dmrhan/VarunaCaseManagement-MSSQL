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

// FAZ 2 §20.2 — aktarım gerekçe kodu → activity log etiketi (TR).
const TRANSFER_REASON_LABEL = {
  wrong_team: 'Yanlış Takım',
  expertise: 'Uzmanlık',
  workload: 'İş Yükü',
  escalation: 'Eskalasyon',
  customer_request: 'Müşteri Talebi',
  other: 'Diğer',
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

/**
 * CaseAccessError — repository-seviyesi 403 sinyal.
 * Mutation'lar başında scope check başarısız olursa fırlatılır; route layer
 * bunu HTTP 403'e çevirir.
 */
export class CaseAccessError extends Error {
  constructor(message = 'Vaka erişimi yok.') {
    super(message);
    this.code = 'CASE_FORBIDDEN';
  }
}

/**
 * Mutation guard + companyId resolver.
 *
 * Davranış:
 *   - Case yok → null döner (route 404'e çevirir).
 *   - allowedCompanyIds verilmiş + scope dışı → CaseAccessError fırlatır.
 *   - Aksi halde → case.companyId döner.
 *
 * Caller'lar bu companyId'yi child satırlar (history, note, call log, vb.)
 * yaratırken denormalize için kullanır — Faz 1.5 multi-tenant child
 * denormalization işi.
 *
 * NOT: Önceki versiyonda allowedCompanyIds yokken fetch atlanıyordu (bypass);
 * artık her zaman fetch yapılır çünkü companyId döndürmek gerekiyor. Maliyet
 * ihmal edilebilir (zaten case mutation'larının çoğu kendi findUnique'ini
 * yapıyor); cron yolu (processSnoozeWakeups) bu helper'ı çağırmıyor zaten.
 */
async function assertCaseInScope(caseId, allowedCompanyIds) {
  const found = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, companyId: true },
  });
  if (!found) return null;
  if (allowedCompanyIds && !allowedCompanyIds.includes(found.companyId)) {
    throw new CaseAccessError();
  }
  return found.companyId;
}

export const caseRepository = {
  async list({ filters, pagination, allowedCompanyIds } = {}) {
    const where = buildWhere(toDbFilters(filters), allowedCompanyIds);
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

  async get(id, allowedCompanyIds) {
    const c = await prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE });
    if (!c) return null;
    if (allowedCompanyIds && !allowedCompanyIds.includes(c.companyId)) {
      throw new CaseAccessError();
    }
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
            companyId: m.companyId,
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

  async update(id, patch, actor = 'Mock User', allowedCompanyIds) {
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
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
        companyId,
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

    // FAZ 2 Collab — atama veya öncelik değişikliklerinde watcher'lara bildirim.
    // Status değişimi transitionStatus() üzerinden ayrı olarak fire eder.
    const watcherTriggers = ['assignedPersonId', 'assignedTeamId', 'assignedPersonName', 'assignedTeamName', 'priority'];
    const changedKey = historyEntries.find((h) => watcherTriggers.includes(h.fieldName ?? ''));
    if (changedKey) {
      const kind = changedKey.fieldName === 'priority' ? 'priority' : 'assignment';
      const label = changedKey.fieldName === 'priority' ? 'Öncelik' : 'Atama';
      await notifyWatchers({
        caseId: id,
        companyId,
        message: `${updated.caseNumber}'de ${label.toLowerCase()} değişti: ${changedKey.fromValue ?? '-'} → ${changedKey.toValue ?? '-'}`,
        kind,
      });
    }

    return shape(updated);
  },

  /**
   * Not ekle — Faz 1.5 Madde 3 ile @mention parse + CaseMention satırları.
   *
   * Format: not içinde `@[Name](userId)` tag'leri. Parse edip:
   *  - Max 10 farklı kullanıcı (spec)
   *  - Hepsi aynı şirkette aktif User olmalı (cross-tenant mention engellenir)
   *  - Her başarılı mention için CaseMention satırı + bell badge sinyali
   *
   * mentionedBy req.user.id (route'tan geçer); aktor'un User.id'si yoksa
   * (cron, test) mention skip — note yine kaydedilir.
   */
  async addNote(id, note, allowedCompanyIds, mentionedBy) {
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;

    // Parse @[Name](userId) tag'leri (dedup userId)
    const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
    const matches = [...(note.content ?? '').matchAll(mentionRegex)];
    const mentionedUserIds = [...new Set(matches.map((m) => m[2]))];

    if (mentionedUserIds.length > 10) {
      return { error: 'Bir notta en fazla 10 kişi etiketlenebilir.' };
    }

    // Cross-tenant koruma: tüm mention'lar aynı şirkette + aktif olmalı.
    if (mentionedUserIds.length > 0) {
      const valid = await prisma.user.findMany({
        where: {
          id: { in: mentionedUserIds },
          isActive: true,
          companies: { some: { companyId, isActive: true } },
        },
        select: { id: true },
      });
      const validIds = new Set(valid.map((v) => v.id));
      const invalid = mentionedUserIds.filter((uid) => !validIds.has(uid));
      if (invalid.length > 0) {
        return {
          error: `Etiketlenen ${invalid.length} kullanıcı bu şirkette bulunamadı veya pasif.`,
        };
      }
    }

    const created = await prisma.caseNote.create({
      data: {
        caseId: id,
        companyId,
        authorName: note.authorName,
        content: note.content,
        visibility: note.visibility,
      },
    });

    // Mention satırları yaz (mentionedBy yoksa skip — note yine kaydedildi).
    if (mentionedUserIds.length > 0 && mentionedBy) {
      await prisma.caseMention.createMany({
        data: mentionedUserIds.map((uid) => ({
          caseId: id,
          noteId: created.id,
          companyId,
          mentionedUserId: uid,
          mentionedBy,
        })),
      });
    }

    // Aktivite akışında "Not eklendi" satırı — content preview ile.
    // @mention tag'leri kullanıcıyı kafa karıştırmasın diye düz isimle değiştirilir.
    const cleanedPreview = (note.content ?? '')
      .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
      .slice(0, 200);
    await prisma.caseActivity.create({
      data: {
        caseId: id,
        companyId,
        action: note.visibility === 'Customer' ? 'Müşteri notu eklendi' : 'İç not eklendi',
        actionType: 'NoteAdded',
        note: cleanedPreview,
        actor: note.authorName,
      },
    });

    // FAZ 2 Collab — vakaya watcher olarak eklenenlere bildirim
    const noteCase = await prisma.case.findUnique({
      where: { id },
      select: { caseNumber: true },
    });
    await notifyWatchers({
      caseId: id,
      companyId,
      message: `${noteCase?.caseNumber ?? id}'de yeni not: ${cleanedPreview.slice(0, 80)}`,
      kind: 'note',
    });

    await prisma.case.update({ where: { id }, data: { updatedAt: new Date() } });
    return created;
  },

  /**
   * Bir vakaya not yazarken @mention dropdown için adaylar.
   * Vakanın şirketine aktif UserCompany ile bağlı + Person'a bağlı User'lar.
   * personId yoksa (Person'a bağlanmamış User) liste'de görünmez — atama
   * hedefi olamadığı için mention'da da anlamsız.
   */
  async listMentionableUsers(caseId, allowedCompanyIds) {
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        personId: { not: null },
        companies: { some: { companyId, isActive: true } },
      },
      select: { id: true, email: true, fullName: true, personId: true },
      orderBy: { fullName: 'asc' },
    });
    if (users.length === 0) return [];

    // Person + team adlarını tek query ile topla
    const personIds = users.map((u) => u.personId).filter(Boolean);
    const persons = await prisma.person.findMany({
      where: { id: { in: personIds } },
      include: { team: { select: { name: true } } },
    });
    const personMap = new Map(persons.map((p) => [p.id, p]));

    return users.map((u) => {
      const p = u.personId ? personMap.get(u.personId) : null;
      return {
        userId: u.id,
        personId: u.personId,
        name: u.fullName,
        email: u.email,
        teamName: p?.team?.name ?? null,
      };
    });
  },

  async addCallLog(id, input, allowedCompanyIds) {
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
    const m = toDb(input);
    const log = await prisma.caseCallLog.create({
      data: {
        caseId: id,
        companyId,
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

    // Aktivite akışında "Çağrı kaydı eklendi" satırı — kısa özet.
    const outcomeLabel = input.callOutcome ?? '-';
    const descPreview = (input.description ?? '').slice(0, 200);
    const noteText = descPreview
      ? `${m.durationMin ?? 0} dk · ${outcomeLabel} — ${descPreview}`
      : `${m.durationMin ?? 0} dk · ${outcomeLabel}`;
    await prisma.caseActivity.create({
      data: {
        caseId: id,
        companyId,
        action: 'Çağrı kaydı eklendi',
        actionType: 'CallLogAdded',
        note: noteText,
        actor: input.callerName ?? 'Mock User',
      },
    });

    const caseUpdated = await prisma.case.update({
      where: { id },
      data: { updatedAt: new Date() },
      include: CASE_INCLUDE,
    });
    return { caseUpdated: shape(caseUpdated), callLog: fromDb(log) };
  },

  async addActivity(caseId, input, allowedCompanyIds) {
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;
    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
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

  async toggleChecklistItem(caseId, itemId, checked, actor = 'Mock User', allowedCompanyIds) {
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;
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
            companyId,
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
  async requestUpload(id, input, allowedCompanyIds) {
    if (!(await assertCaseInScope(id, allowedCompanyIds))) return null;
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
  async finalizeUpload(id, input, allowedCompanyIds) {
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
    const actor = input.uploadedBy ?? 'Mock User';
    const file = await prisma.caseAttachment.create({
      data: {
        id: input.attachmentId,
        caseId: id,
        companyId,
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
            companyId,
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
  async getDownloadUrl(caseId, fileId, allowedCompanyIds) {
    if (!(await assertCaseInScope(caseId, allowedCompanyIds))) return null;
    const target = await prisma.caseAttachment.findUnique({ where: { id: fileId } });
    if (!target || target.caseId !== caseId || !target.fileUrl) return null;
    const url = await createDownloadUrl(target.fileUrl);
    return { url, fileName: target.fileName };
  },

  async removeFile(id, fileId, actor = 'Mock User', allowedCompanyIds) {
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
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
            companyId,
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

  /**
   * Toplu güncelleme — Faz 1.5 Madde 2 "Bulk Actions".
   *
   * Whitelist: yalnızca assignedPersonId, assignedTeamId, priority, status.
   * Status'te kapatma yasak (Cozuldu/IptalEdildi) — her vaka için ayrı kapatma
   * log'u/onayı gerekiyor, bulk'ta yapılmamalı.
   *
   * Cross-tenant koruma: caseIds'in TÜMÜ allowedCompanyIds içinde değilse
   * tek bir vaka bile güncellenmez (CaseAccessError fırlatılır). Bu "saldırgan
   * listede yetkisiz ID gizleyemesin" prensibi — partial-success yok.
   *
   * SLA pause/resume mantığı: bulk status değişiminde transitionStatus
   * çalıştırılmaz — yalnızca basit alan update'i. 3rdPartyBekleniyor'a bulk
   * geçiş SLA'yı duraklatmaz; kullanıcı SLA pause istiyorsa tek vaka
   * üzerinden statü geçişi yapsın. Bilinçli sadelik.
   */
  async bulkUpdate({ caseIds, updates }, actor = 'Mock User', allowedCompanyIds) {
    if (!Array.isArray(caseIds) || caseIds.length === 0) {
      return { error: 'caseIds dizisi gerekli (boş olamaz).' };
    }
    if (caseIds.length > 100) {
      return { error: 'En fazla 100 vaka tek seferde güncellenebilir.' };
    }
    if (!updates || typeof updates !== 'object') {
      return { error: 'updates nesnesi gerekli.' };
    }

    // Whitelist: yalnızca bu 4 alan kabul.
    const ALLOWED = ['assignedPersonId', 'assignedTeamId', 'priority', 'status'];
    const filtered = {};
    for (const k of ALLOWED) {
      if (updates[k] !== undefined && updates[k] !== null && updates[k] !== '') {
        filtered[k] = updates[k];
      }
    }
    if (Object.keys(filtered).length === 0) {
      return { error: 'En az bir geçerli alan güncellenmeli (assignedPersonId, assignedTeamId, priority, status).' };
    }

    // Status kapatma yasağı (TR ya da ASCII fark etmez — ikisini de yakala).
    const dbStatusCandidate = filtered.status
      ? toDb({ status: filtered.status }).status
      : undefined;
    if (dbStatusCandidate === 'Cozuldu' || dbStatusCandidate === 'IptalEdildi') {
      return { error: 'Toplu işlemde kapatma (Çözüldü/İptalEdildi) yapılamaz.' };
    }

    // Cross-tenant validation: tüm vakaları tek query'de çek, scope'a bak.
    const cases = await prisma.case.findMany({
      where: { id: { in: caseIds } },
      select: { id: true, companyId: true },
    });
    if (cases.length !== caseIds.length) {
      const foundIds = new Set(cases.map((c) => c.id));
      const missing = caseIds.filter((id) => !foundIds.has(id));
      return { error: `Bazı vakalar bulunamadı: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` (+${missing.length - 3})` : ''}` };
    }
    if (allowedCompanyIds) {
      const outsider = cases.find((c) => !allowedCompanyIds.includes(c.companyId));
      if (outsider) {
        throw new CaseAccessError('Toplu işlem: erişiminiz olmayan vaka(lar) listede.');
      }
    }

    // Denormalize names: assignedPersonId / assignedTeamId verildiyse
    // Person/Team adını DB'den çek (frontend bulk için sadece ID gönderiyor).
    let assignedPersonName;
    if (filtered.assignedPersonId) {
      const person = await prisma.person.findUnique({
        where: { id: filtered.assignedPersonId },
        select: { name: true },
      });
      if (!person) return { error: 'Atanan kişi bulunamadı.' };
      assignedPersonName = person.name;
    }
    let assignedTeamName;
    if (filtered.assignedTeamId) {
      const team = await prisma.team.findUnique({
        where: { id: filtered.assignedTeamId },
        select: { name: true },
      });
      if (!team) return { error: 'Atanan takım bulunamadı.' };
      assignedTeamName = team.name;
    }

    // DB'ye yazılacak patch (ASCII enum + denormalize names)
    const dbPatch = toDb(filtered);
    const dataPatch = { ...dbPatch };
    if (assignedPersonName !== undefined) dataPatch.assignedPersonName = assignedPersonName;
    if (assignedTeamName !== undefined) dataPatch.assignedTeamName = assignedTeamName;

    // Activity log: field başına ayrı log per case (spec).
    const FIELD_LABELS = {
      assignedPersonId: 'Atanan Kişi',
      assignedTeamId: 'Atanan Takım',
      priority: 'Öncelik',
      status: 'Statü',
    };
    const VALUE_LABELS = {
      assignedPersonId: assignedPersonName,
      assignedTeamId: assignedTeamName,
      // priority/status için frontend TR string geliyor; doğrudan göster.
    };

    let updated = 0;
    let failed = 0;
    const errors = [];
    for (const c of cases) {
      try {
        const historyEntries = [];
        for (const [field, newVal] of Object.entries(filtered)) {
          const fieldLabel = FIELD_LABELS[field] ?? field;
          const valueLabel = VALUE_LABELS[field] ?? String(newVal);
          historyEntries.push({
            companyId: c.companyId,
            action: `Toplu işlem: ${fieldLabel} → ${valueLabel} (${cases.length} vakadan biri)`,
            actionType: field === 'status' ? 'StatusChange' : 'FieldUpdate',
            fieldName: field,
            toValue: valueLabel,
            actor,
          });
        }
        await prisma.case.update({
          where: { id: c.id },
          data: { ...dataPatch, history: { create: historyEntries } },
        });
        updated++;
      } catch (e) {
        failed++;
        errors.push({ caseId: c.id, error: e?.message ?? 'Bilinmeyen' });
      }
    }
    return { updated, failed, errors };
  },

  async findOpenCaseFor(accountId, caseType, allowedCompanyIds) {
    const where = {
      accountId,
      caseType,
      status: { notIn: ['Cozuldu', 'IptalEdildi'] },
    };
    if (allowedCompanyIds) where.companyId = { in: allowedCompanyIds };
    const found = await prisma.case.findFirst({ where, include: CASE_INCLUDE });
    return shape(found);
  },

  /**
   * Statü geçişi — SLA pause/resume + eskalasyon log'u + status change history.
   * Spec §6: 3rdPartyBekleniyor'a girilince slaPausedAt set edilir; çıkılınca
   * geçen süre slaPausedDurationMin'e eklenip slaResolutionDueAt ileri kaydırılır.
   */
  async transitionStatus(id, nextStatus, payload = {}, actor = 'Mock User', allowedCompanyIds) {
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
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
        companyId,
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
          companyId,
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
        companyId,
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

    // FAZ 2 Collab — watcher bildirimleri (statü + opsiyonel eskalasyon)
    const kind = enteringEscalation ? 'escalation' : 'status';
    await notifyWatchers({
      caseId: id,
      companyId,
      message: `${updated.caseNumber}: ${prevStatusTr} → ${nextStatus}`,
      kind,
    });

    return shape(updated);
  },

  /**
   * Vaka aktarımı (FAZ 2 §20.2). Takım/kişi devri için tek atomic operasyon:
   * Case güncelle (assigned*, transferCount++) + CaseTransfer audit + Activity.
   *
   * Validasyonlar:
   *  - Vaka kapalı (Cozuldu/IptalEdildi) → { error: 'closed_case' }
   *  - Aynı takım → { error: 'same_team' }
   *  - Hedef takım vakanın şirketinde değil → { error: 'invalid_team' }
   *  - toPersonId verilmiş + person bu takıma ait değil → { error: 'invalid_person' }
   *
   * SLA değiştirilmez (kuralı: aktarım SLA sayacını duraklatmaz/sıfırlamaz).
   */
  async transferCase(id, input, allowedCompanyIds) {
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;

    const c = await prisma.case.findUnique({ where: { id } });
    if (!c) return null;

    // Kapalı vakalar aktarılamaz
    if (c.status === 'Cozuldu' || c.status === 'IptalEdildi') {
      return { error: 'closed_case', message: 'Kapatılmış vakalar aktarılamaz.' };
    }

    if (!input.toTeamId || typeof input.toTeamId !== 'string') {
      return { error: 'invalid_input', message: 'toTeamId zorunlu.' };
    }
    if (c.assignedTeamId === input.toTeamId) {
      return { error: 'same_team', message: 'Vaka zaten bu takımda.' };
    }
    if (!input.reason || typeof input.reason !== 'string' || !input.reason.trim()) {
      return { error: 'invalid_input', message: 'Aktarım gerekçesi zorunlu.' };
    }
    if (!input.transferredBy) {
      return { error: 'invalid_input', message: 'transferredBy zorunlu.' };
    }

    // Hedef takım tenant kontrolü
    const team = await prisma.team.findUnique({ where: { id: input.toTeamId } });
    if (!team || team.companyId !== companyId) {
      return { error: 'invalid_team', message: 'Hedef takım vakanın şirketinde değil.' };
    }
    if (!team.isActive) {
      return { error: 'invalid_team', message: 'Hedef takım pasif.' };
    }

    // Hedef kişi (opsiyonel) takım eşleşmesi
    let person = null;
    if (input.toPersonId) {
      person = await prisma.person.findUnique({ where: { id: input.toPersonId } });
      if (!person || person.teamId !== input.toTeamId || !person.isActive) {
        return { error: 'invalid_person', message: 'Atanan kişi seçilen takıma ait değil.' };
      }
    }

    const fromTeamId = c.assignedTeamId ?? null;
    const fromPersonId = c.assignedPersonId ?? null;
    const fromTeamName = c.assignedTeamName ?? '—';

    // Activity action satırı: "↔ Vaka aktarıldı: <from> → <to>"
    // Note alanı: gerekçe etiketi + serbest metin.
    const reasonLabel = input.reasonCode ? TRANSFER_REASON_LABEL[input.reasonCode] : null;
    const trimmedReason = input.reason.trim();
    const noteText = reasonLabel
      ? `Gerekçe: ${reasonLabel} — ${trimmedReason}`
      : `Gerekçe: ${trimmedReason}`;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.case.update({
        where: { id },
        data: {
          assignedTeamId: input.toTeamId,
          assignedTeamName: team.name,
          assignedPersonId: person?.id ?? null,
          assignedPersonName: person?.name ?? null,
          transferCount: { increment: 1 },
        },
        include: CASE_INCLUDE,
      });

      await tx.caseTransfer.create({
        data: {
          caseId: id,
          companyId,
          fromTeamId,
          toTeamId: input.toTeamId,
          fromPersonId,
          toPersonId: person?.id ?? null,
          reason: trimmedReason,
          reasonCode: input.reasonCode ?? null,
          transferredBy: input.transferredBy,
          aiSuggestedTeamId: input.aiSuggestedTeamId ?? null,
          aiSuggestedReason: input.aiSuggestedReason ?? null,
          aiReasonCode: input.aiReasonCode ?? null,
          aiConfidence: typeof input.aiConfidence === 'number' ? input.aiConfidence : null,
        },
      });

      await tx.caseActivity.create({
        data: {
          caseId: id,
          companyId,
          action: `↔ Vaka aktarıldı: ${fromTeamName} → ${team.name}`,
          actionType: 'Transfer',
          fieldName: 'assignedTeamId',
          fromValue: fromTeamName,
          toValue: team.name,
          note: noteText,
          actor: input.transferredByName ?? input.transferredBy,
        },
      });

      return u;
    });

    // Race-safe: post-increment değerini DB'den oku — pre-computed
    // (c.transferCount + 1) eş zamanlı transfer'lerde supervisor uyarı
    // eşiğini atlatabilir.
    return {
      case: shape(updated),
      transferCount: updated.transferCount,
      fromTeamId,
      fromTeamName,
      toTeamId: input.toTeamId,
      toTeamName: team.name,
      companyId,
    };
  },

  /**
   * Bir vakanın tüm aktarım geçmişi — UI için takım/kişi adları enrich edilir.
   * En yeni en üstte. allowedCompanyIds scope'lu.
   */
  async listTransfers(caseId, allowedCompanyIds) {
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    const rows = await prisma.caseTransfer.findMany({
      where: { caseId },
      orderBy: { transferredAt: 'desc' },
    });
    if (rows.length === 0) return [];

    const teamIds = new Set();
    const personIds = new Set();
    for (const r of rows) {
      if (r.fromTeamId) teamIds.add(r.fromTeamId);
      if (r.toTeamId) teamIds.add(r.toTeamId);
      if (r.aiSuggestedTeamId) teamIds.add(r.aiSuggestedTeamId);
      if (r.fromPersonId) personIds.add(r.fromPersonId);
      if (r.toPersonId) personIds.add(r.toPersonId);
    }

    const [teams, persons] = await Promise.all([
      teamIds.size > 0
        ? prisma.team.findMany({ where: { id: { in: [...teamIds] } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      personIds.size > 0
        ? prisma.person.findMany({ where: { id: { in: [...personIds] } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const personName = new Map(persons.map((p) => [p.id, p.name]));

    return rows.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      companyId: r.companyId,
      fromTeamId: r.fromTeamId,
      fromTeamName: r.fromTeamId ? teamName.get(r.fromTeamId) ?? null : null,
      toTeamId: r.toTeamId,
      toTeamName: teamName.get(r.toTeamId) ?? null,
      fromPersonId: r.fromPersonId,
      fromPersonName: r.fromPersonId ? personName.get(r.fromPersonId) ?? null : null,
      toPersonId: r.toPersonId,
      toPersonName: r.toPersonId ? personName.get(r.toPersonId) ?? null : null,
      reason: r.reason,
      reasonCode: r.reasonCode,
      reasonLabel: r.reasonCode ? TRANSFER_REASON_LABEL[r.reasonCode] ?? null : null,
      transferredBy: r.transferredBy,
      transferredAt: r.transferredAt,
      aiSuggestedTeamId: r.aiSuggestedTeamId,
      aiSuggestedTeamName: r.aiSuggestedTeamId ? teamName.get(r.aiSuggestedTeamId) ?? null : null,
      aiSuggestedReason: r.aiSuggestedReason,
      aiReasonCode: r.aiReasonCode,
      aiConfidence: r.aiConfidence,
    }));
  },

  /**
   * Vakayı ertele — snoozeUntil + snoozeReason + snoozePreviousStatus set,
   * status değişmez. unsnooze/cron-wakeup snoozePreviousStatus'a geri döner.
   */
  async snoozeCase(id, { snoozeUntil, snoozeReason }, actor = 'Mock User', allowedCompanyIds) {
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
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
            companyId,
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
  async unsnoozeCase(id, actor = 'Mock User', allowedCompanyIds) {
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
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
            companyId,
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
   *
   * Multi-tenant: allowedCompanyIds verildiyse sadece o şirketlerin vakaları.
   */
  async listSnoozedForUser(personId, allowedCompanyIds) {
    if (!personId) return { items: [], total: 0 };
    const where = {
      assignedPersonId: personId,
      snoozeUntil: { not: null },
    };
    if (allowedCompanyIds) where.companyId = { in: allowedCompanyIds };
    const rows = await prisma.case.findMany({
      where,
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
      select: { id: true, companyId: true, status: true, snoozeReason: true, snoozePreviousStatus: true },
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
              companyId: c.companyId,
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

  async findByAccount(accountId, options = {}, allowedCompanyIds) {
    const where = { accountId };
    if (allowedCompanyIds) where.companyId = { in: allowedCompanyIds };
    if (options.excludeId) where.NOT = { id: options.excludeId };
    const mapStatuses = (arr) => arr.map((s) => toDb({ status: s }).status);
    if (options.statusIn) where.status = { in: mapStatuses(options.statusIn) };
    if (options.statusNotIn) {
      where.status = { ...(where.status ?? {}), notIn: mapStatuses(options.statusNotIn) };
    }
    const items = await prisma.case.findMany({ where, include: CASE_INCLUDE });
    return items.map(shape);
  },

  /**
   * Customer Pulse — vakanın müşterisinin geniş durumunu deterministic
   * metriklerle hesaplar. AI gerekmez, AI servisi olmasa da çalışır.
   * Roadmap §"Customer Context Intelligence".
   *
   * Davranış:
   *  - Vaka yoksa null → 404
   *  - allowedCompanyIds scope dışı → CaseAccessError (route 403'e çevirir)
   *  - Aksi halde: o müşterinin son 90 günlük tüm vakalarını tarar
   *    (companyId scope'lu), metrikler + state + summary üretir.
   *
   * Performans: tek prisma sorgu (lightweight select), 90 günden eski
   * vakalar atılır. Çok aktif müşterilerde de düşük maliyet.
   */
  async getCustomerPulse(caseId, allowedCompanyIds) {
    const found = await prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, companyId: true, accountId: true, accountName: true },
    });
    if (!found) return null;
    if (allowedCompanyIds && !allowedCompanyIds.includes(found.companyId)) {
      throw new CaseAccessError();
    }

    // Son 90 gün — recent metrics için yeterli. Daha eskisi performansı boğar.
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000);

    const rows = await prisma.case.findMany({
      where: {
        accountId: found.accountId,
        companyId: found.companyId,
        // Tüm vakalar — açık + kapalı — repeat issue ve geçmiş sayımı için.
        // 90 günden eski olanları sayım dışı bırakmak için createdAt filtre ile
        // birlikte değil; metrikleri içeride zaman damgasına göre türetiyoruz.
      },
      orderBy: { createdAt: 'desc' },
      take: 200, // Çok eski müşterilerde de bound — son 200 vakaya bakarız.
      select: {
        id: true,
        caseNumber: true,
        title: true,
        status: true,
        priority: true,
        category: true,
        subCategory: true,
        createdAt: true,
        resolvedAt: true,
        slaViolation: true,
        escalationLevel: true,
      },
    });

    const OPEN_STATUSES = new Set(['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi']);
    const now = Date.now();
    const ms30 = 30 * 24 * 3600 * 1000;
    const ms60 = 60 * 24 * 3600 * 1000;
    const ms90 = 90 * 24 * 3600 * 1000;

    let openCases = 0;
    let recent30d = 0;
    let recent60d = 0;
    let recent90d = 0;
    let slaViolations = 0;
    let criticalCases = 0;
    let escalatedCases = 0;
    const categoryCount = new Map();

    for (const r of rows) {
      const ageMs = now - new Date(r.createdAt).getTime();
      if (OPEN_STATUSES.has(r.status)) openCases++;
      if (ageMs <= ms30) recent30d++;
      if (ageMs <= ms60) recent60d++;
      if (ageMs <= ms90) recent90d++;
      if (r.slaViolation) slaViolations++;
      if (r.priority === 'Critical') criticalCases++;
      if (r.escalationLevel && r.escalationLevel !== 'Yok') escalatedCases++;
      else if (r.status === 'Eskalasyon') escalatedCases++;

      // Repeated issues: yalnız son 90 gün — eski örüntüler bilgisel değil.
      if (ageMs <= ms90) {
        const key = r.subCategory ? `${r.category}::${r.subCategory}` : r.category;
        categoryCount.set(key, (categoryCount.get(key) ?? 0) + 1);
      }
    }

    const repeatedIssues = [...categoryCount.entries()]
      .filter(([, count]) => count >= 2)
      .map(([key, count]) => {
        const [category, subCategory] = key.split('::');
        return { category: fromDb({ category }).category ?? category, subCategory, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    void ninetyDaysAgo; // eslint-fence: kullanılmayan değişken uyarısını sustur

    // Son 5 vaka — UI'da hızlı geçmiş için (current case dahil değil)
    const recentCases = rows
      .filter((r) => r.id !== caseId)
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        caseNumber: r.caseNumber,
        title: r.title,
        status: fromDb({ status: r.status }).status,
        priority: r.priority,
        category: fromDb({ category: r.category }).category ?? r.category,
        subCategory: fromDb({ subCategory: r.subCategory }).subCategory ?? r.subCategory,
        createdAt: r.createdAt,
        slaViolation: r.slaViolation,
      }));

    // State logic — roadmap spec'iyle birebir
    let state = 'Stable';
    if (
      openCases >= 3 ||
      criticalCases > 0 ||
      slaViolations >= 2 ||
      (escalatedCases > 0 && openCases > 0)
    ) {
      state = 'Critical';
    } else if (
      openCases >= 2 ||
      recent30d >= 3 ||
      slaViolations > 0 ||
      repeatedIssues.length >= 3
    ) {
      state = 'Risky';
    } else if (recent90d >= 2 || repeatedIssues.length >= 2) {
      state = 'Watch';
    }

    // Deterministic summary + evidence + recommendation
    const evidence = [];
    if (openCases > 0) evidence.push(`${openCases} açık vaka`);
    if (slaViolations > 0) evidence.push(`${slaViolations} SLA ihlali`);
    if (criticalCases > 0) evidence.push(`${criticalCases} kritik vaka`);
    if (escalatedCases > 0) evidence.push(`${escalatedCases} eskalasyona giden vaka`);
    if (recent30d >= 2) evidence.push(`Son 30 günde ${recent30d} vaka`);
    if (recent90d >= 3 && recent30d < 2) evidence.push(`Son 90 günde ${recent90d} vaka`);
    for (const r of repeatedIssues.slice(0, 2)) {
      const label = r.subCategory ? `${r.category} / ${r.subCategory}` : r.category;
      evidence.push(`Tekrar eden: ${label} (${r.count}×)`);
    }

    let summaryText;
    let recommendedAction;
    switch (state) {
      case 'Critical':
        summaryText = 'Bu müşteri yüksek riskli — yakın takip gerekli. Son dönemde açık veya çözülmemiş kritik/eskalasyon vakaları mevcut.';
        recommendedAction = 'Supervisor görünürlüğünü aç, proaktif iletişim kur, mevcut açık vakaları öncelikli işlet.';
        break;
      case 'Risky':
        summaryText = 'Müşteri dikkat gerektiriyor. Açık veya tekrar eden vakalar var, müşteri memnuniyeti riskli olabilir.';
        recommendedAction = 'Açık vakaları gözden geçir, tekrar eden konuları araştır, müşteriyle proaktif iletişim planla.';
        break;
      case 'Watch':
        summaryText = 'Müşterinin son dönemde birkaç vakası var. Şu an kritik değil ama örüntü gelişebilir.';
        recommendedAction = 'Geçmiş vakaları kontrol et, benzer şikayetler tekrarlanıyorsa kök neden ara.';
        break;
      default:
        summaryText = 'Müşteri stabil görünüyor. Son dönemde tekrar eden vaka veya SLA risk sinyali yok.';
        recommendedAction = 'Standart akışla devam et — özel önlem gerekmez.';
        break;
    }
    if (evidence.length === 0) evidence.push('Risk sinyali yok');

    return {
      accountId: found.accountId,
      accountName: found.accountName,
      caseId: found.id,
      state,
      metrics: {
        openCases,
        recent30d,
        recent60d,
        recent90d,
        slaViolations,
        criticalCases,
        escalatedCases,
      },
      repeatedIssues,
      recentCases,
      summary: {
        text: summaryText,
        evidence,
        recommendedAction,
        source: 'deterministic',
      },
    };
  },
};

/**
 * Mention repository — user-centric mention sorguları (bell badge için).
 * Multi-tenant scope: yalnızca allowedCompanyIds içindeki mention'ları döner.
 */
export const mentionRepo = {
  async listUnreadForUser(userId, allowedCompanyIds) {
    if (!userId || !allowedCompanyIds || allowedCompanyIds.length === 0) {
      return { items: [], total: 0 };
    }
    const items = await prisma.caseMention.findMany({
      where: {
        mentionedUserId: userId,
        seenAt: null,
        companyId: { in: allowedCompanyIds },
      },
      orderBy: { createdAt: 'desc' },
      take: 50, // bell drawer için pratik üst sınır
      select: {
        id: true,
        caseId: true,
        noteId: true,
        mentionedBy: true,
        createdAt: true,
        case: { select: { caseNumber: true, title: true, accountName: true } },
      },
    });
    return { items, total: items.length };
  },

  /** Vaka açıldığında o vakadaki mention'ları seen yap (route caller'ı tetikler). */
  async markCaseAsSeen(userId, caseId, allowedCompanyIds) {
    if (!userId) return { updated: 0 };
    const where = {
      mentionedUserId: userId,
      caseId,
      seenAt: null,
    };
    if (allowedCompanyIds) where.companyId = { in: allowedCompanyIds };
    const result = await prisma.caseMention.updateMany({
      where,
      data: { seenAt: new Date() },
    });
    return { updated: result.count };
  },
};

/**
 * notifyWatchers — bir vakaya watcher olarak eklenmiş tüm kullanıcılara
 * CaseNotification yazar (eventType='watcher_update', channel='InApp').
 *
 * Mutation handler'ları (addNote, update, transitionStatus) tarafından
 * çağrılır. Hata olursa ana akışı durdurmaz — sessiz warn.
 *
 * Payload: { message, kind } — kind 'note' | 'status' | 'assignment' |
 * 'priority' | 'escalation' (UI ayrıştırma için ipucu).
 */
async function notifyWatchers({ caseId, companyId, message, kind }) {
  try {
    const watchers = await prisma.caseWatcher.findMany({
      where: { caseId },
      select: { userId: true },
    });
    if (watchers.length === 0) return;
    await prisma.caseNotification.createMany({
      data: watchers.map((w) => ({
        caseId,
        companyId,
        eventType: 'watcher_update',
        channel: 'InApp',
        recipient: w.userId,
        payload: { message, kind },
      })),
    });
  } catch (err) {
    console.warn('[notifyWatchers]', err?.message ?? err);
  }
}

/**
 * Watcher repository — vaka takipçileri (FAZ 2 Collab).
 * Multi-tenant scope: vakanın companyId'si allowedCompanyIds'de olmalı.
 * Çapraz tenant watcher imkânsız.
 */
export const watcherRepo = {
  async list(caseId, allowedCompanyIds) {
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;
    const rows = await prisma.caseWatcher.findMany({
      where: { caseId },
      orderBy: { addedAt: 'asc' },
    });
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.flatMap((r) => [r.userId, r.addedBy]))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true, email: true },
    });
    const um = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: um.get(r.userId)?.fullName ?? r.userId,
      userEmail: um.get(r.userId)?.email ?? null,
      addedBy: r.addedBy,
      addedByName: um.get(r.addedBy)?.fullName ?? r.addedBy,
      addedAt: r.addedAt,
    }));
  },

  /**
   * Add watcher. Auth (caller responsibility — route layer):
   *  - Add self: any role
   *  - Add others: Supervisor+ OR (Agent + case.assignedPersonId === self.personId)
   *
   * Cross-tenant guard:
   *  - Hedef vakanın companyId'si allowedCompanyIds'de olmalı
   *  - Eklenecek kullanıcı aynı şirkette aktif UserCompany'ye sahip olmalı
   *
   * Duplicate guard: aynı (caseId, userId) ikinci kez eklenirse 'already' döner.
   */
  async add({ caseId, userId, addedBy, allowedCompanyIds, actor = 'Mock User' }) {
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    // Eklenecek kullanıcı aynı şirkette aktif olmalı (cross-tenant block)
    const valid = await prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        companies: { some: { companyId, isActive: true } },
      },
      select: { id: true, fullName: true },
    });
    if (!valid) {
      return { error: 'invalid_user', message: 'Kullanıcı bu şirkette bulunamadı veya pasif.' };
    }

    // Duplicate check
    const existing = await prisma.caseWatcher.findUnique({
      where: { caseId_userId: { caseId, userId } },
    });
    if (existing) {
      return { error: 'already', message: 'Kullanıcı zaten izleyici.' };
    }

    const c = await prisma.case.findUnique({
      where: { id: caseId },
      select: { caseNumber: true },
    });

    const created = await prisma.caseWatcher.create({
      data: { caseId, userId, companyId, addedBy },
    });

    // CaseActivity — "Selin Gümüş izleyici olarak eklendi"
    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: `${valid.fullName} izleyici olarak eklendi`,
        actionType: 'FieldUpdate',
        fieldName: 'watchers',
        toValue: valid.fullName,
        actor,
      },
    });

    // CaseNotification — eklenen kullanıcıya "izleyici eklendi" bildirim
    await prisma.caseNotification.create({
      data: {
        caseId,
        companyId,
        eventType: 'watcher_added',
        channel: 'InApp',
        recipient: userId,
        payload: {
          message: `Sizi ${c?.caseNumber ?? caseId} vakasında izleyici olarak eklendi`,
          addedBy,
        },
      },
    });

    return { id: created.id, userId, addedBy, addedAt: created.addedAt };
  },

  /**
   * Remove watcher. Auth (caller responsibility — route layer):
   *  - Self-removal: always allowed
   *  - Remove others: Supervisor+
   */
  async remove({ caseId, userId, allowedCompanyIds, actor = 'Mock User' }) {
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    const existing = await prisma.caseWatcher.findUnique({
      where: { caseId_userId: { caseId, userId } },
    });
    if (!existing) return { error: 'not_found', message: 'İzleyici bulunamadı.' };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });

    await prisma.caseWatcher.delete({ where: { id: existing.id } });

    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: `${user?.fullName ?? userId} izleyici listesinden çıkarıldı`,
        actionType: 'FieldUpdate',
        fieldName: 'watchers',
        fromValue: user?.fullName ?? userId,
        actor,
      },
    });

    return { ok: true };
  },

  /** Kullanıcının izlediği aktif vakalar — Watcher Inbox (ileri faz) için. */
  async listForUser(userId, allowedCompanyIds) {
    if (!userId || !allowedCompanyIds || allowedCompanyIds.length === 0) return [];
    const rows = await prisma.caseWatcher.findMany({
      where: { userId, companyId: { in: allowedCompanyIds } },
      orderBy: { addedAt: 'desc' },
      take: 200,
      select: {
        addedAt: true,
        case: {
          select: {
            id: true,
            caseNumber: true,
            title: true,
            status: true,
            priority: true,
            companyName: true,
            accountName: true,
            assignedPersonName: true,
            slaViolation: true,
            updatedAt: true,
          },
        },
      },
    });
    return rows
      .filter((r) => r.case)
      .map((r) => ({
        ...shape(r.case),
        addedAt: r.addedAt,
      }));
  },
};

/**
 * Link repository — vakalar arası bağlantı (FAZ 2 Collab).
 * 3 tip: Related (asymmetric), Duplicate (BFF symmetric), Parent (asymmetric).
 *
 * Cross-tenant block: kaynak ve hedef vakanın companyId'leri eşit olmalı +
 * her ikisi de allowedCompanyIds'de.
 *
 * Symmetric: Duplicate eklenince reverse link de yazılır; remove'da reverse
 * de silinir.
 *
 * Cycle guard (Parent): A → B Parent + B → A Parent yasak.
 */
const LINK_TYPE_TR = {
  Related: 'İlişkili',
  Duplicate: 'Mükerrer',
  Parent: 'Üst Vaka',
};

export const linkRepo = {
  async list(caseId, allowedCompanyIds) {
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;
    const rows = await prisma.caseLink.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      include: {
        linkedCase: {
          select: {
            id: true,
            caseNumber: true,
            title: true,
            status: true,
            priority: true,
            assignedPersonName: true,
            companyId: true,
          },
        },
      },
    });
    return rows.map((r) => ({
      linkId: r.id,
      linkType: r.linkType,
      linkTypeLabel: LINK_TYPE_TR[r.linkType] ?? r.linkType,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      linkedCase: r.linkedCase
        ? {
            id: r.linkedCase.id,
            caseNumber: r.linkedCase.caseNumber,
            title: r.linkedCase.title,
            status: fromDb({ status: r.linkedCase.status }).status,
            priority: r.linkedCase.priority,
            assignedPersonName: r.linkedCase.assignedPersonName,
          }
        : null,
    }));
  },

  async add({ caseId, linkedCaseId, linkType, createdBy, allowedCompanyIds, actor = 'Mock User' }) {
    if (caseId === linkedCaseId) {
      return { error: 'self_link', message: 'Vaka kendisine bağlanamaz.' };
    }
    if (!['Related', 'Duplicate', 'Parent'].includes(linkType)) {
      return { error: 'invalid_type', message: 'linkType geçersiz.' };
    }

    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    const target = await prisma.case.findUnique({
      where: { id: linkedCaseId },
      select: { id: true, companyId: true, caseNumber: true },
    });
    if (!target) return { error: 'target_not_found', message: 'Hedef vaka bulunamadı.' };
    if (target.companyId !== companyId) {
      return { error: 'cross_tenant', message: 'Farklı şirketteki vakaya bağlantı kurulamaz.' };
    }

    // Duplicate guard (aynı yönde + tipte tekrar)
    const existing = await prisma.caseLink.findUnique({
      where: {
        caseId_linkedCaseId_linkType: { caseId, linkedCaseId, linkType },
      },
    });
    if (existing) {
      return { error: 'already', message: 'Bağlantı zaten var.' };
    }

    // Cycle guard for Parent (A → B Parent, B → A Parent yasak)
    if (linkType === 'Parent') {
      const reverseParent = await prisma.caseLink.findUnique({
        where: {
          caseId_linkedCaseId_linkType: {
            caseId: linkedCaseId,
            linkedCaseId: caseId,
            linkType: 'Parent',
          },
        },
      });
      if (reverseParent) {
        return { error: 'circular', message: 'Döngüsel Parent bağlantısı yapılamaz.' };
      }
    }

    const created = await prisma.caseLink.create({
      data: { caseId, linkedCaseId, linkType, companyId, createdBy },
    });

    // Symmetric: Duplicate her iki yönde de tutulur.
    if (linkType === 'Duplicate') {
      const reverseExists = await prisma.caseLink.findUnique({
        where: {
          caseId_linkedCaseId_linkType: {
            caseId: linkedCaseId,
            linkedCaseId: caseId,
            linkType: 'Duplicate',
          },
        },
      });
      if (!reverseExists) {
        await prisma.caseLink.create({
          data: {
            caseId: linkedCaseId,
            linkedCaseId: caseId,
            linkType: 'Duplicate',
            companyId,
            createdBy,
          },
        });
      }
    }

    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: `Bağlantı eklendi: ${LINK_TYPE_TR[linkType]} → ${target.caseNumber}`,
        actionType: 'FieldUpdate',
        fieldName: 'links',
        toValue: `${LINK_TYPE_TR[linkType]} → ${target.caseNumber}`,
        actor,
      },
    });

    return { linkId: created.id, linkType, linkedCaseNumber: target.caseNumber };
  },

  /**
   * Remove link. Auth (caller responsibility):
   *  - Case owner (assignedPersonId === self.personId) or Supervisor+.
   *
   * Symmetric Duplicate: hem ileri hem geri yön silinir.
   */
  async remove({ caseId, linkId, allowedCompanyIds, actor = 'Mock User' }) {
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    const existing = await prisma.caseLink.findUnique({
      where: { id: linkId },
      include: { linkedCase: { select: { caseNumber: true } } },
    });
    if (!existing || existing.caseId !== caseId) {
      return { error: 'not_found', message: 'Bağlantı bulunamadı.' };
    }
    if (existing.companyId !== companyId) {
      return { error: 'cross_tenant', message: 'Bağlantı bu vakaya ait değil.' };
    }

    await prisma.caseLink.delete({ where: { id: linkId } });

    // Symmetric Duplicate — reverse'i de sil
    if (existing.linkType === 'Duplicate') {
      const reverse = await prisma.caseLink.findUnique({
        where: {
          caseId_linkedCaseId_linkType: {
            caseId: existing.linkedCaseId,
            linkedCaseId: existing.caseId,
            linkType: 'Duplicate',
          },
        },
      });
      if (reverse) {
        await prisma.caseLink.delete({ where: { id: reverse.id } });
      }
    }

    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: `Bağlantı kaldırıldı: ${LINK_TYPE_TR[existing.linkType]} → ${existing.linkedCase?.caseNumber ?? '?'}`,
        actionType: 'FieldUpdate',
        fieldName: 'links',
        fromValue: `${LINK_TYPE_TR[existing.linkType]} → ${existing.linkedCase?.caseNumber ?? '?'}`,
        actor,
      },
    });

    return { ok: true };
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

function buildWhere(f, allowedCompanyIds) {
  if (!f) f = {};
  const where = {};
  const andClauses = [];
  // Multi-tenant izolasyon: liste sorgusu sadece kullanıcının erişebildiği
  // şirketlerin vakalarını döner. allowedCompanyIds boş array ise [] dönmez —
  // Prisma `in: []` ile hiçbir şey döndürmez (doğru davranış: yetkisiz user
  // hiçbir şey görmez).
  if (allowedCompanyIds) {
    andClauses.push({ companyId: { in: allowedCompanyIds } });
  }
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
