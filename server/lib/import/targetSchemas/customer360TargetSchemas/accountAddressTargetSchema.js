/**
 * WR-A8 Phase 2a — Customer 360 / accountAddress entity schema.
 *
 * Parent: account (via `accountKey`). Country normalized to ISO-3166-1
 * alpha-2. type required, line1 required.
 */

import {
  ADDRESS_TYPE_VALUES,
  asTrimmedString,
  normalizeBoolean,
  normalizeCountryIso2,
  normalizeEnum,
  normalizeText,
} from './_shared.js';

export const ACCOUNT_ADDRESS_VERSION = '2026-05-22.accountAddress.v1';

export const ACCOUNT_ADDRESS_FIELDS = [
  {
    key: 'accountKey',
    label: 'Müşteri Anahtarı',
    description: 'Parent Account satırına bağlayan anahtar.',
    example: '1234567890',
    group: 'İlişki',
    type: 'text',
    required: true,
    aliases: ['accountkey', 'müşteri anahtarı', 'parent vkn'],
    validationHint: 'Parent account satırlarından birine eşleşmeli.',
    normalizationHint: null,
    businessWarning: 'Eşleşmezse orphan address hatası.',
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
    key: 'type',
    label: 'Adres Tipi',
    description: 'Billing / Shipping / Visit / Headquarters / Branch.',
    example: 'Billing',
    group: 'Zorunlu',
    type: 'enum',
    required: true,
    aliases: ['type', 'adres tipi', 'addresstype'],
    validationHint: 'Billing / Shipping / Visit / Headquarters / Branch.',
    normalizationHint: 'Case-insensitive eşleştirme.',
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: false, normalized: null, reason: 'Adres tipi zorunlu.' };
      const v = normalizeEnum(s, ADDRESS_TYPE_VALUES);
      if (v === undefined) return { ok: false, normalized: null, reason: 'Adres tipi tanınmadı (Billing/Shipping/Visit/Headquarters/Branch).' };
      return { ok: true, normalized: v };
    },
  },
  {
    key: 'label',
    label: 'Etiket',
    description: 'Adres etiketi (örn. "Merkez Ofis").',
    example: 'Merkez Ofis',
    group: 'Detay',
    type: 'text',
    required: false,
    aliases: ['label', 'etiket'],
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
    key: 'line1',
    label: 'Sokak/Cadde',
    description: 'Birinci satır — sokak/cadde + numara.',
    example: 'Atatürk Bulvarı No:5',
    group: 'Zorunlu',
    type: 'text',
    required: true,
    aliases: ['line1', 'sokak', 'cadde', 'adres satırı 1', 'adres'],
    validationHint: 'Boş olamaz; maks 250 karakter.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 250, requiredLabel: 'Adres satırı 1' });
    },
  },
  {
    key: 'line2',
    label: 'Bina/Apt No',
    description: 'İkinci satır.',
    example: 'A Blok Kat 3 Daire 12',
    group: 'Detay',
    type: 'text',
    required: false,
    aliases: ['line2', 'adres satırı 2', 'bina', 'apt'],
    validationHint: 'Maks 250 karakter.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 250 });
    },
  },
  {
    key: 'district',
    label: 'İlçe',
    description: 'İlçe / district.',
    example: 'Çankaya',
    group: 'Detay',
    type: 'text',
    required: false,
    aliases: ['district', 'ilçe', 'ilce'],
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
    key: 'city',
    label: 'Şehir',
    description: 'Şehir.',
    example: 'Ankara',
    group: 'Detay',
    type: 'text',
    required: false,
    aliases: ['city', 'sehir', 'şehir', 'il'],
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
    key: 'state',
    label: 'Bölge/Eyalet',
    description: 'State / region (TR için boş bırakılabilir).',
    example: '',
    group: 'Detay',
    type: 'text',
    required: false,
    aliases: ['state', 'eyalet', 'bölge', 'bolge'],
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
    key: 'postalCode',
    label: 'Posta Kodu',
    description: 'Posta kodu.',
    example: '06420',
    group: 'Detay',
    type: 'text',
    required: false,
    aliases: ['postalcode', 'posta kodu', 'postalcode', 'zip'],
    validationHint: 'Maks 20 karakter.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 20 });
    },
  },
  {
    key: 'country',
    label: 'Ülke',
    description: 'ISO-3166-1 alpha-2 (TR, DE, US).',
    example: 'TR',
    group: 'Zorunlu',
    type: 'iso2-country',
    required: true,
    aliases: ['country', 'ülke', 'ulke'],
    validationHint: 'ISO-2 (TR/DE/US...) veya yaygın isim (Türkiye, Germany).',
    normalizationHint: 'ISO-2 normalize.',
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: false, normalized: null, reason: 'Ülke kodu zorunlu.' };
      const v = normalizeCountryIso2(s);
      if (v === undefined) return { ok: false, normalized: null, reason: 'Ülke kodu tanınmadı (TR/DE/US gibi 2 haneli).' };
      return { ok: true, normalized: v };
    },
  },
  {
    key: 'isDefault',
    label: 'Varsayılan mı?',
    description: 'Hesap+tip başına en fazla bir varsayılan.',
    example: 'Evet',
    group: 'Durum',
    type: 'boolean',
    required: false,
    aliases: ['isdefault', 'varsayılan', 'varsayilan', 'default'],
    validationHint: 'Evet/Hayır.',
    normalizationHint: null,
    businessWarning: 'Aynı (account, type) için ikiden fazla default işaretlerse hata verir.',
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
  {
    key: 'isActive',
    label: 'Aktif mi?',
    description: 'Adres aktif mi.',
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
