/**
 * WR-A8 Phase 2a — Customer 360 / accountContact entity schema.
 *
 * Parent: account (via `accountKey`). Match key: account + email primary,
 * account + phone secondary. Each account allows at most one primary
 * contact (uniqueness enforced at validation time in Phase 2a).
 */

import {
  asTrimmedString,
  normalizeBoolean,
  normalizePhoneE164,
  normalizeText,
  validateEmail,
} from './_shared.js';

export const ACCOUNT_CONTACT_VERSION = '2026-05-22.accountContact.v1';

export const ACCOUNT_CONTACT_FIELDS = [
  {
    key: 'accountKey',
    label: 'Müşteri Anahtarı',
    description: 'Parent Account satırına bağlayan anahtar.',
    example: '1234567890',
    group: 'İlişki',
    type: 'text',
    required: true,
    aliases: ['accountkey', 'müşteri anahtarı', 'account vkn', 'parent vkn'],
    validationHint: 'Parent account satırlarından birine eşleşmeli.',
    normalizationHint: null,
    businessWarning: 'Eşleşmezse orphan contact hatası.',
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
    key: 'fullName',
    label: 'Ad Soyad',
    description: 'İletişim kişisinin tam adı.',
    example: 'Ali Veli',
    group: 'Zorunlu',
    type: 'text',
    required: true,
    aliases: ['fullname', 'full name', 'ad soyad', 'adsoyad', 'isim', 'name'],
    validationHint: 'Maks 150 karakter.',
    normalizationHint: 'Trim uygulanır.',
    businessWarning: null,
    sensitive: true,
    pii: true,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 150, requiredLabel: 'Ad soyad' });
    },
  },
  {
    key: 'title',
    label: 'Unvan',
    description: 'Görev/unvan.',
    example: 'Satın Alma Müdürü',
    group: 'Detay',
    type: 'text',
    required: false,
    aliases: ['title', 'unvan', 'gorev', 'görev', 'position'],
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
    key: 'email',
    label: 'E-posta',
    description: 'İletişim e-posta adresi. Match key.',
    example: 'ali@acme.com.tr',
    group: 'İletişim',
    type: 'email',
    required: false,
    aliases: ['email', 'e-posta', 'eposta', 'mail'],
    validationHint: 'name@domain.tld.',
    normalizationHint: null,
    businessWarning: null,
    sensitive: true,
    pii: true,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: true, normalized: null };
      const r = validateEmail(s);
      if (!r.ok) return { ok: false, normalized: null, reason: r.reason };
      return { ok: true, normalized: r.normalized };
    },
  },
  {
    key: 'phone',
    label: 'Telefon',
    description: 'İletişim telefonu. Fallback match key.',
    example: '+905321112233',
    group: 'İletişim',
    type: 'phone',
    required: false,
    aliases: ['phone', 'telefon', 'gsm', 'cep'],
    validationHint: 'TR formatları + E.164.',
    normalizationHint: 'E.164 normalize.',
    businessWarning: null,
    sensitive: true,
    pii: true,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: true, normalized: null };
      const e164 = normalizePhoneE164(s);
      if (!e164) return { ok: false, normalized: null, reason: 'Telefon E.164 formatına çevrilemedi.' };
      return { ok: true, normalized: e164, extra: { rawPhone: s } };
    },
  },
  {
    key: 'isPrimary',
    label: 'Birincil mi?',
    description: 'Hesap başına en fazla bir birincil iletişim olabilir.',
    example: 'Evet',
    group: 'Durum',
    type: 'boolean',
    required: false,
    aliases: ['isprimary', 'birincil', 'primary'],
    validationHint: 'Evet/Hayır.',
    normalizationHint: null,
    businessWarning: 'Aynı müşteri için ikiden fazla birincil işaretlerse hata verir.',
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
    description: 'İletişim kişisi aktif mi.',
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
  {
    key: 'notes',
    label: 'Not',
    description: 'Serbest not.',
    example: '',
    group: 'Detay',
    type: 'text',
    required: false,
    aliases: ['notes', 'not', 'note'],
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
];
