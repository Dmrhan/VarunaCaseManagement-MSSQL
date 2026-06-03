/**
 * WR-A8 Phase 2a — Customer 360 schema shared helpers.
 *
 * Shared normalizers + safe-string utilities used by all 5 entity schemas.
 * No external deps; Prisma-portable; MSSQL-safe (no PG-specific calls).
 */

import {
  validateVkn,
  normalizePhoneE164,
} from '../../../../utils/accountValidation.js';
import { CUSTOMER_TYPE_VALUES } from '../../../../db/enumMap.js';

export const PROJECT_STATUS_VALUES = ['Active', 'Passive', 'Completed', 'Cancelled'];
export const ADDRESS_TYPE_VALUES = ['Billing', 'Shipping', 'Visit', 'Headquarters', 'Branch'];
export const ACCOUNT_COMPANY_STATUS_VALUES = ['active', 'churn', 'prospect', 'inactive'];

const CUSTOMER_TYPE_LABEL_MAP = {
  individual: 'Individual',
  bireysel: 'Individual',
  corporate: 'Corporate',
  kurumsal: 'Corporate',
  government: 'Government',
  kamu: 'Government',
  nonprofit: 'NonProfit',
  'non-profit': 'NonProfit',
  'non profit': 'NonProfit',
  'vakif-stk': 'NonProfit',
  'vakıf-stk': 'NonProfit',
  vakif: 'NonProfit',
  vakıf: 'NonProfit',
  stk: 'NonProfit',
};

const BOOLEAN_TRUE = new Set(['true', '1', 'yes', 'y', 'evet', 'e', 'aktif', 'on']);
const BOOLEAN_FALSE = new Set(['false', '0', 'no', 'n', 'hayir', 'hayır', 'h', 'pasif', 'off']);

/**
 * ISO-3166-1 alpha-2 country normalizer.
 * Accepts ISO-2 directly, or common TR/EN names → ISO-2.
 * Returns undefined for unrecognized (caller turns into error).
 */
const COUNTRY_MAP = {
  tr: 'TR', 'türkiye': 'TR', turkiye: 'TR', turkey: 'TR', tur: 'TR', tr1: 'TR',
  de: 'DE', 'almanya': 'DE', deutschland: 'DE', germany: 'DE',
  us: 'US', 'amerika': 'US', usa: 'US', 'united states': 'US',
  gb: 'GB', uk: 'GB', england: 'GB', 'birleşik krallık': 'GB', 'birlesik krallik': 'GB',
  fr: 'FR', france: 'FR', fransa: 'FR',
  it: 'IT', italy: 'IT', italya: 'IT',
  es: 'ES', spain: 'ES', ispanya: 'ES',
  nl: 'NL', netherlands: 'NL', hollanda: 'NL',
  be: 'BE', belgium: 'BE', 'belçika': 'BE', belcika: 'BE',
  at: 'AT', austria: 'AT', avusturya: 'AT',
  ch: 'CH', switzerland: 'CH', 'isviçre': 'CH', isvicre: 'CH',
  ru: 'RU', russia: 'RU', rusya: 'RU',
  ua: 'UA', ukraine: 'UA', ukrayna: 'UA',
  bg: 'BG', bulgaria: 'BG', bulgaristan: 'BG',
  gr: 'GR', greece: 'GR', yunanistan: 'GR',
  ro: 'RO', romania: 'RO', romanya: 'RO',
  ae: 'AE', uae: 'AE', emirlikler: 'AE',
  sa: 'SA', 'suudi arabistan': 'SA', 'saudi arabia': 'SA',
};

export function asTrimmedString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function normalizeBoolean(input) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'boolean') return input;
  const s = String(input).trim().toLowerCase();
  if (BOOLEAN_TRUE.has(s)) return true;
  if (BOOLEAN_FALSE.has(s)) return false;
  return undefined;
}

export function normalizeCustomerType(input) {
  const s = asTrimmedString(input);
  if (!s) return null;
  const key = s.toLowerCase();
  if (CUSTOMER_TYPE_LABEL_MAP[key]) return CUSTOMER_TYPE_LABEL_MAP[key];
  if (CUSTOMER_TYPE_VALUES.includes(s)) return s;
  return undefined;
}

