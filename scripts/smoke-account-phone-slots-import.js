/**
 * smoke-account-phone-slots-import.js — Phase 3
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-account-phone-slots-import.js
 *
 * Account 3 phone slot import desteğini doğrular:
 *
 *  §1 Schema field + alias presence
 *    Phase 1 + C360 hem phoneType/Extension hem phone2/phone3 + primary
 *    field'larını doğru alias'larla içerir mi.
 *
 *  §2 dryRunCustomer360 satır-seviyesi validasyonlar
 *    - Geçerli 3 slot + primary=2 → error yok
 *    - primary=3 ama phone3 boş → primary_phone_slot_empty
 *    - phone+phone2 aynı E.164 → duplicate_phone_across_slots
 *    - Geçersiz phoneType → row error
 *    - Geçersiz primaryPhoneSlot (4) → row error
 *
 *  §3 Phase 1 normalizeRow
 *    accountTargetSchema.normalizeRow ile phone2/phone3/primary parse
 *    edilir, _rawPhone2/_rawPhone3 doldurulur, hatalar düşer.
 *
 *  §4 AccountContact import alanları DEĞİŞMEDİ
 *    Customer 360 accountContact schema hâlâ tek phone (phoneE164),
 *    phone2/phone3 alanları yok.
 *
 * DB gerektiren testler (DB erişilebilirse): §2 dryRunCustomer360
 * pickCompany ile companyId alır; aksi halde graceful skip.
 *
 * NO DB mutation: dryRunCustomer360 read-only.
 */

import { prisma } from '../server/db/client.js';
import {
  ACCOUNT_FIELDS as C360_ACCOUNT_FIELDS,
} from '../server/lib/import/targetSchemas/customer360TargetSchemas/accountTargetSchema.js';
import {
  ACCOUNT_CONTACT_FIELDS as C360_CONTACT_FIELDS,
} from '../server/lib/import/targetSchemas/customer360TargetSchemas/accountContactTargetSchema.js';
import {
  ACCOUNT_TARGET_FIELDS as P1_ACCOUNT_FIELDS,
  normalizeRow as p1NormalizeRow,
} from '../server/lib/import/targetSchemas/accountTargetSchema.js';
import { dryRunCustomer360 } from '../server/lib/import/customer360DryRun.js';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}
function fieldByKey(arr, key) {
  return arr.find((f) => f.key === key);
}

// ─── §1 Schema field + alias coverage ────────────────────────────────
function aliasCoverage(field, needed) {
  const have = new Set((field?.aliases ?? []).map((a) => a.toLowerCase()));
  const missing = needed.filter((n) => !have.has(n.toLowerCase()));
  return { ok: missing.length === 0, missing };
}

{
  // Phase 1
  const p1Phone = fieldByKey(P1_ACCOUNT_FIELDS, 'phone');
  const p1PType = fieldByKey(P1_ACCOUNT_FIELDS, 'phoneType');
  const p1PExt = fieldByKey(P1_ACCOUNT_FIELDS, 'phoneExtension');
  const p1P2 = fieldByKey(P1_ACCOUNT_FIELDS, 'phone2');
  const p1P2T = fieldByKey(P1_ACCOUNT_FIELDS, 'phone2Type');
  const p1P2E = fieldByKey(P1_ACCOUNT_FIELDS, 'phone2Extension');
  const p1P3 = fieldByKey(P1_ACCOUNT_FIELDS, 'phone3');
  const p1P3T = fieldByKey(P1_ACCOUNT_FIELDS, 'phone3Type');
  const p1P3E = fieldByKey(P1_ACCOUNT_FIELDS, 'phone3Extension');
  const p1Primary = fieldByKey(P1_ACCOUNT_FIELDS, 'primaryPhoneSlot');
  const presence =
    !!p1PType && !!p1PExt && !!p1P2 && !!p1P2T && !!p1P2E && !!p1P3 && !!p1P3T && !!p1P3E && !!p1Primary;
  record('1) Phase 1 schema — slot 1 meta + slot 2/3 + primary fields present', presence);

  const c2P2 = aliasCoverage(p1P2, ['phone2', 'phone_2', 'telefon2', 'telefon_2', 'ikinci_telefon', 'phone2E164', 'phone2_e164']);
  record('2) Phase 1 phone2 alias coverage', c2P2.ok, c2P2.ok ? '' : `missing=${c2P2.missing.join(',')}`);
  const c2P3 = aliasCoverage(p1P3, ['phone3', 'phone_3', 'telefon3', 'telefon_3', 'ucuncu_telefon', 'üçüncü_telefon', 'phone3E164', 'phone3_e164']);
  record('3) Phase 1 phone3 alias coverage', c2P3.ok, c2P3.ok ? '' : `missing=${c2P3.missing.join(',')}`);
  const c2P2T = aliasCoverage(p1P2T, ['phone2Type', 'phone2_type', 'telefon2_tipi', 'ikinci_telefon_tipi']);
  record('4) Phase 1 phone2Type alias coverage', c2P2T.ok, c2P2T.ok ? '' : `missing=${c2P2T.missing.join(',')}`);
  const c2P3E = aliasCoverage(p1P3E, ['phone3Extension', 'phone3_extension', 'phone3_dahili', 'telefon3_dahili', 'ucuncu_telefon_dahili', 'üçüncü_telefon_dahili']);
  record('5) Phase 1 phone3Extension alias coverage', c2P3E.ok, c2P3E.ok ? '' : `missing=${c2P3E.missing.join(',')}`);
  const c2Pri = aliasCoverage(p1Primary, ['primaryPhoneSlot', 'primary_phone_slot', 'birincil_telefon_slot', 'birincilTelefonSlot', 'ana_telefon_slot']);
  record('6) Phase 1 primaryPhoneSlot alias coverage', c2Pri.ok, c2Pri.ok ? '' : `missing=${c2Pri.missing.join(',')}`);
}

