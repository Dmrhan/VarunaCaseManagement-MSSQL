export type CaseType = 'GeneralSupport' | 'ProactiveTracking' | 'Churn';

export type CaseStatus =
  | 'Açık'
  | 'İncelemede'
  | '3rdPartyBekleniyor'
  | 'Eskalasyon'
  | 'Çözüldü'
  | 'YenidenAcildi'
  | 'İptalEdildi';

// Spec section 5.1 — canonical priority values are English. Display via labels.
export type CasePriority = 'Low' | 'Medium' | 'High' | 'Critical';

export type CaseOrigin = 'Telefon' | 'E-posta' | 'Web' | 'Chatbot' | 'Diğer';

export type CaseRequestType = 'Bilgi' | 'Öneri' | 'Talep' | 'Şikayet' | 'Hata';

export type EscalationLevel = 'Yok' | 'TakımLideri' | 'Direktör' | 'ÜstYönetim';

export type NoteVisibility = 'Internal' | 'Customer';

// Spec 5.2 — ProactiveTracking enum'ları
export type FinancialStatus = 'Düşük' | 'Orta' | 'Yüksek' | 'Kritik';
export type ProductUsage = 'Yüksek' | 'Orta' | 'Düşük' | 'Yok';
export type UsageChangeAlert = 'Artış' | 'Azalma' | 'Sabit';
export type ResponseLevel = 'Yüksek Öncelik' | 'Orta Öncelik' | 'Düşük Öncelik';

// Spec 5.2 — CaseCallLog enum'ları
export type CallDisposition =
  | 'Cevapladı'
  | 'Cevaplamadı'
  | 'NumaraHatalı'
  | 'GörüşmekIstemedi'
  | 'TekrarAranacak';

export type CallOutcome = 'Memnun' | 'MemnunDeğil' | 'Tarafsız' | 'Ulaşılamadı';

export interface CaseCallLog {
  id: string;
  caseId: string;
  callDate: string;             // ISO datetime
  durationMin: number;
  callDisposition: CallDisposition;
  callOutcome: CallOutcome;
  description?: string;
  callerId: string;
  callerName: string;
  nextFollowupDate?: string;    // Cevaplamadı dispoziyonunda zorunlu
  lastInteractionDate?: string;
}

export interface CaseCompany {
  id: string;
  name: string;
  /** Phase D: true ise vaka açarken müşteri seçimi zorunlu. Default false. */
  requireCustomerOnCaseCreate?: boolean;
  /** WR-A4 / PM-04: AccountProject UI'da gösterilsin mi? Default false. */
  projectsEnabled?: boolean;
  /** WR-A4 / PM-04: accountId varken vaka açarken proje zorunlu mu? Default false. */
  projectsRequired?: boolean;
}

export interface CaseThirdParty {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
}

export interface CaseDocumentType {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
}

/** WR-A5 / PM-03 — destek seviyesi. L1/L2 mevcut kullanım; L3/Expert future. */
export type SupportLevel = 'L1' | 'L2' | 'L3' | 'Expert';

export const SUPPORT_LEVELS: SupportLevel[] = ['L1', 'L2', 'L3', 'Expert'];

export const SUPPORT_LEVEL_LABELS: Record<SupportLevel, string> = {
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
  Expert: 'Uzman',
};

export interface CaseTeam {
  id: string;
  name: string;
  description?: string;
  /** Phase 5C — multi-tenant scope. BE prisma.team.companyId String (NOT NULL). */
  companyId: string;
  isActive: boolean;
  /** WR-A5 — Takımın varsayılan destek seviyesi. Default L1. */
  defaultSupportLevel?: SupportLevel;
}

export interface CasePerson {
  id: string;
  name: string;
  teamId: string;
  email?: string;
  isActive: boolean;
  /** WR-B1 — Takım lideri bayrağı. */
  isTeamLead?: boolean;
  /** WR-A5 — Kişinin destek seviyesi. */
  supportLevel?: SupportLevel;
}

export interface CaseSubCategoryDef {
  id: string;
  name: string;
  isActive: boolean;
}

export interface CaseCategoryDef {
  id: string;
  name: string;
  description?: string;
  /** null = sistem geneli (cross-company şablon); aksi halde şirket-spesifik. */
  companyId?: string | null;
  isActive: boolean;
  subCategories: CaseSubCategoryDef[];
}

