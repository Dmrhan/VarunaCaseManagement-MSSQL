/**
 * smoke-smart-ticket-description-rerun.js — Stage 2 açıklama düzenle + KB
 * yeniden sor akışı için static guard.
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-description-rerun.js
 *
 * Korunan invariant'lar:
 *   - Stage2DescriptionEditor bileşeni tanımlı
 *   - Stage 2 mount: editor panel'in üstünde + refreshKey state
 *   - Panel key={`${id}:${refreshKey}`} ile remount tetikleniyor
 *   - Submit caseService.update + importAiSuggestedSolutionSteps sırayla
 *   - Aynı açıklama submit → no-op (gereksiz KB çağrısı önlenir)
 *   - 5 karakter min validation
 *   - createdCase.description senk (collapsed iken ezme guard)
 *   - Klasik akış (Stage 1/3) dokunulmadı
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = resolve(ROOT, 'src/features/smart-ticket/SmartTicketNewPage.tsx');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

if (!existsSync(PAGE)) { bad('SmartTicketNewPage.tsx YOK'); process.exit(1); }
const src = readFileSync(PAGE, 'utf8');

// 1) Stage2DescriptionEditor bileşeni tanımlı.
if (/function\s+Stage2DescriptionEditor\s*\(/.test(src)) {
  ok('1) Stage2DescriptionEditor bileşeni tanımlı');
} else {
  bad('1) Stage2DescriptionEditor eksik');
}

// 2) Stage2Solution refreshKey state + Stage2DescriptionEditor mount.
if (
  /useState\(0\)[\s\S]{0,400}?<Stage2DescriptionEditor/.test(src) ||
  (/refreshKey/.test(src) && /<Stage2DescriptionEditor/.test(src))
) {
  ok('2) Stage 2 refreshKey state + editor mount');
} else {
  bad('2) refreshKey state veya editor mount eksik');
}

// 3) Panel key prop refreshKey ile remount tetikliyor.
if (
  /key=\{`\$\{createdCase\.id\}:\$\{refreshKey\}`\}[\s\S]{0,300}?<CaseSolutionStepsPanel/.test(src) ||
  /<CaseSolutionStepsPanel[\s\S]{0,300}?key=\{`\$\{createdCase\.id\}:\$\{refreshKey\}`\}/.test(src)
) {
  ok('3) Panel key prop refreshKey ile (remount on description rerun)');
} else {
  bad('3) Panel key/refreshKey pattern eksik');
}

// 4) Editor mount panel'in ÜSTÜNDE (önce editor, sonra panel).
//    Indexler: Stage2DescriptionEditor < CaseSolutionStepsPanel mount edilmiş olmalı.
const editorIdx = src.indexOf('<Stage2DescriptionEditor');
const panelIdx = src.indexOf('<CaseSolutionStepsPanel');
if (editorIdx !== -1 && panelIdx !== -1 && editorIdx < panelIdx) {
  ok('4) Editor panel\'in üstünde mount edilmiş');
} else {
  bad('4) Editor / panel sırası yanlış');
}

// 5) Submit caseService.update + importAiSuggestedSolutionSteps sırayla.
if (
  /caseService\.update\(createdCase\.id,\s*\{\s*description:\s*trimmed\s*\}\)[\s\S]{0,800}?importAiSuggestedSolutionSteps\(updated\.id,\s*\{\s*freeText:\s*trimmed/.test(src)
) {
  ok('5) Submit: caseService.update sonra importAiSuggestedSolutionSteps');
} else {
  bad('5) Submit sequence eksik');
}

// 6) Aynı açıklama → no-op guard (info toast + KB call yok).
if (
  /trimmed\s*===\s*\(createdCase\.description\s*\?\?\s*''\)\.trim\(\)/.test(src) &&
  /A[çc]ıklama de[ğg]i[şs]medi/i.test(src)
) {
  ok('6) Aynı açıklama submit → no-op guard (info toast)');
} else {
  bad('6) No-op guard eksik');
}

// 7) Min 5 karakter validation.
if (/trimmed\.length\s*<\s*5/.test(src) && /En az 5 karakter/.test(src)) {
  ok('7) Min 5 karakter validation');
} else {
  bad('7) Min char validation eksik');
}

// 8) createdCase.description senk — yalnız collapsed iken (expanded edit
//    state'i ezmez).
if (
  /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(!expanded\)\s*setDraft\(createdCase\.description/.test(src)
) {
  ok('8) Expanded iken edit ezilmez (description senk guard)');
} else {
  bad('8) Senk guard eksik');
}

// 9) onUpdated callback caller'a updated case geçiriyor (Stage2Solution
//    refreshKey artırmak için).
if (/onUpdated\(updated\)/.test(src)) {
  ok('9) onUpdated callback updated case parametresi ile çağrılıyor');
} else {
  bad('9) onUpdated callback eksik');
}

// 10) Buton metni "Kaydet ve Yeniden Sor".
if (/Kaydet ve Yeniden Sor/.test(src)) {
  ok('10) Submit buton metni: "Kaydet ve Yeniden Sor"');
} else {
  bad('10) Buton metni eksik');
}

// 11) Editor sadece Stage 2'de mount; Stage 1/3 dokunulmadı (hızlı sanity).
if (
  /stage === 'opening'/.test(src) &&
  /stage === 'closure'/.test(src) &&
  /stage === 'transfer'/.test(src)
) {
  ok('11) Klasik Stage 1/3 render path\'leri dokunulmadı');
} else {
  bad('11) Stage 1/3 path eksik');
}

// 12) Yeni endpoint EKLENMEDİ.
if (
  !/POST\s+\/api\/cases\/.*description-rerun/.test(src) &&
  !/\/api\/smart-ticket\/.*description/.test(src)
) {
  ok('12) Yeni endpoint eklenmedi (mevcut update + import reuse)');
} else {
  bad('12) Yeni endpoint referansı tespit edildi');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
