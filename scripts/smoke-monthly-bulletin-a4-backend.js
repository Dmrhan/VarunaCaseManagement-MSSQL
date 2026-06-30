/**
 * smoke-monthly-bulletin-a4-backend.js — A4a backend orchestrator + endpoint.
 *
 * KAPSAM (static):
 *   - bulletinAggregator.js mevcut
 *   - computeMonthlyBulletin export'lu
 *   - STATUS_BUCKET_MAP 7→4 doğru (Acik/YenidenAcildi → open vb.)
 *   - querySnoozedActiveCount parametreli (SQL injection korunma)
 *   - build4BucketStatus snoozedActive'i waiting'e ekler
 *   - buildWhereSql filters.accountId opsiyonel filter destekler
 *   - Endpoint mount: POST /monthly-bulletin
 *   - Scope check: account.companyId IN scope.companyIds intersection 403 guard
 *   - Privacy: response'ta customerContact* girmediği (mevcut aggregator)
 */

import { readFileSync } from 'node:fs';
import { _internal } from '../server/analytics/bulletinAggregator.js';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${actual} expected=${expected}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

// ─── 1) bulletinAggregator yapısı ──────────────────────────────────
const agg = read('server/analytics/bulletinAggregator.js');
const aggCode = strip(agg);

console.log('── 1) bulletinAggregator yapısı ──────────────────');
expect('1.1 computeMonthlyBulletin export\'lu',
  /^export async function computeMonthlyBulletin/m.test(aggCode), true);
expect('1.2 querySnoozedActiveCount fonksiyonu',
  /async function querySnoozedActiveCount/.test(aggCode), true);
expect('1.3 build4BucketStatus fonksiyonu',
  /function build4BucketStatus\(byStatus, snoozedActive\)/.test(aggCode), true);
expect('1.4 emptyBulletinPayload helper (scope boş + account boş)',
  /function emptyBulletinPayload/.test(aggCode), true);

console.log('\n── 2) 7→4 STATUS_BUCKET_MAP (runtime) ───────────');
const { STATUS_BUCKET_MAP, BUCKET_LABELS, build4BucketStatus } = _internal;
expect('2.1 Acik → open', STATUS_BUCKET_MAP['Acik'], 'open');
expect('2.2 YenidenAcildi → open', STATUS_BUCKET_MAP['YenidenAcildi'], 'open');
expect('2.3 Incelemede → inProgress', STATUS_BUCKET_MAP['Incelemede'], 'inProgress');
expect('2.4 Eskalasyon → inProgress', STATUS_BUCKET_MAP['Eskalasyon'], 'inProgress');
expect('2.5 ThirdPartyWaiting → waiting', STATUS_BUCKET_MAP['ThirdPartyWaiting'], 'waiting');
expect('2.6 Cozuldu → closed', STATUS_BUCKET_MAP['Cozuldu'], 'closed');
expect('2.7 IptalEdildi → closed', STATUS_BUCKET_MAP['IptalEdildi'], 'closed');
expect('2.8 BUCKET_LABELS TR',
  BUCKET_LABELS.open === 'Açık' && BUCKET_LABELS.inProgress === 'Üstlenildi'
    && BUCKET_LABELS.waiting === 'Bekletiliyor' && BUCKET_LABELS.closed === 'Kapalı', true);

console.log('\n── 3) build4BucketStatus davranış ────────────────');
const sample = [
  { key: 'Acik', count: 5 },
  { key: 'YenidenAcildi', count: 1 },
  { key: 'Incelemede', count: 3 },
  { key: 'Eskalasyon', count: 1 },
  { key: 'ThirdPartyWaiting', count: 2 },
  { key: 'Cozuldu', count: 10 },
  { key: 'IptalEdildi', count: 2 },
];
const r = build4BucketStatus(sample, 3); // snooze 3
expect('3.1 open = Acik (5) + YenidenAcildi (1) = 6',
  r.find((x) => x.key === 'open').count, 6);
expect('3.2 inProgress = Incelemede (3) + Eskalasyon (1) = 4',
  r.find((x) => x.key === 'inProgress').count, 4);
expect('3.3 waiting = ThirdPartyWaiting (2) + snooze (3) = 5',
  r.find((x) => x.key === 'waiting').count, 5);
expect('3.4 closed = Cozuldu (10) + IptalEdildi (2) = 12',
  r.find((x) => x.key === 'closed').count, 12);
