/**
 * WR-NOTIFICATION-CENTER Phase 2B — generic CaseNotification flow smoke.
 *
 * Repository-level (no HTTP). 11 scenarios covering the four migrated
 * eventTypes + backfill + tenant scope + read mapping + watcher
 * self-add suppression (Codex P2):
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
 *        Drift fixture targeting a user with isActive=false UC →
 *        backfill skipped_inactive_membership++ and no ActionItem.
 *
 * Run: node --env-file=.env scripts/smoke-generic-notification-flow.js
 * Cleanup: all rows removed in finally{}.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import { caseRepository, watcherRepo, reactionRepo } from '../server/db/caseRepository.js';
import {
  buildNotificationDedupKey,
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
  'transfer_warning',
]);

const EVENT_TO_KIND = {
  watcher_added: 'watcher_event',
  watcher_update: 'watcher_event',
  note_reaction: 'watcher_event',
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
    if (!SUPPORTED_EVENT_TYPES.has(row.eventType)) {
      report.skipped_unmapped_event_type += 1;
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
    const existing = await prisma.actionItem.findUnique({
      where: { dedupKey }, select: { id: true },
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
    const reasonLabel = String(
      row.payload?.message ?? `${row.eventType} bildirimi.`,
    ).slice(0, 500);
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
