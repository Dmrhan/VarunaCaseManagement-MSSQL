import { Router } from 'express';
import { caseRepository, mentionRepo, watcherRepo, linkRepo, reactionRepo, notificationRepo, CaseAccessError, CaseValidationError } from '../db/caseRepository.js';
import { accountRepository } from '../db/accountRepository.js';
import { customerMatchRepository } from '../db/customerMatchRepository.js';
import { verifyJwt, requireRole } from '../db/auth.js';
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
      console.error('[cases]', err);
      res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
    }
  };
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
    const filters = {
      search: f.search,
      statuses: f.statuses ? f.statuses.split(',') : undefined,
      caseType: f.caseType,
      priorities: f.priorities ? f.priorities.split(',') : undefined,
      teamId: f.teamId,
      personId: f.personId,
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
      customerMatchPending,
    };
    const pagination = f.page
      ? { page: Number(f.page), pageSize: Number(f.pageSize ?? 25) }
      : undefined;
    const { items, total } = await caseRepository.list({
      filters,
      pagination,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    res.json({ value: items, '@odata.count': total });
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
    const found = await caseRepository.findOpenCaseFor(accountId, caseType, req.user.allowedCompanyIds);
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
    const { items, total } = await caseRepository.listSnoozedForUser(
      req.user.personId,
      req.user.allowedCompanyIds,
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
    const items = await watcherRepo.listForUser(req.user.id, req.user.allowedCompanyIds);
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
    const result = await caseRepository.bulkUpdate(
      { caseIds: body.caseIds, updates: body.updates ?? {} },
      req.user.fullName,
      req.user.allowedCompanyIds,
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
    );
    res.json({ value: cases });
  }),
);

/** GET /api/cases/:id */
router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const c = await caseRepository.get(req.params.id, req.user.allowedCompanyIds);
    if (!c) return res.status(404).json({ error: 'Vaka bulunamadı', id: req.params.id });
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
    const created = await caseRepository.create(body);
    res.status(201).json(created);
  }),
);

/** PATCH /api/cases/:id — kısmi güncelleme (otomatik history log) */
router.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const updated = await caseRepository.update(
      req.params.id,
      req.body ?? {},
      req.user.fullName,
      req.user.allowedCompanyIds,
    );
    if (!updated) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json(updated);
  }),
);

/**
 * GET /api/cases/:id/customer-match-suggestions — Phase D Step 2
 *
 * customerMatchPending=true vakalar için deterministic eşleştirme önerileri.
 * AI YOK, auto-link YOK; Supervisor/Admin manuel onay verir (PATCH /link-account).
 *
 * Auth: Supervisor, CSM, Admin, SystemAdmin (Agent + Backoffice 403)
 * Scope:
 *   - Case kullanıcının allowedCompanyIds'inde (route layer guard)
 *   - Önerilen Account'lar case.companyId ile uyumlu (helper guard)
 *
 * Linked case (accountId set veya pending=false) → { suggestions: [], reason: 'case_already_linked' }
 */
