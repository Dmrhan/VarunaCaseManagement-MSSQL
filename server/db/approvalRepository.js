/**
 * WR-D4 Phase 1 — Resolution Approval repository.
 *
 * Two domains:
 *  1) ResolutionApprovalPolicy CRUD (admin surface).
 *  2) CaseResolutionApproval lifecycle: submit / approve / reject +
 *     policy match + approver resolution + close guard helper.
 *
 * No external sending in Phase 1. Phase 2 (D3) will plug
 * NotificationRule + Dispatch into the same lifecycle hooks. See
 * docs/planning_cards/WR-D4-D3-...md §6 (lifecycle) and §16 (phases).
 *
 * All queries are tenant-scoped via allowedCompanyIds; per-tenant
 * cache is intentionally NOT added in Phase 1 — policy count is low
 * (10-50 per tenant) and the perf budget allows it.
 */

import { prisma } from './client.js';
import { emitEvent as emitNotificationEvent } from './notificationRepository.js';
import {
  emitActionItem,
  closeActionItemsForApproval,
  expireSiblingActionItemsForApproval,
} from './actionItemRepository.js';

/**
 * WR-D4 Phase 2 wire-up: approval lifecycle fires notification events.
 * Failures inside emitEvent are absorbed (logged, not thrown) so an event
 * dispatch never blocks the underlying approval mutation.
 */

/**
 * Domain error: 400 with structured `code`. Route layer converts to
 * HTTP response (mirrors CaseValidationError pattern in caseRepository).
 */
