/**
 * WR-Smart-Ticket Phase 2a — CaseSolutionStep repository.
 *
 * Hayat döngüsü:
 *   suggested → tried → worked | not_worked | skipped
 *
 * Source whitelist:
 *   - ai_suggested_step   — External KB `analyze` cevabının
 *                           `analysis.suggestedSteps` bölümünden
 *   - manual              — L1 agent serbest girişi
 *   - external_kb         — KB başka bir kanal (ileri PR)
 *   - similar_case        — Benzer vaka eşleştirmesi (ileri PR)
 *
 * Multi-tenant: companyId her zaman Case.companyId'den türetilir.
 * Client payload'taki companyId/caseId ignore edilir; route handler
 * scope guard ek katmandır.
 *
 * Idempotency: aynı (caseId, source, sourceRef) tuple unique. Manual
 * satırlar sourceRef = NULL → Postgres unique kuralında ayrı sayılır,
 * birden fazla manual step izin verilir.
 *
 * Bu fazda **yalnız** AI Önerilen Adımlar import edilir; root cause /
 * customer reply / engineer handoff / similar / raw response bilinçli
 * olarak göz ardı edilir.
 */

import crypto from 'node:crypto';
import { prisma } from './client.js';

class SolutionStepError extends Error {
  constructor(message, { status = 400, code = 'solution_step_error' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const VALID_SOLUTION_STEP_SOURCES = [
  'ai_suggested_step',
  'manual',
  'external_kb',
  'similar_case',
];
export const VALID_SOLUTION_STEP_STATUSES = [
  'suggested',
  'tried',
  'worked',
  'not_worked',
  'skipped',
];
const TERMINAL_STATUSES = new Set(['worked', 'not_worked', 'skipped']);

const STEP_SELECT = {
  id: true,
  caseId: true,
  companyId: true,
  stepIndex: true,
  source: true,
  sourceRef: true,
  sourceTitle: true,
  title: true,
  description: true,
  status: true,
  note: true,
  triedAt: true,
  triedByUserId: true,
  outcomeAt: true,
  outcomeByUserId: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
};

// ─────────────────────────────────────────────────────────────────
// Scope helper
// ─────────────────────────────────────────────────────────────────

async function assertCaseScope(caseId, allowedCompanyIds) {
  const allowed = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
  if (!caseId) throw new SolutionStepError('caseId gerekli.', { status: 400, code: 'case_required' });
  const row = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, companyId: true },
  });
  if (!row) throw new SolutionStepError('Vaka bulunamadı.', { status: 404, code: 'case_not_found' });
  if (!allowed.includes(row.companyId)) {
    throw new SolutionStepError('Bu vakaya erişim yok.', { status: 403, code: 'forbidden' });
  }
  return row;
}

async function assertStepScope(stepId, allowedCompanyIds) {
  const allowed = Array.isArray(allowedCompanyIds) ? allowedCompanyIds : [];
  if (!stepId) throw new SolutionStepError('stepId gerekli.', { status: 400, code: 'step_required' });
  const step = await prisma.caseSolutionStep.findUnique({
    where: { id: stepId },
    select: { id: true, caseId: true, companyId: true, source: true, status: true },
  });
  if (!step) throw new SolutionStepError('Çözüm adımı bulunamadı.', { status: 404, code: 'step_not_found' });
  if (!allowed.includes(step.companyId)) {
    throw new SolutionStepError('Bu adıma erişim yok.', { status: 403, code: 'forbidden' });
  }
  return step;
}

// ─────────────────────────────────────────────────────────────────
// AI suggested-step extraction
// ─────────────────────────────────────────────────────────────────

/**
 * External KB analyze cevabından **yalnız** `analysis.suggestedSteps`
 * bölümünü çıkarır. Diğer alanları (rootCauseHypotheses,
 * customerReplyDraft, engineeringHandoff, similar, panoramaScreens,
 * citations, kbChunks, hits, answer, ...) **bilinçle yok sayar**.
 *
 * Item formatları (UI'da görülen):
 *   - string                                              → {title}
 *   - { text|instruction|title, rationale|note }          → {title, description}
 *
 * Boş title üreten item'lar atlanır (defensive — string trim, object
 * fallback'ler boş kalırsa).
 */
/**
 * Bir string item JSON object string'i olabilir. KB upstream'i bazen:
 *   '{"step": "...", "rationale": "..."}'
 * formatında gönderiyor — `step` ve `rationale` alanlarını okuyamadan
 * raw JSON'u `title`'a düşürmek UI'da `{...}` braces gösterirdi.
 * Bu helper başarılıysa parse edilmiş objeyi, başarısızsa null döner.
 */
function tryParseJsonItem(text) {
  const t = text.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Geçersiz JSON — string'i olduğu gibi title yapacağız (fallback safe).
  }
  return null;
}

