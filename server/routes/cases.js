import express, { Router } from 'express';
import { createHash } from 'crypto';
import { caseRepository, mentionRepo, watcherRepo, linkRepo, reactionRepo, notificationRepo, CaseAccessError, CaseValidationError, SMART_TICKET_ANALYSIS_CACHE_VERSION } from '../db/caseRepository.js';
import { caseEmailRepository } from '../db/caseEmailRepository.js';
import { externalMailFromAliasRepo } from '../db/externalMailFromAliasRepository.js';
import { caseEmailSender } from '../lib/caseEmailSender.js';
import { prisma } from '../db/client.js';
import { signStorageToken, verifyStorageToken, saveObject, statObject, createObjectStream } from '../db/storage.js';
import {
  solutionStepRepository,
  SolutionStepError,
  extractAiDrafts,
} from '../db/solutionStepRepository.js';
import { externalKbClient, classifyKbFailure } from '../lib/externalKbClient.js';
import { externalKbSettingRepo } from '../db/externalKbSettingRepository.js';
import { markInProgressForCase } from '../db/actionItemRepository.js';
import { accountRepository } from '../db/accountRepository.js';
import { customerMatchRepository } from '../db/customerMatchRepository.js';
import { verifyJwt, requireRole } from '../db/auth.js';
import { requireActor } from '../lib/actor.js';
import { authorizationPolicyRepository } from '../db/authorizationPolicyRepository.js';
import {
  AuthorizationRuntimeError,
  assertRequiredFieldsPresent,
  assertDenyOnlyResourceAccess,
  buildCurrentAuthorizationUser,
  compileSecurityFilterOverrides,
  resolveAuthorizationTeamId,
} from '../lib/authorizationRuntime.js';
import { runSnoozeWakeup } from '../cron/snoozeWakeup.js';
import { triggerTransferRootCause, generateTransferBrief } from '../lib/transferAi.js';
import { generateActionSummary } from '../lib/actionSummaryAi.js';

const router = Router();

/**
 * Cron tetikleyicisi — verifyJwt'den ÖNCE mount edilir.
 *
 * Vercel Hobby plan günde 1'den fazla cron desteklemediği için bu endpoint
 * UptimeRobot tarafından (her 5 dk) tetikleniyor. İki auth header kabul:
 *   - Authorization: Bearer ${CRON_SECRET}  (Vercel Cron — ileride Pro plan)
 *   - x-uptime-secret: ${CRON_SECRET}       (UptimeRobot custom header)
 *
 * CRON_SECRET env'de yoksa endpoint kapalı (503) — production'da set edilmeli.
 * Detaylar: docs/INCIDENTS.md §5 (Operational Notes).
 */
router.post('/cron/snooze-wakeup', async (req, res) => {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return res.status(503).json({ error: 'cron_disabled', message: 'CRON_SECRET tanımlı değil.' });
  }
  const bearerMatch = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  const bearerOk = bearerMatch && bearerMatch[1] === expected;
  const uptimeOk = req.headers['x-uptime-secret'] === expected;
  if (!bearerOk && !uptimeOk) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const result = await runSnoozeWakeup();
    res.json(result);
  } catch (err) {
    console.error('[cron:snooze-wakeup]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

// ─────────────────────────────────────────────────────────────────
// Storage endpoints (Faz 4 — local disk).
//  - PUT raw upload: PR-4 follow-up (Codex P2) — artık verifyJwt zorunlu.
//    Token + req.user.id binding: User A token'ını User B alsa bile
//    PUT atamaz (token.userId !== req.user.id → 403).
//  - GET raw download: tarayıcı <a> tıklaması header taşıyamaz — verifyJwt
//    BYPASS edilir; sadece HMAC token doğrulanır. Bu kasıtlı.
// ─────────────────────────────────────────────────────────────────

/**
 * Adım 2 — PUT /api/cases/:id/files/upload?token=... (raw body, max 25MB)
 *
 * PR-4 follow-up (Codex P2): JWT auth zorunlu kılındı. Token'daki userId
 * ile req.user.id eşleşmek zorunda. PUT verifyJwt'den ÖNCE mount ediliyor
 * (line 124) — bu route için verifyJwt inline middleware olarak çağrılır.
 */
router.put(
  '/:id/files/upload',
  verifyJwt, // ← inline: PUT için JWT auth zorunlu (Codex P2 fix)
  express.raw({ type: () => true, limit: '25mb' }),
  async (req, res) => {
    try {
      const payload = verifyStorageToken(String(req.query.token ?? ''));
      if (!payload || payload.typ !== 'upload' || payload.caseId !== req.params.id) {
        return res.status(401).json({ error: 'invalid_token', message: 'Yükleme izni geçersiz veya süresi dolmuş.' });
      }
      // PR-4 follow-up (Codex P2) — User binding enforcement: token'ı
      // çalan/paylaşan kullanıcı PUT atamasın. Asıl request sahibi sadece
      // kendi token'ıyla PUT yapabilir; finalize zaten userId match yapıyor
      // ama bu BYTES yazımını da bağlar (audit trail bütünlüğü).
      if (payload.userId !== req.user?.id) {
        return res.status(403).json({ error: 'user_mismatch', message: 'Yükleme token\'ı farklı bir kullanıcıya ait.' });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'empty_body', message: 'Dosya içeriği boş.' });
      }
      await saveObject(payload.path, req.body);
      res.json({ success: true, path: payload.path });
    } catch (err) {
      const status = err?.status ?? 500;
      console.error('[storage] upload', err?.message ?? err);
      res.status(status).json({ error: 'storage_error', message: err?.message ?? 'Dosya kaydedilemedi.' });
    }
  },
);

/** GET /api/cases/:id/files/:fileId/raw?token=... — dosyayı stream eder */
router.get('/:id/files/:fileId/raw', async (req, res) => {
  try {
    const payload = verifyStorageToken(String(req.query.token ?? ''));
    if (
      !payload ||
      payload.typ !== 'download' ||
      payload.caseId !== req.params.id ||
      payload.fileId !== req.params.fileId
    ) {
      return res.status(401).json({ error: 'invalid_token', message: 'İndirme izni geçersiz veya süresi dolmuş.' });
    }
    const st = await statObject(payload.path);
    if (!st) return res.status(404).json({ error: 'not_found', message: 'Dosya bulunamadı.' });

    const fileName = payload.fileName ?? 'dosya';
    // RFC 5987 — Türkçe karakterli dosya adları için filename* kullan.
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    // 2026-07-03 fix — Content-Type gerçek mime'a set. Önceki hard-coded
    // application/octet-stream mail cid inline render'da kırık img'e sebep
    // oluyordu (UNV-1000093: <img src=".../raw?token=..."> browser
    // octet-stream'i image olarak render edemez). payload.mimeType
    // opsiyonel — caller (mail-eki download / case attachment download)
    // token oluştururken geçirir; yoksa geriye uyum için octet-stream.
    //
    // Content-Disposition: caller `disposition` alanı geçirebilir. Mail
    // cid inline için 'inline' (browser render için gerekli değil, defensive);
    // case attachment normal download için 'attachment' (download prompt).
    const disposition = payload.disposition === 'inline' ? 'inline' : 'attachment';
    res.setHeader('Content-Length', st.size);
    res.setHeader('Content-Type', payload.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    createObjectStream(payload.path)
      .on('error', (err) => {
        console.error('[storage] stream', err?.message ?? err);
        if (!res.headersSent) res.status(500).end();
        else res.destroy();
      })
      .pipe(res);
  } catch (err) {
    const status = err?.status ?? 500;
    console.error('[storage] download', err?.message ?? err);
    res.status(status).json({ error: 'storage_error', message: err?.message ?? 'Dosya indirilemedi.' });
  }
});

// Spec §13 — Tüm case endpoint'leri auth gerekli. Rol-spesifik kısıtlar
// (örn. iptal için Supervisor) ileri sprint'te eklenir.
router.use(verifyJwt);

/**
 * Hata wrapper'ı — async route'lardaki throw'ları 500'e çevirir.
 * caseRepository null/undefined dönerse 404 gönderilir.
 * CaseAccessError (multi-tenant scope ihlali) → 403.
 */
function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof CaseAccessError) {
        return res.status(403).json({ error: 'forbidden', message: err.message });
      }
      if (err instanceof CaseValidationError) {
        return res.status(err.status ?? 400).json({ error: err.code ?? 'validation_error', message: err.message });
      }
      if (err instanceof SolutionStepError) {
        return res.status(err.status ?? 400).json({ error: err.code ?? 'solution_step_error', message: err.message });
      }
      if (err instanceof AuthorizationRuntimeError) {
        return res.status(err.status ?? 403).json({ error: err.code ?? 'authorization_forbidden', message: err.message });
      }
      console.error('[cases]', err);
      res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
    }
  };
}

function isAuthorizationResourceEnforcementEnabled() {
  return process.env.AUTHORIZATION_RESOURCE_ENFORCEMENT_ENABLED === 'true';
}

function isAuthorizationFieldEnforcementEnabled() {
  return process.env.AUTHORIZATION_FIELD_ENFORCEMENT_ENABLED === 'true';
}

function isAuthorizationSecurityFilterEnforcementEnabled() {
  return process.env.AUTHORIZATION_SECURITY_FILTER_ENFORCEMENT_ENABLED === 'true';
}

function hasWhereClause(where) {
  return where && typeof where === 'object' && !Array.isArray(where) && Object.keys(where).length > 0;
}

async function buildCaseListSecurityWhere(req) {
  if (!isAuthorizationSecurityFilterEnforcementEnabled()) return null;
  const allowedCompanyIds = Array.isArray(req.user?.allowedCompanyIds)
    ? req.user.allowedCompanyIds
    : [];
  if (allowedCompanyIds.length === 0) return null;

  const teamId = await resolveAuthorizationTeamId(prisma, req.user);
  const scopedClauses = [];
  let hasAnySecurityFilter = false;

  for (const companyId of allowedCompanyIds) {
    const policyUser = buildCurrentAuthorizationUser(req.user, companyId, teamId);
    const overrides = await authorizationPolicyRepository.listOverrides(
      companyId,
      req.user.allowedCompanyIds,
    );
    const compiled = compileSecurityFilterOverrides({
      resourceKey: 'case',
      user: policyUser,
      overrides,
    });
    if (hasWhereClause(compiled)) {
      hasAnySecurityFilter = true;
      scopedClauses.push({ AND: [{ companyId }, compiled] });
    } else {
      scopedClauses.push({ companyId });
    }
  }

  if (!hasAnySecurityFilter) return null;
  if (scopedClauses.length === 1) return scopedClauses[0];
  return { OR: scopedClauses };
}

async function isCaseVisibleBySecurityFilter(req, {
  caseId = req.params.id,
  companyId = null,
} = {}) {
  if (!isAuthorizationSecurityFilterEnforcementEnabled()) return true;
  const allowedCompanyIds = Array.isArray(req.user?.allowedCompanyIds)
    ? req.user.allowedCompanyIds
    : [];
  if (!caseId || allowedCompanyIds.length === 0) return true;

  let targetCompanyId = companyId;
  if (targetCompanyId && !allowedCompanyIds.includes(targetCompanyId)) return false;
  if (!targetCompanyId) {
    const row = await prisma.case.findFirst({
      where: { id: caseId, companyId: { in: allowedCompanyIds } },
      select: { companyId: true },
    });
    if (!row) return false;
    targetCompanyId = row.companyId;
  }

  const teamId = await resolveAuthorizationTeamId(prisma, req.user);
  const policyUser = buildCurrentAuthorizationUser(req.user, targetCompanyId, teamId);
  const overrides = await authorizationPolicyRepository.listOverrides(
    targetCompanyId,
    req.user.allowedCompanyIds,
  );
  const compiled = compileSecurityFilterOverrides({
    resourceKey: 'case',
    user: policyUser,
    overrides,
  });
  if (!hasWhereClause(compiled)) return true;

  const visible = await prisma.case.findFirst({
    where: {
      id: caseId,
      companyId: targetCompanyId,
      AND: [compiled],
    },
    select: { id: true },
  });
  return Boolean(visible);
}

async function assertCaseSecurityFilterAccess(req, {
  caseId = req.params.id,
  companyId = null,
} = {}) {
  const visible = await isCaseVisibleBySecurityFilter(req, { caseId, companyId });
  if (!visible) {
    throw new AuthorizationRuntimeError('Vaka bulunamadı.', 404, 'case_not_found');
  }
  return null;
}

async function filterVisibleLinkedCases(req, links) {
  if (!isAuthorizationSecurityFilterEnforcementEnabled()) return links;
  const visibleLinks = [];
  for (const link of links ?? []) {
    const linkedCaseId = link?.linkedCase?.id;
    if (!linkedCaseId) {
      visibleLinks.push(link);
      continue;
    }
    const visible = await isCaseVisibleBySecurityFilter(req, { caseId: linkedCaseId });
    if (visible) visibleLinks.push(link);
  }
  return visibleLinks;
}