router.get(
  '/:id/customer-match-suggestions',
  requireRole('Supervisor', 'CSM', 'Admin', 'SystemAdmin'),
  asyncRoute(async (req, res) => {
    // Scope verify via existing get (404/403 mantığı reuse).
    const found = await caseRepository.get(req.params.id, req.user.allowedCompanyIds);
    if (!found) return res.status(404).json({ error: 'Vaka bulunamadı' });
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
 * Müşterisiz açılmış vakaya Supervisor/Admin müşteri eşleştirir.
 * Body: { accountId: string }
 * Auth: Supervisor, CSM, Admin, SystemAdmin (Agent + Backoffice 403)
 *
 * Repository scope guard:
 *  - Vaka kullanıcının allowedCompanyIds'inde
 *  - Account vakanın companyId'sine bağlı (AccountCompany OR legacy OR shared NULL)
 *  - Aksi halde 400 (company_mismatch)
 */
router.patch(
  '/:id/link-account',
  requireRole('Supervisor', 'CSM', 'Admin', 'SystemAdmin'),
  asyncRoute(async (req, res) => {
    const { accountId } = req.body ?? {};
    if (!accountId || typeof accountId !== 'string') {
      return res.status(400).json({ error: 'validation_error', message: 'accountId zorunlu.' });
    }
    const updated = await caseRepository.linkAccount(
      req.params.id,
      accountId,
      req.user.fullName,
      req.user.allowedCompanyIds,
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
    const updated = await caseRepository.transitionStatus(
      req.params.id,
      nextStatus,
      payload,
      req.user.fullName,
      req.user.allowedCompanyIds,
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
    const caseRow = await caseRepository.get(req.params.id, req.user.allowedCompanyIds);
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
    const list = await watcherRepo.list(req.params.id, req.user.allowedCompanyIds);
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
        const c = await caseRepository.get(req.params.id, req.user.allowedCompanyIds);
        if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
        assignedOwner = c.assignedPersonId === req.user.personId;
      }
      if (!elevated && !assignedOwner) {
        return res.status(403).json({ error: 'forbidden', message: 'Başka kullanıcıyı izleyici yapma yetkin yok.' });
      }
    }
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
    const list = await linkRepo.list(req.params.id, req.user.allowedCompanyIds);
    if (list === null) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.json({ value: list });
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
      const c = await caseRepository.get(req.params.id, req.user.allowedCompanyIds);
      if (!c) return res.status(404).json({ error: 'Vaka bulunamadı' });
      if (!req.user.personId || c.assignedPersonId !== req.user.personId) {
        return res.status(403).json({ error: 'forbidden', message: 'Bağlantı kaldırma yetkin yok.' });
      }
    }
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
    const list = await caseRepository.listTransfers(
      req.params.id,
      req.user.allowedCompanyIds,
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
    const note = await caseRepository.addNote(
      req.params.id,
      req.body ?? {},
      req.user.allowedCompanyIds,
      req.user.id,
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
    const replies = await caseRepository.listReplies(
      req.params.id,
      req.params.noteId,
      req.user.allowedCompanyIds,
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
    const reply = await caseRepository.addReply(
      req.params.id,
      req.params.noteId,
      req.body ?? {},
      req.user.allowedCompanyIds,
      req.user.id,
    );
    if (!reply) return res.status(404).json({ error: 'Vaka veya not bulunamadı' });
    if (reply.error) return res.status(400).json(reply);
    res.status(201).json(reply);
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
    const users = await caseRepository.listMentionableUsers(
      req.params.id,
      req.user.allowedCompanyIds,
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
    // Önce case scope check (allowedCompanyIds), sonra updateMany.
    if (!(await caseRepository.get(req.params.id, req.user.allowedCompanyIds))) {
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
    const result = await caseRepository.addCallLog(
      req.params.id,
      req.body ?? {},
      req.user.allowedCompanyIds,
    );
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.status(201).json(result);
  }),
);

/** POST /api/cases/:id/activity — manuel aktivite (Transfer vb.) */
router.post(
  '/:id/activity',
  asyncRoute(async (req, res) => {
    const updated = await caseRepository.addActivity(
      req.params.id,
      req.body ?? {},
      req.user.allowedCompanyIds,
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
 * Adım 1 — POST /api/cases/:id/files/upload-url
 * Body: { fileName, fileSize, mimeType }
 * Yanıt: { uploadUrl, path, attachmentId }
 */
router.post(
  '/:id/files/upload-url',
  asyncRoute(async (req, res) => {
    const result = await caseRepository.requestUpload(
      req.params.id,
      req.body ?? {},
      req.user.allowedCompanyIds,
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
    const result = await caseRepository.finalizeUpload(
      req.params.id,
      req.body ?? {},
      req.user.allowedCompanyIds,
    );
    if (!result) return res.status(404).json({ error: 'Vaka bulunamadı' });
    res.status(201).json(result);
  }),
);

/** GET /api/cases/:id/files/:fileId/download — kısa ömürlü signed URL */
router.get(
  '/:id/files/:fileId/download',
  asyncRoute(async (req, res) => {
    const result = await caseRepository.getDownloadUrl(
      req.params.id,
      req.params.fileId,
      req.user.allowedCompanyIds,
    );
    if (!result) return res.status(404).json({ error: 'Dosya bulunamadı' });
    res.json(result);
  }),
);

/** DELETE /api/cases/:id/files/:fileId */
router.delete(
  '/:id/files/:fileId',
  asyncRoute(async (req, res) => {
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

export default router;
