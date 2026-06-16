/**
 * Case Report Studio Phase 2A — CaseSolutionStep aggregate loader.
 *
 * Sözleşme:
 *   - `loadSolutionStepAggregates(prisma, caseIds)` → `Map<caseId, AggregatePayload>`
 *   - Tek bir `prisma.caseSolutionStep.findMany({ where: { caseId: { in: caseIds } } })`
 *     çağrısı. N+1 yasak — preview/export aynı toplu fetch'i paylaşır.
 *   - caseIds[] boşsa boş Map döner (DB'ye dokunma).
 *   - Caller aggregate kolon seçilmediyse bu helper'ı hiç çağırmaz (perf).
 *
 * Status grouping (TASK spec):
 *   - suggestedCount  : status === 'suggested'
 *   - triedCount      : status ∈ {tried, worked, not_worked}
 *                       ("denenmiş ve outcome verilmiş veya outcome bekliyor"
 *                        — skipped DAHİL DEĞİL; atlanan adım "denenmedi")
 *   - workedCount     : status === 'worked'
 *   - notWorkedCount  : status === 'not_worked'
 *   - skippedCount    : status === 'skipped'
 *
 * Title/Source seçim mantığı:
 *   - firstWorkedTitle: status='worked' adımlardan outcomeAt ASC → stepIndex ASC.
 *                        Title yoksa boş.
 *   - workedSource    : Aynı first-worked step'in source field'ı (ai_suggested_step
 *                        / external_kb / manual / similar_case). Aynı sıralama,
 *                        formatter TR label'a çevirir.
 *   - lastTriedTitle  : status ∈ {tried, worked, not_worked, skipped} (yani
 *                        "henüz suggested olmayan" tüm step'ler) — sort key
 *                        COALESCE(outcomeAt, triedAt, updatedAt) DESC. İlk eleman.
 *
 * outcomeSummary template (Türkçe, sabit format):
 *   "Toplam {total} · Denenen {triedCount} · Başarılı {workedCount} · Başarısız {notWorkedCount}"
 *
 * Stored data MUTASYON YAPILMAZ; sadece okunup aggregate edilir.
 */

const TRIED_STATUSES = new Set(['tried', 'worked', 'not_worked']);
const COMPLETED_STATUSES = new Set(['tried', 'worked', 'not_worked', 'skipped']);

