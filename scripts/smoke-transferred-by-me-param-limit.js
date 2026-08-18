/**
 * "Yönlendirdiklerim" (transferredByMeCount / listTransferredByMe) —
 * MSSQL 2100 parametre sınırı fix'i.
 *
 * Kök sebep: çok sayıda vaka devretmiş bir kullanıcı (ör. Ceren Üstkoyuncu,
 * 2.098 distinct vaka) için, önce TÜM vaka ID'leri JS'e toplanıp sonra
 * `id: { in: [...] } }` ile sayılıyor/getiriliyordu — MSSQL'in tek sorgudaki
 * azami 2100 parametre sınırını aşınca `prisma.case.count()`/`findMany()`
 * "code 8003" ile patlıyordu (canlıda gözlemlendi, 2026-08-18).
 *
 * İki ayrı çağrı noktası vardı:
 *  1) getStats() — KPI kartı sayısı (Agent 'personal' + Supervisor 'team'
 *     modu, ikisi de) — Case.transfers ilişkisi üzerinden `some:` filtresine
 *     çevrildi (ID listesi hiç materialize edilmiyor, sınır bir daha
 *     aşılamaz).
 *  2) listTransferredByMe() — karta tıklayınca açılan liste. `some:` filtresi
 *     count() için sorunu çözdü ama include: CASE_INCLUDE ile birlikte
 *     findMany()'de Prisma/SQL Server yine ID'leri materialize edip aynı
 *     duvara çarpıyordu (test edilip doğrulandı) — bu yüzden burada ID
 *     listesi 1000'lik chunk'lara bölünüp paralel sorgulanıyor.
 *
 * Gerçek veriyle doğrulandı: Ceren (2.098 vaka) artık hatasız — hem
 * getStats() (236ms, transferredByMeCount: 2098) hem listTransferredByMe()
 * (total: 2098) çalışıyor. Orta ölçekli kullanıcılarla (107-176 vaka) eski/
 * yeni sonuçlar birebir eşleşti (davranış değişmedi).
 *
 * Statik smoke: DB'ye dokunmaz, kaynak kodda beklenen desenlerin varlığını
 * kontrol eder.
 *
 * Çalıştır: node scripts/smoke-transferred-by-me-param-limit.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FILE = 'server/db/caseRepository.js';
const src = readFileSync(path.resolve(root, FILE), 'utf8');

let pass = 0;
let fail = 0;

function check(label, predicate) {
  const ok = predicate instanceof RegExp ? predicate.test(src) : predicate();
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

check(
  'getStats() — eski "transferredCaseIds" ID-toplama deseni tamamen kaldırıldı',
  (() => !/const transferredCaseIds = \(/.test(src)),
);
check(
  'getStats() — count() artık Case.transfers ilişkisi üzerinden (2 kez: personal + team modu)',
  (() => {
    const matches = src.match(/transfers: \{ some: \{ transferredBy: user\.id, companyId: \{ in: allowedCompanyIds \} \} \},\s*\n\s*companyId: \{ in: allowedCompanyIds \},/g);
    return Array.isArray(matches) && matches.length === 2;
  }),
);
check(
  'listTransferredByMe() — id: { in: [...byCase.keys()] } tek seferde YOK, chunk\'lı',
  (() => !/const where = \{ id: \{ in: \[\.\.\.byCase\.keys\(\)\] \} \};/.test(src)),
);
check(
  'listTransferredByMe() — CHUNK = 1000 ile paralel sorgulanıyor',
  /const CHUNK = 1000;[\s\S]{0,400}Promise\.all\(/,
);
check(
  'listTransferredByMe() — chunk sonuçları flat() ile birleştiriliyor',
  /const rows = chunkedRows\.flat\(\);/,
);
check(
  'listTransferredByMe() — nihai sıralama (myLastTransferAt) korunuyor, chunk sırası önemsiz',
  /items\.sort\(\(a, b\) => new Date\(b\.myLastTransferAt\)\.getTime\(\) - new Date\(a\.myLastTransferAt\)\.getTime\(\)\);/,
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
