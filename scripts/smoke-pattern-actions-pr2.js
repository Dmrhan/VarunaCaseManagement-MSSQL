/**
 * smoke-pattern-actions-pr2.js — Pattern Triage Actions PR-2.
 *
 * KAPSAM (static):
 *   - 3 endpoint mount (link-cases / notify-team / status)
 *   - Cross-tenant guard (allowedCompanyIds + team.companyId match)
 *   - linkRepo REUSE (Parent linkType)
 *   - NotificationDispatch insert (caseId zorunluğunu temsili caseIds[0] ile karşıla)
 *   - status enum genişlemesi (active/dismissed/known_issue)
 *   - dismissedBy/At alanları durumla uyumlu
 *   - Frontend service 4 method (linkPatternCases / notifyPatternTeam / setPatternStatus + listPatterns)
 *   - UI 4 aksiyon butonu (Ana Vakaya Bağla / Takıma Bildir / Bilinen Sorun / Kapat)
 *   - 2 modal (LinkModal master select + NotifyModal team picker)
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

// ─── 1) Backend endpoint'ler ─────────────────────────────────────
const routes = read('server/routes/analytics.js');
const routesCode = strip(routes);

console.log('── 1) Backend 3 endpoint mount ─────────────────');
expect('1.1 POST /patterns/:id/link-cases',
  /router\.post\(\s*'\/patterns\/:id\/link-cases', requireSupervisorAnalytics/.test(routesCode), true);
expect('1.2 POST /patterns/:id/notify-team',
  /router\.post\(\s*'\/patterns\/:id\/notify-team', requireSupervisorAnalytics/.test(routesCode), true);
expect('1.3 PATCH /patterns/:id/status',
  /router\.patch\(\s*'\/patterns\/:id\/status', requireSupervisorAnalytics/.test(routesCode), true);
expect('1.4 Legacy /dismiss endpoint korundu',
  /router\.patch\(\s*'\/patterns\/:id\/dismiss'/.test(routesCode), true);

console.log('\n── 2) Cross-tenant guard ─────────────────────────');
expect('2.1 link-cases — alert.companyId ∈ allowedCompanyIds',
  /link-cases'[\s\S]{0,500}allowedCompanyIds\.includes\(alert\.companyId\)/.test(routesCode), true);
expect('2.2 notify-team — team.companyId === alert.companyId',
  /notify-team'[\s\S]{0,2000}team\.companyId !== alert\.companyId[\s\S]{0,200}team_out_of_scope/.test(routesCode), true);
expect('2.3 status — alert.companyId ∈ allowedCompanyIds',
  /\/status'[\s\S]{0,500}allowedCompanyIds\.includes\(target\.companyId\)/.test(routesCode), true);

console.log('\n── 3) link-cases linkRepo REUSE ──────────────────');
expect('3.1 linkRepo.add({linkType: \'Parent\'})',
  /link-cases'[\s\S]{0,2500}linkRepo\.add\(\{[\s\S]{0,400}linkType: 'Parent'/.test(routesCode), true);
expect('3.2 masterCaseId default caseIds[0]',
  /link-cases'[\s\S]{0,2000}masterCaseId[\s\S]{0,200}caseIds\[0\]/.test(routesCode), true);
expect('3.3 self-link skip (cid === masterCaseId continue)',
  /link-cases'[\s\S]{0,3000}cid === masterCaseId\) continue/.test(routesCode), true);
expect('3.4 Master tetik vakalarından biri olmalı (master_not_in_trigger)',
  /master_not_in_trigger/.test(routesCode), true);

console.log('\n── 4) notify-team NotificationDispatch insert ────');
expect('4.1 caseId=caseIds[0] temsili (caseId zorunlu)',
  /representativeCaseId = caseIds\[0\][\s\S]{0,1000}caseId: representativeCaseId/.test(routesCode), true);
expect('4.2 channel=InApp + state=Sent (manuel agent)',
  /notify-team'[\s\S]{0,3000}channel: 'InApp'[\s\S]{0,200}state: 'Sent'/.test(routesCode), true);
expect('4.3 audienceType=team_lead + audienceIdentifier=teamId',
  /audienceType: 'team_lead'[\s\S]{0,200}audienceIdentifier: teamId/.test(routesCode), true);
expect('4.4 message override + slice(0, 1000) DoS koruması',
  /req\.body\?\.message[\s\S]{0,500}\.slice\(0, 1000\)/.test(routesCode), true);

console.log('\n── 5) status enum (active/dismissed/known_issue) ──');
expect('5.1 3 değer validation',
  /\['active', 'dismissed', 'known_issue'\]\.includes\(newStatus\)/.test(routesCode), true);
expect('5.2 dismissed → dismissedBy/At set',
  /newStatus === 'dismissed'[\s\S]{0,800}data\.dismissedBy = req\.user\.id[\s\S]{0,300}data\.dismissedAt = new Date\(\)/.test(routesCode), true);
expect('5.3 active veya known_issue → dismiss alanları temizle',
  /newStatus === 'active' \|\| newStatus === 'known_issue'[\s\S]{0,800}data\.dismissedBy = null[\s\S]{0,300}data\.dismissedAt = null/.test(routesCode), true);

// ─── 6) Frontend service ─────────────────────────────────────────
const svc = read('src/services/analyticsService.ts');

console.log('\n── 6) Frontend service 4 method ──────────────────');
expect('6.1 linkPatternCases',
  /async linkPatternCases\(\s*id: string,\s*body: \{ masterCaseId\?: string \}/.test(svc), true);
expect('6.2 notifyPatternTeam',
  /async notifyPatternTeam\(\s*id: string,\s*body: \{ teamId: string; message\?: string \}/.test(svc), true);
expect('6.3 setPatternStatus 3-state',
  /async setPatternStatus\(\s*id: string,\s*status: 'active' \| 'dismissed' \| 'known_issue'/.test(svc), true);
expect('6.4 listPatterns korundu (regression)',
  /async listPatterns/.test(svc), true);

// ─── 7) UI — PatternsPage actions ────────────────────────────────
const ui = read('src/features/analytics/PatternsPage.tsx');

console.log('\n── 7) UI aksiyon butonları + modal ───────────────');
expect('7.1 4 aksiyon buton (Ana Vakaya Bağla / Takıma Bildir / Bilinen Sorun / Kapat)',
  /Ana Vakaya Bağla[\s\S]{0,3000}Takıma Bildir[\s\S]{0,3000}Bilinen Sorun[\s\S]{0,3000}>\s*Kapat\s*</.test(ui), true);
expect('7.2 LinkModal — master vaka select',
  /function LinkModal\(/.test(ui) && /Ana vaka[\s\S]{0,500}<Select/.test(ui), true);
expect('7.3 NotifyModal — team picker',
  /function NotifyModal\(/.test(ui) && /Takım[\s\S]{0,500}<Select/.test(ui), true);
expect('7.4 NotifyModal — companyId scope filter',
  /allTeams\.filter\(\(t\) => t\.companyId === alert\.companyId/.test(ui), true);
expect('7.5 handleKnownIssue — setPatternStatus(\'known_issue\')',
  /handleKnownIssue[\s\S]{0,400}setPatternStatus\(alert\.id, 'known_issue'\)/.test(ui), true);
expect('7.6 handleDismiss artık setPatternStatus(\'dismissed\')',
  /handleDismiss[\s\S]{0,400}setPatternStatus\(alert\.id, 'dismissed'\)/.test(ui), true);
expect('7.7 ActionModal state union (link/notify)',
  /ActionModal[\s\S]{0,200}kind: 'link'[\s\S]{0,200}kind: 'notify'/.test(ui), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
