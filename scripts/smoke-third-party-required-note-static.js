/**
 * U-C — 3. Parti Bekleniyor geçişinde tanım-bazlı zorunlu açıklama alanı.
 * Statik smoke: DB'ye dokunmaz, sadece kaynak kodda beklenen desenlerin
 * varlığını kontrol eder (migration henüz DB'ye uygulanmadan da çalışır).
 *
 * Çalıştır: node scripts/smoke-third-party-required-note-static.js
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

check('schema.prisma — ThirdParty.requiresNote', 'prisma/schema.prisma', /requiresNote\s+Boolean\s+@default\(false\)/);
check('schema.prisma — Case.thirdPartyNote', 'prisma/schema.prisma', /thirdPartyNote\s+String\?\s+@db\.NVarChar\(Max\)/);
check('migration dosyası mevcut', 'prisma/migrations/20260720_third_party_required_note/migration.sql', /ADD\s*\n\s*\[requiresNote\]/);
check('migration dosyası — Case.thirdPartyNote', 'prisma/migrations/20260720_third_party_required_note/migration.sql', /\[thirdPartyNote\] NVARCHAR\(MAX\) NULL/);

check('adminRepository.js — create requiresNote persist', 'server/db/adminRepository.js', /requiresNote:\s*input\.requiresNote === true/);
check('adminRepository.js — update requiresNote patch', 'server/db/adminRepository.js', /patch\.requiresNote !== undefined && \{ requiresNote: !!patch\.requiresNote \}/);

check('lookupRepository.js — ThirdParty select requiresNote', 'server/db/lookupRepository.js', /requiresNote: true/);

check('types.ts — CaseThirdParty.requiresNote', 'src/features/cases/types.ts', /requiresNote\?:\s*boolean/);
check('adminService.ts — ThirdPartyInput.requiresNote', 'src/services/adminService.ts', /requiresNote\?:\s*boolean/);

check('AdminThirdPartyPage.tsx — checkbox', 'src/features/admin/AdminThirdPartyPage.tsx', /Seçildiğinde açıklama zorunlu/);

check('StatusTransitionPanel.tsx — thirdPartyNote state', 'src/features/cases/StatusTransitionPanel.tsx', /const \[thirdPartyNote, setThirdPartyNote\] = useState/);
check('StatusTransitionPanel.tsx — selectedThirdParty gate', 'src/features/cases/StatusTransitionPanel.tsx', /selectedThirdParty\?\.requiresNote === true && !thirdPartyNote\.trim\(\)/);
check('StatusTransitionPanel.tsx — MentionTextarea render', 'src/features/cases/StatusTransitionPanel.tsx', /Bekleme Açıklaması/);
check('StatusTransitionPanel.tsx — mention mirror', 'src/features/cases/StatusTransitionPanel.tsx', /3\. parti bekleme açıklaması: \$\{thirdPartyNote\.trim\(\)\}/);

check('caseService.ts — transitionStatus payload', 'src/services/caseService.ts', /thirdPartyNote\?:\s*string/);

check('cases.js — route doc güncel', 'server/routes/cases.js', /thirdPartyNote\?, escalationLevel/);

check('caseRepository.js — requiresNote select', 'server/db/caseRepository.js', /requiresNote: true,\s*\n\s*\},/);
check('caseRepository.js — backend guard', 'server/db/caseRepository.js', /third_party_note_required/);
check('caseRepository.js — kalıcı persist (leavingPause temizlemiyor)', 'server/db/caseRepository.js', /thirdPartyNote: resolvedThirdPartyNote,/);

check('columnRegistry.js — rapor kolonu', 'server/lib/caseReport/columnRegistry.js', /id: 'thirdPartyNote'/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
