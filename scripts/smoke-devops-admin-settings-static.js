#!/usr/bin/env node
/**
 * Static smoke — DevOps Faz 2.1 admin settings + şifreli PAT.
 *
 * Çağrı YAPMAZ; sadece dosya/regex inceler. Hedef:
 *  - secretCipher.js AES-256-GCM, lazy throw, round-trip (runtime ek test)
 *  - Prisma model ExternalDevOpsSetting + migration var
 *  - Repository SELECTABLE_PUBLIC pat ciphertext'i DÖKMEZ; patIsSet derived
 *  - Admin route GET PAT döndürmez; PATCH server-side fields strip; test ucu
 *  - devopsClient companyId-aware getConfig (DB-first, env fallback,
 *    disabled=503, env'e düşmez)
 *  - AdminPage WRITE-ONLY PAT input, "Değiştir" toggle
 *  - .env.example DEVOPS_PAT_ENC_KEY placeholder
 *  - PAT plain text string'i hiçbir GET/log path'inde sızdırılmıyor
 *    (string match 'patCiphertext' SELECTABLE_PUBLIC içinde YOK)
 */

import { readFileSync, existsSync } from 'node:fs';

let pass = 0;
let fail = 0;
function expect(name, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name} — actual=${actual} expected=${expected}`);
  }
}
function read(p) {
  return readFileSync(p, 'utf8');
}
function strip(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

console.log('── 1) secretCipher.js — AES-256-GCM, lazy throw ───');
const cipher = read('server/lib/secretCipher.js');
const cipherCode = strip(cipher);
expect('1.1 algorithm aes-256-gcm', /aes-256-gcm/.test(cipherCode), true);
expect('1.2 key bytes 32', /KEY_BYTES\s*=\s*32/.test(cipherCode), true);
expect('1.3 IV 12 byte (GCM)', /IV_BYTES\s*=\s*12/.test(cipherCode), true);
expect('1.4 authTag 16 byte (GCM)', /AUTH_TAG_BYTES\s*=\s*16/.test(cipherCode), true);
expect('1.5 randomBytes(IV_BYTES) — taze IV her encrypt', /randomBytes\(IV_BYTES\)/.test(cipherCode), true);
expect('1.6 setAuthTag — GCM tag doğrulaması', /decipher\.setAuthTag\(tagBuf\)/.test(cipherCode), true);
expect('1.7 LAZY THROW — resolveKey encrypt/decrypt anında çağrılır',
  /function resolveKey\(\)[\s\S]{0,400}throw new SecretCipherError/.test(cipherCode), true);
expect('1.8 env key adı DEVOPS_PAT_ENC_KEY', /KEY_ENV_NAME\s*=\s*'DEVOPS_PAT_ENC_KEY'/.test(cipherCode), true);
expect('1.9 export encrypt/decrypt fonksiyonları',
  /export function encrypt\(plain\)/.test(cipherCode)
    && /export function decrypt\(\{ ciphertext, iv, authTag \}\)/.test(cipherCode), true);

console.log('\n── 2) Prisma model + migration ────────────────────');
const schema = read('prisma/schema.prisma');
expect('2.1 model ExternalDevOpsSetting tanımlı',
  /model ExternalDevOpsSetting \{/.test(schema), true);
expect('2.2 companyId @unique',
  /model ExternalDevOpsSetting[\s\S]{0,1500}companyId\s+String\s+@unique/.test(schema), true);
expect('2.3 patCiphertext / patIv / patAuthTag NVarChar(Max) nullable',
  /patCiphertext\s+String\?\s+@db\.NVarChar\(Max\)/.test(schema)
    && /patIv\s+String\?\s+@db\.NVarChar\(Max\)/.test(schema)
    && /patAuthTag\s+String\?\s+@db\.NVarChar\(Max\)/.test(schema), true);
expect('2.4 patSetAt DateTime?',
  /patSetAt\s+DateTime\?/.test(schema), true);
expect('2.5 enabled @default(false)',
  /model ExternalDevOpsSetting[\s\S]{0,500}enabled\s+Boolean\s+@default\(false\)/.test(schema), true);
expect('2.6 Company → externalDevOpsSetting back-relation',
  /externalDevOpsSetting\s+ExternalDevOpsSetting\?/.test(schema), true);
expect('2.7 migration dosyası mevcut',
  existsSync('prisma/migrations/00000000000009_external_devops_setting/migration.sql'), true);

console.log('\n── 3) Repository — PAT plain GET response\'a YOK ───');
const repo = read('server/db/externalDevOpsSettingRepository.js');
const repoCode = strip(repo);
expect('3.1 SELECTABLE_PUBLIC patCiphertext YOK',
  /const SELECTABLE_PUBLIC = \{[\s\S]*?\};/.exec(repoCode)?.[0]?.includes('patCiphertext') === false, true);
expect('3.2 SELECTABLE_PUBLIC patIv YOK',
  /const SELECTABLE_PUBLIC = \{[\s\S]*?\};/.exec(repoCode)?.[0]?.includes('patIv') === false, true);
expect('3.3 SELECTABLE_PUBLIC patAuthTag YOK',
  /const SELECTABLE_PUBLIC = \{[\s\S]*?\};/.exec(repoCode)?.[0]?.includes('patAuthTag') === false, true);
expect('3.4 shapeForPublic patIsSet = patSetAt türetilir',
  /patIsSet:\s*row\.patSetAt\s*!==\s*null/.test(repoCode), true);
// shapeForPublic function gövdesini izole et (function ... { ... ilk } )
{
  const m = /function shapeForPublic\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(repoCode);
  const body = m?.[1] ?? '';
  expect('3.5 shapeForPublic function gövdesi patCiphertext/patIv/patAuthTag içermez',
    body.length > 0
      && !/patCiphertext/.test(body)
      && !/patIv/.test(body)
      && !/patAuthTag/.test(body), true);
}
expect('3.6 upsert pat varsa encrypt edilip ciphertext/iv/authTag persist',
  /typeof patch\.pat === 'string'[\s\S]{0,300}encrypt\(patch\.pat\.trim\(\)\)[\s\S]{0,300}data\.patCiphertext = enc\.ciphertext/.test(repoCode), true);
expect('3.7 upsert pat yoksa mevcut PAT korunur (rotate semantik)',
  /typeof patch\.pat === 'string' && patch\.pat\.trim\(\)\.length > 0/.test(repoCode), true);
expect('3.8 resolveActiveConfig enabled=false → { enabled: false } (env\'e DÜŞMEZ)',
  /if \(!row\.enabled\) \{\s*return \{ enabled: false \};\s*\}/.test(repoCode), true);
expect('3.9 resolveActiveConfig satır yoksa null (env fallback caller\'da)',
  /if \(!row\) return null;/.test(repoCode), true);
expect('3.10 decrypt yalnız patCiphertext+iv+authTag varsa',
  /if \(row\.patCiphertext && row\.patIv && row\.patAuthTag\)/.test(repoCode), true);

console.log('\n── 4) Admin route — GET pat plain YOK, PATCH strip, test endpoint ───');
const route = read('server/routes/admin.js');
const routeCode = strip(route);
expect('4.1 GET /external-devops-settings + assertCompanyAdmin',
  /router\.get\('\/external-devops-settings'[\s\S]{0,400}assertCompanyAdmin\(req, companyId\)/.test(routeCode), true);
expect('4.2 PATCH /external-devops-settings/:companyId + assertCompanyAdmin',
  /router\.patch\('\/external-devops-settings\/:companyId'[\s\S]{0,400}assertCompanyAdmin\(req, companyId\)/.test(routeCode), true);
expect('4.3 PATCH body server-side fields strip (patIsSet/patSetAt/ciphertext/iv/authTag)',
  /delete patch\.patIsSet/.test(routeCode)
    && /delete patch\.patSetAt/.test(routeCode)
    && /delete patch\.patCiphertext/.test(routeCode)
    && /delete patch\.patIv/.test(routeCode)
    && /delete patch\.patAuthTag/.test(routeCode), true);
expect('4.4 POST /test endpoint + assertCompanyAdmin',
  /router\.post\('\/external-devops-settings\/:companyId\/test'[\s\S]{0,400}assertCompanyAdmin\(req, companyId\)/.test(routeCode), true);
expect('4.5 test endpoint companyId-aware devopsClient.getWorkItem',
  /devopsClient\.getWorkItem\(testId, \{ companyId \}\)/.test(routeCode), true);
expect('4.6 test response minimum — id/title/state (PAT/ham YOK)',
  /workItem:\s*\{\s*id:\s*result\.data\.normalized\?\.id/.test(routeCode), true);

console.log('\n── 5) devopsClient companyId-aware ────────────────');
const client = read('server/lib/devopsClient.js');
const clientCode = strip(client);
expect('5.1 getConfig async + opts.companyId',
  /async function getConfig\(\{ companyId \} = \{\}\)/.test(clientCode), true);
expect('5.2 DB-first lookup (dynamic import)',
  /externalDevOpsSettingRepository\.js[\s\S]{0,300}resolveActiveConfig\(companyId\)/.test(clientCode), true);
expect('5.3 disabled = throw tfs_integration_disabled 503 (env\'e DÜŞME)',
  /dbConfig\.enabled === false[\s\S]{0,300}tfs_integration_disabled[\s\S]{0,200}status: 503/.test(clientCode), true);
expect('5.4 env fallback dbConfig?.baseUrl || process.env.TFS_BASE_URL',
  /dbConfig\?\.baseUrl \|\| process\.env\.TFS_BASE_URL/.test(clientCode), true);
expect('5.5 env fallback pat dbConfig?.pat || process.env.TFS_PAT',
  /dbConfig\?\.pat \|\| process\.env\.TFS_PAT/.test(clientCode), true);
expect('5.6 getWorkItem(id, opts) — companyId iletilir',
  /getWorkItem\(id, opts = \{\}\)[\s\S]{0,500}companyId: opts\.companyId/.test(clientCode), true);
expect('5.7 getWorkItems(ids, opts) — companyId iletilir',
  /export async function getWorkItems\(ids, opts = \{\}\)/.test(clientCode)
    && /export async function getWorkItems\(ids, opts = \{\}\)[\s\S]*?companyId: opts\.companyId/.test(clientCode), true);
expect('5.8 tfsRequest getConfig hata → wrapped ok:false (500 atmaz)',
  /async function tfsRequest\(\{ path, method = 'GET', body, companyId \}\)[\s\S]{0,800}try \{\s*config = await getConfig\(\{ companyId \}\)/.test(clientCode), true);

console.log('\n── 6) caseRepository — link/unlink/listLive companyId iletir ───');
const caseRepo = read('server/db/caseRepository.js');
const caseCode = strip(caseRepo);
expect('6.1 linkDevops getWorkItem(workItemId, { companyId })',
  /devopsClient\.getWorkItem\(workItemId, \{ companyId \}\)/.test(caseCode), true);
expect('6.2 listDevopsLive chunk getWorkItems(c, { companyId })',
  /devopsClient\.getWorkItems\(c, \{ companyId \}\)/.test(caseCode), true);
expect('6.3 linkDevops disabled=503 error mapping',
  /tfs_integration_disabled' \? 503/.test(caseCode), true);

console.log('\n── 7) AdminExternalDevOpsPage — WRITE-ONLY PAT widget ───');
const page = read('src/features/admin/AdminExternalDevOpsPage.tsx');
const pageCode = strip(page);
expect('7.1 PAT input WRITE-ONLY (default kapalı; editingPat toggle)',
  /editingPat:\s*boolean/.test(pageCode)
    && /editingPat:\s*false,/.test(pageCode), true);
expect('7.2 toPatch — pat yalnız editingPat && trim().length > 0 ise eklenir',
  /if \(d\.editingPat && d\.patInput\.trim\(\)\.length > 0\) \{\s*patch\.pat = d\.patInput\.trim\(\)/.test(pageCode), true);
expect('7.3 "Değiştir" button (patIsSet ise) / "PAT gir" (yoksa)',
  /setting\?\.patIsSet \? 'Değiştir' : 'PAT gir'/.test(pageCode), true);
expect('7.4 PAT input type="password" autoComplete="new-password"',
  /type="password"[\s\S]{0,80}autoComplete="new-password"/.test(pageCode), true);
expect('7.5 Bağlantı testi button + adminService.externalDevOpsSettings.test',
  /adminService\.externalDevOpsSettings\.test\(companyId\)/.test(pageCode), true);
expect('7.6 PAT plain text init state empty string',
  /patInput:\s*'',/.test(pageCode), true);

console.log('\n── 8) adminService — ExternalDevOps types/calls ───');
const svc = read('src/services/adminService.ts');
expect('8.1 ExternalDevOpsSetting interface patIsSet yes / pat NO',
  /export interface ExternalDevOpsSetting \{[\s\S]{0,800}patIsSet:\s*boolean/.test(svc)
    && /export interface ExternalDevOpsSetting \{[\s\S]{0,800}pat:\s*string/.test(svc) === false, true);
expect('8.2 ExternalDevOpsSettingInput pat opsiyonel',
  /export interface ExternalDevOpsSettingInput \{[\s\S]{0,400}pat\?\:\s*string;/.test(svc), true);
expect('8.3 service entry externalDevOpsSettings.get/save/test',
  /externalDevOpsSettings:\s*\{[\s\S]{0,1500}async get\(/.test(svc)
    && /externalDevOpsSettings:[\s\S]{0,2000}async save\(/.test(svc)
    && /externalDevOpsSettings:[\s\S]{0,2500}async test\(/.test(svc), true);

console.log('\n── 9) .env.example DEVOPS_PAT_ENC_KEY placeholder ───');
const envEx = read('.env.example');
expect('9.1 DEVOPS_PAT_ENC_KEY placeholder var',
  /DEVOPS_PAT_ENC_KEY=replace_with_base64_32byte_key/.test(envEx), true);
expect('9.2 openssl rand notu var',
  /openssl rand -base64 32/.test(envEx), true);

console.log('\n── 10) AdminLayout — yeni view kaydı ───────────────');
const layout = read('src/features/admin/AdminLayout.tsx');
expect('10.1 AdminView union admin-external-devops içerir',
  /'admin-external-devops'/.test(layout), true);
expect('10.2 NAV entry "DevOps / TFS Entegrasyonu" + GitBranch icon',
  /admin-external-devops[\s\S]{0,100}DevOps \/ TFS Entegrasyonu[\s\S]{0,100}GitBranch/.test(layout), true);

console.log('\n────────────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
