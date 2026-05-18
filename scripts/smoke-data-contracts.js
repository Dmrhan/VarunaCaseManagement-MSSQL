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
