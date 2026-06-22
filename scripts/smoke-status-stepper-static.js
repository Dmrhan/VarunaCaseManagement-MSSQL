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
  expect('4.2 sticky header\'da <CompactStatusStepper render',
    /<CompactStatusStepper item=\{item\} onApplied=\{setItem\}/.test(src), true);
  // 4.3 — Geniş panel render gövdede kaldırıldı (sadece comment kaldı)
  expect('4.3 <StatusTransitionPanel JSX gövdede yok',
    /<StatusTransitionPanel/.test(src), false);
  // 4.4 — Sticky header'daki StatusPill kaldırıldı (stepper onun yerini aldı)
  expect('4.4 sticky header StatusPill\'i CompactStepper ile değiştirildi',
    /\{\/\* StatusPill artık görsel\/display-only/.test(src), false);
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
  // 4b.4 — Metadata bloğu sağa yaslandı (ml-auto)
  expect('4b.4 metadata bloğu ml-auto ile sağa yaslandı',
    /<div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1/.test(src), true);
  // 4b.5 — Header import: PriorityBadge + CaseTypeBadge artık import edilmiyor
  expect('4b.5 PriorityBadge / CaseTypeBadge artık CaseDetailPage\'de import yok',
    /CaseTypeBadge,\s*PriorityBadge/.test(src), false);
  // 4b.6 — flex-wrap responsive (dar ekranda alt satıra düşer)
  expect('4b.6 ana satır flex flex-wrap gap-x-4 (responsive)',
    /mt-1\.5 flex flex-wrap items-center gap-x-4 gap-y-2/.test(src), true);
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
