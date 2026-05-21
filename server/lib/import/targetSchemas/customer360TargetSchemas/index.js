/**
 * WR-A8 Phase 2a — Customer 360 multi-target schema registry composer.
 *
 * Entity registry + relationships + dynamic schema response builder.
 * All field metadata derives from per-entity files; no duplication.
 *
 * Phase 2a scope: registry + describe + autoMap + per-row normalize.
 * No commit / no rollback / no DB mutation here.
 */

import { ACCOUNT_FIELDS, ACCOUNT_VERSION } from './accountTargetSchema.js';
import { ACCOUNT_COMPANY_FIELDS, ACCOUNT_COMPANY_VERSION } from './accountCompanyTargetSchema.js';
import { ACCOUNT_CONTACT_FIELDS, ACCOUNT_CONTACT_VERSION } from './accountContactTargetSchema.js';
import { ACCOUNT_ADDRESS_FIELDS, ACCOUNT_ADDRESS_VERSION } from './accountAddressTargetSchema.js';
import { ACCOUNT_PROJECT_FIELDS, ACCOUNT_PROJECT_VERSION } from './accountProjectTargetSchema.js';

export const CUSTOMER_360_VERSION = '2026-05-22.customer360.v1';

/**
 * Entity registry. Each entry is the full descriptor.
 */
export const CUSTOMER_360_ENTITIES = [
  {
    entity: 'account',
    version: ACCOUNT_VERSION,
    label: 'Müşteri Ana Kartı',
    description: 'Customer 360 yapısının kökü. Eşleştirme anahtarı VKN.',
    parentEntity: null,
    relationshipKeys: [],
    fields: ACCOUNT_FIELDS,
  },
  {
    entity: 'accountCompany',
    version: ACCOUNT_COMPANY_VERSION,
    label: 'İlişkili Şirket',
    description: 'Müşterinin Varuna şirket(ler)i ile bağı. Per-tenant kod, paket, segment.',
    parentEntity: 'account',
    relationshipKeys: ['accountKey'],
    fields: ACCOUNT_COMPANY_FIELDS,
  },
  {
    entity: 'accountContact',
    version: ACCOUNT_CONTACT_VERSION,
    label: 'İletişim Kişileri',
    description: 'Müşteriye bağlı iletişim kişileri.',
    parentEntity: 'account',
    relationshipKeys: ['accountKey'],
    fields: ACCOUNT_CONTACT_FIELDS,
  },
  {
    entity: 'accountAddress',
    version: ACCOUNT_ADDRESS_VERSION,
    label: 'Adresler',
    description: 'Country-agnostic adresler (ISO-2 normalize).',
    parentEntity: 'account',
    relationshipKeys: ['accountKey'],
    fields: ACCOUNT_ADDRESS_FIELDS,
  },
  {
    entity: 'accountProject',
    version: ACCOUNT_PROJECT_VERSION,
    label: 'Projeler',
    description: 'AccountCompany-scoped projeler. Proje doğrudan Account\'a bağlanmaz.',
    parentEntity: 'accountCompany',
    relationshipKeys: ['accountKey', 'accountCompanyKey'],
    fields: ACCOUNT_PROJECT_FIELDS,
  },
];

/**
 * Relationships graph (for UI).
 */
export const CUSTOMER_360_RELATIONSHIPS = [
  { from: 'account', to: 'accountCompany', key: 'accountKey' },
  { from: 'account', to: 'accountContact', key: 'accountKey' },
  { from: 'account', to: 'accountAddress', key: 'accountKey' },
  { from: 'accountCompany', to: 'accountProject', key: 'accountCompanyKey' },
];

/**
 * Matching rules summary (for UI; the actual matching happens in dryRun).
 */
export const CUSTOMER_360_MATCHING = {
  account: ['vkn', 'externalCustomerCode(secondary)'],
  accountCompany: ['accountKey + companyCode'],
  accountContact: ['accountKey + email', 'accountKey + phone(fallback)'],
  accountAddress: ['accountKey + type + label', 'accountKey + type + normalize(line1)(secondary)'],
  accountProject: ['accountCompanyKey + projectCode'],
};

const ENTITY_BY_KEY = new Map(CUSTOMER_360_ENTITIES.map((e) => [e.entity, e]));

export function getEntityDescriptor(entityKey) {
  return ENTITY_BY_KEY.get(entityKey) ?? null;
}

export function getEntityField(entityKey, fieldKey) {
  const e = ENTITY_BY_KEY.get(entityKey);
  if (!e) return null;
  return e.fields.find((f) => f.key === fieldKey) ?? null;
}

/**
 * Public describe — what the schema endpoint returns. No normalize functions
 * (those stay server-side); only metadata.
 */
