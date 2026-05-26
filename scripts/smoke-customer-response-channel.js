/**
 * WR-D4/D3 Phase 3 — Customer Response Channel smoke + Level A path.
 *
 * Repository-level scenarios. Covers:
 *
 *   Channel resolver (resolveCustomerCommunication):
 *     1.  No accountId → manual + no_channel_available
 *     2.  AccountCompany missing → defaults to account fallback (email if any)
 *     3.  Account.email only → channel=email, source=account_fallback
 *     4.  Account.phone only → channel=phone, source=account_fallback
 *     5.  Account has neither → channel=manual, no_channel_available
 *     6.  AccountContact.preferredChannel beats account fallback
 *     7.  AccountCompany.preferredResponseChannel beats contact pref
 *     8.  AccountCompany.responseEmail beats AccountContact.email
 *     9.  Case override beats AccountCompany pref (channel only)
 *     10. allowCustomerNotifications=false → customer_opted_out
 *     11. AC prefers email but no email anywhere → no_channel_available
 *
 *   Audience resolver integration (emitEvent):
 *     12. Opt-out → Suppressed/customer_opted_out
 *     13. No-channel → Pending + suppressionReason=no_channel_available
 *     14. Override→email + responseEmail set → audienceIdentifier matches
 *     15. End-to-end Level A: policy + approval submit + approve →
 *         resolution_approved event fires → customer-facing dispatch
 *         carries resolved channel/identifier; manual-confirm succeeds.
 *
 * Run: node --env-file=.env scripts/smoke-customer-response-channel.js
 *
 * Mutation: all rows cleaned up in finally{}.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import {
  createRule,
  createTemplate,
  emitEvent,
  manualConfirmDispatch,
  resolveCustomerCommunication,
} from '../server/db/notificationRepository.js';
import {
  approveApproval,
  createPolicy,
  submitApproval,
} from '../server/db/approvalRepository.js';
import {
  addCompanyRelation,
  getAccount,
  updateCompanyRelation,
} from '../server/db/accountRepository.js';
import { caseRepository } from '../server/db/caseRepository.js';

const stamp = Date.now();
const PREFIX = `crc_${stamp}`;
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

function makeCaseRow({ companyId, accountId = null, override = null }) {
  return { id: 'fake', companyId, accountId, communicationChannelOverride: override };
}

async function run() {
  console.log('🔍 customer-response-channel smoke\n');
  const company = await pickCompany();
  const allowedCompanyIds = [company.id];
  console.log(`Company: ${company.id} (${company.name})\n`);

  const created = {
    accounts: [],
    accountCompanies: [],
    accountContacts: [],
    cases: [],
    rules: [],
    templates: [],
    policies: [],
    teams: [],
    persons: [],
    users: [],
    dispatches: [],
  };

  try {
    // ─── Setup: team / persons / users ───────────────────────────
    const team = await prisma.team.create({ data: { name: `${PREFIX}-team`, companyId: company.id } });
    created.teams.push(team.id);
    const leadPerson = await prisma.person.create({
      data: { name: `${PREFIX}-lead`, teamId: team.id, isTeamLead: true, isActive: true, email: `${PREFIX}-lead@smoke.test` },
    });
    created.persons.push(leadPerson.id);
    const memberPerson = await prisma.person.create({
      data: { name: `${PREFIX}-member`, teamId: team.id, isActive: true, email: `${PREFIX}-member@smoke.test` },
    });
    created.persons.push(memberPerson.id);
    const memberUser = await prisma.user.create({
      data: { id: randomUUID(), email: `${PREFIX}-member-user@smoke.test`, fullName: memberPerson.name, personId: memberPerson.id },
    });
    created.users.push(memberUser.id);
    const leadUser = await prisma.user.create({
      data: { id: randomUUID(), email: `${PREFIX}-lead-user@smoke.test`, fullName: leadPerson.name, personId: leadPerson.id },
    });
    created.users.push(leadUser.id);
    const adminUser = await prisma.user.create({
      data: { id: randomUUID(), email: `${PREFIX}-admin@smoke.test`, fullName: `${PREFIX}-admin` },
    });
    created.users.push(adminUser.id);

    /* ─── Resolver unit-style scenarios (no Case row needed) ───── */

    // 1) No accountId → manual + no_channel_available
    {
      const r = await resolveCustomerCommunication({
        caseRow: makeCaseRow({ companyId: company.id, accountId: null }),
      });
      record(
        '1. no accountId → manual + no_channel_available',
        r.channel === 'manual' && r.suppressionReason === 'no_channel_available',
        `channel=${r.channel} reason=${r.suppressionReason}`,
      );
    }

    // Account with email only — used in #2, #3
    const accEmailOnly = await prisma.account.create({
      data: { name: `${PREFIX}-acc-email`, email: `${PREFIX}-acc@smoke.test`, companyId: company.id },
    });
    created.accounts.push(accEmailOnly.id);

    // 2) No AccountCompany row — should fall through to account.email
    {
      const r = await resolveCustomerCommunication({
        caseRow: makeCaseRow({ companyId: company.id, accountId: accEmailOnly.id }),
      });
      record(
        '2. AccountCompany missing → account email fallback',
        r.channel === 'email' &&
          r.identifier === `${PREFIX}-acc@smoke.test` &&
          r.source === 'account_fallback',
        `channel=${r.channel} id=${r.identifier} source=${r.source}`,
      );
    }

    // 3) Account.email only + AccountCompany with no prefs → still account fallback
    const acEmailOnly = await prisma.accountCompany.create({
      data: { accountId: accEmailOnly.id, companyId: company.id },
    });
    created.accountCompanies.push(acEmailOnly.id);
    {
      const r = await resolveCustomerCommunication({
        caseRow: makeCaseRow({ companyId: company.id, accountId: accEmailOnly.id }),
      });
      record(
        '3. AC with no prefs → account.email fallback',
        r.channel === 'email' && r.identifier === `${PREFIX}-acc@smoke.test` && r.source === 'account_fallback',
        `channel=${r.channel}`,
      );
    }

    // 4) Phone-only account
    const accPhoneOnly = await prisma.account.create({
      data: { name: `${PREFIX}-acc-phone`, phone: '+905550000001', companyId: company.id },
    });
    created.accounts.push(accPhoneOnly.id);
    const acPhoneOnly = await prisma.accountCompany.create({
      data: { accountId: accPhoneOnly.id, companyId: company.id },
    });
    created.accountCompanies.push(acPhoneOnly.id);
    {
      const r = await resolveCustomerCommunication({
        caseRow: makeCaseRow({ companyId: company.id, accountId: accPhoneOnly.id }),
      });
      record(
        '4. Account.phone only → phone fallback',
        r.channel === 'phone' && r.identifier === '+905550000001' && r.source === 'account_fallback',
        `channel=${r.channel} id=${r.identifier}`,
      );
    }

    // 5) Account has neither email nor phone, AC empty → manual + no_channel_available
    const accNeither = await prisma.account.create({
      data: { name: `${PREFIX}-acc-none`, companyId: company.id },
    });
    created.accounts.push(accNeither.id);
    const acNeither = await prisma.accountCompany.create({
      data: { accountId: accNeither.id, companyId: company.id },
    });
    created.accountCompanies.push(acNeither.id);
    {
      const r = await resolveCustomerCommunication({
        caseRow: makeCaseRow({ companyId: company.id, accountId: accNeither.id }),
      });
      record(
        '5. no email / no phone → manual + no_channel_available',
        r.channel === 'manual' && r.suppressionReason === 'no_channel_available',
        `channel=${r.channel} reason=${r.suppressionReason}`,
      );
    }

    // 6) AccountContact.preferredChannel beats account fallback
    const accContactPref = await prisma.account.create({
      data: { name: `${PREFIX}-acc-contactpref`, email: `${PREFIX}-acc-cp@smoke.test`, phone: '+905550000002', companyId: company.id },
    });
    created.accounts.push(accContactPref.id);
    const acContactPref = await prisma.accountCompany.create({
      data: { accountId: accContactPref.id, companyId: company.id },
    });
    created.accountCompanies.push(acContactPref.id);
    const contactPref = await prisma.accountContact.create({
      data: {
        accountId: accContactPref.id,
        fullName: 'Contact Person',
        email: `${PREFIX}-cp@smoke.test`,
        phone: '+905550009002',
        isPrimary: true,
        isActive: true,
        preferredChannel: 'phone',
      },
    });
    created.accountContacts.push(contactPref.id);
    {
      const r = await resolveCustomerCommunication({
        caseRow: makeCaseRow({ companyId: company.id, accountId: accContactPref.id }),
      });
      record(
        '6. AccountContact pref=phone beats account email fallback',
        r.channel === 'phone' && r.identifier === '+905550009002' && r.source === 'account_contact',
        `channel=${r.channel} id=${r.identifier} src=${r.source}`,
      );
    }

    // 7) AccountCompany.preferredResponseChannel beats contact pref
    await prisma.accountCompany.update({
      where: { id: acContactPref.id },
      data: { preferredResponseChannel: 'email' },
    });
    {
      const r = await resolveCustomerCommunication({
        caseRow: makeCaseRow({ companyId: company.id, accountId: accContactPref.id }),
      });
      record(
        '7. AC.preferredResponseChannel=email beats contact pref=phone',
        r.channel === 'email' && r.source === 'account_company',
        `channel=${r.channel} src=${r.source}`,
      );
    }

    // 8) AC.responseEmail beats contact.email
    await prisma.accountCompany.update({
      where: { id: acContactPref.id },
      data: { responseEmail: `${PREFIX}-ac@smoke.test` },
    });
    {
      const r = await resolveCustomerCommunication({
        caseRow: makeCaseRow({ companyId: company.id, accountId: accContactPref.id }),
      });
      record(
        '8. AC.responseEmail beats AccountContact.email',
        r.identifier === `${PREFIX}-ac@smoke.test`,
        `id=${r.identifier}`,
      );
    }

    // 9) Case override beats AccountCompany pref (channel only — address still chained)
    {
      const r = await resolveCustomerCommunication({
        caseRow: makeCaseRow({ companyId: company.id, accountId: accContactPref.id, override: 'phone' }),
      });
      record(
        '9. Case override=phone beats AC.preferredResponseChannel=email',
        r.channel === 'phone' && r.source === 'case_override' && r.identifier === '+905550009002',
        `channel=${r.channel} id=${r.identifier} src=${r.source}`,
      );
    }

    // 10) allowCustomerNotifications=false → customer_opted_out
    await prisma.accountCompany.update({
      where: { id: acContactPref.id },
      data: { allowCustomerNotifications: false },
    });
    {
      const r = await resolveCustomerCommunication({
        caseRow: makeCaseRow({ companyId: company.id, accountId: accContactPref.id }),
      });
      record(
        '10. allowCustomerNotifications=false → customer_opted_out',
        r.suppressionReason === 'customer_opted_out' && r.channel === null,
        `reason=${r.suppressionReason}`,
      );
    }
    // Restore so subsequent scenarios are not affected
    await prisma.accountCompany.update({
      where: { id: acContactPref.id },
      data: { allowCustomerNotifications: true },
    });

    // 11) AC prefers email but no email anywhere → no_channel_available
    const accNoEmail = await prisma.account.create({
      data: { name: `${PREFIX}-acc-noemail`, phone: '+905550000099', companyId: company.id },
    });
    created.accounts.push(accNoEmail.id);
    const acNoEmail = await prisma.accountCompany.create({
      data: { accountId: accNoEmail.id, companyId: company.id, preferredResponseChannel: 'email' },
    });
    created.accountCompanies.push(acNoEmail.id);
    {
      const r = await resolveCustomerCommunication({
        caseRow: makeCaseRow({ companyId: company.id, accountId: accNoEmail.id }),
      });
      record(
        '11. AC prefers email + no email anywhere → manual + no_channel_available',
        r.channel === 'manual' && r.suppressionReason === 'no_channel_available',
        `channel=${r.channel} reason=${r.suppressionReason}`,
      );
    }

    /* ─── Audience resolver integration (emitEvent) ───── */

    // Common template + rule for case_closed → customer_primary_contact / Email
    const tpl = await createTemplate({
      data: {
        companyId: company.id,
        key: `${PREFIX}_tpl`,
        name: 'phase3 tpl',
        subjectTemplate: 'Vaka {{case.number}}',
        bodyTemplate: 'Merhaba {{account.name}}, vakanız çözüldü.',
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.templates.push(tpl.id);
    const rule = await createRule({
      data: {
        companyId: company.id,
        name: `${PREFIX}-rule-customer`,
        event: 'case_closed',
        conditions: {},
        isMatchAll: true,
        audience: [{ type: 'customer_primary_contact' }],
        templateId: tpl.id,
        channel: 'Email',
        mode: 'Manual',
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.rules.push(rule.id);

    // 12) Opt-out → Suppressed/customer_opted_out via emitEvent.
    // Mark accNoEmail's AC as opt-out, attach a case, fire case_closed.
    await prisma.accountCompany.update({
      where: { id: acNoEmail.id },
      data: { allowCustomerNotifications: false, preferredResponseChannel: null },
    });
    const cOptOut = await caseRepository.create({
      title: `${PREFIX}-case-optout`,
      description: 'optout',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: company.id,
      companyName: company.name,
      accountId: accNoEmail.id,
      accountName: accNoEmail.name,
      category: 'X',
      subCategory: 'Y',
      requestType: 'Talep',
      assignedTeamId: team.id,
      assignedTeamName: team.name,
      assignedPersonId: memberPerson.id,
      assignedPersonName: memberPerson.name,
    });
    created.cases.push(cOptOut.id);
    const optOutDispatches = await emitEvent({ event: 'case_closed', caseId: cOptOut.id });
    optOutDispatches.forEach((d) => created.dispatches.push(d.id));
    const optOutD = optOutDispatches.find((d) => d.audienceType === 'customer_primary_contact');
    record(
      '12. emitEvent + opt-out → Suppressed/customer_opted_out',
      optOutD?.state === 'Suppressed' && optOutD?.suppressionReason === 'customer_opted_out',
      `state=${optOutD?.state} reason=${optOutD?.suppressionReason}`,
    );

    // 13) No channel available → Pending + suppressionReason=no_channel_available
    // Fresh account with only a phone but rule.channel='Email' → no email anywhere → manual fallback.
    await prisma.accountCompany.update({
      where: { id: acNoEmail.id },
      data: { allowCustomerNotifications: true, preferredResponseChannel: 'email' },
    });
    const cNoChannel = await caseRepository.create({
      title: `${PREFIX}-case-nochannel`,
      description: 'nochan',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: company.id,
      companyName: company.name,
      accountId: accNoEmail.id,
      accountName: accNoEmail.name,
      category: 'X',
      subCategory: 'Y',
      requestType: 'Talep',
      assignedTeamId: team.id,
      assignedTeamName: team.name,
      assignedPersonId: memberPerson.id,
      assignedPersonName: memberPerson.name,
    });
    created.cases.push(cNoChannel.id);
    const noChanDispatches = await emitEvent({ event: 'case_closed', caseId: cNoChannel.id });
    noChanDispatches.forEach((d) => created.dispatches.push(d.id));
    const noChanD = noChanDispatches.find((d) => d.audienceType === 'customer_primary_contact');
    record(
      '13. emitEvent + no email anywhere → Pending + no_channel_available',
      noChanD?.state === 'Pending' &&
        noChanD?.suppressionReason === 'no_channel_available' &&
        noChanD?.audienceIdentifier === 'manual',
      `state=${noChanD?.state} reason=${noChanD?.suppressionReason} id=${noChanD?.audienceIdentifier}`,
    );

    // 14) Override→email + responseEmail set → identifier matches responseEmail
    // Use accContactPref (has AC.responseEmail set) and override the case to email.
    const cOverride = await caseRepository.create({
      title: `${PREFIX}-case-override`,
      description: 'override',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: company.id,
      companyName: company.name,
      accountId: accContactPref.id,
      accountName: accContactPref.name,
      category: 'X',
      subCategory: 'Y',
      requestType: 'Talep',
      assignedTeamId: team.id,
      assignedTeamName: team.name,
      assignedPersonId: memberPerson.id,
      assignedPersonName: memberPerson.name,
    });
    created.cases.push(cOverride.id);
    await prisma.case.update({
      where: { id: cOverride.id },
      data: { communicationChannelOverride: 'email' },
    });
    const overrideDispatches = await emitEvent({ event: 'case_closed', caseId: cOverride.id });
    overrideDispatches.forEach((d) => created.dispatches.push(d.id));
    const overrideD = overrideDispatches.find((d) => d.audienceType === 'customer_primary_contact');
    record(
      '14. emitEvent + Case override=email → audienceIdentifier=AC.responseEmail',
      overrideD?.audienceIdentifier === `${PREFIX}-ac@smoke.test` &&
        overrideD?.state === 'Pending',
      `id=${overrideD?.audienceIdentifier} state=${overrideD?.state}`,
    );

    // 15) End-to-end Level A — policy + approval submit + approve fires
    //     resolution_approved customer-facing dispatch with resolved channel.
    const policy = await createPolicy({
      data: {
        companyId: company.id,
        name: `${PREFIX}-policy-levelA`,
        approverType: 'AssignedTeamLead',
        rejectionBehavior: 'ReturnToAssignee',
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.policies.push(policy.id);

    // Create a rule for resolution_approved → customer_primary_contact Email/Manual.
    const ruleApproved = await createRule({
      data: {
        companyId: company.id,
        name: `${PREFIX}-rule-approved`,
        event: 'resolution_approved',
        conditions: {},
        isMatchAll: true,
        audience: [{ type: 'customer_primary_contact' }],
        templateId: tpl.id,
        channel: 'Email',
        mode: 'Manual',
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.rules.push(ruleApproved.id);

    const cLevelA = await caseRepository.create({
      title: `${PREFIX}-case-levelA`,
      description: 'level A path',
      caseType: 'GeneralSupport',
      priority: 'High',
      origin: 'Telefon',
      companyId: company.id,
      companyName: company.name,
      accountId: accContactPref.id,
      accountName: accContactPref.name,
      category: 'X',
      subCategory: 'Y',
      requestType: 'Talep',
      assignedTeamId: team.id,
      assignedTeamName: team.name,
      assignedPersonId: memberPerson.id,
      assignedPersonName: memberPerson.name,
    });
    created.cases.push(cLevelA.id);

    const approval = await submitApproval({
      caseId: cLevelA.id,
      payload: { resolutionSummary: 'Level A çözüm özeti' },
      user: { id: memberUser.id, personId: memberPerson.id, fullName: memberPerson.name },
      allowedCompanyIds,
    });
    await approveApproval({
      approvalId: approval.id,
      payload: {},
      user: { id: leadUser.id, personId: leadPerson.id, fullName: leadPerson.name, role: 'Supervisor' },
      allowedCompanyIds,
    });

    // Wait for fire-and-forget event emission to land.
    // Bumped 2500 → 4000 after WR-ACTION-CENTER Phase 1 added parallel
    // ActionItem upserts in approveApproval / rejectApproval.
    await new Promise((res) => setTimeout(res, 4000));

    const approvedDispatches = await prisma.notificationDispatch.findMany({
      where: {
        caseId: cLevelA.id,
        event: 'resolution_approved',
        audienceType: 'customer_primary_contact',
      },
    });
    approvedDispatches.forEach((d) => created.dispatches.push(d.id));
    const approvedD = approvedDispatches[0];
    record(
      '15a. resolution_approved → customer dispatch created with resolved channel',
      approvedD &&
        approvedD.state === 'Pending' &&
        approvedD.audienceIdentifier === `${PREFIX}-ac@smoke.test`,
      `state=${approvedD?.state} id=${approvedD?.audienceIdentifier}`,
    );

    // Operator manual-confirms the customer-facing dispatch.
    if (approvedD) {
      const confirmed = await manualConfirmDispatch({
        dispatchId: approvedD.id,
        payload: { deliveryNote: 'Müşteriye e-posta gönderildi 14:30; teyit alındı.' },
        user: { id: leadUser.id, fullName: leadUser.fullName },
        allowedCompanyIds,
      });
      const caseAfter = await prisma.case.findUnique({
        where: { id: cLevelA.id },
        select: { communicationState: true },
      });
      record(
        '15b. Level A manual-confirm completes the customer comm loop',
        confirmed.state === 'Sent' &&
          confirmed.mode === 'Manual' &&
          confirmed.deliveryNote != null &&
          caseAfter?.communicationState === 'Manual',
        `state=${confirmed.state} mode=${confirmed.mode} caseComm=${caseAfter?.communicationState}`,
      );
    } else {
      record('15b. Level A manual-confirm completes the customer comm loop', false, 'no dispatch');
    }

    // ─── Phase 3 review fixes (Codex P1 #1 + #2) ────────────────────
    // Round-trip integrity for AccountCompany customer response channel
    // preferences across addCompanyRelation (create) and updateCompanyRelation
    // (update + edit-preserves invariant).
    //
    // The bug bundle:
    //   #1 — addCompanyRelation silently dropped the 4 commPrefs fields
    //        so AccountCompanyEditor's create flow never persisted them.
    //   #2 — getAccount did not return the 4 commPrefs columns; the editor
    //        loaded them as undefined → defaulted → submitted back as
    //        null/true → overwrote stored values.

    // Need a separate company id (the existing acContactPref is already on
    // `company.id` — duplicate (accountId, companyId) is unique-blocked.
    // Pick a second active company for these scenarios, or fall back if
    // none exists.
    const secondCompany = await prisma.company.findFirst({
      where: { id: { not: company.id }, isActive: true },
      select: { id: true },
    });
    if (!secondCompany) {
      record('16-19. AccountCompany commPrefs round-trip', false, 'second active company not found in tenant set');
    } else {
      const allowedForPrefs = [company.id, secondCompany.id];
      const adminUserForAcc = { id: adminUser.id, role: 'SystemAdmin', allowedCompanyIds: allowedForPrefs };

      // 16) Create with explicit commPrefs → persisted on reload
      const prefsAccount = await prisma.account.create({
        data: { name: `${PREFIX}-acc-prefs`, companyId: secondCompany.id },
      });
      created.accounts.push(prefsAccount.id);

      await addCompanyRelation({
        accountId: prefsAccount.id,
        data: {
          companyId: secondCompany.id,
          preferredResponseChannel: 'phone',
          responseEmail: 'create@smoke.test',
          responsePhone: '+905550999000',
          allowCustomerNotifications: false,
        },
        user: adminUserForAcc,
      });

      const reloaded16 = await getAccount(prefsAccount.id, { allowedCompanyIds: allowedForPrefs });
      const ac16 = reloaded16?.companies?.find((c) => c.companyId === secondCompany.id);
      // Track the created AC for cleanup.
      if (ac16?.accountCompanyId) created.accountCompanies.push(ac16.accountCompanyId);

      record(
        '16. addCompanyRelation persists all 4 commPrefs fields',
        ac16?.preferredResponseChannel === 'phone' &&
          ac16?.responseEmail === 'create@smoke.test' &&
          ac16?.responsePhone === '+905550999000' &&
          ac16?.allowCustomerNotifications === false,
        `channel=${ac16?.preferredResponseChannel} email=${ac16?.responseEmail} phone=${ac16?.responsePhone} allow=${ac16?.allowCustomerNotifications}`,
      );

      // 17) Edit an UNRELATED field (notes) → commPrefs preserved.
      // Reflects the editor's real submit shape: the loaded relation is
      // round-tripped, so all commPrefs reappear in the patch body. The
      // bug was that they came back as defaults; now they come back as the
      // actual stored values.
      await updateCompanyRelation({
        accountId: prefsAccount.id,
        accountCompanyId: ac16.accountCompanyId,
        data: {
          notes: 'edit-only-notes',
          // Form round-trips loaded values:
          preferredResponseChannel: ac16.preferredResponseChannel,
          responseEmail: ac16.responseEmail,
          responsePhone: ac16.responsePhone,
          allowCustomerNotifications: ac16.allowCustomerNotifications,
        },
        user: adminUserForAcc,
      });
      const reloaded17 = await getAccount(prefsAccount.id, { allowedCompanyIds: allowedForPrefs });
      const ac17 = reloaded17?.companies?.find((c) => c.accountCompanyId === ac16.accountCompanyId);
      record(
        '17. updateCompanyRelation editing unrelated field preserves commPrefs',
        ac17?.preferredResponseChannel === 'phone' &&
          ac17?.responseEmail === 'create@smoke.test' &&
          ac17?.responsePhone === '+905550999000' &&
          ac17?.allowCustomerNotifications === false &&
          ac17?.notes === 'edit-only-notes',
        `channel=${ac17?.preferredResponseChannel} email=${ac17?.responseEmail} allow=${ac17?.allowCustomerNotifications}`,
      );

      // 18) Edit can intentionally change commPrefs.
      await updateCompanyRelation({
        accountId: prefsAccount.id,
        accountCompanyId: ac16.accountCompanyId,
        data: {
          preferredResponseChannel: 'email',
          responseEmail: 'updated@smoke.test',
          responsePhone: '',
          allowCustomerNotifications: true,
        },
        user: adminUserForAcc,
      });
      const reloaded18 = await getAccount(prefsAccount.id, { allowedCompanyIds: allowedForPrefs });
      const ac18 = reloaded18?.companies?.find((c) => c.accountCompanyId === ac16.accountCompanyId);
      record(
        '18. updateCompanyRelation intentionally changes commPrefs (channel + email + clear phone + opt-in)',
        ac18?.preferredResponseChannel === 'email' &&
          ac18?.responseEmail === 'updated@smoke.test' &&
          ac18?.responsePhone === null &&
          ac18?.allowCustomerNotifications === true,
        `channel=${ac18?.preferredResponseChannel} email=${ac18?.responseEmail} phone=${ac18?.responsePhone} allow=${ac18?.allowCustomerNotifications}`,
      );

      // 19) Opt-out (allowCustomerNotifications=false) persists and remains
      //     false after an unrelated edit (reverse of #17 with opt-out
      //     explicitly the target invariant).
      await updateCompanyRelation({
        accountId: prefsAccount.id,
        accountCompanyId: ac16.accountCompanyId,
        data: { allowCustomerNotifications: false },
        user: adminUserForAcc,
      });
      await updateCompanyRelation({
        accountId: prefsAccount.id,
        accountCompanyId: ac16.accountCompanyId,
        data: {
          segment: 'pilot',
          // Editor would round-trip current loaded prefs:
          preferredResponseChannel: 'email',
          responseEmail: 'updated@smoke.test',
          responsePhone: null,
          allowCustomerNotifications: false,
        },
        user: adminUserForAcc,
      });
      const reloaded19 = await getAccount(prefsAccount.id, { allowedCompanyIds: allowedForPrefs });
      const ac19 = reloaded19?.companies?.find((c) => c.accountCompanyId === ac16.accountCompanyId);
      record(
        '19. allowCustomerNotifications=false persists across unrelated edits',
        ac19?.allowCustomerNotifications === false && ac19?.segment === 'pilot',
        `allow=${ac19?.allowCustomerNotifications} segment=${ac19?.segment}`,
      );
    }
  } catch (err) {
    console.error('smoke fatal:', err);
    results.push({ name: 'fatal', ok: false, detail: err?.message });
  } finally {
    // Order: dispatches → activity → approvals → cases → AC contact/projects → AccountCompany → accounts → templates/rules/policies → users/persons/teams.
    if (created.dispatches.length) {
      await prisma.notificationDispatch.deleteMany({ where: { id: { in: created.dispatches } } }).catch(() => {});
    }
    if (created.cases.length) {
      await prisma.notificationDispatch.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.caseResolutionApproval.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.caseActivity.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.case.deleteMany({ where: { id: { in: created.cases } } }).catch(() => {});
    }
    if (created.accountContacts.length) {
      await prisma.accountContact.deleteMany({ where: { id: { in: created.accountContacts } } }).catch(() => {});
    }
    if (created.accountCompanies.length) {
      await prisma.accountCompany.deleteMany({ where: { id: { in: created.accountCompanies } } }).catch(() => {});
    }
    if (created.accounts.length) {
      await prisma.account.deleteMany({ where: { id: { in: created.accounts } } }).catch(() => {});
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

run();
