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
  parseDate,
} from './_shared.js';

export const ACCOUNT_PROJECT_VERSION = '2026-05-22.accountProject.v1';

export const ACCOUNT_PROJECT_FIELDS = [
  {
    key: 'accountKey',
    label: 'Müşteri Anahtarı',
    description: 'Üst parent Account satırına bağlayan anahtar.',
    example: '1234567890',
    group: 'İlişki',
    type: 'text',
    required: true,
    aliases: ['accountkey', 'müşteri anahtarı', 'parent vkn'],
    validationHint: 'Parent account satırlarından birine eşleşmeli.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: false,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 80, requiredLabel: 'Müşteri anahtarı' });
    },
  },
  {
    key: 'accountCompanyKey',
    label: 'Şirket İlişki Anahtarı',
    description: 'AccountCompany ilişkisini belirleyen companyCode.',
    example: 'COMP-UNIVERA',
    group: 'İlişki',
    type: 'text',
    required: true,
    aliases: ['accountcompanykey', 'şirket ilişki', 'companycode', 'company code'],
    validationHint: 'accountKey + companyCode satırına eşleşmeli.',
    normalizationHint: null,
    businessWarning: 'Eşleşmezse orphan project hatası.',
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: false,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 40, requiredLabel: 'Şirket ilişki anahtarı' });
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
