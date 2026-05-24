/**
 * WR-A8 Phase 2a — Customer 360 / account entity schema.
 *
 * Reuses Phase 1 fields (label-by-label) but lives in the new multi-target
 * registry. Phase 1's standalone accountTargetSchema.js is NOT modified —
 * existing endpoints keep working unchanged.
 */

import {
  asTrimmedString,
  normalizeBoolean,
  normalizeCustomerType,
  normalizePhoneE164,
  normalizeText,
  validateEmail,
  validateVkn,
} from './_shared.js';

export const ACCOUNT_VERSION = '2026-05-22.account.v2';

export const ACCOUNT_FIELDS = [
  {
    key: 'name',
    label: 'Müşteri Adı',
    description: 'Müşterinin görünen adı. Boş bırakılamaz.',
    example: 'Acme Kurumsal A.Ş.',
    group: 'Zorunlu',
    type: 'text',
    required: true,
    aliases: ['name', 'müşteri adı', 'musteri adi', 'firma adı', 'firma adi', 'company name', 'account name', 'ad', 'isim', 'unvan'],
    validationHint: '1-200 karakter; boş olamaz.',
    normalizationHint: 'Trim uygulanır.',
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      return normalizeText(raw, { max: 200, requiredLabel: 'Müşteri adı' });
    },
  },
  {
    key: 'vkn',
    label: 'VKN',
    description: '10 haneli Vergi Kimlik Numarası. Eşleştirme anahtarı.',
    example: '1234567890',
    group: 'Kimlik',
    type: 'vkn',
    required: false,
    aliases: ['vkn', 'vergi no', 'vergino', 'tax id', 'tax number', 'taxid', 'taxnumber'],
    validationHint: '10 haneli rakam + checksum.',
    normalizationHint: 'Boşluk/tire kaldırılır.',
    businessWarning: 'VKN eşleşmezse mevcut müşteri güncellemesi yapılamaz; yeni müşteri açılır.',
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: {
      code: 'no_tax_id',
      message: 'VKN/TCKN yok. Kayıt resmi kimlik olmadan oluşturulacak; ileride tamamlanabilir.',
    },
    normalize(raw) {
      const s = asTrimmedString(raw);
      // NULL-like sentinels ('NULL', '-') reach normalize as non-empty
      // strings; treat them as missing so they take the no_tax_id warning
      // path rather than producing a misleading invalid-VKN error.
      if (!s || /^(null|-)$/i.test(s)) return { ok: true, normalized: null };
      const r = validateVkn(s);
      if (!r.ok) return { ok: false, normalized: null, reason: r.reason ?? 'VKN geçersiz.' };
      return { ok: true, normalized: r.normalized };
    },
  },
  {
    key: 'customerType',
    label: 'Müşteri Tipi',
    description: 'Bireysel, Kurumsal, Kamu veya Vakıf-STK. Boş bırakılırsa Kurumsal varsayılır.',
    example: 'Kurumsal',
    group: 'Kimlik',
    type: 'enum',
    required: false,
    aliases: ['customertype', 'customer type', 'müşteri tipi', 'musteri tipi', 'tip', 'type'],
    validationHint: 'Bireysel / Kurumsal / Kamu / Vakıf-STK',
    normalizationHint: 'Lowercase eşleştirme.',
    businessWarning: null,
    sensitive: false,
    pii: false,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: null,
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: true, normalized: null };
      const v = normalizeCustomerType(s);
      if (v === undefined) return { ok: false, normalized: null, reason: 'Müşteri tipi bilinmiyor (Bireysel/Kurumsal/Kamu/Vakıf-STK).' };
      return { ok: true, normalized: v };
    },
  },
  {
    key: 'legalName',
    label: 'Ticari Unvan',
    description: 'Resmi ticari unvan (kurumsal müşteriler için).',
    example: 'Acme Kurumsal Anonim Şirketi',
    group: 'Yasal',
    type: 'text',
    required: false,
    aliases: ['legalname', 'legal name', 'ticari unvan', 'ticariunvan'],
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
    key: 'registrationNo',
    label: 'Sicil No',
    description: 'Ticaret sicil numarası.',
    example: '123456-5',
    group: 'Yasal',
    type: 'text',
    required: false,
    aliases: ['registrationno', 'registration no', 'sicil no', 'sicilno', 'ticaret sicil'],
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
    key: 'phone',
    label: 'Telefon',
    description: 'Müşteri telefonu. E.164 formatına çevrilir.',
    example: '+905321112233',
    group: 'İletişim',
    type: 'phone',
    required: false,
    aliases: ['phone', 'telefon', 'gsm', 'tel'],
    validationHint: 'TR formatları + E.164 desteklenir.',
    normalizationHint: 'E.164 normalize edilir.',
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
      if (!e164) return { ok: false, normalized: null, reason: 'Telefon numarası E.164 formatına çevrilemedi.' };
      return { ok: true, normalized: e164, extra: { rawPhone: s } };
    },
  },
  {
    key: 'email',
    label: 'E-posta',
    description: 'İletişim e-posta adresi.',
    example: 'info@acme.com.tr',
    group: 'İletişim',
    type: 'email',
    required: false,
    aliases: ['email', 'e-posta', 'eposta', 'mail'],
    validationHint: 'name@domain.tld formatı.',
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
    key: 'isActive',
    label: 'Aktif mi?',
    description: 'Evet/Hayır kabul edilir. Boş bırakılırsa true varsayılır.',
    example: 'Evet',
    group: 'Durum',
    type: 'boolean',
    required: false,
    aliases: ['isactive', 'aktif', 'aktif mi', 'active', 'durum'],
    validationHint: 'Evet/Hayır, true/false, 1/0.',
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