function maxDate(...vals) {
  let best = null;
  for (const v of vals) {
    if (!v) continue;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best;
}

function timeOrZero(v) {
  if (!v) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

function buildEmptyPayload() {
  return {
    total: 0,
    suggestedCount: 0,
    triedCount: 0,
    workedCount: 0,
    notWorkedCount: 0,
    skippedCount: 0,
    firstWorkedTitle: '',
    lastTriedTitle: '',
    workedSource: '',
    outcomeSummary: '',
  };
}

function summarize(steps) {
  const p = buildEmptyPayload();
  // Static smoke contract'ı: 0 step durumunda da template üretilir
  // ("Toplam 0 · Denenen 0 · Başarılı 0 · Başarısız 0"). Excel filtresi ve
  // UI tutarlılığı için boş string yerine kanonik özet tercih edildi.
  if (!Array.isArray(steps) || steps.length === 0) {
    p.outcomeSummary = 'Toplam 0 · Denenen 0 · Başarılı 0 · Başarısız 0';
    return p;
  }
  let firstWorked = null;
  let lastTried = null;
  for (const s of steps) {
    p.total += 1;
    switch (s.status) {
      case 'suggested': p.suggestedCount += 1; break;
      case 'tried':     p.triedCount += 1; break;
      case 'worked':    p.triedCount += 1; p.workedCount += 1; break;
      case 'not_worked':p.triedCount += 1; p.notWorkedCount += 1; break;
      case 'skipped':   p.skippedCount += 1; break;
      // bilinmeyen status → total'a sayılır ama alt sayaçlara değil
    }
    if (s.status === 'worked') {
      if (!firstWorked) {
        firstWorked = s;
      } else {
        const cur = timeOrZero(firstWorked.outcomeAt);
        const incoming = timeOrZero(s.outcomeAt);
        if (incoming < cur || (incoming === cur && s.stepIndex < firstWorked.stepIndex)) {
          firstWorked = s;
        }
      }
    }
    if (COMPLETED_STATUSES.has(s.status)) {
      if (!lastTried) {
        lastTried = s;
      } else {
        const cur = maxDate(lastTried.outcomeAt, lastTried.triedAt, lastTried.updatedAt) ?? 0;
        const incoming = maxDate(s.outcomeAt, s.triedAt, s.updatedAt) ?? 0;
        if (incoming > cur) lastTried = s;
      }
    }
  }
  if (firstWorked) {
    p.firstWorkedTitle = firstWorked.title ?? '';
    p.workedSource = firstWorked.source ?? '';
  }
  if (lastTried) {
    p.lastTriedTitle = lastTried.title ?? '';
  }
  p.outcomeSummary =
    `Toplam ${p.total}`
    + ` · Denenen ${p.triedCount}`
    + ` · Başarılı ${p.workedCount}`
    + ` · Başarısız ${p.notWorkedCount}`;
  return p;
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string[]} caseIds
 * @returns {Promise<Map<string, ReturnType<typeof buildEmptyPayload>>>}
 */
export async function loadSolutionStepAggregates(prisma, caseIds) {
  const map = new Map();
  if (!Array.isArray(caseIds) || caseIds.length === 0) return map;
  // Tek query — tüm caseId'lerin step'lerini bir kerede çek.
  const rows = await prisma.caseSolutionStep.findMany({
    where: { caseId: { in: caseIds } },
    select: {
      caseId: true,
      stepIndex: true,
      source: true,
      title: true,
      status: true,
      triedAt: true,
      outcomeAt: true,
      updatedAt: true,
    },
  });
  // caseId → step[] grupla
  const byCase = new Map();
  for (const row of rows) {
    let bucket = byCase.get(row.caseId);
    if (!bucket) { bucket = []; byCase.set(row.caseId, bucket); }
    bucket.push(row);
  }
  // Boş case'ler (step'i olmayan vakalar) için de boş payload — UI'da 0/blank
  // doğru gösterilsin.
  for (const id of caseIds) {
    const steps = byCase.get(id) ?? [];
    map.set(id, summarize(steps));
  }
  return map;
}

// ──────────────────────────────────────────────────────────────────────
// Phase 2B.1 — CaseActivity aggregate
// ──────────────────────────────────────────────────────────────────────
//
// Sözleşme:
//   - Tek `prisma.caseActivity.findMany({ where: { caseId: { in } } })`
//   - in-memory groupBy + summarize per case
//   - Smart Ticket ayrımı YOK — tüm Case'lerde çalışır
//   - Empty case → tüm sayaçlar 0, string alanlar ''
//
// Alanlar:
//   - activityCount       : tüm aktivitelerin sayısı
//   - firstActor          : at ASC ilk aktivitenin actor'u
//   - lastActor           : at DESC son aktivitenin actor'u
//   - lastActivityAt      : Date | null (formatter datetimeTr uygular)
//   - lastStatusChange    : actionType='StatusChange' olan en son aktivitenin
//                            toValue'su + datetime stringi (compact).
//                            "<toValue> · <DD.MM.YYYY HH:mm>" — hem hangi
//                            statüye geçti hem ne zaman. Empty ise ''.
//
// Status değişikliği tespiti:
//   actionType === 'StatusChange' (caseRepository.update'in atatığı value).
//   Eski/legacy formatlar olabilir; bu durumda gözden kaçar (sessiz).

function buildEmptyActivityPayload() {
  return {
    activityCount: 0,
    firstActor: '',
    lastActor: '',
    lastActivityAt: null, // Date | null — formatter datetime
    lastStatusChange: '', // compact string
  };
}

// Intl.DateTimeFormat reuse — aynı tek instance hem aggregate satırlarda
// hem solutionSteps-format'ında çakışmaz; bu modül kendi instance'ı.
const ACTIVITY_TR_DT = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
});

