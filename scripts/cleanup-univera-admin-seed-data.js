/**
 * cleanup-univera-admin-seed-data.js
 *
 * Guarded cleanup of UNIVERA-only admin SEED DATA for three modules:
 *   1) categories    — CategoryDef (parents + subcategories, self-relation)
 *   2) checklists    — ChecklistTemplate
 *   3) teams         — Team (soft-disable preferred; hard-delete only when safe)
 *
 * Product Catalog and Package Catalog are NEVER touched here — that cleanup
 * lives in scripts/cleanup-univera-product-catalog.js.
 *
 * Usage:
 *   node --env-file=.env scripts/cleanup-univera-admin-seed-data.js
 *       → dry-run all modules (default)
 *
 *   node --env-file=.env scripts/cleanup-univera-admin-seed-data.js --execute
 *       → run all modules inside a single Prisma transaction
 *
 *   --module categories | checklists | teams | all  (default: all)
 *
 * Hard rules:
 *   - Only UNIVERA rows are touched. PARAM / FINROTA never touched.
 *   - Case / Account / AccountCompany / AccountProduct rows are NEVER deleted.
 *   - Person / User rows are NEVER deleted.
 *   - CaseActivity / CaseTransfer / CaseNote / history / audit are NEVER deleted.
 *   - Closed cases keep their assignedTeamId/Name snapshot (history preserved).
 *   - Open-case clearing is SCOPED to UNIVERA cases only (companyId filter);
 *     any cross-tenant drift (PARAM/FINROTA case assigned to a UNIVERA team)
 *     is reported but NOT mutated.
 *   - Teams are ALWAYS soft-disabled (isActive=false); never hard-deleted.
 *     CaseTransfer.fromTeamId / toTeamId / aiSuggestedTeamId are string refs
 *     (no FK), so deleting the Team row would break listTransfers name
 *     resolution. Soft-disable keeps history queryable.
 *   - Categories (CategoryDef) and Checklists (ChecklistTemplate) are
 *     hard-deleted: Case stores denormalized snapshots, no FK reference.
 *   - Idempotent: a second --execute run finds zero/already-clean state.
 *
 * Exit codes:
 *   0  — success (dry-run printed; or --execute completed + verified)
 *   1  — aborted (UNIVERA not resolved, multi-match, or verification failed)
 */

import { prisma } from '../server/db/client.js';

const UNIVERA_ID_HINTS = ['COMP-UNIVERA'];
const UNIVERA_NAME_HINTS = ['UNIVERA'];

// Open-status whitelist for Case.assignedTeamId clearing. Anything not in this
// list is treated as "closed/historical" and left untouched.
const OPEN_CASE_STATUSES = ['Acik', 'Incelemede', 'ThirdPartyWaiting', 'Eskalasyon', 'YenidenAcildi'];

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const moduleIdx = argv.indexOf('--module');
const MODULE = moduleIdx >= 0 ? (argv[moduleIdx + 1] || 'all') : 'all';
const VALID_MODULES = new Set(['categories', 'checklists', 'teams', 'all']);
if (!VALID_MODULES.has(MODULE)) {
  console.error(`[ABORT] --module must be one of: categories, checklists, teams, all (got "${MODULE}")`);
  process.exit(1);
}
const RUN_CATS = MODULE === 'all' || MODULE === 'categories';
const RUN_CHK  = MODULE === 'all' || MODULE === 'checklists';
const RUN_TM   = MODULE === 'all' || MODULE === 'teams';

function fmt(n) { return String(n).padStart(4, ' '); }
function line(label, value) {
  console.log(`  ${label.padEnd(52, ' ')} ${value}`);
}
function header(title) {
  console.log(`\n${'─'.repeat(64)}\n  ${title}\n${'─'.repeat(64)}`);
}

async function resolveUniveraCompany() {
  const candidates = await prisma.company.findMany({
    where: {
      OR: [
        { id: { in: UNIVERA_ID_HINTS } },
        { name: { in: UNIVERA_NAME_HINTS } },
      ],
    },
    select: { id: true, name: true, isActive: true },
  });
  if (candidates.length === 0) {
    console.error('[ABORT] UNIVERA company not found (looked for ids %j, names %j).', UNIVERA_ID_HINTS, UNIVERA_NAME_HINTS);
    process.exit(1);
  }
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const uniq = [...byId.values()];
  if (uniq.length > 1) {
    console.error('[ABORT] Multiple UNIVERA candidates resolved: %j', uniq.map((c) => `${c.id} (${c.name})`));
    process.exit(1);
  }
  return uniq[0];
}

