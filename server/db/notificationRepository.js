/**
 * WR-D4/D3 Phase 2 — Notification Rule + Template + Dispatch repository.
 *
 * Surfaces:
 *  1) NotificationRule CRUD (admin)
 *  2) NotificationTemplate CRUD (admin)
 *  3) Event emission (called from approvalRepository + transitionStatus)
 *     → rule scanner → audience resolver → template render → dispatch insert
 *  4) Dispatch read (admin viewer + case-scoped)
 *  5) Manual confirmation (operator stamps mode=Manual / state=Sent +
 *     required deliveryNote)
 *
 * Constraints (Phase 2):
 *  - mode='Active' BLOCKED at API layer (forward-compat enum value only)
 *  - No external HTTP / SMTP / Resend calls — log_only + manual_task only
 *  - Audience resolution uses Phase 1 set: assignee / team_lead / supervisor
 *    / admin / customer_primary_contact / static_email
 *  - Idempotency via partial unique index on `idempotencyKey`
 *  - Rate limit via SQL count window (no Redis)
 *
 * MSSQL portability:
 *  - All JSON storage; never query inside JSON
 *  - All enums are Prisma-managed (provider handles MSSQL string fallback)
 *  - No PG-specific syntax
 */

import { prisma } from './client.js';

// ─────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────

export class NotificationValidationError extends Error {
  constructor(message, { status = 400, code = 'notification_validation_error' } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class NotificationAccessError extends Error {
  constructor(message = 'İletişim kaydına erişim yok.') {
    super(message);
    this.code = 'NOTIFICATION_FORBIDDEN';
    this.status = 403;
  }
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const ALLOWED_EVENTS = [
  'resolution_submitted',
  'resolution_approved',
  'resolution_rejected',
  'case_closed',
  'case_reopened',
];

const ALLOWED_CHANNELS = ['InApp', 'Email', 'ManualTask']; // Webhook = Phase 4
const ALLOWED_MODES = ['LogOnly', 'Manual']; // Active = Phase 4 (blocked at API)

const ALLOWED_AUDIENCE_TYPES = [
  'assignee',
  'team_lead',
  'supervisor',
  'admin',
  'customer_primary_contact',
  'static_email',
];

const CONDITION_KEYS = ['category', 'subCategory', 'priority', 'supportLevel', 'teamId'];

const ALLOWED_VARIABLE_PATHS = [
  'case.number',
  'case.title',
  'case.description',
  'case.priority',
  'case.status',
  'case.category',
  'case.subCategory',
  'account.name',
  'company.name',
  'assignee.name',
  'team.name',
  'resolution.summary',
  'resolution.customerMessage',
  'approval.rejectionReason',
  'approval.approverName',
];

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function trimOrNull(v, max = 10000) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) {
    throw new NotificationValidationError(`Alan ${max} karakteri geçemez.`, { code: 'field_too_long' });
  }
  return s;
}

function trimRequired(v, max, fieldName, code) {
  const s = trimOrNull(v, max);
  if (!s) throw new NotificationValidationError(`${fieldName} zorunlu.`, { code });
  return s;
}

function normalizeConditions(raw) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new NotificationValidationError('conditions JSON nesne olmalı.', { code: 'conditions_invalid' });
  }
  const out = {};
  for (const k of CONDITION_KEYS) {
    if (raw[k] != null && raw[k] !== '') out[k] = String(raw[k]);
  }
  return out;
}

function normalizeAudience(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new NotificationValidationError('audience en az 1 satır içermeli.', { code: 'audience_required' });
  }
  return raw.map((row, i) => {
    if (!row || typeof row !== 'object') {
      throw new NotificationValidationError(`audience[${i}] nesne olmalı.`, { code: 'audience_invalid' });
    }
    const type = String(row.type ?? '');
    if (!ALLOWED_AUDIENCE_TYPES.includes(type)) {
      throw new NotificationValidationError(`audience[${i}].type geçersiz: ${type}`, {
        code: 'audience_type_invalid',
      });
    }
    const out = { type };
    if (row.targetValue != null && row.targetValue !== '') {
      out.targetValue = String(row.targetValue);
    }
    if (type === 'static_email' && !out.targetValue) {
      throw new NotificationValidationError(`audience[${i}] static_email için targetValue gerekli.`, {
        code: 'audience_target_required',
      });
    }
    return out;
  });
}

