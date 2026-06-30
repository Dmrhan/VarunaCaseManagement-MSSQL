/**
 * smoke-pattern-insight-pr1.js — Pattern Alert Triage PR-1 deterministik enrichment.
 *
 * KAPSAM (DB-bağımsız + runtime):
 *   - findDominantValue dominance threshold davranışı (kullanıcı revision)
 *   - findDominantKeyword tokenize + stop-words + dominance
 *   - parseCaseIds JSON/array tolerance
 *   - deriveSeverity 3 kova (critical/warning/info)
 *   - endpoint shape (insight: {...} her item'a eklendi)
 *   - graceful degrade (enrichment fail → insight=null)
 *   - UI severity stilleri + thread chip dominance ratio wording
 *
 * KAPSAM DIŞI (integration smoke):
 *   - Gerçek DB seed + cron run + endpoint roundtrip
 */

import { readFileSync } from 'node:fs';
import {
  _internal,
} from '../server/lib/patternInsight.js';

const { parseCaseIds, findDominantValue, findDominantKeyword, deriveSeverity, STOP_WORDS, DOMINANCE_THRESHOLD } = _internal;

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}\n    actual=${JSON.stringify(actual)}\n    expected=${JSON.stringify(expected)}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

// ─── 1) parseCaseIds tolerance ────────────────────────────────────
console.log('── 1) parseCaseIds tolerance ─────────────────────');
expect('1.1 Array geçerse pass-through',
  parseCaseIds(['c1', 'c2']),
  ['c1', 'c2']);
expect('1.2 JSON string parse',
  parseCaseIds('["c1","c2"]'),
  ['c1', 'c2']);
expect('1.3 Bozuk JSON → []',
  parseCaseIds('not json'),
  []);
expect('1.4 Boş string → []',
  parseCaseIds(''),
  []);
expect('1.5 undefined → []',
  parseCaseIds(undefined),
  []);
expect('1.6 Non-string array eleman filtrelenir',
  parseCaseIds(['c1', null, 123, 'c2']),
  ['c1', 'c2']);

// ─── 2) findDominantValue — Codex revision (≥%60 baskınlık) ──
console.log('\n── 2) findDominantValue dominance (kullanıcı revision) ──');
expect('2.1 7/8 Nestlé (≥60%) → top: Nestlé',
  findDominantValue(['N', 'N', 'N', 'N', 'N', 'N', 'N', 'X']),
  { key: 'N', count: 7, total: 8, dominance: 0.875 });
expect('2.2 6/7 Nestlé (≥60%) → top: Nestlé',
  findDominantValue(['N', 'N', 'N', 'N', 'N', 'N', 'X']),
  { key: 'N', count: 6, total: 7, dominance: 6 / 7 });
expect('2.3 3/7 Nestlé (<60%) → null (dominance yetmiyor)',
  findDominantValue(['N', 'N', 'N', 'X', 'X', 'Y', 'Y']),
  null);
expect('2.4 %100 kesişim → dominance=1',
  findDominantValue(['N', 'N', 'N']),
  { key: 'N', count: 3, total: 3, dominance: 1 });
expect('2.5 Tüm null/undefined → null',
  findDominantValue([null, null, undefined]),
  null);
expect('2.6 Karışık null filtrelenir',
  findDominantValue(['N', null, 'N', 'N', undefined]),
  { key: 'N', count: 3, total: 3, dominance: 1 });
expect('2.7 Threshold override (0.4 → 3/7 Nestlé bile geçer)',
  findDominantValue(['N', 'N', 'N', 'X', 'X', 'Y', 'Y'], 0.4),
  { key: 'N', count: 3, total: 7, dominance: 3 / 7 });

// ─── 3) findDominantKeyword tokenize + stop-words ────────────────
console.log('\n── 3) findDominantKeyword tokenize + stop-words ──');
expect('3.1 "giriş" 5 vakanın 4\'ünde → ≥60% → top: giriş (Türkçe lowercase doğru)',
  findDominantKeyword([
    'Kullanıcı giriş yapamıyor',
    'Giriş ekranı açılmıyor',
    'Giriş sonrası takılıyor',
    'GİRİŞ butonu çalışmıyor',
    'Şifre sıfırlama',
  ]),
  { word: 'giriş', dominance: 0.8, count: 4, total: 5 });
expect('3.2 Stop-words "ile/için/ve" elenir',
  findDominantKeyword(['ile için ve giriş', 've ile için giriş', 'ile için ve giriş'])?.word,
  'giriş');
expect('3.3 Min 3 char (2 char "kg" filtre)',
  findDominantKeyword(['kg ile yapma', 'kg ile yapma', 'kg ile yapma'])?.word,
  'yapma');
expect('3.4 Numeric token elenir',
  findDominantKeyword(['error 500 lütfen', 'error 500 lütfen', 'error 500 lütfen'])?.word,
  'error');
expect('3.5 <60% dominance → null',
  findDominantKeyword([
    'alfa beta',
    'gamma delta',
    'epsilon zeta',
  ]),
  null);
expect('3.6 Boş array → null',
  findDominantKeyword([]),
  null);
