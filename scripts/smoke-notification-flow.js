/**
 * WR-D4/D3 Phase 2 — Notification flow smoke.
 *
 * Repository-level senaryolar (HTTP yok). 15 senaryo:
 *
 *   1.  Template CRUD happy path
 *   2.  Template create — duplicate key blocked
 *   3.  Template create — bad variable name blocked
 *   4.  Rule create — happy path (filtered + audience + template)
 *   5.  Rule create — match-all without isMatchAll → block
 *   6.  Rule create — mode='Active' → block (Phase 4)
 *   7.  Rule create — invalid event → block
 *   8.  Render — variables resolved
 *   9.  Render — missing variable surfaces in `missing` array
 *  10.  emitEvent — rule matches → dispatch row inserted (Sent for InApp/LogOnly)
 *  11.  emitEvent — rule conditions don't match case → no dispatch
 *  12.  emitEvent — idempotency dedup → second emit = Suppressed
 *  13.  manualConfirmDispatch — happy path; case.communicationState='Manual'
 *  14.  manualConfirmDispatch — missing deliveryNote → 400
 *  15.  Integration — submitApproval fires resolution_submitted event
 *
 * Çalıştır: node --env-file=.env scripts/smoke-notification-flow.js
 *
 * Mutasyon: yarattığı tüm satırları finally bloğunda temizler.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import {
  NotificationAccessError,
  NotificationValidationError,
  createRule,
  createTemplate,
  emitEvent,
  manualConfirmDispatch,
  renderTemplate,
  updateTemplate,
} from '../server/db/notificationRepository.js';
import {
  createPolicy,
  submitApproval,
} from '../server/db/approvalRepository.js';
import { caseRepository } from '../server/db/caseRepository.js';

const stamp = Date.now();
const PREFIX = `notf_${stamp}`;
const NAME_PREFIX = `notf-${stamp}`; // for human-readable names (dashes allowed)
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
  console.log('🔍 notification-flow smoke\n');
  const company = await pickCompany();
  const allowedCompanyIds = [company.id];
  console.log(`Company: ${company.id} (${company.name})\n`);

  const created = {
    rules: [],
    templates: [],
    policies: [],
    cases: [],
    dispatches: [],
    users: [],
    persons: [],
    teams: [],
  };

  try {
    // Setup: team + lead + member + users
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
        isTeamLead: false,
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
      },
    });
    created.users.push(leadUser.id);

    const memberUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-member-user@smoke.test`,
        fullName: memberPerson.name,
        personId: memberPerson.id,
      },
    });
    created.users.push(memberUser.id);

    const adminUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-admin@smoke.test`,
        fullName: `${PREFIX}-admin`,
      },
    });
    created.users.push(adminUser.id);

    // ─── 1) Template CRUD happy path ───
    const tpl = await createTemplate({
      data: {
        companyId: company.id,
        key: `${PREFIX}_test_template`,
        name: `${PREFIX}-template-1`,
        subjectTemplate: 'Vaka {{case.number}} — {{case.title}}',
        bodyTemplate: 'Merhaba {{assignee.name}}, {{case.number}} numaralı vaka {{case.status}} durumunda.',
        requiredVariables: ['case.number', 'case.title', 'case.status', 'assignee.name'],
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.templates.push(tpl.id);
    record('1. createTemplate happy path', !!tpl.id && tpl.companyId === company.id);

    // ─── 2) Duplicate key blocked ───
    let r2 = false;
    let r2msg = '';
    try {
      await createTemplate({
        data: {
          companyId: company.id,
          key: `${PREFIX}_test_template`,
          name: 'dup',
          subjectTemplate: 'x',
          bodyTemplate: 'y',
        },
        user: { id: adminUser.id },
        allowedCompanyIds,
      });
    } catch (e) {
      r2 = e instanceof NotificationValidationError && e.code === 'key_duplicate';
      r2msg = e.code;
    }
    record('2. createTemplate duplicate key → 409', r2, r2msg);

    // ─── 3) Bad variable name blocked ───
    let r3 = false;
    let r3msg = '';
    try {
      await createTemplate({
        data: {
          companyId: company.id,
          key: `${PREFIX}_bad_var`,
          name: 'bad',
          subjectTemplate: 'x',
          bodyTemplate: 'y',
          requiredVariables: ['case.number', 'invalid.thing'],
        },
        user: { id: adminUser.id },
        allowedCompanyIds,
      });
    } catch (e) {
      r3 = e instanceof NotificationValidationError && e.code === 'required_var_unknown';
      r3msg = e.code;
    }
    record('3. createTemplate unknown var → 400', r3, r3msg);

    // ─── 4) Rule create happy path ───
    const rule = await createRule({
      data: {
        companyId: company.id,
        name: `${PREFIX}-rule-1`,
        event: 'resolution_submitted',
        conditions: { category: 'Yazılım' },
        audience: [{ type: 'team_lead' }],
        templateId: tpl.id,
        channel: 'InApp',
        mode: 'LogOnly',
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.rules.push(rule.id);
    record('4. createRule happy path', !!rule.id && rule.event === 'resolution_submitted');

    // ─── 5) Match-all guard ───
    let r5 = false;
    let r5msg = '';
    try {
      await createRule({
        data: {
          companyId: company.id,
          name: `${PREFIX}-rule-bad-matchall`,
          event: 'case_closed',
          conditions: {},
          // isMatchAll: false (default)
          audience: [{ type: 'assignee' }],
          templateId: tpl.id,
          channel: 'InApp',
          mode: 'LogOnly',
        },
        user: { id: adminUser.id },
        allowedCompanyIds,
      });
    } catch (e) {
      r5 = e instanceof NotificationValidationError && e.code === 'match_all_confirm_required';
      r5msg = e.code;
    }
    record('5. createRule match-all without isMatchAll → 400', r5, r5msg);

    // ─── 6) mode='Active' blocked ───
    let r6 = false;
    let r6msg = '';
    try {
      await createRule({
        data: {
          companyId: company.id,
          name: `${PREFIX}-rule-active`,
          event: 'case_closed',
          conditions: { priority: 'High' },
          audience: [{ type: 'assignee' }],
          templateId: tpl.id,
          channel: 'Email',
          mode: 'Active',
        },
        user: { id: adminUser.id },
        allowedCompanyIds,
      });
    } catch (e) {
      r6 = e instanceof NotificationValidationError && e.code === 'mode_active_not_allowed';
      r6msg = e.code;
    }
    record('6. createRule mode=Active → 400', r6, r6msg);

    // ─── 7) Invalid event ───
    let r7 = false;
    let r7msg = '';
    try {
      await createRule({
        data: {
          companyId: company.id,
          name: `${PREFIX}-rule-bad-event`,
          event: 'bogus_event',
          conditions: { priority: 'High' },
          audience: [{ type: 'assignee' }],
          templateId: tpl.id,
          channel: 'InApp',
          mode: 'LogOnly',
        },
        user: { id: adminUser.id },
        allowedCompanyIds,
      });
    } catch (e) {
      r7 = e instanceof NotificationValidationError && e.code === 'event_invalid';
      r7msg = e.code;
    }
    record('7. createRule invalid event → 400', r7, r7msg);

    // ─── 8) Render resolves variables ───
    const { rendered: r8body, missing: r8missing } = renderTemplate(
      'Hello {{case.number}} for {{account.name}}',
      { 'case.number': 'VK-1', 'account.name': 'ACME' },
    );
    record(
      '8. renderTemplate resolves variables',
      r8body === 'Hello VK-1 for ACME' && r8missing.length === 0,
      r8body,
    );

    // ─── 9) Missing variable reported ───
    const { rendered: r9body, missing: r9missing } = renderTemplate(
      'Hi {{case.number}} — {{ghost}}',
      { 'case.number': 'VK-1' },
    );
    record(
      '9. renderTemplate flags missing var',
      r9body.includes('[ghost eksik]') && r9missing.includes('ghost'),
      `missing=${r9missing.join(',')}`,
    );

    // ─── Setup: case for emission tests ───
    const c1 = await caseRepository.create({
      title: `${PREFIX}-case-1`,
      description: 'smoke notif case',
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
    created.cases.push(c1.id);

    // ─── 10) emitEvent — rule matches, dispatch created ───
    const dispatches10 = await emitEvent({
      event: 'resolution_submitted',
      caseId: c1.id,
      approvalContext: { resolutionSummary: 'çözüldü', approverName: 'lead' },
    });
    record(
      '10. emitEvent inserts dispatch when rule matches',
      dispatches10.length === 1 && dispatches10[0].state === 'Sent',
      `state=${dispatches10[0]?.state} audienceId=${dispatches10[0]?.audienceIdentifier}`,
    );
    dispatches10.forEach((d) => created.dispatches.push(d.id));

    // ─── 11) Non-matching case → no dispatch ───
    const c2 = await caseRepository.create({
      title: `${PREFIX}-case-2`,
      description: 'non-match category',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: company.id,
      companyName: company.name,
      category: 'DonanımDışı', // rule's condition was category='Yazılım'
      subCategory: 'Genel',
      requestType: 'Talep',
      assignedTeamId: team.id,
      assignedTeamName: team.name,
      assignedPersonId: memberPerson.id,
      assignedPersonName: memberPerson.name,
    });
    created.cases.push(c2.id);
    const dispatches11 = await emitEvent({
      event: 'resolution_submitted',
      caseId: c2.id,
      approvalContext: { resolutionSummary: 'no match' },
    });
    record('11. emitEvent skips when conditions do not match', dispatches11.length === 0);

    // ─── 12) Idempotency: with suppress window, 2nd emit suppressed ───
    // Update rule to set suppress window.
    await prisma.notificationRule.update({
      where: { id: rule.id },
      data: { suppressDuplicateWithinMinutes: 10 },
    });
    // Emit twice in same window
    const first = await emitEvent({
      event: 'resolution_submitted',
      caseId: c1.id,
      approvalContext: { resolutionSummary: 'idem first' },
    });
    const second = await emitEvent({
      event: 'resolution_submitted',
      caseId: c1.id,
      approvalContext: { resolutionSummary: 'idem second' },
    });
    first.forEach((d) => created.dispatches.push(d.id));
    second.forEach((d) => created.dispatches.push(d.id));
    record(
      '12. emitEvent dedup — second emission within window suppressed',
      first.length === 1 &&
        second.length === 1 &&
        second[0].state === 'Suppressed' &&
        second[0].suppressionReason === 'duplicate_within_window',
      `2nd state=${second[0]?.state} reason=${second[0]?.suppressionReason}`,
    );

    // ─── 13) manualConfirmDispatch happy path ───
    // Need a Pending dispatch. Create a Manual-mode rule + emit.
    const tplManual = await createTemplate({
      data: {
        companyId: company.id,
        key: `${PREFIX}_manual_tpl`,
        name: 'manual tpl',
        subjectTemplate: 'subj',
        bodyTemplate: 'body',
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.templates.push(tplManual.id);
    const ruleManual = await createRule({
      data: {
        companyId: company.id,
        name: `${PREFIX}-rule-manual`,
        event: 'case_closed',
        conditions: {},
        isMatchAll: true,
        audience: [{ type: 'static_email', targetValue: 'reach@smoke.test' }],
        templateId: tplManual.id,
        channel: 'Email',
        mode: 'Manual',
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.rules.push(ruleManual.id);
    // Emit case_closed manually (we'll trigger via direct emit rather than
    // transitionStatus to avoid status-machine validation):
    const manualDispatches = await emitEvent({ event: 'case_closed', caseId: c1.id });
    manualDispatches.forEach((d) => created.dispatches.push(d.id));
    const pendingD = manualDispatches.find((d) => d.state === 'Pending');
    if (!pendingD) {
      record('13. manualConfirmDispatch happy path', false, 'no pending dispatch created');
    } else {
      const confirmed = await manualConfirmDispatch({
        dispatchId: pendingD.id,
        payload: { deliveryNote: 'Telefonla hallettim, müşteri tamam dedi.' },
        user: { id: leadUser.id, fullName: leadUser.fullName },
        allowedCompanyIds,
      });
      const caseAfter = await prisma.case.findUnique({
        where: { id: c1.id },
        select: { communicationState: true },
      });
      record(
        '13. manualConfirmDispatch happy path + case.communicationState=Manual',
        confirmed.state === 'Sent' && confirmed.mode === 'Manual' && caseAfter?.communicationState === 'Manual',
        `state=${confirmed.state} caseComm=${caseAfter?.communicationState}`,
      );

      // ─── 14) Missing deliveryNote → 400 ───
      // Need another pending dispatch — second case_closed within window
      // is suppressed; create another case + emit.
      const c3 = await caseRepository.create({
        title: `${PREFIX}-case-3`,
        description: 'second close',
        caseType: 'GeneralSupport',
        priority: 'Medium',
        origin: 'Telefon',
        companyId: company.id,
        companyName: company.name,
        category: 'DonanımDışı',
        subCategory: 'Genel',
        requestType: 'Talep',
        assignedTeamId: team.id,
        assignedTeamName: team.name,
        assignedPersonId: memberPerson.id,
        assignedPersonName: memberPerson.name,
      });
      created.cases.push(c3.id);
      const c3dispatches = await emitEvent({ event: 'case_closed', caseId: c3.id });
      c3dispatches.forEach((d) => created.dispatches.push(d.id));
      const pendingD3 = c3dispatches.find((d) => d.state === 'Pending');
      let r14 = false;
      let r14msg = '';
      if (pendingD3) {
        try {
          await manualConfirmDispatch({
            dispatchId: pendingD3.id,
            payload: { deliveryNote: '' },
            user: { id: leadUser.id, fullName: leadUser.fullName },
            allowedCompanyIds,
          });
        } catch (e) {
          r14 = e instanceof NotificationValidationError && e.code === 'delivery_note_required';
          r14msg = e.code;
        }
      } else {
        r14msg = 'no pending dispatch on c3';
      }
      record('14. manualConfirmDispatch missing deliveryNote → 400', r14, r14msg);
    }

    // ─── 15) Integration: submitApproval fires resolution_submitted ───
    // Create a policy so submit goes through, then submit + verify dispatch.
    const policy = await createPolicy({
      data: {
        companyId: company.id,
        name: `${PREFIX}-policy-int`,
        approverType: 'AssignedTeamLead',
        rejectionBehavior: 'ReturnToAssignee',
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.policies.push(policy.id);

    const c4 = await caseRepository.create({
      title: `${PREFIX}-case-4`,
      description: 'integration test',
      caseType: 'GeneralSupport',
      priority: 'High',
      origin: 'Telefon',
      companyId: company.id,
      companyName: company.name,
      category: 'Yazılım', // matches rule conditions
      subCategory: 'Genel',
      requestType: 'Talep',
      assignedTeamId: team.id,
      assignedTeamName: team.name,
      assignedPersonId: memberPerson.id,
      assignedPersonName: memberPerson.name,
    });
    created.cases.push(c4.id);

    await submitApproval({
      caseId: c4.id,
      payload: { resolutionSummary: 'Integration submit' },
      user: { id: memberUser.id, personId: memberPerson.id, fullName: memberPerson.name },
      allowedCompanyIds,
    });

    // Give the fire-and-forget event a beat to land.
    await new Promise((res) => setTimeout(res, 1500));
    const dispatchesAfterSubmit = await prisma.notificationDispatch.findMany({
      where: { caseId: c4.id, event: 'resolution_submitted' },
    });
    record(
      '15. submitApproval fires resolution_submitted event → dispatch created',
      dispatchesAfterSubmit.length >= 1,
      `count=${dispatchesAfterSubmit.length}`,
    );
    dispatchesAfterSubmit.forEach((d) => created.dispatches.push(d.id));

    // ─── Phase 2 review fixes ───────────────────────────────────────
    // The next three scenarios exercise the post-review fixes shipped on
    // the Phase 3 branch:
    //   16) manualConfirmDispatch must 409 on Suppressed rows (audit
    //       integrity — never flip a Suppressed row to Sent).
    //   17) emitEvent must enforce rule.rateLimitPerHour by writing
    //       Suppressed/rate_limit_exceeded rows once the cap is reached.
    //   18) manual-confirming a rate-limited Suppressed row also 409s
    //       (same audit invariant as 16, different path).

    // ─── 16) Suppressed manual-confirm → 409 ────────────────────────
    // Use scenario 12's already-suppressed dispatch (duplicate_within_window).
    const existingSuppressed = await prisma.notificationDispatch.findFirst({
      where: {
        caseId: c1.id,
        state: 'Suppressed',
        suppressionReason: 'duplicate_within_window',
      },
    });
    let r16 = false;
    let r16msg = '';
    if (!existingSuppressed) {
      r16msg = 'no suppressed dispatch from prior scenarios';
    } else {
      try {
        await manualConfirmDispatch({
          dispatchId: existingSuppressed.id,
          payload: { deliveryNote: 'invalid — should be blocked' },
          user: { id: leadUser.id, fullName: leadUser.fullName },
          allowedCompanyIds,
        });
      } catch (e) {
        r16 = e instanceof NotificationValidationError && e.code === 'dispatch_already_finalized';
        r16msg = e.code ?? e.message;
      }
      // State must NOT have changed.
      const refetched = await prisma.notificationDispatch.findUnique({
        where: { id: existingSuppressed.id },
      });
      r16 = r16 && refetched?.state === 'Suppressed' && refetched?.confirmedByUserId == null;
      r16msg = `${r16msg} stateAfter=${refetched?.state}`;
    }
    record('16. manual-confirm on Suppressed → 409, state unchanged', r16, r16msg);

    // ─── 17) rateLimitPerHour enforcement ──────────────────────────
    // Fresh rule with rateLimitPerHour=1 and no suppressDuplicateWithinMinutes,
    // so the only suppression source is the rate-limit guard. Use a unique
    // case so prior counts don't leak in.
    const tplRate = await createTemplate({
      data: {
        companyId: company.id,
        key: `${PREFIX}_rate_tpl`,
        name: 'rate tpl',
        subjectTemplate: 'subj',
        bodyTemplate: 'body',
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.templates.push(tplRate.id);
    const ruleRate = await createRule({
      data: {
        companyId: company.id,
        name: `${PREFIX}-rule-rate-limited`,
        event: 'case_reopened',
        conditions: {},
        isMatchAll: true,
        audience: [{ type: 'assignee' }],
        templateId: tplRate.id,
        channel: 'InApp',
        mode: 'LogOnly',
        rateLimitPerHour: 1,
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.rules.push(ruleRate.id);

    const cRate1 = await caseRepository.create({
      title: `${PREFIX}-case-rate-1`,
      description: 'rate-limit first',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: company.id,
      companyName: company.name,
      category: 'X',
      subCategory: 'Y',
      requestType: 'Talep',
      assignedTeamId: team.id,
      assignedTeamName: team.name,
      assignedPersonId: memberPerson.id,
      assignedPersonName: memberPerson.name,
    });
    created.cases.push(cRate1.id);
    const cRate2 = await caseRepository.create({
      title: `${PREFIX}-case-rate-2`,
      description: 'rate-limit second',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: company.id,
      companyName: company.name,
      category: 'X',
      subCategory: 'Y',
      requestType: 'Talep',
      assignedTeamId: team.id,
      assignedTeamName: team.name,
      assignedPersonId: memberPerson.id,
      assignedPersonName: memberPerson.name,
    });
    created.cases.push(cRate2.id);

    const firstRate = await emitEvent({ event: 'case_reopened', caseId: cRate1.id });
    const secondRate = await emitEvent({ event: 'case_reopened', caseId: cRate2.id });
    firstRate.forEach((d) => created.dispatches.push(d.id));
    secondRate.forEach((d) => created.dispatches.push(d.id));

    const firstDispatch = firstRate.find((d) => d.ruleId === ruleRate.id);
    const secondDispatch = secondRate.find((d) => d.ruleId === ruleRate.id);
    record(
      '17a. first emit under rate limit → Sent',
      firstDispatch?.state === 'Sent' && firstDispatch?.suppressionReason == null,
      `state=${firstDispatch?.state} reason=${firstDispatch?.suppressionReason}`,
    );
    record(
      '17b. second emit at cap → Suppressed/rate_limit_exceeded',
      secondDispatch?.state === 'Suppressed' &&
        secondDispatch?.suppressionReason === 'rate_limit_exceeded',
      `state=${secondDispatch?.state} reason=${secondDispatch?.suppressionReason}`,
    );

    // ─── 18) manual-confirm on rate-limited Suppressed → 409 ───────
    let r18 = false;
    let r18msg = '';
    if (secondDispatch) {
      try {
        await manualConfirmDispatch({
          dispatchId: secondDispatch.id,
          payload: { deliveryNote: 'should be blocked too' },
          user: { id: leadUser.id, fullName: leadUser.fullName },
          allowedCompanyIds,
        });
      } catch (e) {
        r18 = e instanceof NotificationValidationError && e.code === 'dispatch_already_finalized';
        r18msg = e.code ?? e.message;
      }
      const refetched = await prisma.notificationDispatch.findUnique({
        where: { id: secondDispatch.id },
      });
      r18 = r18 && refetched?.state === 'Suppressed' && refetched?.confirmedByUserId == null;
      r18msg = `${r18msg} stateAfter=${refetched?.state}`;
    } else {
      r18msg = 'no rate-limited dispatch';
    }
    record('18. manual-confirm on rate-limited Suppressed → 409, state unchanged', r18, r18msg);
  } catch (err) {
    console.error('smoke fatal:', err);
    results.push({ name: 'fatal', ok: false, detail: err?.message });
  } finally {
    if (created.dispatches.length) {
      await prisma.notificationDispatch.deleteMany({ where: { id: { in: created.dispatches } } }).catch(() => {});
    }
    if (created.cases.length) {
      await prisma.notificationDispatch.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.caseResolutionApproval.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.caseActivity.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.case.deleteMany({ where: { id: { in: created.cases } } }).catch(() => {});
    }
    if (created.rules.length) {
      await prisma.notificationRule.deleteMany({ where: { id: { in: created.rules } } }).catch(() => {});
    }
    if (created.templates.length) {
      await prisma.notificationTemplate.deleteMany({ where: { id: { in: created.templates } } }).catch(() => {});
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

// Suppress unused-import warning (we keep updateTemplate exported even though
// not directly tested here — admin UI uses it).
void updateTemplate;
void NotificationAccessError;

run();
