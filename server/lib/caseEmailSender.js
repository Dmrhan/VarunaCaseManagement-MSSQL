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
  if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) {
    return { ok: true, items: [], rows: [] };
  }
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
  // rows döner — appendOutbound sonrası CaseEmailAttachment yazımı için
  // (Codex review fix: thread'de ek görünür + indirilebilir).
  return { ok: true, items, rows };
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
    // Codex P2 fix — composer'ın seçtiği reply parent. Satır içi
    // "Yanıtla" reply-context'le agent'ın tıkladığı mail'in messageId'sini
    // taşır. Verilirse threading bu satıra göre kurulur; yoksa son
    // inbound fallback (eski davranış).
    inReplyTo,
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
  // Codex P2 fix — composer'ın seçtiği reply parent (inReplyTo) varsa
  // ONU kullan; yoksa eski davranış (son inbound). Agent eski satıra
  // Reply tıkladıysa header'lar O satırı doğru gösterir; aksi halde
  // outbound thread breakage olur (UI'da eski mail prefill ama header
  // yeni mail'i parent gösterir).
  const newMessageId = buildSenderMessageId();
  let parent = null;
  if (typeof inReplyTo === 'string' && inReplyTo.trim()) {
    const explicit = await prisma.caseEmail.findFirst({
      where: { caseId, messageId: inReplyTo.trim() },
      select: { messageId: true, refs: true },
    });
    if (explicit?.messageId) {
      parent = { parentMessageId: explicit.messageId, refs: explicit.refs };
    }
    // Eğer composer'ın gönderdiği inReplyTo bu vakadaki bir CaseEmail
    // değilse (cross-case / silinmiş / outbound-only id) → fallback
    // son inbound. UI bozulmasın; security açığı yok (DB scope check).
  }
  if (!parent) {
    parent = await findThreadParentMessageId(caseId);
  }
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

  // ─── 8. DB satırı + K4 atomic + CaseEmailAttachment persistence ───
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

  // Codex review fix — CaseEmailAttachment satırlarını oluştur. Daha
  // önce yalnız outbound CaseEmail yazılıyor, attachments thread'de
  // GÖRÜNMÜYORDU + download route'tan ulaşılamıyordu. Mail gönderildi,
  // CaseEmail var ama CaseEmailAttachment yok → UI ek listesi BOŞ.
  // M2.1 paterniyle aynı: CaseAttachment.fileUrl storage path olarak
  // reuse edilir; cid/inline metadata composer için şimdilik default
  // (false / null).
  if (emailRecord?.id && Array.isArray(att.rows) && att.rows.length) {
    try {
      await prisma.caseEmailAttachment.createMany({
        data: att.rows.map((r) => ({
          emailId: emailRecord.id,
          storageKey: r.fileUrl,
          fileName: r.fileName,
          mimeType: r.mimeType,
          fileSize: r.fileSize,
          contentId: null,
          isInline: false,
        })),
      });
    } catch (err) {
      console.warn('[sender] caseEmailAttachment persistence failed',
        err?.message ?? err);
    }
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
async function buildReplyContext(caseId, { emailId } = {}) {
  if (!caseId) return null;
  const caseRow = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, companyId: true, caseNumber: true },
  });
  if (!caseRow) return null;

  // Codex P2 fix — emailId verilmişse O satırı kaynak al; yoksa son inbound.
  // Satır içi "Yanıtla" tıklandığında agent'ın seçtiği mail referans olur;
  // üst toolbar "Yanıtla" çağrısında (eski akış) emailId yok → davranış aynı.
  let lastInbound;
  if (emailId) {
    lastInbound = await prisma.caseEmail.findFirst({
      where: { id: emailId, caseId, direction: 'inbound' },
      select: {
        fromAddress: true,
        fromName: true,
        toAddresses: true,
        ccAddresses: true,
        subject: true,
        messageId: true,
      },
    });
    // Yanlış emailId / outbound / cross-case → null fallback yerine son
    // inbound'a düş (UX: agent yine de Reply alabilsin).
    if (!lastInbound) {
      lastInbound = await prisma.caseEmail.findFirst({
        where: { caseId, direction: 'inbound' },
        orderBy: { receivedAt: 'desc' },
        select: {
          fromAddress: true, fromName: true, toAddresses: true,
          ccAddresses: true, subject: true, messageId: true,
        },
      });
    }
  } else {
    lastInbound = await prisma.caseEmail.findFirst({
      where: { caseId, direction: 'inbound' },
      orderBy: { receivedAt: 'desc' },
      select: {
        fromAddress: true, fromName: true, toAddresses: true,
        ccAddresses: true, subject: true, messageId: true,
      },
    });
  }

  // Tenant alias adresleri (loop koruması).
  // Codex P2 fix — `listActive` yerine `listActiveWithSettingFallback`:
  // FromAlias hiç tanımlı değil + ExternalMailSetting.fromAddress fallback'i
  // kullanılan tenant'larda kendi fallback adresi loop set'inden DIŞARIDA
  // kalıyordu → reply-all kendi mailbox'ına yanıt gönderebilirdi.
  // Composer dropdown ile aynı kaynak.
  const aliases = await externalMailFromAliasRepo.listActiveWithSettingFallback(caseRow.companyId);
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

