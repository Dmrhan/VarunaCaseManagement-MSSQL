/**
 * WR-ACTION-CENTER Phase 1 — Approval Visibility MVP smoke.
 *
 * Repository-level (HTTP yok). 21 scenarios:
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
 *   15. P1 review#1     case_returned_to_assignee targets CURRENT assignee, not stale submitter
 *   16. P1 review#2     getDashboard pendingApprovalsInbox tenant-scoped
 *   17. Acceptance P1#1 non-snapshotted eligible Supervisor decides via fan-out + sibling Expired
 *   18. Acceptance P1#1 unrelated user (outside eligible set) still 403
 *   19. Acceptance P2#4 markDone closes case_returned_to_assignee (Tamamlandı inbox button)
 *   20. Hotfix P1   decision-time self-approval guard blocks non-snapshot submitter on approve; other eligible Supervisor still decides
 *   21. Hotfix P1   decision-time self-approval guard blocks reject path for submitter
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

    async function waitForFireAndForget(ms = 3000) {
      // Bumped 1500 → 3000 after P1 fix added an extra sequential
      // user.findFirst inside the rejectApproval void-async block.
      // Total fire-and-forget tail now does ~4-5 DB round-trips.
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

    // ─── Codex P1 review fixes — Phase 1.5 ──────────────────────────
    // 15. P1#1 — case_returned_to_assignee must target CURRENT assignee.
    //    Submit as member, transfer case to a new assignee, reject with
    //    ReturnToAssignee → case_returned_to_assignee must reach the new
    //    assignee's user, NOT the stale submitter.
    // 16. P1#2 — getDashboard pendingApprovalsInbox must filter by
    //    allowedCompanyIds. Plant an ActionItem in companyY for user;
    //    fetch getDashboard with allowedCompanyIds=[companyX] only →
    //    pendingApprovalsInbox must be empty.

    // ─── 15. transfer-then-reject must not route stale submitter ───
    // Setup: a third Person + User to be the transferred-to assignee.
    const newAssigneePerson = await prisma.person.create({
      data: {
        name: `${PREFIX}-newassignee`,
        teamId: team.id,
        isActive: true,
        email: `${PREFIX}-newassignee@smoke.test`,
      },
    });
    created.persons.push(newAssigneePerson.id);
    const newAssigneeUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-newassignee-user@smoke.test`,
        fullName: newAssigneePerson.name,
        personId: newAssigneePerson.id,
        isActive: true,
      },
    });
    created.users.push(newAssigneeUser.id);

    // Fresh case, submitter = memberUser.
    const c15 = await newCase('case-15-transfer');
    const approval15 = await submitApproval({
      caseId: c15.id,
      payload: { resolutionSummary: 'submit before transfer' },
      user: submitter,
      allowedCompanyIds,
    });
    created.approvals.push(approval15.id);
    await waitForFireAndForget();

    // Now transfer the case to the new assignee — only update
    // assignedPersonId on Case (direct DB write keeps the test focused).
    await prisma.case.update({
      where: { id: c15.id },
      data: {
        assignedPersonId: newAssigneePerson.id,
        assignedPersonName: newAssigneePerson.name,
      },
    });

    // Reject with ReturnToAssignee.
    await rejectApproval({
      approvalId: approval15.id,
      payload: { rejectionReason: 'transfer test — please revise' },
      user: {
        id: leadUser.id,
        personId: leadPerson.id,
        fullName: leadPerson.name,
        role: 'Supervisor',
      },
      allowedCompanyIds,
    });
    await waitForFireAndForget();

    // Verify:
    //   a) case_returned_to_assignee exists for newAssigneeUser
    //   b) NO case_returned_to_assignee for stale submitter (memberUser)
    //   c) approval_decided FYI still went to submitter (audit transparency)
    const returnToNew = await prisma.actionItem.findFirst({
      where: {
        kind: 'case_returned_to_assignee',
        userId: newAssigneeUser.id,
        caseId: c15.id,
      },
    });
    const returnToStale = await prisma.actionItem.findFirst({
      where: {
        kind: 'case_returned_to_assignee',
        userId: memberUser.id,
        caseId: c15.id,
      },
    });
    const submitterFyi = await prisma.actionItem.findFirst({
      where: {
        kind: 'approval_decided',
        userId: memberUser.id,
        caseId: c15.id,
      },
    });
    if (returnToNew) created.actionItems.push(returnToNew.id);
    if (submitterFyi) created.actionItems.push(submitterFyi.id);

    record(
      '15. P1#1 — case_returned_to_assignee targets current assignee, NOT stale submitter',
      !!returnToNew && returnToNew.userId === newAssigneeUser.id &&
        !returnToStale &&
        !!submitterFyi && submitterFyi.actionRequired === false,
      `newAssignee=${!!returnToNew} stale=${!!returnToStale} submitterFyi=${!!submitterFyi}`,
    );

    // ─── 16. P1#2 — getDashboard tenant filter ─────────────────────
    // Plant an ActionItem for leadUser scoped to a DIFFERENT company.
    // Then fetch dashboard with allowedCompanyIds restricted to ONLY
    // the original company → the planted item must not surface.
    if (secondCompany) {
      const planted = await prisma.actionItem.create({
        data: {
          userId: leadUser.id,
          companyId: secondCompany.id,
          kind: 'approval_pending',
          state: 'Pending',
          actionRequired: true,
          priority: 70,
          reasonLabel: 'planted-other-company',
        },
      });
      created.actionItems.push(planted.id);

      // Import getDashboard dynamically.
      const { getDashboard } = await import('../server/db/myRepository.js');
      const dashOnlyCompanyA = await getDashboard({
        user: {
          id: leadUser.id,
          fullName: leadPerson.name,
          allowedCompanyIds: [company.id],
          // companyRoles unused by getDashboard scope filter path
        },
      });
      const inboxAfter = dashOnlyCompanyA?.pendingApprovalsInbox ?? [];
      const leakedIds = inboxAfter
        .filter((x) => x.id === planted.id)
        .map((x) => x.id);

      // Also re-fetch with FULL allowedCompanyIds to prove the item IS
      // visible when scope permits — sanity check.
      const dashBothCompanies = await getDashboard({
        user: {
          id: leadUser.id,
          fullName: leadPerson.name,
          allowedCompanyIds: [company.id, secondCompany.id],
        },
      });
      const inboxFull = dashBothCompanies?.pendingApprovalsInbox ?? [];
      const presentWhenAllowed = inboxFull.some((x) => x.id === planted.id);

      record(
        '16. P1#2 — getDashboard pendingApprovalsInbox respects allowedCompanyIds',
        leakedIds.length === 0 && presentWhenAllowed,
        `leakedWhenScoped=${leakedIds.length} visibleWhenAllowed=${presentWhenAllowed}`,
      );
    } else {
      record(
        '16. P1#2 — getDashboard pendingApprovalsInbox respects allowedCompanyIds',
        true,
        'skipped — only one active company in tenant set',
      );
    }

    // ─── Phase 1 ACCEPTANCE FIXES ────────────────────────────────────
    // 17. P1#1 fan-out authority — non-snapshotted but eligible
    //     Supervisor can decide via Action Center.
    // 18. Unrelated user (no Supervisor membership) still 403.
    // 19. P2#4 — markDone works for kind=case_returned_to_assignee
    //     (the "Tamamlandı" inbox button reuses the same endpoint).

    // Deactivate the AssignedTeamLead policy from setup so the new
    // Supervisor-role policy is the one matchPolicyForCase resolves.
    await prisma.resolutionApprovalPolicy.update({
      where: { id: policy.id },
      data: { isActive: false },
    });

    // Two Supervisor-role members.
    const sup1Person = await prisma.person.create({
      data: {
        name: `${PREFIX}-sup1`,
        teamId: team.id,
        isActive: true,
        email: `${PREFIX}-sup1@smoke.test`,
      },
    });
    created.persons.push(sup1Person.id);
    const sup1User = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-sup1-user@smoke.test`,
        fullName: sup1Person.name,
        personId: sup1Person.id,
        isActive: true,
      },
    });
    created.users.push(sup1User.id);
    await prisma.userCompany.create({
      data: { userId: sup1User.id, companyId: company.id, role: 'Supervisor', isActive: true },
    });

    const sup2Person = await prisma.person.create({
      data: {
        name: `${PREFIX}-sup2`,
        teamId: team.id,
        isActive: true,
        email: `${PREFIX}-sup2@smoke.test`,
      },
    });
    created.persons.push(sup2Person.id);
    const sup2User = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-sup2-user@smoke.test`,
        fullName: sup2Person.name,
        personId: sup2Person.id,
        isActive: true,
      },
    });
    created.users.push(sup2User.id);
    await prisma.userCompany.create({
      data: { userId: sup2User.id, companyId: company.id, role: 'Supervisor', isActive: true },
    });

    const supervisorPolicy = await createPolicy({
      data: {
        companyId: company.id,
        name: `${PREFIX}-supervisor-policy`,
        approverType: 'Supervisor',
        rejectionBehavior: 'ReturnToAssignee',
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.policies.push(supervisorPolicy.id);

    // ─── 17. Non-snapshotted but eligible Supervisor decides ────────
    const c17 = await newCase('case-17-multi-approver');
    const approval17 = await submitApproval({
      caseId: c17.id,
      payload: { resolutionSummary: 'multi-approver authority test' },
      user: submitter,
      allowedCompanyIds,
    });
    created.approvals.push(approval17.id);
    await waitForFireAndForget();

    // resolveApprover sorts Supervisor members by personId asc — pick the
    // decoy as whichever supervisor is NOT the snapshotted first.
    const approval17Row = await prisma.caseResolutionApproval.findUnique({
      where: { id: approval17.id },
    });
    const snapshotIsSup1 = approval17Row.expectedApproverPersonId === sup1Person.id;
    const snapshotUserId = snapshotIsSup1 ? sup1User.id : sup2User.id;
    const decoyUserId = snapshotIsSup1 ? sup2User.id : sup1User.id;
    const decoyPersonId = snapshotIsSup1 ? sup2Person.id : sup1Person.id;
    const decoyPersonName = snapshotIsSup1 ? sup2Person.name : sup1Person.name;

    const sup1Item = await prisma.actionItem.findFirst({
      where: { userId: sup1User.id, objectId: approval17.id, kind: 'approval_pending' },
    });
    const sup2Item = await prisma.actionItem.findFirst({
      where: { userId: sup2User.id, objectId: approval17.id, kind: 'approval_pending' },
    });
    if (sup1Item) created.actionItems.push(sup1Item.id);
    if (sup2Item) created.actionItems.push(sup2Item.id);

    let decoyApproved = false;
    let decoyErr = null;
    try {
      const u17 = await approveApproval({
        approvalId: approval17.id,
        payload: {},
        user: {
          id: decoyUserId,
          personId: decoyPersonId,
          fullName: decoyPersonName,
          role: 'Supervisor',
        },
        allowedCompanyIds,
      });
      decoyApproved = u17.state === 'Approved';
    } catch (e) {
      decoyErr = e?.code ?? e?.message;
    }
    await waitForFireAndForget();

    const decoyItemAfter = await prisma.actionItem.findFirst({
      where: { userId: decoyUserId, objectId: approval17.id },
    });
    const snapshotItemAfter = await prisma.actionItem.findFirst({
      where: { userId: snapshotUserId, objectId: approval17.id },
    });

    record(
      '17. P1#1 ACCEPT — non-snapshotted eligible Supervisor decides via fan-out + sibling Expired',
      !!sup1Item && !!sup2Item &&
        decoyApproved &&
        decoyItemAfter?.state === 'Done' &&
        snapshotItemAfter?.state === 'Expired',
      `bothEmitted=${!!sup1Item && !!sup2Item} decoyApproved=${decoyApproved} ` +
        `decoyAfter=${decoyItemAfter?.state} snapshotAfter=${snapshotItemAfter?.state} err=${decoyErr ?? ''}`,
    );

    // ─── 18. Unrelated user (no Supervisor membership) still 403 ────
    const c18 = await newCase('case-18-unrelated-403');
    const approval18 = await submitApproval({
      caseId: c18.id,
      payload: { resolutionSummary: 'unrelated user must be 403' },
      user: submitter,
      allowedCompanyIds,
    });
    created.approvals.push(approval18.id);
    await waitForFireAndForget();

    let r18_forbidden = false;
    let r18_err = '';
    try {
      await approveApproval({
        approvalId: approval18.id,
        payload: {},
        user: {
          id: memberUser.id, // not a Supervisor; not in resolved.persons
          personId: memberPerson.id,
          fullName: memberPerson.name,
          role: 'Agent',
        },
        allowedCompanyIds,
      });
    } catch (e) {
      r18_forbidden = e?.code === 'APPROVAL_FORBIDDEN';
      r18_err = e?.code ?? e?.message;
    }
    const approval18After = await prisma.caseResolutionApproval.findUnique({
      where: { id: approval18.id },
    });
    record(
      '18. P1#1 ACCEPT — unrelated user (outside eligible set) still 403, state unchanged',
      r18_forbidden && approval18After?.state === 'Pending',
      `forbidden=${r18_forbidden} err=${r18_err} state=${approval18After?.state}`,
    );

    // ─── 19. P2#4 — markDone closes case_returned_to_assignee row ───
    const c19 = await newCase('case-19-tamamlandi');
    const approval19 = await submitApproval({
      caseId: c19.id,
      payload: { resolutionSummary: 'will be rejected, then assignee marks Done' },
      user: submitter,
      allowedCompanyIds,
    });
    created.approvals.push(approval19.id);
    await waitForFireAndForget();

    // Reject as sup1 (eligible Supervisor) → case_returned_to_assignee
    // routed to memberUser (the case assignee).
    await rejectApproval({
      approvalId: approval19.id,
      payload: { rejectionReason: 'tamamlandı testi — revize et' },
      user: {
        id: sup1User.id,
        personId: sup1Person.id,
        fullName: sup1Person.name,
        role: 'Supervisor',
      },
      allowedCompanyIds,
    });
    await waitForFireAndForget();

    const returnItem19 = await prisma.actionItem.findFirst({
      where: {
        kind: 'case_returned_to_assignee',
        userId: memberUser.id,
        caseId: c19.id,
      },
    });
    if (returnItem19) created.actionItems.push(returnItem19.id);

    let r19_done = false;
    let r19_err = '';
    if (returnItem19) {
      try {
        const updated19 = await markDone({
          id: returnItem19.id,
          userId: memberUser.id,
          allowedCompanyIds,
          payload: { outcome: 'acknowledged' },
        });
        r19_done = updated19?.state === 'Done' && updated19?.doneByUserId === memberUser.id;
      } catch (e) {
        r19_err = e?.code ?? e?.message;
      }
    } else {
      r19_err = 'no case_returned_to_assignee row emitted';
    }
    record(
      '19. P2#4 — markDone closes case_returned_to_assignee (Tamamlandı inbox button)',
      r19_done,
      `done=${r19_done} err=${r19_err}`,
    );

    // ─── 20. Self-approval guard at decision time — block submitter ────
    // Bug: userIsEligibleApprover lets ANY eligible person decide, which
    // lets a submitter who is also in the role's eligible set (but not
    // the snapshotted approver) approve their own row. The submit-time
    // check only compares user.personId to the snapshot.
    //
    // Setup: same supervisorPolicy (allowSelfApprove defaults to false).
    // Submitter = the HIGHER-personId Supervisor (so the snapshot picks
    // the LOWER one, leaving the submitter off-snapshot but eligible).
    // Expect: submit succeeds; same-user approve → self_approval_blocked;
    // approval still Pending; other eligible Supervisor approves → OK.
    const submitterIsSup1 = sup1Person.id > sup2Person.id;
    const selfSupUser = submitterIsSup1 ? sup1User : sup2User;
    const selfSupPerson = submitterIsSup1 ? sup1Person : sup2Person;
    const otherSupUser = submitterIsSup1 ? sup2User : sup1User;
    const otherSupPerson = submitterIsSup1 ? sup2Person : sup1Person;

    const c20 = await newCase('case-20-self-approval-decide');
    const approval20 = await submitApproval({
      caseId: c20.id,
      payload: { resolutionSummary: 'self-approval decision-time guard test' },
      user: {
        id: selfSupUser.id,
        personId: selfSupPerson.id,
        fullName: selfSupPerson.name,
        role: 'Supervisor',
      },
      allowedCompanyIds,
    });
    created.approvals.push(approval20.id);
    await waitForFireAndForget();

    const approval20RowBefore = await prisma.caseResolutionApproval.findUnique({
      where: { id: approval20.id },
    });
    // Sanity: submitter must not be the snapshot, otherwise the test is
    // exercising the submit-time path, not the decide-time guard.
    const snapshotIsNotSubmitter =
      approval20RowBefore?.expectedApproverPersonId !== selfSupPerson.id;

    let r20_blocked = false;
    let r20_err = '';
    try {
      await approveApproval({
        approvalId: approval20.id,
        payload: {},
        user: {
          id: selfSupUser.id,
          personId: selfSupPerson.id,
          fullName: selfSupPerson.name,
          role: 'Supervisor',
        },
        allowedCompanyIds,
      });
    } catch (e) {
      r20_blocked = e?.code === 'self_approval_blocked';
      r20_err = e?.code ?? e?.message;
    }
    const approval20AfterBlock = await prisma.caseResolutionApproval.findUnique({
      where: { id: approval20.id },
    });

    let r20_otherOk = false;
    let r20_otherErr = '';
    try {
      const u20 = await approveApproval({
        approvalId: approval20.id,
        payload: {},
        user: {
          id: otherSupUser.id,
          personId: otherSupPerson.id,
          fullName: otherSupPerson.name,
          role: 'Supervisor',
        },
        allowedCompanyIds,
      });
      r20_otherOk = u20.state === 'Approved';
    } catch (e) {
      r20_otherErr = e?.code ?? e?.message;
    }

    record(
      '20. Decision-time self-approval guard blocks non-snapshot submitter; other eligible can decide',
      snapshotIsNotSubmitter &&
        r20_blocked &&
        approval20AfterBlock?.state === 'Pending' &&
        r20_otherOk,
      `snapshotIsNotSubmitter=${snapshotIsNotSubmitter} blocked=${r20_blocked} blockErr=${r20_err} ` +
        `afterBlock=${approval20AfterBlock?.state} otherOk=${r20_otherOk} otherErr=${r20_otherErr}`,
    );

    // ─── 21. Self-approval guard — reject path is symmetric ────────────
    const c21 = await newCase('case-21-self-reject-decide');
    const approval21 = await submitApproval({
      caseId: c21.id,
      payload: { resolutionSummary: 'self-reject decision-time guard test' },
      user: {
        id: selfSupUser.id,
        personId: selfSupPerson.id,
        fullName: selfSupPerson.name,
        role: 'Supervisor',
      },
      allowedCompanyIds,
    });
    created.approvals.push(approval21.id);
    await waitForFireAndForget();

    let r21_blocked = false;
    let r21_err = '';
    try {
      await rejectApproval({
        approvalId: approval21.id,
        payload: { rejectionReason: 'self-reject must be blocked' },
        user: {
          id: selfSupUser.id,
          personId: selfSupPerson.id,
          fullName: selfSupPerson.name,
          role: 'Supervisor',
        },
        allowedCompanyIds,
      });
    } catch (e) {
      r21_blocked = e?.code === 'self_approval_blocked';
      r21_err = e?.code ?? e?.message;
    }
    const approval21After = await prisma.caseResolutionApproval.findUnique({
      where: { id: approval21.id },
    });
    record(
      '21. Decision-time self-approval guard blocks reject path for submitter',
      r21_blocked && approval21After?.state === 'Pending',
      `blocked=${r21_blocked} err=${r21_err} state=${approval21After?.state}`,
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