/**
 * Codex parser review (post Phase 2c) — KB upstream'i bazen `step` alanını
 * "ordinal" olarak (number veya numerik string) gönderiyor:
 *   { step: 1, text: "Clear cache" }
 *   { step: "1.", text: "..." }
 * Önceki implementation `obj.step` truthy ise (1 dahil) onu title'a
 * düşürüyordu — sonuç: "1" karakterlik anlamsız adımlar.
 *
 * Bu helper `step` ve diğer alanları yalnız ANLAMLI metin (boş değil,
 * sadece ordinal numarası değil) ise dönüştürür.
 *
 *   "1"      → ''   (ordinal)
 *   "1)"     → ''   (ordinal)
 *   "1."     → ''   (ordinal)
 *   "Step 1" → 'Step 1'  (gerçek metin)
 *   123      → ''   (string değil)
 */
function meaningfulText(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  // Sırf rakam veya "1." / "1)" gibi ordinal işaretleri → anlamsız.
  if (/^\d+[).]?$/.test(trimmed)) return '';
  return trimmed;
}

/**
 * Object item'ı title/description'a normalize eder. Title öncelik:
 *   1) text
 *   2) instruction
 *   3) title
 *   4) step (yalnız anlamlı non-ordinal string ise)
 *
 * `step` artık DAHA DÜŞÜK öncelik — KB upstream'i numeric ordinal
 * gönderdiğinde gerçek `text` alanı title olur. step string ise
 * (örneğin '{"step":"Cache temizle"}' JSON varyantı) backward-compatible
 * olarak fallback'e düşer.
 *
 * Description öncelik: rationale > note > description.
 */
function normalizeStepObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const title =
    meaningfulText(obj.text) ||
    meaningfulText(obj.instruction) ||
    meaningfulText(obj.title) ||
    meaningfulText(obj.step);
  if (!title) return null;
  const descRaw = obj.rationale || obj.note || obj.description;
  const description = typeof descRaw === 'string' && descRaw.trim() ? descRaw.trim() : null;
  return { title, description };
}

export function extractAiSuggestedSteps(analyzeResponse) {
  if (!analyzeResponse || typeof analyzeResponse !== 'object') return [];
  const analysis = analyzeResponse.analysis;
  if (!analysis || typeof analysis !== 'object') return [];
  const raw = analysis.suggestedSteps;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (item == null) continue;
    if (typeof item === 'string') {
      // Önce JSON object string'i mi diye dene (KB upstream realite check).
      const parsed = tryParseJsonItem(item);
      if (parsed) {
        const norm = normalizeStepObject(parsed);
        if (norm) out.push(norm);
        continue;
      }
      // Düz metin step — title olarak al.
      const t = item.trim();
      if (t) out.push({ title: t, description: null });
      continue;
    }
    if (typeof item === 'object') {
      const norm = normalizeStepObject(item);
      if (norm) out.push(norm);
    }
  }
  return out;
}

