/**
 * smoke-mail-multi-inbox-a4.js — Multi-Inbox A4 (admin route + service + UI).
 *
 * KAPSAM (static — kod yapısı):
 *   - server/routes/admin.js — 4 endpoint mevcut (GET/POST/PATCH/DELETE)
 *   - assertCompanyAdmin guard'ı her uçta
 *   - src/services/adminService.ts — inboxes namespace + types
 *   - src/features/admin/AdminExternalMailPage.tsx — MailInboxManager mount edildi
 *   - Help banner mevcut (CS yardımsız kullanabilsin)
 *
 * KAPSAM DIŞI (integration smoke):
 *   - Modal CRUD round-trip (HTTP düzeyinde)
 *   - Secret rotation flow
 *   - Cross-tenant team_scope_mismatch 403 davranışı
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

// ─── Backend routes ─────────────────────────────────────────────────
const route = read('server/routes/admin.js');
const routeCode = strip(route);

console.log('── 1) Backend admin route\'lar ────────────────────');
expect('1.1 externalMailInboxRepo import',
  /import \{ externalMailInboxRepo \} from '\.\.\/db\/externalMailInboxRepository\.js'/.test(routeCode), true);
expect('1.2 GET /:companyId/inboxes',
  /router\.get\('\/external-mail-settings\/:companyId\/inboxes'/.test(routeCode), true);
expect('1.3 POST /:companyId/inboxes',
  /router\.post\('\/external-mail-settings\/:companyId\/inboxes'/.test(routeCode), true);
expect('1.4 PATCH /:companyId/inboxes/:inboxId',
  /router\.patch\('\/external-mail-settings\/:companyId\/inboxes\/:inboxId'/.test(routeCode), true);
expect('1.5 DELETE /:companyId/inboxes/:inboxId',
  /router\.delete\('\/external-mail-settings\/:companyId\/inboxes\/:inboxId'/.test(routeCode), true);

console.log('\n── 2) Scope guard\'lar (assertCompanyAdmin) ──────');
// 4 endpoint x 1 assertCompanyAdmin minimum — paterni kontrol et
const inboxRouteBlock = (routeCode.match(/external-mail-settings\/:companyId\/inboxes[\s\S]{0,8000}/) || [''])[0];
expect('2.1 GET endpoint assertCompanyAdmin',
  /router\.get\('\/external-mail-settings\/:companyId\/inboxes'[\s\S]{0,400}assertCompanyAdmin\(req, companyId\)/.test(routeCode), true);
expect('2.2 POST endpoint assertCompanyAdmin',
  /router\.post\('\/external-mail-settings\/:companyId\/inboxes'[\s\S]{0,400}assertCompanyAdmin\(req, companyId\)/.test(routeCode), true);
expect('2.3 PATCH endpoint assertCompanyAdmin',
  /router\.patch\('\/external-mail-settings\/:companyId\/inboxes\/:inboxId'[\s\S]{0,400}assertCompanyAdmin\(req, companyId\)/.test(routeCode), true);
expect('2.4 DELETE endpoint assertCompanyAdmin',
  /router\.delete\('\/external-mail-settings\/:companyId\/inboxes\/:inboxId'[\s\S]{0,400}assertCompanyAdmin\(req, companyId\)/.test(routeCode), true);

console.log('\n── 3) Error code → HTTP status mapping ───────────');
expect('3.1 team_scope_mismatch → 403',
  /team_scope_mismatch[\s\S]{0,100}403/.test(routeCode), true);
expect('3.2 address_already_exists → 409',
  /address_already_exists[\s\S]{0,100}409/.test(routeCode), true);
expect('3.3 not_found → 404',
  /not_found[\s\S]{0,100}404/.test(routeCode), true);

// ─── Frontend service ──────────────────────────────────────────────
const svc = read('src/services/adminService.ts');
const svcCode = strip(svc);

console.log('\n── 4) Frontend adminService.externalMailSettings.inboxes ─');
expect('4.1 inboxes.list method',
  /inboxes:\s*\{[\s\S]{0,300}async list\(companyId:/.test(svcCode), true);
expect('4.2 inboxes.create method',
  /async create\(companyId: string, draft: MailInboxDraft\)/.test(svcCode), true);
expect('4.3 inboxes.update method',
  /async update\([\s\S]{0,200}inboxId: string,[\s\S]{0,200}draft: MailInboxDraft/.test(svcCode), true);
expect('4.4 inboxes.remove method',
  /async remove\(companyId: string, inboxId: string\)/.test(svcCode), true);
expect('4.5 MailInboxItem interface',
  /export interface MailInboxItem \{/.test(svcCode), true);
expect('4.6 MailInboxDraft interface',
  /export interface MailInboxDraft \{/.test(svcCode), true);
expect('4.7 secretIsSet shape (raw secret\'ler dışarı çıkmıyor)',
  /secretIsSet: boolean/.test(svcCode)
    && !/secretCiphertext.*MailInbox/.test(svcCode), true);

// ─── Admin UI ──────────────────────────────────────────────────────
const ui = read('src/features/admin/AdminExternalMailPage.tsx');
const uiCode = strip(ui);

console.log('\n── 5) Admin UI — MailInboxManager mount ────────');
expect('5.1 MailInboxManager component mevcut',
  /function MailInboxManager\(\{ companyId \}/.test(uiCode), true);
expect('5.2 AdminExternalMailPage\'e mount edildi',
  /<MailInboxManager companyId=\{companyId\} \/>/.test(uiCode), true);
expect('5.3 MailInboxEditor (Modal CRUD)',
  /function MailInboxEditor\(/.test(uiCode), true);
expect('5.4 Help banner — "Her inbox AYRI bir mail hesabıdır"',
  /Her inbox AYRI bir mail hesab/.test(ui), true);
expect('5.5 Team picker — lookupService.teams + companyId filter',
  /lookupService\.teams\(\)[\s\S]{0,500}filter\(\(t\) => t\.companyId === companyId\)/.test(uiCode), true);
expect('5.6 Secret rotation toggle (FromAlias paterni)',
  /rotateSecret/.test(uiCode), true);

console.log('\n────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
