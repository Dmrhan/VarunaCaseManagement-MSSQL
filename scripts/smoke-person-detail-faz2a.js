/**
 * smoke-person-detail-faz2a.js — 2026-07-07
 * Performans Panosu FAZ 2a — kişi uzmanlık profili veri motoru
 * (personDetailAggregator) + POST /api/analytics/person-detail.
 * Yapısal doğrulama. Canlı (VPN, supervisor, gerçek veri): HTTP 200, 6 bölüm
 * dolu (uzmanlık/sorunlar/ürün/en-uzun/çözüm-imzası/trend) — teyit edildi.
 */
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const read = (p) => readFileSync(p, 'utf8');
const aggr = read('server/analytics/personDetailAggregator.js');
const routes = read('server/routes/analytics.js');

console.log('── 6 sorgu ailesi ──');
ok('1.1 uzmanlık: kategori dağılımı + konu-içi median + EKİP median kıyası + uzman etiketi',
  /async function queryExpertise/.test(aggr)
  && /PERCENTILE_CONT\(0\.5\)[\s\S]{0,120}OVER \(PARTITION BY \[category\]\)/.test(aggr)
  && /tag = 'expert'/.test(aggr) && /fasterPct/.test(aggr));
ok('1.2 en çok karşılaştığı sorunlar (subCategory) + ürün (productName)',
  /queryProblems[\s\S]{0,600}GROUP BY \[subCategory\]/.test(aggr)
  && /queryProducts[\s\S]{0,600}GROUP BY \[productName\]/.test(aggr));
ok('1.3 en uzun işler: DATEDIFF desc + reopen bayrağı + PII\'siz SELECT (yalnız başlık+taksonomi+süre)',
  /async function queryLongestCases/.test(aggr)
  && /ORDER BY hrs DESC/.test(aggr) && /reopened: r\.status === 'YenidenAcildi'/.test(aggr)
  && !/SELECT[^;]*customerContact/.test(aggr));
ok('1.4 çözüm imzası: kapanış rootCause/resolutionType + permanentPrevention (kişi vs ekip)',
  /async function querySolutionSignature/.test(aggr)
  && /JSON_VALUE\(\[customFields\],'\$\.smartTicket\.closure\.\$\{field\}'\)/.test(aggr)
  && /permanentPreventionPct/.test(aggr) && /teamPermanentPreventionPct/.test(aggr));
ok('1.5 günlük trend: gün başına count+median + 7g yürüyen (dalgalanma yumuşatma)',
  /async function queryDailyTrend/.test(aggr)
  && /CAST\(\[resolvedAt\] AS date\)/.test(aggr) && /rollingMedianHours/.test(aggr));

console.log('── Güvenlik + sözleşme ──');
ok('2.1 tüm sorgular scope: companyId IN + assignedPersonId + isArchived=0',
  /function resolvedWhere/.test(aggr)
  && /\[companyId\] IN \(\$\{companyList\}\) AND \[assignedPersonId\] = \$\{pIdx\}/.test(aggr)
  && /\[isArchived\] = 0/.test(aggr));
ok('2.2 fasterPct sıfıra-yakın ekip medyanında clamp (sunulabilir)',
  /Math\.max\(-99, Math\.min\(99,/.test(aggr));
ok('2.3 computePersonDetail export + Promise.all 6 sorgu',
  /export async function computePersonDetail/.test(aggr)
  && /Promise\.all\(\[[\s\S]{0,400}queryDailyTrend/.test(aggr));

console.log('── Endpoint ──');
ok('3.1 POST /person-detail Supervisor+ + personId zorunlu',
  /router\.post\('\/person-detail', requireSupervisorAnalytics/.test(routes)
  && /typeof body\.personId !== 'string'/.test(routes));
ok('3.2 scope.companyIds ile korunuyor (cross-company sızıntı yok) + import',
  /computePersonDetail\(\{[\s\S]{0,120}allowedCompanyIds: scope\.companyIds/.test(routes)
  && /import \{ computePersonDetail \}/.test(routes));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
