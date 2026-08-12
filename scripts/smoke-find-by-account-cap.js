/**
 * smoke-find-by-account-cap.js — statik guard.
 *
 * findByAccount (server/db/caseRepository.js), bir müşterinin (account)
 * tüm vakalarını tam CASE_INCLUDE (notlar/dosyalar/geçmiş/aramalar dahil)
 * ile üst sınırsız çekiyordu. Bazı ana firmalarda yüzlerce vaka var —
 * tek sorguda hepsini ağır include ile çekmek tek istekte büyük payload/
 * latency riski taşıyor (Müşterinin Diğer Vakaları paneli, Customer 360
 * kartı, Customer Search modal gibi birçok yerden çağrılıyor).
 *
 * Fix: FIND_BY_ACCOUNT_CAP (300) ile en yeni N vaka döner (orderBy
 * createdAt desc + take). Tüketiciler zaten "son N vaka" beklentisiyle
 * çalışıyor; countByAccount ayrı, hafif bir sayaç olarak zaten mevcuttu
 * ve bu fix'ten etkilenmedi.
 *
 * Çalıştır: node scripts/smoke-find-by-account-cap.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = readFileSync(path.resolve(root, 'server/db/caseRepository.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(label, pattern) {
  const ok = pattern.test(src);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

const fnStart = src.indexOf('async findByAccount(accountId, options = {}, allowedCompanyIds, securityWhere = null) {');
const fnEnd = src.indexOf('\n  },', fnStart);
const fnBody = fnStart >= 0 && fnEnd > fnStart ? src.slice(fnStart, fnEnd) : '';
console.log(`${fnBody ? '✔' : '✘'} findByAccount fonksiyon gövdesi bulundu`);
if (fnBody) pass += 1; else fail += 1;

check(
  'Cap sabiti tanımlı (FIND_BY_ACCOUNT_CAP = 300)',
  /const FIND_BY_ACCOUNT_CAP = 300;/,
);
check(
  'findMany çağrısında take: FIND_BY_ACCOUNT_CAP var',
  /take: FIND_BY_ACCOUNT_CAP,/,
);
check(
  'En yeni vakalar önce döner (orderBy createdAt desc) — cap kesintisi en eskilerden olur',
  /orderBy: \{ createdAt: 'desc' \},/,
);
check(
  'CASE_INCLUDE ve mergeSecurityWhere korunuyor (davranış aynı, sadece sınır eklendi)',
  /where: mergeSecurityWhere\(where, securityWhere\),\s*include: CASE_INCLUDE,/,
);
check(
  'countByAccount (hafif sayaç) dokunulmadı — cap ondan bağımsız',
  /async countByAccount\(accountId, options = \{\}, allowedCompanyIds, securityWhere = null\) \{/,
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
