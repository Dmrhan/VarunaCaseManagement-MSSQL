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
expect('1.2 querySnoozedActiveByStatus (Codex P2 double-count fix)',
  /async function querySnoozedActiveByStatus/.test(aggCode), true);
expect('1.3 build4BucketStatus fonksiyonu (snoozed object signature)',
  /function build4BucketStatus\(byStatus, snoozed\)/.test(aggCode), true);
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

console.log('\n── 3) build4BucketStatus davranış (Codex P2 fix) ──');
// Senaryo: 10 Açık vakanın 2'si snoozed; 5 ThirdPartyWaiting vakanın 1'i snoozed.
const sample = [
  { key: 'Acik', count: 10 },
  { key: 'YenidenAcildi', count: 1 },
  { key: 'Incelemede', count: 3 },
  { key: 'Eskalasyon', count: 1 },
  { key: 'ThirdPartyWaiting', count: 5 },
  { key: 'Cozuldu', count: 8 },
  { key: 'IptalEdildi', count: 2 },
];
// 2 snoozed Açık + 1 snoozed ThirdPartyWaiting = 3 toplam snoozed
const snoozed = {
  total: 3,
  byStatus: [
    { key: 'Acik', count: 2 },
    { key: 'ThirdPartyWaiting', count: 1 },
  ],
};
const r = build4BucketStatus(sample, snoozed);
expect('3.1 open = 10 + 1 (YenidenAcildi) - 2 (snoozed Acik) = 9',
  r.find((x) => x.key === 'open').count, 9);
expect('3.2 inProgress = 3 + 1 = 4 (snoozed yok)',
  r.find((x) => x.key === 'inProgress').count, 4);
expect('3.3 waiting = 5 (ThirdPartyWaiting) - 1 (snoozed) + 3 (toplam snooze) = 7',
  r.find((x) => x.key === 'waiting').count, 7);
expect('3.4 closed = 8 + 2 = 10',
  r.find((x) => x.key === 'closed').count, 10);
// 4-kova total = byStatus total + 0 (snooze double-count YOK)
const totalBuckets = r.reduce((s, b) => s + b.count, 0);
const totalByStatus = sample.reduce((s, x) => s + x.count, 0);
expect('3.5 4-kova toplamı byStatus toplamı ile uyumlu (double-count yok)',
  totalBuckets, totalByStatus);
expect('3.6 boş byStatus + boş snooze = tüm 0',
  build4BucketStatus([], { total: 0, byStatus: [] }).every((x) => x.count === 0), true);
expect('3.7 bilinmeyen status sessiz skip',
  build4BucketStatus([{ key: 'GarbageStatus', count: 99 }], { total: 0, byStatus: [] })
    .every((x) => x.count === 0), true);
expect('3.8 Negatif guard — snoozed > status count → clamp 0',
  build4BucketStatus(
    [{ key: 'Acik', count: 1 }],
    { total: 5, byStatus: [{ key: 'Acik', count: 5 }] },
  ).find((x) => x.key === 'open').count, 0);

console.log('\n── 4) Snooze query — SQL injection + GROUP BY status ──');
expect('4.1 querySnoozedActiveByStatus — companyId IN placeholder döngü',
  /querySnoozedActiveByStatus[\s\S]{0,800}companyPlaceholders[\s\S]{0,200}params\.push\(v\)/.test(aggCode), true);
expect('4.2 querySnoozedActiveByStatus — accountId parametre',
  /querySnoozedActiveByStatus[\s\S]{0,1200}params\.push\(accountId\)/.test(aggCode), true);
expect('4.3 querySnoozedActiveByStatus — snoozeUntil > sysutcdatetime()',
  /\[snoozeUntil\] > sysutcdatetime\(\)/.test(aggCode), true);
expect('4.4 querySnoozedActiveByStatus — GROUP BY status (double-count fix için)',
  /querySnoozedActiveByStatus[\s\S]{0,2000}GROUP BY \[status\]/.test(aggCode), true);
expect('4.5 querySnoozedActiveByStatus — scope/account boş ise empty payload',
  /querySnoozedActiveByStatus[\s\S]{0,300}const empty = \{ total: 0, byStatus: \[\] \}/.test(aggCode), true);

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

console.log('\n── 9) Codex P1 — CSM scope bypass ────────────────');
expect('9.1 endpoint scope.personIds = [] (CSM\'in self-scope filter\'ı temizle)',
  /monthly-bulletin[\s\S]{0,3000}personIds: \[\]/.test(routesCode), true);
expect('9.2 endpoint scope.teamIds = [] (Supervisor team-scope temizle)',
  /monthly-bulletin[\s\S]{0,3000}teamIds: \[\]/.test(routesCode), true);
expect('9.3 rawScope deriveAnalyticsScope çağrılıyor (companyIds korunur)',
  /const rawScope = deriveAnalyticsScope\(req\.user, body\)/.test(routesCode), true);

console.log('\n── 10) Codex P2 — byCategory shape map ──────────');
expect('10.1 byCategory normalize (queryByCategory shape → {key, label, count})',
  /byCategoryNormalized[\s\S]{0,300}overview\.byCategory[\s\S]{0,200}r\.category[\s\S]{0,200}r\.total/.test(aggCode), true);
expect('10.2 Response\'da byCategory normalized version',
  /byCategory: byCategoryNormalized/.test(aggCode), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