/**
 * Kontrol Listesi (Checklist) — PRODUCT_SPEC.
 * 3-tuple eşleşme: company + productGroup + category. Vaka detayında otomatik yüklenir.
 */
export interface CaseChecklistItem {
  id: string;
  label: string;
  required: boolean;
  isActive: boolean;
}

export interface CaseChecklistTemplate {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  productGroup: string;
  categoryName: string;
  description?: string;
  isActive: boolean;
  items: CaseChecklistItem[];
}

/**
 * SLA Policy — PRODUCT_SPEC §6.
 * Eşleşme anahtarı: company + productGroup + category + subCategory + requestType.
 * Tüm boyutlar ad-bazlı tutulur (vakalar denormalized ad sakladığı için).
 */
export interface SlaPolicy {
  id: string;
  companyId: string;
  companyName: string;
  productGroup: string;
  categoryName: string;
  subCategoryName: string;
  requestType: CaseRequestType;
  responseHours: number;
  resolutionHours: number;
  description?: string;
  isActive: boolean;
}

/**
 * Sabit emoji whitelist — UI + BFF dogrulamasi ayni listeyi paylasir.
 * UI sembolu ve aciklamayi REACTION_EMOJI_META'dan alir.
 */
export type NoteReactionEmoji = 'thumbs_up' | 'eyes' | 'check' | 'important' | 'thanks';

export const NOTE_REACTION_EMOJIS: NoteReactionEmoji[] = [
  'thumbs_up',
  'eyes',
  'check',
  'important',
  'thanks',
];

export const NOTE_REACTION_META: Record<
  NoteReactionEmoji,
  { symbol: string; label: string }
> = {
  thumbs_up: { symbol: '👍', label: 'Onayladım' },
  eyes: { symbol: '👀', label: 'İnceliyorum' },
  check: { symbol: '✅', label: 'Bitti' },
  important: { symbol: '❗', label: 'Önemli' },
  thanks: { symbol: '🙏', label: 'Teşekkürler' },
};

export interface CaseNoteReactionRow {
  id: string;
  userId: string;
  emoji: NoteReactionEmoji;
}

export interface CaseNote {
  id: string;
  caseId: string;
  authorName: string;
  content: string;
  visibility: NoteVisibility;
  /** Parent note id — null/undefined ise top-level. Reply ise parent.id. */
  parentNoteId?: string | null;
  /** Top-level notlar icin reply sayisi (denormalize). Reply'larda 0. */
  replyCount?: number;
  /** Raw reaksiyon satirlari — frontend aggregate eder (emoji + count + mine). */
  reactions?: CaseNoteReactionRow[];
  createdAt: string;
}

export interface CaseFile {
  id: string;
  caseId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: string;
  /** Mock'ta indirme için base64 data URL. FAZ 2 BFF'te S3/blob URL'i olur. */
  dataUrl?: string;
}

export const CASE_FILE_MAX_SIZE = 25 * 1024 * 1024; // 25 MB
export const CASE_FILE_MAX_COUNT = 20;

export type CaseHistoryActionType =
  | 'Transfer'         // Vaka başka kişiye devredildi
  | 'StatusChange'     // Statü geçişi
  | 'FieldUpdate'      // Inline alan güncellendi
  | 'ChecklistToggle'  // Kontrol maddesi işaretlendi
  | 'NoteAdded'        // Not eklendi
  | 'CallLogAdded'     // Çağrı kaydı eklendi
  | 'FileUploaded'     // Dosya yüklendi
  | 'FileRemoved'      // Dosya silindi
  | 'CaseCreated'      // Vaka oluşturuldu
  | 'SLAApplied';      // SLA kuralı/fallback uygulandı

export interface CaseHistoryEntry {
  id: string;
  caseId: string;
  action: string;                       // Human-readable başlık (eski + yeni kayıtlar için)
  /** Semantik aksiyon tipi (ActivityTab'de farklı render için). Eski kayıtlarda yok. */
  actionType?: CaseHistoryActionType;
  fromValue?: string;
  toValue?: string;
  fieldName?: string;                   // inline edit kayıtları için (Spec section 15 — CaseActivity.field_name)
  /** Kullanıcının eklediği serbest açıklama (örn. devir notu) */
  note?: string;
  actor: string;
  at: string;
}