async function assertCaseResourcePolicy(req, { resourceKey, action, baselineAllowed = true }) {
  const resourceEnabled = isAuthorizationResourceEnforcementEnabled();
  const securityFilterEnabled = isAuthorizationSecurityFilterEnforcementEnabled();
  if (!resourceEnabled && !securityFilterEnabled) return null;
  const c = await caseRepository.get(req.params.id, req.user.allowedCompanyIds, req.user.role);
  if (!c) {
    throw new AuthorizationRuntimeError('Vaka bulunamadı.', 404, 'case_not_found');
  }
  await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: c.companyId });
  if (!resourceEnabled) return null;
  const teamId = await resolveAuthorizationTeamId(prisma, req.user);
  const policyUser = buildCurrentAuthorizationUser(req.user, c.companyId, teamId);
  const overrides = await authorizationPolicyRepository.listOverrides(
    c.companyId,
    req.user.allowedCompanyIds,
  );
  return assertDenyOnlyResourceAccess({
    resourceKey,
    action,
    user: policyUser,
    overrides,
    baselineAllowed,
  });
}

async function assertCompanyResourcePolicy(req, {
  companyId,
  resourceKey,
  action,
  baselineAllowed = true,
}) {
  if (!isAuthorizationResourceEnforcementEnabled()) return null;
  if (!companyId || typeof companyId !== 'string') {
    throw new AuthorizationRuntimeError('Şirket bilgisi gerekli.', 400, 'company_required');
  }
  if (!Array.isArray(req.user.allowedCompanyIds) || !req.user.allowedCompanyIds.includes(companyId)) {
    throw new AuthorizationRuntimeError('Bu şirket için yetkin yok.', 403, 'company_forbidden');
  }
  const teamId = await resolveAuthorizationTeamId(prisma, req.user);
  const policyUser = buildCurrentAuthorizationUser(req.user, companyId, teamId);
  const overrides = await authorizationPolicyRepository.listOverrides(
    companyId,
    req.user.allowedCompanyIds,
  );
  return assertDenyOnlyResourceAccess({
    resourceKey,
    action,
    user: policyUser,
    overrides,
    baselineAllowed,
  });
}

function hasBulkUpdateValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function bulkResourceActions(updates = {}) {
  const hasAssignment =
    hasBulkUpdateValue(updates.assignedPersonId) ||
    hasBulkUpdateValue(updates.assignedTeamId);
  const hasGeneralUpdate =
    hasBulkUpdateValue(updates.priority) ||
    hasBulkUpdateValue(updates.status);

  const actions = new Set();
  if (hasGeneralUpdate) actions.add('update');
  if (hasAssignment) actions.add('assign');
  return Array.from(actions);
}

async function assertBulkCaseResourcePolicy(req, { caseIds, updates }) {
  if (!isAuthorizationResourceEnforcementEnabled()) return null;
  if (!Array.isArray(caseIds) || caseIds.length === 0) return null;

  const allowedCompanyIds = Array.isArray(req.user.allowedCompanyIds)
    ? req.user.allowedCompanyIds
    : [];
  const cases = await prisma.case.findMany({
    where: {
      id: { in: caseIds },
      companyId: { in: allowedCompanyIds },
    },
    select: { companyId: true },
  });
  const companyIds = Array.from(new Set(cases.map((c) => c.companyId).filter(Boolean)));
  const actions = bulkResourceActions(updates);
  if (actions.length === 0) return null;

  for (const companyId of companyIds) {
    for (const action of actions) {
      await assertCompanyResourcePolicy(req, {
        companyId,
        resourceKey: 'case',
        action,
      });
    }
  }
  return null;
}

// Codex #437 P2 — bulk-archive koleksiyon route'u: assertCaseResourcePolicy
// req.params.id okur (koleksiyonda undefined → enforcement açıkken anında
// 404). assertBulkCaseResourcePolicy deseninin arşiv aksiyonu için karşılığı:
// istenen id'lerin şirketleri üstünden company-aware policy kontrolü.
//
// Codex #438 P1 — tekil arşiv paritesi TAM olmalı: tekil yol
// assertCaseSecurityFilterAccess'ten geçer; güvenlik filtresiyle kısıtlı bir
// SystemAdmin görünmeyen vaka id'lerini toplu arşivleyememeli. Vaka başına
// görünürlük kontrolü eklendi (ilk gizli vakada 404 — route repo'ya inmeden
// keser, hiçbir şey yazılmaz; görünürlük yardımcısı kendi bayrağını içeride
// kontrol eder, kapalıyken no-op).
async function assertBulkCaseArchivePolicy(req, { caseIds }) {
  const resourceEnabled = isAuthorizationResourceEnforcementEnabled();
  const securityFilterEnabled = isAuthorizationSecurityFilterEnforcementEnabled();
  if (!resourceEnabled && !securityFilterEnabled) return null;
  if (!Array.isArray(caseIds) || caseIds.length === 0) return null;
  // Codex #439 P2 — üst sınır kısa devresi: guard, repo'nun max-100
  // validasyonundan ÖNCE koşar; 100'ü aşan ham diziyle sınırsız IN sorgusu +
  // vaka başına policy kontrolü çalıştırma. Sorgulamadan çekil — repo
  // kontrollü 400'ü üretir, hiçbir şey yazılmaz.
  if (caseIds.length > 100) return null;

  const allowedCompanyIds = Array.isArray(req.user.allowedCompanyIds)
    ? req.user.allowedCompanyIds
    : [];
  const cases = await prisma.case.findMany({
    where: {
      id: { in: caseIds },
      companyId: { in: allowedCompanyIds },
    },
    select: { id: true, companyId: true },
  });
  for (const c of cases) {
    await assertCaseSecurityFilterAccess(req, { caseId: c.id, companyId: c.companyId });
  }
  if (!resourceEnabled) return null;
  const companyIds = Array.from(new Set(cases.map((c) => c.companyId).filter(Boolean)));
  for (const companyId of companyIds) {
    await assertCompanyResourcePolicy(req, {
      companyId,
      resourceKey: 'case',
      action: 'archive',
    });
  }
  return null;
}

function transitionResourceAction(nextStatus) {
  return nextStatus === 'Çözüldü' || nextStatus === 'İptal Edildi'
    ? 'close'
    : 'update';
}

function closeFieldCandidatesFor(nextStatus) {
  if (nextStatus === 'Çözüldü') {
    return [
      'resolutionNote',
      'rootCauseGroup',
      'rootCauseDetail',
      'resolutionType',
      'permanentPrevention',
    ];
  }
  if (nextStatus === 'İptal Edildi') {
    return ['cancellationReason'];
  }
  return [];
}

function closeFieldValuesFrom(payload) {
  const closure = payload?.smartTicketClosure && typeof payload.smartTicketClosure === 'object'
    ? payload.smartTicketClosure
    : {};
  return {
    resolutionNote: payload?.resolutionNote,
    cancellationReason: payload?.cancellationReason,
    rootCauseGroup: closure.rootCauseGroup,
    rootCauseDetail: closure.rootCauseDetail,
    resolutionType: closure.resolutionType,
    permanentPrevention: closure.permanentPrevention,
  };
}

async function assertCaseCloseRequiredFields(req, { nextStatus, payload }) {
  if (!isAuthorizationFieldEnforcementEnabled()) return null;
  const fields = closeFieldCandidatesFor(nextStatus);
  if (fields.length === 0) return null;
  const c = await caseRepository.get(req.params.id, req.user.allowedCompanyIds, req.user.role);
  if (!c) {
    throw new AuthorizationRuntimeError('Vaka bulunamadı.', 404, 'case_not_found');
  }
  const teamId = await resolveAuthorizationTeamId(prisma, req.user);
  const policyUser = buildCurrentAuthorizationUser(req.user, c.companyId, teamId);
  const overrides = await authorizationPolicyRepository.listOverrides(
    c.companyId,
    req.user.allowedCompanyIds,
  );
  return assertRequiredFieldsPresent({
    scope: 'case.close',
    resourceKey: 'case',
    fields,
    values: closeFieldValuesFrom(payload),
    user: policyUser,
    overrides,
  });
}

/**
 * GET /api/cases — list + filter + pagination
 * Query params: search, statuses (CSV), caseType, priorities (CSV), teamId,
 *               personId, dateFrom, dateTo, page, pageSize,
 *               customerMatchPending (true|false — Supervisor+ only)
 */
const CUSTOMER_MATCH_QUEUE_ROLES = ['Supervisor', 'CSM', 'Admin', 'SystemAdmin'];

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const f = req.query;
    // Phase D: müşteri eşleştirme bekleyen vaka filter'ı sadece Supervisor+
    // tarafından kullanılabilir. Agent/Backoffice query param gönderse bile
    // ignore edilir — sızıntı yok ama sessiz davranış.
    let customerMatchPending;
    if (f.customerMatchPending !== undefined && CUSTOMER_MATCH_QUEUE_ROLES.includes(req.user.role)) {
      if (f.customerMatchPending === 'true') customerMatchPending = true;
      else if (f.customerMatchPending === 'false') customerMatchPending = false;
    }

    // KPI tile click intents — server-side resolution (assignedToMe → personId,
    // teamScope → Supervisor'ın Person.teamId'si). Query params boş veya kötü
    // niyetli olursa silent ignore: tek-sürçük yapan input filter yok.
    let personId = f.personId;
    if (f.assignedToMe === 'true' && req.user.personId) {
      personId = req.user.personId;
    }
    let teamId = f.teamId;
    if (f.teamScope === 'true' && req.user.role === 'Supervisor' && req.user.personId) {
      const sup = await (await import('../db/client.js')).prisma.person.findUnique({
        where: { id: req.user.personId },
        select: { teamId: true },
      });
      if (sup?.teamId) teamId = sup.teamId;
    }
    // Takım Havuzu (Supervisor) — ?teamIds=id1,id2 CSV. Client, kendi
    // takımıyla aynı defaultSupportLevel'a sahip takımların id'lerini
    // bootstrap'te zaten yüklü teams listesinden çıkarıp gönderiyor.
    // Ek bir sızıntı yok: sonuç yine de companyId scope + roleDefaultScope
    // ile AND'lenir (tenant dışı/erişimsiz takım id'si boş sonuç verir).
    const teamIds = typeof f.teamIds === 'string'
      ? f.teamIds.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    // Rol bazlı varsayılan liste kapsamı (sadece liste ekranı, güvenlik kısıtı değil).
    // Agent: her zaman uygulanır. Supervisor/Backoffice: roleDefaultView=off gelmediği sürece uygulanır.
    // CSM/Admin/SystemAdmin: kapsam uygulanmaz.
    const ROLE_DEFAULT_SCOPE_OPEN = ['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi'];
    let roleDefaultScope = null;
    const roleDefaultViewOff = f.roleDefaultView === 'off';
    if (req.user.role === 'Agent' && req.user.personId) {
      const { prisma: prismaCases } = await import('../db/client.js');
      const agentPerson = await prismaCases.person.findUnique({
        where: { id: req.user.personId },
        select: { teamId: true, isTeamLead: true, supportLevel: true },
      });
      const agentTeamId = agentPerson?.teamId ?? null;
      const canSeeTeamPool = agentPerson?.isTeamLead === true || ['L2', 'L3'].includes(agentPerson?.supportLevel ?? '');
      const orClauses = [
        { assignedPersonId: req.user.personId },
        { createdByUserId: req.user.id },
      ];
      if (!agentTeamId) {
        // Takımı olmayan Agent → mevcut davranış (takımsız + tüm havuz)
        orClauses.push({ assignedPersonId: null, status: { in: ROLE_DEFAULT_SCOPE_OPEN } });
      } else if (canSeeTeamPool) {
        // Takım lideri veya L2/L3 → kendi takım havuzu + takımsız havuz
        orClauses.push({ assignedPersonId: null, assignedTeamId: agentTeamId, status: { in: ROLE_DEFAULT_SCOPE_OPEN } });
        orClauses.push({ assignedPersonId: null, assignedTeamId: null, status: { in: ROLE_DEFAULT_SCOPE_OPEN } });
      } else {
        // L1 Agent with team → hiçbir sahipsiz/atanmamış havuz görünmez
        // (ne kendi takımının ne takımsız/genel havuzun). Kayıt üzerine
        // atama yalnız L1 takım liderinin (Supervisor) elinde — L1 Agent
        // kendi kendine "Üstlen" ile sahipsiz bir kayıt alamaz. Yalnız
        // kendine atanmış + kendi açtığı vakaları görür (üstteki ortak
        // orClauses zaten bunları kapsıyor).
      }
      roleDefaultScope = { OR: orClauses };
    } else if (['Supervisor', 'Backoffice'].includes(req.user.role) && req.user.personId && !roleDefaultViewOff) {
      const { prisma } = await import('../db/client.js');
      const myPerson = await prisma.person.findUnique({
        where: { id: req.user.personId },
        select: { teamId: true },
      });
      if (myPerson?.teamId) {
        const teamMemberIds = (
          await prisma.person.findMany({ where: { teamId: myPerson.teamId }, select: { id: true } })
        ).map((p) => p.id);
        roleDefaultScope = {
          OR: [
            { assignedTeamId: myPerson.teamId },
            { assignedPersonId: { in: teamMemberIds } },
            { assignedPersonId: req.user.personId },
            { createdByUserId: req.user.id },
            { assignedPersonId: null, status: { in: ROLE_DEFAULT_SCOPE_OPEN } },
          ],
        };
      }
    }

    // M6.3b Faz 1 — "Yanıt bekliyor" filtresi (tüm roller; pendingCustomerReply
    // K4 türetilmiş state, sızıntı yok).
    let pendingCustomerReply;
    if (f.pendingCustomerReply === 'true') pendingCustomerReply = true;
    else if (f.pendingCustomerReply === 'false') pendingCustomerReply = false;

    const filters = {
      search: f.search,
      statuses: f.statuses ? f.statuses.split(',') : undefined,
      caseType: f.caseType,
      priorities: f.priorities ? f.priorities.split(',') : undefined,
      teamId,
      teamIds: teamIds && teamIds.length > 0 ? teamIds : undefined,
      personId,
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
      customerMatchPending,
      pendingCustomerReply,
      slaViolation: f.slaViolation === 'true' ? true : undefined,
      resolvedToday: f.resolvedToday === 'true' ? true : undefined,
      unassigned: f.unassigned === 'true' ? true : undefined,
      // WR-A4 — Proje filtresi.
      accountProjectId: typeof f.accountProjectId === 'string' && f.accountProjectId ? f.accountProjectId : undefined,
      // PR-SD — Arşivli vakaları dahil et: sadece SystemAdmin. Diğer roller
      // query param gönderse bile sessizce ignore edilir (sızıntı yok).
      includeArchived: f.includeArchived === 'true' && req.user.role === 'SystemAdmin' ? true : undefined,
    };
    // WR-H1 — Defansif large-query guard.
    // pageSize [1, 200] aralığına clamp edilir; pagination her zaman üretilir
    // (unbounded findMany engellenir). Frontend sayfa başına istediği kadar istek atar.
    const HARD_MAX_PAGE_SIZE = 200;
    const requestedPageSize = Number(f.pageSize ?? 25);
    const safePageSize = Math.min(
      HARD_MAX_PAGE_SIZE,
      Math.max(1, Number.isFinite(requestedPageSize) ? requestedPageSize : 25),
    );
    const safePage = Math.max(1, Number(f.page) || 1);
    const pagination = { page: safePage, pageSize: safePageSize };

    // Sort params — frontend'in kolon başlığı tıklamalarından gelir.
    const VALID_SORT_KEYS = ['updatedAt', 'createdAt', 'sla', 'caseNumber', 'title',
      'accountName', 'assignment', 'priority', 'status', 'caseType'];
    const sortBy  = VALID_SORT_KEYS.includes(f.sortBy)  ? f.sortBy  : 'updatedAt';
    const sortDir = f.sortDir === 'asc' ? 'asc' : 'desc';
    const securityWhere = await buildCaseListSecurityWhere(req);

    const { items, total } = await caseRepository.list({
      filters,
      pagination,
      sortBy,
      sortDir,
      allowedCompanyIds: req.user.allowedCompanyIds,
      securityWhere,
      roleDefaultScope,
    });
    res.json({ value: items, '@odata.count': total });
  }),
);

