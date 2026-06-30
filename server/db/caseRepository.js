import { prisma } from './client.js';
import { fromDb, toDb, toDbFilters } from './enumMap.js';
import { createUploadUrl, createDownloadUrl, removeObject, verifyStorageToken } from './storage.js';
import { isAcceptedUpload } from '../lib/uploadWhitelist.js';
import { checkCloseAllowed as checkApprovalCloseAllowed } from './approvalRepository.js';
import { emitEvent as emitNotificationEvent } from './notificationRepository.js';
import {
  emitMentionsForNote,
  emitGenericNotification,
} from './actionItemRepository.js';
import { ActorRequiredError } from '../lib/actor.js';
import { devopsClient, parseWorkItemId } from '../lib/devopsClient.js';
import crypto from 'node:crypto';
import { resolveSlaPolicy } from '../lib/sla/slaPolicyResolver.js';

/**
 * PR-1 (Codex P1) + PR-2 — defansif throw helper.
 *
 * Hem string hem ActorContext object kabul eder (hybrid). Mock User
 * sentinel'leri (literal 'Mock User'/'mock-user') REDDEDİLİR — caller
 * silent fallback yazmak isterse derhal görünür hata alır.
 *
 * - String actor    → backwards-compat (eski signature'lar; route layer
 *                     req.user.fullName geçer). Boş veya sentinel reddedilir.
 * - Object actor    → PR-1 ActorContext (displayName + userId). PR-1'in
 *                     4 method'u bunu kullanır.
 * - undefined/null  → ActorRequiredError (Mock User fallback YOK).
 *
 * Cron/system paths: 'system' veya 'user:${id}' string'leri normal kabul.
 */
const MOCK_USER_SENTINELS = new Set(['Mock User', 'mock-user', 'mock_user', '']);

/**
 * PR-5 — Optional FK actorUserId stamp helper.
 *
 * Actor object ise userId döner; string actor (cron/legacy) ise null.
 * Forward writes display string'i KORURKEN FK alanını da doldurur.
 * UI display chain: actorUserId varsa canlı User.fullName, yoksa actor string.
 */
function actorUserIdOf(actor) {
  if (actor && typeof actor === 'object' && typeof actor.userId === 'string' && actor.userId.length > 0) {
    return actor.userId;
  }
  return null;
}

function assertActor(actor, where) {
  if (typeof actor === 'string') {
    if (MOCK_USER_SENTINELS.has(actor)) {
      throw new ActorRequiredError(
        `${where}: actor required (got sentinel: "${actor}"; route must pass req.user)`,
      );
    }
    return;
  }
  if (
    !actor ||
    typeof actor !== 'object' ||
    typeof actor.displayName !== 'string' ||
    actor.displayName.length === 0 ||
    MOCK_USER_SENTINELS.has(actor.displayName)
  ) {
    throw new ActorRequiredError(
      `${where}: actor context required (see server/lib/actor.js requireActor)`,
    );
  }
}

// Snooze sebebi → CaseActivity log'unda görünen TR etiket.
const SNOOZE_REASON_LABEL = {
  CustomerWillCall: 'Müşteri tekrar arayacak',
  WaitingThirdParty: '3. taraf bekleniyor',
  Reminder: 'Hatırlatıcı',
};

// FAZ 2 §20.2 — aktarım gerekçe kodu → activity log etiketi (TR).
const TRANSFER_REASON_LABEL = {
  wrong_team: 'Yanlış Takım',
  expertise: 'Uzmanlık',
  workload: 'İş Yükü',
  escalation: 'Eskalasyon',
  customer_request: 'Müşteri Talebi',
  other: 'Diğer',
};

const TR_DATETIME = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * Case repository — vaka CRUD + ilişkili tablolar (notes, files, history, callLogs).
 *
 * Frontend caseService.ts USE_MOCK=false dalında bu repository'e karşılık gelen
 * BFF endpoint'lerini çağıracak. Bu katmanın iki amacı var:
 *  1. Prisma çağrılarını route handler'lardan soyutla → MSSQL'e geçiş tek
 *     katmanı etkiler.
 *  2. Frontend'in beklediği denormalized Case shape'i (companyName, accountName,
 *     notes/files/history/callLogs ilişkili dizileri) ile DB'nin normalized
 *     yapısını birleştir.
 */

// Frontend Case shape'i tek bir SELECT'te hazırla — ilişkili tabloları include et
// History desc: yeni en üstte (uzun yaşayan vakada scroll etmeden son durumu gör)
// Notlar: top-level (parentNoteId IS NULL) çekilir; replies inline değil,
// kullanıcı thread'i açtığında ayrı endpoint ile lazy load edilir.
// Reactions: her note ile birlikte raw satırlar gelir (userId + emoji);
// frontend aggregate eder ve "mine" flag'ini hesaplar.
const NOTE_REACTION_SELECT = { id: true, userId: true, emoji: true };

const CASE_INCLUDE = {
  notes: {
    where: { parentNoteId: null },
    orderBy: { createdAt: 'desc' },
    include: { reactions: { select: NOTE_REACTION_SELECT } },
  },
  attachments:  { orderBy: { uploadedAt: 'desc' } },
  history:      { orderBy: { at: 'desc' } },
  callLogs:     { orderBy: { callDate: 'desc' } },
  // Liste/Detay her ikisi icin de "kac baglanti var" sinyali. outgoingLinks
  // sayisi: Related/Parent A->B yonu + Duplicate symmetric'in A->B satiri.
  // Detay sayfasi tam listeyi LinksTab'de gosterir; bu yalniz chip icin.
  _count: { select: { outgoingLinks: true } },
  // PR-SD — Arşiv banner için kim arşivledi adı (audit JOIN; PII guard
  // sadece display name).
  archivedByUser: { select: { id: true, fullName: true } },
};

// İzin verilen reaksiyon emojileri — UI + BFF whitelist.
// Anahtarlar UI'da ikon olarak gösterilir; identifier ile saklanır ki ileride
// gerekirse aynı anahtar için farklı sembol render edilebilir.
export const NOTE_REACTION_EMOJIS = ['thumbs_up', 'eyes', 'check', 'important', 'thanks'];

// DB'den gelen Case'i frontend Case tipine çevir:
//  - attachments → files
//  - enum identifier'larını TR string'e geri map'le
//  - callLog'lardaki enum'ları da TR'ye çevir
function shape(c) {
  if (!c) return null;
  const { attachments, callLogs, _count, archivedByUser, ...rest } = c;
  const baseShape = fromDb(rest);
  return {
    ...baseShape,
    files: attachments ?? [],
    callLogs: (callLogs ?? []).map((cl) => fromDb(cl)),
    // _count.outgoingLinks → linkCount (frontend için tek flat number).
    linkCount: _count?.outgoingLinks ?? 0,
    // PR-SD — Arşiv banner için flat display name (UI JOIN gerekmez).
    archivedByUserName: archivedByUser?.fullName ?? null,
  };
}

/**
 * Per-process in-flight registry for note/reply creates — guards against
 * truly-concurrent identical create requests (browser HTTP/2 multiplexed
 * double-click). Single-instance scope; sufficient for current BFF
 * deployment. Sequential duplicates (within 5s after completion) are
 * caught by the DB short-window guard inside addNote/addReply.
 *
 * Key format: `note|<caseId>|<userId>|<visibility>|<content>` (top-level)
 *             `reply|<caseId>|<parentNoteId>|<userId>|<visibility>|<content>`
 * Entry lifetime: in-flight + 5s post-settlement window.
 */
const noteCreateInFlight = new Map();

function coalesceNoteCreate(key, factory) {
  const existing = noteCreateInFlight.get(key);
  if (existing) return existing;
  const p = factory();
  noteCreateInFlight.set(key, p);
  // Hold for 5s after settlement so a back-to-back retry sees the
  // cached promise and returns the same row (defense in depth alongside
  // the DB short-window guard).
  p.catch(() => {}).finally(() => {
    setTimeout(() => {
      if (noteCreateInFlight.get(key) === p) noteCreateInFlight.delete(key);
    }, 5000);
  });
  return p;
}

/**
 * Core write path for addNote — extracted so the public addNote can
 * wrap it with in-flight coalescing + short-window DB guard. Performs:
 *  1. @mention parse + cross-tenant validation
 *  2. caseNote.create
 *  3. CaseMention rows + fire-and-forget mention ActionItem emit
 *  4. CaseActivity NoteAdded
 *  5. Watcher notification
 *  6. case.updatedAt bump
 */
async function _addNoteWriteAndEmit({ id, note, companyId, mentionedBy, actor }) {
  // Actor identity hardening (2026-06-18): actor varsa authorName + authorId
  // server-side belirlenir; body.authorName / body.authorId sessizce yok
  // sayılır. Smoke caller'ları actor pass etmediği için legacy path
  // (note.authorName, mentionedBy) korunur — test ortamı dummy isim
  // yazabiliyor. Production route handler her zaman actor pass eder.
  const effectiveAuthorName = actor?.displayName ?? note.authorName;
  const effectiveAuthorUserId = actor?.userId ?? mentionedBy ?? null;
  const effectiveMentionedBy = actor?.userId ?? mentionedBy;

  const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
  const matches = [...(note.content ?? '').matchAll(mentionRegex)];
  const mentionedUserIds = [...new Set(matches.map((m) => m[2]))];

  if (mentionedUserIds.length > 10) {
    return { error: 'Bir notta en fazla 10 kişi etiketlenebilir.' };
  }

  if (mentionedUserIds.length > 0) {
    const valid = await prisma.user.findMany({
      where: {
        id: { in: mentionedUserIds },
        isActive: true,
        companies: { some: { companyId, isActive: true } },
      },
      select: { id: true },
    });
    const validIds = new Set(valid.map((v) => v.id));
    const invalid = mentionedUserIds.filter((uid) => !validIds.has(uid));
    if (invalid.length > 0) {
      return {
        error: `Etiketlenen ${invalid.length} kullanıcı bu şirkette bulunamadı veya pasif.`,
      };
    }
  }

  const created = await prisma.caseNote.create({
    data: {
      caseId: id,
      companyId,
      authorName: effectiveAuthorName,
      authorId: effectiveAuthorUserId,
      content: note.content,
      visibility: note.visibility,
    },
  });

  if (mentionedUserIds.length > 0 && effectiveMentionedBy) {
    await prisma.caseMention.createMany({
      data: mentionedUserIds.map((uid) => ({
        caseId: id,
        noteId: created.id,
        companyId,
        mentionedUserId: uid,
        mentionedBy: effectiveMentionedBy,
      })),
    });

    const caseSnapshot = await prisma.case.findUnique({
      where: { id },
      select: { caseNumber: true, title: true },
    });
    void emitMentionsForNote({
      caseId: id,
      companyId,
      noteId: created.id,
      mentionedUserIds,
      actorUserId: effectiveMentionedBy,
      actorDisplay: effectiveAuthorName,
      caseNumber: caseSnapshot?.caseNumber,
      caseTitle: caseSnapshot?.title,
      noteContent: note.content,
    });
  }

  const cleanedPreview = (note.content ?? '')
    .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
    .slice(0, 200);
  await prisma.caseActivity.create({
    data: {
      caseId: id,
      companyId,
      action: note.visibility === 'Customer' ? 'Müşteri notu eklendi' : 'İç not eklendi',
      actionType: 'NoteAdded',
      note: cleanedPreview,
      actor: effectiveAuthorName,
      actorUserId: effectiveAuthorUserId,
    },
  });

  const noteCase = await prisma.case.findUnique({
    where: { id },
    select: { caseNumber: true },
  });
  await notifyWatchers({
    caseId: id,
    companyId,
    message: `${noteCase?.caseNumber ?? id}'de yeni not: ${cleanedPreview.slice(0, 80)}`,
    kind: 'note',
  });

  await prisma.case.update({ where: { id }, data: { updatedAt: new Date() } });
  return created;
}

/**
 * CaseAccessError — repository-seviyesi 403 sinyal.
 * Mutation'lar başında scope check başarısız olursa fırlatılır; route layer
 * bunu HTTP 403'e çevirir.
 */
export class CaseAccessError extends Error {
  constructor(message = 'Vaka erişimi yok.') {
    super(message);
    this.code = 'CASE_FORBIDDEN';
  }
}

/**
 * CaseValidationError — 400 validation. Phase D: requireCustomerOnCaseCreate
 * ihlali bunu fırlatır; route layer bunu HTTP 400'e çevirir.
 */
export class CaseValidationError extends Error {
  constructor(message, { status = 400, code = 'validation_error' } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Phase D Step 2 — Müşterisiz vaka başvuran bilgilerini sanitize et.
 *  - Trim
 *  - Max length cap
 *  - Email format kontrolü (basit regex)
 *  - Boş string null'a çevrilir
 *  - Tüm alanlar opsiyonel; hiçbiri verilmese hata yok
 */
const EMAIL_VALIDATION_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function trimOrNull(value, max) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new CaseValidationError(`Alan ${max} karakteri geçemez.`, {
      status: 400,
      code: 'requester_field_too_long',
    });
  }
  return trimmed;
}
/**
 * WR-A4 — AccountProject lookup + integrity validator. Used by both create
 * and update paths.
 *
 *  - projectId must exist + isActive=true → else 400 'invalid_project'
 *  - accountId is REQUIRED when projectId is supplied (Account→AccountCompany
 *    →AccountProject→Case hierarchy invariant) → else 400
 *    'project_requires_account'
 *  - project's AccountCompany.companyId must equal companyId → else 400
 *    'project_company_mismatch'
 *  - project's AccountCompany.accountId must equal accountId → else 400
 *    'project_account_mismatch'
 *
 * Returns { id, name } for denormalize.
 */
async function loadAndValidateProject({ projectId, accountId, companyId }) {
  if (!accountId) {
    // Project without account would orphan Case.accountProjectId from the
    // Account → AccountCompany → AccountProject hierarchy.
    throw new CaseValidationError(
      'Müşteri seçilmeden proje seçilemez.',
      { status: 400, code: 'project_requires_account' },
    );
  }
  const project = await prisma.accountProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      isActive: true,
      accountCompany: { select: { accountId: true, companyId: true } },
    },
  });
  if (!project || !project.isActive) {
    throw new CaseValidationError('Geçersiz veya pasif proje.', {
      status: 400,
      code: 'invalid_project',
    });
  }
  if (project.accountCompany.companyId !== companyId) {
    throw new CaseValidationError(
      'Bu proje vaka şirketine ait değil.',
      { status: 400, code: 'project_company_mismatch' },
    );
  }
  if (project.accountCompany.accountId !== accountId) {
    throw new CaseValidationError(
      'Bu proje seçili müşteriye ait değil.',
      { status: 400, code: 'project_account_mismatch' },
    );
  }
  return { id: project.id, name: project.name };
}

/**
 * WR-A7b / DI.2 — Case.productId validation.
 *
 *  - Product mevcut + isActive=true → else 400 'invalid_product'
 *  - Product.companyId === Case.companyId → else 400 'product_company_mismatch'
 *
 * Returns { id, name, supportLevel } for denormalize + supportLevel cascade.
 */
async function loadAndValidateCaseProduct({ productId, companyId }) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, companyId: true, isActive: true, supportLevel: true },
  });
  if (!product || !product.isActive) {
    throw new CaseValidationError('Geçersiz veya pasif ürün.', {
      status: 400,
      code: 'invalid_product',
    });
  }
  if (product.companyId !== companyId) {
    throw new CaseValidationError(
      'Bu ürün vaka şirketine ait değil.',
      { status: 400, code: 'product_company_mismatch' },
    );
  }
  return { id: product.id, name: product.name, supportLevel: product.supportLevel };
}

/**
 * WR-A7b — Case.packageId validation (DI.3 / DI.4 / DI.5).
 *
 *  - DI.3: Package.companyId === Case.companyId → else 400 'invalid_package' or
 *    'package_company_mismatch'
 *  - DI.4: accountId NULL + packageId set → 400 'package_requires_account'
 *  - DI.5: accountId set + packageId set → AccountCompany(account,company).packageId
 *    === packageId; aksi halde 400 'package_account_company_mismatch'
 *    (AccountCompany'de packageId NULL ise zaten mismatch'tir; önce
 *    AccountCompany'e bağla, sonra vakaya at).
 *
 * Returns { id, name } for denormalize.
 */
async function loadAndValidateCasePackage({ packageId, accountId, companyId }) {
  if (!accountId) {
    // D-A7BI.4 — customerless flow için package bağlanamaz.
    throw new CaseValidationError(
      'Müşteri seçilmeden paket atanamaz.',
      { status: 400, code: 'package_requires_account' },
    );
  }
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    select: { id: true, name: true, companyId: true, isActive: true },
  });
  if (!pkg || !pkg.isActive) {
    throw new CaseValidationError('Geçersiz veya pasif paket.', {
      status: 400,
      code: 'invalid_package',
    });
  }
  if (pkg.companyId !== companyId) {
    throw new CaseValidationError(
      'Bu paket vaka şirketine ait değil.',
      { status: 400, code: 'package_company_mismatch' },
    );
  }
  // D-A7BI.3 — Case.packageId === AccountCompany.packageId zorunlu.
  const ac = await prisma.accountCompany.findUnique({
    where: { accountId_companyId: { accountId, companyId } },
    select: { packageId: true },
  });
  if (!ac || ac.packageId !== pkg.id) {
    throw new CaseValidationError(
      'Bu paket müşterinin şirket ilişkisine bağlı değil. Önce müşteri-şirket ilişkisinde paketi tanımla.',
      { status: 400, code: 'package_account_company_mismatch' },
    );
  }
  return { id: pkg.id, name: pkg.name };
}

/**
 * WR-A7b / DI.3 — Eğer Case'de hem productId hem packageId set ise productId
 * o paketin PackageItem listesinde olmalı. Aksi halde 400 'package_product_mismatch'.
 *
 * Bu invariant planning card §⑥ tablosunda enumarate edildi (CP.6 contract).
 * UI'da product picker zaten paket seçilince filtre uyguluyor; backend
 * defense-in-depth.
 *
 * Helper yalnız her iki id de set olduğunda çağrılmalı; null tarafı caller atlar.
 */
async function assertPackageProductCompatible({ packageId, productId }) {
  if (!packageId || !productId) return;
  const link = await prisma.packageItem.findUnique({
    where: { packageId_productId: { packageId, productId } },
    select: { packageId: true },
  });
  if (!link) {
    throw new CaseValidationError(
      'Seçilen ürün bu paketin içeriğinde değil.',
      { status: 400, code: 'package_product_mismatch' },
    );
  }
}

function sanitizeRequesterContext(raw) {
  const out = {
    customerContactName: trimOrNull(raw.customerContactName, 120),
    customerContactPhone: trimOrNull(raw.customerContactPhone, 40),
    customerContactEmail: trimOrNull(raw.customerContactEmail, 160),
    customerCompanyName: trimOrNull(raw.customerCompanyName, 180),
  };
  if (out.customerContactEmail && !EMAIL_VALIDATION_RX.test(out.customerContactEmail)) {
    throw new CaseValidationError('Geçersiz e-posta.', {
      status: 400,
      code: 'requester_email_invalid',
    });
  }
  return out;
}

/**
 * Mutation guard + companyId resolver.
 *
 * Davranış:
 *   - Case yok → null döner (route 404'e çevirir).
 *   - allowedCompanyIds verilmiş + scope dışı → CaseAccessError fırlatır.
 *   - Aksi halde → case.companyId döner.
 *
 * Caller'lar bu companyId'yi child satırlar (history, note, call log, vb.)
 * yaratırken denormalize için kullanır — Faz 1.5 multi-tenant child
 * denormalization işi.
 *
 * NOT: Önceki versiyonda allowedCompanyIds yokken fetch atlanıyordu (bypass);
 * artık her zaman fetch yapılır çünkü companyId döndürmek gerekiyor. Maliyet
 * ihmal edilebilir (zaten case mutation'larının çoğu kendi findUnique'ini
 * yapıyor); cron yolu (processSnoozeWakeups) bu helper'ı çağırmıyor zaten.
 */
// WR-Smart-Ticket Phase 1e — yapılandırılmış kapanış metadata'sını mevcut
// Case.customFields üzerine deep-merge eder. Yalnız transitionStatus
// içinden çağrılır (Cozuldu'ya geçiş guard'ından sonra).
//
// Sözleşme:
//   - prev.customFields.smartTicket var olmalı (Case Smart Ticket intake'ten
//     açılmış olmalı). Yoksa `smart_ticket_closure_requires_opening` 400.
//   - Diğer customFields dalları (örn. FieldDefinition tabanlı dinamik
//     alanlar) AYNEN korunur — sadece smartTicket dalı yeniden yazılır.
//   - smartTicket içindeki opening alanları (platform/businessProcess/…)
//     AYNEN korunur — sadece `closure` alt-objesi set edilir.
//   - version + updatedAt server-side stamplenir; client gönderemez.
const SMART_TICKET_CLOSURE_VERSION = 1;

// Kapanışın 4 bağımsız alanı — telemetry perField anahtarları bu set ile
// allowlist'lenir (beklenmedik key persist edilmesin).
const CLOSURE_TELEMETRY_FIELD_KEYS = new Set([
  'rootCauseGroup',
  'rootCauseDetail',
  'resolutionType',
  'permanentPrevention',
]);

// closureSuggestion.aiSuggested — sıkı bounded sanitize. Frontend'in ürettiği
// NORMALIZE telemetry (raw KB cevabı değil); yine de yalnız bilinen alanlar
// geçer, bilinmeyen anahtarlar düşürülür.
function sanitizeAiSuggestedTelemetry(ai) {
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return undefined;
  const out = {};
  for (const k of [
    'suggestedAt',
    'resolutionSeen',
    'modelUsed',
    'tier',
    'promptVersion',
    'taxonomyVersion',
    'reason',
  ]) {
    if (typeof ai[k] === 'string') out[k] = ai[k];
  }
  if (typeof ai.confidence === 'number') out.confidence = ai.confidence;
  if (ai.perField && typeof ai.perField === 'object' && !Array.isArray(ai.perField)) {
    const pf = {};
    for (const [field, v] of Object.entries(ai.perField)) {
      if (!CLOSURE_TELEMETRY_FIELD_KEYS.has(field) || !v || typeof v !== 'object') continue;
      const e = {};
      if (typeof v.code === 'string') e.code = v.code;
      if (typeof v.label === 'string') e.label = v.label;
      if (typeof v.matchedBy === 'string') e.matchedBy = v.matchedBy;
      if (typeof v.confidence === 'number') e.confidence = v.confidence;
      pf[field] = e;
    }
    out.perField = pf;
  }
  if (Array.isArray(ai.unmatched)) {
    out.unmatched = ai.unmatched
      .filter((u) => u && typeof u === 'object' && typeof u.taxonomyType === 'string')
      .map((u) => ({
        taxonomyType: u.taxonomyType,
        ...(typeof u.rawValue === 'string' ? { rawValue: u.rawValue } : {}),
      }));
  }
  return out;
}

// closureSuggestion.humanApplied — sıkı bounded sanitize.
function sanitizeHumanAppliedTelemetry(ha) {
  if (!ha || typeof ha !== 'object' || Array.isArray(ha)) return undefined;
  const out = {};
  if (typeof ha.appliedAt === 'string') out.appliedAt = ha.appliedAt;
  if (ha.perField && typeof ha.perField === 'object' && !Array.isArray(ha.perField)) {
    const pf = {};
    for (const [field, v] of Object.entries(ha.perField)) {
      if (!CLOSURE_TELEMETRY_FIELD_KEYS.has(field) || !v || typeof v !== 'object') continue;
      const e = {};
      if (typeof v.code === 'string') e.code = v.code;
      if (typeof v.label === 'string') e.label = v.label;
      if (typeof v.changedFromAi === 'boolean') e.changedFromAi = v.changedFromAi;
      pf[field] = e;
    }
    out.perField = pf;
  }
  return out;
}

