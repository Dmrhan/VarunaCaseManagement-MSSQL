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
 * Template metnindeki {{varName}} ifadelerini değiştirir.
 * Bilinmeyen var → empty string + missing[] listesinde toplanır.
 *
 * @returns { text, missing: string[] }
 */
export function renderPlaceholders(template, values) {
  if (typeof template !== 'string') return { text: '', missing: [] };
  const missing = [];
  const text = template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9._]*)\s*\}\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return String(values[key] ?? '');
    }
    missing.push(key);
    return '';
  });
  return { text, missing };
}

/**
 * Composer preview entry point — subject + bodyHtml render.
 * @returns { subject, bodyHtml, missing: string[] }
 */
export function renderTemplate(template, caseRow, actor) {
  const values = buildPlaceholderValues(caseRow, actor);
  const subjOut = template?.subject
    ? renderPlaceholders(template.subject, values)
    : { text: null, missing: [] };
  const bodyOut = renderPlaceholders(template?.bodyHtml ?? '', values);
  return {
    subject: subjOut.text,
    bodyHtml: bodyOut.text,
    missing: Array.from(new Set([...subjOut.missing, ...bodyOut.missing])),
  };
}
