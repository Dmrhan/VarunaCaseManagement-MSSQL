/**
 * sla-restamp-dryrun.mjs — SLA iş-saati Faz 5 DRY-RUN (2026-07-14).
 * SALT-OKUR: hiçbir şey yazmaz. Mevcut damgadan hedef dakikayı geri türetir
 * (yeniden politika eşleme YAPMAZ — politika sonradan değiştiyse bile vakanın
 * o günkü taahhüdü korunur), iş-saati takvimiyle yeni due'ları simüle eder.
 *
 * Hedef türetimi:
 *   respTargetMin = duvar-dk(created → respDue)
 *   resoTargetMin = duvar-dk(created → resoDue) - slaPausedDurationMin
 *     (eski rejimde pause çıkışı due'yu duvar-dk kaydırıyordu; geri düşülür)
 * Yeni damga:
 *   respDueNew = addBusinessMinutes(created, respTargetMin)
 *   resoDueNew = addBusinessMinutes(created, resoTargetMin + pausedMin)
 * Not: tarihsel pause süreleri DUVAR ölçülmüştü; iş-dk'ya çevrilmeden aynen
 * eklenir (konservatif — due daha erken kalır, uyum iyileşmesi abartılmaz).
 */
import { writeFileSync } from 'node:fs';
import { prisma } from '../server/db/client.js';
import { normalizeCalendar, addBusinessMinutes } from '../server/lib/sla/businessTime.js';

const MIN = 60000;
const wallMin = (a, b) => Math.round((b - a) / MIN);

// Takvim ŞABLONU: bugün tek kayıt Finrota'da — simülasyonda 3 şirkete de
// aynı düzen uygulanır (rapor bunu açıkça söyler; gerçek yazım için her
// şirketin KENDİ kaydı + kesim tarihi şart).
const calRow = await prisma.workCalendar.findFirst({ include: { holidays: true } });
if (!calRow) { console.error('WorkCalendar kaydı yok'); process.exit(1); }
const cal = normalizeCalendar(calRow);
if (!cal) { console.error('takvim normalize edilemedi'); process.exit(1); }

const cases = await prisma.case.findMany({
  where: { isArchived: false },
  select: {
    id: true, caseNumber: true, companyId: true, status: true,
    createdAt: true, resolvedAt: true,
    slaResponseDueAt: true, slaResolutionDueAt: true,
    slaResponseMetAt: true, slaViolation: true,
    slaPausedAt: true, slaPausedDurationMin: true,
  },
});
const archivedCount = await prisma.case.count({ where: { isArchived: true } });

const now = Date.now();
const TERMINAL = new Set(['Cozuldu', 'IptalEdildi']);
const perCompany = new Map();
const detail = [];