function stableHash(title, description) {
  // Re-run import dedup için deterministic hash. Upstream KB stable id
  // vermiyor — title + description tek anahtardır. SHA-256 ilk 16 karakter
  // (= 64 bit) çakışma olasılığı pratik açıdan sıfır (bir case için
  // gönderilen step sayısı 10-30 mertebesinde).
  const norm = `${title} ${description ?? ''}`.normalize('NFC').toLowerCase();
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

async function nextStepIndex(caseId) {
  const max = await prisma.caseSolutionStep.aggregate({
    where: { caseId },
    _max: { stepIndex: true },
  });
  return (max._max.stepIndex ?? 0) + 1;
}

function trimRequired(value, label) {
  if (typeof value !== 'string') {
    throw new SolutionStepError(`${label} gerekli.`, { status: 400, code: 'field_required' });
  }
  const out = value.trim();
  if (!out) throw new SolutionStepError(`${label} gerekli.`, { status: 400, code: 'field_required' });
  return out;
}

function trimOptional(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

// ─────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Transfer brief composer
// ─────────────────────────────────────────────────────────────────

const TRANSFER_STATUS_LABEL = {
  suggested: 'Önerildi',
  tried: 'Denendi',
  worked: 'İşe yaradı',
  not_worked: 'İşe yaramadı',
  skipped: 'Uygun değil',
};

const TRANSFER_SOURCE_LABEL = {
  ai_suggested_step: 'KB önerisi',
  manual: 'Manuel',
  external_kb: 'KB önerisi',
  similar_case: 'Benzer vaka',
};

/**
 * WR-Smart-Ticket Phase T1 — L1 → L2 devir akışı için deterministic
 * "denenen işlemler özeti" üretir. L2 agent vakayı ilk açtığında L1'in
 * neyi denediğini, hangisinin işe yaramadığını net görür.
 *
 * Davranış:
 *  - Boş step listesi → null döner (transferContext.composedSummary
 *    boş kalır, UI fallback metin gösterir).
 *  - status enum'a göre TR label; source enum'a göre "KB/Manuel" etiketi.
 *  - Outcome metrikleri (worked/notWorked/skipped/pending) hesaplanır.
 *  - attemptedStepIds: TÜM step id'leri (transferContext'te referans).
 *
 * Server-side compose tek truth source. UI override edebilir
 * (kullanıcı düzenlemesi); kalıcı edit edilen değer
 * `transferContext.composedSummary`'ye yazılır.
 */
export async function composeTransferBriefFromSteps(caseId) {
  if (!caseId) {
    throw new SolutionStepError('caseId gerekli.', { status: 400, code: 'case_required' });
  }
  const steps = await prisma.caseSolutionStep.findMany({
    where: { caseId },
    orderBy: [{ stepIndex: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      stepIndex: true,
      source: true,
      title: true,
      description: true,
      status: true,
      note: true,
    },
  });

  const outcomes = { worked: 0, notWorked: 0, skipped: 0, pending: 0, total: steps.length };
  for (const s of steps) {
    if (s.status === 'worked') outcomes.worked += 1;
    else if (s.status === 'not_worked') outcomes.notWorked += 1;
    else if (s.status === 'skipped') outcomes.skipped += 1;
    else outcomes.pending += 1;
  }

  const attemptedStepIds = steps.map((s) => s.id);

  let composedSummary = null;
  if (steps.length > 0) {
    const lines = ['Denenen adımlar:'];
    for (const s of steps) {
      const statusLabel = TRANSFER_STATUS_LABEL[s.status] ?? s.status;
      const sourceLabel = TRANSFER_SOURCE_LABEL[s.source] ?? s.source;
      const noteSuffix = s.note ? ` — Not: ${s.note}` : '';
      lines.push(`- [${statusLabel}] ${s.title} (${sourceLabel})${noteSuffix}`);
    }
    lines.push('');
    lines.push(
      `Toplam: ${outcomes.total} · İşe yaradı: ${outcomes.worked} · İşe yaramadı: ${outcomes.notWorked} · Uygun değil: ${outcomes.skipped} · Beklemede: ${outcomes.pending}`,
    );
    composedSummary = lines.join('\n');
  }

  return { composedSummary, attemptedStepIds, stepOutcomesSummary: outcomes };
}

export const solutionStepRepository = {
  SolutionStepError,
  composeTransferBriefFromSteps,

  /**
   * Public scope helper — route handler'lar Case'in companyId'sini
   * (External KB setting fetch, vb.) almak için kullanır. allowedCompanyIds
   * scope kontrolü içinde uygulanır; başarısızsa SolutionStepError fırlatır.
   */
  async getCaseCompanyId(caseId, allowedCompanyIds) {
    const row = await assertCaseScope(caseId, allowedCompanyIds);
    return row.companyId;
  },

  async list(caseId, allowedCompanyIds) {
    await assertCaseScope(caseId, allowedCompanyIds);
    return prisma.caseSolutionStep.findMany({
      where: { caseId },
      select: STEP_SELECT,
      orderBy: [{ stepIndex: 'asc' }, { createdAt: 'asc' }],
    });
  },

  async createManual(caseId, input, userId, allowedCompanyIds) {
    const caseRow = await assertCaseScope(caseId, allowedCompanyIds);
    const title = trimRequired(input?.title, 'title');
    const description = trimOptional(input?.description);
    const note = trimOptional(input?.note);
    const stepIndex = await nextStepIndex(caseId);
    return prisma.caseSolutionStep.create({
      data: {
        caseId,
        companyId: caseRow.companyId,
        stepIndex,
        source: 'manual',
        // sourceRef = null → Postgres unique kuralı NULL'ları ayrı sayar:
        // aynı case altında birden fazla manual satıra izin verilir.
        sourceRef: null,
        sourceTitle: trimOptional(input?.sourceTitle),
        title,
        description,
        status: 'suggested',
        note,
        createdByUserId: userId ?? null,
      },
      select: STEP_SELECT,
    });
  },

  async update(stepId, patch, userId, allowedCompanyIds) {
    const step = await assertStepScope(stepId, allowedCompanyIds);
    const data = {};
    if (patch?.title !== undefined) data.title = trimRequired(patch.title, 'title');
    if (patch?.description !== undefined) data.description = trimOptional(patch.description);
    if (patch?.note !== undefined) data.note = trimOptional(patch.note);
    if (patch?.sourceTitle !== undefined) data.sourceTitle = trimOptional(patch.sourceTitle);
    // Status / source / case değişikliği bu endpoint'ten yapılmaz.
    if ('status' in (patch ?? {}) || 'source' in (patch ?? {}) || 'caseId' in (patch ?? {})) {
      throw new SolutionStepError(
        'status / source / caseId bu endpoint\'ten değiştirilemez.',
        { status: 400, code: 'immutable_field' },
      );
    }
    if (Object.keys(data).length === 0) {
      // No-op update istisnası — caller bir şey değiştirmediyse mevcut satırı dönelim.
      return prisma.caseSolutionStep.findUnique({ where: { id: stepId }, select: STEP_SELECT });
    }
    return prisma.caseSolutionStep.update({
      where: { id: stepId },
      data,
      select: STEP_SELECT,
    });
  },

  async setStatus(stepId, status, opts, userId, allowedCompanyIds) {
    const step = await assertStepScope(stepId, allowedCompanyIds);
    if (!VALID_SOLUTION_STEP_STATUSES.includes(status)) {
      throw new SolutionStepError(
        `Geçersiz status. Geçerli: ${VALID_SOLUTION_STEP_STATUSES.join(', ')}`,
        { status: 400, code: 'invalid_status' },
      );
    }
    const data = { status };
    const note = trimOptional(opts?.note);
    if (note !== null) data.note = note;
    const now = new Date();
    if (status === 'tried') {
      data.triedAt = now;
      data.triedByUserId = userId ?? null;
      // Outcome alanları clear edilir — tried, terminal'den önce gelir.
      data.outcomeAt = null;
      data.outcomeByUserId = null;
    } else if (TERMINAL_STATUSES.has(status)) {
      // 'tried' aşaması atlanmış olabilir (ör. agent direkt skipped işaretler);
      // sorun değil — triedAt'i değiştirmeden outcome alanlarını set ediyoruz.
      data.outcomeAt = now;
      data.outcomeByUserId = userId ?? null;
    } else if (status === 'suggested') {
      // Geri sarma: triedAt + outcomeAt clear.
      data.triedAt = null;
      data.triedByUserId = null;
      data.outcomeAt = null;
      data.outcomeByUserId = null;
    }
    return prisma.caseSolutionStep.update({
      where: { id: step.id },
      data,
      select: STEP_SELECT,
    });
  },

  /**
   * External KB `analyze` cevabından AI Önerilen Adımlar'ı import eder.
   *
   * Davranış:
   *  - Yalnız `analysis.suggestedSteps` bölümünü okur (diğerleri ignored).
   *  - Mevcut adımlar etkilenmez; status değişmez.
   *  - Aynı (case, source, sourceRef) varsa SKIP edilir (idempotent).
   *  - Yeni adımlar stepIndex = max + 1, +2, ... olarak eklenir.
   *  - 200 + tüm liste döndürülür; hiçbir yeni adım olmasa bile hata değil.
   *
   * Boş cevap (suggestedSteps yok / boş array) için fırlatmaz; sadece
   * existing list döner.
   */
  async importAiSuggested(caseId, analyzeResponse, userId, allowedCompanyIds) {
    const caseRow = await assertCaseScope(caseId, allowedCompanyIds);
    const extracted = extractAiSuggestedSteps(analyzeResponse);
    const before = await prisma.caseSolutionStep.findMany({
      where: { caseId, source: 'ai_suggested_step' },
      select: { sourceRef: true },
    });
    const knownRefs = new Set(before.map((r) => r.sourceRef).filter(Boolean));
    let nextIdx = await nextStepIndex(caseId);
    const created = [];
    const skipped = [];
    for (const step of extracted) {
      const sourceRef = stableHash(step.title, step.description);
      if (knownRefs.has(sourceRef)) {
        skipped.push(sourceRef);
        continue;
      }
      try {
        const row = await prisma.caseSolutionStep.create({
          data: {
            caseId,
            companyId: caseRow.companyId,
            stepIndex: nextIdx++,
            source: 'ai_suggested_step',
            sourceRef,
            sourceTitle: 'External KB analyze',
            title: step.title,
            description: step.description,
            status: 'suggested',
            createdByUserId: userId ?? null,
          },
          select: STEP_SELECT,
        });
        created.push(row);
        knownRefs.add(sourceRef);
      } catch (err) {
        // Concurrent import race → unique constraint hatası SKIP say.
        if (err?.code === 'P2002') {
          skipped.push(sourceRef);
          continue;
        }
        throw err;
      }
    }
    const all = await prisma.caseSolutionStep.findMany({
      where: { caseId },
      select: STEP_SELECT,
      orderBy: [{ stepIndex: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      items: all,
      summary: {
        importedCount: created.length,
        skippedCount: skipped.length,
        totalCount: all.length,
      },
    };
  },
};

export { SolutionStepError };