export function normalizeCountryIso2(input) {
  const s = asTrimmedString(input);
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const key = s.toLowerCase();
  if (COUNTRY_MAP[key]) return COUNTRY_MAP[key];
  return undefined;
}

export function normalizeEnum(input, allowed) {
  const s = asTrimmedString(input);
  if (!s) return null;
  if (allowed.includes(s)) return s;
  // Case-insensitive match
  const match = allowed.find((v) => v.toLowerCase() === s.toLowerCase());
  if (match) return match;
  return undefined;
}

export function validateEmail(input) {
  const s = asTrimmedString(input);
  if (!s) return { ok: false, normalized: null, reason: 'E-posta boş.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    return { ok: false, normalized: null, reason: 'E-posta formatı geçersiz.' };
  }
  return { ok: true, normalized: s };
}

export function parseDate(input) {
  const s = asTrimmedString(input);
  if (!s) return { ok: true, normalized: null };
  // Accept ISO 8601 (YYYY-MM-DD or full) and TR DD.MM.YYYY / DD/MM/YYYY
  let d;
  const isoMatch = /^\d{4}-\d{2}-\d{2}/.test(s);
  const trMatch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (isoMatch) {
    d = new Date(s);
  } else if (trMatch) {
    d = new Date(`${trMatch[3]}-${trMatch[2].padStart(2, '0')}-${trMatch[1].padStart(2, '0')}`);
  } else {
    return { ok: false, normalized: null, reason: 'Tarih formatı tanınmadı (YYYY-MM-DD veya DD.MM.YYYY kullanın).' };
  }
  if (Number.isNaN(d.getTime())) {
    return { ok: false, normalized: null, reason: 'Geçersiz tarih.' };
  }
  return { ok: true, normalized: d.toISOString() };
}

/**
 * Generic length-bounded text normalizer.
 */
export function normalizeText(input, { max = 250, requiredLabel = null } = {}) {
  const s = asTrimmedString(input);
  if (!s) {
    if (requiredLabel) return { ok: false, normalized: null, reason: `${requiredLabel} boş olamaz.` };
    return { ok: true, normalized: null };
  }
  if (s.length > max) {
    return { ok: false, normalized: null, reason: `${max} karakteri aşamaz.` };
  }
  return { ok: true, normalized: s };
}

export { validateVkn, normalizePhoneE164 };

// ─── Relationship + Persistent Source ID field factories ─────────────
//
// Customer 360 importları artık iki ek kavramı destekler:
//
//   recordNo / parentRecordNo / parentCompanyRecordNo
//     Dosya İÇİNDEKİ parent-child bağı (Accounts sheet satırı ↔ child
//     sheet satırları). Kalıcı saklanmaz; ImportJobRow.normalizedJson
//     içinde audit için tutulur. Account/AC kimliği DEĞİLDİR; her
//     import bu key'leri sıfırdan tanımlayabilir.
//
//   sourceContactId / sourceAddressId / sourceProjectId
//     Kalıcı external/ERP/CRM ID. AccountContact/Address/AccountProject
//     üzerindeki sourceExternalId kolonuna yazılır. İkinci import aynı
//     ID ile geldiğinde mevcut child row UPDATE edilir, yeni kayıt
//     yaratılmaz.
//
// Aşağıdaki factory'ler tek tip alan tanımlarını her entity'de
// tekrar yazmaktan kaçınır.

const REL_TEXT_MAX = 64;

function relAliases(extra = []) {
  return [
    'recordno',
    'record_no',
    'record no',
    'kayıt no',
    'kayit no',
    'kaynak kayıt no',
    'kaynak kayit no',
    'sourcerecordno',
    'source_record_no',
    'source record no',
    ...extra,
  ];
}

export function recordNoField({ description = 'Dosya içindeki satır kimliği. Child kayıtlar parent\'a bu numara ile bağlanır. Kalıcı saklanmaz.' } = {}) {
  return {
    key: 'recordNo',
    label: 'Kayıt No (Dosya İçi)',
    description,
    example: 'A001',
    group: 'İlişki',
    type: 'text',
    required: false,
    aliases: relAliases(),
    validationHint: '1-64 karakter, dosya içinde aynı sheet\'te tekildir.',
    normalizationHint: 'Trim uygulanır.',
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: false,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: REL_TEXT_MAX });
    },
  };
}

