/**
 * smoke-smart-ticket-intake.js — WR-Smart-Ticket Phase 1c.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-smart-ticket-intake.js
 *   node --env-file=.env scripts/smoke-smart-ticket-intake.js --keep
 *
 * Bu smoke `caseRepository.create` ve mevcut TaxonomyDef'leri doğrudan
 * çalıştırarak Smart Ticket intake'in arkasındaki round-trip'i doğrular:
 *
 *   1. UNIVERA company resolve edilebiliyor mu
 *   2. TaxonomyDef üzerinde her 5 açılış tipi için en az 1 aktif satır var mı
 *      (intake dropdown'ları boş kalmasın — PR-1a/1b'nin sonucu)
 *   3. caseRepository.create customFields.smartTicket payload'unu kabul edip
 *      DB'ye yazıyor mu
 *   4. Round-trip: yarattığı Case'in customFields.smartTicket alanı orijinal
 *      payload ile birebir aynı geliyor mu
 *   5. Case.category/subCategory/requestType klasik akış için doldurulmuş mu
 *      (Smart Ticket alanları klasik alanların yerine geçmiyor — regression)
 *   6. Smart Ticket Case'i mevcut case list query'sinde görünüyor (lifecycle
 *      aynı; smoke list'i tek-Case için filterlar)
 *
 * Test sonunda yarattığı Case kaydını siler (`--keep` ile koruyabilirsin).
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

console.log('');
console.log('── Summary ──────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}  SKIP=${skip}`);

await prisma.$disconnect().catch(() => {});
process.exit(fail > 0 ? 1 : 0);
