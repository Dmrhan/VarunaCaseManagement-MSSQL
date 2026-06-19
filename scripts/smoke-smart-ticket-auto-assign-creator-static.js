/**
 * smoke-smart-ticket-auto-assign-creator-static.js
 *
 * Smart Ticket'tan açılan vaka, vakayı açan kullanıcıya otomatik atanır
 * (assignedPersonId = user.personId, assignedPersonName = user.fullName).
 * Kural: user.personId yoksa (SystemAdmin/Backoffice) atama yapılmaz.
 *
 * Static smoke — kaynak-seviye invariant guard.
 *
 * Çalıştır:
 *   node scripts/smoke-smart-ticket-auto-assign-creator-static.js
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

const src = readFileSync(path.join(REPO_ROOT, 'src/features/smart-ticket/SmartTicketNewPage.tsx'), 'utf8');

console.log('── Smart Ticket auto-assign creator ──────────────────────');
{
  // 1) useAuth import + hook çağrısı
  expect('1.1 useAuth import',
    src.includes("import { useAuth } from '@/services/AuthContext'"), true);
  expect('1.2 const { user } = useAuth() çağrısı',
    /const \{ user \} = useAuth\(\);/.test(src), true);

  // 2) create payload'ında conditional spread (personId varsa)
  expect('2.1 caseService.create payload\'ında user.personId conditional spread',
    /\.\.\.\(user\?\.personId[\s\S]{0,200}assignedPersonId:\s*user\.personId[\s\S]{0,200}assignedPersonName:\s*user\.fullName/.test(src), true);

  // 3) personId yoksa atama yapılmıyor (SystemAdmin/Backoffice için no-op)
  // Tek caseService.create çağrısı bu pattern'i kullanmalı, hardcoded
  // assignedPersonId yok
  expect('3.1 hardcoded assignedPersonId yok',
    /assignedPersonId:\s*['"]/.test(src), false);

  // 4) Stage 3 transitionStatus'a assignedPersonId/Name göndermiyoruz
  // (vaka zaten Stage 1'de atandı; transition'da değişmesin)
  const transitionMatch = src.match(/transitionStatus\([\s\S]{0,500}'Çözüldü'[\s\S]{0,500}\)/);
  expect('4.1 transitionStatus çağrısında assignedPersonId yok',
    transitionMatch ? !transitionMatch[0].includes('assignedPersonId') : true, true);

  // 5) Comment: "Atanmamış" davranışı SystemAdmin için korunduğunu belgeliyor
  expect('5.1 SystemAdmin/Backoffice için Atanmamış davranışı belgeli',
    src.includes('SystemAdmin/Backoffice') && src.includes('Atanmamış'), true);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
