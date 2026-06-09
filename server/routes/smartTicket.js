/**
 * WR-Smart-Ticket Phase 2b — açılış sınıflandırma önerisi route'u.
 *
 * Endpoint: POST /api/smart-ticket/suggest-classification
 *
 * Akış:
 *   1. verifyJwt + allowedCompanyIds scope (companyId zorunlu).
 *   2. External KB analyze çağrılır (per-tenant setting).
 *   3. extractClassificationFromKb → yalnız 5 sınıflandırma alanı.
 *   4. TaxonomyDef listesi okunur (active rows).
 *   5. mapClassificationToTaxonomy → suggestions + unmatched.
 *   6. Hiçbir Case oluşturulmaz; hiçbir şey persist edilmez.
 *
 * Hata davranışı:
 *  - KB devre dışıysa veya ayar yoksa → 400, mesaj kullanıcıya gösterilebilir.
 *  - KB uçtan hata dönerse → 502, mevcut manual dropdown'lar bozulmaz.
 *  - companyId scope dışıysa → 403.
 *
 * Bu fazda KB cevabının diğer alanları (suggestedSteps, rootCause,
 * customerReply, handoff, similar, panorama, citations, kbChunks, hits,
 * raw answer) **kullanılmaz**; route döndürmez. Smart Ticket Step 2 UI
 * için ayrı endpoint (PR-2a) zaten var.
 */

import { Router } from 'express';
import { verifyJwt } from '../db/auth.js';
import { prisma } from '../db/client.js';
import { externalKbClient } from '../lib/externalKbClient.js';
import { externalKbSettingRepo } from '../db/externalKbSettingRepository.js';
import {
  extractClassificationFromKb,
  mapClassificationToTaxonomy,
  SMART_TICKET_CLASSIFICATION_FIELDS,
} from '../lib/smartTicketClassification.js';

const router = Router();
router.use(verifyJwt);

const TAXONOMY_TYPES_FOR_CLASSIFICATION = ['platform', 'businessProcess', 'operationType', 'affectedObject', 'impact'];

async function loadActiveTaxonomies(companyId) {
  const rows = await prisma.taxonomyDef.findMany({
    where: {
      companyId,
      isActive: true,
      taxonomyType: { in: TAXONOMY_TYPES_FOR_CLASSIFICATION },
    },
    select: {
      taxonomyType: true,
      code: true,
      label: true,
      sortOrder: true,
      metadata: true,
    },
    orderBy: [{ taxonomyType: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
  });
  const out = {};
  for (const t of TAXONOMY_TYPES_FOR_CLASSIFICATION) out[t] = [];
  for (const r of rows) out[r.taxonomyType].push(r);
  return out;
}

router.post('/suggest-classification', async (req, res) => {
  try {
    const body = req.body ?? {};
    const allowed = Array.isArray(req.user?.allowedCompanyIds) ? req.user.allowedCompanyIds : [];
    const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : '';
    if (!companyId) {
      return res.status(400).json({
        error: 'company_required',
        message: 'companyId zorunlu.',
      });
    }
    if (!allowed.includes(companyId)) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Bu şirkete erişim yok.',
      });
    }

    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length < 5) {
      return res.status(400).json({
        error: 'description_required',
        message: 'Sınıflandırma için en az 5 karakterlik açıklama gerekli.',
      });
    }

    // External KB ayarı.
    const setting = await externalKbSettingRepo.getByCompany(companyId);
    if (!setting?.enabled) {
      return res.status(400).json({
        error: 'external_kb_disabled',
        message: 'Bu şirket için External KB devre dışı; sınıflandırma önerisi alınamıyor. Manuel seçim yapılabilir.',
      });
    }

    // KB analyze çağır (server-side). Hatalar 502 ile sarılır.
    let kbResponse;
    try {
      kbResponse = await externalKbClient.analyze(setting, {
        freeText: description,
        ...(typeof body.bildirimNo === 'string' && body.bildirimNo.trim()
          ? { bildirimNo: body.bildirimNo.trim() }
          : {}),
        ...(typeof body.project === 'string' && body.project.trim()
          ? { project: body.project.trim() }
          : {}),
      });
    } catch (err) {
      console.error('[smart-ticket/suggest-classification] KB analyze failed', err?.message ?? err);
      return res.status(502).json({
        error: 'external_kb_failed',
        message: 'External KB çağrısı başarısız oldu. Manuel seçim yapılabilir.',
      });
    }

    // Adapter — yalnız 5 sınıflandırma alanı.
    const raw = extractClassificationFromKb(kbResponse);
    const taxonomies = await loadActiveTaxonomies(companyId);
    const { suggestions, unmatched } = mapClassificationToTaxonomy(raw, taxonomies);

    res.json({
      companyId,
      suggestions,
      unmatched,
      source: 'external_kb',
      // Debug: KB cevabının diğer alanlarını DÖNDÜRMEYİZ; client de
      // bunları persist etmez. Bu PR'ın özünü garanti altına alıyor.
      meta: {
        fieldsRequested: SMART_TICKET_CLASSIFICATION_FIELDS,
        extractedRawCount: Object.keys(raw).length,
      },
    });
  } catch (err) {
    console.error('[smart-ticket/suggest-classification]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

export default router;
