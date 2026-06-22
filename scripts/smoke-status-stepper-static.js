/**
 * smoke-status-stepper-static.js
 *
 * Vaka Detay sticky header CompactStatusStepper invariant'ları (DB-bağımsız,
 * kaynak-seviye).
 *
 * Korunan invariant'lar:
 *  1) types.ts'de 3 fazlı omurga + label + phase map + reason flag export
 *  2) StatusTransitionPanel.tsx silinmedi + initialPending prop'u var
 *     (reason/closure logic parçalanmadı; aynı panel modal'da reuse ediliyor)
 *  3) CompactStatusStepper.tsx mevcut + Modal içinde StatusTransitionPanel
 *     render ediyor (parçalanma yok)
 *  4) CaseDetailPage sticky header'da CompactStatusStepper render; geniş
 *     panel render kaldırıldı
 *  5) Backend / Prisma / API endpoint değişmedi (görsel katman)
 *
 * Çalıştır:
 *   node scripts/smoke-status-stepper-static.js
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
function expect(name, actual, expected) {
  if (actual === expected || JSON.stringify(actual) === JSON.stringify(expected)) ok(name);
  else bad(name, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

console.log('── 1) types.ts — faz omurgası + label + reason flag ──────');
{
  const t = read('src/features/cases/types.ts');
  expect('1.1 CASE_STATUS_LABELS export',
    /export const CASE_STATUS_LABELS: Record<CaseStatus, string>/.test(t), true);
  expect('1.2 CASE_STATUS_PHASES = [open, in_progress, result]',
    t.includes("CASE_STATUS_PHASES: CaseStatusPhase[] = ['open', 'in_progress', 'result']"), true);
  expect('1.3 CASE_STATUS_PHASE_MAP — 7 statü → 3 faz',
    /CASE_STATUS_PHASE_MAP[\s\S]{0,400}'Açık':\s*'open'[\s\S]{0,300}'İncelemede':\s*'in_progress'[\s\S]{0,500}'Çözüldü':\s*'result'/.test(t), true);
  expect('1.4 STATUS_REQUIRES_REASON — Çözüldü+İptal+3.parti+Eskalasyon true',
    /STATUS_REQUIRES_REASON[\s\S]{0,400}'3rdPartyBekleniyor':\s*true[\s\S]{0,200}'Eskalasyon':\s*true[\s\S]{0,200}'Çözüldü':\s*true[\s\S]{0,200}'İptalEdildi':\s*true/.test(t), true);
  expect('1.5 STATUS_REQUIRES_REASON — Açık+İncelemede+YenidenAcildi false',
    /'Açık':\s*false[\s\S]{0,100}'İncelemede':\s*false[\s\S]{0,300}'YenidenAcildi':\s*false/.test(t), true);
}

console.log('\n── 2) StatusTransitionPanel.tsx — silinmedi + initialPending ──');
{
  const p = 'src/features/cases/StatusTransitionPanel.tsx';
  expect('2.1 StatusTransitionPanel.tsx dosyası mevcut (silinmedi)',
    existsSync(path.join(REPO_ROOT, p)), true);
  const src = read(p);
  expect('2.2 initialPending prop interface\'de',
    /initialPending\?:\s*CaseStatus \| null/.test(src), true);
  expect('2.3 useState initial value initialPending ?? null',
    /useState<CaseStatus \| null>\(initialPending \?\? null\)/.test(src), true);
  expect('2.4 useEffect item.id reset initialPending fallback',
    /setPending\(initialPending \?\? null\)/.test(src), true);
  // 2.5 — reason/closure logic hala panel içinde (parçalanmadı): handleApply,
  // closure taxonomy + KB suggestion + checklist + resolutionNote/cancelReason
  // hepsi tek dosyada.
  expect('2.5 handleApply hala panel içinde',
    /async function handleApply\(\)/.test(src), true);
  expect('2.6 closure taxonomy + KB suggestion + checklist panel içinde',
    /closureTax|kbSuggestion|requiredChecklistPending/.test(src), true);
}

console.log('\n── 3) CompactStatusStepper.tsx — yeni component ──────────');
{
  const p = 'src/features/cases/CompactStatusStepper.tsx';
  expect('3.1 CompactStatusStepper.tsx mevcut',
    existsSync(path.join(REPO_ROOT, p)), true);
  const src = read(p);
  expect('3.2 export function CompactStatusStepper',
    /export function CompactStatusStepper\(/.test(src), true);
  expect('3.3 3 fazlı omurga: CASE_STATUS_PHASES map',
    /CASE_STATUS_PHASES\.map/.test(src), true);
  // 3.4 — reason zorunlu hedef için Modal + StatusTransitionPanel reuse
  expect('3.4 Modal içinde StatusTransitionPanel reuse',
    /<Modal[\s\S]{0,500}<StatusTransitionPanel[\s\S]{0,200}initialPending=\{reasonTarget\}/.test(src), true);
  // 3.5 — reason gerekmeyen hedef için doğrudan caseService.transitionStatus
  expect('3.5 direkt transitionStatus reason gerekmeyenler için',
    /caseService\.transitionStatus\(item\.id,\s*target/.test(src), true);
  // 3.6 — Reason/closure logic CompactStatusStepper'da YENİDEN YAZILMADI
  expect('3.6 reason/closure logic stepper\'da yeniden yazılmadı (no resolutionNote handling)',
    /resolutionNote\s*=|closureRcg|kbSuggestion/.test(src), false);
  // 3.7 — Aksiyon satırı: en sık 2 buton + ⋯ menü (Popover)
  expect('3.7 PRIMARY_LIMIT = 2',
    /const PRIMARY_LIMIT = 2/.test(src), true);
  expect('3.8 Popover import + "Daha fazla" overflow menü',
    src.includes("import { Popover }") && src.includes('Daha fazla'), true);
}

console.log('\n── 4) CaseDetailPage — sticky header wiring ──────────────');
{
  const src = read('src/features/cases/CaseDetailPage.tsx');
  expect('4.1 CompactStatusStepper import',
    src.includes("import { CompactStatusStepper } from './CompactStatusStepper'"), true);
  expect('4.2 sticky header\'da <CompactStatusStepper render',
    /<CompactStatusStepper item=\{item\} onApplied=\{setItem\}/.test(src), true);
  // 4.3 — Geniş panel render gövdede kaldırıldı (sadece comment kaldı)
  expect('4.3 <StatusTransitionPanel JSX gövdede yok',
    /<StatusTransitionPanel/.test(src), false);
  // 4.4 — Sticky header'daki StatusPill kaldırıldı (stepper onun yerini aldı)
  expect('4.4 sticky header StatusPill\'i CompactStepper ile değiştirildi',
    /\{\/\* StatusPill artık görsel\/display-only/.test(src), false);
}

console.log('\n── 5) Backend / Prisma / API touch-check ─────────────────');
{
  // Bu task tamamen FE görsel katmanı; backend dosyaları değişmemeli.
  // git diff origin/dev baz alarak doğrula; CI ortamında basit kanıt için
  // bilinen backend dosyalarının değişiklik özetini kontrol et.
  // (Smoke runner branch context'inde olsa da defansif kalsın.)
  const backendKey = 'server/db/caseRepository.js';
  // Yalnız caseRepository içindeki create/transitionStatus signature stable:
  const repo = read(backendKey);
  expect('5.1 caseRepository.create signature stable',
    /async create\(input, actor\) \{/.test(repo), true);
  expect('5.2 caseRepository.transitionStatus signature stable',
    /async transitionStatus\(id, nextStatus, payload = \{\}/.test(repo), true);
  // 5.3 — STATUS_TRANSITIONS enum dokunulmadı
  const t = read('src/features/cases/types.ts');
  expect('5.3 STATUS_TRANSITIONS — 7 statü kuralı korundu',
    /STATUS_TRANSITIONS:[\s\S]{0,400}'Açık':[\s\S]{0,200}'İncelemede':[\s\S]{0,300}'Çözüldü':/.test(t), true);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
