#!/usr/bin/env node
/**
 * CompactStatusStepper — 7 DAİRE-DÜĞÜM TIKLANIR stepper statik doğrulaması.
 *
 * Önceki iter: pill satırı + 3-faz omurga (bu fix'te kaldırıldı).
 * Bu iter: tek 7-düğümlü stepper — 3-faz omurganın görsel stili (daire +
 * bağlantı çizgisi + ikon + alt etiket) ile.
 *
 * REUSE: STATUS_TRANSITIONS, STATUS_REQUIRES_REASON, STATUS_VISUAL,
 * StatusTransitionPanel modal akışı, CASE_STATUS_LABELS.
 */

import { readFile } from 'node:fs/promises';

let pass = 0; let fail = 0;
function ok(name) { pass++; console.log(`  ✓ ${name}`); }
function bad(name, hint) { fail++; console.log(`  ✗ ${name}${hint ? ` — ${hint}` : ''}`); }
function expectContains(name, content, needle) {
  if (content.includes(needle)) ok(name);
  else bad(name, `bulunamadı: ${JSON.stringify(needle.slice(0, 80))}`);
}
function expectNotContains(name, content, needle) {
  if (!content.includes(needle)) ok(name);
  else bad(name, `hâlâ var: ${JSON.stringify(needle.slice(0, 80))}`);
}

(async () => {
  const src = await readFile('src/features/cases/CompactStatusStepper.tsx', 'utf8');

  console.log('=== Dropdown ve eski yapılar kaldırıldı ===');
  expectNotContains('Popover import yok', src, "from '@/components/ui/Popover'");
  expectNotContains('ChevronDown import yok', src, 'ChevronDown,');
  expectNotContains('Popover render yok', src, '<Popover');
  expectNotContains('Dropdown trigger button (aria-haspopup="menu") yok',
    src, 'aria-haspopup="menu"');
  expectNotContains('3-faz CASE_STATUS_PHASES.map kaldırıldı',
    src, 'CASE_STATUS_PHASES.map(');
  expectNotContains('CASE_STATUS_PHASE_LABELS import kaldırıldı',
    src, 'CASE_STATUS_PHASE_LABELS,');
  expectNotContains('CASE_STATUS_PHASE_MAP import kaldırıldı',
    src, 'CASE_STATUS_PHASE_MAP,');
  expectNotContains('Eski pill rounded-full px-2.5 py-1 satırı yok',
    src, 'rounded-full px-2.5 py-1 text-[11px] font-medium leading-none');

  console.log('\n=== 7 DAİRE-DÜĞÜM stepper (3-faz görsel stili reuse) ===');
  expectContains('NODE_ORDER = Object.keys(CASE_STATUS_LABELS) — 7 sıralı',
    src, 'const NODE_ORDER = Object.keys(CASE_STATUS_LABELS) as CaseStatus[]');
  expectContains('Tek <ol> 7 düğüm konteyneri',
    src, '<ol');
  expectContains('Daire düğüm boyutu h-7 w-7 rounded-full (3-faz omurga stili)',
    src, 'h-7 w-7 items-center justify-center rounded-full');
  expectContains('Yatay bağlantı çizgisi (connector h-1 flex-1)',
    src, 'h-1 flex-1 rounded-full');
  expectContains('Alt etiket (text-[11px])',
    src, "text-center text-[11px] leading-tight");
  expectContains('STATUS_VISUAL.iconLg current için (3-faz omurga aktif düğüm stili)',
    src, 'v.iconLg ?? v.icon');

  console.log('\n=== Gating ve TIKLANIR davranış ===');
  expectContains('isCurrent flag',
    src, 'const isCurrent = target === item.status;');
  expectContains('isAllowed (STATUS_TRANSITIONS reuse)',
    src, 'const isAllowed = allowed.includes(target);');
  expectContains('needsReason (STATUS_REQUIRES_REASON reuse)',
    src, 'const needsReason = STATUS_REQUIRES_REASON[target];');
  expectContains('interactive türetimi (isAllowed && !isCurrent)',
    src, 'const interactive = isAllowed && !isCurrent;');
  expectContains('handleClick guard: !interactive → no-op',
    src, 'if (!interactive) return;');
  expectContains('Button disabled: !interactive || directSubmitting',
    src, 'disabled={!interactive || !!directSubmitting}');
  expectContains('aria-disabled', src, 'aria-disabled={!interactive}');
  expectContains('aria-current="step" mevcut için (li üzerinde)',
    src, "aria-current={isCurrent ? 'step' : undefined}");

  console.log('\n=== Görsel renk-kodu + STATUS_VISUAL reuse ===');
  expectContains('current = dotColor + ring-4 (3-faz stilinde aktif düğüm)',
    src, '${v.dotColor} text-white ring-4 ${v.ringColor}');
  expectContains('allowed (interactive) = dotColor dolu + hover ring',
    src, 'hover:${v.ringColor}');
  expectContains('disallowed = dashed border + opacity-60',
    src, 'border-dashed border-slate-300');
  expectContains('Connector renk (mevcut-öncesi = emerald hafif tonu)',
    src, "idx <= currentIdx");
  expectContains('Reason ikonu yalnız interactive + needsReason için',
    src, 'interactive && needsReason');

  console.log('\n=== Responsive (dar ekran) ===');
  expectContains('overflow-x-auto', src, 'overflow-x-auto');
  expectContains('flex-1 min-w-[80px] sonraki düğümlerde',
    src, 'flex-1 min-w-[80px]');
  expectContains('shrink-0 düğüm container\'larında',
    src, 'shrink-0');

  console.log('\n=== StatusTransitionPanel modal akışı KORUNDU ===');
  expectContains('reasonTarget modal', src, 'reasonTarget && (');
  expectContains('StatusTransitionPanel reuse', src, '<StatusTransitionPanel');
  expectContains('initialPending preselect', src, 'initialPending={reasonTarget}');
  expectContains('caseService.transitionStatus reason\'sız direct path',
    src, 'caseService.transitionStatus(item.id, target, {})');

  console.log('\n=== types.ts dokunulmadı (DB enum sabit) ===');
  const types = await readFile('src/features/cases/types.ts', 'utf8');
  expectContains('STATUS_TRANSITIONS hâlâ types.ts içinde', types, 'STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]>');
  expectContains('STATUS_REQUIRES_REASON hâlâ types.ts içinde', types, 'STATUS_REQUIRES_REASON: Record<CaseStatus, boolean>');
  expectContains("'Eskalasyon' enum sabit (DB değeri)", types, "'Eskalasyon':          ['İncelemede'");
  expectContains("'Eskale Edildi' display label sabit", types, "'Eskalasyon':          'Eskale Edildi'");

  console.log('\n────────────────────────────────────────────────────────');
  console.log(`PASS=${pass}  FAIL=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
