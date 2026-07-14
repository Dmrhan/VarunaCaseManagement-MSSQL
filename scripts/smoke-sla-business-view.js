/**
 * smoke-sla-business-view.js — SLA iş-saati Faz 4 (tüketici çevrimi). 2026-07-14
 * Süre-farkı GÖSTEREN katmanlar damganın rejimiyle okur: takvimli şirkette
 * İŞ-dk, kesim öncesi/takvimsiz vakada duvar-dk (diffMinutes fallback'i).
 * Fonksiyonel (diffMinutes/netDayMinutes) + yapısal (tüketici bağlantıları).
 */
import { readFileSync } from 'node:fs';
import { normalizeCalendar, diffMinutes, netDayMinutes } from '../server/lib/sla/businessTime.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const rd = (p) => readFileSync(p, 'utf8');

// ── 1 · Motor görünüm yardımcıları (fonksiyonel) ──
// Pzt-Cu 08:30-18:00, mola 12:00-13:00 → net 510 dk/gün.
const cal = normalizeCalendar({
  isActive: true,
  workDays: [1, 2, 3, 4, 5].map((d) => ({ day: d, startMin: 510, endMin: 1080 })),
  breakStartMin: 720, breakEndMin: 780,
  holidays: [],
});
ok('1 netDayMinutes: mola düşülmüş net gün (510dk); takvimsizde 1440',
  netDayMinutes(cal) === 510 && netDayMinutes(null) === 1440);

// 2026-07-14 Salı 10:00 → 2026-07-14 Salı 16:00 = 5 iş-saati (mola düşer)
const T = Date.UTC(2026, 6, 14, 7, 0); // 10:00 TR (UTC+3)
const T2 = Date.UTC(2026, 6, 14, 13, 0); // 16:00 TR
ok('2 diffMinutes ileri: mola düşülmüş iş-dk (6 duvar-saat → 300 iş-dk)',
  diffMinutes(T, T2, cal) === 300);
ok('3 diffMinutes geri: işaret korunur (gecikme negatif)',
  diffMinutes(T2, T, cal) === -300);
ok('4 diffMinutes takvimsiz: duvar-dk (360)',
  diffMinutes(T, T2, null) === 360 && diffMinutes(T2, T, null) === -360);

// ── 2 · BE tüketicileri damga rejimiyle okuyor ──
const dash = rd('server/analytics/slaDashboard.js');
ok('5 slaDashboard: şirket kapıları + satır createdAt kapısı + diffMinutes/netDayMinutes',
  dash.includes('getCalendarGateFor') && dash.includes('calGates.get(c.companyId)(created)')
  && dash.includes('diffMinutes(created, end, cal)') && dash.includes('netDayMinutes(cal)'));
const myr = rd('server/db/myRepository.js');
ok('6 myRepository: deriveAiSignal + 6-saat kuralı iş-saatiyle (rowCal kapısı)',
  myr.includes('deriveAiSignal(c, rowCal(c))') && myr.includes('rowCal(c)) / 60'));
const sup = rd('server/lib/supervisorSummaryPrompt.js');
ok('7 supervisorSummaryPrompt: enrichment.slaCal + müşteri-bekleme durumu',
  sup.includes('const slaCal = (await getCalendarGateFor(c.companyId))')
  && sup.includes("formatSlaSummary(c, enrichment.slaCal ?? null)")
  && sup.includes('duraklatıldı (müşteri-bekleme)'));
const qa = rd('server/cron/qaScoreBatch.js');
ok('8 qaScoreBatch: çözüm-due farkı damganın rejimiyle',
  qa.includes('getCalendarGateFor(c.companyId)') && qa.includes('diffMinutes(new Date(c.resolvedAt)'));
const ai = rd('server/routes/ai.js');
ok('9 ai.js: bilinçli duvar-saat kararı belgeli (FE snapshot, AI-bağlam metni)',
  ai.split('BİLİNÇLİ duvar-saat').length >= 3);

// ── 3 · FE: takvim kopyası YASAK — BE hesaplar, FE alan-tercihli ──
const repo = rd('server/db/caseRepository.js');
ok('10 enrichSlaView: liste + detay dönüşünde BE-hesaplı kalan dk + slaDayMinutes',
  repo.includes('async function enrichSlaView(')
  && repo.includes('await enrichSlaView(items.map(shape))')
  && repo.includes('(await enrichSlaView([shape(c)]))[0]')
  && repo.includes('r.slaDayMinutes = Math.round(netDayMinutes(cal))'));
const fmt = rd('src/lib/format.ts');
ok('11 formatSlaRemaining: BE dakikasından render, iş etiketi + null→fallback sözleşmesi',
  fmt.includes('export function formatSlaRemaining(') && fmt.includes("'iş-sa'")
  && fmt.includes('if (remainingMin == null) return null;'));
const feFiles = [
  'src/features/cases/CasesListPage.tsx',
  'src/features/cases/components/CaseHeaderChips.tsx',
  'src/features/cases/CaseDetailPage.tsx',
  'src/features/cases/l1-console/L1DecisionRail.tsx',
  'src/features/cases/l1-console/L1WorkbenchPanel.tsx',
  'src/features/cases/components/CaseListDrawer.tsx',
];
ok('12 6 FE tüketicisi formatSlaRemaining tercihli (fallback: eski duvar formatı)',
  feFiles.every((f) => rd(f).includes('formatSlaRemaining(')));
ok('13 FE müşteri-bekleme göstergesi: liste pill + header chip + detay paneli',
  rd('src/features/cases/CasesListPage.tsx').includes('slaCustomerWaitStartedAt')
  && rd('src/features/cases/components/CaseHeaderChips.tsx').includes('müşteri yanıtı bekleniyor')
  && rd('src/features/cases/CaseDetailPage.tsx').includes('Müşteri yanıtı bekleniyor — sayaç durdu'));
ok('14 FE hiçbir dosyada takvim kopyası yok (workDays/dayIntervals FE\'ye sızmadı)',
  feFiles.every((f) => !rd(f).includes('workDays') && !rd(f).includes('dayIntervals')));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
