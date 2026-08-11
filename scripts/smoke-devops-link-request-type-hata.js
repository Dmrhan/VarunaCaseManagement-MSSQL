/**
 * smoke-devops-link-request-type-hata.js — statik guard.
 *
 * Ürün kararı: DevOps work item bir vakaya bağlandığında Talep Türü
 * (requestType) otomatik "Hata" olarak set edilir — mevcut değer ne
 * olursa olsun ezilir (her DevOps kaydı hata/defect kabul edilir).
 *
 * Korunan invariant'lar:
 *  - Yalnızca gerçek yeni bağlantıda (mutateResult.op === 'append') çalışır.
 *  - requestType zaten 'Hata' ise no-op (gereksiz update/log yok).
 *  - Ayrı bir CaseActivity ('FieldUpdate', fieldName 'requestType') düşülür
 *    — mevcut "DevOps work item bağlandı" (DevopsLinked) kaydından AYRI.
 *  - unlinkDevops'a dokunulmadı — tek yönlü, geri alınmaz.
 *
 * Çalıştır: node scripts/smoke-devops-link-request-type-hata.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const repo = readFileSync(path.resolve(root, 'server/db/caseRepository.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(label, pattern) {
  const ok = pattern.test(repo);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

check(
  'op===append bloğunun İÇİNDE (aynı if bloğu, DevopsLinked activity ile aynı kapsam)',
  /if \(mutateResult\.op === 'append'\) \{[\s\S]{0,2000}requestType !== 'Hata'/,
);
check(
  'requestType !== \'Hata\' guard\'ı var (zaten Hata ise no-op)',
  /if \(row && row\.requestType !== 'Hata'\) \{/,
);
check(
  'requestType koşulsuz \'Hata\'ya set ediliyor (mevcut değer ezilir)',
  /data: \{\s*requestType: 'Hata',/,
);
check(
  'Ayrı CaseActivity — FieldUpdate / requestType / fromValue eski değer / toValue Hata',
  /actionType: 'FieldUpdate',\s*fieldName: 'requestType',\s*fromValue: row\.requestType,\s*toValue: 'Hata',/,
);
check(
  'Aktivite metni DevOps bağlantısına referans veriyor (ayrı, açıklayıcı)',
  /action: 'Talep Türü otomatik güncellendi \(DevOps bağlantısı\)',/,
);

// unlinkDevops fonksiyonunun requestType'a HİÇ dokunmadığını doğrula —
// satır aralığıyla izole et (bir sonraki method'a kadar), regex sınır
// eşleşmesine bağımlı olmadan.
const lines = repo.split('\n');
const unlinkStart = lines.findIndex((l) => /async unlinkDevops\(caseId, \{ workItemId, actor, allowedCompanyIds \}\) \{/.test(l));
const listStart = lines.findIndex((l) => /async listDevopsLive\(caseId, allowedCompanyIds, actorRole\) \{/.test(l));
const unlinkFound = unlinkStart >= 0 && listStart > unlinkStart;
console.log(`${unlinkFound ? '✔' : '✘'} unlinkDevops gövdesi bulundu (satır ${unlinkStart}-${listStart})`);
if (unlinkFound) pass += 1; else fail += 1;
if (unlinkFound) {
  const unlinkDevopsBody = lines.slice(unlinkStart, listStart).join('\n');
  const touchesRequestType = /requestType/.test(unlinkDevopsBody);
  console.log(`${!touchesRequestType ? '✔' : '✘'} unlinkDevops requestType'a DOKUNMUYOR (tek yönlü, geri alınmaz)`);
  if (!touchesRequestType) pass += 1; else fail += 1;
}

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
