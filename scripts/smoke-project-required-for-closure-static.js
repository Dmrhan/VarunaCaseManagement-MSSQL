/**
 * WR-Proje-Kapanış — statik smoke: DB'ye dokunmaz, kaynak kodda beklenen
 * desenlerin varlığını kontrol eder.
 *
 * Çalıştır: node scripts/smoke-project-required-for-closure-static.js
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
  if (ok) pass += 1;
  else fail += 1;
}

// ── Backend: helper + guard ──────────────────────────────────
check('caseRepository.js — hasActiveProjectsForCaseAccount export', 'server/db/caseRepository.js', /export async function hasActiveProjectsForCaseAccount/);
check('caseRepository.js — AccountCompany unique lookup', 'server/db/caseRepository.js', /accountId_companyId: \{ accountId, companyId \}/);
check('caseRepository.js — AccountProject count filtresi (isActive+Active)', 'server/db/caseRepository.js', /accountCompanyId: accountCompany\.id, isActive: true, status: 'Active'/);
check('caseRepository.js — transitionStatus guard: project_required_for_closure', 'server/db/caseRepository.js', /code: 'project_required_for_closure'/);
check('caseRepository.js — shapeWithProjectAvailability export/tanım', 'server/db/caseRepository.js', /async function shapeWithProjectAvailability\(c\)/);
// get() — GET /api/cases/:id, sayfa ilk açılışında kullanılan TEKİL fetch.
// list() ile aynı enrichSlaView([shape(c)]) yüzeysel deseni yüzünden ilk
// dönüşümde atlanmıştı (bkz. bug: ilk sayfa yüklemesinde proje kapısı hiç
// tetiklenmiyordu — hasAvailableProjects undefined kalıyordu).
check('caseRepository.js — get() shapeWithProjectAvailability kullanıyor', 'server/db/caseRepository.js', /enrichSlaView\(\[await shapeWithProjectAvailability\(c\)\]\)/);

// ── Backend: guard sırası (account guard'dan hemen sonra, product_group'tan önce) ──
{
  const src = readFileSync(path.resolve(root, 'server/db/caseRepository.js'), 'utf8');
  const accountIdx = src.indexOf("code: 'account_required_for_closure'");
  const projectIdx = src.indexOf("code: 'project_required_for_closure'");
  const productGroupIdx = src.indexOf("code: 'product_group_required_for_closure'");
  const ok = accountIdx > 0 && projectIdx > accountIdx && productGroupIdx > projectIdx;
  console.log(`${ok ? '✔' : '✘'} caseRepository.js — guard sırası: account → project → product_group`);
  if (ok) pass += 1; else fail += 1;
}

// ── Backend: tüm tekil-case dönüşleri shapeWithProjectAvailability kullanıyor,
//    liste (.map(shape)) dönüşleri DOKUNULMAMIŞ ──
{
  const src = readFileSync(path.resolve(root, 'server/db/caseRepository.js'), 'utf8');
  const strayReturnShape = /return\s+shape\(/g.test(src.replace(/shapeWithProjectAvailability/g, ''));
  console.log(`${!strayReturnShape ? '✔' : '✘'} caseRepository.js — tekil dönüşlerde çıplak 'return shape(' kalmamış`);
  if (!strayReturnShape) pass += 1; else fail += 1;

  // Yalnız gerçek kod satırlarını say (yorum satırındaki örnek referansı hariç).
  const codeLines = src.split('\n').filter((l) => !/^\s*[*/]/.test(l));
  const listSitesIntact = codeLines.filter((l) => /items\.map\(shape\)/.test(l)).length === 2;
  console.log(`${listSitesIntact ? '✔' : '✘'} caseRepository.js — liste dönüşleri (items.map(shape), 2 yer) DOKUNULMAMIŞ`);
  if (listSitesIntact) pass += 1; else fail += 1;
}

// ── Frontend: tip ──────────────────────────────────────────────
check('types.ts — Case.hasAvailableProjects', 'src/features/cases/types.ts', /hasAvailableProjects\?: boolean;/);

// ── Frontend: CaseDetailPage client filtresi isActive+status ────
check('CaseDetailPage.tsx — proje filtresi isActive+status', 'src/features/cases/CaseDetailPage.tsx', /\.filter\(\(p\) => p\.isActive && p\.status === 'Active'\)/);