// CaseHistoryEntry.fieldName için Türkçe karşılıklar (Aktivite timeline gösterimi)
export const CASE_FIELD_LABELS: Record<string, string> = {
  // Temel
  title:                'Konu',
  description:          'Açıklama',
  status:               'Statü',
  priority:             'Öncelik',
  origin:               'Origin',
  originDescription:    'Origin Açıklama',

  // Sınıflandırma
  category:             'Kategori',
  subCategory:          'Alt Kategori',
  requestType:          'Talep Türü',
  productGroup:         'Ürün Grubu',

  // FK / atama
  companyId:            'Şirket',
  companyName:          'Şirket',
  accountId:            'Müşteri',
  accountName:          'Müşteri',
  assignedTeamId:       'Atanan Takım',
  assignedTeamName:     'Atanan Takım',
  assignedPersonId:     'Atanan Kişi',
  assignedPersonName:   'Atanan Kişi',

  // Eskalasyon / 3rd party
  escalationLevel:      'Eskalasyon Seviyesi',
  thirdPartyId:         '3. Parti',
  thirdPartyName:       '3. Parti',

  // SLA
  slaResponseDueAt:     'SLA Yanıt Tarihi',
  slaResolutionDueAt:   'SLA Çözüm Tarihi',
  slaViolation:         'SLA İhlali',
  slaPausedAt:          'SLA Duraklatma',
  slaPausedDurationMin: 'SLA Pause Süresi',

  // Çözüm / İptal
  resolutionNote:       'Çözüm Notu',
  cancellationReason:   'İptal Gerekçesi',

  // ProactiveTracking
  financialStatus:      'Finansal Durum',
  productUsage:         'Ürün Kullanımı',
  usageChangeAlert:     'Kullanım Trendi',
  responseLevel:        'Müdahale Önceliği',

  // Churn
  cancellationRequest:  'İptal Talebi',
  offeredSolutions:     'Sunulan Teklifler',
  offerExpiryDate:      'Teklif Geçerlilik',
  offerOutcome:         'Teklif Sonucu',
  offerRejectionReason: 'Red Gerekçesi',
  actionTaken:          'Yapılan Aksiyon',
  churnResult:          'Churn Sonucu',
  retentionStatus:      'Elde Tutma Durumu',
  followUpDate:         'Takip Tarihi',

  // AI
  aiSummary:                  'AI Özeti',
  aiCategoryPrediction:       'AI Kategori Önerisi',
  aiPriorityPrediction:       'AI Öncelik Önerisi',
  aiGeneratedFlag:            'AI Önerisi',
  aiFollowupRecommendation:   'AI Takip Önerisi',
  aiCallBrief:                'AI Çağrı Özeti',
  aiDuplicateScore:           'AI Dublikasyon Skoru',
  aiConfidenceScore:          'AI Güven Skoru',
  aiRejectReason:             'AI Red Gerekçesi',
  aiRetentionOfferSuggestion: 'AI Elde Tutma Önerisi',
  aiRootCause:                'AI Kök Neden',

  // Snooze
  snoozeUntil:          'Erteleme Tarihi',
  snoozeReason:         'Erteleme Nedeni',
  snoozePreviousStatus: 'Erteleme Öncesi Statü',

  // QA (Faz 1.5 Smart QA Lite)
  qaEmpathyScore: 'QA Empati Skoru',
  qaClarityScore: 'QA Netlik Skoru',
  qaSpeedScore:   'QA Hız Skoru',
  qaFeedback:     'QA Geri Bildirim',
  qaScoredAt:     'QA Skor Tarihi',

  // Diğer
  transferCount:        'Aktarım Sayısı',
  checklistItems:       'Kontrol Listesi',
  customFields:         'Özel Alanlar',
  slaThirdPartyWaitMin: '3. Parti Bekleme Süresi',
  resolvedAt:           'Çözüm Tarihi',
  updatedAt:            'Güncelleme Tarihi',
  createdAt:            'Oluşturma Tarihi',
};

// Inline edit ile düzenlenebilen Case alanları
export type EditableCaseField =
  | 'title'
  | 'description'
  | 'requestType'
  | 'productGroup'
  | 'origin'
  | 'originDescription'
  | 'category'
  | 'subCategory'
  | 'financialStatus'
  | 'productUsage'
  | 'usageChangeAlert'
  | 'responseLevel'
  | 'cancellationRequest'
  | 'offerOutcome'
  | 'offerExpiryDate'
  | 'followUpDate'
  | 'actionTaken'
  | 'offerRejectionReason';

