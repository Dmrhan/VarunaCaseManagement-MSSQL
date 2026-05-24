/**
 * WR-A8 — Account import target schema registry.
 *
 * Bu modül "Veri Aktarım Stüdyosu"nun hedef alan kaynağıdır. UI ve BFF
 * doğrulama-mantığı bu kayıttan beslenir. Yeni alan eklendiğinde:
 *
 *   1) Aşağıdaki FIELDS dizisine ekle.
 *   2) VERSION sabitini güncelle (date.label.v<n>).
 *   3) Frontend otomatik yeni alanı render eder; ekstra UI değişikliği gerekmez.
 *
 * Phase 1 yalnızca Account hedefi destekler.
 */

import {
  validateVkn,
  normalizePhoneE164,
} from '../../../utils/accountValidation.js';
import { CUSTOMER_TYPE_VALUES } from '../../../db/enumMap.js';

export const ACCOUNT_TARGET_VERSION = '2026-05-22.account.v1';
export const ACCOUNT_TARGET_TYPE = 'account';

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

function asTrimmedString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Email — temel format validation. International idn-email değil; basit pattern.
 */
function validateEmail(input) {
  const s = asTrimmedString(input);
  if (!s) return { ok: false, normalized: null, reason: 'E-posta boş.' };
  // RFC 5322'nin minimal simplification'ı; gerçek e-posta için yeterli.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    return { ok: false, normalized: null, reason: 'E-posta formatı geçersiz.' };
  }
  return { ok: true, normalized: s };
}

function normalizeBoolean(input) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'boolean') return input;
  const s = String(input).trim().toLowerCase();
  if (BOOLEAN_TRUE.has(s)) return true;
  if (BOOLEAN_FALSE.has(s)) return false;
  return undefined; // undefined → unparsable
}

function normalizeCustomerTypeLabel(input) {
  const s = asTrimmedString(input);
  if (!s) return null;
  const key = s.toLowerCase();
  if (CUSTOMER_TYPE_LABEL_MAP[key]) return CUSTOMER_TYPE_LABEL_MAP[key];
  // Türkçe enum mapping (Bireysel/Kurumsal/Kamu/Vakıf-STK) zaten map'te;
  // direkt enum key de kabul edilir.
  if (CUSTOMER_TYPE_VALUES.includes(s)) return s;
  return undefined; // undefined → unknown value
}

/**
 * Phase 1 Account importable fields.
 *
 * Field metadata:
 *  - key:            Internal Account field key (Prisma model property)
 *  - label:          Türkçe display label
 *  - group:          UI grouping (Zorunlu / Kimlik / Yasal / İletişim / Durum)
 *  - required:       true → mapping zorunlu (dry-run önce blocker)
 *  - type:           text | number | email | phone | vkn | boolean | enum
 *  - aliases:        Auto-map için case-insensitive alias listesi
 *  - description:    UI'da hint
 *  - example:        Şablon CSV'de örnek değer
 *  - writable:       BE write yapar mı (false ise yalnız display)
 *  - createAllowed:  Create payload'a dahil edilir mi
 *  - updateAllowed:  Update payload'a dahil edilir mi
 *  - warningIfMissing: Map edilmezse satır warning üret
 *  - normalize:      (raw) => { ok, normalized, reason, warning }
 */
