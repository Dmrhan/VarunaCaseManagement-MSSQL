/**
 * Vaka Etiket Doğrulama Ekranı — Talep Türü eklendi (10. alan).
 *
 * Diğer 9 etiketten (Platform/İş Süreci/.../Kalıcı Önlem) mimari olarak
 * farklı: kaynağı Case.customFields.smartTicket JSON'ı DEĞİL, doğrudan
 * Case.requestType kolonu; geçerli seçenekleri TaxonomyDef DEĞİL, sabit
 * 5 değerlik enum (M_REQUEST: Bilgi/Öneri/Talep/Şikayet/Hata).
 *
 * Gerçek veriyle doğrulandı (2026-08-19):
 *  - create-time snapshot Case.requestType'tan doğru okunuyor
 *  - geçerli düzeltme kodu (Sikayet) doğru TR etikete (Şikayet) çözülüyor
 *  - geçersiz kod reddediliyor
 *  - getTaggingReviewsByCaseIds (generic, değişmedi) yeni alanları taşıyor
 *  - mevcut 9 alanın davranışı (openingPlatformVerdict) bozulmadı
 *
 * Statik smoke: DB'ye dokunmaz, kaynak kodda beklenen desenlerin varlığını
 * kontrol eder.
 *
 * Çalıştır: node scripts/smoke-tagging-review-request-type.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

function check(label, filePath, predicate) {
  const content = readFileSync(path.resolve(root, filePath), 'utf8');
  const ok = predicate instanceof RegExp ? predicate.test(content) : predicate(content);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

// ── Şema ──────────────────────────────────────────────────────
check('schema.prisma — CaseTaggingReview.requestType* 5 kolon eklendi', 'prisma/schema.prisma', /requestTypeOriginalCode {3}String\? @db\.NVarChar\(255\)[\s\S]{0,300}requestTypeCorrectedLabel String\? @db\.NVarChar\(Max\)/);
check('migration dosyası oluşturuldu (ALTER TABLE CaseTaggingReview ADD)', 'prisma/migrations/20260819_tagging_review_request_type/migration.sql', /ALTER TABLE \[dbo\]\.\[CaseTaggingReview\] ADD[\s\S]*requestTypeCorrectedLabel/);

// ── Backend ───────────────────────────────────────────────────
check('caseRepository.js — TAGGING_FIELD_DEFS requestType (source:enum) içeriyor', 'server/db/caseRepository.js', /\{ prefix: '', tag: 'requestType', customField: 'requestType', source: 'enum' \}/);
check('caseRepository.js — R_REQUEST_TYPE ters harita M_REQUEST\'ten türetiliyor', 'server/db/caseRepository.js', /const R_REQUEST_TYPE = Object\.fromEntries\(Object\.entries\(M_REQUEST\)/);
check('caseRepository.js — correction doğrulaması taxonomy/enum olarak ikiye ayrılıyor', 'server/db/caseRepository.js', /taxonomyCorrectedEntries = correctedEntries\.filter\(\(e\) => e\.def\.source !== 'enum'\);[\s\S]{0,50}enumCorrectedEntries = correctedEntries\.filter\(\(e\) => e\.def\.source === 'enum'\);/);
check('caseRepository.js — original snapshot Case.requestType\'tan (customFields DEĞİL)', 'server/db/caseRepository.js', /originalData\[`\$\{def\.prefix\}\$\{def\.tag\}OriginalCode`\] = caseRow\?\.requestType \?\? null;/);
check('caseRepository.js — caseRow select\'ine requestType eklendi', 'server/db/caseRepository.js', /select: \{ customFields: true, requestType: true \}/);
check('routes/cases.js — TAGGING_REVIEW_FIELD_KEYS requestTypeVerdict/CorrectedCode içeriyor', 'server/routes/cases.js', /'requestTypeVerdict', 'requestTypeCorrectedCode',/);

// ── Frontend ──────────────────────────────────────────────────
check('types.ts — CaseTaggingReview.requestType* 5 alan eklendi', 'src/features/cases/types.ts', /requestTypeOriginalCode: string \| null;[\s\S]{0,200}requestTypeCorrectedLabel: string \| null;/);
check('caseService.ts — updateTaggingReview patch tipine requestType eklendi', 'src/services/caseService.ts', /requestTypeVerdict\?: TaggingVerdict \| null;\s*\n\s*requestTypeCorrectedCode\?: string \| null;/);
check('CaseTaggingReviewPage.tsx — TagDef.prefix requestType\'ı da kapsıyor', 'src/features/analytics/CaseTaggingReviewPage.tsx', /prefix: 'opening' \| 'closing' \| 'requestType';/);
check('CaseTaggingReviewPage.tsx — REQUEST_TYPE_OPTIONS sabit 5 değer (ASCII kod / TR etiket)', 'src/features/analytics/CaseTaggingReviewPage.tsx', /const REQUEST_TYPE_OPTIONS: SmartTicketTaxonomyItem\[\] = \[/);
check('CaseTaggingReviewPage.tsx — TAG_DEFS\'e requestType eklendi', 'src/features/analytics/CaseTaggingReviewPage.tsx', /\{ prefix: 'requestType', field: '', label: 'Talep Türü', customField: 'requestType' \}/);
check('CaseTaggingReviewPage.tsx — originalLabel() Case.requestType\'ı doğrudan okuyor', 'src/features/analytics/CaseTaggingReviewPage.tsx', /if \(def\.prefix === 'requestType'\) return c\.requestType \|\| null;/);
check('CaseTaggingReviewPage.tsx — modalda 3. TagSection ("Talep Türü") render ediliyor', 'src/features/analytics/CaseTaggingReviewPage.tsx', /title="Talep Türü"[\s\S]{0,100}defs=\{REQUEST_TYPE_DEFS\}/);
check('CaseTaggingReviewPage.tsx — CSV export prefix etiketi 3 yollu (Ac/Ka/TT)', 'src/features/analytics/CaseTaggingReviewPage.tsx', /def\.prefix === 'opening' \? 'Ac' : def\.prefix === 'closing' \? 'Ka' : 'TT';/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
