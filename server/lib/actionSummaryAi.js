import { prisma } from '../db/client.js';
import { aiClient, callOpenAI, logAIUsage } from './aiClient.js';
import { fromDb, M_STATUS } from '../db/enumMap.js';

// Codex P2 — DB'de status ASCII identifier tutulur (Cozuldu/IptalEdildi).
const STATUS_DB_RESOLVED_AS = M_STATUS['Çözüldü'];      // 'Cozuldu'
const STATUS_DB_CANCELLED_AS = M_STATUS['İptalEdildi']; // 'IptalEdildi'

/**
 * Case Status Report — vakanın paydaşlara gönderilebilecek profesyonel,
 * mail-ready durum raporunu AI ile üretir. Eskiden "Action Timeline Summary"
 * idi; replaced.
 *
 * Mevcut aiSummary (vaka içeriği) ve supervisor-summary (risk) ile FARKLI
 * amaç: yöneticilere / 3. taraflara gönderilecek formatlanmış durum
 * raporu (Konu + Vaka Bilgisi + Sorunun Özeti + Süreç Özeti + Güncel
 * Durum + Sonraki Adım + İmza).
 *
 * Çıktı persistlenmez — UI üzerinde transient, kullanıcı her "Yenile"
 * tıklayışında yeniden üretilir. AIUsageLog endpoint = 'status-report'.
 *
 * Güvenlik:
 *  - Tenant scope: allowedCompanyIds.
 *  - Sadece structured activity verisi gider — UI metin scraping yok.
 *  - AI alan-güncelleme olayları (aiSummary, aiFollowupRecommendation,
 *    aiCallBrief, aiRetentionOfferSuggestion, aiCategoryPrediction,
 *    aiPriorityPrediction, aiConfidenceScore, aiGeneratedFlag) süreç
 *    özetinde gösterilmez — operasyonel anlamı yok, mailı kirletir.
 *  - Raw note 300 char ile kırpılır.
 *  - "loglarda görünmüyor" disiplini prompt ile zorlanır.
 */

const MAX_EVENTS = 50;

// Faz 4 (Plan v2 — /tmp/runa-ai-enrichment-plan.md) — status-report input
// enrichment cap'leri. supervisor-summary'dakilerden DAHA TUTUCU: status-report
// zaten 50-olay JSON içerdiği için input bütçesi yüksek.
const FAZ4_SOLUTION_STEP_CAP = 5;
const FAZ4_TRUNCATE = {
  solutionStepNote: 100,
  resolutionNote: 300,
  cancellationReason: 300,
};

// Smart Ticket label extraction — supervisorSummaryPrompt.js'in pattern'i
// (duplikasyon: ayrı modül; status-report bağımsız tonu/akışı korur).
function pickStLabel(obj, codeKey, labelKey) {
  if (!obj || typeof obj !== 'object') return null;
  const label = obj[labelKey];
  if (typeof label === 'string' && label.trim()) return label.trim();
  const code = obj[codeKey];
  if (typeof code === 'string' && code.trim()) return code.trim();
  return null;
}
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

