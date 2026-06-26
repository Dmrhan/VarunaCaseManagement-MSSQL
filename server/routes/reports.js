/**
 * Case Report Studio — Phase 1 endpoints.
 *
 *   GET  /api/reports/cases/columns  → column registry (UI picker)
 *   POST /api/reports/cases/preview  → seçili kolon + filtre ile sayfalı önizleme
 *   POST /api/reports/cases/export   → seçili kolon + filtre ile .xlsx
 *
 * Multi-tenant guard:
 *   verifyJwt + buildReportWhere(filters, req.user.allowedCompanyIds).
 *   Frontend hiçbir scope kararı vermez; her endpoint allowedCompanyIds
 *   ile intersect eder.
 *
 * Phase 1 export sınırı: 5000 satır. Üzeri 400 + clear error message.
 */
import { Router } from 'express';
import * as XLSX from 'xlsx';
import { verifyJwt, requireRole } from '../db/auth.js';
import { prisma } from '../db/client.js';
import { AuthorizationRuntimeError } from '../lib/authorizationRuntime.js';
import { filterAllowedCompanyIdsByResourcePolicy } from '../lib/authorizationRouteGuards.js';
import {
  REPORT_COLUMNS,
  REPORT_COLUMN_CATEGORIES,
  resolveColumns,
  buildPrismaSelect,
  needsSolutionStepAggregates,
  needsCaseActivityAggregates,
  needsCaseNoteAggregates,
  needsCaseFileAggregates,
  needsCaseCallAggregates,
  needsCaseTransferAggregates,
  isColumnAllowedForRole,
  filterColumnsByRole,
} from '../lib/caseReport/columnRegistry.js';
import { buildReportWhere } from '../lib/caseReport/buildWhere.js';
import { buildReportRows, extractRawValue, parseCustomFields } from '../lib/caseReport/buildRows.js';
import {
  loadSolutionStepAggregates,
  loadCaseActivityAggregates,
  loadCaseNoteAggregates,
  loadCaseFileAggregates,
  loadCaseCallAggregates,
  loadCaseTransferAggregates,
} from '../lib/caseReport/aggregates.js';
import {
  computePivot,
  isPivotableDimension,
  isPivotableMeasure,
  PIVOT_MEASURE_FNS,
} from '../lib/caseReport/pivot.js';

const router = Router();
router.use(verifyJwt);

// Codex P2 #1 fix — Defense-in-depth: Frontend sidebar yalnız Supervisor/
// Admin/SystemAdmin'e Rapor Stüdyosu entry'sini gösterse de, JWT'si geçerli
// herhangi bir Agent/Backoffice/CSM URL'i bilse fetch yapabiliyordu. Tenant
// scope (allowedCompanyIds) zaten cross-tenant sızıntıyı önlüyor; ama bu
// guard rapor üretme yetkisini rolü açıkça tanımlananlarla sınırlıyor.
// 403 forbidden — UI hiding'e güvenmiyoruz.
const REPORT_ROLES = requireRole('Supervisor', 'Admin', 'SystemAdmin');
router.use(REPORT_ROLES);

const PREVIEW_DEFAULT_PAGE_SIZE = 50;

/**
 * Phase 2B.1 — Aggregate batch fetch'lerini seçili kolonlara göre paralel
 * koşturur. Hiç aggregate seçilmediyse hiç DB sorgusu atılmaz (perf).
 * N+1 garantisi: her aggregate türü için TEK findMany; Promise.all paralel.
 */
async function loadAggregatesIfNeeded(columns, items) {
  const aggregates = {};
  if (items.length === 0) return aggregates;
  const caseIds = items.map((i) => i.id);
  const jobs = [];
  if (needsSolutionStepAggregates(columns)) {
    jobs.push(loadSolutionStepAggregates(prisma, caseIds).then((m) => { aggregates.solutionSteps = m; }));
  }
  if (needsCaseActivityAggregates(columns)) {
    jobs.push(loadCaseActivityAggregates(prisma, caseIds).then((m) => { aggregates.caseActivity = m; }));
  }
  if (needsCaseNoteAggregates(columns)) {
    jobs.push(loadCaseNoteAggregates(prisma, caseIds).then((m) => { aggregates.caseNote = m; }));
  }
  // Phase 2B.2
  if (needsCaseFileAggregates(columns)) {
    jobs.push(loadCaseFileAggregates(prisma, caseIds).then((m) => { aggregates.caseFile = m; }));
  }
  if (needsCaseCallAggregates(columns)) {
    jobs.push(loadCaseCallAggregates(prisma, caseIds).then((m) => { aggregates.caseCall = m; }));
  }
  if (needsCaseTransferAggregates(columns)) {
    jobs.push(loadCaseTransferAggregates(prisma, caseIds).then((m) => { aggregates.caseTransfer = m; }));
  }
  if (jobs.length > 0) await Promise.all(jobs);
  return aggregates;
}
const PREVIEW_MAX_PAGE_SIZE = 200;
const EXPORT_MAX_ROWS = 5000;