export function describeCustomer360Schema() {
  return {
    target: 'customer360',
    version: CUSTOMER_360_VERSION,
    entities: CUSTOMER_360_ENTITIES.map((e) => ({
      entity: e.entity,
      version: e.version,
      label: e.label,
      description: e.description,
      parentEntity: e.parentEntity,
      relationshipKeys: e.relationshipKeys,
      fields: e.fields.map((f) => ({
        key: f.key,
        label: f.label,
        description: f.description,
        example: f.example ?? null,
        group: f.group,
        type: f.type,
        required: !!f.required,
        aliases: f.aliases,
        validationHint: f.validationHint ?? null,
        normalizationHint: f.normalizationHint ?? null,
        businessWarning: f.businessWarning ?? null,
        sensitive: !!f.sensitive,
        pii: !!f.pii,
        createAllowed: f.createAllowed !== false,
        updateAllowed: f.updateAllowed !== false,
        warningIfMissing: f.warningIfMissing ?? null,
      })),
    })),
    relationships: CUSTOMER_360_RELATIONSHIPS,
    matchingRules: CUSTOMER_360_MATCHING,
  };
}

/**
 * Auto-map source columns → target entity fields.
 * Returns { source, targetKey, confidence }[] for a specific entity.
 */
export function autoMapEntityColumns(entityKey, columnNames) {
  const e = ENTITY_BY_KEY.get(entityKey);
  if (!e) return [];
  const lower = columnNames.map((c) => ({ raw: c, key: String(c ?? '').trim().toLowerCase() }));
  const out = [];
  for (const col of lower) {
    if (!col.key) {
      out.push({ source: col.raw, targetKey: null, confidence: 0 });
      continue;
    }
    let best = null;
    for (const f of e.fields) {
      if (col.key === f.key.toLowerCase()) {
        best = { targetKey: f.key, confidence: 1.0 };
        break;
      }
      if (f.aliases.includes(col.key)) {
        if (!best || best.confidence < 0.9) best = { targetKey: f.key, confidence: 0.9 };
      }
    }
    out.push({ source: col.raw, targetKey: best?.targetKey ?? null, confidence: best?.confidence ?? 0 });
  }
  return out;
}

/**
 * Mapping validation per entity.
 */
export function validateEntityMapping(entityKey, mapping) {
  const e = ENTITY_BY_KEY.get(entityKey);
  if (!e) return { ok: false, errors: [{ code: 'unknown_entity', message: `Bilinmeyen entity: ${entityKey}` }], warnings: [] };
  const errors = [];
  const warnings = [];
  const targetCount = new Map();
  const keyIndex = new Map(e.fields.map((f) => [f.key, f]));
  for (const m of mapping) {
    if (!m.targetKey) continue;
    if (!keyIndex.has(m.targetKey)) {
      errors.push({ code: 'unknown_target', source: m.source, targetKey: m.targetKey });
      continue;
    }
    targetCount.set(m.targetKey, (targetCount.get(m.targetKey) ?? 0) + 1);
  }
  for (const [tk, n] of targetCount.entries()) {
    if (n > 1) {
      errors.push({ code: 'duplicate_target', targetKey: tk, message: `${keyIndex.get(tk).label} alanına birden fazla kaynak eşleştirildi.` });
    }
  }
  for (const f of e.fields) {
    if (f.required && !targetCount.has(f.key)) {
      errors.push({ code: 'required_unmapped', targetKey: f.key, message: `${f.label} alanı eşleştirilmeli.` });
    } else if (!targetCount.has(f.key) && f.warningIfMissing) {
      warnings.push({ code: f.warningIfMissing.code, targetKey: f.key, message: f.warningIfMissing.message });
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Normalize a single row for a given entity using the mapping. Returns
 * { normalized, errors, warnings } — no DB lookups; pure transformation.
 */
export function normalizeEntityRow(entityKey, rawRow, mapping) {
  const e = ENTITY_BY_KEY.get(entityKey);
  if (!e) return { normalized: {}, errors: [{ code: 'unknown_entity', message: entityKey }], warnings: [] };
  const keyIndex = new Map(e.fields.map((f) => [f.key, f]));
  const errors = [];
  const warnings = [];
  const normalized = {};
  for (const m of mapping) {
    if (!m.targetKey) continue;
    const f = keyIndex.get(m.targetKey);
    if (!f) continue;
    const r = f.normalize(rawRow[m.source]);
    if (!r.ok) {
      errors.push({ entity: entityKey, targetKey: f.key, label: f.label, message: r.reason });
      continue;
    }
    if (r.normalized !== null) {
      normalized[f.key] = r.normalized;
      if (r.extra?.rawPhone) normalized._rawPhone = r.extra.rawPhone;
    }
    if (r.warning) warnings.push({ entity: entityKey, targetKey: f.key, label: f.label, message: r.warning });
  }
  return { normalized, errors, warnings };
}

/**
 * TCKN guard — Privacy Guardrail #1: plain TCKN MUST NEVER be imported
 * from any source. Customer 360 registry does NOT declare a tckn field
 * for any entity; this helper inspects raw row to detect any column that
 * looks like a TCKN header and returns a structured guard error.
 */
const TCKN_HEADER_PATTERNS = [/^tckn$/i, /^tc kimlik/i, /^t\.c\.\s*kimlik/i, /^national id$/i, /^tckimlik/i, /^tckno$/i];
export function detectTcknHeader(columnNames) {
  return columnNames.filter((c) => TCKN_HEADER_PATTERNS.some((p) => p.test(String(c ?? '').trim())));
}
