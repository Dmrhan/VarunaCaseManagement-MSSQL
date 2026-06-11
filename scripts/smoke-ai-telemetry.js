/**
 * smoke-ai-telemetry.js — WR-F7 / PM-16 AI Usage telemetry verification.
 *
 * Read-only smoke. **No OpenAI calls.** Sadece DB okumaları + schema introspection.
 * Cost: $0.00.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/smoke-ai-telemetry.js
 *
 * 4 bölüm (Planning Card §⑧):
 *  A. AIUsageLog schema/contract — required + nullable + forbidden fields
 *  B. Path coverage — bilinen endpoint identifier'ları için DB'de log row mevcut mu
 *  C. Privacy guard — PII / raw-prompt forbidden column absence
 *  D. Dashboard input sanity — aggregate query deterministic + reasonable
 *
 * F1 (geniş envanter) umbrella'sının ilk küçük adımıdır; yeni AI feature
 * eklendiğinde aiHandler wrapper'ı bypass edilirse buradaki coverage check
 * WARN/FAIL üretir → regression guard.
 */

import { prisma } from '../server/db/client.js';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ─────────────────────────────────────────────────────────────────
// A. AIUsageLog schema/contract
// ─────────────────────────────────────────────────────────────────

console.log('\n── A) AIUsageLog schema/contract ──');

// MSSQL + Turkish collation: katalog adı BÜYÜK harfle yazılmalı (Türkçe
// kuralında i≠I olduğundan 'information_schema' INFORMATION_SCHEMA ile
// eşleşmez) ve dönen kolon adları alias'lanmalı.
const aiCols = await prisma.$queryRawUnsafe(
  `SELECT COLUMN_NAME AS column_name, IS_NULLABLE AS is_nullable, DATA_TYPE AS data_type
   FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_NAME = 'AIUsageLog'
   ORDER BY ORDINAL_POSITION`,
);
const colMap = Object.fromEntries(aiCols.map((c) => [c.column_name, c]));

const REQUIRED_COLS = ['id', 'endpoint', 'companyId', 'createdAt'];
const NULLABLE_COLS = ['caseId', 'userId', 'accepted', 'responseTimeMs', 'tokenCount'];

for (const col of REQUIRED_COLS) {
  record(`A.req.${col} exists`, !!colMap[col], col in colMap ? `nullable=${colMap[col].is_nullable}` : 'MISSING');
}

for (const col of NULLABLE_COLS) {
  if (!colMap[col]) {
    record(`A.opt.${col} exists`, false, 'MISSING');
    continue;
  }
  const nullable = colMap[col].is_nullable === 'YES';
  record(`A.opt.${col} is nullable`, nullable, `is_nullable=${colMap[col].is_nullable}`);
}

// ─────────────────────────────────────────────────────────────────
// B. Path coverage — bilinen endpoint identifier'ları
// ─────────────────────────────────────────────────────────────────

console.log('\n── B) AI endpoint path coverage ──');

/**
 * Bilinen AI endpoint identifier'ları. Kaynaklar:
 *  - server/routes/ai.js — 15 aiHandler('<name>', ...) call
 *  - server/lib/transferAi.js — 2 logAIUsage call (transfer-cause-analysis, transfer-brief)
 *  - server/lib/actionSummaryAi.js — 1 logAIUsage call ('status-report')
 *  - server/cron/qaScoreBatch.js — 1 logAIUsage call (qa-score-batch)
 *
 * Doğrulama: bu listeden FARKLI bir endpoint DB'de görünürse yeni AI path eklenmiş
 * ama envanter güncellenmemiş demektir → smoke WARN (FAIL değil; demo dataset
 * varyasyonlarında zaten 0 satırlı path'ler olabilir).
 */
const EXPECTED_ENDPOINTS = [
  // ai.js routes (15)
  'suggest-category',
  'suggest-title',
  'draft-resolution',
  'supervisor-summary',
  'churn-conversion',
  'dashboard-chat',
  'call-summary',
  'transfer-suggest',
  'customer-pulse-summary',
  'suggest-links',
  'operations-brief',
  'operations-insights',
  'operations-explain-metric',
  'operations-drilldown-assist',
  'operations-report-draft',
  // lib + cron (4)
  'transfer-cause-analysis',
  'transfer-brief',
  'status-report', // actionSummaryAi.js — vakanın aksiyon zaman çizelgesi özeti
  'qa-score-batch',
];

const seen = await prisma.aIUsageLog.groupBy({
  by: ['endpoint'],
  _count: { _all: true },
});
const seenMap = Object.fromEntries(seen.map((r) => [r.endpoint, r._count._all]));

record('B.totalEndpointsSeen >= 0 (DB readable)', Array.isArray(seen));

// Coverage check — 0 satır endpoint'ler "henüz çağrılmamış" demek; FAIL değil INFO.
// Critical-set: en az bunlar mutlaka log üretmiş olmalı (sık kullanılan veya
// recent fix kapsamında); kalan endpoint'ler "info — kullanılınca log üretir".
const CRITICAL_ENDPOINTS = [
  'qa-score-batch',          // cron fix #142 — must have rows
  'suggest-category',        // commonly used in new case flow
  'draft-resolution',        // recently added (drawer AI suggestion)
  'customer-pulse-summary',  // case detail panel
];
let criticalMissing = [];
let coveredCount = 0;
for (const ep of EXPECTED_ENDPOINTS) {
  const n = seenMap[ep] ?? 0;
  if (n > 0) coveredCount++;
  if (CRITICAL_ENDPOINTS.includes(ep)) {
    record(`B.critical("${ep}") has rows`, n > 0, `count=${n}`);
    if (n === 0) criticalMissing.push(ep);
  } else {
    // Info-level: 0 rows OK (endpoint hiç çağrılmamış olabilir)
    record(`B.endpoint("${ep}") rows (info)`, true, `count=${n}`);
  }
}
record('B.coverage summary (info)', true,
  `${coveredCount}/${EXPECTED_ENDPOINTS.length} endpoint daha önce log yazmış; critical missing: ${criticalMissing.length === 0 ? 'none' : criticalMissing.join(', ')}`);