function normalizeRequiredVariables(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new NotificationValidationError('requiredVariables array olmalı.', { code: 'required_vars_invalid' });
  }
  return raw.map((v, i) => {
    const s = String(v ?? '').trim();
    if (!s) {
      throw new NotificationValidationError(`requiredVariables[${i}] boş olamaz.`, { code: 'required_var_empty' });
    }
    if (!ALLOWED_VARIABLE_PATHS.includes(s)) {
      throw new NotificationValidationError(
        `requiredVariables[${i}] tanınmayan değişken: ${s}. İzinli: ${ALLOWED_VARIABLE_PATHS.join(', ')}`,
        { code: 'required_var_unknown' },
      );
    }
    return s;
  });
}

// ─────────────────────────────────────────────────────────────────
// Template render
// ─────────────────────────────────────────────────────────────────

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Render a template body with a flat variable map. Unknown variables
 * are replaced with `[X eksik]` and reported via `missing` array.
 *
 * Returns { rendered, missing: string[] }.
 */
export function renderTemplate(text, vars) {
  if (text == null) return { rendered: '', missing: [] };
  const missing = [];
  const rendered = String(text).replace(VAR_RE, (_, key) => {
    const value = vars[key];
    if (value == null || value === '') {
      if (!missing.includes(key)) missing.push(key);
      return `[${key} eksik]`;
    }
    return String(value);
  });
  return { rendered, missing };
}

/**
 * Build the flat variable map for a (case, approval) tuple. Approval is
 * optional — null for events that don't carry one (e.g. case_closed
 * without a policy).
 */
