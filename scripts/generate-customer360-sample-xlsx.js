/**
 * WR-A8 Phase 2a — Customer 360 dry-run sample workbook generator.
 *
 * Çalıştır:
 *   node scripts/generate-customer360-sample-xlsx.js
 *
 * Üretir:
 *   docs/integration-test-pack/inbound/customer360-valid.xlsx
 *   docs/integration-test-pack/inbound/customer360-errors.xlsx
 *   docs/integration-test-pack/inbound/customer360-csv/{Accounts,Companies,Contacts,Addresses,Projects}.csv
 *
 * Test fixture only — gerçek PII yok, deterministic.
 * Yalnız `xlsx` npm paketini kullanır (Phase 1'de zaten bağımlılık).
 * Backend/route/schema/migration dokunmaz.
 *
 * Target company konvansiyonu: COMP-UNIVERA (seed dosyalarındaki kimlik).
 * Wizard'da UNIVERA seçildikten sonra `customer360-valid.xlsx` dry-run'ı
 * temiz geçmelidir; `customer360-errors.xlsx` aşağıdaki hataları
 * tetiklemelidir:
 *   - selected company mismatch (COMP-PARAM satırı)
 *   - orphan contact (eşleşmeyen accountKey)
 *   - invalid address country ("Türkiyye")
 *   - orphan project (eşleşmeyen accountCompanyKey)
 *   - duplicate contact (aynı account+email)
 *   - missing account name (boş name)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'docs', 'integration-test-pack', 'inbound');
const CSV_DIR = path.join(OUT_DIR, 'customer360-csv');

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CSV_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────
// Deterministic, validated VKNs (Phase 1 checksum algoritması)
// ─────────────────────────────────────────────────────────────────
function vknChecksum(prefix9) {
  const ds = prefix9.split('').map(Number);
  const tmp = [];
  for (let i = 0; i < 9; i++) {
    let t = (ds[i] + (9 - i)) % 10;
    if (t !== 0) {
      t = (t * Math.pow(2, 9 - i)) % 9;
      if (t === 0) t = 9;
    }
    tmp.push(t);
  }
  const sum = tmp.reduce((a, b) => a + b, 0);
  return (10 - (sum % 10)) % 10;
}
function genVkn(seed) {
  const p = String(seed).padStart(9, '0').slice(0, 9);
  return p + String(vknChecksum(p));
}
const VKN_ACME = genVkn('111222333'); // → 1112223339
const VKN_BETA = genVkn('444555666'); // → 4445556665
const VKN_GAMA = genVkn('777888999'); // → 7778889991

// ─────────────────────────────────────────────────────────────────
// VALID workbook — clean dry-run expected.
// 3 accounts × 3 companies × 4 contacts × 3 addresses × 2 projects
// ─────────────────────────────────────────────────────────────────
const validAccounts = [
  // Phase 3 — örnek: 3 telefon slot + primary slot 2
  { recordNo: 'A001', name: 'Acme Demo A.Ş.', vkn: VKN_ACME, customerType: 'Kurumsal', email: 'info@acme.demo', phone: '+902121110000', phoneType: 'switchboard', phoneExtension: '101', phone2: '+905321119000', phone2Type: 'mobile', phone3: '+905321119001', phone3Type: 'whatsapp', primaryPhoneSlot: 2, isActive: 'Evet' },
  // No-VKN account → warning (warningIfMissing.no_vkn) ama satır geçerli; 1 telefon
  { recordNo: 'A002', name: 'Beta Demo Ltd.', vkn: '', customerType: 'Kurumsal', email: 'info@beta.demo', phone: '+903121112222', phoneType: 'work', primaryPhoneSlot: 1, isActive: 'Evet' },
  { recordNo: 'A003', name: 'Gama Demo Bireysel', vkn: VKN_GAMA, customerType: 'Bireysel', email: 'gama@example.demo', phone: '+905321113333', phoneType: 'mobile', primaryPhoneSlot: 1, isActive: 'Evet' },
];

const validCompanies = [
  // Selected company (COMP-UNIVERA) için açık eşleşme, parentRecordNo → A001
  { recordNo: 'AC001', parentRecordNo: 'A001', accountKey: VKN_ACME, companyCode: 'COMP-UNIVERA', externalCustomerCode: '90001', packageName: 'Premium', segment: 'Key Account', status: 'active' },
  // Boş companyCode → auto-bind to selected (warning). parentRecordNo → A002 (Beta, no VKN)
  { recordNo: 'AC002', parentRecordNo: 'A002', accountKey: 'Beta Demo Ltd.', companyCode: '', externalCustomerCode: '90002', packageName: 'Standard', segment: '', status: 'active' },
  { recordNo: 'AC003', parentRecordNo: 'A003', accountKey: VKN_GAMA, companyCode: 'COMP-UNIVERA', externalCustomerCode: '90003', packageName: 'Basic', segment: '', status: 'active' },
];

const validContacts = [
  { recordNo: 'C001', parentRecordNo: 'A001', sourceContactId: 'ERP-CN-1001', accountKey: VKN_ACME, fullName: 'Ayşe Demo', title: 'Satın Alma Müdürü', email: 'ayse@acme.demo', phone: '+905321110001', isPrimary: 'Evet', isActive: 'Evet' },
  { recordNo: 'C002', parentRecordNo: 'A001', sourceContactId: 'ERP-CN-1002', accountKey: VKN_ACME, fullName: 'Mehmet Demo', title: 'Operasyon Şefi', email: 'mehmet@acme.demo', phone: '+905321110002', isPrimary: 'Hayır', isActive: 'Evet' },
  { recordNo: 'C003', parentRecordNo: 'A002', sourceContactId: 'ERP-CN-2001', accountKey: 'Beta Demo Ltd.', fullName: 'Cem Demo', title: 'Genel Müdür', email: 'cem@beta.demo', phone: '+905321110003', isPrimary: 'Evet', isActive: 'Evet' },
  { recordNo: 'C004', parentRecordNo: 'A003', sourceContactId: 'ERP-CN-3001', accountKey: VKN_GAMA, fullName: 'Selin Demo', title: '', email: 'selin@example.demo', phone: '+905321110004', isPrimary: 'Evet', isActive: 'Evet' },
];

const validAddresses = [
  { recordNo: 'D001', parentRecordNo: 'A001', sourceAddressId: 'ERP-ADR-1001', accountKey: VKN_ACME, type: 'Billing', label: 'Merkez Ofis', line1: 'Atatürk Bulvarı No:5', district: 'Çankaya', city: 'Ankara', postalCode: '06420', country: 'TR', isDefault: 'Evet', isActive: 'Evet' },
  { recordNo: 'D002', parentRecordNo: 'A002', sourceAddressId: 'ERP-ADR-2001', accountKey: 'Beta Demo Ltd.', type: 'Headquarters', label: 'Berlin HQ', line1: 'Friedrichstrasse 100', city: 'Berlin', postalCode: '10117', country: 'DE', isDefault: 'Evet', isActive: 'Evet' },
  { recordNo: 'D003', parentRecordNo: 'A003', sourceAddressId: 'ERP-ADR-3001', accountKey: VKN_GAMA, type: 'Shipping', label: 'Amsterdam Warehouse', line1: 'Damrak 45', city: 'Amsterdam', postalCode: '1012LL', country: 'NL', isDefault: 'Evet', isActive: 'Evet' },
];

const validProjects = [
  // accountCompanyKey selected company ile aynı → OK. parentCompanyRecordNo AC001'e bağlanır.
  { recordNo: 'P001', parentRecordNo: 'A001', parentCompanyRecordNo: 'AC001', sourceProjectId: 'ERP-PRJ-1001', accountKey: VKN_ACME, accountCompanyKey: 'COMP-UNIVERA', projectCode: 'RT-001', projectName: 'Rota Optimizasyon', status: 'Active', startDate: '2025-03-01', endDate: '2026-12-31', isActive: 'Evet' },
  // accountCompanyKey boş → selected'a auto-bind (warning); parentCompanyRecordNo de boş, fallback.
  { recordNo: 'P002', parentRecordNo: 'A003', parentCompanyRecordNo: '', sourceProjectId: 'ERP-PRJ-3001', accountKey: VKN_GAMA, accountCompanyKey: '', projectCode: 'BR-002', projectName: 'Bireysel Saha', status: 'Active', startDate: '2025-06-01', endDate: '', isActive: 'Evet' },
];

// ─────────────────────────────────────────────────────────────────
// ERRORS workbook — intentionally triggers all major validation paths.
// ─────────────────────────────────────────────────────────────────
const VKN_ERR_ACCT = genVkn('200300400'); // valid VKN for the "good" account
const VKN_ERR_DUP = genVkn('500600700'); // for duplicate-contact account
const errorAccounts = [
  // 1) Missing name → required_unmapped will not fire (mapping is fine);
  //    name normalize'ı boş ise "Müşteri adı boş olamaz" hatası verir.
  { name: '', vkn: VKN_ERR_ACCT, customerType: 'Kurumsal', email: 'noname@x.demo', phone: '', isActive: 'Evet' },
  { name: 'ErrorCo Two', vkn: VKN_ERR_DUP, customerType: 'Kurumsal', email: 'two@x.demo', phone: '', isActive: 'Evet' },
];

const errorCompanies = [
  // 2) Selected company mismatch: companyCode = COMP-PARAM, wizard'da UNIVERA seçili olacak
  { accountKey: VKN_ERR_ACCT, companyCode: 'COMP-PARAM', externalCustomerCode: '99001', packageName: 'X', segment: '', status: 'active' },
  // Geçerli AC (errors workbook'ta da en az bir geçerli AC tutuyoruz ki
  // contact/address satırları kendi orphan/duplicate path'lerini tetikleyebilsin).
  { accountKey: VKN_ERR_DUP, companyCode: 'COMP-UNIVERA', externalCustomerCode: '99002', packageName: 'Y', segment: '', status: 'active' },
];

const errorContacts = [
  // 3) Duplicate contact: aynı account+email iki kez
  { accountKey: VKN_ERR_DUP, fullName: 'Dup A', title: '', email: 'dup@x.demo', phone: '', isPrimary: 'Hayır', isActive: 'Evet' },
  { accountKey: VKN_ERR_DUP, fullName: 'Dup B', title: '', email: 'dup@x.demo', phone: '', isPrimary: 'Hayır', isActive: 'Evet' },
  // 4) Orphan contact: parent Account yok
  { accountKey: '9999999999', fullName: 'Orphan Cnt', title: '', email: 'orphan@x.demo', phone: '', isPrimary: 'Hayır', isActive: 'Evet' },
];

const errorAddresses = [
  // 5) Invalid country (Türkiyye yanlış yazım)
  { accountKey: VKN_ERR_DUP, type: 'Billing', label: 'Bad Country', line1: 'Demo Sok. 1', city: 'Ankara', postalCode: '06420', country: 'Türkiyye', isDefault: 'Evet', isActive: 'Evet' },
];

const errorProjects = [
  // 6) Orphan project: parent Account yok
  { accountKey: '9999999999', accountCompanyKey: 'COMP-UNIVERA', projectCode: 'OR-001', projectName: 'Orphan Project', status: 'Active', startDate: '', endDate: '', isActive: 'Evet' },
];

// ─────────────────────────────────────────────────────────────────
// XLSX writers
// ─────────────────────────────────────────────────────────────────
function buildWorkbook({ Accounts, Companies, Contacts, Addresses, Projects }) {
  const wb = XLSX.utils.book_new();
  const add = (rows, name) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add(Accounts, 'Accounts');
  add(Companies, 'Companies');
  add(Contacts, 'Contacts');
  add(Addresses, 'Addresses');
  add(Projects, 'Projects');
  return wb;
}

function writeWorkbook(filename, data) {
  const wb = buildWorkbook(data);
  const filePath = path.join(OUT_DIR, filename);
  XLSX.writeFile(wb, filePath);
  return filePath;
}

// ─────────────────────────────────────────────────────────────────
// CSV writers (valid workbook'tan fallback)
// ─────────────────────────────────────────────────────────────────
function rowsToCsv(rows) {
  if (rows.length === 0) return '';
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const head = headers.join(',');
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(',')).join('\n');
  return '﻿' + head + '\n' + body + '\n'; // BOM for Excel friendliness
}

function writeCsv(name, rows) {
  const p = path.join(CSV_DIR, `${name}.csv`);
  writeFileSync(p, rowsToCsv(rows));
  return p;
}

// ─────────────────────────────────────────────────────────────────
const validFile = writeWorkbook('customer360-valid.xlsx', {
  Accounts: validAccounts,
  Companies: validCompanies,
  Contacts: validContacts,
  Addresses: validAddresses,
  Projects: validProjects,
});
const errorsFile = writeWorkbook('customer360-errors.xlsx', {
  Accounts: errorAccounts,
  Companies: errorCompanies,
  Contacts: errorContacts,
  Addresses: errorAddresses,
  Projects: errorProjects,
});

// CSV fallback — valid workbook'un satırlarından
const csvFiles = [
  writeCsv('Accounts', validAccounts),
  writeCsv('Companies', validCompanies),
  writeCsv('Contacts', validContacts),
  writeCsv('Addresses', validAddresses),
  writeCsv('Projects', validProjects),
];

console.log('Generated:');
console.log(`  ${validFile}`);
console.log(`  ${errorsFile}`);
console.log('  CSV fallback (valid workbook):');
for (const f of csvFiles) console.log(`    ${f}`);

console.log('\nRow counts:');
console.log(`  customer360-valid.xlsx — Accounts:${validAccounts.length} Companies:${validCompanies.length} Contacts:${validContacts.length} Addresses:${validAddresses.length} Projects:${validProjects.length}`);
console.log(`  customer360-errors.xlsx — Accounts:${errorAccounts.length} Companies:${errorCompanies.length} Contacts:${errorContacts.length} Addresses:${errorAddresses.length} Projects:${errorProjects.length}`);