/**
 * GET /api/cases/stats — Role-aware KPI counts for the cases list tile bar.
 *
 * Response shape switches by role:
 *   Agent/Backoffice/CSM → { mode:'personal', assignedToMe, slaRiskMine, resolvedToday, snoozedMine }
 *   Supervisor           → { mode:'team', teamOpenCount, teamSlaRisk, teamEscalation, teamResolvedToday, supervisorTeamId }
 *   Admin/SystemAdmin    → { mode:'operations', totalOpen, slaViolation, critical, resolvedToday }
 *
 * companyId scope enforced via req.user.allowedCompanyIds. Closed statuses
 * (Cozuldu, IptalEdildi) intentionally not counted in open/action metrics.
 *
 * LIMITATION: Supervisor schema'da çoklu-takım üyeliğini modellemediği için
 * "ekibim" = Person.teamId (tek takım). Person yoksa fallback: assignedTeamId
 * NOT NULL (allowed companies içinde) — supervisor takım bilgisi olmadan
 * görünür operasyonu kapsar.
 */
router.get(
  '/stats',
  asyncRoute(async (req, res) => {
    const securityWhere = await buildCaseListSecurityWhere(req);
    const stats = await caseRepository.getStats({ user: req.user, securityWhere });
    res.json(stats);
  }),
);

/** GET /api/cases/duplicate-check?accountId=...&caseType=... */
router.get(
  '/duplicate-check',
  asyncRoute(async (req, res) => {
    const { accountId, caseType } = req.query;
    if (!accountId || !caseType) {
      return res.status(400).json({ error: 'accountId ve caseType gerekli' });
    }
    const securityWhere = await buildCaseListSecurityWhere(req);
    const found = await caseRepository.findOpenCaseFor(
      accountId,
      caseType,
      req.user.allowedCompanyIds,
      securityWhere,
    );
    res.json({ case: found });
  }),
);

/**
 * GET /api/cases/snoozed — kullanıcının ertelediği aktif vakalar (Inbox Later).
 * personId User.personId üzerinden çözülür; kullanıcının Person bağlantısı
 * yoksa boş döner.
 */
router.get(
  '/snoozed',
  asyncRoute(async (req, res) => {
    const securityWhere = await buildCaseListSecurityWhere(req);
    const { items, total } = await caseRepository.listSnoozedForUser(
      req.user.personId,
      req.user.allowedCompanyIds,
      securityWhere,
    );
    res.json({ value: items, '@odata.count': total });
  }),
);

/**
 * GET /api/cases/watching — kullanıcının izlediği aktif vakalar (Watcher Inbox).
 * companyId scope. /:id rotasından önce mount edilmeli (Express order eşleşmesi).
 */
router.get(
  '/watching',
  asyncRoute(async (req, res) => {
    const securityWhere = await buildCaseListSecurityWhere(req);
    const items = await watcherRepo.listForUser(
      req.user.id,
      req.user.allowedCompanyIds,
      securityWhere,
    );
    res.json({ value: items, '@odata.count': items.length });
  }),
);

/**
 * POST /api/cases/bulk-update — Faz 1.5 Madde 2.
 * Body: { caseIds: string[] (max 100), updates: { assignedPersonId?, assignedTeamId?, priority?, status? } }
 * Status'te kapatma yasak. Cross-tenant case ID denenirse 403, hiçbir şey güncellenmez.
 */
router.post(
  '/bulk-update',
  asyncRoute(async (req, res) => {
    const body = req.body ?? {};
    const actorObj = requireActor(req); // PR-5 follow-up
    await assertBulkCaseResourcePolicy(req, {
      caseIds: body.caseIds,
      updates: body.updates ?? {},
    });
    const result = await caseRepository.bulkUpdate(
      { caseIds: body.caseIds, updates: body.updates ?? {} },
      req.user.fullName,
      req.user.allowedCompanyIds,
      actorObj,
    );
    if (result?.error) return res.status(400).json(result);
    res.json(result);
  }),
);

/**
 * POST /api/cases/bulk-archive — toplu soft-archive (SystemAdmin-only).
 * Body: { caseIds: string[] (max 100), reason: string (min 3) }
 * Tekil /:id/archive paritesi: rol + resource policy aynı; idempotent
 * (zaten arşivli olanlar sayılır, hata üretmez). Cross-tenant id → 403,
 * hiçbir şey yazılmaz. 2026-07-06 mail döngüsü temizliği ihtiyacından.
 */
router.post(
  '/bulk-archive',
  requireRole('SystemAdmin'),
  asyncRoute(async (req, res) => {
    const body = req.body ?? {};
    await assertBulkCaseArchivePolicy(req, { caseIds: body.caseIds });
    const actor = requireActor(req);
    const result = await caseRepository.bulkArchive(
      { caseIds: body.caseIds, reason: body.reason },
      { actor, allowedCompanyIds: req.user.allowedCompanyIds },
    );
    if (result?.error) return res.status(400).json(result);
    res.json(result);
  }),
);

/** GET /api/cases/by-account?accountId=...&excludeId=...&statusIn=... */
router.get(
  '/by-account',
  asyncRoute(async (req, res) => {
    const { accountId, excludeId, statusIn, statusNotIn } = req.query;
    if (!accountId) return res.status(400).json({ error: 'accountId gerekli' });
    const cases = await caseRepository.findByAccount(
      accountId,
      {
        excludeId,
        statusIn: statusIn ? statusIn.split(',') : undefined,
        statusNotIn: statusNotIn ? statusNotIn.split(',') : undefined,
      },
      req.user.allowedCompanyIds,
      await buildCaseListSecurityWhere(req),
    );
    res.json({ value: cases });
  }),
);

/** GET /api/cases/by-account/count?accountId=...&statusIn=...
 * Lightweight badge counter. Smart Ticket banner için: tam by-account
 * include set'i (notes/attachments/history/callLogs) yüklemeden
 * sadece sayıyı döner. Çok aktif müşterilerde de düşük maliyet. */
router.get(
  '/by-account/count',
  asyncRoute(async (req, res) => {
    const { accountId, excludeId, statusIn, statusNotIn } = req.query;
    if (!accountId) return res.status(400).json({ error: 'accountId gerekli' });
    const count = await caseRepository.countByAccount(
      accountId,
      {
        excludeId,
        statusIn: statusIn ? statusIn.split(',') : undefined,
        statusNotIn: statusNotIn ? statusNotIn.split(',') : undefined,
      },
      req.user.allowedCompanyIds,
      await buildCaseListSecurityWhere(req),
    );
    res.json({ count });
  }),
);

/**
 * GET /api/cases/tagging-review/export
 * Sayfalama olmadan tüm filtreli kayıtları döner — Excel export için.
 */
router.get(
  '/tagging-review/export',
  requireRole('Supervisor', 'Admin', 'SystemAdmin'),
  asyncRoute(async (req, res) => {
    const f = req.query;
    const filters = {
      statuses: f.statuses ? f.statuses.split(',') : undefined,
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
      teamId: f.teamId || undefined,
    };
    const securityWhere = await buildCaseListSecurityWhere(req);
    const { items } = await caseRepository.list({
      filters,
      pagination: { page: 1, pageSize: 5000 },
      allowedCompanyIds: req.user.allowedCompanyIds,
      securityWhere,
    });
    const reviewMap = await caseRepository.getTaggingReviewsByCaseIds(items.map((c) => c.id));
    res.json({
      value: items,
      reviews: Object.fromEntries(reviewMap),
    });
  }),
);

/**
 * GET /api/cases/tagging-review?dateFrom&dateTo&statuses&page&pageSize
 *
 * Vaka Etiket Doğrulama Ekranı — Supervisor/Admin/SystemAdmin.
 * KRİTİK: bu literal route GET /:id'den (aşağıda) ÖNCE mount edilmeli,
 * yoksa Express '/:id' ile eşleşir (id="tagging-review") ve buraya hiç
 * ulaşılmaz — bkz. aşağıdaki /watching route'undaki aynı uyarı.
 *
 * caseRepository.list/shape/CASE_INCLUDE'a dokunulmaz: vaka listesi mevcut
 * filtre/scope mantığıyla çekilir, review kayıtları ayrı sorgulanıp
 * caseId → review map'i olarak ayrı bir alanda döner.
 */
router.get(
  '/tagging-review',
  requireRole('Supervisor', 'Admin', 'SystemAdmin'),
  asyncRoute(async (req, res) => {
    const f = req.query;
    const filters = {
      statuses: f.statuses ? f.statuses.split(',') : undefined,
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
      teamId: f.teamId || undefined,
    };
    const HARD_MAX_PAGE_SIZE = 200;
    const requestedPageSize = Number(f.pageSize ?? 25);
    const safePageSize = Math.min(
      HARD_MAX_PAGE_SIZE,
      Math.max(1, Number.isFinite(requestedPageSize) ? requestedPageSize : 25),
    );
    const safePage = Math.max(1, Number(f.page) || 1);
    const pagination = { page: safePage, pageSize: safePageSize };

    const ALLOWED_SORT = ['caseNumber','status','createdAt','accountName','companyName','updatedAt','reviewer','reviewedAt'];
    const sortBy  = ALLOWED_SORT.includes(f.sortBy) ? f.sortBy : 'createdAt';
    const sortDir = f.sortDir === 'asc' ? 'asc' : 'desc';

    const securityWhere = await buildCaseListSecurityWhere(req);
    const { items, total } = await caseRepository.list({
      filters,
      pagination,
      sortBy,
      sortDir,
      allowedCompanyIds: req.user.allowedCompanyIds,
      securityWhere,
    });
    const reviewMap = await caseRepository.getTaggingReviewsByCaseIds(items.map((c) => c.id));
    res.json({
      value: items,
      '@odata.count': total,
      reviews: Object.fromEntries(reviewMap),
    });
  }),
);

/**
 * PUT /api/cases/:id/tagging-review
 *
 * Alan bazlı model (9 etiket × Verdict + CorrectedCode) + note. SADECE bu
 * alanlar kabul edilir — Original{Code,Label} ve Corrected*Label client'tan
 * asla okunmaz (snapshot create'te server'da set edilir, label TaxonomyDef'ten
 * server-side resolve edilir). reviewerId/reviewerName/reviewedAt
 * req.user'dan stamplenir, client body'den asla okunmaz (transferCase'teki
 * transferredBy emsali).
 */
