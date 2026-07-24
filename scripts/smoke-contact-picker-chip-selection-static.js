/**
 * ContactPicker Gmail-benzeri chip seçimi (Faz 1 — seçim/kopyalama/silme/
 * çift-tık-düzenleme; sürükle-bırak KAPSAM DIŞI, ayrı bir PR'da).
 *
 * Statik smoke: DB'ye/tarayıcıya dokunmaz, kaynak kodda beklenen desenlerin
 * varlığını + mevcut davranışların KORUNDUĞUNU kontrol eder.
 *
 * Çalıştır: node scripts/smoke-contact-picker-chip-selection-static.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FILE = 'src/features/cases/components/ContactPicker.tsx';
const src = readFileSync(path.resolve(root, FILE), 'utf8');

let pass = 0;
let fail = 0;
function check(label, pattern) {
  const ok = pattern.test(src);
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (ok) pass += 1; else fail += 1;
}

// ── Props sözleşmesi DEĞİŞMEDİ ──────────────────────────────────
check('Props: values/onChange/suggestions/disabled aynı imza', /values: ContactPickerValue\[\];\s*onChange: \(next: ContactPickerValue\[\]\) => void;/);
check('ContactPickerValue { address, name } backend payload formatı sabit', /export interface ContactPickerValue \{\s*address: string;\s*name: string \| null;\s*\}/);

// ── Mevcut davranışlar KORUNDU ───────────────────────────────────
check('Enter/virgül/Tab ile chip ekleme korunuyor', /e\.key === 'Enter' \|\| e\.key === ',' \|\| e\.key === 'Tab'/);
check('commit() + parseEntry()/isLikelyEmail dokunulmadı', /function parseEntry\(raw: string\): ContactPickerValue \| null/);
check('Duplicate kontrolü korunuyor', /Duplicate engelle/);
check('X butonu ile tek chip silme korunuyor (stopPropagation)', /onChange\(values\.filter\(\(_, idx\) => idx !== i\)\)/);
check('Suggestion dropdown (öneri listesi) dokunulmadı', /filteredSuggestions\.slice\(0, 8\)/);
check('Input blur\'da pending text commit ediliyor', /if \(text\.trim\(\)\) commit\(text\);/);
check('Seçim yokken input boş + Backspace ile son chip silme korunuyor', /Seçim yok — mevcut davranış: input boş \+ Backspace/);

// ── Yeni davranışlar ──────────────────────────────────────────────
check('selectedAddresses state (address bazlı, index DEĞİL)', /const \[selectedAddresses, setSelectedAddresses\] = useState<Set<string>>\(new Set\(\)\);/);
check('values değişince stale seçimler temizleniyor (useEffect)', /useEffect\(\(\) => \{\s*setSelectedAddresses\(\(prev\) => \{/);
check('Chip click — stopPropagation + input focus VERİLMİYOR', /function handleChipClick[\s\S]{0,200}e\.stopPropagation\(\);/);
check('Ctrl/Cmd+click multi-select toggle', /const multi = e\.ctrlKey \|\| e\.metaKey;/);
check('Ctrl/Cmd+C kopyalama — navigator.clipboard.writeText kullanılıyor', /navigator\.clipboard\.writeText\(orderedAddresses\.join\(', '\)\)/);
check('Kopyalama execCommand KULLANMIYOR', /^(?!.*document\.execCommand).*$/s);
check('Clipboard hatası yutuluyor (.catch)', /\.catch\(\(\) => \{/);
check('Backspace/Delete seçili chip\'leri siliyor (input\'ta pending metin yoksa)', /if \(text\.trim\(\)\) return;[\s\S]{0,50}if \(selectedAddresses\.size > 0\)/);
check('Çift tık — chip\'i values\'tan çıkarıp input\'a yazıyor (Name <addr> formatı)', /setText\(v\.name \? `\$\{v\.name\} <\$\{v\.address\}>` : v\.address\);/);
check('Container onClick boş alanda seçimi temizliyor', /setSelectedAddresses\(new Set\(\)\);\s*inputRef\.current\?\.focus\(\);/);
check('Seçili chip görsel vurgu — ring-2 ring-brand-400 bg-brand-50', /'bg-brand-50 ring-2 ring-brand-400/);
check('Chip tabIndex — doğal Tab sırasına GİRMİYOR (-1), disabled\'da undefined', /tabIndex=\{disabled \? undefined : -1\}/);

// ── disabled guard'ları ────────────────────────────────────────────
check('handleContainerKeyDown disabled guard', /const handleContainerKeyDown = \(e: React\.KeyboardEvent<HTMLDivElement>\) => \{\s*if \(disabled\) return;/);
check('handleChipClick disabled guard', /function handleChipClick\(e: React\.MouseEvent<HTMLSpanElement>, address: string\) \{\s*if \(disabled\) return;/);
check('handleChipDoubleClick disabled guard', /function handleChipDoubleClick[\s\S]{0,200}if \(disabled\) return;/);
check('Container onClick disabled guard', /if \(disabled\) return;\s*\/\/ Chip/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
