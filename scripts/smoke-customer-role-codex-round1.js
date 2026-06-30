/**
 * smoke-customer-role-codex-round1.js — Codex P2 round 1 fix'leri.
 *
 * KAPSAM:
 *   1. customerRole import commit yolu (writeAccount update + create)
 *      → ACCOUNT_SELECT + snapshotAccount + commit path
 *   2. anaFirmaKey resolver (writeProject) → VKN + customerRole=Central
 *      + tenant scope ile çöz; persist (create + update)
 *      → PROJECT_SELECT + snapshotProject + commit path
 *   3. Central downgrade'de bağlı projeleri NULL'la
 *      → updateAccount transaction (accountProject.updateMany + account.update)
 *      → isCentralDowngrade flag detection
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

// ─── 1) writeAccount — customerRole persist ──────────────────────
const engine = read('server/lib/import/customer360CommitEngine.js');
const engineCode = strip(engine);

console.log('── 1) writeAccount customerRole import persist ──');
expect('1.1 update path — patch.customerRole = normalized.customerRole',
  /normalized\.customerRole !== undefined && normalized\.customerRole !== null\) patch\.customerRole = normalized\.customerRole/.test(engineCode), true);
expect('1.2 create path — data.customerRole = normalized.customerRole',
  /create\(\{[\s\S]{0,2500}customerRole: normalized\.customerRole \?\? null/.test(engineCode), true);
expect('1.3 ACCOUNT_SELECT customerRole eklendi',
  /ACCOUNT_SELECT[\s\S]{0,400}customerRole: true/.test(engineCode), true);
expect('1.4 snapshotAccount customerRole alanı (rollback)',
  /snapshotAccount[\s\S]{0,800}customerRole: a\.customerRole/.test(engineCode), true);

// ─── 2) writeProject — anaFirmaKey resolver ─────────────────────
console.log('\n── 2) writeProject anaFirmaKey resolver ────────');
expect('2.1 anaFirmaKey set ise accountCompany.findUnique companyId resolve',
  /normalized\.anaFirmaKey[\s\S]{0,500}prisma\.accountCompany\.findUnique[\s\S]{0,300}companyId: true/.test(engineCode), true);
expect('2.2 Account.findFirst vkn + customerRole=Central filter',
  /prisma\.account\.findFirst\(\{[\s\S]{0,300}vkn: normalized\.anaFirmaKey,[\s\S]{0,200}customerRole: 'Central'/.test(engineCode), true);
expect('2.3 Cross-tenant scope check (companies.some companyId)',
  /findFirst[\s\S]{0,600}companies: \{ some: \{ companyId: ac\.companyId \} \}/.test(engineCode), true);
expect('2.4 update path — anaFirmaAccountId patch',
  /writeProject[\s\S]{0,3500}normalized\.anaFirmaKey && resolvedAnaFirmaAccountId[\s\S]{0,200}patch\.anaFirmaAccountId = resolvedAnaFirmaAccountId/.test(engineCode), true);
expect('2.5 create path — data.anaFirmaAccountId',
  /prisma\.accountProject\.create\(\{[\s\S]{0,1500}anaFirmaAccountId: resolvedAnaFirmaAccountId/.test(engineCode), true);
expect('2.6 PROJECT_SELECT anaFirmaAccountId eklendi',
  /PROJECT_SELECT[\s\S]{0,400}anaFirmaAccountId: true/.test(engineCode), true);
expect('2.7 snapshotProject anaFirmaAccountId alanı (rollback)',
  /snapshotProject[\s\S]{0,600}anaFirmaAccountId: p\.anaFirmaAccountId/.test(engineCode), true);
expect('2.8 anaFirma bulunamazsa SESSİZ null (mevcut paterni mirror)',
  /resolvedAnaFirmaAccountId = null/.test(engineCode), true);

// ─── 3) updateAccount Central downgrade — bağlı proje NULL'la ────
const repo = read('server/db/accountRepository.js');
const repoCode = strip(repo);

console.log('\n── 3) updateAccount Central downgrade NULL ────');
expect('3.1 isCentralDowngrade flag tanımlı',
  /let isCentralDowngrade = false/.test(repoCode), true);
expect('3.2 Central → başka role + ack → isCentralDowngrade = true',
  /current\?\.customerRole === 'Central' && cr !== 'Central'[\s\S]{0,800}isCentralDowngrade = true/.test(repoCode), true);
expect('3.3 Central → CLEAR + ack → isCentralDowngrade = true',
  /data\?\.customerRole === 'CLEAR'[\s\S]{0,1500}current\?\.customerRole === 'Central'[\s\S]{0,1500}isCentralDowngrade = true/.test(repoCode), true);
expect('3.4 isCentralDowngrade ise prisma.$transaction',
  /isCentralDowngrade\)[\s\S]{0,300}prisma\.\$transaction\(\[/.test(repoCode), true);
expect('3.5 Transaction — accountProject.updateMany anaFirmaAccountId NULL',
  /\$transaction\(\[[\s\S]{0,500}prisma\.accountProject\.updateMany\(\{[\s\S]{0,300}where: \{ anaFirmaAccountId: accountId \}[\s\S]{0,200}data: \{ anaFirmaAccountId: null \}/.test(repoCode), true);
expect('3.6 Transaction — Account.update aynı transaction\'da',
  /\$transaction\(\[[\s\S]{0,1000}prisma\.account\.update\(\{ where: \{ id: accountId \}, data: patch \}\)/.test(repoCode), true);
expect('3.7 isCentralDowngrade=false ise eski tek update yolu korunur',
  /} else \{[\s\S]{0,300}await prisma\.account\.update\(\{ where: \{ id: accountId \}, data: patch \}\)/.test(repoCode), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
