/**
 * Pass 3: yorum içine kaçan @db.NVarChar eklerini kod tarafına taşır.
 * (Pass 1, satır sonunda `//` yorumu olan alanlarda eki yorumdan sonraya
 * eklemişti; Prisma bunu yorum sayar.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'prisma', 'schema.prisma');
const lines = fs.readFileSync(schemaPath, 'utf8').replace(/\r\n/g, '\n').split('\n');

let fixed = 0;
for (let n = 0; n < lines.length; n++) {
  const line = lines[n];
  const idx = line.indexOf('//');
  if (idx < 0) continue;
  const comment = line.slice(idx);
  const m = comment.match(/@db\.NVarChar\((?:\d+|Max)\)/);
  if (!m) continue;
  const code = line.slice(0, idx).trimEnd();
  const cleanedComment = comment.replace(m[0], '').replace(/\s+$/, '').replace(/\s{2,}/g, ' ');
  lines[n] = `${code} ${m[0]} ${cleanedComment}`.trimEnd();
  fixed++;
  console.log(`fixed: ${lines[n].trim()}`);
}

fs.writeFileSync(schemaPath, lines.join('\n'), 'utf8');
console.log(`done. fixed lines: ${fixed}`);
