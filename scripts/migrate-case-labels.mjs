// Eski taksonomi label snapshot'larını vaka customFields içinde günceller.
// Vakalar closure.rootCauseGroup gibi CODE saklar + ...Label snapshot tutar.
// Snapshot'lar kapatma anındaki (eski) label'ı tutuyor → raporda eski isim
// görünebilir. Bu script snapshot'ları TaxonomyDef'teki GÜNCEL label ile eşler.
//
// Kullanım:
//   node --env-file=.env scripts/migrate-case-labels.mjs            (dry-run)
//   node --env-file=.env scripts/migrate-case-labels.mjs --commit   (yazar)
import { prisma } from '../server/db/client.js';

const commit = process.argv.includes('--commit');
const COMPANY = 'COMP-UNIVERA';

// eski (snapshot'ta görülen) label -> TaxonomyDef code. Sabit eşleme.
const oldToCode = {
  'Cihaz / Mobil Ortam': 'rcg.cihaz_mobil_ortam',
  'Yazılım Hatası': 'rcg.yazilim_hatasi',
  'E-Belge / Entegratör (3. parti)': 'rcg.e_belge_entegrator_3_parti',
  'Eğitim': 'rt.egitim',
  'Ürün geliştirme': 'rt.urun_gelistirme',
  'Kullanım / Eğitim': 'rcg.kullanim_egitim',
};

// label snapshot alanları (smartTicket.closure altında)
const LABEL_FIELDS = ['rootCauseGroupLabel', 'resolutionTypeLabel', 'permanentPreventionLabel'];

const defs = await prisma.taxonomyDef.findMany({
  where: { companyId: COMPANY, code: { in: Object.values(oldToCode) } },
  select: { code: true, label: true },
});
const codeToLabel = Object.fromEntries(defs.map((d) => [d.code, d.label]));

// eski label -> güncel label (yalnız gerçekten değişenler)
const rename = {};
for (const [oldLabel, code] of Object.entries(oldToCode)) {
  const newLabel = codeToLabel[code];
  if (newLabel && newLabel !== oldLabel) rename[oldLabel] = newLabel;
}
console.log('=== rename map (TaxonomyDef güncel label) ===');
for (const [o, n] of Object.entries(rename)) console.log(`  "${o}"  ->  "${n}"`);
console.log('');

const cases = await prisma.case.findMany({
  where: { customFields: { not: null } },
  select: { id: true, caseNumber: true, customFields: true },
});

let changed = 0;
const log = [];
const handoff = [];

for (const c of cases) {
  let cf;
  try {
    cf = typeof c.customFields === 'string' ? JSON.parse(c.customFields) : c.customFields;
  } catch {
    continue;
  }
  const cl = cf?.smartTicket?.closure;
  if (!cl) continue;
  let dirty = false;

  for (const f of LABEL_FIELDS) {
    if (cl[f] && rename[cl[f]]) {
      log.push(`${c.caseNumber}  ${f}: "${cl[f]}" -> "${rename[cl[f]]}"`);
      cl[f] = rename[cl[f]];
      dirty = true;
    }
  }

  const un = cl.closureSuggestion?.unmatched;
  if (Array.isArray(un)) {
    for (const u of un) {
      if (u && typeof u.rawValue === 'string' && rename[u.rawValue]) {
        log.push(`${c.caseNumber}  unmatched.rawValue: "${u.rawValue}" -> "${rename[u.rawValue]}"`);
        u.rawValue = rename[u.rawValue];
        dirty = true;
      }
    }
  }

  // engineeringHandoff = AI devir taslağı (serbest metin, iç kullanım, rapora gitmez)
  const eh = cf?.smartTicket?.aiDrafts?.engineeringHandoff;
  if (typeof eh === 'string' && Object.keys(oldToCode).some((o) => eh.includes(o))) {
    handoff.push(c.caseNumber);
  }

  if (dirty) {
    changed += 1;
    if (commit) {
      await prisma.case.update({ where: { id: c.id }, data: { customFields: cf } });
    }
  }
}

log.forEach((l) => console.log(l));
console.log('');
console.log(`${commit ? 'COMMIT' : 'DRY-RUN'}: ${changed} vaka, ${log.length} snapshot alanı güncellendi`);
if (handoff.length) {
  console.log(
    `NOT: engineeringHandoff (AI devir taslağı — serbest metin, müşteriye/rapora gitmez) eski isim içeren: ${handoff.join(', ')} — otomatik değiştirilmedi.`,
  );
}
process.exit(0);
