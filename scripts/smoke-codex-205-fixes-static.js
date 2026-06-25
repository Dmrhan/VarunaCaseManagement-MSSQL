#!/usr/bin/env node
/**
 * Codex #205 review — 3 fix statik (file-content) doğrulaması.
 *
 * P1 — server/lib/imapPoller.js: client.search'e { uid: true } geçilir mi?
 * P2a — NotificationRulesPage + notificationService: 'Active' round-trip
 * P2b — App.tsx + AdminLayout: canShowAdminView + SystemAdmin self-lockout
 *
 * DB'siz çalışır; sadece source dosya içeriklerine bakar.
 */

import { readFile } from 'node:fs/promises';

let pass = 0; let fail = 0;
function ok(name) { pass++; console.log(`  ✓ ${name}`); }
function bad(name, hint) {
  fail++;
  console.log(`  ✗ ${name}${hint ? ` — ${hint}` : ''}`);
}
function expectContains(name, content, needle) {
  if (content.includes(needle)) ok(name);
  else bad(name, `bulunamadı: ${JSON.stringify(needle.slice(0, 80))}`);
}
function expectNotContains(name, content, needle) {
  if (!content.includes(needle)) ok(name);
  else bad(name, `hâlâ var: ${JSON.stringify(needle.slice(0, 80))}`);
}

(async () => {
  console.log('=== P1 — IMAP search UID modu (server/lib/imapPoller.js) ===');
  const imap = await readFile('server/lib/imapPoller.js', 'utf8');
  expectContains(
    'client.search\'e { uid: true } geçildi',
    imap,
    "client.search({ seen: false }, { uid: true })",
  );
  expectNotContains(
    'Eski sequence-mode call kalmadı',
    imap,
    'client.search({ seen: false });',
  );
  expectContains(
    'Codex #205 P1 atıf yorumu var',
    imap,
    'Codex #205 P1',
  );

  console.log('\n=== P2a — NotificationRule editor Active round-trip ===');
  const editor = await readFile('src/features/admin/NotificationRulesPage.tsx', 'utf8');
  expectContains(
    "MODE_OPTIONS'a 'Active' eklendi",
    editor,
    "{ value: 'Active' as const",
  );
  expectContains(
    "ruleMode tipi 'LogOnly' | 'Manual' | 'Active'",
    editor,
    "'LogOnly' | 'Manual' | 'Active'",
  );
  expectContains(
    "Init 'Active' mode'u korur (downgrade etmez)",
    editor,
    "initial?.mode === 'Active'",
  );

  const svc = await readFile('src/services/notificationService.ts', 'utf8');
  expectContains(
    'RuleCreateInput.mode DispatchMode tipinde (Active dahil)',
    svc,
    'mode?: DispatchMode;',
  );
  expectNotContains(
    "Eski dar tip 'LogOnly' | 'Manual' kalmadı (mode field için)",
    svc,
    "mode?: 'LogOnly' | 'Manual';",
  );

  console.log('\n=== P2b — Admin alt-menü policy + SystemAdmin self-lockout guard ===');
  const app = await readFile('src/App.tsx', 'utf8');
  expectContains(
    'App.tsx canShowAdminView fonksiyonu var',
    app,
    'canShowAdminView',
  );
  expectContains(
    "SystemAdmin için 'admin-authorization-policies' self-lockout guard",
    app,
    "key === 'admin-authorization-policies'",
  );
  expectContains(
    'AdminLayout canShowAdminView prop alır',
    app,
    'canShowAdminView={canShowAdminView}',
  );
  expectContains(
    'onSelectView öncesi canShowAdminView kontrolü',
    app,
    'if (!canShowAdminView(v)) return;',
  );

  const layout = await readFile('src/features/admin/AdminLayout.tsx', 'utf8');
  expectContains(
    'AdminLayout canShowAdminView prop tipi',
    layout,
    'canShowAdminView?: (key: AdminView) => boolean',
  );
  expectContains(
    'NAV.map içinde alt-menü filtre',
    layout,
    'visibleItems',
  );

  console.log('\n────────────────────────────────────────────────────────');
  console.log(`PASS=${pass}  FAIL=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
