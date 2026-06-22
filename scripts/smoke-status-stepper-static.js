/**
 * smoke-status-stepper-static.js
 *
 * Vaka Detay sticky header CompactStatusStepper invariant'ları (DB-bağımsız,
 * kaynak-seviye).
 *
 * Korunan invariant'lar:
 *  1) types.ts'de 3 fazlı omurga + label + phase map + reason flag export
 *  2) StatusTransitionPanel.tsx silinmedi + initialPending prop'u var
 *     (reason/closure logic parçalanmadı; aynı panel modal'da reuse ediliyor)
 *  3) CompactStatusStepper.tsx mevcut + Modal içinde StatusTransitionPanel
 *     render ediyor (parçalanma yok)
 *  4) CaseDetailPage sticky header'da CompactStatusStepper render; geniş
 *     panel render kaldırıldı
 *  5) Backend / Prisma / API endpoint değişmedi (görsel katman)
 *
 * Çalıştır:
 *   node scripts/smoke-status-stepper-static.js
 */

import { readFileSync, existsSync } from 'node:fs';
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
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

console.log('── 1) types.ts — faz omurgası + label + reason flag ──────');
{
  const t = read('src/features/cases/types.ts');
  expect('1.1 CASE_STATUS_LABELS export',
    /export const CASE_STATUS_LABELS: Record<CaseStatus, string>/.test(t), true);
  expect('1.2 CASE_STATUS_PHASES = [open, in_progress, result]',
    t.includes("CASE_STATUS_PHASES: CaseStatusPhase[] = ['open', 'in_progress', 'result']"), true);
  expect('1.3 CASE_STATUS_PHASE_MAP — 7 statü → 3 faz',
    /CASE_STATUS_PHASE_MAP[\s\S]{0,400}'Açık':\s*'open'[\s\S]{0,300}'İncelemede':\s*'in_progress'[\s\S]{0,500}'Çözüldü':\s*'result'/.test(t), true);
  expect('1.4 STATUS_REQUIRES_REASON — Çözüldü+İptal+3.parti+Eskalasyon true',
    /STATUS_REQUIRES_REASON[\s\S]{0,400}'3rdPartyBekleniyor':\s*true[\s\S]{0,200}'Eskalasyon':\s*true[\s\S]{0,200}'Çözüldü':\s*true[\s\S]{0,200}'İptalEdildi':\s*true/.test(t), true);
  expect('1.5 STATUS_REQUIRES_REASON — Açık+İncelemede+YenidenAcildi false',
    /'Açık':\s*false[\s\S]{0,100}'İncelemede':\s*false[\s\S]{0,300}'YenidenAcildi':\s*false/.test(t), true);
}

console.log('\n── 2) StatusTransitionPanel.tsx — silinmedi + initialPending ──');
{
  const p = 'src/features/cases/StatusTransitionPanel.tsx';
  expect('2.1 StatusTransitionPanel.tsx dosyası mevcut (silinmedi)',
    existsSync(path.join(REPO_ROOT, p)), true);
  const src = read(p);
  expect('2.2 initialPending prop interface\'de',
    /initialPending\?:\s*CaseStatus \| null/.test(src), true);
  expect('2.3 useState initial value initialPending ?? null',
    /useState<CaseStatus \| null>\(initialPending \?\? null\)/.test(src), true);
  expect('2.4 useEffect item.id reset initialPending fallback',
    /setPending\(initialPending \?\? null\)/.test(src), true);
  // 2.5 — reason/closure logic hala panel içinde (parçalanmadı): handleApply,
  // closure taxonomy + KB suggestion + checklist + resolutionNote/cancelReason
  // hepsi tek dosyada.
  expect('2.5 handleApply hala panel içinde',
    /async function handleApply\(\)/.test(src), true);
  expect('2.6 closure taxonomy + KB suggestion + checklist panel içinde',
    /closureTax|kbSuggestion|requiredChecklistPending/.test(src), true);
}

