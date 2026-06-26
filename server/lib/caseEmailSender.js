/**
 * Mail M6.2a — Agent composer'dan gönderim orkestrasyon.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 9 + Bölüm 6.
 *
 * Sorumluluk:
 *  1. From DOĞRULA — validateOutboundFrom (M5-extension): seçilen alias
 *     o şirketin AKTİF alias'larından biri olmalı; aksi halde reddet
 *     (spoof önleme).
 *  2. Subject TOKEN: applyCaseTokenToSubject (M4 reuse) — [VK-<caseNo>]
 *     yoksa ekle, varsa dokunma.
 *  3. Message-ID üret: buildSenderMessageId (M4 paterni).
 *  4. Threading: thread'deki son CaseEmail.messageId varsa
 *     In-Reply-To/References zinciri kur.
 *  5. Sanitize: bodyHtml sanitizeOutgoingEmailHtml (M6.1 reuse).
 *  6. Ekler: CaseAttachment.id listesi → DB satırlarını oku → storage
 *     stream → mailProvider attachment formatı.
 *  7. mailProvider.sendMail(...) (M5 transport, companyId-aware).
 *  8. Başarı → caseEmailRepository.appendOutbound (source='manual_send',
 *    sentByUserId actor, dispatchId YOK). K4 atomic update otomatik.
 *  9. Hata yakalanır — throw etmez; { ok:false, code, ... }.
 *
 * REUSE: hiçbir gönderim/threading/sanitize mantığı YENİDEN YAZILMAZ.
 *  - mailProvider.sendMail (M1/M5)
 *  - applyCaseTokenToSubject + buildDispatchMessageId paterni (M4)
 *  - validateOutboundFrom (M5-ext)
 *  - sanitizeOutgoingEmailHtml (M6.1)
 *  - caseEmailRepository.appendOutbound (M6.1)
 *  - createObjectStream + statObject (storage.js)
 *
 * SCOPE: caller (route layer) önce assertCaseInScopeForRead +
 * assertCaseSecurityFilterAccess çalıştırır; sender DB'den case.companyId
 * okur, oradan FromAlias / mailProvider config çağırır.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../db/client.js';
import { sendMail as mailProviderSendMail } from './mailProvider.js';
import { applyCaseTokenToSubject } from '../db/notificationRepository.js';
import { externalMailFromAliasRepo } from '../db/externalMailFromAliasRepository.js';
import { caseEmailRepository } from '../db/caseEmailRepository.js';
import { sanitizeOutgoingEmailHtml } from './htmlSanitizer.js';
import { statObject, createObjectStream } from '../db/storage.js';

const RAW_SOURCE = 'case-email-sender';

/**
 * RFC 5322-friendly Message-ID üretimi. M4 paterni:
 *   <varuna-<uuid>@varuna.local>
 * Plan: tenant domain ile hizalanması nice-to-have (M6.3'te
 * ExternalMailSetting.fromAddress'ten parse edilebilir).
 */
function buildSenderMessageId(domain = 'varuna.local') {
  return `<varuna-${randomUUID()}@${domain}>`;
}

/**
 * to/cc/bcc dizilerini nodemailer-compatible adres dizilerine çevirir.
 * Composer "[{ address, name }]" şeklinde gönderir. Validation:
 * adresin boş/uzun olmaması yeterli (detaylı RFC 5322 syntax M6.2b
 * composer'da).
 */
function normalizeRecipients(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((r) => {
      if (typeof r === 'string') return r.trim();
      if (!r || typeof r !== 'object') return null;
      const address = typeof r.address === 'string' ? r.address.trim() : '';
      if (!address) return null;
      const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : null;
      return name ? `"${name}" <${address}>` : address;
    })
    .filter(Boolean);
}

/**
 * CaseAttachment.id[] → mailProvider attachments[].
 * SCOPE: attachment.caseId === caseId olmayan satır filtrelenir
 * (cross-case ek bağlama engellenir).
 */
async function loadAttachmentsForCase(caseId, attachmentIds) {
  if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) return { ok: true, items: [] };
  const rows = await prisma.caseAttachment.findMany({
    where: { id: { in: attachmentIds }, caseId },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      // fileUrl çoğunlukla relative storage path (M5'te); legacy URL ise
      // intake'in eski supabase senaryolarında dolu olabilir.
      fileUrl: true,
    },
  });
  if (rows.length !== attachmentIds.length) {
    return { ok: false, code: 'attachment_scope_mismatch' };
  }
  const items = [];
  for (const r of rows) {
    // storage path local relative path olarak tutuluyor; statObject ile
    // var olup olmadığını kontrol.
    if (!r.fileUrl) {
      return { ok: false, code: 'attachment_no_path', meta: { id: r.id } };
    }
    const st = await statObject(r.fileUrl);
    if (!st) {
      return { ok: false, code: 'attachment_missing', meta: { id: r.id } };
    }
    items.push({
      filename: r.fileName,
      content: createObjectStream(r.fileUrl),
      contentType: r.mimeType,
    });
  }
  return { ok: true, items };
}

