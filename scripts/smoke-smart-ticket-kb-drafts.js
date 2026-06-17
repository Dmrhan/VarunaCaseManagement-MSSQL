/**
 * smoke-smart-ticket-kb-drafts.js — Madde 2 backend + static guard.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-smart-ticket-kb-drafts.js
 *
 * Backend:
 *   - extractAiDrafts multi-format parser
 *   - persistSmartTicketAiDrafts Smart Ticket case'ine yazar, klasik
 *     case'lerde no-op döner
 *   - aiDrafts merge mevcut opening / closure / transferContext'i bozmaz
 *
 * Static:
 *   - KbDraftCard bileşeni mevcut
 *   - SmartTicketNewPage Stage 3 closure + transfer kart mount
 *   - CaseDetailPage Detay sekmesinde KbDraftSection
 *   - import-ai-suggested route extractAiDrafts + persist çağrısı
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../server/db/client.js';
import { caseRepository } from './_actor-fixture.js';
import { extractAiDrafts } from '../server/db/solutionStepRepository.js';

const ROOT = resolve(import.meta.dirname, '..');
const CARD = resolve(ROOT, 'src/features/cases/KbDraftCard.tsx');
const PAGE = resolve(ROOT, 'src/features/smart-ticket/SmartTicketNewPage.tsx');
const DETAIL = resolve(ROOT, 'src/features/cases/CaseDetailPage.tsx');
const ROUTE = resolve(ROOT, 'server/routes/cases.js');

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

// ─── 1) extractAiDrafts multi-format parser ──────────────────────────

console.log('── 1) extractAiDrafts parser ───────────────────────────');

const stringFormat = {
  analysis: {
    engineeringHandoff: 'Cache temizle, JWT yenile, log incele.',
    customerReplyDraft: 'Sayın müşterimiz, bildiriminiz alındı...',
  },
};
const a = extractAiDrafts(stringFormat);
if (
  a.engineeringHandoff === 'Cache temizle, JWT yenile, log incele.' &&
  a.customerReplyDraft === 'Sayın müşterimiz, bildiriminiz alındı...'
) {
  ok('1a) String format — engineeringHandoff + customerReplyDraft');
} else {
  bad('1a) String format', JSON.stringify(a));
}

const objectFormat = {
  analysis: {
    engineeringHandoff: { text: 'Object text path' },
    customerReplyDraft: { content: 'Object content path' },
  },
};
const b = extractAiDrafts(objectFormat);
if (b.engineeringHandoff === 'Object text path' && b.customerReplyDraft === 'Object content path') {
  ok('1b) Object format — text/content path fallback');
} else {
  bad('1b) Object format', JSON.stringify(b));
}

const emptyAnalysis = extractAiDrafts({ analysis: { suggestedSteps: ['x'] } });
if (Object.keys(emptyAnalysis).length === 0) {
  ok('1c) Boş draft alanları → boş object');
} else {
  bad('1c) Empty → non-empty', JSON.stringify(emptyAnalysis));
}

const noAnalysis = extractAiDrafts({ noAnalysisField: true });
if (Object.keys(noAnalysis).length === 0) {
  ok('1d) analysis yoksa → boş object');
} else {
  bad('1d) noAnalysis', JSON.stringify(noAnalysis));
}

// ─── 2) Company resolve ──────────────────────────────────────────────

console.log('');
console.log('── 2) Company resolve ──────────────────────────────────');
let companyId = null;
let companyName = null;
try {
  const c = await prisma.company.findUnique({ where: { name: COMPANY }, select: { id: true, name: true } });
  if (c) { companyId = c.id; companyName = c.name; }
} catch (err) {
  note('DB skip', err?.message);
}
if (!companyId) {
  console.log(`PASS=${pass} FAIL=${fail} SKIP=${skip + 1}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}
ok('2) UNIVERA resolve', companyId);

// ─── 3) Smart Ticket Case + persistSmartTicketAiDrafts ───────────────

console.log('');
console.log('── 3) persistSmartTicketAiDrafts ───────────────────────');

const OPENING = {
  platform: 'plat.test',
  platformLabel: 'Test Platform',
};
const OTHER_CF = { someOtherField: 'should_survive' };

let stCase = null;
try {
  stCase = await caseRepository.create({
    title: `[smoke] ST drafts ${Date.now().toString(36)}`,
    description: 'ST drafts smoke.',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Web',
    companyId,
    companyName,
    category: 'Akıllı Ticket',
    subCategory: 'Genel',
    requestType: 'Talep',
    customFields: { smartTicket: OPENING, ...OTHER_CF },
    createdBy: 'Smoke User',
  });
  created.push(stCase.id);

  const r = await caseRepository.persistSmartTicketAiDrafts(
    stCase.id,
    { engineeringHandoff: 'Token rotate et', customerReplyDraft: 'Sayın müşteri...' },
    [companyId],
  );
  if (r?.persisted === true) {
    ok('3a) persistSmartTicketAiDrafts başarılı (persisted=true)');
  } else {
    bad('3a) persist', JSON.stringify(r));
  }

  const after = await prisma.case.findUnique({
    where: { id: stCase.id },
    select: { customFields: true },
  });
  const drafts = after?.customFields?.smartTicket?.aiDrafts;
  if (
    drafts?.engineeringHandoff === 'Token rotate et' &&
    drafts?.customerReplyDraft === 'Sayın müşteri...' &&
    drafts?.source === 'external_kb' &&
    drafts?.version === 1 &&
    typeof drafts?.capturedAt === 'string'
  ) {
    ok('3b) aiDrafts roundtrip (engineering + customer + meta)');
  } else {
    bad('3b) roundtrip', JSON.stringify(drafts));
  }

  // 3c) Mevcut opening korundu.
  const st = after?.customFields?.smartTicket;
  if (st?.platform === OPENING.platform && st?.platformLabel === OPENING.platformLabel) {
    ok('3c) Smart Ticket opening alanları korundu');
  } else {
    bad('3c) opening', JSON.stringify(st));
  }

  // 3d) Diğer customFields.
  if (after?.customFields?.someOtherField === 'should_survive') {
    ok('3d) Diğer customFields anahtarları korundu');
  } else {
    bad('3d) other customFields', JSON.stringify(after?.customFields));
  }
} catch (err) {
  bad('3) Smart Ticket persist', err?.message ?? String(err));
}

// ─── 4) Klasik (non-ST) Case → no-op ────────────────────────────────

console.log('');
console.log('── 4) Non-ST Case persist → no-op ──────────────────────');

let plainCase = null;
try {
  plainCase = await caseRepository.create({
    title: `[smoke] non-ST drafts ${Date.now().toString(36)}`,
    description: 'Non-ST drafts smoke.',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Telefon',
    companyId,
    companyName,
    category: 'Genel',
    subCategory: 'Genel',
    requestType: 'Talep',
    createdBy: 'Smoke User',
  });
  created.push(plainCase.id);
  const r = await caseRepository.persistSmartTicketAiDrafts(
    plainCase.id,
    { engineeringHandoff: 'x', customerReplyDraft: 'y' },
    [companyId],
  );
  // No smartTicket opening → merge null döner; persisted=false beklenir.
  if (r?.persisted === false) {
    ok('4a) Non-ST case → persisted=false (no-op)');
  } else {
    bad('4a) Non-ST persist', JSON.stringify(r));
  }
  const after = await prisma.case.findUnique({
    where: { id: plainCase.id },
    select: { customFields: true },
  });
  if (after?.customFields == null) {
    ok('4b) Non-ST customFields dokunulmadı');
  } else {
    bad('4b) non-ST customFields', JSON.stringify(after?.customFields));
  }
} catch (err) {
  bad('4) non-ST persist', err?.message ?? String(err));
}

// ─── 5) Boş drafts → no-op ───────────────────────────────────────────

console.log('');
console.log('── 5) Boş drafts → no-op ───────────────────────────────');
if (stCase) {
  const r = await caseRepository.persistSmartTicketAiDrafts(
    stCase.id,
    { engineeringHandoff: '   ', customerReplyDraft: undefined },
    [companyId],
  );
  if (r?.persisted === false) {
    ok('5) Boş/whitespace drafts → persisted=false (no overwrite)');
  } else {
    bad('5) Empty drafts', JSON.stringify(r));
  }
}

// ─── 6-12) Static UI invariant ───────────────────────────────────────

console.log('');
console.log('── 6-12) Static UI invariant ───────────────────────────');

for (const p of [CARD, PAGE, DETAIL, ROUTE]) {
  if (!existsSync(p)) { bad(`${p} YOK`); }
}
const cardSrc = readFileSync(CARD, 'utf8');
const pageSrc = readFileSync(PAGE, 'utf8');
const detailSrc = readFileSync(DETAIL, 'utf8');
const routeSrc = readFileSync(ROUTE, 'utf8');

if (/export function KbDraftCard\(/.test(cardSrc)) {
  ok('6) KbDraftCard bileşeni export edildi');
} else {
  bad('6) KbDraftCard export eksik');
}

if (/variant\s*===\s*['"]transfer['"][\s\S]{0,100}?customerReplyDraft|showCustomer\s*=\s*variant\s*!==\s*['"]transfer['"]/.test(cardSrc)) {
  ok('7) Transfer variant\'ında customerReplyDraft gizli');
} else {
  bad('7) Transfer customerReplyDraft gizleme eksik');
}

if (/navigator\.clipboard\.writeText\(content\)/.test(cardSrc)) {
  ok('8) Kopyala buton clipboard\'a yazıyor');
} else {
  bad('8) Clipboard write eksik');
}

if (/<KbDraftCard\s+item=\{createdCase\}\s+variant="closure"/.test(pageSrc)) {
  ok('9) Stage 3 closure KbDraftCard mount');
} else {
  bad('9) Closure mount eksik');
}

if (/<KbDraftCard\s+item=\{createdCase\}\s+variant="transfer"/.test(pageSrc)) {
  ok('10) Stage 3 transfer KbDraftCard mount');
} else {
  bad('10) Transfer mount eksik');
}

if (/<KbDraftSection\s+item=\{item\}\s*\/>/.test(detailSrc) && /function KbDraftSection\(/.test(detailSrc)) {
  ok('11) Case Detail KbDraftSection wrapper + mount');
} else {
  bad('11) Case Detail wrapper/mount eksik');
}

if (/extractAiDrafts\(analyzeResponse\)[\s\S]{0,300}?persistSmartTicketAiDrafts/.test(routeSrc)) {
  ok('12) import-ai-suggested route extractAiDrafts + persist çağrısı');
} else {
  bad('12) Route persist call eksik');
}

// 13) Codex P2 (main #459) — handleCreateAndContinue import sonrası
//     caseService.get(created.id) ile createdCase yenileniyor. Aksi
//     halde KbDraftCard stale customFields ile render eder ve
//     persistSmartTicketAiDrafts'in yazdığı aiDrafts UI'a yansımaz.
if (
  /importAiSuggestedSolutionSteps\([\s\S]{0,400}?caseService\.get\(created\.id\)/.test(pageSrc) &&
  /if\s*\(refreshed\)\s*setCreatedCase\(refreshed\)/.test(pageSrc)
) {
  ok('13) Codex P2 (main #459) — Stage 1→2 import sonrası createdCase fresh fetch');
} else {
  bad('13) Stage 1→2 fresh fetch eksik');
}

// 14) Aynı pattern Stage2DescriptionEditor submit'inde de uygulanmalı —
//     "Kaydet ve Yeniden Sor" sonrası import aiDrafts persist eder,
//     parent'a fresh case geçirmek için get çağrısı.
const editorBlock = pageSrc.match(/function\s+Stage2DescriptionEditor[\s\S]+?\n\}\n/);
if (
  editorBlock &&
  /caseService\.get\(updated\.id\)/.test(editorBlock[0]) &&
  /onUpdated\(refreshed\s*\?\?\s*updated\)/.test(editorBlock[0])
) {
  ok('14) Stage2DescriptionEditor submit\'inde de fresh fetch (refreshed ?? updated)');
} else {
  bad('14) Editor submit fresh fetch eksik');
}

// ─── Cleanup ─────────────────────────────────────────────────────────

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
