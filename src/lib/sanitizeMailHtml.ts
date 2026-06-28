/**
 * Compose-Signature F4 Codex P2 fix — Paylaşılan mail HTML sanitize helper.
 *
 * Backend `server/lib/htmlSanitizer.js` `ALLOWED_ATTRIBUTES` listesi
 * tablo bazlı email layout'larını korumak için tablo özniteliklerini
 * (border, cellpadding, cellspacing, colspan, rowspan, align, valign)
 * allowlist'ine alır. Eski mail client uyumluluğu için kurumsal şablonlar
 * tablo paternine güvenir; sanitize'da bunları silmek admin'in tasarladığı
 * şablonu bozar.
 *
 * Frontend DOMPurify config'leri (CompanySignatureTemplate canlı önizleme,
 * AdminEmailTemplatesPage preview modal, MailMessageCard render) önce
 * EKSIKTI — bu helper backend'le birebir hizalı tek bir allowlist sağlar.
 *
 * KARARLAR:
 *  - Ortak ALLOWED_ATTR + FORBID_TAGS — backend mirror (table attrs + img
 *    attrs + a attrs + style/class)
 *  - USE_PROFILES: { html: true } — DOMPurify default web HTML profile
 *  - Caller'lar tek import + tek fonksiyon; tek satırda config yok
 *
 * Mevcut MailMessageCard config'i de bu helper'a geçirildi (tutarlılık) —
 * tablo'lu inbound mail render'ı artık tablo attrs'lerini bozmaz.
 */
import DOMPurify from 'dompurify';

const ALLOWED_ATTR = [
  // Standart inline + link
  'href', 'title', 'target', 'rel',
  // Image
  'src', 'alt', 'width', 'height',
  // Inline style + class (allowlist + style filter backend tarafı korur)
  'style', 'class',
  // Tablo bazlı email layout (Codex P2 fix — backend sanitize-html
  // ALLOWED_ATTRIBUTES paterniyle mirror; server/lib/htmlSanitizer.js)
  'border', 'cellpadding', 'cellspacing',
  'colspan', 'rowspan', 'align', 'valign',
];

const FORBID_TAGS = [
  'script', 'iframe', 'form', 'object', 'embed',
  'link', 'meta', 'style',
];

/**
 * Mail HTML preview/render path'leri için DOMPurify sarmal.
 * Backend sanitize-html save öncesi zaten temizler; bu defense-in-depth
 * client-side ek katman.
 */
export function sanitizeMailHtml(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return '';
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_ATTR,
    FORBID_TAGS,
  });
}