const TAGGING_REVIEW_FIELD_KEYS = [
  'openingPlatformVerdict', 'openingPlatformCorrectedCode',
  'openingBusinessProcessVerdict', 'openingBusinessProcessCorrectedCode',
  'openingOperationTypeVerdict', 'openingOperationTypeCorrectedCode',
  'openingAffectedObjectVerdict', 'openingAffectedObjectCorrectedCode',
  'openingImpactVerdict', 'openingImpactCorrectedCode',
  'closingRootCauseGroupVerdict', 'closingRootCauseGroupCorrectedCode',
  'closingRootCauseDetailVerdict', 'closingRootCauseDetailCorrectedCode',
  'closingResolutionTypeVerdict', 'closingResolutionTypeCorrectedCode',
  'closingPermanentPreventionVerdict', 'closingPermanentPreventionCorrectedCode',
];

router.put(
  '/:id/tagging-review',
  requireRole('Supervisor', 'Admin', 'SystemAdmin'),
  asyncRoute(async (req, res) => {
    const actor = requireActor(req);
    const body = req.body ?? {};
    const input = { note: body.note };
    for (const key of TAGGING_REVIEW_FIELD_KEYS) {
      if (key in body) input[key] = body[key];
    }
    const result = await caseRepository.upsertTaggingReview(
      req.params.id,
      input,
      req.user.allowedCompanyIds,
      actor,
    );
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    if (result?.error) return res.status(400).json(result);
    res.json(result);
  }),
);

/** GET /api/cases/:id */
router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    // PR-SD — actorRole rol-aware guard: arşivli vaka direct URL'de
    // yalnız SystemAdmin görür; diğer roller 404 alır.
    const c = await caseRepository.get(req.params.id, req.user.allowedCompanyIds, req.user.role);
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı', id: req.params.id });
    await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: c.companyId });
    // WR-ACTION-CENTER Phase 1 — auto-InProgress: flip user's Pending
    // ActionItems for this case to InProgress, stamp firstSeenAt.
    // Fire-and-forget; case detail must never block on action-center write.
    void markInProgressForCase({ caseId: req.params.id, userId: req.user.id });
    res.json(c);
  }),
);

/** POST /api/cases — yeni vaka. companyId body'den; kullanıcının allowedCompanyIds'inde olmalı. */
router.post(
  '/',
  asyncRoute(async (req, res) => {
    const body = req.body ?? {};
    if (body.companyId && !req.user.allowedCompanyIds.includes(body.companyId)) {
      return res.status(403).json({ error: 'forbidden', message: 'Bu şirkette vaka oluşturma yetkin yok.' });
    }
    await assertCompanyResourcePolicy(req, {
      companyId: body.companyId,
      resourceKey: 'case',
      action: 'create',
    });
    // PR-1 — Server-authoritative actor: body.createdBy YUTULUR.
    // requireActor 401 fırlatır (eksik auth → asyncRoute JSON'a çevirir).
    const actor = requireActor(req);
    const created = await caseRepository.create(body, actor);
    res.status(201).json(created);
  }),
);

/** PATCH /api/cases/:id — kısmi güncelleme (otomatik history log) */
router.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case', action: 'update' });
    // PR-5 follow-up — actor object pass'lensin ki historyEntries actorUserId
    // stamp atılsın (post-migration audit FK doldurulur).
    const actorObj = requireActor(req);
    const updated = await caseRepository.update(
      req.params.id,
      req.body ?? {},
      req.user.fullName,
      req.user.allowedCompanyIds,
      req.user.role,
      req.user.personId ?? null,
      actorObj,
    );
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * PR-SD — POST /api/cases/:id/archive (SystemAdmin-only)
 *
 * Vakayı soft-archive. Hard delete YOK; tüm child kayıtlar intact, sadece
 * UI listelerinden gizlenir. status enum dokunulmaz.
 *
 * Body: { reason: string }  // min 3 char
 * Audit: CaseActivity actionType='Archived', actor.
 * Idempotent: zaten arşivli ise sessizce 200 döner.
 */
