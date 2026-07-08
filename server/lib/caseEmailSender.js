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
 * bodyHtml içindeki `<img src="cid:xxx">` referanslarından CID setini çıkar.
 * FE composer ile SİMETRİK regex — composer bu tam pattern'i insert eder,
 * backend aynı pattern'i tanır. Sanitize `img[src^="cid:"]`'i zaten allow
 * ediyor (htmlSanitizer.js allowedSchemesByTag) → strip yok.
 */
function extractInlineCidsFromHtml(html) {
  const set = new Set();
  if (typeof html !== 'string' || !html) return set;
  const re = /<img[^>]+src=["']cid:([^"']+)["']/gi;
  for (let m; (m = re.exec(html)); ) {
    const cid = m[1]?.trim();
    if (cid) set.add(cid);
  }
  return set;
}

/**
 * CaseAttachment.id[] → mailProvider attachments[].
 * SCOPE: attachment.caseId === caseId olmayan satır filtrelenir
 * (cross-case ek bağlama engellenir).
 *
 * @param {Set<string>} [inlineCids] — bodyHtml'de cid:xxx olarak referans
 *   verilmiş attachment id'leri. Bu set'te olan ekler nodemailer'a `cid`
 *   field ile geçer → gövde içinde render edilir (Ctrl+V paste image).
 */
async function loadAttachmentsForCase(caseId, attachmentIds, inlineCids) {
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
  const inlineSet = inlineCids instanceof Set ? inlineCids : new Set();
  const items = [];
  for (const r of rows) {
    if (!r.fileUrl) {
      return { ok: false, code: 'attachment_no_path', meta: { id: r.id } };
    }
    const st = await statObject(r.fileUrl);
    if (!st) {
      return { ok: false, code: 'attachment_missing', meta: { id: r.id } };
    }
    const entry = {
      filename: r.fileName,
      content: createObjectStream(r.fileUrl),
      contentType: r.mimeType,
    };
    // nodemailer: cid alanı → Content-ID header + Content-Disposition inline.
    // Mail istemcisi (Gmail/Outlook) gövde içindeki <img src="cid:xxx">'yi
    // bu ek ile eşleştirir ve INLINE render eder.
    if (inlineSet.has(r.id)) {
      entry.cid = r.id;
    }
    items.push(entry);
  }
  // rows döner — appendOutbound sonrası CaseEmailAttachment yazımı için
  // (Codex review fix: thread'de ek görünür + indirilebilir).
  return { ok: true, items, rows };
}

/**
 * Alıntı gövdesindeki inline `cid:` görselleri giden maile yeniden ekler.
 *
 * Sorun (saha, UNV-1001056): "Yanıtla"da alıntı gövdesi, gelen mailin
 * `<img src="cid:ii_...">` referanslarını taşır ama o görseller composer
 * ekleri (`CaseAttachment`, `cmsa_...`) arasında DEĞİL — orijinal mesajın
 * `CaseEmailAttachment.contentId`'sine ait. loadAttachmentsForCase yalnız
 * composer eklerini yüklediğinden bu cid'ler MIME'a hiç konmuyordu →
 * alıcının Gmail'i çözemiyor → kırık görsel.
 *
 * Bu fonksiyon gövdedeki cid'lerden composer ekiyle KARŞILANMAYANLARı,
 * vakanın `CaseEmailAttachment` kayıtlarından (tenant/case-scope) contentId
 * eşleştirerek çeker ve aynı cid ile inline ekler. Böylece alıntı görselleri
 * de alıcıya gider.
 *
 * Kullanıcı kararı (2026-07-08): boyut SINIRI yok — büyük görseller dahil
 * hepsi gönderilir. Dedup var (aynı cid tek sefer). Mail sağlayıcı boyut
 * limitini aşarsa gönderim mevcut hata yolundan AÇIKÇA başarısız olur
 * (sessiz kayıp yok) — cap koyup görsel düşürmüyoruz.
 *
 * @param {string} caseId
 * @param {Set<string>|string[]} bodyCids — gövdedeki tüm cid string'leri
 * @param {Set<string>} coveredCanon — composer ekiyle zaten karşılanan cid'ler
 *   (canonical: bracket-sız + lowercase)
 * @returns {Promise<Array>} nodemailer attachment[] (cid'li inline)
 */
