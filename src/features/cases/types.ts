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
}

export interface CaseThirdParty {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
}

export interface CaseNote {
  id: string;
  caseId: string;
  authorName: string;
  content: string;
  visibility: NoteVisibility;
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
}

export interface CaseHistoryEntry {
  id: string;
  caseId: string;
  action: string;
  fromValue?: string;
  toValue?: string;
  fieldName?: string;     // inline edit kayıtları için (Spec section 15 — CaseActivity.field_name)
  actor: string;
  at: string;
}

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
  priority: CasePriority;
  origin: CaseOrigin;
  originDescription?: string;

  // Spec 5.1 — şirket FK
  companyId: string;
  companyName: string;

  accountId: string;
  accountName: string;

  category: string;
  subCategory: string;
  requestType: CaseRequestType;

  productGroup?: string;

  assignedTeamId?: string;
  assignedTeamName?: string;
  assignedPersonId?: string;
  assignedPersonName?: string;

  escalationLevel: EscalationLevel;

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

  notes: CaseNote[];
  files: CaseFile[];
  history: CaseHistoryEntry[];
  callLogs: CaseCallLog[];
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
}

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
