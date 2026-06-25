/**
 * Inbound Mail Parser — raw .eml → normalized intake shape.
 *
 * M2 kapsamı: sadece ayrıştırma. Müşteri eşleştirme + vaka oluşturma
 * inboundMailIntake.js'de (bu modül DOKUNMAZ).
 *
 * Ekler: SADECE metadata (filename, contentType, size). Dosya STORAGE'ı
 * M2'de YOK — M3'te (IMAP polling + storage entegrasyonu) eklenecek.
 *
 * Stil: server/lib/mailProvider.js + devopsClient.js ile aynı
 * (ESM .js, wrapped response, custom error class).
 */

import { simpleParser } from 'mailparser';

const RAW_SOURCE = 'inbound-mail-parser';

export class InboundMailParserError extends Error {
  constructor(message, { code = 'inbound_parse_error', status = 400 } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Address normalize — mailparser AddressObject → { name, email }.
 * İlk adresi alır (Reply-To/From genelde tek; To/Cc çoklu olabilir, ilk).
 */
function normalizeAddress(addr) {
  if (!addr) return null;
  // mailparser AddressObject: { value: [{address, name}], text }
  const first = Array.isArray(addr.value) ? addr.value[0] : null;
  if (!first) return null;
  const email = (first.address ?? '').trim().toLowerCase() || null;
  const name = (first.name ?? '').trim() || null;
  if (!email) return null;
  return { name, email };
}

/**
 * To/Cc gibi çoklu adres listesi — { name, email }[].
 */
function normalizeAddressList(addr) {
  if (!addr) return [];
  const items = Array.isArray(addr.value) ? addr.value : [];
  return items
    .map((v) => ({
      name: (v.name ?? '').trim() || null,
      email: (v.address ?? '').trim().toLowerCase() || null,
    }))
    .filter((a) => a.email);
}

/**
 * References header — boşlukla ayrılmış Message-ID listesi.
 * M4 tam threading için — M2'de parse edilir ama eşleştirme YAPILMAZ
 * (Case.threadMessageId field'ı yok; eklenmesi M4 işi).
 */
function parseReferences(refs) {
  if (!refs) return [];
  if (Array.isArray(refs)) return refs.map((r) => String(r).trim()).filter(Boolean);
  return String(refs)
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Ham .eml (Buffer | string | Stream) → normalized intake shape.
 *
 * Wrapped response döner; throw etmez. parser fail → ok:false + error.
 *
 * @param {Buffer|string|NodeJS.ReadableStream} raw
 * @returns {Promise<{
 *   ok: boolean,
 *   data?: {
 *     from: { name: string|null, email: string } | null,
 *     to: Array<{ name: string|null, email: string }>,
 *     cc: Array<{ name: string|null, email: string }>,
 *     replyTo: { name: string|null, email: string } | null,
 *     subject: string|null,
 *     text: string|null,
 *     html: string|null,
 *     messageId: string|null,
 *     inReplyTo: string|null,
 *     references: string[],
 *     date: string|null,
 *     attachments: Array<{
 *       filename: string|null,
 *       contentType: string|null,
 *       size: number,
 *       content: Buffer|null,     // M2.1 — gerçek içerik (intake disk-yazma için)
 *       cid: string|null,         // HTML inline referans
 *       inline: boolean           // disposition === 'inline' veya cid var
 *     }>
 *   },
 *   error?: { code: string, message: string, status?: number },
 *   meta?: { parsedAt: string, rawSource: string }
 * }>}
 */
export async function parseInboundEml(raw) {
  const parsedAt = new Date().toISOString();
  if (!raw) {
    return {
      ok: false,
      error: {
        code: 'inbound_input_empty',
        message: 'Ham .eml verisi (Buffer/string/Stream) gerekli.',
        status: 400,
      },
      meta: { parsedAt, rawSource: RAW_SOURCE },
    };
  }

  let parsed;
  try {
    parsed = await simpleParser(raw);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'inbound_parse_failed',
        message: err?.message ?? 'simpleParser hatası.',
        status: 400,
      },
      meta: { parsedAt, rawSource: RAW_SOURCE },
    };
  }

  const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
  // M2.1 — Ek + inline/cid görseller İÇERİK (Buffer) ile dışa verilir.
  // Storage'a yazma + caseAttachment satırı oluşturma intake katmanında
  // (inboundMailIntake.js writeCaseFile). isAcceptedUpload + boyut limiti
  // uygulamaları intake'te.

  return {
    ok: true,
    data: {
      from: normalizeAddress(parsed.from),
      to: normalizeAddressList(parsed.to),
      cc: normalizeAddressList(parsed.cc),
      replyTo: normalizeAddress(parsed.replyTo),
      subject: (parsed.subject ?? '').trim() || null,
      text: parsed.text ?? null,
      html: parsed.html === false ? null : (parsed.html ?? null),
      messageId: (parsed.messageId ?? '').trim() || null,
      inReplyTo: (parsed.inReplyTo ?? '').trim() || null,
      references: parseReferences(parsed.references),
      date: parsed.date ? new Date(parsed.date).toISOString() : null,
      attachments: attachments.map((a) => ({
        filename: a.filename ?? null,
        contentType: a.contentType ?? null,
        size: Number.isFinite(a.size) ? a.size : 0,
        // M2.1 — content Buffer; intake writeCaseFile için. cid varsa
        // HTML referansı; inline=true ise mail body içine gömülü
        // (typically image/png signature/logos).
        content: Buffer.isBuffer(a.content)
          ? a.content
          : (a.content ? Buffer.from(a.content) : null),
        cid: a.cid ? String(a.cid) : null,
        inline: a.contentDisposition === 'inline' || !!a.cid,
      })),
    },
    meta: { parsedAt, rawSource: RAW_SOURCE },
  };
}

export const inboundMailParser = {
  parseInboundEml,
};