expect('3.5 boş byStatus + snooze 0 = tüm 0',
  build4BucketStatus([], 0).every((x) => x.count === 0), true);
expect('3.6 bilinmeyen status sessiz skip',
  build4BucketStatus([{ key: 'GarbageStatus', count: 99 }], 0)
    .every((x) => x.count === 0), true);

console.log('\n── 4) Snooze query — SQL injection korunma ───────');
expect('4.1 querySnoozedActiveCount — companyId IN placeholder döngü',
  /querySnoozedActiveCount[\s\S]{0,800}companyPlaceholders[\s\S]{0,200}params\.push\(v\)/.test(aggCode), true);
expect('4.2 querySnoozedActiveCount — accountId parametre',
  /querySnoozedActiveCount[\s\S]{0,1200}params\.push\(accountId\)/.test(aggCode), true);
expect('4.3 querySnoozedActiveCount — snoozeUntil > sysutcdatetime()',
  /\[snoozeUntil\] > sysutcdatetime\(\)/.test(aggCode), true);
expect('4.4 querySnoozedActiveCount — scope boş ise 0 dön',
  /querySnoozedActiveCount[\s\S]{0,500}scope\.companyIds\.length === 0\) return 0/.test(aggCode), true);

console.log('\n── 5) computeOperationsOverview accountId filter ──');
const opAgg = read('server/analytics/operationsAggregator.js');
const opCode = strip(opAgg);
expect('5.1 buildWhereSql filters.accountId opsiyonel filter eklendi',
  /filters\.accountId[\s\S]{0,300}\[accountId\] = @P\$\{params\.length\}/.test(opCode), true);
expect('5.2 String typeof check (defansif)',
  /filters\.accountId && typeof filters\.accountId === 'string'/.test(opCode), true);

// ─── 6) Endpoint mount + scope check ───────────────────────────────
const routes = read('server/routes/analytics.js');
const routesCode = strip(routes);

console.log('\n── 6) Endpoint POST /monthly-bulletin ────────────');
expect('6.1 computeMonthlyBulletin import',
  /import \{ computeMonthlyBulletin \} from '\.\.\/analytics\/bulletinAggregator\.js'/.test(routesCode), true);
expect('6.2 router.post(\'/monthly-bulletin\') mount',
  /router\.post\('\/monthly-bulletin', requireOverviewAnalytics/.test(routesCode), true);
expect('6.3 accountId zorunlu validation',
  /monthly-bulletin[\s\S]{0,800}!body\.accountId[\s\S]{0,200}invalid_input/.test(routesCode), true);
expect('6.4 validateOverviewBody REUSE (90-gün cap)',
  /monthly-bulletin[\s\S]{0,1500}validateOverviewBody\(body\)/.test(routesCode), true);
expect('6.5 deriveAnalyticsScope REUSE',
  /monthly-bulletin[\s\S]{0,2000}deriveAnalyticsScope\(req\.user, body\)/.test(routesCode), true);

console.log('\n── 7) Cross-tenant guard (account.companyId ∩ scope) ─');
expect('7.1 Account lookup + accountCompanies select',
  /monthly-bulletin[\s\S]{0,3000}prisma\.account\.findUnique[\s\S]{0,500}accountCompanies/.test(routesCode), true);
expect('7.2 accountCompanyIds ∩ scope.companyIds intersection',
  /monthly-bulletin[\s\S]{0,4000}accountCompanyIds\.filter\([\s\S]{0,200}scope\.companyIds\.includes/.test(routesCode), true);
expect('7.3 Intersection boşsa 403 account_out_of_scope',
  /monthly-bulletin[\s\S]{0,4000}scopeIntersection\.length === 0[\s\S]{0,200}403[\s\S]{0,200}account_out_of_scope/.test(routesCode), true);
expect('7.4 Account bulunamadı 404',
  /monthly-bulletin[\s\S]{0,3500}!account[\s\S]{0,200}404[\s\S]{0,100}account_not_found/.test(routesCode), true);

console.log('\n── 8) Privacy — customerContact* response\'a girmez ─');
expect('8.1 bulletinAggregator response shape — customerContact YOK',
  !/customerContact/.test(aggCode), true);
expect('8.2 endpoint response shape — customerContact YOK',
  !/customerContact/.test(routesCode.match(/monthly-bulletin[\s\S]{0,5000}/)?.[0] ?? ''), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