/**
 * Thread'deki son inbound CaseEmail.messageId — In-Reply-To/References
 * için referans. Composer reply mod'unda kullanır.
 */
async function findThreadParentMessageId(caseId) {
  const last = await prisma.caseEmail.findFirst({
    where: { caseId, direction: 'inbound', messageId: { not: null } },
    orderBy: { receivedAt: 'desc' },
    select: { messageId: true, refs: true },
  });
  if (!last) return null;
  return {
    parentMessageId: last.messageId,
    refs: last.refs,
  };
}

/**
 * Asıl gönderim entry point.
 *
 * @param {Object} params
 * @param {string} params.caseId
 * @param {string} params.fromAddress       — composer dropdown'dan seçilen alias
 * @param {Array}  params.to                — [{ address, name? }, ...]
 * @param {Array}  [params.cc]
 * @param {Array}  [params.bcc]
 * @param {string} params.subject
 * @param {string} params.bodyHtml          — composer içeriği (imza dahil; sanitize
 *                                              edilecek)
 * @param {string} [params.bodyText]        — text fallback (opsiyonel)
 * @param {Array}  [params.attachments]     — CaseAttachment.id[]
 * @param {Object} params.actor             — { userId, fullName }
 * @param {Object} [opts]
 * @param {Function} [opts.sendFn] - mailProvider.sendMail injection (test
 *   amaçlı; default'unu değiştirme).
 *
 * @returns {Promise<{
 *   ok: true, emailId: string, messageId: string, previewUrl?: string|null
 * } | { ok: false, code: string, message?: string }>}
 */
async function sendCaseEmail(params, opts = {}) {
  const sendFn = opts.sendFn ?? mailProviderSendMail;
  const {
    caseId, fromAddress, to, cc, bcc, subject, bodyHtml, bodyText,
    attachments, actor,
  } = params ?? {};

  if (!caseId || !fromAddress) {
    return { ok: false, code: 'missing_params' };
  }
  const recipientsTo = normalizeRecipients(to);
  if (recipientsTo.length === 0) {
    return { ok: false, code: 'recipients_missing' };
  }

  // ─── 1. Case context ───
  const caseRow = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, companyId: true, caseNumber: true },
  });
  if (!caseRow) return { ok: false, code: 'case_not_found' };

  // ─── 2. From DOĞRULA (M5-ext) ───
  const fromValidation = await externalMailFromAliasRepo.validateOutboundFrom(
    caseRow.companyId,
    fromAddress,
  );
  if (!fromValidation.ok) {
    return { ok: false, code: 'from_invalid', message: `Geçersiz gönderen: ${fromValidation.code}` };
  }
  const fromAlias = fromValidation.alias;
  // Composer dropdown'da display ile gönderilen tam adres
  const sendFrom = fromAlias.displayName
    ? `"${fromAlias.displayName}" <${fromAlias.address}>`
    : fromAlias.address;

  // ─── 3. Subject token (M4 reuse) ───
  const finalSubject = applyCaseTokenToSubject(subject ?? '', caseRow.caseNumber);

  // ─── 4. Threading ───
  const newMessageId = buildSenderMessageId();
  const parent = await findThreadParentMessageId(caseId);
  const headers = { 'Message-ID': newMessageId };
  if (parent?.parentMessageId) {
    headers['In-Reply-To'] = parent.parentMessageId;
    // References zinciri: önceki refs + parent.
    const prevRefs = (parent.refs ?? '').trim();
    headers['References'] = prevRefs
      ? `${prevRefs} ${parent.parentMessageId}`.trim()
      : parent.parentMessageId;
  }

  // ─── 5. Sanitize ───
  const safeHtml = sanitizeOutgoingEmailHtml(bodyHtml ?? '');
  const safeText = typeof bodyText === 'string' && bodyText.trim()
    ? bodyText
    : safeHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // ─── 6. Ekler ───
  const att = await loadAttachmentsForCase(caseId, attachments ?? []);
  if (!att.ok) return { ok: false, code: att.code, message: 'Ek erişimi başarısız.' };

  // ─── 7. mailProvider.sendMail ───
  const send = await sendFn(
    {
      to: recipientsTo,
      cc: normalizeRecipients(cc),
      bcc: normalizeRecipients(bcc),
      from: sendFrom,
      subject: finalSubject,
      html: safeHtml,
      text: safeText,
      headers,
      attachments: att.items,
    },
    { companyId: caseRow.companyId },
  );
  if (!send.ok) {
    return {
      ok: false,
      code: send.error?.code ?? 'mail_send_failed',
      message: send.error?.message ?? 'Gönderim başarısız.',
    };
  }

  // mailProvider transport gerçek Message-ID döndürebilir (nodemailer
  // header'a yazarsa); bizim ürettiğimiz headers['Message-ID'] gönderilir.
  // appendOutbound için ürettiğimizi tercih ederiz (round-trip için
  // tutarlı).

  // ─── 8. DB satırı + K4 atomic ───
  let emailRecord;
  try {
    emailRecord = await caseEmailRepository.appendOutbound({
      caseId: caseRow.id,
      companyId: caseRow.companyId,
      from: { address: fromAlias.address, name: fromAlias.displayName ?? null },
      to: Array.isArray(to) ? to : [],
      cc: Array.isArray(cc) ? cc : [],
      bcc: Array.isArray(bcc) ? bcc : [],
      subject: finalSubject,
      bodyHtml: safeHtml,
      bodyText: safeText,
      messageId: newMessageId,
      inReplyTo: parent?.parentMessageId ?? null,
      refs: headers.References ?? null,
      sentAt: new Date(),
      source: 'manual_send',
      sentByUserId: actor?.userId ?? null,
    });
  } catch (err) {
    // Mail gönderildi ama DB persist fail oldu — round-trip için
    // hata loglanır; UI yine başarı sayar (mail teslim oldu).
    console.warn('[sender] appendOutbound failed after send', err?.message ?? err);
  }

  return {
    ok: true,
    emailId: emailRecord?.id ?? null,
    messageId: newMessageId,
    previewUrl: send.previewUrl ?? null,
    rawSource: RAW_SOURCE,
  };
}

