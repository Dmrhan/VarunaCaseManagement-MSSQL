/**
 * smoke-pattern-codex-round3.js — Pattern Triage Codex round 3.
 *
 * Bulgu (P2): notify-team CaseNotification INSERT eksik.
 *   emitGenericNotification sadece ActionItem yazar; bell drawer
 *   (`/api/cases/me/notifications/unread`) `CaseNotification` tablosundan
 *   okur. Mevcut watcher_update paterni ikisini birlikte yazıyor
 *   (caseRepository:4512+); pattern notify de aynı deseni izlemeli.
 *
 * Fix (mevcut watcher paterni birebir mirror):
 *   1. `prisma.caseNotification.createMany` batch — bell drawer
 *   2. `emitGenericNotification` per-user — ActionItem/Aksiyonlarım
 *   3. Response'a bellNotifiedCount (audit şeffaflığı)
 */

import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} — actual=${actual} expected=${expected}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

const routes = read('server/routes/analytics.js');
const routesCode = strip(routes);

console.log('── 1) CaseNotification.createMany (bell drawer) ──');
expect('1.1 caseNotification.createMany batch INSERT',
  /notify-team'[\s\S]{0,8000}prisma\.caseNotification\.createMany\(\{[\s\S]{0,300}data: members\.map/.test(routesCode), true);
expect('1.2 eventType=pattern_alert_team_notify + channel=InApp',
  /caseNotification\.createMany[\s\S]{0,800}eventType: 'pattern_alert_team_notify'[\s\S]{0,300}channel: 'InApp'/.test(routesCode), true);
expect('1.3 recipient=m.id (User.id)',
  /caseNotification\.createMany[\s\S]{0,1000}recipient: m\.id/.test(routesCode), true);
expect('1.4 payload JSON.stringify (schema String; obje serialize)',
  /caseNotification\.createMany[\s\S]{0,1500}payload: JSON\.stringify\(bellPayload\)/.test(routesCode), true);
expect('1.5 bellPayload — message + alertId + category + caseCount + kind',
  /const bellPayload = \{[\s\S]{0,500}message,[\s\S]{0,200}kind: 'pattern_alert_team_notify'[\s\S]{0,200}alertId: alert\.id[\s\S]{0,300}category: alert\.category[\s\S]{0,300}caseCount: alert\.caseCount/.test(routesCode), true);

console.log('\n── 2) emitGenericNotification (ActionItem korundu) ──');
expect('2.1 emitGenericNotification per-user hâlâ çağrılıyor',
  /for \(const member of members\)[\s\S]{0,500}emitGenericNotification\(\{/.test(routesCode), true);
expect('2.2 bellPayload emitGenericNotification\'a da geçirilir (tek kaynak)',
  /emitGenericNotification\(\{[\s\S]{0,800}payload: bellPayload/.test(routesCode), true);

console.log('\n── 3) Response şeffaflığı ────────────────────────');
expect('3.1 bellNotifiedCount audit alanı',
  /bellNotifiedCount: bellCreated/.test(routesCode), true);
expect('3.2 notifiedCount (ActionItem) korundu',
  /notifiedCount,[\s\S]{0,200}totalMembers: members\.length/.test(routesCode), true);

console.log('\n── 4) Empty members guard (gereksiz sorgu yok) ──');
expect('4.1 members.length > 0 kontrolü — boş team\'de INSERT yok',
  /if \(members\.length > 0\)[\s\S]{0,500}prisma\.caseNotification\.createMany/.test(routesCode), true);

console.log('\n── 5) Regresyon — round 1+2 fix\'leri korundu ────');
expect('5.1 Person → User 2-step chain (round 2)',
  /prisma\.person\.findMany\(\{[\s\S]{0,500}personId: \{ in: teamPersonIds \}/.test(routesCode), true);
expect('5.2 NotificationDispatch (audit) korundu',
  /notificationDispatch\.create/.test(routesCode), true);
expect('5.3 emitGenericNotification lazy import',
  /await import\('\.\.\/db\/actionItemRepository\.js'\)/.test(routesCode), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