export const ACCOUNT_TARGET_FIELDS = [
  // ───── Zorunlu ─────
  {
    key: 'name',
    label: 'Müşteri Adı',
    group: 'Zorunlu',
    required: true,
    type: 'text',
    aliases: [
      'name',
      'müşteri adı',
      'musteri adi',
      'müşteri',
      'musteri',
      'unvan',
      'firma adı',
      'firma adi',
      'company name',
      'account name',
      'ad',
      'isim',
    ],
    description: 'Müşterinin görünen adı. Boş bırakılamaz.',
    example: 'Acme Kurumsal A.Ş.',
    writable: true,
    createAllowed: true,
    updateAllowed: true,
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: false, normalized: null, reason: 'Müşteri adı boş olamaz.' };
      if (s.length > 200) return { ok: false, normalized: null, reason: 'Müşteri adı 200 karakterden uzun.' };
      return { ok: true, normalized: s };
    },
  },

  // ───── Kimlik ─────
  {
    key: 'vkn',
    label: 'VKN',
    group: 'Kimlik',
    required: false,
    type: 'vkn',
    aliases: ['vkn', 'vergi no', 'vergino', 'tax id', 'tax number', 'taxid', 'taxnumber'],
    description: '10 haneli Vergi Kimlik Numarası. Eşleştirme anahtarı.',
    example: '1234567890',
    writable: true,
    createAllowed: true,
    updateAllowed: true,
    warningIfMissing: {
      code: 'no_tax_id',
      message: 'VKN/TCKN yok. Kayıt resmi kimlik olmadan oluşturulacak; ileride tamamlanabilir.',
    },
    normalize(raw) {
      const s = asTrimmedString(raw);
      // Treat NULL-like sentinel values (legacy exports often use literal
      // "NULL"/"-") the same as a blank cell so they reach the per-row
      // no_tax_id warning path rather than the invalid-VKN error path.
      if (!s || /^(null|-)$/i.test(s)) return { ok: true, normalized: null };
      const r = validateVkn(s);
      if (!r.ok) return { ok: false, normalized: null, reason: r.reason ?? 'VKN geçersiz.' };
      return { ok: true, normalized: r.normalized };
    },
  },
  {
    key: 'customerType',
    label: 'Müşteri Tipi',
    group: 'Kimlik',
    required: false,
    type: 'enum',
    aliases: [
      'customertype',
      'customer type',
      'müşteri tipi',
      'musteri tipi',
      'müşteri türü',
      'musteri turu',
      'tip',
      'type',
    ],
    description: 'Bireysel, Kurumsal, Kamu veya Vakıf-STK. Boş bırakılırsa Kurumsal varsayılır.',
    example: 'Kurumsal',
    writable: true,
    createAllowed: true,
    updateAllowed: true,
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: true, normalized: null };
      const mapped = normalizeCustomerTypeLabel(s);
      if (mapped === undefined) {
        return { ok: false, normalized: null, reason: 'Müşteri tipi bilinmiyor (Bireysel/Kurumsal/Kamu/Vakıf-STK).' };
      }
      return { ok: true, normalized: mapped };
    },
  },
  {
    key: 'externalCustomerCode',
    label: 'Dış Müşteri Kodu',
    group: 'Kimlik',
    required: false,
    type: 'text',
    aliases: [
      'externalcustomercode',
      'external customer code',
      'dış müşteri kodu',
      'dis musteri kodu',
      'müşteri kodu',
      'musteri kodu',
      'müşteri no',
      'musteri no',
      'customer code',
      'customer no',
    ],
    description: 'Şirketinizdeki müşteri kodu (örn. Univera 5 haneli). Şirket bazlı tekildir.',
    example: '12345',
    writable: true, // AccountCompany üzerine yazılır
    createAllowed: true,
    updateAllowed: true,
    /** AccountCompany üzerine yazılan field — Account'a değil. */
    target: 'accountCompany',
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: true, normalized: null };
      if (s.length > 40) return { ok: false, normalized: null, reason: 'Dış müşteri kodu 40 karakteri aşamaz.' };
      return { ok: true, normalized: s };
    },
  },

  // ───── Yasal ─────
  {
    key: 'legalName',
    label: 'Ticari Unvan',
    group: 'Yasal',
    required: false,
    type: 'text',
    aliases: ['legalname', 'legal name', 'ticari unvan', 'ticariunvan', 'unvan', 'full legal name'],
    description: 'Resmi ticari unvan (kurumsal müşteriler için).',
    example: 'Acme Kurumsal Anonim Şirketi',
    writable: true,
    createAllowed: true,
    updateAllowed: true,
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: true, normalized: null };
      if (s.length > 250) return { ok: false, normalized: null, reason: 'Ticari unvan 250 karakteri aşamaz.' };
      return { ok: true, normalized: s };
    },
  },
  {
    key: 'registrationNo',
    label: 'Sicil No',
    group: 'Yasal',
    required: false,
    type: 'text',
    aliases: ['registrationno', 'registration no', 'sicil no', 'sicilno', 'ticaret sicil'],
    description: 'Ticaret sicil numarası veya muadili.',
    example: '123456-5',
    writable: true,
    createAllowed: true,
    updateAllowed: true,
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: true, normalized: null };
      if (s.length > 60) return { ok: false, normalized: null, reason: 'Sicil no 60 karakteri aşamaz.' };
      return { ok: true, normalized: s };
    },
  },

  // ───── İletişim ─────
  {
    key: 'phone',
    label: 'Telefon',
    group: 'İletişim',
    required: false,
    type: 'phone',
    aliases: ['phone', 'telefon', 'gsm', 'tel', 'mobile', 'cep'],
    description: 'Müşteri telefonu. E.164 formatına çevrilir.',
    example: '+905321112233',
    writable: true,
    createAllowed: true,
    updateAllowed: true,
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: true, normalized: null };
      const e164 = normalizePhoneE164(s);
      if (!e164) {
        return { ok: false, normalized: null, reason: 'Telefon numarası E.164 formatına çevrilemedi.' };
      }
      // raw display + e164 normalize: caller iki alanı da yazsın diye object döner
      return { ok: true, normalized: e164, extra: { rawPhone: s } };
    },
  },
  {
    key: 'email',
    label: 'E-posta',
    group: 'İletişim',
    required: false,
    type: 'email',
    aliases: ['email', 'e-posta', 'eposta', 'mail', 'mail adresi', 'e-mail'],
    description: 'İletişim e-posta adresi.',
    example: 'info@acme.com.tr',
    writable: true,
    createAllowed: true,
    updateAllowed: true,
    normalize(raw) {
      const s = asTrimmedString(raw);
      if (!s) return { ok: true, normalized: null };
      const r = validateEmail(s);
      if (!r.ok) return { ok: false, normalized: null, reason: r.reason ?? 'E-posta geçersiz.' };
      return { ok: true, normalized: r.normalized };
    },
  },

  // ───── Durum ─────
  {
    key: 'isActive',
    label: 'Aktif mi?',
    group: 'Durum',
    required: false,
    type: 'boolean',
    aliases: ['isactive', 'is active', 'aktif', 'aktif mi', 'active', 'durum'],
    description: 'Evet/Hayır, true/false, 1/0 kabul edilir. Boş bırakılırsa true varsayılır.',
    example: 'Evet',
    writable: true,
    createAllowed: true,
    updateAllowed: true,
    normalize(raw) {
      const v = normalizeBoolean(raw);
      if (v === null) return { ok: true, normalized: null };
      if (v === undefined) return { ok: false, normalized: null, reason: 'Aktiflik değeri tanınmadı (Evet/Hayır kullanın).' };
      return { ok: true, normalized: v };
    },
  },
];

