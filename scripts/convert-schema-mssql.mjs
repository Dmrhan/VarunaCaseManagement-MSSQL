/**
 * One-shot schema converter: Postgres → SQL Server (Faz 1).
 *
 * - provider "postgresql" → "sqlserver", directUrl kaldırılır
 * - enum blokları silinir; enum tipli alanlar String'e döner,
 *   @default(EnumValue) → @default("EnumValue")
 * - Json → String (NVarChar ile)
 * - @db.Text → @db.NVarChar(Max)
 * - @default(now()) → @default(dbgenerated("sysutcdatetime()")) (UTC korunur)
 * - String alan uzunlukları canlı DB'den (scripts/mssql-columns.csv) alınır;
 *   DB'de olmayan alanlar için heuristik: id/*Id → 450, enum → 50, diğer → Max
 *
 * Kullanım: node scripts/convert-schema-mssql.mjs
 * Çıktı: prisma/schema.prisma üzerine yazar (git diff ile incelenir).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'prisma', 'schema.prisma');
const csvPath = path.join(root, 'scripts', 'mssql-columns.csv');

let src = fs.readFileSync(schemaPath, 'utf8').replace(/\r\n/g, '\n');

// --- Canlı DB kolon uzunlukları: "Table,Column,type,len"
const dbLen = new Map();
for (const line of fs.readFileSync(csvPath, 'utf8').split(/\r?\n/)) {
  const parts = line.trim().split(',');
  if (parts.length !== 4) continue;
  const [table, col, dtype, len] = parts;
  if (dtype === 'nvarchar' || dtype === 'varchar') {
    dbLen.set(`${table}.${col}`, parseInt(len, 10)); // -1 = max
  }
}

// --- Enum bloklarını topla ve sil
const enums = new Map(); // name -> [values (ascii identifiers)]
src = src.replace(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}\n?/gm, (_m, name, body) => {
  const values = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const ident = line.split(/\s+/)[0];
    if (ident) values.push(ident);
  }
  enums.set(name, values);
  return '';
});

// --- Datasource bloğu
src = src.replace(
  /datasource db \{[\s\S]*?\n\}/,
  `datasource db {
  provider = "sqlserver"
  url      = env("DATABASE_URL")
}`
);

// --- Model alanlarını dönüştür
const lines = src.split('\n');
let currentModel = null;
const out = [];
const enumFieldDoc = []; // dokümantasyon için: model.field -> enum values

for (let line of lines) {
  const modelOpen = line.match(/^model\s+(\w+)\s*\{/);
  if (modelOpen) currentModel = modelOpen[1];
  if (/^\}/.test(line)) currentModel = null;

  const fieldMatch = currentModel &&
    line.match(/^(\s{2})(\w+)(\s+)(\w+)(\?|\[\])?(.*)$/);

  if (fieldMatch && !line.trim().startsWith('//') && !line.trim().startsWith('@@')) {
    const [, indent, fname, gap, ftype, optional, restRaw] = fieldMatch;
    let rest = restRaw;
    const key = `${currentModel}.${fname}`;

    const applyLen = (fallback) => {
      if (/@db\./.test(rest)) return ''; // zaten native tip var
      const len = dbLen.has(key) ? dbLen.get(key) : fallback;
      if (len === undefined || len === null) return '';
      return len === -1 || len === 'Max'
        ? ' @db.NVarChar(Max)'
        : ` @db.NVarChar(${len})`;
    };

    if (enums.has(ftype)) {
      // enum → String + değer dokümantasyonu
      const values = enums.get(ftype);
      rest = rest.replace(/@default\((\w+)\)/, '@default("$1")');
      const ann = applyLen(50);
      enumFieldDoc.push({ model: currentModel, field: fname, enumName: ftype, values });
      line = `${indent}${fname}${gap}String${optional ?? ''}${rest}${ann} // enum:${ftype}`;
    } else if (ftype === 'Json') {
      const ann = applyLen(-1);
      line = `${indent}${fname}${gap}String${optional ?? ''}${rest}${ann} // json`;
    } else if (ftype === 'String') {
      rest = rest.replace(/@db\.Text/, '@db.NVarChar(Max)');
      let ann = '';
      if (!/@db\./.test(rest)) {
        const isIdLike = fname === 'id' || /Id$/.test(fname);
        ann = applyLen(isIdLike ? 450 : -1);
      }
      line = `${indent}${fname}${gap}String${optional ?? ''}${rest}${ann}`;
    }

    // now() → sysutcdatetime() (DB tarafında UTC default)
    line = line.replace(/@default\(now\(\)\)/, '@default(dbgenerated("sysutcdatetime()"))');
  }

  out.push(line);
}

src = out.join('\n').replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(schemaPath, src, 'utf8');

// Enum değer setlerini app-layer validation için JSON olarak da yaz
const docPath = path.join(root, 'prisma', 'enum-values.json');
const docObj = {};
for (const [name, values] of enums) docObj[name] = values;
fs.writeFileSync(docPath, JSON.stringify(docObj, null, 2), 'utf8');

console.log(`enums removed: ${enums.size}`);
console.log(`enum fields converted: ${enumFieldDoc.length}`);
console.log(`db columns mapped: ${dbLen.size}`);
