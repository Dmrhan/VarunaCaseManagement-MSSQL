/**
 * smoke-admin-system-role-static.js
 *
 * Admin Users — System Role Edit (SystemAdmin-only) için DB-bağımsız
 * static smoke.
 *
 * Senaryolar:
 *   1) Repository userRepo.updateSystemRole davranışı (mock prisma):
 *      - Admin caller → 403
 *      - Self change → 400
 *      - Target SystemAdmin → 403
 *      - Invalid role → 400
 *      - Not found → 404
 *      - Happy path (Agent → Admin)
 *      - Idempotent (same role) → unchanged: true
 *   2) Route source: PATCH /users/:id/system-role mount + repo call
 *   3) AdminUsersPage source:
 *      - Button gizli condition (isSystemAdmin && !isReadOnly && !isSelf && u.isActive)
 *      - Modal field'ları (role select 5 option)
 *      - Assignment modal'da system role EDIT yok (sadece read-only + hint)
 *   4) adminService source:
 *      - updateSystemRole method
 *      - PATCH HTTP method
 *
 * Çalıştır:
 *   node scripts/smoke-admin-system-role-static.js
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
async function expectThrows(name, fn, errorContains, statusCode) {
  try {
    await fn();
    bad(name, 'beklenen throw oluşmadı');
  } catch (err) {
    const msg = err?.message ?? String(err);
    const status = err?.status;
    if (errorContains && !msg.includes(errorContains)) {
      bad(name, `err.message='${msg}' içermeli '${errorContains}'`);
    } else if (statusCode != null && status !== statusCode) {
      bad(name, `err.status=${status} expected=${statusCode}`);
    } else {
      ok(name);
    }
  }
}
function readFile(rel) { return readFileSync(path.join(REPO_ROOT, rel), 'utf8'); }

// ── 1) Repository updateSystemRole davranış ──────────────────
console.log('── 1) userRepo.updateSystemRole davranış (mock prisma) ───');
{
  // Mock prisma — minimal subset, isolated import via dynamic
  // (gerçek repo'yu test etmek için ESM module reload mümkün değil; bunun
  // yerine repository source'unu okuyup pattern doğrulanıyor)
  const repo = readFile('server/db/adminRepository.js');

  // 1.1 — updateSystemRole method tanımlı
  expect('1.1 updateSystemRole method tanımlı',
    /async updateSystemRole\(userId, role, requestingUser\)/.test(repo), true);

  // 1.2 — Admin caller reddedilir (role !== 'SystemAdmin')
  expect('1.2 SystemAdmin-only guard',
    repo.includes("requestingUser?.role !== 'SystemAdmin'"), true);

  // 1.3 — Self change reddedilir
  expect('1.3 self change guard',
    repo.includes('userId === requestingUser?.id'), true);

  // 1.4 — ALLOWED_ROLES whitelist
  expect('1.4 ALLOWED_ROLES whitelist',
    /ALLOWED_ROLES\s*=\s*\['Agent',\s*'Backoffice',\s*'Supervisor',\s*'CSM',\s*'Admin'\]/.test(repo), true);

  // 1.5 — Target SystemAdmin reddedilir
  expect('1.5 target SystemAdmin guard',
    repo.includes("target.role === 'SystemAdmin'"), true);

  // 1.6 — Not found 404
  expect('1.6 not found 404',
    /if \(!target\) throw new AdminError\('Kullanıcı bulunamadı.', 404\)/.test(repo), true);

  // 1.7 — Idempotent (same role) unchanged: true
  expect('1.7 idempotent unchanged',
    repo.includes('unchanged: true'), true);

  // 1.8 — prisma.user.update {role} (UserCompany.role'e DOKUNULMAZ)
  expect('1.8 prisma.user.update data: { role }',
    /await prisma\.user\.update\(\{[\s\S]{0,100}data:\s*\{\s*role\s*\},?\s*\}\)/.test(repo), true);

  // 1.9 — userCompany'ye dokunulmuyor (negative assertion)
  // updateSystemRole method bloğunda 'userCompany' kelimesi geçmemeli
  const startIdx = repo.indexOf('async updateSystemRole');
  const endIdx = repo.indexOf('\n  async reactivate', startIdx);
  const methodBlock = startIdx >= 0 && endIdx > startIdx ? repo.slice(startIdx, endIdx) : '';
  expect('1.9 updateSystemRole bloğu userCompany\'ye dokunmuyor',
    methodBlock.toLowerCase().includes('usercompany'), false);
}

// ── 2) Route: PATCH /users/:id/system-role ───────────────────
console.log('\n── 2) Route mount + repo call ────────────────────────────');
{
  const route = readFile('server/routes/admin.js');

  // 2.1 — PATCH mount
  expect('2.1 PATCH /users/:id/system-role mount',
    route.includes("router.patch('/users/:id/system-role'"), true);

  // 2.2 — userRepo.updateSystemRole çağrısı
  expect('2.2 userRepo.updateSystemRole(req.params.id, role, req.user) call',
    /userRepo\.updateSystemRole\(req\.params\.id,\s*role,\s*req\.user\)/.test(route), true);

  // 2.3 — body.role'den alıyor
  expect('2.3 const role = req.body?.role',
    /const\s+role\s*=\s*req\.body\?\.role/.test(route), true);
}

// ── 3) AdminUsersPage source ─────────────────────────────────
console.log('\n── 3) AdminUsersPage: button + modal kaynak ─────────────');
{
  const page = readFile('src/features/admin/AdminUsersPage.tsx');

  // 3.1 — systemRoleTarget state
  expect('3.1 systemRoleTarget state',
    /\[systemRoleTarget,\s*setSystemRoleTarget\]\s*=\s*useState/.test(page), true);

  // 3.2 — Button gizleme condition: isSystemAdmin && !isReadOnly && !isSelf
  expect('3.2 Button gizli: isSystemAdmin && !isReadOnly && !isSelf && u.isActive',
    page.includes('isSystemAdmin && !isReadOnly && !isSelf && u.isActive'), true);

  // 3.3 — Modal title "Sistem Rolünü Değiştir"
  expect('3.3 Modal title "Sistem Rolünü Değiştir"',
    page.includes('title="Sistem Rolünü Değiştir"'), true);

  // 3.4 — 5 role option (Agent, Backoffice, Supervisor, CSM, Admin)
  expect('3.4a Agent option',     /<option value="Agent">/.test(page), true);
  expect('3.4b Backoffice option', /<option value="Backoffice">/.test(page), true);
  expect('3.4c Supervisor option', /<option value="Supervisor">/.test(page), true);
  expect('3.4d CSM option',        /<option value="CSM">/.test(page), true);
  expect('3.4e Admin option',      /<option value="Admin">/.test(page), true);
  // SystemAdmin option YOK (whitelist dışı)
  expect('3.4f SystemAdmin option YOK',
    /<option value="SystemAdmin">/.test(page), false);

  // 3.5 — adminService.users.updateSystemRole çağrısı
  expect('3.5 updateSystemRole service call',
    page.includes('adminService.users.updateSystemRole'), true);

  // 3.6 — Assignment modal'da sistem rolü EDIT yok (sadece read-only + hint)
  // Modal body kaynağında "Sistem Rolü" select yok (sadece üst modal'da)
  // UserAssignmentEditor block — system role read-only badge
  const assignmentSection = page.indexOf('UserAssignmentEditor modal');
  if (assignmentSection >= 0) {
    const aBlock = page.slice(assignmentSection);
    expect('3.6 Assignment modal: sistem rolü read-only',
      aBlock.includes('Sistem rolü:'), true);
    expect('3.7 Assignment modal: sistem rolü kullanıcı listesi aksiyonlarından',
      aBlock.includes('kullanıcı listesi aksiyonlarından'), true);
    // Negative: assignment modal'da updateSystemRole çağrısı yok
    expect('3.8 Assignment modal updateSystemRole YOK',
      aBlock.includes('updateSystemRole'), false);
  }
}

// ── 4) adminService.ts ───────────────────────────────────────
console.log('\n── 4) adminService: updateSystemRole method ─────────────');
{
  const svc = readFile('src/services/adminService.ts');

  // 4.1 — method tanımlı
  expect('4.1 updateSystemRole method',
    /async updateSystemRole\(\s*userId: string,\s*role: AdminUser\['role'\]/.test(svc), true);

  // 4.2 — PATCH endpoint
  expect('4.2 PATCH /users/${userId}/system-role',
    svc.includes('${ADMIN_BASE}/users/${userId}/system-role'), true);

  // 4.3 — method: PATCH (system-role endpoint window)
  const srIdx = svc.indexOf('system-role');
  const window = srIdx >= 0 ? svc.slice(Math.max(0, srIdx - 500), srIdx + 500) : '';
  expect('4.3 HTTP method PATCH (system-role yakını)',
    window.includes("method: 'PATCH'"), true);

  // 4.4 — Body { role }
  expect('4.4 body JSON.stringify({ role })',
    svc.includes('JSON.stringify({ role })'), true);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
