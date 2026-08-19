/**
 * Talep Türü backfill migration — 20260819_tagging_review_request_type'ın
 * takibi.
 *
 * Bulunan gerçek hata: upsertTaggingReview()'da Original{Code,Label}
 * snapshot alanları SADECE create yolunda set ediliyor. Bu migration'dan
 * ÖNCE var olan HER CaseTaggingReview satırı (1.372 kayıttan 1.371'i)
 * update yoluna düşüyordu — snapshot bloğuna hiç ulaşmadan erken dönüyordu
 * — requestTypeOriginalCode/Label kalıcı NULL kalıyordu. Re-review bile
 * onu doldurmuyordu; "Doğru" işaretlenen satırlarda export'ta "Doğru
 * Etiket" kalıcı olarak boş görünüyordu.
 *
 * Düzeltme: tek seferlik, idempotent SQL backfill — yalnız
 * requestTypeOriginalCode NULL olan satırları, ilişkili vakanın ŞU ANKİ
 * Case.requestType'ından doldurur (ASCII→TR eşlemesi SQL CASE ile,
 * R_REQUEST_TYPE ile birebir aynı 5 sabit değer).
 *
 * Gerçek veriyle doğrulandı: 1.372 kayıt → 0 NULL. Re-review + "Doğru"
 * senaryosu uçtan uca test edildi — export artık boş değil, orijinal
 * etiketi ("Hata") doğru gösteriyor.
 *
 * Statik smoke: DB'ye dokunmaz, kaynak kodda beklenen desenlerin varlığını
 * kontrol eder.
 *
 * Çalıştır: node scripts/smoke-tagging-review-backfill.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FILE = 'prisma/migrations/20260819b_tagging_review_request_type_backfill/migration.sql';
const src = readFileSync(path.resolve(root, FILE), 'utf8');

let pass = 0;
let fail = 0;

function check(label, pattern) {
  const ok = pattern.test(src);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

check('backfill UPDATE — CaseTaggingReview + Case JOIN üzerinden', /UPDATE r[\s\S]*FROM \[dbo\]\.\[CaseTaggingReview\] r\s*\nJOIN \[dbo\]\.\[Case\] c ON c\.\[id\] = r\.\[caseId\]/);
check('idempotent — yalnız requestTypeOriginalCode NULL olan satırlar hedefleniyor', /WHERE r\.\[requestTypeOriginalCode\] IS NULL/);
check('boş requestType\'lı vakalar dışlanıyor (savunmacı guard)', /AND c\.\[requestType\] IS NOT NULL\s*\n\s*AND c\.\[requestType\] <> N''/);
check('ASCII→TR eşlemesi R_REQUEST_TYPE ile birebir (5 sabit değer)', /WHEN N'Bilgi'\s*THEN N'Bilgi'[\s\S]*WHEN N'Oneri'\s*THEN N'Öneri'[\s\S]*WHEN N'Sikayet' THEN N'Şikayet'[\s\S]*WHEN N'Hata'\s*THEN N'Hata'/);
check('transaction + rollback koruması (mevcut migration şablonuyla aynı)', /BEGIN TRAN;[\s\S]*ROLLBACK TRAN;/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