export function buildSmartTicketClosureMerge(prev, closureInput) {
  if (!closureInput || typeof closureInput !== 'object') {
    throw new CaseValidationError('Geçersiz Smart Ticket closure payload.', {
      status: 400,
      code: 'smart_ticket_closure_invalid',
    });
  }
  const existing =
    prev.customFields && typeof prev.customFields === 'object' ? prev.customFields : {};
  const existingSt =
    existing.smartTicket && typeof existing.smartTicket === 'object' ? existing.smartTicket : null;
  if (!existingSt) {
    throw new CaseValidationError(
      'Smart Ticket kapanış metadata\'sı yalnız Smart Ticket akışıyla açılmış vakalara yazılabilir.',
      { status: 400, code: 'smart_ticket_closure_requires_opening' },
    );
  }
  // Client'ın gönderebileceği alanları sıkı pickle — başka anahtar persist
  // edilmesin. Hepsi opsiyonel; ama UI submit'inde temel alanlar dolu olur.
  const pick = (k) => {
    const v = closureInput[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const closure = {
    rootCauseGroup: pick('rootCauseGroup'),
    rootCauseGroupLabel: pick('rootCauseGroupLabel'),
    rootCauseDetail: pick('rootCauseDetail'),
    rootCauseDetailLabel: pick('rootCauseDetailLabel'),
    resolutionType: pick('resolutionType'),
    resolutionTypeLabel: pick('resolutionTypeLabel'),
    permanentPrevention: pick('permanentPrevention'),
    permanentPreventionLabel: pick('permanentPreventionLabel'),
    // WR-KB-Closure-Auto — Smart Ticket Stage 3 auto-fetch metadata.
    // selectedWorkedStepId: hangi solution-step kullanıcının seçtiği
    // "İşe yaradı" referansı olarak persist edilir.
    selectedWorkedStepId: pick('selectedWorkedStepId'),
    version: SMART_TICKET_CLOSURE_VERSION,
    updatedAt: new Date().toISOString(),
  };
  // closureSuggestion meta opsiyonel object: KB tarafından gelen normalize
  // edilmiş öneri (source/appliedAt/appliedFields/perField/unmatched).
  // Sıkı pickle: raw KB cevabı persist EDİLMEZ.
  if (
    closureInput.closureSuggestion &&
    typeof closureInput.closureSuggestion === 'object' &&
    !Array.isArray(closureInput.closureSuggestion)
  ) {
    const cs = closureInput.closureSuggestion;
    const meta = { source: 'external_kb' };
    if (typeof cs.appliedAt === 'string') meta.appliedAt = cs.appliedAt;
    else meta.appliedAt = new Date().toISOString();
    if (Array.isArray(cs.appliedFields)) {
      meta.appliedFields = cs.appliedFields.filter((x) => typeof x === 'string');
    }
    if (cs.perField && typeof cs.perField === 'object' && !Array.isArray(cs.perField)) {
      meta.perField = cs.perField;
    }
    if (Array.isArray(cs.unmatched)) {
      meta.unmatched = cs.unmatched.filter(
        (u) => u && typeof u === 'object' && typeof u.taxonomyType === 'string',
      );
    }
    if (typeof cs.confidence === 'number') meta.confidence = cs.confidence;
    if (typeof cs.reason === 'string') meta.reason = cs.reason;
    if (typeof cs.modelUsed === 'string') meta.modelUsed = cs.modelUsed;
    // Telemetry attribution (ai_suggested / human_applied) — bounded allow.
    const aiSuggested = sanitizeAiSuggestedTelemetry(cs.aiSuggested);
    if (aiSuggested) meta.aiSuggested = aiSuggested;
    const humanApplied = sanitizeHumanAppliedTelemetry(cs.humanApplied);
    if (humanApplied) meta.humanApplied = humanApplied;
    closure.closureSuggestion = meta;
  }
  // Undefined alanları temizle (Postgres JSON içinde null tutmaktansa hiç koyma).
  for (const k of Object.keys(closure)) {
    if (closure[k] === undefined) delete closure[k];
  }
  return {
    ...existing,
    smartTicket: {
      ...existingSt,
      closure,
    },
  };
}

// WR-Smart-Ticket Phase T1 — L1 → L2 devir akışında L2 agent'a görünür
// "devir bağlamı" Case.customFields üzerine deep-merge edilir. Yalnız
// transferCase içinden çağrılır (Smart Ticket akışıyla açılmış
// vakalarda).
//
// Sözleşme:
//   - prev.customFields.smartTicket var olmalı (Case Smart Ticket
//     intake'ten açılmış). Yoksa `smart_ticket_transfer_requires_opening`
//     400. (Klasik vakaların transfer'i etkilenmez; backend buraya yalnız
//     payload.smartTicketTransfer geldiyse uğrar.)
//   - Diğer customFields dalları AYNEN korunur.
//   - smartTicket içindeki opening + closure alt-objeleri korunur — yalnız
//     `transferContext` alt-objesi yazılır/üzerine yazılır.
//   - version + transferredAt server-side stamp.
const SMART_TICKET_TRANSFER_VERSION = 1;
function buildSmartTicketTransferMerge(prev, transferInput, contextFields) {
  if (!transferInput || typeof transferInput !== 'object') {
    throw new CaseValidationError('Geçersiz Smart Ticket transfer payload.', {
      status: 400,
      code: 'smart_ticket_transfer_invalid',
    });
  }
  const existing =
    prev.customFields && typeof prev.customFields === 'object' ? prev.customFields : {};
  const existingSt =
    existing.smartTicket && typeof existing.smartTicket === 'object' ? existing.smartTicket : null;
  if (!existingSt) {
    throw new CaseValidationError(
      'Smart Ticket devir bağlamı yalnız Smart Ticket akışıyla açılmış vakalara yazılabilir.',
      { status: 400, code: 'smart_ticket_transfer_requires_opening' },
    );
  }
  const pickStr = (k) => {
    const v = transferInput[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const transferNote = pickStr('transferNote');
  if (!transferNote) {
    throw new CaseValidationError(
      'Devir notu zorunludur.',
      { status: 400, code: 'smart_ticket_transfer_note_required' },
    );
  }
  const composedSummary = pickStr('composedSummary');
  // attemptedStepIds opsiyonel — caller composer'dan alır.
  const attemptedStepIds = Array.isArray(transferInput.attemptedStepIds)
    ? transferInput.attemptedStepIds.filter((x) => typeof x === 'string' && x.trim())
    : undefined;

  // Opening taxonomy snapshot — mevcut smartTicket opening'ten kopyalanır
  // (server-side); client gönderdiyse kopya ile birleştirilir ama mevcut
  // opening verisi öncelik kazanır (tamper-safe).
  const openingSnapshot = {};
  const OPENING_FIELDS = [
    'platform', 'platformLabel',
    'businessProcess', 'businessProcessLabel',
    'operationType', 'operationTypeLabel',
    'affectedObject', 'affectedObjectLabel',
    'impact', 'impactLabel',
  ];
  for (const k of OPENING_FIELDS) {
    if (typeof existingSt[k] === 'string' && existingSt[k].trim()) {
      openingSnapshot[k] = existingSt[k].trim();
    }
  }

  const stepOutcomesSummary =
    transferInput.stepOutcomesSummary &&
    typeof transferInput.stepOutcomesSummary === 'object' &&
    !Array.isArray(transferInput.stepOutcomesSummary)
      ? {
          worked: Number(transferInput.stepOutcomesSummary.worked) || 0,
          notWorked: Number(transferInput.stepOutcomesSummary.notWorked) || 0,
          skipped: Number(transferInput.stepOutcomesSummary.skipped) || 0,
          pending: Number(transferInput.stepOutcomesSummary.pending) || 0,
          total: Number(transferInput.stepOutcomesSummary.total) || 0,
        }
      : undefined;

  // contextFields — transferCase'in resolved ekip/kişi bilgileri.
  const transferContext = {
    version: SMART_TICKET_TRANSFER_VERSION,
    transferredAt: new Date().toISOString(),
    fromTeamId: contextFields?.fromTeamId ?? undefined,
    fromTeamName: contextFields?.fromTeamName ?? undefined,
    toTeamId: contextFields?.toTeamId,
    toTeamName: contextFields?.toTeamName,
    toPersonId: contextFields?.toPersonId ?? undefined,
    toPersonName: contextFields?.toPersonName ?? undefined,
    transferNote,
    composedSummary,
    attemptedStepIds,
    openingTaxonomySnapshot: Object.keys(openingSnapshot).length > 0 ? openingSnapshot : undefined,
    stepOutcomesSummary,
  };

  for (const k of Object.keys(transferContext)) {
    if (transferContext[k] === undefined) delete transferContext[k];
  }

  return {
    ...existing,
    smartTicket: {
      ...existingSt,
      transferContext,
    },
  };
}

// Madde 2 — KB analyze cevabından çıkarılan "engineering handoff" (teknik
// devir notu) ve "customer reply draft" (müşteri yanıt taslağı) string'leri
// customFields.smartTicket.aiDrafts altına persist edilir.
//
// Sözleşme:
//   - prev.customFields.smartTicket var olmalı (Smart Ticket akışı). Yoksa
//     null döner (klasik vakalar etkilenmez; defensive no-op).
//   - Diğer customFields dalları + smartTicket içindeki opening/closure/
//     transferContext AYNEN korunur — yalnız `aiDrafts` set edilir.
//   - version + capturedAt server-side stamp. Raw KB persist EDİLMEZ
//     (yalnız iki normalized string + meta).
const SMART_TICKET_AI_DRAFTS_VERSION = 1;
/**
 * PR-D2 — customFields.devops array read/write helper'ları.
 *
 * Case.customFields Prisma'da NVarChar(Max) (JSON string olabilir VEYA
 * smart-ticket merge fonksiyonlarındaki gibi object olarak elden geçmiş
 * olabilir). İki durumu da güvenli ele al: parse fail → boş object.
 *
 * writeDevopsArray her zaman JSON string döndürür (Prisma'ya yazılır).
 */
function readDevopsArray(customFieldsRaw) {
  if (!customFieldsRaw) return [];
  let obj;
  if (typeof customFieldsRaw === 'string') {
    try {
      obj = JSON.parse(customFieldsRaw);
    } catch {
      return [];
    }
  } else if (typeof customFieldsRaw === 'object') {
    obj = customFieldsRaw;
  } else {
    return [];
  }
  const arr = obj?.devops;
  return Array.isArray(arr) ? arr : [];
}

function writeDevopsArray(customFieldsRaw, devopsArr) {
  let obj = {};
  if (customFieldsRaw) {
    if (typeof customFieldsRaw === 'string') {
      try {
        obj = JSON.parse(customFieldsRaw);
      } catch {
        obj = {};
      }
    } else if (typeof customFieldsRaw === 'object') {
      obj = { ...customFieldsRaw };
    }
  }
  obj.devops = devopsArr;
  return JSON.stringify(obj);
}

/**
 * Fix 2 (Codex P2 pre-main) — Atomik devops array mutate (optimistic
 * concurrency control + retry).
 *
 * Sorun: linkDevops/unlinkDevops naïve read-modify-write race condition'a
 * açıktı. İki eşzamanlı POST /devops-link:
 *   Tx A read arr=[]
 *   Tx B read arr=[]
 *   Tx A write arr=[X]
 *   Tx B write arr=[Y]   ← X kaybedildi
 *
 * Çözüm: `updateMany(where: { id, updatedAt })` optimistic guard. Prisma
 * @updatedAt directive update'lerde otomatik yeni timestamp set eder;
 * concurrent write timestamp eşleşmesi nedeniyle count=0 döner → retry.
 *
 * Aktivite (CaseActivity) successful update sonrası ayrı satır — append-only
 * audit, race-relevant değil.
 *
 * @param {string} caseId
 * @param {(arr: Array<object>) => { nextArr: Array<object>, op: 'append'|'remove'|'noop', target?: object }} mutate
 *   Mevcut array → next array dönüştürücüsü.
 * @returns {Promise<{ ok: true, op: string, target?: object } | null>}
 *   - null: case bulunamadı
 *   - { ok: true, op: 'noop' }: idempotent (zaten istenen state)
 *   - { ok: true, op: 'append'|'remove', target }: değişiklik kaydedildi
 *
 * Throws CaseValidationError(409, 'devops_concurrent_update') retry tükenirse.
 */
const DEVOPS_MUTATE_MAX_RETRIES = 5;
async function atomicMutateDevopsArray(caseId, mutate) {
  for (let attempt = 0; attempt < DEVOPS_MUTATE_MAX_RETRIES; attempt += 1) {
    const current = await prisma.case.findUnique({
      where: { id: caseId },
      select: { customFields: true, updatedAt: true },
    });
    if (!current) return null;
    const arr = readDevopsArray(current.customFields);
    const result = mutate(arr);
    if (result.op === 'noop') {
      return { ok: true, op: 'noop' };
    }
    const next = writeDevopsArray(current.customFields, result.nextArr);
    const updated = await prisma.case.updateMany({
      where: { id: caseId, updatedAt: current.updatedAt },
      data: { customFields: next },
    });
    if (updated.count === 1) {
      return { ok: true, op: result.op, target: result.target };
    }
    // Race lost — exponential-ish backoff (10/35/85/185/385 ms ortalama)
    await new Promise((r) => setTimeout(r, 10 + attempt * 25));
  }
  throw new CaseValidationError(
    'Eşzamanlı değişiklik nedeniyle DevOps bağlantısı güncellenemedi. Lütfen tekrar deneyin.',
    { status: 409, code: 'devops_concurrent_update' },
  );
}

function buildSmartTicketAiDraftsMerge(prev, drafts) {
  if (!drafts || typeof drafts !== 'object') return null;
  const engineering =
    typeof drafts.engineeringHandoff === 'string' && drafts.engineeringHandoff.trim()
      ? drafts.engineeringHandoff.trim()
      : undefined;
  const customer =
    typeof drafts.customerReplyDraft === 'string' && drafts.customerReplyDraft.trim()
      ? drafts.customerReplyDraft.trim()
      : undefined;
  if (!engineering && !customer) return null;

  const existing =
    prev.customFields && typeof prev.customFields === 'object' ? prev.customFields : {};
  const existingSt =
    existing.smartTicket && typeof existing.smartTicket === 'object' ? existing.smartTicket : null;
  if (!existingSt) return null; // Smart Ticket opening şartı — sessiz no-op.

  const aiDrafts = {
    source: 'external_kb',
    version: SMART_TICKET_AI_DRAFTS_VERSION,
    capturedAt: new Date().toISOString(),
  };
  if (engineering) aiDrafts.engineeringHandoff = engineering;
  if (customer) aiDrafts.customerReplyDraft = customer;

  return {
    ...existing,
    smartTicket: {
      ...existingSt,
      aiDrafts,
    },
  };
}

/**
 * PR-SD (Codex P2 round-4) — Read path scope guard. Read endpoint'leri
 * için kullanılır; arşivli case yalnız SystemAdmin'e açıktır, diğer roller
 * null alır (route 404 yansıtır). Bu helper write semantiği taşımaz —
 * arşivli case write için assertCaseInScope (default flags) kullanılır
 * ve 409 case_archived_readonly döner.
 *
 * actorRole null/undefined → SystemAdmin değil sayılır (defansif: legacy
 * caller arşivli case'e erişim alamasın).
 */
async function assertCaseInScopeForRead(caseId, allowedCompanyIds, actorRole = null) {
  const found = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, companyId: true, isArchived: true },
  });
  if (!found) return null;
  if (allowedCompanyIds && !allowedCompanyIds.includes(found.companyId)) {
    throw new CaseAccessError();
  }
  // Arşivli case → sadece SystemAdmin görür; diğer roller (Agent/Admin/...)
  // null alır → route 404 yansıtır (ana case GET /:id rol guard'ı ile
  // tutarlı; Codex P2 round-4).
  if (found.isArchived && actorRole !== 'SystemAdmin') {
    return null;
  }
  return found.companyId;
}

async function assertCaseInScope(caseId, allowedCompanyIds, { allowArchived = false } = {}) {
  const found = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, companyId: true, isArchived: true },
  });
  if (!found) return null;
  if (allowedCompanyIds && !allowedCompanyIds.includes(found.companyId)) {
    throw new CaseAccessError();
  }
  // PR-SD (Codex P2) — Arşivli vaka tüm write path'lerde READ-ONLY.
  // SystemAdmin bile transfer/transition/note/file/checklist/solution-step
  // yapamaz. Önce restore (POST /:id/restore) edilmeli. allowArchived flag
  // sadece archive()/restore() helper'larının kendileri için (idempotent
  // davranışı korumak amacıyla).
  if (found.isArchived && !allowArchived) {
    throw new CaseValidationError(
      'Arşivli vakaya yazılamaz. Önce SystemAdmin tarafından restore edilmeli.',
      { status: 409, code: 'case_archived_readonly' },
    );
  }
  return found.companyId;
}

/**
 * Role-aware KPI stats. Used by /api/cases/stats — Vakalar listesi üstündeki
 * kartlar. Aynı scope kuralları list endpoint'iyle birebir tutarlı:
 *   - companyId ∈ allowedCompanyIds
 *   - "open" = Acik/Incelemede/ThirdPartyWaiting/Eskalasyon/YenidenAcildi
 *   - resolvedToday = today UTC (server tz uses Istanbul daysOffset already in scope)
 *
 * Modes:
 *   personal   → Agent / Backoffice / CSM
 *   team       → Supervisor (Person.teamId üzerinden tek-takım)
 *   operations → Admin / SystemAdmin
 *
 * LIMITATION: Schema Supervisor için çoklu-takım üyeliği modellemiyor.
 * Person.teamId tek bir takım. Supervisor birden fazla takımı yönetiyorsa
 * şu an sadece kendi Person.teamId'sindeki vakaları görüyor. Person'ı yoksa
 * fallback: assignedTeamId NOT NULL içindeki tüm cases (scope dahilinde).
 */
const STATS_OPEN_STATUSES = ['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi'];

function buildTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { gte: start, lte: end };
}

// List endpoint default: snoozeUntil > now olan vakalar hidden (Later sekmesi
// ayrı). Stats da aynı kuralı kullanır ki "Bana Atanan" sayısı tıklama sonrası
// liste sayısıyla aynı olsun. Sadece snoozedMine bunu override eder (sadece
// snoozed olanları sayar).
function notSnoozedClause() {
  return { OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: new Date() } }] };
}

// Vaka Etiket Doğrulama Ekranı — alan bazlı (per-field) model. Her giriş
// CaseTaggingReview'daki `${prefix}${tag}{Original,Verdict,Corrected}*`
// kolon ailesini, Case.customFields.smartTicket(.closure) içindeki kaynak
// alanı ve TaxonomyDef.taxonomyType değerini birbirine bağlar — tek yerden
// değişsin diye repository + route + (frontend'de ayrıca) tekrarlanır.
const TAGGING_FIELD_DEFS = [
  { prefix: 'opening', tag: 'Platform', customField: 'platform', taxonomyType: 'platform' },
  { prefix: 'opening', tag: 'BusinessProcess', customField: 'businessProcess', taxonomyType: 'businessProcess' },
  { prefix: 'opening', tag: 'OperationType', customField: 'operationType', taxonomyType: 'operationType' },
  { prefix: 'opening', tag: 'AffectedObject', customField: 'affectedObject', taxonomyType: 'affectedObject' },
  { prefix: 'opening', tag: 'Impact', customField: 'impact', taxonomyType: 'impact' },
  { prefix: 'closing', tag: 'RootCauseGroup', customField: 'rootCauseGroup', taxonomyType: 'rootCauseGroup' },
  { prefix: 'closing', tag: 'RootCauseDetail', customField: 'rootCauseDetail', taxonomyType: 'rootCauseDetail' },
  { prefix: 'closing', tag: 'ResolutionType', customField: 'resolutionType', taxonomyType: 'resolutionType' },
  { prefix: 'closing', tag: 'PermanentPrevention', customField: 'permanentPrevention', taxonomyType: 'permanentPrevention' },
];

