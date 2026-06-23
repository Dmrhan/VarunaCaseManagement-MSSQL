/**
 * RUNA AI — supervisor-summary prompt builder + enrichment fetch.
 *
 * Faz 1 (Plan v2 — /tmp/runa-ai-enrichment-plan.md):
 *   - Input zenginleştirme: Smart Ticket sınıflandırma + Çözüm Adımları +
 *     Müşteri Durumu sayısal sinyalleri + Devir geçmişi + Ürün/paket + Son
 *     çağrı içeriği + Çözüm/İptal notu.
 *   - Yapısal prompt: `## Vaka`, `## Sınıflandırma`, `## Denenen Çözümler`,
 *     `## Müşteri Durumu`, `## Devir Geçmişi`, `## Çağrılar`,
 *     `## Çözüm/İptal`. Boş alan/bölüm hiç yazılmaz (Q2 — status-gate yok).
 *
 * SERT KURALLAR (ihlal edilmez):
 *  - PII: `accountName`, `assignedPersonName`, `Account.email/phone/tckn*`,
 *    `customerContact*`, `customerCompanyName`, `AccountContact` PROMPT'A
 *    GİRMEZ. (Bu modül o alanları okumaz; smoke regex assertion ile guard.)
 *  - RUNA paneli kategori/öncelik ÜRETMEZ. Bu modül çıktı şemasına müdahale
 *    etmez; sadece input zenginleştirir.
 *  - Model gpt-4o-mini DEĞİŞMEZ (üst seviyede aiClient sabit).
 *
 * Token cap'leri (Plan Bölüm 3.2):
 *  - Çözüm adımları: status !== 'suggested', son 10, note 100 char truncate
 *  - Son çağrı: son 3, brief 80 char truncate
 *  - Not: ilk 3, content 300 char truncate (mevcut davranış)
 *  - Açıklama: 1000 char (mevcut davranış)
 *  - resolutionNote + cancellationReason: 300 char truncate
 *  - reasonLabel: doğal kısa
 */

import { prisma } from '../db/client.js';
import { fromDb, M_STATUS } from '../db/enumMap.js';

// Codex P2 — DB'de status ASCII identifier tutulur (Cozuldu/IptalEdildi);
// enumMap.M_STATUS TR → ASCII haritasıdır. UI literal'ı ile sorgulamak
// her zaman boş set döner — historik sinyal kaybolur.
const STATUS_DB_RESOLVED = M_STATUS['Çözüldü'];      // 'Cozuldu'
const STATUS_DB_CANCELLED = M_STATUS['İptalEdildi']; // 'IptalEdildi'

const SOLUTION_STEP_CAP = 10;
const CALL_CAP = 3;
const NOTE_CAP = 3;
const TRANSFER_REASON_CAP = 3;
const TRUNCATE = {
  description: 1000,
  note: 300,
  solutionStepNote: 100,
  callBrief: 80,
  resolutionNote: 300,
  cancellationReason: 300,
};

/**
 * Enrichment fetch — caseId'den (PII'siz alanlar) zengin sinyalleri çeker.
 * Tüm sorgular tek select transaction'ı içinde; allowedCompanyIds verilirse
 * scope guard uygular.
 *
 * NOT: Bu fonksiyon AccountContact, Account email/phone/tckn*, customerContact*
 * alanlarını HİÇ çekmez. Smoke regex assertion ile bu modüldeki Prisma select
 * field listelerinin yasak alan içermediği doğrulanır.
 */
