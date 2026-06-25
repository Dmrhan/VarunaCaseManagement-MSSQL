// fill-vk-kb.mjs'in ürettiği cache'i (vk-kb-fill-results.json) production DB'ye
// uygular. Case.customFields.smartTicket içindeki BOŞ açılış/kapanış alanlarını
// doldurur — mevcut etiketleri ASLA ezmez (idempotent).
//
// Kullanım:
//   node --env-file=.env scripts/apply-vk-kb.mjs            (dry-run)
//   node --env-file=.env scripts/apply-vk-kb.mjs --commit   (yazar)
import { prisma } from '../server/db/client.js';
import fs from 'node:fs';

const commit = process.argv.includes('--commit');
const cache = JSON.parse(fs.readFileSync(new URL('./vk-kb-fill-results.json', import.meta.url), 'utf8'));

const OPEN_FIELDS = ['platform', 'businessProcess', 'operationType', 'affectedObject', 'impact'];
const CLOSE_FIELDS = ['rootCauseGroup', 'rootCauseDetail', 'resolutionType', 'permanentPrevention'];

let casesUpdated = 0;
let openCells = 0;
let closeCells = 0;
let skippedNoFill = 0;
const log = [];

for (const rec of cache) {
  const hasOpen = rec.open && Object.keys(rec.open).length;
  const hasClose = rec.close && Object.keys(rec.close).length;
  if (!hasOpen && !hasClose) {
    skippedNoFill += 1;
    continue;
  }

  const c = await prisma.case.findUnique({ where: { id: rec.caseId }, select: { customFields: true } });
  if (!c) {
    log.push(`${rec.caseNumber}: BULUNAMADI`);
    continue;
  }
  let cf;
  try {
    cf = typeof c.customFields === 'string' ? JSON.parse(c.customFields) : c.customFields;
  } catch {
    log.push(`${rec.caseNumber}: customFields parse hatasi`);
    continue;
  }
  if (!cf || typeof cf !== 'object') cf = {};
  if (!cf.smartTicket || typeof cf.smartTicket !== 'object') cf.smartTicket = {};
  const st = cf.smartTicket;

  const wrote = [];

  // OPEN — yalnız boş alanlar
  for (const f of OPEN_FIELDS) {
    const v = rec.open?.[f];
    if (v?.label && !st[`${f}Label`]) {
      st[f] = v.code;
      st[`${f}Label`] = v.label;
      openCells += 1;
      wrote.push(f);
    }
  }

  // CLOSE — yalnız boş alanlar
  if (hasClose) {
    if (!st.closure || typeof st.closure !== 'object') st.closure = {};
    const cl = st.closure;
    let closeTouched = false;
    for (const f of CLOSE_FIELDS) {
      const v = rec.close?.[f];
      if (v?.label && !cl[`${f}Label`]) {
        cl[f] = v.code;
        cl[`${f}Label`] = v.label;
        closeCells += 1;
        wrote.push(`closure.${f}`);
        closeTouched = true;
      }
    }
    if (closeTouched) {
      cl.updatedAt = new Date().toISOString();
      if (!cl.version) cl.version = 1;
      cl.kbBackfilled = true; // bu kapanışın KB ile dolduruldugunu işaretle
    }
  }

  if (wrote.length) {
    casesUpdated += 1;
    log.push(`${rec.caseNumber}: ${wrote.join(', ')}`);
    if (commit) {
      await prisma.case.update({ where: { id: rec.caseId }, data: { customFields: cf } });
    }
  }
}

console.log(`${commit ? 'COMMIT' : 'DRY-RUN'} — guncellenen vaka: ${casesUpdated}`);
console.log(`  acilis hucresi: ${openCells} | kapanis hucresi: ${closeCells} | toplam: ${openCells + closeCells}`);
console.log(`  cache'te doldurulacak alan olmayan (atlanan): ${skippedNoFill}`);
console.log('\n=== ilk 20 vaka ===');
log.slice(0, 20).forEach((l) => console.log('  ' + l));
if (log.length > 20) console.log(`  ... +${log.length - 20} vaka daha`);
if (!commit) console.log('\n(dry-run — yazmak icin --commit)');
else console.log('\n✓ DB guncellendi');
process.exit(0);