router.post(
  '/:id/archive',
  requireRole('SystemAdmin'),
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case', action: 'archive' });
    const { reason } = req.body ?? {};
    const actor = requireActor(req);
    const updated = await caseRepository.archive(req.params.id, {
      reason,
      actor,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * PR-SD — POST /api/cases/:id/restore (SystemAdmin-only)
 *
 * Arşivli vakayı geri yükler. Status enum dokunulmaz.
 * Audit: CaseActivity actionType='Restored', actor.
 * Idempotent: zaten arşivli değilse sessizce 200 döner.
 */
router.post(
  '/:id/restore',
  requireRole('SystemAdmin'),
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case', action: 'restore' });
    const actor = requireActor(req);
    const updated = await caseRepository.restore(req.params.id, {
      actor,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * PR-D2 — POST /api/cases/:id/devops-link
 *
 * Mevcut TFS work item'ı vakaya bağlar (çoklu/array). Yetki: case-write
 * (PATCH /:id ile aynı kapı — requireActor + allowedCompanyIds; explicit
 * requireRole yok). Arşivli case için assertCaseInScope otomatik 409.
 *
 * Body: { workItemRef: number | string }  // id veya TFS URL
 * Dönen: güncel Case (devops array customFields'te).
 *
 * Hatalar:
 *   400 devops_workitem_ref_invalid — id/URL parse edilemedi
 *   404 (tfs_not_found) — TFS'te yok
 *   502 (tfs_auth_error / tfs_network_error / tfs_timeout) — TFS down
 *   409 case_archived_readonly — arşivli vaka
 */
router.post(
  '/:id/devops-link',
  asyncRoute(async (req, res) => {
    const { workItemRef } = req.body ?? {};
    const actor = requireActor(req);
    await assertCaseResourcePolicy(req, { resourceKey: 'case.link', action: 'create' });
    const updated = await caseRepository.linkDevops(req.params.id, {
      workItemRef,
      actor,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * PR-D2 — DELETE /api/cases/:id/devops-link/:workItemId
 *
 * Bağlı TFS work item'ı array'den kaldırır + audit (DevopsUnlinked).
 * Idempotent: zaten yoksa sessizce 200 döner.
 */
router.delete(
  '/:id/devops-link/:workItemId',
  asyncRoute(async (req, res) => {
    const actor = requireActor(req);
    await assertCaseResourcePolicy(req, { resourceKey: 'case.link', action: 'delete' });
    const updated = await caseRepository.unlinkDevops(req.params.id, {
      workItemId: req.params.workItemId,
      actor,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * PR-D2 — GET /api/cases/:id/devops-items
 *
 * Bağlı TFS work item'larının CANLI değerlerini batch çek (UI render
 * öncesi tazeleme). TFS erişilemezse snapshot fallback + `stale: true`.
 *
 * Read endpoint — assertCaseInScopeForRead: SystemAdmin arşivli case için
 * 200, diğer roller 404.
 *
 * Dönen: { items: Array<entry>, stale: boolean, error?: {...} }
 */
router.get(
  '/:id/devops-items',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const result = await caseRepository.listDevopsLive(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (result === null) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(result);
  }),
);

/**
 * WR-C1 / PM-07 — POST /api/cases/:id/claim ("Üstlen")
 *
 * Atanmamış açık bir vakayı çağıran kullanıcıya atomik olarak atar.
 * Auth: Agent, Backoffice, CSM, Supervisor, Admin, SystemAdmin
 *   (Sadece kullanıcının allowedCompanyIds scope'undaki vakalar.)
 *
 * Atomicity & race handling repository tarafında (`updateMany` WHERE filter).
 * Hata kodları:
 *   400 — kapalı vaka (Cozuldu/IptalEdildi) veya user'da Person kaydı yok
 *   403 — cross-tenant case erişimi (CaseAccessError)
 *   404 — case yok
 *   409 — vaka zaten atanmış (race lost ya da ön check)
 */
router.post(
  '/:id/claim',
  requireRole('Agent', 'Backoffice', 'CSM', 'Supervisor', 'Admin', 'SystemAdmin'),
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case', action: 'assign' });
    const updated = await caseRepository.claim({
      caseId: req.params.id,
      user: req.user,
    });
    if (!updated) {
      return res.status(404).json({ error: 'not_found', message: 'Vaka bulunamadı.' });
    }
    res.json(updated);
  }),
);

/**
 * GET /api/cases/:id/customer-match-suggestions — Phase D Step 2
 *
 * customerMatchPending=true vakalar için deterministic eşleştirme önerileri.
 * AI YOK, auto-link YOK; manuel onay gerekir (PATCH /link-account).
 *
 * Auth: tüm operasyon rolleri (Agent + Backoffice dahil — link-account ile aynı)
 * Scope:
 *   - Case kullanıcının allowedCompanyIds'inde (route layer guard)
 *   - Önerilen Account'lar case.companyId ile uyumlu (helper guard)
 *
 * Linked case (accountId set veya pending=false) → { suggestions: [], reason: 'case_already_linked' }
 */
router.get(
  '/:id/customer-match-suggestions',
  requireRole('Agent', 'Backoffice', 'Supervisor', 'CSM', 'Admin', 'SystemAdmin'),
  asyncRoute(async (req, res) => {
    // Scope verify via existing get (404/403 mantığı reuse).
    const found = await caseRepository.get(req.params.id, req.user.allowedCompanyIds, req.user.role);
    if (!found) return res.status(404).json({ error: 'Vaka bulunamadı' });
    await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: found.companyId });
    const out = await customerMatchRepository.suggestCustomerMatches({
      caseId: req.params.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
      limit: req.query.limit ? Math.min(20, Math.max(1, Number(req.query.limit))) : 5,
    });
    if (!out) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(out);
  }),
);

/**
 * PATCH /api/cases/:id/link-account — Phase D
 *
 * Müşterisiz açılmış vakaya müşteri eşleştirir.
 * Body: { accountId: string }
 * Auth: tüm operasyon rolleri. Agent/Backoffice bağlayabilir ama learned
 * sender öğrenmesi yalnız Supervisor/CSM/Admin/SystemAdmin kararından yapılır.
 *
 * Repository scope guard:
 *  - Vaka kullanıcının allowedCompanyIds'inde
 *  - Account vakanın companyId'sine bağlı (AccountCompany OR legacy OR shared NULL)
 *  - Aksi halde 400 (company_mismatch)
 */
router.patch(
  '/:id/link-account',
  requireRole('Agent', 'Backoffice', 'Supervisor', 'CSM', 'Admin', 'SystemAdmin'),
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case', action: 'update' });
    const { accountId } = req.body ?? {};
    if (!accountId || typeof accountId !== 'string') {
      return res.status(400).json({ error: 'validation_error', message: 'accountId zorunlu.' });
    }
    // M2.3 + Agent/Backoffice genişletmesi — öğrenme (learned sender) yalnız
    // Supervisor+ kararından beslenir. Agent/Backoffice bağlayabilir ama
    // kararı ezberlenmez: yanlış eşleştirme tek vakayla sınırlı kalır,
    // kalıcı auto-link kuralına dönüşmez. source='manual' dışındaki değerler
    // caseRepository.linkAccount'ta öğrenmeyi tetiklemez.
    const learnsFromLink = ['Supervisor', 'CSM', 'Admin', 'SystemAdmin'].includes(req.user.role);
    const updated = await caseRepository.linkAccount(
      req.params.id,
      accountId,
      req.user.fullName,
      req.user.allowedCompanyIds,
      { source: learnsFromLink ? 'manual' : 'manual_no_learn', actorUserId: req.user.id ?? null },
    );
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * POST /api/cases/:id/transition — statü geçişi
 * Body: { nextStatus, resolutionNote?, cancellationReason?, thirdPartyId?, thirdPartyName?, escalationLevel?, escalationReason? }
 */
router.post(
  '/:id/transition',
  asyncRoute(async (req, res) => {
    const { nextStatus, ...payload } = req.body ?? {};
    if (!nextStatus) return res.status(400).json({ error: 'nextStatus gerekli' });
    await assertCaseResourcePolicy(req, {
      resourceKey: 'case',
      action: transitionResourceAction(nextStatus),
    });
    await assertCaseCloseRequiredFields(req, { nextStatus, payload });
    const actorObj = requireActor(req); // PR-5 follow-up
    const updated = await caseRepository.transitionStatus(
      req.params.id,
      nextStatus,
      payload,
      req.user.fullName,
      req.user.allowedCompanyIds,
      actorObj,
    );
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * POST /api/cases/:id/transfer — FAZ 2 §20.2 (Vaka Aktarımı).
 * Body: { toTeamId, toPersonId?, reason, reasonCode?,
 *         aiSuggestedTeamId?, aiSuggestedReason?, aiReasonCode?, aiConfidence? }
 *
 * Atomic: Case güncelle (assigned*, transferCount++) + CaseTransfer audit +
 * Activity. SLA değiştirilmez. Aynı takım/kapalı vaka 400 döner.
 *
 * transferCount >= 2 olduğunda supervisor uyarısı + AI kök neden analizi
 * fire-and-forget tetiklenir (response geri dönmeden önce başlatılır,
 * sonuç CaseActivity'ye düşer).
 */
router.post(
  '/:id/transfer',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case', action: 'transfer' });
    const body = req.body ?? {};
    const result = await caseRepository.transferCase(
      req.params.id,
      {
        toTeamId: body.toTeamId,
        toPersonId: body.toPersonId,
        reason: body.reason,
        reasonCode: body.reasonCode,
        aiSuggestedTeamId: body.aiSuggestedTeamId,
        aiSuggestedReason: body.aiSuggestedReason,
        aiReasonCode: body.aiReasonCode,
        aiConfidence: body.aiConfidence,
        transferredBy: req.user.id,
        transferredByName: req.user.fullName,
        // WR-Smart-Ticket Phase T1 — opsiyonel devir bağlamı (transferNote,
        // composedSummary, attemptedStepIds, stepOutcomesSummary). PR-T2
        // Stage 3 UI bunu doldurur; klasik TransferModal göndermez ve
        // backend ignore eder.
        smartTicketTransfer: body.smartTicketTransfer,
        // Madde 4 — opsiyonel priority değişimi. Verilirse transferCase
        // mevcut Case.priority'yi karşılaştırır; değişiyorsa transaction
        // içinde update + ayrı FieldUpdate activity row.
        priority: body.priority,
      },
      req.user.allowedCompanyIds,
    );

    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    if (result.error) return res.status(400).json(result);

    // transferCount >= 2 → fire-and-forget supervisor warning + root-cause AI
    if (result.transferCount >= 2) {
      void triggerTransferRootCause({
        caseId: req.params.id,
        companyId: result.companyId,
        transferCount: result.transferCount,
        caseNumber: result.case.caseNumber,
        userId: req.user.id,
      });
    }

    res.json(result.case);
  }),
);

/**
 * GET /api/cases/:id/customer-pulse — Customer Context Intelligence.
 * Vakanın müşterisinin geniş durumunu deterministic metriklerle özetler:
 * açık vaka sayısı, son 30/60/90 gün vakaları, SLA ihlal/kritik/eskalasyon
 * sayıları, tekrar eden kategoriler, state etiketi (Stable/Watch/Risky/Critical),
 * deterministic summary + evidence + recommendedAction.
 *
 * AI gerekmez — endpoint OPENAI_API_KEY olmadan da tam çalışır.
 * companyId scope allowedCompanyIds ile korunur.
 */
router.get(
  '/:id/customer-pulse',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const pulse = await caseRepository.getCustomerPulse(
      req.params.id,
      req.user.allowedCompanyIds,
    );
    if (!pulse) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(pulse);
  }),
);

/**
 * GET /api/cases/:id/customer-context — Case Detail müşteri panel'i.
 *
 * Hafif payload: müşteri adı, maskeli VKN, vakanın bağlı olduğu şirketin
 * AccountCompany kaydı (externalCustomerCode, packageName, kontrat, aktif
 * ürünler) ve birincil kontak. Account modülünün dahili `notes` ve `segment`
 * alanları DAHİL EDİLMEZ (Agent için güvenli).
 *
 * accountId null vakalarda 200 + { context: null } döner.
 */
router.get(
  '/:id/customer-context',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const caseRow = await caseRepository.get(req.params.id, req.user.allowedCompanyIds, req.user.role);
    if (!caseRow) return res.status(404).json({ error: 'Vaka bulunamadı' });
    const context = await accountRepository.getCaseCustomerContext({
      accountId: caseRow.accountId,
      companyId: caseRow.companyId,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json({ context });
  }),
);

/**
 * GET /api/cases/accounts/:accountId/customer-pulse?companyId=...
 * Yeni vaka açma akışı için — vaka henüz oluşmadığı için account-based.
 * Cross-tenant: companyId allowedCompanyIds'de olmalı; Account.companyId
 * (varsa) sorgulanan companyId ile uyumlu olmalı (null = shared, ok).
 *
 * Response payload `caseId: null` (vaka yok). AI upgrade istemcide yapılmaz
 * (caseId bağımlı log); deterministic ile döner.
 */
router.get(
  '/accounts/:accountId/customer-pulse',
  asyncRoute(async (req, res) => {
    const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : null;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId zorunlu (query param).' });
    }
    const pulse = await caseRepository.getCustomerPulseByAccount(
      req.params.accountId,
      companyId,
      req.user.allowedCompanyIds,
    );
    if (!pulse) return res.status(404).json({ error: 'Müşteri bulunamadı' });
    res.json(pulse);
  }),
);

// ─────────────────────────────────────────────────────────────────
// FAZ 2 Collab — Watcher (izleyici) endpoints
// ─────────────────────────────────────────────────────────────────

/** GET /api/cases/:id/watchers — vakanın izleyicileri (UI: avatar listesi). */
router.get(
  '/:id/watchers',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const list = await watcherRepo.list(req.params.id, req.user.allowedCompanyIds, req.user.role);
    if (list === null) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json({ value: list });
  }),
);

/**
 * POST /api/cases/:id/watchers — izleyici ekle.
 * Body: { userId: string }
 *
 * Yetki (route-layer):
 *  - userId === req.user.id (self-watch): tüm roller
 *  - Başka kullanıcı ekleme: Supervisor/Admin/SystemAdmin VEYA
 *    (Agent + req.user.personId === case.assignedPersonId)
 */
router.post(
  '/:id/watchers',
  asyncRoute(async (req, res) => {
    const targetUserId = req.body?.userId;
    if (!targetUserId || typeof targetUserId !== 'string') {
      return res.status(400).json({ error: 'userId gerekli.' });
    }
    const isSelf = targetUserId === req.user.id;
    if (!isSelf) {
      const role = req.user.role;
      const elevated = ['Supervisor', 'Admin', 'SystemAdmin'].includes(role);
      let assignedOwner = false;
      if (!elevated && req.user.personId) {
        const c = await caseRepository.get(req.params.id, req.user.allowedCompanyIds, req.user.role);
        if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
        assignedOwner = c.assignedPersonId === req.user.personId;
      }
      if (!elevated && !assignedOwner) {
        return res.status(403).json({ error: 'forbidden', message: 'Başka kullanıcıyı izleyici yapma yetkin yok.' });
      }
    }
    await assertCaseResourcePolicy(req, { resourceKey: 'case.watcher', action: 'create' });
    const result = await watcherRepo.add({
      caseId: req.params.id,
      userId: targetUserId,
      addedBy: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
      actor: req.user.fullName,
    });
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    if (result.error === 'already') return res.status(409).json(result);
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  }),
);

/**
 * DELETE /api/cases/:id/watchers/:userId — izleyiciyi kaldır.
 * Yetki: self veya Supervisor/Admin/SystemAdmin.
 */
router.delete(
  '/:id/watchers/:userId',
  asyncRoute(async (req, res) => {
    const targetUserId = req.params.userId;
    const isSelf = targetUserId === req.user.id;
    const elevated = ['Supervisor', 'Admin', 'SystemAdmin'].includes(req.user.role);
    if (!isSelf && !elevated) {
      return res.status(403).json({ error: 'forbidden', message: 'Başka kullanıcıyı çıkarma yetkin yok.' });
    }
    await assertCaseResourcePolicy(req, { resourceKey: 'case.watcher', action: 'delete' });
    const result = await watcherRepo.remove({
      caseId: req.params.id,
      userId: targetUserId,
      allowedCompanyIds: req.user.allowedCompanyIds,
      actor: req.user.fullName,
    });
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    if (result.error === 'not_found') return res.status(404).json(result);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  }),
);

// ─────────────────────────────────────────────────────────────────
// FAZ 2 Collab — Linked Cases endpoints
// ─────────────────────────────────────────────────────────────────

/** GET /api/cases/:id/links — vakanın bağlantıları (3 tip karışık liste). */
router.get(
  '/:id/links',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const list = await linkRepo.list(req.params.id, req.user.allowedCompanyIds, req.user.role);
    if (list === null) return res.status(404).json({ error: 'Vaka bulunamadı' });
    const visibleLinks = await filterVisibleLinkedCases(req, list);
    res.json({ value: visibleLinks });
  }),
);

/**
 * POST /api/cases/:id/links — bağlantı ekle.
 * Body: { linkedCaseId: string, linkType: 'Related'|'Duplicate'|'Parent' }
 * Validasyonlar repo'da: self_link / invalid_type / target_not_found /
 * cross_tenant / already / circular (Parent).
 */
router.post(
  '/:id/links',
  asyncRoute(async (req, res) => {
    const { linkedCaseId, linkType } = req.body ?? {};
    await assertCaseResourcePolicy(req, { resourceKey: 'case.link', action: 'create' });
    const result = await linkRepo.add({
      caseId: req.params.id,
      linkedCaseId,
      linkType,
      createdBy: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
      actor: req.user.fullName,
    });
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    if (result.error === 'target_not_found') return res.status(404).json(result);
    if (result.error === 'cross_tenant') return res.status(403).json(result);
    if (result.error === 'already') return res.status(409).json(result);
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  }),
);

/**
 * DELETE /api/cases/:id/links/:linkId — bağlantı kaldır.
 * Yetki: case owner (assignedPersonId === self.personId) veya Supervisor+.
 * Symmetric Duplicate: reverse link de silinir (repo halleder).
 */
router.delete(
  '/:id/links/:linkId',
  asyncRoute(async (req, res) => {
    const elevated = ['Supervisor', 'Admin', 'SystemAdmin'].includes(req.user.role);
    if (!elevated) {
      const c = await caseRepository.get(req.params.id, req.user.allowedCompanyIds, req.user.role);
      if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
      if (!req.user.personId || c.assignedPersonId !== req.user.personId) {
        return res.status(403).json({ error: 'forbidden', message: 'Bağlantı kaldırma yetkin yok.' });
      }
    }
    await assertCaseResourcePolicy(req, { resourceKey: 'case.link', action: 'delete' });
    const result = await linkRepo.remove({
      caseId: req.params.id,
      linkId: req.params.linkId,
      allowedCompanyIds: req.user.allowedCompanyIds,
      actor: req.user.fullName,
    });
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    if (result.error === 'not_found') return res.status(404).json(result);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  }),
);

/** GET /api/cases/:id/transfers — bir vakanın aktarım geçmişi (en yeni en üstte). */
router.get(
  '/:id/transfers',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const list = await caseRepository.listTransfers(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (list === null) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json({ value: list });
  }),
);

/**
 * POST /api/cases/:id/transfer-brief — AI devir notu üretir.
 * Body: { toTeamId?, toPersonId? }  (opsiyonel — yeni atamayı bağlam olarak verir)
 * Yanıt: { brief: string }
 *
 * Genelde transfer endpoint'i başarıyla döndükten sonra UI bu endpoint'i
 * çağırır (success state'te devir notunu gösterir). AI key yoksa 503.
 */
router.post(
  '/:id/transfer-brief',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const body = req.body ?? {};
    const result = await generateTransferBrief({
      caseId: req.params.id,
      toTeamId: body.toTeamId,
      toPersonId: body.toPersonId,
      userId: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    if (result.error === 'not_found') return res.status(404).json({ error: 'Vaka bulunamadı' });
    if (result.error === 'forbidden') return res.status(403).json({ error: 'forbidden' });
    if (result.error === 'ai_unavailable') return res.status(503).json(result);
    if (result.error) return res.status(502).json(result);
    res.json({ brief: result.brief });
  }),
);

/**
 * POST /api/cases/:id/action-summary — AI ile vaka aksiyon log özeti.
 * Mevcut aiSummary (vaka içeriği) ve supervisor-summary (risk) FARKLI bir amaç:
 * vakanın operasyonel yolculuğunu (atamalar, statü geçişleri, eskalasyon,
 * snooze, aktarımlar) kronolojik anlatır.
 *
 * Body: yok (caseId path param yeterli).
 * Yanıt: { summary, currentState, recommendedNextAction, eventCount, generatedAt }
 *
 * Persist edilmez — UI her "Yenile" tıklayışında yeniden üretir.
 * AI key yoksa 503. AI başarısızsa 502.
 */
router.post(
  '/:id/action-summary',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const result = await generateActionSummary({
      caseId: req.params.id,
      userId: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    if (result.error === 'not_found') return res.status(404).json({ error: 'Vaka bulunamadı' });
    if (result.error === 'forbidden') return res.status(403).json({ error: 'forbidden' });
    if (result.error === 'ai_unavailable') return res.status(503).json(result);
    if (result.error) return res.status(502).json(result);
    res.json(result);
  }),
);

/**
 * POST /api/cases/:id/notes — content içinde @[Name](userId) tag'leri parse
 * edilir, CaseMention satırları yazılır. mentionedBy = req.user.id (etiketleyen).
 */
router.post(
  '/:id/notes',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case.note', action: 'create' });
    // Actor identity hardening (audit 2026-06-18): note authorship'i tamamen
    // server-side req.user üzerinden yazılır; body.authorName / body.authorId
    // sessizce yok sayılır (client spoof attempt).
    const actor = requireActor(req);
    const note = await caseRepository.addNote(
      req.params.id,
      req.body ?? {},
      req.user.allowedCompanyIds,
      req.user.id,
      actor,
    );
    if (!note) return res.status(404).json({ error: 'Vaka bulunamadı' });
    if (note.error) return res.status(400).json(note);
    res.status(201).json(note);
  }),
);

/**
 * GET /api/cases/:id/notes/:noteId/replies — bir notun thread reply'larını
 * lazy fetch eder (kullanıcı thread'i açtığında çağrılır). createdAt ASC.
 */
router.get(
  '/:id/notes/:noteId/replies',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const replies = await caseRepository.listReplies(
      req.params.id,
      req.params.noteId,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (replies === null) return res.status(404).json({ error: 'Not bulunamadı' });
    res.json({ value: replies });
  }),
);

/**
 * POST /api/cases/:id/notes/:noteId/reply — bir nota yanıt ekle (max 1 derinlik).
 * @[Name](userId) tag'leri parse edilir; CaseMention + watcher bildirimi tetiklenir.
 */
router.post(
  '/:id/notes/:noteId/reply',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case.note', action: 'create' });
    // Actor identity hardening (audit 2026-06-18): reply authorship'i tamamen
    // server-side req.user üzerinden yazılır; body.authorName / body.authorId
    // sessizce yok sayılır.
    const actor = requireActor(req);
    const reply = await caseRepository.addReply(
      req.params.id,
      req.params.noteId,
      req.body ?? {},
      req.user.allowedCompanyIds,
      req.user.id,
      actor,
    );
    if (!reply) return res.status(404).json({ error: 'Vaka veya not bulunamadı' });
    if (reply.error) return res.status(400).json(reply);
    res.status(201).json(reply);
  }),
);

/**
 * DELETE /api/cases/:id/notes/:noteId — kendi notunu/yanıtını silme.
 *
 * Yetki: yalnız `CaseNote.authorId === req.user.id`. Cross-tenant 404,
 * başka kullanıcının notu 403, authorId NULL eski not 403 ("orphan"),
 * yanıtı olan top-level note 409 ("has_replies" — soft-delete yok).
 *
 * Hard delete: mention rows manuel temizlenir (FK yok), reactions
 * schema cascade ile gider. Reply silinince parent.replyCount
 * decrement edilir. CaseActivity'ye "Not silindi" text-only satır
 * (actionType=null, yeni enum value yok).
 */
router.delete(
  '/:id/notes/:noteId',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case.note', action: 'delete' });
    const result = await caseRepository.deleteNote(
      req.params.id,
      req.params.noteId,
      req.user.allowedCompanyIds,
      req.user.id,
    );
    if (result === null) return res.status(404).json({ error: 'Vaka veya not bulunamadı' });
    if (result.error === 'forbidden' || result.error === 'orphan') {
      return res.status(403).json(result);
    }
    if (result.error === 'has_replies') {
      return res.status(409).json(result);
    }
    if (result.error) return res.status(400).json(result);
    res.json(result);
  }),
);

