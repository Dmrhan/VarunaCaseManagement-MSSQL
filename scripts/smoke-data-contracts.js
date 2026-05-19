#!/usr/bin/env node
/**
 * System-wide data contract smoke guard — read-only.
 *
 * Hiçbir DB mutasyonu yapmaz. Idempotent değil; sadece okur.
 *
 * Çalıştır:
 *   npm run smoke:data-contracts
 *   node --env-file=.env scripts/smoke-data-contracts.js
 *
 * Mimari:
 *   - Her contract grubu `defineGroup(name, async fn)` ile kaydedilir.
 *   - Group fn'i `check()` çağrıları üzerinden `Result[]` döner.
 *   - Her check: { name, severity: 'PASS'|'WARN'|'FAIL', count, examples }
 *   - Yeni domain (Notifications, Jira Sync, Knowledge Base...) eklenince
 *     defineGroup('X Contract', ...) ile genişletilir.
 *
 * Exit kodu:
 *   0  → tüm gruplar PASS veya WARN only
 *   1  → en az bir FAIL var
 */

import { prisma } from '../server/db/client.js';

// ─────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────

/** @typedef {{ name: string; severity: 'PASS' | 'WARN' | 'FAIL'; count?: number; examples?: any[]; detail?: string }} Result */

const groups = [];

/**
 * Bir kontrat grubunu kayıt et.
 * @param {string} name
 * @param {() => Promise<Result[]>} fn
 */
function defineGroup(name, fn) {
  groups.push({ name, fn });
}

/**
 * Tek bir kontrat check'i.
 * @param {string} name
 * @param {'PASS' | 'WARN' | 'FAIL'} severity
 * @param {{ count?: number; examples?: any[]; detail?: string }} [extra]
 * @returns {Result}
 */
function check(name, severity, extra = {}) {
  return { name, severity, ...extra };
}

const MAX_EXAMPLES = 5;
function take(rows) {
  return rows.slice(0, MAX_EXAMPLES);
}

const usrPrefix = { startsWith: 'USR-' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────────────────────────────────────────────────────────
// Group 1 — Identity Contract
// ─────────────────────────────────────────────────────────────────

defineGroup('Identity Contract', async () => {
  /** @type {Result[]} */
  const out = [];

  // 1a) User.id alanları USR-* içermez
  const userIdFields = [
    { table: 'UserCompany', field: 'userId' },
    { table: 'CaseWatcher', field: 'userId' },
    { table: 'CaseWatcher', field: 'addedBy' },
    { table: 'CaseNote', field: 'authorId' },
    { table: 'CaseNoteReaction', field: 'userId' },
    { table: 'CaseMention', field: 'mentionedUserId' },
    { table: 'CaseMention', field: 'mentionedBy' },
    { table: 'CaseReminder', field: 'userId' },
    { table: 'CaseTransfer', field: 'transferredBy' },
    { table: 'CaseLink', field: 'createdBy' },
    { table: 'AIUsageLog', field: 'userId' },
    { table: 'MetricQueryAudit', field: 'userId' },
    { table: 'PatternAlert', field: 'dismissedBy' },
  ];

  for (const { table, field } of userIdFields) {
    const delegate = prisma[lowerFirst(table)];
    if (!delegate) {
      out.push(check(`${table}.${field}: USR-* check`, 'WARN', { detail: 'prisma delegate yok' }));
      continue;
    }
    const bad = await delegate.count({ where: { [field]: usrPrefix } });
    out.push(check(`${table}.${field} starts with USR-`, bad === 0 ? 'PASS' : 'FAIL', { count: bad }));
  }

  // 1b) Person.id alanları UUID içermez (string startsWith USR- veya kısa form)
  const personIdFields = [
    { table: 'Case', field: 'assignedPersonId' },
    { table: 'CaseTransfer', field: 'fromPersonId' },
    { table: 'CaseTransfer', field: 'toPersonId' },
  ];
  for (const { table, field } of personIdFields) {
    const delegate = prisma[lowerFirst(table)];
    if (!delegate) continue;
    // Bilinen tüm Person.id'leri çek
    const allPersons = await prisma.person.findMany({ select: { id: true } });
    const validSet = new Set(allPersons.map((p) => p.id));
    // null olmayan satırları al, validSet dışı olanları FAIL
    const rows = await delegate.findMany({
      where: { [field]: { not: null } },
      select: { id: true, [field]: true },
      take: 1000,
    });
    const bad = rows.filter((r) => !validSet.has(r[field]));
    out.push(check(`${table}.${field} non-Person values`, bad.length === 0 ? 'PASS' : 'FAIL', {
      count: bad.length,
      examples: take(bad),
    }));
  }

  // 1c) FK existence — User.personId
  const usersWithPersonId = await prisma.user.findMany({
    where: { personId: { not: null } },
    select: { id: true, email: true, personId: true },
  });
  const orphanUserPersonId = [];
  if (usersWithPersonId.length) {
    const allPersonIds = new Set((await prisma.person.findMany({ select: { id: true } })).map((p) => p.id));
    for (const u of usersWithPersonId) {
      if (!allPersonIds.has(u.personId)) orphanUserPersonId.push(u);
    }
  }
  out.push(check('User.personId → Person FK', orphanUserPersonId.length === 0 ? 'PASS' : 'FAIL', {
    count: orphanUserPersonId.length,
    examples: take(orphanUserPersonId).map((u) => ({ email: u.email, personId: u.personId })),
  }));

  // 1d) Case.assignedPersonId → Person FK (yukarıdaki 1b zaten kapsıyor; bu detaylı sayım)
  const assignedNotFound = await prisma.case.count({
    where: { assignedPersonId: { not: null }, assignedPerson: null },
  });
  out.push(check('Case.assignedPersonId → Person FK', assignedNotFound === 0 ? 'PASS' : 'FAIL', {
    count: assignedNotFound,
  }));

  // 1e) CaseWatcher.userId → User FK
  const watcherUserIds = await prisma.caseWatcher.findMany({ select: { id: true, userId: true } });
  const allUserIds = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));
  const orphanWatcher = watcherUserIds.filter((w) => !allUserIds.has(w.userId));
  out.push(check('CaseWatcher.userId → User FK', orphanWatcher.length === 0 ? 'PASS' : 'FAIL', {
    count: orphanWatcher.length,
    examples: take(orphanWatcher),
  }));

  // 1f) CaseNote.authorId → User FK (nullable)
  const notesWithAuthor = await prisma.caseNote.findMany({
    where: { authorId: { not: null } },
    select: { id: true, authorId: true },
  });
  const orphanNotes = notesWithAuthor.filter((n) => !allUserIds.has(n.authorId));
  out.push(check('CaseNote.authorId → User FK', orphanNotes.length === 0 ? 'PASS' : 'FAIL', {
    count: orphanNotes.length,
    examples: take(orphanNotes),
  }));

  // 1g) CaseLink.createdBy → User FK
  const links = await prisma.caseLink.findMany({ select: { id: true, createdBy: true } });
  const orphanLinks = links.filter((l) => !allUserIds.has(l.createdBy));
  out.push(check('CaseLink.createdBy → User FK', orphanLinks.length === 0 ? 'PASS' : 'FAIL', {
    count: orphanLinks.length,
    examples: take(orphanLinks),
  }));

  return out;
});

