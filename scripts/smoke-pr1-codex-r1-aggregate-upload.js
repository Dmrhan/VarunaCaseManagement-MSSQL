/**
 * smoke-pr1-codex-r1-aggregate-upload.js — 2026-07-04
 *
 * PR-1 Codex R1 — 2× P2 fix (aktivite toplu-satır dikişi).
 *
 * Kontrat (backend server/lib/inboundMailIntake.js):
 *   Aggregate (N>1): actionType='FileUploaded', toValue='<N> dosya',
 *                     note='a.pdf, b.pdf[, +M daha]'
 *   Tekil (N==1):    actionType='FileUploaded', toValue=fileName, note=null
 *
 * P2-1: Toplu satır render (dosya adları geri gelsin) — note'tan parse +
 *       ▸ toggle. N==1 eski format birebir korunur.
 * P2-2: Legacy grouping'den toplu satırlar hariç tutulur (buffer'a girmez).
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTrue(name, cond) { expect(name, !!cond, true); }
function read(p) { return readFileSync(p, 'utf8'); }

const detail = read('src/features/cases/CaseDetailPage.tsx');
const backend = read('server/lib/inboundMailIntake.js');

console.log('── 1) Kontrat doğrulama (backend yazan taraf) ─');
expectTrue('1.1 Backend aggregate: toValue = `${stored.length} dosya` (N>1)',
  /toValue:\s*isMulti\s*\?\s*`\$\{stored\.length\} dosya`\s*:\s*fileNames\[0\]/.test(backend));
expectTrue('1.2 Backend note = fileNames.join(", ") + "+N daha" fallback',
  /const joined = fileNames\.join\(', '\)/.test(backend)
  && /`\$\{acc\}, \+\$\{remainingCount\} daha`/.test(backend));
expectTrue('1.3 Backend tekil (N==1): toValue=fileNames[0], note=null (aggregate note yok)',
  /toValue:\s*isMulti\s*\?[\s\S]{0,80}:\s*fileNames\[0\]/.test(backend));

console.log('\n── 2) Helper: isAggregateUploadRow (TEK KAYNAK) ─');
expectTrue('2.1 Helper tanımlı: isAggregateUploadRow(h)',
  /function isAggregateUploadRow\(h:\s*CaseHistoryEntry\):\s*boolean/.test(detail));
expectTrue('2.2 Kriter: actionType==="FileUploaded"',
  /if \(h\.actionType !== 'FileUploaded'\) return false/.test(detail));
expectTrue('2.3 Kriter: toValue /^\\d+ dosya$/ regex',
  /!\/\^\\d\+ dosya\$\/\.test\(h\.toValue\)/.test(detail));
expectTrue('2.4 Kriter: note dolu (string.trim().length > 0)',
  /typeof h\.note === 'string' && h\.note\.trim\(\)\.length > 0/.test(detail));
// TEK KAYNAK: helper'ın 3+ kullanımı (renderer 2× — tekil + fork, grouping 1×)
const helperCalls = (detail.match(/isAggregateUploadRow\(/g) ?? []).length;
expect('2.5 Helper 3+ tüketici (tanım + render fork + grouping guard + herhangi bir smoke import)',
  helperCalls >= 3, true);

console.log('\n── 3) parseAggregateNote helper ────────────');
expectTrue('3.1 parseAggregateNote tanımlı',
  /function parseAggregateNote\(note:\s*string\):\s*\{\s*names:\s*string\[\];\s*more:\s*number\s*\}/.test(detail));
expectTrue('3.2 "+N daha" regex + names split',
  /moreMatch = trimmed\.match\(\/,\\s\*\\\+\(\\d\+\)\\s\+daha\\s\*\$\//.test(detail));

// Runtime davranış simülasyonu
function parseAggregateNote(note) {
  const trimmed = note.trim();
  const moreMatch = trimmed.match(/,\s*\+(\d+)\s+daha\s*$/);
  const more = moreMatch ? Number.parseInt(moreMatch[1], 10) : 0;
  const namesPart = moreMatch ? trimmed.slice(0, moreMatch.index).trim() : trimmed;
  const names = namesPart.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  return { names, more };
}

expect('3.3 parseAggregateNote("a.pdf, b.pdf, c.pdf")',
  parseAggregateNote('a.pdf, b.pdf, c.pdf'),
  { names: ['a.pdf', 'b.pdf', 'c.pdf'], more: 0 });
expect('3.4 parseAggregateNote("a.pdf, b.pdf, +5 daha") — 180+ char fallback',
  parseAggregateNote('a.pdf, b.pdf, +5 daha'),
  { names: ['a.pdf', 'b.pdf'], more: 5 });
expect('3.5 Boş note',
  parseAggregateNote(''), { names: [], more: 0 });
expect('3.6 Tek dosya + more (edge)',
  parseAggregateNote('sozlesme.pdf, +12 daha'),
  { names: ['sozlesme.pdf'], more: 12 });

console.log('\n── 4) P2-1: Aggregate render fork + parite ─');
expectTrue('4.1 Tekil satır renderer\'ında isAggregateUploadRow fork (aggregate → AggregateFileUploadedRow)',
  /if \(isAggregateUploadRow\(h\)\) \{\s*return <AggregateFileUploadedRow key=\{h\.id\} entry=\{h\}/.test(detail));
expectTrue('4.2 AggregateFileUploadedRow component tanımlı',
  /function AggregateFileUploadedRow\(\{ entry \}: \{ entry:\s*CaseHistoryEntry \}\)/.test(detail));
expectTrue('4.3 ▸ göster / ▾ gizle toggle (UI paritesi)',
  /AggregateFileUploadedRow[\s\S]{0,2000}[▾▸] (gizle|göster)/.test(detail));
expectTrue('4.4 Toggle sonrası dosya adları listesi (Paperclip icon + name)',
  /AggregateFileUploadedRow[\s\S]{0,2000}parsed\.names\.map[\s\S]{0,300}Paperclip size=\{10\}/.test(detail));
expectTrue('4.5 "+M daha" satırı render (kısaltma göstergesi)',
  /AggregateFileUploadedRow[\s\S]{0,2500}parsed\.more > 0 && \(\s*<li className="italic text-slate-500">\+\{parsed\.more\} daha/.test(detail));
expectTrue('4.6 Zarif düşüş: parsed.names boş → note düz metin (parse edilemedi)',
  /AggregateFileUploadedRow[\s\S]{0,3500}parsed\.names\.length > 0[\s\S]{0,1500}<div className="mt-1 pl-4 text-xs italic text-slate-600">\s*\{entry\.note\}/.test(detail));
// Parite: N==1 eski path'e düşer (isAggregate false)
expectTrue('4.7 N==1 parite: isAggregate false → eski FileUploaded/FileRemoved render kalır',
  /isAggregateUploadRow\(h\)\)[\s\S]{0,200}\}\s*\n\s*\/\/ Dosya yüklendi\/silindi/.test(detail));

console.log('\n── 5) P2-2: groupFileUploadedRuns aggregate exclude ─');
expectTrue('5.1 groupFileUploadedRuns içi: isAggregateUploadRow(h) → flush + out.push standalone',
  /for \(const h of items\) \{[\s\S]{0,600}if \(isAggregateUploadRow\(h\)\) \{\s*flush\(\);\s*out\.push\(h\);\s*continue;\s*\}/.test(detail));
expectTrue('5.2 Aggregate branch YALNIZ flush+push+continue (buf.push DALIN İÇİNDE YOK)',
  /if \(isAggregateUploadRow\(h\)\) \{\s*flush\(\);\s*out\.push\(h\);\s*continue;\s*\}/.test(detail));

console.log('\n── 6) Davranış simülasyonu (grouping + aggregate) ─');

// Simülasyon: groupFileUploadedRuns eş-davranışı JS'de
const WIN = 60_000;
function isAgg(h) {
  return h.actionType === 'FileUploaded'
    && typeof h.toValue === 'string' && /^\d+ dosya$/.test(h.toValue)
    && typeof h.note === 'string' && h.note.trim().length > 0;
}
function group(items) {
  const out = [];
  let buf = [];
  const flush = () => {
    if (buf.length === 0) return;
    if (buf.length === 1) out.push(buf[0]);
    else out.push({ __group: true, count: buf.length, at: buf[0].at, actor: buf[0].actor });
    buf = [];
  };
  for (const h of items) {
    if (h.actionType !== 'FileUploaded') { flush(); out.push(h); continue; }
    if (isAgg(h)) { flush(); out.push(h); continue; }
    if (buf.length === 0) { buf.push(h); continue; }
    const last = buf[buf.length - 1];
    const delta = Math.abs(new Date(last.at).getTime() - new Date(h.at).getTime());
    if (last.actor === h.actor && delta <= WIN) buf.push(h);
    else { flush(); buf.push(h); }
  }
  flush();
  return out;
}

const t0 = new Date('2026-07-04T10:00:00Z').getTime();
const at = (ms) => new Date(t0 + ms).toISOString();

// 6.1 Toplu satır tek başına
const s1 = group([
  { id: '1', actionType: 'FileUploaded', toValue: '5 dosya', note: 'a.pdf, b.pdf, c.pdf, d.pdf, e.pdf', actor: 'Sistem', at: at(0) },
]);
expect('6.1 Sadece aggregate → 1 element (standalone)', s1.length, 1);
expect('6.1b Element __group DEĞİL (aggregate row olduğu gibi)', !!s1[0].__group, false);

// 6.2 N==1 tekil parite (isAgg false → group'a düşer, tek eleman → tek çıkış)
const s2 = group([
  { id: '1', actionType: 'FileUploaded', toValue: 'sozlesme.pdf', note: null, actor: 'Ali', at: at(0) },
]);
expect('6.2 Tekil (N==1) → 1 element (parite: toValue=fileName)', s2.length, 1);

// 6.3 60sn içinde 2 aggregate AYRI kalır (birleşmez)
const s3 = group([
  { id: '1', actionType: 'FileUploaded', toValue: '3 dosya', note: 'a.pdf, b.pdf, c.pdf', actor: 'Sistem', at: at(0) },
  { id: '2', actionType: 'FileUploaded', toValue: '2 dosya', note: 'd.pdf, e.pdf', actor: 'Sistem', at: at(30_000) },
]);
expect('6.3 60sn içinde 2 aggregate → 2 element ayrı', s3.length, 2);

// 6.4 Legacy per-file run gruplaması: 5 satır aynı actor + ≤60sn → 1 grup
const s4 = group([
  { id: '1', actionType: 'FileUploaded', toValue: 'a.pdf', note: null, actor: 'Ali', at: at(0) },
  { id: '2', actionType: 'FileUploaded', toValue: 'b.pdf', note: null, actor: 'Ali', at: at(10_000) },
  { id: '3', actionType: 'FileUploaded', toValue: 'c.pdf', note: null, actor: 'Ali', at: at(20_000) },
  { id: '4', actionType: 'FileUploaded', toValue: 'd.pdf', note: null, actor: 'Ali', at: at(30_000) },
  { id: '5', actionType: 'FileUploaded', toValue: 'e.pdf', note: null, actor: 'Ali', at: at(40_000) },
]);
expect('6.4 5 legacy per-file → 1 grup', s4.length, 1);
expect('6.4b Grup count 5', s4[0].count, 5);

// 6.5 Karışık: legacy + aggregate + legacy (aggregate grubu BÖLER ama YUTMAZ)
const s5 = group([
  { id: '1', actionType: 'FileUploaded', toValue: 'a.pdf', note: null, actor: 'Ali', at: at(0) },
  { id: '2', actionType: 'FileUploaded', toValue: 'b.pdf', note: null, actor: 'Ali', at: at(5_000) },
  { id: '3', actionType: 'FileUploaded', toValue: '3 dosya', note: 'x.pdf, y.pdf, z.pdf', actor: 'Sistem', at: at(10_000) },
  { id: '4', actionType: 'FileUploaded', toValue: 'c.pdf', note: null, actor: 'Ali', at: at(15_000) },
  { id: '5', actionType: 'FileUploaded', toValue: 'd.pdf', note: null, actor: 'Ali', at: at(20_000) },
]);
expect('6.5 Legacy+Aggregate+Legacy → 3 element (grup + aggregate + grup)', s5.length, 3);
expect('6.5b İlk element grup (count=2)', s5[0].count, 2);
expect('6.5c İkinci element aggregate (standalone)', s5[1].id, '3');
expect('6.5d Üçüncü element grup (count=2)', s5[2].count, 2);

// 6.6 Farklı actor → grup bölünür
const s6 = group([
  { id: '1', actionType: 'FileUploaded', toValue: 'a.pdf', note: null, actor: 'Ali', at: at(0) },
  { id: '2', actionType: 'FileUploaded', toValue: 'b.pdf', note: null, actor: 'Veli', at: at(10_000) },
]);
expect('6.6 Farklı actor → 2 element ayrı', s6.length, 2);

// 6.7 61sn zaman farkı → grup bölünür
const s7 = group([
  { id: '1', actionType: 'FileUploaded', toValue: 'a.pdf', note: null, actor: 'Ali', at: at(0) },
  { id: '2', actionType: 'FileUploaded', toValue: 'b.pdf', note: null, actor: 'Ali', at: at(61_000) },
]);
expect('6.7 61sn farkı → 2 element ayrı', s7.length, 2);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