// Bilinmeyen endpoint var mı? (yeni AI eklenmiş ama envanter güncellenmemiş)
const unknownEndpoints = seen
  .map((r) => r.endpoint)
  .filter((ep) => !EXPECTED_ENDPOINTS.includes(ep));
record('B.no unexpected endpoint identifiers (envanter taze mi?)',
  unknownEndpoints.length === 0,
  unknownEndpoints.length === 0
    ? 'all seen endpoints are in EXPECTED_ENDPOINTS — envanter senkron'
    : `WARN: yeni AI path tespit edildi — envantere ekle: ${unknownEndpoints.join(', ')}`);

// ─────────────────────────────────────────────────────────────────
// C. Privacy guard — forbidden columns absent
// ─────────────────────────────────────────────────────────────────

console.log('\n── C) Privacy guard — no PII / raw-prompt columns ──');

const FORBIDDEN_COLS = [
  // PII (requester context — never in AI telemetry)
  'customerContactName',
  'customerContactPhone',
  'customerContactEmail',
  'customerCompanyName',
  // Raw prompt content (would balloon storage + leak PII)
  'prompt',
  'system',
  'user',
  'text',
  'content',
  'rawPrompt',
  'response',
  'message',
];

const foundForbidden = FORBIDDEN_COLS.filter((c) => c in colMap);
record(
  'C.AIUsageLog has no PII / raw-prompt columns',
  foundForbidden.length === 0,
  foundForbidden.length === 0
    ? 'safe: only id/companyId/endpoint/caseId/userId/accepted/responseTimeMs/tokenCount/createdAt'
    : `LEAK: ${foundForbidden.join(', ')}`,
);

// ─────────────────────────────────────────────────────────────────
// D. Dashboard input sanity
// ─────────────────────────────────────────────────────────────────

console.log('\n── D) Dashboard aggregate query sanity ──');

const total = await prisma.aIUsageLog.count();
record('D.total AIUsageLog count is numeric', Number.isInteger(total), `total=${total}`);

const responseTimeAgg = await prisma.aIUsageLog.aggregate({
  _avg: { responseTimeMs: true },
  _min: { responseTimeMs: true },
  _max: { responseTimeMs: true },
  where: { responseTimeMs: { not: null } },
});
record('D.responseTimeMs aggregate non-null subset is computable',
  true,
  `n>0 ⇒ avg=${responseTimeAgg._avg.responseTimeMs ?? 'null'}, min=${responseTimeAgg._min.responseTimeMs ?? 'null'}, max=${responseTimeAgg._max.responseTimeMs ?? 'null'}`);

if (responseTimeAgg._min.responseTimeMs != null) {
  record('D.responseTimeMs min >= 0', responseTimeAgg._min.responseTimeMs >= 0,
    `min=${responseTimeAgg._min.responseTimeMs}`);
}

const endpointGroup = await prisma.aIUsageLog.groupBy({
  by: ['endpoint', 'companyId'],
  _count: { _all: true },
  _avg: { responseTimeMs: true },
  orderBy: { endpoint: 'asc' },
  take: 50,
});
record('D.GROUP BY endpoint, companyId works',
  Array.isArray(endpointGroup),
  `groups=${endpointGroup.length}`);

// acceptedRate: count(accepted=true) / count(accepted!=null)
const acceptedTrue = await prisma.aIUsageLog.count({ where: { accepted: true } });
const acceptedDecided = await prisma.aIUsageLog.count({ where: { accepted: { not: null } } });
const acceptanceRate = acceptedDecided > 0 ? acceptedTrue / acceptedDecided : null;
record('D.acceptanceRate computable (null OK if no accept/reject yet)',
  acceptanceRate === null || (acceptanceRate >= 0 && acceptanceRate <= 1),
  `acceptanceRate=${acceptanceRate} (true=${acceptedTrue}, decided=${acceptedDecided})`);

// Cron userId nullable behavior (qa-score-batch should have null userId rows)
const cronNullUser = await prisma.aIUsageLog.count({
  where: { endpoint: 'qa-score-batch', userId: null },
});
const cronTotal = await prisma.aIUsageLog.count({ where: { endpoint: 'qa-score-batch' } });
record('D.cron path (qa-score-batch) writes nullable userId',
  cronTotal === 0 ? true : cronNullUser > 0,
  cronTotal === 0
    ? 'no qa-score-batch rows yet — schema allows null'
    : `cronTotal=${cronTotal} cronNullUser=${cronNullUser}`);

// ─────────────────────────────────────────────────────────────────
// Done
// ─────────────────────────────────────────────────────────────────

await prisma.$disconnect();

const failed = results.filter((r) => !r.ok);
console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('[smoke] FAILED:');
  failed.forEach((f) => console.log(`  - ${f.name} ${f.detail ?? ''}`));
  process.exitCode = 1;
} else {
  console.log('[smoke] ALL GREEN');
}
