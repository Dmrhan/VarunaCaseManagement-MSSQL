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
// devopsClient.getWorkItem doğrulama (Faz 2.1 — companyId opts ile)
expect('2.12 linkDevops devopsClient.getWorkItem doğrulama (companyId)',
  /devopsClient\.getWorkItem\(workItemId, \{ companyId \}\)/.test(repoCode), true);
// Batch live için getWorkItems (Fix 3 chunk + Faz 2.1 companyId)
expect('2.13 listDevopsLive devopsClient.getWorkItems batch (chunk + companyId)',
  /devopsClient\.getWorkItems\(c, \{ companyId \}\)/.test(repoCode), true);
// Fallback stale işareti
expect('2.14 listDevopsLive TFS down → stale: true + snapshot fallback',
  /items:\s*stored\.map\(\(entry\) => \(\{ \.\.\.entry, _stale:\s*true \}\)\)[\s\S]{0,400}stale:\s*true/.test(repoCode), true);

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

console.log('\n── 5) PR-D3 — Service + UI section ───────────────────');
const svc = read('src/services/devopsService.ts');
expect('5.1 devopsService.getItems',
  /async getItems\(caseId: string\): Promise<DevopsItemsResponse \| undefined>/.test(svc), true);
expect('5.2 devopsService.link(caseId, workItemRef)',
  /async link\(caseId: string, workItemRef: string \| number\)/.test(svc), true);
expect('5.3 devopsService.unlink(caseId, workItemId)',
  /async unlink\(caseId: string, workItemId: number\)/.test(svc), true);
expect('5.4 devopsService BFF endpoint URLs (devops-items / devops-link)',
  /devops-items/.test(svc) && /devops-link/.test(svc), true);
expect('5.5 devopsService TFS\'e doğrudan çağrı YOK (sadece /api/cases/...)',
  /unitfs|TFS_BASE_URL|tfs\.\w+/.test(svc), false);

const section = read('src/features/cases/components/DevOpsSection.tsx');
const sectionCode = strip(section);
expect('5.6 DevOpsSection bileşeni export',
  /export function DevOpsSection\(\{ caseId, canWrite \}: DevOpsSectionProps\)/.test(sectionCode), true);
expect('5.7 FIELD_TR_LABELS 13 alan (id/title/state/url üst başlıkta)',
  /const FIELD_TR_LABELS: Array<\{ key: keyof DevopsItem; label: string \}>/.test(sectionCode), true);
