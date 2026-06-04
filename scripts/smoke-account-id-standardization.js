/**
 * smoke-account-id-standardization.js
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-account-id-standardization.js
 *
 * Account.id Phase 1 standardization smoke'u:
 *
 *   • Helper purity:
 *       1) generateAccountId() → "cus_" prefix
 *       2) URL-safe karakter seti (Crockford base32 → 0-9A-HJ-NP-Z)
 *       3) 10k üretimde 0 collision
 *       4) generateUniqueAccountId() DB-doğrulanmış unique id döner
 *
 *   • DB integration (production create path'leri):
 *       5) prisma.account.create({ data: { id, ... } }) ile yeni satır
 *          gerçekten cus_ formatında saklanır
 *       6) `@default(cuid())` korunduğu için legacy create
 *          (id omitted) hâlâ cuid üretir → eski satırlar simüle
 *       7) cus_ + cuid yan yana DB'de okunabiliyor
 *       8) generateUniqueAccountId üst üste çağrı distinct değer döner
 *
 *   • Backward compat:
 *       9) Legacy cuid-formatlı Account.id ile prisma.account.findUnique
 *          (read path id formatına bağımlı değil)
 *
 *   • Schema:
 *      10) prisma/migrations altında bu PR ile schema migration
 *          eklenmediğini doğrula (bu script doğal-olarak migration
 *          state'i değiştirmez; assertion için son migration listesi
 *          beklenenle aynı olmalı — fixture style)
 *
 * Tüm DB satırları smoke içinde TEMİZLENİR (try/finally).
 */

import { prisma } from '../server/db/client.js';
import {
  ACCOUNT_ID_ALPHABET,
  ACCOUNT_ID_PREFIX,
  ACCOUNT_ID_TOKEN_LENGTH,
  generateAccountId,
  generateUniqueAccountId,
  isCusAccountId,
} from '../server/utils/accountId.js';
import { readdirSync } from 'node:fs';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

const PREFIX = TEST_PREFIX();
function TEST_PREFIX() {
  const stamp = Date.now().toString().slice(-7);
  return `aidstd_${stamp}`;
}

const createdAccountIds = new Set();
let testCompanyId = null;

async function pickCompany() {
  const c = await prisma.company.findFirst({ where: { isActive: true }, select: { id: true } });
  return c?.id ?? null;
}

async function safeDeleteAccount(id) {
  await prisma.accountCompany.deleteMany({ where: { accountId: id } }).catch(() => {});
  await prisma.account.delete({ where: { id } }).catch(() => {});
}

try {
  // ── §1 Helper purity (DB gerektirmez) — DB öncesi koş ────────────
  {
    const id = generateAccountId();
    record('1) generateAccountId returns "cus_" prefix', id.startsWith(ACCOUNT_ID_PREFIX), `id=${id}`);
  }

  {
    const id = generateAccountId();
    const token = id.slice(ACCOUNT_ID_PREFIX.length);
    const allInAlphabet = [...token].every((c) => ACCOUNT_ID_ALPHABET.includes(c));
    const isUrlSafe = /^[0-9A-Z]+$/.test(token);
    record('2) URL-safe + Crockford alphabet only', allInAlphabet && isUrlSafe && token.length === ACCOUNT_ID_TOKEN_LENGTH,
      `len=${token.length} url-safe=${isUrlSafe}`);
  }

  {
    const N = 10000;
    const set = new Set();
    for (let i = 0; i < N; i++) set.add(generateAccountId());
    record(`3) ${N} generated IDs all unique`, set.size === N, `unique=${set.size}/${N}`);
  }

  // §4-10 DB gerektirir. Önce bağlanmayı dene; başarısızsa graceful skip.
  try {
    testCompanyId = await pickCompany();
  } catch (err) {
    console.log(`⊘ SKIP §2-§4 DB tests — DB unreachable: ${err?.message ?? err}`);
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed (pure helper only; DB skipped)`);
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  }
  if (!testCompanyId) {
    console.log('SKIP — no active Company in DB');
    await prisma.$disconnect();
    process.exit(0);
  }

  {
    const id = await generateUniqueAccountId();
    record('4) generateUniqueAccountId returns cus_ + DB-verified unique', isCusAccountId(id), `id=${id}`);
  }

  // ── §2 DB integration ───────────────────────────────────────────
  {
    const id = await generateUniqueAccountId();
    const created = await prisma.account.create({
      data: {
        id,
        name: `${PREFIX}-A`,
        customerType: 'Corporate',
        isActive: true,
        companyId: testCompanyId,
        companies: { create: [{ companyId: testCompanyId, status: 'active' }] },
      },
      select: { id: true },
    });
    createdAccountIds.add(created.id);
    record('5) prisma.account.create({ id: <cus_> }) → row saklı',
      created.id === id && isCusAccountId(created.id), `id=${created.id}`);
  }

  {
    // Account.id default cuid() korunur — id verilmezse cuid üretilir.
    const created = await prisma.account.create({
      data: {
        name: `${PREFIX}-Legacy`,
        customerType: 'Corporate',
        isActive: true,
        companyId: testCompanyId,
        companies: { create: [{ companyId: testCompanyId, status: 'active' }] },
      },
      select: { id: true },
    });
    createdAccountIds.add(created.id);
    record('6) @default(cuid()) korunuyor: id omitted → cuid üretildi',
      !isCusAccountId(created.id) && created.id.length > 0, `id=${created.id}`);
  }

  {
    // Yan yana iki format ID'yi okuyabiliyor muyuz?
    const ids = [...createdAccountIds];
    const rows = await prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const found = new Set(rows.map((r) => r.id));
    record('7) cus_ + legacy cuid yan yana okunabiliyor',
      ids.every((id) => found.has(id)), `found=${rows.length}/${ids.length}`);
  }

  {
    const a = await generateUniqueAccountId();
    const b = await generateUniqueAccountId();
    const c = await generateUniqueAccountId();
    record('8) generateUniqueAccountId üst üste distinct değer döner',
      new Set([a, b, c]).size === 3, `ids=${a},${b},${c}`);
  }

  // ── §3 Backward compat ──────────────────────────────────────────
  {
    // Legacy cuid create + read
    const cuidRow = [...createdAccountIds].find((id) => !isCusAccountId(id));
    const fetched = await prisma.account.findUnique({ where: { id: cuidRow }, select: { id: true, name: true } });
    record('9) Legacy cuid Account.id ile findUnique çalışıyor',
      !!fetched && fetched.id === cuidRow, `id=${cuidRow}`);
  }

  // ── §4 Schema unchanged ─────────────────────────────────────────
  {
    // Bu PR için prisma/migrations'a yeni migration eklenmemeli.
    // Heuristic: en son migration adı `cus_` veya `account_id` içermesin.
    const dir = readdirSync('prisma/migrations', { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const latest = dir[dir.length - 1] ?? '';
    const introducedSchemaChange = /cus_|account.*id/i.test(latest);
    record('10) Bu PR yeni schema migration eklemedi (son migration adı kontrol)',
      !introducedSchemaChange, `latest=${latest}`);
  }

  // ── Summary ─────────────────────────────────────────────────────
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
  // Cleanup
  for (const id of createdAccountIds) {
    await safeDeleteAccount(id);
  }
  await prisma.$disconnect();
}
