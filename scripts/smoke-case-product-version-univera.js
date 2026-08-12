/**
 * Vakaya "Versiyon No" alanı + COMP-UNIVERA Çözüldü öncesi zorunluluk —
 * statik smoke: DB'ye dokunmaz, kaynak kodda beklenen desenlerin varlığını
 * kontrol eder.
 *
 * Spec: serbest metin, açılışta zorunlu değil, vaka detayında düzenlenebilir,
 * rapor/export kolonlarında kullanılabilir, YALNIZ COMP-UNIVERA'da Çözüldü'ye
 * geçmeden önce zorunlu (İptal Edildi muaf, diğer tenant'ları etkilemez).
 *
 * Çalıştır: node scripts/smoke-case-product-version-univera.js
 */
import { readFileSync, readdirSync } from 'node:fs';
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
  if (ok) pass += 1; else fail += 1;
}

// ── DB şeması ────────────────────────────────────────────────────
check('schema.prisma — Case.productVersion alanı (nullable, NVarChar(50))', 'prisma/schema.prisma', /productVersion String\? @db\.NVarChar\(50\)/);

// ── Migration ────────────────────────────────────────────────────
{
  const migrationsDir = path.resolve(root, 'prisma/migrations');
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.includes('case_product_version'));
  const ok = dirs.length === 1;
  console.log(`${ok ? '✔' : '✘'} prisma/migrations — case_product_version migration klasörü bulundu (${dirs.length})`);
  if (ok) pass += 1; else fail += 1;
  if (ok) {
    const sql = readFileSync(path.join(migrationsDir, dirs[0].name, 'migration.sql'), 'utf8');
    const alterOk = /ALTER TABLE \[dbo\]\.\[Case\] ADD\s*\n\s*\[productVersion\] NVARCHAR\(50\) NULL;/.test(sql);
    console.log(`${alterOk ? '✔' : '✘'} migration.sql — ALTER TABLE Case ADD productVersion NVARCHAR(50) NULL`);
    if (alterOk) pass += 1; else fail += 1;
  }
}

// ── Backend: kapanış kapısı (transitionStatus) ──────────────────
check('caseRepository.js — guard kodu: product_version_required_for_closure', 'server/db/caseRepository.js', /code: 'product_version_required_for_closure'/);
check('caseRepository.js — guard yalnız COMP-UNIVERA scope', 'server/db/caseRepository.js', /prev\.companyId === 'COMP-UNIVERA' &&\s*!prev\.productVersion &&/);
{
  const src = readFileSync(path.resolve(root, 'server/db/caseRepository.js'), 'utf8');
  const productGroupIdx = src.indexOf("code: 'product_group_required_for_closure'");
  const productVersionIdx = src.indexOf("code: 'product_version_required_for_closure'");
  const ok = productGroupIdx > 0 && productVersionIdx > productGroupIdx;
  console.log(`${ok ? '✔' : '✘'} caseRepository.js — guard sırası: product_group → product_version`);
  if (ok) pass += 1; else fail += 1;
}
{
  // Guard yalnız dbNext === 'Cozuldu' bloğunda — İptalEdildi hiç bu kod
  // yoluna girmiyor (ayrı bir 'Cozuldu' !== kontrolü İptalEdildi'yi
  // muaf tutmuyor; tüm guard'lar zaten yalnız Cozuldu'ya bağlı).
  const src = readFileSync(path.resolve(root, 'server/db/caseRepository.js'), 'utf8');
  const idx = src.indexOf("code: 'product_version_required_for_closure'");
  const before = src.slice(Math.max(0, idx - 400), idx);
  const ok = /dbNext === 'Cozuldu' &&\s*prev\.status !== 'Cozuldu' &&\s*prev\.companyId === 'COMP-UNIVERA' &&\s*!prev\.productVersion &&\s*actorObject\?\.role !== 'SystemAdmin'/.test(before);
  console.log(`${ok ? '✔' : '✘'} caseRepository.js — guard koşulları (Cozuldu + Univera + boş + SystemAdmin muaf)`);
  if (ok) pass += 1; else fail += 1;
}

// ── Backend: rapor/export kolonu ─────────────────────────────────
check('columnRegistry.js — productVersion kolonu (Versiyon No, scalar)', 'server/lib/caseReport/columnRegistry.js', /\{ id: 'productVersion', label: 'Versiyon No', category: 'classification', type: 'string', source: 'scalar', prismaField: 'productVersion' \}/);

// ── Frontend: tip ─────────────────────────────────────────────────
check('types.ts — Case.productVersion alanı', 'src/features/cases/types.ts', /productVersion\?: string \| null;/);
check('types.ts — EditableCaseField productVersion içeriyor', 'src/features/cases/types.ts', /\| 'productGroup'\s*\n\s*\| 'productVersion'/);
check('types.ts — CASE_FIELD_LABELS.productVersion = Versiyon No', 'src/features/cases/types.ts', /productVersion:\s*'Versiyon No',/);

