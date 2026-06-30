/**
 * smoke-customer-role-ana-firma-pr4.js — Import target schemas.
 *
 * KAPSAM:
 *   - _shared.normalizeCustomerRole helper (TR/ASCII varyant + invalid)
 *   - accountTargetSchema.customerRole field (label/aliases/normalize)
 *   - accountProjectTargetSchema.anaFirmaKey field (accountKey paterni mirror)
 *   - VERSION bump'lar
 */

import { readFileSync } from 'node:fs';
import {
  normalizeCustomerRole,
  normalizeCustomerType,
} from '../server/lib/import/targetSchemas/customer360TargetSchemas/_shared.js';
import {
  ACCOUNT_FIELDS,
  ACCOUNT_VERSION,
} from '../server/lib/import/targetSchemas/customer360TargetSchemas/accountTargetSchema.js';
import {
  ACCOUNT_PROJECT_FIELDS,
  ACCOUNT_PROJECT_VERSION,
} from '../server/lib/import/targetSchemas/customer360TargetSchemas/accountProjectTargetSchema.js';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
}

// ─── 1) normalizeCustomerRole helper (runtime) ────────────────────
console.log('── 1) normalizeCustomerRole — n4b parite ────────');

expect('1.1 TR "Merkez Müşteri" → Central',
  normalizeCustomerRole('Merkez Müşteri'), 'Central');
expect('1.2 TR "merkez" alias → Central',
  normalizeCustomerRole('merkez'), 'Central');
expect('1.3 TR "Distribütör/Bayi" → Distributor',
  normalizeCustomerRole('Distribütör/Bayi'), 'Distributor');
expect('1.4 TR "bayi" alias → Distributor',
  normalizeCustomerRole('bayi'), 'Distributor');
expect('1.5 TR "Bölge Müdürlüğü" → RegionalOffice',
  normalizeCustomerRole('Bölge Müdürlüğü'), 'RegionalOffice');
expect('1.6 TR "Kanal/Çözüm Ortağı" → ChannelPartner',
  normalizeCustomerRole('Kanal/Çözüm Ortağı'), 'ChannelPartner');
expect('1.7 TR "Yurt Dışı" → International',
  normalizeCustomerRole('Yurt Dışı'), 'International');
expect('1.8 ASCII varyant "yurt disi" → International',
  normalizeCustomerRole('yurt disi'), 'International');
expect('1.9 TR "Stokbar" → Stockbar',
  normalizeCustomerRole('Stokbar'), 'Stockbar');
expect('1.10 ASCII "Central" → Central (round-trip)',
  normalizeCustomerRole('Central'), 'Central');
expect('1.11 Bilinmeyen "FoobarRole" → undefined',
  normalizeCustomerRole('FoobarRole'), undefined);
expect('1.12 Boş input → null',
  normalizeCustomerRole(''), null);
expect('1.13 Null input → null',
  normalizeCustomerRole(null), null);

console.log('\n── 2) normalizeCustomerType (mevcut) DOKUNULMADI ──');
expect('2.1 "Kurumsal" → Corporate (regression)',
  normalizeCustomerType('Kurumsal'), 'Corporate');
expect('2.2 "Bireysel" → Individual (regression)',
  normalizeCustomerType('Bireysel'), 'Individual');

// ─── 3) accountTargetSchema.customerRole field ────────────────────
console.log('\n── 3) accountTargetSchema — customerRole field ──');
const customerRoleField = ACCOUNT_FIELDS.find((f) => f.key === 'customerRole');
expect('3.1 customerRole field mevcut',
  !!customerRoleField, true);
expect('3.2 label "Müşteri Türü" (customerType "Müşteri Tipi" ile FARKLI)',
  customerRoleField?.label, 'Müşteri Türü');
expect('3.3 required=false (nullable, mevcut import\'ları kırmaz)',
  customerRoleField?.required, false);
expect('3.4 createAllowed=true',
  customerRoleField?.createAllowed, true);
expect('3.5 updateAllowed=true',
  customerRoleField?.updateAllowed, true);
expect('3.6 aliases içinde "müşteri türü"',
  customerRoleField?.aliases?.includes('müşteri türü'), true);