const labelCount = (sectionCode.match(/key: '\w+', label: '/g) ?? []).length;
expect('5.8 FIELD_TR_LABELS toplam 13 entry',
  labelCount === 13, true, `bulunan=${labelCount}`);
expect('5.9 devopsService.getItems mount\'ta çağrılır',
  /devopsService\.getItems\(caseId\)/.test(sectionCode), true);
expect('5.10 Bağla modal — link çağrısı',
  /devopsService\.link\(caseId, ref\)/.test(sectionCode), true);
expect('5.11 Kaldır — unlink çağrısı',
  /devopsService\.unlink\(caseId, id\)/.test(sectionCode), true);
expect('5.12 canWrite gating (Bağla/Kaldır gizli read-only rolde)',
  /\{canWrite && items\.length > 0/.test(sectionCode) && /canWrite && \(\s*<Button/.test(sectionCode), true);
expect('5.13 Stale rozet (TFS down — Sync hatası)',
  /Sync hatası/.test(sectionCode), true);
expect('5.14 item\._stale → opacity-60 (sönük)',
  /item\._stale \? 'opacity-60'/.test(sectionCode), true);
expect('5.15 "DevOps\'ta aç" external link (target=_blank)',
  /target="_blank"/.test(sectionCode) && /DevOps'ta aç/.test(sectionCode), true);
expect('5.16 PR-D3 SERBESTMETİN sızıntı yok (Description/ReproSteps okuma yok)',
  /Description|ReproSteps/.test(sectionCode), false);

const detail = read('src/features/cases/CaseDetailPage.tsx');
const detailCode = strip(detail);
expect('5.17 CaseDetailPage DevOpsSection import',
  /import \{ DevOpsSection \} from '\.\/components\/DevOpsSection'/.test(detailCode), true);
expect('5.18 DevOpsSection DetailTab içinde render (Atama sonrası)',
  /<DevOpsSection caseId=\{item\.id\} canWrite=\{canWriteCase\}\s*\/>/.test(detailCode), true);
expect('5.19 canWriteCase = Agent+ rolleri',
  /canWriteCase\s*=[\s\S]{0,200}'Agent',\s*'Backoffice',\s*'CSM',\s*'Supervisor',\s*'Admin',\s*'SystemAdmin'/.test(detailCode), true);

console.log('\n── 6) Jira stub kaldırıldı (TBD-12) ──────────────────');
// MenuAction label="Jira'ya Aktar" silindi — kebab menüde Jira yok.
expect('6.1 "Jira\'ya Aktar" MenuAction kaldırıldı',
  /label="Jira'ya Aktar"/.test(detail), false);
expect('6.2 "Jira entegrasyonu FAZ 2" toast mesajı kalmadı',
  /Jira entegrasyonu FAZ 2/.test(detail), false);

console.log('\n── 7) Codex P2 pre-main fix\'leri ─────────────────────');

// Fix 1 — $expand=all CODE PATH'inden kayboldu; fields= allowlist URL'lerinde.
// Comment'lerde geçebilir (eski/yeni karşılaştırma açıklaması).
expect('7.1 server/ code path $expand=all KALDIRILDI (request-level allowlist)',
  /\$expand=all/.test(clientCode), false);
expect('7.2 devopsClient FIELDS_QUERY_PARAM allowlist (FIELD_MAP.values)',
  /const FIELDS_QUERY_PARAM = \(\(\) => \{[\s\S]{0,300}Object\.values\(FIELD_MAP\)/.test(clientCode), true);
expect('7.3 getWorkItem URL fields= kullanır',
  /workitems\/\$\{encodeURIComponent\(id\)\}\?fields=\$\{FIELDS_QUERY_PARAM\}/.test(clientCode), true);
expect('7.4 getWorkItems URL fields= kullanır',
  /workitems\?ids=\$\{idsParam\}&fields=\$\{FIELDS_QUERY_PARAM\}/.test(clientCode), true);

// Fix 2 — Atomik mutate helper + linkDevops/unlinkDevops kullanır
const repoSrc = read('server/db/caseRepository.js');
const repoSrcCode = strip(repoSrc);
expect('7.5 atomicMutateDevopsArray helper + updateMany updatedAt guard',
  /async function atomicMutateDevopsArray\(caseId, mutate\)[\s\S]{0,1500}prisma\.case\.updateMany\(\{\s*where: \{ id: caseId, updatedAt: current\.updatedAt \}/.test(repoSrcCode), true);
expect('7.6 retry mechanism (MAX_RETRIES + 409 devops_concurrent_update)',
  /DEVOPS_MUTATE_MAX_RETRIES/.test(repoSrcCode)
    && /devops_concurrent_update/.test(repoSrcCode), true);
expect('7.7 linkDevops atomicMutateDevopsArray kullanır',
  /async linkDevops[\s\S]{0,3000}atomicMutateDevopsArray\(caseId, \(arr\)/.test(repoSrcCode), true);
expect('7.8 unlinkDevops atomicMutateDevopsArray kullanır',
  /async unlinkDevops[\s\S]{0,2000}atomicMutateDevopsArray\(caseId, \(arr\)/.test(repoSrcCode), true);
expect('7.9 link/unlink eski naïve $transaction read-modify-write KALDIRILDI',
  /await prisma\.\$transaction\(\[[\s\S]{0,500}prisma\.case\.update\(\{[\s\S]{0,200}data: \{ customFields:/.test(repoSrcCode), false);

// Fix 3 — listDevopsLive chunk ≤100 + try/catch fallback
expect('7.10 DEVOPS_LIVE_CHUNK = 100',
  /DEVOPS_LIVE_CHUNK = 100/.test(repoSrcCode), true);
expect('7.11 listDevopsLive Promise.all chunks (Faz 2.1: companyId opts)',
  /Promise\.all\(\s*chunks\.map\(\(c\) => devopsClient\.getWorkItems\(c, \{ companyId \}\)\)/.test(repoSrcCode), true);
expect('7.12 listDevopsLive try/catch sarmalı (500 yok, stale fallback)',
  /try \{[\s\S]{0,1500}Promise\.all\([\s\S]{0,200}chunks[\s\S]{0,800}\} catch \(err\) \{[\s\S]{0,400}devops_live_unexpected_error/.test(repoSrcCode), true);
expect('7.13 listDevopsLive herhangi chunk fail → stale fallback (firstFail check)',
  /const firstFail = results\.find\(\(r\) => !r\.ok\)/.test(repoSrcCode), true);

// Codex P2 fix — DevOpsSection monotonic request token + caseId reset.
// Eski `requestedCaseIdRef` self-reset bug'ı (handleLink/Unlink sonrası
// eski closure'ın `void load()` çağrısı kendi ref'ini güncelliyordu) için
// monotonic counter pattern'ine geçildi. Stale closure'lar token okur,
// artıramaz (ref'i kendine açamaz).
const sectionSrc = read('src/features/cases/components/DevOpsSection.tsx');
const sectionSrcCode = strip(sectionSrc);
expect('7.14 DevOpsSection requestTokenRef monotonic counter',
  /requestTokenRef = useRef\(0\)/.test(sectionSrcCode), true);
expect('7.15 load() monotonic token guard (++ + check)',
  /const myToken = \+\+requestTokenRef\.current/.test(sectionSrcCode)
    && /if \(requestTokenRef\.current !== myToken\) return/.test(sectionSrcCode), true);
expect('7.16 caseId değişince token++ + setData(null) — eski in-flight invalidate',
  /useEffect\(\(\) => \{\s*requestTokenRef\.current \+= 1;\s*setData\(null\)[\s\S]{0,400}void load\(\);\s*\}, \[caseId, load\]\)/.test(sectionSrcCode), true);
expect('7.17 caseId değişince modal/linkInput/unlinkingId reset',
  /setLinkModalOpen\(false\);\s*setLinkInput\(''\);\s*setUnlinkingId\(null\);/.test(sectionSrcCode), true);
// Codex P1 fix (#153 sonrası) — currentCaseIdRef ile early-return.
// Sadece monotonic token bug'ı tam çözmüyordu: handleLink completion'da
// eski A closure ++token yapıp kendine yeni en yüksek token alıyordu →
// A response guard'ı geçiyordu, B response discard ediliyordu.
// currentCaseIdRef useEffect ile **prop'tan** sync edilir; closure'lar
// OKUR, asla yazamaz → eski closure'lar load başlamadan early-return.
expect('7.18 currentCaseIdRef prop\'tan sync (closure-immune)',
  /currentCaseIdRef = useRef\(caseId\)/.test(sectionSrcCode), true);
expect('7.19 useEffect(caseId) currentCaseIdRef.current = caseId (sync)',
  /useEffect\(\(\) => \{\s*currentCaseIdRef\.current = caseId;\s*\}, \[caseId\]\)/.test(sectionSrcCode), true);
expect('7.20 load() başında early-return: currentCaseIdRef.current !== caseId',
  /if \(currentCaseIdRef\.current !== caseId\) return/.test(sectionSrcCode), true);
// Eski (artık relevant olmayan) requestedCaseIdRef pattern'i KALMADI
expect('7.21 eski requestedCaseIdRef kullanımı KALDIRILDI',
  /requestedCaseIdRef/.test(sectionSrcCode), false);

console.log('\n────────────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
