/**
 * Case Report Studio Phase 2A — CaseSolutionStep aggregate loader.
 *
 * Sözleşme:
 *   - `loadSolutionStepAggregates(prisma, caseIds)` → `Map<caseId, AggregatePayload>`
 *   - `findManyChunked()` helper'ıyla toplu fetch (bkz. aşağıdaki tanım).
 *     N+1 yasak — preview/export aynı toplu fetch'i paylaşır.
 *     (2026-08-19: MSSQL 2100 parametre sınırı için 1000'lik chunk'lara
 *     bölünür — bkz. findManyChunked tanımı.)
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

// 2026-08-19 fix — MSSQL parametre sınırı (2100). Rapor Studyosu export'u
// tek seferde 20.000 case id'ye kadar aggregate sorgusu atabiliyor;
// caseId filtresi tek IN(...) sorgusunda kalırsa liste kolayca
// parametre sınırını aşıyor (code 8003, "The incoming request has too many
// parameters"). TÜM aggregate loader'lar caseIds'i 1000'lik gruplara bölüp
// ayrı sorgularla çeker (caseRepository.js'teki aynı chunking deseni —
// findManyChunked). Chunk case ID'ye göre bölündüğü için (zamana göre
// DEĞİL), bir case'in tüm satırları her zaman AYNI chunk'ta kalır —
// per-case "en erken/en son" mantığı (orderBy her chunk'ta korunur) bozulmaz.
const CASE_ID_CHUNK_SIZE = 1000;
async function findManyChunked(model, caseIds, { where = {}, select, orderBy } = {}) {
  const out = [];
  for (let i = 0; i < caseIds.length; i += CASE_ID_CHUNK_SIZE) {
    const chunk = caseIds.slice(i, i + CASE_ID_CHUNK_SIZE);
    const rows = await model.findMany({
      where: { ...where, caseId: { in: chunk } },
      select,
      ...(orderBy ? { orderBy } : {}),
    });
    out.push(...rows);
  }
  return out;
}

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
  // caseIds 1000'lik gruplara bölünür (MSSQL 2100 parametre sınırı — bkz. findManyChunked).
  const rows = await findManyChunked(prisma.caseSolutionStep, caseIds, {
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
  const rows = await findManyChunked(prisma.caseActivity, caseIds, {
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
  const rows = await findManyChunked(prisma.caseNote, caseIds, {
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

// ──────────────────────────────────────────────────────────────────────
// Phase 2B.2 — CaseAttachment (Dosya) aggregate
// ──────────────────────────────────────────────────────────────────────
//
// Sözleşme:
//   - Tek `prisma.caseAttachment.findMany({ where: { caseId: { in } } })`
//   - in-memory groupBy + summarize per case
//
// Alanlar:
//   - fileCount   : satır sayısı
//   - totalSizeMb : tüm dosyaların byte toplamı → MB (1 ondalık, "X.Y" string).
//                    Excel'de okunabilir ondalık format. 0 dosya → 0 değil ''.

function buildEmptyFilePayload() {
  return {
    fileCount: 0,
    totalSizeMb: '', // 0 dosya → blank; rapor kırılmaz
  };
}

function bytesToMb(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  // 0.1 MB'tan küçük → 2 ondalık; >= 0.1 → 1 ondalık. Excel için string.
  return mb < 0.1 ? mb.toFixed(2) : mb.toFixed(1);
}

function summarizeFiles(rows) {
  const p = buildEmptyFilePayload();
  if (!Array.isArray(rows) || rows.length === 0) return p;
  let total = 0;
  for (const r of rows) {
    p.fileCount += 1;
    if (Number.isFinite(r.fileSize) && r.fileSize > 0) total += r.fileSize;
  }
  if (total > 0) p.totalSizeMb = bytesToMb(total);
  else if (p.fileCount > 0) p.totalSizeMb = '0.0'; // dosya var ama hepsi 0 byte
  return p;
}

export async function loadCaseFileAggregates(prisma, caseIds) {
  const map = new Map();
  if (!Array.isArray(caseIds) || caseIds.length === 0) return map;
  const rows = await findManyChunked(prisma.caseAttachment, caseIds, {
    select: { caseId: true, fileSize: true },
  });
  const byCase = new Map();
  for (const row of rows) {
    let bucket = byCase.get(row.caseId);
    if (!bucket) { bucket = []; byCase.set(row.caseId, bucket); }
    bucket.push(row);
  }
  for (const id of caseIds) map.set(id, summarizeFiles(byCase.get(id) ?? []));
  return map;
}

// ──────────────────────────────────────────────────────────────────────
// Phase 2B.2 — CaseCallLog (Çağrı) aggregate
// ──────────────────────────────────────────────────────────────────────
//
// Alanlar:
//   - callCount       : satır sayısı
//   - lastCallResult  : en son callDate'in callOutcome'u
//                       ('Memnun' / 'MemnunDeğil' / 'Tarafsız' / 'Ulaşılamadı')
//   - lastCallAt      : Date | null — formatter datetimeTr

function buildEmptyCallPayload() {
  return {
    callCount: 0,
    lastCallResult: '',
    lastCallAt: null,
  };
}

function summarizeCalls(rows) {
  const p = buildEmptyCallPayload();
  if (!Array.isArray(rows) || rows.length === 0) return p;
  let last = null;
  for (const r of rows) {
    p.callCount += 1;
    const t = toDateOrNull(r.callDate);
    if (!last || (t && (!toDateOrNull(last.callDate) || toDateOrNull(last.callDate).getTime() < t.getTime()))) {
      last = r;
    }
  }
  if (last) {
    p.lastCallAt = toDateOrNull(last.callDate);
    p.lastCallResult = last.callOutcome ?? '';
  }
  return p;
}

export async function loadCaseCallAggregates(prisma, caseIds) {
  const map = new Map();
  if (!Array.isArray(caseIds) || caseIds.length === 0) return map;
  const rows = await findManyChunked(prisma.caseCallLog, caseIds, {
    select: { caseId: true, callDate: true, callOutcome: true },
  });
  const byCase = new Map();
  for (const row of rows) {
    let bucket = byCase.get(row.caseId);
    if (!bucket) { bucket = []; byCase.set(row.caseId, bucket); }
    bucket.push(row);
  }
  for (const id of caseIds) map.set(id, summarizeCalls(byCase.get(id) ?? []));
  return map;
}

// ──────────────────────────────────────────────────────────────────────
// Phase 2B.2 — CaseTransfer (Transfer) aggregate
// ──────────────────────────────────────────────────────────────────────
//
// Sözleşme:
//   - Tek `prisma.caseTransfer.findMany({ where: { caseId: { in } } })`
//   - lastTransferTargetTeam için Team isim eşlemesi: tek extra
//     `prisma.team.findMany({ where: { id: { in: distinctToTeamIds } } })`.
//     Toplam 2 fixed query (N+1 değil — case sayısından bağımsız).
//
// Alanlar:
//   - transferCount          : satır sayısı (CaseTransfer rows; Case.transferCount
//                              denormalize alanından bağımsız — bağımsız truth)
//   - lastTransferTargetTeam : en son transferredAt'in toTeamId'sine karşılık
//                              Team.name (yoksa raw id)
//   - lastTransferAt         : Date | null — formatter datetimeTr

function buildEmptyTransferPayload() {
  return {
    transferCount: 0,
    lastTransferTargetTeam: '',
    lastTransferAt: null,
  };
}

function summarizeTransfers(rows, teamNamesById) {
  const p = buildEmptyTransferPayload();
  if (!Array.isArray(rows) || rows.length === 0) return p;
  let last = null;
  for (const r of rows) {
    p.transferCount += 1;
    const t = toDateOrNull(r.transferredAt);
    if (!last || (t && (!toDateOrNull(last.transferredAt) || toDateOrNull(last.transferredAt).getTime() < t.getTime()))) {
      last = r;
    }
  }
  if (last) {
    p.lastTransferAt = toDateOrNull(last.transferredAt);
    const toId = last.toTeamId ?? '';
    p.lastTransferTargetTeam = (teamNamesById && teamNamesById.get(toId)) || toId;
  }
  return p;
}

export async function loadCaseTransferAggregates(prisma, caseIds) {
  const map = new Map();
  if (!Array.isArray(caseIds) || caseIds.length === 0) return map;
  const rows = await findManyChunked(prisma.caseTransfer, caseIds, {
    select: { caseId: true, toTeamId: true, transferredAt: true },
  });
  // Team isimleri için tek ek query (N+1 değil — distinct toTeamId set'i)
  const teamIds = Array.from(new Set(rows.map((r) => r.toTeamId).filter(Boolean)));
  let teamNamesById = new Map();
  if (teamIds.length > 0) {
    const teams = await prisma.team.findMany({
      where: { id: { in: teamIds } },
      select: { id: true, name: true },
    });
    teamNamesById = new Map(teams.map((t) => [t.id, t.name]));
  }
  const byCase = new Map();
  for (const row of rows) {
    let bucket = byCase.get(row.caseId);
    if (!bucket) { bucket = []; byCase.set(row.caseId, bucket); }
    bucket.push(row);
  }
  for (const id of caseIds) map.set(id, summarizeTransfers(byCase.get(id) ?? [], teamNamesById));
  return map;
}

// ──────────────────────────────────────────────────────────────────────
// İlk Atanan Kişi / Takım aggregate
// ──────────────────────────────────────────────────────────────────────
//
// Sözleşme — export-vaka-ilk-atanan-kapatan-temmuz-agustos.mjs script'iyle
// başlayan mantık, rapor pipeline'ına taşındı, sonra code-review bulgusuyla
// düzeltildi:
//   - "İlk atanan kişi" — kişi değişikliği İKİ farklı kaynaktan gelebilir:
//       1) CaseActivity fieldName='assignedPersonId' — claim()/manuel atama
//          yolu.
//       2) CaseTransfer.fromPersonId/toPersonId — transferCase() yolu.
//          ÖNEMLİ: transferCase() (caseRepository.js ~5255-5303) kişi
//          değişse bile SADECE fieldName='assignedTeamId' CaseActivity
//          yazar — assignedPersonId için HİÇ activity satırı YOK. Bu
//          kaynak atlanırsa (yalnız CaseActivity okunursa), oluşturulurken
//          atanmış bir vaka sonradan transferCase ile başka birine (veya
//          havuza) devredildiğinde firstPersonRawByCase boş kalır ve
//          fallback MEVCUT (transfer SONRASI, yanlış) atananı "ilk atanan"
//          diye raporlar.
//     Doğru çözüm: iki kaynaktan gelen olaylar caseId bazında zaman
//     damgasına göre BİRLEŞTİRİLİR (CaseActivity.at / CaseTransfer.
//     transferredAt); kronolojik olarak EN ERKEN olay hangisiyse (activity
//     veya transfer fark etmez) ondan fromValue/fromPersonId (doluysa) yoksa
//     toValue/toPersonId alınır. Hiç olay yoksa → mevcut
//     Case.assignedPersonName (case hiç el değiştirmemiş, fallback doğru).
//   - "İlk atanan takım" — fieldName='assignedTeamId' EN ERKEN activity.
//       - fromValue doluysa (zaten bir takımdan başka bir takıma geçmişti)
//         → fromValue = gerçek ilk atanan takım.
//       - fromValue boşsa (hiç takımı yokken ilk kez atandı) → toValue =
//         gerçek ilk atanan takım.
//     Hiç activity yoksa → mevcut Case.assignedTeamName. Transfer action'ı
//     fromValue/toValue'ya takım ADINI yazar; ama case create sırasındaki
//     İLK atama farklı bir action path'inden geçtiği için toValue'ya ham
//     Team.id yazabiliyor (gerçek veride görüldü — bkz. smoke test) — bu
//     yüzden kişi çözümlemesiyle aynı desende Team id→name haritası da var.
//   - Kişi adı çözümleme — assignedPersonId activity'lerinde toValue bazen
//     raw Person.id (claim() yolu), bazen okunabilir ad (auto-assign/manuel
//     atama yolu). Tek haritadan her ikisi de çözülür.
//
// 5 fixed query (case sayısından bağımsız — N+1 değil): CaseActivity x2
// (person + team fieldName'leri ayrı where) + CaseTransfer (person değişim
// olaylarının ikinci kaynağı) + Person + Team (isim çözümleme). Case'in
// kendi mevcut assignedPersonName/assignedTeamName'i (fallback için) ayrı
// bir küçük query ile çekilir — aggregate loader'lar yalnız caseIds alır,
// dbRows'a erişimi yok (buildRows.js'teki genel sözleşme).

function buildEmptyFirstAssignmentPayload() {
  return { firstAssignedPersonName: '', firstAssignedTeamName: '' };
}

export async function loadFirstAssignmentAggregates(prisma, caseIds) {
  const map = new Map();
  if (!Array.isArray(caseIds) || caseIds.length === 0) return map;

  // Case.id de caseIds kadar büyüyebildiği için ayrıca chunk'lanır
  // (findManyChunked "caseId" alanına göre filtreliyor — Case'in kendi
  // PK'sı "id", o yüzden burada inline chunking).
  const currentRows = [];
  for (let i = 0; i < caseIds.length; i += CASE_ID_CHUNK_SIZE) {
    const chunk = caseIds.slice(i, i + CASE_ID_CHUNK_SIZE);
    currentRows.push(...await prisma.case.findMany({
      where: { id: { in: chunk } },
      select: { id: true, assignedPersonName: true, assignedTeamName: true },
    }));
  }
  const currentByCase = new Map(currentRows.map((r) => [r.id, r]));

  const [personHistory, teamHistory, transferHistory] = await Promise.all([
    findManyChunked(prisma.caseActivity, caseIds, {
      where: { fieldName: 'assignedPersonId' },
      select: { caseId: true, fromValue: true, toValue: true, at: true },
      orderBy: { at: 'asc' },
    }),
    findManyChunked(prisma.caseActivity, caseIds, {
      where: { fieldName: 'assignedTeamId' },
      select: { caseId: true, fromValue: true, toValue: true, at: true },
      orderBy: { at: 'asc' },
    }),
    findManyChunked(prisma.caseTransfer, caseIds, {
      select: { caseId: true, fromPersonId: true, toPersonId: true, transferredAt: true },
      orderBy: { transferredAt: 'asc' },
    }),
  ]);

  // Kişi değişikliği olaylarını İKİ kaynaktan (CaseActivity + CaseTransfer)
  // caseId bazında birleştirip zaman damgasına göre sırala — hangisi
  // kronolojik olarak EN ERKEN ise ondan fromValue/fromPersonId (doluysa)
  // yoksa toValue/toPersonId alınır (bkz. yukarıdaki sözleşme yorumu).
  const personEventsByCase = new Map();
  for (const h of personHistory) {
    let bucket = personEventsByCase.get(h.caseId);
    if (!bucket) { bucket = []; personEventsByCase.set(h.caseId, bucket); }
    bucket.push({ at: h.at, fromRaw: h.fromValue, toRaw: h.toValue });
  }
  for (const t of transferHistory) {
    let bucket = personEventsByCase.get(t.caseId);
    if (!bucket) { bucket = []; personEventsByCase.set(t.caseId, bucket); }
    bucket.push({ at: t.transferredAt, fromRaw: t.fromPersonId, toRaw: t.toPersonId });
  }
  const firstPersonRawByCase = new Map();
  for (const [caseId, events] of personEventsByCase) {
    // Takım-sadece transferler (CaseTransfer.fromPersonId/toPersonId ikisi
    // de null — kişi hiç değişmedi/dokunulmadı) kişi hakkında BİLGİ TAŞIMAZ;
    // en erken olay seçilirken bunlar yok sayılmalı, yoksa gerçek ilk
    // kişi-olayından daha erken tarihli boş bir transfer, sonucu boşa
    // düşürür (gerçek veride görüldü — bkz. smoke test).
    const informative = events.filter((e) => e.fromRaw || e.toRaw);
    if (informative.length === 0) continue; // hiç kişi-olayı yok → fallback (mevcut atanan) kullanılacak
    informative.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const earliest = informative[0];
    firstPersonRawByCase.set(caseId, earliest.fromRaw || earliest.toRaw);
  }
  const firstTeamRawByCase = new Map();
  for (const h of teamHistory) {
    if (!firstTeamRawByCase.has(h.caseId)) firstTeamRawByCase.set(h.caseId, h.fromValue || h.toValue);
  }

  const rawPersonRefs = Array.from(new Set([...firstPersonRawByCase.values()].filter(Boolean)));
  const persons = rawPersonRefs.length
    ? await prisma.person.findMany({
        where: { OR: [{ id: { in: rawPersonRefs } }, { name: { in: rawPersonRefs } }] },
        select: { id: true, name: true },
      })
    : [];
  const personById = new Map(persons.map((p) => [p.id, p.name]));
  const personByName = new Map(persons.map((p) => [p.name, p.name]));
  const resolvePersonName = (raw) => (!raw ? null : personById.get(raw) ?? personByName.get(raw) ?? raw);

  const rawTeamRefs = Array.from(new Set([...firstTeamRawByCase.values()].filter(Boolean)));
  const teams = rawTeamRefs.length
    ? await prisma.team.findMany({
        where: { OR: [{ id: { in: rawTeamRefs } }, { name: { in: rawTeamRefs } }] },
        select: { id: true, name: true },
      })
    : [];
  const teamById = new Map(teams.map((t) => [t.id, t.name]));
  const teamByName = new Map(teams.map((t) => [t.name, t.name]));
  const resolveTeamName = (raw) => (!raw ? null : teamById.get(raw) ?? teamByName.get(raw) ?? raw);

  for (const id of caseIds) {
    const current = currentByCase.get(id);
    const p = buildEmptyFirstAssignmentPayload();
    p.firstAssignedPersonName = firstPersonRawByCase.has(id)
      ? (resolvePersonName(firstPersonRawByCase.get(id)) ?? '')
      : (current?.assignedPersonName ?? '');
    p.firstAssignedTeamName = firstTeamRawByCase.has(id)
      ? (resolveTeamName(firstTeamRawByCase.get(id)) ?? '')
      : (current?.assignedTeamName ?? '');
    map.set(id, p);
  }
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
  // Phase 2B.2
  summarizeFiles,
  buildEmptyFilePayload,
  bytesToMb,
  summarizeCalls,
  buildEmptyCallPayload,
  summarizeTransfers,
  buildEmptyTransferPayload,
  buildEmptyFirstAssignmentPayload,
};