const KEY_INDEX = new Map(ACCOUNT_TARGET_FIELDS.map((f) => [f.key, f]));

export function getAccountTargetField(key) {
  return KEY_INDEX.get(key) ?? null;
}

/**
 * Public schema descriptor (frontend & API yanıtı).
 */
export function describeAccountTargetSchema() {
  return {
    target: ACCOUNT_TARGET_TYPE,
    version: ACCOUNT_TARGET_VERSION,
    fields: ACCOUNT_TARGET_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      group: f.group,
      required: !!f.required,
      type: f.type,
      aliases: f.aliases,
      description: f.description,
      example: f.example,
      writable: f.writable !== false,
      createAllowed: f.createAllowed !== false,
      updateAllowed: f.updateAllowed !== false,
      warningIfMissing: f.warningIfMissing ?? null,
      target: f.target ?? 'account',
    })),
  };
}

/**
 * Auto-map source column → target field. Confidence: 1.0 exact, 0.9 alias.
 */
export function autoMapAccountColumns(columnNames) {
  const out = [];
  const lower = columnNames.map((c) => ({ raw: c, key: String(c ?? '').trim().toLowerCase() }));

  for (const col of lower) {
    if (!col.key) {
      out.push({ source: col.raw, targetKey: null, confidence: 0 });
      continue;
    }
    let best = null;
    for (const f of ACCOUNT_TARGET_FIELDS) {
      // exact key
      if (col.key === f.key.toLowerCase()) {
        best = { targetKey: f.key, confidence: 1.0 };
        break;
      }
      // alias
      if (f.aliases.includes(col.key)) {
        if (!best || best.confidence < 0.9) {
          best = { targetKey: f.key, confidence: 0.9 };
        }
      }
    }
    out.push({ source: col.raw, targetKey: best?.targetKey ?? null, confidence: best?.confidence ?? 0 });
  }
  return out;
}

