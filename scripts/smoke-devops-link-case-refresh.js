/**
 * smoke-devops-link-case-refresh.js — statik guard.
 *
 * Bug: DevOps work item bağlama/kaldırma backend'de Case'i yan etki olarak
 * güncelleyebiliyor (örn. requestType → Hata otomatik ataması, bkz.
 * smoke-devops-link-request-type-hata.js). devopsService.link()/.unlink()
 * bu güncel Case'i zaten döndürüyordu ama DevOpsSection.tsx bunu üst
 * bileşene (CaseDetailPage) iletmiyordu — "Sınıflandırma" paneli gibi
 * paylaşılan case state'ine bağlı UI'lar sayfa yenilenene kadar eski
 * (stale) veri gösteriyordu.
 *
 * Fix: DevOpsSectionProps'a onCaseUpdated?: (updated: Case) => void eklendi;
 * handleLink/handleUnlink başarı yollarında devopsService'ten dönen updated
 * Case truthy ise onCaseUpdated çağrılıyor. CaseDetailPage.tsx zaten sahip
 * olduğu onCaseUpdated callback'ini <DevOpsSection> render'ına geçiyor.
 *
 * Çalıştır: node scripts/smoke-devops-link-case-refresh.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const section = readFileSync(path.resolve(root, 'src/features/cases/components/DevOpsSection.tsx'), 'utf8');
const detailPage = readFileSync(path.resolve(root, 'src/features/cases/CaseDetailPage.tsx'), 'utf8');

let pass = 0;
let fail = 0;
function check(label, pattern, src) {
  const ok = pattern.test(src);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

check(
  'Case tipi import edildi (@/features/cases/types)',
  /import type \{ Case \} from '@\/features\/cases\/types';/,
  section,
);
check(
  'DevOpsSectionProps onCaseUpdated?: (updated: Case) => void içeriyor',
  /onCaseUpdated\?: \(updated: Case\) => void;/,
  section,
);
check(
  'Component signature onCaseUpdated\'ı destructure ediyor',
  /export function DevOpsSection\(\{ caseId, canWrite, onCaseUpdated \}: DevOpsSectionProps\)/,
  section,
);
check(
  'handleLink başarı yolunda onCaseUpdated?.(updated) çağrılıyor',
  /const updated = await devopsService\.link\(caseId, ref\);[\s\S]{0,300}onCaseUpdated\?\.\(updated\);/,
  section,
);
check(
  'handleUnlink başarı yolunda onCaseUpdated?.(updated) çağrılıyor',
  /const updated = await devopsService\.unlink\(caseId, id\);[\s\S]{0,200}onCaseUpdated\?\.\(updated\);/,
  section,
);
check(
  'CaseDetailPage <DevOpsSection> render\'ına onCaseUpdated geçiyor',
  /<DevOpsSection caseId=\{item\.id\} canWrite=\{canWriteCase\} onCaseUpdated=\{onCaseUpdated\} \/>/,
  detailPage,
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
