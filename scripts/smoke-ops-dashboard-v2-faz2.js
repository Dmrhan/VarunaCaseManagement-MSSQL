/**
 * smoke-ops-dashboard-v2-faz2.js — 2026-07-05
 *
 * Ops Panosu v2 FAZ 2 (docs/OPERATIONS_DASHBOARD_V2.md): AI görüş alanı —
 * 5 aggregate ailesi + RUNA prompt + UI mini kartlar.
 * KRİTİK: PII snapshot testi (kabul kriteri #1) — buildOperationsSnapshot'a
 * PII enjekte edilmiş payload verilir, çıktıda İZİ OLMAMALI.
 */
import { readFileSync } from 'node:fs';
import { buildOperationsSnapshot } from '../server/ai/operationsAnalyst.js';

let pass = 0;
let fail = 0;
const expectTrue = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS — ${name}`); }
  else { fail += 1; console.log(`FAIL — ${name}`); }
};

const aggr = readFileSync('server/analytics/operationsAggregator.js', 'utf8');
const analyst = readFileSync('server/ai/operationsAnalyst.js', 'utf8');
const page = readFileSync('src/features/analytics/OperationsDashboardPage.tsx', 'utf8');
const lens = readFileSync('src/features/analytics/operationsLensConfig.ts', 'utf8');
const svc = readFileSync('src/services/analyticsService.ts', 'utf8');

console.log('── 1) Aggregator — 5 aile ──');
expectTrue('1.1 queryBySmartTicketTaxonomy (JSON_VALUE + label snapshot, TaxonomyDef join YOK)',
  aggr.includes('async function queryBySmartTicketTaxonomy')
  && aggr.includes("JSON_VALUE([customFields], '$.smartTicket.${field}')"));
expectTrue('1.2 taksonomi alan allowlist (SQL injection guard)',
  aggr.includes('if (!SMART_TICKET_TAXONOMY_FIELDS.includes(field)) return []'));
expectTrue('1.3 queryBySolutionStepSource subquery (join ambiguity yok) + kb oranı',
  aggr.includes('async function queryBySolutionStepSource')
  && aggr.includes('s.[caseId] IN (') && aggr.includes('kbAssistedResolutionRate'));
expectTrue('1.4 queryMailOps: pending + hacim + PERCENTILE_CONT medyan',
  aggr.includes('async function queryMailOps') && aggr.includes('PERCENTILE_CONT(0.5)'));
expectTrue('1.5 queryPatternAlertSummary: status alanı (state DEĞİL) + spec sapma notu',
  aggr.includes("status: 'active'") && aggr.includes('largestSpike'));
expectTrue('1.5b Codex R1 P2: daraltılmış kapsamda alarm caseIds kesişimi (takım/kişi/müşteri)',
  aggr.includes('const narrowed =')
  && /queryPatternAlertSummary\(scope, filters\)/.test(aggr)
  && aggr.includes('a.ids.filter((id) => scopedSet.has(id))'));
expectTrue('1.6 queryQaAverages: MIN_SAMPLE.qaScore altında null',
  aggr.includes('n < MIN_SAMPLE.qaScore'));
expectTrue('1.7 response yeni alanlar + qa minSample violation',
  aggr.includes('bySmartTicketPlatform,') && aggr.includes('kbAssistedResolutionRate: solutionStepSource.kbAssistedResolutionRate')
  && aggr.includes("minSampleNote('qaAverages'"));

console.log('── 2) PII snapshot testi (kabul kriteri #1) ──');
const poisonedPayload = {
  kpis: {}, byStatus: [], byPriority: [], byCaseType: [], byTeam: [], byCategory: [],
  topAtRiskAccounts: [{ accountName: 'Test AŞ', count: 3 }],
  bySmartTicketPlatform: [{ key: 'p', label: 'P', count: 1 }],
  bySolutionStepSource: [{ key: 'manual', count: 2 }],
  kbAssistedResolutionRate: 0.4,
  mailOps: { pendingCustomerReply: 1, inboundVolume: 2, outboundVolume: 3, firstResponseMedianMin: 10 },
  patternAlerts: { activeCount: 1, largestSpike: { category: 'X', caseCount: 5 } },
  qaAverages: { empathy: 4, clarity: 4, speed: 4, sampleCount: 20 },
  // 🔒 PII ZEHRİ — snapshot'a SIZMAMALI (builder yalnız bilinen alanları kopyalar)
  customerContactEmail: 'gizli@musteri.com',
  customerContactName: 'Gizli Kişi',
  customerCompanyName: 'Gizli Şirket AŞ',
  cases: [{ title: 'GİZLİ VAKA BAŞLIĞI', customerContactPhone: '+905551112233' }],
};
const snap = buildOperationsSnapshot(
  { scopeKind: 'company', companyIds: ['C1'], canCrossCompanyAgg: false },
  poisonedPayload,
  { from: '2026-01-01', to: '2026-01-31' },
);
const snapStr = JSON.stringify(snap);
expectTrue('2.1 customerContact* snapshot\'ta YOK',
  !snapStr.includes('customerContact') && !snapStr.includes('gizli@musteri.com') && !snapStr.includes('Gizli Kişi'));
expectTrue('2.2 customerCompanyName snapshot\'ta YOK', !snapStr.includes('Gizli Şirket'));
expectTrue('2.3 vaka başlığı / telefon snapshot\'ta YOK',
  !snapStr.includes('GİZLİ VAKA') && !snapStr.includes('5551112233'));
expectTrue('2.4 FAZ 2 alanları snapshot\'ta VAR',
  snapStr.includes('kbAssistedResolutionRate') && snapStr.includes('mailOps')
  && snapStr.includes('patternAlerts') && snapStr.includes('qaAverages')
  && snapStr.includes('smartTicket'));

console.log('── 3) RUNA prompt rehberi (2f) ──');
expectTrue('3.1 FAZ2_GUIDANCE tanımlı + brief prompt\'ta',
  analyst.includes('const FAZ2_GUIDANCE') && /buildBriefPrompt[\s\S]{0,600}FAZ2_GUIDANCE/.test(analyst));
expectTrue('3.2 insights prompt\'ta + yeni alan evidence kuralı',
  /buildInsightsPrompt[\s\S]{0,800}FAZ2_GUIDANCE/.test(analyst)
  && analyst.includes('bucketKind/bucketKey NULL birakilabilir'));
expectTrue('3.3 kbAssistedResolutionRate fiili sayıyla atıf talimatı (kabul kriteri #4)',
  analyst.includes('CÜMLE İÇİNDE fiili sayıyla söyle'));
expectTrue('3.4 commentary-only kural (yeni kategori ÖNERME)',
  analyst.includes('Yeni kategori ÖNERME'));
expectTrue('3.5 drilldown asistanı FAZ 2 verilerini görür (kbRate/alarm/mailOps/taksonomi)',
  /buildDrilldownAssistPrompt[\s\S]{0,1500}kbAssistedResolutionRate: snapshot/.test(analyst)
  && /buildDrilldownAssistPrompt[\s\S]{0,2500}smartTicketTop/.test(analyst));

console.log('── 4) UI — AI Görüş bölümü ──');
expectTrue('4.1 aiDataGroup section key + operations lens sırasında',
  lens.includes("'aiDataGroup'") && /'requestOriginGroup',\s*'aiDataGroup',/.test(lens));
expectTrue('4.2 müşteri + yönetici lens\'lerinde gizli',
  (lens.match(/hiddenSections: \[[^\]]*'aiDataGroup'/g) ?? []).length === 2);
expectTrue('4.3 5 mini kart', ['Akıllı Sınıflandırma', 'Çözüm Kaynağı', 'Mail Operasyonu', 'Örüntü Alarmları', 'QA Ortalamaları']
  .every((t) => page.includes(`title="${t}"`)));
expectTrue('4.4 KB-destekli çözüm başlık metriği', page.includes('KB-destekli çözüm'));
expectTrue('4.5 çözüm kaynağı TR etiketleri', page.includes("external_kb: 'Bilgi Bankası'") && page.includes("ai_suggested_step: 'AI Önerisi'"));
expectTrue('4.6 null guard\'lar (—) ', page.includes("'—'"));

console.log('── 5) Servis tipleri ──');
expectTrue('5.1 OverviewTaxonomyRow + 5 taksonomi alanı',
  svc.includes('interface OverviewTaxonomyRow') && svc.includes('bySmartTicketImpact: OverviewTaxonomyRow[]'));
expectTrue('5.2 mailOps/patternAlerts/qaAverages tipleri',
  svc.includes('firstResponseMedianMin: number | null') && svc.includes('largestSpike:') && svc.includes('sampleCount: number'));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
