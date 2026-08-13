/**
 * Versiyon No — QuickCaseModal (Hızlı Vaka) ve SmartTicketNewPage (Akıllı
 * Ticket) doğrudan transitionStatus çağıran 2 kapanış yüzeyine de proaktif
 * Versiyon No kapısı eklendi. StatusTransitionPanel dışında bu iki bileşen
 * backend guard'a (product_version_required_for_closure) rağmen kullanıcıyı
 * önceden uyarmıyordu — generic hata/yönlendirme mesajına düşüyordu.
 *
 * CompactStatusStepper KAPSAM DIŞI — Çözüldü geçişi zaten StatusTransitionPanel'i
 * modal olarak açıyor (STATUS_REQUIRES_REASON kontrolü), ayrı bir kapı gerekmiyor.
 *
 * Statik smoke: DB'ye dokunmaz, kaynak kodda beklenen desenlerin varlığını
 * kontrol eder.
 *
 * Çalıştır: node scripts/smoke-quick-close-product-version-gate.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

function check(label, filePath, pattern) {
  const content = readFileSync(path.resolve(root, filePath), 'utf8');
  const ok = pattern.test(content);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

// ── QuickCaseModal.tsx ("Hızlı Vaka") ─────────────────────────────
check('QuickCaseModal.tsx — resolveProductVersion state', 'src/features/cases/QuickCaseModal.tsx', /const \[resolveProductVersion, setResolveProductVersion\] = useState\(''\);/);
check('QuickCaseModal.tsx — resolveNeedsProductVersion yalnız COMP-UNIVERA + SystemAdmin muaf', 'src/features/cases/QuickCaseModal.tsx', /const resolveNeedsProductVersion =\s*\n\s*resolveEnabled && form\.companyId === 'COMP-UNIVERA' && !isSystemAdmin;/);
check('QuickCaseModal.tsx — canSubmit resolveNeedsProductVersion kontrol ediyor', 'src/features/cases/QuickCaseModal.tsx', /\(!resolveNeedsProductVersion \|\| !!resolveProductVersion\.trim\(\)\)/);
check('QuickCaseModal.tsx — transitionStatus ÖNCESİ caseService.update(productVersion) çağrısı', 'src/features/cases/QuickCaseModal.tsx', /caseService\.update\(created\.id, \{ productVersion: resolveProductVersion\.trim\(\) \}\);/);
check('QuickCaseModal.tsx — Versiyon No input render ediliyor (resolveNeedsProductVersion koşullu)', 'src/features/cases/QuickCaseModal.tsx', /\{resolveNeedsProductVersion && \(\s*<Field label="Versiyon No" required/);
{
  const src = readFileSync(path.resolve(root, 'src/features/cases/QuickCaseModal.tsx'), 'utf8');
  const updateIdx = src.indexOf("caseService.update(created.id, { productVersion: resolveProductVersion.trim() });");
  const transitionIdx = src.indexOf("caseService.transitionStatus(created.id, 'Çözüldü'");
  const ok = updateIdx > 0 && transitionIdx > updateIdx;
  console.log(`${ok ? '✔' : '✘'} QuickCaseModal.tsx — update() transitionStatus'tan ÖNCE çağrılıyor (guard prev.productVersion'ı dolu bulsun)`);
  if (ok) pass += 1; else fail += 1;
}

// ── SmartTicketNewPage.tsx ("Akıllı Ticket" Stage 3 kapanış) ──────
check('SmartTicketNewPage.tsx — ClosureFormState.productVersion alanı', 'src/features/smart-ticket/SmartTicketNewPage.tsx', /productVersion: string;/);
check('SmartTicketNewPage.tsx — emptyClosure() productVersion: \'\' içeriyor', 'src/features/smart-ticket/SmartTicketNewPage.tsx', /permanentPrevention: '',\s*resolutionNote: '',\s*productVersion: '',/);
check('SmartTicketNewPage.tsx — handleCloseCase requiresProductVersion yalnız COMP-UNIVERA + SystemAdmin muaf', 'src/features/smart-ticket/SmartTicketNewPage.tsx', /const requiresProductVersion =\s*\n\s*createdCase\.companyId === 'COMP-UNIVERA' && user\?\.role !== 'SystemAdmin';/);
check('SmartTicketNewPage.tsx — handleCloseCase erken-return validasyonu (Versiyon No zorunlu)', 'src/features/smart-ticket/SmartTicketNewPage.tsx', /if \(requiresProductVersion && !closure\.productVersion\.trim\(\)\) \{\s*setClosureError\('Versiyon No zorunlu\.'\);\s*return;\s*\}/);
check('SmartTicketNewPage.tsx — transitionStatus ÖNCESİ caseService.update(productVersion) çağrısı', 'src/features/smart-ticket/SmartTicketNewPage.tsx', /caseService\.update\(createdCase\.id, \{ productVersion: closure\.productVersion\.trim\(\) \}\);/);
check('SmartTicketNewPage.tsx — Stage3Closure isSystemAdmin prop\'u alıyor', 'src/features/smart-ticket/SmartTicketNewPage.tsx', /isSystemAdmin: boolean;/);
check('SmartTicketNewPage.tsx — Stage3Closure çağrısına isSystemAdmin geçiliyor', 'src/features/smart-ticket/SmartTicketNewPage.tsx', /isSystemAdmin=\{user\?\.role === 'SystemAdmin'\}/);
check('SmartTicketNewPage.tsx — Versiyon No input render ediliyor (Stage3Closure içinde)', 'src/features/smart-ticket/SmartTicketNewPage.tsx', /\{createdCase\.companyId === 'COMP-UNIVERA' && !isSystemAdmin && \(\s*<Field label="Versiyon No" required/);
{
  const src = readFileSync(path.resolve(root, 'src/features/smart-ticket/SmartTicketNewPage.tsx'), 'utf8');
  const updateIdx = src.indexOf("caseService.update(createdCase.id, { productVersion: closure.productVersion.trim() });");
  const transitionIdx = src.indexOf("caseService.transitionStatus(createdCase.id, 'Çözüldü'");
  const ok = updateIdx > 0 && transitionIdx > updateIdx;
  console.log(`${ok ? '✔' : '✘'} SmartTicketNewPage.tsx — update() transitionStatus'tan ÖNCE çağrılıyor (guard prev.productVersion'ı dolu bulsun)`);
  if (ok) pass += 1; else fail += 1;
}

// ── CompactStatusStepper.tsx — kapsam dışı, DOKUNULMAMIŞ olduğunu doğrula ──
check('CompactStatusStepper.tsx — Çözüldü hâlâ StatusTransitionPanel modal üzerinden geçiyor (STATUS_REQUIRES_REASON)', 'src/features/cases/CompactStatusStepper.tsx', /if \(STATUS_REQUIRES_REASON\[target\]\) \{/);
{
  const src = readFileSync(path.resolve(root, 'src/features/cases/CompactStatusStepper.tsx'), 'utf8');
  const ok = !/productVersion/.test(src);
  console.log(`${ok ? '✔' : '✘'} CompactStatusStepper.tsx — productVersion'a HİÇ dokunulmadı (zaten kapsam dışı)`);
  if (ok) pass += 1; else fail += 1;
}

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