export class ApprovalValidationError extends Error {
  constructor(message, { status = 400, code = 'approval_validation_error' } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class ApprovalAccessError extends Error {
  constructor(message = 'Onay erişimi yok.') {
    super(message);
    this.code = 'APPROVAL_FORBIDDEN';
    this.status = 403;
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function trimOrNull(v, max = 5000) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) {
    throw new ApprovalValidationError(`Alan ${max} karakteri geçemez.`, { code: 'field_too_long' });
  }
  return s;
}

/** Validate that matchScope JSON shape is allowed (Phase 1 fields only). */
function normalizeMatchScope(raw) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApprovalValidationError('matchScope JSON nesne olmalı.', { code: 'matchscope_invalid' });
  }
  const out = {};
  // Whitelist: prevent admin from injecting arbitrary keys.
  const allowed = ['category', 'subCategory', 'priority', 'supportLevel', 'teamId'];
  for (const k of allowed) {
    if (raw[k] != null && raw[k] !== '') out[k] = String(raw[k]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// ResolutionApprovalPolicy CRUD
// ─────────────────────────────────────────────────────────────────

/**
 * List policies in scope. Admin UI surface.
 * @param {{ allowedCompanyIds: string[], companyId?: string }} args
 */
export async function listPolicies({ allowedCompanyIds, companyId = null }) {
  const allowed = ensureArray(allowedCompanyIds);
  if (allowed.length === 0) return [];
  if (companyId && !allowed.includes(companyId)) return [];
  const where = companyId ? { companyId } : { companyId: { in: allowed } };
  return prisma.resolutionApprovalPolicy.findMany({
    where,
    orderBy: [{ companyId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function getPolicy({ id, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const row = await prisma.resolutionApprovalPolicy.findUnique({ where: { id } });
  if (!row) return null;
  if (!allowed.includes(row.companyId)) return null;
  return row;
}

/** Validate approverType + approverPersonId combination. */
async function validateApproverFields({ companyId, approverType, approverPersonId }) {
  const validTypes = ['TeamLead', 'AssignedTeamLead', 'Supervisor', 'Admin', 'SystemAdmin', 'SpecificPerson'];
  if (!validTypes.includes(approverType)) {
    throw new ApprovalValidationError(`approverType geçersiz: ${approverType}`, { code: 'approver_type_invalid' });
  }
  if (approverType === 'SpecificPerson') {
    if (!approverPersonId) {
      throw new ApprovalValidationError('SpecificPerson için approverPersonId zorunlu.', { code: 'approver_person_required' });
    }
    const p = await prisma.person.findUnique({
      where: { id: approverPersonId },
      select: { id: true, isActive: true, team: { select: { companyId: true } } },
    });
    if (!p) {
      throw new ApprovalValidationError('Belirtilen approver Person bulunamadı.', { code: 'approver_person_not_found', status: 404 });
    }
    if (!p.isActive) {
      throw new ApprovalValidationError('Approver Person pasif.', { code: 'approver_person_inactive' });
    }
    // Person tenant scope: their team's companyId must match. Persons
    // without a team are intentionally rejected as policy approvers —
    // ambiguous scope.
    if (!p.team || p.team.companyId !== companyId) {
      throw new ApprovalValidationError('Approver Person bu şirkete bağlı değil.', { code: 'approver_person_wrong_company' });
    }
  } else if (approverPersonId) {
    throw new ApprovalValidationError('approverPersonId yalnız SpecificPerson tipinde verilir.', { code: 'approver_person_unexpected' });
  }
}

export async function createPolicy({ data, user, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const companyId = data.companyId;
  if (!companyId || !allowed.includes(companyId)) {
    throw new ApprovalAccessError('Bu şirkete erişim yok.');
  }
  const name = trimOrNull(data.name, 200);
  if (!name) {
    throw new ApprovalValidationError('name zorunlu.', { code: 'name_required' });
  }
  const description = trimOrNull(data.description, 1000);
  const matchScope = normalizeMatchScope(data.matchScope);
  await validateApproverFields({
    companyId,
    approverType: data.approverType,
    approverPersonId: data.approverPersonId ?? null,
  });
  const validBehaviors = ['ReturnToAssignee', 'ReturnToTeam', 'Escalate'];
  if (data.rejectionBehavior && !validBehaviors.includes(data.rejectionBehavior)) {
    throw new ApprovalValidationError('rejectionBehavior geçersiz.', { code: 'rejection_behavior_invalid' });
  }
  return prisma.resolutionApprovalPolicy.create({
    data: {
      companyId,
      name,
      description,
      isActive: data.isActive !== false,
      sortOrder: Number.isFinite(data.sortOrder) ? Number(data.sortOrder) : 100,
      matchScope,
      approverType: data.approverType,
      approverPersonId: data.approverType === 'SpecificPerson' ? data.approverPersonId : null,
      allowSelfApprove: !!data.allowSelfApprove,
      rejectionBehavior: data.rejectionBehavior || 'ReturnToAssignee',
      createdByUserId: user?.id ?? null,
    },
  });
}

export async function updatePolicy({ id, data, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const existing = await prisma.resolutionApprovalPolicy.findUnique({ where: { id } });
  if (!existing || !allowed.includes(existing.companyId)) {
    throw new ApprovalAccessError('Politikaya erişim yok.');
  }
  const patch = {};
  if (data.name !== undefined) {
    const name = trimOrNull(data.name, 200);
    if (!name) throw new ApprovalValidationError('name zorunlu.', { code: 'name_required' });
    patch.name = name;
  }
  if (data.description !== undefined) patch.description = trimOrNull(data.description, 1000);
  if (data.isActive !== undefined) patch.isActive = !!data.isActive;
  if (data.sortOrder !== undefined) {
    patch.sortOrder = Number.isFinite(data.sortOrder) ? Number(data.sortOrder) : existing.sortOrder;
  }
  if (data.matchScope !== undefined) patch.matchScope = normalizeMatchScope(data.matchScope);
  if (data.approverType !== undefined) {
    await validateApproverFields({
      companyId: existing.companyId,
      approverType: data.approverType,
      approverPersonId: data.approverPersonId ?? null,
    });
    patch.approverType = data.approverType;
    patch.approverPersonId = data.approverType === 'SpecificPerson' ? data.approverPersonId : null;
  } else if (data.approverPersonId !== undefined) {
    // approverType unchanged but approverPersonId provided — must be
    // SpecificPerson, else ignored.
    if (existing.approverType === 'SpecificPerson') {
      await validateApproverFields({
        companyId: existing.companyId,
        approverType: 'SpecificPerson',
        approverPersonId: data.approverPersonId,
      });
      patch.approverPersonId = data.approverPersonId;
    }
  }
  if (data.allowSelfApprove !== undefined) patch.allowSelfApprove = !!data.allowSelfApprove;
  if (data.rejectionBehavior !== undefined) {
    const validBehaviors = ['ReturnToAssignee', 'ReturnToTeam', 'Escalate'];
    if (!validBehaviors.includes(data.rejectionBehavior)) {
      throw new ApprovalValidationError('rejectionBehavior geçersiz.', { code: 'rejection_behavior_invalid' });
    }
    patch.rejectionBehavior = data.rejectionBehavior;
  }
  return prisma.resolutionApprovalPolicy.update({ where: { id }, data: patch });
}

// ─────────────────────────────────────────────────────────────────
// Policy matching (§7 in planning card)
// ─────────────────────────────────────────────────────────────────

/**
 * Returns the highest-precedence active policy matching the case, or
 * null. Match rules:
 *  - companyId == case.companyId
 *  - isActive == true
 *  - Each matchScope[k] (when set) == case[k] (string match)
 * Precedence: sortOrder ASC → specificity (fewer null scope fields) DESC
 *   → createdAt ASC. Ambiguity falls deterministically to createdAt.
 *
 * Phase 1: app-layer filtering. Per-tenant cache deferred to Phase 2 if
 * load demands it.
 */
export async function matchPolicyForCase(caseRow) {
  if (!caseRow || !caseRow.companyId) return null;
  const policies = await prisma.resolutionApprovalPolicy.findMany({
    where: { companyId: caseRow.companyId, isActive: true },
  });
  if (policies.length === 0) return null;
  const matched = policies.filter((p) => {
    const scope = p.matchScope || {};
    if (scope.category && scope.category !== caseRow.category) return false;
    if (scope.subCategory && scope.subCategory !== caseRow.subCategory) return false;
    if (scope.priority && scope.priority !== caseRow.priority) return false;
    if (scope.supportLevel && scope.supportLevel !== caseRow.supportLevel) return false;
    if (scope.teamId && scope.teamId !== caseRow.assignedTeamId) return false;
    return true;
  });
  if (matched.length === 0) return null;
  // Specificity = number of non-empty scope keys (higher = more specific).
  const score = (p) => {
    const s = p.matchScope || {};
    return ['category', 'subCategory', 'priority', 'supportLevel', 'teamId']
      .reduce((n, k) => (s[k] ? n + 1 : n), 0);
  };
  matched.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const sb = score(b) - score(a);
    if (sb !== 0) return sb;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
  return matched[0];
}

// ─────────────────────────────────────────────────────────────────
// Approver resolution (§8)
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve the expected approver Person for a (policy, case) pair.
 * Returns { personId, userId, persons, userIds } where:
 *  - `personId` is the canonical approver Person to snapshot on the approval row
 *  - `userId` is the corresponding User.id (Action Center inbox routing)
 *  - `persons` is the eligible Person set (any-one approval Phase 1)
 *  - `userIds` is the eligible User set (Action Center fan-out)
 * Returns null when no approver can be resolved (caller must 400).
 *
 * Resolution rules (per planning card §8, Phase 1 set):
 *  - TeamLead / AssignedTeamLead → Person where teamId=case.assignedTeamId AND isTeamLead=true AND isActive=true
 *  - Supervisor → Persons with Supervisor-role membership in case.companyId (via UserCompany)
 *  - Admin → Persons with Admin-role membership in case.companyId
 *  - SystemAdmin → Persons with SystemAdmin role (companyId scope skipped)
 *  - SpecificPerson → policy.approverPersonId (already validated at create-time)
 *
 * WR-ACTION-CENTER Phase 1 — userId/userIds added so Action Center can
 * route inbox items without an extra query in submitApproval.
 */
export async function resolveApprover({ policy, caseRow }) {
  if (!policy || !caseRow) return null;
  switch (policy.approverType) {
    case 'TeamLead':
    case 'AssignedTeamLead': {
      if (!caseRow.assignedTeamId) return null;
      const leads = await prisma.person.findMany({
        where: {
          teamId: caseRow.assignedTeamId,
          isTeamLead: true,
          isActive: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (leads.length === 0) return null;
      // Map persons to users via personId → User.personId unique link.
      const users = await prisma.user.findMany({
        where: { personId: { in: leads.map((l) => l.id) }, isActive: true },
        select: { id: true, personId: true },
      });
      const personIdToUserId = new Map(users.map((u) => [u.personId, u.id]));
      const userIds = leads
        .map((l) => personIdToUserId.get(l.id))
        .filter((id) => !!id);
      const firstUserId = personIdToUserId.get(leads[0].id) ?? null;
      return {
        personId: leads[0].id,
        userId: firstUserId,
        persons: leads,
        userIds,
      };
    }
    case 'SpecificPerson': {
      if (!policy.approverPersonId) return null;
      const p = await prisma.person.findUnique({
        where: { id: policy.approverPersonId },
        select: { id: true, isActive: true },
      });
      if (!p || !p.isActive) return null;
      const u = await prisma.user.findFirst({
        where: { personId: p.id, isActive: true },
        select: { id: true },
      });
      return {
        personId: p.id,
        userId: u?.id ?? null,
        persons: [{ id: p.id }],
        userIds: u ? [u.id] : [],
      };
    }
    case 'Supervisor':
    case 'Admin':
    case 'SystemAdmin': {
      // Role-based resolution uses UserCompany.role pivot.
      // Phase 1: a single person per role can approve any-one style.
      const roleName = policy.approverType;
      const memberships = await prisma.userCompany.findMany({
        where:
          roleName === 'SystemAdmin'
            ? { role: roleName }
            : { role: roleName, companyId: caseRow.companyId },
        select: { user: { select: { id: true, personId: true, isActive: true } } },
      });
      // Filter to memberships whose User has a linked Person AND is active.
      const validMembers = memberships
        .map((m) => m.user)
        .filter((u) => !!u && !!u.personId && u.isActive !== false);
      if (validMembers.length === 0) return null;
      // Deterministic ordering by personId for stable snapshot pick.
      validMembers.sort((a, b) => (a.personId > b.personId ? 1 : -1));
      const snapshotMember = validMembers[0];
      return {
        personId: snapshotMember.personId,
        userId: snapshotMember.id,
        persons: validMembers.map((u) => ({ id: u.personId })),
        userIds: validMembers.map((u) => u.id),
      };
    }
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Multi-approver authority check (Phase 1 acceptance fix)
// ─────────────────────────────────────────────────────────────────

/**
 * Decide whether a user is authorized to approve or reject `row`.
 *
 * Phase 1 originally only allowed the snapshotted `expectedApproverPersonId`
 * to decide, but `submitApproval` fans out `approval_pending` ActionItems
 * to every eligible approver user (e.g. all Supervisor-role members). The
 * snapshot-only check meant non-snapshotted but eligible users could see
 * the inbox row but received 403 on click.
 *
 * Fix: snapshot still wins on the fast path; if the caller is not the
 * snapshot, re-resolve the policy's current eligible set and accept any
 * `personId` in it. Re-resolving at decision time honors team/role
 * changes between submit and decide.
 *
 * Returns true when authorized, false otherwise. Caller must AND this
 * with the override path and emit ApprovalAccessError on false.
 */
async function userIsEligibleApprover({ row, user }) {
  if (!user?.personId) return false;
  if (user.personId === row.expectedApproverPersonId) return true;
  if (!row.policy) return false;
  const caseRow = await prisma.case.findUnique({
    where: { id: row.caseId },
    select: { id: true, companyId: true, assignedTeamId: true },
  });
  if (!caseRow) return false;
  const resolved = await resolveApprover({ policy: row.policy, caseRow });
  if (!resolved) return false;
  const eligible = resolved.persons ?? [];
  for (const p of eligible) {
    if (p?.id && p.id === user.personId) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────
// Submit / Approve / Reject
// ─────────────────────────────────────────────────────────────────

/**
 * Submit a resolution for approval. Validates:
 *  - case in scope
 *  - case status open (not Cozuldu / IptalEdildi)
 *  - no Pending approval already on this case
 *  - policy resolves
 *  - approver resolves
 *  - allowSelfApprove guard
 *
 * Returns the created CaseResolutionApproval row.
 */
export async function submitApproval({ caseId, payload, user, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const caseRow = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      companyId: true,
      status: true,
      category: true,
      subCategory: true,
      priority: true,
      supportLevel: true,
      assignedTeamId: true,
      approvalState: true,
      // WR-ACTION-CENTER Phase 1 — denorm snapshots for ActionItem rows.
      caseNumber: true,
      title: true,
    },
  });
  if (!caseRow) {
    throw new ApprovalValidationError('Vaka bulunamadı.', { status: 404, code: 'case_not_found' });
  }
  if (!allowed.includes(caseRow.companyId)) {
    throw new ApprovalAccessError();
  }
  if (caseRow.status === 'Cozuldu' || caseRow.status === 'IptalEdildi') {
    throw new ApprovalValidationError('Kapalı vaka için onay gönderilemez.', {
      code: 'case_already_closed',
    });
  }
  if (caseRow.approvalState === 'Pending') {
    throw new ApprovalValidationError('Bu vakada zaten bekleyen bir onay var.', {
      status: 409,
      code: 'approval_already_pending',
    });
  }

  const resolutionSummary = trimOrNull(payload?.resolutionSummary, 10000);
  if (!resolutionSummary) {
    throw new ApprovalValidationError('resolutionSummary zorunlu.', { code: 'resolution_summary_required' });
  }
  const customerMessageDraft = trimOrNull(payload?.customerMessageDraft, 10000);

  const policy = await matchPolicyForCase(caseRow);
  if (!policy) {
    throw new ApprovalValidationError(
      'Bu vakaya uygun aktif çözüm onayı politikası yok; onay göndermek yerine doğrudan kapatın.',
      { code: 'no_matching_policy' },
    );
  }

  const resolved = await resolveApprover({ policy, caseRow });
  if (!resolved || !resolved.personId) {
    throw new ApprovalValidationError(
      'Bu politika için onaylayıcı çözülemedi (örn. takım liderinin aktif olmaması).',
      { code: 'approver_unresolvable' },
    );
  }

  // Self-approval guard: only Person-linked submitters can be checked.
  // user.personId may be null (system user / non-Person account); in
  // that case self-approval check is moot.
  if (!policy.allowSelfApprove && user?.personId && user.personId === resolved.personId) {
    throw new ApprovalValidationError(
      'Kendi çözümünüzü onaylayamazsınız; bu politika self-approval\'a izin vermiyor.',
      { code: 'self_approval_blocked' },
    );
  }

  // Insert + denormalize Case.approvalState in a transaction.
  const approval = await prisma.$transaction(async (tx) => {
    const created = await tx.caseResolutionApproval.create({
      data: {
        caseId,
        companyId: caseRow.companyId,
        policyId: policy.id,
        policyNameSnapshot: policy.name,
        state: 'Pending',
        submittedByUserId: user.id,
        resolutionSummary,
        customerMessageDraft,
        expectedApproverPersonId: resolved.personId,
      },
    });
    await tx.case.update({
      where: { id: caseId },
      data: { approvalState: 'Pending' },
    });
    await tx.caseActivity.create({
      data: {
        caseId,
        companyId: caseRow.companyId,
        action: 'Çözüm onayına gönderildi',
        actionType: 'FieldUpdate',
        fieldName: 'approvalState',
        fromValue: null,
        toValue: 'Pending',
        actor: user.fullName || user.email || user.id,
        note: policy.name,
      },
    });
    return created;
  });

  // Phase 2 — event emission (out-of-transaction; never blocks).
  void emitNotificationEvent({
    event: 'resolution_submitted',
    caseId,
    approvalContext: {
      resolutionSummary: approval.resolutionSummary,
      customerMessageDraft: approval.customerMessageDraft,
      approverName: '',
    },
  });

  // WR-ACTION-CENTER Phase 1 — emit approval_pending ActionItem(s).
  // One per eligible approver userId (multi-approver fan-out for role-
  // based approverType). dedupKey includes userId so each row is unique.
  for (const approverUserId of resolved.userIds ?? []) {
    void emitActionItem({
      kind: 'approval_pending',
      userId: approverUserId,
      personId: resolved.personId,
      companyId: caseRow.companyId,
      objectType: 'CaseResolutionApproval',
      objectId: approval.id,
      caseId,
      caseNumber: caseRow.caseNumber,
      caseTitle: caseRow.title,
      generatedBy: `policy:${policy.id}`,
      groupKey: `${caseId}:approval`,
      dedupKey: `${caseRow.companyId}:${approverUserId}:approval_pending:${approval.id}`,
      priority: 70,
      actionRequired: true,
      reasonLabel: `Çünkü "${policy.name}" politikası kapsamında onaylayıcısın.`,
    });
  }

  return approval;
}

/**
 * Approve an approval row. Verifies authority: caller must be either
 *  - the resolved approver Person, OR
 *  - SystemAdmin (override path) — set `override=true` in payload.
 */
export async function approveApproval({ approvalId, payload, user, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const row = await prisma.caseResolutionApproval.findUnique({
    where: { id: approvalId },
    include: { policy: true },
  });
  if (!row) {
    throw new ApprovalValidationError('Onay bulunamadı.', { status: 404, code: 'approval_not_found' });
  }
  if (!allowed.includes(row.companyId)) {
    throw new ApprovalAccessError();
  }
  if (row.state !== 'Pending') {
    throw new ApprovalValidationError(`Bu onay zaten ${row.state}.`, { code: 'approval_not_pending' });
  }

  const override = !!payload?.override && user?.role === 'SystemAdmin';
  const authorized = override || (await userIsEligibleApprover({ row, user }));
  if (!authorized) {
    throw new ApprovalAccessError('Bu onayı verme yetkin yok.');
  }
  // Decision-time self-approval guard. Submit-time check only catches the
  // case where the submitter equals the snapshotted approverPersonId. For
  // role-based policies with multi-approver fan-out, a submitter who is
  // *also* in the eligible set (but not snapshotted) would otherwise slip
  // past userIsEligibleApprover and approve their own submission. Block
  // here so allowSelfApprove=false is honored regardless of which eligible
  // user decides. SystemAdmin override path still bypasses, by design.
  if (!override && row.policy?.allowSelfApprove === false && row.submittedByUserId === user.id) {
    throw new ApprovalValidationError(
      'Kendi gönderdiğin çözüm onayını onaylayamazsın; bu politika self-approval\'a izin vermiyor.',
      { code: 'self_approval_blocked', status: 403 },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.caseResolutionApproval.update({
      where: { id: approvalId },
      data: {
        state: 'Approved',
        decidedByUserId: user.id,
        decidedAt: new Date(),
      },
    });
    await tx.case.update({
      where: { id: row.caseId },
      data: { approvalState: 'Approved' },
    });
    await tx.caseActivity.create({
      data: {
        caseId: row.caseId,
        companyId: row.companyId,
        action: override ? 'Çözüm onayı verildi (override)' : 'Çözüm onayı verildi',
        actionType: 'FieldUpdate',
        fieldName: 'approvalState',
        fromValue: 'Pending',
        toValue: 'Approved',
        actor: user.fullName || user.email || user.id,
        note: row.policyNameSnapshot,
      },
    });
    return u;
  });

  void emitNotificationEvent({
    event: 'resolution_approved',
    caseId: row.caseId,
    approvalContext: {
      resolutionSummary: updated.resolutionSummary,
      customerMessageDraft: updated.customerMessageDraft,
      approverName: user.fullName ?? '',
    },
  });

  // WR-ACTION-CENTER Phase 1 — close decider's ActionItem (if any) + expire
  // sibling approver ActionItems + emit FYI to the original submitter.
  // All three are fire-and-forget; approval semantics never depend on them.
  void closeActionItemsForApproval({
    approvalId,
    deciderUserId: user.id,
    outcome: 'approved',
  });
  void expireSiblingActionItemsForApproval({
    approvalId,
    exceptUserId: user.id,
  });
  void (async () => {
    // FYI to original submitter — fetch case denorm via the row we already have.
    const caseRow = await prisma.case.findUnique({
      where: { id: row.caseId },
      select: { caseNumber: true, title: true },
    });
    void emitActionItem({
      kind: 'approval_decided',
      userId: row.submittedByUserId,
      companyId: row.companyId,
      objectType: 'CaseResolutionApproval',
      objectId: approvalId,
      caseId: row.caseId,
      caseNumber: caseRow?.caseNumber ?? null,
      caseTitle: caseRow?.title ?? null,
      generatedBy: row.policyId ? `policy:${row.policyId}` : 'system',
      groupKey: `${row.caseId}:approval`,
      dedupKey: `${row.companyId}:${row.submittedByUserId}:approval_decided:${approvalId}`,
      priority: 30,
      actionRequired: false,
      reasonLabel: 'Gönderdiğin çözüm onayı sonuçlandı: Onaylandı.',
    });
  })();

  return updated;
}

/**
 * Reject an approval row + apply rejectionBehavior to the case.
 *   ReturnToAssignee → no case-level change (note prepended via activity)
 *   ReturnToTeam → assignedPersonId/Name cleared
 *   Escalate → status='Eskalasyon', escalationLevel='Seviye1' default
 */
export async function rejectApproval({ approvalId, payload, user, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const row = await prisma.caseResolutionApproval.findUnique({
    where: { id: approvalId },
    include: { policy: true },
  });
  if (!row) {
    throw new ApprovalValidationError('Onay bulunamadı.', { status: 404, code: 'approval_not_found' });
  }
  if (!allowed.includes(row.companyId)) {
    throw new ApprovalAccessError();
  }
  if (row.state !== 'Pending') {
    throw new ApprovalValidationError(`Bu onay zaten ${row.state}.`, { code: 'approval_not_pending' });
  }
  const rejectionReason = trimOrNull(payload?.rejectionReason, 5000);
  if (!rejectionReason) {
    throw new ApprovalValidationError('Red gerekçesi zorunlu.', { code: 'rejection_reason_required' });
  }

  const override = !!payload?.override && user?.role === 'SystemAdmin';
  const authorized = override || (await userIsEligibleApprover({ row, user }));
  if (!authorized) {
    throw new ApprovalAccessError('Bu onayı reddetme yetkin yok.');
  }
  // Decision-time self-approval guard — see approveApproval above for the
  // rationale. Reject path is symmetric: a submitter who is also eligible
  // for the role-based policy must not be able to reject their own row.
  if (!override && row.policy?.allowSelfApprove === false && row.submittedByUserId === user.id) {
    throw new ApprovalValidationError(
      'Kendi gönderdiğin çözüm onayını reddedemezsin; bu politika self-approval\'a izin vermiyor.',
      { code: 'self_approval_blocked', status: 403 },
    );
  }

  const behavior = row.policy?.rejectionBehavior ?? 'ReturnToAssignee';

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.caseResolutionApproval.update({
      where: { id: approvalId },
      data: {
        state: 'Rejected',
        decidedByUserId: user.id,
        decidedAt: new Date(),
        rejectionReason,
      },
    });

    const caseUpdate = { approvalState: 'Rejected' };
    if (behavior === 'ReturnToTeam') {
      caseUpdate.assignedPersonId = null;
      caseUpdate.assignedPersonName = null;
    } else if (behavior === 'Escalate') {
      caseUpdate.status = 'Eskalasyon';
      caseUpdate.escalationLevel = 'Seviye1';
    }
    await tx.case.update({ where: { id: row.caseId }, data: caseUpdate });

    await tx.caseActivity.create({
      data: {
        caseId: row.caseId,
        companyId: row.companyId,
        action: override ? 'Çözüm onayı reddedildi (override)' : 'Çözüm onayı reddedildi',
        actionType: 'FieldUpdate',
        fieldName: 'approvalState',
        fromValue: 'Pending',
        toValue: 'Rejected',
        actor: user.fullName || user.email || user.id,
        note: `${row.policyNameSnapshot} — ${rejectionReason}`,
      },
    });
    return u;
  });

  void emitNotificationEvent({
    event: 'resolution_rejected',
    caseId: row.caseId,
    approvalContext: {
      resolutionSummary: updated.resolutionSummary,
      customerMessageDraft: updated.customerMessageDraft,
      rejectionReason: updated.rejectionReason,
      approverName: user.fullName ?? '',
    },
  });

  // WR-ACTION-CENTER Phase 1 — close decider, expire siblings, FYI to
  // submitter, and (only for ReturnToAssignee) emit actionable
  // case_returned_to_assignee item.
  void closeActionItemsForApproval({
    approvalId,
    deciderUserId: user.id,
    outcome: 'rejected',
  });
  void expireSiblingActionItemsForApproval({
    approvalId,
    exceptUserId: user.id,
  });
  void (async () => {
    // P1 review fix — fetch CURRENT case assignment so we can route the
    // case_returned_to_assignee actionable item to whoever is responsible
    // NOW, not whoever submitted the approval (case may have been
    // transferred between submit and reject; stale submitter must not
    // receive a "revise and resubmit" action they no longer own).
    //
    // Product semantic chosen (a): ReturnToAssignee = "case stays with
    // current assignee" — the case-level update path leaves assignedPersonId
    // untouched for this behavior (only ReturnToTeam clears it). Therefore
    // the actionable item must target the current assignedPersonId's User.
    //
    // The original submitter ALWAYS receives the approval_decided FYI so
    // they know the outcome of their submission even after a transfer.
    const caseRow = await prisma.case.findUnique({
      where: { id: row.caseId },
      select: { caseNumber: true, title: true, assignedPersonId: true },
    });
    const submitterId = row.submittedByUserId;
    if (submitterId) {
      void emitActionItem({
        kind: 'approval_decided',
        userId: submitterId,
        companyId: row.companyId,
        objectType: 'CaseResolutionApproval',
        objectId: approvalId,
        caseId: row.caseId,
        caseNumber: caseRow?.caseNumber ?? null,
        caseTitle: caseRow?.title ?? null,
        generatedBy: row.policyId ? `policy:${row.policyId}` : 'system',
        groupKey: `${row.caseId}:approval`,
        dedupKey: `${row.companyId}:${submitterId}:approval_decided:${approvalId}`,
        priority: 30,
        actionRequired: false,
        reasonLabel: `Gönderdiğin çözüm onayı sonuçlandı: Reddedildi — ${updated.rejectionReason ?? ''}`.slice(0, 500),
      });
    }
    if (behavior === 'ReturnToAssignee' && caseRow?.assignedPersonId) {
      // Look up the User linked to the current assignedPersonId. If the
      // assignee has no User row (e.g. legacy person), we deliberately
      // do NOT fall back to the submitter — better to leave the row
      // unrouted than misdirect to a stale user. The approval_decided
      // FYI above already informs the original submitter of the reject.
      const assigneeUser = await prisma.user.findFirst({
        where: { personId: caseRow.assignedPersonId, isActive: true },
        select: { id: true },
      });
      if (assigneeUser) {
        void emitActionItem({
          kind: 'case_returned_to_assignee',
          userId: assigneeUser.id,
          personId: caseRow.assignedPersonId,
          companyId: row.companyId,
          objectType: 'CaseResolutionApproval',
          objectId: approvalId,
          caseId: row.caseId,
          caseNumber: caseRow?.caseNumber ?? null,
          caseTitle: caseRow?.title ?? null,
          generatedBy: row.policyId ? `policy:${row.policyId}` : 'system',
          groupKey: `${row.caseId}:approval`,
          dedupKey: `${row.companyId}:${assigneeUser.id}:case_returned:${row.caseId}:${approvalId}`,
          priority: 70,
          actionRequired: true,
          reasonLabel: 'Reddedildi — revize edip yeniden çözüm onayına gönder.',
        });
      }
    }
  })();

  return updated;
}

// ─────────────────────────────────────────────────────────────────
// Close guard for transitionStatus integration
// ─────────────────────────────────────────────────────────────────

/**
 * Returns null if the case can be closed (Cozuldu transition allowed);
 * returns an ApprovalValidationError instance otherwise. The caller
 * (caseRepository.transitionStatus) should throw it.
 *
 * Rule (§6 in planning card):
 *   - No policy match → no block (legacy behavior)
 *   - Policy match AND case.approvalState === 'Approved' → no block
 *   - Policy match AND case.approvalState !== 'Approved' → BLOCK
 */
export async function checkCloseAllowed({ caseRow }) {
  if (!caseRow) return null;
  // Already-closed cases bypass — different validation owns that.
  if (caseRow.status === 'Cozuldu' || caseRow.status === 'IptalEdildi') return null;
  const policy = await matchPolicyForCase(caseRow);
  if (!policy) return null; // no policy → free close
  if (caseRow.approvalState === 'Approved') return null;
  return new ApprovalValidationError(
    'Bu vakanın kapatılması için çözüm onayı gerekli. Önce "Çözüm Onayına Gönder".',
    { code: 'approval_required' },
  );
}

// ─────────────────────────────────────────────────────────────────
// Per-case approval read (CaseDetail right-pane)
// ─────────────────────────────────────────────────────────────────

export async function listApprovalsForCase({ caseId, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const caseRow = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, companyId: true },
  });
  if (!caseRow) return null;
  if (!allowed.includes(caseRow.companyId)) return null;
  return prisma.caseResolutionApproval.findMany({
    where: { caseId },
    orderBy: { submittedAt: 'desc' },
  });
}
