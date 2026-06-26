/**
 * Mail M6.1 — CaseEmail repository.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 9.
 *
 * Sorumluluk:
 *  - appendInbound(): IMAP intake (M3 + M2.x parse) → CaseEmail satırı + K4 türetim
 *  - appendOutbound(): notification dispatch (M4) → paralel CaseEmail satırı + K4 türetim
 *    (M6.2'de composer da bunu çağırır)
 *  - listForCase(): MailThread için kronolojik liste
 *  - getById(): tek mail + ekleri + scope guard
 *  - getAttachmentForRaw(): ek indirme endpoint'i
 *
 * Dedup:
 *  - companyId + messageId @@unique (Prisma). messageId null ise dedup
 *    devre dışı; intake'in parse failure'larında manuel kabul.
 *
 * K4 (Case.lastEmailInboundAt / lastEmailOutboundAt / pendingCustomerReply):
 *  append* fonksiyonları aynı transaction içinde Case satırını günceller:
 *    inbound  → lastEmailInboundAt + pendingCustomerReply=true
 *    outbound → lastEmailOutboundAt + pendingCustomerReply=false
 *  transitionStatus terminal'e geçerken false yapar — caseRepository
 *  içinde ayrı yer (R12 mitigation).
 *
 * REUSE:
 *  - prisma client
 *  - storage.js writeBuffer/writeCaseFile (eklerde — caller orchestrator
 *    içinde, repo sadece DB satırı)
 *
 * Scope guard caller'da (assertCaseInScope*). Repo signature companyId
 * alır ve bunu zorunlu kılar; ham FK insert'i kabul etmez.
 */

import { prisma } from './client.js';

/** Visibility default. Plan K2: composer'dan toggle kaldırıldı; sabit 'Customer'. */
const DEFAULT_VISIBILITY = 'Customer';

/**
 * JSON-as-string serialize helper. CaseEmail.toAddresses/ccAddresses/
 * bccAddresses MSSQL'de NVARCHAR(Max) — null/empty array için
 * boş string yerine '[]' veya null tercih edilir.
 */
function serializeAddresses(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const safe = list
    .map((a) => {
      if (typeof a === 'string') return { address: a, name: null };
      if (!a || typeof a !== 'object') return null;
      const address = typeof a.address === 'string' ? a.address.trim() : '';
      if (!address) return null;
      const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : null;
      return { address, name };
    })
    .filter(Boolean);
  return safe.length ? JSON.stringify(safe) : null;
}

function parseAddresses(s) {
  if (!s || typeof s !== 'string') return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * CaseEmail satırını UI-friendly shape'e çevirir. MailMessageCard
 * direkt bunu render eder.
 */
function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.caseId,
    direction: row.direction,
    source: row.source,
    from: {
      address: row.fromAddress,
      name: row.fromName,
    },
    to: parseAddresses(row.toAddresses),
    cc: parseAddresses(row.ccAddresses),
    bcc: parseAddresses(row.bccAddresses),
    subject: row.subject,
    bodyHtml: row.bodyHtml,
    bodyText: row.bodyText,
    messageId: row.messageId,
    inReplyTo: row.inReplyTo,
    refs: row.refs,
    visibility: row.visibility,
    sentByUserId: row.sentByUserId,
    dispatchId: row.dispatchId,
    sentAt: row.sentAt,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    attachments: Array.isArray(row.attachments)
      ? row.attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSize: a.fileSize,
          contentId: a.contentId,
          isInline: a.isInline,
        }))
      : [],
  };
}

/**
 * Inbound CaseEmail yazımı. IMAP intake (server/lib/inboundMailIntake.js)
 * tarafından çağrılır.
 *
 * @param {Object} params
 * @param {string} params.caseId
 * @param {string} params.companyId
 * @param {Object} params.from - { address, name? }
 * @param {Array}  params.to - [{ address, name? }]
 * @param {Array}  [params.cc]
 * @param {Array}  [params.bcc]
 * @param {string} params.subject
 * @param {string} params.bodyHtml - SANITIZE EDİLMİŞ HTML (caller responsibility)
 * @param {string} [params.bodyText]
 * @param {string} [params.messageId] - RFC 5322 Message-ID
 * @param {string} [params.inReplyTo]
 * @param {string} [params.refs]
 * @param {Date}   [params.receivedAt]
 * @param {number} [params.rawSize]
 * @param {string} [params.headersJson]
 * @param {string} [params.source='imap_intake']
 *
 * @returns {Promise<{ id: string, deduped: boolean }>}
 *   deduped=true → companyId+messageId zaten varmış, yeni satır oluşmadı.
 */