export const caseRepository = {
  /**
   * Madde 2 — Smart Ticket akışında KB analyze cevabından extract edilen
   * AI draft'larını (engineeringHandoff, customerReplyDraft) Case.customFields
   * altına persist eder. Sadece Smart Ticket akışıyla açılmış case'lerde
   * çalışır (buildSmartTicketAiDraftsMerge defensive — smartTicket opening
   * yoksa null döner, no-op). Tek L1 ajan akışı olduğu için transaction
   * gerektirmez; mevcut customFields fresh read + merge yeterli.
   */
  async persistSmartTicketAiDrafts(id, drafts, allowedCompanyIds) {
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
    const fresh = await prisma.case.findUnique({
      where: { id },
      select: { customFields: true },
    });
    if (!fresh) return null;
    const merged = buildSmartTicketAiDraftsMerge(
      { customFields: fresh.customFields },
      drafts,
    );
    if (!merged) return { persisted: false };
    await prisma.case.update({
      where: { id },
      data: { customFields: merged },
    });
    return { persisted: true };
  },

  /**
   * Compute role-aware stats for the cases list KPI cards.
   * Mode is selected from `user.role`. companyId scope enforced via
   * allowedCompanyIds. No cross-tenant leakage. snoozedMine ignores the
   * default "hide snoozed" rule (which is a list-presentation default,
   * not a counting default).
   */
  async getStats({ user, securityWhere = null }) {
    const allowedCompanyIds = user?.allowedCompanyIds ?? [];
    if (!Array.isArray(allowedCompanyIds) || allowedCompanyIds.length === 0) {
      return { mode: 'empty' };
    }
    const scope = { companyId: { in: allowedCompanyIds } };
    const todayRange = buildTodayRange();
    const role = user.role;
    const scoped = (where) => mergeSecurityWhere(where, securityWhere);

    if (['Agent', 'Backoffice', 'CSM'].includes(role)) {
      if (!user.personId) {
        return { mode: 'personal', assignedToMe: 0, slaRiskMine: 0, resolvedToday: 0, snoozedMine: 0 };
      }
      const personId = user.personId;
      const notSnoozed = notSnoozedClause();
      const [assignedToMe, slaRiskMine, resolvedToday, snoozedMine, unassigned, critical] = await Promise.all([
        // assignedToMe: open + not snoozed (matches list default)
        prisma.case.count({
          where: scoped({ ...scope, assignedPersonId: personId, status: { in: STATS_OPEN_STATUSES }, AND: [notSnoozed] }),
        }),
        // slaRiskMine: open + not snoozed + slaViolation
        prisma.case.count({
          where: scoped({ ...scope, assignedPersonId: personId, status: { in: STATS_OPEN_STATUSES }, slaViolation: true, AND: [notSnoozed] }),
        }),
        // resolvedToday: snooze irrelevant — case zaten Cozuldu
        prisma.case.count({
          where: scoped({ ...scope, assignedPersonId: personId, resolvedAt: todayRange, status: { in: ['Cozuldu', 'IptalEdildi'] } }),
        }),
        // snoozedMine: yalnız snooze-active vakalar (list /api/cases/snoozed ile aynı kontrat)
        prisma.case.count({
          where: scoped({ ...scope, assignedPersonId: personId, snoozeUntil: { gt: new Date() }, status: { in: STATS_OPEN_STATUSES } }),
        }),
        // chip sayıları — scope'taki tüm atanmamış/kritik açık + snooze-dışı vakalar
        prisma.case.count({ where: scoped({ ...scope, assignedPersonId: null, status: { in: STATS_OPEN_STATUSES }, AND: [notSnoozed] }) }),
        prisma.case.count({ where: scoped({ ...scope, priority: 'Critical', status: { in: STATS_OPEN_STATUSES }, AND: [notSnoozed] }) }),
      ]);
      return { mode: 'personal', assignedToMe, slaRiskMine, resolvedToday, snoozedMine, unassigned, critical };
    }

    if (role === 'Supervisor') {
      // Supervisor "team" = Person.teamId (single-team limitation, see header).
      let teamFilter = { assignedTeamId: { not: null } };
      let supervisorTeamId = null;
      if (user.personId) {
        const person = await prisma.person.findUnique({
          where: { id: user.personId },
          select: { teamId: true },
        });
        if (person?.teamId) {
          supervisorTeamId = person.teamId;
          teamFilter = { assignedTeamId: person.teamId };
        }
      }
      const notSnoozed = notSnoozedClause();
      const [teamOpenCount, teamSlaRisk, teamEscalation, teamResolvedToday, unassigned, critical] = await Promise.all([
        prisma.case.count({
          where: scoped({ ...scope, ...teamFilter, status: { in: STATS_OPEN_STATUSES }, AND: [notSnoozed] }),
        }),
        prisma.case.count({
          where: scoped({ ...scope, ...teamFilter, status: { in: STATS_OPEN_STATUSES }, slaViolation: true, AND: [notSnoozed] }),
        }),
        prisma.case.count({
          where: scoped({ ...scope, ...teamFilter, status: 'Eskalasyon', AND: [notSnoozed] }),
        }),
        prisma.case.count({
          where: scoped({ ...scope, ...teamFilter, resolvedAt: todayRange, status: { in: ['Cozuldu', 'IptalEdildi'] } }),
        }),
        // chip sayıları — scope'taki tüm atanmamış/kritik açık + snooze-dışı vakalar
        prisma.case.count({ where: scoped({ ...scope, assignedPersonId: null, status: { in: STATS_OPEN_STATUSES }, AND: [notSnoozed] }) }),
        prisma.case.count({ where: scoped({ ...scope, priority: 'Critical', status: { in: STATS_OPEN_STATUSES }, AND: [notSnoozed] }) }),
      ]);
      return {
        mode: 'team',
        teamOpenCount,
        teamSlaRisk,
        teamEscalation,
        teamResolvedToday,
        unassigned,
        critical,
        // Echo back resolved teamId for client filter (so click can apply same scope).
        supervisorTeamId,
      };
    }

    if (role === 'Admin' || role === 'SystemAdmin') {
      const notSnoozed = notSnoozedClause();
      const [totalOpen, slaViolation, critical, resolvedToday, unassigned] = await Promise.all([
        prisma.case.count({ where: scoped({ ...scope, status: { in: STATS_OPEN_STATUSES }, AND: [notSnoozed] }) }),
        prisma.case.count({
          where: scoped({ ...scope, status: { in: STATS_OPEN_STATUSES }, slaViolation: true, AND: [notSnoozed] }),
        }),
        prisma.case.count({
          where: scoped({ ...scope, status: { in: STATS_OPEN_STATUSES }, priority: 'Critical', AND: [notSnoozed] }),
        }),
        prisma.case.count({ where: scoped({ ...scope, resolvedAt: todayRange, status: { in: ['Cozuldu', 'IptalEdildi'] } }) }),
        // chip sayısı — tüm scope'taki atanmamış açık + snooze-dışı vakalar
        prisma.case.count({ where: scoped({ ...scope, assignedPersonId: null, status: { in: STATS_OPEN_STATUSES }, AND: [notSnoozed] }) }),
      ]);
      return { mode: 'operations', totalOpen, slaViolation, critical, resolvedToday, unassigned };
    }

    return { mode: 'unknown' };
  },

  async list({ filters, pagination, sortBy, sortDir, allowedCompanyIds, securityWhere } = {}) {
    const where = buildWhere(toDbFilters(filters), allowedCompanyIds, securityWhere);
    const total = await prisma.case.count({ where });

    // Desteklenen sort alanları → Prisma kolon adı. Bilinmeyen değer updatedAt'e düşer.
    const SORT_FIELD_MAP = {
      updatedAt:   'updatedAt',
      createdAt:   'createdAt',
      sla:         'slaResolutionDueAt',
      caseNumber:  'caseNumber',
      title:       'title',
      accountName: 'accountName',
      companyName: 'companyName',
      assignment:  'assignedPersonName',
      priority:    'priority',
      status:      'status',
      caseType:    'caseType',
    };
    const dir = sortDir === 'asc' ? 'asc' : 'desc';
    // İlişkili tablo sort'ları (taggingReview one-to-one).
    const RELATION_SORT = {
      reviewer:   { taggingReview: { reviewerName: dir } },
      reviewedAt: { taggingReview: { reviewedAt:   dir } },
    };
    let orderBy;
    if (RELATION_SORT[sortBy]) {
      orderBy = [RELATION_SORT[sortBy], { updatedAt: 'desc' }];
    } else {
      const field = SORT_FIELD_MAP[sortBy] ?? 'updatedAt';
      // İki kademeli sıralama: seçili alan + updatedAt (sayfalama kararlılığı için).
      orderBy = field === 'updatedAt'
        ? [{ updatedAt: dir }]
        : [{ [field]: dir }, { updatedAt: 'desc' }];
    }

    const skip = (pagination.page - 1) * pagination.pageSize;
    const items = await prisma.case.findMany({
      where,
      include: CASE_INCLUDE,
      orderBy,
      skip,
      take: pagination.pageSize,
    });
    return { items: items.map(shape), total };
  },

  async get(id, allowedCompanyIds, actorRole) {
    const c = await prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE });
    if (!c) return null;
    if (allowedCompanyIds && !allowedCompanyIds.includes(c.companyId)) {
      throw new CaseAccessError();
    }
    // PR-SD — Arşivli vaka direct URL: yalnız SystemAdmin görür. Diğer
    // roller için 404 davranışı (null döner → route 404 yansıtır).
    if (c.isArchived && actorRole !== 'SystemAdmin') return null;
    return shape(c);
  },

  async create(input, actor) {
    // input: NewCaseInput shape (caseService.ts §142)
    // actor: ActorContext (server/lib/actor.js); route layer requireActor(req)
    //        ile üretip pass eder. Eksikse defansif throw (Mock User
    //        fallback'ı geri dönmez — caller migrasyonu zorunlu).
    assertActor(actor, 'caseRepository.create');
    const caseNumber = `VK-${Date.now().toString(36).toUpperCase()}`;
    // TR string enum'larını ASCII identifier'a çevir
    const m = toDb(input);

    // Phase D — Müşterisiz vaka akışı:
    //   - CompanySettings.requireCustomerOnCaseCreate=true ise accountId zorunlu
    //   - accountId null → customerMatchPending=true (Supervisor eşleştirme kuyruğu)
    //   - accountId dolu → customerMatchPending=false
    const settings = m.companyId
      ? await prisma.companySettings.findUnique({
          where: { companyId: m.companyId },
          select: {
            requireCustomerOnCaseCreate: true,
            // WR-A4 — projectsRequired flag (default false)
            projectsRequired: true,
          },
        })
      : null;
    const requireCustomer = !!settings?.requireCustomerOnCaseCreate;
    if (requireCustomer && !m.accountId) {
      throw new CaseValidationError(
        'Bu şirkette vaka açmak için müşteri seçimi zorunludur.',
        { status: 400, code: 'customer_required' },
      );
    }
    const customerMatchPending = !m.accountId;

    // WR-A4 — AccountProject integrity guard.
    //   Invariant: Account → AccountCompany → AccountProject → Case. A project
    //   reference is meaningful only when the case has an account; otherwise
    //   accountProjectId would dangle (no account to anchor the relationship).
    //
    //   1. accountProjectId provided + accountId missing → 400 project_requires_account
    //   2. accountProjectId provided + accountId provided → full validate via helper
    //   3. accountProjectId missing + accountId provided + projectsRequired=true → 400 project_required
    //   4. accountId missing → accountProjectId/Name MUST be null (customerless flow)
    let accountProjectName = null;
    if (m.accountProjectId) {
      // accountId checked first inside helper (project_requires_account).
      const project = await loadAndValidateProject({
        projectId: m.accountProjectId,
        accountId: m.accountId,
        companyId: m.companyId,
      });
      accountProjectName = project.name;
    } else if (m.accountId && settings?.projectsRequired) {
      // projectsRequired=true + accountId var + projectId yok → 400
      throw new CaseValidationError(
        'Bu şirkette vaka açmak için proje seçimi zorunludur.',
        { status: 400, code: 'project_required' },
      );
    }
    // Customerless (accountId missing) → force project to null regardless of
    // what frontend may have sent; defense-in-depth alongside the helper
    // throw above.
    const finalAccountProjectId = m.accountId ? (m.accountProjectId ?? null) : null;
    const finalAccountProjectName = m.accountId ? accountProjectName : null;

    // WR-A7b — Product / Package validation + denorm.
    let productInfo = null;
    if (m.productId) {
      productInfo = await loadAndValidateCaseProduct({
        productId: m.productId,
        companyId: m.companyId,
      });
    }
    let packageInfo = null;
    if (m.packageId) {
      packageInfo = await loadAndValidateCasePackage({
        packageId: m.packageId,
        accountId: m.accountId,
        companyId: m.companyId,
      });
    }
    const finalProductId = productInfo ? productInfo.id : null;
    const finalProductName = productInfo ? productInfo.name : null;
    const finalPackageId = packageInfo ? packageInfo.id : null;
    const finalPackageName = packageInfo ? packageInfo.name : null;
    // WR-A7b / DI.3 — Hem product hem package set ise PackageItem üyeliği zorunlu.
    await assertPackageProductCompatible({
      packageId: finalPackageId,
      productId: finalProductId,
    });

    // Person lookup — Codex P2 (PR #104): assignedPersonId verildiğinde
    // hem supportLevel cascade'i hem team cascade'i için tek sefer çekilir.
    // Smart Ticket auto-assign creator (PR #104) sadece personId/Name
    // gönderiyor; takım resolution backend'de yapılır (claim flow ile
    // simetrik). Aksi halde vaka kişiye atanır ama supervisor team
    // KPI/queue'larında görünmez.
    let personInfo = null;
    if (m.assignedPersonId) {
      personInfo = await prisma.person.findUnique({
        where: { id: m.assignedPersonId },
        select: {
          supportLevel: true,
          teamId: true,
          team: { select: { name: true, companyId: true } },
        },
      });
    }

    // assignedTeamId/Name cascade — caller team göndermediyse Person.teamId
    // resolve edilir, ama yalnız Person'un takımı vakanın şirketi ile aynı
    // şirkette ise (Codex P2 PR #105 review). Multi-company kullanıcı başka
    // şirkette Smart Ticket açtığında Person.team başka şirketin takımı
    // olabilir → cross-company assignedTeamId yazarsak supervisor KPI/queue
    // o vakayı görmez. Şirket eşleşmiyorsa team NULL kalır; dispatcher
    // manuel atar.
    const personTeamMatchesCompany =
      !!personInfo?.teamId && personInfo?.team?.companyId === m.companyId;
    const finalAssignedTeamId =
      m.assignedTeamId ?? (personTeamMatchesCompany ? personInfo.teamId : null);
    const finalAssignedTeamName =
      m.assignedTeamName ?? (personTeamMatchesCompany ? personInfo.team?.name ?? null : null);

    // WR-A5 / PM-03 + WR-A7b D-A7BI.7 — supportLevel cascade.
    //   1. patch'te explicit set edildiyse onu kullan (D-A5.2)
    //   2. WR-A7b: productId varsa Product.supportLevel (catalog hint en güvenilir)
    //   3. assignedPersonId varsa Person.supportLevel
    //   4. else finalAssignedTeamId varsa Team.defaultSupportLevel
    //   5. else 'L1'
    let resolvedSupportLevel = m.supportLevel;
    if (!resolvedSupportLevel && productInfo?.supportLevel) {
      resolvedSupportLevel = productInfo.supportLevel;
    }
    if (!resolvedSupportLevel && personInfo?.supportLevel) {
      resolvedSupportLevel = personInfo.supportLevel;
    }
    if (!resolvedSupportLevel && finalAssignedTeamId) {
      const t = await prisma.team.findUnique({
        where: { id: finalAssignedTeamId },
        select: { defaultSupportLevel: true },
      });
      if (t?.defaultSupportLevel) resolvedSupportLevel = t.defaultSupportLevel;
    }
    if (!resolvedSupportLevel) resolvedSupportLevel = 'L1';

    // Phase D Step 2 — Opsiyonel başvuran bilgileri.
    // Hassas alanlar (phone, email) sadece DB'ye yazılır; log/analytics yok.
    const requester = sanitizeRequesterContext({
      customerContactName: m.customerContactName,
      customerContactPhone: m.customerContactPhone,
      customerContactEmail: m.customerContactEmail,
      customerCompanyName: m.customerCompanyName,
    });

    // Smart Ticket self-assign: açan kişinin personId'si varsa vaka İncelemede
    // başlar ve takıma atama bildirimi gitmez.
    const isSmartTicketCreate =
      m.customFields &&
      typeof m.customFields === 'object' &&
      m.customFields.smartTicket &&
      typeof m.customFields.smartTicket === 'object';
    const isSmartTicketSelfAssigned = isSmartTicketCreate && !!m.assignedPersonId;

    // SLA politika çözümleyici — esnek eşleşme (null = wildcard).
    const slaMatch = await resolveSlaPolicy({
      companyId: m.companyId,
      productGroup: m.productGroup ?? null,
      categoryName: m.category ?? null,
      subCategoryName: m.subCategory ?? null,
      requestType: m.requestType ?? null,
      priority: m.priority ?? null,
    });
    const slaCreatedAt = new Date();
    const slaResponseDueAt = slaMatch
      ? new Date(slaCreatedAt.getTime() + slaMatch.responseHours * 3600000)
      : null;
    const slaResolutionDueAt = slaMatch
      ? new Date(slaCreatedAt.getTime() + slaMatch.resolutionHours * 3600000)
      : null;
    const slaResolutionStartedAt = m.assignedPersonId ? slaCreatedAt : null;

    const created = await prisma.case.create({
      data: {
        caseNumber,
        title: m.title,
        description: m.description,
        caseType: m.caseType,
        status: isSmartTicketSelfAssigned ? 'Incelemede' : 'Acik',
        priority: m.priority,
        origin: m.origin,
        originDescription: m.originDescription,
        // Phase D Step 2 — başvuran bilgileri (opsiyonel)
        customerContactName: requester.customerContactName,
        customerContactPhone: requester.customerContactPhone,
        customerContactEmail: requester.customerContactEmail,
        customerCompanyName: requester.customerCompanyName,
        companyId: m.companyId,
        companyName: m.companyName,
        accountId: m.accountId,
        accountName: m.accountName,
        customerMatchPending,
        // WR-A4 — Project link (validated above).
        accountProjectId: finalAccountProjectId,
        accountProjectName: finalAccountProjectName,
        category: m.category,
        subCategory: m.subCategory,
        requestType: m.requestType,
        productGroup: m.productGroup,
        // WR-A7b — Catalog product/package link + snapshot.
        productId: finalProductId,
        productName: finalProductName,
        packageId: finalPackageId,
        packageName: finalPackageName,
        assignedTeamId: finalAssignedTeamId,
        assignedTeamName: finalAssignedTeamName,
        assignedPersonId: m.assignedPersonId,
        assignedPersonName: m.assignedPersonName,
        // Vaka Sahibi — vakayı açan kullanıcı (creator). Atamadan bağımsız,
        // bu alan yalnız create()'te set edilir, claim/atama/devirde değişmez.
        createdByUserId: actor.userId,
        createdByName: actor.displayName,
        // WR-A5 / PM-03 — Cascade person → team → L1.
        supportLevel: resolvedSupportLevel,
        // ProactiveTracking
        financialStatus: m.financialStatus,
        productUsage: m.productUsage,
        usageChangeAlert: m.usageChangeAlert,
        responseLevel: m.responseLevel,
        // Churn
        cancellationRequest: m.cancellationRequest,
        offeredSolutions: m.offeredSolutions ?? undefined,
        offerExpiryDate: m.offerExpiryDate ? new Date(m.offerExpiryDate) : undefined,
        offerOutcome: m.offerOutcome,
        offerRejectionReason: m.offerRejectionReason,
        actionTaken: m.actionTaken,
        followUpDate: m.followUpDate ? new Date(m.followUpDate) : undefined,
        // AI
        aiGeneratedFlag: m.aiGeneratedFlag ?? false,
        aiCategoryPrediction: m.aiCategoryPrediction,
        aiPriorityPrediction: m.aiPriorityPrediction,
        aiConfidenceScore: m.aiConfidenceScore,
        aiRejectReason: m.aiRejectReason,
        // Custom Fields (şirket FieldDefinition'larına göre dinamik)
        customFields: m.customFields ?? undefined,
        // SLA — politika çözümleyiciden
        slaResponseDueAt,
        slaResolutionDueAt,
        slaResolutionStartedAt,
        // Açılış log'u — Smart Ticket akışıyla açıldıysa note alanına suffix
        // konur. L2 personası Activity tab'da vakanın Smart Ticket'tan
        // geldiğini ayırt edebilsin.
        history: {
          create: {
            companyId: m.companyId,
            action: 'Vaka oluşturuldu',
            actionType: 'CaseCreated',
            // PR-1 — server-authoritative: body.createdBy YUTULUR; actor
            // route'tan req.user ile geliyor (caller asla null bırakmaz).
            actor: actor.displayName,
            actorUserId: actorUserIdOf(actor), // PR-5
            note:
              m.customFields &&
              typeof m.customFields === 'object' &&
              m.customFields.smartTicket &&
              typeof m.customFields.smartTicket === 'object'
                ? 'Smart Ticket akışıyla açıldı'
                : undefined,
          },
        },
      },
      include: CASE_INCLUDE,
    });

    if (!isSmartTicketSelfAssigned) {
      await notifyAssignmentTargets({
        caseId: created.id,
        companyId: created.companyId,
        assignedPersonId: created.assignedPersonId,
        assignedTeamId: created.assignedTeamId,
        actorUserId: actorUserIdOf(actor),
        message: `${created.caseNumber} oluşturuldu ve atandı.`,
        eventType: 'watcher_update',
        kind: 'assignment',
      });
    }

    // M4.1 FAZ B — case_created event emission BURADA YAPILMIYOR.
    //
    // Codex P1 fix — emit'i inboundMailIntake.js'e taşıdık (account
    // match BİTTİKTEN sonra). Sebep:
    //   - inboundMailIntake önce caseRepository.create() ile accountId=null
    //     ham vaka yaratır, SONRA customerMatch + linkAccount yapar.
    //   - Emit burada fire etseydi: accountId henüz set edilmemiş →
    //     requester resolver opt-out kontrolünü skip ederdi → opt-out olan
    //     müşteriye ACK gönderilirdi (cross-tenant bypass tarzı kırılım).
    //   - intake match sonrası emit → resolver caseRow'u re-fetch eder
    //     (notificationRepository:1140) → accountId set'liyse opt-out
    //     gate uygulanır.
    //
    // UI/portal/API açılışlarında ACK semantiği yok (kullanıcı UI teyit
    // görür); intake olmayan path'lerde emit zaten beklenmiyor.

    return shape(created);
  },

  async update(id, patch, actor, allowedCompanyIds, actorRole, actorPersonId = null, actorObject = null) {
    // PR-5 follow-up (Codex P2) — actorObject opsiyonel; varsa actorUserId
    // stamp atılır (post-migration audit FK doldurulur). Caller pass
    // etmezse NULL kalır (legacy davranış — backwards-compat).
    assertActor(actor, 'caseRepository.update');
    // PR-SD (Codex P1) — Arşiv alanları generic PATCH ile YAZILAMAZ. SystemAdmin
    // bile generic update üzerinden arşivleyemez; tek doğru yol POST /:id/archive
    // ve /:id/restore (rol guard + audit + idempotency garantili). Bu guard
    // olmadan herhangi bir authenticated user vakayı arşivleyebilirdi.
    const ARCHIVE_FIELDS = ['isArchived', 'archivedAt', 'archivedByUserId', 'archiveReason'];
    for (const field of ARCHIVE_FIELDS) {
      if (field in patch) {
        throw new CaseValidationError(
          `Arşiv alanı (${field}) generic PATCH ile değiştirilemez. ` +
            'POST /api/cases/:id/archive veya /:id/restore kullanılmalı.',
          { status: 400, code: 'archive_field_immutable' },
        );
      }
    }
    // WR-A5 / PM-03 — D-A5.1: Case.supportLevel patch sadece Supervisor/CSM/
    // Admin/SystemAdmin. Agent/Backoffice yetkisi yok — 403'e map'lenir.
    if ('supportLevel' in patch && actorRole) {
      const SUPPORT_LEVEL_ROLES = new Set(['Supervisor', 'CSM', 'Admin', 'SystemAdmin']);
      if (!SUPPORT_LEVEL_ROLES.has(actorRole)) {
        throw new CaseValidationError(
          'Destek seviyesini değiştirme yetkin yok.',
          { status: 403, code: 'support_level_forbidden' },
        );
      }
    }

    // WR-A7b / D-A7BI.5 — Role gates for productId / packageId patch.
    //   - productId: Supervisor / CSM / Admin / SystemAdmin (Agent değiştiremez)
    //   - packageId: Supervisor / Admin / SystemAdmin (CSM dahil değil; contract bağlama yetkisi)
    if ('productId' in patch && actorRole) {
      const PRODUCT_ROLES = new Set(['Supervisor', 'CSM', 'Admin', 'SystemAdmin']);
      if (!PRODUCT_ROLES.has(actorRole)) {
        throw new CaseValidationError(
          'Ürün alanını değiştirme yetkin yok.',
          { status: 403, code: 'product_forbidden' },
        );
      }
    }
    if ('packageId' in patch && actorRole) {
      const PACKAGE_ROLES = new Set(['Supervisor', 'Admin', 'SystemAdmin']);
      if (!PACKAGE_ROLES.has(actorRole)) {
        throw new CaseValidationError(
          'Paket alanını değiştirme yetkin yok.',
          { status: 403, code: 'package_forbidden' },
        );
      }
    }

    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
    // Otomatik alan değişim log'u: değişen her alan için CaseActivity entry'si
    const before = await prisma.case.findUnique({ where: { id } });
    if (!before) return null;

    // Eskalasyon seviyesi yalnızca vaka "Eskalasyon" statüsündeyken değiştirilebilir.
    if ('escalationLevel' in patch && before.status !== 'Eskalasyon') {
      throw new CaseValidationError(
        'Eskalasyon seviyesi yalnızca vaka "Eskalasyon" statüsündeyken değiştirilebilir.',
        { status: 400, code: 'escalation_level_immutable' },
      );
    }

    // Vaka adı (title) edit guard'ı — yetki + statü + length.
    //   Yetki: assignedPersonId === actorPersonId  OR  role ∈ Supervisor/Admin/SystemAdmin
    //   Statü: sadece açık vakalarda (Cozuldu/IptalEdildi'de yasak)
    //   Length: trim + boş yasak + max 200
    if ('title' in patch) {
      const rawTitle = patch.title;
      if (typeof rawTitle !== 'string') {
        throw new CaseValidationError(
          'Vaka adı geçerli bir metin olmalı.',
          { status: 400, code: 'title_invalid' },
        );
      }
      const trimmed = rawTitle.trim();
      if (trimmed.length === 0) {
        throw new CaseValidationError(
          'Vaka adı boş olamaz.',
          { status: 400, code: 'title_empty' },
        );
      }
      if (trimmed.length > 200) {
        throw new CaseValidationError(
          'Vaka adı en fazla 200 karakter olabilir.',
          { status: 400, code: 'title_too_long' },
        );
      }
      const CLOSED_STATUSES = new Set(['Cozuldu', 'IptalEdildi']);
      if (CLOSED_STATUSES.has(before.status)) {
        throw new CaseValidationError(
          'Kapanmış vakanın adı değiştirilemez.',
          { status: 403, code: 'title_case_closed' },
        );
      }
      const TITLE_EDIT_ROLES = new Set(['Supervisor', 'Admin', 'SystemAdmin']);
      const hasRolePermission = actorRole && TITLE_EDIT_ROLES.has(actorRole);
      const hasOwnership =
        actorPersonId && before.assignedPersonId && before.assignedPersonId === actorPersonId;
      if (!hasRolePermission && !hasOwnership) {
        throw new CaseValidationError(
          'Vaka adını değiştirme yetkin yok.',
          { status: 403, code: 'title_forbidden' },
        );
      }
      patch.title = trimmed;
    }

    // Frontend TR string'leri → ASCII identifier
    const dbPatch = toDb(patch);
    // History log frontend ile aynı (TR) görünsün — patch'i orijinal haliyle logla
    const historyEntries = [];
    for (const [field, newVal] of Object.entries(patch)) {
      const oldVal = before[field];
      if (oldVal === dbPatch[field]) continue; // db karşılığı eşitse skip
      if (oldVal == null && newVal == null) continue;
      historyEntries.push({
        companyId,
        action: 'Alan güncellendi',
        actionType: 'FieldUpdate',
        fieldName: field,
        // Log'larda TR string görünsün; ihtiyaç varsa frontend ek format yapar
        fromValue: oldVal == null ? null : String(oldVal),
        toValue: newVal == null ? null : String(newVal),
        actor,
        actorUserId: actorUserIdOf(actorObject), // PR-5 follow-up
      });
    }

    // Phase D — customerMatchPending lifecycle:
    //   patch içinde accountId alanı geliyorsa pending flag'i otomatik toggle et.
    //   accountId set ediliyor → pending=false; accountId clear ediliyor → pending=true.
    //   (Update path'inde companyId değiştirilmediği için requireCustomer kontrolüne
    //    gerek yok; create + link-account endpoint'lerinde zaten enforce ediliyor.)
    const lifecyclePatch = {};
    if ('accountId' in patch) {
      lifecyclePatch.customerMatchPending = patch.accountId == null;
    }

    // WR-A4 — AccountProject ↔ accountId integrity matrix for PATCH.
    //
    // Invariant: a Case may carry an accountProjectId only when its accountId
    // is set AND the project's AccountCompany belongs to that account in the
    // same companyId. Bug fix: prior code only validated when the patch
    // explicitly touched accountProjectId, allowing an accountId change to
    // orphan the existing project link.
    //
    // Effective values: companyId never changes via PATCH (multi-tenant
    // guarantee); effectiveAccountId is the value after the patch lands.
    const accountIdInPatch = 'accountId' in patch;
    const projectIdInPatch = 'accountProjectId' in patch;
    const effectiveAccountId = accountIdInPatch ? patch.accountId : before.accountId;
    const effectiveCompanyId = companyId;

    if (projectIdInPatch) {
      // Frontend explicitly set/cleared the project.
      const requestedProjectId = patch.accountProjectId;
      if (requestedProjectId == null || requestedProjectId === '') {
        lifecyclePatch.accountProjectId = null;
        lifecyclePatch.accountProjectName = null;
      } else {
        const project = await loadAndValidateProject({
          projectId: requestedProjectId,
          accountId: effectiveAccountId,
          companyId: effectiveCompanyId,
        });
        lifecyclePatch.accountProjectId = project.id;
        lifecyclePatch.accountProjectName = project.name;
      }
    } else if (accountIdInPatch) {
      // Account changed but project not explicitly set.
      // If account cleared or changed to a different one → clear orphaned
      // project link. Same account (re-sent with same value) → keep project.
      const accountCleared = patch.accountId == null;
      const accountChanged = !accountCleared && patch.accountId !== before.accountId;
      if (accountCleared || accountChanged) {
        if (before.accountProjectId != null) {
          lifecyclePatch.accountProjectId = null;
          lifecyclePatch.accountProjectName = null;
        }
      }
    }
    // Neither accountId nor accountProjectId in patch → existing project link
    // is preserved by the absence of any lifecyclePatch entry.

    // WR-A7b / DI.6 — Product / Package lifecycle on PATCH.
    //
    //  - productId explicit set → validate Product (company match), refresh productName snapshot.
    //  - productId explicit clear → productName null.
    //  - packageId explicit set → validate Package + AccountCompany match (DI.3/4/5);
    //    refresh packageName snapshot.
    //  - packageId explicit clear → packageName null.
    //  - accountId cleared/changed AND packageId not in patch → auto-clear packageId/Name
    //    (D-A7BI.2: packageId binds to accountId; productId remains untouched).
    const productIdInPatch = 'productId' in patch;
    const packageIdInPatch = 'packageId' in patch;

    if (productIdInPatch) {
      const requestedProductId = patch.productId;
      if (requestedProductId == null || requestedProductId === '') {
        lifecyclePatch.productId = null;
        lifecyclePatch.productName = null;
      } else {
        const product = await loadAndValidateCaseProduct({
          productId: requestedProductId,
          companyId: effectiveCompanyId,
        });
        lifecyclePatch.productId = product.id;
        lifecyclePatch.productName = product.name;
      }
    }

    if (packageIdInPatch) {
      const requestedPackageId = patch.packageId;
      if (requestedPackageId == null || requestedPackageId === '') {
        lifecyclePatch.packageId = null;
        lifecyclePatch.packageName = null;
      } else {
        const pkg = await loadAndValidateCasePackage({
          packageId: requestedPackageId,
          accountId: effectiveAccountId,
          companyId: effectiveCompanyId,
        });
        lifecyclePatch.packageId = pkg.id;
        lifecyclePatch.packageName = pkg.name;
      }
    } else if (accountIdInPatch) {
      // D-A7BI.2 — accountId cleared or changed → packageId/packageName clear.
      //                                           productId remains (catalog ref).
      const accountCleared = patch.accountId == null;
      const accountChanged = !accountCleared && patch.accountId !== before.accountId;
      if (accountCleared || accountChanged) {
        if (before.packageId != null) {
          lifecyclePatch.packageId = null;
          lifecyclePatch.packageName = null;
        }
      }
    }

    // WR-A7b / DI.3 — Effective (productId, packageId) çiftinde her ikisi de set ise
    // PackageItem üyeliği zorunlu. lifecyclePatch'i öncelikli al; sonra patch; sonra before.
    const effectiveProductId = Object.prototype.hasOwnProperty.call(lifecyclePatch, 'productId')
      ? lifecyclePatch.productId
      : productIdInPatch
        ? patch.productId
        : before.productId;
    const effectivePackageId = Object.prototype.hasOwnProperty.call(lifecyclePatch, 'packageId')
      ? lifecyclePatch.packageId
      : packageIdInPatch
        ? patch.packageId
        : before.packageId;
    if (effectiveProductId && effectivePackageId) {
      await assertPackageProductCompatible({
        packageId: effectivePackageId,
        productId: effectiveProductId,
      });
    }

    const updated = await prisma.case.update({
      where: { id },
      data: {
        ...dbPatch,
        ...lifecyclePatch,
        history: historyEntries.length > 0 ? { create: historyEntries } : undefined,
      },
      include: CASE_INCLUDE,
    });

    // FAZ 2 Collab — atama veya öncelik değişikliklerinde watcher'lara bildirim.
    // Status değişimi transitionStatus() üzerinden ayrı olarak fire eder.
    const watcherTriggers = ['assignedPersonId', 'assignedTeamId', 'assignedPersonName', 'assignedTeamName', 'priority'];
    const changedKey = historyEntries.find((h) => watcherTriggers.includes(h.fieldName ?? ''));
    if (changedKey) {
      const kind = changedKey.fieldName === 'priority' ? 'priority' : 'assignment';
      const label = changedKey.fieldName === 'priority' ? 'Öncelik' : 'Atama';
      await notifyWatchers({
        caseId: id,
        companyId,
        message: `${updated.caseNumber}'de ${label.toLowerCase()} değişti: ${changedKey.fromValue ?? '-'} → ${changedKey.toValue ?? '-'}`,
        kind,
      });
    }

    const assignmentChanged = historyEntries.some((h) =>
      ['assignedPersonId', 'assignedTeamId', 'assignedPersonName', 'assignedTeamName'].includes(h.fieldName ?? ''),
    );
    if (assignmentChanged) {
      await notifyAssignmentTargets({
        caseId: id,
        companyId,
        assignedPersonId: updated.assignedPersonId,
        assignedTeamId: updated.assignedTeamId,
        actorUserId: actorUserIdOf(actorObject),
        message: `${updated.caseNumber}'de atama değişti.`,
        eventType: 'watcher_update',
        kind: 'assignment',
      });
    }

    return shape(updated);
  },

  /**
   * WR-C1 / PM-07 — POST /api/cases/:id/claim ("Üstlen")
   *
   * Atanmamış açık bir vakayı çağıran kullanıcıya atomik olarak atar. Race
   * koşulları `updateMany` WHERE filter'ı ile kapatılır: iki kullanıcı eş
   * zamanlı claim'lerse Postgres ilkini başarıyla kaydeder, ikincide
   * `count: 0` döner → 409.
   *
   * Kurallar:
   *  - Case kullanıcının scope'unda olmalı (assertCaseInScope → 403 / 404).
   *  - Case status terminal olamaz: Cozuldu, IptalEdildi → 400.
   *  - Case.assignedPersonId NULL olmalı; aksi halde 409.
   *  - User.personId NULL ise (SystemAdmin gibi) 400 — atanabilir Person yok.
   *  - Atomik update: `updateMany` WHERE assignedPersonId IS NULL AND
   *    status NOT IN terminal. Affected row count = 0 → 409.
   *  - On success: assignedPersonId/Name, assignedTeamId (varsa) güncellenir;
   *    CaseActivity (actionType=FieldUpdate, "Vaka üstlenildi: {fullName}") oluşur;
   *    watcher'lara assignment notification yollanır (mevcut pattern).
   */
  async claim({ caseId, user }) {
    const allowed = Array.isArray(user?.allowedCompanyIds) ? user.allowedCompanyIds : [];
    const companyId = await assertCaseInScope(caseId, allowed);
    if (!companyId) return null; // route 404'e çevirir

    if (!user?.personId) {
      throw new CaseValidationError(
        'Bu hesap claim yapamaz (atanabilir Person kaydı yok).',
        { status: 400, code: 'no_person_record' },
      );
    }

    // Ön check — closed mu, zaten atanmış mı? Atomik update zaten kapsar
    // ama explicit 400 vs 409 ayrımı için ön bakış.
    const current = await prisma.case.findUnique({
      where: { id: caseId },
      select: { status: true, assignedPersonId: true, companyId: true, slaResolutionStartedAt: true },
    });
    if (!current) return null;
    if (current.status === 'Cozuldu' || current.status === 'IptalEdildi') {
      throw new CaseValidationError('Kapalı vaka üstlenilemez.', {
        status: 400,
        code: 'case_closed',
      });
    }
    if (current.assignedPersonId) {
      throw new CaseValidationError(
        'Bu vaka başka bir kullanıcı tarafından üstlenilmiş olabilir.',
        { status: 409, code: 'already_assigned' },
      );
    }

    const person = await prisma.person.findUnique({
      where: { id: user.personId },
      select: { name: true, teamId: true, team: { select: { name: true } } },
    });
    if (!person) {
      throw new CaseValidationError('Person kaydı bulunamadı.', {
        status: 400,
        code: 'person_not_found',
      });
    }

    const assignedPersonName = person.name ?? user.fullName ?? user.personId;
    const assignedTeamId = person.teamId ?? null;
    const assignedTeamName = person.team?.name ?? null;

    // Atomic — race-safe.
    const claimNow = new Date();
    const result = await prisma.case.updateMany({
      where: {
        id: caseId,
        assignedPersonId: null,
        status: { notIn: ['Cozuldu', 'IptalEdildi'] },
      },
      data: {
        assignedPersonId: user.personId,
        assignedPersonName,
        ...(assignedTeamId
          ? { assignedTeamId, assignedTeamName }
          : {}),
        // İlk üstlenme → çözüm SLA saati başlar (daha önce set edilmemişse).
        // updateMany koşulda slaResolutionStartedAt: null filtresi eklenemez —
        // findUnique'teki current.slaResolutionStartedAt NULL ise set et.
        ...(current.slaResolutionStartedAt === null ? { slaResolutionStartedAt: claimNow } : {}),
        updatedAt: claimNow,
      },
    });

    if (result.count === 0) {
      // Başka kullanıcı arada üstlendi veya status değişti.
      throw new CaseValidationError(
        'Bu vaka başka bir kullanıcı tarafından üstlenilmiş olabilir.',
        { status: 409, code: 'claim_race_lost' },
      );
    }

    // Audit log — başarılı claim sonrası.
    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: `Vaka üstlenildi: ${assignedPersonName}`,
        actionType: 'FieldUpdate',
        fieldName: 'assignedPersonId',
        fromValue: null,
        toValue: user.personId,
        actor: user.fullName ?? assignedPersonName,
        actorUserId: typeof user?.id === 'string' ? user.id : null, // PR-5
      },
    });

    // Watcher bildirimi — mevcut update path ile aynı pattern.
    await notifyWatchers({
      caseId,
      companyId,
      message: `Vaka üstlenildi: ${assignedPersonName}`,
      kind: 'assignment',
    });

    await notifyAssignmentTargets({
      caseId,
      companyId,
      assignedPersonId: user.personId,
      assignedTeamId,
      actorUserId: typeof user?.id === 'string' ? user.id : null,
      message: `Vaka üstlenildi: ${assignedPersonName}`,
      eventType: 'watcher_update',
      kind: 'assignment',
    });

    const updated = await prisma.case.findUnique({
      where: { id: caseId },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  /**
   * PR-SD — Vakayı arşivle (SystemAdmin-only). Hard delete YOK; tüm child
   * kayıtlar intact, sadece UI listelerinden default exclude'la gizlenir.
   * Status enum dokunulmaz — archive orthogonal bayrak. Reason zorunlu
   * (route layer 3+ char validate eder; defansif olarak burada da kontrol).
   *
   * Audit: CaseActivity actionType='Archived', note=reason, actor.
   * Watcher bildirimi YOK (operasyonel olmayan event).
   */
  async archive(id, { reason, actor, allowedCompanyIds }) {
    assertActor(actor, 'caseRepository.archive');
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (trimmedReason.length < 3) {
      throw new CaseValidationError(
        'Arşiv sebebi gerekli (en az 3 karakter).',
        { status: 400, code: 'archive_reason_required' },
      );
    }
    // allowArchived: true — assertCaseInScope arşivli case'leri throw eder
    // (Codex P2 write guard), ama archive() kendisi idempotent: zaten arşivli
    // case'i tekrar arşivlemek throw değil, current state döndürmek demek.
    const companyId = await assertCaseInScope(id, allowedCompanyIds, { allowArchived: true });
    if (!companyId) return null;

    const before = await prisma.case.findUnique({
      where: { id },
      select: { isArchived: true },
    });
    if (!before) return null;
    if (before.isArchived) {
      // Idempotent: zaten arşivli — current state'i döndür (UI'da double-click
      // edilirse 409 yerine sessizce success).
      const current = await prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE });
      return shape(current);
    }

    await prisma.$transaction([
      prisma.case.update({
        where: { id },
        data: {
          isArchived: true,
          archivedAt: new Date(),
          archivedByUserId: actor.userId ?? null,
          archiveReason: trimmedReason,
        },
      }),
      prisma.caseActivity.create({
        data: {
          caseId: id,
          companyId,
          actionType: 'Archived',
          action: 'Vaka arşivlendi',
          actor: actor.displayName,
          actorUserId: actor.userId ?? null,
          note: trimmedReason,
          at: new Date(),
        },
      }),
    ]);

    const updated = await prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE });
    return shape(updated);
  },

  /**
   * PR-SD — Arşivli vakayı geri yükle (SystemAdmin-only). Status enum
   * dokunulmaz. Audit: CaseActivity actionType='Restored', actor.
   */
  async restore(id, { actor, allowedCompanyIds }) {
    assertActor(actor, 'caseRepository.restore');
    // allowArchived: true — restore zaten arşivli case'i çevirmek için var.
    const companyId = await assertCaseInScope(id, allowedCompanyIds, { allowArchived: true });
    if (!companyId) return null;

    const before = await prisma.case.findUnique({
      where: { id },
      select: { isArchived: true },
    });
    if (!before) return null;
    if (!before.isArchived) {
      // Idempotent: zaten arşivli değil.
      const current = await prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE });
      return shape(current);
    }

    await prisma.$transaction([
      prisma.case.update({
        where: { id },
        data: {
          isArchived: false,
          archivedAt: null,
          archivedByUserId: null,
          archiveReason: null,
        },
      }),
      prisma.caseActivity.create({
        data: {
          caseId: id,
          companyId,
          actionType: 'Restored',
          action: 'Vaka arşivden çıkarıldı',
          actor: actor.displayName,
          actorUserId: actor.userId ?? null,
          at: new Date(),
        },
      }),
    ]);

    const updated = await prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE });
    return shape(updated);
  },

  /**
   * PR-D2 — Azure DevOps / TFS work item bağla.
   *
   * Saklama: Case.customFields.devops = Array<DevopsLinkEntry>.
   * Her entry SADECE devopsClient.normalizeWorkItem çıktısının 16 allowlist
   * alanı + bağlama meta'sı (linkedAt, linkedBy{Id,Name}, lastSyncedAt) içerir.
   * Description/ReproSteps/History HİÇBİR YERDE saklanmaz (devopsClient
   * allowlist guard'ı zaten engeller).
   *
   * Davranış:
   *  - workItemRef (id veya TFS URL) → numeric id'ye parse
   *  - devopsClient.getWorkItem(id) ile canlı doğrula
   *  - aynı id zaten array'de varsa idempotent: mevcut hali döndür (yeniden ekleme yok)
   *  - değilse normalize snapshot + meta'yı array'e push
   *  - CaseActivity: 'DevopsLinked' (note = `#<id> bağlandı: <title>`)
   *
   * Arşivli vaka guard'ı: assertCaseInScope (write semantiği) otomatik
   * 409 case_archived_readonly döner — arşivli vakaya link atılamaz.
   */
  async linkDevops(caseId, { workItemRef, actor, allowedCompanyIds }) {
    assertActor(actor, 'caseRepository.linkDevops');
    const workItemId = parseWorkItemId(workItemRef);
    if (!workItemId) {
      throw new CaseValidationError(
        'Geçerli bir work item id veya TFS URL gerekli.',
        { status: 400, code: 'devops_workitem_ref_invalid' },
      );
    }
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    // TFS'ten canlı çek + normalize (allowlist guard devopsClient'ta).
    // Fix 1 + Fix 2: request-level allowlist (?fields=) + race-safe write
    // helper'ı. Önce dedup için pre-check yaparız (TFS çağrısını boşa
    // harcamamak için), sonra atomic mutate içinde tekrar dedup
    // (race-safe).
    const fresh = await prisma.case.findUnique({
      where: { id: caseId },
      select: { customFields: true },
    });
    if (!fresh) return null;
    const existingArr = readDevopsArray(fresh.customFields);
    if (existingArr.some((entry) => entry?.id === workItemId)) {
      // Idempotent: zaten bağlı, güncel state'i döndür.
      const c = await prisma.case.findUnique({ where: { id: caseId }, include: CASE_INCLUDE });
      return shape(c);
    }

    // Faz 2.1 — per-tenant config (DB-first, env fallback). companyId
    // assertCaseInScope tarafından döndürüldü.
    const tfs = await devopsClient.getWorkItem(workItemId, { companyId });
    if (!tfs.ok) {
      const status = tfs.error.code === 'tfs_not_found' ? 404
        : tfs.error.code === 'tfs_auth_error' ? 502
          : tfs.error.code === 'tfs_integration_disabled' ? 503
            : tfs.error.status ?? 502;
      throw new CaseValidationError(
        tfs.error.message,
        { status, code: tfs.error.code },
      );
    }
    const snapshot = tfs.data.normalized;
    if (!snapshot || !snapshot.id) {
      throw new CaseValidationError(
        'TFS work item normalize edilemedi.',
        { status: 502, code: 'devops_normalize_failed' },
      );
    }

    const now = new Date().toISOString();
    const entry = {
      ...snapshot,                       // 16 allowlist alanı + url + id
      linkedAt: now,
      linkedByUserId: actor.userId ?? null,
      linkedByUserName: actor.displayName,
      lastSyncedAt: now,
    };

    // Fix 2 — atomic mutate (race-safe). Helper içinde dedup tekrar
    // kontrol edilir: concurrent link gelirse op='noop' veya
    // updateMany count=0 → retry.
    const mutateResult = await atomicMutateDevopsArray(caseId, (arr) => {
      if (arr.some((e) => e?.id === workItemId)) {
        return { nextArr: arr, op: 'noop' };
      }
      return { nextArr: [...arr, entry], op: 'append', target: entry };
    });
    if (!mutateResult) return null;

    // Activity log — sadece gerçek append durumunda (noop = zaten bağlıydı).
    if (mutateResult.op === 'append') {
      const noteText = `#${workItemId} bağlandı${snapshot.title ? `: ${snapshot.title}` : ''}`;
      await prisma.caseActivity.create({
        data: {
          caseId,
          companyId,
          actionType: 'DevopsLinked',
          action: 'DevOps work item bağlandı',
          actor: actor.displayName,
          actorUserId: actor.userId ?? null,
          note: noteText,
          at: new Date(),
        },
      });
    }

    const updated = await prisma.case.findUnique({ where: { id: caseId }, include: CASE_INCLUDE });
    return shape(updated);
  },

  /**
   * PR-D2 — Bağlı DevOps work item'ı kaldır (array'den çıkar).
   *
   * Idempotent: aranan id array'de yoksa mevcut state'i döndürür (silent).
   * CaseActivity 'DevopsUnlinked' kayıt atar.
   * Arşivli vaka guard'ı assertCaseInScope ile otomatik 409.
   */
  async unlinkDevops(caseId, { workItemId, actor, allowedCompanyIds }) {
    assertActor(actor, 'caseRepository.unlinkDevops');
    const id = parseWorkItemId(workItemId);
    if (!id) {
      throw new CaseValidationError(
        'Geçerli bir work item id gerekli.',
        { status: 400, code: 'devops_workitem_id_invalid' },
      );
    }
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    // Fix 2 — atomic mutate (race-safe).
    const mutateResult = await atomicMutateDevopsArray(caseId, (arr) => {
      const target = arr.find((entry) => entry?.id === id);
      if (!target) {
        return { nextArr: arr, op: 'noop' };
      }
      return {
        nextArr: arr.filter((entry) => entry?.id !== id),
        op: 'remove',
        target,
      };
    });
    if (!mutateResult) return null;

    if (mutateResult.op === 'remove') {
      const noteText = `#${id} kaldırıldı${mutateResult.target?.title ? `: ${mutateResult.target.title}` : ''}`;
      await prisma.caseActivity.create({
        data: {
          caseId,
          companyId,
          actionType: 'DevopsUnlinked',
          action: 'DevOps work item kaldırıldı',
          actor: actor.displayName,
          actorUserId: actor.userId ?? null,
          note: noteText,
          at: new Date(),
        },
      });
    }

    const updated = await prisma.case.findUnique({ where: { id: caseId }, include: CASE_INCLUDE });
    return shape(updated);
  },

  /**
   * PR-D2 — Bağlı DevOps work item'larının CANLI değerlerini çek.
   *
   * customFields.devops array'indeki id'leri batch ile TFS'ten sorgular.
   * TFS erişilemezse saklı snapshot'a düşer (fallback) + her item'a stale
   * meta'sı ekler.
   *
   * Read endpoint olduğu için assertCaseInScopeForRead (SystemAdmin arşivli
   * case için 200; diğer roller arşivli case'te 404 — soft-archive guard
   * otomatik).
   *
   * Dönen:
   *   { items: Array<entry>, stale: boolean, error?: { code, message } }
   *   stale=true → TFS down, snapshot fallback gösteriliyor.
   */
  async listDevopsLive(caseId, allowedCompanyIds, actorRole) {
    const companyId = await assertCaseInScopeForRead(caseId, allowedCompanyIds, actorRole);
    if (!companyId) return null;

    const fresh = await prisma.case.findUnique({
      where: { id: caseId },
      select: { customFields: true },
    });
    if (!fresh) return null;
    const stored = readDevopsArray(fresh.customFields);
    if (stored.length === 0) {
      return { items: [], stale: false };
    }

    const ids = stored.map((e) => e?.id).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) {
      return { items: [], stale: false };
    }

    // Fix 3 (Codex P2 pre-main) — Chunk batch fetch + try/catch fallback.
    //   - TFS REST batch limiti 200; biz 100 chunk'larız (güvenli marj).
    //   - Tüm chunk'ları paralel çek (Promise.all).
    //   - Herhangi BİR chunk fail → tüm response stale fallback (snapshot
    //     döner, _stale:true her item'da, error meta'sı).
    //   - Hiçbir senaryoda 500 atılmaz — try/catch tüm live path'i sarar.
    const DEVOPS_LIVE_CHUNK = 100;
    let liveList = [];
    let stale = false;
    let liveError = null;
    try {
      const chunks = [];
      for (let i = 0; i < ids.length; i += DEVOPS_LIVE_CHUNK) {
        chunks.push(ids.slice(i, i + DEVOPS_LIVE_CHUNK));
      }
      // Faz 2.1 — per-tenant config (DB-first, env fallback).
      const results = await Promise.all(
        chunks.map((c) => devopsClient.getWorkItems(c, { companyId })),
      );
      const firstFail = results.find((r) => !r.ok);
      if (firstFail) {
        stale = true;
        liveError = { code: firstFail.error.code, message: firstFail.error.message };
      } else {
        liveList = results.flatMap((r) => (Array.isArray(r.data?.normalized) ? r.data.normalized : []));
      }
    } catch (err) {
      // Bilinmeyen runtime hata (devopsClient throw, fetch internal vs.)
      // — snapshot fallback'a düş, 500 yansıtma.
      stale = true;
      liveError = {
        code: 'devops_live_unexpected_error',
        message: err?.message ?? 'DevOps canlı çek başarısız.',
      };
    }

    if (stale) {
      return {
        items: stored.map((entry) => ({ ...entry, _stale: true })),
        stale: true,
        error: liveError ?? { code: 'devops_live_unknown', message: 'TFS canlı çek başarısız.' },
      };
    }

    const liveById = new Map(liveList.map((n) => [n.id, n]));
    const now = new Date().toISOString();
    // Live ile snapshot meta'sını birleştir: live alanları + linked* + lastSyncedAt
    const items = stored.map((entry) => {
      const live = liveById.get(entry?.id);
      if (live) {
        return {
          ...live,                       // 16 allowlist alanı (canlı)
          linkedAt: entry?.linkedAt ?? null,
          linkedByUserId: entry?.linkedByUserId ?? null,
          linkedByUserName: entry?.linkedByUserName ?? null,
          lastSyncedAt: now,
        };
      }
      // Live çağrı 200 döndü ama bu id batch response'da yok (TFS rare):
      // snapshot'a düş + stale.
      return { ...entry, _stale: true };
    });
    return { items, stale: false };
  },

  /**
   * Phase D — PATCH /api/cases/:id/link-account
   *
   * Müşterisiz açılmış (customerMatchPending=true) bir vakaya Supervisor/Admin
   * eşleştirmesi. Geri uyumluluk için müşterili vakalarda da çağrılabilir.
   *
   * Kurallar:
   *  - Vaka kullanıcının scope'unda olmalı (assertCaseInScope).
   *  - Account kullanıcının allowedCompanyIds'inde görünür olmalı.
   *  - Account vakanın companyId'sine bağlanmış olmalı:
   *      AccountCompany.companyId === case.companyId
   *      OR legacy Account.companyId === case.companyId
   *      OR legacy shared Account.companyId IS NULL
   *  - Update: Case.accountId + Case.accountName + customerMatchPending=false
   *  - Audit: CaseActivity "Müşteri eşleştirildi: {accountName}"
   */
  async linkAccount(caseId, accountId, actor, allowedCompanyIds, opts = {}) {
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        name: true,
        companyId: true,
        companies: { select: { companyId: true } },
      },
    });
    if (!account) {
      throw new CaseValidationError('Müşteri bulunamadı.', { status: 404, code: 'account_not_found' });
    }

    const allowed = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
    // Account kullanıcının scope'unda görünür mü?
    const visibleToUser =
      account.companies.some((c) => allowed.includes(c.companyId)) ||
      (account.companyId && allowed.includes(account.companyId)) ||
      account.companyId === null;
    if (!visibleToUser) {
      throw new CaseAccessError('Bu müşteriye erişim yetkin yok.');
    }

    // Account vakanın companyId'sine bağlı mı?
    const linkable =
      account.companies.some((c) => c.companyId === companyId) ||
      account.companyId === companyId ||
      account.companyId === null;
    if (!linkable) {
      throw new CaseValidationError(
        'Bu müşteri vakanın şirketine bağlı değil.',
        { status: 400, code: 'company_mismatch' },
      );
    }

    const before = await prisma.case.findUnique({
      where: { id: caseId },
      select: { accountName: true },
    });

    const updated = await prisma.case.update({
      where: { id: caseId },
      data: {
        accountId: account.id,
        accountName: account.name,
        customerMatchPending: false,
        history: {
          create: {
            companyId,
            action: `Müşteri eşleştirildi: ${account.name}`,
            actionType: 'FieldUpdate',
            fieldName: 'accountId',
            fromValue: before?.accountName ?? null,
            toValue: account.name,
            actor,
          },
        },
      },
      include: CASE_INCLUDE,
    });

    // M2.3 — Manuel link sonrası öğrenme.
    // YALNIZ source='manual' VE case.origin='Eposta' VE customerContactEmail
    // doluysa öğren. Intake'in auto-link çağrısı opts.source='auto' geçer →
    // öğrenmez (zaten exact email match'le tetiklendi, redundant).
    // Hata kapsanır: öğrenme fail olursa linkAccount başarısı bozulmaz.
    if (opts.source === 'manual') {
      try {
        const caseRow = await prisma.case.findUnique({
          where: { id: caseId },
          select: { origin: true, customerContactEmail: true },
        });
        if (caseRow?.origin === 'Eposta' && caseRow.customerContactEmail) {
          const { learnedSenderAccountRepo } = await import('./learnedSenderAccountRepository.js');
          await learnedSenderAccountRepo.upsert(
            companyId,
            caseRow.customerContactEmail,
            account.id,
            { source: 'manual_link', createdByUserId: opts.actorUserId ?? null },
          );
        }
      } catch (err) {
        // Defensive: log + devam et. linkAccount return shape değişmez.
        console.warn('[linkAccount] learnedSender upsert fail',
          err?.message ?? err);
      }
    }

    return shape(updated);
  },

  /**
   * Not ekle — Faz 1.5 Madde 3 ile @mention parse + CaseMention satırları.
   *
   * Format: not içinde `@[Name](userId)` tag'leri. Parse edip:
   *  - Max 10 farklı kullanıcı (spec)
   *  - Hepsi aynı şirkette aktif User olmalı (cross-tenant mention engellenir)
   *  - Her başarılı mention için CaseMention satırı + bell badge sinyali
   *
   * mentionedBy req.user.id (route'tan geçer); aktor'un User.id'si yoksa
   * (cron, test) mention skip — note yine kaydedilir.
   */
  async addNote(id, note, allowedCompanyIds, mentionedBy, actor) {
    // Actor identity hardening: actor varsa author kimliği server-side; aksi
    // halde legacy davranış (mentionedBy + note.authorName) — smoke caller'ları.
    const effectiveAuthorUserId = actor?.userId ?? mentionedBy ?? null;

    // Two-layer duplicate guard (note safety task §C):
    //   Layer 1 — in-flight coalescing: concurrent identical creates
    //     (HTTP/2 multiplexed double-click) share the same promise.
    //   Layer 2 — DB short-window: sequential identical create within
    //     5s of completion returns the existing row.
    // Both layers gate only on authenticated calls (effective author set);
    // cron/mock paths skip because identity is ambiguous.
    const _impl = async () => {
      const companyId = await assertCaseInScope(id, allowedCompanyIds);
      if (!companyId) return null;

      if (effectiveAuthorUserId && note.content) {
        const dupeWindow = new Date(Date.now() - 5000);
        const existing = await prisma.caseNote.findFirst({
          where: {
            caseId: id,
            authorId: effectiveAuthorUserId,
            content: note.content,
            visibility: note.visibility,
            parentNoteId: null,
            createdAt: { gte: dupeWindow },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) return existing;
      }

      return _addNoteWriteAndEmit({ id, note, companyId, mentionedBy, actor });
    };

    if (effectiveAuthorUserId && note.content) {
      const key = `note|${id}|${effectiveAuthorUserId}|${note.visibility}|${note.content}`;
      return coalesceNoteCreate(key, _impl);
    }
    return _impl();
  },

  /**
   * Bir notun reply'larını döner (thread görünümü için lazy load).
   * Auth: vaka scope + parent note aynı vakaya ait olmalı.
   * Sıralama: createdAt ASC — kronolojik thread.
   */
  async listReplies(caseId, noteId, allowedCompanyIds, actorRole = null) {
    // PR-SD (Codex P2 round-4) — Read path; arşivli case SystemAdmin'e
    // açık, diğer roller null/404.
    const companyId = await assertCaseInScopeForRead(caseId, allowedCompanyIds, actorRole);
    if (!companyId) return null;

    const parent = await prisma.caseNote.findUnique({
      where: { id: noteId },
      select: { id: true, caseId: true },
    });
    if (!parent || parent.caseId !== caseId) return null;

    const replies = await prisma.caseNote.findMany({
      where: { parentNoteId: noteId },
      orderBy: { createdAt: 'asc' },
      include: { reactions: { select: NOTE_REACTION_SELECT } },
    });
    return replies;
  },

  /**
   * Bir nota reply ekle (max 1 derinlik — reply'a reply yok).
   *
   * Kurallar:
   *  - Parent note aynı vakada olmalı.
   *  - Parent'in parentNoteId NULL olmalı (zaten reply olana reply yok).
   *  - @mention parse + cross-tenant kontrol (addNote ile aynı kalıp).
   *  - parent.replyCount transactional artırılır.
   *  - CaseActivity: NoteReplyAdded.
   *  - Watcher bildirimleri tetiklenir.
   */
  async addReply(caseId, noteId, reply, allowedCompanyIds, mentionedBy, actor) {
    // Actor identity hardening: actor varsa author kimliği server-side; aksi
    // halde legacy davranış (mentionedBy + reply.authorName) — smoke caller'ları.
    const effectiveAuthorName = actor?.displayName ?? reply.authorName;
    const effectiveAuthorUserId = actor?.userId ?? mentionedBy ?? null;
    const effectiveMentionedBy = actor?.userId ?? mentionedBy;

    // Trim content here so the in-flight key + dup guard use the canonical
    // form. Empty/max_depth/scope errors come back via the inner _impl
    // and short-circuit before any in-flight registration would matter.
    const contentTrimmedKey = (reply.content ?? '').trim();
    const _impl = async () => {
      const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
      if (!companyId) return null;

      const parent = await prisma.caseNote.findUnique({
        where: { id: noteId },
        select: { id: true, caseId: true, parentNoteId: true, authorName: true },
      });
      if (!parent || parent.caseId !== caseId) return null;
      if (parent.parentNoteId !== null) {
        return { error: 'max_depth', message: 'Bir yanıta yanıt verilemez (max 1 derinlik).' };
      }

      const content = contentTrimmedKey;
      if (!content) {
        return { error: 'empty', message: 'Yanıt boş olamaz.' };
      }

    // Short-window duplicate guard — same shape as addNote, scoped to
    // this thread (parentNoteId=noteId). Two rapid identical replies
    // within 5 seconds collapse to the first row; parent.replyCount
    // is NOT double-incremented and the activity log / watcher notify
    // do NOT fire twice.
    if (effectiveAuthorUserId) {
      const dupeWindow = new Date(Date.now() - 5000);
      const existing = await prisma.caseNote.findFirst({
        where: {
          caseId,
          parentNoteId: noteId,
          authorId: effectiveAuthorUserId,
          content,
          visibility: reply.visibility,
          createdAt: { gte: dupeWindow },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return existing;
    }

    // @[Name](userId) tag parse (addNote ile aynı kural)
    const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
    const matches = [...content.matchAll(mentionRegex)];
    const mentionedUserIds = [...new Set(matches.map((m) => m[2]))];

    if (mentionedUserIds.length > 10) {
      return { error: 'too_many_mentions', message: 'Bir yanıtta en fazla 10 kişi etiketlenebilir.' };
    }

    if (mentionedUserIds.length > 0) {
      const valid = await prisma.user.findMany({
        where: {
          id: { in: mentionedUserIds },
          isActive: true,
          companies: { some: { companyId, isActive: true } },
        },
        select: { id: true },
      });
      const validIds = new Set(valid.map((v) => v.id));
      const invalid = mentionedUserIds.filter((uid) => !validIds.has(uid));
      if (invalid.length > 0) {
        return {
          error: 'invalid_mentions',
          message: `Etiketlenen ${invalid.length} kullanıcı bu şirkette bulunamadı veya pasif.`,
        };
      }
    }

    // Transactional: reply create + parent.replyCount artır.
    const created = await prisma.$transaction(async (tx) => {
      const r = await tx.caseNote.create({
        data: {
          caseId,
          companyId,
          authorName: effectiveAuthorName,
          authorId: effectiveAuthorUserId,
          content,
          visibility: reply.visibility,
          parentNoteId: noteId,
        },
      });
      await tx.caseNote.update({
        where: { id: noteId },
        data: { replyCount: { increment: 1 } },
      });
      return r;
    });

    // Mention satırları
    if (mentionedUserIds.length > 0 && effectiveMentionedBy) {
      await prisma.caseMention.createMany({
        data: mentionedUserIds.map((uid) => ({
          caseId,
          noteId: created.id,
          companyId,
          mentionedUserId: uid,
          mentionedBy: effectiveMentionedBy,
        })),
      });

      // WR-NOTIFICATION-CENTER Phase 2A — inbox emit per mentioned user.
      // Same pattern as addNote (above); fire-and-forget; reply creation
      // never awaits this.
      const caseSnapshot = await prisma.case.findUnique({
        where: { id: caseId },
        select: { caseNumber: true, title: true },
      });
      // Codex P1 hotfix — `created.id` is the REPLY note id; its
      // parentNoteId is `noteId` (this addReply call's arg, already
      // validated to be top-level by the max_depth guard above).
      // `noteId` for dedup must stay as `created.id` so two distinct
      // replies that mention the same user dedupe per-reply, not
      // per-parent-thread. `parentNoteId` is what the inline-reply
      // composer needs to target the thread root.
      void emitMentionsForNote({
        caseId,
        companyId,
        noteId: created.id,
        parentNoteId: noteId,
        mentionedUserIds,
        actorUserId: effectiveMentionedBy,
        actorDisplay: effectiveAuthorName,
        caseNumber: caseSnapshot?.caseNumber,
        caseTitle: caseSnapshot?.title,
        noteContent: content,
      });
    }

    const cleanedPreview = content
      .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
      .slice(0, 200);
    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: 'Nota yanıt eklendi',
        actionType: 'NoteReplyAdded',
        note: cleanedPreview,
        actor: effectiveAuthorName,
        actorUserId: effectiveAuthorUserId,
      },
    });

    const noteCase = await prisma.case.findUnique({
      where: { id: caseId },
      select: { caseNumber: true },
    });
    await notifyWatchers({
      caseId,
      companyId,
      message: `${noteCase?.caseNumber ?? caseId} — ${parent.authorName}'in notuna yanıt: ${cleanedPreview.slice(0, 80)}`,
      kind: 'note',
    });

      await prisma.case.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
      return created;
    };

    if (effectiveAuthorUserId && contentTrimmedKey) {
      const key = `reply|${caseId}|${noteId}|${effectiveAuthorUserId}|${reply.visibility}|${contentTrimmedKey}`;
      return coalesceNoteCreate(key, _impl);
    }
    return _impl();
  },

  /**
   * Vaka notu / yanıtı silme (note safety task).
   *
   * Yetki modeli:
   *  - Sadece `CaseNote.authorId === currentUserId` olan kullanıcı silebilir.
   *  - Vaka scope'u (allowedCompanyIds) zorlanır — yabancı tenant 403.
   *  - authorId NULL olan eski notlar silinemez (sahiplik tespit edilemez).
   *
   * Cascade güvenliği (schema migration YOK):
   *  - Reactions: schema cascade ile gider (CaseNoteReaction.onDelete: Cascade)
   *  - Mentions: schema'da FK yok → manuel deleteMany ile temizlenir
   *  - Replies: parent→replies relation onDelete: SetNull. Yetimleşmemesi
   *    için top-level note `replyCount > 0` ise `note_has_replies` 409
   *    döner. Yanıtı olan ana not silmek için önce yanıtların silinmesi
   *    veya soft-delete migration'u gerekir.
   *  - Reply silinince parent.replyCount transactional decrement edilir.
   *  - CaseActivity: text-only "Not silindi" / "Not yanıtı silindi" satırı
   *    yazılır (actionType=null — yeni enum value eklemiyoruz; eski enum
   *    set'i değişmez).
   *
   * Dönüş:
   *  - { success: true } başarı
   *  - null → vaka bulunamadı / not bulunamadı / cross-tenant
   *  - { error: 'forbidden', message } → kendi notu değil
   *  - { error: 'orphan', message } → authorId NULL eski not
   *  - { error: 'has_replies', message } → top-level note + replyCount > 0
   */
  async deleteNote(caseId, noteId, allowedCompanyIds, currentUserId) {
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    const note = await prisma.caseNote.findUnique({
      where: { id: noteId },
      select: {
        id: true,
        caseId: true,
        authorId: true,
        authorName: true,
        content: true,
        parentNoteId: true,
        replyCount: true,
      },
    });
    if (!note || note.caseId !== caseId) return null;

    if (!note.authorId) {
      return {
        error: 'orphan',
        message: 'Yazarı belirlenemeyen eski not silinemez.',
      };
    }
    if (note.authorId !== currentUserId) {
      return {
        error: 'forbidden',
        message: 'Sadece kendi notunu silebilirsin.',
      };
    }
    if (note.parentNoteId === null && note.replyCount > 0) {
      return {
        error: 'has_replies',
        message: 'Yanıtı olan bir ana not silinemez. Önce yanıtları silmelisin.',
      };
    }

    // Transactional: mention cleanup + note delete + parent counter
    // decrement (if reply).
    await prisma.$transaction(async (tx) => {
      // CaseMention has no schema FK to CaseNote — manual cleanup.
      await tx.caseMention.deleteMany({ where: { noteId } });
      await tx.caseNote.delete({ where: { id: noteId } });
      if (note.parentNoteId) {
        await tx.caseNote.update({
          where: { id: note.parentNoteId },
          data: { replyCount: { decrement: 1 } },
        });
      }
    });

    // Activity log — actionType left null intentionally (no new enum).
    const preview = (note.content ?? '')
      .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
      .slice(0, 200);
    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: note.parentNoteId ? 'Not yanıtı silindi' : 'Not silindi',
        note: preview,
        actor: note.authorName,
        actorUserId: typeof currentUserId === 'string' ? currentUserId : null, // PR-5
      },
    });

    await prisma.case.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
    return { success: true };
  },

  /**
   * Bir vakaya not yazarken @mention dropdown için adaylar.
   * Vakanın şirketine aktif UserCompany ile bağlı + Person'a bağlı User'lar.
   * personId yoksa (Person'a bağlanmamış User) liste'de görünmez — atama
   * hedefi olamadığı için mention'da da anlamsız.
   */
  async listMentionableUsers(caseId, allowedCompanyIds, actorRole = null) {
    // PR-SD (Codex P2 round-4) — Read path.
    const companyId = await assertCaseInScopeForRead(caseId, allowedCompanyIds, actorRole);
    if (!companyId) return null;

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        personId: { not: null },
        companies: { some: { companyId, isActive: true } },
      },
      select: { id: true, email: true, fullName: true, personId: true },
      orderBy: { fullName: 'asc' },
    });
    if (users.length === 0) return [];

    // Person + team adlarını tek query ile topla
    const personIds = users.map((u) => u.personId).filter(Boolean);
    const persons = await prisma.person.findMany({
      where: { id: { in: personIds } },
      include: { team: { select: { name: true } } },
    });
    const personMap = new Map(persons.map((p) => [p.id, p]));

    return users.map((u) => {
      const p = u.personId ? personMap.get(u.personId) : null;
      return {
        userId: u.id,
        personId: u.personId,
        name: u.fullName,
        email: u.email,
        teamName: p?.team?.name ?? null,
      };
    });
  },

  async addCallLog(id, input, allowedCompanyIds, actor) {
    // PR-1 — server-authoritative actor: body.callerId YUTULUR; callerId
    // daima caller'ın userId'si (req.user.id) ile yazılır. Audit trail'de
    // çağrıyı kaydeden gerçek kullanıcı. callerName (input metadata) hâlâ
    // body'den alınabilir — bu çağrılan müşteriyi/3rd party'yi etiketleyen
    // serbest metindir, actor'la karıştırılmamalı.
    assertActor(actor, 'caseRepository.addCallLog');
    if (typeof actor.userId !== 'string' || actor.userId.length === 0) {
      throw new ActorRequiredError('caseRepository.addCallLog: actor.userId required');
    }
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
    const m = toDb(input);
    const log = await prisma.caseCallLog.create({
      data: {
        caseId: id,
        companyId,
        callDate: m.callDate ? new Date(m.callDate) : new Date(),
        durationMin: m.durationMin,
        callDisposition: m.callDisposition,
        callOutcome: m.callOutcome,
        description: m.description,
        callerId: actor.userId,
        callerName: m.callerName,
        nextFollowupDate: m.nextFollowupDate ? new Date(m.nextFollowupDate) : null,
        lastInteractionDate: new Date(),
      },
    });

    // Aktivite akışında "Çağrı kaydı eklendi" satırı — kısa özet.
    const outcomeLabel = input.callOutcome ?? '-';
    const descPreview = (input.description ?? '').slice(0, 200);
    const noteText = descPreview
      ? `${m.durationMin ?? 0} dk · ${outcomeLabel} — ${descPreview}`
      : `${m.durationMin ?? 0} dk · ${outcomeLabel}`;
    await prisma.caseActivity.create({
      data: {
        caseId: id,
        companyId,
        action: 'Çağrı kaydı eklendi',
        actionType: 'CallLogAdded',
        note: noteText,
        actor: actor.displayName,
        actorUserId: actorUserIdOf(actor), // PR-5
      },
    });

    const caseUpdated = await prisma.case.update({
      where: { id },
      data: { updatedAt: new Date() },
      include: CASE_INCLUDE,
    });
    return { caseUpdated: shape(caseUpdated), callLog: fromDb(log) };
  },

  async addActivity(caseId, input, allowedCompanyIds, actor) {
    // PR-1 — server-authoritative: body.actor YUTULUR. Manuel activity
    // entry'sini ekleyen gerçek kullanıcı her zaman audit trail'de görünür.
    assertActor(actor, 'caseRepository.addActivity');
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;
    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: input.action,
        actionType: input.actionType,
        fieldName: input.fieldName,
        fromValue: input.oldValue,
        toValue: input.newValue,
        note: input.note,
        actor: actor.displayName,
        actorUserId: actorUserIdOf(actor), // PR-5
      },
    });
    const updated = await prisma.case.update({
      where: { id: caseId },
      data: { updatedAt: new Date() },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  async toggleChecklistItem(caseId, itemId, checked, actor, allowedCompanyIds) {
    assertActor(actor, 'caseRepository.toggleChecklistItem');
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;
    const c = await prisma.case.findUnique({ where: { id: caseId } });
    if (!c?.checklistItems) return shape(c);

    const items = c.checklistItems.map((it) => {
      if (it.id !== itemId) return it;
      return checked
        ? { ...it, checked: true, checkedAt: new Date().toISOString(), checkedBy: actor }
        : { ...it, checked: false, checkedAt: undefined, checkedBy: undefined };
    });

    const target = c.checklistItems.find((it) => it.id === itemId);
    const updated = await prisma.case.update({
      where: { id: caseId },
      data: {
        checklistItems: items,
        history: {
          create: {
            companyId,
            action: checked ? 'Kontrol maddesi işaretlendi' : 'Kontrol maddesi işareti kaldırıldı',
            actionType: 'ChecklistToggle',
            fieldName: 'checklist',
            toValue: target?.label ?? itemId,
            actor,
          },
        },
      },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  /**
   * Adım 1 — Upload talebi: limit kontrolü + storage'da signed PUT URL üret.
   * Frontend bu URL'e doğrudan PUT eder (Vercel 4.5MB body limiti bypass).
   * DB satırı henüz yazılmaz; finalize() ile yazılır.
   */
  async requestUpload(id, input, allowedCompanyIds, actor) {
    // PR-4 — Upload two-step user binding: token'a actor.userId gömülür,
    // PUT ve finalize endpoint'leri user mismatch'i reddeder.
    assertActor(actor, 'caseRepository.requestUpload');
    if (typeof actor !== 'object' || typeof actor.userId !== 'string' || actor.userId.length === 0) {
      throw new ActorRequiredError('caseRepository.requestUpload: actor.userId required for token binding');
    }
    if (!(await assertCaseInScope(id, allowedCompanyIds))) return null;
    const FILE_MAX_SIZE = 25 * 1024 * 1024;
    const FILE_MAX_COUNT = 20;

    const c = await prisma.case.findUnique({
      where: { id },
      include: { attachments: true },
    });
    if (!c) return null;
    if (c.attachments.length >= FILE_MAX_COUNT) {
      return { error: `Bu vakada en fazla ${FILE_MAX_COUNT} dosya olabilir.` };
    }
    if (input.fileSize > FILE_MAX_SIZE) {
      return { error: `Dosya boyutu üst sınırı ${Math.round(FILE_MAX_SIZE / (1024 * 1024))} MB.` };
    }

    // PR-7 — Business review Madde 6. MIME + uzantı whitelist (deny-by-
    // default). XML explicit kabul listesinde; executable/script tipleri
    // reddedilir. Eski yüklenmiş dosyalar etkilenmez — yalnız yeni
    // upload check edilir. İçerik (magic bytes) doğrulama YOK; backend
    // dosyaları parse etmez, XXE/SSRF riski sıfır.
    if (!isAcceptedUpload(input.mimeType, input.fileName)) {
      return {
        error: 'Bu dosya türü kabul edilmiyor. PDF, Office belgeleri, görseller (PNG/JPG/GIF/WebP), metin (TXT/CSV/JSON/XML) ve ZIP yüklenebilir.',
      };
    }

    // Önceden id üret — Storage path'i bunu kullanır (henüz DB'de yok).
    const attachmentId = `cmsa_${crypto.randomBytes(12).toString('hex')}`;
    const { signedUrl, path, token } = await createUploadUrl(id, attachmentId, input.fileName, actor.userId);
    return { uploadUrl: signedUrl, path, attachmentId, token };
  },

  /**
   * Adım 2 — Finalize: storage upload başarılı → DB satırını yaz + history log.
   * Frontend, requestUpload'tan dönen attachmentId/path'i geri gönderir.
   */
  async finalizeUpload(id, input, allowedCompanyIds, actor) {
    // PR-1 — server-authoritative: body.uploadedBy YUTULUR.
    // PR-4 — Upload two-step user binding: token verify + userId match.
    //   User A upload-url ister, User B finalize ederse 403 verir.
    //   Eksik token (upload-url'siz finalize) reddedilir.
    assertActor(actor, 'caseRepository.finalizeUpload');
    if (typeof actor !== 'object' || typeof actor.userId !== 'string') {
      throw new ActorRequiredError('caseRepository.finalizeUpload: actor.userId required for binding check');
    }
    const tokenPayload = verifyStorageToken(input.token);
    if (!tokenPayload || tokenPayload.typ !== 'upload') {
      return { error: 'Geçersiz veya süresi dolmuş yükleme token\'ı.' };
    }
    if (tokenPayload.userId !== actor.userId) {
      return { error: 'Yükleme token\'ı farklı bir kullanıcıya ait. Yeniden yüklemeyi başlatın.' };
    }
    if (tokenPayload.caseId !== id || tokenPayload.path !== input.path) {
      return { error: 'Yükleme token\'ı bu vaka/path ile uyumsuz.' };
    }
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
    // PR-7 — Defense-in-depth: requestUpload signed URL aldıktan sonra
    // finalize'a farklı MIME ile gelirse reddet. Aynı whitelist'i
    // tekrar kontrol et. Eski upload'lar (signed URL akışı dışında)
    // bu code path'ten geçmez.
    if (!isAcceptedUpload(input.mimeType, input.fileName)) {
      return {
        error: 'Bu dosya türü kabul edilmiyor. PDF, Office belgeleri, görseller (PNG/JPG/GIF/WebP), metin (TXT/CSV/JSON/XML) ve ZIP yüklenebilir.',
      };
    }
    const actorName = actor.displayName;
    const actorUid = actorUserIdOf(actor); // PR-5
    const file = await prisma.caseAttachment.create({
      data: {
        id: input.attachmentId,
        caseId: id,
        companyId,
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        fileUrl: input.path, // Storage path — download'da signed URL'e dönüşür
        uploadedBy: actorName,
        uploadedByUserId: actorUid, // PR-5
      },
    });
    const caseUpdated = await prisma.case.update({
      where: { id },
      data: {
        updatedAt: new Date(),
        history: {
          create: {
            companyId,
            action: 'Dosya yüklendi',
            actionType: 'FileUploaded',
            fieldName: 'files',
            toValue: file.fileName,
            actor: actorName,
            actorUserId: actorUid, // PR-5
          },
        },
      },
      include: CASE_INCLUDE,
    });
    return { caseUpdated: shape(caseUpdated), file };
  },

  /** Download için kısa ömürlü token'lı URL üret (local disk; Faz 4). */
  async getDownloadUrl(caseId, fileId, allowedCompanyIds, actorRole = null) {
    // PR-SD (Codex P2 round-4) — Read path; arşivli case dosyaları
    // SystemAdmin için erişilebilir kalmalı, diğer roller 404.
    if (!(await assertCaseInScopeForRead(caseId, allowedCompanyIds, actorRole))) return null;
    const target = await prisma.caseAttachment.findUnique({ where: { id: fileId } });
    if (!target || target.caseId !== caseId || !target.fileUrl) return null;
    const url = createDownloadUrl(caseId, fileId, target.fileUrl, target.fileName);
    return { url, fileName: target.fileName };
  },

  async removeFile(id, fileId, actor, allowedCompanyIds) {
    assertActor(actor, 'caseRepository.removeFile');
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
    const target = await prisma.caseAttachment.findUnique({ where: { id: fileId } });
    if (!target || target.caseId !== id) {
      const c = await prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE });
      return shape(c);
    }
    // Önce Storage'dan sil — başarısız olursa DB satırı yine silinir, orphan log'lanır.
    if (target.fileUrl) {
      await removeObject(target.fileUrl);
    }
    await prisma.caseAttachment.delete({ where: { id: fileId } });
    const updated = await prisma.case.update({
      where: { id },
      data: {
        updatedAt: new Date(),
        history: {
          create: {
            companyId,
            action: 'Dosya silindi',
            actionType: 'FileRemoved',
            fieldName: 'files',
            fromValue: target.fileName,
            actor,
          },
        },
      },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  /**
   * Toplu güncelleme — Faz 1.5 Madde 2 "Bulk Actions".
   *
   * Whitelist: yalnızca assignedPersonId, assignedTeamId, priority, status.
   * Status'te kapatma yasak (Cozuldu/IptalEdildi) — her vaka için ayrı kapatma
   * log'u/onayı gerekiyor, bulk'ta yapılmamalı.
   *
   * Cross-tenant koruma: caseIds'in TÜMÜ allowedCompanyIds içinde değilse
   * tek bir vaka bile güncellenmez (CaseAccessError fırlatılır). Bu "saldırgan
   * listede yetkisiz ID gizleyemesin" prensibi — partial-success yok.
   *
   * SLA pause/resume mantığı: bulk status değişiminde transitionStatus
   * çalıştırılmaz — yalnızca basit alan update'i. 3rdPartyBekleniyor'a bulk
   * geçiş SLA'yı duraklatmaz; kullanıcı SLA pause istiyorsa tek vaka
   * üzerinden statü geçişi yapsın. Bilinçli sadelik.
   */
  async bulkUpdate({ caseIds, updates }, actor, allowedCompanyIds, actorObject = null) {
    // PR-5 follow-up — actorObject opsiyonel; varsa actorUserId stamp.
    assertActor(actor, 'caseRepository.bulkUpdate');
    if (!Array.isArray(caseIds) || caseIds.length === 0) {
      return { error: 'caseIds dizisi gerekli (boş olamaz).' };
    }
    if (caseIds.length > 100) {
      return { error: 'En fazla 100 vaka tek seferde güncellenebilir.' };
    }
    if (!updates || typeof updates !== 'object') {
      return { error: 'updates nesnesi gerekli.' };
    }

    // Whitelist: yalnızca bu 4 alan kabul.
    const ALLOWED = ['assignedPersonId', 'assignedTeamId', 'priority', 'status'];
    const filtered = {};
    for (const k of ALLOWED) {
      if (updates[k] !== undefined && updates[k] !== null && updates[k] !== '') {
        filtered[k] = updates[k];
      }
    }
    if (Object.keys(filtered).length === 0) {
      return { error: 'En az bir geçerli alan güncellenmeli (assignedPersonId, assignedTeamId, priority, status).' };
    }

    // Status kapatma yasağı (TR ya da ASCII fark etmez — ikisini de yakala).
    const dbStatusCandidate = filtered.status
      ? toDb({ status: filtered.status }).status
      : undefined;
    if (dbStatusCandidate === 'Cozuldu' || dbStatusCandidate === 'IptalEdildi') {
      return { error: 'Toplu işlemde kapatma (Çözüldü/İptalEdildi) yapılamaz.' };
    }

    const bulkTouchesAssignment =
      filtered.assignedPersonId !== undefined || filtered.assignedTeamId !== undefined;

    // Cross-tenant validation: tüm vakaları tek query'de çek, scope'a bak.
    const cases = await prisma.case.findMany({
      where: { id: { in: caseIds } },
      select: { id: true, companyId: true, assignedPersonId: true, assignedTeamId: true },
    });
    if (cases.length !== caseIds.length) {
      const foundIds = new Set(cases.map((c) => c.id));
      const missing = caseIds.filter((id) => !foundIds.has(id));
      return { error: `Bazı vakalar bulunamadı: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` (+${missing.length - 3})` : ''}` };
    }
    if (allowedCompanyIds) {
      const outsider = cases.find((c) => !allowedCompanyIds.includes(c.companyId));
      if (outsider) {
        throw new CaseAccessError('Toplu işlem: erişiminiz olmayan vaka(lar) listede.');
      }
    }

    // Denormalize names: assignedPersonId / assignedTeamId verildiyse
    // Person/Team adını DB'den çek (frontend bulk için sadece ID gönderiyor).
    let assignedPersonName;
    if (filtered.assignedPersonId) {
      const person = await prisma.person.findUnique({
        where: { id: filtered.assignedPersonId },
        select: { name: true },
      });
      if (!person) return { error: 'Atanan kişi bulunamadı.' };
      assignedPersonName = person.name;
    }
    let assignedTeamName;
    if (filtered.assignedTeamId) {
      const team = await prisma.team.findUnique({
        where: { id: filtered.assignedTeamId },
        select: { name: true },
      });
      if (!team) return { error: 'Atanan takım bulunamadı.' };
      assignedTeamName = team.name;
    }

    // DB'ye yazılacak patch (ASCII enum + denormalize names)
    const dbPatch = toDb(filtered);
    const dataPatch = { ...dbPatch };
    if (assignedPersonName !== undefined) dataPatch.assignedPersonName = assignedPersonName;
    if (assignedTeamName !== undefined) dataPatch.assignedTeamName = assignedTeamName;

    // Activity log: field başına ayrı log per case (spec).
    const FIELD_LABELS = {
      assignedPersonId: 'Atanan Kişi',
      assignedTeamId: 'Atanan Takım',
      priority: 'Öncelik',
      status: 'Statü',
    };
    const VALUE_LABELS = {
      assignedPersonId: assignedPersonName,
      assignedTeamId: assignedTeamName,
      // priority/status için frontend TR string geliyor; doğrudan göster.
    };

    let updated = 0;
    let failed = 0;
    const errors = [];
    for (const c of cases) {
      try {
        const historyEntries = [];
        for (const [field, newVal] of Object.entries(filtered)) {
          const fieldLabel = FIELD_LABELS[field] ?? field;
          const valueLabel = VALUE_LABELS[field] ?? String(newVal);
          historyEntries.push({
            companyId: c.companyId,
            action: `Toplu işlem: ${fieldLabel} → ${valueLabel} (${cases.length} vakadan biri)`,
            actionType: field === 'status' ? 'StatusChange' : 'FieldUpdate',
            fieldName: field,
            toValue: valueLabel,
            actor,
            actorUserId: actorUserIdOf(actorObject), // PR-5 follow-up
          });
        }
        await prisma.case.update({
          where: { id: c.id },
          data: { ...dataPatch, history: { create: historyEntries } },
        });

        if (bulkTouchesAssignment) {
          const finalAssignedPersonId =
            filtered.assignedPersonId !== undefined ? filtered.assignedPersonId : c.assignedPersonId;
          const finalAssignedTeamId =
            filtered.assignedTeamId !== undefined ? filtered.assignedTeamId : c.assignedTeamId;
          const assignmentChanged =
            finalAssignedPersonId !== c.assignedPersonId || finalAssignedTeamId !== c.assignedTeamId;
          if (assignmentChanged) {
            await notifyAssignmentTargets({
              caseId: c.id,
              companyId: c.companyId,
              assignedPersonId: finalAssignedPersonId,
              assignedTeamId: finalAssignedTeamId,
              actorUserId: actorUserIdOf(actorObject),
              message: 'Toplu işlemle atama değişti.',
              eventType: 'watcher_update',
              kind: 'assignment',
            });
          }
        }

        updated++;
      } catch (e) {
        failed++;
        errors.push({ caseId: c.id, error: e?.message ?? 'Bilinmeyen' });
      }
    }
    return { updated, failed, errors };
  },

  async findOpenCaseFor(accountId, caseType, allowedCompanyIds, securityWhere = null) {
    const where = {
      accountId,
      caseType,
      status: { notIn: ['Cozuldu', 'IptalEdildi'] },
    };
    if (allowedCompanyIds) where.companyId = { in: allowedCompanyIds };
    const found = await prisma.case.findFirst({ where: mergeSecurityWhere(where, securityWhere), include: CASE_INCLUDE });
    return shape(found);
  },

  /**
   * Statü geçişi — SLA pause/resume + eskalasyon log'u + status change history.
   * Spec §6: 3rdPartyBekleniyor'a girilince slaPausedAt set edilir; çıkılınca
   * geçen süre slaPausedDurationMin'e eklenip slaResolutionDueAt ileri kaydırılır.
   */
  async transitionStatus(id, nextStatus, payload = {}, actor, allowedCompanyIds, actorObject = null) {
    // PR-5 follow-up — actorObject opsiyonel; varsa actorUserId stamp.
    assertActor(actor, 'caseRepository.transitionStatus');
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
    const prev = await prisma.case.findUnique({ where: { id } });
    if (!prev) return null;

    // TR → ASCII (DB enum identifier)
    const dbNext = toDb({ status: nextStatus }).status;
    const prevStatusTr = fromDb({ status: prev.status }).status; // history'de TR görünsün

    // WR-D4 Phase 1 — Çözüm onayı zorunluluğu (close guard).
    // Bir politika eşleşiyor ve approvalState !== 'Approved' ise Cozuldu'ya
    // geçiş engellenir. Policy yoksa veya zaten onaylıysa legacy davranış sürer.
    // approvalRepository ApprovalValidationError döndürür; route katmanı
    // CaseValidationError'ı tanıdığı için aynı kod/mesajla yeniden fırlatıyoruz.
    if (dbNext === 'Cozuldu' && prev.status !== 'Cozuldu') {
      const blockErr = await checkApprovalCloseAllowed({ caseRow: prev });
      if (blockErr) {
        throw new CaseValidationError(blockErr.message, {
          status: blockErr.status,
          code: blockErr.code,
        });
      }
    }

    // WR-Smart-Ticket Phase 1e — yapılandırılmış kapanış metadata'sı.
    // payload.smartTicketClosure verilirse Smart Ticket Case'inin
    // customFields.smartTicket.closure alanına deep-merge edilir.
    // Approval guard'dan sonra hazırlanır (atomicity: aynı prisma.update
    // call'unda diğer transition alanlarıyla birlikte yazılır; guard
    // patlarsa hiçbir şey yazılmaz).
    let mergedCustomFields = prev.customFields;
    if (payload.smartTicketClosure) {
      mergedCustomFields = buildSmartTicketClosureMerge(prev, payload.smartTicketClosure);
    }

    const enteringPause = dbNext === 'ThirdPartyWaiting' && prev.status !== 'ThirdPartyWaiting';
    const leavingPause = prev.status === 'ThirdPartyWaiting' && dbNext !== 'ThirdPartyWaiting';

    let nextSlaPausedAt = prev.slaPausedAt;
    let nextPausedDurationMin = prev.slaPausedDurationMin;
    let nextThirdPartyWaitMin = prev.slaThirdPartyWaitMin;
    let nextResolutionDueAt = prev.slaResolutionDueAt;
    let resolvedThirdPartyId = prev.thirdPartyId;
    let resolvedThirdPartyName = prev.thirdPartyName;

    if (enteringPause) {
      if (payload.thirdPartyId) {
        const tp = await prisma.thirdParty.findUnique({
          where: { id: payload.thirdPartyId },
          select: { id: true, name: true, companyId: true, pausesSla: true },
        });
        // Codex P2 fix — Global (companyId=null) 3. partiler tüm
        // şirketler için kullanılabilir; admin UI bunları oluşturuyor +
        // bootstrap listeliyor. Reddetme YALNIZ:
        //   * tp yok
        //   * tp.companyId BAŞKA bir şirkete bağlı (cross-tenant)
        // tp.companyId === null → kabul; pausesSla davranışı global için
        // de aynen uygulanır.
        if (!tp || (tp.companyId !== null && tp.companyId !== companyId)) {
          throw new CaseValidationError('Seçilen 3. parti bu şirkete ait değil.', { status: 400, code: 'invalid_third_party' });
        }
        resolvedThirdPartyId = tp.id;
        resolvedThirdPartyName = tp.name;
        if (tp.pausesSla) {
          nextSlaPausedAt = new Date();
        }
      } else {
        // thirdPartyId yoksa geri uyumluluk: SLA dursun.
        nextSlaPausedAt = new Date();
      }
    } else if (leavingPause && prev.slaPausedAt) {
      const pausedMin = Math.round((Date.now() - new Date(prev.slaPausedAt).getTime()) / 60000);
      nextPausedDurationMin += pausedMin;
      nextThirdPartyWaitMin += pausedMin;
      if (prev.slaResolutionDueAt) {
        nextResolutionDueAt = new Date(
          new Date(prev.slaResolutionDueAt).getTime() + pausedMin * 60000,
        );
      }
      nextSlaPausedAt = null;
    }

    // Yanıt SLA karşılandı mı? İncelemede'ye ilk geçişte slaResponseMetAt stamp'la.
    const enteringIncelemede = dbNext === 'Incelemede' && prev.status !== 'Incelemede';
    const nextSlaResponseMetAt =
      enteringIncelemede && !prev.slaResponseMetAt ? new Date() : prev.slaResponseMetAt;

    const enteringEscalation = dbNext === 'Eskalasyon';
    const leavingEscalation  = prev.status === 'Eskalasyon' && !enteringEscalation;
    const newEscalationLevel = enteringEscalation
      ? toDb({ escalationLevel: payload.escalationLevel }).escalationLevel ?? prev.escalationLevel
      : leavingEscalation
      ? 'Yok'
      : prev.escalationLevel;

    // PR-5 follow-up — actorObject pass'lendiyse actorUserId stamp, yoksa NULL.
    const stampUid = actorUserIdOf(actorObject);
    const historyEntries = [
      {
        companyId,
        action: 'Statü değişti',
        actionType: 'StatusChange',
        fromValue: prevStatusTr,
        toValue: nextStatus,
        actor,
        actorUserId: stampUid,
      },
    ];

    if (enteringEscalation && payload.escalationLevel) {
      const prevLevelTr = fromDb({ escalationLevel: prev.escalationLevel }).escalationLevel;
      if (payload.escalationLevel !== prevLevelTr) {
        historyEntries.push({
          companyId,
          action: 'Eskalasyon seviyesi',
          actionType: 'FieldUpdate',
          fieldName: 'escalationLevel',
          fromValue: prevLevelTr,
          toValue: payload.escalationLevel,
          actor,
          actorUserId: stampUid,
        });
      }
    }
    if (enteringEscalation && payload.escalationReason) {
      historyEntries.push({
        companyId,
        action: 'Eskalasyon gerekçesi',
        toValue: payload.escalationReason,
        actor,
        actorUserId: stampUid,
      });
    }

    const updated = await prisma.case.update({
      where: { id },
      data: {
        status: dbNext,
        resolutionNote: payload.resolutionNote ?? prev.resolutionNote,
        cancellationReason: payload.cancellationReason ?? prev.cancellationReason,
        thirdPartyId: enteringPause ? resolvedThirdPartyId : prev.thirdPartyId,
        thirdPartyName: enteringPause ? resolvedThirdPartyName : prev.thirdPartyName,
        escalationLevel: newEscalationLevel,
        slaPausedAt: nextSlaPausedAt,
        slaPausedDurationMin: nextPausedDurationMin,
        slaThirdPartyWaitMin: nextThirdPartyWaitMin,
        slaResolutionDueAt: nextResolutionDueAt,
        slaResponseMetAt: nextSlaResponseMetAt,
        resolvedAt: (dbNext === 'Cozuldu' || dbNext === 'IptalEdildi') ? new Date() : prev.resolvedAt,
        // M6.1 — terminal'e (Çözüldü/İptal) geçişte pendingCustomerReply
        // OTOMATİK false. Müşteri yanıtı bekleyen bir vaka kapanırsa
        // "yanıt bekliyor" rozeti kalmamalı (R12 mitigation).
        ...((dbNext === 'Cozuldu' || dbNext === 'IptalEdildi') && prev.pendingCustomerReply
          ? { pendingCustomerReply: false }
          : {}),
        ...(mergedCustomFields !== prev.customFields ? { customFields: mergedCustomFields } : {}),
        history: { create: historyEntries },
      },
      include: CASE_INCLUDE,
    });

    // FAZ 2 Collab — watcher bildirimleri (statü + opsiyonel eskalasyon)
    const kind = enteringEscalation ? 'escalation' : 'status';
    await notifyWatchers({
      caseId: id,
      companyId,
      message: `${updated.caseNumber}: ${prevStatusTr} → ${nextStatus}`,
      kind,
    });

    // WR-D4 Phase 2 — close / reopen event emission (fire-and-forget).
    if (dbNext === 'Cozuldu' && prev.status !== 'Cozuldu') {
      void emitNotificationEvent({ event: 'case_closed', caseId: id });
    } else if (dbNext === 'YenidenAcildi' && prev.status !== 'YenidenAcildi') {
      void emitNotificationEvent({ event: 'case_reopened', caseId: id });
    } else if (dbNext !== prev.status) {
      // M4.1 FAZ B — status_changed event (close/reopen DIŞI geçişler).
      // KARDEŞ DESEN: yukarıdaki case_closed/reopened emit'leri.
      // Terminal guard: close/reopen kendi event'lerini zaten yukarıda
      // fire etti; bu else-if dalı sadece ara statü geçişlerinde çalışır
      // (örn. YeniTalep→Inceleniyor, Inceleniyor→Beklemede).
      void emitNotificationEvent({ event: 'status_changed', caseId: id });
    }

    return shape(updated);
  },

  /**
   * Vaka aktarımı (FAZ 2 §20.2). Takım/kişi devri için tek atomic operasyon:
   * Case güncelle (assigned*, transferCount++) + CaseTransfer audit + Activity.
   *
   * Validasyonlar:
   *  - Vaka kapalı (Cozuldu/IptalEdildi) → { error: 'closed_case' }
   *  - Aynı takım → { error: 'same_team' }
   *  - Hedef takım vakanın şirketinde değil → { error: 'invalid_team' }
   *  - toPersonId verilmiş + person bu takıma ait değil → { error: 'invalid_person' }
   *
   * SLA değiştirilmez (kuralı: aktarım SLA sayacını duraklatmaz/sıfırlamaz).
   */
  async transferCase(id, input, allowedCompanyIds) {
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;

    const c = await prisma.case.findUnique({ where: { id } });
    if (!c) return null;

    // Kapalı vakalar aktarılamaz
    if (c.status === 'Cozuldu' || c.status === 'IptalEdildi') {
      return { error: 'closed_case', message: 'Kapatılmış vakalar aktarılamaz.' };
    }

    if (!input.toTeamId || typeof input.toTeamId !== 'string') {
      return { error: 'invalid_input', message: 'toTeamId zorunlu.' };
    }

    if (!input.reason || typeof input.reason !== 'string' || !input.reason.trim()) {
      return { error: 'invalid_input', message: 'Aktarım gerekçesi zorunlu.' };
    }
    if (!input.transferredBy) {
      return { error: 'invalid_input', message: 'transferredBy zorunlu.' };
    }

    // Hedef takım tenant kontrolü
    const team = await prisma.team.findUnique({ where: { id: input.toTeamId } });
    if (!team || team.companyId !== companyId) {
      return { error: 'invalid_team', message: 'Hedef takım vakanın şirketinde değil.' };
    }
    if (!team.isActive) {
      return { error: 'invalid_team', message: 'Hedef takım pasif.' };
    }

    // Hedef kişi (opsiyonel) takım eşleşmesi
    let person = null;
    if (input.toPersonId) {
      person = await prisma.person.findUnique({ where: { id: input.toPersonId } });
      if (!person || person.teamId !== input.toTeamId || !person.isActive) {
        return { error: 'invalid_person', message: 'Atanan kişi seçilen takıma ait değil.' };
      }
    }

    const fromTeamId = c.assignedTeamId ?? null;
    const fromPersonId = c.assignedPersonId ?? null;
    const fromTeamName = c.assignedTeamName ?? '—';

    // Activity action satırı: "↔ Vaka aktarıldı: <from> → <to>"
    // Note alanı: gerekçe etiketi + serbest metin.
    const reasonLabel = input.reasonCode ? TRANSFER_REASON_LABEL[input.reasonCode] : null;
    const trimmedReason = input.reason.trim();
    let noteText = reasonLabel
      ? `Gerekçe: ${reasonLabel} — ${trimmedReason}`
      : `Gerekçe: ${trimmedReason}`;

    // WR-Smart-Ticket Phase T1 — Smart Ticket akışı devir bağlamı varsa
    // customFields.smartTicket.transferContext merge edilir (atomik, aynı txn);
    // activity note multi-line genişler. Klasik vakalar etkilenmez (param
    // opsiyonel ve smartTicket opening şartı helper'da enforce edilir).
    const stTransfer =
      input.smartTicketTransfer && typeof input.smartTicketTransfer === 'object'
        ? input.smartTicketTransfer
        : null;

    // Madde 4 — Devir sırasında opsiyonel priority değişimi. L1 ajan L2'ye
    // devrederken vaka önceliğini de güncelleyebilir. Mevcut Case.priority
    // ile aynıysa update edilmez (no-op + gereksiz activity row önlenir).
    // Geçersiz değer → 400. SLA değiştirilmez (Phase 3 ayrı kapsam).
    const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
    let priorityChange = null;
    if (input.priority !== undefined && input.priority !== null) {
      if (!VALID_PRIORITIES.includes(input.priority)) {
        return {
          error: 'invalid_input',
          message: `Geçersiz priority. Beklenen: ${VALID_PRIORITIES.join(' | ')}.`,
        };
      }
      if (input.priority !== c.priority) {
        priorityChange = { from: c.priority, to: input.priority };
      }
    }

    if (stTransfer) {
      const noteParts = [noteText];
      const trimmedTransferNote =
        typeof stTransfer.transferNote === 'string' ? stTransfer.transferNote.trim() : '';
      if (trimmedTransferNote) {
        noteParts.push('');
        noteParts.push('L1 Notu:');
        noteParts.push(trimmedTransferNote);
      }
      const trimmedComposed =
        typeof stTransfer.composedSummary === 'string' ? stTransfer.composedSummary.trim() : '';
      if (trimmedComposed) {
        noteParts.push('');
        noteParts.push('Denenen Adımlar Özeti:');
        noteParts.push(trimmedComposed);
      }
      noteText = noteParts.join('\n');
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Smart Ticket transfer context merge — Case fresh read içinde,
      // taze customFields baz alınır.
      let nextCustomFields;
      if (stTransfer) {
        const fresh = await tx.case.findUnique({
          where: { id },
          select: { customFields: true },
        });
        nextCustomFields = buildSmartTicketTransferMerge(
          { customFields: fresh?.customFields },
          stTransfer,
          {
            fromTeamId,
            fromTeamName: c.assignedTeamName ?? null,
            toTeamId: input.toTeamId,
            toTeamName: team.name,
            toPersonId: person?.id ?? null,
            toPersonName: person?.name ?? null,
          },
        );
      }

      const u = await tx.case.update({
        where: { id },
        data: {
          assignedTeamId: input.toTeamId,
          assignedTeamName: team.name,
          assignedPersonId: person?.id ?? null,
          assignedPersonName: person?.name ?? null,
          transferCount: { increment: 1 },
          ...(nextCustomFields ? { customFields: nextCustomFields } : {}),
          ...(priorityChange ? { priority: priorityChange.to } : {}),
        },
        include: CASE_INCLUDE,
      });

      await tx.caseTransfer.create({
        data: {
          caseId: id,
          companyId,
          fromTeamId,
          toTeamId: input.toTeamId,
          fromPersonId,
          toPersonId: person?.id ?? null,
          reason: trimmedReason,
          reasonCode: input.reasonCode ?? null,
          transferredBy: input.transferredBy,
          aiSuggestedTeamId: input.aiSuggestedTeamId ?? null,
          aiSuggestedReason: input.aiSuggestedReason ?? null,
          aiReasonCode: input.aiReasonCode ?? null,
          aiConfidence: typeof input.aiConfidence === 'number' ? input.aiConfidence : null,
        },
      });

      await tx.caseActivity.create({
        data: {
          caseId: id,
          companyId,
          action: `↔ Vaka aktarıldı: ${fromTeamName} → ${team.name}`,
          actionType: 'Transfer',
          fieldName: 'assignedTeamId',
          fromValue: fromTeamName,
          toValue: team.name,
          note: noteText,
          actor: input.transferredByName ?? input.transferredBy,
        },
      });

      // Madde 4 — priority değişti ise ayrı FieldUpdate row.
      // Activity tab'daki filtreleme (fields chip'i + watcher trigger
      // mantığı) priority değişimini ayrı bir kayıt olarak görebilsin
      // diye Transfer row'una sığdırılmadı.
      if (priorityChange) {
        await tx.caseActivity.create({
          data: {
            caseId: id,
            companyId,
            action: 'Öncelik güncellendi',
            actionType: 'FieldUpdate',
            fieldName: 'priority',
            fromValue: String(priorityChange.from ?? '—'),
            toValue: String(priorityChange.to),
            actor: input.transferredByName ?? input.transferredBy,
          },
        });
      }

      return u;
    });

    // Watcher bildirimi — transfer status/assignment/priority gibi izlenebilir
    // bir değişiklik. (Smoke Audit P1.2)
    await notifyWatchers({
      caseId: id,
      companyId,
      message: `${c.caseNumber ?? id} — Vaka aktarıldı: ${fromTeamName} → ${team.name}`,
      kind: 'transfer',
    });

    await notifyAssignmentTargets({
      caseId: id,
      companyId,
      assignedPersonId: person?.id ?? null,
      assignedTeamId: input.toTeamId,
      actorUserId: input.transferredBy,
      message: `${c.caseNumber ?? id} — Vaka aktarıldı: ${fromTeamName} → ${team.name}`,
      eventType: 'transfer',
      kind: 'transfer_assignee',
      extraPayload: { fromTeam: fromTeamName, toTeam: team.name },
    });

    // Race-safe: post-increment değerini DB'den oku — pre-computed
    // (c.transferCount + 1) eş zamanlı transfer'lerde supervisor uyarı
    // eşiğini atlatabilir.
    return {
      case: shape(updated),
      transferCount: updated.transferCount,
      fromTeamId,
      fromTeamName,
      toTeamId: input.toTeamId,
      toTeamName: team.name,
      companyId,
    };
  },

  /**
   * Bir vakanın tüm aktarım geçmişi — UI için takım/kişi adları enrich edilir.
   * En yeni en üstte. allowedCompanyIds scope'lu.
   */
  async listTransfers(caseId, allowedCompanyIds, actorRole = null) {
    // PR-SD (Codex P2 round-4) — Read path.
    const companyId = await assertCaseInScopeForRead(caseId, allowedCompanyIds, actorRole);
    if (!companyId) return null;

    const rows = await prisma.caseTransfer.findMany({
      where: { caseId },
      orderBy: { transferredAt: 'desc' },
    });
    if (rows.length === 0) return [];

    const teamIds = new Set();
    const personIds = new Set();
    for (const r of rows) {
      if (r.fromTeamId) teamIds.add(r.fromTeamId);
      if (r.toTeamId) teamIds.add(r.toTeamId);
      if (r.aiSuggestedTeamId) teamIds.add(r.aiSuggestedTeamId);
      if (r.fromPersonId) personIds.add(r.fromPersonId);
      if (r.toPersonId) personIds.add(r.toPersonId);
    }

    const [teams, persons] = await Promise.all([
      teamIds.size > 0
        ? prisma.team.findMany({ where: { id: { in: [...teamIds] } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      personIds.size > 0
        ? prisma.person.findMany({ where: { id: { in: [...personIds] } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const personName = new Map(persons.map((p) => [p.id, p.name]));

    return rows.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      companyId: r.companyId,
      fromTeamId: r.fromTeamId,
      fromTeamName: r.fromTeamId ? teamName.get(r.fromTeamId) ?? null : null,
      toTeamId: r.toTeamId,
      toTeamName: teamName.get(r.toTeamId) ?? null,
      fromPersonId: r.fromPersonId,
      fromPersonName: r.fromPersonId ? personName.get(r.fromPersonId) ?? null : null,
      toPersonId: r.toPersonId,
      toPersonName: r.toPersonId ? personName.get(r.toPersonId) ?? null : null,
      reason: r.reason,
      reasonCode: r.reasonCode,
      reasonLabel: r.reasonCode ? TRANSFER_REASON_LABEL[r.reasonCode] ?? null : null,
      transferredBy: r.transferredBy,
      transferredAt: r.transferredAt,
      aiSuggestedTeamId: r.aiSuggestedTeamId,
      aiSuggestedTeamName: r.aiSuggestedTeamId ? teamName.get(r.aiSuggestedTeamId) ?? null : null,
      aiSuggestedReason: r.aiSuggestedReason,
      aiReasonCode: r.aiReasonCode,
      aiConfidence: r.aiConfidence,
    }));
  },

  /**
   * Vakayı ertele — snoozeUntil + snoozeReason + snoozePreviousStatus set,
   * status değişmez. unsnooze/cron-wakeup snoozePreviousStatus'a geri döner.
   */
  async snoozeCase(id, { snoozeUntil, snoozeReason }, actor, allowedCompanyIds) {
    assertActor(actor, 'caseRepository.snoozeCase');
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
    const target = new Date(snoozeUntil);
    if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) {
      return { error: 'snoozeUntil gelecek bir tarih olmalı.' };
    }
    if (!SNOOZE_REASON_LABEL[snoozeReason]) {
      return { error: 'snoozeReason geçersiz.' };
    }
    const exists = await prisma.case.findUnique({ where: { id } });
    if (!exists) return null;

    const reasonLabel = SNOOZE_REASON_LABEL[snoozeReason];
    const updated = await prisma.case.update({
      where: { id },
      data: {
        snoozeUntil: target,
        snoozeReason,
        // Mevcut statü tekrar açılırken geri yüklensin diye sakla.
        // Tekrar erteleme durumunda mevcut snoozePreviousStatus korunmalı:
        // status zaten ertelemeden beri değişmemiş olmalı.
        snoozePreviousStatus: exists.snoozePreviousStatus ?? exists.status,
        history: {
          create: {
            companyId,
            action: `Vaka ertelendi → ${TR_DATETIME.format(target)} — ${reasonLabel}`,
            actionType: 'FieldUpdate',
            fieldName: 'snoozeUntil',
            toValue: target.toISOString(),
            actor,
          },
        },
      },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  /**
   * Erteleme kaldır — snooze alanlarını temizle, snoozePreviousStatus'a dön.
   * Yoksa Acik fallback (yalnızca Cozuldu/IptalEdildi değilse).
   */
  async unsnoozeCase(id, actor, allowedCompanyIds) {
    assertActor(actor, 'caseRepository.unsnoozeCase');
    const companyId = await assertCaseInScope(id, allowedCompanyIds);
    if (!companyId) return null;
    const exists = await prisma.case.findUnique({ where: { id } });
    if (!exists) return null;
    if (!exists.snoozeUntil) {
      return shape(await prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE }));
    }

    const restored = pickRestoreStatus(exists.snoozePreviousStatus, exists.status);
    const restoredTr = fromDb({ status: restored }).status;
    const updated = await prisma.case.update({
      where: { id },
      data: {
        snoozeUntil: null,
        snoozeReason: null,
        snoozePreviousStatus: null,
        status: restored,
        history: {
          create: {
            companyId,
            action: `Erteleme kaldırıldı → ${restoredTr}`,
            actionType: 'FieldUpdate',
            fieldName: 'snoozeUntil',
            fromValue: exists.snoozeUntil.toISOString(),
            toValue: restoredTr,
            actor,
          },
        },
      },
      include: CASE_INCLUDE,
    });
    return shape(updated);
  },

  /**
   * Inbox "Ertelendi" sekmesi — kullanıcının ertelediği vakalar (aktif + süresi
   * dolmuş ama cron tarafından henüz uyandırılmamış olanlar). Cron 5 dakikada
   * bir çalıştığı için 0-5 dakikalık bir aralıkta "expired" görünebilir; UI
   * bunu amber rozetle gösterir ve kullanıcının manuel kaldırmasını sağlar.
   *
   * Sıralama: expired olanlar önce (en eski uyanmış en üstte → aciliyet),
   * sonra aktif erteleler (en yakın uyanacak en üstte).
   *
   * Multi-tenant: allowedCompanyIds verildiyse sadece o şirketlerin vakaları.
   */
  async listSnoozedForUser(personId, allowedCompanyIds, securityWhere = null) {
    if (!personId) return { items: [], total: 0 };
    const where = {
      assignedPersonId: personId,
      snoozeUntil: { not: null },
    };
    if (allowedCompanyIds) where.companyId = { in: allowedCompanyIds };
    const rows = await prisma.case.findMany({
      where: mergeSecurityWhere(where, securityWhere),
      include: CASE_INCLUDE,
    });
    const now = Date.now();
    const items = rows.map((row) => {
      const expired = row.snoozeUntil && row.snoozeUntil.getTime() <= now;
      return { ...shape(row), expired: Boolean(expired) };
    });
    items.sort((a, b) => {
      if (a.expired !== b.expired) return a.expired ? -1 : 1;
      return new Date(a.snoozeUntil).getTime() - new Date(b.snoozeUntil).getTime();
    });
    return { items, total: items.length };
  },

  /**
   * Cron (her 5 dk) — snoozeUntil geçmiş vakaları Acik'e döndür, log üret.
   * Mutation idempotent: zaten snoozeUntil null olanlar where'de eşleşmez.
   * Bildirim tetikleme şu aşamada uygulama-içi log; Faz 2 §6 bildirim sistemi
   * canlı olunca CaseNotification kaydı buradan üretilir.
   */
  async processSnoozeWakeups() {
    const due = await prisma.case.findMany({
      where: {
        snoozeUntil: { lte: new Date() },
        NOT: { snoozeUntil: null },
      },
      select: { id: true, companyId: true, status: true, snoozeReason: true, snoozePreviousStatus: true },
    });
    if (due.length === 0) return { woken: 0, ids: [] };

    const woken = [];
    for (const c of due) {
      const restored = pickRestoreStatus(c.snoozePreviousStatus, c.status);
      const restoredTr = fromDb({ status: restored }).status;
      const reasonLabel = c.snoozeReason ? SNOOZE_REASON_LABEL[c.snoozeReason] : '—';
      await prisma.case.update({
        where: { id: c.id },
        data: {
          snoozeUntil: null,
          snoozeReason: null,
          snoozePreviousStatus: null,
          status: restored,
          history: {
            create: {
              companyId: c.companyId,
              action: `Erteleme süresi doldu → ${restoredTr} (${reasonLabel})`,
              actionType: 'FieldUpdate',
              fieldName: 'snoozeUntil',
              toValue: restoredTr,
              actor: 'Sistem (cron)',
            },
          },
        },
      });
      woken.push(c.id);
    }
    return { woken: woken.length, ids: woken };
  },

  async findByAccount(accountId, options = {}, allowedCompanyIds, securityWhere = null) {
    const where = { accountId };
    if (allowedCompanyIds) where.companyId = { in: allowedCompanyIds };
    if (options.excludeId) where.NOT = { id: options.excludeId };
    const mapStatuses = (arr) => arr.map((s) => toDb({ status: s }).status);
    if (options.statusIn) where.status = { in: mapStatuses(options.statusIn) };
    if (options.statusNotIn) {
      where.status = { ...(where.status ?? {}), notIn: mapStatuses(options.statusNotIn) };
    }
    const items = await prisma.case.findMany({ where: mergeSecurityWhere(where, securityWhere), include: CASE_INCLUDE });
    return items.map(shape);
  },

  /**
   * Lightweight by-account counter. SmartTicketNewPage banner'da geçmiş çözüm
   * sayısı için kullanılır — findByAccount tam CASE_INCLUDE (notes,
   * attachments, history, callLogs) çekiyor; rozet için bu maliyet gereksiz.
   * Bu yardımcı sadece prisma.case.count ile sayıyı döner.
   *
   * Aynı filtre semantiği: excludeId, statusIn, statusNotIn.
   */
  async countByAccount(accountId, options = {}, allowedCompanyIds, securityWhere = null) {
    const where = { accountId };
    if (allowedCompanyIds) where.companyId = { in: allowedCompanyIds };
    if (options.excludeId) where.NOT = { id: options.excludeId };
    const mapStatuses = (arr) => arr.map((s) => toDb({ status: s }).status);
    if (options.statusIn) where.status = { in: mapStatuses(options.statusIn) };
    if (options.statusNotIn) {
      where.status = { ...(where.status ?? {}), notIn: mapStatuses(options.statusNotIn) };
    }
    return prisma.case.count({ where: mergeSecurityWhere(where, securityWhere) });
  },

  /**
   * Customer Pulse — vakanın müşterisinin geniş durumunu deterministic
   * metriklerle hesaplar. AI gerekmez, AI servisi olmasa da çalışır.
   * Roadmap §"Customer Context Intelligence".
   *
   * Davranış:
   *  - Vaka yoksa null → 404
   *  - allowedCompanyIds scope dışı → CaseAccessError (route 403'e çevirir)
   *  - Aksi halde: o müşterinin son 90 günlük tüm vakalarını tarar
   *    (companyId scope'lu), metrikler + state + summary üretir.
   *
   * Performans: tek prisma sorgu (lightweight select), 90 günden eski
   * vakalar atılır. Çok aktif müşterilerde de düşük maliyet.
   */
  async getCustomerPulse(caseId, allowedCompanyIds) {
    const found = await prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, companyId: true, accountId: true, accountName: true },
    });
    if (!found) return null;
    if (allowedCompanyIds && !allowedCompanyIds.includes(found.companyId)) {
      throw new CaseAccessError();
    }
    return computeCustomerPulse({
      accountId: found.accountId,
      accountName: found.accountName,
      companyId: found.companyId,
      excludeCaseId: caseId,
      caseIdForResponse: found.id,
    });
  },

  /**
   * Account-based Customer Pulse — yeni vaka açma formundan kullanılır.
   * Vaka henüz oluşmadığı için caseId yok; sadece accountId + companyId yeter.
   *
   * Cross-tenant: companyId allowedCompanyIds'de olmalı + account'in companyId'si
   * (varsa — Account.companyId null olabilir, shared kayıt) sorgulanan companyId
   * ile uyumlu olmalı.
   */
  async getCustomerPulseByAccount(accountId, companyId, allowedCompanyIds) {
    if (!accountId || !companyId) return null;
    if (allowedCompanyIds && !allowedCompanyIds.includes(companyId)) {
      throw new CaseAccessError();
    }
    // Account doğrula — yoksa 404 (cross-tenant null guard değildir; Account
    // companyId null shared olabiliyor).
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, name: true, companyId: true },
    });
    if (!account) return null;
    // Account.companyId null = shared (tüm şirketler kullanır). Doluysa
    // sorgulanan companyId ile uyumlu olmalı.
    if (account.companyId && account.companyId !== companyId) {
      throw new CaseAccessError();
    }
    return computeCustomerPulse({
      accountId,
      accountName: account.name,
      companyId,
      excludeCaseId: null,
      caseIdForResponse: null,
    });
  },

  /**
   * Vaka Etiket Doğrulama Ekranı — verilen caseId listesi için review
   * kayıtlarını Map<caseId, review> olarak döner. Çağıran (route layer)
   * caseId listesini zaten allowedCompanyIds ile scope'lanmış bir
   * caseRepository.list() sonucundan türetir — burada tekrar companyId
   * kontrolü yapılmaz.
   */
  async getTaggingReviewsByCaseIds(caseIds) {
    if (!caseIds?.length) return new Map();
    const rows = await prisma.caseTaggingReview.findMany({
      where: { caseId: { in: caseIds } },
    });
    return new Map(rows.map((r) => [r.caseId, r]));
  },

  /**
   * Vaka Etiket Doğrulama Ekranı — tek vakanın review kaydını upsert eder.
   * Alan bazlı model: 9 etiketin her biri kendi Verdict + CorrectedCode'unu
   * taşır (bkz. TAGGING_FIELD_DEFS). Original{Code,Label} snapshot alanları
   * SADECE create'te Case.customFields'tan kopyalanır, update'te asla
   * dokunulmaz — bilgi bankası veri seti vaka arşivlenip silinse bile
   * bağımsız kalmalı. correctedCode her zaman kendi taxonomyType'ına karşı
   * tek bir batched sorguda doğrulanır; correctedLabel client'tan asla
   * okunmaz, TaxonomyDef'ten server-side resolve edilir.
   * reviewerId/reviewerName/reviewedAt route layer'da req.user'dan stamplenir
   * ve buraya actor üzerinden geçirilir — client body'den asla okunmaz.
   * caseId @unique → son yazan kazanır, concurrency token yok (QAScoreLog
   * ile aynı kabul edilebilir risk).
   */
  async upsertTaggingReview(id, input, allowedCompanyIds, actor) {
    const companyId = await assertCaseInScope(id, allowedCompanyIds, { allowArchived: true });
    if (!companyId) return null;

    const VALID_VERDICTS = ['Dogru', 'Yanlis', 'Belirsiz'];
    for (const def of TAGGING_FIELD_DEFS) {
      const verdictKey = `${def.prefix}${def.tag}Verdict`;
      const v = input[verdictKey];
      if (v !== undefined && v !== null && !VALID_VERDICTS.includes(v)) {
        return { error: 'invalid_input', message: `Geçersiz ${verdictKey}. Beklenen: ${VALID_VERDICTS.join(' | ')}.` };
      }
    }

    // correctedCode → kendi taxonomyType'ına karşı tek batched sorgu.
    const correctedEntries = TAGGING_FIELD_DEFS
      .map((def) => ({ def, code: input[`${def.prefix}${def.tag}CorrectedCode`] }))
      .filter((e) => e.code !== undefined && e.code !== null && e.code !== '');

    if (correctedEntries.length) {
      const rows = await prisma.taxonomyDef.findMany({
        where: {
          companyId,
          isActive: true,
          OR: correctedEntries.map((e) => ({ taxonomyType: e.def.taxonomyType, code: e.code })),
        },
        select: { taxonomyType: true, code: true, label: true },
      });
      const found = new Map(rows.map((r) => [`${r.taxonomyType}::${r.code}`, r.label]));
      for (const e of correctedEntries) {
        const label = found.get(`${e.def.taxonomyType}::${e.code}`);
        if (!label) {
          return {
            error: 'invalid_input',
            message: `Geçersiz doğru etiket kodu: ${e.def.prefix}${e.def.tag} = "${e.code}" (taxonomyType: ${e.def.taxonomyType}).`,
          };
        }
        e.label = label;
      }
    }
    const correctedByDef = new Map(correctedEntries.map((e) => [e.def, e]));

    const data = {
      note: typeof input.note === 'string' ? input.note.trim() || null : null,
      reviewerId: actor.userId,
      reviewerName: actor.displayName,
      reviewedAt: new Date(),
    };
    for (const def of TAGGING_FIELD_DEFS) {
      const verdictKey = `${def.prefix}${def.tag}Verdict`;
      const codeKey = `${def.prefix}${def.tag}CorrectedCode`;
      const labelKey = `${def.prefix}${def.tag}CorrectedLabel`;
      if (verdictKey in input) data[verdictKey] = input[verdictKey] ?? null;
      if (codeKey in input) {
        const entry = correctedByDef.get(def);
        data[codeKey] = entry ? entry.code : null;
        data[labelKey] = entry ? entry.label : null;
      }
    }

    const existing = await prisma.caseTaggingReview.findUnique({ where: { caseId: id } });
    if (existing) {
      return prisma.caseTaggingReview.update({ where: { caseId: id }, data });
    }

    const caseRow = await prisma.case.findUnique({ where: { id }, select: { customFields: true } });
    const smartTicket = caseRow?.customFields?.smartTicket ?? {};
    const closure = smartTicket?.closure ?? {};
    const originalData = {};
    for (const def of TAGGING_FIELD_DEFS) {
      const src = def.prefix === 'opening' ? smartTicket : closure;
      originalData[`${def.prefix}${def.tag}OriginalCode`] = src?.[def.customField] ?? null;
      originalData[`${def.prefix}${def.tag}OriginalLabel`] = src?.[`${def.customField}Label`] ?? null;
    }

    return prisma.caseTaggingReview.create({
      data: { caseId: id, companyId, ...originalData, ...data },
    });
  },
};

/**
 * Customer Pulse computation — shared between case-based (CaseDetailPage) ve
 * account-based (NewCaseForm) endpoint'ler. accountId + companyId aynı,
 * sadece excludeCaseId (mevcut vakayı recentCases'ten dışla) ve
 * caseIdForResponse (response payload'undaki caseId alanı) farklılaşır.
 */
async function computeCustomerPulse({
  accountId,
  accountName,
  companyId,
  excludeCaseId,
  caseIdForResponse,
}) {
  const rows = await prisma.case.findMany({
    where: {
      accountId,
      companyId,
      // Tüm vakalar — açık + kapalı — repeat issue ve geçmiş sayımı için.
      // 90 günden eski olanları sayım dışı bırakmak için createdAt filtre ile
      // birlikte değil; metrikleri içeride zaman damgasına göre türetiyoruz.
    },
    orderBy: { createdAt: 'desc' },
    take: 200, // Çok eski müşterilerde de bound — son 200 vakaya bakarız.
    select: {
      id: true,
      caseNumber: true,
      title: true,
      status: true,
      priority: true,
      category: true,
      subCategory: true,
      createdAt: true,
      resolvedAt: true,
      slaViolation: true,
      escalationLevel: true,
    },
  });

  const OPEN_STATUSES = new Set(['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi']);
  const now = Date.now();
  const ms30 = 30 * 24 * 3600 * 1000;
  const ms60 = 60 * 24 * 3600 * 1000;
  const ms90 = 90 * 24 * 3600 * 1000;

  let openCases = 0;
  let recent30d = 0;
  let recent60d = 0;
  let recent90d = 0;
  let slaViolations = 0;
  let criticalCases = 0;
  let escalatedCases = 0;
  const categoryCount = new Map();

  for (const r of rows) {
    const ageMs = now - new Date(r.createdAt).getTime();
    if (OPEN_STATUSES.has(r.status)) openCases++;
    if (ageMs <= ms30) recent30d++;
    if (ageMs <= ms60) recent60d++;
    if (ageMs <= ms90) recent90d++;
    if (r.slaViolation) slaViolations++;
    if (r.priority === 'Critical') criticalCases++;
    if (r.escalationLevel && r.escalationLevel !== 'Yok') escalatedCases++;
    else if (r.status === 'Eskalasyon') escalatedCases++;

    // Repeated issues: yalnız son 90 gün — eski örüntüler bilgisel değil.
    if (ageMs <= ms90) {
      const key = r.subCategory ? `${r.category}::${r.subCategory}` : r.category;
      categoryCount.set(key, (categoryCount.get(key) ?? 0) + 1);
    }
  }

  const repeatedIssues = [...categoryCount.entries()]
    .filter(([, count]) => count >= 2)
    .map(([key, count]) => {
      const [category, subCategory] = key.split('::');
      return { category: fromDb({ category }).category ?? category, subCategory, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Son 5 vaka — UI'da hızlı geçmiş için (current case dahil değil — case-based
  // çağrıda mevcut vaka filtrelenir; account-based'de excludeCaseId null = filter yok)
  const recentCases = rows
    .filter((r) => !excludeCaseId || r.id !== excludeCaseId)
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      caseNumber: r.caseNumber,
      title: r.title,
      status: fromDb({ status: r.status }).status,
      priority: r.priority,
      category: fromDb({ category: r.category }).category ?? r.category,
      subCategory: fromDb({ subCategory: r.subCategory }).subCategory ?? r.subCategory,
      createdAt: r.createdAt,
      slaViolation: r.slaViolation,
    }));

  // State logic — roadmap spec'iyle birebir
  let state = 'Stable';
  if (
    openCases >= 3 ||
    criticalCases > 0 ||
    slaViolations >= 2 ||
    (escalatedCases > 0 && openCases > 0)
  ) {
    state = 'Critical';
  } else if (
    openCases >= 2 ||
    recent30d >= 3 ||
    slaViolations > 0 ||
    repeatedIssues.length >= 3
  ) {
    state = 'Risky';
  } else if (recent90d >= 2 || repeatedIssues.length >= 2) {
    state = 'Watch';
  }

  // Deterministic summary + evidence + recommendation
  const evidence = [];
  if (openCases > 0) evidence.push(`${openCases} açık vaka`);
  if (slaViolations > 0) evidence.push(`${slaViolations} SLA ihlali`);
  if (criticalCases > 0) evidence.push(`${criticalCases} kritik vaka`);
  if (escalatedCases > 0) evidence.push(`${escalatedCases} eskalasyona giden vaka`);
  if (recent30d >= 2) evidence.push(`Son 30 günde ${recent30d} vaka`);
  if (recent90d >= 3 && recent30d < 2) evidence.push(`Son 90 günde ${recent90d} vaka`);
  for (const r of repeatedIssues.slice(0, 2)) {
    const label = r.subCategory ? `${r.category} / ${r.subCategory}` : r.category;
    evidence.push(`Tekrar eden: ${label} (${r.count}×)`);
  }

  let summaryText;
  let recommendedAction;
  switch (state) {
    case 'Critical':
      summaryText = 'Bu müşteri yüksek riskli — yakın takip gerekli. Son dönemde açık veya çözülmemiş kritik/eskalasyon vakaları mevcut.';
      recommendedAction = 'Supervisor görünürlüğünü aç, proaktif iletişim kur, mevcut açık vakaları öncelikli işlet.';
      break;
    case 'Risky':
      summaryText = 'Müşteri dikkat gerektiriyor. Açık veya tekrar eden vakalar var, müşteri memnuniyeti riskli olabilir.';
      recommendedAction = 'Açık vakaları gözden geçir, tekrar eden konuları araştır, müşteriyle proaktif iletişim planla.';
      break;
    case 'Watch':
      summaryText = 'Müşterinin son dönemde birkaç vakası var. Şu an kritik değil ama örüntü gelişebilir.';
      recommendedAction = 'Geçmiş vakaları kontrol et, benzer şikayetler tekrarlanıyorsa kök neden ara.';
      break;
    default:
      summaryText = 'Müşteri stabil görünüyor. Son dönemde tekrar eden vaka veya SLA risk sinyali yok.';
      recommendedAction = 'Standart akışla devam et — özel önlem gerekmez.';
      break;
  }
  if (evidence.length === 0) evidence.push('Risk sinyali yok');

  return {
    accountId,
    accountName,
    caseId: caseIdForResponse,
    state,
    metrics: {
      openCases,
      recent30d,
      recent60d,
      recent90d,
      slaViolations,
      criticalCases,
      escalatedCases,
    },
    repeatedIssues,
    recentCases,
    summary: {
      text: summaryText,
      evidence,
      recommendedAction,
      source: 'deterministic',
    },
  };
}

/**
 * Mention repository — user-centric mention sorguları (bell badge için).
 * Multi-tenant scope: yalnızca allowedCompanyIds içindeki mention'ları döner.
 */
export const mentionRepo = {
  async listUnreadForUser(userId, allowedCompanyIds) {
    if (!userId || !allowedCompanyIds || allowedCompanyIds.length === 0) {
      return { items: [], total: 0 };
    }
    const items = await prisma.caseMention.findMany({
      where: {
        mentionedUserId: userId,
        seenAt: null,
        companyId: { in: allowedCompanyIds },
      },
      orderBy: { createdAt: 'desc' },
      take: 50, // bell drawer için pratik üst sınır
      select: {
        id: true,
        caseId: true,
        noteId: true,
        mentionedBy: true,
        createdAt: true,
        case: { select: { caseNumber: true, title: true, accountName: true } },
      },
    });
    return { items, total: items.length };
  },

  /** Vaka açıldığında o vakadaki mention'ları seen yap (route caller'ı tetikler). */
  async markCaseAsSeen(userId, caseId, allowedCompanyIds) {
    if (!userId) return { updated: 0 };
    const where = {
      mentionedUserId: userId,
      caseId,
      seenAt: null,
    };
    if (allowedCompanyIds) where.companyId = { in: allowedCompanyIds };
    const result = await prisma.caseMention.updateMany({
      where,
      data: { seenAt: new Date() },
    });
    return { updated: result.count };
  },
};

/**
 * Notification repository — generic CaseNotification okuyucu.
 * (Smoke Audit P0.1 — yazılıyordu, okunmuyordu.)
 *
 * Bell badge bu repo'dan beslenir; mention (CaseMention) ayrı kanal kalır
 * (kendine has audit/read tracking var).
 *
 * eventType kapsamı: 'watcher_update', 'watcher_added', 'note_reaction', vs.
 * Tüm yazıcılar payload'u { message, kind, ... } şeklinde verir.
 */
export const notificationRepo = {
  async listUnreadForUser(userId, allowedCompanyIds) {
    if (!userId || !allowedCompanyIds || allowedCompanyIds.length === 0) {
      return { items: [], total: 0 };
    }
    const items = await prisma.caseNotification.findMany({
      where: {
        recipient: userId,
        readAt: null,
        channel: 'InApp',
        companyId: { in: allowedCompanyIds },
      },
      orderBy: { sentAt: 'desc' },
      take: 50, // bell drawer için pratik üst sınır
      select: {
        id: true,
        caseId: true,
        eventType: true,
        payload: true,
        sentAt: true,
        case: { select: { caseNumber: true, title: true, accountName: true } },
      },
    });
    return { items, total: items.length };
  },

  /**
   * Kullanıcının tüm in-app notification'larını seen yap.
   * Body opsiyonel `ids` array'i ile sadece o id'leri seen yapılabilir
   * (mention seen flow ile uyumlu).
   */
  async markAllAsSeen(userId, allowedCompanyIds, ids) {
    if (!userId) return { updated: 0 };
    const where = {
      recipient: userId,
      channel: 'InApp',
      readAt: null,
    };
    if (allowedCompanyIds) where.companyId = { in: allowedCompanyIds };
    if (Array.isArray(ids) && ids.length > 0) where.id = { in: ids };
    const result = await prisma.caseNotification.updateMany({
      where,
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  },
};

/**
 * notifyWatchers — bir vakaya watcher olarak eklenmiş tüm kullanıcılara
 * CaseNotification yazar (eventType='watcher_update', channel='InApp').
 *
 * Mutation handler'ları (addNote, update, transitionStatus) tarafından
 * çağrılır. Hata olursa ana akışı durdurmaz — sessiz warn.
 *
 * Payload: { message, kind } — kind 'note' | 'status' | 'assignment' |
 * 'priority' | 'escalation' (UI ayrıştırma için ipucu).
 */
async function notifyWatchers({ caseId, companyId, message, kind }) {
  try {
    const watchers = await prisma.caseWatcher.findMany({
      where: { caseId },
      select: { userId: true },
    });
    if (watchers.length === 0) return;
    await prisma.caseNotification.createMany({
      data: watchers.map((w) => ({
        caseId,
        companyId,
        eventType: 'watcher_update',
        channel: 'InApp',
        recipient: w.userId,
        payload: { message, kind },
      })),
    });
    // WR-NOTIFICATION-CENTER Phase 2B — fire-and-forget Aksiyonlarım
    // emit per watcher. Same payload shape as the legacy notification;
    // dedupKey is content-derived so reruns don't double-emit.
    const caseSnapshot = await prisma.case.findUnique({
      where: { id: caseId },
      select: { caseNumber: true, title: true },
    });
    for (const w of watchers) {
      void emitGenericNotification({
        caseId,
        companyId,
        eventType: 'watcher_update',
        recipientUserId: w.userId,
        payload: { message, kind },
        caseNumber: caseSnapshot?.caseNumber,
        caseTitle: caseSnapshot?.title,
      });
    }
  } catch (err) {
    console.warn('[notifyWatchers]', err?.message ?? err);
  }
}

/**
 * notifyAssignmentTargets — atanan kişi / hedef takım üyelerine bildirim
 * yazar. Watcher olmayan hedeflere gider; actor ve mevcut watcher'lar hariç
 * tutulur (notifyWatchers ile çift bildirim olmasın).
 *
 * Hata olursa ana akışı durdurmaz — sessiz warn.
 */
async function notifyAssignmentTargets({
  caseId,
  companyId,
  assignedPersonId,
  assignedTeamId,
  actorUserId,
  message,
  eventType,
  kind,
  extraPayload = {},
}) {
  try {
    const normalizeEmail = (value) =>
      typeof value === 'string' ? value.trim().toLowerCase() : '';

    const personEmails = new Set();

    if (assignedPersonId) {
      const assignedPerson = await prisma.person.findUnique({
        where: { id: assignedPersonId },
        select: { email: true },
      });
      const assignedEmail = normalizeEmail(assignedPerson?.email);
      if (assignedEmail) personEmails.add(assignedEmail);
    }

    if (assignedTeamId) {
      const teamMembers = await prisma.person.findMany({
        where: { teamId: assignedTeamId, isActive: true },
        select: { id: true, email: true },
      });
      for (const member of teamMembers) {
        const email = normalizeEmail(member.email);
        if (email) personEmails.add(email);
      }
    }

    if (personEmails.size === 0) return;

    const users = await prisma.user.findMany({
      where: {
        email: { in: [...personEmails] },
        isActive: true,
        companies: { some: { companyId, isActive: true } },
      },
      select: { id: true, email: true },
    });
    if (users.length === 0) return;

    const resolvedEmails = new Set(
      users.map((u) => normalizeEmail(u.email)).filter(Boolean),
    );
    const unresolvedCount = [...personEmails].filter(
      (email) => !resolvedEmails.has(email),
    ).length;
    if (unresolvedCount > 0) {
      console.warn('[notifyAssignmentTargets] unresolved email targets', {
        caseId,
        count: unresolvedCount,
      });
    }

    const watchers = await prisma.caseWatcher.findMany({
      where: { caseId },
      select: { userId: true },
    });
    const watcherUserIds = new Set(watchers.map((w) => w.userId));

    const recipients = new Set();
    for (const user of users) {
      if (!user.id) continue;
      if (actorUserId && user.id === actorUserId) continue;
      if (watcherUserIds.has(user.id)) continue;
      recipients.add(user.id);
    }
    if (recipients.size === 0) return;

    const payload = { message, kind, ...extraPayload };
    await prisma.caseNotification.createMany({
      data: [...recipients].map((userId) => ({
        caseId,
        companyId,
        eventType,
        channel: 'InApp',
        recipient: userId,
        payload,
      })),
    });

    const caseSnapshot = await prisma.case.findUnique({
      where: { id: caseId },
      select: { caseNumber: true, title: true },
    });
    for (const userId of recipients) {
      void emitGenericNotification({
        caseId,
        companyId,
        eventType,
        recipientUserId: userId,
        payload,
        caseNumber: caseSnapshot?.caseNumber,
        caseTitle: caseSnapshot?.title,
      });
    }
  } catch (err) {
    console.warn('[notifyAssignmentTargets]', err?.message ?? err);
  }
}

/**
 * Watcher repository — vaka takipçileri (FAZ 2 Collab).
 * Multi-tenant scope: vakanın companyId'si allowedCompanyIds'de olmalı.
 * Çapraz tenant watcher imkânsız.
 */
export const watcherRepo = {
  async list(caseId, allowedCompanyIds, actorRole = null) {
    // PR-SD (Codex P2 round-4) — Read path.
    const companyId = await assertCaseInScopeForRead(caseId, allowedCompanyIds, actorRole);
    if (!companyId) return null;
    const rows = await prisma.caseWatcher.findMany({
      where: { caseId },
      orderBy: { addedAt: 'asc' },
    });
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.flatMap((r) => [r.userId, r.addedBy]))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true, email: true },
    });
    const um = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: um.get(r.userId)?.fullName ?? r.userId,
      userEmail: um.get(r.userId)?.email ?? null,
      addedBy: r.addedBy,
      addedByName: um.get(r.addedBy)?.fullName ?? r.addedBy,
      addedAt: r.addedAt,
    }));
  },

  /**
   * Add watcher. Auth (caller responsibility — route layer):
   *  - Add self: any role
   *  - Add others: Supervisor+ OR (Agent + case.assignedPersonId === self.personId)
   *
   * Cross-tenant guard:
   *  - Hedef vakanın companyId'si allowedCompanyIds'de olmalı
   *  - Eklenecek kullanıcı aynı şirkette aktif UserCompany'ye sahip olmalı
   *
   * Duplicate guard: aynı (caseId, userId) ikinci kez eklenirse 'already' döner.
   */
  async add({ caseId, userId, addedBy, allowedCompanyIds, actor }) {
    assertActor(actor, 'watcherRepo.add');
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    // Eklenecek kullanıcı aynı şirkette aktif olmalı (cross-tenant block)
    const valid = await prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        companies: { some: { companyId, isActive: true } },
      },
      select: { id: true, fullName: true },
    });
    if (!valid) {
      return { error: 'invalid_user', message: 'Kullanıcı bu şirkette bulunamadı veya pasif.' };
    }

    // Duplicate check
    const existing = await prisma.caseWatcher.findUnique({
      where: { caseId_userId: { caseId, userId } },
    });
    if (existing) {
      return { error: 'already', message: 'Kullanıcı zaten izleyici.' };
    }

    const c = await prisma.case.findUnique({
      where: { id: caseId },
      select: { caseNumber: true },
    });

    const created = await prisma.caseWatcher.create({
      data: { caseId, userId, companyId, addedBy },
    });

    // CaseActivity — "Selin Gümüş izleyici olarak eklendi"
    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: `${valid.fullName} izleyici olarak eklendi`,
        actionType: 'FieldUpdate',
        fieldName: 'watchers',
        toValue: valid.fullName,
        actor,
        // PR-5 — watcherRepo string actor; addedBy = actor's user.id (route'tan)
        actorUserId: typeof addedBy === 'string' ? addedBy : null,
      },
    });

    // CaseNotification — eklenen kullanıcıya "izleyici eklendi" bildirim.
    // Payload shape diğer notification yazıcılarıyla aynı: { message, kind }.
    // (Smoke Audit P2.2 — UI tek shape okuyabilsin.)
    const watcherAddedPayload = {
      message: `Sizi ${c?.caseNumber ?? caseId} vakasında izleyici olarak eklendi`,
      kind: 'watcher_added',
      addedBy,
    };
    await prisma.caseNotification.create({
      data: {
        caseId,
        companyId,
        eventType: 'watcher_added',
        channel: 'InApp',
        recipient: userId,
        payload: watcherAddedPayload,
      },
    });

    // WR-NOTIFICATION-CENTER Phase 2B — Aksiyonlarım emit (FYI).
    //
    // Codex P2 (Phase 2C P0 fix) — self-add suppression:
    //   When a user self-follows (userId === addedBy), the inbox would
    //   otherwise show "Sizi <case> vakasında izleyici olarak eklendi"
    //   to themselves — noise. The watcher write, CaseActivity row and
    //   the legacy CaseNotification record above remain UNCHANGED
    //   (watcher self-follow behavior preserved); only the new
    //   Aksiyonlarım emit is skipped here. Mirrors the same self-skip
    //   discipline used by reactionRepo (line 3129) and emitMentionsForNote
    //   (R6).
    if (userId !== addedBy) {
      const caseSnapshot = await prisma.case.findUnique({
        where: { id: caseId },
        select: { caseNumber: true, title: true },
      });
      void emitGenericNotification({
        caseId,
        companyId,
        eventType: 'watcher_added',
        recipientUserId: userId,
        payload: watcherAddedPayload,
        caseNumber: caseSnapshot?.caseNumber,
        caseTitle: caseSnapshot?.title,
      });
    }

    return { id: created.id, userId, addedBy, addedAt: created.addedAt };
  },

  /**
   * Remove watcher. Auth (caller responsibility — route layer):
   *  - Self-removal: always allowed
   *  - Remove others: Supervisor+
   */
  async remove({ caseId, userId, allowedCompanyIds, actor }) {
    assertActor(actor, 'watcherRepo.remove');
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    const existing = await prisma.caseWatcher.findUnique({
      where: { caseId_userId: { caseId, userId } },
    });
    if (!existing) return { error: 'not_found', message: 'İzleyici bulunamadı.' };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });

    await prisma.caseWatcher.delete({ where: { id: existing.id } });

    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: `${user?.fullName ?? userId} izleyici listesinden çıkarıldı`,
        actionType: 'FieldUpdate',
        fieldName: 'watchers',
        fromValue: user?.fullName ?? userId,
        actor,
        // PR-5 — watcherRepo.remove string actor; userId scope'ta yok (legacy),
        // null kalır. Display chain string actor'a düşer.
        actorUserId: null,
      },
    });

    return { ok: true };
  },

  /** Kullanıcının izlediği aktif vakalar — Watcher Inbox (ileri faz) için. */
  async listForUser(userId, allowedCompanyIds, securityWhere = null) {
    if (!userId || !allowedCompanyIds || allowedCompanyIds.length === 0) return [];
    const where = { userId, companyId: { in: allowedCompanyIds } };
    if (
      securityWhere &&
      typeof securityWhere === 'object' &&
      !Array.isArray(securityWhere) &&
      Object.keys(securityWhere).length > 0
    ) {
      // Security filter must be part of the initial relation query so `take`
      // caps visible watched cases, not the unfiltered watcher rows.
      where.case = { is: securityWhere };
    }
    const rows = await prisma.caseWatcher.findMany({
      where,
      orderBy: { addedAt: 'desc' },
      take: 200,
      select: {
        addedAt: true,
        case: {
          select: {
            id: true,
            caseNumber: true,
            title: true,
            status: true,
            priority: true,
            companyName: true,
            accountName: true,
            assignedPersonName: true,
            slaViolation: true,
            updatedAt: true,
          },
        },
      },
    });
    return rows
      .filter((r) => r.case)
      .map((r) => ({
        ...shape(r.case),
        addedAt: r.addedAt,
      }));
  },
};