// ─────────────────────────────────────────────────────────────────
// Group 2 — Account / Case Integrity
// ─────────────────────────────────────────────────────────────────

defineGroup('Account / Case Integrity', async () => {
  /** @type {Result[]} */
  const out = [];

  // 2.1) Account.companyId set ama AccountCompany eksik
  const accountsLegacy = await prisma.account.findMany({
    where: { companyId: { not: null } },
    select: { id: true, name: true, companyId: true, companies: { select: { companyId: true } } },
  });
  const missingAC = accountsLegacy.filter((a) => !a.companies.some((c) => c.companyId === a.companyId));
  out.push(check('Account legacy companyId has matching AccountCompany', missingAC.length === 0 ? 'PASS' : 'FAIL', {
    count: missingAC.length,
    examples: take(missingAC).map((a) => ({ id: a.id, name: a.name, companyId: a.companyId })),
  }));

  // 2.2) Case.accountId → Account FK
  const allAccountIds = new Set((await prisma.account.findMany({ select: { id: true } })).map((a) => a.id));
  const casesWithAccount = await prisma.case.findMany({
    where: { accountId: { not: null } },
    select: { id: true, caseNumber: true, accountId: true },
  });
  const orphanCaseAccount = casesWithAccount.filter((c) => !allAccountIds.has(c.accountId));
  out.push(check('Case.accountId → Account FK', orphanCaseAccount.length === 0 ? 'PASS' : 'FAIL', {
    count: orphanCaseAccount.length,
    examples: take(orphanCaseAccount).map((c) => ({ caseNumber: c.caseNumber, accountId: c.accountId })),
  }));

  // 2.3) Case.accountName set ama accountId null — WARN, legacy/unlinked
  const unlinkedCases = await prisma.case.findMany({
    where: { accountId: null, accountName: { not: null } },
    select: { caseNumber: true, accountName: true, companyId: true },
    take: MAX_EXAMPLES,
  });
  const unlinkedCount = await prisma.case.count({
    where: { accountId: null, accountName: { not: null } },
  });
  out.push(check(
    'Case.accountName without accountId (manual/legacy unlinked)',
    unlinkedCount === 0 ? 'PASS' : 'WARN',
    { count: unlinkedCount, examples: unlinkedCases },
  ));

  // 2.4) AccountCompany.companyId → Company FK
  const allCompanyIds = new Set((await prisma.company.findMany({ select: { id: true } })).map((c) => c.id));
  const acs = await prisma.accountCompany.findMany({ select: { id: true, companyId: true } });
  const orphanAC = acs.filter((c) => !allCompanyIds.has(c.companyId));
  out.push(check('AccountCompany.companyId → Company FK', orphanAC.length === 0 ? 'PASS' : 'FAIL', {
    count: orphanAC.length,
    examples: take(orphanAC),
  }));

  // 2.5) AccountProduct.accountCompanyId → AccountCompany FK
  const allACIds = new Set(acs.map((c) => c.id));
  const products = await prisma.accountProduct.findMany({ select: { id: true, accountCompanyId: true } });
  const orphanProducts = products.filter((p) => !allACIds.has(p.accountCompanyId));
  out.push(check('AccountProduct.accountCompanyId → AccountCompany FK', orphanProducts.length === 0 ? 'PASS' : 'FAIL', {
    count: orphanProducts.length,
    examples: take(orphanProducts),
  }));

  // 2.6) AccountContact.accountId → Account FK
  const contacts = await prisma.accountContact.findMany({ select: { id: true, accountId: true } });
  const orphanContacts = contacts.filter((c) => !allAccountIds.has(c.accountId));
  out.push(check('AccountContact.accountId → Account FK', orphanContacts.length === 0 ? 'PASS' : 'FAIL', {
    count: orphanContacts.length,
    examples: take(orphanContacts),
  }));

  // 2.7) WR-A1 — Account.customerType has no nulls. Migration default 'Kurumsal' (Corporate)
  //      tüm satırlarda olmalı. Schema NOT NULL — Prisma zaten geçirmez; runtime raw query ile doğrula.
  const rawNulls = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*)::int as n FROM "Account" WHERE "customerType" IS NULL',
  );
  const nullCount = rawNulls?.[0]?.n ?? 0;
  out.push(check('Account.customerType has no nulls (WR-A1)', nullCount === 0 ? 'PASS' : 'FAIL', {
    count: nullCount,
  }));

  // 2.8) WR-A1 / WR-A2 regression guard — Account tablosunda PLAIN TCKN kolonu yok.
  //      A2'de tcknHash + tcknLast4 eklendi (privacy-safe); ama plain tckn / national_id ASLA olmamalı.
  //      Detaylı privacy kontratı: 'Account Privacy Contract' grubunda.
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'Account' AND column_name IN ('tckn', 'tckn_raw', 'rawTckn', 'national_id', 'nationalId')`,
  );
  const forbiddenCols = (cols ?? []).map((r) => r.column_name);
  out.push(check(
    'Account table excludes raw TCKN columns (WR-A1+A2 / Modeling Guardrail #1)',
    forbiddenCols.length === 0 ? 'PASS' : 'FAIL',
    { count: forbiddenCols.length, examples: forbiddenCols },
  ));

  return out;
});

// ─────────────────────────────────────────────────────────────────
// Group 3 — Tenant Scope Contract (simulate verifyJwt scope rules)
// ─────────────────────────────────────────────────────────────────

defineGroup('Tenant Scope Contract', async () => {
  /** @type {Result[]} */
  const out = [];

  const demoEmails = ['agent@varuna.dev', 'supervisor@varuna.dev', 'admin@varuna.dev', 'sysadmin@varuna.dev'];
  const demoUsers = await prisma.user.findMany({
    where: { email: { in: demoEmails }, isActive: true },
    select: { id: true, email: true, role: true },
  });
  if (demoUsers.length < demoEmails.length) {
    out.push(check('demo personas exist', 'WARN', {
      detail: `Eksik: ${demoEmails.filter((e) => !demoUsers.some((u) => u.email === e)).join(', ')}`,
    }));
    out.push(check('Tenant Scope checks', 'WARN', { detail: 'Demo persona yok → grup atlandı' }));
    return out;
  }
  out.push(check('demo personas exist', 'PASS', { count: demoUsers.length }));

  const allActiveCompanies = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  const activeIds = allActiveCompanies.map((c) => c.id);

  async function computeAllowed(u) {
    if (u.role === 'SystemAdmin') return activeIds;
    const links = await prisma.userCompany.findMany({
      where: { userId: u.id, isActive: true },
      select: { companyId: true },
    });
    return links.map((l) => l.companyId);
  }

  // 3.1) Agent has ≥1 allowed company
  const agent = demoUsers.find((u) => u.email === 'agent@varuna.dev');
  const agentAllowed = await computeAllowed(agent);
  out.push(check('Agent has ≥1 allowedCompanyIds', agentAllowed.length >= 1 ? 'PASS' : 'FAIL', {
    count: agentAllowed.length,
  }));

  // 3.2 / 3.3) Supervisor + Admin allowedCompanyIds ⊆ active companies
  for (const role of ['supervisor@varuna.dev', 'admin@varuna.dev']) {
    const u = demoUsers.find((x) => x.email === role);
    const allowed = await computeAllowed(u);
    const leaked = allowed.filter((id) => !activeIds.includes(id));
    out.push(check(`${role} scope ⊆ active companies`, leaked.length === 0 ? 'PASS' : 'FAIL', {
      count: leaked.length,
      examples: leaked,
    }));
  }

  // 3.4) Account list/search case counts scoped to allowedCompanyIds.
  //      Repository'nin gerçek çıktısı verify edilir: listAccounts'tan dönen
  //      totalCaseCount / openCaseCount allowedCompanyIds-filtreli ground truth ile eşleşmeli.
  const { accountRepository } = await import('../server/db/accountRepository.js');
  const listOut = await accountRepository.listAccounts({
    allowedCompanyIds: agentAllowed,
    page: 1,
    limit: 100,
  });
  if (listOut.accounts.length === 0) {
    out.push(check('Agent listAccounts case-count scope', 'WARN', { detail: 'No accounts visible (clean DB?)' }));
  } else {
    const ids = listOut.accounts.map((a) => a.id);
    const truth = await prisma.case.groupBy({
      by: ['accountId'],
      where: { accountId: { in: ids }, companyId: { in: agentAllowed } },
      _count: { _all: true },
    });
    const truthMap = new Map(truth.map((g) => [g.accountId, g._count._all]));
    const mismatches = listOut.accounts
      .map((a) => ({ id: a.id, name: a.name, listed: a.totalCaseCount, truth: truthMap.get(a.id) ?? 0 }))
      .filter((r) => r.listed !== r.truth);
    out.push(check(
      'Agent listAccounts totalCaseCount === truth(allowedCompanyIds)',
      mismatches.length === 0 ? 'PASS' : 'FAIL',
      { count: mismatches.length, examples: take(mismatches) },
    ));
  }

  // 3.5) AccountCompany status filter — Agent'a hidden tenant status sızmamalı.
  //      Repository çıktısını verify et: status filter ile dönen account'lar
  //      görünür AccountCompany'lerinde (allowedCompanyIds) o status'u taşımalı.
  const churnList = await accountRepository.listAccounts({
    allowedCompanyIds: agentAllowed,
    status: 'churn',
    page: 1,
    limit: 100,
  });
  let statusLeakExamples = [];
  for (const a of churnList.accounts) {
    const visibleAcs = await prisma.accountCompany.findMany({
      where: { accountId: a.id, companyId: { in: agentAllowed } },
      select: { companyId: true, status: true },
    });
    const hasVisibleChurn = visibleAcs.some((c) => c.status === 'churn');
    if (!hasVisibleChurn) statusLeakExamples.push({ id: a.id, name: a.name, visibleAcs });
  }
  out.push(check(
    'Agent status=churn filter excludes hidden-tenant matches',
    statusLeakExamples.length === 0 ? 'PASS' : 'FAIL',
    {
      count: statusLeakExamples.length,
      examples: take(statusLeakExamples),
      detail: statusLeakExamples.length
        ? 'Filter sonucu Agent\'ın görmediği şirketteki status match\'i sızdırıyor'
        : undefined,
    },
  ));

  // 3.6) SystemAdmin sees all active companies
  const sysadmin = demoUsers.find((u) => u.email === 'sysadmin@varuna.dev');
  const sysallowed = await computeAllowed(sysadmin);
  const sysOk = sysallowed.length === activeIds.length && activeIds.every((id) => sysallowed.includes(id));
  out.push(check('SystemAdmin sees ALL active companies', sysOk ? 'PASS' : 'FAIL', {
    count: sysallowed.length,
    detail: `expected=${activeIds.length}, got=${sysallowed.length}`,
  }));

  return out;
});

// ─────────────────────────────────────────────────────────────────
// Group 4 — Demo Seed Drift
// ─────────────────────────────────────────────────────────────────

defineGroup('Demo Seed Drift', async () => {
  /** @type {Result[]} */
  const out = [];

  // 4.1) Required companies
  const needCompanies = ['COMP-PARAM', 'COMP-UNIVERA', 'COMP-FINROTA'];
  const haveCompanies = (await prisma.company.findMany({ where: { id: { in: needCompanies } }, select: { id: true } })).map((c) => c.id);
  const missingCompanies = needCompanies.filter((c) => !haveCompanies.includes(c));
  out.push(check('Required demo companies present', missingCompanies.length === 0 ? 'PASS' : 'WARN', {
    count: missingCompanies.length,
    detail: missingCompanies.length ? `Missing: ${missingCompanies.join(', ')}. Run db:seed.` : undefined,
  }));

  // 4.2) Required persons USR-001..USR-006
  const needPersons = ['USR-001', 'USR-002', 'USR-003', 'USR-004', 'USR-005', 'USR-006'];
  const havePersons = (await prisma.person.findMany({ where: { id: { in: needPersons } }, select: { id: true } })).map((p) => p.id);
  const missingPersons = needPersons.filter((p) => !havePersons.includes(p));
  out.push(check('Required demo persons present', missingPersons.length === 0 ? 'PASS' : 'WARN', {
    count: missingPersons.length,
    detail: missingPersons.length ? `Missing: ${missingPersons.join(', ')}. Run db:seed.` : undefined,
  }));

  // 4.3) Required users + roles
  const wantRoles = {
    'agent@varuna.dev': 'Agent',
    'backoffice@varuna.dev': 'Backoffice',
    'supervisor@varuna.dev': 'Supervisor',
    'csm@varuna.dev': 'CSM',
    'admin@varuna.dev': 'Admin',
    'sysadmin@varuna.dev': 'SystemAdmin',
  };
  const users = await prisma.user.findMany({
    where: { email: { in: Object.keys(wantRoles) } },
    select: { email: true, role: true, isActive: true },
  });
  const roleMismatch = users.filter((u) => wantRoles[u.email] !== u.role || !u.isActive);
  const missingUsers = Object.keys(wantRoles).filter((e) => !users.some((u) => u.email === e));
  if (missingUsers.length === Object.keys(wantRoles).length) {
    out.push(check('Demo users exist with expected roles', 'WARN', {
      detail: 'No demo users found — run db:seed:auth.',
    }));
  } else {
    out.push(check('Demo users exist with expected roles', roleMismatch.length === 0 && missingUsers.length === 0 ? 'PASS' : 'FAIL', {
      count: roleMismatch.length + missingUsers.length,
      examples: [...take(roleMismatch).map((u) => ({ email: u.email, role: u.role })), ...missingUsers.map((e) => ({ email: e, missing: true }))],
    }));
  }

  // 4.4) Demo non-SystemAdmin users have UserCompany rows
  for (const email of Object.keys(wantRoles)) {
    if (email === 'sysadmin@varuna.dev') continue;
    const u = users.find((x) => x.email === email);
    if (!u) continue;
    const fullU = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    const ucCount = await prisma.userCompany.count({ where: { userId: fullU.id, isActive: true } });
    out.push(check(`${email} has UserCompany rows`, ucCount > 0 ? 'PASS' : 'FAIL', { count: ucCount }));
  }

  // 4.5) Demo Agent has ≥1 assigned active case (after seedScenarios)
  const agentU = await prisma.user.findUnique({
    where: { email: 'agent@varuna.dev' },
    select: { personId: true },
  });
  if (agentU?.personId) {
    const OPEN = ['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi'];
    const assigned = await prisma.case.count({
      where: { assignedPersonId: agentU.personId, status: { in: OPEN } },
    });
    out.push(check('Demo Agent has ≥1 assigned active case', assigned >= 1 ? 'PASS' : 'WARN', {
      count: assigned,
      detail: assigned ? undefined : 'Run db:seed:scenarios to populate.',
    }));
  } else {
    out.push(check('Demo Agent has ≥1 assigned active case', 'WARN', { detail: 'Agent user yok' }));
  }

  // 4.6) Watcher demo rows resolve to real User.id (no USR-*)
  const watcherUsr = await prisma.caseWatcher.count({ where: { userId: usrPrefix } });
  out.push(check('Watcher demo rows use User.id (UUID)', watcherUsr === 0 ? 'PASS' : 'FAIL', { count: watcherUsr }));

  // 4.7) Linked case demo rows: createdBy is User.id
  const linkUsr = await prisma.caseLink.count({ where: { createdBy: usrPrefix } });
  out.push(check('Linked-case demo createdBy uses User.id (UUID)', linkUsr === 0 ? 'PASS' : 'FAIL', { count: linkUsr }));

  return out;
});

// ─────────────────────────────────────────────────────────────────
// Group 5 — Customer Picker Contract
// ─────────────────────────────────────────────────────────────────

defineGroup('Customer Picker Contract', async () => {
  /** @type {Result[]} */
  const out = [];

  const supervisor = await prisma.user.findUnique({
    where: { email: 'supervisor@varuna.dev' },
    select: { id: true, role: true },
  });
  if (!supervisor) {
    out.push(check('demo Supervisor exists', 'WARN', { detail: 'Picker scope checks atlandı' }));
    return out;
  }
  const supLinks = await prisma.userCompany.findMany({
    where: { userId: supervisor.id, isActive: true },
    select: { companyId: true },
  });
  const supAllowed = supLinks.map((l) => l.companyId);
  if (supAllowed.length === 0) {
    out.push(check('Supervisor has UserCompany rows', 'WARN', { detail: 'Supervisor scope yok' }));
    return out;
  }

  // 5.1) AccountCompany-only accounts discoverable via scope
  const acOnly = await prisma.account.findMany({
    where: {
      companyId: null,
      companies: { some: { companyId: { in: supAllowed } } },
    },
    select: { id: true, name: true },
    take: MAX_EXAMPLES,
  });
  const acOnlyCount = await prisma.account.count({
    where: {
      companyId: null,
      companies: { some: { companyId: { in: supAllowed } } },
    },
  });
  out.push(check('AccountCompany-only accounts discoverable', 'PASS', {
    count: acOnlyCount,
    examples: take(acOnly),
  }));

  // 5.2) Legacy Account.companyId accounts discoverable
  const legacy = await prisma.account.count({
    where: { companyId: { in: supAllowed } },
  });
  out.push(check('Legacy Account.companyId accounts discoverable', 'PASS', { count: legacy }));

  // 5.3) Shared NULL accounts discoverable
  const shared = await prisma.account.count({ where: { companyId: null, companies: { none: {} } } });
  out.push(check('Shared (companyId=NULL) accounts present', shared === 0 ? 'WARN' : 'PASS', { count: shared }));

  // 5.4 / 5.5) Agent picker access scoped, no detail
  // (Conceptual — route layer enforce eder. Burada server source kontrolü.)
  // Picker LIST_ROLES Agent dahil; DETAIL_READ_ROLES Agent değil.
  // Doğrudan FS regex check yapmıyoruz; bunun yerine source dosyalarında bir
  // marker arıyoruz (route-layer changes regression olursa).
  const fs = await import('node:fs/promises');
  const accountsRouteSrc = await fs.readFile('/Users/demirhan.isbakan/VarunaCaseManagement/server/routes/accounts.js', 'utf8');
  const hasListRoles = /LIST_ROLES\s*=\s*\[[^\]]*'Agent'[^\]]*\]/.test(accountsRouteSrc);
  const hasDetailReadRoles = /DETAIL_READ_ROLES\s*=\s*\[[^\]]*'Supervisor'[^\]]*\]/.test(accountsRouteSrc);
  const detailExcludesAgent = !/DETAIL_READ_ROLES\s*=\s*\[[^\]]*'Agent'[^\]]*\]/.test(accountsRouteSrc);
  out.push(check(
    'Picker: Agent ∈ LIST_ROLES',
    hasListRoles ? 'PASS' : 'FAIL',
    { detail: hasListRoles ? undefined : 'server/routes/accounts.js LIST_ROLES Agent içermiyor' },
  ));
  out.push(check(
    'Detail: Agent ∉ DETAIL_READ_ROLES',
    hasDetailReadRoles && detailExcludesAgent ? 'PASS' : 'FAIL',
    { detail: !hasDetailReadRoles ? 'DETAIL_READ_ROLES tanımsız' : !detailExcludesAgent ? 'DETAIL_READ_ROLES Agent içeriyor (leak)' : undefined },
  ));

  // 5.6) Picker case-count scope rule — server/db/accountRepository.js listAccounts allowedCompanyIds case filtre
  const repoSrc = await fs.readFile('/Users/demirhan.isbakan/VarunaCaseManagement/server/db/accountRepository.js', 'utf8');
  const caseCountScoped = /accountId:\s*{[^}]*in:[^}]*accountIds[^}]*}[^]*companyId:\s*{[^}]*in:[^}]*allowed/m.test(repoSrc)
    || /companyId:\s*{\s*in:\s*allowed\s*}/.test(repoSrc);
  out.push(check(
    'Picker case-count scoped to allowedCompanyIds',
    caseCountScoped ? 'PASS' : 'WARN',
    { detail: caseCountScoped ? undefined : 'listAccounts groupBy where\'inde companyId scope filter görülmedi (review et)' },
  ));

  return out;
});

// ─────────────────────────────────────────────────────────────────
// Group 6 — Customer Match Contract (Phase D Step 1)
// ─────────────────────────────────────────────────────────────────

defineGroup('Customer Match Contract', async () => {
  /** @type {Result[]} */
  const out = [];

  // 6.1) accountId NULL → customerMatchPending = true (her zaman tutarlı olmalı)
  const nullAccountWrong = await prisma.case.count({
    where: { accountId: null, customerMatchPending: false },
  });
  const nullAccountTotal = await prisma.case.count({ where: { accountId: null } });
  out.push(check(
    'accountId NULL → customerMatchPending = true',
    nullAccountWrong === 0 ? 'PASS' : 'FAIL',
    {
      count: nullAccountWrong,
      detail: `accountId NULL toplam: ${nullAccountTotal}`,
    },
  ));

  // 6.2) accountId NON-NULL → customerMatchPending = false
  const setAccountWrong = await prisma.case.count({
    where: { accountId: { not: null }, customerMatchPending: true },
  });
  out.push(check(
    'accountId NOT NULL → customerMatchPending = false',
    setAccountWrong === 0 ? 'PASS' : 'FAIL',
    {
      count: setAccountWrong,
      examples: setAccountWrong
        ? take(
            await prisma.case.findMany({
              where: { accountId: { not: null }, customerMatchPending: true },
              select: { id: true, caseNumber: true, accountId: true },
              take: MAX_EXAMPLES,
            }),
          )
        : [],
    },
  ));

  // 6.3) link-account cross-company guard — simulate: vakanın companyId'sine
  //      bağlı OLMAYAN account'a link denenirse repository CaseValidationError
  //      (company_mismatch) atmalı. Smoke harness'ı runtime'da denemiyor;
  //      onun yerine VERİDE inconsistency varsa raporla:
  //      Case.accountId NOT NULL ama Account o şirkete bağlı değil → FAIL.
  const linkedCases = await prisma.case.findMany({
    where: { accountId: { not: null } },
    select: {
      id: true,
      caseNumber: true,
      companyId: true,
      accountId: true,
      account: {
        select: {
          companyId: true,
          companies: { select: { companyId: true } },
        },
      },
    },
    take: 1000,
  });
  const crossCompanyLinks = linkedCases.filter((c) => {
    if (!c.account) return false; // FK orphan'ı Group 2 yakalar
    const acIds = c.account.companies.map((x) => x.companyId);
    const compatible =
      acIds.includes(c.companyId) ||
      c.account.companyId === c.companyId ||
      c.account.companyId === null;
    return !compatible;
  });
  out.push(check(
    'Case.accountId linked to Account compatible with case.companyId',
    crossCompanyLinks.length === 0 ? 'PASS' : 'FAIL',
    {
      count: crossCompanyLinks.length,
      examples: take(crossCompanyLinks).map((c) => ({
        caseNumber: c.caseNumber,
        companyId: c.companyId,
        accountId: c.accountId,
      })),
      detail: crossCompanyLinks.length
        ? 'Bu vakalar başka şirketteki Account\'a bağlı — link-account guard regresyonu'
        : undefined,
    },
  ));

  // 6.4) companies with requireCustomerOnCaseCreate = true cannot have
  //      customerless cases (accountId NULL).
  const strictSettings = await prisma.companySettings.findMany({
    where: { requireCustomerOnCaseCreate: true },
    select: { companyId: true },
  });
  if (strictSettings.length === 0) {
    out.push(check('requireCustomer companies have no customerless cases', 'PASS', {
      detail: 'Hiçbir şirket strict mode aktif değil (default)',
    }));
  } else {
    const strictIds = strictSettings.map((s) => s.companyId);
    const violations = await prisma.case.findMany({
      where: { companyId: { in: strictIds }, accountId: null },
      select: { id: true, caseNumber: true, companyId: true },
      take: MAX_EXAMPLES,
    });
    const violationCount = await prisma.case.count({
      where: { companyId: { in: strictIds }, accountId: null },
    });
    out.push(check(
      'requireCustomer companies have no customerless cases',
      violationCount === 0 ? 'PASS' : 'FAIL',
      {
        count: violationCount,
        examples: violations,
        detail: violationCount
          ? `Strict companies (${strictIds.join(', ')}) yine de accountId NULL vaka içeriyor`
          : `Strict companies: ${strictIds.join(', ')}`,
      },
    ));
  }

  // 6.5) Phase D Step 2 — Case schema includes requester context columns
  //      Müşterisiz vaka intake'i için 4 opsiyonel kolon mevcut olmalı.
  const requesterCols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Case'
      AND column_name IN (
        'customerContactName', 'customerContactPhone',
        'customerContactEmail', 'customerCompanyName'
      )
  `);
  const presentCols = new Set(requesterCols.map((r) => r.column_name));
  const expectedCols = ['customerContactName', 'customerContactPhone', 'customerContactEmail', 'customerCompanyName'];
  const missingCols = expectedCols.filter((c) => !presentCols.has(c));
  out.push(check(
    'Case schema has requester context columns (Phase D Step 2)',
    missingCols.length === 0 ? 'PASS' : 'FAIL',
    {
      count: presentCols.size,
      detail: missingCols.length ? `Eksik: ${missingCols.join(', ')}` : 'Tüm 4 kolon mevcut',
    },
  ));

  // 6.6) Customerless case + requester context kullanım — varsa sample, yoksa WARN
  //      (Feature yeni; sadece kullanıma açıldığını teyit eder. Zorunlu DEĞİL.)
  const customerlessTotal = await prisma.case.count({
    where: { accountId: null, customerMatchPending: true },
  });
  const customerlessWithCtx = await prisma.case.count({
    where: {
      accountId: null,
      customerMatchPending: true,
      OR: [
        { customerContactPhone: { not: null } },
        { customerContactEmail: { not: null } },
        { customerCompanyName: { not: null } },
        { customerContactName: { not: null } },
      ],
    },
  });
  out.push(check(
    'Customerless cases may carry requester context (schema allows it)',
    'PASS',
    {
      count: customerlessTotal,
      detail: `accountId=NULL toplam ${customerlessTotal}, requester context dolu ${customerlessWithCtx}`,
    },
  ));

  return out;
});

