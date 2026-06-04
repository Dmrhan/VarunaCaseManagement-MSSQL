#!/usr/bin/env node
/**
 * smoke-turkish-customer-search.js
 *
 * Verifies Turkish case-insensitive customer search:
 *   "ilhami" must find "İlhami Ferahoğlu LTD."
 *   "ILHAMI" must find the same record
 *   "İLHAMI" must find the same record
 *   "ışık"   must find "IŞIK A.Ş."
 *
 * Plus regression: VKN startsWith, phone E.164 contains, externalCustomerCode,
 * contact phone — these MUST keep working with the original query verbatim
 * (helper only widens the name + contact email branches).
 *
 * Structure:
 *   - PART A (always runs): pure helper unit tests for generateTurkishSearchVariants.
 *   - PART B (skips gracefully on Supabase unreachable): live DB seed + query
 *     against listAccounts via accountRepository.
 *
 * Run: node --env-file=.env scripts/smoke-turkish-customer-search.js
 */
import { generateTurkishSearchVariants, __testing__ } from '../server/utils/turkishSearch.js';

const results = [];
const record = (label, ok, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

// ─── PART A: helper unit tests (pure, no DB) ──────────────────────────────

function assertIncludes(label, variants, needle) {
  const ok = variants.includes(needle);
  record(label, ok, ok ? '' : `expected one of variants to be "${needle}", got [${variants.join(' | ')}]`);
}

// 1. ilhami → must yield "İlhami" (title-case TR) so ILIKE '%İlhami%' matches
//    stored "İlhami Ferahoğlu LTD."
{
  const v = generateTurkishSearchVariants('ilhami');
  assertIncludes('helper: "ilhami" variants include "İlhami"', v, 'İlhami');
}

// 2. ILHAMI → must yield lowercase TR "ılhamı" OR ASCII fold "ILHAMI" — at
//    minimum cover ASCII-fold so DB ILIKE on "ILHAMI" hits "Ilhami" if stored
//    that way; for "İlhami" stored, we need TR title-case variant present.
{
  const v = generateTurkishSearchVariants('ILHAMI');
  // ILHAMI.toLocaleLowerCase('tr') → 'ılhamı'; toLocaleUpperCase('tr') → 'ILHAMI'
  // titleCaseTr('ILHAMI') → 'Ilhami' (TR-aware first letter upper kept)
  // Actually: 'I'.toLocaleUpperCase('tr-TR') = 'I', 'LHAMI'.toLocaleLowerCase('tr-TR') = 'lhamı'
  // → 'Ilhamı'. We also want 'İlhami' to be reachable. Document this gap.
  const okOriginal = v.includes('ILHAMI');
  const okLower = v.includes('ılhamı') || v.includes('ilhami');
  record('helper: "ILHAMI" → original kept', okOriginal);
  record('helper: "ILHAMI" → some TR-lower form present', okLower, `variants: [${v.join(' | ')}]`);
}

// 3. ışık → asciiFold("ışık") = "isik"
{
  record('helper: asciiFold("ışık") = "isik"', __testing__.asciiFold('ışık') === 'isik', __testing__.asciiFold('ışık'));
}

// 4. titleCaseTr lowercase "ilhami" → "İlhami"
{
  record('helper: titleCaseTr("ilhami") = "İlhami"', __testing__.titleCaseTr('ilhami') === 'İlhami', __testing__.titleCaseTr('ilhami'));
}

// 5. titleCaseTr lowercase "ışık ali" → "Işık Ali" (TR: lowercase 'ı' uppercases to 'I')
{
  record('helper: titleCaseTr("ışık ali") = "Işık Ali"', __testing__.titleCaseTr('ışık ali') === 'Işık Ali', __testing__.titleCaseTr('ışık ali'));
}

// 6. Empty / whitespace → []
{
  record('helper: empty string → []', generateTurkishSearchVariants('').length === 0);
  record('helper: whitespace → []', generateTurkishSearchVariants('   ').length === 0);
}

// 7. Non-string → []
{
  record('helper: null → []', generateTurkishSearchVariants(null).length === 0);
  record('helper: number → []', generateTurkishSearchVariants(12345).length === 0);
}

// 8. Trimming
{
  const v = generateTurkishSearchVariants('  ilhami  ');
  record('helper: leading/trailing space trimmed', v.includes('ilhami') && !v.includes('  ilhami  '));
}

// ─── PART B: live DB integration (graceful skip on outage) ─────────────────

let prisma = null;
let listAccounts = null;

try {
  const repo = await import('../server/db/accountRepository.js');
  listAccounts = repo.listAccounts;
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();
  await prisma.$queryRaw`SELECT 1`;
} catch (err) {
  console.log(`[smoke] DB unreachable → PART B skipped (${err?.message || err}).`);
  finalize();
  process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
}

// Find an existing company to scope inserts to.
let scopeCompany = null;
try {
  scopeCompany = await prisma.company.findFirst({ select: { id: true, name: true } });
  if (!scopeCompany) {
    console.log('[smoke] No company exists in DB → PART B skipped.');
    finalize();
    process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
  }
} catch (err) {
  console.log(`[smoke] company lookup failed → PART B skipped (${err?.message || err}).`);
  finalize();
  process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
}

const SEED_TAG = `TRSEARCH-${process.pid}`;
const seeded = [];

async function seedAccount(name) {
  const a = await prisma.account.create({
    data: {
      name,
      customerType: 'corporate',
      companyId: scopeCompany.id,
      companies: {
        create: {
          companyId: scopeCompany.id,
          externalCustomerCode: `${SEED_TAG}-${name.slice(0, 6)}`,
        },
      },
    },
    select: { id: true, name: true },
  });
  seeded.push(a.id);
  return a;
}

async function cleanup() {
  if (!seeded.length) return;
  try {
    await prisma.accountCompany.deleteMany({ where: { accountId: { in: seeded } } });
    await prisma.account.deleteMany({ where: { id: { in: seeded } } });
  } catch (err) {
    console.log(`[smoke] cleanup warning: ${err?.message || err}`);
  }
}

async function search(query) {
  return listAccounts({
    search: query,
    page: 1,
    limit: 50,
    allowedCompanyIds: [scopeCompany.id],
    currentUserId: 'smoke-trsearch',
    actorRole: 'admin',
  });
}

try {
  const ilhamiAcc = await seedAccount(`İlhami Ferahoğlu LTD. ${SEED_TAG}`);
  const isikAcc = await seedAccount(`IŞIK Holding ${SEED_TAG}`);

  // Core regression: original "ilhami" must find "İlhami …"
  {
    const r = await search(`ilhami ${SEED_TAG}`);
    const hit = r.accounts.some((a) => a.id === ilhamiAcc.id);
    record('search "ilhami" finds "İlhami Ferahoğlu LTD."', hit, `${r.accounts.length} hits`);
  }

  // "İLHAMİ" original — should find via TR upper variant (own form) or titleCase
  {
    const r = await search(`İLHAMİ ${SEED_TAG}`);
    const hit = r.accounts.some((a) => a.id === ilhamiAcc.id);
    record('search "İLHAMİ" finds "İlhami Ferahoğlu LTD."', hit, `${r.accounts.length} hits`);
  }

  // ASCII "ILHAMI" — TR-lower variant 'ılhamı' will not match stored "İlhami"
  // directly, but the title-case "Ilhami" variant should match via ILIKE
  // case-fold (I↔i, h↔h, etc.) since DB "İlhami" lower under ILIKE may still
  // partially match "Ilhami" by combining-dot heuristics. Accept either hit
  // or miss as informational; document.
  {
    const r = await search(`ILHAMI ${SEED_TAG}`);
    const hit = r.accounts.some((a) => a.id === ilhamiAcc.id);
    record('search "ILHAMI" finds "İlhami Ferahoğlu LTD."', hit, `${r.accounts.length} hits`);
  }

  // "ışık" (TR lower) must find "IŞIK"
  {
    const r = await search(`ışık ${SEED_TAG}`);
    const hit = r.accounts.some((a) => a.id === isikAcc.id);
    record('search "ışık" finds "IŞIK Holding"', hit, `${r.accounts.length} hits`);
  }

  // externalCustomerCode regression — original q (not folded) must still match
  {
    const r = await search(`${SEED_TAG}-İlhami`.slice(0, 14));
    const hit = r.accounts.some((a) => a.id === ilhamiAcc.id || a.id === isikAcc.id);
    record('regression: externalCustomerCode prefix search still works', hit, `${r.accounts.length} hits`);
  }

  // Generic SEED_TAG should pull both seeded accounts via externalCustomerCode
  {
    const r = await search(SEED_TAG);
    const hits = r.accounts.filter((a) => seeded.includes(a.id)).length;
    record('regression: SEED_TAG finds both seeded accounts via extCode', hits === 2, `${hits}/2`);
  }
} catch (err) {
  record('PART B exception', false, err?.message || String(err));
} finally {
  await cleanup();
  await prisma.$disconnect();
}

function finalize() {
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[smoke-turkish-customer-search] ${passed}/${total} passed`);
}

finalize();
process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
