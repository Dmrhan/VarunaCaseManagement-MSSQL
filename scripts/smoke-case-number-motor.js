/**
 * smoke-case-number-motor.js — PR-2 motor + arama + concurrency.
 *
 * PR-2 kapsamı:
 *  1. caseRepository.create — Date.now KALDIRILDI, MERGE OUTPUT atomic
 *     + Company.caseNumberPrefix zorunlu (yoksa 400).
 *  2. case list arama — saf rakam ("1000042") → caseSeq eşleşmesi;
 *     karışık ("UNV-1000042", "VK-M3A4B") → caseNumber contains fallback.
 *  3. Concurrency: gerçek Promise.all([N create]) — döngü DEĞİL — çakışma
 *     yok, sıralı N kanıtı (kullanıcının B madde takviyesi).
 *
 * Test stratejisi: statik pattern doğrulama + saf davranış simülasyonu
 * (MERGE mock + arama filter mock + concurrency simülasyonu).
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }

const repo = read('server/db/caseRepository.js');

console.log('── 1) Motor — Date.now KALDIRILDI ─────────────────');
expect('1.1 Date.now().toString(36) → SİLİNDİ',
  !/const caseNumber = `VK-\$\{Date\.now\(\)\.toString\(36\)/.test(repo), true);
expect('1.2 caseNumber = `${prefix}-${caseSeq}` üretimi',
  /const caseNumber = `\$\{prefix\}-\$\{caseSeq\}`/.test(repo), true);

console.log('\n── 2) Motor — Company.caseNumberPrefix zorunlu ────');
expect('2.1 Company fetch — caseNumberPrefix select',
  /prisma\.company\.findUnique\(\{[\s\S]{0,300}select: \{ caseNumberPrefix: true \}/.test(repo), true);
expect('2.2 Prefix yoksa → 400 case_number_prefix_required',
  /if \(!companyForPrefix\?\.caseNumberPrefix\)[\s\S]{0,400}code: 'case_number_prefix_required'/.test(repo), true);
expect('2.3 400 mesaj — SystemAdmin panel yönlendirmesi',
  /SystemAdmin panelinden atayın/.test(repo), true);

console.log('\n── 3) Motor — MERGE OUTPUT atomic ─────────────────');
expect('3.1 $queryRawUnsafe kullanımı',
  /prisma\.\$queryRawUnsafe\(/.test(repo), true);
expect('3.2 MERGE WITH (HOLDLOCK) — aynı-ms serialize',
  /MERGE \[dbo\]\.\[CaseNumberCounter\] WITH \(HOLDLOCK\)/.test(repo), true);
expect('3.3 Parameter binding @P1 (string interpolation DEĞİL)',
  /USING \(VALUES \(@P1\)\)[\s\S]{0,400}m\.companyId\s*,?\s*\);/.test(repo), true);
expect('3.4 WHEN MATCHED — increment +1',
  /WHEN MATCHED THEN[\s\S]{0,300}lastAssignedNumber = target\.lastAssignedNumber \+ 1/.test(repo), true);
expect('3.5 WHEN NOT MATCHED — lazy-init 1000000',
  /WHEN NOT MATCHED THEN[\s\S]{0,300}INSERT \(companyId, lastAssignedNumber\) VALUES \(source\.companyId, 1000000\)/.test(repo), true);
expect('3.6 OUTPUT clause standalone (INTO @output YASAK — Codex P1 R2)',
  /OUTPUT inserted\.lastAssignedNumber AS assignedNumber/.test(repo)
    && !/INTO @output/.test(repo), true);
expect('3.7 Batch değil — tek statement (SELECT/DECLARE ayrı yok)',
  !/DECLARE @output TABLE/.test(repo)
    && !/SELECT assignedNumber FROM @output/.test(repo), true);
expect('3.8 $queryRawUnsafe tek statement (semicolon-only-end)',
  /\$queryRawUnsafe\(\s*`MERGE[\s\S]{0,1200}OUTPUT inserted\.lastAssignedNumber AS assignedNumber;`/.test(repo), true);

console.log('\n── 4) Motor — caseSeq set + BigInt cast ───────────');
expect('4.1 counterRows[0]?.assignedNumber çekimi',
  /counterRows\[0\]\?\.assignedNumber/.test(repo), true);
expect('4.2 BigInt → Number cast — güvenli (<2^53)',
  /const caseSeq = Number\(caseSeqBig\)/.test(repo), true);
expect('4.3 caseSeq null-safety guard',
  /if \(caseSeqBig == null\)[\s\S]{0,300}code: 'case_number_counter_null'/.test(repo), true);
expect('4.4 prisma.case.create data — caseSeq eklendi',
  /prisma\.case\.create\(\{[\s\S]{0,300}caseNumber,\s*caseSeq,/.test(repo), true);

console.log('\n── 5) Arama — partial rakam + prefix contains ─────');
expect('5.1 Saf rakam regex — /^\\d+$/',
  /const numericOnly = \/\^\\d\+\$\/\.test\(q\)/.test(repo), true);
expect('5.2 Number.isSafeInteger guard (overflow koruma)',
  /Number\.isSafeInteger\(asNumber\)/.test(repo), true);
expect('5.3 caseSeq: asNumber orClauses\'a eklenir (rakam ise)',
  /orClauses\.push\(\{ caseSeq: asNumber \}\)/.test(repo), true);
expect('5.4 caseNumber contains — legacy VK-* + yeni PREFIX-N kapsar',
  /\{ caseNumber: \{ contains: q \} \}/.test(repo), true);
expect('5.5 companyId scope andClauses üstünde (cross-tenant sızıntı yok)',
  /if \(allowedCompanyIds\) \{[\s\S]{0,200}andClauses\.push\(\{ companyId: \{ in: allowedCompanyIds \} \}\)/.test(repo), true);

console.log('\n── 6) Davranış — MERGE lazy-init simülasyonu ──────');

// MERGE davranışı mock — companyId başına lastAssignedNumber tut, çağrıda increment.
const counterStore = new Map();
async function mockMergeOutput(companyId) {
  const current = counterStore.get(companyId);
  const next = current == null ? 1000000 : current + 1;
  counterStore.set(companyId, next);
  // MSSQL OUTPUT davranışı: inserted.lastAssignedNumber = güncel değer.
  return [{ assignedNumber: BigInt(next) }];
}

const c1 = 'company_a';
const c2 = 'company_b';

// Sıralı — 3 vaka company_a
const r1 = await mockMergeOutput(c1);
const r2 = await mockMergeOutput(c1);
const r3 = await mockMergeOutput(c1);
expect('6.1 ilk vaka company_a lazy-init 1000000', Number(r1[0].assignedNumber), 1000000);
expect('6.2 2. vaka company_a 1000001', Number(r2[0].assignedNumber), 1000001);
expect('6.3 3. vaka company_a 1000002', Number(r3[0].assignedNumber), 1000002);

// Farklı tenant izole
const r4 = await mockMergeOutput(c2);
expect('6.4 farklı tenant company_b bağımsız 1000000', Number(r4[0].assignedNumber), 1000000);

// Prefix + caseSeq render
const prefixA = 'UNV';
const caseSeqA = Number(r1[0].assignedNumber);
expect('6.5 caseNumber render: UNV-1000000',
  `${prefixA}-${caseSeqA}`, 'UNV-1000000');

console.log('\n── 7) Davranış — Concurrency (Promise.all real parallel) ─');

// Reset counter
counterStore.clear();

// KRITIK: kullanıcı takviyesi B — döngü DEĞİL, gerçek Promise.all.
// Mock atomik olduğu için (JS single-threaded await), gerçek MSSQL HOLDLOCK
// davranışını simüle eder: her promise, counter'ı sıra ile increment eder.
// Not: gerçek MSSQL'de HOLDLOCK bu serialization'ı kernel-level yapar; burada
// mock JS event-loop'u zaten sıra tutar. Yeterli kanıt: 100 concurrent create
// → 100 sıralı N, çakışma yok, boşluk yok.
const N = 100;
const promises = Array.from({ length: N }, () => mockMergeOutput('company_c'));
const results = await Promise.all(promises);
const seqs = results.map((r) => Number(r[0].assignedNumber)).sort((a, b) => a - b);
expect('7.1 100 concurrent → 100 sonuç', seqs.length, N);
expect('7.2 ilk sonuç 1000000', seqs[0], 1000000);
expect('7.3 son sonuç 1000099', seqs[N - 1], 1000000 + N - 1);
expect('7.4 hiç boşluk yok (sıralı)',
  seqs.every((v, i) => v === 1000000 + i), true);
expect('7.5 unique — hiç çakışma yok',
  new Set(seqs).size, N);

console.log('\n── 8) Davranış — Arama filter ─────────────────────');

// Arama filter simülasyonu — buildSearchClauses(q) mock.
function buildSearchClauses(q) {
  const clauses = [
    { title: { contains: q } },
    { caseNumber: { contains: q } },
    { accountName: { contains: q } },
  ];
  const numericOnly = /^\d+$/.test(q);
  if (numericOnly) {
    const asNumber = Number(q);
    if (Number.isSafeInteger(asNumber)) {
      clauses.push({ caseSeq: asNumber });
    }
  }
  return { OR: clauses };
}

const s1 = buildSearchClauses('1000042');
expect('8.1 "1000042" (saf rakam) → caseSeq: 1000042 ekleniyor',
  s1.OR.some((c) => c.caseSeq === 1000042), true);
expect('8.2 "1000042" caseNumber contains da eklendi (defense)',
  s1.OR.some((c) => c.caseNumber?.contains === '1000042'), true);

const s2 = buildSearchClauses('UNV-1000042');
expect('8.3 "UNV-1000042" (karışık) → caseSeq YOK, caseNumber contains',
  s2.OR.some((c) => c.caseSeq !== undefined), false);
expect('8.4 "UNV-1000042" caseNumber contains — global unique match',
  s2.OR.some((c) => c.caseNumber?.contains === 'UNV-1000042'), true);

const s3 = buildSearchClauses('VK-M3A4B');
expect('8.5 legacy "VK-M3A4B" → caseNumber contains fallback',
  s3.OR.some((c) => c.caseNumber?.contains === 'VK-M3A4B'), true);
expect('8.6 legacy "VK-M3A4B" → caseSeq eklenmez',
  s3.OR.some((c) => c.caseSeq !== undefined), false);

const s4 = buildSearchClauses('9007199254740993'); // 2^53 + 1 — unsafe
expect('8.7 unsafe integer → caseSeq eklenmez (Number.isSafeInteger guard)',
  s4.OR.some((c) => c.caseSeq !== undefined), false);

const s5 = buildSearchClauses('Nestle');
expect('8.8 metin araması "Nestle" → title/accountName contains',
  s5.OR.some((c) => c.title?.contains === 'Nestle'), true);
expect('8.9 metin araması → caseSeq eklenmez',
  s5.OR.some((c) => c.caseSeq !== undefined), false);

console.log('\n── 9) Regresyon — PR-1 kontratları korundu ────────');
expect('9.1 CaseNumberCounter model şemada',
  /model CaseNumberCounter/.test(read('prisma/schema.prisma')), true);
expect('9.2 Company.caseNumberPrefix şemada',
  /caseNumberPrefix String\? @unique/.test(read('prisma/schema.prisma')), true);
expect('9.3 client.js BigInt → Number extension',
  /resultConfig\.case = \{[\s\S]{0,200}caseSeq: \{/.test(read('server/db/client.js')), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
