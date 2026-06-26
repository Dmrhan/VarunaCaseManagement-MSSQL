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

console.log('\n── Codex P2: backend create resolves Person.teamId ───────');
{
  const repoSrc = readFileSync(path.join(REPO_ROOT, 'server/db/caseRepository.js'), 'utf8');

  // 6.1 — Person lookup teamId + team.name + team.companyId (Codex P2 #2)
  expect('6.1 Person lookup teamId + team.name + team.companyId select',
    /prisma\.person\.findUnique\([\s\S]{0,600}teamId:\s*true,[\s\S]{0,200}team:\s*\{\s*select:\s*\{\s*name:\s*true,\s*companyId:\s*true/.test(repoSrc), true);

  // 6.2 — personTeamMatchesCompany guard (Codex P2 #2 cross-company scope)
  expect('6.2 personTeamMatchesCompany cross-company guard',
    /const personTeamMatchesCompany =\s*!!personInfo\?\.teamId && personInfo\?\.team\?\.companyId === m\.companyId/.test(repoSrc), true);

  // 6.3 — finalAssignedTeamId cascade SADECE matchesCompany ise
  expect('6.3 finalAssignedTeamId cascade scoped by matchesCompany',
    /const finalAssignedTeamId =\s*m\.assignedTeamId \?\? \(personTeamMatchesCompany \? personInfo\.teamId : null\)/.test(repoSrc), true);
  // 6.3b — finalAssignedTeamName aynı scope
  expect('6.3b finalAssignedTeamName cascade scoped by matchesCompany',
    /const finalAssignedTeamName =\s*m\.assignedTeamName \?\? \(personTeamMatchesCompany \?/.test(repoSrc), true);

  // 6.4 — prisma.case.create assigned* alanlarında final*Team* kullanılıyor
  // (m.assignedTeamId/Name direkt yazılmıyor)
  expect('6.4 prisma.case.create assignedTeamId: finalAssignedTeamId',
    /assignedTeamId:\s*finalAssignedTeamId,\s*assignedTeamName:\s*finalAssignedTeamName/.test(repoSrc), true);

  // 6.5 — Tek Person lookup (supportLevel + teamId aynı query'de)
  // Regression guard: iki ayrı prisma.person.findUnique olmamalı create içinde
  const createBlockStart = repoSrc.indexOf('async create(input, actor)');
  const createBlockEnd = repoSrc.indexOf('\n  async ', createBlockStart + 50);
  const createBlock = createBlockEnd > createBlockStart ? repoSrc.slice(createBlockStart, createBlockEnd) : repoSrc.slice(createBlockStart);
  const personLookups = (createBlock.match(/prisma\.person\.findUnique/g) || []).length;
  expect('6.5 create() içinde tek prisma.person.findUnique',
    personLookups, 1);
}

console.log('\n── 7) Backend: Smart Ticket self-assign → Incelemede + bildirim yok ──');
{
  const repoSrc = readFileSync(path.join(REPO_ROOT, 'server/db/caseRepository.js'), 'utf8');

  // 7.1 — isSmartTicketCreate sabiti tanımlı
  expect('7.1 isSmartTicketCreate sabiti create() içinde',
    /const isSmartTicketCreate =\s*\n?\s*m\.customFields &&/.test(repoSrc), true);

  // 7.2 — isSmartTicketSelfAssigned sabiti tanımlı
  expect('7.2 isSmartTicketSelfAssigned sabiti create() içinde',
    /const isSmartTicketSelfAssigned = isSmartTicketCreate && !!m\.assignedPersonId/.test(repoSrc), true);

  // 7.3 — status koşullu: self-assigned ise Incelemede, değilse Acik
  expect('7.3 status: isSmartTicketSelfAssigned ? Incelemede : Acik',
    /status:\s*isSmartTicketSelfAssigned \? 'Incelemede' : 'Acik'/.test(repoSrc), true);

  // 7.4 — notifyAssignmentTargets create'te !isSmartTicketSelfAssigned guard'lı
  expect('7.4 notifyAssignmentTargets create\'te self-assign guard\'lı',
    /if \(!isSmartTicketSelfAssigned\)\s*\{[\s\S]{0,400}notifyAssignmentTargets\(/.test(repoSrc), true);

  // 7.5 — Klasik vaka davranışı korundu: guard sadece create'teki ilk notify'ı etkiler
  // (transitionStatus/update içindeki notifyAssignmentTargets'lar guard'sız)
  const createBlockStart = repoSrc.indexOf('async create(input, actor)');
  const createBlockEnd = repoSrc.indexOf('\n  async ', createBlockStart + 50);
  const createBlock = createBlockEnd > createBlockStart
    ? repoSrc.slice(createBlockStart, createBlockEnd)
    : repoSrc.slice(createBlockStart);
  expect('7.5 create bloğunda guard sayısı = 1',
    (createBlock.match(/if \(!isSmartTicketSelfAssigned\)/g) || []).length, 1);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
