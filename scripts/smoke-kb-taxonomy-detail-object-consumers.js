/**
 * smoke-kb-taxonomy-detail-object-consumers.js — statik guard.
 *
 * Bug: commit 124c9a6 (fix/kb-taxonomy-cascade-structure), data/cc-taxonomy-v2.json
 * içindeki close.kok_neden.groups[].details[] alanını düz string'ten
 * {label, cozum_tipleri} nesnesine çevirdi (categorizer-v2.ts'in
 * d.cozum_tipleri.join() çökmesini düzeltmek için). Bu, aynı details
 * dizisini düz string bekleyerek tüketen script'leri kırdı:
 *
 *  - scripts/seed-taxonomies-from-kb.js — emit()'e objeyi geçiriyordu,
 *    slugify() label.toLocaleLowerCase() çağırınca TypeError ile çöküyordu
 *    (rootCauseDetail taksonomisi hiç upsert edilemiyordu).
 *  - scripts/compare-taxonomy-xlsx.mjs — norm(obje) → "[object Object]",
 *    Kök Neden Detayı karşılaştırması sessizce anlamsızlaşıyordu.
 *  - scripts/merge-gold-examples.mjs — kokNedenDetayi setine ham nesneler
 *    giriyordu, normalize() aynı şekilde bozuluyordu.
 *
 * Fix: üçü de artık d.label okuyor (build-gold-from-reviews.mjs ve
 * server/kb/kbCore.js'teki ZATEN doğru olan desenle aynı).
 *
 * Çalıştır: node scripts/smoke-kb-taxonomy-detail-object-consumers.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function check(label, pattern, src) {
  const ok = pattern.test(src);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

const seed = readFileSync(path.resolve(root, 'scripts/seed-taxonomies-from-kb.js'), 'utf8');
const compare = readFileSync(path.resolve(root, 'scripts/compare-taxonomy-xlsx.mjs'), 'utf8');
const merge = readFileSync(path.resolve(root, 'scripts/merge-gold-examples.mjs'), 'utf8');

check(
  'seed-taxonomies-from-kb.js — rootCauseDetail artık d.label ile emit ediliyor',
  /for \(const d of g\.details \?\? \[\]\) emit\('rootCauseDetail', d\.label\);/,
  seed,
);
check(
  'compare-taxonomy-xlsx.mjs — Kök Neden Detayı seti artık d.label ile normalize ediliyor',
  /\(g\.details \?\? \[\]\)\.map\(\(d\) => norm\(d\.label\)\)/,
  compare,
);
check(
  'merge-gold-examples.mjs — kokNedenDetayi artık d.label listesi',
  /kokNedenDetayi: c\.kok_neden\.groups\.flatMap\(\(g\) => g\.details\.map\(\(d\) => d\.label\)\),/,
  merge,
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