/**
 * M6.3-realign — Forward context. Belirli bir CaseEmail referans alıp
 * "İlet" composer akışı için prefill üretir.
 *
 *  - subject: "Fwd: <baseSubject>" (token korunur — composer subject
 *    sanity check yapar)
 *  - to/cc/bcc: BOŞ — agent forward'da alıcı manuel girer
 *  - quotedBodyHtml: "----- İletilen mesaj -----" header + orijinal
 *    gövde (referans HTML; client composer gövdesinin sonuna ekler)
 *
 * GUARD: caller (route) önce scope check yapar; bu fonksiyon yalnız
 * DB'den emailRow'u companyId match ile alır.
 */
async function buildForwardContext(caseId, emailId, { companyId } = {}) {
  if (!caseId || !emailId) return null;
  const caseRow = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, companyId: true, caseNumber: true },
  });
  if (!caseRow) return null;
  if (companyId && caseRow.companyId !== companyId) return null;

  const ref = await prisma.caseEmail.findUnique({
    where: { id: emailId },
    select: {
      caseId: true,
      companyId: true,
      fromAddress: true,
      fromName: true,
      toAddresses: true,
      ccAddresses: true,
      subject: true,
      bodyHtml: true,
      sentAt: true,
      receivedAt: true,
    },
  });
  if (!ref) return null;
  // Cross-case binding guard — emailId yanlış case'e ait olabilir
  if (ref.caseId !== caseId) return null;
  if (ref.companyId !== caseRow.companyId) return null;

  function parse(s) {
    if (!s || typeof s !== 'string') return [];
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  function joinAddresses(arr) {
    return arr.map((a) => (a?.name ? `${a.name} <${a.address}>` : a?.address)).filter(Boolean).join(', ');
  }

  const baseSubject = ref.subject ?? '';
  const subject = /^(re:|fwd?:)\s*/i.test(baseSubject) ? baseSubject : `Fwd: ${baseSubject}`;
  const ts = ref.sentAt ?? ref.receivedAt;
  const headerLines = [
    '---------- İletilen mesaj ----------',
    `Kimden: ${ref.fromName ? `${ref.fromName} <${ref.fromAddress}>` : ref.fromAddress}`,
    ts ? `Tarih: ${new Date(ts).toLocaleString('tr-TR')}` : null,
    ref.subject ? `Konu: ${ref.subject}` : null,
    `Kime: ${joinAddresses(parse(ref.toAddresses))}`,
    parse(ref.ccAddresses).length ? `Cc: ${joinAddresses(parse(ref.ccAddresses))}` : null,
  ].filter(Boolean);
  const quotedBodyHtml = [
    '<br><br>',
    '<div style="border-top:1px solid #ccc;margin-top:12px;padding-top:8px">',
    headerLines.map((l) => `<div>${escapeHtml(l)}</div>`).join(''),
    '<br>',
    ref.bodyHtml ?? '',
    '</div>',
  ].join('');

  return {
    caseNumber: caseRow.caseNumber,
    to: [],
    cc: [],
    bcc: [],
    subject,
    quotedBodyHtml,
    inReplyTo: null,
  };
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const caseEmailSender = {
  sendCaseEmail,
  buildReplyContext,
  buildForwardContext,
};

export const _internal = {
  buildSenderMessageId,
  normalizeRecipients,
  findThreadParentMessageId,
  loadAttachmentsForCase,
};
