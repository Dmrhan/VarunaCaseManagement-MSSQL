/**
 * smoke-person-profile-faz2b.js — 2026-07-07
 * Performans Panosu FAZ 2b — kişi uzmanlık profili UI (PersonProfileView) +
 * drill-down (kişi kartı → profil) + servis. Yapısal doğrulama.
 * Canlı DOM (VPN, supervisor, gerçek veri): 6/7 + 2 ekran görüntüsü — profil
 * maketle birebir (trend SVG + uzmanlık + sorunlar + ürün + en uzun 25gün +
 * çözüm imzası %81); 7. assert Türkçe-i+CSS-uppercase regex artefaktı.
 */
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const read = (p) => readFileSync(p, 'utf8');
const svc = read('src/services/analyticsService.ts');
const prof = read('src/features/analytics/PersonProfileView.tsx');
const page = read('src/features/analytics/PeoplePerformancePage.tsx');
const app = read('src/App.tsx');

console.log('── Servis ──');
ok('1.1 personDetail metodu + endpoint + tipler',
  /async personDetail\(/.test(svc) && svc.includes("'/api/analytics/person-detail'")
  && /interface PersonDetailResponse/.test(svc) && /interface ExpertiseTopic/.test(svc));

console.log('── Profil ekranı (6 bölüm) ──');
ok('2.1 günlük süre trendi SVG (7g yürüyen çizgi + hacim çubuk)',
  /function TrendChart/.test(prof) && prof.includes('rollingMedianHours') && /<svg/.test(prof));
ok('2.2 uzmanlık parmak izi + uzman/sağlam etiketi + konu-içi hız',
  /Uzmanlık parmak izi/.test(prof) && /'Uzman'|Uzman</.test(prof) && /ekipten %\{e\.fasterPct\} hızlı/.test(prof));
ok('2.3 en çok karşılaştığı sorunlar + çalıştığı ürün',
  /En çok karşılaştığı sorunlar/.test(prof) && /Çalıştığı ürün/.test(prof));
ok('2.4 en uzun işler — süre gün/saat + tıklayınca vaka detayı (onSelectCase)',
  /En uzun süren işleri/.test(prof) && /function formatDuration/.test(prof)
  && /onSelectCase\?\.\(c\.id\)/.test(prof));
ok('2.5 çözüm imzası — kök neden/çözüm yöntemi + kalıcı önleme kişi vs ekip',
  /Çözüm imzası/.test(prof) && /permanentPreventionPct/.test(prof) && /teamPermanentPreventionPct/.test(prof));

console.log('── Drill-down bağlama ──');
ok('3.1 kişi kartı tıklanabilir (onOpen) → profil (selected state)',
  /onOpen: \(\) => void/.test(page) && /setSelected\(\{ id: p\.id, name: p\.name \}\)/.test(page)
  && /<PersonProfileView/.test(page));
ok('3.2 profil doğru dönem (rangeStart/End) + onSelectCase App\'ten',
  /from=\{rangeStartIso\(dateFrom\)\}/.test(page)
  && /<PeoplePerformancePage onSelectCase=\{openCase\} \/>/.test(app));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
