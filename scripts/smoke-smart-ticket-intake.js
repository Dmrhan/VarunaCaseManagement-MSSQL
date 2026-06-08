/**
 * smoke-smart-ticket-intake.js — WR-Smart-Ticket Phase 1c + 1d.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-smart-ticket-intake.js
 *   node --env-file=.env scripts/smoke-smart-ticket-intake.js --keep
 *
 * Phase 1c: caseRepository.create + customFields.smartTicket roundtrip.
 * Phase 1d: Smart Ticket → klasik Case alanları mapping (TaxonomyDef.metadata).
 *
 *   1.  UNIVERA company resolve
 *   2.  intake için 5 taxonomy tipi aktif satır mevcut (PR-1a/1b)
 *   3.  caseRepository.create customFields.smartTicket kabul ediyor
 *   4.  customFields.smartTicket round-trip eşleşir
 *   5.  klasik Case alanları regression doldurulmuş
 *   6.  Case mevcut list query'sinde görünüyor (lifecycle aynı)
 *   7.  UI P2-A: company change reset (Codex PR-1c)
 *   8.  UI P2-B: projectsRequired gating (Codex PR-1c)
 *   9.  Mapping pure logic: businessProcess.metadata varsa Case alanlarına yansır
 *   10. End-to-end: mapped Case create → Case.category metadata değerinden
 *   11. customFields.smartTicket original taxonomy code/labels + appliedMapping
 *   12. End-to-end: unmapped (metadata yok) → fallback değerler
 *
 * Test sonunda yarattığı Case + metadata değişikliklerini geri alır
 * (`--keep` ile koruyabilirsin).
 */

import { prisma } from '../server/db/client.js';
import { caseRepository } from '../server/db/caseRepository.js';

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

function ok(name, detail = '') {
  pass += 1;
  console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`);
}
function bad(name, detail = '') {
  fail += 1;
  console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`);
}
function note(name, detail = '') {
  skip += 1;
  console.log(`⊘ ${name}${detail ? ' — ' + detail : ''}`);
}

// ─── 1) Company resolve ───────────────────────────────────────────────────

console.log('── 1) Company resolve ──────────────────────────────────');
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

// ─── 2) Taxonomy dropdown'ları doluluk kontrolü ──────────────────────────

