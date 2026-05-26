/**
 * smoke-customer-search-extended.js — WR-C2 customer search refactor.
 *
 * Verifies the GET /api/accounts list/search endpoint covers all five
 * dimensions the Müşteri Ara modal needs after the C2 refactor:
 *   1) name (contains, case-insensitive)
 *   2) vkn (startsWith)
 *   3) AccountCompany.externalCustomerCode (contains, case-insensitive)  ← C2
 *   4) contact phone (contains, case-insensitive)
 *   5) contact email (contains, case-insensitive)
 *
 * Also asserts:
 *   - min-length: queries shorter than 2 chars are ignored (no search).
 *   - tenant scope: a result row's companies[].companyId is always in the
 *     caller's allowedCompanyIds; cross-tenant accounts never surface.
 *   - existing dimensions still work (regression for #1, #2, #4, #5).
 *
 * Usage:
 *   node --env-file=.env scripts/smoke-customer-search-extended.js
 */

import { prisma } from '../server/db/client.js';
import { listAccounts } from '../server/db/accountRepository.js';

const BFF = process.env.BFF_URL || 'http://localhost:3101';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test1234!';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}
function skip(name, reason = '') {
  results.push({ name, ok: true, skipped: true, detail: reason });
  console.log(`⊘ SKIP ${name}${reason ? ' — ' + reason : ''}`);
}

async function getToken(email) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  const j = await r.json();
  return j.access_token || null;
}

