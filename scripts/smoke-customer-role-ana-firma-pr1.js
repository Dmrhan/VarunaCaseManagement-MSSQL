/**
 * smoke-customer-role-ana-firma-pr1.js — PR-1 schema + enum + repo pure helpers.
 *
 * KAPSAM (DB-bağımsız):
 *   - enumMap M_CUSTOMER_ROLE (6 değer, n4b parite TR ↔ ASCII)
 *   - CUSTOMER_ROLE_VALUES validation listesi
 *   - customerType (mevcut) ile FARKLI alan — çakışma yok
 *   - normalizeCustomerRole helper (boş/CLEAR/invalid)
 *   - validateAnaFirma 3-katmanlı guard (kod string regex testi)
 *   - WARN guard kodu (Central → başka role indirme)
 *   - listCentralAccounts export
 *
 * KAPSAM DIŞI (PR-3 integration smoke):
 *   - Gerçek DB seed → endpoint çağrısı → davranış denial testi
 *   - Cross-tenant Central account başka tenant'a sızıyor mu (DB testi)
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${actual} expected=${expected}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

// ─── 1) enumMap M_CUSTOMER_ROLE (runtime) ────────────────────────
const { M_CUSTOMER_ROLE, CUSTOMER_ROLE_VALUES, M_CUSTOMER_TYPE } =
  await import('../server/db/enumMap.js');

console.log('── 1) M_CUSTOMER_ROLE — n4b parite 6 değer ────────');
expect('1.1 Merkez Müşteri → Central',
  M_CUSTOMER_ROLE['Merkez Müşteri'], 'Central');
expect('1.2 Distribütör/Bayi → Distributor',
  M_CUSTOMER_ROLE['Distribütör/Bayi'], 'Distributor');
expect('1.3 Bölge Müdürlüğü → RegionalOffice',
  M_CUSTOMER_ROLE['Bölge Müdürlüğü'], 'RegionalOffice');
expect('1.4 Kanal/Çözüm Ortağı → ChannelPartner',
  M_CUSTOMER_ROLE['Kanal/Çözüm Ortağı'], 'ChannelPartner');
expect('1.5 Yurt Dışı → International',
  M_CUSTOMER_ROLE['Yurt Dışı'], 'International');
expect('1.6 Stokbar → Stockbar',
  M_CUSTOMER_ROLE['Stokbar'], 'Stockbar');
expect('1.7 Tam 6 değer (başka YOK)',
  Object.keys(M_CUSTOMER_ROLE).length, 6);

console.log('\n── 2) CUSTOMER_ROLE_VALUES validation listesi ────');
expect('2.1 CUSTOMER_ROLE_VALUES 6 element',
  CUSTOMER_ROLE_VALUES.length, 6);
expect('2.2 Central + Distributor + RegionalOffice mevcut',
  CUSTOMER_ROLE_VALUES.includes('Central')
    && CUSTOMER_ROLE_VALUES.includes('Distributor')
    && CUSTOMER_ROLE_VALUES.includes('RegionalOffice'), true);
expect('2.3 ChannelPartner + International + Stockbar mevcut',
  CUSTOMER_ROLE_VALUES.includes('ChannelPartner')
    && CUSTOMER_ROLE_VALUES.includes('International')
    && CUSTOMER_ROLE_VALUES.includes('Stockbar'), true);

console.log('\n── 3) customerType (mevcut) DOKUNULMADI ──────────');
expect('3.1 M_CUSTOMER_TYPE mevcut (LEGAL tip)',
  M_CUSTOMER_TYPE['Kurumsal'], 'Corporate');
expect('3.2 customerType ile customerRole AYRI map\'ler',
  M_CUSTOMER_TYPE !== M_CUSTOMER_ROLE, true);
expect('3.3 customerType 4 değer (Bireysel/Kurumsal/Kamu/Vakıf-STK)',
  Object.keys(M_CUSTOMER_TYPE).length, 4);

// ─── 4) Schema değişimleri ────────────────────────────────────────
const schema = read('prisma/schema.prisma');

console.log('\n── 4) Schema — Account.customerRole + AccountProject.anaFirmaAccountId ──');
expect('4.1 Account.customerRole nullable',
  /customerRole\s+String\?\s+@db\.NVarChar\(50\)/.test(schema), true);
expect('4.2 Account.@@index([customerRole])',
  /@@index\(\[customerRole\]\)/.test(schema), true);
expect('4.3 AccountProject.anaFirmaAccountId nullable',
  /anaFirmaAccountId\s+String\?\s+@db\.NVarChar\(450\)/.test(schema), true);
expect('4.4 AccountProject.anaFirma relation NO ACTION (multi-cascade engelleme)',
  /anaFirma\s+Account\?\s+@relation\("AccountProjectAnaFirma"[\s\S]{0,300}onDelete:\s*NoAction/.test(schema), true);
expect('4.5 AccountProject.@@index([anaFirmaAccountId])',
  /@@index\(\[anaFirmaAccountId\]\)/.test(schema), true);
expect('4.6 Account.anaFirmaProjects inverse relation',
  /anaFirmaProjects\s+AccountProject\[\]\s+@relation\("AccountProjectAnaFirma"\)/.test(schema), true);

// ─── 5) Migration SQL ─────────────────────────────────────────────
const migration = read('prisma/migrations/20260630_customer_role_ana_firma/migration.sql');

console.log('\n── 5) Migration SQL ─────────────────────────────');
expect('5.1 BEGIN TRY/CATCH transaction guard',
  /BEGIN TRY[\s\S]*BEGIN TRAN[\s\S]*COMMIT TRAN[\s\S]*END TRY[\s\S]*BEGIN CATCH/.test(migration), true);
expect('5.2 Account.customerRole ALTER TABLE',
  /ALTER TABLE \[dbo\]\.\[Account\][\s\S]{0,200}ADD \[customerRole\] NVARCHAR\(50\) NULL/.test(migration), true);
expect('5.3 Account.customerRole index',
  /CREATE NONCLUSTERED INDEX \[Account_customerRole_idx\]/.test(migration), true);
expect('5.4 AccountProject.anaFirmaAccountId ALTER TABLE',
  /ALTER TABLE \[dbo\]\.\[AccountProject\][\s\S]{0,200}ADD \[anaFirmaAccountId\] NVARCHAR\(450\) NULL/.test(migration), true);
expect('5.5 AccountProject FK NO ACTION (MSSQL multi-cascade engelleme)',
  /FOREIGN KEY \(\[anaFirmaAccountId\]\) REFERENCES \[dbo\]\.\[Account\]\(\[id\]\)[\s\S]{0,200}ON DELETE NO ACTION/.test(migration), true);

// ─── 6) accountRepository — normalize + guard ────────────────────
const repo = read('server/db/accountRepository.js');
const repoCode = strip(repo);

console.log('\n── 6) accountRepository — normalize + guard ──────');
expect('6.1 normalizeCustomerRole helper',
  /function normalizeCustomerRole\(value\)/.test(repoCode), true);
expect('6.2 normalizeCustomerRole CLEAR sentinel → null',
  /normalizeCustomerRole[\s\S]{0,400}if \(value === 'CLEAR'\) return null/.test(repoCode), true);
expect('6.3 normalizeCustomerRole invalid → throw',
  /normalizeCustomerRole[\s\S]{0,600}invalid_customer_role/.test(repoCode), true);
expect('6.4 create path customerRole field (data create objesi)',
  /customerType,\s+customerRole,/.test(repoCode), true);
expect('6.5 update path customerRole patch',
  /data\?\.customerRole !== undefined[\s\S]{0,500}patch\.customerRole/.test(repoCode), true);

console.log('\n── 7) CR karar #5 — WARN guard (downgrade) ───────');
expect('7.1 Mevcut Central + yeni başka role → bağlı proje count check',
  /current\?\.customerRole === 'Central' && cr !== 'Central'[\s\S]{0,500}accountProject\.count[\s\S]{0,200}anaFirmaAccountId: accountId/.test(repoCode), true);
expect('7.2 acknowledgedRoleDowngrade flag yoksa 409',
  /!data\?\.acknowledgedRoleDowngrade[\s\S]{0,500}customer_role_downgrade_requires_ack/.test(repoCode), true);
expect('7.3 Impact payload boundProjectCount',
  /impact: \{ boundProjectCount \}/.test(repoCode), true);
expect('7.4 CLEAR sentinel için de aynı WARN guard',
  /data\?\.customerRole === 'CLEAR'[\s\S]{0,500}current\?\.customerRole === 'Central'[\s\S]{0,500}customer_role_downgrade_requires_ack/.test(repoCode), true);

console.log('\n── 8) validateAnaFirma 3-katmanlı guard ──────────');
expect('8.1 validateAnaFirma fonksiyon mevcut',
  /async function validateAnaFirma\(anaFirmaAccountId, targetCompanyId\)/.test(repoCode), true);
expect('8.2 null anaFirma → ok:true (opsiyonel)',
  /validateAnaFirma[\s\S]{0,300}if \(!anaFirmaAccountId\) return \{ ok: true \}/.test(repoCode), true);
expect('8.3 Account exists check → ana_firma_not_found 404',
  /ana_firma_not_found[\s\S]{0,200}404/.test(repoCode), true);
expect('8.4 customerRole=Central check → ana_firma_not_central 409',
  /customerRole !== 'Central'[\s\S]{0,300}ana_firma_not_central[\s\S]{0,200}409/.test(repoCode), true);
expect('8.5 Cross-tenant scope check → ana_firma_out_of_scope 403',
  /companies\.some\(\(c\) => c\.companyId === targetCompanyId\)[\s\S]{0,400}ana_firma_out_of_scope[\s\S]{0,200}403/.test(repoCode), true);

console.log('\n── 9) addProject + updateProject anaFirmaAccountId entegre ──');
expect('9.1 addProject anaFirmaAccountId validate',
  /addProject[\s\S]{0,2000}const anaFirmaAccountId = data\?\.anaFirmaAccountId/.test(repoCode), true);
expect('9.2 addProject validateAnaFirma çağrısı (ac.companyId ile)',
  /addProject[\s\S]{0,2500}validateAnaFirma\(anaFirmaAccountId, ac\.companyId\)/.test(repoCode), true);
expect('9.3 updateProject anaFirmaAccountId patch',
  /updateProject[\s\S]{0,3000}data\?\.anaFirmaAccountId !== undefined[\s\S]{0,500}validateAnaFirma/.test(repoCode), true);
expect('9.4 updateProject null/empty → patch null (bağı temizle)',
  /updateProject[\s\S]{0,3000}data\.anaFirmaAccountId === null \|\| data\.anaFirmaAccountId === ''[\s\S]{0,200}patch\.anaFirmaAccountId = null/.test(repoCode), true);

console.log('\n── 10) listCentralAccounts + decideCentralListScope (PR-3 için) ──');
expect('10.1 listCentralAccounts export\'lu',
  /^export async function listCentralAccounts/m.test(repoCode), true);
expect('10.2 customerRole=Central filter',
  /listCentralAccounts[\s\S]{0,1500}customerRole: 'Central'/.test(repoCode), true);
expect('10.3 decideCentralListScope helper export\'lu (DB-bağımsız davranış testi için)',
  /^export function decideCentralListScope/m.test(repoCode), true);
expect('10.4 decideCentralListScope SystemAdmin → companyIdsToConsider=null',
  /decideCentralListScope[\s\S]{0,1000}isSystemAdmin[\s\S]{0,400}companyIdsToConsider: null/.test(repoCode), true);
expect('10.5 decideCentralListScope cross-tenant DENY (!allowed.includes)',
  /decideCentralListScope[\s\S]{0,1000}!isSystemAdmin && !allowed\.includes\(targetCompanyId\)[\s\S]{0,200}deny: true/.test(repoCode), true);
expect('10.6 listCentralAccounts decision.deny ise erken [] dönüş',
  /listCentralAccounts[\s\S]{0,1500}decision\.deny\) return \[\]/.test(repoCode), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
