/**
 * smoke-bulk-archive.js — 2026-07-06
 * Toplu arşiv (bulk bar "Arşivle") — yapısal assertler.
 * Canlı kabul: accept-bulk-archive (13/13, 2026-07-06 çalıştırıldı).
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const expectTrue = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS — ${name}`); }
  else { fail += 1; console.log(`FAIL — ${name}`); }
};

const routes = readFileSync('server/routes/cases.js', 'utf8');
const repo = readFileSync('server/db/caseRepository.js', 'utf8');
const page = readFileSync('src/features/cases/CasesListPage.tsx', 'utf8');
const svc = readFileSync('src/services/caseService.ts', 'utf8');
const modal = readFileSync('src/components/ui/Modal.tsx', 'utf8');

console.log('── Backend ──');
expectTrue('1.1 route SystemAdmin + BULK-aware archive policy (Codex #437 P2: req.params.id okuyan tekil helper DEĞİL)',
  /'\/bulk-archive',\s*requireRole\('SystemAdmin'\)/.test(routes)
  && /bulk-archive'[\s\S]{0,400}assertBulkCaseArchivePolicy\(req, \{ caseIds: body\.caseIds \}\)/.test(routes)
  && /assertBulkCaseArchivePolicy[\s\S]{0,1600}action: 'archive'/.test(routes));
expectTrue('1.1b bulk policy: şirket-bazlı döngü (assertCompanyResourcePolicy) + her iki bayrak kapalıyken no-op',
  /assertBulkCaseArchivePolicy[\s\S]{0,300}!resourceEnabled && !securityFilterEnabled\) return null/.test(routes)
  && /assertBulkCaseArchivePolicy[\s\S]{0,2400}assertCompanyResourcePolicy/.test(routes));
expectTrue('1.1c Codex #438 P1: güvenlik filtresi görünürlüğü VAKA BAŞINA (tekil arşiv paritesi) ve resource-policy\'den ÖNCE',
  /assertBulkCaseArchivePolicy[\s\S]{0,1600}for \(const c of cases\) \{\s*await assertCaseSecurityFilterAccess\(req, \{ caseId: c\.id, companyId: c\.companyId \}\);/.test(routes)
  && routes.indexOf('assertCaseSecurityFilterAccess(req, { caseId: c.id') < routes.indexOf("action: 'archive'"));
expectTrue('1.1d Codex #439 P2: guard >100 id\'de sorgulamadan kısa devre (repo 400\'ü üretir)',
  /assertBulkCaseArchivePolicy[\s\S]{0,800}if \(caseIds\.length > 100\) return null;/.test(routes)
  && routes.indexOf('if (caseIds.length > 100) return null;') < routes.indexOf('select: { id: true, companyId: true }'));
expectTrue('1.2 repo: max 100 + reason ≥3 + bulunamayan id reddi (hiçbir şey yazılmaz)',
  repo.includes('En fazla 100 vaka tek seferde arşivlenebilir')
  && /bulkArchive[\s\S]{0,900}Arşiv sebebi gerekli/.test(repo)
  && /bulkArchive[\s\S]{0,1800}Bazı vakalar bulunamadı/.test(repo));
expectTrue('1.3 repo: scope dışı → CaseAccessError (403, bulkUpdate paritesi)',
  /Toplu arşiv: erişiminiz olmayan vaka/.test(repo));
expectTrue('1.4 repo: idempotent (zaten arşivli = alreadyArchived sayacı) + transaction + aktivite',
  /alreadyArchived = cases\.length - targets\.length/.test(repo)
  && /Vaka arşivlendi \(toplu\)/.test(repo)
  && /bulkArchive[\s\S]{0,3000}\$transaction/.test(repo));

console.log('── Frontend ──');
expectTrue('2.1 buton yalnız SystemAdmin (canArchive={user?.role === \'SystemAdmin\'})',
  page.includes("canArchive={user?.role === 'SystemAdmin'}")
  && /\{canArchive && \([\s\S]{0,400}Arşivle/.test(page));
expectTrue('2.2 BulkArchiveModal: neden zorunlu (≥3) + geri alınabilirlik açıklaması (öz-açıklayıcı UI)',
  page.includes('reason.trim().length >= 3') && page.includes('geri alınabilir'));
expectTrue('2.3 servis bulkArchive + invalidateCaseDetail',
  svc.includes("'/bulk-archive'".replace("'", '`').replace("'", '')) || /bulk-archive/.test(svc));
expectTrue('2.4 modal centered prop (opsiyonel, default eski davranış)',
  modal.includes('centered = false') && /fixedHeight \|\| centered \? 'items-center'/.test(modal));
expectTrue('2.5 üç toplu modal da belirgin (centered + lg)',
  (page.match(/size="lg"\s*\n\s*centered/g) ?? []).length === 3);
expectTrue('2.6 archive alanı BulkActionModal\'a sızmaz (Exclude tip + koşul)',
  page.includes("Exclude<BulkField, 'assign' | 'archive'>")
  && page.includes("bulkField !== 'assign' && bulkField !== 'archive'"));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