/**
 * Link repository — vakalar arası bağlantı (FAZ 2 Collab).
 * 3 tip: Related (asymmetric), Duplicate (BFF symmetric), Parent (asymmetric).
 *
 * Cross-tenant block: kaynak ve hedef vakanın companyId'leri eşit olmalı +
 * her ikisi de allowedCompanyIds'de.
 *
 * Symmetric: Duplicate eklenince reverse link de yazılır; remove'da reverse
 * de silinir.
 *
 * Cycle guard (Parent): A → B Parent + B → A Parent yasak.
 */
const LINK_TYPE_TR = {
  Related: 'İlişkili',
  Duplicate: 'Mükerrer',
  Parent: 'Üst Vaka',
};

export const linkRepo = {
  async list(caseId, allowedCompanyIds, actorRole = null) {
    // PR-SD (Codex P2 round-4) — Read path.
    const companyId = await assertCaseInScopeForRead(caseId, allowedCompanyIds, actorRole);
    if (!companyId) return null;
    const rows = await prisma.caseLink.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      include: {
        linkedCase: {
          select: {
            id: true,
            caseNumber: true,
            title: true,
            status: true,
            priority: true,
            assignedPersonName: true,
            companyId: true,
          },
        },
      },
    });
    return rows.map((r) => ({
      linkId: r.id,
      linkType: r.linkType,
      linkTypeLabel: LINK_TYPE_TR[r.linkType] ?? r.linkType,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      linkedCase: r.linkedCase
        ? {
            id: r.linkedCase.id,
            caseNumber: r.linkedCase.caseNumber,
            title: r.linkedCase.title,
            status: fromDb({ status: r.linkedCase.status }).status,
            priority: r.linkedCase.priority,
            assignedPersonName: r.linkedCase.assignedPersonName,
          }
        : null,
    }));
  },

  async add({ caseId, linkedCaseId, linkType, createdBy, allowedCompanyIds, actor }) {
    assertActor(actor, 'linkRepo.add');
    if (caseId === linkedCaseId) {
      return { error: 'self_link', message: 'Vaka kendisine bağlanamaz.' };
    }
    if (!['Related', 'Duplicate', 'Parent'].includes(linkType)) {
      return { error: 'invalid_type', message: 'linkType geçersiz.' };
    }

    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    const target = await prisma.case.findUnique({
      where: { id: linkedCaseId },
      select: { id: true, companyId: true, caseNumber: true },
    });
    if (!target) return { error: 'target_not_found', message: 'Hedef vaka bulunamadı.' };
    if (target.companyId !== companyId) {
      return { error: 'cross_tenant', message: 'Farklı şirketteki vakaya bağlantı kurulamaz.' };
    }

    // Duplicate guard (aynı yönde + tipte tekrar)
    const existing = await prisma.caseLink.findUnique({
      where: {
        caseId_linkedCaseId_linkType: { caseId, linkedCaseId, linkType },
      },
    });
    if (existing) {
      return { error: 'already', message: 'Bağlantı zaten var.' };
    }

    // Cycle guard for Parent (A → B Parent, B → A Parent yasak)
    if (linkType === 'Parent') {
      const reverseParent = await prisma.caseLink.findUnique({
        where: {
          caseId_linkedCaseId_linkType: {
            caseId: linkedCaseId,
            linkedCaseId: caseId,
            linkType: 'Parent',
          },
        },
      });
      if (reverseParent) {
        return { error: 'circular', message: 'Döngüsel Parent bağlantısı yapılamaz.' };
      }
    }

    // Forward + reverse (Duplicate için) tek transaction içinde — reverse
    // create fail ederse forward da rollback olur (orphan link kalmaz).
    // Smoke Audit P2.1.
    const created = await prisma.$transaction(async (tx) => {
      const fwd = await tx.caseLink.create({
        data: { caseId, linkedCaseId, linkType, companyId, createdBy },
      });

      if (linkType === 'Duplicate') {
        const reverseExists = await tx.caseLink.findUnique({
          where: {
            caseId_linkedCaseId_linkType: {
              caseId: linkedCaseId,
              linkedCaseId: caseId,
              linkType: 'Duplicate',
            },
          },
        });
        if (!reverseExists) {
          await tx.caseLink.create({
            data: {
              caseId: linkedCaseId,
              linkedCaseId: caseId,
              linkType: 'Duplicate',
              companyId,
              createdBy,
            },
          });
        }
      }

      return fwd;
    });

    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: `Bağlantı eklendi: ${LINK_TYPE_TR[linkType]} → ${target.caseNumber}`,
        actionType: 'FieldUpdate',
        fieldName: 'links',
        toValue: `${LINK_TYPE_TR[linkType]} → ${target.caseNumber}`,
        actor,
        // PR-5 — linkRepo.add: createdBy = link creator user.id (route'tan)
        actorUserId: typeof createdBy === 'string' ? createdBy : null,
      },
    });

    return { linkId: created.id, linkType, linkedCaseNumber: target.caseNumber };
  },

  /**
   * Remove link. Auth (caller responsibility):
   *  - Case owner (assignedPersonId === self.personId) or Supervisor+.
   *
   * Symmetric Duplicate: hem ileri hem geri yön silinir.
   */
  async remove({ caseId, linkId, allowedCompanyIds, actor }) {
    assertActor(actor, 'linkRepo.remove');
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    const existing = await prisma.caseLink.findUnique({
      where: { id: linkId },
      include: { linkedCase: { select: { caseNumber: true } } },
    });
    if (!existing || existing.caseId !== caseId) {
      return { error: 'not_found', message: 'Bağlantı bulunamadı.' };
    }
    if (existing.companyId !== companyId) {
      return { error: 'cross_tenant', message: 'Bağlantı bu vakaya ait değil.' };
    }

    await prisma.caseLink.delete({ where: { id: linkId } });

    // Symmetric Duplicate — reverse'i de sil
    if (existing.linkType === 'Duplicate') {
      const reverse = await prisma.caseLink.findUnique({
        where: {
          caseId_linkedCaseId_linkType: {
            caseId: existing.linkedCaseId,
            linkedCaseId: existing.caseId,
            linkType: 'Duplicate',
          },
        },
      });
      if (reverse) {
        await prisma.caseLink.delete({ where: { id: reverse.id } });
      }
    }

    await prisma.caseActivity.create({
      data: {
        caseId,
        companyId,
        action: `Bağlantı kaldırıldı: ${LINK_TYPE_TR[existing.linkType]} → ${existing.linkedCase?.caseNumber ?? '?'}`,
        actionType: 'FieldUpdate',
        fieldName: 'links',
        fromValue: `${LINK_TYPE_TR[existing.linkType]} → ${existing.linkedCase?.caseNumber ?? '?'}`,
        actor,
        // PR-5 — linkRepo.remove string actor; userId scope'ta yok (legacy), null kalır.
        actorUserId: null,
      },
    });

    return { ok: true };
  },
};