expect('3.7 aliases içinde "tür" + "rol"',
  customerRoleField?.aliases?.includes('tür') && customerRoleField?.aliases?.includes('rol'), true);

// normalize TR
const normResult = customerRoleField?.normalize('Merkez Müşteri');
expect('3.8 normalize TR → ok + Central',
  normResult?.ok === true && normResult?.normalized === 'Central', true);
const normBlank = customerRoleField?.normalize('');
expect('3.9 normalize empty → ok + null (nullable)',
  normBlank?.ok === true && normBlank?.normalized === null, true);
const normInvalid = customerRoleField?.normalize('GarbageValue');
expect('3.10 normalize bilinmeyen → ok=false + reason',
  normInvalid?.ok === false && typeof normInvalid?.reason === 'string', true);

console.log('\n── 4) customerType (mevcut) DOKUNULMADI (regression) ──');
const customerTypeField = ACCOUNT_FIELDS.find((f) => f.key === 'customerType');
expect('4.1 customerType field hala mevcut',
  !!customerTypeField, true);
expect('4.2 customerType label "Müşteri Tipi" (DOKUNULMADI)',
  customerTypeField?.label, 'Müşteri Tipi');
expect('4.3 customerType aliases korundu',
  customerTypeField?.aliases?.includes('müşteri tipi'), true);

// ─── 5) accountProjectTargetSchema.anaFirmaKey field ─────────────
console.log('\n── 5) accountProjectTargetSchema — anaFirmaKey ──');
const anaFirmaField = ACCOUNT_PROJECT_FIELDS.find((f) => f.key === 'anaFirmaKey');
expect('5.1 anaFirmaKey field mevcut',
  !!anaFirmaField, true);
expect('5.2 label "Ana Firma Anahtarı"',
  anaFirmaField?.label, 'Ana Firma Anahtarı');
expect('5.3 required=false (geriye uyumlu — mevcut projeler ana-firmasız)',
  anaFirmaField?.required, false);
expect('5.4 createAllowed=true',
  anaFirmaField?.createAllowed, true);
expect('5.5 updateAllowed=true (sonradan eklenebilir)',
  anaFirmaField?.updateAllowed, true);
expect('5.6 aliases içinde "ana firma vkn"',
  anaFirmaField?.aliases?.includes('ana firma vkn'), true);
expect('5.7 aliases içinde "merkez müşteri"',
  anaFirmaField?.aliases?.includes('merkez müşteri'), true);
// normalizeText pattern: max exceed → ok=false (accountKey ile aynı davranış)
const longResult = anaFirmaField?.normalize?.('a'.repeat(85));
expect('5.8 normalize 80 karakter cap (max exceed → ok=false; accountKey paterni)',
  longResult?.ok === false && longResult?.reason?.includes('80'), true);
const shortResult = anaFirmaField?.normalize?.('1234567890');
expect('5.9 normalize 10 karakter (VKN) → ok + trimmed',
  shortResult?.ok === true && shortResult?.normalized === '1234567890', true);

// ─── 6) accountKey field (mevcut) — DOKUNULMADI (regression) ─────
console.log('\n── 6) accountKey (mevcut) DOKUNULMADI ────────────');
const accountKeyField = ACCOUNT_PROJECT_FIELDS.find((f) => f.key === 'accountKey');
expect('6.1 accountKey field hala mevcut',
  !!accountKeyField, true);
expect('6.2 accountKey aliases korundu',
  accountKeyField?.aliases?.includes('parent vkn'), true);

// ─── 7) VERSION bump ─────────────────────────────────────────────
console.log('\n── 7) VERSION bump ──────────────────────────────');
expect('7.1 ACCOUNT_VERSION 2026-06-30 → v6',
  ACCOUNT_VERSION.startsWith('2026-06-30') && ACCOUNT_VERSION.endsWith('v6'), true);
expect('7.2 ACCOUNT_PROJECT_VERSION 2026-06-30 → v4',
  ACCOUNT_PROJECT_VERSION.startsWith('2026-06-30') && ACCOUNT_PROJECT_VERSION.endsWith('v4'), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
