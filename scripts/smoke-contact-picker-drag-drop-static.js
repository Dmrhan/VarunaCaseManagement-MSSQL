/**
 * ContactPicker Gmail-benzeri chip'ler — Faz 2: sürükle-bırak (alanlar
 * arası taşıma, self-drop koruması, dışarıdan düz metin bırakma).
 *
 * Statik smoke: DB'ye/tarayıcıya dokunmaz, kaynak kodda beklenen desenlerin
 * varlığını + Faz 1 davranışlarının KORUNDUĞUNU kontrol eder.
 *
 * Çalıştır: node scripts/smoke-contact-picker-drag-drop-static.js
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

// ── Faz 1 davranışları DOKUNULMADI ──────────────────────────────
check('Faz 1 — selectedAddresses (address bazlı seçim) hâlâ var', /const \[selectedAddresses, setSelectedAddresses\] = useState<Set<string>>\(new Set\(\)\);/);
check('Faz 1 — Ctrl\\/Cmd+C kopyalama hâlâ var', /navigator\.clipboard\.writeText\(orderedAddresses\.join\(', '\)\)/);
check('Faz 1 — çift tık düzenleme hâlâ var', /function handleChipDoubleClick/);
check('Props sözleşmesi hâlâ aynı (values/onChange/suggestions/disabled)', /values: ContactPickerValue\[\];\s*onChange: \(next: ContactPickerValue\[\]\) => void;/);

// ── Faz 2 (düzeltme) — açık kabul onayı, dropEffect'e güvenilmiyor ──
// dropEffect tek başına güvenilmezdi: chip'in text/plain payload'ı
// composer'daki BAŞKA droppable'lar (örn. RichTextEditor) tarafından da
// kabul edilebiliyordu — hiçbir ContactPicker onDrop'u çalışmadan chip
// kaynaktan silinebiliyordu. Artık silme, modül seviyeli paylaşılan bir
// "kabul edilen drag id" kümesine bağlı.
check('acceptedDragIds — modül seviyeli paylaşılan kabul kümesi', /const acceptedDragIds = new Set<string>\(\);/);
check('currentDragIdRef — bu drag işlemine özgü id (dataTransfer\'dan tekrar okunmuyor)', /const currentDragIdRef = useRef<string \| null>\(null\);/);
check('sourceIdRef / justHandledSelfDropRef KALDIRILDI (artık kullanılmıyor)', /^(?![\s\S]*sourceIdRef)(?![\s\S]*justHandledSelfDropRef)[\s\S]*$/);

// ── Faz 2 — chip dragStart/dragEnd ───────────────────────────────
check('Chip draggable={!disabled}', /draggable=\{!disabled\}/);
check('onDragStart — stopPropagation', /onDragStart=\{\(e\) => \{\s*if \(disabled\) return;\s*e\.stopPropagation\(\);/);
check('onDragStart — effectAllowed = move', /e\.dataTransfer\.effectAllowed = 'move';/);
check('onDragStart — text/plain adres', /e\.dataTransfer\.setData\('text\/plain', v\.address\);/);
check('onDragStart — application/x-varuna-contact JSON payload', /e\.dataTransfer\.setData\('application\/x-varuna-contact', JSON\.stringify\(v\)\);/);
check('onDragStart — drag id üretilip ref + dataTransfer\'a yazılıyor', /currentDragIdRef\.current = dragId;\s*e\.dataTransfer\.setData\('text\/plain', v\.address\);\s*e\.dataTransfer\.setData\('application\/x-varuna-contact', JSON\.stringify\(v\)\);\s*e\.dataTransfer\.setData\('application\/x-varuna-drag-id', dragId\);/);
check('onDragEnd — yalnız acceptedDragIds içinde varsa kaynaktan siliniyor', /if \(acceptedDragIds\.has\(dragId\)\) \{\s*acceptedDragIds\.delete\(dragId\);\s*onChange\(values\.filter\(\(_, idx\) => idx !== i\)\);/);

// ── Faz 2 — container dragOver/drop ──────────────────────────────
check('Container onDragOver — preventDefault + dropEffect=move', /onDragOver=\{\(e\) => \{\s*if \(disabled\) return;\s*e\.preventDefault\(\);\s*e\.dataTransfer\.dropEffect = 'move';/);
check('Container onDrop — disabled guard', /onDrop=\{\(e\) => \{\s*if \(disabled\) return;/);
check('onDrop — önce application/x-varuna-contact JSON okunuyor', /const contactJson = e\.dataTransfer\.getData\('application\/x-varuna-contact'\);/);
check('onDrop — JSON yoksa text/plain + parseEntry fallback', /parsed = parseEntry\(e\.dataTransfer\.getData\('text\/plain'\)\);/);
check('onDrop — dedupe kontrolü korunuyor (self-drop dahil, mevcut adres varsa eklenmez)', /const duplicate = values\.some\(\(v\) => v\.address\.toLowerCase\(\) === \(parsed as ContactPickerValue\)\.address\.toLowerCase\(\)\);\s*if \(duplicate\) return;/);
check('onDrop — geçerli + tekil ise onChange([...values, parsed]) ile eklenir', /onChange\(\[\.\.\.values, parsed\]\);/);
check('onDrop — eklendikten SONRA acceptedDragIds\'e ekleniyor (açık kabul onayı)', /const dragId = e\.dataTransfer\.getData\('application\/x-varuna-drag-id'\);\s*if \(dragId\) acceptedDragIds\.add\(dragId\);/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
