/**
 * Rapor Studyosu Excel export'unda hücre karakter sınırı fix'i.
 *
 * Kök neden: applyFormat() 'text' tipli kolonlar için ham string'i sınırsız
 * döndürüyordu; sendXlsx() bunu doğrudan aoa_to_sheet()'e yazıyordu. Excel/
 * OOXML'in sabit hücre sınırı 32.767 karakter — aşan bir string yazılırsa
 * dosya spesifikasyona aykırı hale geliyor, Excel "onarım" isteyip hücreyi
 * bozuyor/kesip atıyor.
 *
 * Gerçek veride doğrulandı: COMP-UNIVERA'da description alanı 32.767'yi
 * aşan 14 vaka var (en uzunu UNV-1003657, 106.799 karakter); diğer 5 text
 * kolonu (resolutionNote, cancellationReason, thirdPartyNote,
 * st.aiDrafts.engineeringHandoff, st.aiDrafts.customerReplyDraft) şu an
 * risksiz ama genel bir güvenlik ağı olarak clip tüm string hücrelere
 * uygulanıyor (sadece type==='text' değil).
 *
 * Fix sadece export (Excel) yolunda — preview JSON'da 32.767 sınırı
 * geçerli değil, bu yüzden clip buildReportRows/applyFormat'a değil
 * sendXlsx()'e konuldu (böylece preview davranışı değişmiyor).
 *
 * Statik smoke: DB'ye dokunmaz, kaynak kodda beklenen desenlerin varlığını
 * kontrol eder.
 *
 * Çalıştır: node scripts/smoke-report-cell-char-limit.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

function check(label, filePath, predicate) {
  const content = readFileSync(path.resolve(root, filePath), 'utf8');
  const ok = predicate instanceof RegExp ? predicate.test(content) : predicate(content);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

check(
  'reports.js — EXCEL_CELL_MAX sabiti tanımlı (32000)',
  'server/routes/reports.js',
  /const EXCEL_CELL_MAX = 32000;/,
);
check(
  'reports.js — clipForExcelCell() 32000 üstünü kırpıp işaret ekliyor',
  'server/routes/reports.js',
  /function clipForExcelCell\(v\) \{\s*\n\s*if \(typeof v !== 'string' \|\| v\.length <= EXCEL_CELL_MAX\) return v;\s*\n\s*return v\.slice\(0, EXCEL_CELL_MAX\) \+ ' …\[kırpıldı\]';/,
);
check(
  'reports.js — sendXlsx() dataRows üretirken clipForExcelCell uyguluyor',
  'server/routes/reports.js',
  /const dataRows = rows\.map\(\(r\) => columns\.map\(\(c\) => clipForExcelCell\(r\[c\.id\]\)\)\);/,
);
check(
  'reports.js — buildReportRows/applyFormat çağrısı değişmedi (preview davranışı korunuyor)',
  'server/routes/reports.js',
  /const rows = buildReportRows\(items, columns, aggregates\);/,
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
