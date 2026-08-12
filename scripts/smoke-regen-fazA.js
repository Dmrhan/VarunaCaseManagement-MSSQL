/**
 * smoke-regen-fazA.js — 2026-07-08
 * Regenerasyon Faz A — anlatı-öncelikli takım görünümü (maket ONAYLI).
 * R1 soru-başlıklı bölümler · R2 exception-first bucketing · R3 içgörü-önce dikkat
 * kartı · R5 aksiyon köprüsü · R6 nabız cümlesi + "Kim güçlü?" KB uzmanlık.
 * Yapısal + canlı (SMOKE_LIVE=1).
 */
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0, skip = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const sk = (n, why) => { skip++; console.log(`SKIP — ${n} (${why})`); };
const read = (p) => readFileSync(p, 'utf8');
const agg = read('server/analytics/operationsAggregator.js');
const svc = read('src/services/analyticsService.ts');
const page = read('src/features/analytics/PeoplePerformancePage.tsx');

console.log('── Backend ──');
ok('1.1 per-person KB uzmanlık highlight (queryPeopleExpertise + topExpertise merge)',
  /async function queryPeopleExpertise/.test(agg) && /businessProcessLabel/.test(agg)
  && /topExpertise: expertiseByPerson\.get\(p\.id\)/.test(agg));
ok('1.2 koçluk sinyaline aksiyon köprüsü (action) — her desende',
  /action: 'Kalite koçluğu için birebir planla'/.test(agg) && /action: 'İş dağılımını gözden geçir'/.test(agg)
  && /return \{ tone: null, text: null, action: null \}/.test(agg));
ok('1.3 aşırı-yük tWip=0 kalıcı düzeltmesi (mutlak eşik 8+)',
  /tWip != null && tWip > 0 \? openWip >= tWip \* 2 : openWip >= 8/.test(agg));
ok('1.4 tipler: topExpertise + coaching.action',
  /topExpertise\?: \{ topic: string; count: number; fasterPct: number \| null \}\[\]/.test(svc)
  && /action\?: string \| null/.test(svc));

const prof = read('src/features/analytics/PersonProfileView.tsx');
console.log('── Süre formatı (L1 dakika · L2 saat/gün, kullanıcı direktifi 2026-07-08) ──');
ok('1.5 formatDur: <1sa→dk, <48sa→sa, sonrası→gün; formatMetric saat→formatDur',
  /function formatDur\(hours/.test(page) && /hours < 1\) return `\$\{Math\.max\(1, Math\.round\(hours \* 60\)\)\} dk`/.test(page)
  && /m\.unit === 'saat'\) return formatDur\(m\.value\)/.test(page)
  // profil: longest cases dk + trend birim seçimi
  && /hours < 1\) return `\$\{Math\.max\(1, Math\.round\(hours \* 60\)\)\} dk`/.test(prof)
  && /maxH < 1 \? \[60, 'dk'\]/.test(prof));

console.log('── UI (anlatı iskeleti) ──');
ok('2.1 R6 nabız cümlesi (PulseSentence)',
  /function PulseSentence/.test(page) && /Ekip nabzı/.test(page) && /yakından bakmaya değer/.test(page) && /belirgin güçlü/.test(page));
ok('2.2 R1 soru-başlıklı bölümler (SectionQ + 4 soru)',
  /function SectionQ/.test(page) && /Ekip bu dönem nasıl\?/.test(page)
  && /Kime bakmalıyım\?/.test(page) && /Kim neyde güçlü\?/.test(page));
ok('2.3 R2 exception-first bucketing (tone → attention/experts/balanced)',
  /const attention = useMemo/.test(page) && /coaching\?\.tone === 'watch' \|\| p\.coaching\?\.tone === 'info'/.test(page)
  && /const balanced = useMemo/.test(page) && /EXPERT_CAP/.test(page));
ok('2.4 R3 içgörü-önce dikkat kartı (koçluk cümlesi başlık + destek sayılar)',
  /function AttentionCard/.test(page) && /\{c\.text\}/.test(page) && /function SupNum/.test(page));
ok('2.5 R5 aksiyon köprüsü (Öneri: + action)',
  /Öneri: \{c\.action\}/.test(page) && /function ExpertCard/.test(page) && /Bilgi paylaşımı için referans/.test(page));
ok('2.6 R2 dengeli çoğunluk katlanır (BalancedCollapsed)',
  /function BalancedCollapsed/.test(page) && /dengeli çalışıyor/.test(page) && /Tümünü göster/.test(page));

if (process.env.SMOKE_LIVE === '1') {
  console.log('── CANLI ──');
  const BASE = 'http://localhost:3101';
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  try {
    const login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'supervisor@varuna.dev', password: 'Test1234!' }) })).json();
    const H = { Authorization: `Bearer ${login.accessToken}`, 'Content-Type': 'application/json' };
    const r = await (await fetch(`${BASE}/api/analytics/people-performance`, { method: 'POST', headers: H, body: JSON.stringify({ from, to: today }) })).json();
    ok('L1 topExpertise + coaching.action canlı geliyor',
      r.people.some((p) => (p.topExpertise ?? []).length > 0)
      && r.people.some((p) => p.coaching?.action));
    const withExpertise = r.people.find((p) => (p.topExpertise ?? []).length > 0);
    ok('L2 KB uzmanlık topic + fasterPct shape',
      withExpertise && typeof withExpertise.topExpertise[0].topic === 'string' && 'fasterPct' in withExpertise.topExpertise[0]);
  } catch (e) { fail++; console.log(`FAIL — CANLI: ${e.message}`); }
} else { sk('CANLI', 'SMOKE_LIVE!=1'); }

console.log(`\nPASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
process.exit(fail ? 1 : (skip && process.env.SMOKE_LIVE === '1' && !process.env.ALLOW_SKIP ? 2 : 0));
