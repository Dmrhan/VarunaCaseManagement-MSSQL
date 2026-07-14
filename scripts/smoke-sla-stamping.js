/**
 * smoke-sla-stamping.js — SLA iş-saati Faz 3 (damga geçişi). 2026-07-14
 * Fonksiyonel (resolveTargetMinutes, getEffectiveCalendar kapısı) +
 * yapısal (create damgası, pause çevrimi, sweep koşulu). DB'ye yazmaz.
 */
import { readFileSync } from 'node:fs';
import { resolveTargetMinutes } from '../server/lib/sla/slaPolicyResolver.js';
import { normalizeCalendar } from '../server/lib/sla/businessTime.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };

const repo = readFileSync('server/db/caseRepository.js', 'utf8');
const sweep = readFileSync('server/cron/slaBreachSweep.js', 'utf8');
const bt = readFileSync('server/lib/sla/businessTime.js', 'utf8');

// ── 1 · resolveTargetMinutes: hedefin TEK okunma noktası ──
ok('1 resolveTargetMinutes: saat→dakika tek noktada (8sa→480dk, 26sa→1560dk; eşleşme yoksa null)',
  JSON.stringify(resolveTargetMinutes({ responseHours: 8, resolutionHours: 26 }))
    === JSON.stringify({ responseMin: 480, resolutionMin: 1560 })
  && resolveTargetMinutes(null) === null);
ok('2 create() artık saat çarpımı içermiyor — hedef yalnız resolveTargetMinutes\'tan',
  !repo.includes('slaMatch.responseHours * 3600000')
  && !repo.includes('slaMatch.resolutionHours * 3600000')
  && repo.includes('const slaTargets = resolveTargetMinutes(slaMatch);'));

// ── 2 · Damga kapısı: takvimli→motor, takvimsiz/guard→duvar-saati ──
ok('3 create damgası: getEffectiveCalendar kapısı + addBusinessMinutes + duvar-saati fallback',
  repo.includes('await getEffectiveCalendar(m.companyId, slaCreatedAt.getTime())')
  && repo.includes('addBusinessMinutes(slaCreatedAt.getTime(), slaTargets.responseMin, slaCal)')
  && repo.includes('respBiz != null ? respBiz : slaCreatedAt.getTime() + slaTargets.responseMin * 60000'));
ok('4 kesim-tarihi kapısı: effectiveFrom null/gelecek → null (geçiş başlamadı); pasif/tanımsız → null',
  bt.includes("if (entry.effectiveFromMs == null || atMs < entry.effectiveFromMs) return null;")
  && bt.includes('export async function getEffectiveCalendar('));

// ── 3 · Pause çevrimi: iş-dk muhasebesi + iş-zamanı öteleme ──
ok('5 leavingPause: takvimli şirkette businessMinutesBetween ile ölçüm + addBusinessMinutes ile due öteleme; takvimsizde mevcut duvar-dk',
  repo.includes('businessMinutesBetween(pausedFromMs, nowMs, pauseCal)')
  && repo.includes('addBusinessMinutes(dueMs, pausedMin, pauseCal)')
  && repo.includes('Math.round((nowMs - pausedFromMs) / 60000)')
  && repo.includes('dueMs + pausedMin * 60000'));

// ── 4 · Sweep boşluğu kapandı ──
ok('6 sweep: duraklamadaki vaka ihlal damgalanmaz (slaPausedAt: null koşulu)',
  sweep.includes('slaPausedAt: null'));

// ── 5 · Kapı davranışı fonksiyonel (normalize üzerinden) ──
const cal = normalizeCalendar({
  isActive: true,
  workDays: [{ day: 2, startMin: 510, endMin: 1080 }],
  holidays: [],
});
ok('7 motor kapı zinciri sağlam: normalize edilmiş tek-gün takvimi geçerli, pasif takvim null',
  cal !== null && normalizeCalendar({ isActive: false, workDays: '[]' }) === null);

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