export interface Case {
  id: string;
  caseNumber: string;

  title: string;
  description: string;
  caseType: CaseType;
  status: CaseStatus;
  /** WR-D4 Phase 1 — çözüm onayı overlay state'i. */
  approvalState?: 'Pending' | 'Approved' | 'Rejected' | null;
  /** WR-D4 Phase 2 — communication overlay denorm (free-string). */
  communicationState?: string | null;
  /** WR-D4/D3 Phase 3 — per-case channel override (email/phone/manual/portal). */
  communicationChannelOverride?: string | null;
  priority: CasePriority;
  origin: CaseOrigin;
  originDescription?: string;

  // Spec 5.1 — şirket FK
  companyId: string;
  companyName: string;

  accountId: string;
  accountName: string;

  /** WR-A4 / PM-04 — AccountCompany altındaki proje (opsiyonel). */
  accountProjectId?: string;
  accountProjectName?: string;

  category: string;
  subCategory: string;
  requestType: CaseRequestType;

  productGroup?: string;

  /** WR-A7b — Catalog Product / Package referansları + snapshot. */
  productId?: string;
  productName?: string;
  packageId?: string;
  packageName?: string;

  assignedTeamId?: string;
  assignedTeamName?: string;
  assignedPersonId?: string;
  assignedPersonName?: string;

  escalationLevel: EscalationLevel;

  /** WR-A5 / PM-03 — destek seviyesi. Default L1. */
  supportLevel?: SupportLevel;

  // Spec 5.1 — third_party_id FK (3rdPartyBekleniyor statüsünde zorunlu)
  thirdPartyId?: string;
  thirdPartyName?: string;

  // Spec 5.2 — ProactiveTracking'e özel (caseType !== 'ProactiveTracking' iken undefined)
  financialStatus?: FinancialStatus;
  productUsage?: ProductUsage;
  usageChangeAlert?: UsageChangeAlert;
  responseLevel?: ResponseLevel;

  // Spec 5.3 — Churn'e özel (caseType !== 'Churn' iken undefined)
  cancellationRequest?: boolean;
  offeredSolutions?: string[];      // OfferedSolutionDef.id'leri
  offerExpiryDate?: string;
  offerOutcome?: OfferOutcome;
  offerRejectionReason?: string;
  actionTaken?: string;
  churnResult?: ChurnResult;
  retentionStatus?: RetentionStatus;
  followUpDate?: string;

  resolutionNote?: string;
  cancellationReason?: string;

  // SLA — spec 6
  slaResponseDueAt?: string;
  slaResolutionDueAt?: string;
  slaViolation: boolean;
  slaPausedAt?: string;
  slaPausedDurationMin: number;
  slaThirdPartyWaitMin: number;

  // Phase D — Müşteri eşleştirme bekleyen flag.
  // true ise vaka accountId NULL açıldı, Supervisor/Admin eşleştirme kuyruğunda
  // görür ve PATCH /api/cases/:id/link-account ile bağlar.
  customerMatchPending: boolean;

  // Phase D Step 2 — opsiyonel başvuran bilgileri (müşterisiz vaka intake'i).
  customerContactName?: string | null;
  customerContactPhone?: string | null;
  customerContactEmail?: string | null;
  customerCompanyName?: string | null;

  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;

  // Spec 5.4 — AI alanları
  aiSummary?: string;
  aiCategoryPrediction?: string;
  aiPriorityPrediction?: CasePriority;
  aiDuplicateScore?: number;
  aiConfidenceScore?: number;
  aiGeneratedFlag: boolean;
  aiRejectReason?: string;
  aiCallBrief?: string;
  aiFollowupRecommendation?: string;
  aiRetentionOfferSuggestion?: string;

  /**
   * FAZ 4 — Vaka açılırken `getChecklistFor()` 3-tuple match'inden gelen
   * checklist template item'larının snapshot'ı. Admin tarafında template
   * sonradan değiştirilirse vaka etkilenmez (denormalized). `undefined` =
   * eşleşen template yok.
   */
  checklistItems?: CaseChecklistItemInstance[];

  /**
   * Custom Fields — şirket FieldDefinition'larına göre dinamik alanlar.
   * `{ fieldKey: value }` mapping. value tipi FieldType'a bağlı (string/number/
   * boolean/ISO-date string).
   */
  customFields?: Record<string, unknown>;

