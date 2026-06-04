/**
 * Phone normalization & validation helpers — libphonenumber-js wrapper.
 *
 * Varuna farklı ülkelerde müşterisi olan bir case management ürünü;
 * telefon numarası müşteri arama, kontak yönetimi, import temizliği ve
 * gelecekteki çağrı eşleştirmesi için kritik kimlik alanıdır. Bu
 * modül UI tarafındaki tek doğru kaynaktır:
 *
 *  - Canonical storage: E.164 (örn. "+905321112233").
 *  - Default country: TR.
 *  - Empty input → null-safe (asla throw).
 *  - Invalid input → yapısal sonuç (asla crash).
 *
 * libphonenumber-js'in `min` build'i yeterli (mobile-friendly ~10KB
 * gzip); bütün ülkelerin metadata'sını barındırır.
 */

import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

export type CountryIso2 = CountryCode;

export interface PhoneParts {
  /** E.164 canonical (örn. "+905321112233"); invalid ise null. */
  e164: string | null;
  /** ISO-3166-1 alpha-2 ("TR", "DE"); invalid ise null. */
  country: CountryIso2 | null;
  /** Ülke ön eki ("90", "49"); invalid ise null. */
  countryCallingCode: string | null;
  /** Ülke kodu hariç ulusal kısım (örn. "5321112233"); invalid ise null. */
  nationalNumber: string | null;
  /** Display-friendly international format (örn. "+90 532 111 22 33"). */
  display: string;
  /** Tam geçerli + tanınan bir numara mı? */
  isValid: boolean;
  /** Tamamen boş input mı? (`null` veya whitespace.) */
  isEmpty: boolean;
}

const EMPTY_PARTS: PhoneParts = {
  e164: null,
  country: null,
  countryCallingCode: null,
  nationalNumber: null,
  display: '',
  isValid: false,
  isEmpty: true,
};

/**
 * Bir input'u (kullanıcı girişi, E.164, ulusal format vb.) yapılandırılmış
 * parts'a çevirir. Boşsa empty-safe sonuç döner.
 */
export function parsePhoneParts(input: string | null | undefined, defaultCountry: CountryIso2 = 'TR'): PhoneParts {
  if (input == null) return EMPTY_PARTS;
  const raw = String(input).trim();
  if (raw === '') return EMPTY_PARTS;
  try {
    const parsed = parsePhoneNumberFromString(raw, defaultCountry);
    if (!parsed) {
      return {
        e164: null,
        country: null,
        countryCallingCode: null,
        nationalNumber: null,
        display: raw,
        isValid: false,
        isEmpty: false,
      };
    }
    const isValid = parsed.isValid();
    return {
      e164: isValid ? parsed.number : null,
      country: (parsed.country as CountryIso2 | undefined) ?? null,
      countryCallingCode: parsed.countryCallingCode ?? null,
      nationalNumber: parsed.nationalNumber ?? null,
      display: isValid ? parsed.formatInternational() : raw,
      isValid,
      isEmpty: false,
    };
  } catch {
    return {
      e164: null,
      country: null,
      countryCallingCode: null,
      nationalNumber: null,
      display: raw,
      isValid: false,
      isEmpty: false,
    };
  }
}

/**
 * Input'u E.164 string'e normalize eder. Boşsa null, invalid ise null
 * (asla "düzelttiğini" varsayıp fake bir sayı üretmez).
 */
export function normalizePhone(input: string | null | undefined, defaultCountry: CountryIso2 = 'TR'): string | null {
  return parsePhoneParts(input, defaultCountry).e164;
}

/** Display-friendly international format. Boşsa "". */
export function formatPhoneForDisplay(input: string | null | undefined, defaultCountry: CountryIso2 = 'TR'): string {
  return parsePhoneParts(input, defaultCountry).display;
}

/** True ⇔ input geçerli + tanınan bir numara. Boş input → false. */
export function isValidPhone(input: string | null | undefined, country?: CountryIso2): boolean {
  return parsePhoneParts(input, country ?? 'TR').isValid;
}

/**
 * AsYouType formatter — kullanıcı yazarken local display'i günceller.
 * E.164 storage path'i her zaman normalizePhone'dan geçer; bu sadece
 * görsel feedback içindir.
 */
