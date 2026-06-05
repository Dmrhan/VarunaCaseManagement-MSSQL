/**
 * Customer 360 — Server-side XLSX parser (Phase B large-file dry-run).
 *
 * Frontend büyük workbook'u (>1.7 MB parse sonrası JSON) sync dry-run
 * endpoint'ine yollayamadığı için (413), bu modül sunucu tarafında ham
 * XLSX'i okuyup CUSTOMER_360 bundle'ı üretir. Dry-run engine
 * (server/lib/import/customer360DryRun.js) bundle'ı oldugu gibi tüketir.
 *
 * KAPSAM (bilinçli daraltılmış):
 *  - Sadece STANDART Customer 360 şablonu sheet'leri:
 *      account, accountCompany, accountContact, accountAddress, accountProject
 *    (TR + EN sheet name alias'ları desteklenir.)
 *  - Legacy preset (Genel / Genel Tekil / Detaylar) sunucu tarafı için
 *    YOK; tespit edilirse structured error döner. Bu kısıt task spec'i
 *    gereği bilinçli: frontend parser legacy/custom path için kullanılır,
 *    server path yalnız standart şablon içindir.
 *
 * Hücre seviyesi normalize parsers.ts'teki passthroughRows ile aynıdır:
 *   - "NULL"/"-"/whitespace → ''
 *   - trim
 *   - "33652.0" → "33652" (ID-shaped sayısallar için float-tail kırpma)
 *
 * Geriye dönen bundle shape: parsers.ts → Customer360Bundle ile birebir
 * uyumlu. Dolayısıyla dryRunCustomer360 engine değiştirilmeden çağrılır.
 */

import * as XLSX from 'xlsx';

export const CUSTOMER_360_ENTITY_KEYS = [
  'account',
  'accountCompany',
  'accountContact',
  'accountAddress',
  'accountProject',
];

/**
 * Sheet name → entity key alias map. parsers.ts SHEET_ALIASES'ın server
 * tarafındaki minimal kopyası. Yalnız standart şablon ve yaygın TR/EN
 * alias'lar. Legacy/custom değil.
 */
const SHEET_ALIASES = {
  accounts: 'account',
  account: 'account',
  'müşteri ana kartı': 'account',
  'musteri ana karti': 'account',
  müşteriler: 'account',
  musteriler: 'account',

  companies: 'accountCompany',
  accountcompanies: 'accountCompany',
  accountcompany: 'accountCompany',
  'ilişkili şirket': 'accountCompany',
  'iliskili sirket': 'accountCompany',
  şirketler: 'accountCompany',
  sirketler: 'accountCompany',

  contacts: 'accountContact',
  accountcontacts: 'accountContact',
  'iletişim kişileri': 'accountContact',
  'iletisim kisileri': 'accountContact',
  iletişimler: 'accountContact',
  iletisimler: 'accountContact',

  addresses: 'accountAddress',
  accountaddresses: 'accountAddress',
  adresler: 'accountAddress',

  projects: 'accountProject',
  accountprojects: 'accountProject',
  projeler: 'accountProject',
};

/** Legacy sheet'leri tespit edip net hata mesajı dönmek için. */
const LEGACY_SHEET_NORMALIZED = new Set([
  'genel',
  'genel tekil',
  'genel-tekil',
  'genel_tekil',
  'detaylar',
  'detay',
]);

function normalizeHeaderName(s) {
  if (s == null) return '';
  // Sadece tr-TR locale lower + whitespace squash. NFD ile decompose
  // ETMİYORUZ — alias map key'leri NFC; NFD ardından bytes farklı çıkar.
  // tr-TR lowercase "İ" → "i", "I" → "ı"; diğer Türkçe harfler birebir.
  return String(s)
    .toLocaleLowerCase('tr-TR')
    .trim()
    .replace(/\s+/g, ' ');
}

function mapSheetNameToEntity(sheetName) {
  const norm = normalizeHeaderName(sheetName);
  return SHEET_ALIASES[norm] ?? null;
}

function isLegacySheet(sheetName) {
  return LEGACY_SHEET_NORMALIZED.has(normalizeHeaderName(sheetName));
}

/**
 * Hücre normalize — parsers.ts'teki passthroughRows ile birebir.
 * cell value → string|null:
 *   - undefined/null/'' → ''
 *   - 'NULL', '-', whitespace → ''
 *   - "33652.0" → "33652" (string olarak gelen float-tail)
 *   - diğer durumlar trim'lenmiş string
 */
function normalizeCell(value) {
  if (value === undefined || value === null) return '';
  const s = String(value).trim();
  if (s === '' || s === '-' || /^null$/i.test(s)) return '';
  // ID-shape: rakamlardan oluşan ve ".0" ile biten string'ler (xlsx parse
  // bazen integer'ları "33652.0" olarak verir). Sadece tamsayı + ".0".
  if (/^\d+\.0+$/.test(s)) return s.replace(/\.0+$/, '');
  return s;
}

function passthroughRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = normalizeCell(v);
  }
  return out;
}

/**
 * @typedef {Object} ParserError
 * @property {string} code
 * @property {string} message
 * @property {*} [meta]
 */