function toDateOrNull(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function summarizeActivities(rows) {
  const p = buildEmptyActivityPayload();
  if (!Array.isArray(rows) || rows.length === 0) return p;
  let first = null;
  let last = null;
  let lastStatusChange = null;
  for (const r of rows) {
    p.activityCount += 1;
    const t = toDateOrNull(r.at);
    if (!first || (t && toDateOrNull(first.at)?.getTime() > t.getTime())) first = r;
    if (!last || (t && (!toDateOrNull(last.at) || toDateOrNull(last.at).getTime() < t.getTime()))) last = r;
    if (r.actionType === 'StatusChange') {
      if (!lastStatusChange) lastStatusChange = r;
      else {
        const cur = toDateOrNull(lastStatusChange.at)?.getTime() ?? 0;
        const inc = t?.getTime() ?? 0;
        if (inc > cur) lastStatusChange = r;
      }
    }
  }
  if (first) p.firstActor = first.actor ?? '';
  if (last) {
    p.lastActor = last.actor ?? '';
    p.lastActivityAt = toDateOrNull(last.at);
  }
  if (lastStatusChange) {
    const to = lastStatusChange.toValue ?? '';
    const d = toDateOrNull(lastStatusChange.at);
    const dStr = d ? ACTIVITY_TR_DT.format(d) : '';
    p.lastStatusChange = to && dStr ? `${to} · ${dStr}` : (to || dStr);
  }
  return p;
}

export async function loadCaseActivityAggregates(prisma, caseIds) {
  const map = new Map();
  if (!Array.isArray(caseIds) || caseIds.length === 0) return map;
  const rows = await prisma.caseActivity.findMany({
    where: { caseId: { in: caseIds } },
    select: { caseId: true, actor: true, at: true, actionType: true, toValue: true },
  });
  const byCase = new Map();
  for (const row of rows) {
    let bucket = byCase.get(row.caseId);
    if (!bucket) { bucket = []; byCase.set(row.caseId, bucket); }
    bucket.push(row);
  }
  for (const id of caseIds) map.set(id, summarizeActivities(byCase.get(id) ?? []));
  return map;
}

// ──────────────────────────────────────────────────────────────────────
// Phase 2B.1 — CaseNote aggregate
// ──────────────────────────────────────────────────────────────────────
//
// Sözleşme:
//   - Tek `prisma.caseNote.findMany({ where: { caseId: { in } } })`
//   - in-memory groupBy + summarize per case
//   - visibility değerleri DB'de 'Internal' | 'Customer' (NoteVisibility enum).
//     - internalNoteCount = visibility === 'Internal'
//     - externalNoteCount = visibility === 'Customer' (müşteriye görünür)
//     - Bilinmeyen değerler iki sayaçtan da hariç (defansif).
//   - Reply not'ları (parentNoteId != null) hâlâ noteCount'a dahil — tüm
//     CaseNote satırları sayılır.
//
// Alanlar:
//   - noteCount         : satır sayısı
//   - lastNoteAt        : Date | null — formatter datetimeTr
//   - lastNoteAuthor    : authorName (createdAt DESC)
//   - internalNoteCount : visibility='Internal'
//   - externalNoteCount : visibility='Customer'

function buildEmptyNotePayload() {
  return {
    noteCount: 0,
    lastNoteAt: null,
    lastNoteAuthor: '',
    internalNoteCount: 0,
    externalNoteCount: 0,
  };
}

function summarizeNotes(rows) {
  const p = buildEmptyNotePayload();
  if (!Array.isArray(rows) || rows.length === 0) return p;
  let last = null;
  for (const r of rows) {
    p.noteCount += 1;
    if (r.visibility === 'Internal') p.internalNoteCount += 1;
    else if (r.visibility === 'Customer') p.externalNoteCount += 1;
    const t = toDateOrNull(r.createdAt);
    if (!last || (t && (!toDateOrNull(last.createdAt) || toDateOrNull(last.createdAt).getTime() < t.getTime()))) {
      last = r;
    }
  }
  if (last) {
    p.lastNoteAt = toDateOrNull(last.createdAt);
    p.lastNoteAuthor = last.authorName ?? '';
  }
  return p;
}

export async function loadCaseNoteAggregates(prisma, caseIds) {
  const map = new Map();
  if (!Array.isArray(caseIds) || caseIds.length === 0) return map;
  const rows = await prisma.caseNote.findMany({
    where: { caseId: { in: caseIds } },
    select: { caseId: true, authorName: true, visibility: true, createdAt: true },
  });
  const byCase = new Map();
  for (const row of rows) {
    let bucket = byCase.get(row.caseId);
    if (!bucket) { bucket = []; byCase.set(row.caseId, bucket); }
    bucket.push(row);
  }
  for (const id of caseIds) map.set(id, summarizeNotes(byCase.get(id) ?? []));
  return map;
}

/** Test/debug için saf summarize'lar ihraç edilir (smoke + unit). */
export const __internal = {
  summarize,
  buildEmptyPayload,
  summarizeActivities,
  buildEmptyActivityPayload,
  summarizeNotes,
  buildEmptyNotePayload,
};
