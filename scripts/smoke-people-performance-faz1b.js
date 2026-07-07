/**
 * smoke-people-performance-faz1b.js — 2026-07-07
 * Performans Panosu FAZ 1b — takım koçluk EKRANI (PeoplePerformancePage) + servis + App wiring.
 * Yapısal doğrulama. Canlı DOM (supervisor, gerçek veri) 5/6 + screenshot ile
 * teyit edildi (6. assert regex artefaktıydı; ekran maketle birebir render etti).
 */
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const read = (p) => readFileSync(p, 'utf8');

const page = read('src/features/analytics/PeoplePerformancePage.tsx');
const svc = read('src/services/analyticsService.ts');
const app = read('src/App.tsx');

console.log('── Servis ──');
ok('1.1 peoplePerformance metodu + doğru endpoint',
  /async peoplePerformance\(/.test(svc) && svc.includes("'/api/analytics/people-performance'"));
ok('1.2 tipler: PersonMetric { value, unit, formula, sampleSize, insufficient } + response',
  /interface PersonMetric \{[\s\S]{0,220}insufficient: boolean/.test(svc)
  && /interface PeoplePerformanceResponse/.test(svc) && /teamBenchmark: PeopleTeamBenchmark/.test(svc));

console.log('── Ekran ──');
ok('2.1 yöneticinin dili — backend etiketleri kullanılıyor (UI uydurmuyor)',
  page.includes('{metric.label}') && page.includes('{metric.formula}'));
ok('2.2 birim + hesap görünür (formatMetric birim + method satırı)',
  /function formatMetric/.test(page) && page.includes('{metric.formula}') && page.includes('{metric.unit}'));
ok('2.3 guardrail: insufficient → gizli + "yetersiz" notu',
  /metric\.insufficient/.test(page) && page.includes('yorum için yetersiz'));
ok('2.4 vs-ekip bağlam çipi (teamBenchmark) + iyi/kötü yön (betterWhenLower)',
  /function contextChip/.test(page) && /betterWhenLower/.test(page)
  && /contextChip\(m\.medianHours\.value, bench\.medianHours, true\)/.test(page)
  && /contextChip\(m\.resolved\.value, bench\.resolved, false\)/.test(page));
ok('2.5 ⓘ tam tanım (Hesap/Birim/Örneklem) + koçluk bandı',
  /function InfoDot/.test(page) && page.includes('HESAP') && page.includes('sıralama değil, koçluk için'));
ok('2.6 takım özeti 4 katman + kişi kartları',
  /① Hacim/.test(page) && /② Süre/.test(page) && /③ Kalite/.test(page) && /④ Yük/.test(page)
  && /function PersonCard/.test(page) && /function TeamSummary/.test(page));

console.log('── App wiring + rol gate ──');
ok('3.1 view union + import + render switch',
  app.includes("'analytics-people-performance'")
  && app.includes("import { PeoplePerformancePage }")
  && /view === 'analytics-people-performance' && <PeoplePerformancePage \/>/.test(app));
ok('3.2 rol gate Supervisor/Admin/SystemAdmin + reports section',
  /showPeoplePerformance = !!user && canShowView\('analytics-people-performance', \['Supervisor', 'Admin', 'SystemAdmin'\]/.test(app)
  && /showReportsSection[\s\S]{0,200}showPeoplePerformance/.test(app));
ok('3.3 sol nav menü öğesi (Gauge + Performans)',
  /handleNavSelect\('analytics-people-performance'\)/.test(app) && app.includes('<Gauge size={16} />'));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