// ── Frontend: StatusTransitionPanel gate ─────────────────────────
check('StatusTransitionPanel.tsx — projectGateActive tanımı', 'src/features/cases/StatusTransitionPanel.tsx', /const projectGateActive =/);
check('StatusTransitionPanel.tsx — hasAvailableProjects koşulu', 'src/features/cases/StatusTransitionPanel.tsx', /effectiveHasAvailableProjects === true/);
check('StatusTransitionPanel.tsx — applyDisabled projectGateActive', 'src/features/cases/StatusTransitionPanel.tsx', /if \(projectGateActive\) return true;/);
check('StatusTransitionPanel.tsx — uyarı mesajı', 'src/features/cases/StatusTransitionPanel.tsx', /vaka çözülmeden önce proje seçilmelidir/);
check('StatusTransitionPanel.tsx — inline proje seçim + kaydet', 'src/features/cases/StatusTransitionPanel.tsx', /handleSaveProject/);

// ── Frontend: Müşteri arama modalı — Smart Ticket'taki gibi "müşteri +
//    proje tek adımda" akışı (AccountSearchPicker.onSelectWithProject) ──
check('StatusTransitionPanel.tsx — linkedCaseSnapshot (taze accountId/hasAvailableProjects)', 'src/features/cases/StatusTransitionPanel.tsx', /const \[linkedCaseSnapshot, setLinkedCaseSnapshot\] = useState<Case \| null>/);
check('StatusTransitionPanel.tsx — effectiveAccountId proje kapısında kullanılıyor', 'src/features/cases/StatusTransitionPanel.tsx', /const effectiveAccountId = linkedCaseSnapshot\?\.accountId \?\? item\.accountId;/);
check('StatusTransitionPanel.tsx — handleLinkCustomerWithProject tanımı', 'src/features/cases/StatusTransitionPanel.tsx', /async function handleLinkCustomerWithProject\(account: AccountListItem, project: PickedProject \| null\)/);
check('StatusTransitionPanel.tsx — AccountSearchPicker onSelectWithProject bağlı', 'src/features/cases/StatusTransitionPanel.tsx', /onSelectWithProject=\{\(account, project\) => \{/);
check('StatusTransitionPanel.tsx — picker projectsEnabled tenant ayarına bağlı', 'src/features/cases/StatusTransitionPanel.tsx', /projectsEnabled=\{projectsEnabledForCompany\}/);

// ── Frontend: CaseDetailPage'in "Manuel müşteri ara" akışı da aynı
//    müşteri+proje tek-adım desenini kullanıyor (değiştir akışı hariç) ──
check('CaseDetailPage.tsx — picker onSelectWithProject bağlı', 'src/features/cases/CaseDetailPage.tsx', /onSelectWithProject=\{async \(account: AccountListItem, project: PickedProject \| null\) => \{/);
check('CaseDetailPage.tsx — picker projectsEnabled tenant ayarına bağlı', 'src/features/cases/CaseDetailPage.tsx', /projectsEnabled=\{projectsEnabledForCompany\}/);

// ── Frontend: "Değiştir" akışında da seçilen proje taslağa girip
//    Kaydet'te uygulanıyor (bug: önceden project bilgisi atlanıyordu) ──
check('CaseDetailPage.tsx — pendingAccountChange proje alanları taşıyor', 'src/features/cases/CaseDetailPage.tsx', /projectId\?: string; projectLabel\?: string \} \| null>\(null\);/);
check('CaseDetailPage.tsx — handleSaveDrafts pendingAccountChange.projectId uyguluyor', 'src/features/cases/CaseDetailPage.tsx', /if \(pendingAccountChange\.projectId\) \{/);

// ── Aktiviteler'de "Proje: <ham ID>" yerine "Proje: <ad>" görünmesi
//    (bug: update() içindeki genel field-diff, patch'teki ham accountProjectId
//    değerini String() ile logluyordu) ──
check('caseRepository.js — update() proje history kaydını isimle güncelliyor', 'server/db/caseRepository.js', /projectHistoryEntry\.toValue = lifecyclePatch\.accountProjectName \?\? null;/);
check('types.ts — CASE_FIELD_LABELS.accountProjectId = Proje', 'src/features/cases/types.ts', /accountProjectId:\s*'Proje',/);

// ── Bug: Backoffice canLookupAccountForCaseProject listesinde yoktu —
//    projectGateActive her role uygulanıyordu ama proje dropdown'ı
//    Backoffice için hiç fetch edilmiyordu (Uygula/Kaydet kilitli kalıyordu) ──
check('accountService.ts — canLookupAccountForCaseProject Backoffice içeriyor', 'src/services/accountService.ts', /\[\.\.\.ACCOUNT_READ_ROLES, 'Agent', 'Backoffice'\]/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
