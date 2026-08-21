/**
 * Erteleme kaldırıldığında (Ertele Kaldır butonu VEYA cron otomatik
 * uyandırma) vaka artık eski statüye değil, MEVCUT statüye göre kalır.
 *
 * Kullanıcı bulgusu: bir vaka ertelenip sonra kullanıcı vakayı elle
 * İncelemede → Çözüldü'ye ilerletiyor (hâlâ ertelenmiş durumdayken).
 * Ertele Kaldır'a basınca vaka Çözüldü yerine Açık'a dönüyordu — çünkü
 * unsnoozeCase()/processSnoozeWakeups() koşulsuz olarak erteleme ANINDA
 * kaydedilmiş snoozePreviousStatus'a dönüyordu, aradaki elle yapılan
 * ilerlemeyi (İncelemede→Çözüldü) hiç görmüyordu.
 *
 * Fix: unsnoozeCase() ve processSnoozeWakeups() artık status alanına HİÇ
 * dokunmuyor — sadece snoozeUntil/snoozeReason/snoozePreviousStatus
 * temizleniyor, statü ne ise öyle kalıyor. pickRestoreStatus() helper'ı
 * artık kullanılmadığı için kaldırıldı.
 *
 * Gerçek veriyle doğrulandı (UNV-1009966 üzerinde tam senaryo — ertele →
 * ertelenmişken Çözüldü'ye ilerlet → Ertele Kaldır — sonuç: Çözüldü
 * korundu, erteleme temizlendi; vaka test sonrası orijinal haline
 * döndürüldü). Bu smoke test SADECE statik — gerçek veriye karşı bir
 * mutasyon senaryosunu her çalıştırmada tekrarlamak (canlı vaka
 * durumunu değiştirmek) uygun değil, bkz. yukarıdaki tek seferlik
 * doğrulama.
 *
 * Çalıştır: node scripts/smoke-unsnooze-preserves-status.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FILE = 'server/db/caseRepository.js';

let pass = 0;
let fail = 0;
function check(label, predicate) {
  const content = readFileSync(path.resolve(root, FILE), 'utf8');
  const ok = predicate instanceof RegExp ? predicate.test(content) : predicate(content);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

function fnBody(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + 1);
  return content.slice(start, end === -1 ? undefined : end);
}

check('pickRestoreStatus() helper kaldırılmış (artık kullanılmıyor)', (content) => !content.includes('function pickRestoreStatus'));
check('caseRepository.js hiçbir yerde pickRestoreStatus çağırmıyor', (content) => !content.includes('pickRestoreStatus('));

check('unsnoozeCase() — data objesinde "status:" anahtarı YOK (statüye dokunmuyor)', (content) => {
  const body = fnBody(content, 'async unsnoozeCase(id, actor, allowedCompanyIds)', '\n  async ');
  // update({..., data: {...}}) bloğu icinde 'status' alanina atama olmamali
  return !/data:\s*\{[^}]*\bstatus:/s.test(body);
});
check('unsnoozeCase() — snoozeUntil/snoozeReason/snoozePreviousStatus temizleniyor', (content) => {
  const body = fnBody(content, 'async unsnoozeCase(id, actor, allowedCompanyIds)', '\n  async ');
  return body.includes('snoozeUntil: null') && body.includes('snoozeReason: null') && body.includes('snoozePreviousStatus: null');
});
check('unsnoozeCase() — mevcut statüyü (exists.status) log metnine yazıyor, restored DEĞİL', (content) => {
  const body = fnBody(content, 'async unsnoozeCase(id, actor, allowedCompanyIds)', '\n  async ');
  return /const currentTr = fromDb\(\{ status: exists\.status \}\)\.status;/.test(body);
});

check('processSnoozeWakeups() — data objesinde "status:" anahtarı YOK (statüye dokunmuyor)', (content) => {
  const body = fnBody(content, 'async processSnoozeWakeups()', '\n  async ');
  return !/data:\s*\{[^}]*\bstatus:/s.test(body);
});
check('processSnoozeWakeups() — mevcut statüyü (c.status) log metnine yazıyor, restored DEĞİL', (content) => {
  const body = fnBody(content, 'async processSnoozeWakeups()', '\n  async ');
  return /const currentTr = fromDb\(\{ status: c\.status \}\)\.status;/.test(body);
});

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