async function api(token, path) {
  const r = await fetch(`${BFF}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

const adminToken = await getToken('admin@varuna.dev');
if (!adminToken) {
  console.log('SKIP — admin token yok');
  await prisma.$disconnect();
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────
// Fixtures — pick existing rows so the smoke doesn't mutate DB.
// ─────────────────────────────────────────────────────────────────

// 1) An account whose AccountCompany has a non-empty externalCustomerCode.
const acWithExtCode = await prisma.accountCompany.findFirst({
  where: { externalCustomerCode: { not: null } },
  select: { id: true, accountId: true, companyId: true, externalCustomerCode: true,
    account: { select: { id: true, name: true, vkn: true } } },
});
if (!acWithExtCode) {
  console.log('SKIP — externalCustomerCode dolu hiç AccountCompany seed yok');
  await prisma.$disconnect();
  process.exit(0);
}

// 2) Existing dim fixtures: pick an account that has a name + (optional) vkn
// + at least one contact with a phone/email — reuse the same Account when
// possible to keep results tight.
const fixtureAcct = await prisma.account.findFirst({
  where: { id: acWithExtCode.accountId },
  select: {
    id: true, name: true, vkn: true,
    contacts: { take: 1, select: { phone: true, email: true } },
  },
});
const fixtureContact = fixtureAcct?.contacts?.[0] ?? null;

// ─────────────────────────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────────────────────────

// 1) Min-length: 1-char query is ignored (returns unfiltered list).
{
  const r1 = await api(adminToken, `/api/accounts?search=a&limit=1`);
  const rFull = await api(adminToken, `/api/accounts?limit=1`);
  record('1) Min-length guard — 1-char query is ignored',
    r1.status === 200 && rFull.status === 200 && (r1.data?.total ?? -1) === (rFull.data?.total ?? -2),
    `1-char total=${r1.data?.total} full total=${rFull.data?.total}`,
  );
}

// 2) name (contains, case-insensitive) — find fixture account by name slice.
{
  const slice = (fixtureAcct?.name ?? '').slice(0, Math.min(4, fixtureAcct?.name?.length ?? 0));
  if (slice.length >= 2) {
    const r = await api(adminToken, `/api/accounts?search=${encodeURIComponent(slice)}&limit=50`);
    const found = (r.data?.accounts ?? []).some((a) => a.id === fixtureAcct.id);
    record('2) Search by name (contains, case-insensitive)', r.status === 200 && found,
      `q="${slice}" status=${r.status} found=${found}`);
  } else {
    skip('2) Search by name', `fixture name too short ("${fixtureAcct?.name}")`);
  }
}

// 3) vkn (startsWith) — only if fixture has a VKN.
if (fixtureAcct?.vkn) {
  const prefix = fixtureAcct.vkn.slice(0, 4);
  const r = await api(adminToken, `/api/accounts?search=${encodeURIComponent(prefix)}&limit=50`);
  const found = (r.data?.accounts ?? []).some((a) => a.id === fixtureAcct.id);
  record('3) Search by VKN (startsWith)', r.status === 200 && found,
    `q="${prefix}" found=${found}`);
} else {
  skip('3) Search by VKN', 'fixture account has no VKN');
}

// 4) externalCustomerCode (contains) — C2 NEW.
{
  const code = acWithExtCode.externalCustomerCode;
  // Use the inner slice to prove "contains" (not just startsWith).
  const slice = code.length >= 4 ? code.slice(1, Math.min(5, code.length)) : code;
  const r = await api(adminToken, `/api/accounts?search=${encodeURIComponent(slice)}&limit=200`);
  const found = (r.data?.accounts ?? []).some((a) => a.id === acWithExtCode.accountId);
  record('4) Search by externalCustomerCode (contains, case-insensitive) — C2 new',
    r.status === 200 && found,
    `q="${slice}" (from "${code}") found=${found}`);

  // Case insensitivity probe (only meaningful if code has any letters).
  if (/[a-z]/i.test(slice)) {
    const upper = slice.toUpperCase();
    const lower = slice.toLowerCase();
    const ru = await api(adminToken, `/api/accounts?search=${encodeURIComponent(upper)}&limit=200`);
    const rl = await api(adminToken, `/api/accounts?search=${encodeURIComponent(lower)}&limit=200`);
    const fu = (ru.data?.accounts ?? []).some((a) => a.id === acWithExtCode.accountId);
    const fl = (rl.data?.accounts ?? []).some((a) => a.id === acWithExtCode.accountId);
    record('4b) externalCustomerCode search is case-insensitive', fu && fl,
      `upper=${fu} lower=${fl}`);
  } else {
    skip('4b) Case-insensitivity probe', 'slice has no letters');
  }
}

// 5) contact phone (contains).
if (fixtureContact?.phone) {
  const slice = fixtureContact.phone.slice(0, Math.min(5, fixtureContact.phone.length));
  if (slice.length >= 2) {
    const r = await api(adminToken, `/api/accounts?search=${encodeURIComponent(slice)}&limit=200`);
    const found = (r.data?.accounts ?? []).some((a) => a.id === fixtureAcct.id);
    record('5) Search by contact phone (contains)', r.status === 200 && found,
      `q="${slice}" found=${found}`);
  } else {
    skip('5) Search by contact phone', 'phone too short');
  }
} else {
  skip('5) Search by contact phone', 'fixture has no contact phone');
}

// 6) contact email (contains).
if (fixtureContact?.email) {
  const local = String(fixtureContact.email).split('@')[0] ?? '';
  const slice = local.slice(0, Math.min(4, local.length));
  if (slice.length >= 2) {
    const r = await api(adminToken, `/api/accounts?search=${encodeURIComponent(slice)}&limit=200`);
    const found = (r.data?.accounts ?? []).some((a) => a.id === fixtureAcct.id);
    record('6) Search by contact email (contains)', r.status === 200 && found,
      `q="${slice}" found=${found}`);
  } else {
    skip('6) Search by contact email', 'email local too short');
  }
} else {
  skip('6) Search by contact email', 'fixture has no contact email');
}

// 7) Tenant scope — every returned row must be reachable through the
//    caller's scope: either it carries at least one AccountCompany chip
//    (the modern multi-tenant shape) OR it is a legacy account with
//    Account.companyId === null (the scope OR explicitly allows those).
//    A row with companies=[] AND a non-null direct companyId would be a
//    cross-tenant leak.
{
  const r = await api(adminToken, `/api/accounts?limit=50`);
  const rows = r.data?.accounts ?? [];
  const leaks = rows.filter((a) =>
    (!Array.isArray(a.companies) || a.companies.length === 0) &&
    a.companyId !== null && a.companyId !== undefined,
  );
  record('7) Tenant scope — no row appears with companies=[] AND a non-null companyId',
    r.status === 200 && leaks.length === 0,
    `status=${r.status} count=${rows.length} leaks=${leaks.length}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// C2 review fix (P1 + P2) — direct repository probes. The dev DB rarely
// has Accounts with TWO ACs both carrying externalCustomerCode, so we
// synthesize a minimal fixture (1 account + 2 AC rows in two existing
// companies, each with a unique stamped code), probe, then delete.
// ─────────────────────────────────────────────────────────────────

const distinctCompanies = await prisma.company.findMany({
  select: { id: true },
  take: 3,
});
let twoAcAccount = null;
let tempAccountId = null;
if (distinctCompanies.length >= 2) {
  const stamp = Date.now().toString().slice(-6);
  const created = await prisma.account.create({
    data: {
      name: `C2 Scope Probe ${stamp}`,
      // No VKN (legitimate, per no_tax_id policy).
      isActive: true,
      // Direct companyId must be set so the account isn't treated as
      // "legacy" by buildScopeWhere's `companyId: null` carveout (which
      // would let every user see it regardless of allowedCompanyIds and
      // mask the real scope behavior we're testing).
      companyId: distinctCompanies[0].id,
      companies: {
        create: [
          { companyId: distinctCompanies[0].id, status: 'active', externalCustomerCode: `SCOPE-A-${stamp}` },
          { companyId: distinctCompanies[1].id, status: 'active', externalCustomerCode: `SCOPE-B-${stamp}` },
        ],
      },
    },
    select: {
      id: true,
      name: true,
      companies: { select: { id: true, companyId: true, externalCustomerCode: true } },
    },
  });
  tempAccountId = created.id;
  twoAcAccount = created;
}

if (!twoAcAccount) {
  skip('8) P1 scope-leak probe', 'no Account with ≥2 AC + externalCustomerCode in dev DB');
  skip('9) P1 in-scope hit',  '(needs same fixture)');
  skip('10) P2 ?ids= revalidation — out-of-scope dropped', '(needs same fixture)');
  skip('11) P2 ?ids= revalidation — in-scope kept',        '(needs same fixture)');
} else {
  const acA = twoAcAccount.companies[0]; // we will give the user access ONLY to this company
  const acB = twoAcAccount.companies[1]; // codeB lives here; must NOT leak when user is scoped to acA's company
  const allowedScoped = [acA.companyId];

  // 8) Search using acB's externalCustomerCode while user only has access
  //    to acA's company. Before the P1 fix this Account would surface;
  //    now it must be filtered out.
  {
    const out = await listAccounts({
      search: acB.externalCustomerCode,
      allowedCompanyIds: allowedScoped,
      limit: 50,
    });
    const leaked = (out?.accounts ?? []).some((a) => a.id === twoAcAccount.id);
    record('8) P1 — externalCustomerCode of forbidden tenant does NOT surface Account',
      !leaked,
      `account=${twoAcAccount.id} codeB="${acB.externalCustomerCode}" allowed=[${allowedScoped.join(',')}] leaked=${leaked}`,
    );
  }

  // 9) Search using acA's externalCustomerCode while user has access to acA.
  //    This must still match.
  {
    const out = await listAccounts({
      search: acA.externalCustomerCode,
      allowedCompanyIds: allowedScoped,
      limit: 50,
    });
    const found = (out?.accounts ?? []).some((a) => a.id === twoAcAccount.id);
    record('9) P1 — externalCustomerCode of allowed tenant DOES surface Account',
      found,
      `account=${twoAcAccount.id} codeA="${acA.externalCustomerCode}" found=${found}`,
    );
  }

  // 10) P2 recents revalidation — passing the account id while scoped to
  //     a tenant that doesn't include any of its AC must return empty.
  //     We use the OPPOSITE company (acB) as the only allowed tenant so the
  //     account *should* show; then we use a foreign companyId (a real one
  //     from another seed) to prove out-of-scope drops.
  const foreignCompany = await prisma.company.findFirst({
    where: { id: { notIn: twoAcAccount.companies.map((c) => c.companyId) } },
    select: { id: true },
  });
  if (foreignCompany) {
    const out = await listAccounts({
      ids: [twoAcAccount.id],
      allowedCompanyIds: [foreignCompany.id],
      limit: 50,
    });
    const leaked = (out?.accounts ?? []).some((a) => a.id === twoAcAccount.id);
    record('10) P2 — ?ids= revalidation drops out-of-scope id (recents leak prevention)',
      !leaked && (out?.accounts ?? []).length === 0,
      `requestedId=${twoAcAccount.id} allowed=[${foreignCompany.id}] leaked=${leaked}`,
    );
  } else {
    skip('10) P2 ?ids= revalidation — out-of-scope dropped', 'no foreign company available');
  }

  // 11) Inverse: scoped to a tenant the account legitimately belongs to,
  //     ?ids= returns it. Proves the filter is not over-strict.
  {
    const out = await listAccounts({
      ids: [twoAcAccount.id],
      allowedCompanyIds: allowedScoped,
      limit: 50,
    });
    const found = (out?.accounts ?? []).some((a) => a.id === twoAcAccount.id);
    record('11) P2 — ?ids= keeps in-scope id (recents normal path)',
      found,
      `requestedId=${twoAcAccount.id} allowed=[${allowedScoped.join(',')}] found=${found}`,
    );
  }

  // 12) Name regression on the same scoped user: searching by Account name
  //     must still surface the account (the OR is name OR vkn OR external
  //     code OR contact). The outer scope still allows the account because
  //     it has at least one AC in `allowedScoped`.
  if (twoAcAccount.name && twoAcAccount.name.length >= 2) {
    const slice = twoAcAccount.name.slice(0, Math.min(4, twoAcAccount.name.length));
    const out = await listAccounts({
      search: slice,
      allowedCompanyIds: allowedScoped,
      limit: 50,
    });
    const found = (out?.accounts ?? []).some((a) => a.id === twoAcAccount.id);
    record('12) Regression — name search still works under scoped allowedCompanyIds',
      found,
      `q="${slice}" found=${found}`,
    );
  } else {
    skip('12) Name regression probe', 'fixture name too short');
  }
}

// Cleanup synthesized fixture.
if (tempAccountId) {
  await prisma.accountCompany.deleteMany({ where: { accountId: tempAccountId } }).catch(() => {});
  await prisma.account.delete({ where: { id: tempAccountId } }).catch(() => {});
}

await prisma.$disconnect();

const failed = results.filter((r) => !r.ok).length;
const skipped = results.filter((r) => r.skipped).length;
console.log(`\n${results.length - failed}/${results.length} passed (${skipped} skipped)`);
process.exit(failed > 0 ? 1 : 0);
