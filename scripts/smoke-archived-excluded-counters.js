/**
 * smoke-archived-excluded-counters.js — 2026-07-06
 * Arşivli vakaların sayaç/analitik/cron yüzeylerinden dışlanması.
 * Bağlam: PR-SD "KPI'da 1-2 arşivli tolere edilir" varsayımı, 448 arşivli
 * temizlik vakasıyla çöktü (TOPLAM AÇIK 799 görünüyordu, gerçek 244).
 * Canlı kanıt (2026-07-06): /cases/stats totalOpen=244 == DB arşivsiz birebir;
 * ops overview createdInPeriod arşivsiz sayıyla uyumlu.
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const expectTrue = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS — ${name}`); }
  else { fail += 1; console.log(`FAIL — ${name}`); }
};
const read = (p) => readFileSync(p, 'utf8');

const repo = read('server/db/caseRepository.js');
expectTrue('1. getStats scope baseline exclude (tüm rol sayaçları tek noktadan)',
  /const scope = \{ companyId: \{ in: allowedCompanyIds \}, isArchived: false \}/.test(repo));

const aggr = read('server/analytics/operationsAggregator.js');
expectTrue('2. operationsAggregator buildWhereSql — raw SQL [isArchived] = 0 (tüm pano metrikleri)',
  /buildWhereSql[\s\S]{0,900}clauses\.push\('\[isArchived\] = 0'\)/.test(aggr));
expectTrue('3. patternAlert daraltılmış kesişim findMany isArchived:false',
  /id: \{ in: allIds \},\s*companyId: \{ in: scope\.companyIds \},\s*isArchived: false/.test(aggr));

const drill = read('server/analytics/drilldownQuery.js');
expectTrue('4. drilldown where — kart sayısı ile liste tutarlı',
  /\{ companyId: \{ in: scope\.companyIds \} \}, \{ isArchived: false \}/.test(drill));

const bull = read('server/analytics/bulletinAggregator.js');
expectTrue('5. bülten snoozed raw SQL [isArchived] = 0 (diğer bülten sorguları computeOperationsOverview üstünden zaten kapsandı)',
  bull.includes('AND [isArchived] = 0'));

const pat = read('server/lib/patternInsight.js');
expectTrue('6. patternInsight tetik vakaları + baseline arşivsiz',
  (pat.match(/isArchived: false/g) ?? []).length >= 2);

const det = read('server/cron/patternDetect.js');
expectTrue('7. patternDetect groupBy + tetik id fetch arşivsiz (sahte spike yok)',
  (det.match(/isArchived: false/g) ?? []).length >= 2);

const sla = read('server/cron/slaBreachSweep.js');
expectTrue('8. slaBreachSweep arşivli vakayı ihlal damgalamaz',
  /slaViolation: false,[\s\S]{0,400}isArchived: false/.test(sla));

const qa = read('server/cron/qaScoreBatch.js');
expectTrue('9. qaScoreBatch arşivliye QA skoru üretmez',
  /status: 'Cozuldu', qaScoredAt: null, isArchived: false/.test(qa));

const act = read('server/lib/actionSummaryAi.js');
expectTrue('10. actionSummaryAi geçmiş vaka + SLA ihlal sayımları arşivsiz',
  (act.match(/isArchived: false/g) ?? []).length >= 2);

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
