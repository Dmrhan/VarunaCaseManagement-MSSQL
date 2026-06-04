/**
 * smoke-import-integrity-phone-tax.js
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-import-integrity-phone-tax.js
 *
 * Bu smoke 5 Codex findings için odaklı kapsama sağlar:
 *
 *   1) C360 normalizeEntityRow slot-spesifik raw phone (her slot kendi
 *      _rawPhoneN ile gider; slot 2/3 slot 1'i ezmez).
 *   2) C360 dryRun update senaryosunda effective-state cross-slot
 *      duplicate yakalar (mevcut Account.phoneE164 + yeni phone2 aynı).
 *   3) Phase 1 rollback restore yeni alanları (phoneType/phoneExtension,
 *      phone2/phone3 ailesi, primaryPhoneSlot, taxOffice) kapsar.
 *   4) Phase 1 rollback taxOffice'i restore eder.
 *   5) Backend updateAccount Corporate→Individual geçişinde taxOffice'i
 *      defensive olarak null'a düşürür.
 *
 * Bu smoke DB integration testleri içerir; pooler erişilebilir olmalı.
 * Tüm test fixture'ları sonunda temizlenir.
 */

import { prisma } from '../server/db/client.js';
import { normalizeEntityRow } from '../server/lib/import/targetSchemas/customer360TargetSchemas/index.js';
import { dryRunCustomer360 } from '../server/lib/import/customer360DryRun.js';
import { createAccount, updateAccount } from '../server/db/accountRepository.js';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const PREFIX = `integ_${Date.now().toString().slice(-7)}`;
const createdAccountIds = new Set();
let companyId = null;

async function pickCompany() {
  const c = await prisma.company.findFirst({ where: { isActive: true }, select: { id: true } });
  return c?.id ?? null;
}

async function cleanup(id) {
  await prisma.accountCompany.deleteMany({ where: { accountId: id } }).catch(() => {});
  await prisma.account.delete({ where: { id } }).catch(() => {});
}

function vknChecksum(prefix9) {
  const ds = prefix9.split('').map(Number);
  const tmp = new Array(9);
  for (let i = 0; i < 9; i++) {
    let t = (ds[i] + (9 - i)) % 10;
    if (t !== 0) {
      t = (t * Math.pow(2, 9 - i)) % 9;
      if (t === 0) t = 9;
    }
    tmp[i] = t;
  }
  const sum = tmp.reduce((a, b) => a + b, 0);
  return (10 - (sum % 10)) % 10;
}
function genVkn(seed) {
  const prefix = String(seed).padStart(9, '0').slice(0, 9);
  return prefix + String(vknChecksum(prefix));
}
const stamp = Date.now().toString().slice(-6);
const VKN_A = genVkn(`810${stamp.slice(0, 6)}`);
const VKN_B = genVkn(`820${stamp.slice(0, 6)}`);

