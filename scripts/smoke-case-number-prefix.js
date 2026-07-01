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
const adminRepoRaw = read('server/db/adminRepository.js');
const adminService = read('src/services/adminService.ts');
const companiesPage = read('src/features/admin/AdminCompaniesPage.tsx');
const intake = read('server/lib/inboundMailIntake.js');
const dbClient = read('server/db/client.js');

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

console.log('\n── 8) inboundMailIntake — regex format-tight + try-all (Codex P2 R1) ──');
expect('8.1 SUBJECT_CASE_TOKEN_RE tight — VK-* OR [A-Z]{2,4}-\\d{7,}',
  /SUBJECT_CASE_TOKEN_RE = \/\\\[\(VK-\[0-9A-Z\]\+\|\[A-Z\]\{2,4\}-\\d\{7,\}\)\\\]\/gi/.test(intake), true);
expect('8.2 extractCaseTokensFromSubject — tüm match\'ler (matchAll)',
  /function extractCaseTokensFromSubject\([\s\S]{0,600}matchAll\(SUBJECT_CASE_TOKEN_RE\)/.test(intake), true);
expect('8.3 extractCaseTokensFromSubject — dedupe (seen Set)',
  /function extractCaseTokensFromSubject\([\s\S]{0,800}const seen = new Set\(\)/.test(intake), true);
expect('8.4 intake path — for cand of tokens, find first match',
  /for \(const cand of tokens\)[\s\S]{0,600}prisma\.case\.findFirst[\s\S]{0,400}break;/.test(intake), true);
expect('8.5 response `token` — matched token veya first candidate',
  /let token = tokens\[0\] \?\? null/.test(intake), true);

console.log('\n── 9) Davranış simülasyonu — regex tight + try-all ─');
const RE = /\[(VK-[0-9A-Z]+|[A-Z]{2,4}-\d{7,})\]/gi;
function extractAll(subject) {
  if (!subject) return [];
  const out = [];
  const seen = new Set();
  for (const m of subject.matchAll(RE)) {
    const t = m[1].toUpperCase();
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}
expect('9.1 legacy VK- token → yakalar (single)',
  JSON.stringify(extractAll('Re: [VK-M3A4B5] Sorunum')), '["VK-M3A4B5"]');
expect('9.2 yeni UNV-1000042 (7 hane) → yakalar',
  JSON.stringify(extractAll('Re: [UNV-1000042] Test')), '["UNV-1000042"]');
expect('9.3 dış ref AB-123 (kısa rakam) → yakalanmaz',
  JSON.stringify(extractAll('[AB-123] Test')), '[]');
expect('9.4 dış ref ABC-456 (3 rakam) → yakalanmaz',
  JSON.stringify(extractAll('[ABC-456] Jira')), '[]');
expect('9.5 Codex örneği — [AB-123] Re: ... [VK-MABC] → yalnız VK yakalanır',
  JSON.stringify(extractAll('[AB-123] Re: yanıt [VK-MABC]')), '["VK-MABC"]');
expect('9.6 çoklu geçerli — [UNV-1000001] önce, [VK-XYZ] sonra → ikisi de',
  JSON.stringify(extractAll('[UNV-1000001] cross-ref [VK-XYZ]')), '["UNV-1000001","VK-XYZ"]');
expect('9.7 dedupe — [UNV-1000042] iki kez → tek',
  JSON.stringify(extractAll('[UNV-1000042] copy [UNV-1000042]')), '["UNV-1000042"]');
expect('9.8 X-1234567 (1 harf prefix) → yakalanmaz',
  JSON.stringify(extractAll('[X-1234567] Test')), '[]');
expect('9.9 TOOLONG-1234567 (5 harf) → yakalanmaz',
  JSON.stringify(extractAll('[TOOLONG-1234567] Test')), '[]');
expect('9.10 küçük harf — case-insensitive',
  JSON.stringify(extractAll('[unv-1000042]')), '["UNV-1000042"]');
expect('9.11 token yok → boş array',
  JSON.stringify(extractAll('Konusuz')), '[]');
expect('9.12 subject ortasında — yakalanır',
  JSON.stringify(extractAll('Yeni: [UNV-1000042] var')), '["UNV-1000042"]');

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

console.log('\n── 11) Codex P2 R1 — prefix collision generic mesaj ──');
expect('11.1 create — enumeration sızıntısı yok (firma adı mesajda yok)',
  /async create[\s\S]{0,3500}Bu önek zaten kullanımda\. Farklı bir 2-4 harfli önek seç\./.test(adminRepoRaw), true);
expect('11.2 update — enumeration sızıntısı yok',
  /async update[\s\S]{0,4500}Bu önek zaten kullanımda\. Farklı bir 2-4 harfli önek seç\./.test(adminRepoRaw), true);
expect('11.3 create — findFirst select sadece id (name YOK)',
  /async create[\s\S]{0,2500}where: \{ caseNumberPrefix: prefixNorm \}[\s\S]{0,200}select: \{ id: true \}/.test(adminRepoRaw), true);
expect('11.4 update — findFirst select sadece id (name YOK)',
  /async update[\s\S]{0,4500}where: \{ id: \{ not: id \}, caseNumberPrefix: normalizedPrefix \}[\s\S]{0,200}select: \{ id: true \}/.test(adminRepoRaw), true);

console.log('\n── 12) Codex P2 R1 — Case.caseSeq BigInt → Number ──');
expect('12.1 resultConfig.case.caseSeq extension eklendi',
  /resultConfig\.case = \{[\s\S]{0,500}caseSeq: \{[\s\S]{0,300}needs: \{ caseSeq: true \}/.test(dbClient), true);
expect('12.2 caseSeq compute — null-safe + Number cast',
  /compute: \(row\) => \(row\.caseSeq == null \? null : Number\(row\.caseSeq\)\)/.test(dbClient), true);
expect('12.3 resultConfig.case merge (spread — JSON alanları ezmez)',
  /resultConfig\.case = \{[\s\S]{0,100}\.\.\.\(resultConfig\.case \?\? \{\}\)/.test(dbClient), true);

console.log('\n── 13) Davranış simülasyonu — BigInt → Number ─────');
const bigVal = 1000042n;
const nullVal = null;
const converted = bigVal == null ? null : Number(bigVal);
expect('13.1 BigInt 1000042n → Number 1000042', converted, 1000042);
expect('13.2 null caseSeq (legacy) → null',
  nullVal == null ? null : Number(nullVal), null);
// JSON.stringify BigInt patlar; Number patlamaz — Express güvenli.
let jsonError = null;
try { JSON.stringify({ caseSeq: bigVal }); } catch (e) { jsonError = e.name; }
expect('13.3 raw BigInt JSON.stringify → TypeError', jsonError, 'TypeError');
let jsonOk = null;
try { jsonOk = JSON.stringify({ caseSeq: converted }); } catch (e) { jsonOk = 'error'; }
expect('13.4 converted Number JSON.stringify → OK', jsonOk, '{"caseSeq":1000042}');

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