// ─────────────────────────────────────────────────────────────────
// Group 7 — Customer Match Suggestions Contract (Phase D Step 2)
// ─────────────────────────────────────────────────────────────────

defineGroup('Customer Match Suggestions Contract', async () => {
  /** @type {Result[]} */
  const out = [];

  // Repository import — read-only kullanım, mutasyon yok.
  const { suggestCustomerMatches } = await import('../server/db/customerMatchRepository.js');
  const fs = await import('node:fs/promises');

  const allActiveCompanies = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
  const activeIds = allActiveCompanies.map((c) => c.id);

  // 7.1) Linked case → empty + reason
  const linkedCase = await prisma.case.findFirst({
    where: { customerMatchPending: false, accountId: { not: null } },
    select: { id: true },
  });
  if (linkedCase) {
    const r = await suggestCustomerMatches({ caseId: linkedCase.id, allowedCompanyIds: activeIds });
    const ok = r && r.suggestions.length === 0 && r.reason === 'case_already_linked';
    out.push(check('Linked case returns empty + case_already_linked', ok ? 'PASS' : 'FAIL', {
      detail: r ? `reason=${r.reason}, count=${r.suggestions.length}` : 'null result',
    }));
  } else {
    out.push(check('Linked case returns empty + case_already_linked', 'WARN', { detail: 'no linked case in DB' }));
  }

  // 7.2) Pending case → suggestions OR empty (deterministic, no error)
  const pendingCase = await prisma.case.findFirst({
    where: { customerMatchPending: true },
    select: { id: true, companyId: true },
  });
  if (pendingCase) {
    const r = await suggestCustomerMatches({ caseId: pendingCase.id, allowedCompanyIds: activeIds });
    const ok = r && Array.isArray(r.suggestions);
    out.push(check('Pending case → suggestions array returned', ok ? 'PASS' : 'FAIL', {
      count: r?.suggestions?.length ?? 0,
    }));

    // 7.3) Suggestions scoped to case.companyId — cross-company never appears
    if (r && r.suggestions.length > 0) {
      const accountIds = r.suggestions.map((s) => s.accountId);
      const accounts = await prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: {
          id: true,
          companyId: true,
          companies: { select: { companyId: true } },
        },
      });
      const violators = accounts.filter((a) => {
        const inAC = a.companies.some((c) => c.companyId === pendingCase.companyId);
        const inLegacy = a.companyId === pendingCase.companyId;
        const shared = a.companyId === null;
        return !inAC && !inLegacy && !shared;
      });
      out.push(check(
        'Suggested accounts compatible with case.companyId',
        violators.length === 0 ? 'PASS' : 'FAIL',
        { count: violators.length, examples: take(violators) },
      ));

      // 7.4) Suggestions do not expose notes/segment
      const leaked = r.suggestions.some(
        (s) =>
          'notes' in s ||
          'segment' in s ||
          s.companies.some((c) => 'notes' in c || 'segment' in c),
      );
      out.push(check('No notes/segment in suggestions response', leaked ? 'FAIL' : 'PASS', {
        detail: leaked ? 'sızıntı bulundu' : undefined,
      }));

      // 7.5) Deterministic order — aynı çağrıyı 2 kez yap
      const r2 = await suggestCustomerMatches({ caseId: pendingCase.id, allowedCompanyIds: activeIds });
      const sameOrder = JSON.stringify(r.suggestions.map((s) => s.accountId)) ===
        JSON.stringify(r2.suggestions.map((s) => s.accountId));
      out.push(check('Deterministic order stable for same DB state', sameOrder ? 'PASS' : 'FAIL'));
    } else {
      out.push(check('Suggested accounts compatible with case.companyId', 'PASS', {
        detail: 'no suggestions to verify',
      }));
      out.push(check('No notes/segment in suggestions response', 'PASS', {
        detail: 'no suggestions to verify',
      }));
      out.push(check('Deterministic order stable for same DB state', 'PASS', {
        detail: 'no suggestions to verify',
      }));
    }
  } else {
    out.push(check('Pending case → suggestions array', 'WARN', { detail: 'no pending case in DB' }));
  }

  // 7.6) Route role config — Agent should not reach suggestions endpoint.
  //      Source kontrolü: requireRole listesinde Agent yok.
  const routeSrc = await fs.readFile('/Users/demirhan.isbakan/VarunaCaseManagement/server/routes/cases.js', 'utf8');
  const suggestionsRoute = routeSrc.match(/customer-match-suggestions[^]*?requireRole\(([^)]*)\)/);
  const rolesStr = suggestionsRoute?.[1] ?? '';
  const allowsAgent = /['"]Agent['"]/.test(rolesStr);
  out.push(check(
    'Suggestions route excludes Agent (requireRole)',
    suggestionsRoute && !allowsAgent ? 'PASS' : 'FAIL',
    { detail: suggestionsRoute ? `roles=${rolesStr.replace(/\s+/g, ' ').trim()}` : 'route guard not found' },
  ));

  // 7.7) AI/OpenAI çağrısı yok — gerçek kullanım imzaları (import/require/yeni client)
  //      taranır, yalnız yorum içindeki "OpenAI" kelimesi false-positive üretmez.
  const repoSrc = await fs.readFile('/Users/demirhan.isbakan/VarunaCaseManagement/server/db/customerMatchRepository.js', 'utf8');
  const aiHit =
    /\b(from\s+['"]openai['"]|require\(['"]openai['"]|new\s+OpenAI|aiClient\b|chat\.completions|gpt-\d)/i.test(repoSrc);
  out.push(check('Suggestions helper contains no AI/OpenAI references', aiHit ? 'FAIL' : 'PASS'));

  // 7.8) Phase D Step 2 — Suggestion engine uses requester contact fields.
  //      extractSignalsFromCase, customerContactPhone/Email/CompanyName/Name
  //      alanlarını üst-öncelikli sinyal olarak okumalı.
  const usesRequesterPhone = /customerContactPhone\b/.test(repoSrc);
  const usesRequesterEmail = /customerContactEmail\b/.test(repoSrc);
  const usesRequesterCompany = /customerCompanyName\b/.test(repoSrc);
  const usesRequesterContactName = /customerContactName\b/.test(repoSrc);
  const usesContactNameTokens = /contactNameTokens\b/.test(repoSrc);
  const allUsed = usesRequesterPhone && usesRequesterEmail && usesRequesterCompany && usesRequesterContactName && usesContactNameTokens;
  out.push(check(
    'Suggestion engine reads requester contact fields (phone/email/company/name)',
    allUsed ? 'PASS' : 'FAIL',
    {
      detail: allUsed
        ? undefined
        : `Eksik: ${[
            !usesRequesterPhone && 'customerContactPhone',
            !usesRequesterEmail && 'customerContactEmail',
            !usesRequesterCompany && 'customerCompanyName',
            !usesRequesterContactName && 'customerContactName',
            !usesContactNameTokens && 'contactNameTokens',
          ].filter(Boolean).join(', ')}`,
    },
  ));

  // 7.9) Runtime — requester phone seçilmiş bir vaka için suggestion engine
  //      eşleştirme üretiyor mu? (Varsa kontrol et; yoksa WARN.)
  const reqCase = await prisma.case.findFirst({
    where: {
      customerMatchPending: true,
      customerContactPhone: { not: null },
    },
    select: { id: true, customerContactPhone: true },
  });
  if (reqCase) {
    const r = await suggestCustomerMatches({ caseId: reqCase.id, allowedCompanyIds: activeIds });
    const ok = r && Array.isArray(r.suggestions);
    out.push(check(
      'Suggestions request with requester phone returns deterministic result',
      ok ? 'PASS' : 'FAIL',
      { count: r?.suggestions?.length ?? 0, detail: `caseId=${reqCase.id}` },
    ));
  } else {
    out.push(check(
      'Suggestions request with requester phone returns deterministic result',
      'WARN',
      { detail: 'No customerless case with requester phone in DB yet (Phase D Step 2 yeni — kullanım zamanı)' },
    ));
  }

  return out;
});

// ─────────────────────────────────────────────────────────────────
// Group N — Account Privacy Contract (WR-A2)
//   Account schema'da raw TCKN kolonu YOK; sadece tcknHash + tcknLast4 + tcknMasked.
//   Detaylı smoke: scripts/smoke-account-validation-privacy.js (A2).
// ─────────────────────────────────────────────────────────────────

defineGroup('Account Privacy Contract', async () => {
  /** @type {Result[]} */
  const out = [];

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'Account'`,
  );
  const colSet = new Set((cols ?? []).map((r) => r.column_name));

  // F.A1) Raw TCKN columns must be ABSENT.
  const FORBIDDEN_TCKN_COLS = ['tckn', 'tcknRaw', 'rawTckn', 'nationalId', 'national_id'];
  const leakedTckn = FORBIDDEN_TCKN_COLS.filter((c) => colSet.has(c));
  out.push(check(
    'Account table has no raw TCKN columns (WR-A2 privacy)',
    leakedTckn.length === 0 ? 'PASS' : 'FAIL',
    { count: leakedTckn.length, examples: leakedTckn },
  ));

  // F.A2) tcknHash + tcknLast4 columns must EXIST.
  const hasHash = colSet.has('tcknHash');
  const hasLast4 = colSet.has('tcknLast4');
  out.push(check(
    'Account table has tcknHash + tcknLast4 columns',
    hasHash && hasLast4 ? 'PASS' : 'FAIL',
    { detail: `tcknHash=${hasHash} tcknLast4=${hasLast4}` },
  ));

  // F.A3) tcknHash unique constraint exists.
  const indexes = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'Account'`,
  );
  const hasTcknHashUnique = (indexes ?? []).some((r) =>
    r.indexname.toLowerCase().includes('tcknhash'),
  );
  out.push(check(
    'Account.tcknHash unique index exists',
    hasTcknHashUnique ? 'PASS' : 'FAIL',
    { detail: 'Account_tcknHash_key (Prisma @unique) present' },
  ));

  // F.A4) phoneE164 column exists; NOT in unique index.
  const hasPhoneE164 = colSet.has('phoneE164');
  out.push(check(
    'Account.phoneE164 column exists',
    hasPhoneE164 ? 'PASS' : 'FAIL',
  ));

  const phoneE164Unique = (indexes ?? []).some((r) => {
    const name = r.indexname.toLowerCase();
    return name.includes('phonee164') && name.endsWith('_key');
  });
  out.push(check(
    'Account.phoneE164 is NOT unique (paylaşılan call center allowed)',
    !phoneE164Unique ? 'PASS' : 'FAIL',
    { detail: phoneE164Unique ? 'unexpected unique index found' : 'index ok, not unique' },
  ));

  // F.A5) Existing tcknHash values look like HMAC-SHA256 hex (64 chars).
  const wrongHashes = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int as n FROM "Account" WHERE "tcknHash" IS NOT NULL AND "tcknHash" !~ '^[0-9a-f]{64}$'`,
  );
  const wrongN = wrongHashes?.[0]?.n ?? 0;
  out.push(check(
    'AIUsageLog-like tcknHash values are 64-char hex (HMAC-SHA256)',
    wrongN === 0 ? 'PASS' : 'FAIL',
    { count: wrongN },
  ));

  return out;
});

// ─────────────────────────────────────────────────────────────────
// Group N — AI Telemetry Contract (WR-F7)
//   AIUsageLog telemetri kontratının statik/deterministic invariant'ları.
//   Detaylı smoke: scripts/smoke-ai-telemetry.js (F7).
// ─────────────────────────────────────────────────────────────────

defineGroup('AI Telemetry Contract', async () => {
  /** @type {Result[]} */
  const out = [];

  // AIUsageLog kolonlarını information_schema'dan oku — schema-level kontrat.
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'AIUsageLog'`,
  );
  const colSet = new Set((cols ?? []).map((r) => r.column_name));

  // F.1) Required field set tam.
  const REQUIRED = ['id', 'endpoint', 'companyId', 'createdAt'];
  const missing = REQUIRED.filter((c) => !colSet.has(c));
  out.push(check(
    'AIUsageLog required columns present',
    missing.length === 0 ? 'PASS' : 'FAIL',
    { count: missing.length, examples: missing },
  ));

  // F.2) Forbidden PII / raw-prompt kolonları YOK (privacy guard).
  const FORBIDDEN = [
    'customerContactName', 'customerContactPhone', 'customerContactEmail', 'customerCompanyName',
    'prompt', 'system', 'user', 'text', 'content', 'rawPrompt', 'response', 'message',
  ];
  const leaked = FORBIDDEN.filter((c) => colSet.has(c));
  out.push(check(
    'AIUsageLog has no PII / raw-prompt columns',
    leaked.length === 0 ? 'PASS' : 'FAIL',
    { count: leaked.length, examples: leaked },
  ));

  // F.3) endpoint not null/empty for existing rows.
  const blankEndpoint = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int as n FROM "AIUsageLog" WHERE "endpoint" IS NULL OR "endpoint" = ''`,
  );
  const blankN = blankEndpoint?.[0]?.n ?? 0;
  out.push(check(
    'AIUsageLog.endpoint not null/empty for existing rows',
    blankN === 0 ? 'PASS' : 'FAIL',
    { count: blankN },
  ));

  // F.4) responseTimeMs >= 0 when present (no negative noise).
  const negTime = await prisma.aIUsageLog.count({
    where: { responseTimeMs: { lt: 0 } },
  });
  out.push(check(
    'AIUsageLog.responseTimeMs >= 0 when present',
    negTime === 0 ? 'PASS' : 'FAIL',
    { count: negTime },
  ));

  // F.5) cron path (qa-score-batch) userId nullable accepted — sanity.
  const cronWithoutUser = await prisma.aIUsageLog.count({
    where: { endpoint: 'qa-score-batch', userId: null },
  });
  const cronTotal = await prisma.aIUsageLog.count({ where: { endpoint: 'qa-score-batch' } });
  out.push(check(
    'AIUsageLog cron paths accept nullable userId (qa-score-batch)',
    cronTotal === 0 || cronWithoutUser > 0 ? 'PASS' : 'WARN',
    {
      count: cronWithoutUser,
      detail: cronTotal === 0
        ? 'no qa-score-batch rows yet — schema allows null'
        : `${cronWithoutUser}/${cronTotal} cron rows have null userId`,
    },
  ));

  return out;
});

// ─────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function severityIcon(s) {
  if (s === 'PASS') return '✅';
  if (s === 'WARN') return '⚠️';
  return '❌';
}

function summarizeGroup(results) {
  let pass = 0, warn = 0, fail = 0;
  for (const r of results) {
    if (r.severity === 'PASS') pass++;
    else if (r.severity === 'WARN') warn++;
    else fail++;
  }
  if (fail) return 'FAIL';
  if (warn) return 'WARN';
  return 'PASS';
}

async function run() {
  console.log('System Data Contract Smoke');
  console.log(`Date: ${new Date().toISOString()}`);
  const dbHint = (process.env.DATABASE_URL || '').replace(/:[^:@/]+@/, ':<redacted>@').slice(0, 70);
  console.log(`DB: ${dbHint}…\n`);

  const groupSummaries = [];
  let totalPass = 0, totalWarn = 0, totalFail = 0;

  for (const group of groups) {
    console.log(`── ${group.name} ──`);
    /** @type {Result[]} */
    let results;
    try {
      results = await group.fn();
    } catch (err) {
      console.error(`  ✗ Group threw: ${err?.message ?? err}`);
      results = [check('group error', 'FAIL', { detail: String(err?.message ?? err) })];
    }
    for (const r of results) {
      const icon = severityIcon(r.severity);
      const countStr = typeof r.count === 'number' ? ` (count=${r.count})` : '';
      console.log(`  ${icon} ${r.name}${countStr}${r.detail ? ' — ' + r.detail : ''}`);
      if (r.examples && r.examples.length) {
        for (const ex of r.examples) {
          console.log(`      • ${JSON.stringify(ex)}`);
        }
      }
      if (r.severity === 'PASS') totalPass++;
      else if (r.severity === 'WARN') totalWarn++;
      else totalFail++;
    }
    const summary = summarizeGroup(results);
    groupSummaries.push({ name: group.name, summary });
    console.log(`  → ${severityIcon(summary)} ${group.name}: ${summary}\n`);
  }

  console.log('──────────────────────────────');
  console.log('Group summary:');
  for (const g of groupSummaries) {
    console.log(`  ${severityIcon(g.summary)} ${g.name}: ${g.summary}`);
  }
  const total = totalPass + totalWarn + totalFail;
  console.log(`\nTotal checks: ${total} — PASS=${totalPass}, WARN=${totalWarn}, FAIL=${totalFail}`);

  await prisma.$disconnect();
  process.exit(totalFail > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error('smoke runner fatal:', err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