function truncate(s, max) {
  if (!s) return '';
  const t = String(s).trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// Süreç özetinde gösterilmemesi gereken AI metadata field'ları.
// Bu alanların FieldUpdate event'leri rapora dahil edilmez.
const AI_META_FIELDS = new Set([
  'aiSummary',
  'aiFollowupRecommendation',
  'aiCallBrief',
  'aiRetentionOfferSuggestion',
  'aiCategoryPrediction',
  'aiPriorityPrediction',
  'aiConfidenceScore',
  'aiGeneratedFlag',
  'aiDuplicateScore',
  'aiRejectReason',
  'aiRootCause',
]);

export async function generateActionSummary({ caseId, userId, allowedCompanyIds }) {
  if (!aiClient) {
    return { error: 'ai_unavailable', message: 'AI servisi yapılandırılmamış.' };
  }

  const c = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      companyId: true,
      accountId: true,
      caseNumber: true,
      title: true,
      description: true,
      // PII tablosu: status-report endpoint'i için accountName +
      // assignedPersonName İZİNLİ (mail muhatabı/imza zorunlu).
      // Account.email/phone/tckn*, customerContact* HÂLÂ YASAK.
      accountName: true,
      status: true,
      priority: true,
      assignedPersonName: true,
      assignedTeamName: true,
      escalationLevel: true,
      thirdPartyName: true,
      createdAt: true,
      resolvedAt: true,
      slaViolation: true,
      transferCount: true,
      // Faz 4 — yeni alanlar (enrichment için)
      customFields: true,
      productName: true,
      packageName: true,
      accountProjectName: true,
      resolutionNote: true,
      cancellationReason: true,
    },
  });
  if (!c) return { error: 'not_found' };
  if (allowedCompanyIds && !allowedCompanyIds.includes(c.companyId)) {
    return { error: 'forbidden' };
  }

  // Aktivite akışı + son 3 not (sorunun özeti için ek bağlam) +
  // Faz 4: Çözüm Adımları (max 5) + Önceki Vaka sayıları.
  const [
    activitiesRaw,
    recentNotes,
    solutionStepsRaw,
    previousOpenCount,
    previousSlaBreachCount,
  ] = await Promise.all([
    prisma.caseActivity.findMany({
      where: { caseId },
      orderBy: { at: 'asc' },
      take: MAX_EVENTS,
      select: {
        action: true,
        actionType: true,
        fieldName: true,
        fromValue: true,
        toValue: true,
        note: true,
        actor: true,
        at: true,
      },
    }),
    prisma.caseNote.findMany({
      where: { caseId, visibility: 'Internal' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { content: true, authorName: true, createdAt: true },
    }),
    // Faz 4 — Çözüm Adımları (status !== 'suggested', max 5; supervisor'dan
    // daha tutucu cap çünkü status-report zaten ağır).
    prisma.caseSolutionStep.findMany({
      where: { caseId, status: { not: 'suggested' } },
      orderBy: [{ outcomeAt: 'desc' }, { triedAt: 'desc' }, { createdAt: 'desc' }],
      take: FAZ4_SOLUTION_STEP_CAP,
      select: { title: true, status: true, note: true },
    }),
    // Faz 4 — Önceki vaka sayısı (Çözüldü + İptalEdildi). PII'siz, sayı.
    // Codex P1 — companyId scope (Account çoklu tenant'a bağlanabilir).
    // Codex P2 — status DB'de ASCII tutulur (M_STATUS).
    c.accountId
      ? prisma.case.count({
          where: {
            companyId: c.companyId,
            accountId: c.accountId,
            id: { not: caseId },
            status: { in: [STATUS_DB_RESOLVED_AS, STATUS_DB_CANCELLED_AS] },
          },
        })
      : Promise.resolve(0),
    // Faz 4 — Geçmiş SLA ihlal sayısı (PII'siz, sayı).
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

  // AI metadata field güncellemelerini ele — mailı kirletir, operasyonel
  // anlamı yok. action/transfer/note/call/checklist/dosya hep dahil.
  const activities = activitiesRaw.filter((a) => {
    if (a.actionType !== 'FieldUpdate') return true;
    if (a.fieldName && AI_META_FIELDS.has(a.fieldName)) return false;
    return true;
  });

  const statusTr = fromDb({ status: c.status }).status;
  const escalationTr = fromDb({ escalationLevel: c.escalationLevel }).escalationLevel;

  // Compact event list — token kontrol için not 300 char ile kırpılır.
  // `whenTr` pre-formatlanmış TR tarih+saat (Europe/Istanbul) — AI'ın
  // doğrudan kullanması için. `at` ISO da bırakılır (gerekirse referans).
  // Aktiviteler zaten `at: 'asc'` ile sorgulandı → kronolojik sıra korunur.
  const events = activities.map((a) => ({
    at: a.at.toISOString(),
    whenTr: formatDateTimeTr(a.at),
    type: a.actionType ?? 'Other',
    action: a.action,
    field: a.fieldName ?? null,
    from: a.fromValue ?? null,
    to: a.toValue ?? null,
    note: a.note ? a.note.slice(0, 300) : null,
    actor: a.actor,
  }));

  const notesContext = recentNotes.length > 0
    ? recentNotes
        .map((n) => `- [${n.createdAt.toISOString()}] ${n.authorName}: ${n.content.slice(0, 300)}`)
        .join('\n')
    : '(iç not yok)';

  // Boş aktivite — AI'ı çağırmadan minimal rapor.
  if (activities.length === 0) {
    const subject = `Konu: ${c.caseNumber} — ${c.title} — Durum Raporu`;
    const owner = c.assignedPersonName
      ? `${c.assignedPersonName}${c.assignedTeamName ? ` / ${c.assignedTeamName}` : ''}`
      : 'Atanmamış';
    const dateTr = formatDateTr(c.createdAt);
    const report = [
      subject,
      '',
      'Sayın ilgili,',
      '',
      'Aşağıda söz konusu vakanın güncel durum özeti sunulmaktadır.',
      '',
      '─────────────────────────────────────',
      'VAKA BİLGİSİ',
      '─────────────────────────────────────',
      `Vaka No    : ${c.caseNumber}`,
      `Müşteri    : ${c.accountName}`,
      `Konu       : ${c.title}`,
      `Açılış     : ${dateTr}`,
      `Sorumlu    : ${owner}`,
      `Statü      : ${statusTr}`,
      '',
      '─────────────────────────────────────',
      'SORUNUN ÖZETİ',
      '─────────────────────────────────────',
      c.description ? c.description.slice(0, 500) : 'loglarda görünmüyor',
      '',
      '─────────────────────────────────────',
      'SÜREÇ ÖZETİ',
      '─────────────────────────────────────',
      'Henüz operasyonel bir aksiyon kaydedilmedi.',
      '',
      '─────────────────────────────────────',
      'GÜNCEL DURUM',
      '─────────────────────────────────────',
      `Vaka ${statusTr} statüsünde, sorumlusu ${owner}.`,
      '',
      '─────────────────────────────────────',
      'SONRAKİ ADIM',
      '─────────────────────────────────────',
      'Loglarda belirtilmemiştir.',
      '',
      '─────────────────────────────────────',
      'Saygılarımızla,',
      owner,
      'Varuna Vaka Yönetim Sistemi',
    ].join('\n');
    return {
      report,
      subject,
      eventCount: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  const owner = c.assignedPersonName
    ? `${c.assignedPersonName}${c.assignedTeamName ? ` / ${c.assignedTeamName}` : ''}`
    : 'Atanmamış';
  const dateTr = formatDateTr(c.createdAt);

  const system = [
    "Sen Varuna CRM'de paydaşlara gönderilecek vaka durum raporları üreten profesyonel bir asistanısın.",
    'Çıktın doğrudan mailde kullanılabilecek formatlanmış bir rapordur.',
    '',
    'KURALLAR (uymak zorunlu):',
    '- Türkçe yaz.',
    '- Profesyonel ton — mail-ready.',
    '- Tahmin etme, uydurma. Bir bilgi logda/notta yoksa "loglarda görünmüyor" veya "Loglarda belirtilmemiştir." yaz.',
    "- 'RUNA AI' aktörlü kayıtları operasyonel insan aksiyonu gibi gösterme; sadece anlamlıysa kısaca anılabilir.",
    '- Süreç Özetinde önemli geçişleri TARİH BAZLI grupla (max 6-7 tarih satırı).',
    '- Her log satırını tekrarlama — önemli olayları (atama, statü, öncelik, eskalasyon, 3. parti, snooze, aktarım, çağrı, not, dosya, çözüm) özetle.',
    '- TR tarih formatı (örn. "12 Mayıs 2026").',
    '- Çıktı SADECE JSON formatında olsun.',
  ].join('\n');

  const headerBlock = [
    `Konu: ${c.caseNumber} — ${c.title} — Durum Raporu`,
    '',
    'Sayın ilgili,',
    '',
    'Aşağıda söz konusu vakanın güncel durum özeti sunulmaktadır.',
    '',
    '─────────────────────────────────────',
    'VAKA BİLGİSİ',
    '─────────────────────────────────────',
    `Vaka No    : ${c.caseNumber}`,
    `Müşteri    : ${c.accountName}`,
    `Konu       : ${c.title}`,
    `Açılış     : ${dateTr}`,
    `Sorumlu    : ${owner}`,
    `Statü      : ${statusTr}`,
  ].join('\n');

  const footerBlock = ['Saygılarımızla,', owner, 'Varuna Vaka Yönetim Sistemi'].join('\n');

  // ───────── Faz 4 — yeni yapısal bölümler ─────────
  // Q2 kuralı: boş alan/bölüm yazılmaz. Her bölüm conditional toplanır,
  // sonra mevcut user prompt'a "VAKA META" altına eklenir.
  const enrichmentSections = [];

  // ## Sınıflandırma (Smart Ticket)
  const st = extractSmartTicket(c.customFields);
  const stLines = [];
  if (st.opening.length) stLines.push(`Açılış: ${st.opening.join(' · ')}`);
  if (st.closure.length) stLines.push(`Kapanış: ${st.closure.join(' · ')}`);
  if (stLines.length) {
    enrichmentSections.push(`SINIFLANDIRMA (Smart Ticket):\n${stLines.join('\n')}`);
  }

  // ## Denenen Çözümler
  const STATUS_TR = {
    tried: 'denendi',
    worked: 'işe yaradı',
    not_worked: 'işe yaramadı',
    skipped: 'atlandı',
  };
  const stepLines = (solutionStepsRaw ?? [])
    .slice(0, FAZ4_SOLUTION_STEP_CAP)
    .map((s) => {
      const head = `- ${truncate(s.title, 120)} → ${STATUS_TR[s.status] ?? s.status}`;
      const note = s.note ? ` (${truncate(s.note, FAZ4_TRUNCATE.solutionStepNote)})` : '';
      return head + note;
    });
  if (stepLines.length) {
    enrichmentSections.push(`DENENEN ÇÖZÜMLER (özet, max ${FAZ4_SOLUTION_STEP_CAP}):\n${stepLines.join('\n')}`);
  }

  // ## Müşteri Geçmiş (sayı)
  const custBits = [];
  if (previousOpenCount > 0) custBits.push(`Geçmiş vaka: ${previousOpenCount}`);
  if (previousSlaBreachCount > 0) custBits.push(`Geçmiş SLA ihlali: ${previousSlaBreachCount}`);
  if (custBits.length) {
    enrichmentSections.push(`MÜŞTERİ GEÇMİŞ (sayı):\n${custBits.join(' · ')}`);
  }

  // ## Ürün/Paket (Faz 4 — sade)
  const productBits = [];
  if (c.productName) productBits.push(`Ürün: ${c.productName}`);
  if (c.packageName) productBits.push(`Paket: ${c.packageName}`);
  if (c.accountProjectName) productBits.push(`Proje: ${c.accountProjectName}`);
  if (productBits.length) {
    enrichmentSections.push(`ÜRÜN/PAKET:\n${productBits.join(' · ')}`);
  }

  // ## Çözüm/İptal Notu (vaka çözülmüş/iptal edilmişse currentStatus'a katkı)
  const closeBits = [];
  if (c.resolutionNote) {
    closeBits.push(`Çözüm notu: ${truncate(c.resolutionNote, FAZ4_TRUNCATE.resolutionNote)}`);
  }
  if (c.cancellationReason) {
    closeBits.push(`İptal gerekçesi: ${truncate(c.cancellationReason, FAZ4_TRUNCATE.cancellationReason)}`);
  }
  if (closeBits.length) {
    enrichmentSections.push(`ÇÖZÜM/İPTAL NOTU:\n${closeBits.join('\n')}`);
  }

  const user = [
    'VAKA META:',
    `- No: ${c.caseNumber}`,
    `- Müşteri: ${c.accountName}`,
    `- Konu: ${c.title}`,
    `- Statü: ${statusTr}`,
    `- Öncelik: ${c.priority}`,
    `- Sorumlu: ${owner}`,
    `- Eskalasyon: ${escalationTr}`,
    `- 3. Parti: ${c.thirdPartyName ?? '-'}`,
    `- Açılış: ${c.createdAt.toISOString()} (${dateTr})`,
    `- Çözüm: ${c.resolvedAt ? c.resolvedAt.toISOString() : '(henüz çözülmedi)'}`,
    `- SLA İhlali: ${c.slaViolation ? 'Var' : 'Yok'}`,
    `- Aktarım Sayısı: ${c.transferCount ?? 0}`,
    '',
    // Faz 4 enrichment bölümleri — sıra "log üzerinden" özet kuralı için
    // VAKA AÇIKLAMASI ve LOG'dan ÖNCE; model bağlamı bütüncül görür.
    // Bölüm boşsa array'e hiç eklenmedi → join'de görünmez (Q2).
    ...(enrichmentSections.length ? [enrichmentSections.join('\n\n'), ''] : []),
    'VAKA AÇIKLAMASI (sorunun özeti için ana kaynak):',
    (c.description ?? '').slice(0, 1000) || '(boş)',
    '',
    'SON İÇ NOTLAR (sorunun özeti için ek bağlam):',
    notesContext,
    '',
    `OPERASYONEL LOG (${events.length} olay, kronolojik — AI metadata güncellemeleri filtrelendi):`,
    JSON.stringify(events, null, 2),
    '',
    'GÖREV:',
    'Aşağıdaki şablona uygun, BÖLÜMLERE göre AYRI metin alanları üret. Şablonun statik kısımlarını sen yazma — birleştirmeyi backend yapar.',
    '',
    '- problemSummary: 2-3 cümle. Müşterinin yaşadığı sorunu özetle (açıklama + notlar + log üzerinden).',
    '- processSummary: AKICI TÜRKÇE NESİR — paragraflar halinde (liste/madde DEĞİL).',
    '    - KATI KURAL: Sadece log içinde AÇIKÇA olan olayları yaz. Çıkarım yapma, varsayma,',
    '      süsleme. Olmayan bir motivasyon, gerekçe veya bağlantı UYDURMA.',
    '        KÖTÜ örnekler (asla yapma):',
    '          • "Benzer vakalar incelendi" — logda yoksa, atla.',
    '          • "Müşterinin teklifi kabul edildi" — logda yoksa, atla.',
    '          • "Destek sürecini hızlandırmak için..." — neden ekleme.',
    '          • Logda olmayan herhangi bir motivasyon veya muhakeme.',
    '        İYİ örnekler:',
    '          • "Vaka 1 Mayıs 2026 saat 10:19\'da oluşturulmuş ve Aslı Tan\'a atanmıştır."',
    '          • "Saat 12:09\'da statü İncelemede olarak güncellenmiştir."',
    '          • "Saat 13:59\'da vaka Çözüldü olarak kapatılmıştır."',
    '        Logda yoksa → tamamen çıkar. Cümleler kısa ve olgusal olmalı.',
    '    - 3-4 paragraf yaz. Olayları tema bazlı grupla: açılış → inceleme/işlem → çözüm/aktarım.',
    '    - Tarih ve saatleri cümlenin doğal akışı içinde belirt ("1 Mayıs sabahı...",',
    '      "aynı gün 14:32\'de...", "ertesi gün öğleden sonra..."). Tam tarih için `whenTr` alanından',
    '      faydalan ama liste/prefix biçiminde DEĞİL.',
    '    - Aktörleri doğal anlat ("Aslı Tan tarafından...", "destek ekibi tarafından...",',
    '      "sistem otomatik olarak..."). RUNA AI önerilerinden bahsetme veya kısaca geç.',
    '    - Önemsiz olayları (AI metadata güncellemeleri, küçük alan değişiklikleri) ATLA.',
    '    - Odak: atamalar, statü geçişleri, kritik aksiyonlar, eskalasyon, 3. parti beklemeleri,',
    '      çözüm/aktarım.',
    '    - Profesyonel kurumsal ton — mail-ready. Madde imi / ":" prefix format kullanma.',
    '- currentStatus: 2-3 cümle. Vakanın şu anki durumu, kim ilgileniyor, ne bekleniyor.',
    '- nextStep: 1-2 cümle. Önerilen sonraki aksiyon. Logdan çıkmıyorsa: "Loglarda belirtilmemiştir."',
    '',
    'ÇIKTI JSON ŞEMASI:',
    '{',
    '  "problemSummary": "...",',
    '  "processSummary": "...",  // çok satırlı text — \\n ile satır ayır',
    '  "currentStatus": "...",',
    '  "nextStep": "..."',
    '}',
  ].join('\n');

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['problemSummary', 'processSummary', 'currentStatus', 'nextStep'],
    properties: {
      problemSummary: { type: 'string' },
      processSummary: { type: 'string' },
      currentStatus:  { type: 'string' },
      nextStep:       { type: 'string' },
    },
  };

  const t0 = Date.now();
  try {
    const { json, tokenCount } = await callOpenAI({
      system,
      user,
      schema,
      schemaName: 'status_report_sections',
    });
    void logAIUsage({
      endpoint: 'status-report',
      companyId: c.companyId,
      caseId,
      userId,
      responseTimeMs: Date.now() - t0,
      tokenCount,
    });

    // Backend birleştirir — şablon statik kısımları + AI bölümleri.
    const subject = `Konu: ${c.caseNumber} — ${c.title} — Durum Raporu`;
    const report = [
      headerBlock,
      '',
      '─────────────────────────────────────',
      'SORUNUN ÖZETİ',
      '─────────────────────────────────────',
      String(json.problemSummary ?? '').slice(0, 800).trim() || 'loglarda görünmüyor',
      '',
      '─────────────────────────────────────',
      'SÜREÇ ÖZETİ',
      '─────────────────────────────────────',
      String(json.processSummary ?? '').slice(0, 2000).trim() || 'loglarda görünmüyor',
      '',
      '─────────────────────────────────────',
      'GÜNCEL DURUM',
      '─────────────────────────────────────',
      String(json.currentStatus ?? '').slice(0, 500).trim() || 'loglarda görünmüyor',
      '',
      '─────────────────────────────────────',
      'SONRAKİ ADIM',
      '─────────────────────────────────────',
      String(json.nextStep ?? '').slice(0, 400).trim() || 'Loglarda belirtilmemiştir.',
      '',
      '─────────────────────────────────────',
      footerBlock,
    ].join('\n');

    return {
      report,
      subject,
      eventCount: events.length,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[status-report]', err?.message ?? err);
    return { error: 'ai_failed', message: err?.message ?? 'AI çağrısı başarısız.' };
  }
}

// TR tarih: "12 Mayıs 2026"
const TR_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];
function formatDateTr(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '-';
  return `${dt.getDate()} ${TR_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

// TR tarih + saat: "12 Mayıs 2026, 14:32"
// Vercel serverless UTC çalışır — timezone explicit Europe/Istanbul (UTC+3)
// olmazsa süreç özetinde saatler 3 saat ofset gözükür.
function formatDateTimeTr(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(dt);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')}`;
}
