/**
 * smoke-pattern-codex-round1.js — Pattern Triage Codex round 1 fix'leri.
 *
 * Bulgular (PR #341 release-review):
 *   P1 #1 — callOpenAI return shape yanlış oku: data → json
 *           (gerçek shape `{ json, raw, tokenCount }`)
 *   P1 #2 — topKeyword title-derived → AI prompt'undan ÇIKAR
 *           (stop-word filter çıplak ismi yakalayamaz, PII sızıntı riski)
 *   P2 #1 — patternDetect cron dedupe sadece 'active' arıyordu;
 *           'known_issue' kategorileri tekrar tetiklenirdi
 *   P2 #2 — notify-team gerçek per-user notification yapmıyordu;
 *           sadece NotificationDispatch (audit-only); bell/action-center
 *           için emitGenericNotification gerek
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

// ─── 1) P1 — callOpenAI shape (data → json) ──────────────────────
const ai = read('server/lib/patternHypothesisAi.js');
const aiCode = strip(ai);

console.log('── 1) P1 callOpenAI shape (data → json) ──────────');
expect('1.1 const { json, tokenCount } destructure (paterni mirror)',
  /const \{ json, tokenCount \} = await callOpenAI/.test(aiCode), true);
expect('1.2 json.hypothesis + json.suggestedAction okuma',
  /json\.hypothesis === 'string'[\s\S]{0,200}json\.suggestedAction === 'string'/.test(aiCode), true);
expect('1.3 json.hypothesis.slice + json.suggestedAction.slice',
  /json\.hypothesis\.slice\(0, 600\)[\s\S]{0,200}json\.suggestedAction\.slice\(0, 400\)/.test(aiCode), true);
expect('1.4 Eski `result?.data ?? result?.parsed` kaldırıldı',
  !/result\?\.data \?\? result\?\.parsed/.test(aiCode), true);

// ─── 2) P1 — topKeyword AI prompt'undan ÇIKAR ────────────────────
console.log('\n── 2) P1 topKeyword AI prompt\'tan ÇIKARILDI ────');
expect('2.1 ❌ topAnahtarKelime AI structuredInput\'ta YOK',
  !/topAnahtarKelime: insight\.commonThread\?\.topKeyword/.test(aiCode), true);
expect('2.2 ❌ insight.commonThread.topKeyword.word AI\'a GİTMEZ',
  !/topKeyword\.word/.test(aiCode), true);
expect('2.3 Yorum: title-derived PII riski açıklandı (raw)',
  /title-derived[\s\S]{0,400}stop-word/.test(ai), true);
expect('2.4 ✅ topAnaFirma + topUrun korundu (tüzel kişi/ürün ad, PII değil)',
  /topAnaFirma[\s\S]{0,400}topUrun/.test(aiCode), true);

// ─── 3) P2 — patternDetect cron known_issue dedupe ───────────────
const cron = read('server/cron/patternDetect.js');
const cronCode = strip(cron);

console.log('\n── 3) P2 cron known_issue dedupe ─────────────────');
expect('3.1 status filter: { in: [\'active\', \'known_issue\'] }',
  /status: \{ in: \['active', 'known_issue'\] \}/.test(cronCode), true);
expect('3.2 Eski tek-string `status: \'active\'` kaldırıldı',
  !/status: 'active',\s*detectedAt/.test(cronCode), true);
expect('3.3 Yorum: kullanıcı niyeti açıklandı (raw)',
  /"biliniyor"[\s\S]{0,200}gürültüyü/.test(cron), true);

// ─── 4) P2 — notify-team per-user notification ───────────────────
const routes = read('server/routes/analytics.js');
const routesCode = strip(routes);

console.log('\n── 4) P2 notify-team per-user notification ───────');
expect('4.1 notify-team — emitGenericNotification import lazy',
  /notify-team'[\s\S]{0,4000}emitGenericNotification[\s\S]{0,300}actionItemRepository/.test(routesCode), true);
expect('4.2 Team members lookup (User.person.teamId)',
  /notify-team'[\s\S]{0,5000}prisma\.user\.findMany\(\{[\s\S]{0,500}person: \{ teamId, isActive: true \}/.test(routesCode), true);
expect('4.3 Her member için emitGenericNotification çağrısı',
  /for \(const member of members\)[\s\S]{0,500}emitGenericNotification\(\{/.test(routesCode), true);
expect('4.4 eventType=pattern_alert_team_notify',
  /eventType: 'pattern_alert_team_notify'/.test(routesCode), true);
expect('4.5 recipientUserId her üye için ayrı',
  /recipientUserId: member\.id/.test(routesCode), true);
expect('4.6 Response\'ta notifiedCount + totalMembers (audit)',
  /notifiedCount[\s\S]{0,200}totalMembers: members\.length/.test(routesCode), true);
expect('4.7 NotificationDispatch korundu (audit; eski davranış)',
  /notificationDispatch\.create/.test(routesCode), true);

// ─── 5) notificationKindFor — pattern_alert_team_notify mapped ───
const actionItemRepo = read('server/db/actionItemRepository.js');

console.log('\n── 5) notificationKindFor pattern_alert eventType ──');
expect('5.1 case \'pattern_alert_team_notify\' → system_alert',
  /case 'pattern_alert_team_notify':[\s\S]{0,200}return 'system_alert'/.test(actionItemRepo), true);
expect('5.2 Mevcut watcher_event + transfer_warning case\'ler korundu (regression)',
  /case 'watcher_added':[\s\S]{0,300}case 'transfer_warning':/.test(actionItemRepo), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
