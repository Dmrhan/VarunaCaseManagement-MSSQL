#!/usr/bin/env node
/**
 * smoke-turkish-customer-search.js
 *
 * Verifies Turkish case-insensitive customer search at TWO layers:
 *
 *   PART A — Pure helper unit tests (always runs).
 *     For each expected user input, asserts that the variant set produced
 *     by generateTurkishSearchVariants contains the Turkish-cased form
 *     that ILIKE can byte-match against the stored name.
 *
 *   PART B — Live DB integration (skips gracefully on Supabase outage).
 *     Seeds two accounts whose names include the PID as a hyphenated
 *     token so the search query is a contiguous substring of the stored
 *     name. Asserts deterministically that:
 *       - search "ilhami-PID" finds "İlhami-PID …"
 *       - search "ILHAMI-PID" finds "İlhami-PID …"
 *       - search "ışık-PID"   finds "IŞIK-PID …"
 *     Plus regression: externalCustomerCode prefix continues to match
 *     verbatim (helper is not applied to that branch).
 *
 * Why the PID-hyphenated token works as a contiguous substring:
 *   Stored: "İlhami-12345 Ferahoğlu LTD."
 *   Query:  "ilhami-12345"
 *   Variant (titleCaseTr from ASCII-lower) → "İlhami-12345" → exact byte
 *   match inside stored name → ILIKE hit (regardless of lc_ctype).
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

const variantsIlhami = generateTurkishSearchVariants('ilhami');
record(
  'helper: "ilhami" variants include "İlhami"',
  variantsIlhami.includes('İlhami'),
  variantsIlhami.join(' | '),
);

const variantsILHAMI = generateTurkishSearchVariants('ILHAMI');
record(
  'helper: "ILHAMI" variants include "İlhami" (supports all-caps)',
  variantsILHAMI.includes('İlhami'),
  variantsILHAMI.join(' | '),
);

const variantsISIK = generateTurkishSearchVariants('ışık');
record(
  'helper: "ışık" variants include "IŞIK" (TR upper for stored uppercase form)',
  variantsISIK.includes('IŞIK'),
  variantsISIK.join(' | '),
);

const variantsISIKupper = generateTurkishSearchVariants('IŞIK');
record(
  'helper: "IŞIK" variants include "IŞIK" (identity, byte-match preserved)',
  variantsISIKupper.includes('IŞIK'),
  variantsISIKupper.join(' | '),
);

const variantsHyphenated = generateTurkishSearchVariants('ilhami-12345');
record(
  'helper: hyphenated "ilhami-12345" yields "İlhami-12345"',
  variantsHyphenated.includes('İlhami-12345'),
  variantsHyphenated.join(' | '),
);

const variantsHyphenatedUpper = generateTurkishSearchVariants('ILHAMI-12345');
record(
  'helper: hyphenated "ILHAMI-12345" yields "İlhami-12345"',
  variantsHyphenatedUpper.includes('İlhami-12345'),
  variantsHyphenatedUpper.join(' | '),
);

// Edge cases on the pure transforms.
record('helper: asciiFold("ışık") = "isik"', __testing__.asciiFold('ışık') === 'isik');
record('helper: titleCaseTr("ilhami") = "İlhami"', __testing__.titleCaseTr('ilhami') === 'İlhami');
record('helper: titleCaseTr("ışık ali") = "Işık Ali"', __testing__.titleCaseTr('ışık ali') === 'Işık Ali');
record('helper: empty → []', generateTurkishSearchVariants('').length === 0);
record('helper: whitespace → []', generateTurkishSearchVariants('   ').length === 0);
record('helper: null → []', generateTurkishSearchVariants(null).length === 0);
record('helper: trims leading/trailing space', generateTurkishSearchVariants('  ilhami  ').includes('ilhami'));

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

let scopeCompany = null;
try {
  scopeCompany = await prisma.company.findFirst({ select: { id: true, name: true } });
  if (!scopeCompany) {
    console.log('[smoke] No company in DB → PART B skipped.');
    finalize();
    process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
  }
} catch (err) {
  console.log(`[smoke] company lookup failed → PART B skipped (${err?.message || err}).`);
  finalize();
  process.exit(results.filter((r) => !r.ok).length > 0 ? 1 : 0);
}

const PID = process.pid;
const TAG = `TRSEARCH-${PID}`;
const ILHAMI_TOKEN = `ilhami-${PID}`; // ASCII form the user types
const ISIK_TOKEN = `ışık-${PID}`; // Turkish form the user types
const STORED_ILHAMI = `İlhami-${PID} Ferahoğlu LTD.`;
const STORED_ISIK = `IŞIK-${PID} Holding`;

const seeded = [];

async function seedAccount(name, externalCode) {
  const a = await prisma.account.create({
    data: {
      name,
      customerType: 'corporate',
      companyId: scopeCompany.id,
      companies: {
        create: {
          companyId: scopeCompany.id,
          externalCustomerCode: externalCode,
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
    limit: 100,
    allowedCompanyIds: [scopeCompany.id],
  });
}

try {
  const ilhamiAcc = await seedAccount(STORED_ILHAMI, `${TAG}-ILH`);
  const isikAcc = await seedAccount(STORED_ISIK, `${TAG}-ISI`);

  // 1. ilhami-PID (lowercase ASCII) → must find "İlhami-PID …"
  {
    const r = await search(ILHAMI_TOKEN);
    const hit = r.accounts.some((a) => a.id === ilhamiAcc.id);
    record(
      `search "${ILHAMI_TOKEN}" finds stored "${STORED_ILHAMI}"`,
      hit,
      `${r.accounts.length} total hits in scope`,
    );
  }

  // 2. ILHAMI-PID (uppercase ASCII) → must find "İlhami-PID …"
  {
    const upper = ILHAMI_TOKEN.toUpperCase();
    const r = await search(upper);
    const hit = r.accounts.some((a) => a.id === ilhamiAcc.id);
    record(
      `search "${upper}" finds stored "${STORED_ILHAMI}"`,
      hit,
      `${r.accounts.length} total hits in scope`,
    );
  }

  // 3. ışık-PID (lowercase Turkish) → must find "IŞIK-PID Holding"
  {
    const r = await search(ISIK_TOKEN);
    const hit = r.accounts.some((a) => a.id === isikAcc.id);
    record(
      `search "${ISIK_TOKEN}" finds stored "${STORED_ISIK}"`,
      hit,
      `${r.accounts.length} total hits in scope`,
    );
  }

  // 4. Regression: externalCustomerCode prefix still works on the original q
  {
    const r = await search(TAG);
    const hits = r.accounts.filter((a) => seeded.includes(a.id)).length;
    record(
      `regression: extCode prefix "${TAG}" finds both seeded accounts`,
      hits === 2,
      `${hits}/2 seeded`,
    );
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
