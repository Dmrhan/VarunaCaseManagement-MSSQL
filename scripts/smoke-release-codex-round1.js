/**
 * smoke-release-codex-round1.js — Release PR Codex round 1 fix'leri.
 *
 * Bulgular:
 *   P1 — /monthly-bulletin endpoint Account.findUnique select'inde relation
 *        adı yanlış: accountCompanies (yok) yerine companies (var). Runtime
 *        500. Endpoint çağrılınca PR çalışmaz.
 *   P2 — writeAccount customerRole patch'i updateAccount downgrade guard'ını
 *        ATLAR; import Central→başka role değişimi bağlı projeleri yetim
 *        bırakır.
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

// ─── 1) P1 — analytics.js relation fix ────────────────────────
const analytics = read('server/routes/analytics.js');
const analyticsCode = strip(analytics);

console.log('── 1) P1 — /monthly-bulletin Account relation fix ─');
expect('1.1 select\'te companies kullanılıyor (accountCompanies DEĞİL)',
  /findUnique\(\{\s*where: \{ id: body\.accountId \},\s*select: \{[\s\S]{0,200}companies: \{\s*select: \{ companyId: true \}/.test(analyticsCode), true);
expect('1.2 accountCompanies relation adı endpoint\'te artık YOK',
  !/account\.accountCompanies/.test(analyticsCode), true);
expect('1.3 account.companies.map ile companyId çıkarma',
  /account\.companies\.map\(\(ac\) => ac\.companyId\)/.test(analyticsCode), true);

// Schema relation adı doğrula — Account modelindeki blok izole et
const schema = read('prisma/schema.prisma');
const accountBlock = (schema.match(/^model Account\s*\{([\s\S]*?)^\}/m) || ['', ''])[1];

console.log('\n── 2) Schema sanity — Account.companies relation gerçekten var');
expect('2.1 Account modelinde companies AccountCompany[] mevcut',
  /\bcompanies\s+AccountCompany\[\]/.test(accountBlock), true);
expect('2.2 Account modelinde accountCompanies relation YOK',
  /\baccountCompanies\b/.test(accountBlock), false);

// ─── 3) P2 — writeAccount Central downgrade transaction ──────
const engine = read('server/lib/import/customer360CommitEngine.js');
const engineCode = strip(engine);

console.log('\n── 3) P2 — writeAccount Central downgrade cleanup ─');
expect('3.1 isCentralDowngradeImport tespit (existing.customerRole === Central + patch.customerRole !== Central)',
  /isCentralDowngradeImport[\s\S]{0,400}existing\.customerRole === 'Central'[\s\S]{0,300}patch\.customerRole !== undefined[\s\S]{0,200}patch\.customerRole !== 'Central'/.test(engineCode), true);
expect('3.2 Downgrade ise prisma.$transaction',
  /isCentralDowngradeImport\)[\s\S]{0,400}prisma\.\$transaction\(\[/.test(engineCode), true);
expect('3.3 Transaction: accountProject.updateMany anaFirmaAccountId NULL',
  /isCentralDowngradeImport[\s\S]{0,1500}prisma\.accountProject\.updateMany\(\{[\s\S]{0,300}where: \{ anaFirmaAccountId: existing\.id \}[\s\S]{0,200}data: \{ anaFirmaAccountId: null \}/.test(engineCode), true);
expect('3.4 Transaction: account.update aynı transaction\'da',
  /isCentralDowngradeImport[\s\S]{0,2000}prisma\.account\.update\(\{\s*where: \{ id: existing\.id \}/.test(engineCode), true);
expect('3.5 Else (non-downgrade) → eski direkt update yolu korunur',
  /} else \{[\s\S]{0,300}updated = await prisma\.account\.update\(\{\s*where: \{ id: existing\.id \}/.test(engineCode), true);
expect('3.6 patch boş ise update bypass (updated = existing)',
  /Object\.keys\(patch\)\.length === 0/.test(engineCode), true);

// ─── 4) Davranış senaryosu — runtime check (pure logic) ───────
console.log('\n── 4) Davranış simülasyonu (pure conditions) ────');
// Mock pattern test — koddaki koşulu burada da gerçekten değerlendir
function shouldNullProjects(existing, patch) {
  return (
    existing.customerRole === 'Central'
    && patch.customerRole !== undefined
    && patch.customerRole !== 'Central'
  );
}
expect('4.1 Central → Distributor: NULL\'la',
  shouldNullProjects({ customerRole: 'Central' }, { customerRole: 'Distributor' }), true);
expect('4.2 Central → Central: NULL\'lama',
  shouldNullProjects({ customerRole: 'Central' }, { customerRole: 'Central' }), false);
expect('4.3 Distributor → Central: NULL\'lama (upgrade)',
  shouldNullProjects({ customerRole: 'Distributor' }, { customerRole: 'Central' }), false);
expect('4.4 null → Central: NULL\'lama',
  shouldNullProjects({ customerRole: null }, { customerRole: 'Central' }), false);
expect('4.5 Central + customerRole patch\'te yok: NULL\'lama',
  shouldNullProjects({ customerRole: 'Central' }, { name: 'Yeni Ad' }), false);
expect('4.6 Central → Stockbar (n4b son enum): NULL\'la',
  shouldNullProjects({ customerRole: 'Central' }, { customerRole: 'Stockbar' }), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
