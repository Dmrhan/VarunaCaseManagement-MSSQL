export type CaseType = 'GeneralSupport' | 'ProactiveTracking' | 'Churn';

export type CaseStatus =
  | 'Açık'
  | 'İncelemede'
  | '3rdPartyBekleniyor'
  | 'Eskalasyon'
  | 'Çözüldü'
  | 'YenidenAcildi'
  | 'İptalEdildi';

export type CasePriority = 'Düşük' | 'Orta' | 'Yüksek' | 'Critical';

export type CaseOrigin = 'Telefon' | 'Email' | 'Web' | 'Mobil' | 'Saha' | 'Diğer';

export type EscalationLevel = 'Yok' | 'Takım Lideri' | 'Müdür' | 'Direktör' | 'ÜstYönetim';

export type NoteVisibility = 'Internal' | 'Customer';

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
  actor: string;
  at: string;
}

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

  accountId: string;
  accountName: string;

  category: string;
  subCategory: string;
  requestType: string;

  productGroup?: string;

  assignedTeamId?: string;
  assignedTeamName?: string;
  assignedPersonId?: string;
  assignedPersonName?: string;

  escalationLevel: EscalationLevel;
  thirdPartyWaitingFor?: string;

  resolutionNote?: string;
  cancellationReason?: string;

  slaResponseDueAt?: string;
  slaResolutionDueAt?: string;
  slaViolation: boolean;
  slaPaused: boolean;

  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;

  notes: CaseNote[];
  files: CaseFile[];
  history: CaseHistoryEntry[];
}

export interface CaseFilters {
  search?: string;
  status?: CaseStatus | 'Tümü';
  caseType?: CaseType | 'Tümü';
  priority?: CasePriority | 'Tümü';
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

export const CASE_PRIORITIES: CasePriority[] = ['Düşük', 'Orta', 'Yüksek', 'Critical'];

export const CASE_ORIGINS: CaseOrigin[] = ['Telefon', 'Email', 'Web', 'Mobil', 'Saha', 'Diğer'];

export const STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  'Açık':                ['İncelemede', 'İptalEdildi'],
  'İncelemede':          ['3rdPartyBekleniyor', 'Eskalasyon', 'Çözüldü', 'İptalEdildi'],
  '3rdPartyBekleniyor':  ['İncelemede', 'Eskalasyon', 'İptalEdildi'],
  'Eskalasyon':          ['İncelemede', 'Çözüldü', 'İptalEdildi'],
  'Çözüldü':             ['YenidenAcildi'],
  'YenidenAcildi':       ['İncelemede'],
  'İptalEdildi':         [],
};