/**
 * Mapping doğrulaması:
 *  - Required field eksik → blocker
 *  - Unknown target key → blocker
 *  - Aynı target key birden çok source'a map edilmiş → blocker
 *  - warningIfMissing trigger → warning
 */
export function validateMapping(mapping) {
  const errors = [];
  const warnings = [];
  const targetCount = new Map();
  for (const m of mapping) {
    if (!m.targetKey) continue;
    if (!KEY_INDEX.has(m.targetKey)) {
      errors.push({ code: 'unknown_target', source: m.source, targetKey: m.targetKey });
      continue;
    }
    targetCount.set(m.targetKey, (targetCount.get(m.targetKey) ?? 0) + 1);
  }
  for (const [targetKey, n] of targetCount.entries()) {
    if (n > 1) {
      errors.push({
        code: 'duplicate_target',
        targetKey,
        message: `${KEY_INDEX.get(targetKey).label} alanına birden fazla kaynak eşleştirildi.`,
      });
    }
  }
  for (const f of ACCOUNT_TARGET_FIELDS) {
    const mapped = targetCount.has(f.key);
    if (f.required && !mapped) {
      errors.push({
        code: 'required_unmapped',
        targetKey: f.key,
        message: `${f.label} alanı eşleştirilmeli.`,
      });
    } else if (!mapped && f.warningIfMissing) {
      warnings.push({
        code: f.warningIfMissing.code,
        targetKey: f.key,
        message: f.warningIfMissing.message,
      });
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Satır normalize: source row + mapping → normalized object + errors/warnings.
 *
 * Returns:
 *   { normalized, errors, warnings, hasVkn }
 *   normalized = { name, vkn, customerType, ... } (account + accountCompany karışık)
 */
export function normalizeRow(rawRow, mapping) {
  const errors = [];
  const warnings = [];
  const normalized = {};
  let hasVkn = false;
  // `rawVknPresent` reflects the SOURCE cell: was anything actually written
  // there? It's intentionally separate from `hasVkn` (which reflects the
  // NORMALIZED result). A row with a malformed VKN string has
  // rawVknPresent=true (and an invalid-VKN error) but hasVkn=false. Without
  // this split the same row would receive both the error and the misleading
  // no_tax_id warning.
  let rawVknPresent = false;
  for (const m of mapping) {
    if (!m.targetKey) continue;
    const f = KEY_INDEX.get(m.targetKey);
    if (!f) continue;
    const rawValue = rawRow[m.source];
    if (f.key === 'vkn') {
      const s = asTrimmedString(rawValue);
      if (s && !/^(null|-)$/i.test(s)) rawVknPresent = true;
    }
    const r = f.normalize(rawValue);
    if (!r.ok) {
      errors.push({ targetKey: f.key, label: f.label, message: r.reason });
      continue;
    }
    if (r.normalized !== null) {
      normalized[f.key] = r.normalized;
      if (f.key === 'vkn') hasVkn = true;
    }
    if (r.warning) warnings.push({ targetKey: f.key, label: f.label, message: r.warning });
    if (r.extra?.rawPhone) {
      normalized._rawPhone = r.extra.rawPhone;
    }
  }
  // no_tax_id reflects ABSENCE of a source value, not "invalid value". A
  // malformed VKN already errors; emitting the missing-identity warning on
  // top would be contradictory and would inflate missingTaxIdCount metrics.
  // Operators must never be pushed to invent fake VKN/TCKN — missing
  // identity is warned, not blocked.
  if (!rawVknPresent) {
    warnings.push({
      code: 'no_tax_id',
      targetKey: 'vkn',
      label: 'VKN',
      message: 'VKN/TCKN yok. Kayıt resmi kimlik olmadan oluşturulacak; ileride tamamlanabilir.',
    });
  }
  return { normalized, errors, warnings, hasVkn };
}

/**
 * Template generator (CSV). Header satırı target field label'larından.
 */
export function generateAccountTemplateCsv() {
  const headers = ACCOUNT_TARGET_FIELDS.map((f) => f.label);
  const examples = ACCOUNT_TARGET_FIELDS.map((f) => f.example ?? '');
  // CSV: BOM + header + tek örnek satır
  return '﻿' + headers.join(',') + '\n' + examples.join(',') + '\n';
}