/**
 * POST /api/cases/:id/notes/:noteId/reactions — bir nota emoji reaksiyonu toggle eder.
 * body: { emoji: 'thumbs_up' | 'eyes' | 'check' | 'important' | 'thanks' }
 * Davranis: ayni kullanici ayni emoji ikinci kez tiklarsa kaldirilir.
 * Activity feed'e yazilmaz (noise azaltmak icin).
 */
router.post(
  '/:id/notes/:noteId/reactions',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const emoji = req.body?.emoji;
    if (typeof emoji !== 'string' || !emoji) {
      return res.status(400).json({ error: 'emoji zorunlu' });
    }
    const result = await reactionRepo.toggle({
      caseId: req.params.id,
      noteId: req.params.noteId,
      userId: req.user.id,
      emoji,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    if (!result) return res.status(404).json({ error: 'Vaka veya not bulunamadı' });
    if (result.error) return res.status(400).json(result);
    res.json(result);
  }),
);

/**
 * GET /api/cases/:id/mentionable-users — @mention dropdown için aday liste.
 * Vakanın şirketine bağlı + Person'a bağlı aktif User'lar (cross-tenant izole).
 */
router.get(
  '/:id/mentionable-users',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const users = await caseRepository.listMentionableUsers(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (users === null) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json({ value: users });
  }),
);

/**
 * POST /api/cases/:id/mentions/seen — vaka açılınca o vakadaki kullanıcının
 * okunmamış mention'larını seen yapar (bell badge sayacı düşer).
 */
router.post(
  '/:id/mentions/seen',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    // Önce case scope check (allowedCompanyIds), sonra updateMany.
    if (!(await caseRepository.get(req.params.id, req.user.allowedCompanyIds, req.user.role))) {
      return res.status(404).json({ error: 'Vaka bulunamadı' });
    }
    const result = await mentionRepo.markCaseAsSeen(
      req.user.id,
      req.params.id,
      req.user.allowedCompanyIds,
    );
    res.json(result);
  }),
);

/**
 * GET /api/cases/me/mentions/unread — bell badge için kullanıcının okunmamış
 * mention listesi (header'da küçük drawer'da göster).
 */
router.get(
  '/me/mentions/unread',
  asyncRoute(async (req, res) => {
    const data = await mentionRepo.listUnreadForUser(
      req.user.id,
      req.user.allowedCompanyIds,
    );
    res.json({ value: data.items, '@odata.count': data.total });
  }),
);

/**
 * GET /api/cases/me/notifications/unread — generic CaseNotification listesi
 * (watcher_update, watcher_added, note_reaction, vs.). Mention'lar AYRI
 * kanal: /me/mentions/unread. Bu liste bell drawer'da mention'larla
 * birleşik gösterilir. (Smoke Audit P0.1)
 */
router.get(
  '/me/notifications/unread',
  asyncRoute(async (req, res) => {
    const data = await notificationRepo.listUnreadForUser(
      req.user.id,
      req.user.allowedCompanyIds,
    );
    res.json({ value: data.items, '@odata.count': data.total });
  }),
);

/**
 * POST /api/cases/me/notifications/seen — drawer açıldığında veya kullanıcı
 * "Tümünü okundu işaretle" yaparken çağrılır. Body opsiyonel `ids` array'i
 * (belirli notification'ları seen yap; yoksa hepsi).
 */
router.post(
  '/me/notifications/seen',
  asyncRoute(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
    const result = await notificationRepo.markAllAsSeen(
      req.user.id,
      req.user.allowedCompanyIds,
      ids,
    );
    res.json(result);
  }),
);

/** POST /api/cases/:id/call-logs */
router.post(
  '/:id/call-logs',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case', action: 'update' });
    // PR-1 — body.callerId YUTULUR; actor.userId callerId olarak yazılır.
    const actor = requireActor(req);
    const result = await caseRepository.addCallLog(
      req.params.id,
      req.body ?? {},
      req.user.allowedCompanyIds,
      actor,
    );
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.status(201).json(result);
  }),
);

/** POST /api/cases/:id/activity — manuel aktivite (Transfer vb.) */
router.post(
  '/:id/activity',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case', action: 'update' });
    // PR-1 — body.actor YUTULUR; activity actor'u req.user'dan.
    const actor = requireActor(req);
    const updated = await caseRepository.addActivity(
      req.params.id,
      req.body ?? {},
      req.user.allowedCompanyIds,
      actor,
    );
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * POST /api/cases/:id/snooze — vakayı ertele.
 * Body: { snoozeUntil: ISO string, snoozeReason: 'CustomerWillCall' | 'WaitingThirdParty' | 'Reminder' }
 */
router.post(
  '/:id/snooze',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case', action: 'update' });
    const { snoozeUntil, snoozeReason } = req.body ?? {};
    if (!snoozeUntil || !snoozeReason) {
      return res.status(400).json({ error: 'snoozeUntil ve snoozeReason gerekli' });
    }
    const result = await caseRepository.snoozeCase(
      req.params.id,
      { snoozeUntil, snoozeReason },
      req.user.fullName,
      req.user.allowedCompanyIds,
    );
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    if ('error' in result) return res.status(400).json(result);
    res.json(result);
  }),
);

/** DELETE /api/cases/:id/snooze — ertelemeyi kaldır, Acik'e döndür. */
router.delete(
  '/:id/snooze',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case', action: 'update' });
    const result = await caseRepository.unsnoozeCase(
      req.params.id,
      req.user.fullName,
      req.user.allowedCompanyIds,
    );
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(result);
  }),
);

/** PATCH /api/cases/:id/checklist/:itemId — checklist toggle */
router.patch(
  '/:id/checklist/:itemId',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case', action: 'update' });
    const { checked } = req.body ?? {};
    const updated = await caseRepository.toggleChecklistItem(
      req.params.id,
      req.params.itemId,
      Boolean(checked),
      req.user.fullName,
      req.user.allowedCompanyIds,
    );
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * L2-Smart-Flow FAZ 1 — PATCH /api/cases/:id/smart-classification
 * Body: {
 *   fields: { platform?: {code,label}, businessProcess?, operationType?,
 *             affectedObject?, impact? }   — TAM SET (boş gelen silinir)
 *   classificationSuggestion?: { appliedAt, appliedFields, perField, unmatched }
 *   appliedMapping?: { source, category, subCategory, requestType, trace }
 * }
 * Yetki: case update (Agent+). KB kapısı FE'de (settings-status); bu uç
 * KB'siz kiracıda da elle düzenlemeye izin verir (veri zaten varsa).
 * Audit: CaseActivity actionType='SmartClassificationUpdate'.
 */
router.patch(
  '/:id/smart-classification',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case', action: 'update' });
    const updated = await caseRepository.updateSmartClassification(
      req.params.id,
      req.body ?? {},
      req.user.allowedCompanyIds,
      req.user.fullName,
    );
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * Adım 1 — POST /api/cases/:id/files/upload-url
 * Body: { fileName, fileSize, mimeType }
 * Yanıt: { uploadUrl, path, attachmentId }
 */
router.post(
  '/:id/files/upload-url',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case.attachment', action: 'create' });
    // PR-4 — Upload two-step user binding: token'a actor.userId gömülür,
    // finalize endpoint'i mismatch'i 400 ile reddeder.
    const actor = requireActor(req);
    const result = await caseRepository.requestUpload(
      req.params.id,
      req.body ?? {},
      req.user.allowedCompanyIds,
      actor,
    );
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    if ('error' in result) return res.status(400).json(result);
    res.json(result);
  }),
);

/**
 * Adım 2 — POST /api/cases/:id/files/finalize
 * Body: { attachmentId, path, fileName, fileSize, mimeType, uploadedBy? }
 */
router.post(
  '/:id/files/finalize',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case.attachment', action: 'create' });
    // PR-1 — body.uploadedBy YUTULUR; uploadedBy actor.displayName ile yazılır.
    const actor = requireActor(req);
    const result = await caseRepository.finalizeUpload(
      req.params.id,
      req.body ?? {},
      req.user.allowedCompanyIds,
      actor,
    );
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    // PR-7 — finalize whitelist defense-in-depth: MIME mismatch 400.
    if ('error' in result) return res.status(400).json(result);
    res.status(201).json(result);
  }),
);

/** GET /api/cases/:id/files/:fileId/download — kısa ömürlü signed URL */
router.get(
  '/:id/files/:fileId/download',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const result = await caseRepository.getDownloadUrl(
      req.params.id,
      req.params.fileId,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (!result) return res.status(404).json({ error: 'Dosya bulunamadı' });
    res.json(result);
  }),
);

/** DELETE /api/cases/:id/files/:fileId */
router.delete(
  '/:id/files/:fileId',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case.attachment', action: 'delete' });
    const updated = await caseRepository.removeFile(
      req.params.id,
      req.params.fileId,
      req.user.fullName,
      req.user.allowedCompanyIds,
    );
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

// ─────────────────────────────────────────────────────────────────
// WR-Smart-Ticket Phase 2a — CaseSolutionStep endpoints
//
// Scope: case-bağlı; companyId daima case'ten türetilir, allowedCompanyIds
// guard her uçta repository tarafında uygulanır.
//
// Bu fazda yalnız "AI Önerilen Adımlar" import edilir (External KB
// `analyze.analysis.suggestedSteps`); root cause / customer reply /
// engineer handoff / similar / raw response intentionally ignored.
// ─────────────────────────────────────────────────────────────────

router.get(
  '/:id/solution-steps',
  asyncRoute(async (req, res) => {
    await assertCaseSecurityFilterAccess(req);
    const items = await solutionStepRepository.list(req.params.id, req.user.allowedCompanyIds);
    res.json({ value: items });
  }),
);

router.post(
  '/:id/solution-steps',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case.solutionStep', action: 'create' });
    const item = await solutionStepRepository.createManual(
      req.params.id,
      req.body ?? {},
      req.user.id,
      req.user.allowedCompanyIds,
    );
    res.status(201).json(item);
  }),
);

router.patch(
  '/:id/solution-steps/:stepId',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case.solutionStep', action: 'update' });
    // ID-based: stepId'nin case'i URL'deki :id ile aynı olmalı (cross-case
    // mutation engellemek için defansif kontrol). Repository step'i fetch
    // ederken companyId scope'u zaten doğrular; burada caseId tutarlılığını
    // ek olarak kontrol ediyoruz.
    const step = await solutionStepRepository.update(
      req.params.stepId,
      req.body ?? {},
      req.user.id,
      req.user.allowedCompanyIds,
    );
    if (step.caseId !== req.params.id) {
      return res.status(400).json({
        error: 'case_mismatch',
        message: 'Bu adım belirtilen vakaya ait değil.',
      });
    }
    res.json(step);
  }),
);

router.post(
  '/:id/solution-steps/:stepId/status',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case.solutionStep', action: 'update' });
    const body = req.body ?? {};
    if (typeof body.status !== 'string') {
      return res.status(400).json({ error: 'status_required', message: 'status gerekli.' });
    }
    // Cross-case guard — stepId case'i URL'deki :id ile aynı olmalı.
    const existing = await solutionStepRepository.list(req.params.id, req.user.allowedCompanyIds);
    if (!existing.find((s) => s.id === req.params.stepId)) {
      return res.status(404).json({
        error: 'step_not_in_case',
        message: 'Bu vakada belirtilen adım bulunamadı.',
      });
    }
    const step = await solutionStepRepository.setStatus(
      req.params.stepId,
      body.status,
      { note: body.note },
      req.user.id,
      req.user.allowedCompanyIds,
    );
    res.json(step);
  }),
);

