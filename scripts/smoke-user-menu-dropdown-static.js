/**
 * smoke-user-menu-dropdown-static.js
 *
 * User avatar dropdown menu için DB-bağımsız static smoke (kaynak-seviye).
 *
 * Senaryolar:
 *   1) App.tsx — Popover import + ChevronDown ikonu
 *   2) Standalone "Şifre Değiştir" ve "Çıkış Yap" header butonları
 *      ARTIK YOK (Popover içine taşındı)
 *   3) Popover trigger: aria-haspopup + aria-expanded + avatar/isim
 *   4) Popover içeriği: kimlik özeti (email + role) + Şifre Değiştir +
 *      Çıkış Yap menü item'ları
 *   5) Click handler'lar close() çağırıyor (modal kapanmadan trigger
 *      kalır gibi UX bug'ları engellenmiş)
 *
 * Çalıştır:
 *   node scripts/smoke-user-menu-dropdown-static.js
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
function readFile(rel) { return readFileSync(path.join(REPO_ROOT, rel), 'utf8'); }

const app = readFile('src/App.tsx');

// ── 1) Import değişiklikleri ────────────────────────────────
console.log('── 1) Import değişiklikleri ──────────────────────────────');
{
  expect('1.1 Popover import',
    app.includes("import { Popover } from './components/ui/Popover'"), true);
  expect('1.2 ChevronDown lucide import',
    /ChevronDown,\s*\n\s+Keyboard/.test(app), true);
}

// ── 2) Standalone header butonları KALDIRILDI ────────────────
console.log('\n── 2) Standalone header butonları kaldırıldı ─────────────');
{
  // Eski pattern: title="Şifre Değiştir" tooltip'i header'da standalone
  // KeyRound icon-only buton. Bu pattern artık YOK — Popover içinde label'lı.
  expect('2.1 standalone title="Şifre Değiştir" tooltip yok',
    app.includes('title="Şifre Değiştir"'), false);
  expect('2.2 standalone title="Çıkış Yap" tooltip yok',
    app.includes('title="Çıkış Yap"'), false);
  // Yeni: dropdown trigger title'ı
  expect('2.3 yeni dropdown trigger title="Kullanıcı menüsü"',
    app.includes('title="Kullanıcı menüsü"'), true);
}

// ── 3) Popover trigger: aria + dropdown affordance ───────────
console.log('\n── 3) Popover trigger: aria + affordance ────────────────');
{
  expect('3.1 aria-haspopup="menu"',
    app.includes('aria-haspopup="menu"'), true);
  expect('3.2 aria-expanded={open}',
    app.includes('aria-expanded={open}'), true);
  expect('3.3 ChevronDown rotation indicator',
    app.includes("rotate-180"), true);
}

// ── 4) Popover içeriği: kimlik + menü items ──────────────────
console.log('\n── 4) Popover içeriği: kimlik özeti + menü items ────────');
{
  // Email görüntülenir (önceden sadece avatar + name + role vardı)
  expect('4.1 user.email gösteriliyor',
    /\{user\.email\}/.test(app), true);
  // Role badge
  expect('4.2 user.role badge',
    /\{user\.role\}/.test(app), true);
  // Şifre Değiştir menü item label
  expect('4.3 "Şifre Değiştir" menü item label',
    />\s*Şifre Değiştir\s*</.test(app), true);
  // Çıkış Yap menü item label
  expect('4.4 "Çıkış Yap" menü item label',
    />\s*Çıkış Yap\s*</.test(app), true);
}

// ── 5) Click handler'lar close() çağırıyor ───────────────────
console.log('\n── 5) Menü item handlers close() çağırıyor ───────────────');
{
  // Şifre Değiştir: close(); setChangePasswordOpen(true)
  expect('5.1 Şifre Değiştir handler: close() + setChangePasswordOpen',
    /close\(\);\s*setChangePasswordOpen\(true\)/.test(app), true);
  // Çıkış Yap: close(); void signOut()
  expect('5.2 Çıkış Yap handler: close() + signOut()',
    /close\(\);\s*void signOut\(\)/.test(app), true);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