for (const c of cases) {
  const co = perCompany.get(c.companyId) ?? {
    total: 0, noSla: 0, guardSkip: 0, activePause: 0,
    resoShifted: 0, respShifted: 0, shiftMinSum: 0, shiftMinMax: 0,
    resoCompliantBefore: 0, resoCompliantAfter: 0, resoMeasurable: 0,
    respCompliantBefore: 0, respCompliantAfter: 0, respMeasurable: 0,
    violationRetract: 0, openViolationRetract: 0,
  };
  perCompany.set(c.companyId, co);
  co.total += 1;

  const created = c.createdAt.getTime();
  const resoDue = c.slaResolutionDueAt?.getTime() ?? null;
  const respDue = c.slaResponseDueAt?.getTime() ?? null;
  if (!resoDue && !respDue) { co.noSla += 1; continue; }
  if (c.slaPausedAt) co.activePause += 1;

  const pausedMin = c.slaPausedDurationMin ?? 0;
  let respDueNew = null, resoDueNew = null;
  if (respDue) {
    const t = Math.max(0, wallMin(created, respDue));
    respDueNew = addBusinessMinutes(created, t, cal);
  }
  if (resoDue) {
    const t = Math.max(0, wallMin(created, resoDue) - pausedMin);
    resoDueNew = addBusinessMinutes(created, t + pausedMin, cal);
  }
  if ((respDue && respDueNew == null) || (resoDue && resoDueNew == null)) {
    co.guardSkip += 1; continue; // motor guard'ı (aşırı uzun) — değişmez bırakılır
  }

  if (resoDue && resoDueNew !== resoDue) {
    co.resoShifted += 1;
    const shift = Math.round((resoDueNew - resoDue) / MIN);
    co.shiftMinSum += shift;
    if (shift > co.shiftMinMax) co.shiftMinMax = shift;
  }
  if (respDue && respDueNew !== respDue) co.respShifted += 1;

  // Çözüm uyumu (ölçülebilir: terminal + resolvedAt damgalı)
  if (resoDue && TERMINAL.has(c.status) && c.resolvedAt) {
    co.resoMeasurable += 1;
    const r = c.resolvedAt.getTime();
    if (r <= resoDue) co.resoCompliantBefore += 1;
    if (r <= resoDueNew) co.resoCompliantAfter += 1;
  }
  // Yanıt uyumu (ölçülebilir: slaResponseMetAt damgalı)
  if (respDue && c.slaResponseMetAt) {
    co.respMeasurable += 1;
    const m = c.slaResponseMetAt.getTime();
    if (m <= respDue) co.respCompliantBefore += 1;
    if (m <= respDueNew) co.respCompliantAfter += 1;
  }
  // İhlal bayrağı geri çekilir mi? referans = resolvedAt ?? now
  if (c.slaViolation && resoDue) {
    const ref = c.resolvedAt ? c.resolvedAt.getTime() : now;
    if (ref <= resoDueNew) {
      co.violationRetract += 1;
      if (!TERMINAL.has(c.status)) co.openViolationRetract += 1;
    }
  }
  detail.push({
    caseNumber: c.caseNumber, companyId: c.companyId, status: c.status,
    resoDueOld: c.slaResolutionDueAt, resoDueNew: resoDueNew ? new Date(resoDueNew) : null,
    respDueOld: c.slaResponseDueAt, respDueNew: respDueNew ? new Date(respDueNew) : null,
    pausedMin,
  });
}

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + '%' : '—');
console.log(`\n═══ SLA RE-STAMP DRY-RUN (salt-okur) — ${new Date().toISOString().slice(0, 16)} ═══`);
console.log(`Takvim şablonu: ${calRow.companyId} kaydı (Pzt-Cu ${calRow.workDays ? '08:30-18:00' : '?'}, mola 12-13, ${calRow.holidays.length} tatil) — SİMÜLASYONDA 3 şirkete de uygulandı`);
console.log(`Arşivli (kapsam DIŞI): ${archivedCount} vaka\n`);
for (const [cid, s] of [...perCompany.entries()].sort()) {
  console.log(`── ${cid} ──`);
  console.log(`  vaka: ${s.total} (SLA'sız: ${s.noSla}, guard-atlanan: ${s.guardSkip}, şu an 3P-pause: ${s.activePause})`);
  console.log(`  due kayan: çözüm ${s.resoShifted}, yanıt ${s.respShifted} | ort. öteleme ${s.resoShifted ? Math.round(s.shiftMinSum / s.resoShifted / 60) : 0} sa, max ${Math.round(s.shiftMinMax / 60)} sa`);
  console.log(`  ÇÖZÜM uyumu (ölçülebilir ${s.resoMeasurable}): ${pct(s.resoCompliantBefore, s.resoMeasurable)} → ${pct(s.resoCompliantAfter, s.resoMeasurable)}`);
  console.log(`  YANIT uyumu (ölçülebilir ${s.respMeasurable}): ${pct(s.respCompliantBefore, s.respMeasurable)} → ${pct(s.respCompliantAfter, s.respMeasurable)}`);
  console.log(`  ihlal bayrağı geri çekilir: ${s.violationRetract} (açık vakada: ${s.openViolationRetract})`);
}
const outPath = process.env.DRYRUN_OUT ?? '/tmp/sla-restamp-dryrun.json';
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date(), calendar: { source: calRow.companyId, holidays: calRow.holidays.length }, detail }, null, 1));
console.log(`\nDetay (vaka-bazlı önce/sonra): ${outPath} (${detail.length} satır)`);
process.exit(0);