async function loadQuotedInlineAttachments(caseId, bodyCids, coveredCanon) {
  const canon = (s) => (s ?? '').trim().replace(/^<|>$/g, '').toLowerCase();
  const covered = coveredCanon instanceof Set ? coveredCanon : new Set();
  const needed = [...bodyCids].filter((c) => c && !covered.has(canon(c)));
  if (!needed.length) return [];
  // Vakanın TÜM email eklerinden contentId → satır (case-scope guard: yalnız
  // bu vakanın maillerine ait ekler). Cross-case sızıntı yok.
  const rows = await prisma.caseEmailAttachment.findMany({
    where: { email: { caseId } },
    select: { contentId: true, storageKey: true, fileName: true, mimeType: true },
  });
  const byCanon = new Map();
  for (const r of rows) {
    if (!r.contentId || !r.storageKey) continue;
    const k = canon(r.contentId);
    if (k && !byCanon.has(k)) byCanon.set(k, r);
  }
  const seen = new Set();
  const items = [];
  for (const cid of needed) {
    const k = canon(cid);
    if (seen.has(k)) continue; // dedup — aynı görsel bir kez
    const row = byCanon.get(k);
    if (!row) continue; // vakada eşleşen ek yok → gövdede placeholder kalır
    const st = await statObject(row.storageKey);
    if (!st) continue; // dosya diskte yok → atla (send yine gider)
    seen.add(k);
    items.push({
      filename: row.fileName,
      content: createObjectStream(row.storageKey),
      contentType: row.mimeType,
      // Content-ID gövdedeki referansla birebir eşleşsin (bracket-sız).
      cid: String(cid).replace(/^<|>$/g, ''),
    });
  }
  return items;
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
  // Codex P2 fix — explicit reply parent receivedAt'i SADECE explicit
  // yolda set; fallback yolda null. Sebep: findThreadParentMessageId
  // messageId IS NOT NULL filter'ı uyguluyor; son inbound messageId'siz
  // ise daha eski bir inbound'a düşebilir → o eski receivedAt'i K4
  // pending hesabına pas edersek isOldReply yanlış tetiklenir.
  // UI explicit emailId pas etmediğinde "tüm thread'e cevap"
  // varsayımıyla eski simetrik mantık doğru çalışır.
  let explicitReplyInboundReceivedAt = null;
  if (typeof inReplyTo === 'string' && inReplyTo.trim()) {
    const explicit = await prisma.caseEmail.findFirst({
      where: { caseId, messageId: inReplyTo.trim() },
      select: { messageId: true, refs: true, receivedAt: true, direction: true },
    });
    if (explicit?.messageId) {
      parent = { parentMessageId: explicit.messageId, refs: explicit.refs };
      if (explicit.direction === 'inbound') {
        explicitReplyInboundReceivedAt = explicit.receivedAt;
      }
    }
    // Eğer composer'ın gönderdiği inReplyTo bu vakadaki bir CaseEmail
    // değilse (cross-case / silinmiş / outbound-only id) → fallback
    // son inbound. UI bozulmasın; security açığı yok (DB scope check).
  }
  if (!parent) {
    parent = await findThreadParentMessageId(caseId);
    // Fallback yolda explicitReplyInboundReceivedAt null kalır → pending
    // hesabı eski simetrik mantığa düşer.
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

  // ─── 5b. Inline CID seti (Ctrl+V paste image) ───
  // Sanitize SONRASINDA extract — sanitize cid img'i strip etmemeli
  // (htmlSanitizer.js allowedSchemesByTag.img: ['http','https','cid']).
  // Eğer strip olursa inlineCids boş çıkar, ekler normal (non-inline)
  // gönderilir — kullanıcı görseli mail'de göremez ama akış kırılmaz.
  const inlineCids = extractInlineCidsFromHtml(safeHtml);

  // ─── 6. Ekler ───
  const att = await loadAttachmentsForCase(caseId, attachments ?? [], inlineCids);
  if (!att.ok) return { ok: false, code: att.code, message: 'Ek erişimi başarısız.' };

  // ─── 6b. Alıntı görselleri (saha fix, UNV-1001056) ───
  // Composer ekiyle karşılanmayan cid'ler (alıntıdaki gelen-mail görselleri)
  // vakanın CaseEmailAttachment'ından yeniden eklenir → alıcının Gmail'inde
  // de görünür. Composer'ın kendi inline cid'leri (att.items[].cid) hariç.
  const coveredCanon = new Set(
    att.items
      .filter((i) => i.cid)
      .map((i) => String(i.cid).trim().replace(/^<|>$/g, '').toLowerCase()),
  );
  const quotedInline = await loadQuotedInlineAttachments(caseId, inlineCids, coveredCanon);
  const outboundAttachments = quotedInline.length
    ? [...att.items, ...quotedInline]
    : att.items;

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
      attachments: outboundAttachments,
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
      // Codex P2 fix — explicit reply parent'ın inbound receivedAt'i.
      // Sadece agent'ın tıkladığı satır için set; fallback yolda null.
      // appendOutbound bunu kullanarak "eski mail'e cevap" senaryosunda
      // pending state'i ve lastEmailOutboundAt advance'ini doğru kurar.
      replyToInboundReceivedAt: explicitReplyInboundReceivedAt,
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
        data: att.rows.map((r) => {
          const isInline = inlineCids.has(r.id);
          return {
            emailId: emailRecord.id,
            storageKey: r.fileUrl,
            fileName: r.fileName,
            mimeType: r.mimeType,
            fileSize: r.fileSize,
            // Inline (Ctrl+V paste) → contentId = attachmentId (FE cid ile
            // simetrik). Outbound thread render'ı (MailMessageCard
            // processBodyHtml) contentId → attachmentId lookup ile gövde
            // içindeki <img src="cid:xxx">'i signed URL'e çeviriyor.
            contentId: isInline ? r.id : null,
            isInline,
          };
        }),
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

  // R13 (2026-07-04) — Yanıtla referans çözümü, direction-aware:
  //   1) emailId verilmişse O SATIRI ref al (direction fark etmez); yoksa
  //   2) son inbound (klasik "karşı tarafa Re:" akışı); yoksa
  //   3) son outbound (outbound-yalnız thread — kullanıcı repro UNV-1000111
  //      Otomatik ACK'e "Yanıtla" tıklaması burada prefill üretir).
  // Codex P2 (outbound emailId → sessizce inbound fallback) davranışı
  // KALDIRILDI — outbound satıra doğrudan yanıt kullanıcı niyeti.
  let refRow = null;
  const REPLY_FIELDS = {
    fromAddress: true, fromName: true, toAddresses: true, ccAddresses: true,
    subject: true, messageId: true, direction: true,
    // Alıntı gövdesi için (2026-07-08 — Yanıtla'da geçmiş yazışma korunur;
    // standart nested quoting: parent gövde blockquote'a sarılır, zincir
    // kendiliğinden iç içe gelir — buildForwardContext ile aynı yaklaşım):
    bodyHtml: true, sentAt: true, receivedAt: true,
  };
  if (emailId) {
    refRow = await prisma.caseEmail.findFirst({
      where: { id: emailId, caseId },
      select: REPLY_FIELDS,
    });
  }
  if (!refRow) {
    refRow = await prisma.caseEmail.findFirst({
      where: { caseId, direction: 'inbound' },
      orderBy: { receivedAt: 'desc' },
      select: REPLY_FIELDS,
    });
  }
  if (!refRow) {
    refRow = await prisma.caseEmail.findFirst({
      where: { caseId, direction: 'outbound' },
      orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
      select: REPLY_FIELDS,
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
  let quotedBodyHtml = '';
  // Reply From önerisi (2026-07-08) — Multi-inbox: cevap, mailin İLGİLİ
  // OLDUĞU paylaşımlı kutudan çıkmalı (uzmandestek@'e gelen maile yanıt
  // From=uzmandestek@), bireysel ajanın/global default'un adresi DEĞİL.
  //   - gelen mail: hangi tanımlı kutuya geldiyse (To sonra Cc'de eşleşen
  //     ilk alias) → o kutu.
  //   - giden maile yanıt: o mail hangi kutudan gittiyse (fromAddress) → o
  //     kutu (aynı gönderen kimliğiyle devam).
  // aliasByKey lowercased anahtar → kanonik alias adresi.
  const aliasByKey = new Map(aliases.map((a) => [a.address.trim().toLowerCase(), a.address]));
  let suggestedFromAddress = null;
  if (refRow) {
    const refTo = parse(refRow.toAddresses);
    const refCc = parse(refRow.ccAddresses);
    if (refRow.direction === 'inbound') {
      for (const r of [...refTo, ...refCc]) {
        const k = (r?.address ?? '').trim().toLowerCase();
        if (k && aliasByKey.has(k)) { suggestedFromAddress = aliasByKey.get(k); break; }
      }
    } else {
      const k = (refRow.fromAddress ?? '').trim().toLowerCase();
      if (k && aliasByKey.has(k)) suggestedFromAddress = aliasByKey.get(k);
    }
    if (refRow.direction === 'inbound') {
      // K6 reply-all: To = [inbound.from] + inbound.to; Cc = inbound.cc
      const senderEntry = { address: refRow.fromAddress, name: refRow.fromName ?? null };
      to = filterAlias(uniq([senderEntry, ...refTo]));
      cc = filterAlias(uniq(refCc));
    } else {
      // R13 outbound-ref: agent giden mail'e yanıt yazıyor → hedef = o
      // mailin alıcıları. Kendi from adresini eklemek self-loop yaratır
      // (fromAddress alias listesinde zaten var → filterAlias düşürürdü,
      // ama niyet net: sadece to/cc).
      to = filterAlias(uniq(refTo));
      cc = filterAlias(uniq(refCc));
    }
    // Subject: token korunur; "Re: " yoksa ekle
    const baseSubject = refRow.subject ?? '';
    subject = /^re:\s*/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;
    inReplyTo = refRow.messageId;

    // Standart yanıt alıntısı — "‹tarih› tarihinde ‹gönderen› şunu yazdı:"
    // + parent gövdesini blockquote'a sar. Parent gövdesi zaten önceki
    // alıntıyı (nested blockquote) taşıdığından zincir kendiliğinden iç içe
    // gelir; ayrı thread birleştirme/dedup gerekmez (Option A).
    const ts = refRow.sentAt ?? refRow.receivedAt;
    const who = refRow.fromName
      ? `${refRow.fromName} <${refRow.fromAddress}>`
      : (refRow.fromAddress ?? '');
    const attribution = ts
      ? `${new Date(ts).toLocaleString('tr-TR')} tarihinde ${who} şunu yazdı:`
      : `${who} şunu yazdı:`;
    quotedBodyHtml = [
      '<br><br>',
      `<div>${escapeHtml(attribution)}</div>`,
      '<blockquote style="margin:0 0 0 8px;padding-left:12px;border-left:2px solid #ccc;color:#555">',
      refRow.bodyHtml ?? '',
      '</blockquote>',
    ].join('');
  }

  return {
    caseNumber: caseRow.caseNumber,
    to,
    cc,
    bcc: [],
    subject,
    inReplyTo,
    quotedBodyHtml,
    suggestedFromAddress,
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
