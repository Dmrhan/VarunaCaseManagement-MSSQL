/**
 * extended-sla-fill-matrix.mjs — Uzatılmış SLA Faz 4: matris doldurma. 2026-07-14
 *
 * Univera'nın öncelik-bazlı SLA kural satırlarına sözleşmedeki uzatılmış
 * TOPLAM süreleri (MESAİ DK) yazar — kabul şartı 2: ekrandan 20 satır elle
 * girilmez; script doldurur + satır satır DOĞRULAMA LİSTESİ basar.
 *
 * Default DRY-RUN (hiçbir şey yazmaz); --write ile yazar ve yazım sonrası
 * tabloyu geri okuyup her satırı assert eder.
 *
 * Fail-safe hatırlatma: bu değerleri doldurmak TEK BAŞINA hiçbir davranışı
 * değiştirmez — tetik ayrıca tanım bayrağına bağlı (triggersExtendedSla,
 * bugün kapalı). Aktivasyon sıra kilidi: takvim kesiminden SONRA.
 */
import { prisma } from '../server/db/client.js';

const WRITE = process.argv.includes('--write');
const COMPANY = 'COMP-UNIVERA';

// U-D — sözleşmedeki uzatılmış TOPLAM değerler (bileşen ayrıştırması YOK).
const EXTENDED_BY_PRIORITY = {
  Critical: 1830,
  High: 3480,
  Medium: 12480,
  Low: 12480,
};

const rows = await prisma.sLAPolicy.findMany({
  where: { companyId: COMPANY, isActive: true, priority: { not: null } },
  orderBy: [{ priority: 'asc' }, { requestType: 'asc' }],
});

console.log(`\n═══ UZATILMIŞ SLA MATRİS ${WRITE ? 'YAZIMI' : 'DRY-RUN (yazım yok)'} — ${COMPANY} ═══`);
console.log(`Öncelik-bazlı aktif satır: ${rows.length} (beklenti: 20)\n`);
if (rows.length !== 20) {
  console.log(`⚠️ SATIR SAYISI BEKLENTİDEN SAPTI (${rows.length} ≠ 20) — yazım yapılmadan durun, listeyi inceleyin.`);
}

let planned = 0, skippedSame = 0, noMapping = 0;
const plan = [];
for (const r of rows) {
  const target = EXTENDED_BY_PRIORITY[r.priority];
  if (!target) { noMapping += 1; console.log(`  ⚠️ eşleme yok: priority=${r.priority} (${r.id})`); continue; }
  const same = r.extendedResolutionMin === target;
  if (same) skippedSame += 1; else planned += 1;
  plan.push({ id: r.id, priority: r.priority, requestType: r.requestType, current: r.extendedResolutionMin, target, action: same ? 'aynı' : 'yaz' });
}

console.log('── Doğrulama listesi (satır satır) ──');
for (const p of plan) {
  console.log(`  ${p.priority.padEnd(8)} | ${String(p.requestType).padEnd(8)} | mevcut=${p.current ?? '—'} → hedef=${p.target} dk | ${p.action}`);
}
console.log(`\nÖzet: yazılacak=${planned}, zaten-doğru=${skippedSame}, eşlemesiz=${noMapping}`);

if (!WRITE) {
  console.log('\nDRY-RUN bitti — yazmak için: node scripts/extended-sla-fill-matrix.mjs --write');
  process.exit(0);
}

if (rows.length !== 20 || noMapping > 0) {
  console.log('\n⛔ YAZIM DURDURULDU: satır sayısı/eşleme beklentiyle uyuşmuyor (kabul şartı 4 deseni — sapma varsa dur, sor).');
  process.exit(2);
}

for (const p of plan) {
  if (p.action !== 'yaz') continue;
  await prisma.sLAPolicy.update({ where: { id: p.id }, data: { extendedResolutionMin: p.target } });
}

// Yazım sonrası geri-okuma doğrulaması — sessiz yazım hatası sınıfını kapatır.
const after = await prisma.sLAPolicy.findMany({
  where: { companyId: COMPANY, isActive: true, priority: { not: null } },
});
let okCount = 0, badCount = 0;
for (const r of after) {
  const expect = EXTENDED_BY_PRIORITY[r.priority];
  if (r.extendedResolutionMin === expect) okCount += 1;
  else { badCount += 1; console.log(`  ✗ DOĞRULAMA HATASI: ${r.priority}/${r.requestType} → ${r.extendedResolutionMin} ≠ ${expect}`); }
}
console.log(`\nGeri-okuma doğrulaması: ${okCount}/${after.length} doğru${badCount ? ` — ${badCount} HATA` : ' ✓'}`);
process.exit(badCount ? 1 : 0);
