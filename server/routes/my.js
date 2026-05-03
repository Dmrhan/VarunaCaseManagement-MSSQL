import { Router } from 'express';
import { verifyJwt } from '../db/auth.js';
import {
  listCalendarEvents,
  createReminder,
  getReminder,
  updateReminder,
  deleteReminder,
} from '../db/myRepository.js';

/**
 * /api/my/* — kişisel takvim, hatırlatıcılar.
 * Tüm endpoint'ler verifyJwt arkasında; req.user.id + allowedCompanyIds scope.
 */

const router = Router();
router.use(verifyJwt);

/**
 * GET /api/my/calendar?from=ISO&to=ISO
 * Kullanıcının ±gerekli aralıkta tüm takvim olaylarını döner.
 * Spec'te "?date=YYYY-MM-DD" varyantı da destekleniyor — o gün ±3 gün eklenir.
 *
 * Olay türleri: reminder | snooze | sla_response | sla_resolution | followup
 * Performans guard: aralık 90 günden fazla olamaz.
 */
router.get('/calendar', async (req, res) => {
  try {
    let { from, to, date, types } = req.query;
    if (date && (!from || !to)) {
      const d = new Date(String(date));
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: 'invalid_date', message: 'date geçerli ISO olmalı' });
      }
      const dayMs = 24 * 60 * 60 * 1000;
      from = new Date(d.getTime() - 3 * dayMs).toISOString();
      to = new Date(d.getTime() + 3 * dayMs).toISOString();
    }
    if (!from || !to) {
      return res.status(400).json({ error: 'missing_range', message: 'from + to (veya date) gerekli' });
    }
    // ?types=reminder,snooze → o türlerin sorgusu çalıştırılır.
    // Verilmezse hepsi (geri uyumlu). Boş "?types=" → hiç fetch yok (lazy).
    let typesArr;
    if (typeof types === 'string') {
      typesArr = types.length > 0 ? types.split(',').map((s) => s.trim()).filter(Boolean) : [];
    }
    const events = await listCalendarEvents({
      userId: req.user.id,
      personId: req.user.personId,
      allowedCompanyIds: req.user.allowedCompanyIds,
      from: String(from),
      to: String(to),
      types: typesArr,
    });
    res.json({ events });
  } catch (err) {
    if (err?.message?.includes('aralık') || err?.message?.includes('Aralık')) {
      return res.status(400).json({ error: 'range_too_wide', message: err.message });
    }
    console.error('[my:calendar]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * POST /api/my/reminders
 * Body: { caseId, remindAt (ISO), message? }
 * Vaka companyId kullanıcının allowedCompanyIds'inde olmalı.
 */
router.post('/reminders', async (req, res) => {
  try {
    const { caseId, remindAt, message } = req.body ?? {};
    if (!remindAt) {
      return res.status(400).json({ error: 'missing_fields', message: 'remindAt gerekli' });
    }
    const result = await createReminder({
      caseId: caseId || null,
      userId: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
      remindAt,
      message,
    });
    if (!result) return res.status(404).json({ error: 'not_found', message: 'Vaka bulunamadı' });
    if ('error' in result) {
      const status = result.error === 'forbidden' ? 403 : 400;
      return res.status(status).json(result);
    }
    res.status(201).json(result);
  } catch (err) {
    console.error('[my:reminders:create]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * GET /api/my/reminders/:id — edit modal'ı için tek hatırlatıcı.
 * Sahibi değilse 404.
 */
router.get('/reminders/:id', async (req, res) => {
  try {
    const r = await getReminder({
      id: req.params.id,
      userId: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    if (!r) return res.status(404).json({ error: 'not_found' });
    res.json(r);
  } catch (err) {
    console.error('[my:reminders:get]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * PATCH /api/my/reminders/:id
 * Body: { remindAt?, message?, caseId? } — kısmi güncelleme.
 *   - caseId null gönderirsen vaka linki kaldırılır (vakasız reminder'a dönüşür).
 *   - caseId değişiyorsa yeni vakanın companyId scope'u kontrol edilir.
 */
router.patch('/reminders/:id', async (req, res) => {
  try {
    const { remindAt, message, caseId } = req.body ?? {};
    const result = await updateReminder({
      id: req.params.id,
      userId: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
      remindAt,
      message,
      caseId,
    });
    if (!result) return res.status(404).json({ error: 'not_found' });
    if ('error' in result) {
      const status =
        result.error === 'forbidden' ? 403 : result.error === 'not_found' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[my:reminders:update]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * DELETE /api/my/reminders/:id
 * Sahibi olmayan kullanıcı 404 görür (yetki sızdırma yapma).
 */
router.delete('/reminders/:id', async (req, res) => {
  try {
    const ok = await deleteReminder({
      id: req.params.id,
      userId: req.user.id,
      allowedCompanyIds: req.user.allowedCompanyIds,
    });
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[my:reminders:delete]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

export default router;