/**
 * Note reaction repository — bir nota (top-level veya reply) emoji reaksiyonu.
 *
 * Toggle davranisi:
 *  - Aynı (noteId, userId, emoji) yoksa: ekle
 *  - Varsa: kaldir (unique constraint nedeniyle "ayni kullanici ayni emoji 2 kez"
 *    yapamaz)
 *
 * Auth/tenant:
 *  - Note'un caseId'si allowedCompanyIds icinde olmali (assertCaseInScope)
 *  - Cross-tenant note id'sine reaction imkansiz
 *
 * Emoji whitelist:
 *  - NOTE_REACTION_EMOJIS'in disindaki emoji'ler 400 ile reddedilir
 *  - "noisy field" değişimi degil, audit/activity yazilmaz (spec: activity-feed
 *    noise yok)
 */
// emoji identifier → görsel sembol (CaseNotification mesaji icin).
// Frontend tarafindaki NOTE_REACTION_META ile ayni esleme.
const NOTE_REACTION_SYMBOL = {
  thumbs_up: '👍',
  eyes: '👀',
  check: '✅',
  important: '❗',
  thanks: '🙏',
};

export const reactionRepo = {
  async toggle({ caseId, noteId, userId, emoji, allowedCompanyIds }) {
    if (!NOTE_REACTION_EMOJIS.includes(emoji)) {
      return { error: 'invalid_emoji', message: 'Bu emoji desteklenmiyor.' };
    }
    const companyId = await assertCaseInScope(caseId, allowedCompanyIds);
    if (!companyId) return null;

    // Note aynı vakaya ait olmalı + sahip bilgisini birlikte çek
    // (bildirim için authorId + authorName lazım).
    const note = await prisma.caseNote.findUnique({
      where: { id: noteId },
      select: { id: true, caseId: true, authorId: true, authorName: true },
    });
    if (!note || note.caseId !== caseId) return null;

    const existing = await prisma.caseNoteReaction.findUnique({
      where: { noteId_userId_emoji: { noteId, userId, emoji } },
      select: { id: true },
    });

    if (existing) {
      // Toggle off — bildirim üretilmez (spec: removal'da notify yok).
      await prisma.caseNoteReaction.delete({ where: { id: existing.id } });
      return { ok: true, action: 'removed', emoji };
    }

    await prisma.caseNoteReaction.create({
      data: { noteId, userId, companyId, emoji },
    });

    // Bildirim — yalnızca: not sahibi biliniyor + sahip kendine tepki vermiyor.
    // Hata sessiz logla (ana akışı durdurma).
    if (note.authorId && note.authorId !== userId) {
      try {
        const reactor = await prisma.user.findUnique({
          where: { id: userId },
          select: { fullName: true, email: true },
        });
        const reactorName = reactor?.fullName ?? reactor?.email ?? 'Bir kullanıcı';
        const symbol = NOTE_REACTION_SYMBOL[emoji] ?? emoji;
        const reactionPayload = {
          message: `${reactorName} notunuza ${symbol} tepkisi verdi`,
          kind: 'reaction',
          emoji,
          noteId,
        };
        await prisma.caseNotification.create({
          data: {
            caseId,
            companyId,
            eventType: 'note_reaction',
            channel: 'InApp',
            recipient: note.authorId,
            payload: reactionPayload,
          },
        });
        // WR-NOTIFICATION-CENTER Phase 2B — Aksiyonlarım emit (FYI).
        const caseSnapshot = await prisma.case.findUnique({
          where: { id: caseId },
          select: { caseNumber: true, title: true },
        });
        void emitGenericNotification({
          caseId,
          companyId,
          eventType: 'note_reaction',
          recipientUserId: note.authorId,
          payload: reactionPayload,
          caseNumber: caseSnapshot?.caseNumber,
          caseTitle: caseSnapshot?.title,
        });
      } catch (err) {
        console.warn('[reactionRepo.notify]', err?.message ?? err);
      }
    }

    return { ok: true, action: 'added', emoji };
  },
};