export async function fetchSupervisorEnrichment({ caseId, allowedCompanyIds }) {
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      companyId: true,
      accountId: true,
      title: true,
      description: true,
      category: true,
      subCategory: true,
      status: true,
      priority: true,
      slaViolation: true,
      slaResponseDueAt: true,
      slaResolutionDueAt: true,
      slaPausedAt: true,
      createdAt: true,
      escalationLevel: true,
      transferCount: true,
      productName: true,
      packageName: true,
      accountProjectName: true,
      resolutionNote: true,
      cancellationReason: true,
      customFields: true,
    },
  });
  if (!c) return { error: 'not_found' };
  if (allowedCompanyIds && !allowedCompanyIds.includes(c.companyId)) {
    return { error: 'forbidden' };
  }

  // PII'siz Account alanları — sadece segment/customerType/financialStatus +
  // supportLevel. accountName, email, phone, tckn HİÇ çekilmez.
  const accountPromise = c.accountId
    ? prisma.account.findUnique({
        where: { id: c.accountId },
        select: {
          customerType: true,
          segment: true,
          financialStatus: true,
          supportLevel: true,
        },
      })
    : Promise.resolve(null);

  const [
    account,
    notes,
    activityRaw,
    solutionStepsRaw,
    callLogsRaw,
    transfersRaw,
    previousOpenCount,
    previousSlaBreachCount,
  ] = await Promise.all([
    accountPromise,
    prisma.caseNote.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      take: NOTE_CAP,
      select: { content: true, createdAt: true },
    }),
    prisma.caseActivity.findMany({
      where: { caseId },
      orderBy: { at: 'desc' },
      take: 5,
      select: { action: true, actionType: true, fieldName: true },
    }),
    prisma.caseSolutionStep.findMany({
      where: { caseId, status: { not: 'suggested' } },
      orderBy: [{ outcomeAt: 'desc' }, { triedAt: 'desc' }, { createdAt: 'desc' }],
      take: SOLUTION_STEP_CAP,
      select: { title: true, status: true, note: true },
    }),
    prisma.caseCallLog.findMany({
      where: { caseId },
      orderBy: { startedAt: 'desc' },
      take: CALL_CAP,
      select: {
        disposition: true,
        outcome: true,
        aiCallBrief: true,
        summary: true,
      },
    }),
    prisma.caseTransfer.findMany({
      where: { caseId },
      orderBy: { transferredAt: 'desc' },
      take: TRANSFER_REASON_CAP,
      select: { reasonLabel: true, reason: true },
    }),
    // Codex P1 — companyId scope: Account AccountCompany üzerinden çoklu
    // tenant'a bağlanabilir. companyId filtresi olmazsa cross-tenant case
    // sayıları AI prompt'una sızar. Mevcut vakanın companyId'sini ZORUNLU
    // ek filtre olarak ver.
    // Codex P2 — status DB'de ASCII tutulur (M_STATUS).
    c.accountId
      ? prisma.case.count({
          where: {
            companyId: c.companyId,
            accountId: c.accountId,
            id: { not: caseId },
            status: { in: [STATUS_DB_RESOLVED, STATUS_DB_CANCELLED] },
          },
        })
      : Promise.resolve(0),
    c.accountId
      ? prisma.case.count({
          where: {
            companyId: c.companyId,
            accountId: c.accountId,
            id: { not: caseId },
            slaViolation: true,
          },
        })
      : Promise.resolve(0),
  ]);

  return {
    case: c,
    account,
    notes: notes.reverse(), // eskiden yeniye okumayı kolaylaştırmak için
    activity: activityRaw,
    solutionSteps: solutionStepsRaw,
    callLogs: callLogsRaw,
    transfers: transfersRaw,
    customerSignals: {
      previousOpenCount,
      previousSlaBreachCount,
      hasDuplicate: previousOpenCount > 0,
    },
  };
}

/**
 * SLA özet metni — mevcut formatSlaInfo davranışını yerel olarak çoğaltır
 * (ai.js içindeki formatSlaInfo bir helper, dışa açık değil). Aynı çıktıyı
 * vermek için TR formatı: "5 dk kaldı" / "12 dk gecikme" vb.
 */
function formatSlaSummary(c) {
  const now = Date.now();
  const fmt = (due, paused) => {
    if (!due) return '-';
    if (paused) return 'paused';
    const ms = new Date(due).getTime() - now;
    const mins = Math.round(ms / 60000);
    if (mins >= 0) return `${mins} dk kaldı`;
    return `${Math.abs(mins)} dk gecikme`;
  };
  const status =
    c.slaViolation === true ? 'İHLAL'
      : c.slaPausedAt ? 'duraklatıldı'
        : 'aktif';
  return {
    response: fmt(c.slaResponseDueAt, c.slaPausedAt),
    resolution: fmt(c.slaResolutionDueAt, c.slaPausedAt),
    status,
  };
}

