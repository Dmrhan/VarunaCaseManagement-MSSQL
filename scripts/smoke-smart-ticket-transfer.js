/**
 * smoke-smart-ticket-transfer.js — WR-Smart-Ticket Phase T1 (PR-T1).
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-smart-ticket-transfer.js
 *   node --env-file=.env scripts/smoke-smart-ticket-transfer.js --keep
 *
 * caseRepository.transferCase üzerinden Smart Ticket L1 → L2 devir
 * akışının deterministic bağlam persistence'ini doğrular.
 *
 * Senaryolar:
 *   1.  UNIVERA company resolve
 *   2.  İki aktif takım bulma (kaynak + hedef)
 *   3.  Smart Ticket Case open (customFields.smartTicket opening dolu) +
 *       Case create activity satırı note='Smart Ticket akışıyla açıldı'
 *   4.  Birkaç CaseSolutionStep ekle (manual + ai_suggested_step,
 *       statuses: tried/worked/not_worked/skipped/suggested)
 *   5.  composeTransferBriefFromSteps direct çağrı — composedSummary,
 *       attemptedStepIds, stepOutcomesSummary doğrula
 *   6.  transferCase smartTicketTransfer payload ile çağrı — return shape
 *   7.  customFields.smartTicket.transferContext roundtrip (version,
 *       transferredAt, toTeamId/Name, transferNote, composedSummary,
 *       attemptedStepIds, openingTaxonomySnapshot, stepOutcomesSummary)
 *   8.  CaseActivity Transfer row note multi-line (Gerekçe + L1 Notu +
 *       Denenen Adımlar Özeti)
 *   9.  CaseTransfer audit row korundu (mevcut akış regressyon)
 *   10. SLA alanları DOKUNULMADI (slaResponseDueAt/slaResolutionDueAt/
 *       slaPausedAt değişmedi)
 *   11. Regression: klasik (non-ST) Case transfer — smartTicketTransfer
 *       gönderilmediğinde mevcut akış aynen çalışır, customFields null kalır
 *   12. Defense in depth: non-ST Case'e smartTicketTransfer verilirse
 *       'smart_ticket_transfer_requires_opening' ile reddedilir
 *   13. transferNote zorunluluğu: ST Case'te smartTicketTransfer.transferNote
 *       boş ise 'smart_ticket_transfer_note_required' ile reddedilir
 *   14. Case create activity note regressyon: non-ST Case'te
 *       "Vaka oluşturuldu" satırı note alanı boş kalır (suffix yok)
 *   15. composeTransferBriefFromSteps boş step listesinde null döner
 *
 * Cleanup: yaratılan Case'leri siler (`--keep` ile koruyabilirsin).
 */

import { prisma } from '../server/db/client.js';
import { caseRepository } from './_actor-fixture.js';
import { composeTransferBriefFromSteps } from '../server/db/solutionStepRepository.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n, def = null) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  if (hit) return hit.slice(n.length + 3);
  const idx = args.indexOf(`--${n}`);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return def;
};
const COMPANY = val('company', 'UNIVERA');
const KEEP = flag('keep');

let pass = 0;
let fail = 0;
let skip = 0;
const created = [];

function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function note(name, detail = '') { skip += 1; console.log(`⊘ ${name}${detail ? ' — ' + detail : ''}`); }

// ─── 1) Company resolve ─────────────────────────────────────────────────

console.log('── 1) Company resolve ─────────────────────────────────');
let companyId = null;
let companyName = null;
try {
  const byId = await prisma.company.findUnique({ where: { id: COMPANY }, select: { id: true, name: true } });
  if (byId) { companyId = byId.id; companyName = byId.name; }
  else {
    const byName = await prisma.company.findUnique({ where: { name: COMPANY }, select: { id: true, name: true } });
    if (byName) { companyId = byName.id; companyName = byName.name; }
  }
} catch (err) {
  note('DB skip', `DB erişilemedi: ${err?.message}`);
}
if (!companyId) {
  console.log('PASS=0  FAIL=0  SKIP=1');
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}
ok('1) UNIVERA company resolve', `${companyId} (${companyName})`);