console.log('\n── 3) CompactStatusStepper.tsx — yeni component ──────────');
{
  const p = 'src/features/cases/CompactStatusStepper.tsx';
  expect('3.1 CompactStatusStepper.tsx mevcut',
    existsSync(path.join(REPO_ROOT, p)), true);
  const src = read(p);
  expect('3.2 export function CompactStatusStepper',
    /export function CompactStatusStepper\(/.test(src), true);
  expect('3.3 3 fazlı omurga: CASE_STATUS_PHASES map',
    /CASE_STATUS_PHASES\.map/.test(src), true);
  // 3.4 — reason zorunlu hedef için Modal + StatusTransitionPanel reuse
  expect('3.4 Modal içinde StatusTransitionPanel reuse',
    /<Modal[\s\S]{0,500}<StatusTransitionPanel[\s\S]{0,200}initialPending=\{reasonTarget\}/.test(src), true);
  // 3.5 — reason gerekmeyen hedef için doğrudan caseService.transitionStatus
  expect('3.5 direkt transitionStatus reason gerekmeyenler için',
    /caseService\.transitionStatus\(item\.id,\s*target/.test(src), true);
  // 3.6 — Reason/closure logic CompactStatusStepper'da YENİDEN YAZILMADI
  expect('3.6 reason/closure logic stepper\'da yeniden yazılmadı (no resolutionNote handling)',
    /resolutionNote\s*=|closureRcg|kbSuggestion/.test(src), false);
  // 3.7 — Tek "Durumu değiştir ▾" ghost link (border yok; ghost text-slate-600)
  expect('3.7 "Durumu değiştir" ghost link (border yok)',
    /text-slate-600 hover:text-slate-900[\s\S]{0,400}Durumu değiştir/.test(src), true);
  // 3.7b — border-md/rounded-md/border class'ları "Durumu değiştir" çevresinde YOK
  expect('3.7b ghost — Durumu değiştir butonunda border-md/rounded-md class yok',
    /rounded-md border[\s\S]{0,200}Durumu değiştir/.test(src), false);
  // 3.8 — Popover import + role="menu"
  expect('3.8 Popover import + role="menu"',
    src.includes("import { Popover }") && src.includes('role="menu"'), true);
  // 3.9 — Fiil etiket map (Çöz / Beklemeye al / Eskale et / İptal et)
  expect('3.9 STATUS_VERB_LABELS map (fiil etiketleri)',
    /STATUS_VERB_LABELS: Record<CaseStatus, string>[\s\S]{0,600}'Eskalasyon':\s*'Eskale et'[\s\S]{0,200}'Çözüldü':\s*'Çöz'[\s\S]{0,200}'İptalEdildi':\s*'İptal et'/.test(src), true);
  // 3.10 — Menüde STATUS_VERB_LABELS kullanılıyor (durum adı değil)
  expect('3.10 menü içinde STATUS_VERB_LABELS[target] render ediliyor',
    /STATUS_VERB_LABELS\[target\]/.test(src), true);
  // 3.11 — STATUS_VISUAL dotColor field'ı + 5 farklı dot rengi (ek kriter 1)
  expect('3.11 STATUS_VISUAL dotColor: bg-amber-500 (İncelemede)',
    /'İncelemede':[\s\S]{0,200}dotColor:\s*'bg-amber-500'/.test(src), true);
  expect('3.12 STATUS_VISUAL dotColor: bg-slate-400 (3rdPartyBekleniyor)',
    /'3rdPartyBekleniyor':[\s\S]{0,200}dotColor:\s*'bg-slate-400'/.test(src), true);
  expect('3.13 STATUS_VISUAL dotColor: bg-rose-500 (Eskalasyon)',
    /'Eskalasyon':[\s\S]{0,200}dotColor:\s*'bg-rose-500'/.test(src), true);
  expect('3.14 STATUS_VISUAL dotColor: bg-violet-500 (YenidenAcildi)',
    /'YenidenAcildi':[\s\S]{0,200}dotColor:\s*'bg-violet-500'/.test(src), true);
  // 3.15 — Aktif faz dot rengi activeVisual.dotColor'dan gelir (sabit amber DEĞİL)
  expect('3.15 aktif faz dot rengi activeVisual.dotColor',
    /isCurrent\s*\?\s*activeVisual\.dotColor/.test(src), true);
  // 3.16 — subStatusNote (alt-durum metni) field'ı tanımlı + render
  expect('3.16 subStatusNote: "3. parti · SLA durdu"',
    src.includes("subStatusNote: '3. parti · SLA durdu'"), true);
  expect('3.17 subStatusNote: "Eskale Edildi" (LBD A9 hizalı)',
    src.includes("subStatusNote: 'Eskale Edildi'"), true);
  expect('3.18 alt-durum notu render — activeVisual.subStatusNote',
    /const subStatusNote = activeVisual\.subStatusNote/.test(src), true);
  // 3.19 — Tamamlanan etiket sönük (text-slate-400) — rötuş
  expect('3.19 tamamlanan etiket sönük (rötuş — text-slate-400 fallthrough)',
    /isCurrent[\s\S]{0,200}font-medium text-slate-900[\s\S]{0,200}'text-slate-400/.test(src), true);
  // 3.20 — Menü seçimi → reason modal akışı (ek kriter 2)
  // handleClick: STATUS_REQUIRES_REASON true ise setReasonTarget(target) çağrılır;
  // panel reasonTarget initialPending={reasonTarget} compactMode prop'larıyla mount edilir.
  expect('3.20 handleClick setReasonTarget(target) for reason-required',
    /if \(STATUS_REQUIRES_REASON\[target\]\)\s*\{[\s\S]{0,200}setReasonTarget\(target\)/.test(src), true);
  expect('3.21 Modal panel initialPending={reasonTarget} + compactMode',
    /<StatusTransitionPanel[\s\S]{0,300}initialPending=\{reasonTarget\}[\s\S]{0,100}compactMode/.test(src), true);
}

console.log('\n── 4) CaseDetailPage — sticky header wiring ──────────────');
{
  const src = read('src/features/cases/CaseDetailPage.tsx');
  expect('4.1 CompactStatusStepper import',
    src.includes("import { CompactStatusStepper } from './CompactStatusStepper'"), true);
  expect('4.2 CompactStatusStepper içerik bandında render (header DEĞİL)',
    /<CompactStatusStepper item=\{item\} onApplied=\{setItem\}/.test(src), true);
  // 4.3 — Geniş panel render gövdede kaldırıldı (sadece comment kaldı)
  expect('4.3 <StatusTransitionPanel JSX gövdede yok',
    /<StatusTransitionPanel/.test(src), false);
  // 4.4 — Sticky header'daki StatusPill kaldırıldı (stepper onun yerini aldı)
  expect('4.4 sticky header StatusPill\'i CompactStepper ile değiştirildi',
    /\{\/\* StatusPill artık görsel\/display-only/.test(src), false);
  // 4.5 — LBD-Move: stepper artık <header> içinde değil; <main> içinde
  // sekme nav'ından ÖNCE render edilir (içerik bandı).
  // Pattern: stepper band → sekme nav (sticky top-0) — bu sırayla bulunmalı.
  const stepperIdx = src.indexOf('<CompactStatusStepper item={item} onApplied={setItem}');
  const tabNavIdx = src.indexOf('<nav className="sticky top-0 z-10 flex shrink-0 gap-1 border-b');
  expect('4.5 stepper içerik bandı, sekme nav\'ından önce',
    stepperIdx > 0 && tabNavIdx > 0 && stepperIdx < tabNavIdx, true);
  // 4.6 — Header'daki eski statü satırı (<div className="mt-1.5 flex flex-wrap items-center gap-x-4 ...) artık yok
  expect('4.6 header gövdesinde statü satırı kalmadı',
    /<CaseTitleEditable[\s\S]{0,300}flex flex-wrap items-center gap-x-4[\s\S]{0,200}<CompactStatusStepper/.test(src), false);
}

console.log('\n── 4b) Header sade — müşteri pill kaldırıldı + metadata sönük ──');
{
  const src = read('src/features/cases/CaseDetailPage.tsx');
  // 4b.1 — Header'daki müşteri butonu kaldırıldı (breadcrumb + sol panelde zaten var)
  expect('4b.1 header onShowCustomer ile müşteri butonu render edilmiyor',
    /onShowCustomer && \(\s*\n\s*<button[\s\S]{0,200}onShowCustomer\(item\.accountId\)/.test(src), false);
  // 4b.2 — Öncelik · Tip tek sönük satır (label prefix yok)
  expect('4b.2 metadata tek sönük satır "Orta · Genel Destek" pattern',
    /CASE_PRIORITY_LABELS\[item\.priority\]\}\s*·\s*\{CASE_TYPE_LABELS\[item\.caseType\]\}/.test(src), true);
  // 4b.3 — SLA İhlali artık inline rose dot + "SLA aşıldı" (Badge component yok)
  expect('4b.3 SLA aşıldı inline rose dot + text',
    /text-rose-600[\s\S]{0,400}bg-rose-500[\s\S]{0,400}SLA aşıldı/.test(src), true);
  // 4b.4 — Adım-1 sonrası metadata layout değişti; ml-auto artık KpiSummaryStrip
  // içinde watcher için kullanılıyor. Status bandı kimliği (Öncelik · Tip)
  // wideConnectors flex-1 ile otomatik sağa düşer.
  expect('4b.4 LBD-B regression: kimlik metadata satırı status bandında var',
    /CASE_PRIORITY_LABELS\[item\.priority\]\}\s*·\s*\{CASE_TYPE_LABELS\[item\.caseType\]\}/.test(src), true);
  // 4b.5 — Header import: PriorityBadge + CaseTypeBadge artık import edilmiyor
  expect('4b.5 PriorityBadge / CaseTypeBadge artık CaseDetailPage\'de import yok',
    /CaseTypeBadge,\s*PriorityBadge/.test(src), false);
  // 4b.6 — LBD-Move sonrası header'daki "mt-1.5 flex flex-wrap..." satırı
  // kaldırıldı; statü bandı içerik alanına taşındı.
  expect('4b.6 header gövdesinde statü/metadata flex satırı yok',
    /mt-1\.5 flex flex-wrap items-center gap-x-4 gap-y-2/.test(src), false);
}

console.log('\n── 4c) Modal akışı — 7 kart grid kaldırıldı (compactMode) ──');
{
  const panel = read('src/features/cases/StatusTransitionPanel.tsx');
  // 4c.1 — compactMode prop interface'de tanımlı
  expect('4c.1 compactMode?: boolean prop',
    /compactMode\?:\s*boolean/.test(panel), true);
  // 4c.2 — function arg'da default false
  expect('4c.2 compactMode = false default arg',
    /compactMode = false/.test(panel), true);
  // 4c.3 — !compactMode header (Statü Geçişi başlığı + "Şu an" badge) guard'lı
  expect('4c.3 !compactMode header conditional render',
    /\{!compactMode && \([\s\S]{0,200}Statü Geçişi/.test(panel), true);
  // 4c.4 — !compactMode 7 kart grid'i conditional render
  expect('4c.4 !compactMode 7 kart grid conditional render',
    /\{!compactMode && \(\s*\n\s*<div className="grid grid-cols-2/.test(panel), true);

  // 4c.5 — Stepper Modal'da compactMode pass ediyor
  const stepper = read('src/features/cases/CompactStatusStepper.tsx');
  expect('4c.5 CompactStatusStepper Modal compactMode pass ediyor',
    /<StatusTransitionPanel[\s\S]{0,300}compactMode[\s\S]{0,100}initialPending=\{reasonTarget\}|<StatusTransitionPanel[\s\S]{0,200}initialPending=\{reasonTarget\}[\s\S]{0,100}compactMode/.test(stepper), true);
}

console.log('\n── 4d) LBD PR-A — sol panel sakinleştirme (A6/A7/A12) ────');
{
  const src = read('src/features/cases/CaseDetailPage.tsx');

  // A6 — WatchersPanel Agent rolünde gizli; diğer rollerde görünür
  expect('4d.1 WatchersPanel userRole !== "Agent" guard',
    /userRole !== 'Agent' && \(\s*\n?\s*<WatchersPanel/.test(src), true);
  expect('4d.2 LeftPanel userRole prop tanımı (string optional)',
    /userRole\?:\s*string/.test(src), true);
  expect('4d.3 LeftPanel caller userRole={user?.role}',
    /userRole=\{user\?\.role\}/.test(src), true);

  // A7 — Hızlı Aksiyonlar PanelSection kaldırıldı
  expect('4d.4 "Hızlı Aksiyonlar" PanelSection sol panelde yok',
    /PanelSection title="Hızlı Aksiyonlar"/.test(src), false);
  // A7 — Header'da Çağrı Başlat + Devret + Durum Raporu hala var
  expect('4d.5 header: "Çağrı Başlat" butonu',
    /Çağrı Başlat[\s\S]{0,200}handleStartCall/.test(src) || /handleStartCall[\s\S]{0,400}Çağrı Başlat/.test(src), true);
  expect('4d.6 header: "Devret" butonu',
    /Devret[\s\S]{0,200}setTransferOpen/.test(src) || /setTransferOpen[\s\S]{0,400}Devret/.test(src), true);
  // A7 — LeftPanel artık onStartCall/onTransfer/onNoteAdded/onTabFocusNote/callActive almaz
  expect('4d.7 LeftPanel onStartCall prop kalktı',
    /onStartCall:\s*\(\)\s*=>\s*void/.test(src), false);
  expect('4d.8 LeftPanel onTransfer prop kalktı',
    /onTransfer:\s*\(\)\s*=>\s*void/.test(src), false);
  // A7 — handleQuickActionAddNote kaldırıldı (caller yoktu)
  expect('4d.9 handleQuickActionAddNote silindi',
    /function handleQuickActionAddNote\(\)/.test(src), false);

  // A12 — Müşteri adı tıklanır; "Detay →" zaten bağlı (regression guard)
  expect('4d.10 müşteri adı button onOpenAccount(item.accountId)',
    /onClick=\{\(\) => onOpenAccount\(item\.accountId as string\)\}[\s\S]{0,400}\{customerContext\?\.accountName \?\? item\.accountName\}/.test(src), true);
  expect('4d.11 "Detay →" link hala bağlı (regression)',
    /onOpenAccount\(item\.accountId as string\)[\s\S]{0,400}Detay →/.test(src), true);
}

console.log('\n── 4e) LBD A9 — "Eskalasyon" → "Eskale Edildi" display rename ──');
{
  // 4e.1 — Merkezi label map güncellendi
  const t = read('src/features/cases/types.ts');
  expect('4e.1 CASE_STATUS_LABELS["Eskalasyon"] = "Eskale Edildi"',
    /'Eskalasyon':\s*'Eskale Edildi'/.test(t), true);
  // 4e.2 — Enum identifier (CaseStatus type union) korundu
  expect('4e.2 CaseStatus type union "Eskalasyon" identifier korundu',
    /\|\s*'Eskalasyon'\s*$/m.test(t) || /\|\s*'Eskalasyon'\s*\n/.test(t), true);
  // 4e.3 — CASE_STATUSES array identifier korundu
  expect('4e.3 CASE_STATUSES array "Eskalasyon" identifier korundu',
    /CASE_STATUSES:\s*CaseStatus\[\]\s*=\s*\[[\s\S]{0,300}'Eskalasyon',/.test(t), true);
  // 4e.4 — STATUS_TRANSITIONS map identifier korundu
  expect('4e.4 STATUS_TRANSITIONS "Eskalasyon" identifier korundu (key + value array)',
    /'Eskalasyon':\s*\['İncelemede'/.test(t), true);

  // 4e.5 — StatusPill local STATUS_LABELS güncellendi
  const pill = read('src/components/ui/StatusPill.tsx');
  expect('4e.5 StatusPill STATUS_LABELS["Eskalasyon"] = "Eskale Edildi"',
    /'Eskalasyon':\s*'Eskale Edildi'/.test(pill), true);

  // 4e.6 — StatusTransitionPanel local STATUS_LABELS güncellendi
  const panel = read('src/features/cases/StatusTransitionPanel.tsx');
  expect('4e.6 StatusTransitionPanel STATUS_LABELS["Eskalasyon"] = "Eskale Edildi"',
    /'Eskalasyon':\s*'Eskale Edildi'/.test(panel), true);

  // 4e.7 — CasesListPage STATUS_LABELS_SHORT + team.escalation tile label
  const list = read('src/features/cases/CasesListPage.tsx');
  expect('4e.7 CasesListPage STATUS_LABELS_SHORT["Eskalasyon"] = "Eskale Edildi"',
    /'Eskalasyon':\s*'Eskale Edildi'/.test(list), true);
  expect('4e.8 CasesListPage team.escalation tile label "Eskale Edildi"',
    /tile\('team\.escalation',\s*'Eskale Edildi'/.test(list), true);

  // 4e.9 — Analytics Ops + ReportPreview tablo başlığı
  const ops = read('src/features/analytics/OperationsDashboardPage.tsx');
  expect('4e.9 OperationsDashboard STATUS_LABEL.Eskalasyon = "Eskale Edildi"',
    /Eskalasyon:\s*'Eskale Edildi'/.test(ops), true);
  expect('4e.10 OperationsDashboard tablo başlığı "Eskale Edildi"',
    />Eskale Edildi</.test(ops), true);
  const report = read('src/features/analytics/ReportPreview.tsx');
  expect('4e.11 ReportPreview <th>Eskale Edildi</th>',
    />Eskale Edildi</.test(report), true);

  // 4e.12 — My Home + CustomerPulsePanel + Stepper subStatusNote
  const myH = read('src/features/my/MyHomePage.tsx');
  expect('4e.12 MyHomePage STATUS_LABEL.Eskalasyon = "Eskale Edildi"',
    /Eskalasyon:\s*'Eskale Edildi'/.test(myH), true);
  const pulse = read('src/features/cases/components/CustomerPulsePanel.tsx');
  expect('4e.13 CustomerPulsePanel MetricChip label="Eskale Edildi"',
    /MetricChip label="Eskale Edildi"/.test(pulse), true);
  const stepper = read('src/features/cases/CompactStatusStepper.tsx');
  expect('4e.14 CompactStatusStepper subStatusNote: "Eskale Edildi"',
    /subStatusNote:\s*'Eskale Edildi'/.test(stepper), true);

  // 4e.15 — Hiçbir UI dosyasında "<>Eskalasyon<" veya "'Eskalasyon':\s*'Eskalasyon'"
  //         display kullanımı kalmadı.
  const filesToScan = [
    'src/features/cases/types.ts',
    'src/components/ui/StatusPill.tsx',
    'src/features/cases/StatusTransitionPanel.tsx',
    'src/features/cases/CasesListPage.tsx',
    'src/features/analytics/OperationsDashboardPage.tsx',
    'src/features/analytics/ReportPreview.tsx',
    'src/features/my/MyHomePage.tsx',
    'src/features/cases/components/CustomerPulsePanel.tsx',
    'src/features/cases/CompactStatusStepper.tsx',
  ];
  let leakedDisplay = 0;
  for (const f of filesToScan) {
    const s = read(f);
    // 'X': 'Eskalasyon' (label map value) kalıbı yok
    if (/'\w+':\s*'Eskalasyon'/.test(s)) leakedDisplay += 1;
    // >Eskalasyon< JSX text yok
    if (/>Eskalasyon</.test(s)) leakedDisplay += 1;
  }
  expect('4e.15 hiçbir tarama dosyasında display "Eskalasyon" string kalmadı',
    leakedDisplay, 0);
}

console.log('\n── 4f) LBD PR-B — görsel sakinleştirme baseline ──────────');
{
  const cd = read('src/features/cases/CaseDetailPage.tsx');
  const pulse = read('src/features/cases/components/CustomerPulsePanel.tsx');

  // 4f.1 — Baseline 2: ALL CAPS yok (uppercase tracking-wide pattern temizlendi)
  expect('4f.1 CaseDetailPage uppercase tracking-wide kaldırıldı',
    /uppercase tracking-wide/.test(cd), false);

  // 4f.2 — PanelSection sentence-case stil
  expect('4f.2 PanelSection h3 text-xs font-medium text-slate-500',
    /<h3 className="flex items-center gap-1\.5 text-xs font-medium text-slate-500/.test(cd), true);
  // 4f.3 — Row sentence-case stil
  expect('4f.3 Row label text-xs text-slate-500 (uppercase yok)',
    /<span className="text-xs text-slate-500 dark:text-ndark-muted">\{label\}<\/span>/.test(cd), true);

  // 4f.4 — Baseline 1 (Müşteri çip çorbası): companyName Badge tint="slate"
  // pattern artık çip değil; sönük metin satırı içinde join edilir.
  expect('4f.4 müşteri pill <Badge tint="slate">{item.companyName}</Badge> kaldırıldı',
    /<Badge tint="slate">\{item\.companyName\}<\/Badge>/.test(cd), false);
  // 4f.5 — Sönük tek satır pattern (companyName + ostalar parts.join)
  expect('4f.5 müşteri sönük satır parts.push(item.companyName)',
    /parts\.push\(item\.companyName\)/.test(cd), true);
  expect('4f.5b müşteri sönük satır return <span>{parts.join...',
    /return <span title=\{parts\.join\(' · '\)\}>\{parts\.join\(' · '\)\}<\/span>/.test(cd), true);
  // 4f.6 — Kritik priority tek vurgu (rose dot inline)
  expect('4f.6 Critical tek vurgu inline rose dot',
    /item\.priority === 'Critical'[\s\S]{0,400}bg-rose-500[\s\S]{0,200}Kritik/.test(cd), true);

  // 4f.7 — CustomerPulsePanel metricsLayout prop tanımlı
  expect('4f.7 CustomerPulsePanel metricsLayout?: "chips" | "summary"',
    /metricsLayout\?:\s*'chips' \| 'summary'/.test(pulse), true);
  // 4f.8 — summary modunda tek satır sönük metin (MetricChip JSX yok bu branch'te)
  expect('4f.8 summary mode tek satır parts.join',
    /metricsLayout === 'summary'[\s\S]{0,400}parts\.push\(`\$\{pulse\.metrics\.openCases\} açık vaka`\)/.test(pulse), true);
  // 4f.9 — CaseDetailPage CustomerPulsePanel metricsLayout="summary"
  expect('4f.9 CaseDetailPage CustomerPulsePanel metricsLayout="summary"',
    /<CustomerPulsePanel source=\{\{ kind: 'case', caseId: item\.id \}\} metricsLayout="summary"/.test(cd), true);

  // 4f.10 — Adım-1 sonrası KpiInlineTile silindi; KpiSummaryStrip tek satır
  // sönük metin pattern'iyle "henüz" italik kullanır (FCR için).
  expect('4f.10 KpiSummaryStrip "henüz" italik (FCR için)',
    /italic text-slate-400[\s\S]{0,40}>henüz</.test(cd), true);
  // 4f.11 — KpiSummaryStrip içinde "Müdahale", "Çözüm", "Y.açılma" labels
  expect('4f.11 KpiSummaryStrip Müdahale + Çözüm + Y.açılma labels',
    /Müdahale[\s\S]{0,500}Çözüm[\s\S]{0,500}Y\.açılma/.test(cd), true);
  // 4f.12 — emptyValue prop yok artık (KpiInlineTile silindi); italic + text-slate-400
  // KpiSummaryStrip'te kullanılır (henüz spanı için)
  expect('4f.12 italic text-slate-400 KpiSummaryStrip içinde',
    /italic text-slate-400/.test(cd), true);
  // 4f.13 — "—" KpiSummaryStrip render path'inde yok (comment'leri dışla)
  const stripFnStart = cd.indexOf('function KpiSummaryStrip');
  const stripFnEnd = cd.indexOf('\nfunction ', stripFnStart + 50);
  const stripBodyRaw = stripFnEnd > stripFnStart ? cd.slice(stripFnStart, stripFnEnd) : '';
  // Block + line comment'lerini striple — yorumdaki em dash false positive olmasın
  const stripBodyCode = stripBodyRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  expect('4f.13 KpiSummaryStrip render path "—" placeholder yok',
    stripBodyCode.includes('—'), false);

  // 4f.14 — A8 regression: header müşteri pill yok
  expect('4f.14 A8 regression — header müşteri pill yok',
    /onShowCustomer && \(\s*\n\s*<button[\s\S]{0,200}onShowCustomer\(item\.accountId\)/.test(cd), false);
}

console.log('\n── 4g) Adım-1 — progress bar + KPI/SLA şeridi ────────────');
{
  const stepper = read('src/features/cases/CompactStatusStepper.tsx');
  const cd = read('src/features/cases/CaseDetailPage.tsx');

  // 4g.1 — wideConnectors prop tanımlı + default false
  expect('4g.1 CompactStatusStepper wideConnectors?: boolean prop',
    /wideConnectors\?:\s*boolean/.test(stepper), true);
  expect('4g.2 wideConnectors = false default',
    /wideConnectors = false/.test(stepper), true);
  // 4g.3 — connector class wideConnectors ile flex-1 min-w
  expect('4g.3 connector flex-1 min-w-[80px] wideConnectors true',
    /wideConnectors \? 'flex-1 min-w-\[80px\]' : 'w-7'/.test(stepper), true);
  // 4g.4 — phase wrapper'a flex-1 (idx>0 + wideConnectors)
  expect('4g.4 phase wrapper flex-1 (idx>0 + wideConnectors)',
    /flex items-center \$\{wideConnectors && idx > 0 \? 'flex-1' : ''\}/.test(stepper), true);

  // 4g.5 — CaseDetailPage Status bandı CompactStatusStepper wideConnectors veriyor
  expect('4g.5 Status bandı stepper wideConnectors prop pass',
    /<CompactStatusStepper item=\{item\} onApplied=\{setItem\} wideConnectors/.test(cd), true);

  // 4g.6 — Status bandında SLA aşıldı YOK (KPI şeridine taşındı)
  const statusBandStart = cd.indexOf('Statü bandı — Adım-1');
  const statusBandEnd = cd.indexOf('KPI/SLA/tarih birleşik şeridi');
  const statusBandBlock = statusBandStart >= 0 && statusBandEnd > statusBandStart
    ? cd.slice(statusBandStart, statusBandEnd)
    : '';
  expect('4g.6 status bandında "SLA aşıldı" yok',
    statusBandBlock.includes('SLA aşıldı'), false);
  expect('4g.7 status bandında WatcherHeaderBadge yok',
    statusBandBlock.includes('WatcherHeaderBadge'), false);
  // 4g.8 — Status bandında kimlik (Öncelik · Tip) KALDI
  expect('4g.8 status bandında kimlik (Öncelik · Tip) var',
    /CASE_PRIORITY_LABELS\[item\.priority\]\}\s*·\s*\{CASE_TYPE_LABELS\[item\.caseType\]\}/.test(statusBandBlock), true);

  // 4g.9 — KpiSummaryStrip component tanımlı
  expect('4g.9 KpiSummaryStrip fonksiyonu tanımlı',
    /function KpiSummaryStrip\(\{ item, caseId \}: \{ item: Case; caseId: string \}\)/.test(cd), true);
  // 4g.10 — Eski KpiInlineRow ve KpiInlineTile silindi
  expect('4g.10 KpiInlineRow silindi',
    /function KpiInlineRow\(/.test(cd), false);
  expect('4g.11 KpiInlineTile silindi',
    /function KpiInlineTile\(/.test(cd), false);

  // 4g.12 — KpiSummaryStrip status bandının altında, tab nav'ın üstünde render
  const stripIdx = cd.indexOf('<KpiSummaryStrip');
  const tabNavIdx2 = cd.indexOf('<nav className="sticky top-0 z-10');
  expect('4g.12 KpiSummaryStrip status bandı altı + tab nav öncesi',
    stripIdx > 0 && tabNavIdx2 > 0 && stripIdx < tabNavIdx2, true);

  // 4g.13 — Detay tab içeriğinden <KpiInlineRow item={item} /> kaldırıldı
  expect('4g.13 Detay tab içinde <KpiInlineRow /> render yok',
    /<KpiInlineRow item=\{item\}/.test(cd), false);

  // 4g.14 — SLA aşıldı şeritte (KpiSummaryStrip içinde)
  const stripBlockStart = cd.indexOf('function KpiSummaryStrip');
  const stripBlock = stripBlockStart > 0 ? cd.slice(stripBlockStart, stripBlockStart + 4000) : '';
  expect('4g.14 KpiSummaryStrip içinde "SLA aşıldı" rose dot inline',
    /bg-rose-500[\s\S]{0,200}SLA aşıldı/.test(stripBlock), true);
}

console.log('\n── 4h) Adım-2 — Detay tab içerik reorder ─────────────────');
{
  const cd = read('src/features/cases/CaseDetailPage.tsx');

  // Sıra: Açıklama → Çözüm Notu → Sınıflandırma → Önceki Vakalar → Atama
  const idxAciklama = cd.indexOf('<Section title="Açıklama">');
  const idxCozumNotu = cd.indexOf('<Section title="Çözüm Notu">');
  // Adım-4 sonrası: Section variant="flat" ile sarmalandı
  const idxSiniflandirma = cd.indexOf('<Section title="Sınıflandırma"');
  // Adım-3 sonrası başlık değişti: "Müşteri geçmiş vakaları (N)" + component sarmalandı
  const idxOnceki = cd.indexOf('<PreviousCasesSection');
  // Adım-4: Atama başlığı sentence-case + variant="flat"
  const idxAtama = cd.indexOf('<Section title="Atama & eskalasyon"');

  // 4h.1 — Açıklama Detay tab içinde ilk Section
  expect('4h.1 Açıklama > 0',
    idxAciklama > 0, true);
  // 4h.2 — Çözüm Notu Açıklama'nın hemen altında
  expect('4h.2 Çözüm Notu Açıklama\'dan sonra',
    idxCozumNotu > idxAciklama, true);
  // 4h.3 — Sınıflandırma Çözüm Notu sonrası
  expect('4h.3 Sınıflandırma Çözüm Notu sonrası',
    idxSiniflandirma > idxCozumNotu, true);
  // 4h.4 — Önceki Vakalar Sınıflandırma sonrası
  expect('4h.4 Önceki Vakalar Sınıflandırma sonrası',
    idxOnceki > idxSiniflandirma, true);
  // 4h.5 — Atama Önceki Vakalar sonrası
  expect('4h.5 Atama Önceki Vakalar sonrası',
    idxAtama > idxOnceki, true);

  // 4h.6 — Eski "Müşteri & Sınıflandırma" başlığı yok
  expect('4h.6 "Müşteri & Sınıflandırma" başlığı kalktı',
    /Section title="Müşteri & Sınıflandırma"/.test(cd), false);

  // 4h.7 — Sınıflandırma içinde Şirket/Müşteri row'u yok
  const sinSec = idxSiniflandirma > 0 ? cd.slice(idxSiniflandirma, idxSiniflandirma + 3000) : '';
  expect('4h.7 Sınıflandırma içinde "Şirket" label\'lı row yok',
    /\{ label: 'Şirket', node:/.test(sinSec), false);
  expect('4h.8 Sınıflandırma içinde "Müşteri" label\'lı row yok',
    /\{ label: 'Müşteri', node:/.test(sinSec), false);

  // 4h.9 — Bağımsız "SLA & Tarihler" Section silindi
  expect('4h.9 "SLA & Tarihler" Section kaldırıldı',
    /Section title="SLA & Tarihler"/.test(cd), false);

  // 4h.10 — Çözüm Notu yeni stil (sol şerit + nötr bg, emerald-50 dolgu yok)
  const cozumSec = idxCozumNotu > 0 ? cd.slice(idxCozumNotu, idxCozumNotu + 600) : '';
  expect('4h.10 Çözüm Notu border-l-2 border-emerald-400 (sol şerit)',
    /border-l-2 border-emerald-400/.test(cozumSec), true);
  expect('4h.11 Çözüm Notu full emerald-50 dolgu yok (nötr bg)',
    /bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200/.test(cozumSec), false);
  // 4h.12 — boşsa render yok (item.resolutionNote conditional)
  expect('4h.12 Çözüm Notu conditional render (item.resolutionNote && ...)',
    /\{item\.resolutionNote && \(\s*\n?\s*<Section title="Çözüm Notu">/.test(cd), true);

  // 4h.13 — ResolutionApprovalCard + CommunicationDispatchCard Atama'dan sonra
  // (kalan koşullu bloklar grubunda)
  const idxApproval = cd.indexOf('<ResolutionApprovalCard');
  const idxDispatch = cd.indexOf('<CommunicationDispatchCard');
  expect('4h.13 ResolutionApprovalCard Atama\'dan sonra',
    idxApproval > idxAtama, true);
  expect('4h.14 CommunicationDispatchCard ResolutionApprovalCard\'dan sonra',
    idxDispatch > idxApproval, true);

  // 4h.15 — DetailGrid function silindi (kullanılan caller kalmadı)
  expect('4h.15 DetailGrid function silindi (unused)',
    /function DetailGrid\(/.test(cd), false);
}

console.log('\n── 4i) Adım-3 — Müşteri geçmiş vakaları tam liste ────────');
{
  const cd = read('src/features/cases/CaseDetailPage.tsx');

  // 4i.1 — PreviousCasesSection local component tanımlı
  expect('4i.1 PreviousCasesSection fonksiyonu tanımlı',
    /function PreviousCasesSection\(\{[\s\S]{0,300}previousCases,[\s\S]{0,200}currentCaseId,/.test(cd), true);

  // 4i.2 — Başlık "Müşteri geçmiş vakaları (N)"
  expect('4i.2 Section title "Müşteri geçmiş vakaları (${totalCount})"',
    /<Section title=\{`Müşteri geçmiş vakaları \(\$\{totalCount\}\)`\}>/.test(cd), true);

  // 4i.3 — Mevcut vakayı filtrele (c.id !== currentCaseId)
  expect('4i.3 mevcut vaka filtrelendi: c.id !== currentCaseId',
    /\.filter\(\(c\) => c\.id !== currentCaseId\)/.test(cd), true);

  // 4i.4 — En yeni üstte sort (resolvedAt ?? updatedAt DESC)
  expect('4i.4 sıralama refDate DESC (en yeni üstte)',
    /\.sort\(\(a, b\) => refDate\(b\) - refDate\(a\)\)/.test(cd), true);

  // 4i.5 — Varsayılan ilk 10 (showAll ? sorted : sorted.slice(0, 10))
  expect('4i.5 varsayılan ilk 10 (sorted.slice(0, 10))',
    /showAll \? sorted : sorted\.slice\(0, 10\)/.test(cd), true);

  // 4i.6 — "Hepsini gör (N)" / "Daha az göster" toggle
  expect('4i.6 "Hepsini gör (N)" toggle',
    /Hepsini gör \(\$\{totalCount\}\)/.test(cd), true);
  expect('4i.7 "Daha az göster" toggle off',
    /Daha az göster/.test(cd), true);

  // 4i.8 — Açık listede max-h scroll
  expect('4i.8 açık listede max-h scroll (max-h-[480px] overflow-y-auto)',
    /max-h-\[480px\] overflow-y-auto/.test(cd), true);

  // 4i.9 — Boş durumda worded empty (placeholder "—" yok)
  expect('4i.9 boş durumda "Bu müşterinin başka vakası yok"',
    cd.includes('Bu müşterinin başka vakası yok'), true);

  // 4i.10 — Yeni fetch eklenmedi — previousCases reuse (parent state)
  // PreviousCasesSection findByAccount çağırmaz (yalnız parent'tan prop alır)
  const psStart = cd.indexOf('function PreviousCasesSection');
  const psEnd = cd.indexOf('\nfunction ', psStart + 50);
  const psBody = psEnd > psStart ? cd.slice(psStart, psEnd) : '';
  expect('4i.10 PreviousCasesSection findByAccount çağırmıyor (no new fetch)',
    /findByAccount/.test(psBody), false);

  // 4i.11 — "Aç →" link her satırda
  expect('4i.11 satır içinde "Aç →" link',
    psBody.includes('Aç →'), true);

  // 4i.12 — Eski slice(0, 3) özet liste konum yok
  expect('4i.12 eski "Önceki Vakalar" başlığı kaldırıldı',
    /<Section title=\{`Önceki Vakalar \(\$\{previousCases\.length\}\)`\}>/.test(cd), false);

  // 4i.13 — Sol panel "Müşteri Durumu" özeti (CustomerPulsePanel) hala render
  // (regresyon yok — sol panelde additive özet)
  expect('4i.13 sol panel CustomerPulsePanel metricsLayout="summary" hala render',
    /<CustomerPulsePanel source=\{\{ kind: 'case', caseId: item\.id \}\} metricsLayout="summary"/.test(cd), true);
}

console.log('\n── 4j) Adım-4 — Sınıflandırma + Atama PR-B baseline tutarlılığı ──');
{
  const cd = read('src/features/cases/CaseDetailPage.tsx');

  // 4j.1 — Section component'inde variant prop tanımlı (default 'card')
  expect('4j.1 Section variant?: "card" | "flat"',
    /variant\?:\s*'card' \| 'flat'/.test(cd), true);
  // 4j.2 — Section flat variant ringless
  expect('4j.2 Section flat → pt-1 (ringless)',
    /variant === 'flat'\s*\?\s*'pt-1'/.test(cd), true);
  // 4j.3 — Section başlığı text-slate-500 (PR-B baseline)
  expect('4j.3 Section h3 text-slate-500',
    /<h3 className="mb-2 text-xs font-medium text-slate-500/.test(cd), true);

  // 4j.4 — EditableGrid variant prop
  expect('4j.4 EditableGrid variant?: "card" | "flat"',
    /variant\?:\s*'card' \| 'flat'/.test(cd) &&
    /function EditableGrid\(\{[\s\S]{0,200}variant/.test(cd), true);
  // 4j.5 — EditableGrid flat: ringless (rounded-md ring-1 yok)
  expect('4j.5 EditableGrid flat ringless dl class',
    /variant === 'flat'\s*\?\s*'grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2'/.test(cd), true);

  // 4j.6 — Sınıflandırma Section variant="flat"
  expect('4j.6 Sınıflandırma Section variant="flat"',
    /<Section title="Sınıflandırma" variant="flat">/.test(cd), true);
  // 4j.7 — Sınıflandırma EditableGrid variant="flat"
  expect('4j.7 Sınıflandırma EditableGrid variant="flat"',
    /<Section title="Sınıflandırma" variant="flat">\s*\n\s*<EditableGrid\s*\n\s*variant="flat"/.test(cd), true);
  // 4j.8 — Atama Section variant="flat" + sentence-case başlık ("Atama & eskalasyon")
  expect('4j.8 Atama Section variant="flat" + sentence-case başlık',
    /<Section title="Atama & eskalasyon" variant="flat">/.test(cd), true);
  // 4j.9 — Atama EditableGrid variant="flat"
  expect('4j.9 Atama EditableGrid variant="flat"',
    /<Section title="Atama & eskalasyon" variant="flat">\s*\n\s*<EditableGrid\s*\n\s*variant="flat"/.test(cd), true);

  // 4j.10 — Atanan Takım/Kişi renderDisplay'lerinde "Atanmadı" worded empty italic
  expect('4j.10 Atanan Takım/Kişi renderDisplay worded empty "Atanmadı" italic',
    /italic text-slate-400">Atanmadı</.test(cd), true);
  // 4j.11 — Vaka Sahibi worded empty
  expect('4j.11 Vaka Sahibi renderDisplay worded empty "Atanmadı"',
    /title="Otomatik atanır">Atanmadı</.test(cd), true);

  // 4j.12 — Eski "Atama & Eskalasyon" (Title Case) başlığı kalmadı
  expect('4j.12 eski "Atama & Eskalasyon" başlığı kalktı (sentence-case)',
    /<Section title="Atama & Eskalasyon">/.test(cd), false);
}

console.log('\n── 4k) Codex P2 — Vazgeç modal kapanır (compactMode) ─────');
{
  const panel = read('src/features/cases/StatusTransitionPanel.tsx');
  const stepper = read('src/features/cases/CompactStatusStepper.tsx');

  // 4k.1 — StatusTransitionPanel onCancel?: prop tanımlı
  expect('4k.1 onCancel?: () => void prop',
    /onCancel\?:\s*\(\) => void/.test(panel), true);
  // 4k.2 — Vazgeç click setPending(null) + onCancel?.() çağırıyor
  expect('4k.2 Vazgeç handler setPending(null) + onCancel?.()',
    /setPending\(null\);[\s\S]{0,400}onCancel\?\.\(\);[\s\S]{0,400}Vazgeç/.test(panel), true);
  // 4k.3 — Stepper Modal'da onCancel={() => setReasonTarget(null)} pass ediyor
  expect('4k.3 Stepper Modal onCancel=setReasonTarget(null)',
    /onCancel=\{\(\) => setReasonTarget\(null\)\}/.test(stepper), true);
}

console.log('\n── 5) Backend / Prisma / API touch-check ─────────────────');
{
  // Bu task tamamen FE görsel katmanı; backend dosyaları değişmemeli.
  // git diff origin/dev baz alarak doğrula; CI ortamında basit kanıt için
  // bilinen backend dosyalarının değişiklik özetini kontrol et.
  // (Smoke runner branch context'inde olsa da defansif kalsın.)
  const backendKey = 'server/db/caseRepository.js';
  // Yalnız caseRepository içindeki create/transitionStatus signature stable:
  const repo = read(backendKey);
  expect('5.1 caseRepository.create signature stable',
    /async create\(input, actor\) \{/.test(repo), true);
  expect('5.2 caseRepository.transitionStatus signature stable',
    /async transitionStatus\(id, nextStatus, payload = \{\}/.test(repo), true);
  // 5.3 — STATUS_TRANSITIONS enum dokunulmadı
  const t = read('src/features/cases/types.ts');
  expect('5.3 STATUS_TRANSITIONS — 7 statü kuralı korundu',
    /STATUS_TRANSITIONS:[\s\S]{0,400}'Açık':[\s\S]{0,200}'İncelemede':[\s\S]{0,300}'Çözüldü':/.test(t), true);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