function handleAuthorizationRuntimeError(res, err) {
  if (err instanceof AuthorizationRuntimeError) {
    res.status(err.status ?? 403).json({
      error: err.code ?? 'authorization_forbidden',
      message: err.message,
    });
    return true;
  }
  return false;
}

/**
 * GET /api/reports/cases/columns
 * Tüm kolonları ve kategori etiketlerini döner. Yetkisiz column gizleme
 * (Phase 2'de privacyTag === 'pii' role gate) henüz yok — Phase 1 kolonları
 * KVKK güvenli alt küme (customerContact* ve Account VKN/TCKN/phone hariç).
 */
router.get('/cases/columns', async (req, res) => {
  try {
    await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'report.caseStudio', action: 'read', throwIfEmpty: true });
  } catch (err) {
    if (handleAuthorizationRuntimeError(res, err)) return;
    console.error('[reports/cases/columns]', err);
    return res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
  // Phase 2D — PII kolonları rol yetkisi olmayan kullanıcıya HİÇ
  // listelenmez (UI'da görünmez). Tenant scope zaten allowedCompanyIds ile
  // garanti edildi; bu ek katman rapor üreten kişinin "bilmek gereği" ile
  // sınırlanmasını sağlar.
  const role = req.user?.role ?? null;
  const visible = REPORT_COLUMNS.filter((c) => isColumnAllowedForRole(c, role));
  res.json({
    categories: REPORT_COLUMN_CATEGORIES,
    columns: visible.map((c) => ({
      id: c.id,
      label: c.label,
      category: c.category,
      type: c.type,
      source: c.source,
      ...(c.privacyTag ? { privacyTag: c.privacyTag } : {}),
    })),
  });
});

/**
 * POST /api/reports/cases/preview
 * Body: { columns: string[], filters?: object, page?: number, pageSize?: number }
 * Response: { rows: object[], total: number, columns: ColumnDef[], page, pageSize }
 */