router.post(
  '/:id/solution-steps/import-ai-suggested',
  asyncRoute(async (req, res) => {
    await assertCaseResourcePolicy(req, { resourceKey: 'case.solutionStep', action: 'create' });
    // 1) Case scope + companyId al (repository de aynı kontrolü yapar).
    const items = await solutionStepRepository.list(req.params.id, req.user.allowedCompanyIds);
    // 2) External KB analyze cevabını al.
    //    İki yol destekleniyor:
    //    a) Client zaten analyze çağrıp cevabı body.analyzeResponse ile gönderir.
    //    b) Server bu istekte kendisi analyze çağırır (body.freeText/bildirimNo).
    let analyzeResponse = null;
    const body = req.body ?? {};
    if (body.analyzeResponse && typeof body.analyzeResponse === 'object') {
      analyzeResponse = body.analyzeResponse;
    } else {
      // Server-side analyze: KB setting + freeText/bildirimNo gerekir.
      // Hata olursa import başarısız sayılır AMA mevcut adımlar korunur
      // (repo henüz hiçbir şey yazmadı).
      const companyId = await solutionStepRepository.getCaseCompanyId(
        req.params.id,
        req.user.allowedCompanyIds,
      );
      const setting = await externalKbSettingRepo.getByCompany(companyId);
      if (!setting?.enabled) {
        return res.status(400).json({
          error: 'external_kb_disabled',
          message: 'Bu şirket için External KB devre dışı.',
        });
      }
      const freeText = typeof body.freeText === 'string' ? body.freeText.trim() : '';
      const bildirimNo = typeof body.bildirimNo === 'string' ? body.bildirimNo.trim() : '';
      if (!freeText && !bildirimNo) {
        return res.status(400).json({
          error: 'invalid_request',
          message: 'analyzeResponse veya freeText/bildirimNo gerekli.',
        });
      }
      // Faz 2 (KB maliyet) — analyze idempotency. Aynı case + aynı input için
      // ikinci "AI çözüm adımı öner" tıklaması pahalı Sonnet analyze'ı TEKRAR
      // yakmasın diye request-hash cache. Hash'e katılan alanlar: cache sürümü
      // (KB prompt/taxonomy anlamlı değişince ELLE bump → invalidate), companyId
      // (tenant izolasyonu; cache case'e bağlı ama defansif) ve gerçek input.
      const requestHash = createHash('sha256')
        .update(
          JSON.stringify({
            v: SMART_TICKET_ANALYSIS_CACHE_VERSION,
            companyId,
            freeText,
            bildirimNo,
          }),
        )
        .digest('hex');
      try {
        const cached = await caseRepository.getSmartTicketAnalysisCache(
          req.params.id,
          requestHash,
          req.user.allowedCompanyIds,
        );
        if (cached) {
          // Cache hit — Sonnet analyze ATLANIR. aiDrafts persist + step import
          // aşağıda cached response ile aynen çalışır (idempotent; adım repo'su
          // dedup eder).
          analyzeResponse = cached;
        }
      } catch (cacheErr) {
        // Cache okuması salt optimizasyon — hata olursa yut, analyze'a düş.
        console.warn(
          '[cases/import-ai-suggested] analysis cache read failed (non-fatal)',
          cacheErr?.message ?? cacheErr,
        );
      }

      if (!analyzeResponse) {
        try {
          const kbResult = await externalKbClient.analyze(setting, {
            ...(freeText ? { freeText } : {}),
            ...(bildirimNo ? { bildirimNo } : {}),
          });
          // externalKbClient.proxy() non-2xx HTTP veya network/timeout için
          // throw atmaz; { ok: false, error, data } wrapped response döner.
          // Codex P2 (main #447 review) PR #448'de suggest-classification ve
          // suggest-closure path'leri için aynı pattern fix edilmişti — bu
          // route O FIX'TE KAPSAMA DIŞINDA KALDI. Sonuç: KB v2 doc'daki ~180sn
          // analyze çağrısı default 30s timeoutMs ile abort olunca,
          // analyzeResponse=null → extractor 0 step → 200 OK + importedCount=0
          // dönülüyordu (sessiz fail). Frontend toast'u "Vaka açıldı" göstedi,
          // L1 kullanıcı KB önerisinin neden gelmediğini anlayamadı.
          if (kbResult && kbResult.ok === false) {
            console.error(
              '[cases/import-ai-suggested] analyze returned ok:false',
              kbResult.error?.code ?? 'unknown',
              kbResult.error?.status ?? '',
            );
            const cls = classifyKbFailure(kbResult);
            return res.status(cls.status).json({
              error: cls.code,
              message: cls.message.replace('elle seçimle devam edebilirsiniz', 'manuel adım ekleyebilirsiniz'),
            });
          }
          analyzeResponse = kbResult?.data ?? kbResult ?? null;
          // Faz 2 — taze analyze sonucunu cache'le (best-effort; ana akışı
          // bloke etmesin). Sonraki aynı-input tıklaması artık cache'ten döner.
          if (analyzeResponse) {
            try {
              await caseRepository.persistSmartTicketAnalysisCache(
                req.params.id,
                requestHash,
                analyzeResponse,
                req.user.allowedCompanyIds,
              );
            } catch (persistErr) {
              console.warn(
                '[cases/import-ai-suggested] analysis cache persist failed (non-fatal)',
                persistErr?.message ?? persistErr,
              );
            }
          }
        } catch (err) {
          const cls = classifyKbFailure({ error: { message: err?.message } });
          return res.status(cls.status).json({ error: cls.code, message: cls.message });
        }
      }
    }
    // Madde 2 — KB analyze cevabından engineeringHandoff + customerReplyDraft
    // extract et ve Smart Ticket case'leri için customFields.smartTicket.aiDrafts
    // altına persist et. Helper smartTicket opening yoksa null döner — klasik
    // vakalar etkilenmez. Hata bu adımda olursa import akışını bozma.
    try {
      const drafts = extractAiDrafts(analyzeResponse);
      if (drafts.engineeringHandoff || drafts.customerReplyDraft) {
        await caseRepository.persistSmartTicketAiDrafts(
          req.params.id,
          drafts,
          req.user.allowedCompanyIds,
        );
      }
    } catch (draftErr) {
      console.warn(
        '[cases/import-ai-suggested] aiDrafts persist failed (non-fatal)',
        draftErr?.message ?? draftErr,
      );
    }

    const result = await solutionStepRepository.importAiSuggested(
      req.params.id,
      analyzeResponse ?? {},
      req.user.id,
      req.user.allowedCompanyIds,
    );
    res.json(result);
  }),
);

// ─────────────────────────────────────────────────────────────────
// Mail M6.1 — Vaka İçi E-Posta thread (read-only)
//
// Plan referansı: docs/M6-email-in-case-plan.md Bölüm 9 (route'lar).
// SCOPE: caseRepository.get ile önce vaka erişim/varlık doğrulanır,
// sonra caseEmailRepository scope-aware listForCase. Composer (M6.2)
// ayrı PR.
// ─────────────────────────────────────────────────────────────────

/**
 * GET /api/cases/:id/emails — vakanın CaseEmail thread'i.
 * Response: { items: CaseEmail[] }
 *
 * Codex review fix — assertCaseSecurityFilterAccess güvenlik filtresi
 * (AUTHORIZATION_SECURITY_FILTER_ENFORCEMENT_ENABLED=true iken) UYGULANIR.
 * Aksi halde kullanıcı allowedCompanyIds içinde olan ama security
 * filter ile gizlenen vakanın mail içeriklerini /api/cases/:id/emails
 * üzerinden okuyabilir (vaka detayı 403/404 dönerken thread sızar).
 */
router.get(
  '/:id/emails',
  asyncRoute(async (req, res) => {
    // Scope + varlık kontrolü (assertCaseInScopeForRead patterni reuse).
    const c = await caseRepository.get(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
    // Codex P1 — Security filter access guard (mevcut case detay
    // route'ları ile aynı patern).
    await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: c.companyId });
    const items = await caseEmailRepository.listForCase(req.params.id, {
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json({ items });
  }),
);

/**
 * Mail M6.2a — POST /api/cases/:id/emails
 *
 * Agent composer'dan gönderim (M6.2b UI). Sender backend:
 *  - validateOutboundFrom (M5-ext) — spoof önleme
 *  - sanitize (M6.1 htmlSanitizer)
 *  - threading: subject token + Message-ID + In-Reply-To/References
 *  - mailProvider.sendMail (M5 per-tenant)
 *  - başarı → CaseEmail(outbound, source='manual_send') + K4 update
 *
 * Body: {
 *   fromAddress: string,    // M5-ext alias adres
 *   to: [{ address, name? }, ...],
 *   cc?, bcc?: aynı şekil,
 *   subject: string,
 *   bodyHtml: string,
 *   bodyText?: string,
 *   attachments?: string[]  // CaseAttachment.id[]
 * }
 *
 * Response:
 *   200 { ok: true, emailId, messageId, previewUrl? }
 *   400 { ok: false, code }
 *   403/404 (scope/case fail)
 *
 * SCOPE: caseRepository.get + assertCaseSecurityFilterAccess (M6.1 ile
 * aynı patern). Agent role guard yok — herhangi authenticated user
 * vakaya yazabilir; assertCaseSecurityFilterAccess yetki filtresini
 * uygular.
 */
router.post(
  '/:id/emails',
  asyncRoute(async (req, res) => {
    const c = await caseRepository.get(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
    await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: c.companyId });
    // Codex review fix (M6.2a P1) — WRITE resource policy gate.
    // Sadece security-filter READ check yapılıyordu; vakayı görebilen ama
    // not/ek/mutate DENY'lı kullanıcı buradan müşteriye mail atabiliyordu.
    // assertCaseResourcePolicy 'case.note' + 'create' semantik yakın
    // (composer outbound mail thread'e satır yazar — not eklemeyle aynı
    // izin sınıfı). AUTHORIZATION_RESOURCE_ENFORCEMENT_ENABLED kapalıyken
    // bypass; açık iken zorlu.
    await assertCaseResourcePolicy(req, { resourceKey: 'case.note', action: 'create' });
    const actor = requireActor(req);
    const body = req.body ?? {};
    const result = await caseEmailSender.sendCaseEmail({
      caseId: req.params.id,
      fromAddress: body.fromAddress,
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: body.subject,
      bodyHtml: body.bodyHtml,
      bodyText: body.bodyText,
      attachments: body.attachments,
      // Codex P2 fix — composer'ın seçtiği reply parent messageId.
      // Satır içi Yanıtla → reply-context'in inReplyTo'sunu draft taşır;
      // backend threading bu satıra göre kurar. Yoksa son inbound.
      inReplyTo: typeof body.inReplyTo === 'string' ? body.inReplyTo : null,
      actor: { userId: actor.userId ?? null, fullName: req.user.fullName },
    });
    if (!result.ok) {
      const status =
        result.code === 'from_invalid' ? 400
        : result.code === 'recipients_missing' ? 400
        : result.code === 'case_not_found' ? 404
        : result.code === 'attachment_scope_mismatch' ? 400
        : result.code === 'attachment_missing' ? 404
        : 502;
      return res.status(status).json({ ok: false, code: result.code, message: result.message ?? null });
    }
    res.json({
      ok: true,
      emailId: result.emailId,
      messageId: result.messageId,
      previewUrl: result.previewUrl,
    });
  }),
);

/**
 * Mail M6.2a — GET /api/cases/:id/emails/reply-context
 *
 * Composer prefill verisi (K6 reply-all). Vakanın son inbound
 * CaseEmail'ından çıkarılır:
 *  - To = [inbound.from] + inbound.to (tenant alias filtresi)
 *  - Cc = inbound.cc (alias filtresi)
 *  - Subject = "Re: " + token korunmuş subject
 *  - inReplyTo = inbound.messageId
 *
 * Composer "Yanıtla" tıklanınca bu endpoint'i çağırır, alanları doldurur.
 */
router.get(
  '/:id/emails/reply-context',
  asyncRoute(async (req, res) => {
    const c = await caseRepository.get(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
    await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: c.companyId });
    // Codex P2 fix — satır içi "Yanıtla" emailId pass eder; backend o
    // satırı baz alır. Param yoksa eski davranış (son inbound).
    const emailIdRaw = req.query?.emailId;
    const emailId = typeof emailIdRaw === 'string' && emailIdRaw ? emailIdRaw : undefined;
    const ctx = await caseEmailSender.buildReplyContext(req.params.id, { emailId });
    res.json(ctx ?? { caseNumber: null, to: [], cc: [], bcc: [], subject: '', inReplyTo: null });
  }),
);

/**
 * Mail M6.3-realign — GET /api/cases/:id/emails/:emailId/forward-context
 *
 * Composer "İlet" akışı için prefill (subject 'Fwd:' + alıntılı body).
 * Alıcılar boş — agent manuel ekler.
 *
 * Scope guard: caseRepository.get + assertCaseSecurityFilterAccess + emailId
 * caseId match (buildForwardContext companyId/case binding check).
 */
