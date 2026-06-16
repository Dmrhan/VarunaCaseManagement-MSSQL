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
import { buildReportRows } from '../lib/caseReport/buildRows.js';
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

/**
 * GET /api/reports/cases/columns
 * Tüm kolonları ve kategori etiketlerini döner. Yetkisiz column gizleme
 * (Phase 2'de privacyTag === 'pii' role gate) henüz yok — Phase 1 kolonları
 * KVKK güvenli alt küme (customerContact* ve Account VKN/TCKN/phone hariç).
 */
router.get('/cases/columns', (req, res) => {
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

  const allowed = Array.isArray(req.user?.allowedCompanyIds) ? req.user.allowedCompanyIds : [];
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

  const allowed = Array.isArray(req.user?.allowedCompanyIds) ? req.user.allowedCompanyIds : [];
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

  const allowed = Array.isArray(req.user?.allowedCompanyIds) ? req.user.allowedCompanyIds : [];
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
    // Aggregate column'lar Phase 3.1'de pivot dim/measure olarak izinli değil;
    // yine de buildReportRows'tan değer geçirelim ki ileride genişletmek kolay.
    const aggregates = await loadAggregatesIfNeeded(resolvedAll, items);
    const rows = buildReportRows(items, resolvedAll, aggregates);
    // Pivot input'ları topla — buildReportRows formatlanmış string döndürür.
    // Row/col dim için label olarak formatted string kullanılır (TR display).
    // Measure için: count → ignore; diğerleri için raw numeric Number(string).
    const rowValues = rows.map((r) => r[rowColumnId]);
    const colValues = rows.map((r) => r[colColumnId]);
    let measureValues = [];
    if (measureColumnId) {
      measureValues = rows.map((r) => {
        const v = r[measureColumnId];
        const n = typeof v === 'number' ? v : Number(v);
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