// ──────────────────────────────────────────────────────────────────────
// MODULE 1 — Categories
// ──────────────────────────────────────────────────────────────────────
async function planCategories(companyId) {
  const all = await prisma.categoryDef.findMany({
    where: { companyId },
    select: { id: true, name: true, parentId: true, isActive: true },
    orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
  });
  const parents = all.filter((c) => c.parentId === null);
  const subs = all.filter((c) => c.parentId !== null);

  // Case uses STRING snapshots for category/subCategory, not FK — counted by
  // string match for awareness only; not blocking.
  const parentNames = new Set(parents.map((p) => p.name));
  const subNames = new Set(subs.map((s) => s.name));
  const caseParentMatches = parentNames.size === 0 ? 0 : await prisma.case.count({
    where: { companyId, category: { in: [...parentNames] } },
  });
  const caseSubMatches = subNames.size === 0 ? 0 : await prisma.case.count({
    where: { companyId, subCategory: { in: [...subNames] } },
  });

  return { all, parents, subs, caseParentMatches, caseSubMatches };
}

// ──────────────────────────────────────────────────────────────────────
// MODULE 2 — Checklists
// ──────────────────────────────────────────────────────────────────────
async function planChecklists(companyId) {
  const templates = await prisma.checklistTemplate.findMany({
    where: { companyId },
    select: { id: true, name: true, productGroup: true, categoryName: true, isActive: true, items: true },
    orderBy: [{ productGroup: 'asc' }, { categoryName: 'asc' }, { name: 'asc' }],
  });
  // Embedded items snapshot count (purely informational).
  let totalEmbeddedItems = 0;
  for (const t of templates) {
    if (Array.isArray(t.items)) totalEmbeddedItems += t.items.length;
  }
  return { templates, totalEmbeddedItems };
}

// ──────────────────────────────────────────────────────────────────────
// MODULE 3 — Teams
// ──────────────────────────────────────────────────────────────────────
async function planTeams(companyId) {
  const teams = await prisma.team.findMany({
    where: { companyId },
    select: { id: true, name: true, isActive: true },
    orderBy: [{ name: 'asc' }],
  });
  const teamIds = teams.map((t) => t.id);

  if (teamIds.length === 0) {
    return {
      teams: [],
      perTeam: [],
      personRefs: 0,
      teamLeadRefs: 0,
      univeraOpenCaseRefs: 0,
      univeraClosedCaseRefs: 0,
      crossTenantDrift: 0,
      transferFromRefs: 0,
      transferToRefs: 0,
      transferAiRefs: 0,
      teamsAlreadyDisabled: 0,
      teamsToDisable: 0,
    };
  }

  const personRefs = await prisma.person.count({ where: { teamId: { in: teamIds } } });
  const teamLeadRefs = await prisma.person.count({
    where: { teamId: { in: teamIds }, isTeamLead: true },
  });

  // Open-case clearing scope: ONLY UNIVERA cases. Cross-tenant drift (a
  // PARAM/FINROTA case mis-assigned to a UNIVERA team) is reported here but
  // NOT mutated by this script.
  const univeraOpenCaseRefs = await prisma.case.count({
    where: {
      companyId,
      assignedTeamId: { in: teamIds },
      status: { in: OPEN_CASE_STATUSES },
    },
  });
  const univeraClosedCaseRefs = await prisma.case.count({
    where: {
      companyId,
      assignedTeamId: { in: teamIds },
      NOT: { status: { in: OPEN_CASE_STATUSES } },
    },
  });
  const crossTenantDrift = await prisma.case.count({
    where: {
      assignedTeamId: { in: teamIds },
      NOT: { companyId },
    },
  });

  // CaseTransfer history references — preserved by soft-disable. Fields are
  // string snapshots (no FK), but server/db/caseRepository.js listTransfers
  // joins back to Team to resolve names, so the Team row must stay alive.
  const transferFromRefs = await prisma.caseTransfer.count({
    where: { fromTeamId: { in: teamIds } },
  });
  const transferToRefs = await prisma.caseTransfer.count({
    where: { toTeamId: { in: teamIds } },
  });
  const transferAiRefs = await prisma.caseTransfer.count({
    where: { aiSuggestedTeamId: { in: teamIds } },
  });

  // Per-team breakdown for reporting only — no longer drives hard-delete.
  const perTeam = [];
  for (const t of teams) {
    const members = await prisma.person.count({ where: { teamId: t.id } });
    const openCases = await prisma.case.count({
      where: { companyId, assignedTeamId: t.id, status: { in: OPEN_CASE_STATUSES } },
    });
    const closedCases = await prisma.case.count({
      where: { companyId, assignedTeamId: t.id, NOT: { status: { in: OPEN_CASE_STATUSES } } },
    });
    const transferRefs = await prisma.caseTransfer.count({
      where: { OR: [{ fromTeamId: t.id }, { toTeamId: t.id }, { aiSuggestedTeamId: t.id }] },
    });
    perTeam.push({ ...t, members, openCases, closedCases, transferRefs });
  }

  const teamsAlreadyDisabled = teams.filter((t) => !t.isActive).length;
  const teamsToDisable = teams.filter((t) => t.isActive).length;

  return {
    teams,
    perTeam,
    personRefs,
    teamLeadRefs,
    univeraOpenCaseRefs,
    univeraClosedCaseRefs,
    crossTenantDrift,
    transferFromRefs,
    transferToRefs,
    transferAiRefs,
    teamsAlreadyDisabled,
    teamsToDisable,
  };
}

