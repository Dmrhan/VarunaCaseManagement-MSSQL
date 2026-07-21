/**
 * smoke-report-build-where-static.js
 *
 * 2026-06-18 bug fix — Report Studio buildReportWhere status TR→ASCII
 * conversion (Phase 1'den beri silent bug). DB-bağımsız static smoke.
 *
 * Senaryolar:
 *   1) Status filter TR enum → DB ASCII conversion
 *   2) Priority filter (zaten ASCII) — dokunulmaz
 *   3) Multi-status array
 *   4) CSV input → split → conversion
 *   5) Bilinmeyen status (defansif filter)
 *   6) Status YOK ise where.status YOK
 *   7) Tenant scope intersect (regression)
 *   8) Date range (regression)
 *
 * Çalıştır:
 *   node scripts/smoke-report-build-where-static.js
 */

import { buildReportWhere } from '../server/lib/caseReport/buildWhere.js';

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); }
function expect(name, actual, expected) {
  if (actual === expected || JSON.stringify(actual) === JSON.stringify(expected)) ok(name);
  else bad(name, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

const ALLOWED = ['CO_PARAM', 'CO_UNIVERA'];

// ── 1) Status TR → DB ASCII conversion ───────────────────────
console.log('── 1) Status TR→ASCII conversion (bug fix) ───────────────');
{
  const { where, scopeValid } = buildReportWhere(
    { statuses: 'Açık' },
    ALLOWED,
  );
  expect('1.1 scopeValid true', scopeValid, true);
  expect('1.2 status TR "Açık" → ASCII "Acik"',
    where.status, { in: ['Acik'] });
}
{
  const { where } = buildReportWhere(
    { statuses: 'Çözüldü' },
    ALLOWED,
  );
  expect('1.3 status TR "Çözüldü" → ASCII "Cozuldu"',
    where.status, { in: ['Cozuldu'] });
}
{
  const { where } = buildReportWhere(
    { statuses: 'İptalEdildi' },
    ALLOWED,
  );
  expect('1.4 status TR "İptalEdildi" → ASCII "IptalEdildi"',
    where.status, { in: ['IptalEdildi'] });
}
{
  const { where } = buildReportWhere(
    { statuses: 'İncelemede' },
    ALLOWED,
  );
  expect('1.5 status TR "İncelemede" → ASCII "Incelemede"',
    where.status, { in: ['Incelemede'] });
}

// ── 2) Priority (zaten ASCII) dokunulmaz ─────────────────────
console.log('\n── 2) Priority ASCII passthrough (regression) ────────────');
{
  const { where } = buildReportWhere(
    { priorities: 'Critical' },
    ALLOWED,
  );
  expect('2.1 priority "Critical" passthrough',
    where.priority, { in: ['Critical'] });
}
{
  const { where } = buildReportWhere(
    { priorities: ['Low', 'Medium', 'High'] },
    ALLOWED,
  );
  expect('2.2 priority array passthrough',
    where.priority, { in: ['Low', 'Medium', 'High'] });
}

// ── 3) Multi-status array → all converted ────────────────────
console.log('\n── 3) Multi-status array → tüm değerler convert ─────────');
{
  const { where } = buildReportWhere(
    { statuses: ['Açık', 'İncelemede', 'Çözüldü'] },
    ALLOWED,
  );
  expect('3.1 array TR → array ASCII',
    where.status, { in: ['Acik', 'Incelemede', 'Cozuldu'] });
}

// ── 4) CSV input → split → conversion ────────────────────────
console.log('\n── 4) CSV input split + convert ──────────────────────────');
{
  const { where } = buildReportWhere(
    { statuses: 'Açık,Çözüldü' },
    ALLOWED,
  );
  expect('4.1 CSV "Açık,Çözüldü" → ASCII array',
    where.status, { in: ['Acik', 'Cozuldu'] });
}

// ── 5) Bilinmeyen status → conv passthrough (defansif) ───────
console.log('\n── 5) Bilinmeyen status defansif handling ────────────────');
{
  // conv'in default davranışı: bilinmeyen değer aynen döner (M_STATUS'da yok).
  // Bu durumda DB'de "__bogus__" arar, hiç match yok = boş sonuç. OK.
  const { where } = buildReportWhere(
    { statuses: '__bogus__' },
    ALLOWED,
  );
  expect('5.1 unknown status → aynen geçer (DB\'de match yok)',
    where.status, { in: ['__bogus__'] });
}

// ── 6) Status YOK ise where.status YOK ───────────────────────
console.log('\n── 6) Status filter yoksa where.status YOK ───────────────');
{
  const { where } = buildReportWhere({}, ALLOWED);
  expect('6.1 boş filter → status undefined',
    'status' in where, false);
}

// ── 7) Tenant scope intersect (regression) ───────────────────
console.log('\n── 7) Tenant scope intersect (regression) ────────────────');
{
  const { where, scopeValid } = buildReportWhere(
    { companyIds: 'CO_PARAM,CO_THIRD' },
    ALLOWED,
  );
  expect('7.1 intersect → sadece allowed olanlar',
    where.companyId, { in: ['CO_PARAM'] });
  expect('7.2 scopeValid true', scopeValid, true);

  const empty = buildReportWhere(
    { companyIds: 'CO_OTHER' },
    ALLOWED,
  );
  expect('7.3 hiç intersect yoksa scopeValid false',
    empty.scopeValid, false);
}

// ── 8) Date range — TR gün sınırı (P2 fix, düz UTC DEĞİL) ─────
console.log('\n── 8) Date range — TR gün sınırı (UTC+3) ─────────────────');
{
  const { where } = buildReportWhere(
    { dateFrom: '2026-01-01', dateTo: '2026-06-18' },
    ALLOWED,
  );
  expect('8.1 createdAt.gte var', where.createdAt?.gte != null, true);
  expect('8.2 createdAt.lte var', where.createdAt?.lte != null, true);
  // dateFrom=2026-01-01 → TR gece yarısı = 2025-12-31T21:00:00.000Z (UTC+3 geri).
  expect('8.3 gte = TR gece yarısı (düz UTC gece yarısı DEĞİL)',
    where.createdAt.gte.toISOString(), '2025-12-31T21:00:00.000Z');
  // dateTo=2026-06-18 gün SONU → ertesi TR gününün gece yarısından 1ms önce.
  expect('8.4 lte = TR gün sonu (23:59:59.999 TRT = 20:59:59.999Z)',
    where.createdAt.lte.toISOString(), '2026-06-18T20:59:59.999Z');
}

// ── 9) Resolved date range (Çözüm Zamanı filtresi) — TR sınırı ─
console.log('\n── 9) Resolved date range — TR gün sınırı ─────────────────');
{
  const { where } = buildReportWhere(
    { resolvedFrom: '2026-01-01', resolvedTo: '2026-06-18' },
    ALLOWED,
  );
  expect('9.1 resolvedAt.gte var', where.resolvedAt?.gte != null, true);
  expect('9.2 resolvedAt.lte var', where.resolvedAt?.lte != null, true);
  expect('9.3 gte = TR gece yarısı', where.resolvedAt.gte.toISOString(), '2025-12-31T21:00:00.000Z');
  expect('9.4 lte = TR gün sonu', where.resolvedAt.lte.toISOString(), '2026-06-18T20:59:59.999Z');
  expect('9.5 createdAt filtresi etkilenmedi (undefined)', where.createdAt, undefined);
}

// ── 10) Gece yarısı sınır senaryosu (asıl P2 bug) ──────────────
// resolvedTo=2026-06-18 iken 19 Haziran 00:00–02:59 TRT arasında çözülen
// bir vaka ARTIK dahil edilmemeli (eski kod düz UTC ile bunu yanlışlıkla
// dahil ediyordu — TRT 02:59 = UTC 2026-06-18T23:59, düz UTC lte'ye göre
// "içeride" görünüyordu).
console.log('\n── 10) Gece yarısı sınırı — asıl P2 senaryosu ─────────────');
{
  const { where } = buildReportWhere({ resolvedTo: '2026-06-18' }, ALLOWED);
  // 19 Haziran 01:30 TRT = 18 Haziran 22:30 UTC — bu artık lte'nin (20:59:59.999Z) DIŞINDA.
  const justAfterTrMidnight = new Date('2026-06-18T22:30:00.000Z');
  expect('10.1 19 Haziran 01:30 TRT ARTIK dışarıda (eski bug bunu dahil ederdi)',
    justAfterTrMidnight.getTime() > where.resolvedAt.lte.getTime(), true);
  // 18 Haziran 23:00 TRT = 18 Haziran 20:00 UTC — hâlâ (haklı olarak) içeride.
  const stillWithinTrDay = new Date('2026-06-18T20:00:00.000Z');
  expect('10.2 18 Haziran 23:00 TRT hâlâ içeride',
    stillWithinTrDay.getTime() <= where.resolvedAt.lte.getTime(), true);
}
{
  const { where } = buildReportWhere({ resolvedFrom: '2026-06-18' }, ALLOWED);
  // 18 Haziran 01:30 TRT = 17 Haziran 22:30 UTC — eski bug bunu YANLIŞLIKLA dışlardı.
  const earlyTrMorning = new Date('2026-06-17T22:30:00.000Z');
  expect('10.3 18 Haziran 01:30 TRT ARTIK içeride (eski bug bunu dışlardı)',
    earlyTrMorning.getTime() >= where.resolvedAt.gte.getTime(), true);
}

{
  const { where } = buildReportWhere({}, ALLOWED);
  expect('9.5 resolvedFrom/To yoksa where.resolvedAt YOK', where.resolvedAt, undefined);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
