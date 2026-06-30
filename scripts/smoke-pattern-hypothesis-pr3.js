/**
 * smoke-pattern-hypothesis-pr3.js — Pattern Triage AI hypothesis (PR-3).
 *
 * KAPSAM:
 *   - Schema: aiHypothesis + aiHypothesisAt nullable
 *   - Migration apply gerçek (gerçekleştirildi — DB applied)
 *   - patternHypothesisAi.js — yapısal girdi (ham başlık YOK)
 *   - 🔒 PII KAYNAKTAN KES — exampleTitles, customerContact*, etc. PROMPT'A
 *     GIRMEZ (kullanıcı revision P0 fix)
 *   - Cache 24h TTL + force flag
 *   - Endpoint /patterns/:id/hypothesis (Supervisor+ guard + scope check)
 *   - Frontend service.getPatternHypothesis
 *   - UI AiHypothesisBox (lazy load + privacy etiketi + graceful degrade)
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

// ─── 1) Schema migration ──────────────────────────────────────────
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260630_pattern_ai_hypothesis/migration.sql');

console.log('── 1) Schema + migration ─────────────────────────');
expect('1.1 PatternAlert.aiHypothesis nullable',
  /aiHypothesis\s+String\?\s+@db\.NVarChar\(Max\)/.test(schema), true);
expect('1.2 PatternAlert.aiHypothesisAt nullable',
  /aiHypothesisAt\s+DateTime\?/.test(schema), true);
expect('1.3 Migration ALTER TABLE + 2 kolon',
  /ALTER TABLE \[dbo\]\.\[PatternAlert\][\s\S]{0,300}ADD \[aiHypothesis\] NVARCHAR\(Max\) NULL,[\s\S]{0,100}\[aiHypothesisAt\] DATETIME2 NULL/.test(migration), true);
expect('1.4 Migration TRY/CATCH transaction guard',
  /BEGIN TRY[\s\S]*BEGIN TRAN[\s\S]*COMMIT TRAN[\s\S]*END TRY[\s\S]*BEGIN CATCH/.test(migration), true);

// ─── 2) patternHypothesisAi.js helper ─────────────────────────────
const ai = read('server/lib/patternHypothesisAi.js');
const aiCode = strip(ai);

console.log('\n── 2) patternHypothesisAi helper ─────────────────');
expect('2.1 generatePatternHypothesis export\'lu',
  /^export async function generatePatternHypothesis/m.test(aiCode), true);
expect('2.2 HYPOTHESIS_SCHEMA strict json_schema',
  /HYPOTHESIS_SCHEMA[\s\S]{0,200}type: 'object'[\s\S]{0,400}required: \['hypothesis', 'suggestedAction'\]/.test(aiCode), true);
expect('2.3 callOpenAI schema kullanımı',
  /callOpenAI\(\{[\s\S]{0,400}schema: HYPOTHESIS_SCHEMA,[\s\S]{0,200}schemaName: 'pattern_hypothesis'/.test(aiCode), true);
expect('2.4 SYSTEM_PROMPT Türkçe + "karar değil" vurgusu',
  /KARAR VERME/.test(ai), true);
expect('2.5 logAIUsage endpoint=pattern_hypothesis',
  /logAIUsage\(\{[\s\S]{0,300}endpoint: 'pattern_hypothesis'/.test(aiCode), true);
expect('2.6 logAIUsage fail durumunda da yazılır (debug için)',
  /catch \(err\)[\s\S]{0,500}logAIUsage/.test(aiCode), true);

// ─── 3) 🔒 PII GUARD — kullanıcı revision P0 ─────────────────────
console.log('\n── 3) PII guard — kaynaktan kes (kullanıcı revision) ──');
expect('3.1 AI girdi yapısal (kategori/topAnaFirma/topUrun/...)',
  /structuredInput[\s\S]{0,3000}kategori:[\s\S]{0,500}topAnaFirma:[\s\S]{0,800}topUrun:[\s\S]{0,800}topAnahtarKelime:/.test(aiCode), true);
expect('3.2 ❌ exampleTitles PROMPT\'A GİRMEZ',
  !/exampleTitles/.test(aiCode), true);
expect('3.3 ❌ caseDescriptions PROMPT\'A GİRMEZ',
  !/caseDescriptions/.test(aiCode), true);
expect('3.4 ❌ customerContact* PROMPT\'A GİRMEZ',
  !/customerContact/.test(aiCode), true);
expect('3.5 ❌ customerCompanyName PROMPT\'A GİRMEZ',
  !/customerCompanyName/.test(aiCode), true);
expect('3.6 ❌ assignedPerson* veya agent ismi PROMPT\'A GİRMEZ',
  !/assignedPerson/.test(aiCode) && !/agentName/.test(aiCode), true);
expect('3.7 ❌ Case.title doğrudan PROMPT\'A GİRMEZ (sadece tokenize sonrası tek kelime)',
  !/case\.title/.test(aiCode) && !/c\.title/.test(aiCode), true);
expect('3.8 ✅ topKeyword YALNIZ kelime (tek string)',
  /topAnahtarKelime[\s\S]{0,300}kelime:/.test(aiCode), true);

// ─── 4) Endpoint /hypothesis ─────────────────────────────────────
const routes = read('server/routes/analytics.js');
const routesCode = strip(routes);

console.log('\n── 4) Endpoint /patterns/:id/hypothesis ──────────');
expect('4.1 generatePatternHypothesis import',
  /import \{ generatePatternHypothesis \} from '\.\.\/lib\/patternHypothesisAi\.js'/.test(routesCode), true);
expect('4.2 POST /patterns/:id/hypothesis mount',
  /router\.post\(\s*'\/patterns\/:id\/hypothesis', requireSupervisorAnalytics/.test(routesCode), true);
expect('4.3 Cross-tenant guard (alert.companyId ∈ allowedCompanyIds)',
  /\/hypothesis'[\s\S]{0,500}allowedCompanyIds\.includes\(alert\.companyId\)/.test(routesCode), true);

console.log('\n── 5) Cache + TTL + force ────────────────────────');
expect('5.1 TTL_MS = 24 * 60 * 60 * 1000',
  /TTL_MS = 24 \* 60 \* 60 \* 1000/.test(routesCode), true);
expect('5.2 Cache hit kontrolü (aiHypothesis dolu + 24h içinde)',
  /\/hypothesis'[\s\S]{0,2000}alert\.aiHypothesis[\s\S]{0,200}alert\.aiHypothesisAt[\s\S]{0,400}TTL_MS/.test(routesCode), true);
expect('5.3 force=true cache bypass',
  /\/hypothesis'[\s\S]{0,1500}force = req\.body\?\.force === true/.test(routesCode), true);
expect('5.4 Cache yaz — update aiHypothesis + aiHypothesisAt',
  /patternAlert\.update\(\{[\s\S]{0,400}aiHypothesis: JSON\.stringify\(hypothesis\)[\s\S]{0,200}aiHypothesisAt: new Date\(\)/.test(routesCode), true);
expect('5.5 Cached response — cached: true',
  /cached: true,[\s\S]{0,300}hypothesis: cached\.hypothesis/.test(routesCode), true);

console.log('\n── 6) Graceful degrade — AI fail → null ──────────');
expect('6.1 hypothesis null → 200 + ai_unavailable error code',
  /\/hypothesis'[\s\S]{0,2500}!hypothesis\)[\s\S]{0,300}hypothesis: null,[\s\S]{0,200}error: 'ai_unavailable'/.test(routesCode), true);
expect('6.2 patternHypothesisAi catch → null return',
  /catch \(err\)[\s\S]{0,500}return null/.test(aiCode), true);

// ─── 7) Frontend service + UI ────────────────────────────────────
const svc = read('src/services/analyticsService.ts');
const ui = read('src/features/analytics/PatternsPage.tsx');

console.log('\n── 7) Frontend service + UI ──────────────────────');
expect('7.1 getPatternHypothesis method',
  /async getPatternHypothesis\(\s*id: string,\s*options:[\s\S]{0,300}force\?: boolean/.test(svc), true);
expect('7.2 AiHypothesisBox component mevcut',
  /function AiHypothesisBox\(\{ alertId \}/.test(ui), true);
expect('7.3 Lazy load — "AI hipotezi göster" butonu',
  /AI hipotezi göster/.test(ui), true);
expect('7.4 Privacy etiketi — "AI hipotezi — karar değil, sinyal"',
  /AI hipotezi — karar değil, sinyal/.test(ui), true);
expect('7.5 Graceful degrade — "AI yanıt veremedi" + Tekrar dene',
  /AI yanıt veremedi[\s\S]{0,800}Tekrar dene/.test(ui), true);
expect('7.6 Force refresh — Yenile buton (cache bypass)',
  /load\(true\)[\s\S]{0,400}Yenile/.test(ui), true);
expect('7.7 AiHypothesisBox kart içinde mount edilmiş',
  /<AiHypothesisBox alertId=\{alert\.id\}/.test(ui), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