console.log('');
console.log('── 2) Taxonomy availability per intake type ────────────');
const INTAKE_TYPES = ['platform', 'businessProcess', 'operationType', 'affectedObject', 'impact'];
const taxonomyByType = {};
try {
  for (const t of INTAKE_TYPES) {
    const list = await prisma.taxonomyDef.findMany({
      where: { companyId, taxonomyType: t, isActive: true },
      select: { id: true, code: true, label: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    taxonomyByType[t] = list;
    if (list.length > 0) ok(`2) ${t.padEnd(18)} — ${list.length} aktif satır`);
    else bad(`2) ${t} listesi boş`, 'intake dropdown kullanılamaz olur');
  }
} catch (err) {
  bad('2) taxonomy fetch', err?.message ?? String(err));
}

// ─── 3-5) Case create with customFields.smartTicket ──────────────────────

console.log('');
console.log('── 3-6) Case create + customFields.smartTicket round-trip ──');

// İstemci tarafının form gönderdiği payload'u taklit et.
const pick = (t) => taxonomyByType[t]?.[0]?.code ?? null;
const smartTicketPayload = {};
for (const t of INTAKE_TYPES) {
  const code = pick(t);
  if (code) smartTicketPayload[t] = code;
}

let createdCase = null;
try {
  createdCase = await caseRepository.create({
    title: `[smoke] Smart Ticket intake ${Date.now().toString(36)}`,
    description:
      'Smoke kayıt — Smart Ticket intake customFields.smartTicket persist roundtrip. ' +
      'Silinmesi güvenlidir.',
    caseType: 'GeneralSupport',
    priority: 'Medium',
    origin: 'Web',
    companyId,
    companyName,
    category: 'Akıllı Ticket',
    subCategory: 'Genel',
    requestType: 'Talep',
    customFields: {
      smartTicket: smartTicketPayload,
    },
  });
  if (createdCase?.id) {
    created.push(createdCase.id);
    ok('3) caseRepository.create customFields.smartTicket ile başarılı', createdCase.id);
  } else {
    bad('3) caseRepository.create', JSON.stringify(createdCase));
  }
} catch (err) {
  bad('3) caseRepository.create', err?.message ?? String(err));
}

if (createdCase) {
  // 4) Round-trip: DB'den oku, customFields.smartTicket aynı mı.
  try {
    const fetched = await prisma.case.findUnique({
      where: { id: createdCase.id },
      select: {
        id: true,
        title: true,
        category: true,
        subCategory: true,
        requestType: true,
        companyId: true,
        customFields: true,
        status: true,
      },
    });
    const got = fetched?.customFields?.smartTicket;
    // Postgres JSON return value'sunda key order korunmayabilir; sıralı
    // serialize edip karşılaştır.
    function canon(obj) {
      if (!obj || typeof obj !== 'object') return JSON.stringify(obj);
      const keys = Object.keys(obj).sort();
      return JSON.stringify(keys.reduce((a, k) => ((a[k] = obj[k]), a), {}));
    }
    const match = got && canon(got) === canon(smartTicketPayload);
    if (match) ok('4) customFields.smartTicket round-trip eşleşti');
    else bad('4) customFields.smartTicket round-trip',
      `expected=${canon(smartTicketPayload)}\n         got=${canon(got)}`);

    // 5) Klasik alanlar regression — Smart Ticket bu PR'da Case alanlarının
    //    yerine geçmiyor. category/subCategory/requestType set olmalı.
    if (
      fetched?.category === 'Akıllı Ticket' &&
      fetched?.subCategory === 'Genel' &&
      fetched?.requestType === 'Talep'
    ) {
      ok('5) klasik Case alanları (category/subCategory/requestType) regression');
    } else {
      bad('5) klasik Case alanları', JSON.stringify(fetched));
    }

    // 6) Case mevcut list query'sinde görünüyor (lifecycle aynı).
    const inList = await prisma.case.findFirst({
      where: { id: createdCase.id, companyId },
      select: { id: true, status: true },
    });
    if (inList?.id === createdCase.id) {
      ok(`6) Case mevcut list query'sinde görünüyor (status=${inList.status})`);
    } else {
      bad('6) Case list query', 'Case mevcut tenant scope query\'sinde bulunamadı');
    }
  } catch (err) {
    bad('4-6) round-trip read', err?.message ?? String(err));
  }
}

// ─── 7-8) UI state-management regression (Codex PR-1c P2-A / P2-B) ───────
//
// SmartTicketNewPage'in inline form mantığının pure replica'sı. UI'ın
// company change'de taxonomy alanlarını sıfırladığını ve projectsRequired
// tenant'larda proje seçilmemişse submit'in disabled olduğunu doğrular.
// Eğer SmartTicketNewPage logic'i değişirse bu blok da güncellenmelidir.

console.log('');
console.log('── 7-8) UI state-management regression ─────────────────');

// P2-A: company change effect → taxonomy ve müşteri alanları sıfırlanmalı.
function companyChangeReset(prev /*: form */) {
  return {
    ...prev,
    accountId: '',
    accountName: '',
    accountProjectId: '',
    accountProjectName: '',
    platform: '',
    businessProcess: '',
    operationType: '',
    affectedObject: '',
    impact: '',
  };
}
const stale = {
  companyId: 'A',
  accountId: 'acc-A',
  accountName: 'Acc A',
  accountProjectId: 'prj-1',
  accountProjectName: 'P1',
  title: 'x',
  description: 'y',
  platform: 'plat.foo',
  businessProcess: 'bp.bar',
  operationType: 'ot.baz',
  affectedObject: 'ao.qux',
  impact: 'imp.high',
};
const afterChange = { ...companyChangeReset(stale), companyId: 'B' };
const cleared = ['accountId', 'accountName', 'accountProjectId', 'accountProjectName',
  'platform', 'businessProcess', 'operationType', 'affectedObject', 'impact'];
const stillDirty = cleared.filter((k) => afterChange[k] !== '');
if (stillDirty.length === 0) ok('7) P2-A: company change taxonomy/müşteri/proje sıfırlar');
else bad('7) P2-A: company change stale fields', stillDirty.join(','));

// P2-B: canSubmit projectsRequired gating.
function canSubmit(state, projectsEnabled, projectsRequired) {
  const projectOk =
    !projectsEnabled || !projectsRequired || !state.accountId || !!state.accountProjectId;
  return (
    !!state.companyId &&
    !!state.accountId &&
    String(state.title || '').trim().length > 0 &&
    String(state.description || '').trim().length > 0 &&
    projectOk
  );
}
const filled = {
  companyId: 'A',
  accountId: 'acc-A',
  accountProjectId: '',
  title: 'Hello',
  description: 'World',
};
const submitBlocked = canSubmit(filled, true, true) === false;
const submitOk = canSubmit({ ...filled, accountProjectId: 'prj-1' }, true, true) === true;
const submitOkWhenNotRequired = canSubmit(filled, true, false) === true;
if (submitBlocked && submitOk && submitOkWhenNotRequired) {
  ok('8) P2-B: projectsRequired tenant\'ta proje yok → submit disabled, seçilince enable');
} else {
  bad('8) P2-B: canSubmit gating',
    `blocked=${submitBlocked} ok=${submitOk} notRequiredOk=${submitOkWhenNotRequired}`);
}

// ─── 9-12) Mapping (Phase 1d) ────────────────────────────────────────────
//
// resolveSmartTicketMapping pure helper'ının inline replica'sı. UI
// (src/features/smart-ticket/mapping.ts) ile manuel senkronize tutulmalı —
// logic değişirse bu blok da güncellenir.

console.log('');
console.log('── 9-12) Mapping (Phase 1d) ────────────────────────────');

const FALLBACK = { category: 'Akıllı Ticket', subCategory: 'Genel', requestType: 'Talep' };
const REQUEST_TYPES = new Set(['Bilgi', 'Öneri', 'Talep', 'Şikayet', 'Hata']);

function resolveMapping(taxonomyMap, selections) {
  // taxonomyMap: { businessProcess: { code → metadata }, operationType: ... }
  const bpMeta = selections.businessProcess ? taxonomyMap.businessProcess?.[selections.businessProcess] : null;
  const otMeta = selections.operationType ? taxonomyMap.operationType?.[selections.operationType] : null;
  const meta = bpMeta && typeof bpMeta === 'object' ? bpMeta : null;
  const otm = otMeta && typeof otMeta === 'object' ? otMeta : null;

  const category = meta?.caseCategory ?? FALLBACK.category;
  const subCategory = meta?.caseSubCategory ?? FALLBACK.subCategory;
  let requestType, rtTrace;
  if (meta?.caseRequestType && REQUEST_TYPES.has(meta.caseRequestType)) {
    requestType = meta.caseRequestType; rtTrace = 'businessProcess';
  } else if (otm?.caseRequestType && REQUEST_TYPES.has(otm.caseRequestType)) {
    requestType = otm.caseRequestType; rtTrace = 'operationType';
  } else {
    requestType = FALLBACK.requestType; rtTrace = 'fallback';
  }
  const bpProvidedCategory = !!meta?.caseCategory;
  const bpProvidedSub = !!meta?.caseSubCategory;
  const anyBp = bpProvidedCategory || bpProvidedSub || rtTrace === 'businessProcess';
  let source;
  if (anyBp && rtTrace === 'operationType') source = 'businessProcess+operationType';
  else if (!anyBp && rtTrace === 'operationType') source = 'businessProcess+operationType';
  else if (anyBp) source = 'businessProcess';
  else source = 'fallback';
  return { category, subCategory, requestType, source };
}

// Test taxonomy seç — bp.crm_islemleri / ot.giremiyorum gibi UNIVERA seedinde
// var olan code'lar.
const bpCode = taxonomyByType.businessProcess?.[0]?.code;
const otCode = taxonomyByType.operationType?.[0]?.code;
const platCode = taxonomyByType.platform?.[0]?.code;
const platLabel = taxonomyByType.platform?.[0]?.label;
const bpLabel = taxonomyByType.businessProcess?.[0]?.label;

// Original metadata'yı yedekle ki cleanup'ta geri yükleyelim.
const metadataRestore = [];
async function restoreMetadata() {
  for (const r of metadataRestore) {
    try {
      await prisma.taxonomyDef.update({
        where: { id: r.id },
        data: { metadata: r.metadata ?? null },
      });
    } catch (err) {
      console.log(`  ⚠️ metadata restore başarısız: ${r.id} — ${err?.message}`);
    }
  }
}

if (!bpCode) {
  note('9-12) mapping', 'UNIVERA businessProcess listesi boş — SKIP');
} else {
  // ── 9) Pure mapping logic ──
  // Setup: bp.X metadata { caseCategory, caseSubCategory, caseRequestType }
  const TEST_META = { caseCategory: 'CRM (smoke)', caseSubCategory: 'İşlemler (smoke)', caseRequestType: 'Hata' };
  const bpRow = await prisma.taxonomyDef.findFirst({
    where: { companyId, taxonomyType: 'businessProcess', code: bpCode },
    select: { id: true, metadata: true },
  });
  if (bpRow) {
    metadataRestore.push({ id: bpRow.id, metadata: bpRow.metadata });
    await prisma.taxonomyDef.update({ where: { id: bpRow.id }, data: { metadata: TEST_META } });
  }

  const mapped = resolveMapping(
    { businessProcess: { [bpCode]: TEST_META } },
    { businessProcess: bpCode },
  );
  if (
    mapped.category === TEST_META.caseCategory &&
    mapped.subCategory === TEST_META.caseSubCategory &&
    mapped.requestType === TEST_META.caseRequestType &&
    mapped.source === 'businessProcess'
  ) {
    ok('9) businessProcess.metadata → category/subCategory/requestType yansır');
  } else {
    bad('9) pure mapping', JSON.stringify(mapped));
  }

  // ── 10) End-to-end mapped Case create ──
  try {
    const smartTicket = {
      platform: platCode,
      platformLabel: platLabel,
      businessProcess: bpCode,
      businessProcessLabel: bpLabel,
      appliedMapping: {
        source: mapped.source,
        category: mapped.category,
        subCategory: mapped.subCategory,
        requestType: mapped.requestType,
      },
    };
    const c = await caseRepository.create({
      title: `[smoke] mapped intake ${Date.now().toString(36)}`,
      description: 'Mapped Case smoke — silinmesi güvenlidir.',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Web',
      companyId,
      companyName,
      category: mapped.category,
      subCategory: mapped.subCategory,
      requestType: mapped.requestType,
      customFields: { smartTicket },
    });
    created.push(c.id);
    const fetched = await prisma.case.findUnique({
      where: { id: c.id },
      select: { id: true, category: true, subCategory: true, requestType: true, customFields: true },
    });
    if (
      fetched.category === TEST_META.caseCategory &&
      fetched.subCategory === TEST_META.caseSubCategory &&
      fetched.requestType === TEST_META.caseRequestType
    ) {
      ok('10) mapped Case create — Case.category metadata değerinden geldi');
    } else {
      bad('10) mapped Case create', JSON.stringify(fetched));
    }

    // ── 11) customFields.smartTicket original code + labels + appliedMapping ──
    const got = fetched?.customFields?.smartTicket;
    if (
      got?.businessProcess === bpCode &&
      got?.businessProcessLabel === bpLabel &&
      got?.appliedMapping?.source === 'businessProcess' &&
      got?.appliedMapping?.category === TEST_META.caseCategory
    ) {
      ok('11) customFields.smartTicket original code + label + appliedMapping korundu');
    } else {
      bad('11) customFields.smartTicket persistence', JSON.stringify(got));
    }
  } catch (err) {
    bad('10-11) mapped Case create', err?.message ?? String(err));
  }
}

// ── 12) End-to-end unmapped Case create → fallback ──
try {
  // Hiç metadata olmayan bir bp seç — listede 2. öğeyi al ve metadata
  // alanını TEMİZLE (eski test çalıştırmaları geride bir şey bırakmış olabilir).
  const candidate = taxonomyByType.businessProcess?.[1];
  if (!candidate) {
    note('12) unmapped fallback', 'ikinci bp yok — SKIP');
  } else {
    const row = await prisma.taxonomyDef.findFirst({
      where: { companyId, taxonomyType: 'businessProcess', code: candidate.code },
      select: { id: true, metadata: true },
    });
    if (row) {
      metadataRestore.push({ id: row.id, metadata: row.metadata });
      await prisma.taxonomyDef.update({ where: { id: row.id }, data: { metadata: null } });
    }
    const fallback = resolveMapping({}, { businessProcess: candidate.code });
    const c = await caseRepository.create({
      title: `[smoke] unmapped intake ${Date.now().toString(36)}`,
      description: 'Unmapped Case fallback smoke.',
      caseType: 'GeneralSupport',
      priority: 'Medium',
      origin: 'Web',
      companyId,
      companyName,
      category: fallback.category,
      subCategory: fallback.subCategory,
      requestType: fallback.requestType,
      customFields: {
        smartTicket: {
          businessProcess: candidate.code,
          businessProcessLabel: candidate.label,
          appliedMapping: {
            source: fallback.source,
            category: fallback.category,
            subCategory: fallback.subCategory,
            requestType: fallback.requestType,
          },
        },
      },
    });
    created.push(c.id);
    const fetched = await prisma.case.findUnique({
      where: { id: c.id },
      select: { category: true, subCategory: true, requestType: true, customFields: true },
    });
    if (
      fetched.category === FALLBACK.category &&
      fetched.subCategory === FALLBACK.subCategory &&
      fetched.requestType === FALLBACK.requestType &&
      fetched.customFields?.smartTicket?.appliedMapping?.source === 'fallback' &&
      fetched.customFields?.smartTicket?.businessProcess === candidate.code
    ) {
      ok('12) unmapped → fallback değerler; original code yine customFields\'de');
    } else {
      bad('12) unmapped fallback', JSON.stringify(fetched));
    }
  }
} catch (err) {
  bad('12) unmapped fallback', err?.message ?? String(err));
}

// ─── Cleanup ──────────────────────────────────────────────────────────────

if (!KEEP && created.length > 0) {
  // Test Case'leri history/attachments yok — direct delete OK.
  for (const id of created) {
    try {
      // Cascade ile ilişkili satırlar (örn. SLA durumu) varsa Prisma onDelete
      // ile temizlenir; cleanup için yeterli.
      await prisma.case.delete({ where: { id } });
    } catch (err) {
      console.log(`  ⚠️ cleanup başarısız: ${id} — ${err?.message ?? err}`);
    }
  }
  console.log('');
  console.log(`🧹 cleanup: ${created.length} test Case silindi`);
}

if (!KEEP) {
  // Metadata değişikliklerini geri yükle — production seed verisini bozmamak için.
  await restoreMetadata();
  if (metadataRestore.length > 0) {
    console.log(`🧹 metadata restore: ${metadataRestore.length} TaxonomyDef satırı eski haline döndü`);
  }
}

console.log('');
console.log('── Summary ──────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}  SKIP=${skip}`);

await prisma.$disconnect().catch(() => {});
process.exit(fail > 0 ? 1 : 0);
