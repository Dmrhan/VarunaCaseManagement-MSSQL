/**
 * smoke-person-engagement-faz2c.js — 2026-07-07
 * Performans Panosu FAZ 2c — Etkinlik & Katkı (gizlenme tespiti). HASSAS.
 * Yapısal doğrulama + canlı endpoint (supervisor 200 shape + agent 403 + verdict dürüstlüğü).
 * Tasarım sözleşmesi: tek düşük sinyal ASLA "kaytarıyor" demez; verdict concern-tetikli.
 *
 * Canlı çalıştırma (backend :3101 + VPN/DB): env SMOKE_LIVE=1
 */
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0, skip = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const sk = (n, why) => { skip++; console.log(`SKIP — ${n} (${why})`); };
const read = (p) => readFileSync(p, 'utf8');
const svc = read('src/services/analyticsService.ts');
const prof = read('src/features/analytics/PersonProfileView.tsx');
const agg = read('server/analytics/personDetailAggregator.js');
const route = read('server/routes/analytics.js');

console.log('── Servis ──');
ok('1.1 personEngagement metodu + endpoint + tipler',
  /async personEngagement\(/.test(svc) && svc.includes("'/api/analytics/person-engagement'")
  && /interface EngagementSignal/.test(svc) && /interface EngagementResponse/.test(svc));

console.log('── Backend ──');
ok('2.1 computePersonEngagement export + endpoint (requireSupervisorAnalytics)',
  /export (async )?function computePersonEngagement/.test(agg)
  && route.includes("'/person-engagement'") && /person-engagement[\s\S]{0,160}requireSupervisorAnalytics/.test(route));
ok('2.2 5 davranış sinyali (aktivite·üstlenme·dokunulmayan·zor iş·devir)',
  /key: 'activityPerDay'/.test(agg) && /key: 'claims'/.test(agg) && /key: 'idleOwned'/.test(agg)
  && /key: 'hardSharePct'/.test(agg) && /key: 'transferOutPct'/.test(agg));
ok('2.3 verdict CONCERN-TETİKLİ (tek skor değil) + tek warn ≠ kaytarma',
  /const concerns = signals\.filter\(\(x\) => x\.tone === 'warn'\)\.length/.test(agg)
  && /concerns === 0 && resolved >= MIN_SAMPLE\.default[\s\S]{0,20}'active'/.test(agg)
  && /concerns >= 3[\s\S]{0,20}'watch'/.test(agg));
ok('2.4 dokunulmayan iş beklemeleri HARİÇ (müşteri/3.taraf/erteleme)',
  /müşteri\/3\.taraf\/erteleme beklemesi HARİÇ/.test(agg));
ok('2.5 PII-free — customerContact/customerCompany/exampleTitles payload\'a girmez',
  !/exampleTitles/.test(agg) && !/customerContact/.test(agg) && !/customerCompanyName/.test(agg));
ok('2.6 team scope engagement sinyallerine de uygulanır (Codex #457 P2 — çapraz-takım sızıntısı yok)',
  /function teamClause/.test(agg)
  && /teamClause\(p, teamIds, 'cs\.\[assignedTeamId\]'\)/.test(agg)
  && /teamClause\(idleParams, teamIds, 'c\.\[assignedTeamId\]'\)/.test(agg)
  // devir kaynak-takımıyla (t.[fromTeamId]), güncel assignment ile DEĞİL (Codex #457 R2)
  && /teamClause\(trParams, teamIds, 't\.\[fromTeamId\]'\)/.test(agg));
ok('2.7 CaseActivity sinyalleri arşivli vakayı hariç tutar (Codex #457 R2 — Case join + isArchived=0)',
  /const caseJoin = 'JOIN \[Case\] cs ON cs\.\[id\] = ca\.\[caseId\]'/.test(agg)
  && (agg.match(/cs\.\[isArchived\] = 0/g) || []).length >= 3
  && /EXISTS \(SELECT 1 FROM \[Case\] c WHERE c\.\[id\]=t\.\[caseId\] AND c\.\[isArchived\] = 0\)/.test(agg));
ok('2.8 devir tenant filtresi CaseTransfer\'a doğrudan (Codex #457 R3 — companyId,transferredAt index)',
  /t\.\[fromPersonId\] = \$\{trPIdx\} AND t\.\[companyId\] IN \(\$\{trCC\}\)/.test(agg));
ok('2.9 idle vaka en az 7 gündür var olmalı — taze/aktivitesiz vaka watch\'ı şişirmez (Codex #457 R3)',
  /c\.\[createdAt\] <= \$\{idleSIdx\}/.test(agg));
ok('2.10 idle sinyali TERS DEĞİL — top-ajanda (pendingCustomerReply=1) dahil, sadece müşteri-bekleyen (0+outbound) hariç (Codex #457 R4)',
  /NOT \(c\.\[pendingCustomerReply\] = 0 AND c\.\[lastEmailOutboundAt\] IS NOT NULL\)/.test(agg)
  // eski ters filtre (düz `pendingCustomerReply = 0`) kalmadı
  && !/\bAND c\.\[pendingCustomerReply\] = 0\b/.test(agg));
ok('2.11 idle staleness inbound e-postadan da ölçülür — bugün gelen müşteri yanıtı idle şişirmez (Codex #457 R5)',
  /c\.\[lastEmailInboundAt\] IS NULL OR c\.\[lastEmailInboundAt\] <= \$\{idleSIdx\}/.test(agg));
ok('2.12 engagement kişi-lookup SCOPE\'lu — kapsam-dışı personId boş payload (kişi-varlığı sızıntısı yok) (Codex #457 R6)',
  /let inScope = \(await queryPersonName\(companyIds, teamIds, personId\)\) != null/.test(agg)
  && /if \(!inScope\) \{[\s\S]{0,400}return \{ signals: \[\], verdict: null/.test(agg));
ok('2.13 scope kanıtı transfer-only kişiyi de kapsar — her vakayı devreden hot-potato gizlenmesin (Codex #457 R7)',
  /FROM \[CaseTransfer\] t\s+WHERE t\.\[fromPersonId\] = \$\{spIdx\} AND t\.\[companyId\] IN/.test(agg)
  && /teamClause\(sp, teamIds, 't\.\[fromTeamId\]'\)/.test(agg));
ok('2.14 transfer scope kanıtı arşivliyi hariç tutar — yalnız-arşivli-devri kişi geçmiş sızdırmaz (Codex #457 R8)',
  /WHERE t\.\[fromPersonId\] = \$\{spIdx\}[\s\S]{0,180}EXISTS \(SELECT 1 FROM \[Case\] c WHERE c\.\[id\]=t\.\[caseId\] AND c\.\[isArchived\] = 0\)/.test(agg));
ok('2.15 kapsam kanıtı BÜTÜNCÜL — 3 kaynak (atanmış+devir+aktivite), aktivite-only kişi de gizlenmez (Codex #457 R8 preempt)',
  /if \(!inScope && uid\) \{/.test(agg)
  && /FROM \[CaseActivity\] a JOIN \[Case\] cs ON cs\.\[id\]=a\.\[caseId\]\s+WHERE a\.\[actorUserId\] = \$\{apUid\} AND cs\.\[companyId\] IN[\s\S]{0,40}cs\.\[isArchived\] = 0/.test(agg));

console.log('── UI (PersonProfileView) ──');
ok('3.1 EngagementSection + verdict banner (4 durum) + anti-toksik caption',
  /function EngagementSection/.test(prof) && /VERDICT_UI/.test(prof)
  && /active:/.test(prof) && /watch:/.test(prof) && /inconclusive:/.test(prof)
  && /Suçlama değil|suçlama değil/i.test(prof));
ok('3.2 5 sinyal kartı — değer + ekip kıyası + tone noktası',
  /eng\.signals\.map/.test(prof) && /ekip \{s\.teamValue == null/.test(prof) && /toneDot\(s\.tone\)/.test(prof));
ok('3.3 "gizlenme deseni neye benzer" açıklayıcı + tek-sinyal guardrail',
  /Gizlenme deseni neye benzer/.test(prof) && /aynı anda/.test(prof) && /Tek bir sinyal/.test(prof));
ok('3.4 profilde render (trend sonrası) + boş-veri koruması',
  /engagement && engagement\.signals\.length > 0 && <EngagementSection/.test(prof));

if (process.env.SMOKE_LIVE === '1') {
  console.log('── CANLI (endpoint) ──');
  const BASE = 'http://localhost:3101';
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  const login = async (email, password) =>
    (await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json());
  try {
    const sup = await login('supervisor@varuna.dev', 'Test1234!');
    if (!sup.accessToken) throw new Error('supervisor login fail');
    const H = { Authorization: `Bearer ${sup.accessToken}`, 'Content-Type': 'application/json' };
    const pp = await (await fetch(`${BASE}/api/analytics/people-performance`, { method: 'POST', headers: H, body: JSON.stringify({ from, to: today }) })).json();
    const pid = pp.people?.[0]?.id;
    const eng = await (await fetch(`${BASE}/api/analytics/person-engagement`, { method: 'POST', headers: H, body: JSON.stringify({ personId: pid, from, to: today }) })).json();
    ok('L1 supervisor 200 + 5 sinyal + verdict shape',
      Array.isArray(eng.signals) && eng.signals.length === 5 && eng.verdict && typeof eng.verdict.read === 'string'
      && eng.signals.every((s) => 'value' in s && 'teamValue' in s && 'tone' in s && 'hint' in s));
    ok('L2 verdict dürüst — concern=0 & resolved≥5 → active (haksız watch yok)',
      !(eng.verdict.concerns === 0 && eng.verdict.resolved >= 5 && eng.verdict.read !== 'active'));
    // Not: team-scope daraltma (Codex #457 P2) DB-fetch teamId ile manuel doğrulandı
    // (L2 merceğinde dokunuş 18.5→0, baseline L1'e daralıyor). Yapısal assert 2.6 guard.
    // authz: agent rolü person-engagement\'e erişememeli (P1)
    const agent = await login('agent@varuna.dev', 'Test1234!');
    if (agent.accessToken) {
      const res = await fetch(`${BASE}/api/analytics/person-engagement`, { method: 'POST', headers: { Authorization: `Bearer ${agent.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ personId: pid, from, to: today }) });
      ok('L3 agent 403 (kişi-davranış verisi supervisor-only)', res.status === 403);
    } else { sk('L3 agent 403', 'agent login yok'); }
  } catch (e) {
    fail++; console.log(`FAIL — CANLI: ${e.message}`);
  }
} else {
  sk('CANLI bloğu', 'SMOKE_LIVE!=1');
}

console.log(`\nPASS=${pass}  FAIL=${fail}  SKIP=${skip}`);
process.exit(fail ? 1 : (skip && process.env.SMOKE_LIVE === '1' && !process.env.ALLOW_SKIP ? 2 : 0));
