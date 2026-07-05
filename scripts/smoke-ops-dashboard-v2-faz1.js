/**
 * smoke-ops-dashboard-v2-faz1.js — 2026-07-05
 *
 * Ops Panosu v2 FAZ 1 (docs/OPERATIONS_DASHBOARD_V2.md):
 *   1a. Müşteri lensi — accountId filtresi (route guard + aggregator/drilldown)
 *   1b. Talep Türü + Kanal kartları (byRequestType / byOrigin UI wiring)
 * Yapısal assert. Canlı DOM kabulü: scripts/accept-ops-dashboard-faz1.mjs
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const expectTrue = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS — ${name}`); }
  else { fail += 1; console.log(`FAIL — ${name}`); }
};

const routes = readFileSync('server/routes/analytics.js', 'utf8');
const drill = readFileSync('server/analytics/drilldownQuery.js', 'utf8');
const aggr = readFileSync('server/analytics/operationsAggregator.js', 'utf8');
const page = readFileSync('src/features/analytics/OperationsDashboardPage.tsx', 'utf8');
const lens = readFileSync('src/features/analytics/operationsLensConfig.ts', 'utf8');
const svc = readFileSync('src/services/analyticsService.ts', 'utf8');

console.log('── 1) Backend — accountId guard + filtre ──');
expectTrue('1.1 checkAccountInScope guard (paylaşılan modülden; 404/403 kodları)',
  routes.includes("from '../analytics/accountScopeGuard.js'")
  && readFileSync('server/analytics/accountScopeGuard.js', 'utf8').includes("'account_not_found'")
  && readFileSync('server/analytics/accountScopeGuard.js', 'utf8').includes("'account_out_of_scope'"));
expectTrue('1.2 overview: accountId guard + filters spread',
  /cases\/overview[\s\S]{0,1600}checkAccountInScope\(body\.accountId, scope\)/.test(routes)
  && /cases\/overview[\s\S]{0,2400}\.\.\.\(accountId \? \{ accountId \} : \{\}\)/.test(routes));
expectTrue('1.3 drilldown: accountId guard + filters spread',
  /cases\/drilldown[\s\S]{0,1600}checkAccountInScope\(body\.accountId, scope\)/.test(routes)
  && /cases\/drilldown[\s\S]{0,2400}\.\.\.\(drillAccountId \? \{ accountId: drillAccountId \} : \{\}\)/.test(routes));
expectTrue('1.4 drilldownQuery: accountId where clause',
  drill.includes("and.push({ accountId: filters.accountId })"));
expectTrue('1.5 aggregator accountId zaten destekli (regresyon çapası)',
  aggr.includes('[accountId] = @P'));
expectTrue('1.6 guard tipi: accountId string değilse 400',
  routes.split('checkAccountInScope(body.accountId').length >= 3
  && routes.includes("'accountId string olmalı.'"));

console.log('── 2) Lens config — requestOriginGroup ──');
expectTrue('2.1 section key tanımlı', lens.includes("'requestOriginGroup'"));
expectTrue('2.2 OPERATIONS lens sırasında',
  /'byCaseType',\s*'requestOriginGroup',/.test(lens));
expectTrue('2.3 customer + executive lens\'te gizli',
  (lens.match(/hiddenSections: \[[^\]]*'requestOriginGroup'/g) ?? []).length === 2);

console.log('── 3) Sayfa — müşteri lensi UI ──');
expectTrue('3.1 selectedAccount state + picker state',
  page.includes('selectedAccount') && page.includes('accountPickerOpen'));
expectTrue('3.2 overviewBody accountId taşıyor (drilldown spread ile otomatik)',
  page.includes('accountId: selectedAccount?.id'));
expectTrue('3.3 AccountSearchPicker REUSE (yeni picker YAZILMADI)',
  page.includes("from '@/features/accounts/AccountSearchPicker'"));
expectTrue('3.4 FilterBar: müşteri chip + temizle + hint',
  page.includes('Müşteri filtresini temizle')
  && page.includes('+ Müşteri seç')
  && page.includes('yalnız o müşterinin vakalarını sayar'));
expectTrue('3.5 genel Temizle müşteriyi de sıfırlar',
  /onClear=\{\(\) => \{[\s\S]{0,200}setSelectedAccount\(null\)/.test(page));

console.log('── 4) Sayfa — Talep Türü + Kanal kartları ──');
expectTrue('4.1 requestOriginGroup case (2-col composite)',
  page.includes("case 'requestOriginGroup':"));
expectTrue('4.2 TR etiketler (ASCII enum → görüntü)',
  page.includes("Sikayet: 'Şikayet'") && page.includes("Eposta: 'E-posta'")
  && page.includes("Diger: 'Diğer'") && page.includes("Oneri: 'Öneri'"));
expectTrue('4.3 mapper\'lar bucket\'sız (drilldown bilinçli kapalı)',
  /function mapRequestTypeItems[\s\S]{0,400}\}\)\);\s*\}/.test(page)
  && !/function mapRequestTypeItems[\s\S]{0,400}bucket: \{/.test(page));
expectTrue('4.4 kartlar byRequestType/byOrigin okuyor',
  page.includes('data?.byRequestType ?? []') && page.includes('data?.byOrigin ?? []'));

console.log('── 5) Servis tipleri ──');
expectTrue('5.1 OverviewRequest.accountId', /accountId\?: string;/.test(svc));
expectTrue('5.2 Response byRequestType + byOrigin',
  svc.includes('byRequestType: OverviewCountPair[]') && svc.includes('byOrigin: OverviewCountPair[]'));

console.log('── 6) Codex R1 P1 — AI snapshot müşteri lensi ──');
const guard = readFileSync('server/analytics/accountScopeGuard.js', 'utf8');
const ai = readFileSync('server/routes/ai.js', 'utf8');
expectTrue('6.1 guard TEK KAYNAK modülde (analytics + ai paylaşır)',
  guard.includes('export async function checkAccountInScope')
  && routes.includes("from '../analytics/accountScopeGuard.js'")
  && ai.includes("from '../analytics/accountScopeGuard.js'"));
expectTrue('6.2 buildScopedSnapshot accountId parse + guard + filters',
  /buildScopedSnapshot[\s\S]{0,1400}checkAccountInScope\(body\.accountId, scope\)/.test(ai)
  && /buildScopedSnapshot[\s\S]{0,2200}\.\.\.\(accountId \? \{ accountId \} : \{\}\)/.test(ai));
expectTrue('6.3 analytics.js\'te yerel guard kopyası KALMADI (tek kaynak)',
  !routes.includes('async function checkAccountInScope'));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