// ── Frontend: vaka detayında düzenleme (Sınıflandırma paneli) ────
check('CaseDetailPage.tsx — InlineEdit fieldKey productVersion', 'src/features/cases/CaseDetailPage.tsx', /fieldKey="productVersion"/);
check('CaseDetailPage.tsx — onCommitDraft productVersion çağrısı', 'src/features/cases/CaseDetailPage.tsx', /onCommitDraft\('productVersion', String\(val\)\)/);
check('CaseDetailPage.tsx — Tag ikonu import edildi', 'src/features/cases/CaseDetailPage.tsx', /\bTag,/);

// ── Frontend: Versiyon No productGroupItem gibi HER ZAMAN görünür —
//    "Diğer sınıflandırma bilgileri" katlanabilir (boşsa saklanır) bölümüne
//    TABİ DEĞİL. productGroupItem'daki AYNI desen: ayrı obje (isEmpty YOK,
//    secondaryClassificationItems dizisinde DEĞİL) + kendi her-zaman-render
//    satırı.
check('CaseDetailPage.tsx — productVersionItem ayrı, her zaman görünen obje olarak tanımlı', 'src/features/cases/CaseDetailPage.tsx', /const productVersionItem = \{\s*label: 'Versiyon No', icon: Tag, node: \(/);
check('CaseDetailPage.tsx — productVersionItem render satırı (primaryClassificationItems ile aynı seviyede, filtre yok)', 'src/features/cases/CaseDetailPage.tsx', /<div key=\{productVersionItem\.label\} className="flex items-center gap-1 px-1\.5 py-0\.5">/);
{
  const src = readFileSync(path.resolve(root, 'src/features/cases/CaseDetailPage.tsx'), 'utf8');
  const secStart = src.indexOf('const secondaryClassificationItems = [');
  const secEnd = src.indexOf('\n        ];', secStart);
  const secBody = secStart >= 0 && secEnd > secStart ? src.slice(secStart, secEnd) : '';
  const ok = secBody !== '' && !/label: 'Versiyon No'/.test(secBody);
  console.log(`${ok ? '✔' : '✘'} CaseDetailPage.tsx — Versiyon No secondaryClassificationItems (boşsa-gizle listesi) İÇİNDE DEĞİL`);
  if (ok) pass += 1; else fail += 1;
}

// ── Frontend: Çözüldü öncesi FE kapısı (StatusTransitionPanel) — productGroup
//    kapısıyla aynı desen (uyarı + Uygula engeli), YALNIZ COMP-UNIVERA ──
check('StatusTransitionPanel.tsx — TextInput import edildi', 'src/features/cases/StatusTransitionPanel.tsx', /import \{ Field, Select, TextInput \} from '@\/components\/ui\/Field';/);
check('StatusTransitionPanel.tsx — productVersionGateActive tanımı', 'src/features/cases/StatusTransitionPanel.tsx', /const productVersionGateActive =/);
check('StatusTransitionPanel.tsx — kapı yalnız COMP-UNIVERA scope', 'src/features/cases/StatusTransitionPanel.tsx', /productVersionGateActive =\s*\n\s*pending === 'Çözüldü' &&\s*\n\s*item\.companyId === 'COMP-UNIVERA' &&\s*\n\s*!item\.productVersion &&/);
check('StatusTransitionPanel.tsx — SystemAdmin muaf', 'src/features/cases/StatusTransitionPanel.tsx', /!productVersionSet &&\s*\n\s*user\?\.role !== 'SystemAdmin';/);
check('StatusTransitionPanel.tsx — handleSaveProductVersion caseService.update çağrısı', 'src/features/cases/StatusTransitionPanel.tsx', /caseService\.update\(item\.id, \{ productVersion: trimmed \}\)/);
check('StatusTransitionPanel.tsx — applyDisabled productVersionGateActive kontrol ediyor', 'src/features/cases/StatusTransitionPanel.tsx', /if \(productVersionGateActive\) return true;/);
check('StatusTransitionPanel.tsx — uyarı UI bloğu render ediliyor', 'src/features/cases/StatusTransitionPanel.tsx', /Versiyon No girilmedi — bu vaka Versiyon No belirtilmeden çözülemez\./);
check('StatusTransitionPanel.tsx — başarı UI bloğu render ediliyor', 'src/features/cases/StatusTransitionPanel.tsx', /✓ Versiyon No kaydedildi:/);

console.log(`\n${pass} geçti, ${fail} başarısız.`);
if (fail > 0) process.exitCode = 1;