router.post('/cases/preview', async (req, res) => {
  const body = req.body ?? {};
  try {
    await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'report.caseStudio', action: 'read', throwIfEmpty: true });
  } catch (err) {
    if (handleAuthorizationRuntimeError(res, err)) return;
    console.error('[reports/cases/preview][authz]', err);
    return res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
  const requestedIds = Array.isArray(body.columns) ? body.columns : [];
  if (requestedIds.length === 0) {
    return res.status(400).json({
      error: 'columns_required',
      message: 'En az bir kolon seçilmeli.',
    });
  }
  const { columns, invalidIds } = resolveColumns(requestedIds);
  // Phase 1.5: bilinmeyen id varsa 400 — sessiz drop ile UI/backend kontrat
  // tutarsızlığı maskelenmesin.
  if (invalidIds.length > 0) {
    return res.status(400).json({
      error: 'columns_invalid',
      message: `Geçersiz kolon id(leri): ${invalidIds.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ')}`,
      invalidIds,
    });
  }
  if (columns.length === 0) {
    return res.status(400).json({
      error: 'columns_unknown',
      message: 'Hiçbir geçerli kolon seçilmedi.',
    });
  }

  // Phase 2D — PII kolonları için defansif role gate. /columns UI'da
  // göstermez ama elle id atılırsa burada reddederiz. Tenant scope ile
  // birlikte iki katmanlı koruma.
  const roleCheck = filterColumnsByRole(columns, req.user?.role ?? null);
  if (roleCheck.forbidden.length > 0) {
    return res.status(403).json({
      error: 'columns_forbidden',
      message: `Bu kolon(lar)a erişim yetkin yok: ${roleCheck.forbidden.join(', ')}`,
      forbiddenIds: roleCheck.forbidden,
    });
  }

  const allowed = await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'report.caseStudio', action: 'read' });
  const { where, scopeValid } = buildReportWhere(body.filters, allowed);
  if (!scopeValid) {
    return res.json({
      rows: [],
      total: 0,
      page: 1,
      pageSize: PREVIEW_DEFAULT_PAGE_SIZE,
      columns: columns.map((c) => ({ id: c.id, label: c.label, type: c.type })),
    });
  }

  const pageRaw = Number(body.page);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const sizeRaw = Number(body.pageSize);
  let pageSize = Number.isFinite(sizeRaw) && sizeRaw >= 1 ? Math.floor(sizeRaw) : PREVIEW_DEFAULT_PAGE_SIZE;
  if (pageSize > PREVIEW_MAX_PAGE_SIZE) pageSize = PREVIEW_MAX_PAGE_SIZE;

  const select = buildPrismaSelect(columns);

  try {
    const [items, total] = await Promise.all([
      prisma.case.findMany({
        where,
        select,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.case.count({ where }),
    ]);
    // Phase 2A + 2B.1: aggregate column'ları paralel batch fetch. Selektif —
    // hiç aggregate seçilmediyse hiçbir aggregate sorgusu atılmaz.
    const aggregates = await loadAggregatesIfNeeded(columns, items);
    const rows = buildReportRows(items, columns, aggregates);
    return res.json({
      rows,
      total,
      page,
      pageSize,
      columns: columns.map((c) => ({ id: c.id, label: c.label, type: c.type })),
    });
  } catch (err) {
    console.error('[reports/cases/preview]', err);
    return res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

/**
 * POST /api/reports/cases/export
 * Body: { columns: string[], filters?: object }
 * Response: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 * Sınır: EXPORT_MAX_ROWS (Phase 1 = 5000). Aşılırsa 400.
 */
router.post('/cases/export', async (req, res) => {
  const body = req.body ?? {};
  try {
    await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'report.caseStudio', action: 'export', throwIfEmpty: true });
  } catch (err) {
    if (handleAuthorizationRuntimeError(res, err)) return;
    console.error('[reports/cases/export][authz]', err);
    return res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
  const requestedIds = Array.isArray(body.columns) ? body.columns : [];
  if (requestedIds.length === 0) {
    return res.status(400).json({ error: 'columns_required', message: 'En az bir kolon seçilmeli.' });
  }
  const { columns, invalidIds } = resolveColumns(requestedIds);
  if (invalidIds.length > 0) {
    return res.status(400).json({
      error: 'columns_invalid',
      message: `Geçersiz kolon id(leri): ${invalidIds.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ')}`,
      invalidIds,
    });
  }
  if (columns.length === 0) {
    return res.status(400).json({ error: 'columns_unknown', message: 'Hiçbir geçerli kolon seçilmedi.' });
  }

  // Phase 2D — defansif role gate (export)
  const roleCheck = filterColumnsByRole(columns, req.user?.role ?? null);
  if (roleCheck.forbidden.length > 0) {
    return res.status(403).json({
      error: 'columns_forbidden',
      message: `Bu kolon(lar)a erişim yetkin yok: ${roleCheck.forbidden.join(', ')}`,
      forbiddenIds: roleCheck.forbidden,
    });
  }

  const allowed = await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'report.caseStudio', action: 'export' });
  const { where, scopeValid } = buildReportWhere(body.filters, allowed);
  if (!scopeValid) {
    // Boş scope → boş Excel üret. Kullanıcıya "izinli şirket yok" sinyali
    // olarak header ve 0 satır içeren bir sayfa döner; download başarısız değil.
    return sendXlsx(res, columns, []);
  }

  try {
    const count = await prisma.case.count({ where });
    if (count > EXPORT_MAX_ROWS) {
      return res.status(400).json({
        error: 'export_limit_exceeded',
        message: `Bu raporda ${count} satır var. Excel export sınırı ${EXPORT_MAX_ROWS}. Lütfen filtreyi daraltın (tarih aralığı / statü / şirket).`,
        limit: EXPORT_MAX_ROWS,
        count,
      });
    }
    const select = buildPrismaSelect(columns);
    const items = await prisma.case.findMany({
      where,
      select,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_MAX_ROWS,
    });
    // Phase 2A + 2B.1: aggregate akışı preview ile bire bir paylaşılır.
    const aggregates = await loadAggregatesIfNeeded(columns, items);
    const rows = buildReportRows(items, columns, aggregates);
    return sendXlsx(res, columns, rows, { filters: body.filters, count });
  } catch (err) {
    console.error('[reports/cases/export]', err);
    return res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

// ──────────────────────────────────────────────────────────────────────
// Phase 3.1 — Pivot endpoint
// ──────────────────────────────────────────────────────────────────────
//
// POST /api/reports/cases/pivot
// Body:
//   {
//     rowColumnId: string,        // pivotable column id (row dimension)
//     colColumnId: string,        // pivotable column id (col dimension)
//     measure: {
//       columnId?: string,        // count fn için ignore
//       fn: 'count'|'sum'|'avg'|'min'|'max'
//     },
//     filters: ReportFilters
//   }
//
// Response: {
//   row: { id, label },
//   col: { id, label },
//   measure: { fn, columnId? },
//   rowLabels, colLabels, matrix, rowTotals, colTotals, grandTotal,
//   total: number  // pivot'a giren case sayısı
// }
//
// Tenant scope, role gate, EXPORT_MAX_ROWS sınırı preview/export ile
// aynı şekilde uygulanır. Pivot fetch'i in-memory yapıldığı için satır
// sınırı önemli — Phase 3.1 max 5000 case ile sınırlı (preview pageSize
// 200 değil; pivot için ayrı PIVOT_MAX_ROWS sabiti).

const PIVOT_MAX_ROWS = 5000;

router.post('/cases/pivot', async (req, res) => {
  const body = req.body ?? {};
  try {
    await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'report.caseStudio', action: 'read', throwIfEmpty: true });
  } catch (err) {
    if (handleAuthorizationRuntimeError(res, err)) return;
    console.error('[reports/cases/pivot][authz]', err);
    return res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
  const rowColumnId = typeof body.rowColumnId === 'string' ? body.rowColumnId : '';
  const colColumnId = typeof body.colColumnId === 'string' ? body.colColumnId : '';
  const measure = body.measure ?? {};
  const measureFn = typeof measure.fn === 'string' ? measure.fn : '';
  const measureColumnId = typeof measure.columnId === 'string' ? measure.columnId : '';

  if (!rowColumnId || !colColumnId) {
    return res.status(400).json({
      error: 'pivot_dimensions_required',
      message: 'Pivot için satır ve kolon boyutu zorunlu.',
    });
  }
  if (!PIVOT_MEASURE_FNS.includes(measureFn)) {
    return res.status(400).json({
      error: 'pivot_measure_fn_invalid',
      message: `Geçersiz pivot fonksiyonu. Beklenen: ${PIVOT_MEASURE_FNS.join('/')}.`,
    });
  }
  if (measureFn !== 'count' && !measureColumnId) {
    return res.status(400).json({
      error: 'pivot_measure_column_required',
      message: `'${measureFn}' fonksiyonu için bir sayısal kolon seçmelisin.`,
    });
  }

  // Kolon id'lerini topla → role + valid + pivotable kontrol
  const ids = [rowColumnId, colColumnId];
  if (measureColumnId) ids.push(measureColumnId);
  const { columns: resolvedAll, invalidIds } = resolveColumns(ids);
  if (invalidIds.length > 0) {
    return res.status(400).json({
      error: 'columns_invalid',
      message: `Geçersiz kolon id(leri): ${invalidIds.join(', ')}`,
      invalidIds,
    });
  }
  const rowCol = resolvedAll.find((c) => c.id === rowColumnId);
  const colCol = resolvedAll.find((c) => c.id === colColumnId);
  const measureCol = measureColumnId ? resolvedAll.find((c) => c.id === measureColumnId) : null;

  if (!isPivotableDimension(rowCol)) {
    return res.status(400).json({ error: 'pivot_row_not_pivotable', message: 'Bu kolon satır boyutu olarak kullanılamıyor.' });
  }
  if (!isPivotableDimension(colCol)) {
    return res.status(400).json({ error: 'pivot_col_not_pivotable', message: 'Bu kolon kolon boyutu olarak kullanılamıyor.' });
  }
  if (measureFn !== 'count' && !isPivotableMeasure(measureCol, measureFn)) {
    return res.status(400).json({
      error: 'pivot_measure_not_numeric',
      message: `'${measureFn}' fonksiyonu sayısal (type=number) bir kolon gerektirir.`,
    });
  }

  // Role gate — pivot da PII kolonu içeriyorsa engelle
  const roleCheck = filterColumnsByRole(resolvedAll, req.user?.role ?? null);
  if (roleCheck.forbidden.length > 0) {
    return res.status(403).json({
      error: 'columns_forbidden',
      message: `Bu kolon(lar)a erişim yetkin yok: ${roleCheck.forbidden.join(', ')}`,
      forbiddenIds: roleCheck.forbidden,
    });
  }

  const allowed = await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'report.caseStudio', action: 'read' });
  const { where, scopeValid } = buildReportWhere(body.filters, allowed);
  if (!scopeValid) {
    return res.json({
      row: { id: rowCol.id, label: rowCol.label },
      col: { id: colCol.id, label: colCol.label },
      measure: { fn: measureFn, ...(measureColumnId ? { columnId: measureColumnId, columnLabel: measureCol?.label } : {}) },
      rowLabels: [], colLabels: [], matrix: {}, rowTotals: {}, colTotals: {}, grandTotal: 0, total: 0,
    });
  }

  try {
    // Phase 3.1: pivot fetch sınırı 5000 satır. Aşılırsa 400 + uyarı.
    const count = await prisma.case.count({ where });
    if (count > PIVOT_MAX_ROWS) {
      return res.status(400).json({
        error: 'pivot_limit_exceeded',
        message: `Bu sorguda ${count} satır var. Pivot sınırı ${PIVOT_MAX_ROWS}. Filtreyi daralt.`,
        limit: PIVOT_MAX_ROWS,
        count,
      });
    }
    // resolvedAll içindeki tüm kolonların select'ini topla — buildPrismaSelect
    // hem scalar hem json_path (customFields) hem join'i doğru yönetir.
    const select = buildPrismaSelect(resolvedAll);
    const items = await prisma.case.findMany({
      where,
      select,
      take: PIVOT_MAX_ROWS,
    });
    const aggregates = await loadAggregatesIfNeeded(resolvedAll, items);
    const rows = buildReportRows(items, resolvedAll, aggregates);
    // Row/col dim için: formatted string (TR display). UI burada görür.
    const rowValues = rows.map((r) => r[rowColumnId]);
    const colValues = rows.map((r) => r[colColumnId]);
    // Codex P2 #1 fix — Measure için: buildReportRows'un formatlanmış string
    // çıktısı (örn. confidence '%85') parse edilemez. Bunun yerine raw değeri
    // extractRawValue ile DB row + parsed customFields + aggregates'ten al.
    // customFields per-case TEK kez parse — N+1 değil.
    let measureValues = [];
    if (measureColumnId && measureCol) {
      measureValues = items.map((item) => {
        const cf = parseCustomFields(item.customFields);
        const raw = extractRawValue(measureCol, item, cf, aggregates);
        const n = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(n) ? n : null;
      });
    }
    const piv = computePivot({ rowValues, colValues, measureValues, measureFn });

    return res.json({
      row: { id: rowCol.id, label: rowCol.label },
      col: { id: colCol.id, label: colCol.label },
      measure: {
        fn: measureFn,
        ...(measureColumnId ? { columnId: measureColumnId, columnLabel: measureCol?.label } : {}),
      },
      ...piv,
      total: items.length,
    });
  } catch (err) {
    console.error('[reports/cases/pivot]', err);
    return res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

// ──────────────────────────────────────────────────────────────────────
// Phase 3.2 — Pivot drill-down: underlying cases for a single cell
// ──────────────────────────────────────────────────────────────────────
//
// POST /api/reports/cases/pivot/drill
// Body:
//   {
//     rowColumnId, colColumnId,
//     rowValue,    // pivot matrix etiketi (BLANK_LABEL = '(boş)' geçilebilir)
//     colValue,
//     filters,
//     columns?: string[]  // dönecek preview kolonları (varsayılan: özet set)
//   }
//
// Response: { rows: ReportRow[], total, columns: ColumnDef[] }
//
// Akış:
//   1. resolveColumns + role/scope guard
//   2. buildReportWhere + same fetch as pivot endpoint (limit PIVOT_MAX_ROWS)
//   3. buildReportRows formatlanmış row'lar
//   4. Filter: row[rowColumnId] === rowValue && row[colColumnId] === colValue
//      (BLANK_LABEL karşılaştırması özel: client'tan gelen '(boş)' için
//       row değeri '' ile eşleşir.)
//   5. Caller belirttiği columns subset'ini döndür (yoksa default)

const DRILL_DEFAULT_COLUMNS = [
  'caseNumber',
  'title',
  'companyName',
  'accountName',
  'status',
  'priority',
  'assignedPersonName',
  'createdAt',
  'resolvedAt',
];

router.post('/cases/pivot/drill', async (req, res) => {
  const body = req.body ?? {};
  try {
    await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'report.caseStudio', action: 'read', throwIfEmpty: true });
  } catch (err) {
    if (handleAuthorizationRuntimeError(res, err)) return;
    console.error('[reports/cases/pivot/drill][authz]', err);
    return res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
  const rowColumnId = typeof body.rowColumnId === 'string' ? body.rowColumnId : '';
  const colColumnId = typeof body.colColumnId === 'string' ? body.colColumnId : '';
  const rowValue = typeof body.rowValue === 'string' ? body.rowValue : '';
  const colValue = typeof body.colValue === 'string' ? body.colValue : '';
  if (!rowColumnId || !colColumnId) {
    return res.status(400).json({ error: 'pivot_dimensions_required', message: 'rowColumnId/colColumnId zorunlu.' });
  }

  // Drill kolonları: caller'ın istediği subset + her zaman row/col dim ekle
  const requestedColIds = Array.isArray(body.columns) && body.columns.length > 0
    ? body.columns
    : DRILL_DEFAULT_COLUMNS;
  // row/col dim'i de fetch et — filter için lazım (formatted display)
  const allIds = Array.from(new Set([...requestedColIds, rowColumnId, colColumnId]));
  const { columns: allCols, invalidIds } = resolveColumns(allIds);
  if (invalidIds.length > 0) {
    return res.status(400).json({ error: 'columns_invalid', message: `Geçersiz kolon: ${invalidIds.join(', ')}`, invalidIds });
  }

  // Role guard — drill PII kolonu içeriyorsa Admin/SystemAdmin
  const roleCheck = filterColumnsByRole(allCols, req.user?.role ?? null);
  if (roleCheck.forbidden.length > 0) {
    return res.status(403).json({
      error: 'columns_forbidden',
      message: `Bu kolon(lar)a erişim yetkin yok: ${roleCheck.forbidden.join(', ')}`,
      forbiddenIds: roleCheck.forbidden,
    });
  }

  const allowed = await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'report.caseStudio', action: 'read' });
  const { where, scopeValid } = buildReportWhere(body.filters, allowed);
  if (!scopeValid) {
    return res.json({
      rows: [], total: 0,
      columns: allCols.filter((c) => requestedColIds.includes(c.id)).map((c) => ({ id: c.id, label: c.label, type: c.type })),
    });
  }

  try {
    const count = await prisma.case.count({ where });
    if (count > PIVOT_MAX_ROWS) {
      return res.status(400).json({
        error: 'pivot_limit_exceeded',
        message: `Bu sorguda ${count} satır var. Drill sınırı ${PIVOT_MAX_ROWS}.`,
        limit: PIVOT_MAX_ROWS, count,
      });
    }
    const select = buildPrismaSelect(allCols);
    const items = await prisma.case.findMany({ where, select, take: PIVOT_MAX_ROWS, orderBy: { createdAt: 'desc' } });
    const aggregates = await loadAggregatesIfNeeded(allCols, items);
    const rows = buildReportRows(items, allCols, aggregates);
    // BLANK_LABEL ('(boş)') gelen değerler için '' karşılaştırması
    const matchRow = (v) => (rowValue === '(boş)' ? !v || String(v).trim() === '' : String(v) === rowValue);
    const matchCol = (v) => (colValue === '(boş)' ? !v || String(v).trim() === '' : String(v) === colValue);
    const filtered = rows.filter((r) => matchRow(r[rowColumnId]) && matchCol(r[colColumnId]));
    // Caller'ın istediği kolon subset'i ve sırası
    const responseCols = requestedColIds
      .map((id) => allCols.find((c) => c.id === id))
      .filter(Boolean);
    return res.json({
      rows: filtered.map((r) => {
        const out = {};
        for (const c of responseCols) out[c.id] = r[c.id];
        return out;
      }),
      total: filtered.length,
      columns: responseCols.map((c) => ({ id: c.id, label: c.label, type: c.type })),
    });
  } catch (err) {
    console.error('[reports/cases/pivot/drill]', err);
    return res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

// ──────────────────────────────────────────────────────────────────────
// Phase 3.2 — Pivot xlsx export
// ──────────────────────────────────────────────────────────────────────
//
// POST /api/reports/cases/pivot/export
// Body: aynı pivot config (rowColumnId, colColumnId, measure, filters)
// Response: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
//
// Sheet "Pivot Tablo": row × col matrix + sağ Toplam kolonu + alt Toplam
// satırı. Sheet "Bilgi": timestamp + pivot config + filtre özeti.

router.post('/cases/pivot/export', async (req, res) => {
  try {
    await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'report.caseStudio', action: 'export', throwIfEmpty: true });
  } catch (err) {
    if (handleAuthorizationRuntimeError(res, err)) return;
    console.error('[reports/cases/pivot/export][authz]', err);
    return res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
  // pivot endpoint'iyle aynı validation; daha sade dupe etmek yerine bir
  // alt-route helper'ı çıkarmadık (Phase 3.2 minimal; ileride refactor edilebilir).
  const body = req.body ?? {};
  const rowColumnId = typeof body.rowColumnId === 'string' ? body.rowColumnId : '';
  const colColumnId = typeof body.colColumnId === 'string' ? body.colColumnId : '';
  const measure = body.measure ?? {};
  const measureFn = typeof measure.fn === 'string' ? measure.fn : '';
  const measureColumnId = typeof measure.columnId === 'string' ? measure.columnId : '';

  if (!rowColumnId || !colColumnId) {
    return res.status(400).json({ error: 'pivot_dimensions_required', message: 'rowColumnId/colColumnId zorunlu.' });
  }
  if (!PIVOT_MEASURE_FNS.includes(measureFn)) {
    return res.status(400).json({ error: 'pivot_measure_fn_invalid', message: 'Geçersiz pivot fonksiyonu.' });
  }
  if (measureFn !== 'count' && !measureColumnId) {
    return res.status(400).json({ error: 'pivot_measure_column_required', message: `'${measureFn}' için sayısal kolon seçin.` });
  }
  const ids = [rowColumnId, colColumnId];
  if (measureColumnId) ids.push(measureColumnId);
  const { columns: resolvedAll, invalidIds } = resolveColumns(ids);
  if (invalidIds.length > 0) {
    return res.status(400).json({ error: 'columns_invalid', message: `Geçersiz kolon: ${invalidIds.join(', ')}`, invalidIds });
  }
  const rowCol = resolvedAll.find((c) => c.id === rowColumnId);
  const colCol = resolvedAll.find((c) => c.id === colColumnId);
  const measureCol = measureColumnId ? resolvedAll.find((c) => c.id === measureColumnId) : null;
  if (!isPivotableDimension(rowCol)) return res.status(400).json({ error: 'pivot_row_not_pivotable' });
  if (!isPivotableDimension(colCol)) return res.status(400).json({ error: 'pivot_col_not_pivotable' });
  if (measureFn !== 'count' && !isPivotableMeasure(measureCol, measureFn)) {
    return res.status(400).json({ error: 'pivot_measure_not_numeric' });
  }
  const roleCheck = filterColumnsByRole(resolvedAll, req.user?.role ?? null);
  if (roleCheck.forbidden.length > 0) {
    return res.status(403).json({
      error: 'columns_forbidden',
      message: `Bu kolon(lar)a erişim yetkin yok: ${roleCheck.forbidden.join(', ')}`,
      forbiddenIds: roleCheck.forbidden,
    });
  }
  const allowed = await filterAllowedCompanyIdsByResourcePolicy(req, { resourceKey: 'report.caseStudio', action: 'export' });
  const { where, scopeValid } = buildReportWhere(body.filters, allowed);
  if (!scopeValid) {
    return sendPivotXlsx(res, { row: rowCol, col: colCol, measure: { fn: measureFn, columnLabel: measureCol?.label }, piv: { rowLabels: [], colLabels: [], matrix: {}, rowTotals: {}, colTotals: {}, grandTotal: 0 } }, body.filters);
  }
  try {
    const count = await prisma.case.count({ where });
    if (count > PIVOT_MAX_ROWS) {
      return res.status(400).json({ error: 'pivot_limit_exceeded', limit: PIVOT_MAX_ROWS, count });
    }
    const select = buildPrismaSelect(resolvedAll);
    const items = await prisma.case.findMany({ where, select, take: PIVOT_MAX_ROWS });
    const aggregates = await loadAggregatesIfNeeded(resolvedAll, items);
    const rows = buildReportRows(items, resolvedAll, aggregates);
    const rowValues = rows.map((r) => r[rowColumnId]);
    const colValues = rows.map((r) => r[colColumnId]);
    let measureValues = [];
    if (measureColumnId && measureCol) {
      measureValues = items.map((item) => {
        const cf = parseCustomFields(item.customFields);
        const raw = extractRawValue(measureCol, item, cf, aggregates);
        const n = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(n) ? n : null;
      });
    }
    const piv = computePivot({ rowValues, colValues, measureValues, measureFn });
    return sendPivotXlsx(res, {
      row: rowCol, col: colCol,
      measure: { fn: measureFn, columnLabel: measureCol?.label },
      piv,
    }, body.filters);
  } catch (err) {
    console.error('[reports/cases/pivot/export]', err);
    return res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası' });
  }
});

function fmtPivotCellForXlsx(value, fn) {
  if (value == null) return '';
  if (!Number.isFinite(value)) return '';
  // Aynı UI formatPivotCell pattern'i: avg 2 ondalık; integer plain; float 2 ondalık
  if (fn === 'avg') return Math.round(value * 100) / 100;
  if (Number.isInteger(value)) return value;
  return Math.round(value * 100) / 100;
}

function sendPivotXlsx(res, ctx, filters) {
  const { row, col, measure, piv } = ctx;
  // Header satırı: dim label + col labels + Toplam
  const header = [`${row.label} ↓ / ${col.label} →`, ...piv.colLabels, 'Toplam'];
  // Data rows
  const dataRows = piv.rowLabels.map((r) => {
    const cells = piv.colLabels.map((c) => fmtPivotCellForXlsx(piv.matrix[r][c], measure.fn));
    return [r, ...cells, fmtPivotCellForXlsx(piv.rowTotals[r], measure.fn)];
  });
  // Toplam satırı
  const totalsRow = ['Toplam', ...piv.colLabels.map((c) => fmtPivotCellForXlsx(piv.colTotals[c], measure.fn)), fmtPivotCellForXlsx(piv.grandTotal, measure.fn)];
  const aoa = [header, ...dataRows, totalsRow];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 32 }, ...piv.colLabels.map(() => ({ wch: 14 })), { wch: 14 }];
  // Autofilter — sadece data range (totals satırı dahil değil, header dahil)
  if (piv.rowLabels.length > 0) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: piv.rowLabels.length, c: header.length - 1 } }),
    };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pivot Tablo');

  // Bilgi sayfası
  const info = [
    ['Üretim Zamanı', new Date().toISOString()],
    ['Satır Boyutu', `${row.label} (${row.id})`],
    ['Kolon Boyutu', `${col.label} (${col.id})`],
    ['Ölçü Fonksiyonu', measure.fn],
    ...(measure.columnLabel ? [['Ölçü Kolonu', measure.columnLabel]] : []),
    ['Toplam Satır', piv.rowLabels.length],
    ['Toplam Kolon', piv.colLabels.length],
    ...(filters && typeof filters === 'object' ? [['Filtreler', JSON.stringify(filters)]] : []),
  ];
  const infoWs = XLSX.utils.aoa_to_sheet(info);
  infoWs['!cols'] = [{ wch: 18 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, infoWs, 'Bilgi');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="vaka-pivot-${stamp}.xlsx"`);
  return res.send(buf);
}

function sendXlsx(res, columns, rows, meta = {}) {
  // Phase 1.5: Excel sheet — backend buildReportRows zaten TR-formatlanmış
  // string'leri döndürdü; sendXlsx yalnız aoa shape'i kuruyor. Uzun text
  // kolonları (type === 'text') için 'wch' büyük + her hücreye wrap text
  // stili. xlsx kütüphanesi alignment.wrapText'i destekliyor (s.alignment).
  const headerRow = columns.map((c) => c.label);
  const dataRows = rows.map((r) => columns.map((c) => r[c.id]));
  const aoa = [headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws['!cols'] = columns.map((c) => ({
    wch: c.excelWidth ?? Math.max(c.label.length + 2, c.type === 'text' ? 60 : 14),
  }));

  // Uzun text kolonlarında her hücreye wrap text stilini ekle. xlsx.write
  // bookType:'xlsx' bunu strict olarak korur. cellStyles option not set on
  // write — XLSX_CALC flag yok; alignment yine de sheet XML'ine yazılır.
  for (let ci = 0; ci < columns.length; ci++) {
    if (columns[ci].type !== 'text') continue;
    for (let ri = 1; ri <= rows.length; ri++) {
      const cellRef = XLSX.utils.encode_cell({ r: ri, c: ci });
      const cell = ws[cellRef];
      if (cell) {
        cell.s = { ...(cell.s ?? {}), alignment: { wrapText: true, vertical: 'top' } };
      }
    }
  }
  // Autofilter — header range
  if (rows.length > 0) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: columns.length - 1 } }),
    };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Vaka Raporu');

  // Opsiyonel "Bilgi" sayfası — generation timestamp + filter özeti.
  const info = [
    ['Üretim Zamanı', new Date().toISOString()],
    ['Toplam Satır', rows.length],
    ['Sınır (Phase 1)', EXPORT_MAX_ROWS],
  ];
  if (meta.filters && typeof meta.filters === 'object') {
    info.push(['Filtreler', JSON.stringify(meta.filters)]);
  }
  const infoWs = XLSX.utils.aoa_to_sheet(info);
  infoWs['!cols'] = [{ wch: 18 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, infoWs, 'Bilgi');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="vaka-raporu-${stamp}.xlsx"`);
  return res.send(buf);
}

export default router;