{
  // C360 Accounts sheet
  const cP2 = fieldByKey(C360_ACCOUNT_FIELDS, 'phone2');
  const cP2T = fieldByKey(C360_ACCOUNT_FIELDS, 'phone2Type');
  const cP3 = fieldByKey(C360_ACCOUNT_FIELDS, 'phone3');
  const cP3E = fieldByKey(C360_ACCOUNT_FIELDS, 'phone3Extension');
  const cPri = fieldByKey(C360_ACCOUNT_FIELDS, 'primaryPhoneSlot');
  const cP1T = fieldByKey(C360_ACCOUNT_FIELDS, 'phoneType');
  const cP1E = fieldByKey(C360_ACCOUNT_FIELDS, 'phoneExtension');
  record(
    '7) C360 Accounts schema — slot 1 meta + slot 2/3 + primary present',
    !!cP2 && !!cP2T && !!cP3 && !!cP3E && !!cPri && !!cP1T && !!cP1E,
  );
}

{
  // C360 Contacts sheet — slot 2/3 EKLENMEMELİ
  const conP2 = fieldByKey(C360_CONTACT_FIELDS, 'phone2');
  const conP3 = fieldByKey(C360_CONTACT_FIELDS, 'phone3');
  const conPri = fieldByKey(C360_CONTACT_FIELDS, 'primaryPhoneSlot');
  record(
    '8) C360 Contacts schema remains one-phone (no phone2/phone3/primaryPhoneSlot)',
    !conP2 && !conP3 && !conPri,
  );
}

// ─── §2 dryRunCustomer360 row-level validations ──────────────────────
async function pickCompanyId() {
  const c = await prisma.company.findFirst({ where: { isActive: true }, select: { id: true } });
  return c?.id ?? null;
}

function payload(entities) {
  const out = {};
  for (const [k, rows] of Object.entries(entities)) {
    const cols = rows.length ? Object.keys(rows[0]) : [];
    out[k] = { columns: cols, mapping: cols.map((c) => ({ source: c, targetKey: c })), rows };
  }
  return out;
}

