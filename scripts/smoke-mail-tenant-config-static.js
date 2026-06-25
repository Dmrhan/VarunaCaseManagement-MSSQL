#!/usr/bin/env node
/**
 * Static smoke — Mail M5 per-tenant ExternalMailSetting + Admin UI.
 *
 * Çağrı YAPMAZ; sadece dosya/regex inceler. Hedef (DevOps Faz 2.1 deseninin
 * aynası):
 *  - Prisma model ExternalMailSetting + migration var
 *  - externalMailSettingRepository SELECTABLE_PUBLIC secret ciphertext'i
 *    DÖKMEZ; secretIsSet derived
 *  - Admin route GET secret döndürmez; PATCH server-side strip; test ucu
 *  - mailProvider companyId-aware resolveConfig (DB-first, env fallback,
 *    disabled=503)
 *  - adminService TS types: ExternalMailSetting + ExternalMailSettingInput +
 *    ExternalMailTestResult + externalMailSettings.get/save/test
 *  - AdminPage WRITE-ONLY secret input + AdminLayout view + App.tsx render
 */

import { readFileSync, existsSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name} — actual=${actual} expected=${expected}`); }
}
function read(p) { return readFileSync(p, 'utf8'); }
function strip(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

console.log('── 1) Prisma model + migration ────────────────────');
const schema = read('prisma/schema.prisma');
expect('1.1 model ExternalMailSetting tanımlı',
  /model ExternalMailSetting \{/.test(schema), true);
expect('1.2 companyId @unique',
  /model ExternalMailSetting[\s\S]{0,2000}companyId\s+String\s+@unique/.test(schema), true);
expect('1.3 secret ciphertext/iv/authTag NVarChar(Max) nullable',
  /secretCiphertext\s+String\?\s+@db\.NVarChar\(Max\)/.test(schema)
    && /secretIv\s+String\?\s+@db\.NVarChar\(Max\)/.test(schema)
    && /secretAuthTag\s+String\?\s+@db\.NVarChar\(Max\)/.test(schema), true);
expect('1.4 secretSetAt + authMode + smtpHost/Port/Secure + imapHost/Port',
  /secretSetAt\s+DateTime\?/.test(schema)
    && /authMode\s+String\s+@default\("password"\)/.test(schema)
    && /smtpHost\s+String\?/.test(schema)
    && /imapHost\s+String\?/.test(schema), true);
expect('1.5 Company back-relation externalMailSetting',
  /externalMailSetting\s+ExternalMailSetting\?/.test(schema), true);
expect('1.6 migration dosyası mevcut',
  existsSync('prisma/migrations/00000000000013_external_mail_setting/migration.sql'), true);

console.log('\n── 2) Repository — secret plain GET response\'a YOK ───');
const repo = read('server/db/externalMailSettingRepository.js');
const repoCode = strip(repo);
expect('2.1 SELECTABLE_PUBLIC secretCiphertext YOK',
  /const SELECTABLE_PUBLIC = \{[\s\S]*?\};/.exec(repoCode)?.[0]?.includes('secretCiphertext') === false, true);
expect('2.2 SELECTABLE_PUBLIC secretIv YOK',
  /const SELECTABLE_PUBLIC = \{[\s\S]*?\};/.exec(repoCode)?.[0]?.includes('secretIv') === false, true);
expect('2.3 SELECTABLE_PUBLIC secretAuthTag YOK',
  /const SELECTABLE_PUBLIC = \{[\s\S]*?\};/.exec(repoCode)?.[0]?.includes('secretAuthTag') === false, true);
expect('2.4 shapeForPublic secretIsSet = secretSetAt türetilir',
  /secretIsSet:\s*row\.secretSetAt\s*!==\s*null/.test(repoCode), true);
expect('2.5 upsert secret varsa encrypt + ciphertext/iv/authTag persist',
  /typeof patch\.secret === 'string'[\s\S]{0,300}encrypt\(patch\.secret\.trim\(\)\)[\s\S]{0,300}data\.secretCiphertext = enc\.ciphertext/.test(repoCode), true);
expect('2.6 upsert secret yoksa mevcut secret\'a dokunulmaz (rotate semantik)',
  /typeof patch\.secret === 'string' && patch\.secret\.trim\(\)\.length > 0/.test(repoCode), true);
expect('2.7 resolveActiveConfig enabled=false → { enabled: false } (env\'e DÜŞMEZ)',
  /if \(!row\.enabled\) \{\s*return \{ enabled: false \};\s*\}/.test(repoCode), true);
expect('2.8 resolveActiveConfig satır yoksa null (env fallback caller\'da)',
  /if \(!row\) return null;/.test(repoCode), true);

console.log('\n── 3) Admin route — GET secret YOK, PATCH strip, test ucu ───');
const route = read('server/routes/admin.js');
const routeCode = strip(route);
expect('3.1 GET /external-mail-settings + assertCompanyAdmin',
  /router\.get\('\/external-mail-settings'[\s\S]{0,400}assertCompanyAdmin\(req, companyId\)/.test(routeCode), true);
expect('3.2 PATCH /external-mail-settings/:companyId + assertCompanyAdmin',
  /router\.patch\('\/external-mail-settings\/:companyId'[\s\S]{0,400}assertCompanyAdmin\(req, companyId\)/.test(routeCode), true);
expect('3.3 PATCH server-side strip (secretIsSet/secretSetAt/ciphertext/iv/authTag)',
  /delete patch\.secretIsSet/.test(routeCode)
    && /delete patch\.secretSetAt/.test(routeCode)
    && /delete patch\.secretCiphertext/.test(routeCode)
    && /delete patch\.secretIv/.test(routeCode)
    && /delete patch\.secretAuthTag/.test(routeCode), true);
expect('3.4 POST /test endpoint + assertCompanyAdmin',
  /router\.post\('\/external-mail-settings\/:companyId\/test'[\s\S]{0,400}assertCompanyAdmin\(req, companyId\)/.test(routeCode), true);
expect('3.5 test endpoint mailProvider companyId-aware',
  /mailProviderSendMail\([\s\S]{0,300}\{ companyId \}/.test(routeCode), true);

console.log('\n── 4) mailProvider companyId-aware ────────────────');
const provider = read('server/lib/mailProvider.js');
const providerCode = strip(provider);
expect('4.1 resolveConfig async + opts.companyId',
  /async function resolveConfig\(\{ companyId \} = \{\}\)/.test(providerCode), true);
expect('4.2 DB-first lookup (dynamic import)',
  /externalMailSettingRepository\.js[\s\S]{0,300}resolveActiveConfig\(companyId\)/.test(providerCode), true);
expect('4.3 disabled → throw mail_integration_disabled 503',
  /dbConfig\.enabled === false[\s\S]{0,300}mail_integration_disabled[\s\S]{0,200}status: 503/.test(providerCode), true);
expect('4.4 sendMail({...}, opts) — companyId iletir',
  /export async function sendMail\(\{[\s\S]{0,400}\} = \{\}, opts = \{\}\)/.test(providerCode), true);
expect('4.5 await resolveConfig({ companyId: opts.companyId })',
  /await resolveConfig\(\{ companyId: opts\.companyId \}\)/.test(providerCode), true);
expect('4.6 meta.source = "db" | "env"',
  /source: 'db'/.test(providerCode) && /source: 'env'/.test(providerCode), true);

console.log('\n── 5) adminService — ExternalMail types/calls ───');
const svc = read('src/services/adminService.ts');
expect('5.1 ExternalMailSetting interface secretIsSet yes / secret NO',
  /export interface ExternalMailSetting \{[\s\S]{0,1500}secretIsSet:\s*boolean/.test(svc)
    && /export interface ExternalMailSetting \{[\s\S]{0,1500}\s+secret:\s*string/.test(svc) === false, true);
expect('5.2 ExternalMailSettingInput secret opsiyonel',
  /export interface ExternalMailSettingInput \{[\s\S]{0,500}secret\?\:\s*string;/.test(svc), true);
expect('5.3 service entry externalMailSettings.get/save/test',
  /externalMailSettings:\s*\{[\s\S]{0,1500}async get\(/.test(svc)
    && /externalMailSettings:[\s\S]{0,2500}async save\(/.test(svc)
    && /externalMailSettings:[\s\S]{0,3000}async test\(/.test(svc), true);

console.log('\n── 6) AdminPage — WRITE-ONLY secret + AdminLayout view + App.tsx ───');
const page = read('src/features/admin/AdminExternalMailPage.tsx');
const pageCode = strip(page);
expect('6.1 secret input WRITE-ONLY (editingSecret toggle, default false)',
  /editingSecret:\s*boolean/.test(pageCode) && /editingSecret:\s*false,/.test(pageCode), true);
expect('6.2 toPatch — secret yalnız editingSecret && trim().length > 0 ise eklenir',
  /if \(d\.editingSecret && d\.secretInput\.trim\(\)\.length > 0\) \{\s*patch\.secret = d\.secretInput\.trim\(\)/.test(pageCode), true);
expect('6.3 Secret input type="password" autoComplete="new-password"',
  /type="password"[\s\S]{0,80}autoComplete="new-password"/.test(pageCode), true);
expect('6.4 adminService.externalMailSettings.test çağrılır',
  /adminService\.externalMailSettings\.test\(companyId\)/.test(pageCode), true);

const layout = read('src/features/admin/AdminLayout.tsx');
expect('6.5 AdminView union admin-external-mail içerir',
  /'admin-external-mail'/.test(layout), true);
expect('6.6 NAV entry "Mail Entegrasyonu" + Mail icon',
  /admin-external-mail[\s\S]{0,100}Mail Entegrasyonu[\s\S]{0,100}Mail size/.test(layout), true);

const app = read('src/App.tsx');
expect('6.7 App.tsx AdminExternalMailPage import + render',
  /import \{ AdminExternalMailPage \}/.test(app)
    && /view === 'admin-external-mail' && <AdminExternalMailPage \/>/.test(app), true);

console.log('\n────────────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
