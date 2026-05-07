import { Router } from 'express';
import { caseRepository, mentionRepo, CaseAccessError } from '../db/caseRepository.js';
import { verifyJwt } from '../db/auth.js';
import { runSnoozeWakeup } from '../cron/snoozeWakeup.js';
import { triggerTransferRootCause, generateTransferBrief } from '../lib/transferAi.js';

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
      console.error('[cases]', err);
      res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
    }
  };
}

/**
 * GET /api/cases — list + filter + pagination
 * Query params: search, statuses (CSV), caseType, priorities (CSV), teamId, personId, dateFrom, dateTo, page, pageSize
 */
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const f = req.query;
    const filters = {
      search: f.search,
      statuses: f.statuses ? f.statuses.split(',') : undefined,
      caseType: f.caseType,
      priorities: f.priorities ? f.priorities.split(',') : undefined,
      teamId: f.teamId,
      personId: f.personId,
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
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
