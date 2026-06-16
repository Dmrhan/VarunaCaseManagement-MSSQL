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
} from '../lib/caseReport/columnRegistry.js';
import { buildReportWhere } from '../lib/caseReport/buildWhere.js';
import { buildReportRows } from '../lib/caseReport/buildRows.js';
import { loadSolutionStepAggregates } from '../lib/caseReport/aggregates.js';

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
const PREVIEW_MAX_PAGE_SIZE = 200;
const EXPORT_MAX_ROWS = 5000;

/**
 * GET /api/reports/cases/columns
 * Tüm kolonları ve kategori etiketlerini döner. Yetkisiz column gizleme
 * (Phase 2'de privacyTag === 'pii' role gate) henüz yok — Phase 1 kolonları
 * KVKK güvenli alt küme (customerContact* ve Account VKN/TCKN/phone hariç).
 */
router.get('/cases/columns', (req, res) => {
  res.json({
    categories: REPORT_COLUMN_CATEGORIES,
    columns: REPORT_COLUMNS.map((c) => ({
      id: c.id,
      label: c.label,
      category: c.category,
      type: c.type,
      source: c.source,
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
    // Phase 2A: aggregate column varsa, sayfa içindeki case'lerin
    // CaseSolutionStep'lerini TEK batch ile çek. Aggregate seçilmediyse
    // fetch SKIP — perf.
    const aggregates = {};
    if (needsSolutionStepAggregates(columns) && items.length > 0) {
      aggregates.solutionSteps = await loadSolutionStepAggregates(
        prisma,
        items.map((i) => i.id),
      );
    }
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
    // Phase 2A: export'ta aynı aggregate akışı — preview ile bire bir paylaşılır.
    const aggregates = {};
    if (needsSolutionStepAggregates(columns) && items.length > 0) {
      aggregates.solutionSteps = await loadSolutionStepAggregates(
        prisma,
        items.map((i) => i.id),
      );
    }
    const rows = buildReportRows(items, columns, aggregates);
    return sendXlsx(res, columns, rows, { filters: body.filters, count });
  } catch (err) {
    console.error('[reports/cases/export]', err);
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