async function appendInbound(params) {
  const {
    caseId, companyId, from, to, cc, bcc, subject,
    bodyHtml, bodyText, messageId, inReplyTo, refs,
    receivedAt, rawSize, headersJson,
    source = 'imap_intake',
  } = params;

  if (!caseId || !companyId || !from?.address) {
    throw new Error('caseEmail.appendInbound: caseId/companyId/from.address zorunlu');
  }

  // Dedup — companyId + messageId unique. messageId null ise dedup yok.
  if (messageId) {
    const existing = await prisma.caseEmail.findUnique({
      where: { companyId_messageId: { companyId, messageId } },
      select: { id: true },
    });
    if (existing) return { id: existing.id, deduped: true };
  }

  const now = new Date();
  const receivedAtFinal = receivedAt instanceof Date ? receivedAt : now;

  // Atomic: CaseEmail + Case K4 update tek transaction.
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.caseEmail.create({
      data: {
        caseId,
        companyId,
        direction: 'inbound',
        source,
        fromAddress: from.address,
        fromName: from.name ?? null,
        toAddresses: serializeAddresses(to) ?? '[]',
        ccAddresses: serializeAddresses(cc),
        bccAddresses: serializeAddresses(bcc),
        subject: subject ?? '',
        bodyHtml: bodyHtml ?? '',
        bodyText: bodyText ?? null,
        messageId: messageId ?? null,
        inReplyTo: inReplyTo ?? null,
        refs: refs ?? null,
        visibility: DEFAULT_VISIBILITY,
        rawSize: rawSize ?? null,
        headersJson: headersJson ?? null,
        receivedAt: receivedAtFinal,
      },
      select: { id: true },
    });

    // K4 türetim (Codex review fix — MONOTONIC):
    //   - lastEmailInboundAt yalnız MAX(mevcut, gelen).
    //   - pendingCustomerReply = (effectiveInbound > effectiveOutbound)
    //     yani son inbound, son outbound'dan SONRAYSA yanıt bekliyor.
    // Önceki davranış (koşulsuz=true) backfill / out-of-order inbound'da
    // state'i geriye gönderiyordu (eski inbound geldikten sonra "yanıt
    // bekleniyor" hatalı şekilde set edilebiliyordu).
    const c = await tx.case.findUnique({
      where: { id: caseId },
      select: { lastEmailInboundAt: true, lastEmailOutboundAt: true },
    });
    const prevIn = c?.lastEmailInboundAt ?? null;
    const prevOut = c?.lastEmailOutboundAt ?? null;
    const effectiveIn = !prevIn || receivedAtFinal.getTime() > prevIn.getTime()
      ? receivedAtFinal
      : prevIn;
    const pending = !prevOut || effectiveIn.getTime() > prevOut.getTime();
    await tx.case.update({
      where: { id: caseId },
      data: {
        ...(prevIn && prevIn.getTime() >= receivedAtFinal.getTime()
          ? {}
          : { lastEmailInboundAt: receivedAtFinal }),
        pendingCustomerReply: pending,
      },
    });

    return row;
  });

  return { id: result.id, deduped: false };
}

/**
 * Outbound CaseEmail yazımı. M4 notification dispatch sonrası paralel
 * kayıt için (source='notification_dispatch') VE M6.2 composer için
 * (source='manual_send').
 *
 * @param {Object} params
 * @param {string} params.caseId
 * @param {string} params.companyId
 * @param {Object} params.from
 * @param {Array}  params.to
 * @param {Array}  [params.cc]
 * @param {Array}  [params.bcc]
 * @param {string} params.subject
 * @param {string} params.bodyHtml
 * @param {string} [params.bodyText]
 * @param {string} [params.messageId]
 * @param {string} [params.inReplyTo]
 * @param {string} [params.refs]
 * @param {Date}   [params.sentAt]
 * @param {string} params.source - 'manual_send' | 'notification_dispatch'
 * @param {string} [params.sentByUserId] - manual_send için audit
 * @param {string} [params.dispatchId] - notification_dispatch için FK
 * @param {string} [params.headersJson]
 *
 * @returns {Promise<{ id: string, deduped: boolean }>}
 */
