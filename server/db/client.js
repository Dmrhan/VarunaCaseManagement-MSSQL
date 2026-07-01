import { PrismaClient } from '@prisma/client';
import { JSON_FIELD_MAP } from './jsonFieldMap.js';

/**
 * Prisma client singleton + MSSQL Json köprüsü.
 *
 * Prisma'nın sqlserver connector'ı Json tipini desteklemez; eski Json alanlar
 * şemada String (nvarchar(max)) oldu. Bu extension Postgres dönemindeki
 * davranışı korur:
 *  - WRITE: create/update/upsert/createMany data'sındaki json alanlara obje
 *    gelirse JSON.stringify edilir (nested write'lar dahil — ilişki ağacı
 *    JSON_FIELD_MAP.relations üzerinden yürünür).
 *  - READ: sonuçlardaki json alanlar JSON.parse ile objeye çevrilir
 *    (result extension; include edilen ilişkilerde de çalışır).
 *
 * Repository kodu böylece Postgres'teki gibi obje okur/yazar.
 * NOT: $queryRaw sonuçlarına dokunulmaz. Şemaya Json alan eklenirse
 * `node scripts/generate-json-field-map.mjs` yeniden çalıştırılmalı.
 */

const WRITE_OPS = new Set(['create', 'update', 'upsert', 'createMany', 'createManyAndReturn', 'updateMany']);

// Nested write düğümlerinde ilişki altında görülebilecek operasyon anahtarları
const NESTED_WRITE_KEYS = ['create', 'update', 'upsert', 'createMany', 'connectOrCreate', 'updateMany', 'set'];

function stringifyValue(v) {
  if (v === null || v === undefined || typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** data objesini (tek kayıt) model bazında dönüştürür; nested ilişkilere iner. */
function transformData(model, data) {
  if (data == null || typeof data !== 'object') return;
  const def = JSON_FIELD_MAP[model];
  if (!def) return;

  for (const [key, value] of Object.entries(data)) {
    if (def.json.includes(key)) {
      // update'te { set: value } sarmalayıcısı da olabilir
      if (value && typeof value === 'object' && !Array.isArray(value) && 'set' in value && Object.keys(value).length === 1) {
        value.set = stringifyValue(value.set);
      } else {
        data[key] = stringifyValue(value);
      }
      continue;
    }
    const targetModel = def.relations[key];
    if (targetModel && value && typeof value === 'object') {
      for (const opKey of NESTED_WRITE_KEYS) {
        const nested = value[opKey];
        if (!nested) continue;
        if (opKey === 'createMany') {
          const rows = Array.isArray(nested.data) ? nested.data : [nested.data];
          rows.forEach((row) => transformData(targetModel, row));
        } else if (opKey === 'connectOrCreate') {
          (Array.isArray(nested) ? nested : [nested]).forEach((n) => transformData(targetModel, n?.create));
        } else if (opKey === 'upsert') {
          (Array.isArray(nested) ? nested : [nested]).forEach((n) => {
            transformData(targetModel, n?.create);
            transformData(targetModel, n?.update);
          });
        } else if (opKey === 'update') {
          (Array.isArray(nested) ? nested : [nested]).forEach((n) => {
            // to-many: { where, data }; to-one: doğrudan data objesi
            transformData(targetModel, n && typeof n === 'object' && 'data' in n ? n.data : n);
          });
        } else {
          (Array.isArray(nested) ? nested : [nested]).forEach((n) => transformData(targetModel, n));
        }
      }
    }
  }
}

function transformWriteArgs(model, operation, args) {
  if (!args) return;
  if (operation === 'upsert') {
    transformData(model, args.create);
    transformData(model, args.update);
    return;
  }
  const data = args.data;
  if (Array.isArray(data)) data.forEach((row) => transformData(model, row));
  else transformData(model, data);
}

function parseValue(v) {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v; // bozuk içerik: ham string dön (Postgres'te oluşamazdı; savunma)
  }
}

const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// READ tarafı: her json alan için result extension (include'larda da uygulanır)
const resultConfig = {};
for (const [model, def] of Object.entries(JSON_FIELD_MAP)) {
  if (!def.json.length) continue;
  resultConfig[lcFirst(model)] = Object.fromEntries(
    def.json.map((field) => [
      field,
      { needs: { [field]: true }, compute: (row) => parseValue(row[field]) },
    ]),
  );
}

// Codex P2 (round 1) — Case.caseSeq BigInt → Number.
// Prisma sqlserver connector BIGINT alanları JS `bigint` primitive döner.
// Express `res.json` (`JSON.stringify`) `bigint` serialize edemez →
// "TypeError: Do not know how to serialize a BigInt" → 500. Case.caseSeq
// case list/detail path'lerinde `CASE_INCLUDE` üstünden döner, response'a
// spread edilir. Extension level dönüşüm tüm read path'lerinde otomatik.
// Güvenlik: caseSeq 1000000'dan başlar, per-tenant, 2^53'e ulaşana kadar
// tenant başına 9,007,199,253,740,992 vaka gerekir → pratik olarak sonsuz.
resultConfig.case = {
  ...(resultConfig.case ?? {}),
  caseSeq: {
    needs: { caseSeq: true },
    compute: (row) => (row.caseSeq == null ? null : Number(row.caseSeq)),
  },
};

function buildClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  });
  return base.$extends({
    name: 'mssql-json-bridge',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (WRITE_OPS.has(operation)) transformWriteArgs(model, operation, args);
          return query(args);
        },
      },
    },
    result: resultConfig,
  });
}

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.__prisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}
