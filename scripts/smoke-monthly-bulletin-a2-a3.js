/**
 * smoke-monthly-bulletin-a2-a3.js — Aylık Bülten A2+A3 (account aggregate + SLA).
 *
 * KAPSAM (static):
 *   - queryByAccount fonksiyonu mevcut
 *   - Cross-tenant scope leakage koruması (baseWhere.sql + scope.companyIds)
 *   - SLA compliance: response (slaResponseMetAt vs slaResponseDueAt) +
 *     resolution (resolvedAt vs slaResolutionDueAt) ayrı hesap
 *   - paydaya yalnız set'li alanları al (slaViolation tek Boolean değil,
 *     direkt alan hesabı — backfill-immune)
 *   - computeAccountBulletinAggregate export'lu, totals türetimi mevcut
 *
 * KAPSAM DIŞI (A4 integration):
 *   - Gerçek seed → aggregate → per-AccountCompany satır doğruluğu
 *   - Account başka tenant'a bağlıyken scope dışı verinin gizlenmesi
 */

import { readFileSync } from 'node:fs';

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

const agg = read('server/analytics/operationsAggregator.js');
const aggCode = strip(agg);

console.log('── 1) queryByAccount — yapı ──────────────────────');
expect('1.1 queryByAccount fonksiyonu mevcut',
  /async function queryByAccount\(scope, filters, accountId, from, to, baseWhere\)/.test(aggCode), true);
expect('1.2 scope guard — companyIds.length===0 → []',
  /queryByAccount[\s\S]{0,400}if \(scope\.companyIds\.length === 0\) return \[\]/.test(aggCode), true);
expect('1.3 accountId guard — boş/null → []',
  /queryByAccount[\s\S]{0,500}if \(!accountId \|\| typeof accountId !== 'string'\) return \[\]/.test(aggCode), true);

console.log('\n── 2) Cross-tenant scope leakage koruması ─────────');
expect('2.1 baseWhere.sql kullanır (scope filter)',
  /queryByAccount[\s\S]{0,1500}WHERE \$\{baseWhere\.sql\}/.test(aggCode), true);
expect('2.2 accountId parametre ile (SQL injection korunma)',
  /queryByAccount[\s\S]{0,600}withParam\(baseWhere, accountId\)/.test(aggCode), true);
expect('2.3 createdAt window parametre ile',
  /queryByAccount[\s\S]{0,1500}withParam\(p1, from\)[\s\S]{0,300}withParam\(p2, to\)/.test(aggCode), true);

console.log('\n── 3) Per-AccountCompany breakdown (GROUP BY companyId) ─');
expect('3.1 GROUP BY companyId',
  /queryByAccount[\s\S]{0,1500}GROUP BY \[companyId\]/.test(aggCode), true);
expect('3.2 resolvedCnt — SUM CASE WHEN resolvedAt IS NOT NULL',
  /queryByAccount[\s\S]{0,2000}SUM\(CASE WHEN \[resolvedAt\] IS NOT NULL THEN 1 ELSE 0 END\)/.test(aggCode), true);
expect('3.3 avgResolutionMin — DATEDIFF MINUTE',
  /queryByAccount[\s\S]{0,2000}DATEDIFF\(MINUTE, \[createdAt\], \[resolvedAt\]\)/.test(aggCode), true);

console.log('\n── 4) SLA compliance (response + resolution ayrı) ───');
expect('4.1 slaResolutionCompliantCnt — resolvedAt ≤ slaResolutionDueAt',
  /\[resolvedAt\] <= \[slaResolutionDueAt\]/.test(aggCode), true);
expect('4.2 slaResponseCompliantCnt — slaResponseMetAt ≤ slaResponseDueAt',
  /\[slaResponseMetAt\] <= \[slaResponseDueAt\]/.test(aggCode), true);
expect('4.3 slaViolation Boolean kullanılmıyor (backfill-immune)',
  !/queryByAccount[\s\S]{0,2000}\[slaViolation\]/.test(aggCode), true);
expect('4.4 responseMetCnt — payda olarak ayrı (only set ones)',
  /SUM\(CASE WHEN \[slaResponseMetAt\] IS NOT NULL THEN 1 ELSE 0 END\)\s+AS responseMetCnt/.test(aggCode), true);

console.log('\n── 5) computeAccountBulletinAggregate (public API) ──');
expect('5.1 export edildi',
  /^export async function computeAccountBulletinAggregate/m.test(aggCode), true);
expect('5.2 scope boşsa empty payload',
  /computeAccountBulletinAggregate[\s\S]{0,500}scope\.companyIds\.length === 0[\s\S]{0,200}emptyAccountTotals/.test(aggCode), true);
expect('5.3 accountId boşsa empty payload',
  /computeAccountBulletinAggregate[\s\S]{0,800}if \(!accountId\)[\s\S]{0,200}emptyAccountTotals/.test(aggCode), true);
expect('5.4 Totals — count + resolvedCount + SLA counts toplama',
  /computeAccountBulletinAggregate[\s\S]{0,3000}acc\.count \+= row\.count/.test(aggCode), true);
expect('5.5 avgResolutionMinutes weighted by resolvedCount',
  /computeAccountBulletinAggregate[\s\S]{0,3000}avgResolutionMinutes \* row\.resolvedCount/.test(aggCode), true);
expect('5.6 slaResolutionCompliancePct — payda resolvedCount (set\'li)',
  /slaResolutionCompliancePct[\s\S]{0,200}totals\.resolvedCount > 0/.test(aggCode), true);
expect('5.7 slaResponseCompliancePct — payda responseMetCount (set\'li)',
  /slaResponseCompliancePct[\s\S]{0,200}totals\.responseMetCount > 0/.test(aggCode), true);
expect('5.8 emptyAccountTotals helper mevcut',
  /function emptyAccountTotals\(\)/.test(aggCode), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