// ──────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────
async function main() {
  header(`Mode: ${EXECUTE ? 'EXECUTE (DB will be mutated)' : 'DRY RUN — no database changes will be made'}`);
  line('Module filter', MODULE);
  line('Modules to run', `categories=${RUN_CATS} checklists=${RUN_CHK} teams=${RUN_TM}`);

  const company = await resolveUniveraCompany();
  line('Resolved UNIVERA company', `${company.id} (${company.name})  isActive=${company.isActive}`);

  // ── Pre-cleanup baseline counts (for verification + reporting) ──
  const baseline = {
    paramTeams: await prisma.team.count({ where: { companyId: 'COMP-PARAM' } }),
    finrotaTeams: await prisma.team.count({ where: { companyId: 'COMP-FINROTA' } }),
    paramCategories: await prisma.categoryDef.count({ where: { companyId: 'COMP-PARAM' } }),
    finrotaCategories: await prisma.categoryDef.count({ where: { companyId: 'COMP-FINROTA' } }),
    paramChecklists: await prisma.checklistTemplate.count({ where: { companyId: 'COMP-PARAM' } }),
    finrotaChecklists: await prisma.checklistTemplate.count({ where: { companyId: 'COMP-FINROTA' } }),
    totalCases: await prisma.case.count(),
    totalAccounts: await prisma.account.count(),
    totalPersons: await prisma.person.count(),
    totalActivities: await prisma.caseActivity.count(),
    totalTransfers: await prisma.caseTransfer.count(),
  };

  // ── Plan each module ──
  const catsPlan = RUN_CATS ? await planCategories(company.id) : null;
  const chkPlan  = RUN_CHK  ? await planChecklists(company.id) : null;
  const tmPlan   = RUN_TM   ? await planTeams(company.id) : null;

  // ── Print plans ──
  if (RUN_CATS) {
    header('MODULE 1 — Categories (UNIVERA)');
    line('Parent category count', fmt(catsPlan.parents.length));
    for (const c of catsPlan.parents) line(`  · ${c.name}`, c.isActive ? 'active' : 'inactive');
    line('Subcategory count', fmt(catsPlan.subs.length));
    for (const c of catsPlan.subs) line(`  · ${c.name} (parentId=${c.parentId})`, c.isActive ? 'active' : 'inactive');
    line('Case rows with matching category text (snapshot)', fmt(catsPlan.caseParentMatches));
    line('Case rows with matching subCategory text (snapshot)', fmt(catsPlan.caseSubMatches));
    line('Plan', 'HARD DELETE — Case uses denormalized text, no FK; snapshots preserved');
  }

  if (RUN_CHK) {
    header('MODULE 2 — Checklist Templates (UNIVERA)');
    line('Template count', fmt(chkPlan.templates.length));
    for (const t of chkPlan.templates) {
      line(`  · ${t.productGroup} / ${t.categoryName} — ${t.name}`, t.isActive ? 'active' : 'inactive');
    }
    line('Total embedded items (in Json) — informational', fmt(chkPlan.totalEmbeddedItems));
    line('Plan', 'HARD DELETE — Case.checklistItems is Json snapshot, no FK');
  }

  if (RUN_TM) {
    header('MODULE 3 — Teams (UNIVERA)');
    line('Team count', fmt(tmPlan.teams.length));
    for (const t of tmPlan.perTeam) {
      line(`  · ${t.name}  members=${t.members} open=${t.openCases} closed=${t.closedCases} xfer=${t.transferRefs}`,
        `${t.isActive ? 'active → SOFT DISABLE' : 'already inactive (no-op)'}`);
    }
    line('Person.teamId references to clear', fmt(tmPlan.personRefs));
    line('Person.isTeamLead flags to clear (subset)', fmt(tmPlan.teamLeadRefs));
    line('UNIVERA open cases — assignedTeamId/Name will be CLEARED', fmt(tmPlan.univeraOpenCaseRefs));
    line('UNIVERA closed cases — PRESERVED (history)', fmt(tmPlan.univeraClosedCaseRefs));
    line('Cross-tenant drift (assigned to UNIVERA team, not UNIVERA case)', fmt(tmPlan.crossTenantDrift));
    if (tmPlan.crossTenantDrift > 0) {
      line('  → WARNING', 'reported only; this script does NOT mutate cross-tenant rows');
    }
    line('CaseTransfer.fromTeamId refs (preserved)', fmt(tmPlan.transferFromRefs));
    line('CaseTransfer.toTeamId refs (preserved)', fmt(tmPlan.transferToRefs));
    line('CaseTransfer.aiSuggestedTeamId refs (preserved)', fmt(tmPlan.transferAiRefs));
    line('Teams already inactive (no-op)', fmt(tmPlan.teamsAlreadyDisabled));
    line('Teams to soft-disable on execute', fmt(tmPlan.teamsToDisable));
    line('Plan', 'SOFT DISABLE all UNIVERA teams; no hard delete, to preserve transfer/audit history');
  }

  header('PARAM / FINROTA baseline — NOT TOUCHED');
  line('PARAM Team count',         fmt(baseline.paramTeams));
  line('PARAM CategoryDef count',  fmt(baseline.paramCategories));
  line('PARAM ChecklistTemplate',  fmt(baseline.paramChecklists));
  line('FINROTA Team count',       fmt(baseline.finrotaTeams));
  line('FINROTA CategoryDef count',fmt(baseline.finrotaCategories));
  line('FINROTA ChecklistTemplate',fmt(baseline.finrotaChecklists));

  header('History / Audit baseline — NEVER deleted');
  line('Total Cases',             fmt(baseline.totalCases));
  line('Total Accounts',          fmt(baseline.totalAccounts));
  line('Total Persons',           fmt(baseline.totalPersons));
  line('Total CaseActivity rows', fmt(baseline.totalActivities));
  line('Total CaseTransfer rows', fmt(baseline.totalTransfers));

  if (!EXECUTE) {
    header('DRY-RUN COMPLETE');
    console.log('  Re-run with --execute to apply the plan.');
    console.log('  No DB mutation occurred.');
    await prisma.$disconnect();
    process.exit(0);
  }

  // ────────────────────────────────────────────────────────────────────
  // EXECUTE — single Prisma transaction
  // ────────────────────────────────────────────────────────────────────
  header('EXECUTING transaction…');

  const result = await prisma.$transaction(async (tx) => {
    const out = {
      categories: { subDeleted: 0, parentDeleted: 0 },
      checklists: { deleted: 0 },
      teams: { personTeamCleared: 0, personLeadCleared: 0, openCaseCleared: 0, softDisabled: 0 },
    };

    // ── Module 1: Categories ── (re-fetch inside tx for fresh state)
    if (RUN_CATS) {
      const inTx = await tx.categoryDef.findMany({
        where: { companyId: company.id },
        select: { id: true, parentId: true },
      });
      const subIds = inTx.filter((c) => c.parentId !== null).map((c) => c.id);
      const parentIds = inTx.filter((c) => c.parentId === null).map((c) => c.id);
      // Delete subs first (children), then parents.
      if (subIds.length) {
        const r = await tx.categoryDef.deleteMany({ where: { id: { in: subIds } } });
        out.categories.subDeleted = r.count;
      }
      if (parentIds.length) {
        const r = await tx.categoryDef.deleteMany({ where: { id: { in: parentIds } } });
        out.categories.parentDeleted = r.count;
      }
    }

    // ── Module 2: Checklists ──
    if (RUN_CHK) {
      const r = await tx.checklistTemplate.deleteMany({ where: { companyId: company.id } });
      out.checklists.deleted = r.count;
    }

    // ── Module 3: Teams ── (recompute team set + per-team refs)
    if (RUN_TM) {
      const teamsInTx = await tx.team.findMany({
        where: { companyId: company.id },
        select: { id: true, isActive: true },
      });
      const teamIds = teamsInTx.map((t) => t.id);
      if (teamIds.length) {
        // 1) Clear Person.teamId (and isTeamLead) for members of UNIVERA teams.
        const leadCount = await tx.person.count({ where: { teamId: { in: teamIds }, isTeamLead: true } });
        const personCleared = await tx.person.updateMany({
          where: { teamId: { in: teamIds } },
          data: { teamId: null, isTeamLead: false },
        });
        out.teams.personTeamCleared = personCleared.count;
        out.teams.personLeadCleared = leadCount;

        // 2) Clear open Case.assignedTeamId/assignedTeamName — SCOPED to
        //    UNIVERA cases. Cross-tenant drift rows are reported in dry-run
        //    but never mutated here.
        const openCleared = await tx.case.updateMany({
          where: {
            companyId: company.id,
            assignedTeamId: { in: teamIds },
            status: { in: OPEN_CASE_STATUSES },
          },
          data: { assignedTeamId: null, assignedTeamName: null },
        });
        out.teams.openCaseCleared = openCleared.count;

        // 3) Soft-disable every UNIVERA team. NEVER hard-delete: CaseTransfer
        //    history references team ids by string, and caseRepository's
        //    listTransfers joins back to Team for name resolution — deleting
        //    the row would orphan historical transfer views.
        const disabled = await tx.team.updateMany({
          where: { companyId: company.id, isActive: true },
          data: { isActive: false },
        });
        out.teams.softDisabled = disabled.count;
      }
    }

    return out;
  });

  header('Transaction success — module counts');
  if (RUN_CATS) {
    line('Subcategories deleted', fmt(result.categories.subDeleted));
    line('Parent categories deleted', fmt(result.categories.parentDeleted));
  }
  if (RUN_CHK) {
    line('Checklist templates deleted', fmt(result.checklists.deleted));
  }
  if (RUN_TM) {
    line('Person.teamId cleared', fmt(result.teams.personTeamCleared));
    line('Person.isTeamLead cleared', fmt(result.teams.personLeadCleared));
    line('UNIVERA open case assignedTeam cleared', fmt(result.teams.openCaseCleared));
    line('Teams soft-disabled (no hard-delete)', fmt(result.teams.softDisabled));
  }

  // ────────────────────────────────────────────────────────────────────
  // POST-EXECUTE VERIFICATION
  // ────────────────────────────────────────────────────────────────────
  const remainingCats = RUN_CATS ? await prisma.categoryDef.count({ where: { companyId: company.id } }) : null;
  const remainingChk  = RUN_CHK  ? await prisma.checklistTemplate.count({ where: { companyId: company.id } }) : null;
  const remainingActiveTeams = RUN_TM
    ? await prisma.team.count({ where: { companyId: company.id, isActive: true } })
    : null;
  const totalUniveraTeams = RUN_TM
    ? await prisma.team.count({ where: { companyId: company.id } })
    : null;
  const remainingTeamMemberRefs = RUN_TM
    ? await prisma.person.count({ where: { team: { companyId: company.id } } })
    : null;
  // UNIVERA-scoped check: open cases of UNIVERA companyId still pointing at a
  // UNIVERA team. Cross-tenant drift is intentionally NOT mutated and not
  // counted here.
  const remainingUniveraOpenCaseTeamRefs = RUN_TM
    ? await prisma.case.count({
        where: {
          companyId: company.id,
          assignedTeam: { companyId: company.id },
          status: { in: OPEN_CASE_STATUSES },
        },
      })
    : null;

  // PARAM/FINROTA unchanged
  const after = {
    paramTeams: await prisma.team.count({ where: { companyId: 'COMP-PARAM' } }),
    finrotaTeams: await prisma.team.count({ where: { companyId: 'COMP-FINROTA' } }),
    paramCategories: await prisma.categoryDef.count({ where: { companyId: 'COMP-PARAM' } }),
    finrotaCategories: await prisma.categoryDef.count({ where: { companyId: 'COMP-FINROTA' } }),
    paramChecklists: await prisma.checklistTemplate.count({ where: { companyId: 'COMP-PARAM' } }),
    finrotaChecklists: await prisma.checklistTemplate.count({ where: { companyId: 'COMP-FINROTA' } }),
    totalCases: await prisma.case.count(),
    totalAccounts: await prisma.account.count(),
    totalPersons: await prisma.person.count(),
    totalActivities: await prisma.caseActivity.count(),
    totalTransfers: await prisma.caseTransfer.count(),
  };

  header('Post-execute verification');
  if (RUN_CATS) line('UNIVERA CategoryDef remaining', fmt(remainingCats));
  if (RUN_CHK)  line('UNIVERA ChecklistTemplate remaining', fmt(remainingChk));
  if (RUN_TM) {
    line('UNIVERA active Team remaining', fmt(remainingActiveTeams));
    line('UNIVERA total Team rows preserved (soft-disabled)', fmt(totalUniveraTeams));
    line('Person rows still on UNIVERA teams', fmt(remainingTeamMemberRefs));
    line('UNIVERA open cases still on UNIVERA teams', fmt(remainingUniveraOpenCaseTeamRefs));
  }
  line('PARAM Team (unchanged)',         `${after.paramTeams} (was ${baseline.paramTeams})`);
  line('PARAM CategoryDef (unchanged)',  `${after.paramCategories} (was ${baseline.paramCategories})`);
  line('PARAM ChecklistTemplate',        `${after.paramChecklists} (was ${baseline.paramChecklists})`);
  line('FINROTA Team (unchanged)',       `${after.finrotaTeams} (was ${baseline.finrotaTeams})`);
  line('FINROTA CategoryDef (unchanged)',`${after.finrotaCategories} (was ${baseline.finrotaCategories})`);
  line('FINROTA ChecklistTemplate',      `${after.finrotaChecklists} (was ${baseline.finrotaChecklists})`);
  line('Total Cases (unchanged)',        `${after.totalCases} (was ${baseline.totalCases})`);
  line('Total Accounts (unchanged)',     `${after.totalAccounts} (was ${baseline.totalAccounts})`);
  line('Total Persons (unchanged)',      `${after.totalPersons} (was ${baseline.totalPersons})`);
  line('CaseActivity rows (unchanged)',  `${after.totalActivities} (was ${baseline.totalActivities})`);
  line('CaseTransfer rows (unchanged)',  `${after.totalTransfers} (was ${baseline.totalTransfers})`);

  const ok =
    (!RUN_CATS || remainingCats === 0) &&
    (!RUN_CHK  || remainingChk === 0) &&
    (!RUN_TM   || (remainingActiveTeams === 0 && remainingTeamMemberRefs === 0 && remainingUniveraOpenCaseTeamRefs === 0)) &&
    after.paramTeams === baseline.paramTeams &&
    after.finrotaTeams === baseline.finrotaTeams &&
    after.paramCategories === baseline.paramCategories &&
    after.finrotaCategories === baseline.finrotaCategories &&
    after.paramChecklists === baseline.paramChecklists &&
    after.finrotaChecklists === baseline.finrotaChecklists &&
    after.totalCases === baseline.totalCases &&
    after.totalAccounts === baseline.totalAccounts &&
    after.totalPersons === baseline.totalPersons &&
    after.totalActivities === baseline.totalActivities &&
    after.totalTransfers === baseline.totalTransfers;

  await prisma.$disconnect();

  if (!ok) {
    console.error('\n[VERIFICATION FAILED] Some invariant did not hold. See counts above.');
    process.exit(1);
  }

  console.log('\n[VERIFICATION PASSED] UNIVERA admin seed data cleaned safely.');
  console.log('  - PARAM / FINROTA untouched');
  console.log('  - Cases / Accounts / Persons preserved');
  console.log('  - CaseActivity / CaseTransfer history preserved');
  console.log('  - All UNIVERA teams soft-disabled (NO hard-delete) — transfer history preserved');
  console.log('  - Closed-case team assignment snapshots preserved');
  console.log('  - Open-case clearing scoped to UNIVERA cases only');
  console.log('\nManual UI follow-up:');
  console.log('  · Yönetim → Kategori: UNIVERA listesi boş / aktif yok');
  console.log('  · Yönetim → Checklist: UNIVERA listesi boş / aktif yok');
  console.log('  · Yönetim → Takımlar: UNIVERA aktif takım yok');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[ERROR]', err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
