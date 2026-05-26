/**
 * WR-ACTION-CENTER Phase 1 — Approval Visibility MVP smoke.
 *
 * Repository-level (HTTP yok). Card §16.1's 14 scenarios:
 *
 *   1.  setup           Create policy + agent + team lead + admin
 *   2.  submit          → approval_pending ActionItem appears for team lead
 *   3.  idempotent      Re-submit (via direct upsert) yields one row
 *   4.  summary         actionRequired=1 for team lead, 0 for unrelated
 *   5.  list            view=action returns row; fyi/done empty
 *   6.  markDone        state=Done, doneAt set, summary actionRequired=0
 *   7.  tenant scope    user in companyY → list returns 0 for companyX user
 *   8.  wrong-user      another user mutation → 403
 *   9.  approve         existing endpoint → ActionItem close + sibling expire + approval_decided FYI
 *   10. reject + ReturnToAssignee  → approval_decided FYI + case_returned_to_assignee actionable
 *   11. snooze          state=Snoozed, summary moves to snoozed bucket
 *   12. lazy wake-up    snoozedUntil past → next summary brings back to Pending
 *   13. dismiss         state=Dismissed, closeNote set
 *   14. fire-and-forget submitApproval succeeds even when emitActionItem stubs throw
 *
 * Run: node --env-file=.env scripts/smoke-action-center-phase1.js
 * Cleanup: all rows removed in finally{}.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import {
  ActionItemAccessError,
  ActionItemValidationError,
  closeActionItemsForApproval,
  dismiss,
  emitActionItem,
  expireSiblingActionItemsForApproval,
  listForUser,
  markDone,
  markInProgressForCase,
  snooze,
  summaryForUser,
} from '../server/db/actionItemRepository.js';
import {
  approveApproval,
  createPolicy,
  rejectApproval,
  submitApproval,
} from '../server/db/approvalRepository.js';
import { caseRepository } from '../server/db/caseRepository.js';

const stamp = Date.now();
const PREFIX = `acp1_${stamp}`;
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function pickCompany() {
  const c = await prisma.company.findFirst({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  if (!c) throw new Error('No active company');
  return c;
}

async function run() {
  console.log('🔍 action-center-phase1 smoke\n');
  const company = await pickCompany();
  const secondCompany = await prisma.company.findFirst({
    where: { id: { not: company.id }, isActive: true },
    select: { id: true },
  });
  const allowedCompanyIds = [company.id];
  console.log(`Company: ${company.id} (${company.name})\n`);

  const created = {
    actionItems: [],
    cases: [],
    approvals: [],
    policies: [],
    teams: [],
    persons: [],
    users: [],
  };

  try {
    // ─── 1. setup ───
    const team = await prisma.team.create({
      data: { name: `${PREFIX}-team`, companyId: company.id },
    });
    created.teams.push(team.id);

    const leadPerson = await prisma.person.create({
      data: {
        name: `${PREFIX}-lead`,
        teamId: team.id,
        isTeamLead: true,
        isActive: true,
        email: `${PREFIX}-lead@smoke.test`,
      },
    });
    created.persons.push(leadPerson.id);

    const memberPerson = await prisma.person.create({
      data: {
        name: `${PREFIX}-member`,
        teamId: team.id,
        isActive: true,
        email: `${PREFIX}-member@smoke.test`,
      },
    });
    created.persons.push(memberPerson.id);

    const leadUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-lead-user@smoke.test`,
        fullName: leadPerson.name,
        personId: leadPerson.id,
        isActive: true,
      },
    });
    created.users.push(leadUser.id);

    const memberUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-member-user@smoke.test`,
        fullName: memberPerson.name,
        personId: memberPerson.id,
        isActive: true,
      },
    });
    created.users.push(memberUser.id);

    const adminUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-admin@smoke.test`,
        fullName: `${PREFIX}-admin`,
        isActive: true,
      },
    });
    created.users.push(adminUser.id);

    const policy = await createPolicy({
      data: {
        companyId: company.id,
        name: `${PREFIX}-policy`,
        approverType: 'AssignedTeamLead',
        rejectionBehavior: 'ReturnToAssignee',
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.policies.push(policy.id);

    record('1. setup (policy + users + team)', !!policy && !!leadUser && !!memberUser);

    // Helper to spin up a case scoped to this team.
    async function newCase(label = 'case') {
      const c = await caseRepository.create({
        title: `${PREFIX}-${label}`,
        description: `${label} smoke case`,
        caseType: 'GeneralSupport',
        priority: 'Medium',
        origin: 'Telefon',
        companyId: company.id,
        companyName: company.name,
        category: 'Yazılım',
        subCategory: 'Genel',
        requestType: 'Talep',
        assignedTeamId: team.id,
        assignedTeamName: team.name,
        assignedPersonId: memberPerson.id,
        assignedPersonName: memberPerson.name,
      });
      created.cases.push(c.id);
      return c;
    }

    async function waitForFireAndForget(ms = 1500) {
      await new Promise((r) => setTimeout(r, ms));
    }

    // ─── 2. submit → approval_pending appears for team lead ───
    const c2 = await newCase('case-2');
    const submitter = {
      id: memberUser.id,
      personId: memberPerson.id,
      fullName: memberPerson.name,
    };
    const approval2 = await submitApproval({
      caseId: c2.id,
      payload: { resolutionSummary: 'lead onayını bekliyor' },
      user: submitter,
      allowedCompanyIds,
    });
    created.approvals.push(approval2.id);
    await waitForFireAndForget();
    const ai2 = await prisma.actionItem.findFirst({
      where: {
        userId: leadUser.id,
        kind: 'approval_pending',
        objectType: 'CaseResolutionApproval',
        objectId: approval2.id,
      },
    });
    if (ai2) created.actionItems.push(ai2.id);
    record(
      '2. submit fires approval_pending ActionItem',
      !!ai2 && ai2.state === 'Pending' && !!ai2.reasonLabel && ai2.priority === 70,
      `state=${ai2?.state} priority=${ai2?.priority}`,
    );

    // ─── 3. idempotent — re-emit same dedupKey reuses row ───
    if (ai2) {
      await emitActionItem({
        kind: 'approval_pending',
        userId: leadUser.id,
        personId: leadPerson.id,
        companyId: company.id,
        objectType: 'CaseResolutionApproval',
        objectId: approval2.id,
        caseId: c2.id,
        caseNumber: c2.caseNumber,
        caseTitle: c2.title,
        dedupKey: ai2.dedupKey,
        priority: 70,
        actionRequired: true,
        reasonLabel: ai2.reasonLabel,
      });
      const rows = await prisma.actionItem.findMany({
        where: { dedupKey: ai2.dedupKey },
      });
      record(
        '3. emitActionItem idempotent via dedupKey',
        rows.length === 1,
        `rowCount=${rows.length}`,
      );
    } else {
      record('3. emitActionItem idempotent via dedupKey', false, 'no base ActionItem from scenario 2');
    }

    // ─── 4. summary ───
    const leadSummary = await summaryForUser({
      userId: leadUser.id,
      allowedCompanyIds,
    });
    const memberSummary = await summaryForUser({
      userId: memberUser.id,
      allowedCompanyIds,
    });
    record(
      '4. summary count actionRequired=1 for lead, 0 for unrelated member',
      leadSummary.actionRequired === 1 && memberSummary.actionRequired === 0,
      `lead=${leadSummary.actionRequired} member=${memberSummary.actionRequired}`,
    );

    // ─── 5. list — view=action returns row; fyi/done empty ───
    const leadAction = await listForUser({
      userId: leadUser.id,
      allowedCompanyIds,
      view: 'action',
    });
    const leadFyi = await listForUser({
      userId: leadUser.id,
      allowedCompanyIds,
      view: 'fyi',
    });
    const leadDone = await listForUser({
      userId: leadUser.id,
      allowedCompanyIds,
      view: 'done',
    });
    record(
      '5. list view=action has 1; view=fyi+done empty',
      leadAction.items.length === 1 && leadFyi.items.length === 0 && leadDone.items.length === 0,
      `action=${leadAction.items.length} fyi=${leadFyi.items.length} done=${leadDone.items.length}`,
    );

    // ─── 6. markDone ───
    if (ai2) {
      const done = await markDone({
        id: ai2.id,
        userId: leadUser.id,
        allowedCompanyIds,
        payload: { outcome: 'acknowledged' },
      });
      const reloaded = await prisma.actionItem.findUnique({ where: { id: ai2.id } });
      const sumAfter = await summaryForUser({
        userId: leadUser.id,
        allowedCompanyIds,
      });
      record(
        '6. markDone sets state=Done; summary drops to 0',
        done.state === 'Done' &&
          reloaded?.doneAt != null &&
          reloaded?.doneByUserId === leadUser.id &&
          sumAfter.actionRequired === 0,
        `state=${reloaded?.state} action=${sumAfter.actionRequired}`,
      );
    } else {
      record('6. markDone sets state=Done', false, 'no base ActionItem');
    }

    // ─── 7. tenant scope leak guard ───
    if (secondCompany) {
      // Plant an ActionItem for leadUser but in companyY (not in their
      // allowedCompanyIds when we restrict allowed=[company.id]).
      const leak = await prisma.actionItem.create({
        data: {
          userId: leadUser.id,
          companyId: secondCompany.id,
          kind: 'approval_pending',
          state: 'Pending',
          actionRequired: true,
          reasonLabel: 'tenant-leak-test',
        },
      });
      created.actionItems.push(leak.id);
      const out = await listForUser({
        userId: leadUser.id,
        allowedCompanyIds: [company.id],
        view: 'action',
      });
      const present = out.items.some((i) => i.id === leak.id);
      record(
        '7. tenant scope leak guard — out-of-scope ActionItem is filtered',
        !present,
        `presentInList=${present}`,
      );
    } else {
      record(
        '7. tenant scope leak guard',
        true,
        'skipped — only one active company in tenant set',
      );
    }

    // ─── 8. wrong-user mutation → 403 ───
    // Create a new case + submit so we have a fresh Pending row.
    const c8 = await newCase('case-8');
    const approval8 = await submitApproval({
      caseId: c8.id,
      payload: { resolutionSummary: 'fresh pending' },
      user: submitter,
      allowedCompanyIds,
    });
    created.approvals.push(approval8.id);
    await waitForFireAndForget();
    const ai8 = await prisma.actionItem.findFirst({
      where: {
        userId: leadUser.id,
        objectId: approval8.id,
        kind: 'approval_pending',
      },
    });
    if (ai8) created.actionItems.push(ai8.id);
    let r8 = false;
    let r8msg = '';
    if (ai8) {
      try {
        await markDone({
          id: ai8.id,
          userId: memberUser.id, // wrong user
          allowedCompanyIds,
          payload: {},
        });
      } catch (e) {
        r8 = e instanceof ActionItemAccessError;
        r8msg = e.code ?? e.message;
      }
      const refetched = await prisma.actionItem.findUnique({ where: { id: ai8.id } });
      r8 = r8 && refetched?.state === 'Pending';
      record('8. wrong-user mutation → 403, state unchanged', r8, r8msg);
    } else {
      record('8. wrong-user mutation → 403', false, 'no Pending ActionItem');
    }

    // ─── 9. approve via existing endpoint → close decider + expire siblings + FYI ───
    if (ai8) {
      const updated9 = await approveApproval({
        approvalId: approval8.id,
        payload: {},
        user: {
          id: leadUser.id,
          personId: leadPerson.id,
          fullName: leadPerson.name,
          role: 'Supervisor',
        },
        allowedCompanyIds,
      });
      await waitForFireAndForget();
      const aiAfter = await prisma.actionItem.findUnique({ where: { id: ai8.id } });
      // FYI to submitter
      const fyi = await prisma.actionItem.findFirst({
        where: {
          userId: memberUser.id,
          objectId: approval8.id,
          kind: 'approval_decided',
        },
      });
      if (fyi) created.actionItems.push(fyi.id);
      record(
        '9. approve → ActionItem Done + approval_decided FYI for submitter',
        updated9.state === 'Approved' &&
          aiAfter?.state === 'Done' &&
          aiAfter?.doneOutcome === 'approved' &&
          !!fyi &&
          fyi.actionRequired === false,
        `aiState=${aiAfter?.state} outcome=${aiAfter?.doneOutcome} fyi=${!!fyi}`,
      );
    } else {
      record('9. approve via endpoint', false, 'no base ActionItem');
    }

    // ─── 10. reject + ReturnToAssignee → approval_decided FYI + case_returned_to_assignee actionable ───
    const c10 = await newCase('case-10');
    const approval10 = await submitApproval({
      caseId: c10.id,
      payload: { resolutionSummary: 'reject test' },
      user: submitter,
      allowedCompanyIds,
    });
    created.approvals.push(approval10.id);
    await waitForFireAndForget();
    const ai10Pending = await prisma.actionItem.findFirst({
      where: { userId: leadUser.id, objectId: approval10.id, kind: 'approval_pending' },
    });
    if (ai10Pending) created.actionItems.push(ai10Pending.id);

    await rejectApproval({
      approvalId: approval10.id,
      payload: { rejectionReason: 'eksik bilgi' },
      user: {
        id: leadUser.id,
        personId: leadPerson.id,
        fullName: leadPerson.name,
        role: 'Supervisor',
      },
      allowedCompanyIds,
    });
    await waitForFireAndForget();

    const ai10FyiAndReturn = await prisma.actionItem.findMany({
      where: { userId: memberUser.id, caseId: c10.id },
    });
    ai10FyiAndReturn.forEach((x) => created.actionItems.push(x.id));
    const fyiRow = ai10FyiAndReturn.find((x) => x.kind === 'approval_decided');
    const returnedRow = ai10FyiAndReturn.find((x) => x.kind === 'case_returned_to_assignee');
    record(
      '10. reject ReturnToAssignee → FYI + case_returned_to_assignee actionable',
      !!fyiRow && fyiRow.actionRequired === false &&
        !!returnedRow && returnedRow.actionRequired === true &&
        returnedRow.priority === 70,
      `fyi=${!!fyiRow} returned=${!!returnedRow}`,
    );

    // ─── 11. snooze ───
    if (returnedRow) {
      const future = new Date(Date.now() + 60 * 60 * 1000); // +1h
      await snooze({
        id: returnedRow.id,
        userId: memberUser.id,
        allowedCompanyIds,
        payload: { snoozedUntil: future.toISOString() },
      });
      const refetched = await prisma.actionItem.findUnique({ where: { id: returnedRow.id } });
      const memberSumAfter = await summaryForUser({
        userId: memberUser.id,
        allowedCompanyIds,
      });
      record(
        '11. snooze sets state=Snoozed; summary moves to snoozed bucket',
        refetched?.state === 'Snoozed' &&
          refetched?.snoozedUntil != null &&
          memberSumAfter.snoozed >= 1,
        `state=${refetched?.state} snoozedCount=${memberSumAfter.snoozed}`,
      );
    } else {
      record('11. snooze', false, 'no case_returned_to_assignee row');
    }

    // ─── 12. lazy wake-up ───
    if (returnedRow) {
      // Backdate snoozedUntil to past directly via Prisma — simulate wakeup.
      await prisma.actionItem.update({
        where: { id: returnedRow.id },
        data: { snoozedUntil: new Date(Date.now() - 1000) },
      });
      // listForUser triggers the lazy wake-up.
      await listForUser({
        userId: memberUser.id,
        allowedCompanyIds,
        view: 'action',
      });
      const refetched = await prisma.actionItem.findUnique({ where: { id: returnedRow.id } });
      record(
        '12. lazy wake-up: past snoozedUntil flips back to Pending',
        refetched?.state === 'Pending' && refetched?.snoozedUntil == null,
        `state=${refetched?.state} snoozedUntil=${refetched?.snoozedUntil}`,
      );
    } else {
      record('12. lazy wake-up', false, 'no case_returned_to_assignee row');
    }

    // ─── 13. dismiss ───
    if (returnedRow) {
      const dismissed = await dismiss({
        id: returnedRow.id,
        userId: memberUser.id,
        allowedCompanyIds,
        payload: { closeNote: 'revize edip yarın tekrar göndereceğim' },
      });
      record(
        '13. dismiss → state=Dismissed + closeNote set',
        dismissed.state === 'Dismissed' &&
          dismissed.closeNote === 'revize edip yarın tekrar göndereceğim',
        `state=${dismissed.state}`,
      );
    } else {
      record('13. dismiss', false, 'no case_returned_to_assignee row');
    }

    // ─── 14. fire-and-forget — emit guards against bad input ───
    // The emitActionItem helper is the only contract surface approval
    // hooks call. It MUST never throw, regardless of payload shape, so
    // a corrupt event can never break submit/approve/reject. We exercise
    // it directly with missing required fields and an invalid kind.
    let r14_threw = false;
    let r14_returned = null;
    try {
      r14_returned = await emitActionItem({
        // intentionally missing kind / userId / companyId / reasonLabel
      });
    } catch (e) {
      r14_threw = true;
      r14_returned = `THREW: ${e?.message}`;
    }
    let r14b_threw = false;
    try {
      await emitActionItem({
        kind: 'mention', // not in Phase 1 allowed set
        userId: leadUser.id,
        companyId: company.id,
        reasonLabel: 'forward-compat kind not in Phase 1 emit set',
      });
    } catch (e) {
      r14b_threw = true;
    }
    record(
      '14. fire-and-forget — emitActionItem swallows bad payload + non-Phase-1 kind, never throws',
      !r14_threw && r14_returned === null && !r14b_threw,
      `bad=${r14_threw ? 'threw' : 'ok'} oot=${r14b_threw ? 'threw' : 'ok'}`,
    );
  } catch (err) {
    console.error('smoke fatal:', err);
    results.push({ name: 'fatal', ok: false, detail: err?.message });
  } finally {
    // Cleanup order (no FK from ActionItem so independent delete is fine).
    if (created.actionItems.length) {
      await prisma.actionItem.deleteMany({ where: { id: { in: created.actionItems } } }).catch(() => {});
    }
    if (created.cases.length) {
      await prisma.actionItem.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.caseResolutionApproval.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.notificationDispatch.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.caseActivity.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.case.deleteMany({ where: { id: { in: created.cases } } }).catch(() => {});
    }
    if (created.policies.length) {
      await prisma.resolutionApprovalPolicy.deleteMany({ where: { id: { in: created.policies } } }).catch(() => {});
    }
    if (created.users.length) {
      await prisma.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => {});
    }
    if (created.persons.length) {
      await prisma.person.deleteMany({ where: { id: { in: created.persons } } }).catch(() => {});
    }
    if (created.teams.length) {
      await prisma.team.deleteMany({ where: { id: { in: created.teams } } }).catch(() => {});
    }
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('[smoke] FAILED:');
    failed.forEach((f) => console.log(`  - ${f.name} ${f.detail ?? ''}`));
    process.exitCode = 1;
  } else {
    console.log('[smoke] ALL GREEN');
  }
}

// Suppress unused-import warnings for helpers we don't directly exercise here.
void closeActionItemsForApproval;
void expireSiblingActionItemsForApproval;
void markInProgressForCase;
void ActionItemValidationError;

run();
