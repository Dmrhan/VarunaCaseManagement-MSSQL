# WR-ACTION-CENTER Phase 1 — Approval Visibility MVP

> **Type:** Implementation Planning Card (Phase 0 → Phase 1 transition; no code yet).
> **Parent card:** [WR-ACTION-CENTER](./WR-ACTION-CENTER.md) §16.1 (Phase 1 — Approval Inbox).
> **Owner:** Ürün direktörü (connect@univera.com.tr)
> **Created:** 2026-05-28
> **Base commit:** `24632cd` on main (parent card merged via PR #267).

This card is the **implementation contract** for the narrowest possible MVP of Action Center: closing the Team Lead "I don't know I have approvals to decide" gap that surfaced after WR-D4/D3 Level A. Nothing more, nothing less.

---

## 0. Decisions referenced

The 8 product decisions from parent card §20, signed off 2026-05-28 with the recommended defaults:

| # | Decision | Applied here |
|---|---|---|
| 1 | FYI band passive show, not in default action view | Phase 1 has *no* FYI kinds — `approval_decided` is the only FYI source and lives in its own band |
| 2 | Snooze Phase 1 lazy on-read | No cron change in Phase 1; lazy wake-up on inbox fetch |
| 3 | Multi-approver: when one decides, others become Expired | Implemented in approval-decided hook (§7.3) |
| 4 | Replace heuristic pendingApprovals widget; rename to "Önerilen Aksiyonlar" where appropriate | MyHome integration plan in §10.2 |
| 5 | Done retention 30 days | Out of Phase 1 (no Done cron); §17 note |
| 6 | SystemAdmin cross-tenant aggregate, explicit company filtering | §13.2 |
| 7 | InProgress auto on CaseDetail open | §6.1 |
| 8 | Two bell counters (Action Required + FYI) | §10.1 |

---

## 1. Strict Scope

### IN

- **One new table:** `ActionItem` (single entity, polymorphic via `objectType`/`objectId`).
- **Three ActionItem kinds only:**
  - `approval_pending` — submitted resolution awaits decision; target = resolved approver
  - `approval_decided` — FYI to original submitter that their resolution was approved/rejected
  - `case_returned_to_assignee` — rejected approval with `ReturnToAssignee` behavior; target = original submitter, actionable ("revize edip yeniden gönder")
- **Backend repository + routes:** read list, read summary (badges), mark done, snooze, dismiss.
- **Generation hooks:** wired into existing `submitApproval` / `approveApproval` / `rejectApproval` in `server/db/approvalRepository.js`.
- **In-app notification bridge:** the 3 events above → ActionItem upsert (fire-and-forget alongside existing `emitNotificationEvent`).
- **MyHome integration:** new "Bekleyen Onaylarım" panel (real `approval_pending` data); existing heuristic widget renamed to "Önerilen Aksiyonlar".
- **Bell integration (safe path):** new `ActionCenterBell` component sits **next to** existing `MentionBellBadge` (not replacing it). Two counters (Action Required + FYI), Phase 1 only sourced from approval-related ActionItems.
- **CaseDetail auto-InProgress:** opening a case marks user's Pending ActionItems for that case as InProgress + `firstSeenAt`.
- **Smoke + manual QA + help docs** for the above.
- **Feature flag:** `actionCenterEnabled` (per-tenant or env-level) — if false, no bell, no widget; backend keeps writing ActionItems silently (forward-compat).

### OUT (deliberate)

- **No full-page `/action-center` route.** Drawer only (Phase 3).
- **No customer communication queue** (`dispatch_manual_confirm`, `dispatch_review_needed` — Phase 2).
- **No SLA / mention / watcher / pattern / transfer / assign hooks.** Just the 3 approval-related kinds.
- **No bulk actions.** Per-item only.
- **No keyboard navigation.** Mouse/touch only.
- **No saved views.** Default view only.
- **No realtime push** (SSE / WebSocket). 60s polling.
- **No AI scoring / prioritization.** `priority` field present but fixed values per kind (see §5.1).
- **No active email or provider work.** Approval lifecycle keeps existing manual-confirm semantics intact.
- **No `ActionItemArchive` cron.** 30-day retention deferred to Phase 2.
- **No mention/watcher migration.** Existing `MentionBellBadge` continues working in parallel.
- **No admin UI for Action Center config.** Hard-coded role-default behavior.
- **No `manual_task` kind** (supervisor → agent task). Phase 2+.
- **No `system_alert` kind.** Phase 4.

### Why this slice?

The Team Lead approval-discoverability gap is the **only acute production pain** WR-D4/D3 Level A leaves behind. Closing it requires the ActionItem table primitive, but every additional kind beyond the three above expands testing surface without addressing the gap. We ship the minimum that unblocks operations and lets the next phase add kinds incrementally with no schema migration.

---

## 2. Architectural Approach

### 2.1 Additive, parallel, reversible

- New table; no existing schema mutated.
- New routes under `/api/action-center/*`; no existing routes touched.
- New FE service + components; existing `MentionBellBadge` + `CaseNotification` untouched.
- Feature flag `actionCenterEnabled` controls UI visibility; backend writes ActionItems regardless of flag (so flag-off → flag-on transition is seamless with no backfill).
- Rollback = drop new table (data loss acceptable, no FK from existing tables).

### 2.2 Fire-and-forget generation

Following the WR-D4/D3 pattern: ActionItem upserts inside approval lifecycle hooks are `void emit(...)` calls — exceptions logged but not re-thrown. Approval submit/approve/reject behavior never breaks because of an ActionItem write failure.

### 2.3 Idempotency at the DB layer

`dedupKey` partial unique index. Re-firing the same event upserts; never inserts duplicates. P2002 caught and treated as "already exists, refresh updatedAt".

### 2.4 Single read endpoint, two views

`GET /api/action-center?view=action|fyi` returns the inbox. Same query, different `actionRequired` filter. Summary endpoint `GET /api/action-center/summary` returns counts only for badges.

---

## 3. Current-State References (verified at base commit)

These references already appear in the parent card §3. Repeated here so this card is self-contained for the implementer:

- **Approval lifecycle hooks (write integration points):**
  - `server/db/approvalRepository.js` — `submitApproval` (~line 365), `approveApproval` (~line 472), `rejectApproval` (~line 530).
  - These already call `void emitNotificationEvent(...)`. We add `void emitActionItem(...)` next to it.
- **`CaseResolutionApproval` model:** `prisma/schema.prisma:1417-1450`. We DO NOT add an FK from ActionItem to this table (polymorphic `objectId` only) — keeps cascade behavior simple.
- **Existing bell:** `src/features/cases/components/MentionBellBadge.tsx`. We mount a sibling `ActionCenterBell` to its left in the header (visual separation matters per decision #8).
- **MyHome dashboard:** `src/features/my/MyHomePage.tsx` + `server/db/myRepository.js` `getDashboard`. We add a new widget `PendingApprovalsPanel` and rename existing heuristic widget label (per decision #4).
- **Role helpers:** `req.user.allowedCompanyIds`, `req.user.personId`, `req.user.role` already populated by `verifyJwt` middleware.
- **`Person.isTeamLead`:** `prisma/schema.prisma:804`. Used by `resolveApprover` (`approvalRepository.js:283`); we don't re-implement.

---

## 4. Schema

### 4.1 New file: `prisma/schema.prisma` additions

```prisma
// ═══════════════════════════════════════════════════════════════════
// WR-ACTION-CENTER Phase 1 — Approval Visibility MVP
// ═══════════════════════════════════════════════════════════════════
//
// Single table covering Phase 1's three approval-related kinds:
//   - approval_pending           (resolved approver receives)
//   - approval_decided           (original submitter FYI)
//   - case_returned_to_assignee  (rejected → assignee revise)
//
// Polymorphic via objectType/objectId — no FK to CaseResolutionApproval
// or Case so cascades stay simple and Phase 2+ kinds can use the same
// table without touching schema.
//
// See docs/planning_cards/WR-ACTION-CENTER.md §5 for full model rationale.

enum ActionItemKind {
  approval_pending
  approval_decided
  case_returned_to_assignee
  // forward-compat values reserved but not generated in Phase 1:
  // case_assigned, case_transferred, case_sla_at_risk, case_sla_breach,
  // mention, watcher_event, dispatch_manual_confirm,
  // dispatch_review_needed, pattern_alert, manual_task, system_alert
}

enum ActionItemState {
  Pending
  InProgress
  Snoozed
  Done
  Dismissed
  Expired
}

model ActionItem {
  id              String          @id @default(cuid())
  companyId       String          // tenant scope
  userId          String          // target user
  personId        String?         // optional Person snapshot (TeamLead routing)
  kind            ActionItemKind
  state           ActionItemState @default(Pending)
  actionRequired  Boolean         @default(true)

  // Polymorphic reference (no FK)
  objectType      String?
  objectId        String?

  // Denormalized snapshots for inbox rendering (avoid JOIN on list)
  caseId          String?
  caseNumber      String?
  caseTitle       String?

  // Routing + dedup
  generatedBy     String?         // 'policy:<id>' | 'system' | 'user:<id>'
  groupKey        String?
  dedupKey        String?
  priority        Int             @default(50)

  // Explainability — required, never empty
  reasonLabel     String

  // Lifecycle timestamps
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  firstSeenAt     DateTime?
  snoozedUntil    DateTime?
  doneAt          DateTime?
  doneByUserId    String?
  doneOutcome     String?         // 'approved' | 'rejected' | 'acknowledged'
  closeNote       String?

  @@unique([dedupKey])
  @@index([userId, state, createdAt(sort: Desc)])
  @@index([userId, state, actionRequired])
  @@index([companyId, kind, state])
  @@index([objectType, objectId])
  @@index([state, snoozedUntil])  // lazy wake-up scan
}
```

### 4.2 Migration

- One additive migration: `prisma migrate dev --name action_center_phase1_action_item`.
- Creates table + enums + indexes.
- Backward-compatible: drop = clean slate (no FK).
- MSSQL portability: enums Prisma-managed; partial unique on nullable `dedupKey` is identical filtered index on MSSQL. No PG-specific syntax.

### 4.3 No back-relations on Case / User / Person

Decision: keep `ActionItem` standalone (polymorphic object reference). Rationale:
- `userId` is a string FK to `User.id` but we skip the Prisma relation declaration to avoid touching `User` model in this card.
- Same for `caseId` denorm and `personId`.
- Trade-off: no Prisma `account.actionItems` traversal. Acceptable for Phase 1 — all queries are direct on ActionItem.
- Phase 2+ if relation traversal needed, additive migration adds back-relation.

---

## 5. Domain Model Details

### 5.1 Fixed priorities (Phase 1 — no scoring)

| Kind | actionRequired | priority |
|---|---|---|
| `approval_pending` | true | 70 |
| `approval_decided` | false | 30 |
| `case_returned_to_assignee` | true | 70 |

Used only for ordering in list query (`ORDER BY priority DESC, createdAt DESC`). UI does not display the number.

### 5.2 dedupKey format

| Kind | dedupKey |
|---|---|
| `approval_pending` | `${companyId}:${userId}:approval_pending:${approvalId}` |
| `approval_decided` | `${companyId}:${userId}:approval_decided:${approvalId}` |
| `case_returned_to_assignee` | `${companyId}:${userId}:case_returned:${caseId}:${approvalId}` |

Different `(userId, kind, approvalId)` combinations produce different rows — multi-approver scenario yields one row per approver.

### 5.3 groupKey (UI collapse hint, Phase 1 unused)

`${caseId}:approval` — Phase 3 will collapse same-case approval activity in drawer; Phase 1 stores but doesn't render groups.

### 5.4 reasonLabel templates (required, never empty)

| Kind | Template |
|---|---|
| `approval_pending` | `Çünkü "{policyName}" politikası kapsamında onaylayıcısın.` |
| `approval_decided` | `Gönderdiğin çözüm onayı sonuçlandı: {outcome}.` |
| `case_returned_to_assignee` | `Reddedildi — revize edip yeniden çözüm onayına gönder.` |

Localized later via i18n layer (out of scope).

---

## 6. Lifecycle (Phase 1 subset of parent §6)

States used in Phase 1:

```
   (event) → Pending ─┬─→ InProgress ─→ Done
                     │       ↑              ↑
                     ├──→ Snoozed ──────────┤  (lazy wake)
                     │
                     ├──→ Dismissed (user, closeNote optional)
                     │
                     └──→ Expired (sibling approver decided)
```

### 6.1 Auto-InProgress on CaseDetail open

Trigger: `GET /api/cases/:id` (existing route, no change to its signature).
Behavior: server-side update query inside the case fetch handler:

```js
// pseudo
await prisma.actionItem.updateMany({
  where: {
    userId: req.user.id,
    caseId: id,
    state: 'Pending',
  },
  data: {
    state: 'InProgress',
    firstSeenAt: new Date(),  // only set if null — see implementation note
  },
});
```

**Implementation note:** Prisma `updateMany` doesn't support conditional field updates. Two-step:
1. Set state to InProgress + updatedAt automatically; `firstSeenAt` only via a separate `updateMany` with `firstSeenAt: null` filter.

This adds 1-2ms to case fetch path. Acceptable given Phase 1 traffic.

### 6.2 Multi-approver Expired path

When `approveApproval` or `rejectApproval` succeeds (after the existing transaction commits, before/after the existing `emitNotificationEvent`):

```js
// pseudo
await prisma.actionItem.updateMany({
  where: {
    objectType: 'CaseResolutionApproval',
    objectId: approvalId,
    state: { in: ['Pending', 'InProgress', 'Snoozed'] },
    userId: { not: deciderUserId },  // don't expire decider's own (we close it as Done below)
  },
  data: { state: 'Expired' },
});
```

Then close the decider's ActionItem:

```js
// pseudo
await prisma.actionItem.updateMany({
  where: {
    objectType: 'CaseResolutionApproval',
    objectId: approvalId,
    state: { in: ['Pending', 'InProgress', 'Snoozed'] },
    userId: deciderUserId,
  },
  data: {
    state: 'Done',
    doneAt: new Date(),
    doneByUserId: deciderUserId,
    doneOutcome: 'approved' | 'rejected',
  },
});
```

### 6.3 Lazy snooze wake-up

`GET /api/action-center` and `GET /api/action-center/summary` BOTH execute:

```js
await prisma.actionItem.updateMany({
  where: {
    userId: req.user.id,
    state: 'Snoozed',
    snoozedUntil: { lte: new Date() },
  },
  data: { state: 'Pending', snoozedUntil: null },
});
```

before the list/count query. Idempotent. <1ms additional cost.

---

## 7. Generation Hooks — exact code locations

### 7.1 `submitApproval` (server/db/approvalRepository.js, after transaction commits)

Existing code (near line 460):
```js
void emitNotificationEvent({
  event: 'resolution_submitted',
  caseId,
  approvalContext: { ... },
});
return approval;
```

Add ABOVE that `void emitNotificationEvent` call (or wherever feels symmetrical):
```js
void emitActionItem({
  kind: 'approval_pending',
  userId: <resolved approver's userId — looked up from resolved.personId>,
  personId: resolved.personId,
  companyId: caseRow.companyId,
  caseId,
  caseNumber: caseRow.caseNumber,  // needs case fetch with caseNumber field
  caseTitle: caseRow.title,
  objectType: 'CaseResolutionApproval',
  objectId: approval.id,
  generatedBy: `policy:${policy.id}`,
  groupKey: `${caseId}:approval`,
  dedupKey: `${caseRow.companyId}:${resolvedUserId}:approval_pending:${approval.id}`,
  priority: 70,
  actionRequired: true,
  reasonLabel: `Çünkü "${policy.name}" politikası kapsamında onaylayıcısın.`,
});
```

**Open implementation question (§20.1):** How to resolve `userId` from `personId`?
- Option A: separate query `prisma.user.findFirst({ where: { personId } })` — adds 1 query in submit path
- Option B: extend `resolveApprover` to return `{ personId, userId }` instead of just `personId` (modify approvalRepository helper — small change)

Recommended: **B** — `resolveApprover` becomes the single source of truth for both Person and User identity. Keeps `submitApproval` clean.

**For role-based approvers** (Supervisor/Admin/SystemAdmin where `expectedApproverPersonId` is the deterministic first sorted personId but multiple users could approve): Phase 1 generates ActionItem for **the snapshotted personId's user only**. If a different eligible user approves (per current Approval authority logic), the snapshot user's ActionItem becomes Expired via §6.2. UI shows "Override yapıldı" (Phase 2+ enhancement; Phase 1 just shows Expired with no extra note).

### 7.2 `approveApproval` (after transaction commits)

Existing code (near line 521):
```js
void emitNotificationEvent({
  event: 'resolution_approved',
  caseId: row.caseId,
  approvalContext: { ... },
});
return updated;
```

Add BEFORE that:
```js
// 1) Close decider's ActionItem
void closeActionItemsForApproval({
  approvalId: approvalId,
  deciderUserId: user.id,
  outcome: 'approved',
});

// 2) Expire siblings (multi-approver fan-out)
void expireSiblingActionItemsForApproval({
  approvalId,
  exceptUserId: user.id,
});

// 3) FYI to original submitter
void emitActionItem({
  kind: 'approval_decided',
  userId: row.submittedByUserId,
  companyId: row.companyId,
  caseId: row.caseId,
  caseNumber: caseRow.caseNumber,
  caseTitle: caseRow.title,
  objectType: 'CaseResolutionApproval',
  objectId: approvalId,
  generatedBy: `policy:${row.policyId ?? 'unknown'}`,
  groupKey: `${row.caseId}:approval`,
  dedupKey: `${row.companyId}:${row.submittedByUserId}:approval_decided:${approvalId}`,
  priority: 30,
  actionRequired: false,
  reasonLabel: `Gönderdiğin çözüm onayı sonuçlandı: Onaylandı.`,
});
```

### 7.3 `rejectApproval` (after transaction commits)

Similar pattern. Three writes:

1. Close decider's ActionItem (outcome=rejected)
2. Expire siblings
3. FYI to submitter — `kind=approval_decided`, reasonLabel: `Gönderdiğin çözüm onayı sonuçlandı: Reddedildi — {rejectionReason}.`
4. If `behavior === 'ReturnToAssignee'`: emit `case_returned_to_assignee` actionable ActionItem for the original assignee (which is `row.submittedByUserId` typically, BUT only if assignee was the submitter — guard against transfer-then-submit scenarios)

```js
if (behavior === 'ReturnToAssignee' && row.submittedByUserId) {
  void emitActionItem({
    kind: 'case_returned_to_assignee',
    userId: row.submittedByUserId,
    companyId: row.companyId,
    caseId: row.caseId,
    caseNumber: caseRow.caseNumber,
    caseTitle: caseRow.title,
    objectType: 'CaseResolutionApproval',
    objectId: approvalId,
    generatedBy: `policy:${row.policyId ?? 'unknown'}`,
    groupKey: `${row.caseId}:approval`,
    dedupKey: `${row.companyId}:${row.submittedByUserId}:case_returned:${row.caseId}:${approvalId}`,
    priority: 70,
    actionRequired: true,
    reasonLabel: 'Reddedildi — revize edip yeniden çözüm onayına gönder.',
  });
}
```

For `ReturnToTeam` and `Escalate`: Phase 1 does NOT generate `case_returned_to_assignee` (no specific assignee to target). Phase 2+ may add `case_returned_to_team` ActionItem for the team.

### 7.4 Helper repository: `server/db/actionItemRepository.js` (new file)

Exports:

- `emitActionItem(payload)` — upsert via `dedupKey`; fire-and-forget wrapper around `prisma.actionItem.upsert`
- `closeActionItemsForApproval({ approvalId, deciderUserId, outcome })`
- `expireSiblingActionItemsForApproval({ approvalId, exceptUserId })`
- `listForUser({ userId, allowedCompanyIds, view, state, kind, limit, offset })`
- `summaryForUser({ userId, allowedCompanyIds })` — returns `{ actionRequired, fyi, snoozed }`
- `markDone({ id, userId, outcome, closeNote })`
- `snooze({ id, userId, snoozedUntil })`
- `dismiss({ id, userId, closeNote })`
- `markInProgressForCase({ caseId, userId })` — used by case detail auto-transition

Each mutation enforces `userId === req.user.id` (you can only mutate your own items). 403 otherwise.

### 7.5 Order of operations (transactional safety)

```
[approveApproval]
  ├─ prisma.$transaction begins
  │   ├─ Update CaseResolutionApproval state=Approved
  │   ├─ Update Case.approvalState='Approved'
  │   └─ Insert CaseActivity row
  ├─ TX commits
  ├─ void closeActionItemsForApproval(...)        ← Phase 1 fire-and-forget
  ├─ void expireSiblingActionItemsForApproval(...) ← Phase 1 fire-and-forget
  ├─ void emitActionItem(approval_decided FYI)     ← Phase 1 fire-and-forget
  ├─ void emitNotificationEvent(...)               ← existing WR-D4/D3
  └─ return updated
```

Decision: all 3 ActionItem writes are outside the transaction. Race window exists where a fast second decide attempt could see stale Pending; idempotent dedupKey + state guards make this safe (`updateMany` on `state IN (Pending, InProgress, Snoozed)` filter).

---

## 8. Routes

### 8.1 New router: `server/routes/action-center.js`

Mount at `/api/action-center` (avoid nesting under `/api/approvals` since this is broader-purpose).

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/api/action-center` | Any authed | List user's ActionItems (filtered by view/state/kind) |
| GET | `/api/action-center/summary` | Any authed | Returns `{ actionRequired, fyi, snoozed }` counts |
| POST | `/api/action-center/:id/done` | Owner only | Mark item Done; body `{ outcome?, closeNote? }` |
| POST | `/api/action-center/:id/snooze` | Owner only | Mark Snoozed; body `{ snoozedUntil: ISO }` |
| POST | `/api/action-center/:id/dismiss` | Owner only | Mark Dismissed; body `{ closeNote? }` |

**No bulk endpoints in Phase 1.**

### 8.2 Query parameters for `GET /api/action-center`

```
view=action|fyi|snoozed|done   (default 'action')
state=Pending|InProgress|Done|Dismissed|Expired  (multi via comma; default depends on view)
kind=approval_pending|approval_decided|case_returned_to_assignee  (multi)
limit=50  (max 200)
offset=0
```

`view=action` → `actionRequired=true AND state IN (Pending, InProgress)`
`view=fyi` → `actionRequired=false AND state IN (Pending, InProgress)`
`view=snoozed` → `state='Snoozed'`
`view=done` → `state IN (Done, Dismissed, Expired)`; ordered by `doneAt DESC`

### 8.3 Authority

- All routes pass `verifyJwt`.
- `:id` mutation routes verify `actionItem.userId === req.user.id`. Otherwise 403.
- No SystemAdmin override on read of other users' items in Phase 1 (privacy). Cross-tenant aggregate (decision #6) is implemented in §13.2.

### 8.4 Response shapes

`GET /api/action-center` returns:
```ts
{
  items: ActionItem[],   // already snapshot-rich — no follow-up JOIN needed
  total: number,
  badgeCounts: { actionRequired, fyi, snoozed }
}
```

`GET /api/action-center/summary`:
```ts
{
  actionRequired: number,
  fyi: number,
  snoozed: number,
  newSinceMs?: number   // optional: ms since most recent ActionItem (for "new" dot)
}
```

---

## 9. Frontend

### 9.1 New service: `src/services/actionCenterService.ts`

```ts
export interface ActionItem { id, kind, state, actionRequired, caseId, caseNumber, caseTitle, reasonLabel, priority, createdAt, snoozedUntil?, doneAt? }
export const actionCenterService = {
  list({ view, state, kind, limit, offset }): Promise<{items, total, badgeCounts}>
  summary(): Promise<{actionRequired, fyi, snoozed}>
  markDone(id, payload): Promise<ActionItem>
  snooze(id, payload): Promise<ActionItem>
  dismiss(id, payload): Promise<ActionItem>
}
```

Uses existing `apiFetch` helper (consistent with caseService / notificationService).

### 9.2 New components

#### `src/features/action-center/ActionCenterBell.tsx`

- Mounted in header (App.tsx), to the left of MentionBellBadge.
- Two visible counters: **kırmızı pill = actionRequired**, **gri pill = fyi**.
- Click → `ActionCenterDrawer` opens.
- Polls `/api/action-center/summary` every 60s. Listens to `app:action-center-changed` event.

#### `src/features/action-center/ActionCenterDrawer.tsx`

- Right-side drawer, full-height, ~360px width.
- 4 tabs at top: **Eylem Bekleyen** (action) / **Bildirimler** (fyi) / **Ertelenen** (snoozed) / **Yapıldı** (done — last 7d).
- Each row renders: `<ActionItemRow>` (icon + reason label + caseNumber rozeti + zaman + mini-actions).
- Mini-actions per kind:
  - `approval_pending` → [Vakayı Aç] [Onayla] [Reddet] (mini-actions trigger existing `/api/approvals/:id/approve|reject` endpoints, then mark done client-side)
  - `approval_decided` → [Vakayı Aç] [Okundu] (mark done with outcome='acknowledged')
  - `case_returned_to_assignee` → [Vakayı Aç] (no inline submit; user must revise then resubmit)
- Per-row context menu: Snooze (1h / yarın 9am / pazartesi 9am / custom), Dismiss (with optional note).
- "Vakayı Aç" navigates to CaseDetail (auto-InProgress fires via §6.1).

#### `src/features/my/PendingApprovalsPanel.tsx`

- Replaces the existing heuristic widget on MyHomePage (per decision #4).
- Header: "Bekleyen Onaylarım" + count badge.
- Body: top 5 `approval_pending` ActionItems (one row each, smaller than drawer rows).
- Empty state: "Bekleyen onayın yok ✓".
- "Tümünü Gör" link opens drawer (no full-page route in Phase 1).

#### Existing widget rename

The current heuristic `pendingApprovals` widget in MyHomePage is **kept** but its label changes to **"Önerilen Aksiyonlar"** (per decision #4). The underlying server-side heuristic in `myRepository.js` `getDashboard` stays as-is; only the UI string changes. This signals to operators that it's an AI suggestion list, not a real approval queue.

### 9.3 CaseDetail auto-InProgress trigger

No new FE component. The auto-update happens server-side inside `caseRepository.get` (or the route handler) when `req.user.id` is known. The FE doesn't need to know about ActionItem state — it just renders the case.

### 9.4 No FE changes to existing approval card

`ResolutionApprovalCard.tsx` is **not modified** in Phase 1. The card continues to render as-is when the user opens a case detail. The ActionCenterBell + drawer is the new entry path; the card remains the workspace.

### 9.5 Feature flag

`src/config/featureFlags.ts` (new file, simple):
```ts
export const featureFlags = {
  actionCenterEnabled: typeof window !== 'undefined' && import.meta.env.VITE_ACTION_CENTER_ENABLED === 'true',
};
```

Bell + widget render only when flag is true. Backend hooks fire regardless (forward-compat).

For dev: default ON. For prod: gradual rollout per tenant via env or a runtime config endpoint (Phase 2; Phase 1 is env-level only).

---

## 10. UI Integration Details

### 10.1 Bell counter UX

- Two counter pills side-by-side or stacked depending on header space.
- Icon: `ListChecks` (lucide). Differentiates visually from existing `Bell` / `BellRing` icons.
- Empty state: just the icon, no pill. Don't show "0".
- Hover tooltip: "X eylem bekliyor, Y bildirim".

### 10.2 MyHome integration

- New `PendingApprovalsPanel` sits between current "Urgent Signals" and "Assigned to Me" widgets — high visibility for Team Leads.
- Existing heuristic widget label change is a 1-line edit; behavior preserved.
- Both panels co-exist on the same dashboard fetch. `getDashboard` adds a single new query:
  ```js
  pendingApprovals: await prisma.actionItem.findMany({
    where: { userId, state: { in: ['Pending', 'InProgress'] }, kind: 'approval_pending' },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })
  ```
  Cost: 1 indexed query, ~1-2ms. Acceptable within existing 30s cache.

### 10.3 Header layout

```
[ Logo ] [ Nav: Vakalar | Raporlar | ... ]   [ActionCenterBell] [MentionBellBadge] [User]
```

Two bells side by side until Phase 2 consolidation. Decision #8 explicit.

---

## 11. Polling and Events

### 11.1 Phase 1 polling

- `ActionCenterBell` polls `/api/action-center/summary` every **60s**.
- `ActionCenterDrawer` (when open) polls `/api/action-center?view=...` every **30s** (more aggressive while user is looking).
- `PendingApprovalsPanel` data comes from `getDashboard` (existing 30s cache).

### 11.2 New custom event

`app:action-center-changed` — dispatched by:
- `markDone`, `snooze`, `dismiss` mutation success
- Any mini-action (approve / reject) success — to also refresh existing `MentionBellBadge` if needed

Subscribers:
- `ActionCenterBell` (refresh summary)
- Drawer (refresh list)
- `PendingApprovalsPanel` (refresh)

### 11.3 No realtime in Phase 1

No SSE / WebSocket / Supabase Realtime channel. Polling-only. Phase 4 may revisit.

### 11.4 Existing polling unchanged

- `MentionBellBadge` continues its 60s poll.
- Pattern alert poll continues.
- Calendar poll continues.

Phase 2 will consolidate; Phase 1 keeps them parallel to limit scope.

---

## 12. Performance & Architecture Gate

> **Verdict:** Pass.

### 12.1 Query cost

| Query | Cost |
|---|---|
| List inbox (50 items) | Index `(userId, state, createdAt DESC)` — O(log n + 50). ~2ms |
| Summary counts | Same index, COUNT — ~1ms |
| Mark done / snooze / dismiss | Single row update by `id` — ~1ms |
| Auto-InProgress on case open | `updateMany` by `userId + caseId` — index `(userId, state, createdAt)` covers; ~2ms |
| Lazy snooze wake-up | `updateMany` by `userId + state=Snoozed + snoozedUntil <= now` — index `(state, snoozedUntil)` covers; ~1-2ms |

Total per-user budget: ~5ms aggregate per page load. Within budget.

### 12.2 Generation cost

Each approval submit/approve/reject now writes 1-3 ActionItems via `upsert`. Each upsert ~2ms. Fire-and-forget so caller P50 untouched.

### 12.3 Table growth

- Phase 1 only emits on approval lifecycle. Estimate: 200 active users × 5 approvals/week × 3 ActionItems each = 3000/week → 12000/month → 150K/year.
- Indexes total: ~30MB at year 1. No concern.

### 12.4 Cache

- Per-user summary count cached 30s in-memory (mirrors `myRepository.getDashboard` pattern).
- Mutation invalidates user's cache key.

### 12.5 N+1 protection

ActionItem rows carry denorm snapshots (`caseNumber`, `caseTitle`). Inbox list has zero JOIN. Detail navigation fetches case separately (existing route).

### 12.6 Failure modes (caller-blocking risk)

All ActionItem writes are `void` — caller never blocked. Tested in §15.

---

## 13. Security / RBAC / Tenant Scope

### 13.1 Tenant scope

- All read queries: `WHERE companyId IN (req.user.allowedCompanyIds)`.
- All mutation queries: same scope AND `userId === req.user.id`.
- `ActionItem.companyId` required at insert time (never null).

### 13.2 SystemAdmin cross-tenant aggregate (decision #6)

Phase 1 implementation:
- `GET /api/action-center?companyId=...` accepts optional explicit tenant filter.
- For SystemAdmin user, `companyId` filter expands `allowedCompanyIds` to all active companies.
- For non-SystemAdmin user, `companyId` must be in their `allowedCompanyIds`; otherwise filtered out silently.

Cross-tenant **aggregate dashboard** (single page showing all tenants) is Phase 4. Phase 1 SystemAdmin sees their natural scope and can manually filter to a specific tenant.

### 13.3 PII handling

- `reasonLabel` and `caseTitle` may contain customer info. Standard PII rules apply: never log to console at INFO; mask in admin audit views.
- No new PII sources introduced; same as existing CaseNotification.

### 13.4 Mutation authority

- "Mark done / snooze / dismiss" requires owner (`actionItem.userId === req.user.id`).
- Mini-actions (Onayla / Reddet) trigger existing approval endpoints — those endpoints retain their own authority guards (`expectedApproverPersonId` match or SystemAdmin override). ActionItem mutation does NOT bypass approval authority.

### 13.5 Read isolation

Phase 1: A user cannot read another user's ActionItems. No "Admin sees agent's queue" feature (Phase 3+ may add audit-only admin read).

---

## 14. Audit & Compliance

### 14.1 ActionItem fields are themselves the audit

- `doneAt`, `doneByUserId`, `doneOutcome`, `closeNote` — immutable after set.
- `firstSeenAt` — captures when user noticed the item.

### 14.2 KVKK / GDPR

- User deletion: `ON DELETE CASCADE` semantics — Phase 1 uses no FK constraint, but cleanup job (Phase 2+) removes ActionItems for deleted users.
- Customer data: ActionItem.caseTitle snapshot. Case deletion does NOT cascade in Phase 1 (no FK); orphan ActionItems become harmless (caseId stale). Phase 2 cleanup query.

### 14.3 Approval audit invariants preserved

`CaseResolutionApproval` row remains the canonical approval audit (§5.2 of parent card). ActionItem `doneOutcome` is a *secondary* audit tied to the user's interaction with the inbox, not the approval decision itself.

---

## 15. Failure Modes

| Mode | Behavior |
|---|---|
| `emitActionItem` throws inside hook | Logged, caller continues (`void`-wrapped) |
| `dedupKey` collision (P2002) | Caught in `emitActionItem`; treated as update (find + set state=Pending if was archived) |
| ActionCenterBell fetch fails | Soft-fail: bell shows no count, no error toast (UI quiet) |
| Auto-InProgress query fails | Logged; case detail still loads (ActionItem stays Pending — operator can manually navigate from drawer) |
| Lazy snooze wake-up race (item already woke via another path) | `updateMany` with state filter is idempotent |
| Sibling expire when no siblings exist | `updateMany` matches 0 rows, no-op |
| Feature flag off + ActionItem writes happen | Backend safely writes; no UI shows them. Flag flip seamless. |

---

## 16. Smoke + Acceptance

### 16.1 New smoke: `scripts/smoke-action-center-phase1.js`

Scenarios (target 14):

1. **Setup:** Create policy + agent + team lead + admin (existing fixture pattern).
2. **submit → approval_pending ActionItem appears** in team lead's inbox with correct fields (kind, reasonLabel, caseNumber, dedupKey).
3. **Idempotent re-submit:** triggering submit twice (forced via direct repo call) yields one row, not two.
4. **Summary count:** `actionRequired = 1` for team lead, `0` for unrelated user.
5. **List query:** `view=action` returns the row; `view=fyi` empty; `view=done` empty.
6. **Mark done:** `POST /api/action-center/:id/done` → state=Done, doneAt set, doneByUserId set; summary `actionRequired = 0`.
7. **Tenant scope leak guard:** insert ActionItem for user in companyY (not in user's allowedCompanyIds); list returns 0.
8. **Wrong-user mutation:** user B tries to done user A's item → 403, item unchanged.
9. **Approve via existing endpoint:** triggers ActionItem close + sibling expire + approval_decided FYI insert for submitter.
10. **Reject via existing endpoint with ReturnToAssignee:** generates approval_decided FYI + case_returned_to_assignee actionable.
11. **Snooze:** `POST /:id/snooze` with future ISO → state=Snoozed, snoozedUntil set; summary `actionRequired` drops, `snoozed` rises.
12. **Lazy wake-up:** insert ActionItem with `state=Snoozed, snoozedUntil=PAST`; `GET /summary` fires lazy update → state=Pending in DB.
13. **Dismiss:** `POST /:id/dismiss` with closeNote → state=Dismissed, closeNote set.
14. **Generation fire-and-forget:** stub `emitActionItem` to throw; `submitApproval` still returns success and creates `CaseResolutionApproval` row (caller never blocked).

Plus regressions:
- `smoke-resolution-approval-flow` — 16/16 PASS (no behavior change)
- `smoke-notification-flow` — 19/19 PASS
- `smoke-customer-response-channel` — 20/20 PASS
- `smoke-help-content` — 2 topics, 0 violations PASS

### 16.2 Manual QA

New file: `docs/qa/WR-ACTION-CENTER-PHASE1-MANUAL-QA.md` (shipped alongside implementation PR; not in this card).

Outline of 12 manual steps:
1. Admin: create policy with `approverType=AssignedTeamLead`.
2. Agent: open new case, assign to a team with a designated lead, submit resolution for approval.
3. Team Lead: log in. Expect **two bell counters** in header (red=1, gray=0) and **PendingApprovalsPanel** on MyHome showing 1 item.
4. Click ActionCenterBell → drawer opens with one row in "Eylem Bekleyen" tab.
5. Row shows reasonLabel "Çünkü ... politikası kapsamında onaylayıcısın."
6. Click "Vakayı Aç" → navigates to case detail.
7. Return to MyHome → ActionItem row state visible as `In Progress` (subtle visual cue).
8. Click drawer row's [Onayla] mini-action → backend approval succeeds; drawer row disappears from "Eylem Bekleyen"; appears in "Yapıldı" tab as outcome=approved.
9. Original Agent (submitter): receives `approval_decided` FYI in gray bell counter.
10. Test reject path: snooze + wake-up + dismiss.
11. Test multi-approver expire: create policy with `approverType=Supervisor` (multiple supervisors); one approves → others' ActionItem becomes Expired (visible in done tab).
12. Feature flag off: bell + widget disappear; backend continues writing ActionItems silently (verify in DB).

### 16.3 Help docs

Plan: extend `src/help/helpRegistry.ts` `approval-notifications` topic with new sections:
- "Eylem Merkezi nedir?" — short
- "Bekleyen onayım nerede görünür?" — bell + MyHome widget
- "Snooze / Dismiss ne işe yarar?" — short

Add `ACTION_CENTER_DRAWER_HELP` to `src/features/admin/helpContents.ts` for the drawer's "? Yardım" button (Phase 1 keeps drawer simple — help is in registry only; no per-drawer help button until Phase 3).

requiredKeywords additions:
- `Eylem Merkezi`
- `Bekleyen Onaylarım`
- `Önerilen Aksiyonlar`
- `Ertele`
- `Yok Say`

### 16.4 Definition of Done (ship criteria)

A user log in as **Team Lead** for a tenant with at least one active resolution approval policy must:
- [ ] See two distinct counters in the header bell area (red action + gray FYI) when ActionItems exist.
- [ ] See "Bekleyen Onaylarım" panel on MyHome (separate from "Önerilen Aksiyonlar" heuristic widget).
- [ ] Open the drawer and see a list of `approval_pending` rows with `reasonLabel` filled.
- [ ] Click [Onayla] inside the drawer and have the approval succeed via existing endpoint (no behavior regression on existing approval flow).
- [ ] Snooze, wake-up, dismiss, mark-done all work via the API + UI.
- [ ] Feature flag off completely hides Action Center UI; backend continues to record ActionItems silently.
- [ ] All 14 smoke scenarios pass.
- [ ] All 4 regression smokes pass.
- [ ] tsc + vite build clean.
- [ ] WORK_REGISTER + matrix updated to reflect Phase 1 shipped.

---

## 17. Data Migration / Backward Compatibility

### 17.1 Phase 1 — additive only

No existing schema mutation. New table + indexes + enums.

### 17.2 Backfill

No backfill required. Old approvals submitted before deployment do not get ActionItems. Acceptable since:
- Existing approvals are already in flight; team leads currently working through them won't see them in inbox, but the existing CaseDetail card still works.
- The first new submit after deployment generates an ActionItem.

If a tenant wants backfill (extreme case), Phase 2 will provide a one-shot script `scripts/backfill-action-items-from-existing-approvals.js`. Not in Phase 1.

### 17.3 Done retention

Decision #5 (30 days) NOT enforced in Phase 1. Done rows accumulate. Phase 2 will add the cron / archive. Acceptable: at 200 users × 5 approvals/week × 30 days = 30K rows. Index handles.

### 17.4 Rollback

- Disable feature flag → UI gone.
- Drop new table → data loss acceptable (no FK from other tables).
- Approval lifecycle works as before WR-ACTION-CENTER.

---

## 18. MSSQL Portability

Same standard as parent card §18. All Prisma enums; all indexes Prisma-managed; partial unique on nullable column = filtered index in MSSQL. No PG-specific syntax. JSON-free.

---

## 19. WORK_REGISTER and Planning Matrix Updates

After Phase 1 ships:

- **WORK_REGISTER.md:** Add new row under section D (Admin Definitions) or a new section "I. Action Center" with ID `I1` (Action Center Phase 1 — Approval Visibility MVP). Status `Shipped`. Cross-reference WR-D4 / WR-D3.
- **PRODUCT_PLANNING_MATRIX.md:** Add `PM-21` capability: "Eylem Merkezi (Approval Visibility MVP)". Priority 🟡 P1 (operational unblock, but small surface).
- **BACKLOG.md:** Reference Phase 2 work item (FYI conversion + dispatch_manual_confirm kind + retention cron) and Phase 3 (full-page inbox + saved views + bulk).

Out of scope for this card — to be done by the implementation PR.

---

## 20. Open Implementation Questions

Decisions for the implementer (not product). Bookmark for the implementation PR:

| # | Question | Recommended default |
|---|---|---|
| 1 | `userId` resolution from `personId` | Extend `resolveApprover` to return both — saves a query (§7.1) |
| 2 | `summary.newSinceMs` semantics | Most recent `createdAt` in last 5 min; UI shows a green dot if > 0 |
| 3 | Drawer fetch interval (30s vs 60s) | 30s while open, 60s when closed (event-driven refresh covers rest) |
| 4 | Done tab look-back window | Last 7 days. Older Done items only visible via Phase 3 search |
| 5 | Feature flag mechanism (env vs runtime config) | Phase 1 env var only; Phase 2 may add admin per-tenant toggle |
| 6 | Auto-InProgress on dashboard fetch too? | No. Only on case detail open. Dashboard fetch is too broad |
| 7 | Mini-action for [Reddet] requires rejection reason — modal in drawer? | Yes — inline modal in drawer; reuses existing rejection modal logic if extractable |
| 8 | If existing `CaseDetail` page has caching, does auto-InProgress fire on cached load? | Always fire (DB-side update); negligible cost. Cache invalidation downstream |

All 8 are technical micro-decisions; implementer applies the recommended default unless code review pushes back.

---

## 21. Out-of-Scope Reminder

**Reiterated** for the implementer to keep this PR small:

- ❌ Full-page `/action-center` route
- ❌ Customer communication queue (`dispatch_manual_confirm`, `dispatch_review_needed`)
- ❌ SLA / mention / watcher / pattern / transfer / assign kinds
- ❌ Bulk actions
- ❌ Keyboard navigation
- ❌ Saved views
- ❌ Realtime push
- ❌ AI scoring
- ❌ Active email / provider integration
- ❌ Done retention cron / archive table
- ❌ Mention / watcher migration from CaseNotification
- ❌ Admin UI for Action Center config
- ❌ `manual_task` kind (supervisor → agent)
- ❌ `system_alert` kind
- ❌ Multi-bell consolidation (kept parallel with `MentionBellBadge`)
- ❌ Backfill of existing pre-deployment approvals

Anything beyond the IN list in §1 belongs to a future card. If a reviewer asks "can we also add X?", the answer is "noted for Phase 2 — let's ship Phase 1 first."

---

## 22. Outcomes / Success Metrics

### 22.1 Acute pain measurement

- **Pre-Phase-1 baseline:** Team Leads' average time-to-decide on a submitted approval (measured from `CaseResolutionApproval.submittedAt` to `decidedAt`).
- **Post-Phase-1 target:** -30% median time-to-decide within 2 weeks of pilot rollout.

### 22.2 Adoption signals (Phase 1 first month)

- Bell open rate per user/day
- Mini-action [Onayla] vs "Vakayı Aç then approve from CaseDetail" ratio (in-drawer adoption indicator)
- Snooze usage rate per user
- Dismiss usage rate (with closeNote frequency)
- "Önerilen Aksiyonlar" widget click-through (does the renamed widget remain useful or become noise?)

### 22.3 Alarms

- Bell open rate < 1× per active user per day → discoverability issue (UI bug or empty inbox bug)
- High dismiss-without-closeNote rate → reasonLabel quality issue
- Drawer fetch errors > 0.1% → backend stability issue

### 22.4 Phase 2 readiness signals

If Phase 1 succeeds (acute pain measurably reduced), proceed to:
- **Phase 2 (FYI + dispatch_manual_confirm):** Expand kinds, migrate mention/watcher, add retention cron.

If Phase 1 underperforms, debug:
- Maybe the gap was less acute than thought
- Maybe reasonLabel UX needs tuning
- Maybe MyHome panel placement needs revisiting

Adjust before Phase 2 investment.

---

## Appendix A — Implementation Timeline Estimate

For the implementation PR (no commitments; estimator only):

| Task | Effort |
|---|---|
| Schema + migration | 0.5 day |
| `actionItemRepository.js` (8 functions) | 1 day |
| Generation hooks (3 in `approvalRepository.js`) | 0.5 day |
| Routes (5 endpoints) | 0.5 day |
| FE service + types | 0.5 day |
| ActionCenterBell + ActionCenterDrawer | 1.5 days |
| PendingApprovalsPanel + MyHome rename | 0.5 day |
| CaseDetail auto-InProgress server-side wire | 0.5 day |
| Feature flag wire | 0.25 day |
| Smoke (14 scenarios) | 1 day |
| Help registry + manual QA doc | 0.5 day |
| Regression validation | 0.25 day |
| Code review + fixes | 0.5 day |

**Total estimate: 8 dev-days.** Single-PR shippable.

---

## Appendix B — File Inventory (will be created in implementation PR)

| New | File |
|---|---|
| ✅ | `prisma/migrations/<timestamp>_action_center_phase1_action_item/migration.sql` |
| ✅ | `server/db/actionItemRepository.js` |
| ✅ | `server/routes/action-center.js` |
| ✅ | `src/services/actionCenterService.ts` |
| ✅ | `src/features/action-center/ActionCenterBell.tsx` |
| ✅ | `src/features/action-center/ActionCenterDrawer.tsx` |
| ✅ | `src/features/action-center/ActionItemRow.tsx` |
| ✅ | `src/features/my/PendingApprovalsPanel.tsx` |
| ✅ | `src/config/featureFlags.ts` |
| ✅ | `scripts/smoke-action-center-phase1.js` |
| ✅ | `docs/qa/WR-ACTION-CENTER-PHASE1-MANUAL-QA.md` |

| Modified | File |
|---|---|
| ✏️ | `prisma/schema.prisma` (+ActionItem model + 2 enums) |
| ✏️ | `server/db/approvalRepository.js` (3 hook points + `resolveApprover` to return userId) |
| ✏️ | `server/db/myRepository.js` (`getDashboard` + 1 query for pendingApprovals) |
| ✏️ | `server/routes/cases.js` (case detail GET → auto-InProgress) — minimal addition |
| ✏️ | `server/app.js` (mount `/api/action-center` router) |
| ✏️ | `src/App.tsx` (mount `ActionCenterBell` in header next to `MentionBellBadge`) |
| ✏️ | `src/features/my/MyHomePage.tsx` (add `PendingApprovalsPanel`, rename heuristic widget label) |
| ✏️ | `src/help/helpRegistry.ts` (extend `approval-notifications` topic) |
| ✏️ | `src/features/admin/helpContents.ts` (optional new entry) |

Existing files NOT touched:
- `ResolutionApprovalCard.tsx`
- `MentionBellBadge.tsx`
- `CaseDetailPage.tsx` (except indirectly via case GET route)
- WR-D3 notification machinery
- AccountCompany / Case schema
- Any catalog / customer 360 paths

---

**This card is the implementation contract for Phase 1. Any deviation in the implementation PR must be justified and reflected back here as an addendum before merge.**
