/**
 * Pass 2: SQL Server kısıtları (Faz 1).
 *
 * - Tüm FK ilişkileri onDelete/onUpdate: NoAction olur (MSSQL "multiple
 *   cascade paths" kısıtı; silme zincirleri uygulama katmanına taşınır).
 * - @@index / @@unique / @unique içinde geçen NVarChar(Max) kolonlar
 *   NVarChar(255)'e indirilir (MSSQL max kolonu index'leyemez).
 *
 * Kullanım: node scripts/convert-schema-mssql-pass2.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'prisma', 'schema.prisma');
let src = fs.readFileSync(schemaPath, 'utf8').replace(/\r\n/g, '\n');

// --- 1) Tüm @relation(... fields: ...) → onDelete/onUpdate NoAction
src = src.replace(/@relation\(([^)]*)\)/g, (m, inner) => {
  if (!/fields\s*:/.test(inner)) return m; // sadece FK tarafı
  let i = inner
    .replace(/,?\s*onDelete\s*:\s*\w+/g, '')
    .replace(/,?\s*onUpdate\s*:\s*\w+/g, '')
    .trim()
    .replace(/,\s*$/, '');
  return `@relation(${i}, onDelete: NoAction, onUpdate: NoAction)`;
});

// --- 2) Index'lenen Max kolonları sınırla
const lines = src.split('\n');
let currentModel = null;
const modelStart = new Map();
const indexedFields = new Map(); // model -> Set(field)

for (let n = 0; n < lines.length; n++) {
  const line = lines[n];
  const mo = line.match(/^model\s+(\w+)\s*\{/);
  if (mo) { currentModel = mo[1]; indexedFields.set(currentModel, new Set()); modelStart.set(currentModel, n); }
  if (/^\}/.test(line)) currentModel = null;
  if (!currentModel) continue;

  const blockAttr = line.match(/@@(?:index|unique)\(\[([^\]]+)\]/);
  if (blockAttr) {
    for (const f of blockAttr[1].split(',')) {
      indexedFields.get(currentModel).add(f.trim().split('(')[0]);
    }
  }
  const fieldUnique = line.match(/^\s{2}(\w+)\s+\w+.*@unique/);
  if (fieldUnique) indexedFields.get(currentModel).add(fieldUnique[1]);
}

currentModel = null;
let bounded = 0;
for (let n = 0; n < lines.length; n++) {
  const mo = lines[n].match(/^model\s+(\w+)\s*\{/);
  if (mo) currentModel = mo[1];
  if (/^\}/.test(lines[n])) currentModel = null;
  if (!currentModel) continue;

  const fm = lines[n].match(/^\s{2}(\w+)\s+String/);
  if (fm && indexedFields.get(currentModel)?.has(fm[1]) && /@db\.NVarChar\(Max\)/.test(lines[n])) {
    lines[n] = lines[n].replace('@db.NVarChar(Max)', '@db.NVarChar(255)');
    bounded++;
    console.log(`bounded: ${currentModel}.${fm[1]} -> NVarChar(255)`);
  }
}

fs.writeFileSync(schemaPath, lines.join('\n'), 'utf8');
console.log(`done. bounded fields: ${bounded}`);
