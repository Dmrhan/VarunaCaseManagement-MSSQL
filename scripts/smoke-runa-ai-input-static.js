/**
 * smoke-runa-ai-input-static.js
 *
 * RUNA AI Faz 1 — supervisor-summary input enrichment static invariant'ları
 * (DB-bağımsız, kaynak-seviye regex assertion).
 *
 * Korunan invariant'lar:
 *  1) supervisor-summary prompt builder modülü mevcut (server/lib/supervisorSummaryPrompt.js)
 *  2) PII guard — yasak alanların İSMİ prompt builder + fetch select listelerinde HİÇ geçmiyor
 *  3) Curate cap'leri: solution step 10, çağrı 3, not 3, truncate'ler beklendiği gibi
 *  4) Yapısal başlıklar mevcut (## Vaka / Sınıflandırma / Denenen Çözümler /
 *     Müşteri Durumu / Devir Geçmişi / Ürün/Paket / Çağrılar / Çözüm/İptal)
 *  5) Boş alan/bölüm yazılmama disiplini (filter pattern'leri kodda mevcut)
 *  6) AI_MAX_TOKENS 1500'e yükseltildi (1000 sabit metni kalmadı)
 *  7) Çıktı şeması DEĞİŞMEDİ — kategori/öncelik üretimi yok (sert kural)
 *  8) handleAnalyze yeni payload (caseId-only) gönderiyor — eski 14-alan
 *     case + history + notes + callLogs spread'i kalmadı
 *
 * Çalıştır:
 *   node scripts/smoke-runa-ai-input-static.js
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function expect(name, actual, expected, detail = '') {
  if (actual === expected) ok(name, detail);
  else bad(name, `actual=${actual} expected=${expected}${detail ? ' · ' + detail : ''}`);
}

function read(rel) {
  const full = path.join(REPO_ROOT, rel);
  if (!existsSync(full)) {
    bad(`file_exists ${rel}`);
    return '';
  }
  return readFileSync(full, 'utf8');
}

// Comment'leri striple — açıklamalarda yasak isim geçebilir (örn. "accountName
// GÖNDERMEZ" gibi guard yorumu) ama code path'inde HİÇ olmaması yeterli.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

console.log('── 1) Modül + import kontrolleri ────────────────────────');
const promptModulePath = 'server/lib/supervisorSummaryPrompt.js';
const promptModule = read(promptModulePath);
expect('1.1 supervisorSummaryPrompt.js mevcut', promptModule.length > 0, true);
expect('1.2 fetchSupervisorEnrichment export',
  /export async function fetchSupervisorEnrichment/.test(promptModule), true);
expect('1.3 buildSupervisorSummaryPrompt export',
  /export function buildSupervisorSummaryPrompt/.test(promptModule), true);

const aiRoutes = read('server/routes/ai.js');
expect('1.4 ai.js import fetchSupervisorEnrichment + buildSupervisorSummaryPrompt',
  /import \{[^}]*fetchSupervisorEnrichment[^}]*buildSupervisorSummaryPrompt[^}]*\}/.test(aiRoutes), true);
expect('1.5 supervisor-summary handler yeni branch — caseId tabanlı',
  /\/supervisor-summary[\s\S]{0,800}const \{ caseId, case: legacyCase \}/.test(aiRoutes), true);

console.log('\n── 2) PII guard — yasak alanlar code path\'inde YOK ─────');
// Bu alanlar prompt builder VE fetch'in Prisma select'lerinde HİÇ geçmemeli.
// Comment'leri striple — guard yorumlarında geçmesi normal.
const promptCode = stripComments(promptModule);

const FORBIDDEN_FIELDS = [
  'accountName',
  'assignedPersonName',
  'assignedTeamName',
  'customerContactName',
  'customerContactPhone',
  'customerContactEmail',
  'customerCompanyName',
  'tcknHash',
  'tcknLast4',
  // AccountContact relation tamamen yok
  'accountContacts',
];
for (const field of FORBIDDEN_FIELDS) {
  // Tek kelime sınırlı kontrol (kelime ortasında geçen başka identifier'a
  // false positive olmasın diye \b kullanılır).
  const re = new RegExp(`\\b${field}\\b`);
  expect(`2.x PII guard — "${field}" prompt builder code'unda YOK`,
    re.test(promptCode), false);
}

// Account select'inde sadece izinli 1 alan (customerType).
// Diğerleri farklı modellerde: segment → AccountCompany, financialStatus +
// supportLevel → Case (Account.segment/financialStatus/supportLevel YOK —
// runtime hata sebebi, schema'ya hizalandı).
expect('2.10 Account select sadece customerType (izinli)',
  /prisma\.account\.findUnique\([\s\S]{0,400}select:\s*\{\s*customerType:\s*true,?\s*\}/.test(promptCode), true);
expect('2.10b AccountCompany.findFirst segment (tenant scope)',
  /prisma\.accountCompany\.findFirst\([\s\S]{0,400}select:\s*\{\s*segment:\s*true\s*\}/.test(promptCode), true);
expect('2.10c AccountCompany where accountId + companyId (tenant scope guard)',
  /accountId:\s*c\.accountId,\s*companyId:\s*c\.companyId/.test(promptCode), true);

// Account email/phone select'lerde geçmiyor (yasak)
expect('2.11 Account select\'inde "email: true" yok',
  /select:[\s\S]{0,500}email:\s*true/.test(promptCode), false);
expect('2.12 Account select\'inde "phone:" yok',
  /select:[\s\S]{0,500}\bphone\b\s*:\s*true/.test(promptCode), false);

// Case select'inde de PII yok (customerContact* yasak)
expect('2.13 Case select\'inde customerContact* yok',
  /customerContact(Name|Phone|Email)/.test(promptCode), false);
expect('2.14 Case select\'inde customerCompanyName yok',
  /customerCompanyName/.test(promptCode), false);

console.log('\n── 3) Curate cap\'leri ──────────────────────────────────');
expect('3.1 SOLUTION_STEP_CAP = 10',
  /const SOLUTION_STEP_CAP = 10/.test(promptCode), true);
expect('3.2 CALL_CAP = 3',
  /const CALL_CAP = 3/.test(promptCode), true);
expect('3.3 NOTE_CAP = 3',
  /const NOTE_CAP = 3/.test(promptCode), true);
expect('3.4 TRANSFER_REASON_CAP = 3',
  /const TRANSFER_REASON_CAP = 3/.test(promptCode), true);
expect('3.5 TRUNCATE.solutionStepNote = 100',
  /solutionStepNote:\s*100/.test(promptCode), true);
expect('3.6 TRUNCATE.callBrief = 80',
  /callBrief:\s*80/.test(promptCode), true);
expect('3.7 TRUNCATE.note = 300',
  /note:\s*300/.test(promptCode), true);
expect('3.8 TRUNCATE.description = 1000',
  /description:\s*1000/.test(promptCode), true);
expect('3.9 TRUNCATE.resolutionNote = 300',
  /resolutionNote:\s*300/.test(promptCode), true);

// Solution step status filter — sadece "tried" / "worked" / "not_worked" / "skipped"
// (suggested hariç) — { not: 'suggested' } pattern
expect('3.10 solution step status !== "suggested" filter',
  /status:\s*\{\s*not:\s*'suggested'\s*\}/.test(promptCode), true);

console.log('\n── 4) Yapısal başlıklar mevcut ─────────────────────────');
const SECTIONS = [
  '## Vaka',
  '## Sınıflandırma',
  '## Denenen Çözümler',
  '## Müşteri Durumu',
  '## Devir Geçmişi',
  '## Ürün/Paket',
  '## Çağrılar',
  '## Çözüm/İptal',
];
for (const s of SECTIONS) {
  expect(`4.x section başlığı: "${s}"`, promptCode.includes(`'${s}'`), true);
}

console.log('\n── 5) Boş alan/bölüm yazılmama disiplini ───────────────');
// Pattern: tüm sections array'i .filter(Boolean) ile birleşim VE her bölümün
// içeriği lines.length kontrolüne tabi — kodda "if (X.length)" pattern'i çokça
// olmalı (her bölüm için 1 tane). En az 6 tane bulalım (8 bölümün 6+ kontrolü
// — bazıları compound olabilir).
const ifLengthChecks = (promptCode.match(/if \(\w+\.length\)/g) ?? []).length;
expect('5.1 if (X.length) kontrolü çok sayıda (>= 6)', ifLengthChecks >= 6, true,
  `bulunan=${ifLengthChecks}`);
// "sections.push(...)" pattern — her bölüm conditional olarak push edilir
const sectionsPushes = (promptCode.match(/sections\.push\(\[/g) ?? []).length;
expect('5.2 sections.push([...]) en az 8 yerde (her bölüm conditional)',
  sectionsPushes >= 8, true, `bulunan=${sectionsPushes}`);

console.log('\n── 6) AI_MAX_TOKENS 1500 ──────────────────────────────');
const aiClientSrc = read('server/lib/aiClient.js');
expect('6.1 AI_MAX_TOKENS = 1500',
  /export const AI_MAX_TOKENS = 1500/.test(aiClientSrc), true);
expect('6.2 eski 1000 sabit metni AI_MAX_TOKENS satırında yok',
  /export const AI_MAX_TOKENS = 1000/.test(aiClientSrc), false);

console.log('\n── 7) Çıktı şeması DEĞİŞMEDİ (sert kural) ──────────────');
// Yeni prompt'un user bloğunda kategori/öncelik üretim talebi YOK.
expect('7.1 prompt\'ta kategori üretimi yok ("categorySuggestion"/"categoryPrediction" yok)',
  /categorySuggestion|categoryPrediction/.test(promptCode), false);
expect('7.2 prompt\'ta öncelik üretimi yok',
  /prioritySuggestion|priorityPrediction/.test(promptCode), false);
// Çıktı şeması 11.2'de strict json_schema üzerinden guard'lanıyor;
// eski 4-alan JSON format bloğu (text-blob) Faz 2'de kaldırıldı.
// Buradaki invariant SUPERVISOR_SUMMARY_SCHEMA üzerinden geçer.
expect('7.3 schema 5 required (Faz 2 strict mode — kategori/öncelik YOK)',
  /required:\s*\[\s*'summary',\s*'riskLevel',\s*'keyPoints',\s*'recommendation',\s*'confidence'\s*\]/.test(promptCode), true);

console.log('\n── 8) Frontend handleAnalyze caseId-only payload ───────');
const caseDetail = read('src/features/cases/CaseDetailPage.tsx');
expect('8.1 handleAnalyze caseId-only payload',
  /aiService\.supervisorSummary\(\{ caseId: item\.id \}\)/.test(caseDetail), true);
expect('8.2 eski 14-alan case spread\'i kaldı YOK',
  /aiService\.supervisorSummary\(\{\s*case: \{\s*title:[\s\S]{0,400}slaResponseDueAt/.test(caseDetail), false);

const aiService = read('src/services/aiService.ts');
expect('8.3 SupervisorSummaryInput.caseId zorunlu',
  /interface SupervisorSummaryInput \{\s*caseId:\s*string/.test(aiService), true);

console.log('\n── 9) Sert kurallar — KB/intake DOKUNULMAZ ─────────────');
// suggest-category endpoint AYNEN var (kategori intake değişmedi).
expect('9.1 ai.js suggest-category endpoint\'i mevcut (intake KORUNDU)',
  /router\.post\(\s*'\/suggest-category'/.test(aiRoutes), true);
// suggest-title endpoint AYNEN var
expect('9.2 ai.js suggest-title endpoint\'i mevcut',
  /router\.post\(\s*'\/suggest-title'/.test(aiRoutes), true);
// Model gpt-4o-mini sabit
expect('9.3 AI_MODEL gpt-4o-mini SABİT',
  /export const AI_MODEL = 'gpt-4o-mini'/.test(aiClientSrc), true);

console.log('\n── 10) Faz 3 — Case.aiRiskLevel + aiKeyPoints alanları ─');
const schema = read('prisma/schema.prisma');
expect('10.1 Prisma Case.aiRiskLevel NVarChar(50) nullable',
  /aiRiskLevel\s+String\?\s+@db\.NVarChar\(50\)/.test(schema), true);
expect('10.2 Prisma Case.aiKeyPoints NVarChar(Max) nullable',
  /aiKeyPoints\s+String\?\s+@db\.NVarChar\(Max\)/.test(schema), true);

const migration = read('prisma/migrations/00000000000006_case_ai_risk_keypoints/migration.sql');
expect('10.3 Migration aiRiskLevel ADD NVARCHAR(50) NULL',
  /ALTER TABLE \[dbo\]\.\[Case\][\s\S]{0,150}ADD \[aiRiskLevel\] NVARCHAR\(50\) NULL/.test(migration), true);
expect('10.4 Migration aiKeyPoints ADD NVARCHAR(MAX) NULL',
  /ALTER TABLE \[dbo\]\.\[Case\][\s\S]{0,150}ADD \[aiKeyPoints\] NVARCHAR\(MAX\) NULL/.test(migration), true);
expect('10.5 Migration BEGIN TRY / TRAN wrapper (rollback safety)',
  /BEGIN TRY[\s\S]{0,800}BEGIN TRAN[\s\S]+COMMIT TRAN[\s\S]+ROLLBACK TRAN/.test(migration), true);

const types = read('src/features/cases/types.ts');
expect('10.6 Case interface aiRiskLevel optional union literal',
  /aiRiskLevel\?: 'Düşük' \| 'Orta' \| 'Yüksek' \| 'Kritik'/.test(types), true);
expect('10.7 Case interface aiKeyPoints optional string (JSON)',
  /aiKeyPoints\?: string;/.test(types), true);
expect('10.8 CASE_FIELD_LABELS aiRiskLevel + aiKeyPoints',
  /aiRiskLevel:\s+'AI Risk Seviyesi'[\s\S]{0,200}aiKeyPoints:\s+'AI Anahtar Noktalar'/.test(types), true);

const card = read('src/components/ui/RunaAiCard.tsx');
expect('10.9 RunaAiCard riskLevel prop type',
  /riskLevel\?:\s*RiskLevel\s*\|\s*null/.test(card), true);
expect('10.10 RunaAiCard keyPoints prop type',
  /keyPoints\?:\s*string\[\]\s*\|\s*null/.test(card), true);
expect('10.11 RunaAiCard RISK_STYLE 4 seviye (Düşük/Orta/Yüksek/Kritik)',
  /'Düşük':\s*\{[\s\S]{0,80}'Orta':\s*\{[\s\S]{0,80}'Yüksek':\s*\{[\s\S]{0,80}'Kritik':\s*\{/.test(card), true);
expect('10.12 RunaAiCard riskLevel conditional render (safeRisk)',
  /\{safeRisk && \(/.test(card), true);
expect('10.13 RunaAiCard keyPoints conditional ul/li render',
  /safeKeyPoints\.length > 0 && \(\s*<ul/.test(card), true);

const detailRaw = read('src/features/cases/CaseDetailPage.tsx');
const detailCode = stripComments(detailRaw);
expect('10.14 parseAiKeyPoints helper mevcut',
  /function parseAiKeyPoints\(raw:\s*string\s*\|\s*undefined\s*\|\s*null\)/.test(detailCode), true);
expect('10.15 RunaAiCard çağrısı riskLevel + keyPoints geçer',
  /<RunaAiCard[\s\S]{0,800}riskLevel=\{item\.aiRiskLevel \?\? null\}[\s\S]{0,200}keyPoints=\{parseAiKeyPoints\(item\.aiKeyPoints\)\}/.test(detailCode), true);
expect('10.16 parseAiKeyPoints JSON.parse + Array.isArray guard',
  /JSON\.parse\(raw\)[\s\S]{0,200}Array\.isArray/.test(detailCode), true);

console.log('\n── 11) Faz 2 — strict json_schema + persist ─────────────');
// 11.1 — SUPERVISOR_SUMMARY_SCHEMA export
expect('11.1 SUPERVISOR_SUMMARY_SCHEMA export',
  /export const SUPERVISOR_SUMMARY_SCHEMA = \{/.test(promptModule), true);
// 11.2 — Schema 5 alan required (sert kural: kategori/öncelik YOK)
expect('11.2 schema required 5 alan (summary/riskLevel/keyPoints/recommendation/confidence)',
  /required:\s*\[\s*'summary',\s*'riskLevel',\s*'keyPoints',\s*'recommendation',\s*'confidence'\s*\]/.test(promptModule), true);
// 11.3 — Schema enum riskLevel 4 seviye TR
expect('11.3 schema riskLevel enum ["Düşük","Orta","Yüksek","Kritik"]',
  /enum:\s*\['Düşük',\s*'Orta',\s*'Yüksek',\s*'Kritik'\]/.test(promptModule), true);
// 11.4 — confidence number type
expect('11.4 schema confidence number type',
  /confidence:\s*\{\s*type:\s*'number'\s*\}/.test(promptModule), true);
// 11.5 — Schema'da kategori/öncelik alanı YOK (sert kural)
expect('11.5 schema\'da categorySuggestion/Prediction YOK',
  /categorySuggestion|categoryPrediction/.test(promptModule), false);
expect('11.6 schema\'da prioritySuggestion/Prediction YOK',
  /prioritySuggestion|priorityPrediction/.test(promptModule), false);

// 11.7 — Route handler schema mode kullanıyor (expectJson değil)
expect('11.7 ai.js supervisor-summary callOpenAI({ schema: SUPERVISOR_SUMMARY_SCHEMA })',
  /callOpenAI\(\{\s*system,\s*user,\s*schema:\s*SUPERVISOR_SUMMARY_SCHEMA/.test(aiRoutes), true);
// 11.8 — supervisor_summary schemaName
expect('11.8 schemaName: "supervisor_summary"',
  /schemaName:\s*'supervisor_summary'/.test(aiRoutes), true);

// 11.9 — Prompt builder system'da kategori/öncelik üretim YASAĞI metni
expect('11.9 system prompt "KATEGORİ veya ÖNCELİK ÜRETME" talimatı',
  /KATEGORİ veya ÖNCELİK ÜRETME/.test(promptCode), true);

// 11.10 — aiService.ts SupervisorSummary.confidence
expect('11.10 SupervisorSummary.confidence optional number',
  /interface SupervisorSummary \{[\s\S]{0,500}confidence\?:\s*number/.test(aiService), true);

// 11.11 — handleAnalyze persist 5 alan (eski 2 + yeni 3)
expect('11.11 handleAnalyze persist aiSummary + aiFollowupRecommendation',
  /caseService\.update\(item\.id,\s*\{[\s\S]{0,500}aiSummary:\s*r\.data\.summary,[\s\S]{0,200}aiFollowupRecommendation:\s*r\.data\.recommendation,/.test(detailCode), true);
expect('11.12 handleAnalyze persist aiRiskLevel + aiKeyPoints',
  /aiRiskLevel:\s*r\.data\.riskLevel,[\s\S]{0,200}aiKeyPoints:\s*JSON\.stringify\(r\.data\.keyPoints/.test(detailCode), true);
expect('11.13 handleAnalyze conditional aiConfidenceScore (typeof number guard)',
  /typeof r\.data\.confidence === 'number'[\s\S]{0,200}aiConfidenceScore:\s*r\.data\.confidence/.test(detailCode), true);

console.log('\n── 12) Faz 4 — status-report input enrichment ──────────');
const asSrc = read('server/lib/actionSummaryAi.js');
const asCode = stripComments(asSrc);

// 12.1 — FAZ4_SOLUTION_STEP_CAP = 5 (supervisor 10'dan daha tutucu)
expect('12.1 FAZ4_SOLUTION_STEP_CAP = 5 (status-report daha tutucu)',
  /const FAZ4_SOLUTION_STEP_CAP = 5/.test(asCode), true);
// 12.2 — TRUNCATE cap'leri
expect('12.2 FAZ4_TRUNCATE.solutionStepNote = 100',
  /solutionStepNote:\s*100/.test(asCode), true);
expect('12.3 FAZ4_TRUNCATE.resolutionNote = 300',
  /resolutionNote:\s*300/.test(asCode), true);
expect('12.4 FAZ4_TRUNCATE.cancellationReason = 300',
  /cancellationReason:\s*300/.test(asCode), true);

// 12.5 — extractSmartTicket helper
expect('12.5 extractSmartTicket helper mevcut',
  /function extractSmartTicket\(customFieldsRaw\)/.test(asCode), true);
expect('12.6 pickStLabel helper mevcut',
  /function pickStLabel\(obj, codeKey, labelKey\)/.test(asCode), true);

// 12.7 — Case select Faz 4 alanları
expect('12.7 Case select customFields + productName + packageName + accountProjectName + resolutionNote + cancellationReason',
  /customFields:\s*true[\s\S]{0,500}productName:\s*true[\s\S]{0,500}packageName:\s*true[\s\S]{0,500}accountProjectName:\s*true[\s\S]{0,500}resolutionNote:\s*true[\s\S]{0,500}cancellationReason:\s*true/.test(asCode), true);

// 12.8 — 3 yeni paralel fetch
expect('12.8 caseSolutionStep findMany cap 5 + status !== suggested',
  /prisma\.caseSolutionStep\.findMany\([\s\S]{0,500}status:\s*\{\s*not:\s*'suggested'\s*\}[\s\S]{0,200}take:\s*FAZ4_SOLUTION_STEP_CAP/.test(asCode), true);
// 12.9 — Codex P2 sonrası TR literal yerine DB ASCII identifier kullanılır;
// gerçek invariant 13.9'da. Burada sadece destructuring varlığını guard'la.
expect('12.9 previousOpenCount destructuring var',
  /previousOpenCount/.test(asCode), true);
expect('12.10 previousSlaBreachCount destructuring + slaViolation count',
  /previousSlaBreachCount/.test(asCode)
    && /slaViolation:\s*true/.test(asCode), true);

// 12.11 — 5 yeni yapısal bölüm başlığı (SINIFLANDIRMA / DENENEN ÇÖZÜMLER /
// MÜŞTERİ GEÇMİŞ / ÜRÜN/PAKET / ÇÖZÜM/İPTAL NOTU)
expect('12.11 SINIFLANDIRMA section başlığı',
  /SINIFLANDIRMA \(Smart Ticket\)/.test(asCode), true);
expect('12.12 DENENEN ÇÖZÜMLER section başlığı',
  /DENENEN ÇÖZÜMLER \(özet, max \$\{FAZ4_SOLUTION_STEP_CAP\}\)/.test(asCode), true);
expect('12.13 MÜŞTERİ GEÇMİŞ section başlığı',
  /MÜŞTERİ GEÇMİŞ \(sayı\)/.test(asCode), true);
expect('12.14 ÜRÜN/PAKET section başlığı',
  /ÜRÜN\/PAKET/.test(asCode), true);
expect('12.15 ÇÖZÜM/İPTAL NOTU section başlığı',
  /ÇÖZÜM\/İPTAL NOTU/.test(asCode), true);

// 12.16 — Boş atla disiplini (her bölüm "if (X.length)" conditional)
const asIfChecks = (asCode.match(/if \(\w+\.length\)/g) ?? []).length;
expect('12.16 if (X.length) kontrolleri Faz 4 enrichment için >= 5',
  asIfChecks >= 5, true, `bulunan=${asIfChecks}`);

// 12.17 — Tüm bölümler boşsa enrichmentSections.length conditional spread
expect('12.17 enrichmentSections.length conditional user prompt insert',
  /\.\.\.\(enrichmentSections\.length \? \[enrichmentSections\.join\('\\n\\n'\),\s*''\] : \[\]\)/.test(asCode), true);

// 12.18 — PII guard (status-report) — accountName ve assignedPersonName
// MEVCUT davranış İZİNLİ; yasak alanlar HÂLÂ yok.
// status-report için yasak: Account.email, phone, tckn*, customerContact*,
// customerCompanyName, AccountContact.
const FORBIDDEN_STATUS_REPORT = [
  'customerContactName',
  'customerContactPhone',
  'customerContactEmail',
  'customerCompanyName',
  'tcknHash',
  'tcknLast4',
  'accountContacts',
];
for (const field of FORBIDDEN_STATUS_REPORT) {
  const re = new RegExp(`\\b${field}\\b`);
  expect(`12.x PII guard (status-report) — "${field}" code'da YOK`,
    re.test(asCode), false);
}

// 12.26 — accountName + assignedPersonName İZİNLİ (mevcut davranış)
expect('12.26 accountName MEVCUT davranış (mail muhatabı)',
  /accountName:\s*true/.test(asCode), true);
expect('12.27 assignedPersonName MEVCUT davranış (mail imzası)',
  /assignedPersonName:\s*true/.test(asCode), true);

// 12.28 — Mevcut "Tahmin etme, uydurma" kuralı KORUNDU (status-report tonu)
expect('12.28 "Tahmin etme, uydurma" kuralı korundu',
  /Tahmin etme,\s*uydurma/.test(asCode), true);

// 12.29 — Mevcut AIUsageLog endpoint = "status-report"
expect('12.29 AIUsageLog endpoint "status-report" değişmedi',
  /endpoint:\s*'status-report'/.test(asCode), true);

// 12.30 — Mevcut "loglarda görünmüyor" disiplini korundu
expect('12.30 "loglarda görünmüyor" disiplini korundu',
  /loglarda görünmüyor/.test(asCode), true);

console.log('\n── 13) Codex P1+P2 fixes — companyId scope + DB ASCII ──');
// 13.1-13.2 — supervisor-summary M_STATUS import + ASCII const
expect('13.1 supervisorSummaryPrompt M_STATUS import',
  /import \{ fromDb, M_STATUS \} from '\.\.\/db\/enumMap\.js'/.test(promptCode), true);
expect('13.2 supervisorSummaryPrompt STATUS_DB_RESOLVED + STATUS_DB_CANCELLED',
  /STATUS_DB_RESOLVED = M_STATUS\['Çözüldü'\][\s\S]{0,200}STATUS_DB_CANCELLED = M_STATUS\['İptalEdildi'\]/.test(promptCode), true);
// 13.3 — supervisor count where companyId scope (her iki count'ta)
const supervisorCountWheres = (promptCode.match(/prisma\.case\.count\(\{\s*where:\s*\{\s*companyId:\s*c\.companyId/g) ?? []).length;
expect('13.3 supervisor case.count en az 2 yerde companyId: c.companyId',
  supervisorCountWheres >= 2, true, `bulunan=${supervisorCountWheres}`);
// 13.4 — supervisor count status: DB identifier (TR literal kalmadı)
expect('13.4 supervisor status: { in: [STATUS_DB_RESOLVED, STATUS_DB_CANCELLED] }',
  /status:\s*\{\s*in:\s*\[STATUS_DB_RESOLVED,\s*STATUS_DB_CANCELLED\]\s*\}/.test(promptCode), true);
expect('13.5 supervisor count TR status literal kalmadı',
  /prisma\.case\.count[\s\S]{0,500}status:\s*\{\s*in:\s*\['Çözüldü',\s*'İptalEdildi'\]/.test(promptCode), false);

// 13.6-13.10 — status-report (actionSummaryAi)
expect('13.6 actionSummaryAi M_STATUS import',
  /import \{ fromDb, M_STATUS \} from '\.\.\/db\/enumMap\.js'/.test(asCode), true);
expect('13.7 actionSummaryAi STATUS_DB_RESOLVED_AS + STATUS_DB_CANCELLED_AS',
  /STATUS_DB_RESOLVED_AS = M_STATUS\['Çözüldü'\][\s\S]{0,200}STATUS_DB_CANCELLED_AS = M_STATUS\['İptalEdildi'\]/.test(asCode), true);
const asCountWheres = (asCode.match(/prisma\.case\.count\(\{\s*where:\s*\{\s*companyId:\s*c\.companyId/g) ?? []).length;
expect('13.8 status-report case.count en az 2 yerde companyId: c.companyId',
  asCountWheres >= 2, true, `bulunan=${asCountWheres}`);
expect('13.9 status-report status: DB identifier kullanır',
  /status:\s*\{\s*in:\s*\[STATUS_DB_RESOLVED_AS,\s*STATUS_DB_CANCELLED_AS\]\s*\}/.test(asCode), true);
expect('13.10 status-report TR status literal kalmadı',
  /prisma\.case\.count[\s\S]{0,500}status:\s*\{\s*in:\s*\['Çözüldü',\s*'İptalEdildi'\]/.test(asCode), false);

console.log('\n── 14) Runtime fix — Prisma field name uyumu ───────────');
// 14.1 — caseCallLog orderBy callDate (startedAt değil)
expect('14.1 caseCallLog orderBy: { callDate: "desc" }',
  /prisma\.caseCallLog\.findMany\([\s\S]{0,500}orderBy:\s*\{\s*callDate:\s*'desc'\s*\}/.test(promptCode), true);
expect('14.2 caseCallLog orderBy startedAt KULLANMAZ',
  /caseCallLog[\s\S]{0,500}orderBy:\s*\{\s*startedAt/.test(promptCode), false);
// 14.3 — callLog select callDisposition / callOutcome / description
expect('14.3 caseCallLog select callDisposition + callOutcome + description',
  /prisma\.caseCallLog\.findMany\([\s\S]{0,500}select:\s*\{\s*callDisposition:\s*true,\s*callOutcome:\s*true,\s*description:\s*true,?\s*\}/.test(promptCode), true);
expect('14.4 caseCallLog select aiCallBrief/summary KULLANMAZ (Prisma model\'inde yok)',
  /prisma\.caseCallLog\.findMany\([\s\S]{0,500}aiCallBrief|prisma\.caseCallLog\.findMany\([\s\S]{0,500}summary:\s*true/.test(promptCode), false);
// 14.5 — caseTransfer select sadece reason + reasonCode (reasonLabel kalktı)
expect('14.5 caseTransfer select reason + reasonCode (reasonLabel KALDIRILDI)',
  /prisma\.caseTransfer\.findMany\([\s\S]{0,500}select:\s*\{\s*reason:\s*true,\s*reasonCode:\s*true\s*\}/.test(promptCode), true);
expect('14.6 caseTransfer reasonLabel select\'te yok',
  /prisma\.caseTransfer\.findMany\([\s\S]{0,500}reasonLabel:\s*true/.test(promptCode), false);
// 14.7 — prompt builder map'lerinde uyumlu field kullanımı
expect('14.7 reasonLabels map t.reason ?? t.reasonCode',
  /t\.reason \?\? t\.reasonCode/.test(promptCode), true);
expect('14.8 callBits map cl.callDisposition + cl.callOutcome',
  /cl\.callDisposition,\s*cl\.callOutcome/.test(promptCode), true);
expect('14.9 callBits map cl.description (aiCallBrief\\/summary değil)',
  /cl\.description \?\? ''/.test(promptCode), true);

console.log('\n────────────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
