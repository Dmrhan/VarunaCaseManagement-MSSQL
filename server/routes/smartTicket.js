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
import {
  composeTransferBriefFromSteps,
  extractAiDrafts,
} from '../db/solutionStepRepository.js';

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

    // WR-KB-v2 — tercih edilen uç: /api/v1/categorize-v2 (~60sn, KB
    // kullanmaz). Hata olursa eski /api/v1/analyze fallback'i çağrılır.
    // Backward-compatible: KB v2 deploy edilmediyse kullanıcı yine de
    // sınıflandırma alabilsin diye iki katmanlı.
    const v2Body = {
      description,
      ...(typeof body.project === 'string' && body.project.trim()
        ? { project: body.project.trim() }
        : {}),
    };
    if (typeof body.customerName === 'string' && body.customerName.trim()) {
      v2Body.customer_name = body.customerName.trim();
    }

    // Codex P2 (main #447 review) — externalKbClient.proxy() non-2xx HTTP
    // veya network/timeout için throw atmaz; { ok: false, error, data }
    // wrapped response döner. Eski impl yalnız catch block'una düşen thrown
    // error'da fallback yapıyordu → KB v2 deploy edilmemiş tenant'larda
    // 404 dönen categorize-v2 cevabı "başarılı" sayılıp analyze fallback
    // tetiklenmiyordu, kullanıcı boş classification görüyordu.
    //
    // Tek truth source: kbResponse.ok. False olduğunda fallback'e geç;
    // her iki uç da ok:false ise 502.
    let kbResponse = null;
    let usedEndpoint = null;
    const analyzeFallback = async () => {
      return externalKbClient.analyze(setting, {
        freeText: description,
        ...(typeof body.bildirimNo === 'string' && body.bildirimNo.trim()
          ? { bildirimNo: body.bildirimNo.trim() }
          : {}),
        ...(typeof body.project === 'string' && body.project.trim()
          ? { project: body.project.trim() }
          : {}),
      });
    };

    try {
      const v2 = await externalKbClient.categorizeV2(setting, v2Body);
      if (v2 && v2.ok === false) {
        console.warn(
          '[smart-ticket/suggest-classification] categorize-v2 returned ok:false, falling back to analyze',
          v2.error?.code ?? 'unknown',
          v2.error?.status ?? '',
        );
        const a = await analyzeFallback();
        if (a && a.ok === false) {
          console.error(
            '[smart-ticket/suggest-classification] both categorize-v2 and analyze returned ok:false',
            a.error?.code ?? 'unknown',
          );
          return res.status(502).json({
            error: 'external_kb_failed',
            message: 'External KB çağrısı başarısız oldu. Manuel seçim yapılabilir.',
          });
        }
        kbResponse = a;
        usedEndpoint = 'analyze';
      } else {
        kbResponse = v2;
        usedEndpoint = 'categorize-v2';
      }
    } catch (err) {
      // Defansif: proxy()'nin sözleşmesini kıran bir bug olursa thrown error'u
      // da yakala ve aynı fallback'i dene.
      console.warn(
        '[smart-ticket/suggest-classification] categorize-v2 threw, falling back to analyze',
        err?.message ?? err,
      );
      try {
        const a = await analyzeFallback();
        if (a && a.ok === false) {
          console.error(
            '[smart-ticket/suggest-classification] analyze fallback ok:false',
            a.error?.code ?? 'unknown',
          );
          return res.status(502).json({
            error: 'external_kb_failed',
            message: 'External KB çağrısı başarısız oldu. Manuel seçim yapılabilir.',
          });
        }
        kbResponse = a;
        usedEndpoint = 'analyze';
      } catch (fallbackErr) {
        console.error(
          '[smart-ticket/suggest-classification] both categorize-v2 and analyze failed',
          fallbackErr?.message ?? fallbackErr,
        );
        return res.status(502).json({
          error: 'external_kb_failed',
          message: 'External KB çağrısı başarısız oldu. Manuel seçim yapılabilir.',
        });
      }
    }

    // Adapter — multi-path adapter zaten categorize-v2'nin top-level
    // snake_case alanlarını (platform, is_sureci, vb.) okuyor; analyze'in
    // analysis.classification.X path'ini de aynı adapter cover ediyor.
    const raw = extractClassificationFromKb(kbResponse);
    const taxonomies = await loadActiveTaxonomies(companyId);
    const { suggestions, unmatched } = mapClassificationToTaxonomy(raw, taxonomies);

    // categorize-v2 cevabı confidence/reason dönüyor — meta'ya yazarız;
    // adapter mapping kalitesinden bağımsız olarak observability için.
    const upstreamMeta = {};
    if (kbResponse && typeof kbResponse === 'object') {
      const payload = kbResponse.data && typeof kbResponse.data === 'object' ? kbResponse.data : kbResponse;
      if (typeof payload.confidence === 'number') upstreamMeta.confidence = payload.confidence;
      if (typeof payload.reason === 'string') upstreamMeta.reason = payload.reason;
      if (typeof payload.modelUsed === 'string') upstreamMeta.modelUsed = payload.modelUsed;
    }

    res.json({
      companyId,
      suggestions,
      unmatched,
      source: 'external_kb',
      meta: {
        fieldsRequested: SMART_TICKET_CLASSIFICATION_FIELDS,
        extractedRawCount: Object.keys(raw).length,
        usedEndpoint,
        ...upstreamMeta,
      },
    });
  } catch (err) {
    console.error('[smart-ticket/suggest-classification]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * WR-KB-Closure-Auto — POST /api/smart-ticket/suggest-closure
 *
 * Stage 3'e girildiğinde **otomatik** çağrılır. Body:
 *
 *   { caseId, workedStepId? }
 *
 * Backend Case + CaseSolutionStep + Smart Ticket opening context'ini
 * server-side toplar; KB upstream `/api/v1/suggest-close` çağrılır;
 * cevabın 4 alanı (kok_neden_grubu, kok_neden_detayi, cozum_tipi,
 * kalici_onlem) + confidence/reason döndürülür.
 *
 * Kurallar:
 *  - Case scope: req.user.allowedCompanyIds.includes(case.companyId)
 *  - workedStepId verilirse o step primary context; yoksa son "worked"
 *    step otomatik bulunur. Hiç worked step yoksa context yine kurulur
 *    (KB tüm denenen adımlardan çıkarım yapabilir).
 *  - Case veya step MUTATE EDİLMEZ; vaka kapatılmaz.
 *  - Raw KB cevabı dönmez; yalnız normalized suggestions/unmatched/meta.
 *  - Match sırası: code > metadata.kbAliases > normalized label.
 *
 * Geri uyumlu (deprecated) body de halen çalışır: { companyId,
 * description, resolution, openIsSureci, openIslemTipi } — eski
 * "KB ile Öner" manuel buton bunu kullanıyordu. v2 body verilirse
 * yeni akış işler.
 */
const TAXONOMY_TYPES_FOR_CLOSURE = ['rootCauseGroup', 'rootCauseDetail', 'resolutionType', 'permanentPrevention'];

async function loadActiveClosureTaxonomies(companyId) {
  const rows = await prisma.taxonomyDef.findMany({
    where: {
      companyId,
      isActive: true,
      taxonomyType: { in: TAXONOMY_TYPES_FOR_CLOSURE },
    },
    // id ZORUNLU: rootCauseDetail eşleştirmesi rcgMatch.id ile parentId
    // filtresine dayanır (aşağıda). id seçilmezse rcgMatch.id=undefined olur,
    // aday liste boş kalır ve Kök Neden Detayı asla eşleşmez.
    select: { id: true, taxonomyType: true, code: true, label: true, parentId: true, metadata: true },
    orderBy: [{ taxonomyType: 'asc' }, { sortOrder: 'asc' }],
  });
  const out = { rootCauseGroup: [], rootCauseDetail: [], resolutionType: [], permanentPrevention: [] };
  for (const r of rows) out[r.taxonomyType].push(r);
  return out;
}

function normalizeLabel(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFC')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchByLabel(list, rawLabel) {
  if (!rawLabel) return null;
  const target = normalizeLabel(rawLabel);
  if (!target) return null;
  return list.find((t) => normalizeLabel(t.label) === target) ?? null;
}

// ─────────────────────────────────────────────────────────────────
// Resolution composer — worked step + tüm step outcomes/notes
// + Smart Ticket opening context'i KB'ye gönderilecek "resolution"
// metnine çevirir. Spec: worked step birincil, kalan step'ler
// "diğer denenen adımlar" listesi.
// ─────────────────────────────────────────────────────────────────

const SOLUTION_STEP_STATUS_LABEL = {
  suggested: 'Önerildi',
  tried: 'Denendi',
  worked: 'İşe yaradı',
  not_worked: 'İşe yaramadı',
  skipped: 'Uygun değil',
};

function composeResolutionFromSteps(workedStep, allSteps) {
  const lines = [];
  if (workedStep) {
    const parts = [`[ÇÖZÜLEN ADIM] ${workedStep.title}`];
    if (workedStep.description) parts.push(workedStep.description);
    if (workedStep.note) parts.push(`Not: ${workedStep.note}`);
    lines.push(parts.join(' — '));
  }
  const others = (allSteps || []).filter((s) => !workedStep || s.id !== workedStep.id);
  if (others.length > 0) {
    lines.push('');
    lines.push('Diğer denenen adımlar:');
    for (const s of others) {
      const statusLabel = SOLUTION_STEP_STATUS_LABEL[s.status] ?? s.status;
      const noteSuffix = s.note ? ` (Not: ${s.note})` : '';
      lines.push(`- ${s.title} — ${statusLabel}${noteSuffix}`);
    }
  }
  if (lines.length === 0) {
    return 'Çözüm adımları henüz girilmedi; KB önerisi yalnız vaka açıklamasından çıkarılabilir.';
  }
  return lines.join('\n');
}

router.post('/suggest-closure', async (req, res) => {
  try {
    const body = req.body ?? {};
    const allowed = Array.isArray(req.user?.allowedCompanyIds) ? req.user.allowedCompanyIds : [];

    // ── Yeni body shape (v2): { caseId, workedStepId? } ──
    const caseId = typeof body.caseId === 'string' ? body.caseId.trim() : '';
    // Stage 3 "Çözüm Açıklaması" textarea'sının current değeri override olarak
    // geçebilir; verildiyse compose-from-steps yerine bu kullanılır (Stage 3
    // resolution-first akışı: kategorizasyon Çözüm Açıklaması'nın current
    // metnine göre üretilsin). Workflow geri uyumlu: gönderilmezse eski
    // davranış (worked step + step özetlerinden compose).
    //
    // Codex P2 #2 fix — Empty string override explicit-reject: caller field'ı
    // gerçekten gönderdiyse (typeof === 'string') ama trim sonrası boş kaldıysa
    // bu "kullanıcı textarea'yı temizledi" sinyali. Eski fallback'e (worked
    // step compose) düşmek stale step text'i current resolution gibi sunardı —
    // misleading drafts/categorization. Bu durumu sessizce omit etmek yerine
    // 400 dönüyoruz; frontend dirty+empty durumunda zaten KB call atmıyor,
    // bu defansif ikinci katman.
    const resolutionOverrideRaw = body.resolutionOverride;
    if (typeof resolutionOverrideRaw === 'string' && resolutionOverrideRaw.trim().length === 0) {
      return res.status(400).json({
        error: 'resolution_override_empty',
        message:
          'Çözüm Açıklaması boş gönderildi; lütfen önce çözümü yazın, sonra KB önerisini isteyin.',
      });
    }
    const resolutionOverride =
      typeof resolutionOverrideRaw === 'string' ? resolutionOverrideRaw.trim() : '';
    let companyId = '';
    let description = '';
    let resolution = '';
    let openUrun, openIsSureci, openIslemTipi;
    let workedStepId = typeof body.workedStepId === 'string' ? body.workedStepId.trim() : '';
    let selectedWorkedStepId = null;
    let contextStepsCount = 0;

    if (caseId) {
      const caseRow = await prisma.case.findUnique({
        where: { id: caseId },
        select: { id: true, companyId: true, description: true, customFields: true },
      });
      if (!caseRow) {
        return res.status(404).json({ error: 'case_not_found', message: 'Vaka bulunamadı.' });
      }
      if (!allowed.includes(caseRow.companyId)) {
        return res.status(403).json({ error: 'forbidden', message: 'Bu vakaya erişim yok.' });
      }
      companyId = caseRow.companyId;
      description = (caseRow.description || '').trim();

      // Smart Ticket opening context — customFields.smartTicket'tan label'lar.
      const stOpening =
        caseRow.customFields && typeof caseRow.customFields === 'object'
          ? caseRow.customFields.smartTicket
          : null;
      if (stOpening && typeof stOpening === 'object') {
        // Codex P2 fix — `open_urun` için label kaynağı önceliği:
        //   1) urunLabel       (forward-compat: ileride bir yazıcı eklenirse)
        //   2) platformLabel   (UI'ın gerçekten persist ettiği alan)
        //   3) platform        (label yok, ham code)
        // SmartTicketNewPage `${field}Label` formatında yazıyor → mevcut
        // tüm Smart Ticket case'lerinde `urunLabel` YOK; `platformLabel`
        // dolu. Eski impl yalnız urunLabel okuyordu → open_urun KB'ye
        // gönderilmiyordu.
        if (typeof stOpening.urunLabel === 'string' && stOpening.urunLabel.trim()) {
          openUrun = stOpening.urunLabel.trim();
        } else if (typeof stOpening.platformLabel === 'string' && stOpening.platformLabel.trim()) {
          openUrun = stOpening.platformLabel.trim();
        } else if (typeof stOpening.platform === 'string' && stOpening.platform.trim()) {
          openUrun = stOpening.platform.trim();
        }
        if (typeof stOpening.businessProcessLabel === 'string') openIsSureci = stOpening.businessProcessLabel;
        if (typeof stOpening.operationTypeLabel === 'string') openIslemTipi = stOpening.operationTypeLabel;
      }

      // Tüm CaseSolutionStep'leri çek.
      const steps = await prisma.caseSolutionStep.findMany({
        where: { caseId },
        orderBy: { stepIndex: 'asc' },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          note: true,
          outcomeAt: true,
        },
      });
      contextStepsCount = steps.length;

      let workedStep = null;
      if (workedStepId) {
        workedStep = steps.find((s) => s.id === workedStepId && s.status === 'worked') ?? null;
      }
      if (!workedStep) {
        // En son worked olan step'i otomatik seç.
        const workedSorted = steps
          .filter((s) => s.status === 'worked' && s.outcomeAt)
          .sort((a, b) => new Date(b.outcomeAt).getTime() - new Date(a.outcomeAt).getTime());
        workedStep = workedSorted[0] ?? steps.find((s) => s.status === 'worked') ?? null;
      }
      selectedWorkedStepId = workedStep?.id ?? null;
      resolution = resolutionOverride.length > 0
        ? resolutionOverride
        : composeResolutionFromSteps(workedStep, steps);
    } else {
      // ── Geri uyumlu body (v1): { companyId, description, resolution, ... } ──
      companyId = typeof body.companyId === 'string' ? body.companyId.trim() : '';
      description = typeof body.description === 'string' ? body.description.trim() : '';
      resolution = typeof body.resolution === 'string' ? body.resolution.trim() : '';
      if (typeof body.openUrun === 'string' && body.openUrun.trim()) openUrun = body.openUrun.trim();
      if (typeof body.openIsSureci === 'string' && body.openIsSureci.trim()) openIsSureci = body.openIsSureci.trim();
      if (typeof body.openIslemTipi === 'string' && body.openIslemTipi.trim()) openIslemTipi = body.openIslemTipi.trim();
      if (!companyId) {
        return res.status(400).json({ error: 'company_required', message: 'companyId veya caseId zorunlu.' });
      }
      if (!allowed.includes(companyId)) {
        return res.status(403).json({ error: 'forbidden', message: 'Bu şirkete erişim yok.' });
      }
    }

    if (description.length < 5) {
      return res.status(400).json({
        error: 'description_required',
        message: 'Kapanış önerisi için en az 5 karakterlik açıklama gerekli.',
      });
    }
    if (resolution.length < 5) {
      return res.status(400).json({
        error: 'resolution_required',
        message: 'Kapanış önerisi için en az 5 karakterlik çözüm taslağı gerekli (worked step veya açıklama).',
      });
    }

    const setting = await externalKbSettingRepo.getByCompany(companyId);
    if (!setting?.enabled) {
      return res.status(400).json({
        error: 'external_kb_disabled',
        message: 'Bu şirket için External KB devre dışı; kapanış önerisi alınamıyor.',
      });
    }

    const sgBody = { description, resolution };
    if (openUrun) sgBody.open_urun = openUrun;
    if (openIsSureci) sgBody.open_is_sureci = openIsSureci;
    if (openIslemTipi) sgBody.open_islem_tipi = openIslemTipi;

    // Stage 3 resolution-first — kategorizasyon (suggestClose) ile aynı anda
    // analyze çağrısı yap → engineeringHandoff + customerReplyDraft draft'larını
    // current resolution metnine göre yeniden üret. Paralel + analyze bounded:
    // wall-clock max(suggestClose, min(analyze, ANALYZE_DRAFTS_TIMEOUT_MS)).
    //
    // Codex P2 #1 fix — Bounded analyze: KB v2 analyze endpoint'i tipik
    // ~180sn'ye kadar sürebiliyor (suggestClose çoğunlukla saniyeler içinde).
    // Eski impl Promise.allSettled iki çağrıyı da bekliyordu → analyze yavaş
    // olduğunda Stage 3 KB spinner kategoriler hazır olsa bile dakikalarca
    // kalıyordu (draft'lar optional, categorization core). Çözüm: analyze'a
    // race-timeout. Timeout kazanırsa drafts undefined → kullanıcı dropdown'ları
    // hemen alır, draft'ları sonra "Yenile" ile bekleyebilir.
    //
    // freeText = description + resolution composition: KB analyze case context
    // + son çözümü birlikte ister. Eski (Stage 2 opening) aiDrafts persist
    // davranışı bu route'ta tetiklenmez — yalnız in-memory response döner.
    const analyzeFreeText = description
      ? `${description}\n\nÇözüm: ${resolution}`
      : resolution;
    const ANALYZE_DRAFTS_TIMEOUT_MS = 8000;
    const ANALYZE_TIMEOUT_SENTINEL = { ok: false, timedOut: true };
    const analyzePromise = externalKbClient
      .analyze(setting, { freeText: analyzeFreeText })
      .catch((err) => ({ ok: false, thrown: true, error: { message: err?.message } }));
    const analyzeBounded = Promise.race([
      analyzePromise,
      new Promise((resolve) => setTimeout(() => resolve(ANALYZE_TIMEOUT_SENTINEL), ANALYZE_DRAFTS_TIMEOUT_MS)),
    ]);

    const [closeSettled, analyzeSettled] = await Promise.allSettled([
      externalKbClient.suggestClose(setting, sgBody),
      analyzeBounded,
    ]);

    let kbResponse;
    if (closeSettled.status === 'rejected') {
      console.error(
        '[smart-ticket/suggest-closure] suggest-close failed',
        closeSettled.reason?.message ?? closeSettled.reason,
      );
      return res.status(502).json({
        error: 'external_kb_failed',
        message: 'External KB çağrısı başarısız oldu. Manuel seçim yapılabilir.',
      });
    }
    kbResponse = closeSettled.value;

    // Codex P2 (main #447 review) — proxy() non-2xx için throw atmaz,
    // { ok: false, error, data } döner. Eski impl bu durumu "başarılı"
    // sayıp boş suggestions ile 200 dönüyordu → Stage 3 UI sessiz fail.
    // Wrapped error'ı network/timeout error'larıyla aynı 502'ye map'le.
    if (kbResponse && kbResponse.ok === false) {
      console.error(
        '[smart-ticket/suggest-closure] suggest-close returned ok:false',
        kbResponse.error?.code ?? 'unknown',
        kbResponse.error?.status ?? '',
      );
      return res.status(502).json({
        error: 'external_kb_failed',
        message: 'External KB çağrısı başarısız oldu. Manuel seçim yapılabilir.',
      });
    }

    const payload =
      kbResponse && typeof kbResponse === 'object'
        ? (kbResponse.data && typeof kbResponse.data === 'object' ? kbResponse.data : kbResponse)
        : {};

    const tax = await loadActiveClosureTaxonomies(companyId);

    // Kök Neden Grubu önce — sonra detayı yalnız bu grubun children'ında ara.
    const rcgMatch = matchByLabel(tax.rootCauseGroup, payload.kok_neden_grubu);
    const rcdCandidates = rcgMatch
      ? tax.rootCauseDetail.filter((d) => d.parentId === rcgMatch.id)
      : tax.rootCauseDetail;
    const rcdMatch = matchByLabel(rcdCandidates, payload.kok_neden_detayi);
    const rtMatch = matchByLabel(tax.resolutionType, payload.cozum_tipi);
    const ppMatch = matchByLabel(tax.permanentPrevention, payload.kalici_onlem);

    const suggestions = {};
    const unmatched = [];
    function addOrMiss(key, match, rawValue) {
      if (match) {
        suggestions[key] = { code: match.code, label: match.label, matchedBy: 'label' };
      } else if (rawValue) {
        unmatched.push({ taxonomyType: key, rawValue });
      }
    }
    addOrMiss('rootCauseGroup', rcgMatch, payload.kok_neden_grubu);
    addOrMiss('rootCauseDetail', rcdMatch, payload.kok_neden_detayi);
    addOrMiss('resolutionType', rtMatch, payload.cozum_tipi);
    addOrMiss('permanentPrevention', ppMatch, payload.kalici_onlem);

    const upstreamMeta = {};
    if (typeof payload.confidence === 'number') upstreamMeta.confidence = payload.confidence;
    if (typeof payload.reason === 'string') upstreamMeta.reason = payload.reason;
    if (typeof payload.modelUsed === 'string') upstreamMeta.modelUsed = payload.modelUsed;

    // Stage 3 resolution-first — paralel analyze cevabından drafts'ı çıkar.
    // analyze rejected veya { ok: false } ise drafts boş kalır; suggestion'lar
    // yine de döner (kullanıcı kategorileri görür).
    let drafts;
    if (analyzeSettled.status === 'fulfilled') {
      const analyzeRaw = analyzeSettled.value;
      if (analyzeRaw && analyzeRaw.timedOut) {
        console.warn(
          `[smart-ticket/suggest-closure] analyze bounded timeout ${ANALYZE_DRAFTS_TIMEOUT_MS}ms (drafts skipped)`,
        );
      } else if (analyzeRaw && analyzeRaw.ok === false) {
        console.warn(
          '[smart-ticket/suggest-closure] analyze returned ok:false (drafts skipped)',
          analyzeRaw.error?.code ?? analyzeRaw.error?.message ?? 'unknown',
        );
      } else {
        const analyzeData = analyzeRaw && analyzeRaw.data ? analyzeRaw.data : analyzeRaw;
        const extracted = extractAiDrafts(analyzeData);
        if (extracted.engineeringHandoff || extracted.customerReplyDraft) {
          drafts = extracted;
        }
      }
    } else {
      console.warn(
        '[smart-ticket/suggest-closure] analyze rejected (drafts skipped)',
        analyzeSettled.reason?.message ?? analyzeSettled.reason,
      );
    }

    res.json({
      companyId,
      suggestions,
      unmatched,
      source: 'external_kb',
      ...(drafts ? { drafts } : {}),
      meta: {
        usedEndpoint: 'suggest-close',
        ...upstreamMeta,
        ...(selectedWorkedStepId ? { selectedWorkedStepId } : {}),
        ...(contextStepsCount > 0 ? { contextStepsCount } : {}),
        ...(drafts ? { draftsSource: 'analyze' } : {}),
      },
    });
  } catch (err) {
    console.error('[smart-ticket/suggest-closure]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * WR-Smart-Ticket Phase T1 — POST /api/smart-ticket/transfer-brief
 *
 * Stage 3 (PR-T2) UI'sının prefill akışı için deterministic özet üretir.
 * AI çağrısı YOK — yalnız CaseSolutionStep tablosundan compose edilir.
 *
 * Body:  { caseId: string }
 * Yanıt:
 *   {
 *     caseId,
 *     composedSummary: string | null,
 *     attemptedStepIds: string[],
 *     stepOutcomesSummary: { worked, notWorked, skipped, pending, total }
 *   }
 *
 * Scope: allowedCompanyIds enforced — case'in companyId'si scope'a girmiyorsa 403.
 *
 * Klasik AI brief endpoint'i (/api/cases/:id/transfer-brief, transferAi.js) ile
 * çakışmaz; ayrı namespace + ayrı amaç (deterministic, KB persist yok).
 */
router.post('/transfer-brief', async (req, res) => {
  try {
    const body = req.body ?? {};
    const allowed = Array.isArray(req.user?.allowedCompanyIds) ? req.user.allowedCompanyIds : [];
    const caseId = typeof body.caseId === 'string' ? body.caseId.trim() : '';
    if (!caseId) {
      return res.status(400).json({ error: 'case_required', message: 'caseId zorunlu.' });
    }
    const caseRow = await prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, companyId: true },
    });
    if (!caseRow) {
      return res.status(404).json({ error: 'case_not_found', message: 'Vaka bulunamadı.' });
    }
    if (!allowed.includes(caseRow.companyId)) {
      return res.status(403).json({ error: 'forbidden', message: 'Bu vakaya erişim yok.' });
    }
    const brief = await composeTransferBriefFromSteps(caseId);
    res.json({ caseId, ...brief });
  } catch (err) {
    console.error('[smart-ticket/transfer-brief]', err);
    res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

export default router;
