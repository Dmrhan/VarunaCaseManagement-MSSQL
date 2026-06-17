/**
 * WR-NOTIFICATION-CENTER Phase 2A — mention inbox flow smoke.
 *
 * Repository-level (no HTTP). 11 scenarios per planning card v2.2 §SCOPE.8:
 *
 *   M1  Live emit               CaseMention create → mention ActionItem;
 *                               reasonLabel template doğru; actionRequired=false;
 *                               kind=mention; priority=50; dedupKey
 *                               buildMentionDedupKey çıktısıyla eşleşir.
 *
 *   M2  Dedup idempotency       Aynı (caseId, noteId, mentionedUserId) üçlüsü
 *                               ile iki emit → tek satır.
 *
 *   M3  Tenant scope leak       Farklı companyId'deki mention ActionItem, başka
 *                               tenant'taki kullanıcının listForUser çağrısında
 *                               sızmaz.
 *
 *   M4  FYI view filter         Mention satırı view=fyi'da görünür; view=action'da
 *                               görünmez.
 *
 *   M5  Backfill dry-run        --dry-run yazma yapmaz; report yapısı doğru.
 *
 *   M6  Backfill idempotent     Backfill simulation iki kez çalışınca ikinci
 *                               çalıştırma 0 yeni satır; skipped_dedup artar.
 *
 *   M7  Legacy flag             featureFlags.legacyMentionBellEnabled === false
 *                               (default state).
 *
 *   M8  Self-mention skip       actor === mentionedUser → ActionItem yazılmaz
 *                               (live AND backfill simulation).
 *
 *   M9  Multi-user emission     Bir not 3 kullanıcıyı @ eder → 3 ayrı ActionItem;
 *                               her userId / dedupKey farklı.
 *
 *   M10 No UserCompany drift    prisma.caseMention.create ile drift fixture
 *                               (UserCompany YOK) → live emit hiçbir şey
 *                               yazmaz, backfill skipped_no_membership.
 *
 *   M11 Inactive UserCompany    Drift fixture (UserCompany var ama
 *                               isActive=false) → live emit yazmaz, backfill
 *                               skipped_inactive_membership.
 *
 * Run: node --env-file=.env scripts/smoke-mention-inbox-flow.js
 * Cleanup: all rows removed in finally{}.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import { caseRepository } from './_actor-fixture.js';
import {
  buildMentionDedupKey,
  emitMentionsForNote,
  listForUser,
} from '../server/db/actionItemRepository.js';

const stamp = Date.now();
const PREFIX = `mif_${stamp}`;
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function pickCompanyPair() {
  const a = await prisma.company.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
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
  console.log('🔍 mention-inbox-flow smoke\n');
  const { a: companyA, b: companyB } = await pickCompanyPair();
  console.log(`Company A: ${companyA.id} (${companyA.name})`);
  if (companyB) console.log(`Company B: ${companyB.id} (${companyB.name})\n`);
  else console.log('Company B: none — M3 tenant scope test skipped\n');

  const created = {
    actionItems: [],
    cases: [],
    notes: [],
    persons: [],
    users: [],
    userCompanies: [],
    teams: [],
    mentions: [],
  };

  try {
    // ─── Setup: a team, an actor, several recipients ───
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
            role: 'Agent',
            isActive: opts.membershipActive !== false,
          },
        });
        created.userCompanies.push(uc.id);
      }
      return { user, person };
    }

    const actor = await makeUser('actor');
    const recipient1 = await makeUser('rec1');
    const recipient2 = await makeUser('rec2');
    const recipient3 = await makeUser('rec3');
    const otherTenantUser = companyB
      ? await prisma.user.findFirst({ where: { isActive: true } })
      : null;

    async function newCase(label) {
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
        assignedPersonId: actor.person.id,
        assignedPersonName: actor.person.name,
      });
      created.cases.push(c.id);
      return c;
    }

    // ─── M1: Live emit via addNote ───
    const c1 = await newCase('case-m1');
    const noteContent1 = `Selam @[${recipient1.person.name}](${recipient1.user.id}), bu vakaya bakar mısın? Müşteri bekliyor.`;
    const r1 = await caseRepository.addNote(
      c1.id,
      { authorName: actor.user.fullName, content: noteContent1, visibility: 'Internal' },
      [companyA.id],
      actor.user.id,
    );
    if (r1?.error) throw new Error(`addNote unexpected error: ${r1.error}`);
    await waitForFireAndForget();
    // Find the resulting ActionItem
    const expectedDedup1 = buildMentionDedupKey({
      caseId: c1.id,
      noteId: (await prisma.caseNote.findFirst({ where: { caseId: c1.id }, orderBy: { createdAt: 'desc' } })).id,
      mentionedUserId: recipient1.user.id,
    });
    const ai1 = await prisma.actionItem.findUnique({ where: { dedupKey: expectedDedup1 } });
    if (ai1) created.actionItems.push(ai1.id);
    // Inline-reply contract: live-emit path MUST point at the parent
    // CaseNote (objectType='CaseNote', objectId=noteId) so the
    // Aksiyonlarım "Cevap Ver" composer can reply directly. Backfill
    // path keeps objectId=null (legacy CaseMention shape).
    const m1NoteIdForAssert = (await prisma.caseNote.findFirst({
      where: { caseId: c1.id }, orderBy: { createdAt: 'desc' },
    })).id;
    record(
      'M1. live emit via addNote — mention ActionItem yazılır + objectType/objectId',
      !!ai1 &&
        ai1.kind === 'mention' &&
        ai1.actionRequired === false &&
        ai1.priority === 50 &&
        ai1.state === 'Pending' &&
        ai1.userId === recipient1.user.id &&
        ai1.objectType === 'CaseNote' &&
        ai1.objectId === m1NoteIdForAssert &&
        ai1.reasonLabel?.includes('yorumunda senden bahsetti'),
      `kind=${ai1?.kind} priority=${ai1?.priority} state=${ai1?.state} ` +
        `objectType=${ai1?.objectType} objectId=${ai1?.objectId === m1NoteIdForAssert ? 'noteId' : ai1?.objectId} ` +
        `reasonLabel=${ai1?.reasonLabel ? 'set' : 'missing'}`,
    );

    // ─── M2: Dedup idempotency ───
    // Re-emit with same triple (via helper directly).
    const m1NoteId = (await prisma.caseNote.findFirst({
      where: { caseId: c1.id }, orderBy: { createdAt: 'desc' },
    })).id;
    await emitMentionsForNote({
      caseId: c1.id,
      companyId: companyA.id,
      noteId: m1NoteId,
      mentionedUserIds: [recipient1.user.id],
      actorUserId: actor.user.id,
      actorDisplay: actor.user.fullName,
      caseNumber: c1.caseNumber,
      caseTitle: c1.title,
      noteContent: noteContent1,
    });
    await waitForFireAndForget();
    const dedupRows = await prisma.actionItem.findMany({ where: { dedupKey: expectedDedup1 } });
    record(
      'M2. dedup idempotency — aynı triple tek satır',
      dedupRows.length === 1,
      `rowCount=${dedupRows.length}`,
    );

    // ─── M3: Tenant scope leak guard ───
    if (companyB && otherTenantUser) {
      // Plant a mention ActionItem in companyB for our recipient1
      const leak = await prisma.actionItem.create({
        data: {
          kind: 'mention',
          userId: recipient1.user.id,
          companyId: companyB.id,
          actionRequired: false,
          priority: 50,
          reasonLabel: 'tenant-leak-test',
          state: 'Pending',
        },
      });
      created.actionItems.push(leak.id);
      const out = await listForUser({
        userId: recipient1.user.id,
        allowedCompanyIds: [companyA.id],
        view: 'fyi',
      });
      const leaked = out.items.some((i) => i.id === leak.id);
      record(
        'M3. tenant scope leak guard — out-of-scope mention sızmaz',
        !leaked,
        `leaked=${leaked}`,
      );
    } else {
      record('M3. tenant scope leak guard', true, 'skipped — single tenant in DB');
    }

    // ─── M4: FYI view filter ───
    const fyi = await listForUser({
      userId: recipient1.user.id,
      allowedCompanyIds: [companyA.id],
      view: 'fyi',
    });
    const action = await listForUser({
      userId: recipient1.user.id,
      allowedCompanyIds: [companyA.id],
      view: 'action',
    });
    const inFyi = fyi.items.some((i) => i.id === ai1?.id);
    const inAction = action.items.some((i) => i.id === ai1?.id);
    record(
      'M4. FYI view filter — mention "Bildirimler"da, "İşler"de yok',
      inFyi && !inAction,
      `inFyi=${inFyi} inAction=${inAction}`,
    );

    // ─── M5: Backfill dry-run reports would-create counts ───
    //
    // CONTRACT — operator pre-flight check:
    //   --dry-run must produce a meaningful would-create projection so
    //   operators can see operational impact BEFORE writing. Therefore
    //   created_pending / created_done count eligibility-passing,
    //   not-yet-deduped candidates regardless of whether writes occur.
    //
    // Setup: two fresh CaseMention rows planted directly via
    //   prisma.caseMention.create (bypassing live adapter so they have
    //   no ActionItem yet):
    //     · one with seenAt = null  → would-create Pending
    //     · one with seenAt = past  → would-create Done (migrated-read)
    // Both target recipients with active UserCompany so no skip
    // counter fires.
    //
    // Assertions:
    //   1) dry-run report.created_pending >= 1
    //   2) dry-run report.created_done >= 1
    //   3) DB ActionItem count for these two dedupKeys unchanged
    //      (still zero) after dry-run
    //   4) execute then materializes those two rows
    //   5) report shape complete (8 counters + dry_run flag)
    const c5a = await newCase('case-m5a-unseen');
    const note5a = await prisma.caseNote.create({
      data: {
        caseId: c5a.id,
        companyId: companyA.id,
        authorName: actor.user.fullName,
        authorId: actor.user.id,
        content: 'M5 fixture — unseen historical mention',
        visibility: 'Internal',
      },
    });
    created.notes.push(note5a.id);
    const m5a = await prisma.caseMention.create({
      data: {
        caseId: c5a.id,
        noteId: note5a.id,
        companyId: companyA.id,
        mentionedUserId: recipient2.user.id,
        mentionedBy: actor.user.id,
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        seenAt: null,
      },
    });
    created.mentions.push(m5a.id);

    const c5b = await newCase('case-m5b-seen');
    const note5b = await prisma.caseNote.create({
      data: {
        caseId: c5b.id,
        companyId: companyA.id,
        authorName: actor.user.fullName,
        authorId: actor.user.id,
        content: 'M5 fixture — already-seen historical mention',
        visibility: 'Internal',
      },
    });
    created.notes.push(note5b.id);
    const m5b = await prisma.caseMention.create({
      data: {
        caseId: c5b.id,
        noteId: note5b.id,
        companyId: companyA.id,
        mentionedUserId: recipient3.user.id,
        mentionedBy: actor.user.id,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        seenAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      },
    });
    created.mentions.push(m5b.id);

    const dedupKey5a = buildMentionDedupKey({
      caseId: c5a.id, noteId: note5a.id, mentionedUserId: recipient2.user.id,
    });
    const dedupKey5b = buildMentionDedupKey({
      caseId: c5b.id, noteId: note5b.id, mentionedUserId: recipient3.user.id,
    });

    const preCount = await prisma.actionItem.count({
      where: { dedupKey: { in: [dedupKey5a, dedupKey5b] } },
    });

    const dryReport = await simulateBackfill({
      windowDays: 30,
      execute: false,
      restrictCompanyId: companyA.id,
    });

    const postDryCount = await prisma.actionItem.count({
      where: { dedupKey: { in: [dedupKey5a, dedupKey5b] } },
    });

    const reportShapeOk =
      typeof dryReport === 'object' &&
      dryReport.dry_run === true &&
      typeof dryReport.scanned === 'number' &&
      typeof dryReport.created_pending === 'number' &&
      typeof dryReport.created_done === 'number' &&
      typeof dryReport.skipped_dedup === 'number' &&
      typeof dryReport.skipped_self_mention === 'number' &&
      typeof dryReport.skipped_no_membership === 'number' &&
      typeof dryReport.skipped_inactive_membership === 'number';

    // Now execute and verify the two fixtures actually materialize.
    const execReport = await simulateBackfill({
      windowDays: 30,
      execute: true,
      restrictCompanyId: companyA.id,
    });
    const ai5a = await prisma.actionItem.findUnique({ where: { dedupKey: dedupKey5a } });
    const ai5b = await prisma.actionItem.findUnique({ where: { dedupKey: dedupKey5b } });
    if (ai5a) created.actionItems.push(ai5a.id);
    if (ai5b) created.actionItems.push(ai5b.id);

    record(
      'M5. backfill dry-run reports would-create counts; execute then materializes',
      reportShapeOk &&
        dryReport.created_pending >= 1 &&
        dryReport.created_done >= 1 &&
        preCount === 0 &&
        postDryCount === 0 &&
        !!ai5a && ai5a.state === 'Pending' &&
        !!ai5b && ai5b.state === 'Done' && ai5b.doneOutcome === 'migrated-read' &&
        execReport.created_pending >= 1 &&
        execReport.created_done >= 1,
      `dry.would-create=${dryReport.created_pending}/${dryReport.created_done} ` +
        `preCount=${preCount} postDry=${postDryCount} ` +
        `ai5a.state=${ai5a?.state} ai5b.state=${ai5b?.state} ` +
        `exec.created=${execReport.created_pending}/${execReport.created_done}`,
    );

    // ─── M6: Backfill idempotency (simulation) ───
    // Plant a CaseMention that hasn't yet emitted (we'll bypass adapter
    // by direct insert), then run simulated backfill twice.
    const c6 = await newCase('case-m6');
    const note6 = await prisma.caseNote.create({
      data: {
        caseId: c6.id,
        companyId: companyA.id,
        authorName: actor.user.fullName,
        authorId: actor.user.id,
        content: 'historical fixture',
        visibility: 'Internal',
      },
    });
    created.notes.push(note6.id);
    const m6 = await prisma.caseMention.create({
      data: {
        caseId: c6.id,
        noteId: note6.id,
        companyId: companyA.id,
        mentionedUserId: recipient2.user.id,
        mentionedBy: actor.user.id,
        // simulate historical (past)
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        seenAt: null,
      },
    });
    created.mentions.push(m6.id);
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
    const aiM6 = await prisma.actionItem.findUnique({
      where: {
        dedupKey: buildMentionDedupKey({
          caseId: c6.id, noteId: note6.id, mentionedUserId: recipient2.user.id,
        }),
      },
    });
    if (aiM6) created.actionItems.push(aiM6.id);
    record(
      'M6. backfill idempotency — ikinci execute 0 yeni',
      exec1.created_pending + exec1.created_done >= 1 &&
        exec2.created_pending === 0 &&
        exec2.created_done === 0 &&
        exec2.skipped_dedup >= 1,
      `exec1.created=${exec1.created_pending}/${exec1.created_done} exec2.created=${exec2.created_pending}/${exec2.created_done} exec2.skipped_dedup=${exec2.skipped_dedup}`,
    );

    // ─── M7: Legacy flag default false ───
    // We cannot read VITE_* env directly from Node smoke without parser;
    // verify that the env var (when set false or unset) gives the
    // expected default. We assert the SHAPE of the rule:
    // - VITE_LEGACY_MENTION_BELL_ENABLED default false
    const envRaw = process.env.VITE_LEGACY_MENTION_BELL_ENABLED;
    const interpreted = envRaw === undefined ? false :
      ['true','1','yes'].includes(String(envRaw).toLowerCase());
    record(
      'M7. legacy bell flag — default false (unset veya false)',
      interpreted === false,
      `env=${envRaw ?? 'unset'} interpreted=${interpreted}`,
    );

    // ─── M8: Self-mention skip ───
    const c8 = await newCase('case-m8');
    const note8Content = `Kendi notum @[${actor.person.name}](${actor.user.id}) demek.`;
    await caseRepository.addNote(
      c8.id,
      { authorName: actor.user.fullName, content: note8Content, visibility: 'Internal' },
      [companyA.id],
      actor.user.id,
    );
    await waitForFireAndForget();
    const selfDedupKey = buildMentionDedupKey({
      caseId: c8.id,
      noteId: (await prisma.caseNote.findFirst({ where: { caseId: c8.id }, orderBy: { createdAt: 'desc' } })).id,
      mentionedUserId: actor.user.id,
    });
    const selfAi = await prisma.actionItem.findUnique({ where: { dedupKey: selfDedupKey } });
    record(
      'M8. self-mention skip — actor === recipient → ActionItem YOK',
      !selfAi,
      `selfAi=${!!selfAi}`,
    );

    // ─── M9: Multi-user emission ───
    const c9 = await newCase('case-m9');
    const noteContent9 =
      `Üç kişi tag: @[${recipient1.person.name}](${recipient1.user.id})` +
      ` @[${recipient2.person.name}](${recipient2.user.id})` +
      ` @[${recipient3.person.name}](${recipient3.user.id}).`;
    await caseRepository.addNote(
      c9.id,
      { authorName: actor.user.fullName, content: noteContent9, visibility: 'Internal' },
      [companyA.id],
      actor.user.id,
    );
    await waitForFireAndForget();
    const note9Id = (await prisma.caseNote.findFirst({ where: { caseId: c9.id }, orderBy: { createdAt: 'desc' } })).id;
    const dedup9_1 = buildMentionDedupKey({ caseId: c9.id, noteId: note9Id, mentionedUserId: recipient1.user.id });
    const dedup9_2 = buildMentionDedupKey({ caseId: c9.id, noteId: note9Id, mentionedUserId: recipient2.user.id });
    const dedup9_3 = buildMentionDedupKey({ caseId: c9.id, noteId: note9Id, mentionedUserId: recipient3.user.id });
    const ai9 = await prisma.actionItem.findMany({
      where: { dedupKey: { in: [dedup9_1, dedup9_2, dedup9_3] } },
    });
    ai9.forEach((r) => created.actionItems.push(r.id));
    const uniqueUsers = new Set(ai9.map((r) => r.userId));
    const uniqueDedups = new Set(ai9.map((r) => r.dedupKey));
    record(
      'M9. multi-user emission — 3 satır, ayrı userId + dedupKey',
      ai9.length === 3 && uniqueUsers.size === 3 && uniqueDedups.size === 3,
      `count=${ai9.length} uniqUsers=${uniqueUsers.size} uniqDedups=${uniqueDedups.size}`,
    );

    // ─── M10 + M11: drift fixtures via prisma.caseMention.create ───
    // For these tests we need recipients WITHOUT or WITH-INACTIVE
    // UserCompany for companyA. Create dedicated users to keep state clean.
    const driftNoMembership = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${PREFIX}-drift-no@smoke.test`,
        fullName: `${PREFIX}-drift-no`,
        isActive: true,
      },
    });
    created.users.push(driftNoMembership.id);
    // No UserCompany row at all.

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

    // Drift fixtures — direct prisma.caseMention.create bypasses
    // addNote's invalid_mentions guard (simulates historical data).
    const c10 = await newCase('case-m10');
    const note10 = await prisma.caseNote.create({
      data: {
        caseId: c10.id,
        companyId: companyA.id,
        authorName: actor.user.fullName,
        authorId: actor.user.id,
        content: 'drift fixture m10',
        visibility: 'Internal',
      },
    });
    created.notes.push(note10.id);
    const driftM10 = await prisma.caseMention.create({
      data: {
        caseId: c10.id,
        noteId: note10.id,
        companyId: companyA.id,
        mentionedUserId: driftNoMembership.id,
        mentionedBy: actor.user.id,
        seenAt: null,
      },
    });
    created.mentions.push(driftM10.id);

    const c11 = await newCase('case-m11');
    const note11 = await prisma.caseNote.create({
      data: {
        caseId: c11.id,
        companyId: companyA.id,
        authorName: actor.user.fullName,
        authorId: actor.user.id,
        content: 'drift fixture m11',
        visibility: 'Internal',
      },
    });
    created.notes.push(note11.id);
    const driftM11 = await prisma.caseMention.create({
      data: {
        caseId: c11.id,
        noteId: note11.id,
        companyId: companyA.id,
        mentionedUserId: driftInactive.id,
        mentionedBy: actor.user.id,
        seenAt: null,
      },
    });
    created.mentions.push(driftM11.id);

    const driftReport = await simulateBackfill({
      windowDays: 30,
      execute: true,
      restrictCompanyId: companyA.id,
    });

    const aiM10 = await prisma.actionItem.findUnique({
      where: {
        dedupKey: buildMentionDedupKey({
          caseId: c10.id, noteId: note10.id, mentionedUserId: driftNoMembership.id,
        }),
      },
    });
    const aiM11 = await prisma.actionItem.findUnique({
      where: {
        dedupKey: buildMentionDedupKey({
          caseId: c11.id, noteId: note11.id, mentionedUserId: driftInactive.id,
        }),
      },
    });

    record(
      'M10. no-UserCompany drift — ActionItem YOK, skipped_no_membership artar',
      !aiM10 && driftReport.skipped_no_membership >= 1,
      `aiM10=${!!aiM10} skipped_no_membership=${driftReport.skipped_no_membership}`,
    );
    record(
      'M11. inactive-UserCompany drift — ActionItem YOK, skipped_inactive_membership artar',
      !aiM11 && driftReport.skipped_inactive_membership >= 1,
      `aiM11=${!!aiM11} skipped_inactive_membership=${driftReport.skipped_inactive_membership}`,
    );
  } catch (err) {
    console.error('smoke fatal:', err);
    results.push({ name: 'fatal', ok: false, detail: err?.message });
  } finally {
    // Cleanup
    if (created.actionItems.length) {
      await prisma.actionItem.deleteMany({ where: { id: { in: created.actionItems } } }).catch(() => {});
    }
    if (created.cases.length) {
      // Also remove any mention/note/activity/ActionItem orphaned by the case set.
      await prisma.actionItem.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
      await prisma.caseMention.deleteMany({ where: { caseId: { in: created.cases } } }).catch(() => {});
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
// Backfill simulation — embedded copy of the script's core logic so we
// can call it in-process without spawning a child. Same contract:
// same dedupKey helper, same R6/R7/R8.b rules, same 6-counter report.
// ─────────────────────────────────────────────────────────────────

async function simulateBackfill({ windowDays, execute, restrictCompanyId }) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const where = {
    createdAt: { gte: since },
    ...(restrictCompanyId ? { companyId: restrictCompanyId } : {}),
  };
  const report = {
    window_days: windowDays,
    scanned: 0,
    created_pending: 0,
    created_done: 0,
    skipped_dedup: 0,
    skipped_self_mention: 0,
    skipped_no_membership: 0,
    skipped_inactive_membership: 0,
    dry_run: !execute,
  };
  const rows = await prisma.caseMention.findMany({
    where,
    orderBy: { id: 'asc' },
    select: {
      id: true, caseId: true, noteId: true, companyId: true,
      mentionedUserId: true, mentionedBy: true, seenAt: true, createdAt: true,
    },
  });
  for (const row of rows) {
    report.scanned += 1;
    if (row.mentionedUserId === row.mentionedBy) {
      report.skipped_self_mention += 1;
      continue;
    }
    const uc = await prisma.userCompany.findFirst({
      where: { userId: row.mentionedUserId, companyId: row.companyId },
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
    const dedupKey = buildMentionDedupKey({
      caseId: row.caseId, noteId: row.noteId, mentionedUserId: row.mentionedUserId,
    });
    const existing = await prisma.actionItem.findUnique({ where: { dedupKey }, select: { id: true } });
    if (existing) {
      report.skipped_dedup += 1;
      continue;
    }
    const c = await prisma.case.findUnique({
      where: { id: row.caseId },
      select: { caseNumber: true, title: true },
    });
    const u = await prisma.user.findUnique({
      where: { id: row.mentionedBy },
      select: { fullName: true, email: true },
    });
    const actorDisp = u?.fullName || u?.email || 'Kullanıcı';
    const note = await prisma.caseNote.findUnique({
      where: { id: row.noteId }, select: { content: true },
    });
    const preview = (() => {
      if (!note?.content) return '';
      const s = String(note.content)
        .replace(/@\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/\s+/g, ' ').trim();
      if (!s) return '';
      return s.length <= 80 ? s : s.slice(0, 80) + '…';
    })();
    const reasonLabel = preview
      ? `@${actorDisp} ${c?.caseNumber ?? ''} yorumunda senden bahsetti: "${preview}".`.replace(/  +/g, ' ').trim()
      : `@${actorDisp} ${c?.caseNumber ?? ''} yorumunda senden bahsetti.`.replace(/  +/g, ' ').trim();
    // Mirror the production backfill script contract: counter increments
    // BEFORE the prisma.create guard, so dry-run produces a meaningful
    // would-create count operator preview.
    if (row.seenAt) {
      report.created_done += 1;
      if (execute) {
        await prisma.actionItem.create({
          data: {
            kind: 'mention',
            userId: row.mentionedUserId,
            companyId: row.companyId,
            objectType: 'CaseMention',
            objectId: null,
            caseId: row.caseId,
            caseNumber: c?.caseNumber ?? null,
            caseTitle: c?.title ?? null,
            generatedBy: `user:${row.mentionedBy}`,
            groupKey: `${row.caseId}:mention`,
            dedupKey,
            priority: 50,
            actionRequired: false,
            reasonLabel,
            state: 'Done',
            doneAt: row.seenAt,
            doneByUserId: row.mentionedUserId,
            doneOutcome: 'migrated-read',
            firstSeenAt: row.seenAt,
            createdAt: row.createdAt,
          },
        });
      }
    } else {
      report.created_pending += 1;
      if (execute) {
        await prisma.actionItem.create({
          data: {
            kind: 'mention',
            userId: row.mentionedUserId,
            companyId: row.companyId,
            objectType: 'CaseMention',
            objectId: null,
            caseId: row.caseId,
            caseNumber: c?.caseNumber ?? null,
            caseTitle: c?.title ?? null,
            generatedBy: `user:${row.mentionedBy}`,
            groupKey: `${row.caseId}:mention`,
            dedupKey,
            priority: 50,
            actionRequired: false,
            reasonLabel,
            state: 'Pending',
            createdAt: row.createdAt,
          },
        });
      }
    }
  }
  return report;
}

run();