/**
 * @param {Buffer|Uint8Array} buffer
 * @param {{ rowCaps?: Record<string, number> }} [opts]
 * @returns {{ ok: true, bundle: object, info: object } | { ok: false, error: ParserError }}
 */
export function parseCustomer360Workbook(buffer, opts = {}) {
  if (!buffer || (typeof buffer.length !== 'number' && typeof buffer.byteLength !== 'number')) {
    return { ok: false, error: { code: 'invalid_buffer', message: 'Dosya okunamadı.' } };
  }
  const rowCaps = {
    account: 5000,
    accountCompany: 10000,
    accountContact: 10000,
    accountAddress: 10000,
    accountProject: 10000,
    ...(opts.rowCaps ?? {}),
  };

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'invalid_workbook',
        message: 'Geçersiz XLSX dosyası. Workbook açılamadı.',
        meta: { reason: err?.message ?? String(err) },
      },
    };
  }
  if (!workbook?.SheetNames?.length) {
    return {
      ok: false,
      error: { code: 'empty_workbook', message: 'Workbook boş veya sheet bulunamadı.' },
    };
  }

  // Legacy detect → net hata; client-side small-flow'a yönlendir.
  const legacySheets = workbook.SheetNames.filter(isLegacySheet);
  if (legacySheets.length > 0) {
    return {
      ok: false,
      error: {
        code: 'unsupported_legacy_layout',
        message:
          'Büyük dosya modu yalnız standart Customer 360 şablonu için desteklenir. Bu workbook eski (Genel / Genel Tekil / Detaylar) düzenindedir.',
        meta: { legacySheets },
      },
    };
  }

  // Sheet → entity bağla.
  const mapped = [];
  const unmapped = [];
  for (const sheetName of workbook.SheetNames) {
    const entity = mapSheetNameToEntity(sheetName);
    if (entity) {
      mapped.push({ sheetName, entity });
    } else {
      unmapped.push(sheetName);
    }
  }

  if (mapped.length === 0) {
    return {
      ok: false,
      error: {
        code: 'no_recognized_sheet',
        message:
          'Workbook içinde tanınabilen standart Customer 360 sheet bulunamadı. ' +
          'Sheet adlarının Müşteri Ana Kartı / İlişkili Şirket / İletişim Kişileri / Adresler / Projeler ' +
          '(veya Accounts / Companies / Contacts / Addresses / Projects) olduğundan emin olun.',
        meta: { unmappedSheets: unmapped, knownAliases: Object.keys(SHEET_ALIASES) },
      },
    };
  }

  // Account sheet zorunlu.
  const hasAccount = mapped.some((m) => m.entity === 'account');
  if (!hasAccount) {
    return {
      ok: false,
      error: {
        code: 'missing_required_sheet',
        message: 'Müşteri Ana Kartı (account) sheet zorunlu; workbook içinde bulunamadı.',
        meta: { foundEntities: mapped.map((m) => m.entity) },
      },
    };
  }

  // Bundle inşa.
  const bundle = {};
  for (const k of CUSTOMER_360_ENTITY_KEYS) {
    bundle[k] = { columns: [], rows: [], sample: [], totalRows: 0 };
  }
  const acc = {
    account: { rows: [], columnSet: new Set() },
    accountCompany: { rows: [], columnSet: new Set() },
    accountContact: { rows: [], columnSet: new Set() },
    accountAddress: { rows: [], columnSet: new Set() },
    accountProject: { rows: [], columnSet: new Set() },
  };
  const perEntityOverflow = [];

  for (const { sheetName, entity } of mapped) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    // defval: '' → boş hücreler de görünsün; raw:false → tarih/sayı stringe.
    const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    for (const r of rawRows) {
      const normalized = passthroughRow(r);
      acc[entity].rows.push(normalized);
      for (const c of Object.keys(normalized)) acc[entity].columnSet.add(c);
    }
  }

  for (const entity of CUSTOMER_360_ENTITY_KEYS) {
    const a = acc[entity];
    const max = rowCaps[entity] ?? 5000;
    if (a.rows.length > max) {
      perEntityOverflow.push({ entity, count: a.rows.length, max });
    }
    if (a.rows.length === 0) continue;
    bundle[entity] = {
      columns: [...a.columnSet],
      rows: a.rows,
      sample: a.rows.slice(0, 5),
      totalRows: a.rows.length,
    };
  }

  if (perEntityOverflow.length > 0) {
    return {
      ok: false,
      error: {
        code: 'row_cap_exceeded',
        message:
          'Bir veya daha fazla sheet için izin verilen satır üst sınırı aşıldı. ' +
          'Sunucu tarafı dry-run bu kapsamla 5k account / 10k çocuk entity satırına kadar destekler.',
        meta: { perEntityOverflow },
      },
    };
  }

  return {
    ok: true,
    bundle,
    info: {
      mappedSheets: mapped,
      unmappedSheets: unmapped,
      perEntityCounts: Object.fromEntries(
        CUSTOMER_360_ENTITY_KEYS.map((k) => [k, bundle[k].totalRows]),
      ),
    },
  };
}

/** Internal helpers exported for unit smoke. */
export const __testing__ = {
  normalizeHeaderName,
  mapSheetNameToEntity,
  isLegacySheet,
  normalizeCell,
};
