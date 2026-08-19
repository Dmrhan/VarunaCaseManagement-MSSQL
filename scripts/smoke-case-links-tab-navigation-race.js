/**
 * CaseDetailPage.tsx — LinksTab ("Bağlantılar" sekmesi) navigasyon yarışı.
 *
 * Kod-review bulgusu: LinksTab, kullanıcı case A üzerindeyken tab'i açıp bir
 * bağlantı ekleme/kaldırma isteği gönderdikten sonra, yanıt gelmeden case
 * B'ye geçerse — LinksTab unmount OLMAZ (satır ~1476'da key yok, aynı
 * CaseDetailPage instance'ı içinde item prop'u sadece değişir). addLink/
 * removeLink/reload/loadAi'nin geç gelen yanıtları, artık ekranda B
 * gösterilirken A'ya ait veriyle local state'i (links/suggestions) günceller
 * — kullanıcı B'yi görürken A'nın bağlantı listesini görebilir.
 *
 * Fix: activeIdRef deseniyle aynı (bkz. handleCommitDescription) — her
 * async çağrı başlangıcında item.id yakalanır (caseIdAtCall), yanıt
 * geldiğinde itemIdRef.current (her render'da güncellenen ref) ile
 * karşılaştırılır; farklıysa state güncellemesi UYGULANMAZ.
 *
 * Statik smoke: DB'ye/React'e dokunmaz (repo'da React test runner yok),
 * kaynak kodda beklenen guard deseninin varlığını kontrol eder.
 *
 * Çalıştır: node scripts/smoke-case-links-tab-navigation-race.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FILE = 'src/features/cases/CaseDetailPage.tsx';

let pass = 0;
let fail = 0;
function check(label, predicate) {
  const content = readFileSync(path.resolve(root, FILE), 'utf8');
  const ok = predicate instanceof RegExp ? predicate.test(content) : predicate(content);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

function linksTabBody(content) {
  const start = content.indexOf('function LinksTab({');
  const end = content.indexOf('\nfunction ', start + 1);
  return content.slice(start, end === -1 ? undefined : end);
}

check(
  'LinksTab — itemIdRef tanımlı ve her render\'da güncelleniyor',
  (content) => /const itemIdRef = useRef\(item\.id\);\s*\n\s*itemIdRef\.current = item\.id;/.test(linksTabBody(content)),
);
check(
  'reload() — caseIdAtCall yakalıyor ve setLinks öncesi guard var',
  (content) => {
    const body = linksTabBody(content);
    const fn = body.slice(body.indexOf('async function reload()'), body.indexOf('async function loadAi()'));
    return /const caseIdAtCall = item\.id;/.test(fn)
      && /if \(itemIdRef\.current !== caseIdAtCall\) return;/.test(fn)
      && fn.indexOf('if (itemIdRef.current !== caseIdAtCall) return;') < fn.indexOf('setLinks(rows);');
  },
);
check(
  'loadAi() — caseIdAtCall yakalıyor ve setSuggestions öncesi guard var',
  (content) => {
    const body = linksTabBody(content);
    const fn = body.slice(body.indexOf('async function loadAi()'), body.indexOf('useEffect(() => {\n    void reload();'));
    return /const caseIdAtCall = item\.id;/.test(fn)
      && /if \(itemIdRef\.current !== caseIdAtCall\) return;/.test(fn)
      && fn.indexOf('if (itemIdRef.current !== caseIdAtCall) return;') < fn.indexOf('setSuggestions(r.data.suggestions);');
  },
);
check(
  'addLink() — caseIdAtCall yakalıyor ve reload/toast öncesi guard var',
  (content) => {
    const body = linksTabBody(content);
    const fn = body.slice(body.indexOf('async function addLink('), body.indexOf('async function removeLink('));
    return /const caseIdAtCall = item\.id;/.test(fn)
      && /if \(itemIdRef\.current !== caseIdAtCall\) return;/.test(fn)
      && fn.indexOf('if (itemIdRef.current !== caseIdAtCall) return;') < fn.indexOf("toast({ type: 'success', message: 'Bağlantı eklendi.'");
  },
);
check(
  'removeLink() — caseIdAtCall yakalıyor ve setLinks-filter öncesi guard var',
  (content) => {
    const body = linksTabBody(content);
    const fn = body.slice(body.indexOf('async function removeLink('), body.indexOf('// Linkleri tip bazında grupla'));
    return /const caseIdAtCall = item\.id;/.test(fn)
      && /if \(itemIdRef\.current !== caseIdAtCall\) return;/.test(fn)
      && fn.indexOf('if (itemIdRef.current !== caseIdAtCall) return;') < fn.indexOf('setLinks((ls) => ls.filter');
  },
);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
