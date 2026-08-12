/**
 * smoke-bulk-cancel.js — 2026-07-10
 * Toplu vaka iptali (Agent HARİÇ roller) dikişleri. YALNIZ YAPISAL —
 * gerçek vaka İPTAL ETMEZ (canlı DB yazımı yok; iptal geri-dönüşü zahmetli).
 * Rol matrisi + gerçek iptal testi local'de manuel (throwaway vaka).
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS — ${n}`); } else { fail++; console.log(`FAIL — ${n}`); } };
const read = (p) => readFileSync(p, 'utf8');

const routes = read('server/routes/cases.js');
const repo = read('server/db/caseRepository.js');
const svc = read('src/services/caseService.ts');
const page = read('src/features/cases/CasesListPage.tsx');

console.log('── Rol kapısı (Agent HARİÇ) ──');
ok('1.1 CASE_BULK_CANCEL_ROLES = 5 rol (SystemAdmin dahil, Agent YOK)',
  /const CASE_BULK_CANCEL_ROLES = \['Backoffice', 'CSM', 'Supervisor', 'Admin', 'SystemAdmin'\]/.test(routes)
  && !/CASE_BULK_CANCEL_ROLES = \[[^\]]*'Agent'/.test(routes));
ok('1.2 route /bulk-cancel requireRole(...CASE_BULK_CANCEL_ROLES) ile korunuyor (birincil kapı)',
  /'\/bulk-cancel',\s*\n\s*requireRole\(\.\.\.CASE_BULK_CANCEL_ROLES\)/.test(routes));
ok('1.3 route repo.bulkCancel\'i ActorContext (userId stamp — Codex #520 P2) + scope ile çağırır',
  /caseRepository\.bulkCancel\(/.test(routes)
  && /actorObject: actor\b/.test(routes)
  && /actorDisplay: actor\.displayName/.test(routes)
  && !/actorObject: req\.user/.test(routes)
  && /allowedCompanyIds: req\.user\.allowedCompanyIds/.test(routes));
ok('1.4 ikincil savunma: assertBulkCaseCancelPolicy (action close, flag açıkken)',
  /async function assertBulkCaseCancelPolicy/.test(routes)
  && /action: 'close'/.test(routes));

console.log('── Repo: bulkCancel (statü geçişi reuse) ──');
ok('2.1 bulkCancel metodu mevcut',
  /async bulkCancel\(\{ caseIds, cancellationReason \}/.test(repo));
ok('2.2 döngüde transitionStatus(\'İptalEdildi\') REUSE (düz prisma.update DEĞİL)',
  /caseRepository\.transitionStatus\(\s*c\.id,\s*'İptalEdildi'/.test(repo));
ok('2.3 neden zorunlu (min 3) + max 100',
  /İptal nedeni gerekli \(en az 3 karakter\)/.test(repo)
  && /En fazla 100 vaka tek seferde iptal edilebilir/.test(repo));
ok('2.4 cross-tenant fail-fast (CaseAccessError, partial write yok)',
  /Toplu iptal: erişiminiz olmayan vaka/.test(repo)
  && /throw new CaseAccessError/.test(repo.split('async bulkCancel')[1]?.split('async ')[0] ?? ''));
ok('2.5 (Codex #520 P2) iptal edilemezler hedef DIŞI: Cozuldu + IptalEdildi + arşivli atlanır',
  /NOT_CANCELABLE = new Set\(\['IptalEdildi', 'Cozuldu'\]\)/.test(repo)
  && /!NOT_CANCELABLE\.has\(c\.status\) && !c\.isArchived/.test(repo)
  && /isArchived: true/.test(repo.split('async bulkCancel')[1]?.split('async ')[0] ?? ''));
ok('2.6 (Codex #520 P2) hata YUTULMAZ — döngü durur + kısmi durum raporlanır (failed.push YOK)',
  /İptal yarıda kesildi/.test(repo)
  && !/failed\.push/.test(repo.split('async bulkCancel')[1]?.split('async ')[0] ?? ''));
ok('2.7 (Codex #521 P2) TOCTOU — transition ÖNCESİ taze status re-check; terminal/arşiv olduysa atla',
  /const fresh = await prisma\.case\.findUnique\(/.test(repo)
  && /if \(!fresh \|\| NOT_CANCELABLE\.has\(fresh\.status\) \|\| fresh\.isArchived\) \{\s*skipped \+= 1;/.test(repo));

console.log('── Regresyon: mevcut invariant\'lar KORUNDU ──');
ok('3.1 bulk-update terminal yasağı DOKUNULMADI (Cozuldu/IptalEdildi hâlâ blok)',
  /Toplu işlemde kapatma \(Çözüldü\/İptalEdildi\) yapılamaz/.test(repo));
ok('3.2 bulk-archive SystemAdmin-only DOKUNULMADI',
  /'\/bulk-archive',\s*\n\s*requireRole\('SystemAdmin'\)/.test(routes));
ok('3.3 tekil transition route /:id/transition hâlâ mevcut (kapsam dışı, değişmedi)',
  /'\/:id\/transition'/.test(routes));

console.log('── Frontend ──');
ok('4.1 service bulkCancel → /bulk-cancel (cancellationReason gövdede)',
  /async bulkCancel\(/.test(svc)
  && /\/bulk-cancel/.test(svc)
  && /cancellationReason/.test(svc));
ok('4.2 canCancel gating = Agent HARİÇ (user.role !== \'Agent\')',
  /canCancel=\{!!user && user\.role !== 'Agent'\}/.test(page)
  && /canCancel: boolean/.test(page));
ok('4.3 İptal Et butonu onAction(\'cancel\') + BulkField \'cancel\' içerir',
  /onClick=\{\(\) => onAction\('cancel'\)\}/.test(page)
  && /İptal Et/.test(page)
  && /type BulkField = [^;]*'cancel'/.test(page));
ok('4.4 BulkCancelModal (neden zorunlu, min 3) + applyBulkCancel handler',
  /function BulkCancelModal\(/.test(page)
  && /async function applyBulkCancel/.test(page)
  && /caseService\.bulkCancel/.test(page));
ok('4.5 BulkActionModal cancel\'ı render ETMEZ (ayrı modal; type de dışlar)',
  /bulkField !== 'assign' && bulkField !== 'archive' && bulkField !== 'cancel'/.test(page)
  && /Exclude<BulkField, 'assign' \| 'archive' \| 'cancel'>/.test(page));

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