export function formatAsYouType(input: string, country: CountryIso2 = 'TR'): string {
  if (!input) return '';
  try {
    const formatter = new AsYouType(country);
    return formatter.input(input);
  } catch {
    return input;
  }
}

export interface CountryOption {
  iso2: CountryIso2;
  name: string;
  dialCode: string;
}

// İsim TR olarak gösterilsin diye küçük bir TR kapsamlı sözlük (en sık
// kullanılan ülkeler). libphonenumber-js country list'i ISO-2 koduyla
// döner; UI'da ülke adı + dial code + ISO arama gerekiyor.
const TR_COUNTRY_NAMES: Partial<Record<CountryIso2, string>> = {
  TR: 'Türkiye',
  DE: 'Almanya',
  US: 'Amerika Birleşik Devletleri',
  GB: 'Birleşik Krallık',
  FR: 'Fransa',
  IT: 'İtalya',
  ES: 'İspanya',
  NL: 'Hollanda',
  BE: 'Belçika',
  AT: 'Avusturya',
  CH: 'İsviçre',
  SE: 'İsveç',
  NO: 'Norveç',
  DK: 'Danimarka',
  FI: 'Finlandiya',
  PL: 'Polonya',
  CZ: 'Çekya',
  RU: 'Rusya',
  UA: 'Ukrayna',
  BG: 'Bulgaristan',
  GR: 'Yunanistan',
  RO: 'Romanya',
  AZ: 'Azerbaycan',
  GE: 'Gürcistan',
  IR: 'İran',
  IQ: 'Irak',
  SY: 'Suriye',
  IL: 'İsrail',
  AE: 'Birleşik Arap Emirlikleri',
  SA: 'Suudi Arabistan',
  QA: 'Katar',
  KW: 'Kuveyt',
  EG: 'Mısır',
  MA: 'Fas',
  CN: 'Çin',
  JP: 'Japonya',
  KR: 'Güney Kore',
  IN: 'Hindistan',
  AU: 'Avustralya',
  CA: 'Kanada',
  BR: 'Brezilya',
  MX: 'Meksika',
  AR: 'Arjantin',
  ZA: 'Güney Afrika',
  KZ: 'Kazakistan',
  // Diğerleri default olarak ISO-2 code'u gösterir.
};

const REGION_NAMES_EN = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

const REGION_NAMES_TR = (() => {
  try {
    return new Intl.DisplayNames(['tr'], { type: 'region' });
  } catch {
    return null;
  }
})();

function regionName(iso2: CountryIso2): string {
  if (TR_COUNTRY_NAMES[iso2]) return TR_COUNTRY_NAMES[iso2] as string;
  try {
    return REGION_NAMES_TR?.of(iso2) ?? REGION_NAMES_EN?.of(iso2) ?? iso2;
  } catch {
    return iso2;
  }
}

let _COUNTRY_OPTIONS: CountryOption[] | null = null;

/**
 * Tüm desteklenen ülkelerin listesini (ISO-2 + display name + dial code)
 * döner. TR ilk sırada, kalan ülkeler alfabetik (display name TR locale).
 * Lazy + cached — list yaklaşık 250 öğe, render'da yeniden hesaplanmaz.
 */
export function getCountryOptions(): CountryOption[] {
  if (_COUNTRY_OPTIONS) return _COUNTRY_OPTIONS;
  const all = getCountries()
    .map((iso2) => ({
      iso2: iso2 as CountryIso2,
      name: regionName(iso2 as CountryIso2),
      dialCode: getCountryCallingCode(iso2),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const tr = all.find((c) => c.iso2 === 'TR');
  const rest = all.filter((c) => c.iso2 !== 'TR');
  _COUNTRY_OPTIONS = tr ? [tr, ...rest] : all;
  return _COUNTRY_OPTIONS;
}

/**
 * Arama filtresi — ülke adı, ISO-2 ve dial code üzerinden case-insensitive
 * substring match.
 */
export function filterCountries(query: string, options?: CountryOption[]): CountryOption[] {
  const list = options ?? getCountryOptions();
  const q = query.trim().toLowerCase().replace(/^\+/, '');
  if (!q) return list;
  return list.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.iso2.toLowerCase().includes(q) ||
      c.dialCode.includes(q),
  );
}
