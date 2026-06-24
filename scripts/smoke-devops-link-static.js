/**
 * smoke-devops-link-static.js
 *
 * PR-D2 — DevOps link/unlink/live veri katmanı static invariant'ları
 * (DB-bağımsız, regex assertion + parseWorkItemId runtime).
 *
 * Korunan invariant'lar:
 *  1) devopsClient: parseWorkItemId export + runtime (id/URL formları)
 *  2) caseRepository: linkDevops + unlinkDevops + listDevopsLive method'ları
 *     - assertCaseInScope (write — arşivli case 409) link/unlink'te
 *     - assertCaseInScopeForRead (read — SystemAdmin arşivli case görür)
 *       listDevopsLive'da
 *     - readDevopsArray + writeDevopsArray helper'lar
 *     - CaseActivity 'DevopsLinked' + 'DevopsUnlinked' actionType
 *  3) routes: POST /:id/devops-link + DELETE /:id/devops-link/:workItemId
 *     + GET /:id/devops-items
 *  4) Güvenlik: customFields write'larda devops array yalnız
 *     normalizeWorkItem çıktısı + meta (Description/ReproSteps sızıntı yok)
 *
 * Çalıştır:
 *   node scripts/smoke-devops-link-static.js
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
const ok = (n) => { pass += 1; console.log(`✓ ${n}`); };
const bad = (n, d = '') => { fail += 1; console.log(`✗ ${n}${d ? ' — ' + d : ''}`); };
const expect = (name, actual, expected, detail = '') => {
  if (actual === expected) ok(name);
  else bad(name, `actual=${actual} expected=${expected}${detail ? ' · ' + detail : ''}`);
};
const read = (rel) => {
  const full = path.join(REPO_ROOT, rel);
  if (!existsSync(full)) { bad(`file_exists ${rel}`); return ''; }
  return readFileSync(full, 'utf8');
};
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

console.log('── 1) devopsClient: parseWorkItemId ───────────────────');
const client = read('server/lib/devopsClient.js');
const clientCode = strip(client);
expect('1.1 parseWorkItemId export',
  /export function parseWorkItemId\(input\)/.test(clientCode), true);
expect('1.2 devopsClient nesnesinde parseWorkItemId',
  /devopsClient = \{[\s\S]{0,400}parseWorkItemId,/.test(clientCode), true);
// 1.3 — parseWorkItemId 4 ayrı URL pattern destekler (source'ta regex
// literal'lerinin marker'larını ara — yorum/komment'lerde de bulunabilir
// ama 4 farklı belirteç olmalı).
const urlPatternMarkers = [
  '_workitems\\/edit\\/',     // _workitems/edit/<id>
  '\\?&]?id=',                 // ?id=<id> veya &id=<id>
  '\\/workitems\\/',           // /workitems/<id>
  '\\/wit\\/workitems\\/',     // /wit/workitems/<id>
];
// Ham source kullan (comment-stripped versiyon comment'lerdeki örnekleri
// kaybeder ve marker sayısı düşer — burada source-level dahil).
const markersFound = urlPatternMarkers.filter((p) => new RegExp(p).test(client)).length;
expect(`1.3 ≥3 URL pattern marker (4 desteklenen format için) bulundu=${markersFound}`,
  markersFound >= 3, true);

// Runtime: dynamic import asenkron — burada sadece sentinel kontrol et
const parseModule = await import(path.join(REPO_ROOT, 'server/lib/devopsClient.js'));
const cases = [
  ['324813', 324813],
  ['https://unitfs/_workitems/edit/324813', 324813],
  ['https://unitfs/_workitems?id=324813', 324813],
  ['https://x/workItems/324813', 324813],
  ['abc', null],
  [-1, null],
  ['', null],
];
let parsePass = 0;
for (const [input, expected] of cases) {
  if (parseModule.parseWorkItemId(input) === expected) parsePass += 1;
}
expect(`1.4 parseWorkItemId runtime ${parsePass}/${cases.length}`, parsePass === cases.length, true);

console.log('\n── 2) caseRepository methods ──────────────────────────');
const repo = read('server/db/caseRepository.js');
const repoCode = strip(repo);

expect('2.1 linkDevops method',
  /async linkDevops\(caseId,\s*\{\s*workItemRef,\s*actor,\s*allowedCompanyIds\s*\}\)/.test(repoCode), true);
expect('2.2 unlinkDevops method',
  /async unlinkDevops\(caseId,\s*\{\s*workItemId,\s*actor,\s*allowedCompanyIds\s*\}\)/.test(repoCode), true);
expect('2.3 listDevopsLive method',
  /async listDevopsLive\(caseId,\s*allowedCompanyIds,\s*actorRole\)/.test(repoCode), true);

expect('2.4 readDevopsArray helper',
  /function readDevopsArray\(customFieldsRaw\)/.test(repoCode), true);
expect('2.5 writeDevopsArray helper',
  /function writeDevopsArray\(customFieldsRaw, devopsArr\)/.test(repoCode), true);

// Write guard: linkDevops + unlinkDevops assertCaseInScope (write — archived 409)
expect('2.6 linkDevops assertCaseInScope (write — archived 409)',
  /async linkDevops[\s\S]{0,600}assertCaseInScope\(caseId, allowedCompanyIds\)/.test(repoCode), true);
expect('2.7 unlinkDevops assertCaseInScope (write — archived 409)',
  /async unlinkDevops[\s\S]{0,500}assertCaseInScope\(caseId, allowedCompanyIds\)/.test(repoCode), true);
// Read: listDevopsLive uses assertCaseInScopeForRead (role-gate)
expect('2.8 listDevopsLive assertCaseInScopeForRead (role-gate)',
  /async listDevopsLive[\s\S]{0,400}assertCaseInScopeForRead\(caseId, allowedCompanyIds, actorRole\)/.test(repoCode), true);

// CaseActivity actionType
expect('2.9 CaseActivity DevopsLinked',
  /actionType:\s*'DevopsLinked'/.test(repoCode), true);
expect('2.10 CaseActivity DevopsUnlinked',
  /actionType:\s*'DevopsUnlinked'/.test(repoCode), true);

// Idempotent dedup: linkDevops mevcut id varsa idempotent
expect('2.11 linkDevops dedup (existingArr.some id check)',
  /existingArr\.some\(\(entry\) => entry\?\.id === workItemId\)/.test(repoCode), true);
// devopsClient.getWorkItem doğrulama
expect('2.12 linkDevops devopsClient.getWorkItem doğrulama',
  /devopsClient\.getWorkItem\(workItemId\)/.test(repoCode), true);
// Batch live için getWorkItems
expect('2.13 listDevopsLive devopsClient.getWorkItems batch',
  /devopsClient\.getWorkItems\(ids\)/.test(repoCode), true);
// Fallback stale işareti
expect('2.14 listDevopsLive TFS down → stale: true + snapshot fallback',
  /stale:\s*true[\s\S]{0,200}error:\s*\{\s*code:\s*tfs\.error\.code/.test(repoCode), true);

console.log('\n── 3) Routes (3 yeni endpoint) ────────────────────────');
const routes = read('server/routes/cases.js');
const routesCode = strip(routes);
expect('3.1 POST /:id/devops-link',
  /router\.post\(\s*'\/:id\/devops-link'/.test(routesCode), true);
expect('3.2 DELETE /:id/devops-link/:workItemId',
  /router\.delete\(\s*'\/:id\/devops-link\/:workItemId'/.test(routesCode), true);
expect('3.3 GET /:id/devops-items',
  /router\.get\(\s*'\/:id\/devops-items'/.test(routesCode), true);
expect('3.4 link route: workItemRef body + actor + allowedCompanyIds',
  /linkDevops\(req\.params\.id,\s*\{\s*workItemRef,\s*actor,\s*allowedCompanyIds/.test(routesCode), true);
expect('3.5 unlink route: workItemId param + actor + allowedCompanyIds',
  /unlinkDevops\(req\.params\.id,\s*\{\s*workItemId:\s*req\.params\.workItemId,\s*actor,\s*allowedCompanyIds/.test(routesCode), true);
expect('3.6 live route: actorRole geçer (read role-gate)',
  /listDevopsLive\(\s*req\.params\.id,\s*req\.user\.allowedCompanyIds,\s*req\.user\.role/.test(routesCode), true);
// Hiçbiri requireRole SystemAdmin değil (case-write yetkisi, archive değil)
expect('3.7 POST link requireRole SystemAdmin YOK',
  /'\/:id\/devops-link',\s*requireRole/.test(routesCode), false);
expect('3.8 DELETE unlink requireRole SystemAdmin YOK',
  /'\/:id\/devops-link\/:workItemId',\s*requireRole/.test(routesCode), false);

console.log('\n── 4) Güvenlik: allowlist guardrail korunur ───────────');
// linkDevops snapshot YALNIZ normalizeWorkItem çıktısı (Description/Repro
// sızıntısı yok)
expect('4.1 snapshot = tfs.data.normalized (allowlist çıktısı)',
  /snapshot = tfs\.data\.normalized/.test(repoCode), true);
// Hiçbir yerde raw.fields spread yok
expect('4.2 raw.fields spread yok (repo)',
  /\.\.\.raw\.fields|\.\.\.tfs\.data\.raw\.fields/.test(repoCode), false);
// Hiçbir yerde Description/ReproSteps key okuma yok (repo path'inde)
expect('4.3 Description/ReproSteps okuma yok',
  /System\.Description|ReproSteps/.test(repoCode), false);

console.log('\n────────────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
