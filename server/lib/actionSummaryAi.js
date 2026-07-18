import { prisma } from '../db/client.js';
import { aiClient, callOpenAI, logAIUsage } from './aiClient.js';
import { fromDb, M_STATUS } from '../db/enumMap.js';
import { getCalendarGateFor, diffMinutes, netDayMinutes } from './sla/businessTime.js';

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

// Durum Raporu v2 — MÜŞTERİ-dostu statü etiketi (kullanıcı kararı 2026-07-17).
// VAKA BİLGİSİ bloğu statik (AI'a gitmez) → müşteriye "3rdPartyBekleniyor"
// gibi ham enum GÖRÜNMESİN. Anahtar = fromDb sonrası görünen TR statü.
const CUSTOMER_STATUS_LABEL = {
  'Açık': 'Talebiniz alındı',
  'İncelemede': 'İnceleniyor',
  '3rdPartyBekleniyor': 'Çözüm sürecinde (geliştirme/uzman ekipte)',
  'Eskalasyon': 'Öncelikli olarak ele alınıyor',
  'Çözüldü': 'Çözümlendi',
  'YenidenAcildi': 'Yeniden değerlendiriliyor',
  'İptalEdildi': 'Kapatıldı',
};
function customerStatusLabel(statusTr) {
  return CUSTOMER_STATUS_LABEL[statusTr] ?? 'İşleniyor';
}

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

// Durum Raporu v2 — DevOps okuyucu (caseRepository.readDevopsArray modül-içi
// olduğundan, sla-activation-write.mjs'teki desenle küçük yerel kopya).
function readDevopsEntries(customFieldsRaw) {
  if (!customFieldsRaw) return [];
  let obj;
  try {
    obj = typeof customFieldsRaw === 'string' ? JSON.parse(customFieldsRaw) : customFieldsRaw;
  } catch {
    return [];
  }
  return Array.isArray(obj?.devops) ? obj.devops : [];
}

// Durum Raporu v2 — dakikayı "N dk / N iş-sa / N iş günü" biçimine çevirir.
// Codex #553 P2: 60 dk altı DAKİKA olarak yazılır — yoksa "0 sa" gibi
// yanıltıcı çıktı olur (kısa duraklama "hiç beklenmedi" görünürdü).
// cal takvimliyse "iş-" öneki + net-gün katsayısı; takvimsizde düz sa/gün.
function formatBusinessSpan(minutes, cal) {
  const abs = Math.abs(Math.round(minutes));
  const dayMin = netDayMinutes(cal);
  if (abs < 60) return `${abs} dk`;
  if (abs < dayMin) return `${Math.round(abs / 60)} ${cal ? 'iş-sa' : 'sa'}`;
  return `${Math.round(abs / dayMin)} ${cal ? 'iş günü' : 'gün'}`;
}

