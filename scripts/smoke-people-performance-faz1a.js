/**
 * smoke-people-performance-faz1a.js — 2026-07-07
 * Performans Panosu FAZ 1a — kişi bazlı metrik motoru (queryByPerson +
 * computePeoplePerformanceOverview) + /people-performance endpoint.
 * Yapısal doğrulama (VPN/DB gerektirmez); canlı doğrulama VPN gelince.
 *
 * İlkeler (maket + kullanıcı kararları):
 *  - Yöneticinin dili: "Tipik çözüm süresi", "Yeniden açılma oranı" vb.
 *  - Her metrik { value, unit, formula, sampleSize } sözleşmesi — tek kaynak backend
 *  - Guardrail: oran/medyan MIN_SAMPLE.agentPerformance (20) altında null
 *  - Medyan (ortalama değil) · WIP anlık · arşivli hariç (baseWhere)
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`PASS — ${name}`); } else { fail++; console.log(`FAIL — ${name}`); } };
const read = (p) => readFileSync(p, 'utf8');

const aggr = read('server/analytics/operationsAggregator.js');
const routes = read('server/routes/analytics.js');
const formulas = read('server/analytics/metricFormulas.js');

console.log('── 1) Metrik motoru — queryByPerson ──');
ok('1.1 queryByPerson + medyan & P90 PERCENTILE_CONT PARTITION BY kişi',
  /async function queryByPerson/.test(aggr)
  && /PERCENTILE_CONT\(0\.5\)[\s\S]{0,120}OVER \(PARTITION BY \[assignedPersonId\]\)/.test(aggr)
  && /PERCENTILE_CONT\(0\.9\)[\s\S]{0,120}OVER \(PARTITION BY \[assignedPersonId\]\)/.test(aggr));
ok('1.2 oran sayımları mevcut kodla tutarlı (reopen/sla/escalation/transfer)',
  aggr.includes("[status] = 'YenidenAcildi' THEN 1")
  && aggr.includes('[slaViolation] = 1 THEN 1')
  && aggr.includes("[escalationLevel] <> 'Yok' THEN 1")
  && aggr.includes('[transferCount] > 0 THEN 1'));
ok('1.3 oran paydası = dönemde çözülen (resolvedAt period) + arşivli hariç (baseWhere)',
  /resolvedAt\] >= @P\$\{p1\.idx\} AND \[resolvedAt\] < @P\$\{p2\.idx\}/.test(aggr)
  && /queryByPerson[\s\S]{0,1400}\$\{baseWhere\.sql\}/.test(aggr));
ok('1.4 WIP anlık (dönemden bağımsız, OPEN_STATUS_DB_VALUES)',
  /open_cnt[\s\S]{0,200}\[status\] IN \(\$\{w1\.list\}\)/.test(aggr)
  && /withArrayParam\(baseWhere, OPEN_STATUS_DB_VALUES\)/.test(aggr));

console.log('── 2) Metrik sözleşmesi + guardrail ──');
ok('2.1 { value, unit, formula, sampleSize, insufficient } sözleşmesi',
  /key, label, value, unit, formula, sampleSize: n, insufficient/.test(aggr));
ok('2.2 guardrail: oran/medyan MIN_SAMPLE.agentPerformance altında null',
  aggr.includes("const AGENT_MIN_KIND = 'agentPerformance'")
  && /isInsufficientSample\(n, AGENT_MIN_KIND\)/.test(aggr)
  && /agentPerformance: 20/.test(formulas));
ok('2.3 yöneticinin dili (maket etiketleri backend\'de)',
  aggr.includes("'Tipik çözüm süresi'") && aggr.includes("'Yeniden açılma oranı'")
  && aggr.includes("'Elindeki açık iş'") && aggr.includes("'Yavaş uç'")
  && aggr.includes("'Zamanında çözüm'"));
ok('2.4 medyan kullanılıyor (ortalama değil) + saat birimi',
  aggr.includes("'ortadaki vaka · açılış→çözüm'") && /roundHours\(row\.medianHours\)/.test(aggr));
ok('2.5 zamanında çözüm = 100 − SLA ihlal oranı',
  /roundPct\(100 - safePct\(row\.slaBreached, n\)\)/.test(aggr));

console.log('── 3) Ekip benchmark (bağlam) ──');
ok('3.1 teamBenchmark = kişiler arası ortanca (vs-ekip çipleri için)',
  /function medianOf/.test(aggr)
  && /teamBenchmark = \{[\s\S]{0,300}medianOf\(people\.map/.test(aggr));
ok('3.2 computePeoplePerformanceOverview export + buildWhereSql zinciri',
  /export async function computePeoplePerformanceOverview/.test(aggr)
  && /buildWhereSql\(scope, filters\)/.test(aggr));

console.log('── 4) Endpoint ──');
ok('4.1 POST /people-performance + Supervisor+ (requireOverviewAnalytics)',
  /router\.post\('\/people-performance', requireOverviewAnalytics/.test(routes));
ok('4.2 overview ile aynı validation + scope zinciri (body scope genişletemez)',
  /people-performance[\s\S]{0,400}validateOverviewBody\(body\)/.test(routes)
  && /people-performance[\s\S]{0,600}deriveAnalyticsScope\(req\.user, body\)/.test(routes));
ok('4.3 computePeoplePerformanceOverview çağrısı + import',
  routes.includes('computePeoplePerformanceOverview')
  && /import \{ computeOperationsOverview, computePeoplePerformanceOverview \}/.test(routes));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