function truncate(s, max) {
  if (!s) return '';
  const t = String(s).trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function pickStLabel(obj, codeKey, labelKey) {
  if (!obj || typeof obj !== 'object') return null;
  const label = obj[labelKey];
  if (typeof label === 'string' && label.trim()) return label.trim();
  const code = obj[codeKey];
  if (typeof code === 'string' && code.trim()) return code.trim();
  return null;
}

/**
 * Smart Ticket açılış + kapanış label'larını çıkar.
 * customFields JSON string olarak gelir (Prisma NVarChar(Max)); parse hatası
 * sessizce skip.
 */
function extractSmartTicket(customFieldsRaw) {
  if (!customFieldsRaw) return { opening: [], closure: [] };
  let cf;
  try {
    cf = typeof customFieldsRaw === 'string' ? JSON.parse(customFieldsRaw) : customFieldsRaw;
  } catch {
    return { opening: [], closure: [] };
  }
  const st = cf && typeof cf === 'object' ? cf.smartTicket : null;
  if (!st || typeof st !== 'object') return { opening: [], closure: [] };

  const openingSpec = [
    ['Platform', 'platform', 'platformLabel'],
    ['İş Süreci', 'businessProcess', 'businessProcessLabel'],
    ['İşlem Tipi', 'operationType', 'operationTypeLabel'],
    ['Etkilenen Nesne', 'affectedObject', 'affectedObjectLabel'],
    ['Etki', 'impact', 'impactLabel'],
  ];
  const closureRaw = st.closure && typeof st.closure === 'object' ? st.closure : null;
  const closureSpec = [
    ['Kök Neden Grubu', 'rootCauseGroup', 'rootCauseGroupLabel'],
    ['Kök Neden Detayı', 'rootCauseDetail', 'rootCauseDetailLabel'],
    ['Çözüm Tipi', 'resolutionType', 'resolutionTypeLabel'],
    ['Kalıcı Önlem', 'permanentPrevention', 'permanentPreventionLabel'],
  ];

  const opening = openingSpec
    .map(([lbl, code, lblKey]) => {
      const v = pickStLabel(st, code, lblKey);
      return v ? `${lbl}: ${v}` : null;
    })
    .filter(Boolean);
  const closure = closureRaw
    ? closureSpec
        .map(([lbl, code, lblKey]) => {
          const v = pickStLabel(closureRaw, code, lblKey);
          return v ? `${lbl}: ${v}` : null;
        })
        .filter(Boolean)
    : [];

  return { opening, closure };
}

/**
 * Yapısal prompt builder — etiketli bölümler. Boş alan/bölüm yazılmaz.
 * PII alanları (accountName, assignedPersonName, customerContact alanları,
 * Account email vb.) bu fonksiyonun kapsamına girmez —
 * fetchSupervisorEnrichment zaten select'lerinde tutmaz.
 */
export function buildSupervisorSummaryPrompt(enrichment) {
  const { case: c, account, notes, activity, solutionSteps, callLogs, transfers, customerSignals } = enrichment;

  const sections = [];

  // ───────── ## Vaka ─────────
  const sla = formatSlaSummary(c);
  const statusTr = (fromDb({ status: c.status }).status) ?? c.status ?? '-';
  const priorityTr = c.priority ?? '-';
  const vakaLines = [];
  if (c.title) vakaLines.push(`Konu: ${c.title}`);
  if (c.category || c.subCategory) {
    vakaLines.push(`Kategori: ${c.category ?? '-'}${c.subCategory ? ` / ${c.subCategory}` : ''}`);
  }
  vakaLines.push(`Statü: ${statusTr}`);
  vakaLines.push(`Öncelik: ${priorityTr}`);
  vakaLines.push(`SLA: yanıt ${sla.response} · çözüm ${sla.resolution} · ${sla.status}`);
  if (c.description) vakaLines.push(`Açıklama: ${truncate(c.description, TRUNCATE.description)}`);
  // Aktivite kuyruğu (son 5) — sadece action/fieldName tipinden kısa imza
  const activityTags = (activity ?? [])
    .map((a) => a.action ?? a.fieldName)
    .filter(Boolean)
    .slice(0, 5);
  if (activityTags.length) vakaLines.push(`Son aktiviteler: ${activityTags.join(' / ')}`);
  // İç notlar (ilk 3 — mevcut davranış)
  const notesLines = (notes ?? [])
    .slice(0, NOTE_CAP)
    .map((n) => `- ${truncate(n.content, TRUNCATE.note)}`)
    .filter((s) => s.length > 2);
  if (notesLines.length) {
    vakaLines.push('Notlar:');
    vakaLines.push(...notesLines);
  }
  if (vakaLines.length) sections.push(['## Vaka', vakaLines.join('\n')]);

  // ───────── ## Sınıflandırma (Smart Ticket) ─────────
  const st = extractSmartTicket(c.customFields);
  const stLines = [];
  if (st.opening.length) stLines.push(`Açılış: ${st.opening.join(' · ')}`);
  if (st.closure.length) stLines.push(`Kapanış: ${st.closure.join(' · ')}`);
  if (stLines.length) sections.push(['## Sınıflandırma', stLines.join('\n')]);

  // ───────── ## Denenen Çözümler ─────────
  const STATUS_TR = {
    tried: 'denendi',
    worked: 'işe yaradı',
    not_worked: 'işe yaramadı',
    skipped: 'atlandı',
  };
  const stepLines = (solutionSteps ?? [])
    .slice(0, SOLUTION_STEP_CAP)
    .map((s) => {
      const head = `- ${truncate(s.title, 120)} → ${STATUS_TR[s.status] ?? s.status}`;
      const note = s.note ? ` (${truncate(s.note, TRUNCATE.solutionStepNote)})` : '';
      return head + note;
    });
  if (stepLines.length) {
    sections.push(['## Denenen Çözümler', stepLines.join('\n')]);
  }

  // ───────── ## Müşteri Durumu ─────────
  // Sadece sayı + segment/customerType/financialStatus + supportLevel. İsim/
  // iletişim YOK (sert kural — fetch zaten getirmiyor).
  const custBits = [];
  if (customerSignals) {
    if (typeof customerSignals.previousOpenCount === 'number') {
      custBits.push(`Geçmiş vaka: ${customerSignals.previousOpenCount}`);
    }
    if (typeof customerSignals.previousSlaBreachCount === 'number' && customerSignals.previousSlaBreachCount > 0) {
      custBits.push(`Geçmiş SLA ihlali: ${customerSignals.previousSlaBreachCount}`);
    }
    if (customerSignals.hasDuplicate) custBits.push('Tekrar eden müşteri');
  }
  if (account) {
    if (account.customerType) custBits.push(`Tip: ${account.customerType}`);
    if (account.segment) custBits.push(`Segment: ${account.segment}`);
    if (account.financialStatus) custBits.push(`Finansal: ${account.financialStatus}`);
  }
  if (custBits.length) sections.push(['## Müşteri Durumu', custBits.join(' · ')]);

  // ───────── ## Devir Geçmişi ─────────
  const transferBits = [];
  if (typeof c.transferCount === 'number' && c.transferCount > 0) {
    transferBits.push(`Devir sayısı: ${c.transferCount}`);
  }
  if (c.escalationLevel && c.escalationLevel !== 'Yok') {
    transferBits.push(`Eskalasyon: ${c.escalationLevel}`);
  }
  if (account?.supportLevel) transferBits.push(`Destek seviyesi: ${account.supportLevel}`);
  const reasonLabels = (transfers ?? [])
    .slice(0, TRANSFER_REASON_CAP)
    .map((t) => (t.reasonLabel ?? t.reason ?? '').trim())
    .filter(Boolean);
  if (reasonLabels.length) {
    transferBits.push(`Devir sebepleri: ${reasonLabels.join(' / ')}`);
  }
  if (transferBits.length) sections.push(['## Devir Geçmişi', transferBits.join(' · ')]);

  // ───────── ## Ürün/Paket ─────────
  const productBits = [];
  if (c.productName) productBits.push(`Ürün: ${c.productName}`);
  if (c.packageName) productBits.push(`Paket: ${c.packageName}`);
  if (c.accountProjectName) productBits.push(`Proje: ${c.accountProjectName}`);
  if (productBits.length) sections.push(['## Ürün/Paket', productBits.join(' · ')]);

  // ───────── ## Çağrılar ─────────
  // Bugün sadece SAYI gidiyordu; şimdi son 3 çağrı içeriği. PII'siz: disposition
  // + outcome + brief (AI-generated özet); kişisel veri içermez.
  const callBits = (callLogs ?? [])
    .slice(0, CALL_CAP)
    .map((cl) => {
      const head = [cl.disposition, cl.outcome].filter(Boolean).join(' / ') || '(çağrı)';
      const brief = truncate(cl.aiCallBrief ?? cl.summary ?? '', TRUNCATE.callBrief);
      return brief ? `- ${head}: ${brief}` : `- ${head}`;
    });
  if (callBits.length) sections.push(['## Çağrılar', callBits.join('\n')]);

  // ───────── ## Çözüm/İptal ─────────
  const closeBits = [];
  if (c.resolutionNote) closeBits.push(`Çözüm notu: ${truncate(c.resolutionNote, TRUNCATE.resolutionNote)}`);
  if (c.cancellationReason) closeBits.push(`İptal gerekçesi: ${truncate(c.cancellationReason, TRUNCATE.cancellationReason)}`);
  if (closeBits.length) sections.push(['## Çözüm/İptal', closeBits.join('\n')]);

  // ───────── Birleştir ─────────
  const body = sections.map(([title, content]) => `${title}\n${content}`).join('\n\n');

  // System prompt — Faz 2 strict json_schema mode'da. Model çıktıyı
  // SUPERVISOR_SUMMARY_SCHEMA enum/required kilidi ile döner; user prompt
  // talimat içermez ama bağlam talimatı verir.
  //
  // KATI KURAL: KATEGORİ veya ÖNCELİK ÜRETME — RUNA paneli yalnız yorum
  // (özet/risk/keyPoints/öneri/confidence) yazar. Kategori/öncelik
  // intake'ten (suggest-category / KB) gelir.
  const system = [
    "Sen Varuna CRM'de supervisor incelemelerine yardımcı olan bir asistanısın.",
    'Türkçe yaz. SADECE JSON formatında yanıt ver.',
    'Bağlamı yapılandırılmış bölümler hâlinde alacaksın (## Vaka, ## Sınıflandırma vb.).',
    'Bir bölüm yoksa o bilgi de yoktur — uydurma. Verilmeyen kişi/iletişim bilgisini ASLA tahmin etme.',
    'KATEGORİ veya ÖNCELİK ÜRETME — bunlar intake aşamasında belirlenir; sen değiştirmez/önermezsin.',
  ].join('\n');

  const user = [
    body,
    '',
    'GÖREV:',
    '- summary: 2-3 cümle vaka özeti — yukarıdaki bağlam üzerinden.',
    '- riskLevel: Düşük | Orta | Yüksek | Kritik.',
    '- keyPoints: 2-5 madde kısa bullet (her biri 1 cümle).',
    '- recommendation: 1 cümle takip önerisi.',
    '- confidence: 0.0-1.0 arası — yorumun bağlam yeterliliğine güvenin',
    '  (kategori/öncelik güveni DEĞİL; özet analizinin güveni).',
  ].join('\n');

  return { system, user };
}

/**
 * Faz 2 — strict json_schema. callOpenAI({ schema }) ile geçirilir; modelin
 * çıktısı decoding-time'da bu şemaya kilitlenir. Kategori/öncelik alanları
 * burada YOK (sert kural — RUNA paneli intake değiştirmez).
 */
export const SUPERVISOR_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'riskLevel', 'keyPoints', 'recommendation', 'confidence'],
  properties: {
    summary:        { type: 'string' },
    riskLevel:      { type: 'string', enum: ['Düşük', 'Orta', 'Yüksek', 'Kritik'] },
    keyPoints:      { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
    confidence:     { type: 'number' },
  },
};

// Test/smoke için constant export — cap'leri tek yerden okumak.
export const SUPERVISOR_SUMMARY_CAPS = {
  SOLUTION_STEP_CAP,
  CALL_CAP,
  NOTE_CAP,
  TRANSFER_REASON_CAP,
  TRUNCATE,
};