export function buildTemplateVars({ caseRow, approval }) {
  return {
    'case.number': caseRow?.caseNumber ?? '',
    'case.title': caseRow?.title ?? '',
    'case.description': (caseRow?.description ?? '').slice(0, 500),
    'case.priority': caseRow?.priority ?? '',
    'case.status': caseRow?.status ?? '',
    'case.category': caseRow?.category ?? '',
    'case.subCategory': caseRow?.subCategory ?? '',
    'account.name': caseRow?.accountName ?? '',
    'company.name': caseRow?.companyName ?? '',
    'assignee.name': caseRow?.assignedPersonName ?? '',
    'team.name': caseRow?.assignedTeamName ?? '',
    'resolution.summary': approval?.resolutionSummary ?? '',
    'resolution.customerMessage': approval?.customerMessageDraft ?? '',
    'approval.rejectionReason': approval?.rejectionReason ?? '',
    'approval.approverName': approval?.approverName ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────
// Template CRUD
// ─────────────────────────────────────────────────────────────────

export async function listTemplates({ allowedCompanyIds, companyId = null }) {
  const allowed = ensureArray(allowedCompanyIds);
  if (allowed.length === 0) return [];
  if (companyId && !allowed.includes(companyId)) return [];
  const where = companyId ? { companyId } : { companyId: { in: allowed } };
  return prisma.notificationTemplate.findMany({
    where,
    orderBy: [{ companyId: 'asc' }, { name: 'asc' }],
  });
}

export async function getTemplate({ id, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const row = await prisma.notificationTemplate.findUnique({ where: { id } });
  if (!row) return null;
  if (!allowed.includes(row.companyId)) return null;
  return row;
}

export async function createTemplate({ data, user, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const companyId = data.companyId;
  if (!companyId || !allowed.includes(companyId)) {
    throw new NotificationAccessError('Bu şirkete erişim yok.');
  }
  const key = trimRequired(data.key, 100, 'key', 'key_required');
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    throw new NotificationValidationError(
      'key sadece küçük harf / rakam / alt çizgi ve harfle başlamalı (örn. approval_pending).',
      { code: 'key_format_invalid' },
    );
  }
  const name = trimRequired(data.name, 200, 'name', 'name_required');
  const subjectTemplate = trimRequired(data.subjectTemplate, 500, 'subjectTemplate', 'subject_required');
  const bodyTemplate = trimRequired(data.bodyTemplate, 10000, 'bodyTemplate', 'body_required');
  const description = trimOrNull(data.description, 1000);
  const requiredVariables = normalizeRequiredVariables(data.requiredVariables);
  const format = data.format === 'html' ? 'html' : 'plain';

  const dup = await prisma.notificationTemplate.findUnique({
    where: { companyId_key: { companyId, key } },
  });
  if (dup) {
    throw new NotificationValidationError(`Bu şirkette "${key}" anahtarı zaten kullanımda.`, {
      status: 409,
      code: 'key_duplicate',
    });
  }

  return prisma.notificationTemplate.create({
    data: {
      companyId,
      key,
      name,
      description,
      subjectTemplate,
      bodyTemplate,
      format,
      isCustomerFacing: !!data.isCustomerFacing,
      requiredVariables,
      isActive: data.isActive !== false,
      createdByUserId: user?.id ?? null,
    },
  });
}

export async function updateTemplate({ id, data, allowedCompanyIds }) {
  const existing = await prisma.notificationTemplate.findUnique({ where: { id } });
  if (!existing || !ensureArray(allowedCompanyIds).includes(existing.companyId)) {
    throw new NotificationAccessError('Şablona erişim yok.');
  }
  const patch = {};
  if (data.name !== undefined) patch.name = trimRequired(data.name, 200, 'name', 'name_required');
  if (data.description !== undefined) patch.description = trimOrNull(data.description, 1000);
  if (data.subjectTemplate !== undefined) {
    patch.subjectTemplate = trimRequired(data.subjectTemplate, 500, 'subjectTemplate', 'subject_required');
  }
  if (data.bodyTemplate !== undefined) {
    patch.bodyTemplate = trimRequired(data.bodyTemplate, 10000, 'bodyTemplate', 'body_required');
  }
  if (data.format !== undefined) patch.format = data.format === 'html' ? 'html' : 'plain';
  if (data.isCustomerFacing !== undefined) patch.isCustomerFacing = !!data.isCustomerFacing;
  if (data.requiredVariables !== undefined) {
    patch.requiredVariables = normalizeRequiredVariables(data.requiredVariables);
  }
  if (data.isActive !== undefined) patch.isActive = !!data.isActive;
  // Bump version on content change.
  if (patch.subjectTemplate || patch.bodyTemplate || patch.format) {
    patch.version = existing.version + 1;
  }
  return prisma.notificationTemplate.update({ where: { id }, data: patch });
}

// ─────────────────────────────────────────────────────────────────
// Template preview (no DB write)
// ─────────────────────────────────────────────────────────────────

/**
 * Render a template with a sample variable map (or a real case if given).
 * Returns { subject, body, missing } — admin UI uses this for the
 * split-pane preview pane.
 */
export async function previewTemplate({ templateId, sampleCaseId, allowedCompanyIds, vars: extraVars }) {
  const tpl = await getTemplate({ id: templateId, allowedCompanyIds });
  if (!tpl) {
    throw new NotificationValidationError('Şablon bulunamadı veya erişim yok.', {
      status: 404,
      code: 'template_not_found',
    });
  }
  let vars;
  if (sampleCaseId) {
    const caseRow = await prisma.case.findUnique({ where: { id: sampleCaseId } });
    if (!caseRow || !ensureArray(allowedCompanyIds).includes(caseRow.companyId)) {
      throw new NotificationValidationError('Örnek vaka erişimi yok.', {
        status: 404,
        code: 'sample_case_not_found',
      });
    }
    vars = buildTemplateVars({ caseRow, approval: null });
  } else {
    vars = buildTemplateVars({
      caseRow: {
        caseNumber: 'VK-PREVIEW',
        title: '[Örnek başlık]',
        description: '[Örnek açıklama]',
        priority: 'Medium',
        status: 'Açık',
        accountName: '[Örnek Müşteri]',
        companyName: '[Şirket]',
        assignedPersonName: '[Atanan]',
        assignedTeamName: '[Takım]',
        category: '[Kategori]',
        subCategory: '[Alt Kategori]',
      },
      approval: null,
    });
  }
  if (extraVars && typeof extraVars === 'object') vars = { ...vars, ...extraVars };

  const { rendered: subject, missing: missingSubject } = renderTemplate(tpl.subjectTemplate, vars);
  const { rendered: body, missing: missingBody } = renderTemplate(tpl.bodyTemplate, vars);
  const missing = Array.from(new Set([...missingSubject, ...missingBody]));
  return { subject, body, missing };
}

// ─────────────────────────────────────────────────────────────────
// Rule CRUD
// ─────────────────────────────────────────────────────────────────

export async function listRules({ allowedCompanyIds, companyId = null }) {
  const allowed = ensureArray(allowedCompanyIds);
  if (allowed.length === 0) return [];
  if (companyId && !allowed.includes(companyId)) return [];
  const where = companyId ? { companyId } : { companyId: { in: allowed } };
  return prisma.notificationRule.findMany({
    where,
    orderBy: [{ companyId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { template: { select: { id: true, key: true, name: true, isCustomerFacing: true } } },
  });
}

export async function getRule({ id, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const row = await prisma.notificationRule.findUnique({
    where: { id },
    include: { template: { select: { id: true, key: true, name: true, isCustomerFacing: true } } },
  });
  if (!row) return null;
  if (!allowed.includes(row.companyId)) return null;
  return row;
}

function validateChannelAndMode({ channel, mode }) {
  if (!ALLOWED_CHANNELS.includes(channel)) {
    throw new NotificationValidationError(`channel geçersiz: ${channel}`, { code: 'channel_invalid' });
  }
  if (mode === 'Active') {
    throw new NotificationValidationError(
      'mode=Active Phase 4 ile birlikte gelecek; şu an LogOnly veya Manual seçebilirsin.',
      { code: 'mode_active_not_allowed' },
    );
  }
  if (!ALLOWED_MODES.includes(mode)) {
    throw new NotificationValidationError(`mode geçersiz: ${mode}`, { code: 'mode_invalid' });
  }
}

export async function createRule({ data, user, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const companyId = data.companyId;
  if (!companyId || !allowed.includes(companyId)) {
    throw new NotificationAccessError('Bu şirkete erişim yok.');
  }
  const name = trimRequired(data.name, 200, 'name', 'name_required');
  const event = String(data.event ?? '');
  if (!ALLOWED_EVENTS.includes(event)) {
    throw new NotificationValidationError(`event geçersiz: ${event}`, { code: 'event_invalid' });
  }
  const conditions = normalizeConditions(data.conditions);
  const isMatchAll = !!data.isMatchAll;
  // Safety: conditions={} must be paired with explicit isMatchAll=true.
  if (Object.keys(conditions).length === 0 && !isMatchAll) {
    throw new NotificationValidationError(
      'Filtre vermediysen "Her vakaya uygula" onayı zorunlu.',
      { code: 'match_all_confirm_required' },
    );
  }
  const audience = normalizeAudience(data.audience);
  const channel = String(data.channel ?? '');
  const mode = String(data.mode ?? 'LogOnly');
  validateChannelAndMode({ channel, mode });

  const template = await getTemplate({ id: data.templateId, allowedCompanyIds });
  if (!template) {
    throw new NotificationValidationError('Şablon bulunamadı veya bu şirkete ait değil.', {
      code: 'template_not_found',
    });
  }
  if (template.companyId !== companyId) {
    throw new NotificationValidationError('Şablon farklı şirkete bağlı.', { code: 'template_company_mismatch' });
  }

  return prisma.notificationRule.create({
    data: {
      companyId,
      name,
      description: trimOrNull(data.description, 1000),
      isActive: data.isActive !== false,
      sortOrder: Number.isFinite(data.sortOrder) ? Number(data.sortOrder) : 100,
      event,
      conditions,
      isMatchAll,
      audience,
      templateId: template.id,
      channel,
      mode,
      suppressDuplicateWithinMinutes:
        data.suppressDuplicateWithinMinutes != null
          ? Math.max(0, Number(data.suppressDuplicateWithinMinutes))
          : null,
      rateLimitPerHour:
        data.rateLimitPerHour != null ? Math.max(0, Number(data.rateLimitPerHour)) : null,
      createdByUserId: user?.id ?? null,
    },
  });
}

export async function updateRule({ id, data, allowedCompanyIds }) {
  const existing = await prisma.notificationRule.findUnique({ where: { id } });
  if (!existing || !ensureArray(allowedCompanyIds).includes(existing.companyId)) {
    throw new NotificationAccessError('Kurala erişim yok.');
  }
  const patch = {};
  if (data.name !== undefined) patch.name = trimRequired(data.name, 200, 'name', 'name_required');
  if (data.description !== undefined) patch.description = trimOrNull(data.description, 1000);
  if (data.isActive !== undefined) patch.isActive = !!data.isActive;
  if (data.sortOrder !== undefined) {
    patch.sortOrder = Number.isFinite(data.sortOrder) ? Number(data.sortOrder) : existing.sortOrder;
  }
  if (data.event !== undefined) {
    if (!ALLOWED_EVENTS.includes(data.event)) {
      throw new NotificationValidationError(`event geçersiz: ${data.event}`, { code: 'event_invalid' });
    }
    patch.event = data.event;
  }
  if (data.conditions !== undefined || data.isMatchAll !== undefined) {
    const conditions =
      data.conditions !== undefined ? normalizeConditions(data.conditions) : existing.conditions;
    const isMatchAll = data.isMatchAll !== undefined ? !!data.isMatchAll : existing.isMatchAll;
    if (Object.keys(conditions ?? {}).length === 0 && !isMatchAll) {
      throw new NotificationValidationError(
        'Filtre vermediysen "Her vakaya uygula" onayı zorunlu.',
        { code: 'match_all_confirm_required' },
      );
    }
    patch.conditions = conditions;
    patch.isMatchAll = isMatchAll;
  }
  if (data.audience !== undefined) patch.audience = normalizeAudience(data.audience);
  if (data.channel !== undefined || data.mode !== undefined) {
    const channel = data.channel ?? existing.channel;
    const mode = data.mode ?? existing.mode;
    validateChannelAndMode({ channel, mode });
    patch.channel = channel;
    patch.mode = mode;
  }
  if (data.templateId !== undefined) {
    const tpl = await getTemplate({ id: data.templateId, allowedCompanyIds });
    if (!tpl || tpl.companyId !== existing.companyId) {
      throw new NotificationValidationError('Şablon bulunamadı veya farklı şirkete bağlı.', {
        code: 'template_invalid',
      });
    }
    patch.templateId = tpl.id;
  }
  if (data.suppressDuplicateWithinMinutes !== undefined) {
    patch.suppressDuplicateWithinMinutes =
      data.suppressDuplicateWithinMinutes == null
        ? null
        : Math.max(0, Number(data.suppressDuplicateWithinMinutes));
  }
  if (data.rateLimitPerHour !== undefined) {
    patch.rateLimitPerHour =
      data.rateLimitPerHour == null ? null : Math.max(0, Number(data.rateLimitPerHour));
  }
  return prisma.notificationRule.update({ where: { id }, data: patch });
}

// ─────────────────────────────────────────────────────────────────
// Rule matching
// ─────────────────────────────────────────────────────────────────

function ruleMatchesCase(rule, caseRow) {
  const c = rule.conditions || {};
  if (c.category && c.category !== caseRow.category) return false;
  if (c.subCategory && c.subCategory !== caseRow.subCategory) return false;
  if (c.priority && c.priority !== caseRow.priority) return false;
  if (c.supportLevel && c.supportLevel !== caseRow.supportLevel) return false;
  if (c.teamId && c.teamId !== caseRow.assignedTeamId) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Audience resolution
// ─────────────────────────────────────────────────────────────────

async function resolveAudienceRow({ row, caseRow, approval }) {
  switch (row.type) {
    case 'assignee': {
      const personId = caseRow.assignedPersonId;
      if (!personId) return { audienceType: 'assignee', audienceIdentifier: 'unresolved', display: '' };
      const p = await prisma.person.findUnique({
        where: { id: personId },
        select: { id: true, name: true, email: true },
      });
      return {
        audienceType: 'assignee',
        audienceIdentifier: p?.email || p?.id || 'unresolved',
        display: p?.name ?? '',
      };
    }
    case 'team_lead': {
      if (!caseRow.assignedTeamId) {
        return { audienceType: 'team_lead', audienceIdentifier: 'unresolved', display: '' };
      }
      const lead = await prisma.person.findFirst({
        where: { teamId: caseRow.assignedTeamId, isTeamLead: true, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, email: true },
      });
      return {
        audienceType: 'team_lead',
        audienceIdentifier: lead?.email || lead?.id || 'unresolved',
        display: lead?.name ?? '',
      };
    }
    case 'supervisor':
    case 'admin': {
      const roleName = row.type === 'supervisor' ? 'Supervisor' : 'Admin';
      const memberships = await prisma.userCompany.findMany({
        where: { role: roleName, companyId: caseRow.companyId, isActive: true },
        select: { user: { select: { id: true, email: true, personId: true, fullName: true } } },
      });
      const recipients = memberships
        .map((m) => m.user)
        .filter((u) => !!u && !!u.email);
      if (recipients.length === 0) {
        return { audienceType: row.type, audienceIdentifier: 'unresolved', display: '' };
      }
      // Phase 2: one dispatch per audience row → pick deterministic first.
      // Multi-recipient fan-out deferred to Phase 4.
      recipients.sort((a, b) => (a.email > b.email ? 1 : -1));
      return {
        audienceType: row.type,
        audienceIdentifier: recipients[0].email,
        display: recipients[0].fullName ?? '',
      };
    }
    case 'customer_primary_contact': {
      if (!caseRow.accountId) {
        return {
          audienceType: 'customer_primary_contact',
          audienceIdentifier: 'unresolved',
          display: '',
        };
      }
      const primary = await prisma.accountContact.findFirst({
        where: { accountId: caseRow.accountId, isPrimary: true, isActive: true },
        select: { fullName: true, email: true, phone: true, preferredChannel: true },
      });
      const identifier = primary?.email || primary?.phone || 'unresolved';
      return {
        audienceType: 'customer_primary_contact',
        audienceIdentifier: identifier,
        display: primary?.fullName ?? '',
      };
    }
    case 'static_email': {
      return {
        audienceType: 'static_email',
        audienceIdentifier: String(row.targetValue ?? '').toLowerCase(),
        display: '',
      };
    }
    default:
      return { audienceType: row.type, audienceIdentifier: 'unresolved', display: '' };
  }
}

// ─────────────────────────────────────────────────────────────────
// Event emission — rule scanner → dispatch creator
// ─────────────────────────────────────────────────────────────────

/**
 * Emit an event. Looks up active rules matching (companyId, event),
 * filters by conditions, resolves audiences, renders templates, and
 * inserts NotificationDispatch rows.
 *
 * Phase 2 behavior:
 *  - All rules created with mode=LogOnly or Manual (Active blocked).
 *  - Dispatch.state = 'Pending' for Manual mode (awaiting operator
 *    confirm); 'Sent' for LogOnly InApp; 'Pending' for LogOnly Email/
 *    ManualTask (operator decides whether to handle).
 *  - Idempotency: if (companyId, event, caseId, audienceIdentifier,
 *    templateId, windowBucket) collides on the partial unique index,
 *    Prisma throws P2002 → we record a Suppressed row instead.
 *
 * Returns array of created NotificationDispatch rows (or suppressed/
 * unresolvable summaries). NEVER throws — emission failures should
 * not block the underlying business action (approve/reject/close).
 *
 * @param {Object} args
 * @param {string} args.event — One of ALLOWED_EVENTS
 * @param {string} args.caseId
 * @param {Object} [args.approvalContext] — { resolutionSummary?,
 *   customerMessageDraft?, rejectionReason?, approverName? }
 */
export async function emitEvent({ event, caseId, approvalContext = null }) {
  try {
    if (!ALLOWED_EVENTS.includes(event)) return [];
    const caseRow = await prisma.case.findUnique({ where: { id: caseId } });
    if (!caseRow) return [];

    const rules = await prisma.notificationRule.findMany({
      where: { companyId: caseRow.companyId, event, isActive: true },
      include: { template: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (rules.length === 0) return [];

    const matched = rules.filter((r) => r.isMatchAll || ruleMatchesCase(r, caseRow));
    if (matched.length === 0) return [];

    const created = [];
    for (const rule of matched) {
      if (!rule.template) continue; // defensive

      // P2 review fix — rateLimitPerHour enforcement.
      // Count non-Suppressed dispatches for (companyId, ruleId) in the last
      // 60 minutes. Suppressed rows don't consume a slot (they never fired
      // a real notification). If we are at or above the cap, every audience
      // row in this rule becomes a Suppressed audit entry with
      // suppressionReason='rate_limit_exceeded' — operator/admin can see
      // the rule fired again but was throttled.
      let rateLimited = false;
      if (rule.rateLimitPerHour && rule.rateLimitPerHour > 0) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentCount = await prisma.notificationDispatch.count({
          where: {
            companyId: caseRow.companyId,
            ruleId: rule.id,
            createdAt: { gte: oneHourAgo },
            state: { not: 'Suppressed' },
          },
        });
        if (recentCount >= rule.rateLimitPerHour) rateLimited = true;
      }

      // Audience resolution may produce 0..N rows per rule.audience entry.
      // Phase 2 currently emits ONE dispatch per audience row.
      for (const audienceRow of rule.audience) {
        const resolved = await resolveAudienceRow({
          row: audienceRow,
          caseRow,
          approval: approvalContext,
        });

        // Render snapshot
        const vars = buildTemplateVars({ caseRow, approval: approvalContext });
        const { rendered: snapshotSubject } = renderTemplate(rule.template.subjectTemplate, vars);
        const { rendered: snapshotBody } = renderTemplate(rule.template.bodyTemplate, vars);

        // Idempotency key (windowBucket = floor(now/min)).
        let idempotencyKey = null;
        if (rule.suppressDuplicateWithinMinutes && rule.suppressDuplicateWithinMinutes > 0) {
          const windowMs = rule.suppressDuplicateWithinMinutes * 60000;
          const bucket = Math.floor(Date.now() / windowMs);
          idempotencyKey = `${caseRow.companyId}:${event}:${caseId}:${resolved.audienceIdentifier}:${rule.templateId}:${bucket}`;
        }

        // Determine state. LogOnly + InApp → Sent (in-app delivered
        // synchronously via CaseNotification down the road). All other
        // Phase 2 combinations → Pending (awaiting operator action).
        let state = 'Pending';
        if (rule.mode === 'LogOnly' && rule.channel === 'InApp') state = 'Sent';

        // Audience unresolvable → Suppressed.
        let suppressionReason = null;
        if (resolved.audienceIdentifier === 'unresolved') {
          state = 'Suppressed';
          suppressionReason = 'audience_unresolvable';
        }

        // Rate-limit takes precedence over normal emission — never insert
        // an active row when the rule is throttled. Idempotency key is
        // cleared so the Suppressed audit row never collides with the
        // dedup unique index.
        if (rateLimited && state !== 'Suppressed') {
          state = 'Suppressed';
          suppressionReason = 'rate_limit_exceeded';
          idempotencyKey = null;
        }

        try {
          const dispatch = await prisma.notificationDispatch.create({
            data: {
              caseId,
              companyId: caseRow.companyId,
              event,
              ruleId: rule.id,
              ruleNameSnapshot: rule.name,
              templateId: rule.templateId,
              templateKeySnapshot: rule.template.key,
              templateVersionSnapshot: rule.template.version,
              audienceType: resolved.audienceType,
              audienceIdentifier: resolved.audienceIdentifier,
              channel: rule.channel,
              mode: rule.mode,
              state,
              snapshotSubject,
              snapshotBody,
              suppressionReason,
              idempotencyKey,
            },
          });
          created.push(dispatch);
        } catch (err) {
          // P2002 = unique violation on idempotencyKey → suppressed dedup.
          if (err?.code === 'P2002') {
            const dispatch = await prisma.notificationDispatch.create({
              data: {
                caseId,
                companyId: caseRow.companyId,
                event,
                ruleId: rule.id,
                ruleNameSnapshot: rule.name,
                templateId: rule.templateId,
                templateKeySnapshot: rule.template.key,
                templateVersionSnapshot: rule.template.version,
                audienceType: resolved.audienceType,
                audienceIdentifier: resolved.audienceIdentifier,
                channel: rule.channel,
                mode: rule.mode,
                state: 'Suppressed',
                snapshotSubject,
                snapshotBody,
                suppressionReason: 'duplicate_within_window',
                idempotencyKey: null,
              },
            });
            created.push(dispatch);
          } else {
            console.error('[notification:emit] dispatch insert failed', err?.code, err?.message);
          }
        }
      }
    }

    // Set Case.communicationState if any dispatch needs operator action.
    const needsAction = created.some(
      (d) => d.state === 'Pending' && (d.mode === 'Manual' || d.channel === 'ManualTask' || d.channel === 'Email'),
    );
    if (needsAction) {
      await prisma.case.update({
        where: { id: caseId },
        data: { communicationState: 'Pending' },
      }).catch(() => {});
    }

    return created;
  } catch (err) {
    // Defensive — never let notification emission block the caller.
    console.error('[notification:emit] fatal', event, err?.code, err?.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────
// Dispatch read
// ─────────────────────────────────────────────────────────────────

export async function listDispatches({ allowedCompanyIds, companyId = null, event = null, state = null, limit = 50, offset = 0 }) {
  const allowed = ensureArray(allowedCompanyIds);
  if (allowed.length === 0) return { value: [], total: 0 };
  const where = { companyId: companyId ? companyId : { in: allowed } };
  if (companyId && !allowed.includes(companyId)) return { value: [], total: 0 };
  if (event) where.event = event;
  if (state) where.state = state;
  const [rows, total] = await Promise.all([
    prisma.notificationDispatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, Number(limit) || 50)),
      skip: Math.max(0, Number(offset) || 0),
    }),
    prisma.notificationDispatch.count({ where }),
  ]);
  return { value: rows, total };
}

export async function listDispatchesForCase({ caseId, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const caseRow = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, companyId: true },
  });
  if (!caseRow) return null;
  if (!allowed.includes(caseRow.companyId)) return null;
  return prisma.notificationDispatch.findMany({
    where: { caseId },
    orderBy: { createdAt: 'desc' },
  });
}

// ─────────────────────────────────────────────────────────────────
// Manual confirmation
// ─────────────────────────────────────────────────────────────────

/**
 * Operator confirms they manually communicated this dispatch (copy/
 * mailto/phone). Stamps mode=Manual, state=Sent, confirmedByUserId/At,
 * deliveryNote (required). Audit fields are immutable on success.
 */
export async function manualConfirmDispatch({ dispatchId, payload, user, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const row = await prisma.notificationDispatch.findUnique({ where: { id: dispatchId } });
  if (!row) {
    throw new NotificationValidationError('Bildirim bulunamadı.', { status: 404, code: 'dispatch_not_found' });
  }
  if (!allowed.includes(row.companyId)) {
    throw new NotificationAccessError();
  }
  // P1 review fix — Suppressed dispatches are immutable. They were already
  // dropped (dedup, rate-limit, opt-out, audience_unresolvable) and must
  // never be transitioned to Sent: that would falsify the audit trail
  // because the customer never received this message. Sent/Failed are
  // already final. Only Pending may transition to Sent via manual confirm.
  if (row.state === 'Sent' || row.state === 'Failed' || row.state === 'Suppressed') {
    throw new NotificationValidationError(`Bu bildirim zaten ${row.state}.`, {
      status: 409,
      code: 'dispatch_already_finalized',
    });
  }
  const deliveryNote = trimRequired(payload?.deliveryNote, 1000, 'deliveryNote', 'delivery_note_required');

  const updated = await prisma.$transaction(async (tx) => {
    const d = await tx.notificationDispatch.update({
      where: { id: dispatchId },
      data: {
        mode: 'Manual',
        state: 'Sent',
        confirmedByUserId: user.id,
        confirmedAt: new Date(),
        deliveryNote,
        dispatchedAt: new Date(),
      },
    });
    await tx.caseActivity.create({
      data: {
        caseId: row.caseId,
        companyId: row.companyId,
        action: 'Bildirim manuel olarak gönderildi',
        actor: user.fullName || user.email || user.id,
        note: `${row.ruleNameSnapshot} → ${row.audienceType} (${row.audienceIdentifier})`,
      },
    });
    // If this was the last pending dispatch on the case, flip
    // communicationState='Manual'. Otherwise leave 'Pending'.
    const stillPending = await tx.notificationDispatch.count({
      where: { caseId: row.caseId, state: 'Pending' },
    });
    if (stillPending === 0) {
      await tx.case.update({
        where: { id: row.caseId },
        data: { communicationState: 'Manual' },
      });
    }
    return d;
  });
  return updated;
}
