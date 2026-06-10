/**
 * smoke-smart-ticket-voice-input.js — PR-1 (Voice input) static guard.
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-voice-input.js
 *
 * Korunan invariant'lar:
 *   - VoiceNoteButton import edildi
 *   - Stage 1 Açıklama (description) field'ına actions ile mount
 *   - Stage 3 Çözüm Açıklaması (resolutionNote) field'ına actions ile mount
 *   - Title alanına voice EKLENMEDİ (kasıtlı scope sınırı)
 *   - useSpeechRecognition hook'u direkt çağrılmadı (VoiceNoteButton içinde)
 *   - Mevcut altyapı reuse (yeni hook/component yok)
 *   - NewCaseForm / QuickCaseModal voice pattern'leri dokunulmadı (regression)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = resolve(ROOT, 'src/features/smart-ticket/SmartTicketNewPage.tsx');
const VBTN = resolve(ROOT, 'src/components/ui/VoiceNoteButton.tsx');
const HOOK = resolve(ROOT, 'src/hooks/useSpeechRecognition.ts');
const NCF = resolve(ROOT, 'src/features/cases/NewCaseForm.tsx');
const QCM = resolve(ROOT, 'src/features/cases/QuickCaseModal.tsx');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }

for (const p of [PAGE, VBTN, HOOK, NCF, QCM]) {
  if (!existsSync(p)) { bad(`${p} YOK`); process.exit(1); }
}
const page = readFileSync(PAGE, 'utf8');
const ncf = readFileSync(NCF, 'utf8');
const qcm = readFileSync(QCM, 'utf8');

// 1) VoiceNoteButton import edildi.
if (/import\s*\{\s*VoiceNoteButton\s*\}\s*from\s*['"]@\/components\/ui\/VoiceNoteButton['"]/.test(page)) {
  ok('1) VoiceNoteButton import edildi');
} else {
  bad('1) VoiceNoteButton import eksik');
}

// 2) Stage 1 Açıklama (description) field actions={<VoiceNoteButton ...} ile mount.
//    Field label="Açıklama" + actions içinde VoiceNoteButton aranır.
//    setForm(... f.description ...) pattern'i yalnız Stage 1 description için.
if (
  /<Field[\s\S]{0,200}?label="Açıklama"[\s\S]{0,1500}?<VoiceNoteButton[\s\S]{0,400}?setForm\([\s\S]{0,200}?f\.description/.test(page)
) {
  ok('2) Stage 1 Açıklama field actions ile VoiceNoteButton mount');
} else {
  bad('2) Stage 1 Açıklama voice mount eksik');
}

// 3) Stage 3 Çözüm Açıklaması field VoiceNoteButton mount.
const resBlock = page.match(/<Field[\s\S]{0,400}?Çözüm Açıklaması[\s\S]{0,800}?<\/Field>/);
if (resBlock && /actions=\{[\s\S]{0,400}?<VoiceNoteButton/.test(resBlock[0])) {
  ok('3) Stage 3 Çözüm Açıklaması field actions ile VoiceNoteButton mount');
} else {
  bad('3) Stage 3 Çözüm Açıklaması voice mount eksik');
}

// 4) Title (Başlık) alanına voice EKLENMEDİ.
//    "Başlık" field'ı içinde VoiceNoteButton OLMAMALI.
const titleBlock = page.match(/<Field\s+label="Başlık"[\s\S]{0,800}?<\/Field>/);
if (titleBlock && !/<VoiceNoteButton/.test(titleBlock[0])) {
  ok('4) Başlık field\'ına voice EKLENMEDİ (scope sınırı korundu)');
} else {
  bad('4) Başlık field\'ında VoiceNoteButton bulundu (scope dışı)');
}

// 5) useSpeechRecognition hook'u SmartTicketNewPage'de direkt çağrılmadı —
//    sadece VoiceNoteButton içinden kullanılıyor.
if (!/useSpeechRecognition/.test(page)) {
  ok('5) useSpeechRecognition hook direkt çağrılmadı (VoiceNoteButton encapsulation korundu)');
} else {
  bad('5) useSpeechRecognition direkt page\'de çağrılmış');
}

// 6) onTranscript chunk → mevcut text'e append pattern (NewCaseForm pattern'i).
//    Hem description hem resolutionNote için chunk varsa boşluklu append.
if (
  /description:\s*f\.description\s*\?\s*`\$\{f\.description\}\s*\$\{chunk\}`/.test(page) &&
  /resolutionNote:\s*c\.resolutionNote\s*\?\s*`\$\{c\.resolutionNote\}\s*\$\{chunk\}`/.test(page)
) {
  ok('6) onTranscript append pattern (boşluklu mevcut text\'e ekle) iki alanda da uygulandı');
} else {
  bad('6) Append pattern eksik veya tutarsız');
}

// 7) Stage 1 voice yalnız stage==='opening' iken render edilir (Stage 2/3'te
//    description alanı zaten readonly; voice gizli kalsın).
if (/stage\s*===\s*['"]opening['"][\s\S]{0,200}?<VoiceNoteButton/.test(page)) {
  ok('7) Stage 1 voice koşullu render (yalnız opening stage\'inde)');
} else {
  bad('7) Stage 1 voice stage koşulu eksik');
}

// 8) Regression: NewCaseForm voice davranışı dokunulmadı.
//    Mevcut pattern (line ~990): actions={<VoiceNoteButton onTranscript=...>}
if (/<Field[\s\S]{0,200}?label="Açıklama"[\s\S]{0,400}?<VoiceNoteButton/.test(ncf)) {
  ok('8) NewCaseForm voice davranışı korundu');
} else {
  bad('8) NewCaseForm voice davranışı bozulmuş (regression)');
}

// 9) Regression: QuickCaseModal voice davranışı dokunulmadı.
const qcmVoiceCount = (qcm.match(/<VoiceNoteButton/g) ?? []).length;
if (qcmVoiceCount >= 2) {
  ok(`9) QuickCaseModal voice davranışı korundu (count=${qcmVoiceCount})`);
} else {
  bad(`9) QuickCaseModal voice davranışı eksik (count=${qcmVoiceCount})`);
}

// 10) Yeni hook/altyapı kurulmadı — mevcut useSpeechRecognition hook'u
//     ve VoiceNoteButton bileşeni intact.
const hookSrc = readFileSync(HOOK, 'utf8');
if (/'tr-TR'/.test(hookSrc) && /webkitSpeechRecognition/.test(hookSrc)) {
  ok('10) Mevcut useSpeechRecognition altyapısı intact (tr-TR + webkit fallback)');
} else {
  bad('10) Speech hook altyapısı değişmiş');
}

console.log('');
console.log('── Summary ─────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
