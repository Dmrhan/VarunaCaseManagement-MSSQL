/**
 * prisma/schema.prisma'daki `// json` işaretli alanlardan ve model
 * ilişkilerinden server/db/jsonFieldMap.js dosyasını üretir.
 *
 * Şemada Json alan ekleyince/kaldırınca yeniden çalıştır:
 *   node scripts/generate-json-field-map.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = fs
  .readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8')
  .replace(/\r\n/g, '\n');

// Model adlarını topla
const modelNames = new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));

const map = {};
let currentModel = null;
for (const line of schema.split('\n')) {
  const mo = line.match(/^model\s+(\w+)\s*\{/);
  if (mo) {
    currentModel = mo[1];
    map[currentModel] = { json: [], relations: {} };
    continue;
  }
  if (/^\}/.test(line)) { currentModel = null; continue; }
  if (!currentModel) continue;

  const fm = line.match(/^\s{2}(\w+)\s+(\w+)(\?|\[\])?/);
  if (!fm) continue;
  const [, fname, ftype] = fm;

  if (/\/\/\s*json\b/.test(line)) map[currentModel].json.push(fname);
  else if (modelNames.has(ftype)) map[currentModel].relations[fname] = ftype;
}

// Boş modelleri eleme — relations yine gerekli (nested write yürüyüşü için)
const out = `/**
 * OTOMATİK ÜRETİLDİ — elle düzenleme; kaynak: prisma/schema.prisma
 * Yeniden üretmek için: node scripts/generate-json-field-map.mjs
 *
 * MSSQL'de Prisma Json tipi yok; eski Json alanlar String (nvarchar(max)).
 * Bu harita client.js'teki extension'a hangi alanların JSON.parse/stringify
 * edileceğini ve nested write'larda hangi ilişkiden hangi modele
 * geçildiğini söyler.
 */
export const JSON_FIELD_MAP = ${JSON.stringify(map, null, 2)};
`;

fs.writeFileSync(path.join(root, 'server', 'db', 'jsonFieldMap.js'), out, 'utf8');

const jsonCount = Object.values(map).reduce((a, m) => a + m.json.length, 0);
console.log(`models: ${Object.keys(map).length}, json fields: ${jsonCount}`);
for (const [m, def] of Object.entries(map)) {
  if (def.json.length) console.log(`  ${m}: ${def.json.join(', ')}`);
}
