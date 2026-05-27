/**
 * WR-ACTION-CENTER Phase 1 — Approval Visibility MVP repository.
 *
 * Single-table ActionItem with three Phase 1 kinds:
 *   - approval_pending           (resolved approver receives)
 *   - approval_decided           (original submitter FYI)
 *   - case_returned_to_assignee  (rejected → assignee revise)
 *
 * Constraints (Phase 1, per planning card §1 / §21):
 *  - No FYI conversion (mention/watcher untouched).
 *  - No customer communication queue (dispatch_manual_confirm out).
 *  - No SLA hooks.
 *  - No bulk operations.
 *  - No retention cron.
 *  - Generation is fire-and-forget — exceptions logged but never rethrown
 *    so approval lifecycle never blocks.
 *
 * MSSQL portability: Prisma-managed enums; partial unique on `dedupKey`
 * is a filtered index in MSSQL. JSON-free.
 */

import { prisma } from './client.js';

// ─────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────

export class ActionItemValidationError extends Error {
  constructor(message, { status = 400, code = 'action_item_validation_error' } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class ActionItemAccessError extends Error {
  constructor(message = 'Eylem öğesine erişim yok.') {
    super(message);
    this.code = 'ACTION_ITEM_FORBIDDEN';
    this.status = 403;
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

const ALLOWED_KINDS_PHASE1 = new Set([
  'approval_pending',
  'approval_decided',
  'case_returned_to_assignee',
  // WR-NOTIFICATION-CENTER Phase 2A — mention adapter.
  'mention',
  // WR-NOTIFICATION-CENTER Phase 2B — generic CaseNotification migration.
  // watcher_event covers watcher_added / watcher_update / note_reaction
  // (all "vakada hareket / sosyal sinyal" semantic). system_alert
  // covers transfer_warning (operational warning to supervisors).
  'watcher_event',
  'system_alert',
]);

const ACTIVE_STATES = ['Pending', 'InProgress', 'Snoozed'];

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function trimRequired(value, max, fieldName, code) {
  if (value == null) {
    throw new ActionItemValidationError(`${fieldName} zorunlu.`, { code });
  }
  const s = String(value).trim();
  if (!s) throw new ActionItemValidationError(`${fieldName} zorunlu.`, { code });
  if (s.length > max) {
    throw new ActionItemValidationError(`${fieldName} ${max} karakteri geçemez.`, {
      code: `${code}_too_long`,
    });
  }
  return s;
}

function trimOptional(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > max) {
    throw new ActionItemValidationError(`Alan ${max} karakteri geçemez.`, {
      code: 'field_too_long',
    });
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────
// WR-NOTIFICATION-CENTER Phase 2A — mention helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Content-derived deterministic dedup key for mention ActionItems.
 *
 * Surrogate `CaseMention.id` is NOT used because:
 *  - Prisma `createMany` does not return generated ids; the live adapter
 *    runs at the call site BEFORE we hold any ids.
 *  - A content-derived key lets the backfill script reuse the exact
 *    same key from existing CaseMention rows without an id round-trip.
 *
 * Both the live mention adapter and the backfill script MUST call this
 * helper. Do not duplicate this string template elsewhere.
 */
export function buildMentionDedupKey({ caseId, noteId, mentionedUserId }) {
  if (!caseId || !noteId || !mentionedUserId) {
    throw new Error(
      '[buildMentionDedupKey] caseId, noteId, mentionedUserId zorunlu.',
    );
  }
  return `mention:${caseId}:${noteId}:${mentionedUserId}`;
}

/**
 * Strip `@[Name](userId)` mention markup; collapse whitespace; truncate
 * to `max` chars (default 80) with trailing ellipsis when truncated.
 * Returns empty string if input would be empty after cleaning.
 */
function buildMentionPreview(raw, max = 80) {
  if (!raw) return '';
  const stripped = String(raw)
    // `@[Display](userId)` → `Display`
    .replace(/@\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    // Normalize all whitespace into single spaces
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return '';
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max) + '…';
}

/**
 * Build mention reasonLabel per planning card §D.2-A + Phase 2A L4.
 *   `@Ali Söz 25-001234 yorumunda seni andı: "ilk 80 char..."`
 * Empty preview omits the trailing `: "…"` clause.
 */
function buildMentionReasonLabel({ actorDisplay, caseNumber, preview }) {
  const display = actorDisplay || 'Kullanıcı';
  const number = caseNumber || '';
  const base = `@${display} ${number} yorumunda seni andı`.trim();
  return preview ? `${base}: "${preview}".` : `${base}.`;
}

/**
 * WR-NOTIFICATION-CENTER Phase 2A — emit one mention ActionItem per
 * mentioned user. Fire-and-forget; never throws. Note/reply creation
 * must NOT await any individual emit.
 *
 * Order of checks per recipient (planning card R6 → R8.a):
 *   1. R6 — self-mention skip (actor === recipient).
 *   2. R8.a — defensive UserCompany active membership check. In normal
 *      flow `addNote`/`addReply` validation already proved this; here we
 *      run a second time so a future call-site drift can't sneak past.
 *   3. Build content-derived dedupKey + L4 reasonLabel preview.
 *   4. emitActionItem upsert.
 *
 * @param {Object} args
 * @param {string} args.caseId
 * @param {string} args.companyId
 * @param {string} args.noteId            — id of just-created CaseNote
 * @param {string[]} args.mentionedUserIds — recipients (parsed)
 * @param {string} args.actorUserId
 * @param {string} [args.actorDisplay]    — fullName / authorName preferred
 * @param {string} [args.caseNumber]
 * @param {string} [args.caseTitle]
 * @param {string} [args.noteContent]     — raw, mention-markup preserved
 */
export async function emitMentionsForNote({
  caseId,
  companyId,
  noteId,
  mentionedUserIds,
  actorUserId,
  actorDisplay,
  caseNumber,
  caseTitle,
  noteContent,
}) {
  try {
    if (!caseId || !companyId || !noteId) return;
    const recipients = Array.isArray(mentionedUserIds) ? mentionedUserIds : [];
    if (recipients.length === 0) return;
    const preview = buildMentionPreview(noteContent, 80);
    const reasonLabel = buildMentionReasonLabel({
      actorDisplay,
      caseNumber,
      preview,
    });
    for (const mentionedUserId of recipients) {
      // R6 — self-mention skip
      if (!mentionedUserId || mentionedUserId === actorUserId) continue;
      // R8.a — defensive tenant guard; the existing invalid_mentions
      // validation in addNote/addReply already passed, so this should
      // normally be true. Future drift is the only failure mode.
      const member = await prisma.userCompany.findFirst({
        where: {
          userId: mentionedUserId,
          companyId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!member) continue;
      void emitActionItem({
        kind: 'mention',
        userId: mentionedUserId,
        companyId,
        objectType: 'CaseMention',
        // R2 — surrogate id is unreliable under createMany; rely on
        // dedupKey for idempotency instead.
        objectId: null,
        caseId,
        caseNumber: caseNumber ?? null,
        caseTitle: caseTitle ?? null,
        generatedBy: actorUserId ? `user:${actorUserId}` : 'system',
        groupKey: `${caseId}:mention`,
        dedupKey: buildMentionDedupKey({
          caseId,
          noteId,
          mentionedUserId,
        }),
        priority: 50,
        actionRequired: false,
        reasonLabel,
      });
    }
  } catch (err) {
    // Fire-and-forget contract — note/reply creation must never block.
    console.error('[action-center:emit-mentions] fatal', err?.code, err?.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// WR-NOTIFICATION-CENTER Phase 2B — generic CaseNotification helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Tiny deterministic hash for dedupKey discriminators. djb2 chosen for
 * being dependency-free and stable across Node versions. Output is a
 * compact base-36 string suitable for embedding in a key.
 */
function djb2(input) {
  const s = String(input ?? '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/**
 * Content-derived deterministic dedup key for a CaseNotification-backed
 * ActionItem. Shared by the live adapter (Phase 2B writers) and the
 * backfill script so both paths agree on identity.
 *
 * Why content-derived (not CaseNotification.id):
 *  - Half of the writers use `prisma.caseNotification.createMany` which
 *    does not return generated ids.
 *  - Backfill would have ids; mixing id-based and content-based keys
 *    creates a duplicate between live (no id) and backfill (id) for the
 *    same logical notification.
 *  - One formula = one source of truth = R5 parity rule from Phase 2A.
 *
 * Payload discriminator is hashed via djb2 so the key stays compact and
 * deterministic regardless of message length. Different payloads —
 * different reactions, different update messages, different transfer
 * counts — produce different keys.
 */
export function buildNotificationDedupKey({
  caseId,
  eventType,
  recipientUserId,
  payload,
}) {
  if (!caseId || !eventType || !recipientUserId) {
    throw new Error(
      '[buildNotificationDedupKey] caseId, eventType, recipientUserId zorunlu.',
    );
  }
  const message = payload?.message ?? '';
  const noteId = payload?.noteId ?? '';
  const emoji = payload?.emoji ?? '';
  const transferCount = payload?.transferCount ?? '';
  const kind = payload?.kind ?? '';
  const discInput = `${kind}|${noteId}|${emoji}|${transferCount}|${message}`;
  const disc = djb2(discInput);
  return `notification:${caseId}:${eventType}:${recipientUserId}:${disc}`;
}

/**
 * Translate a CaseNotification.eventType to the ActionItemKind it
 * should land under. Returns null for unknown eventTypes so the
 * adapter can silently skip them (forward-compat: a new writer added
 * later without a mapping will not blow up the adapter — it will
 * simply not surface in Aksiyonlarım until the mapping is added here).
 *
 * Mapping rationale (planning card §17.A coverage table):
 *   watcher_added   → watcher_event  (FYI; "vakada hareket")
 *   watcher_update  → watcher_event  (FYI; same semantic family)
 *   note_reaction   → watcher_event  (FYI; reasonLabel carries emoji)
 *   transfer_warning→ system_alert   (FYI; supervisor-side warning)
 */
function notificationKindFor(eventType) {
  switch (eventType) {
    case 'watcher_added':
    case 'watcher_update':
    case 'note_reaction':
      return 'watcher_event';
    case 'transfer_warning':
      return 'system_alert';
    default:
      return null;
  }
}

/**
 * WR-NOTIFICATION-CENTER Phase 2B — emit a single ActionItem for a
 * generic CaseNotification. Fire-and-forget; never throws. Callers
 * use `void` and never await rejection.
 *
 * Order of checks (same R6/R8 discipline as mention adapter):
 *   1. Recipient is a User.id (legacy bell already only delivers to
 *      User.ids; we trust that contract).
 *   2. R8.a — defensive UserCompany active membership re-check.
 *   3. notificationKindFor(eventType) — unknown types silently skip.
 *   4. Build content-derived dedupKey via the shared helper.
 *   5. emitActionItem upsert (state Pending; actionRequired false;
 *      reasonLabel = payload.message — already an operator-ready
 *      sentence in Turkish).
 *
 * @param {Object} args
 * @param {string} args.caseId
 * @param {string} args.companyId
 * @param {string} args.eventType        — 'watcher_added' | 'watcher_update' | 'note_reaction' | 'transfer_warning'
 * @param {string} args.recipientUserId
 * @param {Object} [args.payload]
 * @param {string} [args.caseNumber]
 * @param {string} [args.caseTitle]
 */
export async function emitGenericNotification({
  caseId,
  companyId,
  eventType,
  recipientUserId,
  payload,
  caseNumber,
  caseTitle,
}) {
  try {
    if (!caseId || !companyId || !eventType || !recipientUserId) return;
    const kind = notificationKindFor(eventType);
    if (!kind) {
      // Unknown eventType — silent skip (forward-compat).
      return;
    }
    // R8.a defensive UserCompany guard. The writer already targets a
    // User.id with active access (legacy bell semantics); a future
    // drift would surface as a silent skip here.
    const member = await prisma.userCompany.findFirst({
      where: {
        userId: recipientUserId,
        companyId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!member) return;
    const dedupKey = buildNotificationDedupKey({
      caseId,
      eventType,
      recipientUserId,
      payload,
    });
    const reasonLabel = String(
      payload?.message ?? `${eventType} bildirimi.`,
    ).slice(0, 500);
    void emitActionItem({
      kind,
      userId: recipientUserId,
      companyId,
      objectType: 'CaseNotification',
      objectId: null, // R2 — surrogate id may not be available (createMany).
      caseId,
      caseNumber: caseNumber ?? null,
      caseTitle: caseTitle ?? null,
      generatedBy: `system:notification:${eventType}`,
      groupKey: `${caseId}:${kind}`,
      dedupKey,
      // FYI severity — none of the migrated eventTypes carry an
      // explicit "you must act" semantic in legacy bell behavior.
      priority: eventType === 'transfer_warning' ? 70 : 50,
      actionRequired: false,
      reasonLabel,
    });
  } catch (err) {
    console.error(
      '[action-center:emit-generic-notification] fatal',
      err?.code,
      err?.message,
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// emitActionItem — fire-and-forget upsert via dedupKey
// ─────────────────────────────────────────────────────────────────

/**
 * Insert or refresh an ActionItem for the given (userId, kind, objectId)
 * tuple. Caller MUST NOT await rejection — internally guarded so any
 * write failure is logged and absorbed (approval lifecycle never blocks
 * because of an inbox write failure).
 *
 * @param {Object} payload
 * @param {string} payload.kind            — one of ALLOWED_KINDS_PHASE1
 * @param {string} payload.userId          — target user
 * @param {string} payload.companyId       — tenant scope
 * @param {string} payload.reasonLabel     — required "why am I seeing this?" sentence
 * @param {string} [payload.personId]
 * @param {string} [payload.objectType]
 * @param {string} [payload.objectId]
 * @param {string} [payload.caseId]
 * @param {string} [payload.caseNumber]
 * @param {string} [payload.caseTitle]
 * @param {string} [payload.generatedBy]
 * @param {string} [payload.groupKey]
 * @param {string} [payload.dedupKey]
 * @param {number} [payload.priority=50]
 * @param {boolean} [payload.actionRequired=true]
 */
export async function emitActionItem(payload) {
  try {
    if (!payload || !payload.kind || !payload.userId || !payload.companyId || !payload.reasonLabel) {
      console.warn('[action-center:emit] missing required field', {
        kind: payload?.kind,
        userId: payload?.userId,
        companyId: payload?.companyId,
        hasReasonLabel: !!payload?.reasonLabel,
      });
      return null;
    }
    if (!ALLOWED_KINDS_PHASE1.has(payload.kind)) {
      console.warn('[action-center:emit] kind not in Phase 1 allowed set', payload.kind);
      return null;
    }

    const data = {
      kind: payload.kind,
      userId: payload.userId,
      companyId: payload.companyId,
      personId: payload.personId ?? null,
      objectType: payload.objectType ?? null,
      objectId: payload.objectId ?? null,
      caseId: payload.caseId ?? null,
      caseNumber: payload.caseNumber ?? null,
      caseTitle: payload.caseTitle ?? null,
      generatedBy: payload.generatedBy ?? null,
      groupKey: payload.groupKey ?? null,
      dedupKey: payload.dedupKey ?? null,
      priority: Number.isFinite(payload.priority) ? Number(payload.priority) : 50,
      actionRequired: payload.actionRequired !== false,
      reasonLabel: String(payload.reasonLabel).slice(0, 500),
      state: 'Pending',
    };

    if (data.dedupKey) {
      // Idempotent upsert: same dedupKey re-runs revive a closed item.
      return await prisma.actionItem.upsert({
        where: { dedupKey: data.dedupKey },
        create: data,
        update: {
          // Re-emitting refreshes routing snapshot and revives state if
          // somehow closed (rare; safe to bring back to Pending so user
          // sees it again).
          state: 'Pending',
          reasonLabel: data.reasonLabel,
          caseNumber: data.caseNumber,
          caseTitle: data.caseTitle,
          generatedBy: data.generatedBy,
          groupKey: data.groupKey,
          priority: data.priority,
          actionRequired: data.actionRequired,
          // Clear lifecycle stamps so item behaves like fresh.
          doneAt: null,
          doneByUserId: null,
          doneOutcome: null,
          closeNote: null,
          snoozedUntil: null,
        },
      });
    }

    return await prisma.actionItem.create({ data });
  } catch (err) {
    console.error('[action-center:emit] fatal', err?.code ?? err?.name, err?.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Approval lifecycle helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Close the decider's ActionItem(s) for a CaseResolutionApproval.
 * Fire-and-forget.
 */
export async function closeActionItemsForApproval({ approvalId, deciderUserId, outcome }) {
  try {
    if (!approvalId || !deciderUserId) return 0;
    const result = await prisma.actionItem.updateMany({
      where: {
        objectType: 'CaseResolutionApproval',
        objectId: approvalId,
        userId: deciderUserId,
        state: { in: ACTIVE_STATES },
      },
      data: {
        state: 'Done',
        doneAt: new Date(),
        doneByUserId: deciderUserId,
        doneOutcome: outcome ?? null,
      },
    });
    return result.count;
  } catch (err) {
    console.error('[action-center:close-decider] fatal', err?.code, err?.message);
    return 0;
  }
}

/**
 * Mark sibling approver ActionItems as Expired once one approver decides.
 * Fire-and-forget.
 */
export async function expireSiblingActionItemsForApproval({ approvalId, exceptUserId }) {
  try {
    if (!approvalId) return 0;
    const result = await prisma.actionItem.updateMany({
      where: {
        objectType: 'CaseResolutionApproval',
        objectId: approvalId,
        state: { in: ACTIVE_STATES },
        ...(exceptUserId ? { userId: { not: exceptUserId } } : {}),
      },
      data: { state: 'Expired' },
    });
    return result.count;
  } catch (err) {
    console.error('[action-center:expire-siblings] fatal', err?.code, err?.message);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────
// Case detail auto-InProgress
// ─────────────────────────────────────────────────────────────────

/**
 * When a user opens a case detail, flip their Pending ActionItems for
 * that case to InProgress. Sets firstSeenAt only when null.
 * Fire-and-forget (case GET path must never block).
 */
export async function markInProgressForCase({ caseId, userId }) {
  try {
    if (!caseId || !userId) return 0;
    // First: stamp firstSeenAt for items that haven't been seen.
    await prisma.actionItem.updateMany({
      where: {
        caseId,
        userId,
        state: 'Pending',
        firstSeenAt: null,
      },
      data: { firstSeenAt: new Date(), state: 'InProgress' },
    });
    // Second pass: handle items already firstSeenAt-stamped (re-visit).
    const result = await prisma.actionItem.updateMany({
      where: {
        caseId,
        userId,
        state: 'Pending',
      },
      data: { state: 'InProgress' },
    });
    return result.count;
  } catch (err) {
    console.error('[action-center:in-progress-for-case] fatal', err?.code, err?.message);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────
// Lazy snooze wake-up
// ─────────────────────────────────────────────────────────────────

async function lazySnoozeWakeUp(userId) {
  try {
    const now = new Date();
    await prisma.actionItem.updateMany({
      where: {
        userId,
        state: 'Snoozed',
        snoozedUntil: { lte: now },
      },
      data: { state: 'Pending', snoozedUntil: null },
    });
  } catch (err) {
    // Non-blocking — list/summary still works on stale state.
    console.error('[action-center:lazy-wake] fatal', err?.code, err?.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// Inbox read APIs
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve which states + actionRequired filter to apply for a given view.
 */
function resolveViewFilter(view) {
  switch (view) {
    case 'fyi':
      return { state: { in: ['Pending', 'InProgress'] }, actionRequired: false };
    case 'snoozed':
      return { state: 'Snoozed' };
    case 'done':
      return { state: { in: ['Done', 'Dismissed', 'Expired'] } };
    case 'action':
    default:
      return { state: { in: ['Pending', 'InProgress'] }, actionRequired: true };
  }
}

/**
 * List ActionItems for a user filtered by view.
 */
export async function listForUser({
  userId,
  allowedCompanyIds,
  view = 'action',
  state = null,
  kind = null,
  limit = 50,
  offset = 0,
  companyId = null,
}) {
  if (!userId) {
    return { items: [], total: 0, badgeCounts: { actionRequired: 0, fyi: 0, snoozed: 0 } };
  }
  const allowed = ensureArray(allowedCompanyIds);
  if (allowed.length === 0) {
    return { items: [], total: 0, badgeCounts: { actionRequired: 0, fyi: 0, snoozed: 0 } };
  }

  await lazySnoozeWakeUp(userId);

  // Tenant scope: caller may pin a single companyId (SystemAdmin filter
  // path); otherwise restrict to allowedCompanyIds.
  let companyScope;
  if (companyId) {
    if (!allowed.includes(companyId)) {
      return { items: [], total: 0, badgeCounts: { actionRequired: 0, fyi: 0, snoozed: 0 } };
    }
    companyScope = companyId;
  } else {
    companyScope = { in: allowed };
  }

  const where = {
    userId,
    companyId: companyScope,
    ...resolveViewFilter(view),
  };

  // Optional explicit overrides (advanced filters)
  if (state) where.state = state;
  if (kind) where.kind = kind;

  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const orderBy = view === 'done'
    ? [{ doneAt: 'desc' }, { createdAt: 'desc' }]
    : [{ priority: 'desc' }, { createdAt: 'desc' }];

  const [items, total] = await Promise.all([
    prisma.actionItem.findMany({
      where,
      orderBy,
      take: safeLimit,
      skip: safeOffset,
    }),
    prisma.actionItem.count({ where }),
  ]);

  const badgeCounts = await computeBadgeCounts(userId, companyScope);

  return { items, total, badgeCounts };
}

async function computeBadgeCounts(userId, companyScope) {
  const baseWhere = { userId, companyId: companyScope };
  const [actionRequired, fyi, snoozed] = await Promise.all([
    prisma.actionItem.count({
      where: { ...baseWhere, state: { in: ['Pending', 'InProgress'] }, actionRequired: true },
    }),
    prisma.actionItem.count({
      where: { ...baseWhere, state: { in: ['Pending', 'InProgress'] }, actionRequired: false },
    }),
    prisma.actionItem.count({
      where: { ...baseWhere, state: 'Snoozed' },
    }),
  ]);
  return { actionRequired, fyi, snoozed };
}

/**
 * Lightweight summary — just the three counts. Called by the bell.
 */
export async function summaryForUser({ userId, allowedCompanyIds, companyId = null }) {
  if (!userId) {
    return { actionRequired: 0, fyi: 0, snoozed: 0 };
  }
  const allowed = ensureArray(allowedCompanyIds);
  if (allowed.length === 0) {
    return { actionRequired: 0, fyi: 0, snoozed: 0 };
  }

  await lazySnoozeWakeUp(userId);

  let companyScope;
  if (companyId) {
    if (!allowed.includes(companyId)) {
      return { actionRequired: 0, fyi: 0, snoozed: 0 };
    }
    companyScope = companyId;
  } else {
    companyScope = { in: allowed };
  }

  return computeBadgeCounts(userId, companyScope);
}

// ─────────────────────────────────────────────────────────────────
// Mutation APIs (owner-only)
// ─────────────────────────────────────────────────────────────────

async function loadOwnedItemOr403({ id, userId, allowedCompanyIds }) {
  const allowed = ensureArray(allowedCompanyIds);
  const row = await prisma.actionItem.findUnique({ where: { id } });
  if (!row) {
    throw new ActionItemValidationError('Eylem öğesi bulunamadı.', {
      status: 404,
      code: 'action_item_not_found',
    });
  }
  if (row.userId !== userId) {
    throw new ActionItemAccessError('Yalnız sahip kullanıcı bu öğeyi değiştirebilir.');
  }
  if (!allowed.includes(row.companyId)) {
    throw new ActionItemAccessError();
  }
  return row;
}

export async function markDone({ id, userId, allowedCompanyIds, payload }) {
  const row = await loadOwnedItemOr403({ id, userId, allowedCompanyIds });
  if (['Done', 'Dismissed', 'Expired'].includes(row.state)) {
    throw new ActionItemValidationError(`Eylem öğesi zaten ${row.state}.`, {
      status: 409,
      code: 'action_item_already_finalized',
    });
  }
  const outcome = payload?.outcome ? String(payload.outcome).slice(0, 50) : 'acknowledged';
  const closeNote = trimOptional(payload?.closeNote, 1000);
  return prisma.actionItem.update({
    where: { id },
    data: {
      state: 'Done',
      doneAt: new Date(),
      doneByUserId: userId,
      doneOutcome: outcome,
      closeNote: closeNote ?? row.closeNote,
    },
  });
}

export async function snooze({ id, userId, allowedCompanyIds, payload }) {
  const row = await loadOwnedItemOr403({ id, userId, allowedCompanyIds });
  if (['Done', 'Dismissed', 'Expired'].includes(row.state)) {
    throw new ActionItemValidationError(`Eylem öğesi zaten ${row.state}.`, {
      status: 409,
      code: 'action_item_already_finalized',
    });
  }
  const snoozedUntilRaw = payload?.snoozedUntil;
  if (!snoozedUntilRaw) {
    throw new ActionItemValidationError('snoozedUntil zorunlu.', { code: 'snoozed_until_required' });
  }
  const snoozedUntil = new Date(snoozedUntilRaw);
  if (Number.isNaN(snoozedUntil.getTime())) {
    throw new ActionItemValidationError('snoozedUntil geçerli bir tarih olmalı.', {
      code: 'snoozed_until_invalid',
    });
  }
  if (snoozedUntil.getTime() <= Date.now()) {
    throw new ActionItemValidationError('snoozedUntil gelecekte olmalı.', {
      code: 'snoozed_until_past',
    });
  }
  return prisma.actionItem.update({
    where: { id },
    data: { state: 'Snoozed', snoozedUntil },
  });
}

/**
 * WR-NOTIFICATION-CENTER Phase 2C P0 — manual unsnooze.
 *
 * Brings a Snoozed row back into the active queue without waiting for
 * snoozedUntil to lapse. Mirrors the owner/tenant guard used by
 * snooze/done/dismiss; only Snoozed rows are accepted (others 409 with
 * action_item_not_snoozed).
 *
 * State change is minimal and reversible:
 *   state = 'Pending'
 *   snoozedUntil = null
 * Other lifecycle stamps (closeNote, doneAt, doneByUserId, doneOutcome,
 * firstSeenAt) are intentionally NOT touched. The row's actionRequired
 * flag dictates whether it lands back in İşler (true) or Bildirimler
 * (false) on the next read — no logic needed here.
 */
export async function unsnooze({ id, userId, allowedCompanyIds }) {
  const row = await loadOwnedItemOr403({ id, userId, allowedCompanyIds });
  if (row.state !== 'Snoozed') {
    throw new ActionItemValidationError(
      `Eylem öğesi şu an ${row.state}; ertelemeyi kaldırılamaz.`,
      { status: 409, code: 'action_item_not_snoozed' },
    );
  }
  return prisma.actionItem.update({
    where: { id },
    data: { state: 'Pending', snoozedUntil: null },
  });
}

export async function dismiss({ id, userId, allowedCompanyIds, payload }) {
  const row = await loadOwnedItemOr403({ id, userId, allowedCompanyIds });
  if (['Done', 'Dismissed', 'Expired'].includes(row.state)) {
    throw new ActionItemValidationError(`Eylem öğesi zaten ${row.state}.`, {
      status: 409,
      code: 'action_item_already_finalized',
    });
  }
  const closeNote = trimOptional(payload?.closeNote, 1000);
  return prisma.actionItem.update({
    where: { id },
    data: {
      state: 'Dismissed',
      doneAt: new Date(),
      doneByUserId: userId,
      doneOutcome: 'dismissed',
      closeNote,
    },
  });
}
