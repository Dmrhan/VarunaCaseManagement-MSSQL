/**
 * smoke-ux-pack-1-activity-grouping.js — 2026-07-04
 *
 * UX FIX PAKETİ PR-1 / FAZ 1 — Aktivite gruplama.
 *
 * Kapsam:
 *  1. Backend intake: writeCaseFile per-file activity KALDIRILDI +
 *     persistAttachmentsForCase toplu activity yazımı (stored > 1 = 1 satır)
 *  2. Backend: stored === 0 → activity YAZILMAZ (kenar)
 *  3. Backend: stored === 1 → mevcut "Dosya yüklendi" davranışı korunur (regresyon)
 *  4. Manuel upload path (caseRepository.finalizeUpload) DOKUNULMAZ (regresyon)
 *  5. Frontend ActivityTab: legacy per-file FileUploaded satırları
 *     ardışık aynı actor + ≤60sn → 1 grup (davranış sim)
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function expectTrue(name, cond) { expect(name, !!cond, true); }
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

const intake = read('server/lib/inboundMailIntake.js');
const intakeCode = strip(intake);
const caseRepo = read('server/db/caseRepository.js');
const caseDetail = read('src/features/cases/CaseDetailPage.tsx');
const caseDetailCode = strip(caseDetail);

console.log('── 1) Backend: writeCaseFile per-file activity KALDIRILDI ─');
expectTrue('1.1 writeCaseFile içinde caseActivity.create YOK',
  !/async function writeCaseFile[\s\S]{0,1200}prisma\.caseActivity\.create/.test(intakeCode));
expectTrue('1.2 REGRESYON: eski action=\'Dosya yüklendi\' + toValue=row.fileName writeCaseFile içinde YOK',
  !/writeCaseFile[\s\S]{0,1400}toValue:\s*row\.fileName,\s*actor:\s*SYSTEM_UPLOADER/.test(intakeCode));

console.log('\n── 2) Backend: persistAttachmentsForCase toplu activity ─');
expectTrue('2.1 stored.length > 0 gate',
  /if \(stored\.length > 0\)/.test(intakeCode));
expectTrue('2.2 isMulti = stored.length > 1',
  /const isMulti\s*=\s*stored\.length > 1/.test(intakeCode));
expectTrue('2.3 isMulti action: "E-posta ile N dosya eklendi"',
  /`E-posta ile \$\{stored\.length\} dosya eklendi`/.test(intake));
expectTrue('2.4 tekil action: "Dosya yüklendi" (regresyon uyumu)',
  /'Dosya yüklendi'/.test(intake));
expectTrue('2.5 actionType: FileUploaded (mevcut chip\'ler etkilenmesin)',
  /actionType:\s*'FileUploaded'/.test(intake));
expectTrue('2.6 note: dosya adları join + max ~180 kar kısaltma',
  /note = joined[\s\S]{0,800}\+\$\{remainingCount\} daha/.test(intakeCode));

console.log('\n── 3) Backend: stored === 0 kenar (activity YAZILMAZ) ─');
// Guard sadece stored.length > 0 iken activity yazar → 0'da atlar
expectTrue('3.1 Guard: stored.length > 0 kontrolü var (0 durumunda atlar)',
  /if \(stored\.length > 0\)/.test(intakeCode));

console.log('\n── 4) Manuel upload path (finalizeUpload) DOKUNULMAZ ─');
expectTrue('4.1 caseRepository.finalizeUpload history.create satırı korundu',
  /finalizeUpload[\s\S]{0,4000}history:\s*\{[\s\S]{0,300}action:\s*['"]Dosya yüklendi['"]/.test(caseRepo));
expectTrue('4.2 finalizeUpload writeCaseFile KULLANMAZ (izole yol)',
  !/finalizeUpload[\s\S]{0,3000}writeCaseFile/.test(caseRepo));

console.log('\n── 5) Frontend ActivityTab: legacy grouping helper ─');
expectTrue('5.1 groupFileUploadedRuns helper tanımlı',
  /function groupFileUploadedRuns\(items:\s*CaseHistoryEntry\[\]\)/.test(caseDetail));
expectTrue('5.2 ACTIVITY_GROUP_WINDOW_MS = 60000 (60sn)',
  /ACTIVITY_GROUP_WINDOW_MS\s*=\s*60_?000/.test(caseDetail));
expectTrue('5.3 Grup koşulu: sameActor + delta <= WINDOW',
  /const sameActor\s*=\s*last\.actor === h\.actor[\s\S]{0,300}delta\s*<=\s*ACTIVITY_GROUP_WINDOW_MS/.test(caseDetailCode));
expectTrue('5.4 Render: isGroup type guard',
  /function isGroup\([\s\S]{0,200}__group\s*===\s*true/.test(caseDetailCode));
expectTrue('5.5 FileUploadGroupRow bileşeni tanımlı',
  /function FileUploadGroupRow\(\{ group \}: \{ group:\s*FileUploadGroupItem \}\)/.test(caseDetail));
expectTrue('5.6 Grup satırı katlanabilir (open state + toggle button)',
  /const \[open, setOpen\]\s*=\s*useState\(false\)[\s\S]{0,400}onClick=\{\(\)\s*=>\s*setOpen\(\(v\)\s*=>\s*!v\)\}/.test(caseDetailCode));
expectTrue('5.7 rendered useMemo tanımlı (groupFileUploadedRuns wrap)',
  /const rendered\s*=\s*useMemo\(\(\)\s*=>\s*groupFileUploadedRuns\(filtered\),\s*\[filtered\]\)/.test(caseDetailCode));
expectTrue('5.7b Render loop rendered.map kullanır',
  /rendered\.length === 0[\s\S]{0,600}rendered\.map/.test(caseDetail));

console.log('\n── 6) Davranış — groupFileUploadedRuns sim ────');

const GROUP_MS = 60_000;
function groupSim(items) {
  const out = [];
  let buf = [];
  const flush = () => {
    if (buf.length === 0) return;
    if (buf.length === 1) out.push(buf[0]);
    else out.push({ __group: true, groupId: `grp-${buf[0].id}`, items: buf, at: buf[0].at, actor: buf[0].actor });
    buf = [];
  };
  for (const h of items) {
    if (h.actionType !== 'FileUploaded') {
      flush(); out.push(h); continue;
    }
    if (buf.length === 0) { buf.push(h); continue; }
    const last = buf[buf.length - 1];
    const sameActor = last.actor === h.actor;
    const delta = Math.abs(new Date(last.at).getTime() - new Date(h.at).getTime());
    if (sameActor && delta <= GROUP_MS) buf.push(h);
    else { flush(); buf.push(h); }
  }
  flush();
  return out;
}

// Fixture A: 14 legacy FileUploaded ardışık aynı actor + saniyeler içinde
const t0 = new Date('2026-06-01T10:00:00Z').getTime();
const legacy14 = Array.from({ length: 14 }, (_, i) => ({
  id: `h${i}`,
  actionType: 'FileUploaded',
  actor: 'E-posta',
  at: new Date(t0 + i * 100).toISOString(),
  toValue: `dosya${i}.png`,
}));
const rA = groupSim(legacy14);
expect('6.1 14-satır legacy → 1 grup (görünümde 1 satır)', rA.length, 1);
expect('6.1b Grup 14 dosya içerir', rA[0].items.length, 14);

// Fixture B: farklı actor arasında split
const legacyMixed = [
  { id: 'h1', actionType: 'FileUploaded', actor: 'E-posta', at: new Date(t0).toISOString(), toValue: 'a.png' },
  { id: 'h2', actionType: 'FileUploaded', actor: 'E-posta', at: new Date(t0 + 1000).toISOString(), toValue: 'b.png' },
  { id: 'h3', actionType: 'FileUploaded', actor: 'agent@x', at: new Date(t0 + 2000).toISOString(), toValue: 'c.png' },
];
const rB = groupSim(legacyMixed);
expect('6.2 Farklı actor → 2 grup (1 grup + 1 tekil)', rB.length, 2);
expect('6.2b İlk grup 2 dosya', rB[0].items.length, 2);
expect('6.2c İkinci tekil (grup değil)', 'actionType' in rB[1], true);

// Fixture C: 60sn geçmiş → yeni grup
const gapItems = [
  { id: 'h1', actionType: 'FileUploaded', actor: 'E-posta', at: new Date(t0).toISOString(), toValue: 'a.png' },
  { id: 'h2', actionType: 'FileUploaded', actor: 'E-posta', at: new Date(t0 + 30_000).toISOString(), toValue: 'b.png' },
  { id: 'h3', actionType: 'FileUploaded', actor: 'E-posta', at: new Date(t0 + 91_000).toISOString(), toValue: 'c.png' },
];
const rC = groupSim(gapItems);
expect('6.3 30sn içindeki 2 grup + 60sn+ sonrası tekil', rC.length, 2);

// Fixture D: FileUploaded + Transfer + FileUploaded → 3 satır (grup değil)
const mixedTypes = [
  { id: 'h1', actionType: 'FileUploaded', actor: 'E-posta', at: new Date(t0).toISOString(), toValue: 'a.png' },
  { id: 'h2', actionType: 'Transfer', actor: 'X', at: new Date(t0 + 500).toISOString() },
  { id: 'h3', actionType: 'FileUploaded', actor: 'E-posta', at: new Date(t0 + 1000).toISOString(), toValue: 'b.png' },
];
const rD = groupSim(mixedTypes);
expect('6.4 FileUploaded arasına Transfer → grupa yalnış → 3 satır', rD.length, 3);

// Fixture E: 1 tekil FileUploaded → grup DEĞİL, tekil satır
const singleFU = [{ id: 'h1', actionType: 'FileUploaded', actor: 'E-posta', at: new Date(t0).toISOString(), toValue: 'a.png' }];
const rE = groupSim(singleFU);
expect('6.5 1 tekil FileUploaded → grup değil (tekil satır)', rE.length, 1);
expect('6.5b Tekil satır grup DEĞİL', 'actionType' in rE[0], true);

console.log('\n── 7) Davranış — backend group activity payload sim ─');

function buildActivityPayload(stored) {
  if (stored.length === 0) return null;
  const isMulti = stored.length > 1;
  const fileNames = stored.map((s) => s.fileName);
  let note = null;
  if (isMulti) {
    const joined = fileNames.join(', ');
    if (joined.length <= 180) note = joined;
    else {
      let acc = ''; let count = 0;
      for (const n of fileNames) {
        const next = acc.length === 0 ? n : `${acc}, ${n}`;
        if (next.length > 160) break;
        acc = next; count += 1;
      }
      const remainingCount = fileNames.length - count;
      note = remainingCount > 0 ? `${acc}, +${remainingCount} daha` : acc;
    }
  }
  return {
    action: isMulti ? `E-posta ile ${stored.length} dosya eklendi` : 'Dosya yüklendi',
    actionType: 'FileUploaded',
    toValue: isMulti ? `${stored.length} dosya` : fileNames[0],
    note,
  };
}

// 0 ek → null (aktivite yazılmaz)
expect('7.1 stored=[] → payload null (activity YAZILMAZ)',
  buildActivityPayload([]), null);

// 1 ek → tekil payload (regresyon uyumu)
const single = buildActivityPayload([{ fileName: 'rapor.pdf' }]);
expect('7.2 stored=1 → action=Dosya yüklendi', single.action, 'Dosya yüklendi');
expect('7.2b toValue=fileName', single.toValue, 'rapor.pdf');
expect('7.2c note=null (tekil)', single.note, null);

// 14 ek → grup payload
const many = buildActivityPayload(Array.from({ length: 14 }, (_, i) => ({ fileName: `d${i}.png` })));
expect('7.3 stored=14 → action=E-posta ile 14 dosya eklendi',
  many.action, 'E-posta ile 14 dosya eklendi');
expect('7.3b toValue=14 dosya', many.toValue, '14 dosya');
expectTrue('7.3c note: dosya adları join',
  many.note && many.note.startsWith('d0.png, d1.png'));

// Uzun listede kısaltma
const longNames = Array.from({ length: 40 }, (_, i) => ({ fileName: `long_filename_number_${i}.pdf` }));
const trimmed = buildActivityPayload(longNames);
expectTrue('7.4 Uzun liste → "+N daha" kısaltma',
  trimmed.note && /\+\d+ daha$/.test(trimmed.note));
expectTrue('7.4b Note ≤180 karakter (kısaltma etkili)',
  trimmed.note && trimmed.note.length <= 180);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
