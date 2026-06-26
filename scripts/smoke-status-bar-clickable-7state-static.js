#!/usr/bin/env node
/**
 * CompactStatusStepper — 7-state TIKLANIR stepper statik doğrulaması.
 *
 * REUSE: STATUS_TRANSITIONS, STATUS_REQUIRES_REASON, STATUS_VISUAL,
 * StatusTransitionPanel modal akışı. Hiçbir transition logic yeniden
 * yazılmaz — gating mevcut matrislerden.
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

  console.log('=== Dropdown kaldırıldı ===');
  expectNotContains('Popover import yok', src, "from '@/components/ui/Popover'");
  expectNotContains('ChevronDown import yok', src, 'ChevronDown,');
  expectNotContains('Popover render yok', src, '<Popover');
  expectNotContains('Dropdown trigger button (aria-haspopup="menu") yok',
    src, 'aria-haspopup="menu"');

  console.log('\n=== 7-state tıklanır chip dizisi ===');
  expectContains('Object.keys(CASE_STATUS_LABELS) — 7\'sini render eder',
    src, 'Object.keys(CASE_STATUS_LABELS) as CaseStatus[]');
  expectContains('aria-label="Statü değiştir" group', src, 'aria-label="Statü değiştir"');
  expectContains('isCurrent (mevcut durum) flag',
    src, 'const isCurrent = target === item.status;');
  expectContains('isAllowed (allowed-transition matrix reuse)',
    src, 'const isAllowed = allowed.includes(target);');
  expectContains('needsReason (STATUS_REQUIRES_REASON reuse)',
    src, 'const needsReason = STATUS_REQUIRES_REASON[target];');

  console.log('\n=== Gating (geçersiz hedef tıklanamaz) ===');
  expectContains('handleClick koruma: !isAllowed || isCurrent → no-op',
    src, 'if (!isAllowed || isCurrent) return;');
  expectContains('button disabled: !isAllowed || isCurrent || directSubmitting',
    src, 'disabled={!isAllowed || isCurrent || !!directSubmitting}');
  expectContains('aria-disabled set',
    src, 'aria-disabled={!isAllowed || isCurrent}');
  expectContains('aria-current="step" mevcut için',
    src, "aria-current={isCurrent ? 'step' : undefined}");

  console.log('\n=== Görsel ayrım (current/allowed/disallowed) ===');
  expectContains('current = ring + dolu renk',
    src, 'ring-2 ${v.ringColor}');
  expectContains('allowed = renkli border + hover chipBg',
    src, 'border-current hover:${v.chipBg}');
  expectContains('disallowed = sönük gri + cursor-not-allowed',
    src, 'opacity-60');
  expectContains('reason ikonu (AlertTriangle) yalnız izinli+reason+non-current',
    src, 'isAllowed && needsReason && !isCurrent');

  console.log('\n=== StatusTransitionPanel modal akışı KORUNDU ===');
  expectContains('reasonTarget modal',
    src, 'reasonTarget && (');
  expectContains('StatusTransitionPanel reuse',
    src, '<StatusTransitionPanel');
  expectContains('initialPending preselect',
    src, 'initialPending={reasonTarget}');
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
