/**
 * WR-A8 Phase 2a — Customer 360 / accountCompany entity schema.
 *
 * Parent: account (via `accountKey` relationship — typically the parent
 * Account's VKN or externalCustomerCode).
 *
 * Tenant safety: `companyCode` MUST resolve to a Varuna Company the admin
 * has permission for. Source row companyCode does NOT override the
 * import-wizard's selected company unless the admin explicitly chose
 * "per-row company" mode (planned Phase 2b feature; in Phase 2a all rows
 * bind to the wizard's selected company).
 */

import {
  ACCOUNT_COMPANY_STATUS_VALUES,
  asTrimmedString,
  normalizeBoolean,
  normalizeEnum,
  normalizeText,
  parentRecordNoField,
  parseDate,
  recordNoField,
} from './_shared.js';

export const ACCOUNT_COMPANY_VERSION = '2026-06-03.accountCompany.v3';

export const ACCOUNT_COMPANY_FIELDS = [
  recordNoField({
    description: 'Bu Companies sheet satırının dosya içi kimliği. Projects sheet parentCompanyRecordNo ile buraya bağlanabilir.',
  }),
  parentRecordNoField(),
  {
    key: 'accountKey',
    label: 'Müşteri Anahtarı',
    description: 'Parent Account satırına bağlayan anahtar (VKN veya externalCustomerCode). parentRecordNo dolu ise opsiyoneldir.',
    example: '1234567890',
    group: 'İlişki',
    type: 'text',
    required: false,
    aliases: ['accountkey', 'müşteri anahtarı', 'account vkn', 'parent vkn', 'parent key'],
    validationHint: 'Parent account satırlarından birine eşleşmeli (veya parentRecordNo verilmeli).',
    normalizationHint: 'Trim uygulanır.',
    businessWarning: 'Eşleşme bulunamazsa orphan row hatası verir.',
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: false,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 80 });
    },
  },
  {
    key: 'companyCode',
    label: 'Varuna Şirket Kodu',
    description: 'Bu ilişkinin bağlı olduğu Varuna company (örn. COMP-PARAM). Boş bırakılırsa wizard\'da seçili şirkete bağlanır.',
    example: 'COMP-UNIVERA',
    group: 'İlişki',
    type: 'text',
    // WR-A8 Phase 2a review fix — required:false; boş ise selected company
    // kullanılır, dolu ise selected company ile eşleşmek zorunda.
    required: false,
    aliases: ['companycode', 'company code', 'şirket kodu', 'sirket kodu', 'tenant'],
    validationHint: 'Varuna Company.id veya kod. Boş bırakılabilir; selected company atanır.',
    normalizationHint: 'Trim uygulanır.',
    businessWarning: 'Selected company\'den farklı bir şirkete işaret ederse satır hatası (account_company_selected_company_mismatch).',
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: false,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 40 });
    },
  },
  {
    key: 'externalCustomerCode',
    label: 'Dış Müşteri Kodu',
    description: 'Şirket içinde müşteriyi tanımlayan kod (Univera 5 haneli vb.).',
    example: '12345',
    group: 'Kimlik',
    type: 'text',
    required: false,
    aliases: [
      'externalcustomercode',
      'external_customer_code',
      'external customer code',
      'dış müşteri kodu',
      'dis musteri kodu',
      'müşteri kodu',
      'musteri_kodu',
      'müşteri_kodu',
      'müşteri no',
      'musteri no',
      'customer code',
      'customercode',
      'customer_code',
    ],
    validationHint: 'Şirket içinde unique olmalı.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 40 });
    },
  },
  {
    key: 'packageName',
    label: 'Paket Adı (legacy)',
    description: 'Free-text paket adı. packageId entegrasyonu Phase 3.',
    example: 'Premium',
    group: 'Sözleşme',
    type: 'text',
    required: false,
    aliases: ['packagename', 'package', 'paket', 'paket adı'],
    validationHint: 'Maks 100 karakter.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 100 });
    },
  },
  {
    key: 'segment',
    label: 'Segment',
    description: 'Anahtar müşteri / VIP / standart gibi serbest etiket.',
    example: 'Key Account',
    group: 'Sözleşme',
    type: 'text',
    required: false,
    aliases: ['segment', 'müşteri segmenti', 'tier'],
    validationHint: 'Maks 60 karakter.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 60 });
    },
  },
  {
    key: 'contractStartAt',
    label: 'Sözleşme Başlangıç',
    description: 'Sözleşme başlangıç tarihi.',
    example: '2024-01-01',
    group: 'Sözleşme',
    type: 'date',
    required: false,
    aliases: ['contractstartat', 'sozlesme baslangic', 'sözleşme başlangıç', 'start date', 'baslangic'],
    validationHint: 'YYYY-MM-DD veya DD.MM.YYYY.',
    normalizationHint: 'ISO 8601 string.',
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize: parseDate,
  },
  {
    key: 'contractEndAt',
    label: 'Sözleşme Bitiş',
    description: 'Sözleşme bitiş tarihi.',
    example: '2026-12-31',
    group: 'Sözleşme',
    type: 'date',
    required: false,
    aliases: ['contractendat', 'sozlesme bitis', 'sözleşme bitiş', 'end date', 'bitis'],
    validationHint: 'YYYY-MM-DD veya DD.MM.YYYY.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize: parseDate,
  },
  {
    key: 'status',
    label: 'Durum',
    description: 'AccountCompany ilişki durumu.',
    example: 'active',
    group: 'Durum',
    type: 'enum',
    required: false,
    aliases: ['status', 'durum'],
    validationHint: 'active | churn | prospect | inactive',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: true, normalized: null };
      const v = normalizeEnum(s, ACCOUNT_COMPANY_STATUS_VALUES);
      if (v === undefined) return { ok: false, normalized: null, reason: `Durum tanınmadı (active/churn/prospect/inactive).` };
      return { ok: true, normalized: v };
    },
  },
  {
    key: 'isActive',
    label: 'Aktif mi?',
    description: 'İlişki aktif mi.',
    example: 'Evet',
    group: 'Durum',
    type: 'boolean',
    required: false,
    aliases: ['isactive', 'aktif'],
    validationHint: 'Evet/Hayır.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      const v = normalizeBoolean(raw);
      if (v === null) return { ok: true, normalized: null };
      if (v === undefined) return { ok: false, normalized: null, reason: 'Aktiflik değeri tanınmadı.' };
      return { ok: true, normalized: v };
    },
  },
];
