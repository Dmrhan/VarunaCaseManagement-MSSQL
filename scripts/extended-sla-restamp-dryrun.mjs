/**
 * extended-sla-restamp-dryrun.mjs — Uzatılmış SLA Faz 4: retroaktif DRY-RUN. 2026-07-14
 * SALT-OKUR — hiçbir şey yazmaz.
 *
 * Aday tespiti thirdPartyId-BAZLI (kırmızı çizgi: isim kural değildir; isim
 * yalnız script başında, bir kez, id çözmek için kullanılır):
 *   isArchived=0 ∧ status=ThirdPartyWaiting ∧ thirdPartyId=YBE(aktif,Univera)
 *   ∧ DevOps kaydı dolu ∧ slaTargetSource ≠ 'extended'
 *
 * Kabul şartı 4: aday sayısı ~37 (14.07 sayımı) — büyük sapma varsa yazım
 * öncesi DURULUR, kullanıcıya sorulur. Bu script zaten yazmaz; sapmayı raporlar.
 *
 * Yeni due SİMÜLASYONU: takvim kesim kapısı henüz kapalı olduğundan
 * getEffectiveCalendar değil loadWorkCalendar kullanılır — "aktivasyon
 * sonrası rejim böyle görünecek" kanıtıdır, bugünkü davranış DEĞİL.
 */
import { writeFileSync } from 'node:fs';
import { prisma } from '../server/db/client.js';
import { normalizeCalendar, addBusinessMinutes } from '../server/lib/sla/businessTime.js';

const EXTENDED_BY_PRIORITY = { Critical: 1830, High: 3480, Medium: 12480, Low: 12480 };
const EXPECTED_CANDIDATES = 37;

// Tanımı isim+şirket+aktiflikle BİR KEZ çöz — sonrası hep id.
const ybe = await prisma.thirdParty.findFirst({
  where: { name: 'Yazılım Bakım Ekibinde', companyId: 'COMP-UNIVERA', isActive: true },
  select: { id: true, name: true, triggersExtendedSla: true, extendedSlaRequiresDevopsLink: true },
});
if (!ybe) { console.error('Univera aktif "Yazılım Bakım Ekibinde" kaydı bulunamadı'); process.exit(1); }

const calRow = await prisma.workCalendar.findUnique({
  where: { companyId: 'COMP-UNIVERA' },
  include: { holidays: true },
});
const cal = calRow ? normalizeCalendar(calRow) : null;

const inMaint = await prisma.case.findMany({
  where: { isArchived: false, status: 'ThirdPartyWaiting', thirdPartyId: ybe.id },
  select: {
    id: true, caseNumber: true, priority: true, createdAt: true, customFields: true,
    slaResolutionDueAt: true, slaResolutionTargetMin: true, slaTargetSource: true,
    slaPausedDurationMin: true, slaViolation: true,
  },
});

const hasDevops = (cf) => {
  if (!cf) return false;
  try { const o = typeof cf === 'string' ? JSON.parse(cf) : cf; return Array.isArray(o?.devops) && o.devops.length > 0; }
  catch { return false; }
};

const nowMs = Date.now();
const candidates = [];
let noDevops = 0, alreadyExtended = 0;
for (const c of inMaint) {
  if (c.slaTargetSource === 'extended') { alreadyExtended += 1; continue; }
  if (!hasDevops(c.customFields)) { noDevops += 1; continue; }
  const extMin = EXTENDED_BY_PRIORITY[c.priority] ?? null;
  const createdMs = new Date(c.createdAt).getTime();
  const pausedMin = c.slaPausedDurationMin ?? 0;
  const total = (extMin ?? 0) + pausedMin;
  const biz = extMin != null && cal ? addBusinessMinutes(createdMs, total, cal) : null;
  const newDueMs = extMin == null ? null : (biz != null ? biz : createdMs + total * 60000);
  candidates.push({
    caseNumber: c.caseNumber,
    priority: c.priority,
    extendedMin: extMin,
    dueOld: c.slaResolutionDueAt,
    dueNew: newDueMs ? new Date(newDueMs) : null,
    violationNow: c.slaViolation,
    violationRetracted: c.slaViolation && newDueMs != null && nowMs <= newDueMs,
  });
}

console.log(`\n═══ UZATILMIŞ SLA RETROAKTİF DRY-RUN (salt-okur) ═══`);
console.log(`Tanım: ${ybe.name} (id=${ybe.id}) | bayraklar: uygular=${ybe.triggersExtendedSla}, DevOps-şartı=${ybe.extendedSlaRequiresDevopsLink}`);
console.log(`Takvim simülasyonu: ${cal ? 'Univera takvimi (İŞ-dk — aktivasyon sonrası rejim)' : 'takvim YOK → duvar-dk'}`);
console.log(`\nBakımda bekleyen: ${inMaint.length} | ADAY (DevOps'lu): ${candidates.length} | DevOps'suz (uzamaz): ${noDevops} | zaten uzatılmış: ${alreadyExtended}`);
const dev = Math.abs(candidates.length - EXPECTED_CANDIDATES);
console.log(dev <= 5
  ? `Beklenti kontrolü: ${candidates.length} ≈ ${EXPECTED_CANDIDATES} ✓ (sapma ${dev})`
  : `⚠️ SAPMA BÜYÜK: ${candidates.length} aday ≠ beklenti ${EXPECTED_CANDIDATES} — YAZMADAN ÖNCE DURUN (kabul şartı 4).`);

const byPri = {};
let retract = 0;
for (const c of candidates) {
  byPri[c.priority] = (byPri[c.priority] ?? 0) + 1;
  if (c.violationRetracted) retract += 1;
}
console.log(`Öncelik dağılımı: ${Object.entries(byPri).map(([k, v]) => `${k}=${v}`).join(', ')}`);
console.log(`İhlal bayrağı geri çekilecek: ${retract}`);

const outPath = process.env.DRYRUN_OUT ?? '/tmp/extended-sla-restamp-dryrun.json';
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date(), thirdPartyId: ybe.id, candidates }, null, 1));
console.log(`\nDetay (vaka bazlı önce/sonra): ${outPath} (${candidates.length} satır)`);
process.exit(0);
