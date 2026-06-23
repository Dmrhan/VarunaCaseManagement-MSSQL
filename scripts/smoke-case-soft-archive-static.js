/**
 * smoke-case-soft-archive-static.js
 *
 * PR-SD — Case soft-archive static invariant'ları (DB-bağımsız, regex assertion).
 *
 * Korunan invariant'lar:
 *  1) Schema: Case'te 4 alan + FK + index
 *  2) Migration dosyası mevcut
 *  3) Repository: archive() + restore() method'ları
 *     - reason min 3 char validation (archive)
 *     - CaseActivity 'Archived' / 'Restored' actionType
 *     - buildWhere default exclude isArchived: false
 *     - get(id, allowedCompanyIds, actorRole) rol-aware guard
 *  4) Routes: POST /:id/archive + /:id/restore, ikisi requireRole('SystemAdmin')
 *  5) Service: archive(id, reason) + restore(id)
 *  6) Types: Case interface + label map
 *  7) UI: CaseDetailPage canArchive + handleArchive + handleRestore;
 *        CasesListPage SystemAdmin filter chip
 *
 * Çalıştır:
 *   node scripts/smoke-case-soft-archive-static.js
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

console.log('── 1) Schema + migration ──────────────────────────────');
const schema = read('prisma/schema.prisma');
expect('1.1 Case.isArchived Boolean default false',
  /isArchived\s+Boolean\s+@default\(false\)/.test(schema), true);
expect('1.2 Case.archivedAt DateTime nullable',
  /archivedAt\s+DateTime\?/.test(schema), true);
expect('1.3 Case.archivedByUserId String nullable',
  /archivedByUserId\s+String\?\s+@db\.NVarChar\(450\)/.test(schema), true);
expect('1.4 Case.archiveReason String nullable',
  /archiveReason\s+String\?\s+@db\.NVarChar\(Max\)/.test(schema), true);
expect('1.5 Case archivedByUser relation',
  /archivedByUser User\?\s+@relation\("CaseArchivedBy"/.test(schema), true);
expect('1.6 Case @@index([companyId, isArchived])',
  /@@index\(\[companyId, isArchived\]\)/.test(schema), true);
expect('1.7 User back-relation casesArchived',
  /casesArchived\s+Case\[\]\s+@relation\("CaseArchivedBy"\)/.test(schema), true);

const migration = read('prisma/migrations/00000000000007_case_soft_archive/migration.sql');
expect('1.8 Migration BEGIN TRY wrapper',
  /BEGIN TRY[\s\S]+BEGIN TRAN[\s\S]+COMMIT TRAN[\s\S]+ROLLBACK TRAN/.test(migration), true);
expect('1.9 Migration ADD isArchived BIT DEFAULT 0',
  /ADD \[isArchived\] BIT NOT NULL CONSTRAINT \[DF_Case_isArchived\] DEFAULT 0/.test(migration), true);
expect('1.10 Migration ADD archivedAt + archivedByUserId + archiveReason',
  /ADD \[archivedAt\] DATETIME2 NULL[\s\S]+ADD \[archivedByUserId\] NVARCHAR\(450\) NULL[\s\S]+ADD \[archiveReason\] NVARCHAR\(MAX\) NULL/.test(migration), true);
expect('1.11 Migration FK archivedByUserId → User',
  /CONSTRAINT \[Case_archivedByUserId_fkey\][\s\S]+FOREIGN KEY \(\[archivedByUserId\]\) REFERENCES \[dbo\]\.\[User\]/.test(migration), true);
expect('1.12 Migration index Case_companyId_isArchived_idx',
  /CREATE NONCLUSTERED INDEX \[Case_companyId_isArchived_idx\]/.test(migration), true);

console.log('\n── 2) Repository: archive/restore/buildWhere/get ──────');
const repo = read('server/db/caseRepository.js');
const repoCode = strip(repo);

expect('2.1 archive method async signature',
  /async archive\(id,\s*\{\s*reason,\s*actor,\s*allowedCompanyIds\s*\}\)/.test(repoCode), true);
expect('2.2 restore method async signature',
  /async restore\(id,\s*\{\s*actor,\s*allowedCompanyIds\s*\}\)/.test(repoCode), true);
expect('2.3 archive reason min 3 char validation',
  /trimmedReason\.length < 3[\s\S]{0,300}archive_reason_required/.test(repoCode), true);
expect('2.4 archive CaseActivity actionType: "Archived"',
  /actionType:\s*'Archived'/.test(repoCode), true);
expect('2.5 restore CaseActivity actionType: "Restored"',
  /actionType:\s*'Restored'/.test(repoCode), true);
expect('2.6 archive transaction (prisma.$transaction)',
  /async archive[\s\S]{0,2500}prisma\.\$transaction/.test(repoCode), true);
expect('2.7 restore transaction',
  /async restore[\s\S]{0,2500}prisma\.\$transaction/.test(repoCode), true);
expect('2.8 buildWhere default exclude isArchived: false',
  /if \(!f\.includeArchived\) \{\s*andClauses\.push\(\{ isArchived: false \}\)/.test(repoCode), true);
expect('2.9 get rol-aware guard (actorRole !== SystemAdmin → null)',
  /c\.isArchived && actorRole !== 'SystemAdmin'/.test(repoCode), true);
expect('2.10 CASE_INCLUDE archivedByUser select',
  /archivedByUser:\s*\{\s*select:\s*\{\s*id:\s*true,\s*fullName:\s*true\s*\}\s*\}/.test(repoCode), true);
expect('2.11 shape() archivedByUserName flat',
  /archivedByUserName:\s*archivedByUser\?\.fullName \?\? null/.test(repoCode), true);

console.log('\n── 3) Routes: POST /:id/archive + /:id/restore ────────');
const routes = read('server/routes/cases.js');
const routesCode = strip(routes);

expect('3.1 POST /:id/archive route',
  /router\.post\(\s*'\/:id\/archive',\s*requireRole\('SystemAdmin'\)/.test(routesCode), true);
expect('3.2 POST /:id/restore route',
  /router\.post\(\s*'\/:id\/restore',\s*requireRole\('SystemAdmin'\)/.test(routesCode), true);
expect('3.3 archive route: reason body + actor + allowedCompanyIds',
  /caseRepository\.archive\(req\.params\.id,\s*\{\s*reason,\s*actor,\s*allowedCompanyIds/.test(routesCode), true);
expect('3.4 restore route: actor + allowedCompanyIds (reason yok)',
  /caseRepository\.restore\(req\.params\.id,\s*\{\s*actor,\s*allowedCompanyIds/.test(routesCode), true);
expect('3.5 GET /:id rol-aware (req.user.role parametre)',
  /caseRepository\.get\(req\.params\.id,\s*req\.user\.allowedCompanyIds,\s*req\.user\.role\)/.test(routesCode), true);
expect('3.6 list filter: includeArchived sadece SystemAdmin (rol guard)',
  /includeArchived:\s*f\.includeArchived === 'true' && req\.user\.role === 'SystemAdmin'\s*\?\s*true\s*:\s*undefined/.test(routesCode), true);

console.log('\n── 4) Service + Types ─────────────────────────────────');
const svc = read('src/services/caseService.ts');
expect('4.1 caseService.archive(caseId, reason)',
  /async archive\(caseId: string, reason: string\): Promise<Case \| undefined>/.test(svc), true);
expect('4.2 caseService.restore(caseId)',
  /async restore\(caseId: string\): Promise<Case \| undefined>/.test(svc), true);
expect('4.3 archive POST URL',
  /\$\{API_BASE\}\/\$\{caseId\}\/archive/.test(svc), true);
expect('4.4 restore POST URL',
  /\$\{API_BASE\}\/\$\{caseId\}\/restore/.test(svc), true);
expect('4.5 list URL includeArchived flag',
  /filters\?\.includeArchived\) params\.set\('includeArchived', 'true'\)/.test(svc), true);

const types = read('src/features/cases/types.ts');
expect('4.6 Case.isArchived?: boolean',
  /isArchived\?:\s*boolean/.test(types), true);
expect('4.7 Case.archivedAt + archivedByUserName + archiveReason',
  /archivedAt\?:\s*string;[\s\S]{0,300}archivedByUserName\?:\s*string;[\s\S]{0,300}archiveReason\?:\s*string;/.test(types), true);
expect('4.8 CaseFilters.includeArchived',
  /includeArchived\?:\s*boolean/.test(types), true);
expect('4.9 CASE_FIELD_LABELS isArchived + archivedAt + archivedByUserName + archiveReason',
  /isArchived:\s+'Arşivli'[\s\S]{0,300}archivedAt:\s+'Arşiv Tarihi'[\s\S]{0,300}archivedByUserName:\s+'Arşivleyen'[\s\S]{0,300}archiveReason:\s+'Arşiv Sebebi'/.test(types), true);

console.log('\n── 5) UI: CaseDetailPage + CasesListPage ──────────────');
const detail = read('src/features/cases/CaseDetailPage.tsx');
const detailCode = strip(detail);
expect('5.1 canArchive = SystemAdmin',
  /canArchive = user\?\.role === 'SystemAdmin'/.test(detailCode), true);
expect('5.2 handleArchive function (reason min 3 char)',
  /async function handleArchive\(\)[\s\S]{0,500}reason\.length < 3/.test(detailCode), true);
expect('5.3 handleRestore function',
  /async function handleRestore\(\)/.test(detailCode), true);
expect('5.4 Kebab menü "Arşivle" item (canArchive + !isArchived)',
  /\{canArchive && !item\.isArchived && \(\s*<MenuAction\s*label="Arşivle"/.test(detailCode), true);
expect('5.5 Archived banner conditional + "Bu vaka arşivlendi" metni',
  /\{item\.isArchived && \(/.test(detailCode) && /Bu vaka arşivlendi/.test(detailCode), true);
expect('5.6 Restore button banner içinde + "Geri Yükle" metni',
  /void handleRestore\(\)/.test(detailCode) && /Geri Yükle/.test(detailCode), true);
expect('5.7 Archive icon import',
  /^\s*Archive,/m.test(detailCode), true);
expect('5.8 Modal arşiv reason zorunlu (length < 3 disabled)',
  /archiveReason\.trim\(\)\.length < 3/.test(detailCode), true);

const list = read('src/features/cases/CasesListPage.tsx');
const listCode = strip(list);
expect('5.9 List filter chip SystemAdmin only',
  /user\?\.role === 'SystemAdmin' && \(\s*<FilterPanelSection label="Arşiv">/.test(listCode), true);
expect('5.10 List filter includeArchived checkbox',
  /checked=\{filters\.includeArchived === true\}/.test(listCode), true);
expect('5.11 List useEffect deps includeArchived',
  /filters\.includeArchived,?\s*\]/.test(listCode), true);

console.log('\n── 6) Codex P1 — generic PATCH archive field guard ─────');
expect('6.1 ARCHIVE_FIELDS guard array (4 alan)',
  /ARCHIVE_FIELDS = \['isArchived',\s*'archivedAt',\s*'archivedByUserId',\s*'archiveReason'\]/.test(repoCode), true);
expect('6.2 update() loop throws CaseValidationError on archive field',
  /for \(const field of ARCHIVE_FIELDS\)[\s\S]{0,400}archive_field_immutable/.test(repoCode), true);
expect('6.3 guard 400 status code',
  /status:\s*400,\s*code:\s*'archive_field_immutable'/.test(repoCode), true);
// Pattern guard: update() içinde arşiv alanları HİÇBİR data spread'inde olmasın.
// Yani `data: { ...patch }` veya `data: { isArchived: ... }` kalıbı sadece
// archive()/restore() içinde geçer.
const dataAssignsArchive = (repoCode.match(/data:\s*\{[\s\S]{0,400}isArchived:/g) ?? []).length;
expect('6.4 isArchived data assign sadece archive/restore içinde (en fazla 2 yerde)',
  dataAssignsArchive <= 2, true, `bulunan=${dataAssignsArchive}`);

console.log('\n── 7) Codex P2 round-2 ────────────────────────────────');
// P2.1 — TÜM caseRepository.get çağrılarında req.user.role 3. parametre
const allGetCalls = (routesCode.match(/caseRepository\.get\(/g) ?? []).length;
const withRole = (routesCode.match(/caseRepository\.get\(req\.params\.id, req\.user\.allowedCompanyIds, req\.user\.role\)/g) ?? []).length;
expect('7.1 caseRepository.get çağrı sayısı (genel)', allGetCalls > 0, true, `bulunan=${allGetCalls}`);
expect('7.2 TÜM caseRepository.get çağrıları req.user.role ile (P2.1)',
  withRole === allGetCalls, true, `withRole=${withRole}/${allGetCalls}`);

// P2.2 — assertCaseInScope arşivli case için throw (write guard)
expect('7.3 assertCaseInScope { allowArchived = false } parametre',
  /async function assertCaseInScope\(caseId, allowedCompanyIds, \{ allowArchived = false \} = \{\}\)/.test(repoCode), true);
expect('7.4 assertCaseInScope select isArchived: true',
  /select:\s*\{\s*id:\s*true,\s*companyId:\s*true,\s*isArchived:\s*true\s*\}/.test(repoCode), true);
expect('7.5 assertCaseInScope archived + !allowArchived → throw 409',
  /found\.isArchived && !allowArchived[\s\S]{0,400}case_archived_readonly/.test(repoCode), true);
expect('7.6 archive() allowArchived: true (idempotent için)',
  /async archive[\s\S]{0,500}assertCaseInScope\(id, allowedCompanyIds, \{ allowArchived: true \}\)/.test(repoCode), true);
expect('7.7 restore() allowArchived: true (restore için zorunlu)',
  /async restore[\s\S]{0,500}assertCaseInScope\(id, allowedCompanyIds, \{ allowArchived: true \}\)/.test(repoCode), true);

// P2.2 — sadece archive/restore'da allowArchived flag var; diğer write
// method'larda YOK (otomatik korumayı alırlar).
const allowArchivedCallers = (repoCode.match(/assertCaseInScope\([^)]+allowArchived: true/g) ?? []).length;
expect('7.8 allowArchived flag SADECE archive+restore (2 yer)',
  allowArchivedCallers === 2, true, `bulunan=${allowArchivedCallers}`);

console.log('\n────────────────────────────────────────────────────────');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
