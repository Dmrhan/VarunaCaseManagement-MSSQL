/**
 * smoke-mail-multi-inbox-a1.js — Multi-Inbox A1 (schema + repo helpers).
 *
 * KAPSAM (DB-bağımsız):
 *   - normalizeAddress: trim + length cap + invalid type
 *   - normalizeOptionalText: undefined-passthrough + null + empty→null
 *   - shapeForPublic: secret raw alanlar dışarı çıkmıyor (güvenlik)
 *   - Repo public API surface (export'lar mevcut)
 *
 * KAPSAM DIŞI (A4 integration smoke):
 *   - Migration backfill verify (mevcut tenant'lar default inbox'a düşmüş)
 *   - CRUD upsert/remove + secret encrypt round-trip
 *   - assignedTeamId cross-tenant guard
 *   - listEnabled IMAP polling lookup
 *
 * Çalıştır:
 *   node scripts/smoke-mail-multi-inbox-a1.js
 *
 * NOT: DB'siz çalışır; sadece pure helper'lar test edilir. Migration/CRUD
 * smoke A4 (admin UI endpoint) tamamlandığında HTTP üzerinden yapılır.
 */

import {
  externalMailInboxRepo,
  _internal,
} from '../server/db/externalMailInboxRepository.js';

const { normalizeAddress, normalizeOptionalText, shapeForPublic } = _internal;

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ─── normalizeAddress ─────────────────────────────────────────────────
record(
  'normalizeAddress: basic email trim',
  normalizeAddress('  yazilimdestek@univera.com.tr  ') === 'yazilimdestek@univera.com.tr',
);
record(
  'normalizeAddress: empty string → null',
  normalizeAddress('   ') === null,
);
record(
  'normalizeAddress: non-string → null',
  normalizeAddress(123) === null && normalizeAddress(null) === null && normalizeAddress(undefined) === null,
);
record(
  'normalizeAddress: 321 char (over RFC 5321 envelope) → null',
  normalizeAddress('a'.repeat(321)) === null,
);
record(
  'normalizeAddress: 320 char limit OK',
  normalizeAddress('a'.repeat(320)) !== null,
);
record(
  'normalizeAddress: case korunur (display)',
  normalizeAddress('YazilimDestek@Univera.com.tr') === 'YazilimDestek@Univera.com.tr',
);

// ─── normalizeOptionalText ───────────────────────────────────────────
record(
  'normalizeOptionalText: undefined-passthrough (partial update için)',
  normalizeOptionalText(undefined) === undefined,
);
record(
  'normalizeOptionalText: null → null',
  normalizeOptionalText(null) === null,
);
record(
  'normalizeOptionalText: empty string → null',
  normalizeOptionalText('   ') === null,
);
record(
  'normalizeOptionalText: trim',
  normalizeOptionalText('  Yazılım Destek  ') === 'Yazılım Destek',
);
record(
  'normalizeOptionalText: non-string → null',
  normalizeOptionalText(123) === null,
);

// ─── shapeForPublic — secret raw alanlar dışarı çıkmıyor ─────────────
const fakeRow = {
  id: 'inbox-1',
  companyId: 'company-1',
  address: 'yazilimdestek@univera.com.tr',
  displayName: 'Yazılım Destek',
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapSecure: true,
  username: 'yazilimdestek@univera.com.tr',
  secretCiphertext: 'BASE64_CIPHERTEXT_RAW',
  secretIv: 'BASE64_IV_RAW',
  secretAuthTag: 'BASE64_AUTHTAG_RAW',
  secretSetAt: new Date('2026-06-30T10:00:00Z'),
  assignedTeamId: 'team-yazilim',
  enabled: true,
  isActive: true,
  sortOrder: 10,
  createdAt: new Date('2026-06-30T09:00:00Z'),
  updatedAt: new Date('2026-06-30T10:00:00Z'),
};
const shaped = shapeForPublic(fakeRow);
record(
  'shapeForPublic: secretCiphertext public response\'a girmiyor',
  !('secretCiphertext' in shaped),
);
record(
  'shapeForPublic: secretIv public response\'a girmiyor',
  !('secretIv' in shaped),
);
record(
  'shapeForPublic: secretAuthTag public response\'a girmiyor',
  !('secretAuthTag' in shaped),
);
record(
  'shapeForPublic: secretIsSet türetilmiş boolean',
  shaped.secretIsSet === true,
);
record(
  'shapeForPublic: secretSetAt korunmuş',
  shaped.secretSetAt instanceof Date,
);
record(
  'shapeForPublic: assignedTeamId mevcut',
  shaped.assignedTeamId === 'team-yazilim',
);
record(
  'shapeForPublic: null secret → secretIsSet=false',
  shapeForPublic({ ...fakeRow, secretCiphertext: null }).secretIsSet === false,
);
record(
  'shapeForPublic: null row → null',
  shapeForPublic(null) === null,
);

// ─── Repo public API surface ─────────────────────────────────────────
const expectedMethods = [
  'list',
  'listEnabled',
  'listEnabledByCompany',
  'findById',
  'findByAddress',
  'getDecryptedSecret',
  'upsert',
  'remove',
];
for (const m of expectedMethods) {
  record(
    `Repo public method exposed: ${m}`,
    typeof externalMailInboxRepo[m] === 'function',
  );
}

// ─── Summary ─────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log('');
console.log(`Toplam: ${results.length} test — ${passed} PASS, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
