/**
 * WR-D4 Phase 1 — Resolution Approval flow smoke.
 *
 * Repository-level senaryolar (HTTP yok). 14 senaryo (planning card §20):
 *
 *   1.  createPolicy happy path
 *   2.  createPolicy reddedildi — SpecificPerson approverPersonId yok
 *   3.  matchPolicyForCase — politika yok → null
 *   4.  matchPolicyForCase — companyId match yeterli
 *   5.  matchPolicyForCase — daha spesifik (category eşli) kazanır
 *   6.  resolveApprover — SpecificPerson
 *   7.  resolveApprover — AssignedTeamLead (TeamLead etiketli person)
 *   8.  submitApproval — happy path; case.approvalState='Pending'
 *   9.  submitApproval — zaten Pending varken duplicate bloklanır (409)
 *   10. submitApproval — self-approval bloklanır (allowSelfApprove=false)
 *   11. approveApproval — wrong user bloklanır (403)
 *   12. approveApproval — happy path; case.approvalState='Approved'
 *   13. rejectApproval — ReturnToTeam → assignedPersonId temizlenir; state=Rejected
 *   14. transitionStatus close guard — Pending iken Cozuldu engellenir;
 *       Approved iken geçer.
 *
 * Çalıştır: node --env-file=.env scripts/smoke-resolution-approval-flow.js
 *
 * Mutasyon: yarattığı tüm satırları finally bloğunda temizler.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import {
  ApprovalAccessError,
  ApprovalValidationError,
  approveApproval,
  checkCloseAllowed,
  createPolicy,
  matchPolicyForCase,
  rejectApproval,
  resolveApprover,
  submitApproval,
} from '../server/db/approvalRepository.js';
import { caseRepository } from '../server/db/caseRepository.js';

const stamp = Date.now();
const PREFIX = `rasf-${stamp}`;
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
  console.log('🔍 resolution-approval-flow smoke\n');
  const company = await pickCompany();
  const allowedCompanyIds = [company.id];
  console.log(`Company: ${company.id} (${company.name})\n`);

  const created = { policies: [], cases: [], accounts: [], teams: [], persons: [], users: [] };

  try {
    // Setup: a Team + TeamLead + regular Person + 2 Users
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
      },
    });
    created.persons.push(leadPerson.id);

    const memberPerson = await prisma.person.create({
      data: {
        name: `${PREFIX}-member`,
        teamId: team.id,
        isTeamLead: false,
        isActive: true,
      },
    });
    created.persons.push(memberPerson.id);

    const leadUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-lead@smoke.test`,
        fullName: leadPerson.name,
        personId: leadPerson.id,
      },
    });
    created.users.push(leadUser.id);

    const memberUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-member@smoke.test`,
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

    // ─── 1) createPolicy happy path ────────────────────────────────────
    const policy = await createPolicy({
      data: {
        companyId: company.id,
        name: `${PREFIX}-policy-all`,
        approverType: 'AssignedTeamLead',
        rejectionBehavior: 'ReturnToTeam',
        sortOrder: 200,
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.policies.push(policy.id);
    record('1. createPolicy happy path', !!policy.id && policy.companyId === company.id, `id=${policy.id}`);

    // ─── 2) createPolicy SpecificPerson without approverPersonId → 400 ──
    let rejected2 = false;
    let rejected2msg = '';
    try {
      await createPolicy({
        data: {
          companyId: company.id,
          name: `${PREFIX}-policy-bad`,
          approverType: 'SpecificPerson',
        },
        user: { id: adminUser.id },
        allowedCompanyIds,
      });
    } catch (e) {
      rejected2 = e instanceof ApprovalValidationError && e.code === 'approver_person_required';
      rejected2msg = e.code ?? e.message;
    }
    record('2. createPolicy SpecificPerson w/o personId → 400 approver_person_required', rejected2, rejected2msg);

    // ─── 3) matchPolicyForCase — başka şirket → null ──────────────────
    const noMatch = await matchPolicyForCase({
      companyId: 'this-company-does-not-exist',
      category: '', subCategory: '', priority: '', supportLevel: '', assignedTeamId: '',
    });
    record('3. matchPolicyForCase — şirket dışı → null', noMatch === null);

    // ─── 4) matchPolicyForCase — companyId match yeterli ─────────────
    const fakeCase = {
      companyId: company.id,
      category: 'Yazılım',
      subCategory: 'Genel',
      priority: 'Medium',
      supportLevel: 'Seviye1',
      assignedTeamId: team.id,
    };
    const m1 = await matchPolicyForCase(fakeCase);
    record('4. matchPolicyForCase — generic policy match', !!m1 && m1.id === policy.id, m1 ? m1.name : 'null');

    // ─── 5) matchPolicyForCase — daha spesifik kazanır ───────────────
    const specific = await createPolicy({
      data: {
        companyId: company.id,
        name: `${PREFIX}-policy-yazilim`,
        approverType: 'AssignedTeamLead',
        rejectionBehavior: 'ReturnToAssignee',
        matchScope: { category: 'Yazılım' },
        sortOrder: 100, // daha düşük = daha önce match
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.policies.push(specific.id);
    const m2 = await matchPolicyForCase(fakeCase);
    record('5. matchPolicyForCase — daha spesifik politika kazanır', m2?.id === specific.id, m2?.name ?? 'null');

    // ─── 6) resolveApprover — SpecificPerson ─────────────────────────
    const specificPersonPolicy = await createPolicy({
      data: {
        companyId: company.id,
        name: `${PREFIX}-policy-specific`,
        approverType: 'SpecificPerson',
        approverPersonId: leadPerson.id,
        rejectionBehavior: 'ReturnToAssignee',
        sortOrder: 999,
      },
      user: { id: adminUser.id },
      allowedCompanyIds,
    });
    created.policies.push(specificPersonPolicy.id);
    const r6 = await resolveApprover({ policy: specificPersonPolicy, caseRow: fakeCase });
    record('6. resolveApprover — SpecificPerson lead\'i döndürür', r6?.personId === leadPerson.id);

    // ─── 7) resolveApprover — AssignedTeamLead ───────────────────────
    const r7 = await resolveApprover({ policy: m2, caseRow: fakeCase });
    record('7. resolveApprover — AssignedTeamLead', r7?.personId === leadPerson.id);

    // Create a case in this company assigned to memberUser, with Yazılım category.
    const c1 = await caseRepository.create({
      title: `${PREFIX}-case-1`,
      description: 'smoke case 1',
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

    // ─── 8) submitApproval — happy path ─────────────────────────────
    const submitter = { id: memberUser.id, personId: memberPerson.id, fullName: memberPerson.name };
    const approval = await submitApproval({
      caseId: c1.id,
      payload: { resolutionSummary: 'Çözüldü; konfigürasyon değiştirildi.' },
      user: submitter,
      allowedCompanyIds,
    });
    const caseAfter = await prisma.case.findUnique({ where: { id: c1.id }, select: { approvalState: true } });
    record(
      '8. submitApproval happy path + case.approvalState=Pending',
      approval.state === 'Pending' && caseAfter?.approvalState === 'Pending',
      `approval=${approval.id} caseState=${caseAfter?.approvalState}`,
    );

    // ─── 9) Duplicate Pending submit bloklanır ──────────────────────
    let r9 = false;
    let r9msg = '';
    try {
      await submitApproval({
        caseId: c1.id,
        payload: { resolutionSummary: 'ikinci dene' },
        user: submitter,
        allowedCompanyIds,
      });
    } catch (e) {
      r9 = e instanceof ApprovalValidationError && e.code === 'approval_already_pending';
      r9msg = e.code ?? e.message;
    }
    record('9. duplicate Pending submit → 409 approval_already_pending', r9, r9msg);

    // ─── 10) Self-approval bloklanır ────────────────────────────────
    // Use the SpecificPerson policy (approverPersonId = leadPerson) but submit as that same person.
    // To do that, first cancel the existing approval (we'll reject it as the lead).
    // We need a fresh case for clean isolation:
    const c2 = await caseRepository.create({
      title: `${PREFIX}-case-2`,
      description: 'smoke case 2 — self-approval test',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: company.id,
      companyName: company.name,
      category: 'DonanımDışı', // matches no specific policy → falls back to generic
      subCategory: 'Genel',
      requestType: 'Talep',
      assignedTeamId: team.id,
      assignedTeamName: team.name,
      assignedPersonId: leadPerson.id,
      assignedPersonName: leadPerson.name,
    });
    created.cases.push(c2.id);
    // generic policy resolves to leadPerson (TeamLead of assigned team). Lead submits → self-approval blocked.
    let r10 = false;
    let r10msg = '';
    try {
      await submitApproval({
        caseId: c2.id,
        payload: { resolutionSummary: 'lead kendi çözdü' },
        user: { id: leadUser.id, personId: leadPerson.id, fullName: leadPerson.name },
        allowedCompanyIds,
      });
    } catch (e) {
      r10 = e instanceof ApprovalValidationError && e.code === 'self_approval_blocked';
      r10msg = e.code ?? e.message;
    }
    record('10. self-approval bloklanır (allowSelfApprove=false)', r10, r10msg);

    // ─── 11) approveApproval — yanlış kullanıcı 403 ─────────────────
    // memberUser tries to approve their own submission (without role override).
    let r11 = false;
    let r11msg = '';
    try {
      await approveApproval({
        approvalId: approval.id,
        payload: {},
        user: { id: memberUser.id, personId: memberPerson.id, role: 'Agent' },
        allowedCompanyIds,
      });
    } catch (e) {
      r11 = e instanceof ApprovalAccessError;
      r11msg = e.code ?? e.message;
    }
    record('11. approveApproval — yanlış kullanıcı → 403', r11, r11msg);

    // ─── 12) approveApproval happy path (lead onaylar) ──────────────
    const approved = await approveApproval({
      approvalId: approval.id,
      payload: {},
      user: { id: leadUser.id, personId: leadPerson.id, fullName: leadPerson.name, role: 'Supervisor' },
      allowedCompanyIds,
    });
    const caseAfterApprove = await prisma.case.findUnique({ where: { id: c1.id }, select: { approvalState: true } });
    record(
      '12. approveApproval happy path + case.approvalState=Approved',
      approved.state === 'Approved' && caseAfterApprove?.approvalState === 'Approved',
      `state=${caseAfterApprove?.approvalState}`,
    );

    // ─── 13) rejectApproval — ReturnToTeam temizler ─────────────────
    // Submit a new approval (case 1 already approved). Use c3 with same generic policy.
    const c3 = await caseRepository.create({
      title: `${PREFIX}-case-3`,
      description: 'smoke case 3 — reject test',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Telefon',
      companyId: company.id,
      companyName: company.name,
      category: 'Yazılım', // will match `specific` policy with rejectionBehavior=ReturnToAssignee
      subCategory: 'Genel',
      requestType: 'Talep',
      assignedTeamId: team.id,
      assignedTeamName: team.name,
      assignedPersonId: memberPerson.id,
      assignedPersonName: memberPerson.name,
    });
    created.cases.push(c3.id);
    // The "specific" policy uses ReturnToAssignee — not what we want to test (ReturnToTeam).
    // Use the original `policy` (sortOrder=200, ReturnToTeam) — but specific (sortOrder=100) wins.
    // To test ReturnToTeam, deactivate `specific` so generic kicks in.
    await prisma.resolutionApprovalPolicy.update({
      where: { id: specific.id },
      data: { isActive: false },
    });
    const approval3 = await submitApproval({
      caseId: c3.id,
      payload: { resolutionSummary: 'reject test submission' },
      user: submitter,
      allowedCompanyIds,
    });
    await rejectApproval({
      approvalId: approval3.id,
      payload: { rejectionReason: 'eksik bilgi' },
      user: { id: leadUser.id, personId: leadPerson.id, fullName: leadPerson.name, role: 'Supervisor' },
      allowedCompanyIds,
    });
    const c3After = await prisma.case.findUnique({
      where: { id: c3.id },
      select: { approvalState: true, assignedPersonId: true, assignedPersonName: true },
    });
    record(
      '13. rejectApproval ReturnToTeam — assignment cleared + state=Rejected',
      c3After?.approvalState === 'Rejected' &&
        c3After?.assignedPersonId === null &&
        c3After?.assignedPersonName === null,
      `state=${c3After?.approvalState} assignedPersonId=${c3After?.assignedPersonId}`,
    );
    // Reactivate specific (cleanup harmless)
    await prisma.resolutionApprovalPolicy.update({
      where: { id: specific.id },
      data: { isActive: true },
    });

    // ─── 14) transitionStatus close guard ─────────────────────────
    // c1.approvalState === Approved → close allowed
    const c1Reload = await prisma.case.findUnique({ where: { id: c1.id } });
    const closeAllowedC1 = await checkCloseAllowed({ caseRow: c1Reload });
    // c2.approvalState is currently null (we attempted self-approval which failed — no row created).
    // generic policy still matches c2 (category DonanımDışı doesn't match `specific`, falls to `policy`).
    // So checkCloseAllowed must BLOCK c2.
    const c2Reload = await prisma.case.findUnique({ where: { id: c2.id } });
    const closeBlockedC2 = await checkCloseAllowed({ caseRow: c2Reload });
    record(
      '14a. checkCloseAllowed — Approved case → null (close allowed)',
      closeAllowedC1 === null,
      `result=${closeAllowedC1 === null ? 'null' : closeAllowedC1?.code}`,
    );
    record(
      '14b. checkCloseAllowed — no approval yet → blocked',
      closeBlockedC2 instanceof ApprovalValidationError && closeBlockedC2.code === 'approval_required',
      closeBlockedC2 instanceof Error ? closeBlockedC2.code : 'not_error',
    );

    // Integration: caseRepository.transitionStatus must throw when blocked.
    let txnBlocked = false;
    let txnMsg = '';
    try {
      await caseRepository.transitionStatus(
        c2.id,
        'Çözüldü',
        { resolutionNote: 'çözdüm' },
        leadPerson.name,
        allowedCompanyIds,
      );
    } catch (e) {
      txnBlocked = e?.code === 'approval_required';
      txnMsg = e?.code ?? e?.message;
    }
    record('14c. transitionStatus(Çözüldü) — bloklanır', txnBlocked, txnMsg);
  } catch (err) {
    console.error('smoke fatal:', err);
    results.push({ name: 'fatal', ok: false, detail: err?.message });
  } finally {
    // Cleanup order respects FKs.
    if (created.cases.length) {
      await prisma.caseResolutionApproval.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
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

run();
