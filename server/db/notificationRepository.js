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
// M4 — Mail outbound send executor.
import { sendMail as mailProviderSendMail } from '../lib/mailProvider.js';
// M4.1 follow-up — Case enum → Türkçe label çevirisi (müşteri-yüzlü
// mail render'ında ham "ThirdPartyWaiting" / "Medium" yerine
// "3. Parti Bekleniyor" / "Orta" yazılsın diye). Aynı kontrat caseReport
// tarafında kullanılır; tek doğruluk kaynağı.
import { STATUS_LABELS, PRIORITY_LABELS } from '../lib/caseReport/formatters.js';

/**
 * Minimal HTML escape — M6.1 paralel CaseEmail için plain-text bodyHtml
 * wrap'inde kullanılır. sanitize-html zaten render katmanında ek koruma.
 */
function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * HTML gövdeyi kabaca düz-metne çevirir (2026-07-09). HTML şablonlu
 * bildirimlerde `text` fallback'i için (mail istemcisi HTML render edemezse)
 * ve önizleme üretiminde kullanılır. Tam HTML parse değil — pratik strip.
 */
function stripHtmlToText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|table|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Müşterinin son mesajından kısa önizleme (customer_replied şablonundaki
 * "müşteri ne yazdı" kutusu için). bodyText varsa onu, yoksa HTML-strip'i
 * kullanır; whitespace sadeleştirir + maxLen'de keser. Alıntı geçmişi
 * genelde altta olduğundan ilk maxLen karakter = yeni mesaj (yaklaşık).
 */
function buildMessagePreview(bodyText, bodyHtml, maxLen = 220) {
  let s = (typeof bodyText === 'string' && bodyText.trim())
    ? bodyText
    : stripHtmlToText(bodyHtml);
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > maxLen ? `${s.slice(0, maxLen).trim()}…` : s;
}

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
  // M4.1 — müşteri bildirim event'leri (FAZ B):
  //   case_created     → mail intake'le açılan vakalarda ACK
  //                      (origin='Eposta' guard caseRepository.create'te)
  //   status_changed   → close/reopen DIŞI statü geçişlerinde müşteri bilgilendirme
  //                      (close/reopen kendi event'lerini tetiklemeye devam eder)
  'case_created',
  'status_changed',
  // 2026-07-09 — müşteri, mevcut vakaya e-postayla yanıt verdi (intake
  // existing-case append yolları emit eder; İÇ adres gönderici HARİÇ —
  // OOO/auto-reply döngü guard'ı). Tipik kural: audience=assignee +
  // channel=Email → vakayı üstlenen ajan CSM'i açmadan haberdar olur
  // (n4b paritesi; seed: scripts/seed-customer-replied-notification.mjs).
  'customer_replied',
];

const ALLOWED_CHANNELS = ['InApp', 'Email', 'ManualTask']; // Webhook = Phase 4
// M4 — Active artık serbest (mail outbound dispatch). Yalnız channel=Email
// + audience=customer_primary_contact path'i mailProvider.sendMail çağırır;
// diğer (Active + InApp / Active + ManualTask) kombinasyonları için Phase
// 4'te ek executor'lar gelecek. ALLOWED_MODES'a 'Active' eklendi; mode=Active
// engeli (mode_active_not_allowed) kaldırıldı (bkz. createRule).
const ALLOWED_MODES = ['LogOnly', 'Manual', 'Active'];

