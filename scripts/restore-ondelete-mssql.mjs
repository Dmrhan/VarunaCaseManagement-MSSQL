/**
 * Faz 1'de tüm ilişkiler onDelete: NoAction yapılmıştı (MSSQL multiple
 * cascade path hatalarını aşmak için kaba çözüm). Bu script orijinal
 * şemadaki (main branch) onDelete davranışlarını geri uygular:
 *   - Cascade / SetNull → aynen geri
 *   - Restrict → NoAction (MSSQL'de Restrict yok; davranış eşdeğer)
 *   - onUpdate: NoAction her yerde korunur (ID'ler immutable; Postgres'in
 *     implicit onUpdate: Cascade'i MSSQL'de path çakışması yaratıyordu)
 *
 * Sonrasında `npx prisma validate` çakışan path'leri gösterir; o ilişkiler
 * elle NoAction'a çekilir (MSSQL'in gerçekten izin vermediği küme).
 *
 * Kullanım: git show main:prisma/schema.prisma > scripts/schema-original.tmp
 *           node scripts/restore-ondelete-mssql.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const orig = fs.readFileSync(path.join(root, 'scripts', 'schema-original.tmp'), 'utf8').replace(/\r\n/g, '\n');
const curPath = path.join(root, 'prisma', 'schema.prisma');
const cur = fs.readFileSync(curPath, 'utf8').replace(/\r\n/g, '\n');

// Orijinal: (model, fieldName) -> onDelete
const want = new Map();
{
  let model = null;
  for (const line of orig.split('\n')) {
    const mo = line.match(/^model\s+(\w+)\s*\{/);
    if (mo) model = mo[1];
    if (/^\}/.test(line)) model = null;
    if (!model) continue;
    const fm = line.match(/^\s{2}(\w+)\s+\w+\??\s+.*@relation\(([^)]*)\)/);
    if (!fm || !/fields\s*:/.test(fm[2])) continue;
    const od = fm[2].match(/onDelete:\s*(\w+)/)?.[1] ?? 'implicit';
    want.set(`${model}.${fm[1]}`, od);
  }
}

const RESTORE = { Cascade: 'Cascade', SetNull: 'SetNull', Restrict: 'NoAction', NoAction: 'NoAction' };

let changed = 0;
let model = null;
const out = cur.split('\n').map((line) => {
  const mo = line.match(/^model\s+(\w+)\s*\{/);
  if (mo) model = mo[1];
  if (/^\}/.test(line)) model = null;
  if (!model) return line;
  const fm = line.match(/^\s{2}(\w+)\s+\w+\??\s+.*@relation\(/);
  if (!fm) return line;
  const key = `${model}.${fm[1]}`;
  const origOd = want.get(key);
  if (!origOd || origOd === 'implicit') return line; // implicit'ler NoAction kalır
  const target = RESTORE[origOd];
  if (!target || target === 'NoAction') return line;
  const updated = line.replace(/onDelete:\s*NoAction/, `onDelete: ${target}`);
  if (updated !== line) {
    changed++;
    console.log(`${key}: NoAction -> ${target}`);
  }
  return updated;
});

fs.writeFileSync(curPath, out.join('\n'), 'utf8');
console.log(`done. restored: ${changed}`);