  // Snooze — Inbox "Later" sekmesi için. snoozeUntil > now ise vaka standart
  // listeden gizlenir, Later sekmesinde görünür. Cron süre dolunca temizler.
  snoozeUntil?: string | null;
  snoozeReason?: SnoozeReason | null;

  // QA Skor — Faz 1.5 Madde 4 (Smart QA Lite). Kapatılmış vakalarda AI
  // 3 kriterde 1-5 puan + kısa feedback üretir. null = henüz skorlanmadı.
  qaEmpathyScore?: number | null;
  qaClarityScore?: number | null;
  qaSpeedScore?: number | null;
  qaFeedback?: string | null;
  qaScoredAt?: string | null;

  // FAZ 2 §20.2 — kaç kez aktarıldı. >=2 olunca CaseDetailPage'de uyarı banner'ı
  // çıkar + supervisor bildirimi + AI kök neden analizi tetiklenir (BFF tarafı).
  transferCount?: number;

  // FAZ 2 Collab — vakanın açtığı bağlantı sayısı (outgoing). CasesList'te
  // chip; detayda LinksTab tam listeyi gösterir. 0 ise chip render edilmez.
  linkCount?: number;

  notes: CaseNote[];
  files: CaseFile[];
  history: CaseHistoryEntry[];
  callLogs: CaseCallLog[];
}

/**
 * Case Status Report — AI ile üretilmiş, paydaşlara gönderilebilecek
 * profesyonel, mail-ready durum raporu. BFF POST /api/cases/:id/action-summary
 * döndürür (endpoint path geriye uyumlu kaldı; AIUsageLog endpoint adı
 * 'status-report' olarak güncellendi).
 *
 * `report`: backend tarafından şablon + AI bölümleri birleştirilmiş tam
 * metin. UI doğrudan göstermeli (pre-wrap, monospace).
 * `subject`: yalnız "Konu:" satırı — mail başlığı.
 *
 * Persist edilmez, transient.
 */
export interface ActionSummary {
  report: string;
  subject: string;
  eventCount: number;
  generatedAt: string;
}

/**
 * Customer Context Intelligence ("Customer Pulse") — Roadmap.
 * BFF GET /api/cases/:id/customer-pulse deterministic metrikler + state
 * etiketi + plain-language summary + evidence + recommendedAction döner.
 * AI yoksa da çalışır (source='deterministic'). AI upgrade'de source='ai'.
 */
export type CustomerPulseState = 'Stable' | 'Watch' | 'Risky' | 'Critical';

export interface CustomerPulseMetrics {
  openCases: number;
  recent30d: number;
  recent60d: number;
  recent90d: number;
  slaViolations: number;
  criticalCases: number;
  escalatedCases: number;
}

export interface CustomerPulseRepeatedIssue {
  category: string;
  subCategory?: string;
  count: number;
}

export interface CustomerPulseRecentCase {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  priority: string;
  category: string;
  subCategory: string;
  createdAt: string;
  slaViolation: boolean;
}

export interface CustomerPulseSummary {
  text: string;
  evidence: string[];
  recommendedAction: string;
  source: 'deterministic' | 'ai';
}

/**
 * FAZ 2 Collab — Vakaya izleyici (watcher) eklenmiş kullanıcılar.
 * Watcher'lar vakada her değişiklikte CaseNotification alır (bell badge).
 */
export interface CaseWatcherRecord {
  id: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  addedBy: string;
  addedByName: string;
  addedAt: string;
}

/**
 * FAZ 2 Collab — Vakalar arası bağlantı (3 tip).
 * Duplicate symmetric (BFF iki yönde de yazar), Related ve Parent asymmetric.
 */
export type CaseLinkType = 'Related' | 'Duplicate' | 'Parent';

export interface LinkedCaseEntry {
  linkId: string;
  linkType: CaseLinkType;
  linkTypeLabel: string;
  createdBy: string;
  createdAt: string;
  linkedCase: {
    id: string;
    caseNumber: string;
    title: string;
    status: string;
    priority: string;
    assignedPersonName: string | null;
  } | null;
}

/**
 * FAZ 2 Collab — AI link önerisi.
 * BFF candidate'ları kendi seçer (companyId scope); UI sadece caseId gönderir.
 */
