import { prisma } from '../db/client.js';
import { aiClient, callOpenAI, logAIUsage } from './aiClient.js';
import { fromDb } from '../db/enumMap.js';

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
      caseNumber: true,
      title: true,
      description: true,
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
    },
  });
  if (!c) return { error: 'not_found' };
  if (allowedCompanyIds && !allowedCompanyIds.includes(c.companyId)) {
    return { error: 'forbidden' };
  }

  // Aktivite akışı + son 3 not (sorunun özeti için ek bağlam).
  const [activitiesRaw, recentNotes] = await Promise.all([
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