export function parentRecordNoField() {
  return {
    key: 'parentRecordNo',
    label: 'Üst Kayıt No (Account)',
    description: 'Bu child kaydın bağlanacağı Account satırının recordNo değeri.',
    example: 'A001',
    group: 'İlişki',
    type: 'text',
    required: false,
    aliases: [
      'parentrecordno',
      'parent_record_no',
      'parent record no',
      'üst kayıt no',
      'ust kayit no',
      'parentsourcerecordno',
      'parent_source_record_no',
      'account_record_no',
      'accountrecordno',
    ],
    validationHint: 'Accounts sheet içindeki bir recordNo değerine eşit olmalı.',
    normalizationHint: 'Trim uygulanır.',
    businessWarning: 'Boşsa fallback olarak accountKey/vkn/name eşleştirmesi kullanılır.',
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: false,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: REL_TEXT_MAX });
    },
  };
}

export function parentCompanyRecordNoField() {
  return {
    key: 'parentCompanyRecordNo',
    label: 'Üst Şirket Kayıt No (AccountCompany)',
    description: 'Project için: AccountCompany satırının recordNo değeri.',
    example: 'AC001',
    group: 'İlişki',
    type: 'text',
    required: false,
    aliases: [
      'parentcompanyrecordno',
      'parent_company_record_no',
      'parent company record no',
      'üst şirket kayıt no',
      'ust sirket kayit no',
      'accountcompanyrecordno',
      'company_record_no',
    ],
    validationHint: 'Companies sheet içindeki bir recordNo değerine eşit olmalı.',
    normalizationHint: 'Trim uygulanır.',
    businessWarning: 'Boşsa fallback olarak accountCompanyKey/companyCode eşleştirmesi kullanılır.',
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: false,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: REL_TEXT_MAX });
    },
  };
}

function sourceIdField({ key, label, description, exampleId, aliasGroup }) {
  return {
    key,
    label,
    description,
    example: exampleId,
    group: 'Kalıcı Kaynak',
    type: 'text',
    required: false,
    aliases: aliasGroup,
    validationHint: '1-128 karakter; aynı sheet içinde tekil olmalı.',
    normalizationHint: 'Trim uygulanır.',
    businessWarning: 'Verilmezse fallback eşleşmeye (e-posta/telefon/ad veya kod) geçilir.',
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 128 });
    },
  };
}

export function sourceContactIdField() {
  return sourceIdField({
    key: 'sourceContactId',
    label: 'Kaynak Contact ID',
    description: 'Dış sistemdeki Contact kimliği. Tekrar importta aynı kaydı günceller.',
    exampleId: 'ERP-CN-1001',
    aliasGroup: [
      'sourcecontactid',
      'source_contact_id',
      'contactexternalid',
      'contact_external_id',
      'externalcontactid',
      'external_contact_id',
      'erp_contact_id',
      'crm_contact_id',
    ],
  });
}

export function sourceAddressIdField() {
  return sourceIdField({
    key: 'sourceAddressId',
    label: 'Kaynak Address ID',
    description: 'Dış sistemdeki adres kimliği. Tekrar importta aynı kaydı günceller.',
    exampleId: 'ERP-ADR-1001',
    aliasGroup: [
      'sourceaddressid',
      'source_address_id',
      'addressexternalid',
      'address_external_id',
      'externaladdressid',
      'external_address_id',
      'erp_address_id',
      'crm_address_id',
    ],
  });
}

export function sourceProjectIdField() {
  return sourceIdField({
    key: 'sourceProjectId',
    label: 'Kaynak Proje ID',
    description: 'Dış sistemdeki proje kimliği. Tekrar importta aynı kaydı günceller.',
    exampleId: 'ERP-PRJ-1001',
    aliasGroup: [
      'sourceprojectid',
      'source_project_id',
      'projectexternalid',
      'project_external_id',
      'externalprojectid',
      'external_project_id',
      'erp_project_id',
      'crm_project_id',
    ],
  });
}
