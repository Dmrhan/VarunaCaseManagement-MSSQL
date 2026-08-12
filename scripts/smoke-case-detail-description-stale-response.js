/**
 * smoke-case-detail-description-stale-response.js — statik guard.
 *
 * Bug: Açıklama alanı ✓ (Onayla) ile kaydedilirken (handleCommitDescription,
 * PATCH caseService.update) kullanıcı yanıt dönmeden breadcrumb/önceki-vaka
 * ile BAŞKA bir vakaya geçerse (activeId değişir), eski vakanın PATCH
 * yanıtı geldiğinde onCaseUpdated (=setItem) koşulsuz çağrılıyordu — bu da
 * üst state'i (artık yeni açılan vakayı göstermesi gereken item) eski
 * vakanın verisiyle EZİYORDU.
 *
 * Fix: parent'ta her render'da güncellenen activeIdRef; async commit,
 * await sonrası activeIdRef.current hâlâ commit başındaki case id'sine eşit
 * DEĞİLSE onCaseUpdated/onCancelEdit çağrılmaz (PATCH backend'de zaten
 * kalıcı olmuştur — sadece stale yanıt üst state'e uygulanmaz).
 *
 * Çalıştır: node scripts/smoke-case-detail-description-stale-response.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FILE = 'src/features/cases/CaseDetailPage.tsx';
const src = readFileSync(path.resolve(root, FILE), 'utf8');

let pass = 0;
let fail = 0;
function check(label, pattern) {
  const ok = pattern.test(src);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

check('activeIdRef — parent state activeId ile senkron tutuluyor', /const activeIdRef = useRef\(activeId\);\s*activeIdRef\.current = activeId;/);
check('DetailTab çağrısına activeIdRef prop olarak geçiliyor', /onCaseUpdated=\{\(updated\) => setItem\(updated\)\}\s*activeIdRef=\{activeIdRef\}/);
check('DetailTab props tipinde activeIdRef tanımlı', /activeIdRef: \{ current: string \};/);
check('handleCommitDescription — commit başındaki case id yakalanıyor', /const caseIdAtCommit = item\.id;\s*const updated = await caseService\.update\(caseIdAtCommit,/);
check('handleCommitDescription — await sonrası activeId hâlâ aynı vakada mı kontrol ediliyor', /if \(activeIdRef\.current !== caseIdAtCommit\) return;/);
check('handleCommitDescription — guard\'dan SONRA onCaseUpdated + onCancelEdit çağrılıyor', /if \(activeIdRef\.current !== caseIdAtCommit\) return;\s*onCaseUpdated\(updated\);\s*onCancelEdit\(\);/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
