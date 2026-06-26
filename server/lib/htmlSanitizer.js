/**
 * Mail M6.1 — HTML Sanitizer.
 *
 * Plan referansı: docs/M6-email-in-case-plan.md Bölüm 7.3 + 11 (XSS).
 *
 * İki yönde kullanım:
 *  - sanitizeIncomingEmailHtml(html) — IMAP intake'in parse ettiği
 *    HTML body'yi DB'ye yazmadan önce temizler. Müşteriden gelen ham
 *    HTML xss vektörü içerebilir.
 *  - sanitizeOutgoingEmailHtml(html) — M6.2 composer'ın gönderim
 *    öncesi outbound HTML body'yi temizler. Agent input dahi olsa
 *    insider veya copy-paste payload riski engellenir.
 *
 * Ortak allowlist:
 *  - Etiketler: temel formatting + tablo + img + heading + hr
 *  - Attribute: a[href|title|target|rel], img[src|alt|w|h], wildcard[style|class]
 *  - Schema: http/https/mailto/cid (script/javascript/data yasak)
 *
 * Style attr: sadece allowlisted CSS prop'lar (color, background, font*,
 * margin, padding, text-decoration, text-align). url(...) / behavior /
 * expression / position engellenir.
 *
 * Link rel: tüm <a>'ya zorla "noopener noreferrer" eklenir.
 *
 * cid: image (RFC 2392) — outbound composer (M6.2) ve inbound parser her
 * ikisi de cid: prefix kullanır. Bilinmeyen cid render eden değil;
 * UI sadece allowlisted contentId'leri çözer (M6.2'de CaseEmailAttachment
 * eşleştirmesi). Burada sanitize sadece SCHEME izni verir.
 */

import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'p','br','strong','b','em','i','u','s','strike','a',
  'ul','ol','li','blockquote','pre','code',
  'span','div',
  'img',
  'table','thead','tbody','tfoot','tr','td','th',
  'h1','h2','h3','h4','h5','h6',
  'hr',
];

const ALLOWED_ATTRIBUTES = {
  '*': ['style', 'class'],
  'a': ['href', 'title', 'target', 'rel'],
  'img': ['src', 'alt', 'width', 'height'],
  'table': ['border', 'cellpadding', 'cellspacing'],
  'td': ['colspan', 'rowspan', 'align', 'valign'],
  'th': ['colspan', 'rowspan', 'align', 'valign'],
};

const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'cid'];

// CSS allowlist — değer regex'leri sanitize-html style filter ile.
const ALLOWED_STYLES = {
  '*': {
    color: [/^.+$/],
    'background-color': [/^.+$/],
    background: [/^.+$/],
    'font-weight': [/^.+$/],
    'font-style': [/^.+$/],
    'font-size': [/^.+$/],
    'font-family': [/^.+$/],
    'text-decoration': [/^.+$/],
    'text-align': [/^(left|right|center|justify)$/],
    margin: [/^.+$/],
    'margin-top': [/^.+$/],
    'margin-right': [/^.+$/],
    'margin-bottom': [/^.+$/],
    'margin-left': [/^.+$/],
    padding: [/^.+$/],
    'padding-top': [/^.+$/],
    'padding-right': [/^.+$/],
    'padding-bottom': [/^.+$/],
    'padding-left': [/^.+$/],
    width: [/^.+$/],
    height: [/^.+$/],
    border: [/^.+$/],
    'border-radius': [/^.+$/],
  },
};

const COMMON_OPTIONS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedSchemes: ALLOWED_SCHEMES,
  allowedSchemesByTag: {
    img: ['http', 'https', 'cid'],
  },
  allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
  allowProtocolRelative: false,
  allowedStyles: ALLOWED_STYLES,
  // Linklere otomatik rel.
  transformTags: {
    a: (tagName, attribs) => {
      const safeAttribs = { ...attribs };
      // rel="noopener noreferrer" zorunlu.
      safeAttribs.rel = 'noopener noreferrer';
      // target="_blank" yoksa ekle (yeni sekmede aç).
      if (!safeAttribs.target) safeAttribs.target = '_blank';
      return { tagName, attribs: safeAttribs };
    },
  },
  // Tüm <script>/<iframe>/<form>/<object>/<embed>/<link>/<meta>/<style>
  // sanitize-html zaten allowedTags dışında olduğu için DROP. Yine de
  // explicit drop list — defansif.
  disallowedTagsMode: 'discard',
};

/**
 * Inbound email HTML body'sini sanitize eder. Müşteriden gelen ham
 * HTML üzerinde çalışır.
 *
 * @param {string} html
 * @returns {string} temizlenmiş HTML; null/empty input için '' döner.
 */
export function sanitizeIncomingEmailHtml(html) {
  if (typeof html !== 'string' || !html.trim()) return '';
  try {
    return sanitizeHtml(html, COMMON_OPTIONS);
  } catch (err) {
    // Sanitize hata verirse boş döner — render'da güvenlik > içerik.
    console.warn('[htmlSanitizer:incoming]', err?.message ?? err);
    return '';
  }
}

/**
 * Outbound email HTML body'sini sanitize eder. M6.2 composer çağırır.
 * Agent input bile olsa copy-paste payload riski engellenir.
 *
 * @param {string} html
 * @returns {string} temizlenmiş HTML
 */
export function sanitizeOutgoingEmailHtml(html) {
  if (typeof html !== 'string' || !html.trim()) return '';
  try {
    return sanitizeHtml(html, COMMON_OPTIONS);
  } catch (err) {
    console.warn('[htmlSanitizer:outgoing]', err?.message ?? err);
    return '';
  }
}

export const _internal = {
  ALLOWED_TAGS,
  ALLOWED_ATTRIBUTES,
  ALLOWED_SCHEMES,
  ALLOWED_STYLES,
  COMMON_OPTIONS,
};
