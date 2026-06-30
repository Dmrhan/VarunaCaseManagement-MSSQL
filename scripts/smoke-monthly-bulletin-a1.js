/**
 * smoke-monthly-bulletin-a1.js — Aylık Bülten A1 (aggregator + formatters).
 *
 * KAPSAM (static / DB-bağımsız):
 *   - operationsAggregator.js byRequestType + byOrigin breakdown'ları
 *     Promise.all dizisine eklendi ve return shape'inde döndü
 *   - queryByRequestType + queryByOrigin fonksiyonları mevcut, SQL injection
 *     korumalı (parameterized + GROUP BY)
 *   - Diğer breakdown'lar paterni (scope guard: companyIds.length===0 → [])
 *   - formatters.js REQUEST_TYPE_LABELS export'lu (module-local'den çıktı)
 *   - ORIGIN_LABELS yeni eklendi + ENUM_MAPS registry'sine caseOrigin
 *   - Hem ASCII (Eposta/Diger) hem TR (E-posta/Diğer) varyantları map'li
 *
 * KAPSAM DIŞI (A4 integration smoke):
 *   - Gerçek DB seed → aggregate çağrısı → byRequestType counts doğru mu
 *   - Cross-tenant scope leakage (companyId IN check)
 *
 * Çalıştır:
 *   node scripts/smoke-monthly-bulletin-a1.js
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

// ─── operationsAggregator ──────────────────────────────────────────
const agg = read('server/analytics/operationsAggregator.js');
const aggCode = strip(agg);

console.log('── 1) Aggregator — yeni breakdown\'lar ────────────');
expect('1.1 queryByRequestType fonksiyonu mevcut',
  /async function queryByRequestType\(scope, filters, from, to, baseWhere\)/.test(aggCode), true);
expect('1.2 queryByOrigin fonksiyonu mevcut',
  /async function queryByOrigin\(scope, filters, from, to, baseWhere\)/.test(aggCode), true);
expect('1.3 Promise.all dizisinde byRequestType + byOrigin',
  /Promise\.all\(\[[\s\S]{0,2000}queryByRequestType[\s\S]{0,500}queryByOrigin/.test(aggCode), true);
expect('1.4 Return shape\'inde byRequestType var',
  /return \{[\s\S]{0,3000}byRequestType,/.test(aggCode), true);
expect('1.5 Return shape\'inde byOrigin var',
  /return \{[\s\S]{0,3000}byOrigin,/.test(aggCode), true);

console.log('\n── 2) Scope guard pariteti (mevcut paterni kopyala) ──');
expect('2.1 queryByRequestType — companyIds.length===0 → []',
  /queryByRequestType[\s\S]{0,400}if \(scope\.companyIds\.length === 0\) return \[\]/.test(aggCode), true);
expect('2.2 queryByOrigin — companyIds.length===0 → []',
  /queryByOrigin[\s\S]{0,400}if \(scope\.companyIds\.length === 0\) return \[\]/.test(aggCode), true);
expect('2.3 queryByRequestType — baseWhere.sql kullanır (scope filter)',
  /queryByRequestType[\s\S]{0,700}WHERE \$\{baseWhere\.sql\}/.test(aggCode), true);
expect('2.4 queryByOrigin — baseWhere.sql kullanır',
  /queryByOrigin[\s\S]{0,700}WHERE \$\{baseWhere\.sql\}/.test(aggCode), true);

console.log('\n── 3) SQL injection koruması (parameterized) ──────');
expect('3.1 queryByRequestType — withParam from + to',
  /queryByRequestType[\s\S]{0,700}withParam\(baseWhere, from\)[\s\S]{0,300}withParam\(p1, to\)/.test(aggCode), true);
expect('3.2 queryByOrigin — withParam from + to',
  /queryByOrigin[\s\S]{0,700}withParam\(baseWhere, from\)[\s\S]{0,300}withParam\(p1, to\)/.test(aggCode), true);
expect('3.3 $queryRawUnsafe params yayılımı (...p2.params)',
  (aggCode.match(/queryByRequestType[\s\S]{0,1000}\$queryRawUnsafe\(sql, \.\.\.p2\.params\)/) !== null)
    && (aggCode.match(/queryByOrigin[\s\S]{0,1000}\$queryRawUnsafe\(sql, \.\.\.p2\.params\)/) !== null), true);

console.log('\n── 4) NULL filter (boş kayıt sızıntısı engeli) ──────');
expect('4.1 queryByRequestType — requestType IS NOT NULL',
  /queryByRequestType[\s\S]{0,700}\[requestType\] IS NOT NULL/.test(aggCode), true);
expect('4.2 queryByOrigin — origin IS NOT NULL',
  /queryByOrigin[\s\S]{0,700}\[origin\] IS NOT NULL/.test(aggCode), true);

// ─── formatters.js ────────────────────────────────────────────────
const fmt = read('server/lib/caseReport/formatters.js');
const fmtCode = strip(fmt);

console.log('\n── 5) formatters — REQUEST_TYPE_LABELS + ORIGIN_LABELS ──');
expect('5.1 REQUEST_TYPE_LABELS export\'lu (önceden module-local idi)',
  /^export const REQUEST_TYPE_LABELS/m.test(fmtCode), true);
expect('5.2 ORIGIN_LABELS yeni eklendi (export)',
  /^export const ORIGIN_LABELS/m.test(fmtCode), true);
expect('5.3 ORIGIN_LABELS — Eposta ASCII → "E-posta" TR',
  /Eposta:\s*'E-posta'/.test(fmtCode), true);
expect('5.4 ORIGIN_LABELS — TR varyant da map\'li (defansif)',
  /'E-posta':\s*'E-posta'/.test(fmtCode), true);
expect('5.5 ORIGIN_LABELS — Diger ASCII → "Diğer" TR',
  /Diger:\s*'Diğer'/.test(fmtCode), true);
expect('5.6 ORIGIN_LABELS — TR Diğer varyantı',
  /Diğer:\s*'Diğer'/.test(fmtCode), true);
expect('5.7 ENUM_MAPS registry\'sine caseOrigin eklendi',
  /caseOrigin:\s*ORIGIN_LABELS/.test(fmtCode), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