async function appendOutbound(params) {
  const {
    caseId, companyId, from, to, cc, bcc, subject,
    bodyHtml, bodyText, messageId, inReplyTo, refs,
    sentAt, source, sentByUserId, dispatchId, headersJson,
  } = params;

  if (!caseId || !companyId || !from?.address) {
    throw new Error('caseEmail.appendOutbound: caseId/companyId/from.address zorunlu');
  }
  if (!source) {
    throw new Error('caseEmail.appendOutbound: source zorunlu');
  }

  if (messageId) {
    const existing = await prisma.caseEmail.findUnique({
      where: { companyId_messageId: { companyId, messageId } },
      select: { id: true },
    });
    if (existing) return { id: existing.id, deduped: true };
  }

  const now = new Date();
  const sentAtFinal = sentAt instanceof Date ? sentAt : now;

  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.caseEmail.create({
      data: {
        caseId,
        companyId,
        direction: 'outbound',
        source,
        fromAddress: from.address,
        fromName: from.name ?? null,
        toAddresses: serializeAddresses(to) ?? '[]',
        ccAddresses: serializeAddresses(cc),
        bccAddresses: serializeAddresses(bcc),
        subject: subject ?? '',
        bodyHtml: bodyHtml ?? '',
        bodyText: bodyText ?? null,
        messageId: messageId ?? null,
        inReplyTo: inReplyTo ?? null,
        refs: refs ?? null,
        visibility: DEFAULT_VISIBILITY,
        sentByUserId: sentByUserId ?? null,
        dispatchId: dispatchId ?? null,
        headersJson: headersJson ?? null,
        sentAt: sentAtFinal,
      },
      select: { id: true },
    });

    // K4 türetim (Codex review fix — MONOTONIC, simetrik):
    //   - lastEmailOutboundAt yalnız MAX(mevcut, giden).
    //   - pendingCustomerReply = (effectiveInbound > effectiveOutbound)
    //     son outbound, son inbound'dan sonraysa yanıt beklenmez.
    const c = await tx.case.findUnique({
      where: { id: caseId },
      select: { lastEmailInboundAt: true, lastEmailOutboundAt: true },
    });
    const prevIn = c?.lastEmailInboundAt ?? null;
    const prevOut = c?.lastEmailOutboundAt ?? null;
    const effectiveOut = !prevOut || sentAtFinal.getTime() > prevOut.getTime()
      ? sentAtFinal
      : prevOut;
    const pending = !!prevIn && prevIn.getTime() > effectiveOut.getTime();
    await tx.case.update({
      where: { id: caseId },
      data: {
        ...(prevOut && prevOut.getTime() >= sentAtFinal.getTime()
          ? {}
          : { lastEmailOutboundAt: sentAtFinal }),
        pendingCustomerReply: pending,
      },
    });

    return row;
  });

  return { id: result.id, deduped: false };
}

/**
 * Vakanın tüm CaseEmail satırlarını kronolojik döner (eskiden yeniye).
 * MailThread bunu render eder.
 *
 * SCOPE: caller assertCaseInScope* ile çağırmadan önce vakanın user'a
 * görünür olduğunu doğrulamış olmalı. Repo guard sadece companyId
 * sınırlamasını uygular (cross-tenant insert/list engeli).
 */
async function listForCase(caseId, { allowedCompanyIds } = {}) {
  if (!caseId) return [];
  const whereCompanyId = Array.isArray(allowedCompanyIds) && allowedCompanyIds.length
    ? { in: allowedCompanyIds }
    : undefined;
  const rows = await prisma.caseEmail.findMany({
    where: {
      caseId,
      ...(whereCompanyId ? { companyId: whereCompanyId } : {}),
    },
    include: {
      attachments: {
        select: { id: true, fileName: true, mimeType: true, fileSize: true, contentId: true, isInline: true },
      },
    },
  });
  // Codex review fix — ASIL sıra coalesce(receivedAt, sentAt); createdAt
  // yalnız tie-breaker. Prisma orderBy native COALESCE desteklemiyor +
  // MSSQL nullable order tutarlı değil; app-layer sort kullanırız.
  // İstek küçük (vaka thread'i); maliyet ihmal edilebilir.
  const tsKey = (r) => {
    const eff = r.receivedAt ?? r.sentAt ?? r.createdAt;
    return eff instanceof Date ? eff.getTime() : new Date(eff).getTime();
  };
  rows.sort((a, b) => {
    const ka = tsKey(a);
    const kb = tsKey(b);
    if (ka !== kb) return ka - kb;
    return (new Date(a.createdAt).getTime()) - (new Date(b.createdAt).getTime());
  });
  return rows.map(shape);
}

/**
 * Tek CaseEmail satırı + ekleri. Raw indirme endpoint'i ve detay panel
 * için. Scope: caller assertCaseInScope* uygular.
 */
async function getById(id, { allowedCompanyIds } = {}) {
  if (!id) return null;
  const row = await prisma.caseEmail.findUnique({
    where: { id },
    include: {
      attachments: true,
    },
  });
  if (!row) return null;
  if (Array.isArray(allowedCompanyIds) && allowedCompanyIds.length
      && !allowedCompanyIds.includes(row.companyId)) {
    return null;
  }
  return shape(row);
}

/**
 * CaseEmailAttachment satırını döner. Raw download endpoint'i companyId
 * kontrolü için kullanır. storageKey ile storage.readBuffer çağrılır.
 */
async function getAttachmentForRaw(emailId, attachmentId, { allowedCompanyIds } = {}) {
  if (!emailId || !attachmentId) return null;
  const row = await prisma.caseEmailAttachment.findUnique({
    where: { id: attachmentId },
    include: { email: { select: { id: true, caseId: true, companyId: true } } },
  });
  if (!row) return null;
  if (row.emailId !== emailId) return null;
  if (Array.isArray(allowedCompanyIds) && allowedCompanyIds.length
      && !allowedCompanyIds.includes(row.email.companyId)) {
    return null;
  }
  return {
    id: row.id,
    emailId: row.emailId,
    caseId: row.email.caseId,
    companyId: row.email.companyId,
    storageKey: row.storageKey,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
  };
}

export const caseEmailRepository = {
  appendInbound,
  appendOutbound,
  listForCase,
  getById,
  getAttachmentForRaw,
};

// Test/smoke helper exports.
export const _internal = { serializeAddresses, parseAddresses, shape, DEFAULT_VISIBILITY };
