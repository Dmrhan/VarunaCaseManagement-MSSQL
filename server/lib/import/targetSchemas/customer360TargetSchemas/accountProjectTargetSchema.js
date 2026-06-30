/**
 * WR-A8 Phase 2a — Customer 360 / accountProject entity schema.
 *
 * Parent: accountCompany (NOT account directly — WR-A4 invariant).
 * Match key: accountCompanyKey + projectCode. projectCode must be unique
 * within an AccountCompany.
 */

import {
  PROJECT_STATUS_VALUES,
  asTrimmedString,
  normalizeBoolean,
  normalizeEnum,
  normalizeText,
  parentCompanyRecordNoField,
  parentRecordNoField,
  parseDate,
  recordNoField,
  sourceProjectIdField,
} from './_shared.js';

// Faz B-temel — version bump (anaFirmaKey field eklendi)
export const ACCOUNT_PROJECT_VERSION = '2026-06-30.accountProject.v4';

export const ACCOUNT_PROJECT_FIELDS = [
  recordNoField({
    description: 'Bu Projects sheet satırının dosya içi kimliği.',
  }),
  parentRecordNoField(),
  parentCompanyRecordNoField(),
  sourceProjectIdField(),
  {
    key: 'accountKey',
    label: 'Müşteri Anahtarı',
    description: 'Üst parent Account satırına bağlayan anahtar. parentRecordNo dolu ise opsiyoneldir.',
    example: '1234567890',
    group: 'İlişki',
    type: 'text',
    required: false,
    aliases: ['accountkey', 'müşteri anahtarı', 'parent vkn'],
    validationHint: 'Parent account satırlarından birine eşleşmeli (veya parentRecordNo verilmeli).',
    normalizationHint: null,
    businessWarning: null,
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
    // Faz B-temel (2026-06-30) — Ana Firma (Merkez Müşteri) bağı.
    //
    // Resolver paterni: accountKey ile aynı. Import sırasında bu değer
    // VKN (veya başka unique key) ile Account.vkn eşleşmesinden Account.id
    // çözülür. Çözümlenen Account'ın customerRole='Central' olduğunu
    // import-worker katmanı doğrular (bu schema sadece field tanımı).
    //
    // Cross-tenant guard: import-worker target tenant'taki AccountCompany
    // ile aynı tenant'a bağlı olduğunu doğrular (accountRepository'deki
    // validateAnaFirma mantığı ile aynı).
    //
    // Boş bırakılabilir — mevcut projeler ana-firmasız kalır.
    key: 'anaFirmaKey',
    label: 'Ana Firma Anahtarı',
    description: 'Bu projenin bağlı olduğu Ana Firma (Merkez Müşteri) Account\'unu belirleyen anahtar (genellikle VKN). Account "Müşteri Türü = Merkez Müşteri" rolünde olmalı. Boş bırakılabilir.',
    example: '1234567890',
    group: 'İlişki',
    type: 'text',
    required: false,
    aliases: [
      'anafirmakey', 'ana firma anahtarı', 'ana firma vkn', 'ana firma',
      // n4b varyantları
      'merkez müşteri', 'merkez musteri', 'merkez musteri vkn',
      'parent customer vkn', 'main customer',
    ],
    validationHint: 'Müşteri Türü="Merkez Müşteri" olan bir Account.vkn eşleşmeli.',
    normalizationHint: 'Trim; uzunluk 80 karakter.',
    businessWarning: 'Bilinmeyen anahtar → projenin ana-firma bağı NULL olur (warning).',
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true, // Faz B-temel — sonradan eklenebilir
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 80 });
    },
  },
  {
    key: 'accountCompanyKey',
    label: 'Şirket İlişki Anahtarı',
    description: 'AccountCompany ilişkisini belirleyen companyCode. Boş bırakılırsa wizard\'da seçili şirkete bağlanır.',
    example: 'COMP-UNIVERA',
    group: 'İlişki',
    type: 'text',
    // WR-A8 Phase 2a review fix — required:false; boş ise selected company
    // kullanılır, dolu ise selected company ile eşleşmek zorunda.
    required: false,
    aliases: ['accountcompanykey', 'şirket ilişki', 'companycode', 'company code'],
    validationHint: 'Boş bırakılabilir; selected company atanır. Dolu ise selected company ile eşleşmeli.',
    normalizationHint: null,
    businessWarning: 'Selected company\'den farklı bir şirkete işaret ederse satır hatası.',
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
    key: 'projectCode',
    label: 'Proje Kodu',
    description: 'AccountCompany içinde unique.',
    example: 'RT-001',
    group: 'Zorunlu',
    type: 'text',
    required: true,
    aliases: ['projectcode', 'proje kodu', 'project code', 'code'],
    validationHint: 'Maks 40 karakter; AccountCompany scope unique.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: false,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 40, requiredLabel: 'Proje kodu' });
    },
  },
  {
    key: 'projectName',
    label: 'Proje Adı',
    description: 'Proje adı.',
    example: 'Rota Optimizasyon',
    group: 'Zorunlu',
    type: 'text',
    required: true,
    aliases: ['projectname', 'project name', 'proje adı', 'proje adi'],
    validationHint: 'Maks 200 karakter.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 200, requiredLabel: 'Proje adı' });
    },
  },
  {
    key: 'status',
    label: 'Durum',
    description: 'ProjectStatus enum.',
    example: 'Active',
    group: 'Durum',
    type: 'enum',
    required: false,
    aliases: ['status', 'durum'],
    validationHint: 'Active | Passive | Completed | Cancelled.',
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
      const v = normalizeEnum(s, PROJECT_STATUS_VALUES);
      if (v === undefined) return { ok: false, normalized: null, reason: 'Proje durumu tanınmadı (Active/Passive/Completed/Cancelled).' };
      return { ok: true, normalized: v };
    },
  },
  {
    key: 'startDate',
    label: 'Başlangıç',
    description: 'Proje başlangıç tarihi.',
    example: '2025-03-01',
    group: 'Tarih',
    type: 'date',
    required: false,
    aliases: ['startdate', 'baslangic', 'başlangıç', 'start date'],
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
    key: 'endDate',
    label: 'Bitiş',
    description: 'Proje bitiş tarihi.',
    example: '2026-12-31',
    group: 'Tarih',
    type: 'date',
    required: false,
    aliases: ['enddate', 'bitis', 'bitiş', 'end date'],
    validationHint: 'YYYY-MM-DD veya DD.MM.YYYY; startDate ≤ endDate.',
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
    key: 'description',
    label: 'Açıklama',
    description: 'Serbest açıklama.',
    example: '',
    group: 'Detay',
    type: 'text',
    required: false,
    aliases: ['description', 'açıklama', 'aciklama', 'desc'],
    validationHint: 'Maks 2000 karakter.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 2000 });
    },
  },
  {
    key: 'isActive',
    label: 'Aktif mi?',
    description: 'Proje aktif mi.',
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
      if (v === undefined) return { ok: false, normalized: null, reason: 'Değer tanınmadı.' };
      return { ok: true, normalized: v };
    },
  },
];
