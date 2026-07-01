/**
 * smoke-case-number-prefix.js — PR-1 pattern doğrulama + davranış simülasyonu.
 *
 * PR-1 kapsamı:
 *  1. Şema — Company.caseNumberPrefix + Case.caseSeq + CaseNumberCounter
 *  2. Migration — additive DDL + Univera=UNV seed
 *  3. companyRepo create/update — format + zorunluluk + benzersizlik + boşaltma yasak
 *  4. AdminCompaniesPage — prefix input + değişim uyarısı + liste sütunu
 *  5. inboundMailIntake — SUBJECT_CASE_TOKEN_RE genelleştirmesi (UNV-, PRM-, ...)
 *
 * Motor (Date.now → MERGE atomic) PR-2'de. Bu smoke onu test etmez.
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
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260701_case_number_prefix/migration.sql');
const adminRepo = strip(read('server/db/adminRepository.js'));
const adminService = read('src/services/adminService.ts');
const companiesPage = read('src/features/admin/AdminCompaniesPage.tsx');
const intake = read('server/lib/inboundMailIntake.js');

console.log('── 1) Şema (additive) ────────────────────────────');
expect('1.1 Company.caseNumberPrefix String? @unique @db.NVarChar(4)',
  /Company \{[\s\S]{0,3000}caseNumberPrefix String\? @unique @db\.NVarChar\(4\)/.test(schema), true);
expect('1.2 Case.caseSeq BigInt?',
  /Case \{[\s\S]{0,3000}caseSeq\s+BigInt\?/.test(schema), true);
expect('1.3 Case @@unique([companyId, caseSeq])',
  /@@unique\(\[companyId, caseSeq\]\)/.test(schema), true);
expect('1.4 model CaseNumberCounter — companyId @id, lastAssignedNumber BigInt',
  /model CaseNumberCounter \{[\s\S]{0,500}companyId\s+String\s+@id[\s\S]{0,300}lastAssignedNumber BigInt/.test(schema), true);
expect('1.5 Company.caseNumberCounter relation (1-1)',
  /Company \{[\s\S]{0,6000}caseNumberCounter\s+CaseNumberCounter\?/.test(schema), true);
expect('1.6 CaseNumberCounter.company FK NoAction',
  /model CaseNumberCounter \{[\s\S]{0,500}company Company @relation\(fields: \[companyId\], references: \[id\], onDelete: NoAction, onUpdate: NoAction\)/.test(schema), true);

console.log('\n── 2) Migration (DDL + seed) ────────────────────');
expect('2.1 Company.caseNumberPrefix NVARCHAR(4) NULL',
  /ALTER TABLE \[dbo\]\.\[Company\][\s\S]{0,200}ADD \[caseNumberPrefix\] NVARCHAR\(4\) NULL/.test(migration), true);
expect('2.2 Filtered unique index — WHERE caseNumberPrefix IS NOT NULL',
  /CREATE UNIQUE INDEX \[Company_caseNumberPrefix_key\][\s\S]{0,300}WHERE \[caseNumberPrefix\] IS NOT NULL/.test(migration), true);
expect('2.3 Case.caseSeq BIGINT NULL',
  /ALTER TABLE \[dbo\]\.\[Case\][\s\S]{0,200}ADD \[caseSeq\] BIGINT NULL/.test(migration), true);
expect('2.4 Case filtered unique — WHERE caseSeq IS NOT NULL',
  /CREATE UNIQUE INDEX \[Case_companyId_caseSeq_key\][\s\S]{0,300}WHERE \[caseSeq\] IS NOT NULL/.test(migration), true);
expect('2.5 CaseNumberCounter tablosu + FK + PK',
  /CREATE TABLE \[dbo\]\.\[CaseNumberCounter\][\s\S]{0,800}PRIMARY KEY \(\[companyId\]\)[\s\S]{0,400}FOREIGN KEY \(\[companyId\]\) REFERENCES \[dbo\]\.\[Company\]/.test(migration), true);
expect('2.6 Univera=UNV seed — idempotent WHERE caseNumberPrefix IS NULL',
  /UPDATE \[dbo\]\.\[Company\][\s\S]{0,200}SET \[caseNumberPrefix\] = 'UNV'[\s\S]{0,200}WHERE \[caseNumberPrefix\] IS NULL[\s\S]{0,100}AND \[name\] = 'UNIVERA'/.test(migration), true);
expect('2.7 BEGIN TRY/CATCH atomic wrapper',
  /BEGIN TRY[\s\S]+BEGIN TRAN[\s\S]+COMMIT TRAN[\s\S]+END TRY[\s\S]+BEGIN CATCH[\s\S]+ROLLBACK TRAN/.test(migration), true);

console.log('\n── 3) companyRepo — create validation ─────────────');
expect('3.1 CASE_NUMBER_PREFIX_RE — /^[A-Z]{2,4}$/',
  /CASE_NUMBER_PREFIX_RE = \/\^\[A-Z\]\{2,4\}\$\//.test(adminRepo), true);
expect('3.2 normalizePrefix — trim + toUpperCase',
  /function normalizePrefix\([\s\S]{0,300}toUpperCase\(\)/.test(adminRepo), true);
expect('3.3 create — prefix ZORUNLU (null ise 400)',
  /async create[\s\S]{0,800}prefixNorm == null[\s\S]{0,300}AdminError\([\s\S]{0,200}Vaka No Öneki zorunlu/.test(adminRepo), true);
expect('3.4 create — assertPrefixFormat çağrılıyor',
  /async create[\s\S]{0,1000}assertPrefixFormat\(prefixNorm\)/.test(adminRepo), true);
expect('3.5 create — benzersizlik kontrolü',
  /async create[\s\S]{0,1500}prisma\.company\.findFirst\(\{[\s\S]{0,200}where: \{ caseNumberPrefix: prefixNorm \}/.test(adminRepo), true);
expect('3.6 create — company.create data\'ya caseNumberPrefix yaz',
  /async create[\s\S]{0,2000}tx\.company\.create\(\{[\s\S]{0,400}caseNumberPrefix: prefixNorm/.test(adminRepo), true);

console.log('\n── 4) companyRepo — update validation ─────────────');
expect('4.1 update — undefined → dokunma (kısmi)',
  /patch\.caseNumberPrefix !== undefined/.test(adminRepo), true);
expect('4.2 update — SET olduysa BOŞALTMA YASAK',
  /target\.caseNumberPrefix != null[\s\S]{0,300}AdminError\([\s\S]{0,200}boşaltılamaz/.test(adminRepo), true);
expect('4.3 update — format kontrolü',
  /async update[\s\S]{0,3000}assertPrefixFormat\(normalizedPrefix\)/.test(adminRepo), true);
expect('4.4 update — benzersizlik (id != current)',
  /async update[\s\S]{0,3500}where: \{ id: \{ not: id \}, caseNumberPrefix: normalizedPrefix \}/.test(adminRepo), true);
expect('4.5 update — company.update data\'ya conditional set',
  /patch\.caseNumberPrefix !== undefined[\s\S]{0,300}caseNumberPrefix: normalizedPrefix/.test(adminRepo), true);

console.log('\n── 5) companyRepo — list select ────────────────────');
expect('5.1 list — caseNumberPrefix response\'da dolu',
  /caseNumberPrefix: c\.caseNumberPrefix \?\? null/.test(adminRepo), true);

console.log('\n── 6) adminService (TS) — type genişletmesi ────────');
expect('6.1 Company.caseNumberPrefix: string | null',
  /Company \{[\s\S]{0,600}caseNumberPrefix: string \| null/.test(adminService), true);
expect('6.2 CompanyInput.caseNumberPrefix?: string',
  /CompanyInput \{[\s\S]{0,500}caseNumberPrefix\?: string/.test(adminService), true);

console.log('\n── 7) AdminCompaniesPage — UI ──────────────────────');
expect('7.1 caseNumberPrefix state (default existing veya "")',
  /useState\(\s*existing\?\.caseNumberPrefix \?\? ''/.test(companiesPage), true);
expect('7.2 originalPrefix — değişim kontrolü için',
  /const originalPrefix = existing\?\.caseNumberPrefix \?\? null/.test(companiesPage), true);
expect('7.3 create — prefix zorunlu erken hata',
  /mode === 'create' && !prefixTrimmed[\s\S]{0,300}zorunlu/.test(companiesPage), true);
expect('7.4 format regex UI — /^[A-Z]{2,4}$/',
  /\/\^\[A-Z\]\{2,4\}\$\//.test(companiesPage), true);
expect('7.5 edit — mevcut prefix boşaltma yasak',
  /mode === 'edit' && originalPrefix && !prefixTrimmed[\s\S]{0,300}boşaltılamaz/.test(companiesPage), true);
expect('7.6 edit — değişim onay confirm',
  /mode === 'edit' && originalPrefix && prefixTrimmed && prefixTrimmed !== originalPrefix[\s\S]{0,300}window\.confirm/.test(companiesPage), true);
expect('7.7 confirm mesajında "eski önekiyle kalır"',
  /eski\s+"?\$\{originalPrefix\}"?[\s\S]{0,200}kalır|eski vakalar[\s\S]{0,300}kalır/.test(companiesPage), true);
expect('7.8 payload — caseNumberPrefix trimmed || undefined',
  /caseNumberPrefix: prefixTrimmed \|\| undefined/.test(companiesPage), true);
expect('7.9 uppercase + maxLength=4 input davranışı',
  /toUpperCase\(\)\.slice\(0, 4\)[\s\S]{0,200}maxLength=\{4\}/.test(companiesPage), true);
expect('7.10 Field label — create\'te "*" zorunlu',
  /mode === 'create' \? 'Vaka No Öneki \*' : 'Vaka No Öneki'/.test(companiesPage), true);
expect('7.11 Field hint — help metni açıklayıcı (self-explanatory)',
  /2-4 büyük harf[\s\S]{0,300}UNV-1000042/.test(companiesPage), true);
expect('7.12 Liste sütun başlığı — "Vaka Öneki"',
  /<th[^>]*>Vaka Öneki<\/th>/.test(companiesPage), true);
expect('7.13 Liste hücresi — tanımlı prefix badge',
  /c\.caseNumberPrefix \?[\s\S]{0,400}\{c\.caseNumberPrefix\}/.test(companiesPage), true);
expect('7.14 Liste hücresi — tanımsız uyarı (amber)',
  /amber-600[\s\S]{0,400}tanımsız/.test(companiesPage), true);

console.log('\n── 8) inboundMailIntake — regex genelleştirme ──────');
expect('8.1 SUBJECT_CASE_TOKEN_RE = /\\[([A-Z]{2,4}-[0-9A-Z]+)\\]/i',
  /SUBJECT_CASE_TOKEN_RE = \/\\\[\(\[A-Z\]\{2,4\}-\[0-9A-Z\]\+\)\\\]\/i/.test(intake), true);

console.log('\n── 9) Davranış simülasyonu — regex ─────────────────');
const RE = /\[([A-Z]{2,4}-[0-9A-Z]+)\]/i;
function extract(subject) {
  const m = RE.exec(subject);
  return m ? m[1].toUpperCase() : null;
}
expect('9.1 legacy VK- token → yakalar', extract('Re: [VK-M3A4B5] Sorunum'), 'VK-M3A4B5');
expect('9.2 yeni UNV- token → yakalar', extract('Re: [UNV-1000042] Test'), 'UNV-1000042');
expect('9.3 PRM (3 harf) token → yakalar', extract('[PRM-1000000] Fatura'), 'PRM-1000000');
expect('9.4 DEMO (4 harf) token → yakalar', extract('[DEMO-1000123] Bakım'), 'DEMO-1000123');
expect('9.5 X-1234 (1 harf) → yakalamaz', extract('[X-1234] Test'), null);
expect('9.6 TOOLONG-1234 (5 harf) → yakalamaz', extract('[TOOLONG-1234] Test'), null);
expect('9.7 küçük harf token — case-insensitive yakalar', extract('[unv-1000042] test'), 'UNV-1000042');
expect('9.8 token yok → null', extract('Sadece konu, token yok'), null);
expect('9.9 subject başında değil de ortada → yakalar', extract('Yeni: [UNV-1000042] var'), 'UNV-1000042');

console.log('\n── 10) Davranış simülasyonu — prefix validation ────');
const PREFIX_RE = /^[A-Z]{2,4}$/;
function normalize(s) {
  if (s == null) return null;
  const t = String(s).trim().toUpperCase();
  return t === '' ? null : t;
}
expect('10.1 "UNV" → valid', PREFIX_RE.test(normalize('UNV')), true);
expect('10.2 "unv" → normalize + valid', PREFIX_RE.test(normalize('unv')), true);
expect('10.3 "UNV  " → trim + valid', PREFIX_RE.test(normalize('UNV  ')), true);
expect('10.4 "AB" (2 harf) → valid', PREFIX_RE.test(normalize('AB')), true);
expect('10.5 "DEMO" (4 harf) → valid', PREFIX_RE.test(normalize('DEMO')), true);
expect('10.6 "X" (1 harf) → invalid', PREFIX_RE.test(normalize('X')), false);
expect('10.7 "TOOLONG" (5 harf) → invalid', PREFIX_RE.test(normalize('TOOLONG')), false);
expect('10.8 "AB1" (rakam) → invalid', PREFIX_RE.test(normalize('AB1')), false);
expect('10.9 "AB-CD" (özel) → invalid', PREFIX_RE.test(normalize('AB-CD')), false);
expect('10.10 "" → null (normalize)', normalize(''), null);
expect('10.11 "   " → null (trim)', normalize('   '), null);
expect('10.12 null → null', normalize(null), null);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