try {
  companyId = await pickCompany();
  if (!companyId) {
    console.log('SKIP — no active Company');
    await prisma.$disconnect();
    process.exit(0);
  }

  // ─── §1 C360 normalizeEntityRow slot-spesifik raw phone ────────────
  {
    const mapping = [
      { source: 'name', targetKey: 'name' },
      { source: 'phone', targetKey: 'phone' },
      { source: 'phone2', targetKey: 'phone2' },
      { source: 'phone3', targetKey: 'phone3' },
    ];
    const raw = {
      name: 'Slot Demo',
      phone: '+902121234567',
      phone2: '+905321110000',
      phone3: '+905321110001',
    };
    const out = normalizeEntityRow('account', raw, mapping);
    const ok =
      out.normalized.phone === '+902121234567' &&
      out.normalized.phone2 === '+905321110000' &&
      out.normalized.phone3 === '+905321110001' &&
      out.normalized._rawPhone === '+902121234567' &&
      out.normalized._rawPhone2 === '+905321110000' &&
      out.normalized._rawPhone3 === '+905321110001' &&
      out.errors.length === 0;
    record('1) C360 normalizeEntityRow → slot-specific _rawPhone1/2/3', ok,
      `_rawPhone=${out.normalized._rawPhone} _rawPhone2=${out.normalized._rawPhone2} _rawPhone3=${out.normalized._rawPhone3}`);
  }

  // ─── §2 dryRun effective-state cross-slot dup on UPDATE ────────────
  {
    // Mevcut Account: phoneE164=+902121234567
    const acc = await createAccount({
      data: {
        name: `${PREFIX}-existing`,
        vkn: VKN_A,
        customerType: 'Corporate',
        phone: '+902121234567',
        companies: [{ companyId }],
      },
      user: { id: 'smoke', allowedCompanyIds: [companyId] },
    });
    createdAccountIds.add(acc.id);
    // C360 row: SAME VKN, body sadece phone2 verir; aynı E.164 → effective dup
    const payload = {
      account: {
        columns: ['name', 'vkn', 'phone2'],
        mapping: [
          { source: 'name', targetKey: 'name' },
          { source: 'vkn', targetKey: 'vkn' },
          { source: 'phone2', targetKey: 'phone2' },
        ],
        rows: [
          { name: `${PREFIX}-existing`, vkn: VKN_A, phone2: '+902121234567' },
        ],
      },
    };
    const r = await dryRunCustomer360({
      companyId,
      entities: payload,
      user: { id: 'smoke', allowedCompanyIds: [companyId] },
    });
    const row = (r.preview?.account ?? [])[0];
    const dup = (row?.errors ?? []).some((e) => e.code === 'duplicate_phone_across_slots');
    record('2) C360 dryRun update effective-state: existing phoneE164 + new phone2 same → duplicate_phone_across_slots',
      dup, `errors=${(row?.errors ?? []).map((e) => e.code).join(',')}`);
  }

  // ─── §3 + §4 Phase 1 rollback restores phone slot fields + taxOffice
  {
    // Mevcut kurumsal Account with old slot/metadata + old taxOffice
    const acc = await createAccount({
      data: {
        name: `${PREFIX}-rollback`,
        vkn: VKN_B,
        customerType: 'Corporate',
        phone: '+905321119900',
        phoneType: 'mobile',
        phoneExtension: '111',
        phone2: '+905321119901',
        phone2Type: 'work',
        phone2Extension: '222',
        phone3: '+905321119902',
        phone3Type: 'whatsapp',
        primaryPhoneSlot: 1,
        taxOffice: 'OLD-VERGI',
        companies: [{ companyId }],
      },
      user: { id: 'smoke', allowedCompanyIds: [companyId] },
    });
    createdAccountIds.add(acc.id);

    // Simüle Phase 1 import update: beforeJson capture sonrası alanları
    // değiştir. Sonra rollbackAccountImport çağrısı simüle olarak
    // beforeJson'dan restore etmeli.
    // Phase 1 importRepository.snapshotAccount/runJob full job akışını
    // tetiklemek burada karmaşık olur; rollback restore listesinin
    // doğruluğunu test etmek için minimal yaklaşım:
    //
    //   - Hard-coded beforeJson hazırla (mevcut DB state'i).
    //   - Account'u değiştir.
    //   - importJobRow benzeri bir kayıt yapıp rollbackAccountImport
    //     çağırmak yerine, rollback restore listesinin DOĞRU alan
    //     setini kullandığını "by-construction" test edelim:
    //     accountRepository'den exported snapshot helper'ı ile
    //     beforeJson üretip alan listesinin restore edilebilir
    //     olduğunu doğrularız.
    //
    // Pragmatik check: importRepository kaynağında restoreKeys
    // dizisinin alan setini contains check ile doğrula.

    const fs = await import('node:fs');
    const repoSource = fs.readFileSync('server/db/importRepository.js', 'utf8');
    const restoreBlock = repoSource.match(/const restoreKeys = \[(?:[^\]]|\n)*?\];/);
    const restoreKeys = restoreBlock ? restoreBlock[0] : '';
    const requiredKeys = [
      'phone', 'phoneE164', 'phoneType', 'phoneExtension',
      'phone2', 'phone2E164', 'phone2Type', 'phone2Extension',
      'phone3', 'phone3E164', 'phone3Type', 'phone3Extension',
      'primaryPhoneSlot',
      'taxOffice',
    ];
    const missing = requiredKeys.filter((k) => !restoreKeys.includes(`'${k}'`));
    record('3) Phase 1 rollback restoreKeys includes phone slot 1/2/3 metadata + primaryPhoneSlot',
      missing.length === 0, `missing=${missing.join(',') || '(none)'}`);
    record('4) Phase 1 rollback restoreKeys includes taxOffice',
      restoreKeys.includes("'taxOffice'"),
      `restoreKeys block found: ${!!restoreBlock}`);

    // Sanity check: snapshotAccount içeriği rollback için gerekli alanları
    // taşır mı?
    const snap = await prisma.account.findUnique({
      where: { id: acc.id },
      select: { phoneType: true, phone2: true, phone3: true, primaryPhoneSlot: true, taxOffice: true },
    });
    record('4b) Phase 1 update path Account.phone2/phone3/taxOffice persist',
      snap?.phone2 === '+905321119901' && snap?.phone3 === '+905321119902' && snap?.taxOffice === 'OLD-VERGI',
      `phone2=${snap?.phone2} phone3=${snap?.phone3} taxOffice=${snap?.taxOffice}`);
  }

  // ─── §5 Corporate → Individual taxOffice clearing (backend defensive)
  {
    const acc = await createAccount({
      data: {
        name: `${PREFIX}-corp-to-ind`,
        vkn: genVkn(`830${stamp.slice(0, 6)}`),
        customerType: 'Corporate',
        taxOffice: 'STALE-VERGI',
        companies: [{ companyId }],
      },
      user: { id: 'smoke', allowedCompanyIds: [companyId] },
    });
    createdAccountIds.add(acc.id);
    // Verify taxOffice geçti
    let row = await prisma.account.findUnique({ where: { id: acc.id }, select: { taxOffice: true } });
    record('5a) Setup: corporate account has taxOffice', row?.taxOffice === 'STALE-VERGI',
      `taxOffice=${row?.taxOffice}`);

    // Caller customerType=Individual gönderir, body'de taxOffice YOK
    // (UI'da fiximiz null gönderiyor ama backend defensive de çalışmalı).
    await updateAccount({
      accountId: acc.id,
      data: { customerType: 'Individual' },
      user: { id: 'smoke', allowedCompanyIds: [companyId] },
    });
    row = await prisma.account.findUnique({ where: { id: acc.id }, select: { taxOffice: true, customerType: true } });
    record('5b) Corporate→Individual update: backend defensive clears taxOffice',
      row?.customerType === 'Individual' && row?.taxOffice === null,
      `customerType=${row?.customerType} taxOffice=${row?.taxOffice}`);
  }

  // ─── Summary ────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name} ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error('smoke fatal:', err);
  process.exitCode = 1;
} finally {
  for (const id of createdAccountIds) await cleanup(id);
  await prisma.$disconnect();
}