// ─── 2) Iki aktif takım ──────────────────────────────────────────────────

console.log('');
console.log('── 2) İki aktif takım resolve ─────────────────────────');
const teams = await prisma.team.findMany({
  where: { companyId, isActive: true },
  select: { id: true, name: true, defaultSupportLevel: true },
  orderBy: { name: 'asc' },
  take: 5,
});
if (teams.length < 2) {
  bad('2) En az 2 aktif takım gerekli', `bulundu=${teams.length}`);
  console.log(`PASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}
const sourceTeam = teams[0];
const targetTeam = teams[1];
ok('2) İki aktif takım bulundu', `from=${sourceTeam.name} → to=${targetTeam.name}`);

// ─── 3) Smart Ticket Case open + activity note ──────────────────────────

console.log('');
console.log('── 3) Smart Ticket Case open ──────────────────────────');

const OPENING = {
  platform: 'plat.test',
  platformLabel: 'Test Platform',
  businessProcess: 'bp.test',
  businessProcessLabel: 'Test Süreç',
  operationType: 'op.test',
  operationTypeLabel: 'Test Operasyon',
  affectedObject: 'aff.test',
  affectedObjectLabel: 'Test Nesne',
  impact: 'imp.test',
  impactLabel: 'Test Etki',
  appliedMapping: { source: 'fallback', category: 'Akıllı Ticket', subCategory: 'Genel', requestType: 'Talep' },
};
const OTHER_CF = { someOtherField: 'should_survive' };

let stCase = null;
try {
  stCase = await caseRepository.create({
    title: `[smoke] ST transfer ${Date.now().toString(36)}`,
    description: 'Smart Ticket transfer smoke — silinmesi güvenlidir.',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Web',
    companyId,
    companyName,
    category: 'Akıllı Ticket',
    subCategory: 'Genel',
    requestType: 'Talep',
    assignedTeamId: sourceTeam.id,
    assignedTeamName: sourceTeam.name,
    customFields: { smartTicket: OPENING, ...OTHER_CF },
    createdBy: 'Smoke User',
  });
  created.push(stCase.id);
  ok('3a) Smart Ticket Case açıldı', stCase.id);
} catch (err) {
  bad('3a) Smart Ticket Case create', err?.message ?? String(err));
}

if (stCase) {
  const createActivity = await prisma.caseActivity.findFirst({
    where: { caseId: stCase.id, actionType: 'CaseCreated' },
    select: { action: true, note: true },
  });
  if (createActivity?.action === 'Vaka oluşturuldu' && createActivity?.note === 'Smart Ticket akışıyla açıldı') {
    ok('3b) Case create activity note="Smart Ticket akışıyla açıldı"');
  } else {
    bad('3b) Case create activity', JSON.stringify(createActivity));
  }
}

// ─── 4) Solution step ekle ──────────────────────────────────────────────

console.log('');
console.log('── 4) CaseSolutionStep ekle (manual + ai mixed) ──────');

const stepRecipes = [
  { source: 'ai_suggested_step', title: 'Cache temizle', status: 'not_worked', note: 'Tarayıcı cache temiz olsa da sorun devam ediyor' },
  { source: 'ai_suggested_step', title: 'Tarayıcı güncelle', status: 'skipped', note: null },
  { source: 'manual', title: 'Hesap detayını kontrol et', status: 'tried', note: null },
  { source: 'manual', title: 'Sunucu loglarını incele', status: 'not_worked', note: 'Log temiz' },
  { source: 'ai_suggested_step', title: 'API token yenile', status: 'suggested', note: null },
];

let stepIds = [];
if (stCase) {
  let idx = 1;
  for (const r of stepRecipes) {
    const row = await prisma.caseSolutionStep.create({
      data: {
        caseId: stCase.id,
        companyId,
        stepIndex: idx++,
        source: r.source,
        sourceRef: r.source === 'ai_suggested_step' ? `smoke-ref-${idx}` : null,
        sourceTitle: r.source === 'ai_suggested_step' ? 'Smoke KB' : null,
        title: r.title,
        status: r.status,
        note: r.note,
        triedAt: ['tried', 'worked', 'not_worked'].includes(r.status) ? new Date() : null,
        outcomeAt: ['worked', 'not_worked', 'skipped'].includes(r.status) ? new Date() : null,
        createdByUserId: null,
      },
      select: { id: true },
    });
    stepIds.push(row.id);
  }
  ok('4) 5 step yazıldı', `not_worked=2 tried=1 skipped=1 suggested=1`);
}

// ─── 5) composeTransferBriefFromSteps direct ────────────────────────────

console.log('');
console.log('── 5) composeTransferBriefFromSteps direct ────────────');

let composed = null;
if (stCase) {
  composed = await composeTransferBriefFromSteps(stCase.id);
  if (composed?.composedSummary && typeof composed.composedSummary === 'string') {
    ok('5a) composedSummary üretildi', `${composed.composedSummary.length} char`);
  } else {
    bad('5a) composedSummary', JSON.stringify(composed));
  }
  if (Array.isArray(composed?.attemptedStepIds) && composed.attemptedStepIds.length === 5) {
    ok('5b) attemptedStepIds tüm step\'leri içeriyor', `count=5`);
  } else {
    bad('5b) attemptedStepIds', JSON.stringify(composed?.attemptedStepIds));
  }
  const sos = composed?.stepOutcomesSummary;
  if (sos && sos.total === 5 && sos.worked === 0 && sos.notWorked === 2 && sos.skipped === 1 && sos.pending === 2) {
    ok('5c) stepOutcomesSummary doğru', `total=5 nw=2 skip=1 pending=2`);
  } else {
    bad('5c) stepOutcomesSummary', JSON.stringify(sos));
  }
  // Composer içeriği TR label içermeli
  if (composed?.composedSummary?.includes('İşe yaramadı') && composed?.composedSummary?.includes('KB önerisi')) {
    ok('5d) composedSummary TR status + source label içeriyor');
  } else {
    bad('5d) composedSummary content', composed?.composedSummary?.slice(0, 200));
  }
}

// ─── 6-10) transferCase smartTicketTransfer ile çağır ───────────────────

console.log('');
console.log('── 6-10) transferCase smartTicketTransfer ──────────────');

let slaBefore = null;
if (stCase) {
  const beforeRow = await prisma.case.findUnique({
    where: { id: stCase.id },
    select: { slaResponseDueAt: true, slaResolutionDueAt: true, slaPausedAt: true },
  });
  slaBefore = beforeRow;
}

let transferResult = null;
const TRANSFER_NOTE = 'L1: KB önerilerini denedim, hiçbiri çözmedi. Lütfen API token tarafına bakar mısın?';
if (stCase && composed) {
  try {
    transferResult = await caseRepository.transferCase(
      stCase.id,
      {
        toTeamId: targetTeam.id,
        toPersonId: null,
        reason: 'L2 uzmanlığı gerekli',
        reasonCode: null,
        transferredBy: 'smoke-user-id',
        transferredByName: 'Smoke User',
        smartTicketTransfer: {
          transferNote: TRANSFER_NOTE,
          composedSummary: composed.composedSummary,
          attemptedStepIds: composed.attemptedStepIds,
          stepOutcomesSummary: composed.stepOutcomesSummary,
        },
      },
      [companyId],
    );
    if (transferResult?.case?.assignedTeamId === targetTeam.id) {
      ok('6) transferCase return shape OK', `toTeamId=${transferResult.toTeamId}`);
    } else {
      bad('6) transferCase return', JSON.stringify(transferResult));
    }
  } catch (err) {
    bad('6) transferCase exception', err?.message ?? String(err));
  }
}

// 7) customFields.smartTicket.transferContext roundtrip
if (stCase && transferResult?.case) {
  const fetched = await prisma.case.findUnique({
    where: { id: stCase.id },
    select: { customFields: true },
  });
  const tc = fetched?.customFields?.smartTicket?.transferContext;
  if (
    tc &&
    tc.version === 1 &&
    typeof tc.transferredAt === 'string' &&
    tc.toTeamId === targetTeam.id &&
    tc.toTeamName === targetTeam.name &&
    tc.transferNote === TRANSFER_NOTE &&
    typeof tc.composedSummary === 'string' &&
    tc.composedSummary.length > 0
  ) {
    ok('7a) transferContext core alanlar persist edildi');
  } else {
    bad('7a) transferContext core', JSON.stringify(tc));
  }
  if (Array.isArray(tc?.attemptedStepIds) && tc.attemptedStepIds.length === 5) {
    ok('7b) transferContext.attemptedStepIds persist edildi', `count=5`);
  } else {
    bad('7b) attemptedStepIds persist', JSON.stringify(tc?.attemptedStepIds));
  }
  const snap = tc?.openingTaxonomySnapshot;
  if (snap?.platform === OPENING.platform && snap?.platformLabel === OPENING.platformLabel && snap?.impact === OPENING.impact) {
    ok('7c) openingTaxonomySnapshot mevcut opening\'ten kopyalandı');
  } else {
    bad('7c) openingTaxonomySnapshot', JSON.stringify(snap));
  }
  const sosp = tc?.stepOutcomesSummary;
  if (sosp?.total === 5 && sosp?.notWorked === 2 && sosp?.skipped === 1 && sosp?.pending === 2) {
    ok('7d) stepOutcomesSummary persist edildi');
  } else {
    bad('7d) stepOutcomesSummary persist', JSON.stringify(sosp));
  }
  // 7e) Opening + closure diğer alanlar korunuyor
  const st = fetched?.customFields?.smartTicket;
  if (st?.platform === OPENING.platform && st?.appliedMapping?.source === OPENING.appliedMapping.source) {
    ok('7e) smartTicket opening alanları korundu (deep-merge invariant)');
  } else {
    bad('7e) opening preserved', JSON.stringify(st));
  }
  // 7f) Diğer customFields anahtarları
  if (fetched?.customFields?.someOtherField === 'should_survive') {
    ok('7f) diğer customFields anahtarları korundu');
  } else {
    bad('7f) other customFields', JSON.stringify(fetched?.customFields));
  }
}

// 8) Activity multi-line note
if (stCase) {
  const transferActivity = await prisma.caseActivity.findFirst({
    where: { caseId: stCase.id, actionType: 'Transfer' },
    orderBy: { at: 'desc' },
    select: { action: true, note: true, fromValue: true, toValue: true },
  });
  const expectedFragments = ['Gerekçe:', 'L1 Notu:', TRANSFER_NOTE, 'Denenen Adımlar Özeti:'];
  const allFound = expectedFragments.every((f) => (transferActivity?.note ?? '').includes(f));
  if (transferActivity?.actionType !== undefined || transferActivity?.action) {
    if (allFound) {
      ok('8) CaseActivity Transfer note multi-line (Gerekçe + L1 Notu + Özet)');
    } else {
      bad('8) Activity note', `note=${transferActivity?.note}`);
    }
  } else {
    bad('8) Activity row missing', JSON.stringify(transferActivity));
  }
}

// 9) CaseTransfer audit row regression
if (stCase) {
  const tr = await prisma.caseTransfer.findFirst({
    where: { caseId: stCase.id },
    orderBy: { transferredAt: 'desc' },
    select: { fromTeamId: true, toTeamId: true, reason: true },
  });
  if (tr?.toTeamId === targetTeam.id && tr?.reason === 'L2 uzmanlığı gerekli') {
    ok('9) CaseTransfer audit row korundu (mevcut akış)');
  } else {
    bad('9) CaseTransfer audit', JSON.stringify(tr));
  }
}

// 10) SLA alanları DOKUNULMADI
if (stCase && slaBefore) {
  const after = await prisma.case.findUnique({
    where: { id: stCase.id },
    select: { slaResponseDueAt: true, slaResolutionDueAt: true, slaPausedAt: true },
  });
  const sameDue = String(after?.slaResponseDueAt) === String(slaBefore.slaResponseDueAt);
  const sameRes = String(after?.slaResolutionDueAt) === String(slaBefore.slaResolutionDueAt);
  const samePause = String(after?.slaPausedAt) === String(slaBefore.slaPausedAt);
  if (sameDue && sameRes && samePause) {
    ok('10) SLA alanları DOKUNULMADI (response/resolution/paused)');
  } else {
    bad('10) SLA alanları değişti', JSON.stringify({ before: slaBefore, after }));
  }
}

// ─── 11) Klasik (non-ST) transfer regressyon ───────────────────────────

console.log('');
console.log('── 11) Klasik transfer regressyon ────────────────────');

let plainCase = null;
try {
  plainCase = await caseRepository.create({
    title: `[smoke] plain transfer ${Date.now().toString(36)}`,
    description: 'Klasik transfer smoke.',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Telefon',
    companyId,
    companyName,
    category: 'Genel',
    subCategory: 'Genel',
    requestType: 'Talep',
    assignedTeamId: sourceTeam.id,
    assignedTeamName: sourceTeam.name,
    createdBy: 'Smoke User',
  });
  created.push(plainCase.id);

  // 14) Case create activity note regressyon — non-ST'de note null kalır
  const createAct = await prisma.caseActivity.findFirst({
    where: { caseId: plainCase.id, actionType: 'CaseCreated' },
    select: { note: true },
  });
  if (createAct && (createAct.note === null || createAct.note === undefined)) {
    ok('14) Non-ST Case create activity note null kaldı (suffix yok)');
  } else {
    bad('14) Non-ST create note', JSON.stringify(createAct));
  }

  const r = await caseRepository.transferCase(
    plainCase.id,
    {
      toTeamId: targetTeam.id,
      toPersonId: null,
      reason: 'Klasik akış',
      transferredBy: 'smoke-user-id',
      transferredByName: 'Smoke User',
      // smartTicketTransfer YOK
    },
    [companyId],
  );
  if (r?.case?.assignedTeamId === targetTeam.id) {
    ok('11a) Klasik transfer başarılı');
  } else {
    bad('11a) Klasik transfer', JSON.stringify(r));
  }

  const after = await prisma.case.findUnique({
    where: { id: plainCase.id },
    select: { customFields: true },
  });
  if (after?.customFields == null) {
    ok('11b) Klasik transfer customFields\'a dokunmadı (null kaldı)');
  } else {
    bad('11b) customFields touched', JSON.stringify(after?.customFields));
  }

  const act = await prisma.caseActivity.findFirst({
    where: { caseId: plainCase.id, actionType: 'Transfer' },
    select: { note: true },
  });
  if (act?.note && !act.note.includes('L1 Notu:') && !act.note.includes('Denenen Adımlar Özeti:')) {
    ok('11c) Klasik transfer activity note tek satır (Smart Ticket enrich yok)');
  } else {
    bad('11c) Klasik activity note', JSON.stringify(act));
  }
} catch (err) {
  bad('11) Klasik transfer exception', err?.message ?? String(err));
}

// ─── 12) Defense in depth: non-ST + smartTicketTransfer ────────────────

console.log('');
console.log('── 12) Defense in depth: non-ST + smartTicketTransfer ─');

let plainRejected = null;
try {
  plainRejected = await caseRepository.create({
    title: `[smoke] non-ST reject ${Date.now().toString(36)}`,
    description: 'Non-ST reject smoke.',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Web',
    companyId,
    companyName,
    category: 'Genel',
    subCategory: 'Genel',
    requestType: 'Talep',
    assignedTeamId: sourceTeam.id,
    assignedTeamName: sourceTeam.name,
    createdBy: 'Smoke User',
  });
  created.push(plainRejected.id);

  let caught = null;
  try {
    await caseRepository.transferCase(
      plainRejected.id,
      {
        toTeamId: targetTeam.id,
        reason: 'L2 lazım',
        transferredBy: 'smoke-user-id',
        transferredByName: 'Smoke User',
        smartTicketTransfer: {
          transferNote: 'Non-ST üzerinde olmamalı',
          composedSummary: 'irrelevant',
        },
      },
      [companyId],
    );
  } catch (err) {
    caught = err;
  }
  if (caught && (caught.code === 'smart_ticket_transfer_requires_opening' || /smart_ticket_transfer_requires_opening|Smart Ticket devir/.test(caught?.message ?? ''))) {
    ok('12) Non-ST Case smartTicketTransfer ile reddedildi', caught.code ?? caught.message);
  } else {
    bad('12) Defense in depth', caught ? `${caught.code}: ${caught.message}` : 'reject olmadı');
  }
} catch (err) {
  bad('12) Setup', err?.message ?? String(err));
}

// ─── 13) transferNote zorunluluğu ──────────────────────────────────────

console.log('');
console.log('── 13) transferNote zorunluluğu ────────────────────────');

let stForNoteReject = null;
try {
  stForNoteReject = await caseRepository.create({
    title: `[smoke] ST note req ${Date.now().toString(36)}`,
    description: 'ST note required smoke.',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Web',
    companyId,
    companyName,
    category: 'Akıllı Ticket',
    subCategory: 'Genel',
    requestType: 'Talep',
    assignedTeamId: sourceTeam.id,
    assignedTeamName: sourceTeam.name,
    customFields: { smartTicket: OPENING },
    createdBy: 'Smoke User',
  });
  created.push(stForNoteReject.id);
  let caught = null;
  try {
    await caseRepository.transferCase(
      stForNoteReject.id,
      {
        toTeamId: targetTeam.id,
        reason: 'L2',
        transferredBy: 'smoke-user-id',
        transferredByName: 'Smoke User',
        smartTicketTransfer: { transferNote: '   ', composedSummary: 'x' },
      },
      [companyId],
    );
  } catch (err) {
    caught = err;
  }
  if (caught && (caught.code === 'smart_ticket_transfer_note_required' || /transferNote|Devir notu zorunlu/.test(caught?.message ?? ''))) {
    ok('13) Boş transferNote reddedildi', caught.code ?? caught.message);
  } else {
    bad('13) transferNote validation', caught ? `${caught.code}: ${caught.message}` : 'reject olmadı');
  }
} catch (err) {
  bad('13) Setup', err?.message ?? String(err));
}

// ─── 15) Boş step listesi composer null döner ──────────────────────────

console.log('');
console.log('── 15) Empty step compose ────────────────────────────');
let emptyCase = null;
try {
  emptyCase = await caseRepository.create({
    title: `[smoke] empty steps ${Date.now().toString(36)}`,
    description: 'Empty steps smoke.',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Web',
    companyId,
    companyName,
    category: 'Genel',
    subCategory: 'Genel',
    requestType: 'Talep',
    assignedTeamId: sourceTeam.id,
    assignedTeamName: sourceTeam.name,
    createdBy: 'Smoke User',
  });
  created.push(emptyCase.id);
  const empty = await composeTransferBriefFromSteps(emptyCase.id);
  if (empty?.composedSummary === null && Array.isArray(empty?.attemptedStepIds) && empty.attemptedStepIds.length === 0 && empty?.stepOutcomesSummary?.total === 0) {
    ok('15) Step yoksa composedSummary=null + total=0');
  } else {
    bad('15) Empty compose', JSON.stringify(empty));
  }
} catch (err) {
  bad('15) Empty compose exception', err?.message ?? String(err));
}

// ─── 16-19) Madde 4 — Transfer + priority change ──────────────────────

console.log('');
console.log('── 16-19) Transfer priority change ─────────────────────');

let stPriCase = null;
try {
  stPriCase = await caseRepository.create({
    title: `[smoke] ST priority ${Date.now().toString(36)}`,
    description: 'ST priority change smoke.',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Web',
    companyId,
    companyName,
    category: 'Akıllı Ticket',
    subCategory: 'Genel',
    requestType: 'Talep',
    assignedTeamId: sourceTeam.id,
    assignedTeamName: sourceTeam.name,
    customFields: { smartTicket: OPENING },
    createdBy: 'Smoke User',
  });
  created.push(stPriCase.id);

  // 16) Priority değişimi ile transfer.
  const r = await caseRepository.transferCase(
    stPriCase.id,
    {
      toTeamId: targetTeam.id,
      reason: 'Eskalasyon — kritik',
      transferredBy: 'smoke-user-id',
      transferredByName: 'Smoke User',
      smartTicketTransfer: {
        transferNote: 'L2: kritik müşteri etkisi, hızlı bakar mısın?',
        composedSummary: 'L1 KB önerilerini denedi, çözmedi.',
      },
      priority: 'Critical',
    },
    [companyId],
  );
  const after = await prisma.case.findUnique({
    where: { id: stPriCase.id },
    select: { priority: true },
  });
  if (r?.case && after?.priority === 'Critical') {
    ok('16) Transfer priority Critical olarak güncellendi');
  } else {
    bad('16) Priority update', `case priority=${after?.priority}`);
  }

  // 17) Ayrı FieldUpdate activity row mevcut.
  const priActivity = await prisma.caseActivity.findFirst({
    where: { caseId: stPriCase.id, actionType: 'FieldUpdate', fieldName: 'priority' },
    select: { fromValue: true, toValue: true, action: true },
  });
  if (priActivity?.toValue === 'Critical' && priActivity?.fromValue === 'Medium') {
    ok('17) FieldUpdate priority activity row (Medium → Critical)');
  } else {
    bad('17) Priority activity row', JSON.stringify(priActivity));
  }

  // 18) Aynı priority ile çağrı → no-op (ek FieldUpdate yazılmaz).
  await caseRepository.transferCase(
    stPriCase.id,
    {
      toTeamId: sourceTeam.id, // geri devret
      reason: 'no-op priority test',
      transferredBy: 'smoke-user-id',
      transferredByName: 'Smoke User',
      smartTicketTransfer: { transferNote: 'no-op pri', composedSummary: '...' },
      priority: 'Critical', // mevcut ile aynı
    },
    [companyId],
  );
  const pricount = await prisma.caseActivity.count({
    where: { caseId: stPriCase.id, actionType: 'FieldUpdate', fieldName: 'priority' },
  });
  if (pricount === 1) {
    ok('18) Aynı priority ile transfer → ek FieldUpdate row yazılmadı (no-op)');
  } else {
    bad('18) Duplicate priority row', `count=${pricount}`);
  }

  // 19) Geçersiz priority → error.
  const errCase = await caseRepository.create({
    title: `[smoke] invalid pri ${Date.now().toString(36)}`,
    description: 'Invalid priority smoke.',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Web',
    companyId,
    companyName,
    category: 'Akıllı Ticket',
    subCategory: 'Genel',
    requestType: 'Talep',
    assignedTeamId: sourceTeam.id,
    assignedTeamName: sourceTeam.name,
    customFields: { smartTicket: OPENING },
    createdBy: 'Smoke User',
  });
  created.push(errCase.id);
  const errR = await caseRepository.transferCase(
    errCase.id,
    {
      toTeamId: targetTeam.id,
      reason: 'invalid priority test',
      transferredBy: 'smoke-user-id',
      transferredByName: 'Smoke User',
      smartTicketTransfer: { transferNote: 'x', composedSummary: 'x' },
      priority: 'BOGUS', // geçersiz
    },
    [companyId],
  );
  if (errR?.error === 'invalid_input' && /Geçersiz priority/.test(errR?.message ?? '')) {
    ok('19) Geçersiz priority reject edildi (invalid_input)');
  } else {
    bad('19) Invalid priority should reject', JSON.stringify(errR));
  }
} catch (err) {
  bad('16-19) Transfer priority exception', err?.message ?? String(err));
}

// ─── Cleanup ────────────────────────────────────────────────────────────

if (!KEEP) {
  console.log('');
  console.log('── Cleanup ────────────────────────────────────────────');
  for (const id of created) {
    try {
      await prisma.caseSolutionStep.deleteMany({ where: { caseId: id } });
      await prisma.caseTransfer.deleteMany({ where: { caseId: id } });
      await prisma.caseActivity.deleteMany({ where: { caseId: id } });
      await prisma.case.delete({ where: { id } });
    } catch (err) {
      console.log(`⊘ cleanup ${id}: ${err?.message}`);
    }
  }
  console.log(`   ${created.length} case temizlendi`);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}  SKIP=${skip}`);

await prisma.$disconnect().catch(() => {});
process.exit(fail > 0 ? 1 : 0);
