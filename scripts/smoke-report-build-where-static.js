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

// ── 8) Date range (regression) ───────────────────────────────
console.log('\n── 8) Date range (regression) ────────────────────────────');
{
  const { where } = buildReportWhere(
    { dateFrom: '2026-01-01', dateTo: '2026-06-18' },
    ALLOWED,
  );
  expect('8.1 createdAt.gte var', where.createdAt?.gte != null, true);
  expect('8.2 createdAt.lte var', where.createdAt?.lte != null, true);
  // End-of-day: lte saat 23:59:59.999 UTC
  expect('8.3 dateTo end-of-day 23:59:59.999',
    where.createdAt.lte.getUTCHours(), 23);
}

// ── 9) Resolved date range (Çözüm Zamanı filtresi) ─────────────
console.log('\n── 9) Resolved date range ─────────────────────────────────');
{
  const { where } = buildReportWhere(
    { resolvedFrom: '2026-01-01', resolvedTo: '2026-06-18' },
    ALLOWED,
  );
  expect('9.1 resolvedAt.gte var', where.resolvedAt?.gte != null, true);
  expect('9.2 resolvedAt.lte var', where.resolvedAt?.lte != null, true);
  expect('9.3 resolvedTo end-of-day 23:59:59.999',
    where.resolvedAt.lte.getUTCHours(), 23);
  expect('9.4 createdAt filtresi etkilenmedi (undefined)', where.createdAt, undefined);
}

{
  const { where } = buildReportWhere({}, ALLOWED);
  expect('9.5 resolvedFrom/To yoksa where.resolvedAt YOK', where.resolvedAt, undefined);
}

console.log('');
console.log(`PASS=${pass}  FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