// Durum Raporu v2 — "X iş-sa/iş günü kaldı|gecikme". cal takvimliyse İŞ-dk
// (Faz 4 diffMinutes deseni), takvimsizde duvar-dk.
function formatSlaRemaining(fromMs, dueMs, cal) {
  const min = diffMinutes(fromMs, dueMs, cal); // + kaldı / − gecikme
  const span = formatBusinessSpan(min, cal);
  return min < 0 ? `${span} gecikme` : `${span} kaldı`;
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

// Durum Raporu v2 (2026-07-17) — muhatap modu.
//   'internal' : iç yönetici (mevcut geri-uyumlu davranış; iç risk/jargon serbest)
//   'customer' : müşteriye gidecek — iç risk gizli, jargon yasak, kurumsal imza,
//                bilinmeyen alan HİÇ yazılmaz.
const REPORT_MODES = new Set(['internal', 'customer']);

// customerFields — 'customer' modunda kesinlikle görünmemesi gereken TR
// jargon/işaret ifadeleri (smoke bunları çıktı-yapısında değil, prompt
// kurallarında arar; runtime metin denetimi AI'a bırakılır).

export async function generateActionSummary({ caseId, userId, allowedCompanyIds, mode = 'internal' }) {
  if (!aiClient) {
    return { error: 'ai_unavailable', message: 'AI servisi yapılandırılmamış.' };
  }
  // Fail-safe: geçersiz mode → internal (en muhafazakâr — mevcut davranış).
  const reportMode = REPORT_MODES.has(mode) ? mode : 'internal';
  const isCustomer = reportMode === 'customer';

  const c = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      companyId: true,
      companyName: true,
      accountId: true,
      caseNumber: true,
      title: true,
      description: true,
      // PII tablosu: status-report endpoint'i için accountName +
      // assignedPersonName İZİNLİ (mail muhatabı/imza zorunlu).
      // Account.email/phone/tckn*, customerContact* HÂLÂ YASAK.
      // 'customer' modunda bile bu izin listesi GENİŞLETİLMEZ.
      accountName: true,
      status: true,
      priority: true,
      assignedPersonName: true,
      assignedTeamName: true,
      assignedPerson: { select: { title: true } }, // v2 — imza unvanı
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
      // Durum Raporu v2 — SLA görünümü (iş-saati + uzatılmış kaynak)
      slaResponseDueAt: true,
      slaResolutionDueAt: true,
      slaResolutionTargetMin: true,
      slaTargetSource: true,
      slaPausedDurationMin: true,
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
            isArchived: false, // 2026-07-06 — arşivli vaka geçmiş sayımına girmez
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
            isArchived: false,
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
  // Durum Raporu v2 — VAKA BİLGİSİ statü: müşteri modunda ham enum yerine
  // müşteri-dostu etiket (kullanıcı kararı 2026-07-17).
  const statusDisplay = isCustomer ? customerStatusLabel(statusTr) : statusTr;
  // Codex #554 P2 — statü ALAN ETİKETİ de mode-aware: "Statü" prompt'ta
  // müşteri-yasağı listesindeki iç jargon; sabit label AI'a gitmediğinden
  // burada değişir → müşteri raporunda "Durum".
  const statusLabel = isCustomer ? 'Durum      ' : 'Statü      ';

  // Durum Raporu v2 — ortak türetimler (hem AI yolu hem boş-aktivite fallback'i
  // kullanır; tek yerde tanımlanır — eski iki mükerrer owner/dateTr birleşti).
  const owner = c.assignedPersonName
    ? `${c.assignedPersonName}${c.assignedTeamName ? ` / ${c.assignedTeamName}` : ''}`
    : 'Atanmamış';
  const dateTr = formatDateTr(c.createdAt);
  const ownerTitle = c.assignedPerson?.title ?? null;
  // Codex #553 P2 — accountName nullable (müşteri eşleşmesi öncesi açılan
  // vaka); "Sayın null Ekibi" üretmesin → müşteri modunda ad yoksa nötr hitap.
  const greeting = isCustomer
    ? (c.accountName ? `Sayın ${c.accountName} Ekibi,` : 'Sayın İlgili,')
    : 'Sayın İlgili,';
  // Müşteri modunda imza KURUMSAL: sorumlu + unvan + şirket adı (Univera vb.).
  // İç modda mevcut davranış korunur (sorumlu + Varuna sistem imzası).
  const footerBlock = (isCustomer
    ? [
        'Saygılarımızla,',
        (c.assignedPersonName ?? 'Destek Ekibi') + (ownerTitle ? `\n${ownerTitle}` : ''),
        c.companyName ?? '',
      ].filter(Boolean)
    : ['Saygılarımızla,', owner, 'Varuna Vaka Yönetim Sistemi']
  ).join('\n');

  // Compact event list — token kontrol için not 300 char ile kırpılır.
  // `whenTr` pre-formatlanmış TR tarih+saat (Europe/Istanbul) — AI'ın
  // doğrudan kullanması için.
  // 2026-07-17 fix — HAM UTC `at` alanı KALDIRILDI: model onu (whenTr yerine)
  // okuyup saatleri 3 saat geri kaydırıyordu (17:08→14:08). Yalnız
  // pre-formatlanmış TR (Europe/Istanbul) whenTr gönderilir.
  // Aktiviteler zaten `at: 'asc'` ile sorgulandı → kronolojik sıra korunur.
  // Durum Raporu v2 — MÜŞTERİ modunda olay akışı SANITIZE edilir. Prompt
  // yasağı LLM'i tam tutmadığından (canlı gözlem: DevOps no + ham statü
  // narrative'e sızıyordu), sızıntıyı GİRDİDE keseriz — kullanıcının "DevOps
  // numarası gizli" kararı ancak böyle garanti edilir. İki temizlik:
  //  (1) Bilinen DevOps id'leri metinlerden çıkar → "[geliştirme kaydı]".
  //  (2) Ham statü token'ları (from/to/action) müşteri-dostu etikete map.
  const devopsIds = readDevopsEntries(c.customFields).map((e) => e?.id).filter((x) => x != null);
  const redact = (txt) => {
    if (!txt || !isCustomer) return txt;
    let out = String(txt);
    for (const id of devopsIds) out = out.split(String(id)).join('[geliştirme kaydı]');
    return out;
  };
  const statusToken = (v) => {
    if (!v || !isCustomer) return v;
    // v hem TR (fromDb sonrası) hem ham DB değeri olabilir → ikisini de dene.
    const tr = fromDb({ status: v }).status ?? v;
    return CUSTOMER_STATUS_LABEL[tr] ?? CUSTOMER_STATUS_LABEL[v] ?? v;
  };
  const events = activities.map((a) => ({
    whenTr: formatDateTimeTr(a.at),
    type: a.actionType ?? 'Other',
    action: redact(a.action),
    field: a.fieldName ?? null,
    from: a.actionType === 'StatusChange' ? statusToken(a.fromValue) : redact(a.fromValue ?? null),
    to: a.actionType === 'StatusChange' ? statusToken(a.toValue) : redact(a.toValue ?? null),
    note: a.note ? redact(a.note.slice(0, 300)) : null,
    actor: a.actor,
  }));

  const notesContext = recentNotes.length > 0
    ? recentNotes
        .map((n) => `- [${formatDateTimeTr(n.createdAt)}] ${n.authorName}: ${redact(n.content.slice(0, 300))}`)
        .join('\n')
    : '(iç not yok)';

  // Boş aktivite — AI'ı çağırmadan minimal rapor.
  if (activities.length === 0) {
    const subject = `Konu: ${c.caseNumber} — ${c.title} — Durum Raporu`;
    // Müşteri modunda "Müşteri" satırı imzada firma zaten var; VAKA BİLGİSİ'nde
    // müşteri adı iç raporda kalır (muhatap zaten o firma). Bilinmeyen-alan
    // kuralı: boş SORUNUN ÖZETİ customer modunda "loglarda görünmüyor" YAZMAZ.
    const report = [
      subject,
      '',
      greeting,
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
      `${statusLabel}: ${statusDisplay}`,
      '',
      '─────────────────────────────────────',
      'SORUNUN ÖZETİ',
      '─────────────────────────────────────',
      c.description ? c.description.slice(0, 500) : (isCustomer ? 'Talebinizin detayları değerlendirilmektedir.' : 'loglarda görünmüyor'),
      '',
      '─────────────────────────────────────',
      'GÜNCEL DURUM',
      '─────────────────────────────────────',
      `Vaka ${statusDisplay} durumunda, sorumlusu ${owner}.`,
      '',
      '─────────────────────────────────────',
      footerBlock,
    ].join('\n');
    return {
      report,
      subject,
      eventCount: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  const systemCommon = [
    'Çıktın doğrudan mailde kullanılabilecek formatlanmış bir rapordur.',
    '',
    'KURALLAR (uymak zorunlu):',
    '- Türkçe yaz.',
    '- Profesyonel ton — mail-ready.',
    '- Süreç Özetinde önemli geçişleri tarih bazlı, akıcı nesir anlat.',
    '- Her log satırını tekrarlama — önemli olayları özetle.',
    '- TR tarih formatı (örn. "12 Mayıs 2026"). Saatleri yalnız `whenTr` alanından al — ISO/UTC yorumlama, ofset ekleme.',
    '- ÖZEL AD SADAKATİ: firma adı, kişi adı, ürün adı, vaka konusu ne verildiyse HARFİ HARFİNE aynen kullan. Kısaltma, çevirme, düzeltme veya benzetme YAPMA (örn. "JTI"yi "Jimmy" yazma). Emin değilsen VAKA META\'daki yazımı kopyala.',
    '- Çıktı SADECE JSON formatında olsun.',
  ];
  const systemInternal = [
    "Sen Varuna CRM'de İÇ YÖNETİME sunulacak vaka durum raporları üreten profesyonel bir asistanısın.",
    ...systemCommon,
    '- Tahmin etme, uydurma. Bir bilgi logda/notta yoksa "loglarda görünmüyor" veya "Loglarda belirtilmemiştir." yaz.',
    "- 'RUNA AI' aktörlü kayıtları operasyonel insan aksiyonu gibi gösterme; sadece anlamlıysa kısaca anılabilir.",
    '- İç bilgiler (eskalasyon, SLA ihlali, 3. parti adı, aktarım gecikmeleri) serbestçe belirtilebilir.',
  ].join('\n');
  const systemCustomer = [
    'Sen bir müşteri hizmetleri firmasında MÜŞTERİYE gönderilecek vaka durum raporları üreten profesyonel bir asistanısın.',
    ...systemCommon,
    '- MÜŞTERİ DİLİ: iç mutfak jargonu YASAK — olayları ANLATIRKEN de geçerli. Şu ifadeleri (ve ham sistem statülerini) HİÇBİR cümlede kullanma: "log", "eskalasyon", "SLA ihlali", "3. parti", "3rdPartyBekleniyor", "İncelemede", "aktarım", "snooze", "DevOps", "çalışma öğesi", "iş kaydı", "statü". Ham durum adı yerine müşteri-dostu anlatım kullan (örn. "3rdPartyBekleniyor" → "geliştirme/uzman ekibin değerlendirmesine alınmıştır"; "İncelemede" → "incelenmeye başlanmıştır"; "DevOps kaydı bağlandı" → "geliştirme birimine iletilmiştir").',
    '- İÇ RİSKLERİ GİZLE: gecikme suçlaması, aksiyon sahibi eleştirisi, iç süreç aksaklığı YAZILMAZ. Yalnız müşteriye dönük durum + taahhüt sunulur.',
    '- BİLİNMEYEN ALAN: bir bilgi kayıtlarda yoksa o cümleyi/bölümü TAMAMEN ATLA — "kayıtlarda yok / belirtilmemiştir" YAZMA. (Boş-alan kuralı.)',
    '- Sıcak ama profesyonel, güven veren bir ton kullan. Müşteriye "sizin talebiniz" perspektifinden yaz.',
    '- Yazılım geliştirmeye iletildiyse bunu olumlu çerçevele ("kalıcı çözüm için geliştirme birimimize iletilmiştir"). İç referans/kayıt NUMARASI YAZMA.',
    '- HEDEF TARİH: SLA HEDEFİ bölümünde çözüm hedef tarihi verildiyse, "currentStatus" veya "nextStep" içinde bunu müşteriye TAAHHÜT olarak doğal cümleyle belirt (örn. "Talebinizin [tarih] tarihine kadar çözümlenmesi hedeflenmektedir."). Tarih yoksa uydurma.',
  ].join('\n');
  const system = isCustomer ? systemCustomer : systemInternal;

  const headerBlock = [
    `Konu: ${c.caseNumber} — ${c.title} — Durum Raporu`,
    '',
    greeting,
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
    `${statusLabel}: ${statusDisplay}`,
  ].join('\n');
  // footerBlock ortak türetimlerde (mode'a göre) zaten tanımlandı.

  // ───────── Faz 4 — yeni yapısal bölümler ─────────
  // Q2 kuralı: boş alan/bölüm yazılmaz. Her bölüm conditional toplanır,
  // sonra mevcut user prompt'a "VAKA META" altına eklenir.
  const enrichmentSections = [];

  // ## SLA (Durum Raporu v2) — hedef + kalan (iş-saati) + kaynak.
  // Kalan süre damganın rejimiyle okunur (Faz 4: takvim kapısı satırın
  // createdAt'ine göre; kesim öncesi vaka duvar-dk). Terminal vakada
  // "kalan" anlamsız → yalnız kaynak/hedef bilgisi.
  const isTerminal = c.status === STATUS_DB_RESOLVED_AS || c.status === STATUS_DB_CANCELLED_AS;
  if (c.slaResolutionDueAt || c.slaResponseDueAt) {
    const gate = await getCalendarGateFor(c.companyId);
    const cal = gate(new Date(c.createdAt).getTime());
    const nowMs = Date.now();
    const slaLines = [];
    if (c.slaResponseDueAt && !isTerminal) {
      slaLines.push(`Yanıt hedefi: ${formatDateTr(c.slaResponseDueAt)} (${formatSlaRemaining(nowMs, new Date(c.slaResponseDueAt).getTime(), cal)})`);
    }
    if (c.slaResolutionDueAt) {
      const kaynak = c.slaTargetSource === 'extended'
        ? ' — sözleşmedeki yazılım geliştirme çözüm süresi kapsamında'
        : '';
      const kalan = isTerminal ? '' : ` (${formatSlaRemaining(nowMs, new Date(c.slaResolutionDueAt).getTime(), cal)})`;
      slaLines.push(`Çözüm hedefi: ${formatDateTr(c.slaResolutionDueAt)}${kalan}${kaynak}`);
    }
    if (c.slaViolation && !isTerminal) slaLines.push('Durum: çözüm hedefi aşıldı.');
    if (slaLines.length) {
      enrichmentSections.push(`SLA HEDEFİ:\n${slaLines.join('\n')}`);
    }
  }

  // ## DevOps (Durum Raporu v2) — yazılım geliştirme referansı.
  // "Yazılım Bakım Ekibinde" devri raporun kritik cümlesi; süreç özetine girer.
  // Kullanıcı kararı 2026-07-17: MÜŞTERİ modunda iç referans NUMARASI GİZLİ —
  // yalnız "geliştirme birimine iletildi" bilgisi verilir (numara sızmaz).
  const devopsEntries = readDevopsEntries(c.customFields).filter((e) => e?.id != null);
  if (devopsEntries.length) {
    if (isCustomer) {
      enrichmentSections.push(
        'YAZILIM GELİŞTİRME:\nBu talep, kalıcı çözüm için yazılım geliştirme birimine iletilmiştir. (Bu bilgiyi kullanırken iç referans/kayıt NUMARASI YAZMA.)',
      );
    } else {
      const dvLines = devopsEntries.map((e) => {
        const state = e.state ? ` (durum: ${e.state})` : '';
        const t = e.title ? ` — ${truncate(e.title, 100)}` : '';
        return `- Geliştirme kaydı #${e.id}${state}${t}`;
      });
      enrichmentSections.push(`YAZILIM GELİŞTİRME REFERANSI:\n${dvLines.join('\n')}`);
    }
  }

  // ## Bekleme muhasebesi (Durum Raporu v2) — "neden sürdü" cevabı.
  const pausedMin = c.slaPausedDurationMin ?? 0;
  if (pausedMin > 0) {
    const gate = await getCalendarGateFor(c.companyId);
    const cal = gate(new Date(c.createdAt).getTime());
    const span = formatBusinessSpan(pausedMin, cal); // #553 P2 — dk dalı dahil
    enrichmentSections.push(`BEKLEME SÜRESİ:\nToplam ${span} 3. taraf/geliştirme dönüşü beklendi (SLA sayacı bu süre durdu).`);
  }

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
    `- Açılış: ${formatDateTimeTr(c.createdAt)}`,
    `- Çözüm: ${c.resolvedAt ? formatDateTimeTr(c.resolvedAt) : '(henüz çözülmedi)'}`,
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
    // Codex #553 P2 — nextStep talimatı mode'a göre: müşteri modunda "Loglarda
    // belirtilmemiştir." iç jargonu ÜRETİLMEZ; sonraki adım yoksa BOŞ bırakılır
    // (backend fallback'i de mode-aware, aşağıda).
    isCustomer
      ? '- nextStep: 1-2 cümle. Müşteriye dönük sonraki adım/taahhüt. Belirgin bir sonraki adım yoksa BOŞ string döndür ("") — "belirtilmemiştir" gibi ifade YAZMA.'
      : '- nextStep: 1-2 cümle. Önerilen sonraki aksiyon. Logdan çıkmıyorsa: "Loglarda belirtilmemiştir."',
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
    // Codex #553 P2 — bölüm birleştirme mode-aware: müşteri modunda boş bölüm
    // "loglarda görünmüyor" iç-jargonu YAZMAZ; opsiyonel bölüm (SONRAKİ ADIM)
    // boşsa tamamen atlanır (boş-alan kuralı). İç modda mevcut davranış.
    const subject = `Konu: ${c.caseNumber} — ${c.title} — Durum Raporu`;
    const RULE = '─────────────────────────────────────';
    const sec = (heading, text) => [RULE, heading, RULE, text, ''];
    const emptyFill = isCustomer ? '' : 'loglarda görünmüyor';
    const problem = String(json.problemSummary ?? '').slice(0, 800).trim();
    const process = String(json.processSummary ?? '').slice(0, 2000).trim();
    const current = String(json.currentStatus ?? '').slice(0, 500).trim();
    const nextStep = String(json.nextStep ?? '').slice(0, 400).trim();

    const parts = [headerBlock, ''];
    // Zorunlu 3 bölüm: iç modda boşsa fallback yazılır, müşteri modunda boşsa
    // yine başlık korunur ama nötr boş bırakılır (iç-jargon SIZMAZ).
    parts.push(...sec('SORUNUN ÖZETİ', problem || emptyFill));
    parts.push(...sec('SÜREÇ ÖZETİ', process || emptyFill));
    parts.push(...sec('GÜNCEL DURUM', current || emptyFill));
    // SONRAKİ ADIM: iç modda boşsa "Loglarda belirtilmemiştir."; müşteri
    // modunda boşsa bölüm TAMAMEN atlanır.
    if (nextStep) parts.push(...sec('SONRAKİ ADIM', nextStep));
    else if (!isCustomer) parts.push(...sec('SONRAKİ ADIM', 'Loglarda belirtilmemiştir.'));
    parts.push(RULE, footerBlock);
    const report = parts.join('\n');

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
