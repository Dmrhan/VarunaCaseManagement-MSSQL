/**
 * Mail M6.3b Faz 3 — Email template placeholder render engine.
 *
 * n4b S9 endüstri parite (Zendesk/Freshdesk/BoldDesk): Mustache benzeri
 *   {{varName}} interpolation.
 *
 * v1 sistem placeholder whitelist (6 alan):
 *   - case.number       — Case.caseNumber
 *   - case.title        — Case.title
 *   - account.name      — Case.accountName (denormalized)
 *   - requester.name    — Case.customerContactName
 *   - requester.email   — Case.customerContactEmail
 *   - agent.fullName    — actor.fullName (request kullanıcısı)
 *
 * Bilinmeyen placeholder → empty string (silent; admin preview'da
 * "missing_var" warning döner ki template editor görsün).
 */

const SYSTEM_PLACEHOLDERS = new Set([
  'case.number',
  'case.title',
  'account.name',
  'requester.name',
  'requester.email',
  'agent.fullName',
]);

export function listSystemPlaceholders() {
  return Array.from(SYSTEM_PLACEHOLDERS);
}

/**
 * Case row + actor verilen değişkenleri kurar.
 * @param {Object} caseRow — prisma.case row (caseNumber, title, accountName, customerContact*)
 * @param {Object} actor — { fullName }
 */
export function buildPlaceholderValues(caseRow, actor) {
  return {
    'case.number': caseRow?.caseNumber ?? '',
    'case.title': caseRow?.title ?? '',
    'account.name': caseRow?.accountName ?? '',
    'requester.name': caseRow?.customerContactName ?? '',
    'requester.email': caseRow?.customerContactEmail ?? '',
    'agent.fullName': actor?.fullName ?? '',
  };
}

/**
 * HTML special char escape — Codex P2 fix.
 *
 * Bağlam: bodyHtml template'i admin save'de sanitize edilir ama placeholder
 * değerleri sonradan (runtime) interpolate edilir. Eğer Case.title /
 * customerContactName / accountName gibi alanlarda `<a>` / `<img>` /
 * `<script>` benzeri HTML varsa (inbound mail subject, vCard, vs.) bu
 * markup composer'a "gerçek HTML" olarak girer → giden mail bozulur veya
 * istem dışı içerik gönderilir.
 *
 * Eskiden plaintext kabul edilen string'leri HTML context'e koymadan ÖNCE
 * 5-char escape (en konservatif allowlist).
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Template metnindeki {{varName}} ifadelerini değiştirir.
 * Bilinmeyen var → empty string + missing[] listesinde toplanır.
 *
 * @param {Object} opts
 * @param {boolean} [opts.htmlEscape=false] — true ise yerleştirilen value
 *   HTML escape edilir. Subject (plain text) için false; bodyHtml için true.
 * @returns { text, missing: string[] }
 */
export function renderPlaceholders(template, values, opts = {}) {
  if (typeof template !== 'string') return { text: '', missing: [] };
  const htmlEscape = !!opts.htmlEscape;
  const missing = [];
  const text = template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9._]*)\s*\}\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      const raw = String(values[key] ?? '');
      return htmlEscape ? escapeHtml(raw) : raw;
    }
    missing.push(key);
    return '';
  });
  return { text, missing };
}

/**
 * Composer preview entry point — subject + bodyHtml render.
 *
 * Subject: text-only (composer subject input plain text alanı). Escape YOK
 * (kullanıcı görürse bile mail header'a giderken zaten encoded).
 *
 * BodyHtml: TipTap rich text alanına gider → HTML context. Placeholder
 * value'ları ESCAPE et (XSS-style markup injection korunsun).
 *
 * @returns { subject, bodyHtml, missing: string[] }
 */
export function renderTemplate(template, caseRow, actor) {
  const values = buildPlaceholderValues(caseRow, actor);
  const subjOut = template?.subject
    ? renderPlaceholders(template.subject, values, { htmlEscape: false })
    : { text: null, missing: [] };
  const bodyOut = renderPlaceholders(template?.bodyHtml ?? '', values, { htmlEscape: true });
  return {
    subject: subjOut.text,
    bodyHtml: bodyOut.text,
    missing: Array.from(new Set([...subjOut.missing, ...bodyOut.missing])),
  };
}