export interface LinkSuggestion {
  caseId: string;
  caseNumber: string;
  title: string;
  linkType: CaseLinkType;
  reason: string;
  confidence: number;
}

export interface CustomerPulse {
  accountId: string;
  accountName: string;
  caseId: string;
  state: CustomerPulseState;
  metrics: CustomerPulseMetrics;
  repeatedIssues: CustomerPulseRepeatedIssue[];
  recentCases: CustomerPulseRecentCase[];
  summary: CustomerPulseSummary;
}

/**
 * FAZ 2 §20.2 — bir vakanın aktarım geçmişi satırı.
 * BFF GET /api/cases/:id/transfers takım/kişi adlarını join'le döner.
 */
export interface CaseTransferRecord {
  id: string;
  caseId: string;
  companyId: string;
  fromTeamId: string | null;
  fromTeamName: string | null;
  toTeamId: string;
  toTeamName: string | null;
  fromPersonId: string | null;
  fromPersonName: string | null;
  toPersonId: string | null;
  toPersonName: string | null;
  reason: string;
  reasonCode: string | null;
  reasonLabel: string | null;
  transferredBy: string;
  transferredAt: string;
  aiSuggestedTeamId: string | null;
  aiSuggestedTeamName: string | null;
  aiSuggestedReason: string | null;
  aiReasonCode: string | null;
  aiConfidence: number | null;
}

// @mention — Faz 1.5 Madde 3
export interface MentionableUser {
  userId: string;
  personId: string | null;
  name: string;
  email: string;
  teamName: string | null;
}

export interface UnreadMention {
  id: string;
  caseId: string;
  noteId: string;
  mentionedBy: string;
  createdAt: string;
  case: {
    caseNumber: string;
    title: string;
    accountName: string;
  };
}

/**
 * Generic CaseNotification — watcher_update, watcher_added, note_reaction,
 * vs. Bell drawer'da mention'larla birleşik gösterilir.
 * payload.message UI'da görünen metindir; payload.kind UI ayrım ipucu.
 */
export interface UnreadNotification {
  id: string;
  caseId: string;
  eventType: string;
  payload: {
    message?: string;
    kind?: string;
    [key: string]: unknown;
  } | null;
  sentAt: string;
  case: {
    caseNumber: string;
    title: string;
    accountName: string;
  };
}

// Snooze sebepleri — backend enum identifier ile eşleşir (CaseDetail UI etiketler).
export type SnoozeReason = 'CustomerWillCall' | 'WaitingThirdParty' | 'Reminder';

export const SNOOZE_REASON_LABELS: Record<SnoozeReason, string> = {
  CustomerWillCall: 'Müşteri tekrar arayacak',
  WaitingThirdParty: '3. taraf bekleniyor',
  Reminder: 'Hatırlatıcı',
};

export interface CaseChecklistItemInstance {
  /** Vakaya özel benzersiz id (snapshot kayıt) */
  id: string;
  /** Kaynak template item id'si (template silinirse de buradan görünür) */
  templateItemId: string;
  label: string;
  required: boolean;
  checked: boolean;
  checkedAt?: string;   // ISO datetime
  checkedBy?: string;   // actor name
}

export interface CaseFilters {
  search?: string;
  statuses?: CaseStatus[];          // multi-select
  caseType?: CaseType | 'Tümü';
  priorities?: CasePriority[];      // multi-select
  teamId?: string;
  personId?: string;
  dateFrom?: string;                // ISO date (YYYY-MM-DD)
  dateTo?: string;                  // ISO date
  // Phase D — yalnız Supervisor+ rolleri görür; backend ignore eder Agent için.
  customerMatchPending?: boolean;
  // KPI tile click intents — server-side resolve edilir.
  assignedToMe?: boolean;     // personId → req.user.personId
  teamScope?: boolean;        // teamId → Supervisor'ın Person.teamId'si (server resolve)
  slaViolation?: boolean;     // Case.slaViolation = true
  resolvedToday?: boolean;    // Case.resolvedAt today range (server tz)
  // WR-A4 — proje bazlı filter
  accountProjectId?: string;
}

