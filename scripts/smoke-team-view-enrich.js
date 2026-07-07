/**
 * smoke-team-view-enrich.js — 2026-07-07
 * Performans Panosu Ekran 1 (takım koçluk görünümü) makete hizalama.
 * Onaylı maketteki zenginlik: 4-katman özet ikincil metriklerle + kişi kartında
 * Kalite puanı (QA) + kural-tabanlı Koçluk sinyali. Yapısal + canlı (SMOKE_LIVE=1).
 */
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0, skip = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const sk = (n, why) => { skip++; console.log(`SKIP — ${n} (${why})`); };
const read = (p) => readFileSync(p, 'utf8');
const agg = read('server/analytics/operationsAggregator.js');
const svc = read('src/services/analyticsService.ts');
const page = read('src/features/analytics/PeoplePerformancePage.tsx');
const pdet = read('server/analytics/personDetailAggregator.js');
const prof = read('src/features/analytics/PersonProfileView.tsx');

console.log('── KB-tabanlı uzmanlık (kullanıcı direktifi 2026-07-07) ──');
ok('0.1 uzmanlık/ürün/sorun KB etiketleriyle (category/subCategory DEĞİL)',
  /businessProcessLabel'\)/.test(pdet) && /platformLabel'\)/.test(pdet) && /operationTypeLabel'\)/.test(pdet)
  && /Kullanıcı kararı 2026-07-07: uzmanlık analizi KB/.test(pdet));
console.log('── İnsancıl dil (kaba ifade YOK) ──');
ok('0.2 Etkinlik&Katkı + sinyal etiketleri insancıl — kaba ifade kaldırıldı',
  !/sıcak-patates|sadece kolay iş mi seçiyor|gerçekten çalışıyor mu/.test(pdet)
  && !/kaytarma|Gizlenme deseni|gerçekten çalışıyor mu/.test(prof)
  && /Zorlayıcı iş payı/.test(pdet) && /Devretme eğilimi/.test(pdet) && /Bekleyen kendi işi/.test(pdet));
ok('0.3 iş dili — kullanıcıya görünen metinde "ortanca" YOK, "ortalama" kullanılıyor (kullanıcı direktifi)',
  // JSX metni + koçluk sinyali text\'lerinde ortanca geçmemeli (kod yorumu hariç)
  !/ekip ortancasına göre|ekip ortancasının|Kişi koçluk kartları — ekip ortancasına/.test(page)
  && !/ortancasının \(\$\{tWip\}|ortancasının altında/.test(agg));

console.log('── Backend ──');
ok('1.1 teamSummary (backlog·netMelted·busiest·idleCapacity·QA·P90) döndürülüyor',
  /teamSummary = \{/.test(agg) && /backlog: snapshot\.openCount/.test(agg)
  && /netMelted: period\.totalResolved - period\.totalCreated/.test(agg)
  && /busiest/.test(agg) && /idleCapacity/.test(agg) && /p90Hours: medianOf/.test(agg));
ok('1.2 per-person QA (qaScore metriği + guardrail qaScore=10)',
  /key: 'qaScore'/.test(agg) && /qaCount \?\? 0\) >= MIN_SAMPLE\.qaScore/.test(agg)
  && /AVG\(\(CAST\(\[qaEmpathyScore\]/.test(agg));
ok('1.3 kural-tabanlı koçluk sinyali (deterministik, RUNA değil)',
  /function buildCoachingSignal/.test(agg) && /Hız kaliteyi yiyor/.test(agg)
  && /coaching: buildCoachingSignal\(p, teamBenchmark\)/.test(agg));
ok('1.4 teamBenchmark eskalasyon/devir/QA ile genişledi',
  /escalationRatePct: medianOf/.test(agg) && /transferRatePct: medianOf/.test(agg) && /qaScore: medianOf/.test(agg));

console.log('── Tipler ──');
ok('2.1 PeopleTeamSummary + coaching + qaScore tipleri',
  /interface PeopleTeamSummary/.test(svc) && /coaching\?: \{ tone/.test(svc)
  && /qaScore: PersonMetric/.test(svc) && /teamSummary: PeopleTeamSummary/.test(svc));

console.log('── UI (Ekran 1) ──');
ok('3.1 SummaryCard 4-katman ikincil metriklerle (backlog·yavaş uç·kalite·en yüklü·boşta)',
  /function SummaryCard/.test(page) && /Biriken \(backlog\)/.test(page) && /Yavaş uç \(P90\)/.test(page)
  && /Kalite puanı/.test(page) && /En yüklü kişi/.test(page) && /Boşta kapasite/.test(page));
ok('3.2 kişi kartı Yeniden açılma · Kalite birleşik hücre',
  /function ReopenQualityCell/.test(page) && /Yeniden açılma · Kalite/.test(page));
ok('3.3 Koçluk sinyali kutusu (tone renkli, 3 durum)',
  /function CoachingSignal/.test(page) && /COACH_CLS/.test(page)
  && /watch:/.test(page) && /info:/.test(page) && /good:/.test(page));
ok('3.4 net akış işaretli/renkli (eriyen ▲ yeşil / birikiyor ▼ kırmızı)',
  /melt >= 0 \? `\+\$\{melt\} ▲` : `\$\{melt\} ▼`/.test(page));
ok('3.5 takım filtresi dropdown (Tüm takımlar + lookupService.teams) → teams scope',
  /aria-label="Takım filtresi"/.test(page) && /lookupService\.teams\(\)/.test(page)
  && /<option value="">Tüm takımlar<\/option>/.test(page)
  && /teamId \? \{ teams: \[teamId\] \}/.test(page)
  && /teams=\{teamsFilter\}/.test(page));

if (process.env.SMOKE_LIVE === '1') {
  console.log('── CANLI ──');
  const BASE = 'http://localhost:3101';
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  try {
    const login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'supervisor@varuna.dev', password: 'Test1234!' }) })).json();
    if (!login.accessToken) throw new Error('login fail');
    const H = { Authorization: `Bearer ${login.accessToken}`, 'Content-Type': 'application/json' };
    const r = await (await fetch(`${BASE}/api/analytics/people-performance`, { method: 'POST', headers: H, body: JSON.stringify({ from, to: today }) })).json();
    const s = r.teamSummary;
    ok('L1 teamSummary shape canlı (backlog·netMelted·busiest·idleCapacity·qaScore·p90)',
      s && typeof s.backlog === 'number' && typeof s.netMelted === 'number'
      && 'busiest' in s && typeof s.idleCapacity === 'number' && 'qaScore' in s && 'p90Hours' in s);
    const withQa = r.people.find((p) => p.metrics.qaScore.value != null);
    ok('L2 en az bir kişide QA puanı hesaplanmış (guardrail geçen)', !!withQa);
    const withSig = r.people.find((p) => p.coaching?.text);
    ok('L3 en az bir kişide koçluk sinyali üretilmiş', !!withSig && typeof withSig.coaching.tone === 'string');
  } catch (e) { fail++; console.log(`FAIL — CANLI: ${e.message}`); }
} else { sk('CANLI', 'SMOKE_LIVE!=1'); }

console.log(`\nPASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
process.exit(fail ? 1 : (skip && process.env.SMOKE_LIVE === '1' && !process.env.ALLOW_SKIP ? 2 : 0));