// ----- helpers -----

// Snooze sonrası dönüş statüsü kararı:
//  - snoozePreviousStatus varsa ona dön (3rdPartyBekleniyor gibi statüler korunsun)
//  - Yoksa: mevcut Cozuldu/IptalEdildi'yse oraya bırak, değilse Acik fallback
//  - Tüm değerler ASCII identifier (Prisma enum), TR mapping caller'ın işi.
function pickRestoreStatus(previous, current) {
  if (previous) return previous;
  if (['Cozuldu', 'IptalEdildi'].includes(current)) return current;
  return 'Acik';
}

function buildWhere(f, allowedCompanyIds, securityWhere = null) {
  if (!f) f = {};
  const where = {};
  const andClauses = [];
  // Multi-tenant izolasyon: liste sorgusu sadece kullanıcının erişebildiği
  // şirketlerin vakalarını döner. allowedCompanyIds boş array ise [] dönmez —
  // Prisma `in: []` ile hiçbir şey döndürmez (doğru davranış: yetkisiz user
  // hiçbir şey görmez).
  if (allowedCompanyIds) {
    andClauses.push({ companyId: { in: allowedCompanyIds } });
  }
  if (
    securityWhere &&
    typeof securityWhere === 'object' &&
    !Array.isArray(securityWhere) &&
    Object.keys(securityWhere).length > 0
  ) {
    andClauses.push(securityWhere);
  }
  // PR-SD — Soft archive default exclude. SystemAdmin'in UI'dan açık seçimi
  // ile includeArchived: true override eder. Diğer query path'lerinde (KPI,
  // report, AI count'ları vb.) DEFAULT EXCLUDE yok — bu PR sadece liste
  // temizliği için minimum scope (1-2 arşivli vaka KPI sayımında tolere
  // edilebilir).
  if (!f.includeArchived) {
    andClauses.push({ isArchived: false });
  }
  // Default: snooze aktif vakalar (snoozeUntil > now) listede gizli — "Later"
  // sekmesi ayrı endpoint kullanıyor. includeSnoozed flag ile override edilir.
  if (!f.includeSnoozed) {
    andClauses.push({ OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: new Date() } }] });
  }
  if (f.search) {
    const q = f.search.trim();
    if (q) {
      andClauses.push({
        OR: [
          { title: { contains: q } },
          { caseNumber: { contains: q } },
          { accountName: { contains: q } },
        ],
      });
    }
  }
  if (andClauses.length) where.AND = andClauses;
  if (f.statuses?.length) where.status = { in: f.statuses };
  if (f.caseType && f.caseType !== 'Tümü') where.caseType = f.caseType;
  if (f.priorities?.length) where.priority = { in: f.priorities };
  if (f.teamId) where.assignedTeamId = f.teamId;
  if (f.personId) where.assignedPersonId = f.personId;
  if (f.dateFrom) where.createdAt = { ...(where.createdAt ?? {}), gte: new Date(f.dateFrom) };
  if (f.dateTo) {
    const to = new Date(f.dateTo);
    to.setHours(23, 59, 59, 999);
    where.createdAt = { ...(where.createdAt ?? {}), lte: to };
  }
  // Phase D — Müşteri eşleştirme bekleyen vakalar filter.
  if (f.customerMatchPending === true) where.customerMatchPending = true;
  if (f.customerMatchPending === false) where.customerMatchPending = false;
  // M6.3b Faz 1 — "Yanıt bekliyor" (Case.pendingCustomerReply K4 state).
  // @@index([companyId, pendingCustomerReply]) ile DB-side hızlı.
  if (f.pendingCustomerReply === true) where.pendingCustomerReply = true;
  if (f.pendingCustomerReply === false) where.pendingCustomerReply = false;
  // KPI tile click intents — sayım ve liste tek truth source kullansın diye:
  if (f.slaViolation === true) where.slaViolation = true;
  if (f.unassigned === true) {
    where.assignedPersonId = null;
    where.status = { notIn: ['Cozuldu', 'IptalEdildi'] };
  }
  if (f.resolvedToday === true) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    where.resolvedAt = { gte: start, lte: end };
    where.status = { in: ['Cozuldu', 'IptalEdildi'] };
  }
  // WR-A4 — Project-bazlı vaka filtresi.
  if (f.accountProjectId) where.accountProjectId = f.accountProjectId;
  return where;
}

function mergeSecurityWhere(where, securityWhere = null) {
  if (
    !securityWhere ||
    typeof securityWhere !== 'object' ||
    Array.isArray(securityWhere) ||
    Object.keys(securityWhere).length === 0
  ) {
    return where;
  }

  const next = { ...where };
  const existingAnd = Array.isArray(where?.AND)
    ? where.AND
    : where?.AND
      ? [where.AND]
      : [];
  next.AND = [...existingAnd, securityWhere];
  return next;
}
