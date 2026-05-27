/**
 * WR-NOTIFICATION-CENTER Phase 2B+2C — generic CaseNotification flow smoke.
 *
 * Repository-level (no HTTP). 18 scenarios covering the four migrated
 * eventTypes + backfill + tenant scope + read mapping + watcher
 * self-add suppression (Codex P2) + backfill-side self-follow guard
 * (Codex P2 follow-up) + Phase 2C legacy eventType classification
 * (`transfer` mapped, `mention` explicitly skipped, unknown eventTypes
 * still flagged, canonical CaseMention path untouched):
 *
 *   G1   watcher_added → live emit
 *        watcherRepo.add writes CaseNotification + emits ActionItem
 *        (kind=watcher_event, actionRequired=false, reasonLabel
 *        comes from payload.message).
 *
 *   G2   watcher_update → live emit
 *        notifyWatchers (invoked via caseRepository.update field
 *        change) writes CaseNotification per watcher + emits
 *        ActionItem per watcher. dedup key is content-derived.
 *
 *   G3   note_reaction → live emit
 *        reactionRepo records a 👍 on a note authored by recipient;
 *        ActionItem (kind=watcher_event) lands in author's inbox
 *        with reasonLabel mentioning the emoji + the reactor name.
 *
 *   G4   transfer_warning → live emit
 *        triggerTransferRootCause fan-out emits a system_alert
 *        ActionItem per supervisor with priority=70 (warning).
 *
 *   G5   Multi-recipient fan-out
 *        One watcher_update for a case with 3 watchers produces
 *        3 ActionItem rows, distinct userId and dedupKey per
 *        recipient.
 *
 *   G6   Backfill dry-run would-create counts
 *        Plant 2 fresh CaseNotification rows (one unread, one
 *        already-read). simulateBackfill --dry-run reports
 *        created_pending >= 1 and created_done >= 1, the DB
 *        ActionItem count for those dedupKeys unchanged.
 *
 *   G7   Backfill idempotency
 *        After execute the two rows materialize (Pending +
 *        Done/migrated-read). A second execute produces 0 new
 *        and skipped_dedup >= 2.
 *
 *   G8   Tenant scope leak guard
 *        ActionItem planted in companyB (kind=watcher_event)
 *        does not appear in companyA listForUser.
 *
 *   G9   No-UserCompany drift
 *        Drift fixture CaseNotification targeting a user without
 *        UserCompany → backfill skipped_no_membership++ and no
 *        ActionItem is written.
 *
 *   G10  Inactive UserCompany drift
 *
 *   G11  Watcher self-add suppression (Codex P2 / Phase 2C P0 fix)
 *        User follows themselves (userId === addedBy):
 *          - CaseWatcher row CREATED (self-follow preserved)
 *          - CaseNotification row CREATED (legacy bell unchanged)
 *          - ActionItem row NOT created (Aksiyonlarım self-noise YOK)
 *
 *   G12  Backfill self-follow guard (Codex P2 follow-up)
 *        After G11, the self-follow CaseNotification is still in
 *        the DB but no dedup ActionItem was written. Without a
 *        backfill-side skip, scripts/backfill-notification-to-inbox.js
 *        --execute would recreate the inbox noise. Asserts:
 *          - simulateBackfill (execute) sees the row, increments
 *            skipped_self_follow
 *          - ActionItem at the deterministic dedupKey still NOT
 *            created after backfill
 *        Drift fixture targeting a user with isActive=false UC →
 *        backfill skipped_inactive_membership++ and no ActionItem.
 *
 *   G13  Legacy `transfer` CaseNotification → ActionItem (Phase 2C)
 *        Legacy demo-seed eventType='transfer' (with payload
 *        { fromTeam, toTeam, caseNumber } and no `message` field)
 *        is now a supported eventType. Asserts:
 *          - ActionItem created, kind=watcher_event, FYI
 *          - reasonLabel built via buildNotificationReasonLabel
 *            ("Vaka transfer edildi: Destek ekibinden Operasyon ekibine.")
 *          - No raw eventType string leakage into the Turkish copy
 *
 *   G13b Distinct (from,to) transfers must not dedup-collide
 *        Codex P2 follow-up — buildNotificationDedupKey discriminator
 *        must include fromTeam/toTeam or two consecutive transfers on
 *        the same (case, recipient) collapse into one ActionItem and
 *        the second is miscounted as skipped_dedup.
 *
 *   G13c Pre-fix transfer dedup keys are recognized on rerun
 *        Codex P2 follow-up on the dedupKey formula change. If a
 *        tenant ran `--execute` on PR #286 (pre-fromTeam/toTeam
 *        formula), their transfer ActionItems live under the LEGACY
 *        key. The next backfill rerun must find them via
 *        buildLegacyTransferDedupKey (dual-key lookup) and skip them
 *        as already-migrated — never duplicate under the new key.
 *
 *   G14  Legacy `mention` CaseNotification → no ActionItem (Phase 2C)
 *        Canonical path is CaseMention → kind='mention' via
 *        emitMentionsForNote. Legacy demo-seed eventType='mention'
 *        rows must skip with the new counter:
 *          - No ActionItem written for the case+recipient
 *          - report.skipped_legacy_mention_notification >= 1
 *
 *   G15  Truly unknown eventType → still unmapped (Phase 2C)
 *        Forward-compat guarantee: after `mention` and `transfer`
 *        gained their own classification, skipped_unmapped_event_type
 *        stays reserved for genuinely future-unknown eventTypes.
 *
 *   G16  Canonical CaseMention exists → no duplicate (Phase 2C)
 *        Even when a kind='mention' ActionItem already exists for a
 *        case+recipient (canonical path), a parallel legacy
 *        CaseNotification eventType='mention' must NOT produce a
 *        second mention ActionItem. Backfill skip + dedupKey guard.
 *
 * Run: node --env-file=.env scripts/smoke-generic-notification-flow.js
 * Cleanup: all rows removed in finally{}.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import { caseRepository, watcherRepo, reactionRepo } from '../server/db/caseRepository.js';
import {
  buildLegacyTransferDedupKey,
  buildNotificationDedupKey,
  buildNotificationReasonLabel,
  emitGenericNotification,
  listForUser,
} from '../server/db/actionItemRepository.js';

const stamp = Date.now();
const PREFIX = `gnf_${stamp}`;
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function pickCompanyPair() {
  const a = await prisma.company.findFirst({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  if (!a) throw new Error('No active company');
  const b = await prisma.company.findFirst({
    where: { id: { not: a.id }, isActive: true },
    select: { id: true, name: true },
  });
  return { a, b };
}

async function waitForFireAndForget(ms = 1500) {
  await new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log('🔍 generic-notification-flow smoke\n');
  const { a: companyA, b: companyB } = await pickCompanyPair();
  console.log(`Company A: ${companyA.id} (${companyA.name})`);
  if (companyB) console.log(`Company B: ${companyB.id} (${companyB.name})\n`);
  else console.log('Company B: none — G8 tenant scope test skipped\n');

  const created = {
    actionItems: [],
    cases: [],
    notes: [],
    notifications: [],
    persons: [],
    users: [],
    userCompanies: [],
    teams: [],
    watchers: [],
  };

  try {
    // ─── Setup: team, actor, three recipients (watchers), one
    // separate note-author (G3), one supervisor (G4). ───
    const team = await prisma.team.create({
      data: { name: `${PREFIX}-team`, companyId: companyA.id },
    });
    created.teams.push(team.id);

    async function makeUser(label, opts = {}) {
      const person = await prisma.person.create({
        data: {
          name: `${PREFIX}-${label}`,
          teamId: team.id,
          isActive: true,
          email: `${PREFIX}-${label}@smoke.test`,
        },
      });
      created.persons.push(person.id);
      const user = await prisma.user.create({
        data: {
          id: randomUUID(),
          email: `${PREFIX}-${label}-user@smoke.test`,
          fullName: person.name,
          personId: person.id,
          isActive: true,
        },
      });
      created.users.push(user.id);
      if (opts.membership !== false) {
        const uc = await prisma.userCompany.create({
          data: {
            userId: user.id,
            companyId: companyA.id,
            role: opts.role ?? 'Agent',
            isActive: opts.membershipActive !== false,
          },
        });
        created.userCompanies.push(uc.id);
      }
      return { user, person };
    }

    const actor = await makeUser('actor');
    const watcher1 = await makeUser('w1');
    const watcher2 = await makeUser('w2');
    const watcher3 = await makeUser('w3');
    const supervisor = await makeUser('sup', { role: 'Supervisor' });
    const noteAuthor = await makeUser('author');

    async function newCase(label, assignedPerson) {
      const c = await caseRepository.create({
        title: `${PREFIX}-${label}`,
        description: `${label} smoke case`,
        caseType: 'GeneralSupport',
        priority: 'Medium',
        origin: 'Telefon',
        companyId: companyA.id,
        companyName: companyA.name,
        category: 'Yazılım',
        subCategory: 'Genel',
        requestType: 'Talep',
        assignedTeamId: team.id,
        assignedTeamName: team.name,
        assignedPersonId: assignedPerson.id,
        assignedPersonName: assignedPerson.name,
      });
      created.cases.push(c.id);
      return c;
    }

    // ─── G1: watcher_added → live emit ───
    const c1 = await newCase('case-g1', actor.person);
    const watchResult = await watcherRepo.add({
      caseId: c1.id,
      userId: watcher1.user.id,
      addedBy: actor.user.id,
      allowedCompanyIds: [companyA.id],
      actor: actor.user.fullName,
    });
    if (watchResult?.id) created.watchers.push(watchResult.id);
    await waitForFireAndForget();
    const dedup1 = buildNotificationDedupKey({
      caseId: c1.id,
      eventType: 'watcher_added',
      recipientUserId: watcher1.user.id,
      payload: {
        message: `Sizi ${c1.caseNumber} vakasında izleyici olarak eklendi`,
        kind: 'watcher_added',
        addedBy: actor.user.id,
      },
    });
    const ai1 = await prisma.actionItem.findUnique({ where: { dedupKey: dedup1 } });
    if (ai1) created.actionItems.push(ai1.id);
    record(
      'G1. watcher_added → ActionItem (kind=watcher_event, FYI)',
      !!ai1 &&
        ai1.kind === 'watcher_event' &&
        ai1.actionRequired === false &&
        ai1.userId === watcher1.user.id &&
        ai1.reasonLabel?.includes('izleyici olarak eklendi'),
      `kind=${ai1?.kind} actionReq=${ai1?.actionRequired} reason=${ai1?.reasonLabel?.slice(0, 50)}…`,
    );

    // ─── G2: watcher_update (via field change → notifyWatchers) ───
    // Add watcher2 + watcher3 first so the next case update fans out
    // to multiple recipients in G5 (combined with G2).
    const c2 = await newCase('case-g2', actor.person);
    for (const w of [watcher1, watcher2, watcher3]) {
      const r = await watcherRepo.add({
        caseId: c2.id,
        userId: w.user.id,
        addedBy: actor.user.id,
        allowedCompanyIds: [companyA.id],
        actor: actor.user.fullName,
      });
      if (r?.id) created.watchers.push(r.id);
    }
    await waitForFireAndForget();
    // Trigger a watcher_update by updating the case's priority field.
    // caseRepository.update signature: (id, patch, actor, allowedCompanyIds, actorRole)
    await caseRepository.update(
      c2.id,
      { priority: 'High' },
      actor.user.fullName,
      [companyA.id],
    );
    await waitForFireAndForget(2500);
    // Collect ActionItem rows for the three watchers on this case.
    const w2Rows = await prisma.actionItem.findMany({
      where: {
        kind: 'watcher_event',
        caseId: c2.id,
        userId: { in: [watcher1.user.id, watcher2.user.id, watcher3.user.id] },
        generatedBy: { startsWith: 'system:notification:watcher_update' },
      },
    });
    w2Rows.forEach((r) => created.actionItems.push(r.id));
    record(
      'G2. watcher_update → live emit (one ActionItem per watcher)',
      w2Rows.length >= 3 &&
        w2Rows.every((r) => r.kind === 'watcher_event' && r.actionRequired === false),
      `rows=${w2Rows.length}`,
    );

    // ─── G5 (combined): Multi-recipient fan-out checks ───
    const uniqueUsers = new Set(w2Rows.map((r) => r.userId));
    const uniqueDedups = new Set(w2Rows.map((r) => r.dedupKey));
    record(
      'G5. multi-recipient fan-out — N watchers → N rows, distinct userId + dedupKey',
      uniqueUsers.size === w2Rows.length && uniqueDedups.size === w2Rows.length,
      `users=${uniqueUsers.size} dedups=${uniqueDedups.size}`,
    );

    // ─── G3: note_reaction ───
    // noteAuthor writes a note on c2 (note belongs to noteAuthor);
    // watcher1 reacts with 👍 → CaseNotification + ActionItem for
    // noteAuthor.
    const noteG3 = await prisma.caseNote.create({
      data: {
        caseId: c2.id,
        companyId: companyA.id,
        authorName: noteAuthor.user.fullName,
        authorId: noteAuthor.user.id,
        content: 'G3 — react bana lütfen.',
        visibility: 'Internal',
      },
    });
    created.notes.push(noteG3.id);
    // Make sure noteAuthor has UC for this company (done in setup).
    const reactionResult = await reactionRepo.toggle({
      caseId: c2.id,
      noteId: noteG3.id,
      userId: watcher1.user.id,
      emoji: 'thumbs_up',
      allowedCompanyIds: [companyA.id],
    });
    await waitForFireAndForget();
    const dedup3 = buildNotificationDedupKey({
      caseId: c2.id,
      eventType: 'note_reaction',
      recipientUserId: noteAuthor.user.id,
      payload: {
        message: `${watcher1.user.fullName} notunuza 👍 tepkisi verdi`,
        kind: 'reaction',
        emoji: 'thumbs_up',
        noteId: noteG3.id,
      },
    });
    const ai3 = await prisma.actionItem.findUnique({ where: { dedupKey: dedup3 } });
    if (ai3) created.actionItems.push(ai3.id);
    record(
      'G3. note_reaction → ActionItem for note author (kind=watcher_event)',
      !!ai3 &&
        ai3.kind === 'watcher_event' &&
        ai3.userId === noteAuthor.user.id &&
        ai3.reasonLabel?.includes('tepkisi verdi'),
      `aiKind=${ai3?.kind} reactionResult=${reactionResult ? 'ok' : 'fail'}`,
    );

    // ─── G4: transfer_warning ───
    // Direct emit (transferAi fan-out is hard to trigger from a unit
    // smoke without the full transfer chain). Test contract: helper
    // produces a system_alert ActionItem with priority=70 for the
    // supervisor recipient.
    const c4 = await newCase('case-g4', actor.person);
    const transferPayload = {
      message: `⚠️ ${c4.caseNumber} aynı vakada 2. kez aktarıldı`,
      transferCount: 2,
    };
    void emitGenericNotification({
      caseId: c4.id,
      companyId: companyA.id,
      eventType: 'transfer_warning',
      recipientUserId: supervisor.user.id,
      payload: transferPayload,
      caseNumber: c4.caseNumber,
      caseTitle: c4.title,
    });
    await waitForFireAndForget();
    const dedup4 = buildNotificationDedupKey({
      caseId: c4.id,
      eventType: 'transfer_warning',
      recipientUserId: supervisor.user.id,
      payload: transferPayload,
    });
    const ai4 = await prisma.actionItem.findUnique({ where: { dedupKey: dedup4 } });
    if (ai4) created.actionItems.push(ai4.id);
    record(
      'G4. transfer_warning → ActionItem (kind=system_alert, priority=70)',
      !!ai4 &&
        ai4.kind === 'system_alert' &&
        ai4.priority === 70 &&
        ai4.actionRequired === false,
      `kind=${ai4?.kind} priority=${ai4?.priority}`,
    );

    // ─── G8: Tenant scope leak guard ───
    if (companyB) {
      const leak = await prisma.actionItem.create({
        data: {
          kind: 'watcher_event',
          userId: watcher1.user.id,
          companyId: companyB.id,
          actionRequired: false,
          priority: 50,
          reasonLabel: 'tenant-leak-test',
          state: 'Pending',
        },
      });
      created.actionItems.push(leak.id);
      const out = await listForUser({
        userId: watcher1.user.id,
        allowedCompanyIds: [companyA.id],
        view: 'fyi',
      });
      const leaked = out.items.some((i) => i.id === leak.id);
      record(
        'G8. tenant scope leak guard — out-of-scope watcher_event sızmaz',
        !leaked,
        `leaked=${leaked}`,
      );
    } else {
      record('G8. tenant scope leak guard', true, 'skipped — single tenant');
    }

    // ─── G6 + G7: Backfill dry-run + execute idempotency ───
    // Plant two fresh CaseNotification fixtures bypassing the live
    // adapter (direct prisma.caseNotification.create); one unread,
    // one already-read.
    const c6 = await newCase('case-g6', actor.person);
    const cnUnread = await prisma.caseNotification.create({
      data: {
        caseId: c6.id,
        companyId: companyA.id,
        eventType: 'watcher_update',
        channel: 'InApp',
        recipient: watcher2.user.id,
        payload: { message: 'G6 — yeni statü', kind: 'status' },
        sentAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        readAt: null,
      },
    });
    created.notifications.push(cnUnread.id);
    const cnRead = await prisma.caseNotification.create({
      data: {
        caseId: c6.id,
        companyId: companyA.id,
        eventType: 'watcher_added',
        channel: 'InApp',
        recipient: watcher3.user.id,
        payload: { message: 'G6 — eski izleyici eklendi', kind: 'watcher_added' },
        sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        readAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      },
    });
    created.notifications.push(cnRead.id);

    const dedupG6Unread = buildNotificationDedupKey({
      caseId: cnUnread.caseId,
      eventType: cnUnread.eventType,
      recipientUserId: cnUnread.recipient,
      payload: cnUnread.payload,
    });
    const dedupG6Read = buildNotificationDedupKey({
      caseId: cnRead.caseId,
      eventType: cnRead.eventType,
      recipientUserId: cnRead.recipient,
      payload: cnRead.payload,
    });
    const preCountG6 = await prisma.actionItem.count({
      where: { dedupKey: { in: [dedupG6Unread, dedupG6Read] } },
    });

    const dryReport = await simulateBackfill({
      windowDays: 30,
      execute: false,
      restrictCompanyId: companyA.id,
    });
    const postDryG6 = await prisma.actionItem.count({
      where: { dedupKey: { in: [dedupG6Unread, dedupG6Read] } },
    });
    record(
      'G6. backfill dry-run would-create counts (unread→Pending + read→Done)',
      typeof dryReport === 'object' &&
        dryReport.dry_run === true &&
        dryReport.created_pending >= 1 &&
        dryReport.created_done >= 1 &&
        preCountG6 === 0 &&
        postDryG6 === 0,
      `dry.would-create=${dryReport.created_pending}/${dryReport.created_done} preCount=${preCountG6} postDry=${postDryG6}`,
    );

    const exec1 = await simulateBackfill({
      windowDays: 30,
      execute: true,
      restrictCompanyId: companyA.id,
    });
    const exec2 = await simulateBackfill({
      windowDays: 30,
      execute: true,
      restrictCompanyId: companyA.id,
    });
    const aiG6Unread = await prisma.actionItem.findUnique({
      where: { dedupKey: dedupG6Unread },
    });
    const aiG6Read = await prisma.actionItem.findUnique({
      where: { dedupKey: dedupG6Read },
    });
    if (aiG6Unread) created.actionItems.push(aiG6Unread.id);
    if (aiG6Read) created.actionItems.push(aiG6Read.id);
    record(
      'G7. backfill idempotency — first execute materializes; second is no-op',
      exec1.created_pending + exec1.created_done >= 2 &&
        exec2.created_pending === 0 &&
        exec2.created_done === 0 &&
        exec2.skipped_dedup >= 2 &&
        !!aiG6Unread && aiG6Unread.state === 'Pending' &&
        !!aiG6Read && aiG6Read.state === 'Done' &&
        aiG6Read.doneOutcome === 'migrated-read',
      `exec1=${exec1.created_pending}/${exec1.created_done} ` +
        `exec2.dedup=${exec2.skipped_dedup} unread.state=${aiG6Unread?.state} read.state=${aiG6Read?.state}`,
    );

    // ─── G9 + G10: drift fixtures (no UC / inactive UC) ───
    const driftNoUC = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-drift-no-uc@smoke.test`,
        fullName: `${PREFIX}-drift-no-uc`,
        isActive: true,
      },
    });
    created.users.push(driftNoUC.id);

    const driftInactive = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-drift-inactive@smoke.test`,
        fullName: `${PREFIX}-drift-inactive`,
        isActive: true,
      },
    });
    created.users.push(driftInactive.id);
    const driftUC = await prisma.userCompany.create({
      data: {
        userId: driftInactive.id,
        companyId: companyA.id,
        role: 'Agent',
        isActive: false,
      },
    });
    created.userCompanies.push(driftUC.id);

    const c910 = await newCase('case-g910', actor.person);
    const cnDriftNoUC = await prisma.caseNotification.create({
      data: {
        caseId: c910.id,
        companyId: companyA.id,
        eventType: 'watcher_update',
        channel: 'InApp',
        recipient: driftNoUC.id,
        payload: { message: 'G9 — orphan recipient', kind: 'status' },
        sentAt: new Date(),
        readAt: null,
      },
    });
    created.notifications.push(cnDriftNoUC.id);
    const cnDriftInactive = await prisma.caseNotification.create({
      data: {
        caseId: c910.id,
        companyId: companyA.id,
        eventType: 'watcher_update',
        channel: 'InApp',
        recipient: driftInactive.id,
        payload: { message: 'G10 — inactive UC recipient', kind: 'status' },
        sentAt: new Date(),
        readAt: null,
      },
    });
    created.notifications.push(cnDriftInactive.id);

    const driftReport = await simulateBackfill({
      windowDays: 30,
      execute: true,
      restrictCompanyId: companyA.id,
    });
    const dedupG9 = buildNotificationDedupKey({
      caseId: c910.id,
      eventType: 'watcher_update',
      recipientUserId: driftNoUC.id,
      payload: cnDriftNoUC.payload,
    });
    const dedupG10 = buildNotificationDedupKey({
      caseId: c910.id,
      eventType: 'watcher_update',
      recipientUserId: driftInactive.id,
      payload: cnDriftInactive.payload,
    });
    const aiG9 = await prisma.actionItem.findUnique({ where: { dedupKey: dedupG9 } });
    const aiG10 = await prisma.actionItem.findUnique({ where: { dedupKey: dedupG10 } });
    record(
      'G9. no-UserCompany drift — ActionItem YOK; skipped_no_membership artar',
      !aiG9 && driftReport.skipped_no_membership >= 1,
      `aiG9=${!!aiG9} skipped_no_membership=${driftReport.skipped_no_membership}`,
    );
    record(
      'G10. inactive-UserCompany drift — ActionItem YOK; skipped_inactive_membership artar',
      !aiG10 && driftReport.skipped_inactive_membership >= 1,
      `aiG10=${!!aiG10} skipped_inactive_membership=${driftReport.skipped_inactive_membership}`,
    );

    // ─── G11: Codex P2 — watcher self-add suppression ───────────────
    // When userId === addedBy (user follows themselves), the legacy
    // bell still wrote a "Sizi izleyici olarak eklendi" notification
    // and the Aksiyonlarım inbox would have echoed it back — noise.
    // Phase 2C P0 fix: skip the ActionItem emit while preserving:
    //   - CaseWatcher row (self-follow IS allowed)
    //   - CaseActivity "izleyici eklendi" entry
    //   - CaseNotification record (legacy bell behavior unchanged)
    const c11 = await newCase('case-g11-self-follow', actor.person);
    const selfFollowResult = await watcherRepo.add({
      caseId: c11.id,
      userId: actor.user.id,        // self
      addedBy: actor.user.id,       // === userId
      allowedCompanyIds: [companyA.id],
      actor: actor.user.fullName,
    });
    if (selfFollowResult?.id) created.watchers.push(selfFollowResult.id);
    await waitForFireAndForget();

    // Self-follow legacy artifacts MUST still exist.
    const selfWatcherRow = await prisma.caseWatcher.findFirst({
      where: { caseId: c11.id, userId: actor.user.id },
    });
    const selfNotificationRow = await prisma.caseNotification.findFirst({
      where: {
        caseId: c11.id,
        eventType: 'watcher_added',
        recipient: actor.user.id,
      },
    });
    if (selfNotificationRow) created.notifications.push(selfNotificationRow.id);

    // Inbox emit MUST be suppressed for self-add.
    const selfFollowDedup = buildNotificationDedupKey({
      caseId: c11.id,
      eventType: 'watcher_added',
      recipientUserId: actor.user.id,
      payload: {
        message: `Sizi ${c11.caseNumber} vakasında izleyici olarak eklendi`,
        kind: 'watcher_added',
        addedBy: actor.user.id,
      },
    });
    const selfFollowAi = await prisma.actionItem.findUnique({
      where: { dedupKey: selfFollowDedup },
    });

    record(
      'G11. watcher self-add (userId === addedBy) — ActionItem skip; watcher+notification preserved',
      !!selfFollowResult?.id &&
        !!selfWatcherRow &&
        !!selfNotificationRow &&
        !selfFollowAi,
      `watcher=${!!selfWatcherRow} notification=${!!selfNotificationRow} actionItem=${!!selfFollowAi}`,
    );

    // ─── G12: Codex P2 follow-up — backfill must NOT recreate the
    //         self-follow inbox row that the live adapter skipped.
    // The CaseNotification row planted by watcherRepo.add (G11) is
    // still in the DB; without backfill-side suppression a later
    // backfill --execute would create an ActionItem because no
    // dedup row was written. Asserts:
    //   1. backfill --execute runs over the past 30 days including
    //      our self-follow CaseNotification
    //   2. report.skipped_self_follow >= 1
    //   3. ActionItem at the deterministic dedupKey is STILL not
    //      created after backfill
    const selfFollowBackfillReport = await simulateBackfill({
      windowDays: 30,
      execute: true,
      restrictCompanyId: companyA.id,
    });
    const selfFollowAiAfterBackfill = await prisma.actionItem.findUnique({
      where: { dedupKey: selfFollowDedup },
    });
    record(
      'G12. backfill self-follow skip — Codex P2 follow-up; ActionItem still NOT created after --execute',
      selfFollowBackfillReport.skipped_self_follow >= 1 &&
        !selfFollowAiAfterBackfill,
      `skipped_self_follow=${selfFollowBackfillReport.skipped_self_follow} ` +
        `aiAfterBackfill=${!!selfFollowAiAfterBackfill}`,
    );

    // ─── G13: legacy `transfer` CaseNotification → ActionItem ──────
    // Phase 2C cleanup. The full-demo seed writes eventType='transfer'
    // CaseNotification rows with payload { fromTeam, toTeam, caseNumber }
    // and no `message` field. Backfill must:
    //   - Recognize 'transfer' as a supported eventType
    //   - Land it under kind='watcher_event' (FYI, gri "Bildirimler")
    //   - Build a rich Turkish reasonLabel via buildNotificationReasonLabel
    //     ("Vaka transfer edildi: <from> ekibinden <to> ekibine.")
    //
    // Codex P2 follow-up — two distinct transfers on the SAME case+recipient
    // must produce TWO ActionItems. Before the dedup-key fix the legacy
    // payload { fromTeam, toTeam } had no representation in the discriminator
    // so multiple transfers collapsed to one ActionItem and the second was
    // miscounted as skipped_dedup (losing the notification).
    const c13 = await newCase('case-g13-transfer', actor.person);
    const transferPayloadG13a = {
      fromTeam: 'Destek',
      toTeam: 'Operasyon',
      caseNumber: c13.caseNumber,
    };
    const transferPayloadG13b = {
      fromTeam: 'Operasyon',
      toTeam: 'Mali İşler',
      caseNumber: c13.caseNumber,
    };
    const cnG13a = await prisma.caseNotification.create({
      data: {
        caseId: c13.id,
        companyId: companyA.id,
        eventType: 'transfer',
        channel: 'InApp',
        recipient: watcher1.user.id,
        payload: transferPayloadG13a,
        sentAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        readAt: null,
      },
    });
    created.notifications.push(cnG13a.id);
    const cnG13b = await prisma.caseNotification.create({
      data: {
        caseId: c13.id,
        companyId: companyA.id,
        eventType: 'transfer',
        channel: 'InApp',
        recipient: watcher1.user.id,
        payload: transferPayloadG13b,
        sentAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        readAt: null,
      },
    });
    created.notifications.push(cnG13b.id);
    const dedupG13a = buildNotificationDedupKey({
      caseId: c13.id,
      eventType: 'transfer',
      recipientUserId: watcher1.user.id,
      payload: transferPayloadG13a,
    });
    const dedupG13b = buildNotificationDedupKey({
      caseId: c13.id,
      eventType: 'transfer',
      recipientUserId: watcher1.user.id,
      payload: transferPayloadG13b,
    });
    const reportG13 = await simulateBackfill({
      windowDays: 30,
      execute: true,
      restrictCompanyId: companyA.id,
    });
    const aiG13a = await prisma.actionItem.findUnique({ where: { dedupKey: dedupG13a } });
    const aiG13b = await prisma.actionItem.findUnique({ where: { dedupKey: dedupG13b } });
    if (aiG13a) created.actionItems.push(aiG13a.id);
    if (aiG13b) created.actionItems.push(aiG13b.id);
    const expectedReasonG13a = buildNotificationReasonLabel('transfer', transferPayloadG13a);
    const expectedReasonG13b = buildNotificationReasonLabel('transfer', transferPayloadG13b);
    record(
      'G13. legacy transfer CaseNotification → ActionItem (kind=watcher_event, rich Turkish reasonLabel)',
      !!aiG13a &&
        aiG13a.kind === 'watcher_event' &&
        aiG13a.actionRequired === false &&
        aiG13a.userId === watcher1.user.id &&
        aiG13a.reasonLabel === expectedReasonG13a &&
        aiG13a.reasonLabel.includes('Destek') &&
        aiG13a.reasonLabel.includes('Operasyon') &&
        // Guard against raw-eventType leakage fallback (R1): the label
        // must NOT be the generic "transfer bildirimi." or any "<eventType>
        // bildirimi." pattern. The Turkish word "transfer" in "Vaka
        // transfer edildi" is the intended human-readable copy and is OK.
        !aiG13a.reasonLabel.endsWith('bildirimi.'),
      `kind=${aiG13a?.kind} reason="${aiG13a?.reasonLabel}" scanned=${reportG13.scanned}`,
    );

    // ─── G13b: Codex P2 — distinct-pair transfers must not collide ──
    // Same case + same recipient, but different (fromTeam,toTeam). The
    // dedup key discriminator must include fromTeam/toTeam or the second
    // transfer collapses into the first.
    record(
      'G13b. distinct (fromTeam,toTeam) transfers → distinct dedupKey + distinct ActionItems',
      dedupG13a !== dedupG13b &&
        !!aiG13a &&
        !!aiG13b &&
        aiG13a.id !== aiG13b.id &&
        aiG13b.reasonLabel === expectedReasonG13b &&
        aiG13b.reasonLabel.includes('Mali İşler'),
      `dedupDistinct=${dedupG13a !== dedupG13b} aiA=${!!aiG13a} aiB=${!!aiG13b}`,
    );

    // ─── G13c: backfill must not duplicate transfer rows materialized
    //         under the pre-fix dedupKey shape (Codex P2 follow-up). ──
    // Simulate the state of a tenant that ran scripts/backfill-...js
    // --execute on PR #286 (before fromTeam/toTeam were added to the
    // discriminator). Plant a CaseNotification + an ActionItem whose
    // dedupKey matches the LEGACY formula (no team suffix). Then run
    // backfill --execute again. The new lookup must find the legacy
    // row, bump skipped_dedup, and create NO second ActionItem under
    // the new key.
    const c13c = await newCase('case-g13c-legacy-dedup', actor.person);
    const transferPayloadG13c = {
      fromTeam: 'Saha',
      toTeam: 'Müşteri Hizmetleri',
      caseNumber: c13c.caseNumber,
    };
    const cnG13c = await prisma.caseNotification.create({
      data: {
        caseId: c13c.id,
        companyId: companyA.id,
        eventType: 'transfer',
        channel: 'InApp',
        recipient: watcher2.user.id,
        payload: transferPayloadG13c,
        sentAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        readAt: null,
      },
    });
    created.notifications.push(cnG13c.id);
    const legacyKeyG13c = buildLegacyTransferDedupKey({
      caseId: c13c.id,
      recipientUserId: watcher2.user.id,
      payload: transferPayloadG13c,
    });
    const newKeyG13c = buildNotificationDedupKey({
      caseId: c13c.id,
      eventType: 'transfer',
      recipientUserId: watcher2.user.id,
      payload: transferPayloadG13c,
    });
    // Sanity — the two formulae must produce different keys for this
    // payload, otherwise G13c proves nothing.
    if (legacyKeyG13c === newKeyG13c) {
      throw new Error('G13c setup invariant violated: legacy === new key');
    }
    const legacyAiG13c = await prisma.actionItem.create({
      data: {
        kind: 'watcher_event',
        userId: watcher2.user.id,
        companyId: companyA.id,
        objectType: 'CaseNotification',
        objectId: null,
        caseId: c13c.id,
        caseNumber: c13c.caseNumber,
        caseTitle: c13c.title,
        generatedBy: 'system:notification:transfer',
        groupKey: `${c13c.id}:watcher_event`,
        dedupKey: legacyKeyG13c,
        priority: 50,
        actionRequired: false,
        reasonLabel: buildNotificationReasonLabel('transfer', transferPayloadG13c),
        state: 'Pending',
      },
    });
    created.actionItems.push(legacyAiG13c.id);
    const reportG13c = await simulateBackfill({
      windowDays: 30,
      execute: true,
      restrictCompanyId: companyA.id,
    });
    const stillOnlyOne = await prisma.actionItem.findMany({
      where: { caseId: c13c.id, userId: watcher2.user.id },
      select: { id: true, dedupKey: true },
    });
    record(
      'G13c. legacy-key transfer ActionItem → rerun skips dedup, no duplicate under new key',
      stillOnlyOne.length === 1 &&
        stillOnlyOne[0].id === legacyAiG13c.id &&
        stillOnlyOne[0].dedupKey === legacyKeyG13c &&
        reportG13c.skipped_dedup >= 1,
      `count=${stillOnlyOne.length} key=${stillOnlyOne[0]?.dedupKey === legacyKeyG13c ? 'legacy' : 'other'} skipped_dedup=${reportG13c.skipped_dedup}`,
    );

    // ─── G14: legacy `mention` CaseNotification → no ActionItem ────
    // Phase 2C cleanup. The canonical mention path is CaseMention →
    // emitMentionsForNote (kind='mention'). A legacy demo-seed
    // CaseNotification eventType='mention' MUST NOT also produce a
    // duplicate ActionItem; instead the backfill bumps its own counter
    // skipped_legacy_mention_notification so the operator-facing report
    // distinguishes "known-skipped legacy noise" from "truly unknown
    // future eventType".
    const c14 = await newCase('case-g14-legacy-mention', actor.person);
    const mentionPayloadG14 = {
      message: `${actor.user.fullName} sizi G14 notunda andı`,
      noteId: 'g14-fake-note-id',
    };
    const cnG14 = await prisma.caseNotification.create({
      data: {
        caseId: c14.id,
        companyId: companyA.id,
        eventType: 'mention',
        channel: 'InApp',
        recipient: watcher2.user.id,
        payload: mentionPayloadG14,
        sentAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        readAt: null,
      },
    });
    created.notifications.push(cnG14.id);
    const reportG14 = await simulateBackfill({
      windowDays: 30,
      execute: true,
      restrictCompanyId: companyA.id,
    });
    // We can't probe by dedupKey because the simulator never builds
    // one for legacy mention rows (skip happens before the dedup step).
    // Instead, prove the side-effect: no ActionItem references this case
    // for this user.
    const aiG14Any = await prisma.actionItem.findFirst({
      where: { caseId: c14.id, userId: watcher2.user.id },
    });
    record(
      'G14. legacy mention CaseNotification → no ActionItem; skipped_legacy_mention_notification artar',
      !aiG14Any && reportG14.skipped_legacy_mention_notification >= 1,
      `aiAny=${!!aiG14Any} skipped_legacy_mention=${reportG14.skipped_legacy_mention_notification}`,
    );

    // ─── G15: truly unknown eventType still increments unmapped ────
    // Phase 2C cleanup. After classifying `mention` and `transfer`
    // explicitly, the skipped_unmapped_event_type counter must stay
    // reserved for FUTURE unknown eventTypes (forward-compat). Plant a
    // fixture with a deliberately fake eventType to prove the unmapped
    // path still fires and no ActionItem leaks through.
    const c15 = await newCase('case-g15-unknown', actor.person);
    const fakeEventTypeG15 = 'future_unknown_event_g15';
    const cnG15 = await prisma.caseNotification.create({
      data: {
        caseId: c15.id,
        companyId: companyA.id,
        eventType: fakeEventTypeG15,
        channel: 'InApp',
        recipient: watcher3.user.id,
        payload: { message: 'G15 — yarının eventType\'ı', kind: 'future' },
        sentAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        readAt: null,
      },
    });
    created.notifications.push(cnG15.id);
    const reportG15 = await simulateBackfill({
      windowDays: 30,
      execute: true,
      restrictCompanyId: companyA.id,
    });
    const aiG15Any = await prisma.actionItem.findFirst({
      where: { caseId: c15.id, userId: watcher3.user.id },
    });
    record(
      'G15. truly unknown eventType → no ActionItem; skipped_unmapped_event_type artar',
      !aiG15Any && reportG15.skipped_unmapped_event_type >= 1,
      `aiAny=${!!aiG15Any} skipped_unmapped=${reportG15.skipped_unmapped_event_type} ` +
        `skipped_legacy_mention=${reportG15.skipped_legacy_mention_notification}`,
    );

    // ─── G16: canonical mention path intact — no duplicate ─────────
    // Phase 2C cleanup. Even if a CaseMention already exists for a
    // note+recipient (canonical path created via emitMentionsForNote),
    // a parallel legacy CaseNotification eventType='mention' for the
    // same caseId+recipient must not produce a SECOND mention
    // ActionItem. The canonical kind='mention' ActionItem stays alone;
    // backfill's mention-skip + dedupKey mean nothing duplicates.
    const c16 = await newCase('case-g16-canonical', actor.person);
    const noteG16 = await prisma.caseNote.create({
      data: {
        caseId: c16.id,
        companyId: companyA.id,
        authorName: actor.user.fullName,
        authorId: actor.user.id,
        content: `@[${watcher1.user.fullName}](${watcher1.user.id}) G16 canonical mention.`,
        visibility: 'Internal',
      },
    });
    created.notes.push(noteG16.id);
    // Plant the canonical mention ActionItem directly via the production
    // dedupKey shape so we exercise dedup without round-tripping the
    // CaseMention table.
    const canonicalDedupG16 = `mention:${c16.id}:${noteG16.id}:${watcher1.user.id}`;
    const canonicalAiG16 = await prisma.actionItem.create({
      data: {
        kind: 'mention',
        userId: watcher1.user.id,
        companyId: companyA.id,
        objectType: 'CaseMention',
        objectId: null,
        caseId: c16.id,
        caseNumber: c16.caseNumber,
        caseTitle: c16.title,
        generatedBy: `user:${actor.user.id}`,
        groupKey: `${c16.id}:mention`,
        dedupKey: canonicalDedupG16,
        priority: 50,
        actionRequired: false,
        reasonLabel: `@${actor.user.fullName} ${c16.caseNumber} yorumunda seni andı.`,
        state: 'Pending',
      },
    });
    created.actionItems.push(canonicalAiG16.id);
    // Now plant a legacy CaseNotification eventType='mention' for the
    // same case+recipient. Different shape but same logical event.
    const cnG16 = await prisma.caseNotification.create({
      data: {
        caseId: c16.id,
        companyId: companyA.id,
        eventType: 'mention',
        channel: 'InApp',
        recipient: watcher1.user.id,
        payload: {
          message: `${actor.user.fullName} sizi G16 notunda andı`,
          noteId: noteG16.id,
        },
        sentAt: new Date(Date.now() - 1 * 60 * 1000),
        readAt: null,
      },
    });
    created.notifications.push(cnG16.id);
    const reportG16 = await simulateBackfill({
      windowDays: 30,
      execute: true,
      restrictCompanyId: companyA.id,
    });
    const allAiForG16 = await prisma.actionItem.findMany({
      where: { caseId: c16.id, userId: watcher1.user.id },
    });
    const mentionAiForG16 = allAiForG16.filter((a) => a.kind === 'mention');
    record(
      'G16. canonical CaseMention exists → legacy mention CaseNotification yields NO duplicate',
      mentionAiForG16.length === 1 &&
        mentionAiForG16[0].id === canonicalAiG16.id &&
        reportG16.skipped_legacy_mention_notification >= 1,
      `mentionAi=${mentionAiForG16.length} legacy_skip=${reportG16.skipped_legacy_mention_notification}`,
    );
  } catch (err) {
    console.error('smoke fatal:', err);
    results.push({ name: 'fatal', ok: false, detail: err?.message });
  } finally {
    if (created.actionItems.length) {
      await prisma.actionItem.deleteMany({ where: { id: { in: created.actionItems } } }).catch(() => {});
    }
    if (created.notifications.length) {
      await prisma.caseNotification.deleteMany({ where: { id: { in: created.notifications } } }).catch(() => {});
    }
    if (created.watchers.length) {
      await prisma.caseWatcher.deleteMany({ where: { id: { in: created.watchers } } }).catch(() => {});
    }
    if (created.cases.length) {
      await prisma.actionItem.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.caseNotification.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.caseWatcher.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.caseNote.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.caseActivity.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.case.deleteMany({ where: { id: { in: created.cases } } }).catch(() => {});
    }
    if (created.userCompanies.length) {
      await prisma.userCompany.deleteMany({ where: { id: { in: created.userCompanies } } }).catch(() => {});
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

// ─────────────────────────────────────────────────────────────────
// Embedded simulator of scripts/backfill-notification-to-inbox.js so
// the smoke runs in-process. Contract mirrors the production script
// (same dedupKey helper, same R6/R7/R8.b rules, same 6+ counters).
// ─────────────────────────────────────────────────────────────────

const SUPPORTED_EVENT_TYPES = new Set([
  'watcher_added',
  'watcher_update',
  'note_reaction',
  'transfer',          // Phase 2C cleanup — legacy demo seed eventType.
  'transfer_warning',
]);

const EVENT_TO_KIND = {
  watcher_added: 'watcher_event',
  watcher_update: 'watcher_event',
  note_reaction: 'watcher_event',
  transfer: 'watcher_event',
  transfer_warning: 'system_alert',
};

async function simulateBackfill({ windowDays, execute, restrictCompanyId }) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const where = {
    sentAt: { gte: since },
    channel: 'InApp',
    ...(restrictCompanyId ? { companyId: restrictCompanyId } : {}),
  };
  const report = {
    window_days: windowDays,
    scanned: 0,
    created_pending: 0,
    created_done: 0,
    skipped_dedup: 0,
    skipped_unmapped_event_type: 0,
    skipped_no_membership: 0,
    skipped_inactive_membership: 0,
    skipped_self_follow: 0,
    skipped_legacy_mention_notification: 0,
    dry_run: !execute,
  };
  const rows = await prisma.caseNotification.findMany({
    where,
    orderBy: { id: 'asc' },
    select: {
      id: true, caseId: true, companyId: true, eventType: true,
      recipient: true, payload: true, sentAt: true, readAt: true,
    },
  });
  for (const row of rows) {
    report.scanned += 1;
    // Phase 2C cleanup — legacy `eventType='mention'` CaseNotification
    // is owned by the canonical CaseMention adapter. Skip BEFORE the
    // SUPPORTED_EVENT_TYPES guard so it lands in its own counter, not
    // skipped_unmapped_event_type.
    if (row.eventType === 'mention') {
      report.skipped_legacy_mention_notification += 1;
      continue;
    }
    if (!SUPPORTED_EVENT_TYPES.has(row.eventType)) {
      report.skipped_unmapped_event_type += 1;
      continue;
    }
    // Codex P2 follow-up — mirror the production backfill self-follow skip.
    if (
      row.eventType === 'watcher_added' &&
      row.payload?.addedBy &&
      row.payload.addedBy === row.recipient
    ) {
      report.skipped_self_follow += 1;
      continue;
    }
    const uc = await prisma.userCompany.findFirst({
      where: { userId: row.recipient, companyId: row.companyId },
      select: { isActive: true },
    });
    if (!uc) {
      report.skipped_no_membership += 1;
      continue;
    }
    if (uc.isActive === false) {
      report.skipped_inactive_membership += 1;
      continue;
    }
    const dedupKey = buildNotificationDedupKey({
      caseId: row.caseId, eventType: row.eventType,
      recipientUserId: row.recipient, payload: row.payload,
    });
    // Codex P2 follow-up — dual-key idempotency for transfer rows that
    // may have been materialized under the pre-fix discriminator (no
    // fromTeam/toTeam in the hash input).
    const lookupKeys = [dedupKey];
    if (row.eventType === 'transfer') {
      lookupKeys.push(
        buildLegacyTransferDedupKey({
          caseId: row.caseId,
          recipientUserId: row.recipient,
          payload: row.payload,
        }),
      );
    }
    const existing = await prisma.actionItem.findFirst({
      where: { dedupKey: { in: lookupKeys } },
      select: { id: true },
    });
    if (existing) {
      report.skipped_dedup += 1;
      continue;
    }
    const kind = EVENT_TO_KIND[row.eventType];
    const c = await prisma.case.findUnique({
      where: { id: row.caseId },
      select: { caseNumber: true, title: true },
    });
    const reasonLabel = buildNotificationReasonLabel(row.eventType, row.payload);
    const priority = row.eventType === 'transfer_warning' ? 70 : 50;
    // Counter increments BEFORE the prisma.create write guard so dry-run
    // produces a meaningful would-create projection.
    if (row.readAt) {
      report.created_done += 1;
      if (execute) {
        await prisma.actionItem.create({
          data: {
            kind, userId: row.recipient, companyId: row.companyId,
            objectType: 'CaseNotification', objectId: null,
            caseId: row.caseId,
            caseNumber: c?.caseNumber ?? null,
            caseTitle: c?.title ?? null,
            generatedBy: `system:notification:${row.eventType}`,
            groupKey: `${row.caseId}:${kind}`,
            dedupKey,
            priority, actionRequired: false, reasonLabel,
            state: 'Done',
            doneAt: row.readAt, doneByUserId: row.recipient,
            doneOutcome: 'migrated-read', firstSeenAt: row.readAt,
            createdAt: row.sentAt,
          },
        });
      }
    } else {
      report.created_pending += 1;
      if (execute) {
        await prisma.actionItem.create({
          data: {
            kind, userId: row.recipient, companyId: row.companyId,
            objectType: 'CaseNotification', objectId: null,
            caseId: row.caseId,
            caseNumber: c?.caseNumber ?? null,
            caseTitle: c?.title ?? null,
            generatedBy: `system:notification:${row.eventType}`,
            groupKey: `${row.caseId}:${kind}`,
            dedupKey,
            priority, actionRequired: false, reasonLabel,
            state: 'Pending', createdAt: row.createdAt,
          },
        });
      }
    }
  }
  return report;
}

run();