expect('3.7 Vaka başına unique (aynı vakada 5 kez "giriş" geçer ama 1 sayılır — 1/3 = %33 < %60)',
  findDominantKeyword(['giriş giriş giriş', 'farklı dosya', 'başka konu'])
    ?? null,
  null);

// ─── 4) STOP_WORDS coverage ──────────────────────────────────────
console.log('\n── 4) STOP_WORDS Türkçe liste ────────────────────');
expect('4.1 "ve" stop-word', STOP_WORDS.has('ve'), true);
expect('4.2 "için" stop-word', STOP_WORDS.has('için'), true);
expect('4.3 "vaka" stop-word (generic ticari)', STOP_WORDS.has('vaka'), true);
expect('4.4 "müşteri" stop-word (PII risk; Codex revision)', STOP_WORDS.has('müşteri'), true);
expect('4.5 DOMINANCE_THRESHOLD default %60', DOMINANCE_THRESHOLD, 0.6);

// ─── 5) deriveSeverity türetimi ─────────────────────────────────
console.log('\n── 5) deriveSeverity 3 kova ──────────────────────');
expect('5.1 spike=5x → critical',
  deriveSeverity({ spike: 5, slaAtRisk: 0 }),
  'critical');
expect('5.2 spike=10x → critical',
  deriveSeverity({ spike: 10, slaAtRisk: 0 }),
  'critical');
expect('5.3 slaAtRisk=3 → critical (spike düşük olsa bile)',
  deriveSeverity({ spike: 1, slaAtRisk: 3 }),
  'critical');
expect('5.4 spike=2x → warning',
  deriveSeverity({ spike: 2, slaAtRisk: 0 }),
  'warning');
expect('5.5 slaAtRisk=1 → warning',
  deriveSeverity({ spike: null, slaAtRisk: 1 }),
  'warning');
expect('5.6 Düşük tüm metrikler → info',
  deriveSeverity({ spike: 1.5, slaAtRisk: 0 }),
  'info');
expect('5.7 spike=null + slaAtRisk=0 → info (yeni kategori)',
  deriveSeverity({ spike: null, slaAtRisk: 0 }),
  'info');

// ─── 6) Endpoint shape (server/routes/analytics.js) ──────────────
const routes = read('server/routes/analytics.js');
const routesCode = strip(routes);

console.log('\n── 6) Endpoint /patterns insight enrichment ──────');
expect('6.1 enrichPatternAlert import',
  /import \{ enrichPatternAlert \} from '\.\.\/lib\/patternInsight\.js'/.test(routesCode), true);
expect('6.2 Her item için Promise.all enrich',
  /items\.map\(async \(alert\) =>[\s\S]{0,400}enrichPatternAlert\(alert/.test(routesCode), true);
expect('6.3 Graceful degrade — insight fail → null',
  /catch \(insightErr\)[\s\S]{0,300}insight: null/.test(routesCode), true);
expect('6.4 allowedCompanyIds scope geçirilir',
  /enrichPatternAlert\(alert, \{ allowedCompanyIds \}\)/.test(routesCode), true);

// ─── 7) UI — PatternsPage redesign ───────────────────────────────
const ui = read('src/features/analytics/PatternsPage.tsx');

console.log('\n── 7) PatternsPage UI redesign ───────────────────');
expect('7.1 PatternInsight type import',
  /import \{[\s\S]{0,500}type PatternInsight/.test(ui), true);
expect('7.2 SEVERITY_STYLES 3 kova (critical/warning/info)',
  /critical:[\s\S]{0,800}warning:[\s\S]{0,800}info:/.test(ui), true);
expect('7.3 SpikeBadge — "Yeni kategori" rozeti (baseline=0)',
  /isNew[\s\S]{0,200}Yeni kategori/.test(ui), true);
expect('7.4 SpikeBadge — N× normal format',
  /\$\{v\}× normal/.test(ui), true);
expect('7.5 ThreadChip — dominance ≥0.99 sade; aksi "Çoğunlukla X (n/t)"',
  /isFull = dominance >= 0\.99[\s\S]{0,400}Çoğunlukla \$\{value\} \(\$\{count\}\/\$\{total\}\)/.test(ui), true);
expect('7.6 3 thread chip (ana firma + ürün + anahtar kelime)',
  /topAnaFirma[\s\S]{0,500}topProduct[\s\S]{0,500}topKeyword/.test(ui), true);
expect('7.7 Impact 3 KPI (etkilenen müşteri + SLA riskinde + açık vaka)',
  /Etkilenen müşteri[\s\S]{0,500}SLA riskinde[\s\S]{0,500}Açık vaka/.test(ui), true);
expect('7.8 Help banner — spike + ortak iplik açıklaması',
  /Spike[\s\S]{0,100}son 7 günlük normal hızına göre[\s\S]{0,200}Ortak iplik/.test(ui), true);
expect('7.9 Missing cases uyarısı (silinmiş/scope dışı)',
  /missingCases > 0[\s\S]{0,300}vaka erişilemedi/.test(ui), true);
expect('7.10 Başlık dynamic — "Olası sorun: <ana firma> · <kategori>"',
  /Olası sorun: \$\{ana\} · \$\{alert\.category\}/.test(ui), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
