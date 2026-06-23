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

// Account select'inde sadece izinli alanlar (customerType/segment/financialStatus/supportLevel)
expect('2.10 Account select sadece izinli 4 alan',
  /prisma\.account\.findUnique\([\s\S]{0,400}select:\s*\{\s*customerType:\s*true,\s*segment:\s*true,\s*financialStatus:\s*true,\s*supportLevel:\s*true,?\s*\}/.test(promptCode), true);

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
// 4-alan şema korundu (summary/riskLevel/keyPoints/recommendation)
expect('7.3 çıktı şeması 4 alan (summary/riskLevel/keyPoints/recommendation)',
  /"summary":[\s\S]{0,300}"riskLevel":[\s\S]{0,300}"keyPoints":[\s\S]{0,300}"recommendation":/.test(promptCode), true);

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

console.log('\n────────────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
