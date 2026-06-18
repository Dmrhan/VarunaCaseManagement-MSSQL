/**
 * smoke-report-views-phase4-2-static.js
 *
 * Phase 4.2 — Saved Views UX polish kaynak-seviye static smoke.
 *
 * Senaryolar:
 *   1) Optgroup ile dropdown grouping (Kendi + Paylaşımlı)
 *   2) Owner badge (aktif görünüm için)
 *   3) Edit modal (rename + isShared + description) — sadece owner
 *   4) Kopyala button (Copy icon) — sadece başkasının paylaşımlısı için
 *   5) Description tooltip (option title attr + picker altında italic)
 *   6) State: ownViews + sharedNotOwnViews + isOwnerOfActive
 *   7) Handler'lar: openEditModal + handleEditSave + handleCopyView
 *
 * Çalıştır:
 *   node scripts/smoke-report-views-phase4-2-static.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function expect(name, actual, expected) {
  if (actual === expected || JSON.stringify(actual) === JSON.stringify(expected)) ok(name);
  else bad(name, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

const src = readFileSync(path.join(REPO_ROOT, 'src/features/reports/CaseReportStudioPage.tsx'), 'utf8');

// ── 1) Optgroup dropdown grouping ────────────────────────────
console.log('── 1) Dropdown <optgroup> grouping ───────────────────────');
{
  expect('1.1 ownViews useMemo filter (ownerId === auth.user.id)',
    /ownViews\s*=\s*useMemo\([\s\S]{0,200}v\.ownerId === auth\.user\?\.id/.test(src), true);
  expect('1.2 sharedNotOwnViews useMemo filter (!= auth + isShared)',
    /sharedNotOwnViews\s*=\s*useMemo\([\s\S]{0,200}v\.ownerId !== auth\.user\?\.id && v\.isShared/.test(src), true);
  expect('1.3 <optgroup label="Kendi Görünümlerim">',
    src.includes('<optgroup label="Kendi Görünümlerim">'), true);
  expect('1.4 <optgroup label="Paylaşımlı Görünümler (Başkalarından)">',
    src.includes('<optgroup label="Paylaşımlı Görünümler (Başkalarından)">'), true);
  // Optgroup'lar conditional render (boş ise gösterme)
  expect('1.5 conditional optgroup: ownViews.length > 0',
    src.includes('ownViews.length > 0 && ('), true);
}

// ── 2) Owner badge ───────────────────────────────────────────
console.log('\n── 2) Owner badge (aktif view için) ──────────────────────');
{
  expect('2.1 isOwnerOfActive computed',
    src.includes('const isOwnerOfActive = activeView?.ownerId === auth.user?.id'), true);
  expect('2.2 "Kendin" label (owner)',
    src.includes("'Kendin'") || src.includes('>Kendin'), true);
  expect('2.3 "Paylaşımlı" label (başkasının)',
    src.includes("'Paylaşımlı'") || src.includes('>Paylaşımlı'), true);
}

// ── 3) Edit modal (rename + isShared + description) ──────────
console.log('\n── 3) Edit modal: rename + isShared + description ───────');
{
  expect('3.1 editViewTarget state',
    /\[editViewTarget,\s*setEditViewTarget\]/.test(src), true);
  expect('3.2 openEditModal handler',
    src.includes('function openEditModal(view: ReportView)'), true);
  expect('3.3 handleEditSave handler',
    src.includes('async function handleEditSave()'), true);
  expect('3.4 reportService.updateView çağrısı',
    /reportService\.updateView\(editViewTarget\.id,\s*\{[\s\S]{0,200}isShared:\s*editForm\.isShared/.test(src), true);
  expect('3.5 Edit modal title pattern',
    src.includes('title={`Görünümü Düzenle:'), true);
  expect('3.6 Edit button sadece owner için',
    /activeView && isOwnerOfActive && \([\s\S]{0,200}openEditModal\(activeView\)/.test(src), true);
}

// ── 4) Kopyala button (sadece başkasının paylaşımlısı) ───────
console.log('\n── 4) Kopyala button (başkasının paylaşımlısı) ──────────');
{
  expect('4.1 handleCopyView handler',
    src.includes('async function handleCopyView(source: ReportView)'), true);
  expect('4.2 Copy icon import',
    /import \{[^}]*Copy[^}]*\} from 'lucide-react'/.test(src), true);
  expect('4.3 Copy button sadece !isOwnerOfActive için',
    /activeView && !isOwnerOfActive && \([\s\S]{0,200}handleCopyView\(activeView\)/.test(src), true);
  expect('4.4 Kopya isim default: "${source.name} (kopya)"',
    src.includes('${source.name} (kopya)'), true);
  // Save modal'ı önceden doldurulmuş halde açar (createView reuse)
  expect('4.5 setSaveModalOpen(true) ile reuse',
    /handleCopyView[\s\S]{0,800}setSaveModalOpen\(true\)/.test(src), true);
}

// ── 5) Description tooltip + picker altında italic ───────────
console.log('\n── 5) Description tooltip + italic preview ───────────────');
{
  // Option title attr (native browser tooltip)
  expect('5.1 <option title={v.description ?? \'\'}>',
    /<option key={v\.id} value={v\.id} title={v\.description \?\? ''}>/.test(src), true);
  // Picker altında aktif view'in description'ı italic
  expect('5.2 activeView.description italic preview',
    /activeView\?\.description &&[\s\S]{0,200}italic/.test(src), true);
}

// ── 6) Pencil + Copy icon imports ────────────────────────────
console.log('\n── 6) Icon imports ───────────────────────────────────────');
{
  expect('6.1 lucide imports: Copy, Pencil, Save, Trash2',
    /import \{ Copy, Pencil, Save, Trash2 \} from 'lucide-react'/.test(src), true);
}

// ── 7) Trash2 (Sil) sadece owner için ────────────────────────
console.log('\n── 7) Sil button sadece owner için (regression) ──────────');
{
  expect('7.1 activeView && isOwnerOfActive Trash2',
    /activeView && isOwnerOfActive && \([\s\S]{0,400}<Trash2/.test(src), true);
}

// ── 8) Codex P2 follow-up: copySource snapshot ───────────────
console.log('\n── 8) Copy uses source state (Codex P2 fix) ──────────────');
{
  // 8.1 — copySource state tanımlı
  expect('8.1 copySource state',
    /\[copySource,\s*setCopySource\]\s*=\s*useState<ReportView \| null>/.test(src), true);

  // 8.2 — handleCopyView setCopySource(source) çağırıyor
  expect('8.2 handleCopyView setCopySource(source)',
    /handleCopyView[\s\S]{0,500}setCopySource\(source\)/.test(src), true);

  // 8.3 — openSaveModal copySource'u null'a sıfırlıyor (normal save)
  expect('8.3 openSaveModal setCopySource(null)',
    /openSaveModal\(\)\s*\{[\s\S]{0,200}setCopySource\(null\)/.test(src), true);

  // 8.4 — closeSaveModal copySource'u temizliyor
  expect('8.4 closeSaveModal setCopySource(null)',
    /closeSaveModal\(\)\s*\{[\s\S]{0,200}setCopySource\(null\)/.test(src), true);

  // 8.5 — handleSaveView payload kaynaktan okur (copySource varsa)
  expect('8.5 handleSaveView columns: src ? src.columns : selectedColumnIds',
    /columns:\s*src\s*\?\s*src\.columns\s*:\s*selectedColumnIds/.test(src), true);
  expect('8.6 handleSaveView filters: src ? src.filters : filters',
    /filters:\s*src\s*\?\s*src\.filters\s*:\s*filters/.test(src), true);
  expect('8.7 handleSaveView mode: src ? src.mode : mode',
    /mode:\s*src\s*\?\s*src\.mode\s*:\s*mode/.test(src), true);
  expect('8.8 handleSaveView pivotConfig: src ? src.pivotConfig : ...',
    /pivotConfig:\s*src\s*\?\s*src\.pivotConfig/.test(src), true);

  // 8.9 — Modal title'da copy modunda kaynak adı
  expect('8.9 Modal title copy modunda kaynak görünür',
    src.includes('copySource ? `Görünüm Kopyala:'), true);

  // 8.10 — Info banner copy modunda
  expect('8.10 Info banner: "kaynak görünümün ... tam yapılandırmasını"',
    src.includes('tam yapılandırmasını'), true);

  // ── 8.11+ — Codex P2 follow-up #2: copy sonrası page state restore ──
  // 8.11 — applyViewToState helper extract edildi (DRY + reuse)
  expect('8.11 applyViewToState pure helper',
    src.includes('function applyViewToState(v: ReportView)'), true);
  // 8.12 — handleLoadView applyViewToState çağırıyor (regression)
  expect('8.12 handleLoadView reuses applyViewToState',
    /handleLoadView[\s\S]{0,400}applyViewToState\(v\)/.test(src), true);
  // 8.13 — handleSaveView copy success path applyViewToState(res.view)
  expect('8.13 copy-success path: applyViewToState(res.view)',
    src.includes('if (wasCopy) applyViewToState(res.view)'), true);
  // 8.14 — wasCopy = src != null mantığı
  expect('8.14 wasCopy = src != null',
    src.includes('const wasCopy = src != null'), true);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