// Role-aware KPI stats — GET /api/cases/stats response.
export type CaseStatsResponse =
  | { mode: 'personal'; assignedToMe: number; slaRiskMine: number; resolvedToday: number; snoozedMine: number }
  | { mode: 'team'; teamOpenCount: number; teamSlaRisk: number; teamEscalation: number; teamResolvedToday: number; supervisorTeamId: string | null }
  | { mode: 'operations'; totalOpen: number; slaViolation: number; critical: number; resolvedToday: number }
  | { mode: 'empty' }
  | { mode: 'unknown' };

export interface CaseListPagination {
  page: number;       // 1-based
  pageSize: number;
}

export const CASE_STATUSES: CaseStatus[] = [
  'Açık',
  'İncelemede',
  '3rdPartyBekleniyor',
  'Eskalasyon',
  'Çözüldü',
  'YenidenAcildi',
  'İptalEdildi',
];

export const CASE_TYPES: CaseType[] = ['GeneralSupport', 'ProactiveTracking', 'Churn'];

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  GeneralSupport: 'Genel Destek',
  ProactiveTracking: 'Proaktif Takip',
  Churn: 'Churn',
};

export const CASE_PRIORITIES: CasePriority[] = ['Low', 'Medium', 'High', 'Critical'];

export const CASE_PRIORITY_LABELS: Record<CasePriority, string> = {
  Low:      'Düşük',
  Medium:   'Orta',
  High:     'Yüksek',
  Critical: 'Critical',
};

export const CASE_ORIGINS: CaseOrigin[] = ['Telefon', 'E-posta', 'Web', 'Chatbot', 'Diğer'];

export const CASE_REQUEST_TYPES: CaseRequestType[] = ['Bilgi', 'Öneri', 'Talep', 'Şikayet', 'Hata'];

export const ESCALATION_LEVELS: EscalationLevel[] = ['Yok', 'TakımLideri', 'Direktör', 'ÜstYönetim'];

export const ESCALATION_LEVEL_LABELS: Record<EscalationLevel, string> = {
  Yok:        'Yok',
  TakımLideri: 'Takım Lideri',
  Direktör:    'Direktör',
  ÜstYönetim:  'Üst Yönetim',
};

export const FINANCIAL_STATUSES: FinancialStatus[] = ['Düşük', 'Orta', 'Yüksek', 'Kritik'];
export const PRODUCT_USAGES: ProductUsage[] = ['Yüksek', 'Orta', 'Düşük', 'Yok'];
export const USAGE_CHANGE_ALERTS: UsageChangeAlert[] = ['Artış', 'Azalma', 'Sabit'];
export const RESPONSE_LEVELS: ResponseLevel[] = ['Yüksek Öncelik', 'Orta Öncelik', 'Düşük Öncelik'];

export const CALL_DISPOSITIONS: CallDisposition[] = [
  'Cevapladı',
  'Cevaplamadı',
  'NumaraHatalı',
  'GörüşmekIstemedi',
  'TekrarAranacak',
];

export const CALL_OUTCOMES: CallOutcome[] = ['Memnun', 'MemnunDeğil', 'Tarafsız', 'Ulaşılamadı'];

// Spec 5.3 — Churn enum'ları
export type OfferOutcome = 'KabulEdildi' | 'Reddedildi' | 'Beklemede';
export type ChurnResult = 'İptalEdildi' | 'DevamEdiyor' | 'TeklifKabulEdildi';
export type RetentionStatus = 'Başarılı' | 'Başarısız' | 'DevamEdiyor';

export const OFFER_OUTCOMES: OfferOutcome[] = ['KabulEdildi', 'Reddedildi', 'Beklemede'];
export const CHURN_RESULTS: ChurnResult[] = ['İptalEdildi', 'DevamEdiyor', 'TeklifKabulEdildi'];
export const RETENTION_STATUSES: RetentionStatus[] = ['Başarılı', 'Başarısız', 'DevamEdiyor'];

export interface OfferedSolutionDef {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
}

export const STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  'Açık':                ['İncelemede', 'İptalEdildi'],
  'İncelemede':          ['3rdPartyBekleniyor', 'Eskalasyon', 'Çözüldü', 'İptalEdildi'],
  '3rdPartyBekleniyor':  ['İncelemede', 'Eskalasyon', 'İptalEdildi'],
  'Eskalasyon':          ['İncelemede', 'Çözüldü', 'İptalEdildi'],
  'Çözüldü':             ['YenidenAcildi'],
  'YenidenAcildi':       ['İncelemede'],
  'İptalEdildi':         [],
};
