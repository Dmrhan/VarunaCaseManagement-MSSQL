/**
 * WR-Smart-Ticket Phase 1d — taxonomy → klasik Case alanları eşleştirici.
 *
 * Smart Ticket intake'te seçilen taxonomy code'larını mevcut
 * `Case.category` / `Case.subCategory` / `Case.requestType` alanlarına
 * map eder. **Mapping kaynağı**: `TaxonomyDef.metadata` JSON alanı.
 * Beklenen şema (her alan opsiyonel):
 *
 *   {
 *     caseCategory?:    string,           // Case.category
 *     caseSubCategory?: string,           // Case.subCategory
 *     caseRequestType?: CaseRequestType,  // 'Bilgi'|'Öneri'|'Talep'|'Şikayet'|'Hata'
 *   }
 *
 * Karar sırası:
 *   1) businessProcess.metadata = MAIN mapping kaynağı (kategori + alt + tip)
 *   2) operationType.metadata.caseRequestType — yalnız requestType önerisi
 *      (businessProcess'te yoksa devreye girer)
 *   3) Hepsi yoksa **sabit fallback** ile vaka açılır:
 *        category=FALLBACK_CATEGORY, subCategory=FALLBACK_SUBCATEGORY,
 *        requestType=FALLBACK_REQUEST_TYPE
 *
 * Vaka oluşturma mapping eksik diye **HİÇBİR ZAMAN** patlamaz.
 *
 * affectedObject / impact bu mapping'e dahil değil — yalnız
 * `customFields.smartTicket` içinde saklanır (intake context).
 */

import type { CaseRequestType } from '@/features/cases/types';
import type {
  SmartTicketTaxonomyItem,
  SmartTicketTaxonomyResponse,
} from '@/services/caseService';

export const SMART_TICKET_FALLBACK_CATEGORY = 'Akıllı Ticket';
export const SMART_TICKET_FALLBACK_SUBCATEGORY = 'Genel';
export const SMART_TICKET_FALLBACK_REQUEST_TYPE: CaseRequestType = 'Talep';

export const SMART_TICKET_CASE_REQUEST_TYPES: ReadonlyArray<CaseRequestType> = [
  'Bilgi',
  'Öneri',
  'Talep',
  'Şikayet',
  'Hata',
];

export interface SmartTicketMappingMeta {
  caseCategory?: string;
  caseSubCategory?: string;
  caseRequestType?: CaseRequestType;
}

export interface SmartTicketSelections {
  platform?: string;
  businessProcess?: string;
  operationType?: string;
  affectedObject?: string;
  impact?: string;
}

export type SmartTicketMappingSource =
  | 'businessProcess'
  | 'businessProcess+operationType'
  | 'fallback';

export interface SmartTicketResolvedMapping {
  category: string;
  subCategory: string;
  requestType: CaseRequestType;
  source: SmartTicketMappingSource;
  /** UI'da debug + telemetry için: hangi taxonomy'lerden hangi alanlar geldi? */
  trace: {
    category: 'businessProcess' | 'fallback';
    subCategory: 'businessProcess' | 'fallback';
    requestType: 'businessProcess' | 'operationType' | 'fallback';
  };
}

function readMeta(item: SmartTicketTaxonomyItem | undefined): SmartTicketMappingMeta | null {
  const raw = item?.metadata;
  if (raw == null || typeof raw !== 'object') return null;
  return raw as SmartTicketMappingMeta;
}

function isValidRequestType(value: unknown): value is CaseRequestType {
  return typeof value === 'string' && (SMART_TICKET_CASE_REQUEST_TYPES as string[]).includes(value);
}

function findByCode(
  list: SmartTicketTaxonomyItem[] | undefined,
  code: string | undefined,
): SmartTicketTaxonomyItem | undefined {
  if (!code || !list) return undefined;
  return list.find((it) => it.code === code);
}

/**
 * Seçili taxonomy code'larından klasik Case alanlarını hesapla.
 * Stale code (eski tenant) varsa lookup'ta bulunmaz → metadata'sı yok →
 * fallback'e düşer. Vaka create yine de başarılı olur.
 */
export function resolveSmartTicketMapping(
  taxonomies: SmartTicketTaxonomyResponse['taxonomies'] | null,
  selections: SmartTicketSelections,
): SmartTicketResolvedMapping {
  const bp = findByCode(taxonomies?.businessProcess, selections.businessProcess);
  const ot = findByCode(taxonomies?.operationType, selections.operationType);

  const bpMeta = readMeta(bp);
  const otMeta = readMeta(ot);

  const category = bpMeta?.caseCategory ?? SMART_TICKET_FALLBACK_CATEGORY;
  const subCategory = bpMeta?.caseSubCategory ?? SMART_TICKET_FALLBACK_SUBCATEGORY;

  let requestType: CaseRequestType;
  let requestTypeTrace: SmartTicketResolvedMapping['trace']['requestType'];
  if (isValidRequestType(bpMeta?.caseRequestType)) {
    requestType = bpMeta!.caseRequestType as CaseRequestType;
    requestTypeTrace = 'businessProcess';
  } else if (isValidRequestType(otMeta?.caseRequestType)) {
    requestType = otMeta!.caseRequestType as CaseRequestType;
    requestTypeTrace = 'operationType';
  } else {
    requestType = SMART_TICKET_FALLBACK_REQUEST_TYPE;
    requestTypeTrace = 'fallback';
  }

  const bpProvidedCategory = !!bpMeta?.caseCategory;
  const bpProvidedSub = !!bpMeta?.caseSubCategory;
  const anyBp = bpProvidedCategory || bpProvidedSub || requestTypeTrace === 'businessProcess';

  let source: SmartTicketMappingSource;
  if (anyBp && requestTypeTrace === 'operationType') source = 'businessProcess+operationType';
  else if (anyBp || requestTypeTrace === 'operationType') {
    source = requestTypeTrace === 'operationType' && !anyBp ? 'businessProcess+operationType' : 'businessProcess';
    // Edge: yalnızca operationType requestType verirse de kompozit gibi etiketlensin —
    // observability açısından "fallback" değil.
    if (!anyBp && requestTypeTrace === 'operationType') source = 'businessProcess+operationType';
  } else {
    source = 'fallback';
  }

  return {
    category,
    subCategory,
    requestType,
    source,
    trace: {
      category: bpProvidedCategory ? 'businessProcess' : 'fallback',
      subCategory: bpProvidedSub ? 'businessProcess' : 'fallback',
      requestType: requestTypeTrace,
    },
  };
}