router.get(
  '/:id/emails/:emailId/forward-context',
  asyncRoute(async (req, res) => {
    const c = await caseRepository.get(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
    await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: c.companyId });
    const ctx = await caseEmailSender.buildForwardContext(req.params.id, req.params.emailId, {
      companyId: c.companyId,
    });
    if (!ctx) return res.status(404).json({ error: 'Mail bulunamadı' });
    res.json(ctx);
  }),
);

/**
 * GET /api/cases/:id/emails/:emailId/attachments/:attachmentId/download
 * — Mail eki indirme — short-lived signed token döner. Token tüketim
 * /:id/files/:fileId/raw deseniyle uyumlu (signStorageToken / 60sn).
 *
 * Codex review fix — Attachment-case binding + security filter check.
 * Önce: att.caseId req.params.id farklı olsa bile token att.caseId'ye
 * yazılıyordu → kullanıcı kendi erişim sahibi olduğu bir vaka ID'sini
 * URL'e koyup başka vakanın eki için token üretebiliyordu.
 * Şimdi: att.caseId === req.params.id zorunlu + security filter check
 * doğru caseId üzerinden.
 */
router.get(
  '/:id/emails/:emailId/attachments/:attachmentId/download',
  asyncRoute(async (req, res) => {
    const c = await caseRepository.get(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
    // Codex P1 — security filter guard (caseDetay rotalarıyla aynı).
    await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: c.companyId });
    const att = await caseEmailRepository.getAttachmentForRaw(
      req.params.emailId,
      req.params.attachmentId,
      { allowedCompanyIds: req.user.allowedCompanyIds },
    );
    if (!att) return res.status(404).json({ error: 'Ek bulunamadı' });
    // Codex P1 — URL'deki :id ile gerçek attachment'ın caseId'si
    // EŞLEŞMELİ. Aksi halde başka vakanın eki için token mintlenebilir
    // (cross-case leak). Mismatch → 404.
    if (att.caseId !== req.params.id) {
      return res.status(404).json({ error: 'Ek bulunamadı' });
    }
    // 60 saniyelik token. Raw endpoint mevcut /:id/files/:fileId/raw
    // ile aynı şema; M6.2'de composer için ortak indirme path'i.
    //
    // 2026-07-03 Codex R2 P1 fix — GÜVENLİK: attacker dış mail'de CID
    // attachment'ı image/svg+xml veya text/html contentType ile
    // gönderirse, inboundMailParser inline=true set eder. Önceki kod
    // "inline + gerçek MIME" mintliyordu → app origin'de attacker-controlled
    // active content (SVG script / HTML script → cookie & DOM erişimi).
    // Signed URL 60sn içinde extension/cache/log yoluyla açılabilir.
    //
    // Sıkı raster-image allowlist:
    //  - image/png, image/jpeg, image/jpg, image/gif, image/webp
    //  - SVG DAHİL DEĞİL (script içerebilir)
    //  - Diğer her şey (text/html, application, ...) → attachment +
    //    octet-stream (browser download prompt, active content YOK)
    //
    // Normal mail-eki (att.isInline=false) yolunda mimeType raw kalır
    // (kullanıcı download button → gerçek MIME + attachment prompt).
    // Sadece "inline claim edilmiş ama unsafe MIME" senaryosu octet-stream'e
    // düşürülür (defense-in-depth: attacker inline flag'ı da ihlal edemez).
    const INLINE_SAFE_MIME = new Set([
      'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
    ]);
    const mimeLower = String(att.mimeType || '').toLowerCase();
    const isSafeRasterImage = INLINE_SAFE_MIME.has(mimeLower);
    const isInlineSafe = att.isInline && isSafeRasterImage;
    const disposition = isInlineSafe ? 'inline' : 'attachment';
    // Fallback güvenlik: attacker inline claim etti ama MIME safe list'te
    // değilse (svg/html vs), mime'i de octet-stream'e düşür → browser
    // bir daha da active olarak render edemez.
    const tokenMimeType = isInlineSafe
      ? att.mimeType
      : (att.isInline ? 'application/octet-stream' : att.mimeType);
    const token = signStorageToken(
      {
        typ: 'download',
        caseId: att.caseId,
        fileId: att.id,
        path: att.storageKey,
        fileName: att.fileName,
        mimeType: tokenMimeType,
        disposition,
      },
      60,
    );
    res.json({
      url: `/api/cases/${att.caseId}/files/${att.id}/raw?token=${encodeURIComponent(token)}`,
      fileName: att.fileName,
      mimeType: att.mimeType,
      fileSize: att.fileSize,
    });
  }),
);

/**
 * Mail M5-extension — GET /api/cases/:id/from-aliases
 *
 * Composer (M6.2) From dropdown lookup. Vaka companyId scope'unda aktif
 * FromAlias listesi döner. Mevcut M6.1 /:id/emails desenleriyle aynı
 * scope guard (caseRepository.get + assertCaseSecurityFilterAccess).
 *
 * Response: { items: [{ id, address, displayName, isDefault }, ...] }
 *
 * Default seçilen ilk satır; composer dropdown 1 satırsa otomatik gizli
 * + seçili (M6.2 davranışı).
 */
router.get(
  '/:id/from-aliases',
  asyncRoute(async (req, res) => {
    const c = await caseRepository.get(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
    await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: c.companyId });
    // M6.3-realign — FromAlias hiç tanımlı değilse ExternalMailSetting.fromAddress
    // fallback ile sentetik tek alias döndür. validateOutboundFrom aynı
    // fallback'i kullanıyor → gönderim tutarlı.
    const items = await externalMailFromAliasRepo.listActiveWithSettingFallback(c.companyId);
    // Composer dropdown'a sade response — admin alanlarını filtrele.
    res.json({
      items: items.map((a) => ({
        id: a.id,
        address: a.address,
        displayName: a.displayName,
        isDefault: a.isDefault,
      })),
    });
  }),
);

/**
 * Mail M6.3-realign — GET /api/cases/:id/email-config
 *
 * İletişim sekmesi açılışında "yapılandırılmış mı?" kararı için tek
 * dedicated endpoint. CommunicationTab banner state'i bu yanıta dayanır.
 *
 * Response: { configured: boolean, reason: 'no-setting' | 'disabled'
 *   | 'no-from' | 'has-alias' | 'fallback-from-address' }
 *
 * Kontrat (kullanıcı talebi, ALTERNATİF — daha sağlam):
 *   configured = ExternalMailSetting var + enabled === true +
 *     (FromAlias 1+ VEYA ExternalMailSetting.fromAddress dolu)
 *   reason:
 *     - 'no-setting'              → ExternalMailSetting kaydı yok
 *     - 'disabled'                → kayıt var ama enabled=false
 *     - 'no-from'                 → enabled ama ne alias ne fromAddress
 *     - 'has-alias'               → FromAlias satır(lar)ı var
 *     - 'fallback-from-address'   → alias yok, fromAddress üzerinden fallback
 *
 * KONTRAT TUTARLILIĞI: configured kararı için
 * listActiveWithSettingFallback (composer dropdown ile aynı helper)
 * kullanılır → composer'a sunulan ALİAS LİSTESİ ile config-detection
 * AYNI kaynaktan beslenir. Composer dropdown 1+ alias döndürürse banner
 * GÖRÜNMEZ (tek doğruluk kaynağı).
 *
 * Scope guard: caseRepository.get + assertCaseSecurityFilterAccess.
 */
router.get(
  '/:id/email-config',
  asyncRoute(async (req, res) => {
    const c = await caseRepository.get(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
    await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: c.companyId });
    const setting = await prisma.externalMailSetting.findUnique({
      where: { companyId: c.companyId },
      select: { enabled: true },
    });
    if (!setting) {
      return res.json({ configured: false, reason: 'no-setting' });
    }
    if (!setting.enabled) {
      return res.json({ configured: false, reason: 'disabled' });
    }
    // composer dropdown ile AYNI kaynak (fallback dahil)
    const items = await externalMailFromAliasRepo.listActiveWithSettingFallback(c.companyId);
    if (items.length === 0) {
      return res.json({ configured: false, reason: 'no-from' });
    }
    const isFallback = items.length === 1 && items[0].id === 'setting-fallback';
    res.json({
      configured: true,
      reason: isFallback ? 'fallback-from-address' : 'has-alias',
    });
  }),
);

/**
 * Mail M6.3b Faz 3 — GET /api/cases/:id/email-templates
 *
 * Composer "Mail Şablonu" dropdown beslemesi. Aktif template'ler döner.
 * Scope: caseRepository.get + assertCaseSecurityFilterAccess (M5-ext desen).
 */
router.get(
  '/:id/email-templates',
  asyncRoute(async (req, res) => {
    const c = await caseRepository.get(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
    await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: c.companyId });
    const { caseEmailTemplateRepo } = await import('../db/caseEmailTemplateRepository.js');
    const items = await caseEmailTemplateRepo.listActive(c.companyId);
    res.json({
      items: items.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        subject: t.subject,
        bodyHtml: t.bodyHtml,
        variables: t.variables,
      })),
    });
  }),
);

/**
 * Mail M6.3b Faz 3 — POST /api/cases/:id/email-templates/:templateId/render
 *
 * Composer'ın seçtiği template'i vaka context'i ile interpolate eder.
 * Response: { subject: string | null, bodyHtml, missing: string[] }
 */
router.post(
  '/:id/email-templates/:templateId/render',
  asyncRoute(async (req, res) => {
    const c = await caseRepository.get(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
    await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: c.companyId });

    const { caseEmailTemplateRepo } = await import('../db/caseEmailTemplateRepository.js');
    const tpl = await caseEmailTemplateRepo.getById(c.companyId, req.params.templateId);
    if (!tpl || !tpl.isActive) return res.status(404).json({ error: 'Şablon bulunamadı' });

    const caseRow = await prisma.case.findUnique({
      where: { id: c.id },
      select: {
        caseNumber: true, title: true, accountName: true,
        customerContactName: true, customerContactEmail: true,
      },
    });
    const { renderTemplate } = await import('../lib/emailTemplateRender.js');
    const out = renderTemplate(tpl, caseRow, { fullName: req.user.fullName ?? '' });
    res.json(out);
  }),
);

/**
 * Mail M6.2b — GET /api/cases/:id/email-signature
 *
 * Composer için tenant default imzası (ExternalMailSetting.signatureHtml).
 * Composer açılışında gövde sonuna append. Per-agent override M6.3'te.
 *
 * Response: { signatureHtml: string | null }
 *
 * Scope guard: caseRepository.get + assertCaseSecurityFilterAccess
 * (composer çağrıyı vaka context'inde yapar; M6.1 patern reuse).
 */
router.get(
  '/:id/email-signature',
  asyncRoute(async (req, res) => {
    const c = await caseRepository.get(
      req.params.id,
      req.user.allowedCompanyIds,
      req.user.role,
    );
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
    await assertCaseSecurityFilterAccess(req, { caseId: req.params.id, companyId: c.companyId });
    // Mail M6.3b Faz 2 — Per-agent imza eklendi. Response genişletildi:
    //   { tenantHtml, agentHtml, signatureHtml? (deprecated geri uyumlu) }
    // Compose-Signature F2 — composedHtml eklendi (şirket şablonu + Person
    // bilgileriyle render). Fallback chain (composer):
    //   override (agentHtml) > composedHtml > none
    // tenantHtml ham şablon, geri uyum için tutuldu.
    // signatureHtml flatten (eski client'lar): agent > composed > tenant.
    const [ems, user] = await Promise.all([
      prisma.externalMailSetting.findUnique({
        where: { companyId: c.companyId },
        select: { signatureHtml: true },
      }),
      prisma.user.findUnique({
        where: { id: req.user.id },
        select: { signatureHtml: true, personId: true, fullName: true },
      }),
    ]);
    const tenantHtml = ems?.signatureHtml ?? null;
    const agentHtml = user?.signatureHtml ?? null;

    // Compose-Signature F2 — Şirket şablonunu Person bilgileriyle render et.
    // Mustache reuse: notificationRepository.renderTemplate.
    // Person yoksa (SystemAdmin gibi) {{agent.title}} boş; {{agent.name}}
    // User.fullName fallback (Person.name yoksa kullanıcının ekran adı).
    let composedHtml = null;
    if (tenantHtml) {
      let agentName = user?.fullName ?? '';
      let agentTitle = '';
      if (user?.personId) {
        const person = await prisma.person.findUnique({
          where: { id: user.personId },
          select: { name: true, title: true },
        });
        if (person?.name) agentName = person.name;
        if (person?.title) agentTitle = person.title;
      }
      const { renderTemplate } = await import('../db/notificationRepository.js');
      // Codex P2 fix — Person.name/title plain text saklanır (HTML değil).
      // tenantHtml HTML context; placeholder values escape edilmeden
      // interpolate edilirse "<b>Lead</b>" gibi bir title gerçek markup'a
      // dönüşür (XSS surface). htmlEscape: true ZORUNLU.
      const out = renderTemplate(
        tenantHtml,
        {
          'agent.name': agentName,
          'agent.title': agentTitle,
        },
        { htmlEscape: true },
      );
      composedHtml = out.rendered || null;
    }

    res.json({
      tenantHtml,
      agentHtml,
      composedHtml,
      // Deprecated — yeni client'lar agentHtml/composedHtml ayrı okur.
      // Eski caller'lar için fallback (agent > composed > tenant).
      signatureHtml: agentHtml ?? composedHtml ?? tenantHtml,
    });
  }),
);

export default router;
