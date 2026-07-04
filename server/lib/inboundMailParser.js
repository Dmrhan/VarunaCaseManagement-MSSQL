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
 * Content-ID normalize — mailparser'dan gelen cid / contentId değerini
 * MailMessageCard.cidMap ile aynı formata düşür.
 *
 * mailparser sürüm/sürücü'ye göre iki farklı alan set eder:
 *   - a.cid       — bracket-strip shortcut (bazen yok)
 *   - a.contentId — RFC 2392 formatlı (`<abc@host>`)
 *
 * cidMap raw + stripped + stripped.toLowerCase() varyantlarını tutuyor,
 * yani hangi format yazılırsa yazılsın lookup yakalar; ama biz DB'ye tek
 * bir değer yazıyoruz → stripped versiyonu tercih (bracket'sız), 3
 * varyant lookup zaten toleranslı. Boş/whitespace → null.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeCid(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/^<|>$/g, '').trim();
  return s.length > 0 ? s : null;
}

/**
 * 2026-07-04 — KRİTİK: mailparser inline CID attachment'ları HTML'e
 * `data:image/png;base64,<content>` olarak GÖMÜYOR (cid: referansını
 * kendisi çözüyor). sanitizeIncomingEmailHtml `data:` şemasını (doğru
 * olarak, XSS + MB'larca base64 şişkinliği) yasakladığı için src'ler
 * SÖKÜLÜYOR → DB'ye src'siz <img> yazılıyor → thread'de kırık img.
 *
 * Deneyle kanıtlandı: multipart/related + Content-ID'li png ham MIME
 * → simpleParser çıktısı `parsed.html` içinde `data:image/png;base64,...`.
 * `p.attachments[0]` cid='img1@test' contentType='image/png' related=true.
 *
 * Fix: Ters eşleme. Sanitize'dan ÖNCE parsed.html'de her related+cid'li
 * ek için:
 *   needle      = `data:${contentType};base64,${content.toString('base64')}`
 *   replacement = `cid:${normalizedCid}`
 * mailparser data-URI'yi AYNI Buffer'dan ürettiği için base64 birebir
 * eşleşir. SONRA sanitize → cid: allowedSchemesByTag.img izinli → src
 * KORUNUR → mevcut render zinciri (contentId map + getAttachmentDownload)
 * çalışır. data:'yı sanitizer'da SERBEST BIRAKMA (XSS yüzeyi + gövde
 * şişkinliği).
 *
 * @param {string|null} html
 * @param {Array} mpAttachments — ham mailparser attachments (content Buffer + cid + contentType)
 * @returns {string|null}
 */
function rewriteDataUrisToCids(html, mpAttachments) {
  if (typeof html !== 'string' || !html) return html;
  if (!Array.isArray(mpAttachments) || mpAttachments.length === 0) return html;
  let out = html;
  for (const a of mpAttachments) {
    if (!a) continue;
    // cid ?? contentId fallback (a.cid bazı sürümlerde yok — sabahki fix ile
    // simetrik). related=true şart değil; inline CID yeterli (bazı istemciler
    // related header'ı koymayabilir).
    const rawCid = a.cid ?? a.contentId;
    const cid = normalizeCid(rawCid);
    if (!cid) continue;
    if (!Buffer.isBuffer(a.content) || a.content.length === 0) continue;
    const contentType = String(a.contentType ?? '').trim();
    if (!contentType) continue;
    // needle: mailparser tam bu şekilde üretir (data:CT;base64,B64).
    // Base64 encoding deterministic; aynı buffer → aynı string.
    const base64 = a.content.toString('base64');
    const needle = `data:${contentType};base64,${base64}`;
    if (out.indexOf(needle) === -1) continue;
    out = out.split(needle).join(`cid:${cid}`);
  }
  return out;
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

  // 2026-07-04 — mailparser inline CID'i data:base64'e gömüyor; sanitize
  // data:'yı yasaklıyor → src siliniyor. Ters eşleme ile data-URI'leri
  // cid:'e geri çevir; SONRA sanitize cid'i preserve eder.
  const rawHtml = parsed.html === false ? null : (parsed.html ?? null);
  const html = rewriteDataUrisToCids(rawHtml, attachments);

  return {
    ok: true,
    data: {
      from: normalizeAddress(parsed.from),
      to: normalizeAddressList(parsed.to),
      cc: normalizeAddressList(parsed.cc),
      replyTo: normalizeAddress(parsed.replyTo),
      subject: (parsed.subject ?? '').trim() || null,
      text: parsed.text ?? null,
      html,
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
        // M6.3a fix (2026-07-03) — mailparser bazı sürümlerde `a.cid`
        // (bracket-strip shortcut) set etmez; sadece `a.contentId` (`<...@..>`
        // formatında) döner. Önceki `a.cid ? ... : null` bu durumda cid=null
        // yazar → intake CaseEmailAttachment.contentId=null → MailMessageCard
        // cidMap boş → gövde-içi görsel render başarısız (canlı repro
        // UNV-1000089, 2026-07-03). Fallback ile ve angle bracket strip.
        cid: normalizeCid(a.cid ?? a.contentId),
        inline: a.contentDisposition === 'inline' || !!(a.cid ?? a.contentId),
      })),
    },
    meta: { parsedAt, rawSource: RAW_SOURCE },
  };
}

export const inboundMailParser = {
  parseInboundEml,
};