const ALLOWED_AUDIENCE_TYPES = [
  'assignee',
  'team_lead',
  'supervisor',
  'admin',
  'customer_primary_contact',
  'static_email',
  // M4.1 FAZ B — requester audience:
  //   case.customerContactEmail (mail göndereni). Mail intake senaryosunda
  //   primary contact'tan DAHA DOĞRU: ACK'ı yanıtlayan kişi yanıtı alır.
  //   Opt-out: AccountCompany.allowCustomerNotifications (semantik tutarlılık).
  'requester',
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
  // M4.1 FAZ B — requester audience için template placeholder'lar.
  // Codex P2 fix: requester audience eklendi ama placeholder'lar yoktu →
  // {{requester.name}} kullanan T1/T2 şablonları whitelist tarafından
  // reddediliyordu, boş string render ediliyordu.
  // M6.3b CaseEmailTemplate engine'iyle aynı pattern (parite).
  'requester.name',
  'requester.email',
  // 2026-07-09 — vaka deep-link'i (customer_replied → assignee maili
  // "vakayı aç" bağlantısı taşısın). APP_PUBLIC_BASE_URL env'i tanımlı
  // değilse boş render edilir — şablonlar buna göre kurgulanmalı.
  'case.url',
  // 2026-07-09 — HTML bildirim şablonu: logo URL'i + müşteri son mesaj önizlemesi.
  'app.logoUrl',
  'case.lastCustomerMessage',
  // 2026-07-09 — MÜŞTERİ-yüzü HTML bildirim şablonlarının markası. app.logoUrl
  // Varuna ürün logosudur (İÇ maillerde kullanılır); company.logoUrl ise
  // müşteriye giden mailin gönderen-kurum (tenant) logosudur. Şu an tek-tenant
  // deploy → univera-logo.png; ileride per-tenant Company.logoUrl alanına bağlanır.
  'company.logoUrl',
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
  // Legacy fix — eski seed/admin akışı `conditions: []` (boş array) yazmış
  // olabilir. Boş array semantiği boş object ile aynıdır ("filtre yok"),
  // o yüzden tolere et + sessizce {} olarak normalize et. Edit→Kaydet
  // sırasında validation fail olup R1/R2/R3 gibi mevcut rule'ları
  // güncellenemez hale getirmesin diye.
  //
  // Boş olmayan array (örn. [{...}]) hala reddedilir — filtre semantiği
  // belirsiz; admin'in hatayı görmesi gerek.
  if (Array.isArray(raw)) {
    if (raw.length === 0) return {};
    throw new NotificationValidationError('conditions JSON nesne olmalı (array kabul edilmez).', { code: 'conditions_invalid' });
  }
  if (typeof raw !== 'object') {
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
 * are replaced with empty string and reported via `missing` array.
 *
 * M4.1 FAZ B — ürün kararı: empty = empty (M6.3b CaseEmailTemplate render
 * engine ile hizalı). Eskiden `[X eksik]` marker basıyordu; bu marker
 * müşteriye giden mail'de çirkin görünüyordu. Artık boş render edilir;
 * eksik liste `missing[]` üzerinden dispatch log'a yazılır (admin
 * Bildirim Kayıtları'nda template editör görür).
 *
 * @param {string} text
 * @param {Object<string,string>} vars
 * @param {Object} [opts]
 * @param {boolean} [opts.htmlEscape=false] — true ise yerleştirilen value
 *   HTML escape edilir. Compose-Signature F2 Codex P2 fix: composedHtml
 *   render'ında Person.name/title plain text güvensiz; HTML context'e
 *   girmeden önce escape şart. Subject/plain text render için default false.
 *   Notification dispatch'lerde mevcut çağrılar değişmedi (geri uyumlu).
 *
 * Returns { rendered, missing: string[] }.
 */
export function renderTemplate(text, vars, opts = {}) {
  if (text == null) return { rendered: '', missing: [] };
  const htmlEscape = !!opts.htmlEscape;
  const missing = [];
  const rendered = String(text).replace(VAR_RE, (_, key) => {
    const value = vars[key];
    if (value == null || value === '') {
      if (!missing.includes(key)) missing.push(key);
      return '';
    }
    const raw = String(value);
    return htmlEscape ? escapeHtml(raw) : raw;
  });
  return { rendered, missing };
}

/**
 * Build the flat variable map for a (case, approval) tuple. Approval is
 * optional — null for events that don't carry one (e.g. case_closed
 * without a policy).
 */
export function buildTemplateVars({ caseRow, approval, event, lastCustomerMessage = '' }) {
  // M4.1 follow-up — Türkçe enum etiketleri.
  // Case.status / Case.priority DB'de ASCII identifier saklanır
  // (Acik, ThirdPartyWaiting, Medium, High vb.). Müşteri-yüzlü mailde
  // ham enum'u göstermek çirkin — formatters.js'in tek doğruluk
  // tablosundan Türkçe label'a çeviriyoruz. Bilinmeyen değer fallback
  // ham string (placeholder render empty marker'a düşmesin diye).
  const rawStatus = caseRow?.status ?? '';
  const rawPriority = caseRow?.priority ?? '';
  return {
    'case.number': caseRow?.caseNumber ?? '',
    'case.title': caseRow?.title ?? '',
    'case.description': (caseRow?.description ?? '').slice(0, 500),
    'case.priority': PRIORITY_LABELS[rawPriority] ?? rawPriority,
    'case.status': STATUS_LABELS[rawStatus] ?? rawStatus,
    'case.category': caseRow?.category ?? '',
    'case.subCategory': caseRow?.subCategory ?? '',
    'account.name': caseRow?.accountName ?? '',
    'company.name': caseRow?.companyName ?? '',
    'assignee.name': caseRow?.assignedPersonName ?? '',
    'team.name': caseRow?.assignedTeamName ?? '',
    'resolution.summary': approval?.resolutionSummary ?? '',
    // M4.1 follow-up — resolution.customerMessage fallback.
    //
    // Codex P2 round 3 fix — fallback YALNIZ:
    //   - approval cycle'da DEĞİL (approval=null), VE
    //   - event === 'case_closed' (basit-kapanış path'i), VE/VEYA
    //   - event undefined (admin preview/debug — sample case'in
    //     resolutionNote'unu göstermek beklenir)
    //
    // Gerekçe: caseRepository.transitionStatus reopen'da resolutionNote'u
    // KORUR (silmez; agent eski çözümü referans alsın diye kasıtlı).
    // Eski fallback (`approval ? draft : resolutionNote`) approval-less
    // tüm event'lerde aktifti → case_reopened / case_created /
    // status_changed gibi event'lerde de ESKİ kapanış mesajı
    // {{resolution.customerMessage}} placeholder'ından sızıyordu.
    //
    // Event gate (closeFallback değişkeniyle):
    //   case_closed                              → fallback AKTİF (FAZ A bug fix)
    //   case_reopened / case_created /
    //     status_changed (yeni approval-less)    → fallback PASİF (sızıntı koruma)
    //   resolution_*                             → approval objesi var; fallback'e gitmez
    //   undefined (admin preview)                → fallback AKTİF (admin debug)
    'resolution.customerMessage': approval
      ? (approval.customerMessageDraft ?? '')
      : ((!event || event === 'case_closed') ? (caseRow?.resolutionNote ?? '') : ''),
    'approval.rejectionReason': approval?.rejectionReason ?? '',
    'approval.approverName': approval?.approverName ?? '',
    // M4.1 FAZ B — requester audience template değişkenleri
    // (Case.customerContact*; M6.3b CaseEmailTemplate ile aynı kaynaklar).
    'requester.name': caseRow?.customerContactName ?? '',
    'requester.email': caseRow?.customerContactEmail ?? '',
    // 2026-07-09 — vaka deep-link'i. App.tsx `?case=<id>` parametresini
    // login sonrası açar (SPA'da path-router yok). APP_PUBLIC_BASE_URL
    // tanımsızsa boş string (renderTemplate missing'e yazar, satır boş
    // kalır) — şablonda tek başına satırda kullanın.
    'case.url': (process.env.APP_PUBLIC_BASE_URL && caseRow?.id)
      ? `${process.env.APP_PUBLIC_BASE_URL.replace(/\/+$/, '')}/?case=${caseRow.id}`
      : '',
    // 2026-07-09 — HTML şablon logosu (varuna-logo.png). Base URL yoksa boş
    // → şablonda <img> alt'ı görünür (zarif düşüş).
    'app.logoUrl': process.env.APP_PUBLIC_BASE_URL
      ? `${process.env.APP_PUBLIC_BASE_URL.replace(/\/+$/, '')}/varuna-logo.png`
      : '',
    // 2026-07-09 — MÜŞTERİ-yüzü mail markası (tenant logosu). app.logoUrl iç/
    // ürün maili (Varuna) içindir; müşteriye giden ACK/durum/çözüm maillerinde
    // gönderen-kurum logosu kullanılır. Tek-tenant deploy → univera-logo.png.
    // Base URL yoksa boş (şablonda <img alt> zarif düşüşü).
    'company.logoUrl': process.env.APP_PUBLIC_BASE_URL
      ? `${process.env.APP_PUBLIC_BASE_URL.replace(/\/+$/, '')}/univera-logo.png`
      : '',
    // 2026-07-09 — müşterinin son mesaj önizlemesi (caller emit hesaplar;
    // customer_replied şablonundaki "ne yazdı" kutusu). HTML formatında
    // renderTemplate bunu escape eder → müşteri metni HTML enjekte edemez.
    'case.lastCustomerMessage': lastCustomerMessage ?? '',
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
  // M4 — mode=Active artık serbest. Yalnız channel=Email +
  // audience=customer_primary_contact path'i gerçekten gönderim yapar
  // (mailProvider.sendMail). Active + InApp / ManualTask hâlâ Phase 4
  // executor bekler — emitEvent içinde state=Pending kalır.
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
// Customer response channel resolution (WR-D4/D3 Phase 3)
// ─────────────────────────────────────────────────────────────────

const CUSTOMER_CHANNEL_VALUES = ['email', 'phone', 'manual', 'portal'];

function normalizeCustomerChannel(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (!CUSTOMER_CHANNEL_VALUES.includes(s)) return null;
  return s;
}

/**
 * Resolve the customer communication target for a case.
 *
 * Fallback chain (planning card §10.3):
 *   1. Case.communicationChannelOverride        → operator-set per-case
 *   2. AccountCompany.preferredResponseChannel  → tenant default
 *   3. AccountContact.preferredChannel          → contact's own pref
 *   4. Account.email/phone (infer channel)      → legacy denorm
 *   5. None → 'manual'
 *
 * Identifier (for the resolved channel) follows a parallel chain:
 *   email: AccountCompany.responseEmail → AccountContact.email → Account.email
 *   phone: AccountCompany.responsePhone → AccountContact.phone → Account.phone
 *   manual / portal: no identifier — operator handles externally
 *
 * Opt-out: AccountCompany.allowCustomerNotifications === false collapses
 * everything to suppressionReason='customer_opted_out'.
 *
 * @returns {Promise<{
 *   channel: 'email'|'phone'|'manual'|'portal'|null,
 *   identifier: string|null,
 *   contactName: string|null,
 *   source: 'case_override'|'account_company'|'account_contact'|'account_fallback'|'none',
 *   suppressionReason: null|'customer_opted_out'|'no_channel_available',
 * }>}
 */
export async function resolveCustomerCommunication({ caseRow, preferChannel = null }) {
  if (!caseRow || !caseRow.accountId) {
    return {
      channel: 'manual',
      identifier: null,
      contactName: null,
      source: 'none',
      suppressionReason: 'no_channel_available',
    };
  }

  // 2026-07-01 — Bildirim Kuralı kanal önceliği (sistem düzeltmesi).
  //
  // Bulgu (üretim): R3 case_closed kuralı channel=Email olarak yapılandırılmış
  // ama müşterinin AccountCompany.preferredResponseChannel='phone' set edildiği
  // için resolver telefon numarası döndürüyordu; executor
  // `isLikelyEmail("+90...")` false → Pending kalıyordu. Sonuç: yönetici
  // "e-posta bildirimi gönder" der ama sistem müşteri tercihini öncelikli
  // tutar, kural kanalı görmezden gelir.
  //
  // Kullanıcı kararı: kural kanalını öncelikli tut. Yani kural EMAIL diyorsa
  // müşteri tercihi 'phone' olsa bile önce EMAIL adresini ara; adres yoksa
  // Pending kalsın (operatörün elden gönderme akışı kaybolmasın —
  // no_channel_available).
  //
  // `preferChannel` parametresi opsiyonel — verilmezse (eski çağrılar) mevcut
  // müşteri-tercihi öncelikli akış korunur. resolveAudienceRow rule.channel'ı
  // normalize edip geçirir.
  const preferredByRule = normalizeCustomerChannel(preferChannel);

  const [accountCompany, primaryContact, account] = await Promise.all([
    prisma.accountCompany.findUnique({
      where: { accountId_companyId: { accountId: caseRow.accountId, companyId: caseRow.companyId } },
      select: {
        preferredResponseChannel: true,
        responseEmail: true,
        responsePhone: true,
        allowCustomerNotifications: true,
      },
    }),
    prisma.accountContact.findFirst({
      where: { accountId: caseRow.accountId, isPrimary: true, isActive: true },
      select: { fullName: true, email: true, phone: true, preferredChannel: true },
    }),
    prisma.account.findUnique({
      where: { id: caseRow.accountId },
      select: { email: true, phone: true },
    }),
  ]);

  if (accountCompany && accountCompany.allowCustomerNotifications === false) {
    return {
      channel: null,
      identifier: null,
      contactName: primaryContact?.fullName ?? null,
      source: 'account_company',
      suppressionReason: 'customer_opted_out',
    };
  }

  // Step 1: pick the channel via the fallback chain.
  //
  // 2026-07-01 fix — Kural kanalı EN YÜKSEK öncelik (`preferredByRule`).
  // Case override + AccountCompany.pref + Contact.pref + Account.fallback
  // hepsi bu bloğun ALTINDA kalır. `preferChannel` verilmemişse eski
  // sıralama korunur (geriye uyumluluk).
  let channel = null;
  let source = 'none';
  if (preferredByRule) {
    channel = preferredByRule;
    source = 'rule_channel';
  }
  const caseOverride = normalizeCustomerChannel(caseRow.communicationChannelOverride);
  if (!channel && caseOverride) {
    channel = caseOverride;
    source = 'case_override';
  }
  if (!channel && accountCompany?.preferredResponseChannel) {
    const v = normalizeCustomerChannel(accountCompany.preferredResponseChannel);
    if (v) {
      channel = v;
      source = 'account_company';
    }
  }
  if (!channel && primaryContact?.preferredChannel) {
    const v = normalizeCustomerChannel(primaryContact.preferredChannel);
    if (v) {
      channel = v;
      source = 'account_contact';
    }
  }
  if (!channel) {
    if (account?.email) {
      channel = 'email';
      source = 'account_fallback';
    } else if (account?.phone) {
      channel = 'phone';
      source = 'account_fallback';
    } else {
      channel = 'manual';
      source = 'none';
    }
  }

  // Step 2: resolve identifier for the chosen channel.
  let identifier = null;
  if (channel === 'email') {
    identifier =
      accountCompany?.responseEmail ||
      primaryContact?.email ||
      account?.email ||
      null;
  } else if (channel === 'phone') {
    identifier =
      accountCompany?.responsePhone ||
      primaryContact?.phone ||
      account?.phone ||
      null;
  }

  // Step 3: if a structured channel was chosen but no identifier exists,
  // fall through to manual_task. The dispatch row stays Pending so the
  // operator handles externally; suppressionReason hints why.
  if ((channel === 'email' || channel === 'phone') && !identifier) {
    return {
      channel: 'manual',
      identifier: null,
      contactName: primaryContact?.fullName ?? null,
      source,
      suppressionReason: 'no_channel_available',
    };
  }

  // Step 4: if the entire chain produced nothing (no override, no AC pref,
  // no contact pref, no account.email/phone), we already landed at
  // channel='manual' with source='none' above. Surface that as a
  // no_channel_available hint so the audit row distinguishes it from a
  // deliberate "manual" preference set by admin/operator.
  if (channel === 'manual' && source === 'none') {
    return {
      channel,
      identifier: null,
      contactName: primaryContact?.fullName ?? null,
      source,
      suppressionReason: 'no_channel_available',
    };
  }

  return {
    channel,
    identifier,
    contactName: primaryContact?.fullName ?? null,
    source,
    suppressionReason: null,
  };
}

// ─────────────────────────────────────────────────────────────────
// Audience resolution
// ─────────────────────────────────────────────────────────────────

async function resolveAudienceRow({ row, caseRow, approval, ruleChannel = null }) {
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
      // WR-D4/D3 Phase 3 — customer response channel resolution.
      // Delegates the full fallback chain + opt-out gate to the helper so
      // suppression decisions (customer_opted_out, no_channel_available)
      // are made in one place and the audit row captures them.
      //
      // 2026-07-01 fix — preferChannel: rule.channel geçir; helper kural
      // kanalını EN YÜKSEK öncelik olarak kullanır (müşteri iletişim
      // tercihi kural kanalını override etmez).
      const resolution = await resolveCustomerCommunication({
        caseRow,
        preferChannel: ruleChannel,
      });
      const display = resolution.contactName ?? '';
      if (resolution.suppressionReason === 'customer_opted_out') {
        return {
          audienceType: 'customer_primary_contact',
          audienceIdentifier: 'opted_out',
          display,
          suppressionReason: 'customer_opted_out',
          resolvedChannel: resolution.channel,
          resolutionSource: resolution.source,
        };
      }
      if (resolution.suppressionReason === 'no_channel_available') {
        // No structured channel — operator must reach the customer manually.
        // Dispatch row stays Pending (operator-actionable), but the reason
        // hint surfaces in the audit so the cause is visible.
        return {
          audienceType: 'customer_primary_contact',
          audienceIdentifier: 'manual',
          display,
          suppressionReason: 'no_channel_available',
          keepPending: true,
          resolvedChannel: 'manual',
          resolutionSource: resolution.source,
        };
      }
      return {
        audienceType: 'customer_primary_contact',
        audienceIdentifier: resolution.identifier ?? 'manual',
        display,
        resolvedChannel: resolution.channel,
        resolutionSource: resolution.source,
      };
    }
    case 'static_email': {
      return {
        audienceType: 'static_email',
        audienceIdentifier: String(row.targetValue ?? '').toLowerCase(),
        display: '',
      };
    }
    case 'requester': {
      // M4.1 FAZ B — Mail intake'le açılan vakalarda mail göndereni.
      // case.customerContactEmail = inbound mail'in From adresi (M2 intake'te
      // doldurulur). Manuel açılan vakalarda BOŞ.
      //
      // Opt-out: AccountCompany.allowCustomerNotifications — semantik
      // tutarlılık (requester de bir müşteri kişisidir).
      const email = (caseRow?.customerContactEmail ?? '').trim();
      const display = caseRow?.customerContactName ?? '';

      // Opt-out kontrol — accountId varsa (mail intake'te eşleştirildiyse).
      if (caseRow?.accountId) {
        const ac = await prisma.accountCompany.findUnique({
          where: { accountId_companyId: { accountId: caseRow.accountId, companyId: caseRow.companyId } },
          select: { allowCustomerNotifications: true },
        });
        if (ac && ac.allowCustomerNotifications === false) {
          return {
            audienceType: 'requester',
            audienceIdentifier: 'opted_out',
            display,
            suppressionReason: 'customer_opted_out',
            resolvedChannel: 'email',
            resolutionSource: 'account_company',
          };
        }
      }

      if (email) {
        return {
          audienceType: 'requester',
          audienceIdentifier: email,
          display,
          resolvedChannel: 'email',
          resolutionSource: 'case_override',
        };
      }

      // 2026-07-01 fix — customerContactEmail boş + kural kanalı EMAIL →
      // AccountContact.email → Account.email fallback dene.
      //
      // Bulgu (üretim): R2 status_changed kuralı requester audience'ında
      // manuel açılan vakalarda "manual" sentinel'i döndürüyordu; dispatcher
      // isLikelyEmail("manual")=false → Pending. Kullanıcı görüşü: müşterinin
      // gerçek email adresi (Account/AccountContact seviyesinde) VAR ama
      // sistem bakmıyordu.
      //
      // Fallback yalnız kural kanalı EMAIL iken uygulanır (ruleChannel !=
      // 'Email' ise bu case zaten email göndermeye çalışmıyor). accountId
      // yoksa fallback yapılamaz (müşteri belirsiz).
      const ruleAsksEmail = String(ruleChannel ?? '').toLowerCase() === 'email';
      if (ruleAsksEmail && caseRow?.accountId) {
        const [primaryContact, account] = await Promise.all([
          prisma.accountContact.findFirst({
            where: { accountId: caseRow.accountId, isPrimary: true, isActive: true },
            select: { email: true, fullName: true },
          }),
          prisma.account.findUnique({
            where: { id: caseRow.accountId },
            select: { email: true },
          }),
        ]);
        const fallbackEmail =
          (primaryContact?.email && primaryContact.email.trim())
          || (account?.email && account.email.trim())
          || null;
        if (fallbackEmail) {
          return {
            audienceType: 'requester',
            audienceIdentifier: fallbackEmail,
            display: display || primaryContact?.fullName || '',
            resolvedChannel: 'email',
            resolutionSource: primaryContact?.email ? 'account_contact' : 'account_fallback',
          };
        }
      }

      // customerContactEmail YOK + fallback bulamadı → dispatch keepPending
      // (operatör manuel gönderim akışı korunur).
      return {
        audienceType: 'requester',
        audienceIdentifier: 'manual',
        display,
        suppressionReason: 'no_channel_available',
        keepPending: true,
        resolvedChannel: 'manual',
        resolutionSource: 'none',
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
/**
 * M4 — Customer-facing email dispatch için subject'e [VK-<caseNumber>]
 * round-trip token'ı ekler. Token zaten varsa dokunmaz.
 *
 * Format M2 inboundMailIntake.js:46 ile birebir uyumlu:
 *   SUBJECT_CASE_TOKEN_RE = /\[(VK-[0-9A-Z]+)\]/i
 *
 * Token sayesinde müşteri yanıt mailini gönderdiğinde, M2 inbound intake
 * subject'ten caseNumber'ı yakalar → mevcut vakaya CaseNote olarak iliştirir.
 * Round-trip kapanmış olur.
 */
export function applyCaseTokenToSubject(subject, caseNumber) {
  const safeSubject = String(subject ?? '').trim() || '(konusuz)';
  const safeNumber = String(caseNumber ?? '').trim();
  if (!safeNumber) return safeSubject;
  const token = `[${safeNumber}]`;
  // Mevcut subject'te zaten token varsa dokunma.
  if (safeSubject.includes(token)) return safeSubject;
  // M2 regex'ine uygun format: subject başında [VK-xxx] prefix.
  return `${token} ${safeSubject}`;
}

/**
 * M4 — Customer-facing dispatch için tutarlı Message-ID üret.
 *
 * Format: "<varuna-{dispatchId}@{tenantDomain}>"
 * tenantDomain örnek: "univera.com.tr" (companyId'den türetilebilir veya
 * SMTP from address'inden domain part). Şu an basit fallback: company.id
 * kısa hash + sabit suffix; gerçek SMTP server bunu accept eder ama
 * domain hizalı olması nice-to-have'dır.
 */
export function buildDispatchMessageId(dispatchId, fallbackDomain = 'varuna.local') {
  return `<varuna-${dispatchId}@${fallbackDomain}>`;
}

/**
 * M4 — Codex P1 fix.
 *
 * audienceIdentifier'ın email adresi olup olmadığını basit ama defansif
 * kontrol et. resolveCustomerCommunication() müşterinin tercih kanalı
 * 'phone' ise phone number, 'no_channel_available' ise 'manual' string'i
 * audienceIdentifier'a yazabilir. Bu durumlarda dispatch.channel hâlâ
 * rule.channel=Email; executor'ı çağırsak SMTP'ye telefon numarası gönderir
 * veya 'manual' string'i ile sendMail çağırır → Failed.
 *
 * Bu durumda operatör müdahale akışı korunmalı (state=Pending kalır,
 * needsAction true, communicationState='Pending').
 *
 * Yaklaşım: minimal RFC-5322 alt kümesi.
 *   - Tek '@' içerir
 *   - '@' öncesi+sonrası whitespace yok
 *   - '@' sonrası en az bir '.' içerir
 *   - Uzunluk pratik sınır
 */
export function isLikelyEmail(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s || s.length > 320) return false;
  // sentinel literals (resolveCustomerCommunication döndürebilir)
  if (s === 'manual' || s === 'phone' || s === 'unresolved') return false;
  // Whitespace, @ sayısı, domain part'ta . var mı
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * M4 — Customer-facing Active email dispatch'i gerçekten gönder.
 *
 * KURALLAR:
 *  - SADECE mode=Active + channel=Email + state=Pending.
 *  - Idempotency / rate-limit / opt-out kontrolleri dispatch.create
 *    öncesi `emitEvent` içinde uygulanır; bu executor onları TEKRAR
 *    KONTROL ETMEZ — sadece "state=Pending olarak insert edilmiş" durumda
 *    çağrılır.
 *  - LogOnly / Manual → BU FONKSIYON ÇAĞRILMAZ (caller mode kontrol eder).
 *  - Customer-facing (audienceType='customer_primary_contact') için
 *    subject'e [VK-<caseNumber>] token + Message-ID üretilir
 *    (round-trip threading).
 *  - Önceki sent dispatch'in providerMessageId'si varsa
 *    In-Reply-To/References header'larına geçer (zincirleme thread).
 *  - Başarı → state=Sent + dispatchedAt + providerMessageId; hata →
 *    state=Failed + failureReason. attempts++ her iki yolda da.
 *  - mailProvider.sendMail companyId-aware (M5 per-tenant config).
 *
 * Throw etmez; başarı/başarısızlık state geçişiyle yansıtılır.
 *
 * @returns {Promise<{ ok: boolean, providerMessageId?: string, error?: object }>}
 */
async function executeOutboundEmailDispatch(dispatch, caseRow) {
  // Codex P2 fix — Customer-facing audience whitelist genişledi.
  // M4.1 FAZ B 'requester' audience type'ı eklendi; mevcut
  // customer_primary_contact path'inden YARARLANMALI:
  //   - [VK-XXX] subject token (round-trip threading için inboundMailIntake
  //     bunu parse eder)
  //   - Message-ID + In-Reply-To header threading
  //   - CaseEmail appendOutbound (İletişim sekmesinde görünür)
  // Aksi halde müşteri ACK'a reply yazınca intake parse edemez ve mail
  // İletişim thread'inde GÖRÜNMEZ.
  const CUSTOMER_FACING_AUDIENCES = new Set([
    'customer_primary_contact',
    'requester',
  ]);
  const isCustomerFacing = CUSTOMER_FACING_AUDIENCES.has(dispatch.audienceType);

  // Subject token (sadece customer-facing'e)
  const finalSubject = isCustomerFacing
    ? applyCaseTokenToSubject(dispatch.snapshotSubject, caseRow.caseNumber)
    : dispatch.snapshotSubject;

  // Message-ID üret (customer-facing için zorunlu — round-trip threading)
  const headers = {};
  if (isCustomerFacing) {
    const newMessageId = buildDispatchMessageId(dispatch.id);
    headers['Message-ID'] = newMessageId;

    // Threading: aynı vakanın önceki sent dispatch'inin providerMessageId'si
    // varsa In-Reply-To + References ekle (en yeni Sent dispatch).
    const prev = await prisma.notificationDispatch.findFirst({
      where: {
        caseId: dispatch.caseId,
        state: 'Sent',
        providerMessageId: { not: null },
        id: { not: dispatch.id },
      },
      orderBy: { dispatchedAt: 'desc' },
      select: { providerMessageId: true },
    });
    if (prev?.providerMessageId) {
      headers['In-Reply-To'] = prev.providerMessageId;
      headers['References'] = prev.providerMessageId;
    }
  }

  // HTML şablon desteği (2026-07-09) — template.format='html' ise gövde
  // HTML gönderilir + text fallback (strip). Format dispatch'te tutulmadığı
  // için templateId üzerinden okunur (tüm çağrı yolları — emit + retry —
  // için sağlam). Yoksa/plain ise mevcut text-only davranış.
  let isHtmlBody = false;
  if (dispatch.templateId) {
    try {
      const tpl = await prisma.notificationTemplate.findUnique({
        where: { id: dispatch.templateId },
        select: { format: true },
      });
      isHtmlBody = tpl?.format === 'html';
    } catch { /* format okunamazsa text-only */ }
  }

  const result = await mailProviderSendMail(
    {
      to: dispatch.audienceIdentifier,
      subject: finalSubject,
      ...(isHtmlBody
        ? { html: dispatch.snapshotBody, text: stripHtmlToText(dispatch.snapshotBody) }
        : { text: dispatch.snapshotBody }),
      headers,
    },
    { companyId: dispatch.companyId },
  );

  if (result.ok) {
    const dispatchedAt = new Date();
    await prisma.notificationDispatch.update({
      where: { id: dispatch.id },
      data: {
        state: 'Sent',
        dispatchedAt,
        providerMessageId: result.messageId ?? null,
        attempts: { increment: 1 },
      },
    });

    // M6.1 — Paralel CaseEmail satırı (source='notification_dispatch').
    // Dispatch'in mail thread'de görünmesi için. messageId aynı ise
    // appendOutbound dedup yapar (companyId+messageId unique).
    // Hata kapsanır: dispatch zaten 'Sent' işaretlendi, mail teslim oldu;
    // CaseEmail kaydı fail olsa bile dispatch'i bozmayız.
    //
    // Codex #496 P1 — YALNIZ CUSTOMER-FACING. İÇ bildirimler (ör.
    // customer_replied → assignee) müşteriye giden mail DEĞİLDİR; bunları
    // outbound CaseEmail yazmak (a) lastEmailOutboundAt'i ilerletip
    // pendingCustomerReply'ı YANLIŞ temizler (ajan cevap vermeden "yanıt
    // bekliyor" düşer — [[reference-pending-customer-reply-semantics]]),
    // (b) müşteri thread'ini iç bildirimle kirletir. isCustomerFacing
    // executor'ın başında audience'a göre belirlendi.
    if (isCustomerFacing) try {
      const { caseEmailRepository } = await import('./caseEmailRepository.js');
      // From: tenant ExternalMailSetting.fromAddress (M5). mailProvider'ın
      // gönderdiği gerçek from'u burada bilmediğimiz için settings'ten
      // alırız (best-effort).
      let fromAddress = null;
      try {
        const mailSetting = await prisma.externalMailSetting.findUnique({
          where: { companyId: dispatch.companyId },
          select: { fromAddress: true },
        });
        fromAddress = mailSetting?.fromAddress ?? null;
      } catch { /* sessiz */ }

      await caseEmailRepository.appendOutbound({
        caseId: dispatch.caseId,
        companyId: dispatch.companyId,
        from: { address: fromAddress ?? 'unknown@local', name: null },
        to: [{ address: dispatch.audienceIdentifier, name: null }],
        subject: finalSubject,
        // HTML şablon → gövde doğrudan; plain → <pre> wrap (2026-07-09).
        bodyHtml: isHtmlBody
          ? (dispatch.snapshotBody ?? '')
          : `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(dispatch.snapshotBody ?? '')}</pre>`,
        bodyText: isHtmlBody ? stripHtmlToText(dispatch.snapshotBody) : (dispatch.snapshotBody ?? ''),
        messageId: result.messageId ?? null,
        inReplyTo: headers?.['In-Reply-To'] ?? null,
        refs: headers?.References ?? null,
        sentAt: dispatchedAt,
        source: 'notification_dispatch',
        dispatchId: dispatch.id,
      });
    } catch (err) {
      console.warn('[notif:executeOutboundEmailDispatch] caseEmail append failed',
        err?.message ?? err);
    }

    return { ok: true, providerMessageId: result.messageId ?? null };
  }
  await prisma.notificationDispatch.update({
    where: { id: dispatch.id },
    data: {
      state: 'Failed',
      failureReason: result.error?.message ?? 'send_failed',
      attempts: { increment: 1 },
    },
  });
  return { ok: false, error: result.error };
}

export async function emitEvent({ event, caseId, approvalContext = null, triggerInboundEmailId = null }) {
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

    // Müşterinin son mesaj önizlemesi (customer_replied HTML şablonu için).
    // Codex #498 P2 — TETİKLEYEN maili doğrudan kullan: caller (intake)
    // az önce append ettiği inbound'un id'sini geçer → kesin doğru mesaj.
    // Fallback (id yoksa) INSERTION sırası (createdAt) — receivedAt mailin
    // Date header'ından gelir, gecikmeli/çarpık tarihte önceki mesajı
    // seçebilirdi. Bir kez çekilir, tüm kurallarda reuse. Opsiyonel.
    let lastCustomerMessage = '';
    try {
      const triggerInbound = triggerInboundEmailId
        ? await prisma.caseEmail.findUnique({
            where: { id: triggerInboundEmailId },
            select: { bodyText: true, bodyHtml: true, direction: true, caseId: true },
          })
        : await prisma.caseEmail.findFirst({
            where: { caseId, direction: 'inbound' },
            orderBy: { createdAt: 'desc' },
            select: { bodyText: true, bodyHtml: true, direction: true, caseId: true },
          });
      // id ile geldi ama başka vaka/yön ise kullanma (defensive).
      if (triggerInbound
          && triggerInbound.direction === 'inbound'
          && triggerInbound.caseId === caseId) {
        lastCustomerMessage = buildMessagePreview(triggerInbound.bodyText, triggerInbound.bodyHtml);
      }
    } catch { /* önizleme opsiyonel */ }

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
      //
      // 2026-07-01 — rule.channel'ı resolver'a geçir (sistem düzeltmesi).
      // customer_primary_contact ve requester akışlarında kural kanalı
      // müşteri iletişim tercihinden ÖNCELIKLI. Aksi halde 'Email' kural
      // müşteri 'phone' tercihi çakışıyor → Pending kayıp.
      for (const audienceRow of rule.audience) {
        const resolved = await resolveAudienceRow({
          row: audienceRow,
          caseRow,
          approval: approvalContext,
          ruleChannel: rule.channel,
        });

        // Render snapshot — Codex P2 round 3: event'i geçiriyoruz ki
        // buildTemplateVars resolution.customerMessage fallback'ini
        // case_closed dışı approval-less event'lerde devre dışı bıraksın
        // (eski resolutionNote case_reopened/created/status_changed
        // template'lerine sızmasın).
        const vars = buildTemplateVars({ caseRow, approval: approvalContext, event, lastCustomerMessage });
        // HTML formatında gövde değişkenleri escape edilir (müşteri metni /
        // isim / e-posta HTML enjekte edemez); konu her zaman düz.
        const isHtmlTemplate = rule.template.format === 'html';
        const { rendered: snapshotSubject } = renderTemplate(rule.template.subjectTemplate, vars);
        const { rendered: snapshotBody } = renderTemplate(rule.template.bodyTemplate, vars, { htmlEscape: isHtmlTemplate });

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

        // WR-D4/D3 Phase 3 — customer channel resolution may attach a
        // suppressionReason ('customer_opted_out' opt-out, or
        // 'no_channel_available' for the manual_task fallback). The
        // resolver's `keepPending` flag lets a no-channel case stay
        // Pending so the operator picks it up; only opt-out goes
        // Suppressed.
        if (!suppressionReason && resolved.suppressionReason) {
          suppressionReason = resolved.suppressionReason;
          if (!resolved.keepPending) state = 'Suppressed';
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

          // M4 — Active + Email + Pending dispatch'lerini gerçekten gönder.
          // Idempotency / rate-limit / opt-out kontrolleri yukarıda
          // uygulanmış (state=Suppressed olanlar bu blok'a girmez —
          // dispatch.state==='Pending' guard'ı).
          //
          // Codex P1 fix — audienceIdentifier'ın email olduğunu da doğrula.
          // resolveCustomerCommunication() müşteri tercihi 'phone' ise
          // phone number, 'no_channel_available' ise 'manual' yazabilir;
          // bu durumda executor SMTP'ye geçersiz to ile gider → Failed,
          // operatörün manuel müdahale akışı kaybolur. Email değilse
          // state=Pending kalır → needsAction true → operatör kuyruğa düşer.
          if (
            dispatch.mode === 'Active'
            && dispatch.channel === 'Email'
            && dispatch.state === 'Pending'
            && isLikelyEmail(dispatch.audienceIdentifier)
          ) {
            try {
              const execResult = await executeOutboundEmailDispatch(dispatch, caseRow);
              // Codex P2 fix — created array'deki dispatch object'i Phase 2
              // emit'den dönen ham (Pending) hâli; executor DB row'unu Sent/
              // Failed'a güncelledi ama created stale. needsAction
              // calculation aşağıda created.some(d.state==='Pending'...)
              // ile çalışır → eski Pending görür → Case.communicationState
              // YANLIŞ 'Pending' set eder. In-place mutate ile created'i
              // güncel state ile yansıtıyoruz.
              if (execResult?.ok) {
                dispatch.state = 'Sent';
                dispatch.dispatchedAt = new Date();
                dispatch.providerMessageId = execResult.providerMessageId ?? null;
              } else {
                dispatch.state = 'Failed';
                dispatch.failureReason = execResult?.error?.message ?? 'send_failed';
              }
              dispatch.attempts = (dispatch.attempts ?? 0) + 1;
            } catch (execErr) {
              // Executor wrapped olarak {ok:false} döndürür; throw etmez
              // ama defansif: caller'a yansıma yok.
              console.error('[notification:emit] outbound executor unexpected', execErr?.message);
            }
          }
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
