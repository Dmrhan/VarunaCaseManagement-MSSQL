/**
 * Case Note Safety smoke — duplicate guard + own-note delete.
 *
 * Repository-level (no HTTP). Covers note safety task §F.
 *
 * N1  Top-level note double-submit guard
 *       Two rapid identical addNote calls (same user/case/content/visibility)
 *       within 5s collapse to ONE row. Second call returns the same note.
 *
 * N2  Reply double-submit guard
 *       Same guard on addReply (per-parent thread).
 *
 * N3  Error preserves draft (composer-level — frontend; documented here
 *       as a contract test: backend may return null on access failure;
 *       composer keeps draft. We assert the backend null contract.)
 *
 * N4  Author deletes own top-level note (childless)
 *       Note disappears from list; CaseActivity gains "Not silindi";
 *       reactions cascade away.
 *
 * N5  Author deletes own reply
 *       Reply disappears; parent.replyCount decrements; thread integrity
 *       (other replies still present) preserved.
 *
 * N6  Delete another user's note forbidden
 *       User B cannot delete User A's note → { error: 'forbidden' };
 *       row remains.
 *
 * N7  Cross-tenant delete forbidden
 *       Wrong scope → CaseAccessError; row remains.
 *
 * N8  Parent-with-replies delete blocked (no soft-delete migration)
 *       Author tries to delete own top-level note that has 1 reply →
 *       { error: 'has_replies' }. Note + reply both remain intact;
 *       no orphan top-level notes created.
 *
 * Run: node --env-file=.env scripts/smoke-case-note-safety.js
 * Cleanup: all rows removed in finally{}.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db/client.js';
import { caseRepository, CaseAccessError } from './_actor-fixture.js';

const stamp = Date.now();
const PREFIX = `cns_${stamp}`;
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

async function run() {
  console.log('🔍 case-note-safety smoke\n');
  const { a: companyA, b: companyB } = await pickCompanyPair();
  console.log(`Company A: ${companyA.id} (${companyA.name})`);
  if (companyB) console.log(`Company B: ${companyB.id} (${companyB.name})\n`);
  else console.log('Company B: none — N7 cross-tenant test skipped\n');

  const created = {
    cases: [],
    notes: [],
    persons: [],
    users: [],
    userCompanies: [],
    teams: [],
  };

  try {
    const team = await prisma.team.create({
      data: { name: `${PREFIX}-team`, companyId: companyA.id },
    });
    created.teams.push(team.id);

    async function makeUser(label) {
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
      const uc = await prisma.userCompany.create({
        data: {
          userId: user.id,
          companyId: companyA.id,
          role: 'Agent',
          isActive: true,
        },
      });
      created.userCompanies.push(uc.id);
      return { user, person };
    }

    const userA = await makeUser('userA');
    const userB = await makeUser('userB');

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
        assignedPersonId: userA.person.id,
        assignedPersonName: userA.person.name,
      });
      created.cases.push(c.id);
      return c;
    }

    // ─── N1: Top-level note double-submit guard ───
    const c1 = await newCase('case-n1');
    const noteContent = 'N1 idempotent içerik — aynı saniyede iki kez gönderildi';
    const [r1a, r1b] = await Promise.all([
      caseRepository.addNote(
        c1.id,
        { authorName: userA.user.fullName, content: noteContent, visibility: 'Internal' },
        [companyA.id],
        userA.user.id,
      ),
      caseRepository.addNote(
        c1.id,
        { authorName: userA.user.fullName, content: noteContent, visibility: 'Internal' },
        [companyA.id],
        userA.user.id,
      ),
    ]);
    const c1Notes = await prisma.caseNote.count({
      where: { caseId: c1.id, parentNoteId: null, content: noteContent },
    });
    if (r1a?.id) created.notes.push(r1a.id);
    if (r1b?.id && r1b.id !== r1a?.id) created.notes.push(r1b.id);
    record(
      'N1. top-level note double-submit — only ONE row persisted; both calls return same id',
      c1Notes === 1 && !!r1a?.id && r1b?.id === r1a?.id,
      `count=${c1Notes} sameId=${r1a?.id === r1b?.id} r1a=${r1a?.id?.slice(-8)} r1b=${r1b?.id?.slice(-8)}`,
    );

    // ─── N2: Reply double-submit guard ───
    const c2 = await newCase('case-n2');
    const parent2 = await caseRepository.addNote(
      c2.id,
      { authorName: userA.user.fullName, content: 'N2 parent', visibility: 'Internal' },
      [companyA.id],
      userA.user.id,
    );
    created.notes.push(parent2.id);
    const replyContent = 'N2 reply içerik';
    const [rep2a, rep2b] = await Promise.all([
      caseRepository.addReply(
        c2.id,
        parent2.id,
        { authorName: userA.user.fullName, content: replyContent, visibility: 'Internal' },
        [companyA.id],
        userA.user.id,
      ),
      caseRepository.addReply(
        c2.id,
        parent2.id,
        { authorName: userA.user.fullName, content: replyContent, visibility: 'Internal' },
        [companyA.id],
        userA.user.id,
      ),
    ]);
    if (rep2a?.id) created.notes.push(rep2a.id);
    if (rep2b?.id && rep2b.id !== rep2a?.id) created.notes.push(rep2b.id);
    const c2Replies = await prisma.caseNote.count({
      where: { caseId: c2.id, parentNoteId: parent2.id, content: replyContent },
    });
    const parent2After = await prisma.caseNote.findUnique({
      where: { id: parent2.id },
      select: { replyCount: true },
    });
    record(
      'N2. reply double-submit — only ONE reply row; parent.replyCount NOT double-incremented',
      c2Replies === 1 &&
        rep2a?.id === rep2b?.id &&
        parent2After.replyCount === 1,
      `replies=${c2Replies} sameId=${rep2a?.id === rep2b?.id} parentReplyCount=${parent2After.replyCount}`,
    );

    // ─── N3: Backend null contract for failed create (frontend composer
    //       relies on undefined/null result to surface inline error and
    //       keep the draft). Verified by triggering a cross-tenant call
    //       (throws CaseAccessError → route handler returns 403 → frontend
    //       apiFetch returns undefined → composer keeps draft).
    if (companyB) {
      let threw = false;
      try {
        await caseRepository.addNote(
          c1.id,
          { authorName: userA.user.fullName, content: 'N3', visibility: 'Internal' },
          [companyB.id], // wrong scope
          userA.user.id,
        );
      } catch (err) {
        threw = err?.code === 'CASE_FORBIDDEN';
      }
      record(
        'N3. backend contract — failed addNote throws (composer surface = undefined → draft preserved)',
        threw,
        `threw=${threw}`,
      );
    } else {
      record('N3. backend contract', true, 'skipped — single tenant; manual verify');
    }

    // ─── N4: Author deletes own top-level note (childless) ───
    const c4 = await newCase('case-n4');
    const n4 = await caseRepository.addNote(
      c4.id,
      { authorName: userA.user.fullName, content: 'N4 silinecek not', visibility: 'Internal' },
      [companyA.id],
      userA.user.id,
    );
    created.notes.push(n4.id);
    const n4DelResult = await caseRepository.deleteNote(
      c4.id,
      n4.id,
      [companyA.id],
      userA.user.id,
    );
    const n4After = await prisma.caseNote.findUnique({ where: { id: n4.id } });
    const n4Activity = await prisma.caseActivity.findFirst({
      where: { caseId: c4.id, action: 'Not silindi' },
    });
    record(
      'N4. delete own top-level note (childless) — row gone, activity logged',
      n4DelResult?.success === true && !n4After && !!n4Activity,
      `success=${n4DelResult?.success} rowGone=${!n4After} activity=${!!n4Activity}`,
    );

    // ─── N5: Author deletes own reply ───
    const c5 = await newCase('case-n5');
    const parent5 = await caseRepository.addNote(
      c5.id,
      { authorName: userA.user.fullName, content: 'N5 parent', visibility: 'Internal' },
      [companyA.id],
      userA.user.id,
    );
    created.notes.push(parent5.id);
    // Two replies: one to delete, one to ensure thread integrity.
    const r5a = await caseRepository.addReply(
      c5.id,
      parent5.id,
      { authorName: userA.user.fullName, content: 'N5 reply A (delete)', visibility: 'Internal' },
      [companyA.id],
      userA.user.id,
    );
    const r5b = await caseRepository.addReply(
      c5.id,
      parent5.id,
      { authorName: userA.user.fullName, content: 'N5 reply B (kalsın)', visibility: 'Internal' },
      [companyA.id],
      userA.user.id,
    );
    created.notes.push(r5a.id, r5b.id);
    const parentBefore = await prisma.caseNote.findUnique({
      where: { id: parent5.id },
      select: { replyCount: true },
    });
    const r5DelResult = await caseRepository.deleteNote(
      c5.id,
      r5a.id,
      [companyA.id],
      userA.user.id,
    );
    const r5aAfter = await prisma.caseNote.findUnique({ where: { id: r5a.id } });
    const r5bAfter = await prisma.caseNote.findUnique({ where: { id: r5b.id } });
    const parentAfter = await prisma.caseNote.findUnique({
      where: { id: parent5.id },
      select: { replyCount: true },
    });
    record(
      'N5. delete own reply — reply gone, sibling reply intact, parent.replyCount decremented',
      r5DelResult?.success === true &&
        !r5aAfter &&
        !!r5bAfter &&
        parentBefore.replyCount === 2 &&
        parentAfter.replyCount === 1,
      `success=${r5DelResult?.success} rAGone=${!r5aAfter} rBKept=${!!r5bAfter} ` +
        `parentReplyCount=${parentBefore.replyCount}→${parentAfter.replyCount}`,
    );

    // ─── N6: Delete another user's note forbidden ───
    const c6 = await newCase('case-n6');
    const n6 = await caseRepository.addNote(
      c6.id,
      { authorName: userA.user.fullName, content: 'N6 userA notu', visibility: 'Internal' },
      [companyA.id],
      userA.user.id,
    );
    created.notes.push(n6.id);
    const n6DelResult = await caseRepository.deleteNote(
      c6.id,
      n6.id,
      [companyA.id],
      userB.user.id, // farklı kullanıcı
    );
    const n6After = await prisma.caseNote.findUnique({ where: { id: n6.id } });
    record(
      'N6. delete other user note — { error: forbidden }; row remains',
      n6DelResult?.error === 'forbidden' && !!n6After,
      `error=${n6DelResult?.error} rowKept=${!!n6After}`,
    );

    // ─── N7: Cross-tenant delete forbidden ───
    if (companyB) {
      const c7 = await newCase('case-n7');
      const n7 = await caseRepository.addNote(
        c7.id,
        { authorName: userA.user.fullName, content: 'N7 not', visibility: 'Internal' },
        [companyA.id],
        userA.user.id,
      );
      created.notes.push(n7.id);
      let threw7 = false;
      try {
        await caseRepository.deleteNote(
          c7.id,
          n7.id,
          [companyB.id], // wrong scope
          userA.user.id,
        );
      } catch (err) {
        if (err instanceof CaseAccessError) threw7 = true;
      }
      const n7After = await prisma.caseNote.findUnique({ where: { id: n7.id } });
      record(
        'N7. cross-tenant delete — CaseAccessError thrown; row remains',
        threw7 && !!n7After,
        `threw=${threw7} rowKept=${!!n7After}`,
      );
    } else {
      record('N7. cross-tenant delete', true, 'skipped — single tenant');
    }

    // ─── N8: Parent-with-replies delete blocked ───
    const c8 = await newCase('case-n8');
    const parent8 = await caseRepository.addNote(
      c8.id,
      { authorName: userA.user.fullName, content: 'N8 parent', visibility: 'Internal' },
      [companyA.id],
      userA.user.id,
    );
    const reply8 = await caseRepository.addReply(
      c8.id,
      parent8.id,
      { authorName: userA.user.fullName, content: 'N8 reply', visibility: 'Internal' },
      [companyA.id],
      userA.user.id,
    );
    created.notes.push(parent8.id, reply8.id);
    const n8DelResult = await caseRepository.deleteNote(
      c8.id,
      parent8.id,
      [companyA.id],
      userA.user.id,
    );
    const parent8After = await prisma.caseNote.findUnique({ where: { id: parent8.id } });
    const reply8After = await prisma.caseNote.findUnique({ where: { id: reply8.id } });
    // Orphan check: no top-level note should appear that wasn't there before.
    const c8TopLevel = await prisma.caseNote.count({
      where: { caseId: c8.id, parentNoteId: null },
    });
    record(
      'N8. parent-with-replies delete blocked — has_replies; parent + reply intact; no orphan',
      n8DelResult?.error === 'has_replies' &&
        !!parent8After &&
        !!reply8After &&
        reply8After.parentNoteId === parent8.id &&
        c8TopLevel === 1,
      `error=${n8DelResult?.error} parentKept=${!!parent8After} replyKept=${!!reply8After} ` +
        `replyStillChild=${reply8After?.parentNoteId === parent8.id} topLevelCount=${c8TopLevel}`,
    );
  } catch (err) {
    console.error('smoke fatal:', err);
    results.push({ name: 'fatal', ok: false, detail: err?.message });
  } finally {
    if (created.cases.length) {
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

run();