let companyId = null;
try {
  companyId = await pickCompanyId();
} catch {
  // DB transient
}
if (!companyId) {
  console.log('⊘ SKIP §2-§3 dryRun tests — DB unreachable or no Company');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed (helper-only path)`);
  await prisma.$disconnect().catch(() => {});
  process.exit(failed.length === 0 ? 0 : 1);
}

// 9) Valid 3 slot + primary=2 → no slot error
{
  const ents = payload({
    account: [
      {
        name: 'Phone Slots Demo',
        phone: '+902121234567',
        phoneType: 'switchboard',
        phoneExtension: '101',
        phone2: '+905321110000',
        phone2Type: 'cep',
        phone3: '+905321110001',
        phone3Type: 'whatsapp',
        primaryPhoneSlot: 2,
      },
    ],
  });
  const r = await dryRunCustomer360({
    companyId,
    entities: ents,
    user: { id: 'smoke', allowedCompanyIds: [companyId] },
  });
  const row = (r.preview?.account ?? [])[0];
  const slotErrs = (row?.errors ?? []).filter((e) =>
    ['primary_phone_slot_empty', 'duplicate_phone_across_slots'].includes(e.code),
  );
  record('9) valid 3 slots + primary=2 → no slot-level errors', slotErrs.length === 0, `errors=${(row?.errors ?? []).map((e) => e.code).join(',')}`);
}

// 10) primary=3 but phone3 empty → primary_phone_slot_empty
{
  const ents = payload({
    account: [
      {
        name: 'Empty Primary Demo',
        phone: '+902121234567',
        primaryPhoneSlot: 3,
      },
    ],
  });
  const r = await dryRunCustomer360({
    companyId,
    entities: ents,
    user: { id: 'smoke', allowedCompanyIds: [companyId] },
  });
  const row = (r.preview?.account ?? [])[0];
  const has = (row?.errors ?? []).some((e) => e.code === 'primary_phone_slot_empty');
  record('10) primary=3 ama slot 3 boş → primary_phone_slot_empty', has, `errors=${(row?.errors ?? []).map((e) => e.code).join(',')}`);
}

// 11) Same E.164 in slot 1 + slot 2 → duplicate_phone_across_slots
{
  const ents = payload({
    account: [
      {
        name: 'Dup Slot Demo',
        phone: '+902121234567',
        phone2: '+902121234567',
      },
    ],
  });
  const r = await dryRunCustomer360({
    companyId,
    entities: ents,
    user: { id: 'smoke', allowedCompanyIds: [companyId] },
  });
  const row = (r.preview?.account ?? [])[0];
  const has = (row?.errors ?? []).some((e) => e.code === 'duplicate_phone_across_slots');
  record('11) aynı E.164 slot 1 + slot 2 → duplicate_phone_across_slots', has, `errors=${(row?.errors ?? []).map((e) => e.code).join(',')}`);
}

// 12) Invalid primaryPhoneSlot (4) → normalize-time error
{
  const ents = payload({
    account: [
      {
        name: 'Bad Primary Demo',
        phone: '+902121234567',
        primaryPhoneSlot: 4,
      },
    ],
  });
  const r = await dryRunCustomer360({
    companyId,
    entities: ents,
    user: { id: 'smoke', allowedCompanyIds: [companyId] },
  });
  const row = (r.preview?.account ?? [])[0];
  const has = (row?.errors ?? []).some((e) =>
    String(e.message || '').toLowerCase().includes('birincil telefon slot 1, 2 veya 3'),
  );
  record('12) primaryPhoneSlot=4 → normalize hatası', has, `errors=${(row?.errors ?? []).map((e) => e.code).join(',')}`);
}

// ─── §3 Phase 1 normalizeRow ────────────────────────────────────────
{
  // Account schema'dan tüm field'ları auto-map ile mapping üret
  const mapping = P1_ACCOUNT_FIELDS.flatMap((f) => [{ source: f.key, targetKey: f.key }]);
  const raw = {
    name: 'P1 Multi-phone',
    phone: '+902121234567',
    phoneType: 'santral',
    phoneExtension: '777',
    phone2: '+905321110000',
    phone2Type: 'cep',
    phone3: '+905321110001',
    phone3Type: 'whatsapp',
    primaryPhoneSlot: '2',
  };
  const out = p1NormalizeRow(raw, mapping);
  const ok =
    out.normalized.phone === '+902121234567' &&
    out.normalized.phoneType === 'switchboard' &&
    out.normalized.phoneExtension === '777' &&
    out.normalized.phone2 === '+905321110000' &&
    out.normalized.phone2Type === 'mobile' &&
    out.normalized.phone3 === '+905321110001' &&
    out.normalized.phone3Type === 'whatsapp' &&
    out.normalized.primaryPhoneSlot === 2 &&
    out.normalized._rawPhone === '+902121234567' &&
    out.normalized._rawPhone2 === '+905321110000' &&
    out.normalized._rawPhone3 === '+905321110001' &&
    out.errors.length === 0;
  record('13) Phase 1 normalizeRow parses 3 slot + primary + _rawPhone* + TR labels', ok,
    `errors=${out.errors.map((e) => e.message).join(',')}`);
}

// 14) Phase 1 normalizeRow → primary=3 ama phone3 boş → error
{
  const mapping = P1_ACCOUNT_FIELDS.flatMap((f) => [{ source: f.key, targetKey: f.key }]);
  const raw = {
    name: 'P1 Empty Primary',
    phone: '+902121234567',
    primaryPhoneSlot: '3',
  };
  const out = p1NormalizeRow(raw, mapping);
  const has = out.errors.some((e) => String(e.message).includes('o slot boş'));
  record('14) Phase 1 normalizeRow primary=3 ama slot 3 boş → row error', has,
    `errors=${out.errors.map((e) => e.message).join(',')}`);
}

// Summary
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name} ${f.detail ?? ''}`);
  await prisma.$disconnect();
  process.exit(1);
}
await prisma.$disconnect();
process.exit(0);