/**
 * K6 reply-context — composer prefill için backend helper. Vakanın son
 * inbound CaseEmail'ından çıkarılır.
 *
 * Response:
 *   {
 *     to:   [{ address, name }],
 *     cc:   [{ address, name }],
 *     subject: "Re: [VK-...] ...",
 *     inReplyTo: "<...>"
 *   }
 *
 * Tenant alias filtresi: tenant'ın AKTİF FromAlias adresleri to/cc'den
 * filtrelenir (loop koruması: kendi adreslerimize reply gönderme).
 *
 * Senaryo: vakanın inbound mail'i yoksa → boş context (composer manuel
 * doldurur). Outbound bile olsa: son outbound'un To/Cc'sini ön-seçili
 * göstermek mantıklı değil (agent karşı tarafa cevap yazıyor); sadece
 * inbound referans alınır.
 */
async function buildReplyContext(caseId) {
  if (!caseId) return null;
  const caseRow = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, companyId: true, caseNumber: true },
  });
  if (!caseRow) return null;

  const lastInbound = await prisma.caseEmail.findFirst({
    where: { caseId, direction: 'inbound' },
    orderBy: { receivedAt: 'desc' },
    select: {
      fromAddress: true,
      fromName: true,
      toAddresses: true,
      ccAddresses: true,
      subject: true,
      messageId: true,
    },
  });

  // Tenant alias adresleri (loop koruması)
  const aliases = await externalMailFromAliasRepo.listActive(caseRow.companyId);
  const aliasKeys = new Set(aliases.map((a) => a.address.trim().toLowerCase()));

  // Adresleri parse — caseEmailRepository serialize JSON-as-string
  function parse(s) {
    if (!s || typeof s !== 'string') return [];
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function filterAlias(list) {
    return list.filter((r) => {
      const a = (r?.address ?? '').trim().toLowerCase();
      return a && !aliasKeys.has(a);
    });
  }

  function uniq(list) {
    const seen = new Set();
    const out = [];
    for (const r of list) {
      const k = (r?.address ?? '').trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  }

  let to = [];
  let cc = [];
  let subject = '';
  let inReplyTo = null;
  if (lastInbound) {
    const inboundTo = parse(lastInbound.toAddresses);
    const inboundCc = parse(lastInbound.ccAddresses);
    // K6 reply-all: To = [inbound.from] + inbound.to; Cc = inbound.cc
    const senderEntry = { address: lastInbound.fromAddress, name: lastInbound.fromName ?? null };
    to = filterAlias(uniq([senderEntry, ...inboundTo]));
    cc = filterAlias(uniq(inboundCc));
    // Subject: token korunur; "Re: " yoksa ekle
    const baseSubject = lastInbound.subject ?? '';
    subject = /^re:\s*/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;
    inReplyTo = lastInbound.messageId;
  }

  return {
    caseNumber: caseRow.caseNumber,
    to,
    cc,
    bcc: [],
    subject,
    inReplyTo,
  };
}

export const caseEmailSender = {
  sendCaseEmail,
  buildReplyContext,
};

export const _internal = {
  buildSenderMessageId,
  normalizeRecipients,
  findThreadParentMessageId,
  loadAttachmentsForCase,
};
