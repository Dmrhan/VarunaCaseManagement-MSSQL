/**
 * WR-A8 — Data Integration Studio (Account import) HTTP routes.
 *
 * Mount: app.use('/api/admin/imports', importsRouter)
 * Auth:  verifyJwt + requireRole('Admin','SystemAdmin') + per-company assertCompanyAdmin
 *
 * Phase 1 — Account hedefi.
 *
 * Önemli:
 *  - companyId payload'ı her endpoint'te zorunlu; assertCompanyAdmin ile doğrulanır.
 *  - Satır verilerindeki herhangi bir "companyId" alanı yok sayılır.
 *  - rawJson içinde hassas alan (API secret vs.) saklamayız; secret zaten BFF'i
 *    aşmaz, dolayısıyla sample/parse response payload'ında da yer almaz.
 *  - Body limiti: 12mb (büyük CSV'leri client'ta parse edip JSON satır olarak
 *    POST etmek için).
 */

import { Router, json as jsonParser } from 'express';
import multer from 'multer';
import { verifyJwt, requireRole } from '../db/auth.js';
import { parseCustomer360Workbook } from '../lib/import/customer360XlsxParser.js';
import {
  describeAccountTargetSchema,
  autoMapAccountColumns,
  validateMapping,
  generateAccountTemplateCsv,
  ACCOUNT_TARGET_VERSION,
} from '../lib/import/targetSchemas/accountTargetSchema.js';
import {
  dryRunAccountImport,
  persistDryRun,
  commitImportJob,
  rollbackImportJob,
  listImportJobs,
  getImportJob,
  listImportJobRows,
} from '../db/importRepository.js';
import { sampleFromApi } from '../lib/import/apiSourceClient.js';
import {
  describeCustomer360Schema,
  autoMapEntityColumns,
  validateEntityMapping,
} from '../lib/import/targetSchemas/customer360TargetSchemas/index.js';
import { dryRunCustomer360, stripCommitRowsFromDryRunResult } from '../lib/import/customer360DryRun.js';
import {
  commitCustomer360,
  rollbackCustomer360,
  getCustomer360Job,
  listCustomer360JobRows,
} from '../lib/import/customer360CommitEngine.js';

const router = Router();

// Bu router'a özel daha büyük body limiti: client tarafında parse edilen CSV/XLSX
// satırları (max 5000) JSON olarak gelebilir. Phase 2a Customer 360 5 entity
// taşıdığı için 24mb'a yükseltildi.
router.use(jsonParser({ limit: '24mb' }));

router.use(verifyJwt, requireRole('Admin', 'SystemAdmin'));

class ImportError extends Error {
  constructor(message, { status = 400, code = 'bad_request' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ImportError) {
        return res.status(err.status).json({ error: err.code, message: err.message });
      }
      if (err?.status) {
        return res
          .status(err.status)
          .json({ error: err.code ?? 'error', message: err.message ?? 'Hata.' });
      }
      console.error('[imports]', err);
      return res.status(500).json({ error: 'internal', message: err?.message ?? 'Sunucu hatası.' });
    }
  };
}

function assertCompanyAdmin(req, companyId) {
  if (!companyId || typeof companyId !== 'string') {
    throw new ImportError('companyId zorunlu.', { status: 400, code: 'company_required' });
  }
  const link = req.user.companyRoles?.find((r) => r.companyId === companyId);
  if (!link || (link.role !== 'Admin' && link.role !== 'SystemAdmin')) {
    throw new ImportError('Bu şirket için admin yetkin yok.', { status: 403, code: 'forbidden' });
  }
}

// ─────────────────────────────────────────────────────────────────
// Target Schema + Template
// ─────────────────────────────────────────────────────────────────

router.get(
  '/targets/account/schema',
  asyncRoute(async (_req, res) => {
    res.json(describeAccountTargetSchema());
  }),
);

router.get(
  '/account/template.csv',
  asyncRoute(async (_req, res) => {
    const csv = generateAccountTemplateCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="varuna-account-import-template.csv"');
    res.send(csv);
  }),
);

// ─────────────────────────────────────────────────────────────────
// Source — File (client-side parsed; BFF satır listesini onaylar)
// ─────────────────────────────────────────────────────────────────
//
// Bu endpoint client'ın parse ettiği CSV/XLSX satırlarını alır, hızlı
// doğrulama yapar (max satır, sütun varlığı). Verileri kalıcı saklamaz —
// yalnızca özet döner ve client mapping/dry-run akışına geçer.

router.post(
  '/account/sources/file/parse',
  asyncRoute(async (req, res) => {
    const { companyId, columns, rows, fileName } = req.body ?? {};
    assertCompanyAdmin(req, companyId);
    if (!Array.isArray(columns) || columns.length === 0) {
      throw new ImportError('Sütun listesi boş.', { code: 'columns_required' });
    }
    if (!Array.isArray(rows)) {
      throw new ImportError('Satır listesi geçersiz.', { code: 'rows_required' });
    }
    if (rows.length > 5000) {
      throw new ImportError('Satır sayısı 5000 sınırını aştı.', { code: 'too_many_rows' });
    }
    const sample = rows.slice(0, 5);
    res.json({
      ok: true,
      fileName: typeof fileName === 'string' ? fileName : null,
      columns,
      totalRows: rows.length,
      sample,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────
// Source — API (BFF outbound; secret BFF içinde resolve edilir)
// ─────────────────────────────────────────────────────────────────

router.post(
  '/account/sources/api/sample',
  asyncRoute(async (req, res) => {
    const { companyId, sourceName, url, method, authType, secretName, headersJson, bodyJson, dataPath, sampleLimit } = req.body ?? {};
    assertCompanyAdmin(req, companyId);
    const result = await sampleFromApi({ url, method, authType, secretName, headersJson, bodyJson, dataPath, sampleLimit });
    if (!result.ok) {
      // 200 ile dön — UI client tarafında error kodunu işlesin
      return res.status(200).json({
        ok: false,
        code: result.code,
        message: result.message,
        status: result.status ?? null,
        totalRows: result.totalRows ?? null,
        maxRows: result.maxRows ?? null,
      });
    }
    // WR-A8 review fix (Issue 1) — rows (tüm import için), sample (yalnız UI
    // preview için) ayrı taşınır; client artık sadece sample'ı import etmez.
    res.json({
      ok: true,
      sourceName: sourceName ?? null,
      sourceUrlMasked: result.sourceUrlMasked,
      columns: result.columns,
      totalRows: result.totalRows,
      rows: result.rows,
      sample: result.sampleRows,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────
// Auto-map + Validate
// ─────────────────────────────────────────────────────────────────

router.post(
  '/account/auto-map',
  asyncRoute(async (req, res) => {
    const { companyId, columns } = req.body ?? {};
    assertCompanyAdmin(req, companyId);
    if (!Array.isArray(columns)) {
      throw new ImportError('Sütun listesi gerekli.', { code: 'columns_required' });
    }
    const suggestions = autoMapAccountColumns(columns);
    res.json({ ok: true, suggestions, targetSchemaVersion: ACCOUNT_TARGET_VERSION });
  }),
);

router.post(
  '/account/validate',
  asyncRoute(async (req, res) => {
    const { companyId, mapping } = req.body ?? {};
    assertCompanyAdmin(req, companyId);
    if (!Array.isArray(mapping)) {
      throw new ImportError('mapping array zorunlu.', { code: 'mapping_required' });
    }
    const r = validateMapping(mapping);
    res.json({ ok: r.ok, errors: r.errors, warnings: r.warnings, targetSchemaVersion: ACCOUNT_TARGET_VERSION });
  }),
);

// ─────────────────────────────────────────────────────────────────
// Dry-run → persist ImportJob (status=validated)
// ─────────────────────────────────────────────────────────────────

router.post(
  '/account/dry-run',
  asyncRoute(async (req, res) => {
    const { companyId, mapping, rows, sourceMeta } = req.body ?? {};
    assertCompanyAdmin(req, companyId);
    if (!Array.isArray(mapping)) {
      throw new ImportError('mapping array zorunlu.', { code: 'mapping_required' });
    }
    if (!Array.isArray(rows)) {
      throw new ImportError('rows array zorunlu.', { code: 'rows_required' });
    }

    const dryRun = await dryRunAccountImport({ companyId, mapping, rows });
    if (!dryRun.ok) {
      return res.json({ ok: false, mapping: dryRun.mapping, targetSchemaVersion: dryRun.targetSchemaVersion });
    }

    const job = await persistDryRun({
      user: req.user,
      companyId,
      sourceMeta: {
        sourceType: sourceMeta?.sourceType === 'api' ? 'api' : 'file',
        sourceName: sourceMeta?.sourceName ?? null,
        sourceUrlMasked: sourceMeta?.sourceUrlMasked ?? null,
        fileName: sourceMeta?.fileName ?? null,
        dataPath: sourceMeta?.dataPath ?? null,
        mapping,
      },
      dryRunResult: dryRun,
    });

    res.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      targetSchemaVersion: dryRun.targetSchemaVersion,
      summary: dryRun.summary,
      mapping: dryRun.mapping,
      preview: dryRun.rows.slice(0, 100).map((r) => ({
        rowNumber: r.rowNumber,
        action: r.action,
        status: r.status,
        errors: r.errors,
        warnings: r.warnings,
        normalized: r.normalized,
        matchedAccountName: r.matchedAccountName,
        matchedAccountVknMasked: r.matchedAccountVknMasked,
        fieldDiff: r.fieldDiff,
      })),
    });
  }),
);

// ─────────────────────────────────────────────────────────────────
// Commit
// ─────────────────────────────────────────────────────────────────

router.post(
  '/account/commit',
  asyncRoute(async (req, res) => {
    const { companyId, jobId, options } = req.body ?? {};
    assertCompanyAdmin(req, companyId);
    if (!jobId || typeof jobId !== 'string') {
      throw new ImportError('jobId zorunlu.', { code: 'job_required' });
    }
    // Job ownership check
    const job = await getImportJob({ jobId, allowedCompanyIds: req.user.allowedCompanyIds });
    if (!job) {
      throw new ImportError('Import job bulunamadı.', { status: 404, code: 'job_not_found' });
    }
    if (job.companyId !== companyId) {
      throw new ImportError('Job başka şirkete ait.', { status: 403, code: 'forbidden' });
    }
    const result = await commitImportJob({ jobId, user: req.user, options: options ?? {} });
    res.json({ ok: true, job: result.job, runStats: result.runStats });
  }),
);

// ─────────────────────────────────────────────────────────────────
// Rollback
// ─────────────────────────────────────────────────────────────────

router.post(
  '/jobs/:id/rollback',
  asyncRoute(async (req, res) => {
    const jobId = req.params.id;
    // Phase 1 endpoint must only ever roll back account-target jobs. The
    // expectedTargetType guard in getImportJob + rollbackImportJob is the
    // backstop against a Customer 360 job id reaching this route by way
    // of a stale UI selection or a malformed client call.
    const job = await getImportJob({
      jobId,
      allowedCompanyIds: req.user.allowedCompanyIds,
      expectedTargetType: 'account',
    });
    if (!job) {
      throw new ImportError('Import job bulunamadı.', { status: 404, code: 'job_not_found' });
    }
    assertCompanyAdmin(req, job.companyId);
    const result = await rollbackImportJob({
      jobId,
      user: req.user,
      expectedTargetType: 'account',
    });
    res.json({ ok: true, job: result.job, report: result.report });
  }),
);

// ─────────────────────────────────────────────────────────────────
// History
// ─────────────────────────────────────────────────────────────────

router.get(
  '/jobs',
  asyncRoute(async (req, res) => {
    const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    // Optional ?targetType=account|customer360 keeps each wizard's history
    // list scoped to its own jobs. Phase 1 sends 'account', Customer 360
    // sends 'customer360'. Omitting it preserves legacy "all jobs" listing.
    const rawTarget = typeof req.query.targetType === 'string' ? req.query.targetType : null;
    const targetType = rawTarget === 'account' || rawTarget === 'customer360' ? rawTarget : null;
    if (companyId) assertCompanyAdmin(req, companyId);
    const items = await listImportJobs({
      allowedCompanyIds: req.user.allowedCompanyIds,
      companyId,
      targetType,
      limit,
    });
    res.json({ value: items });
  }),
);

router.get(
  '/jobs/:id',
  asyncRoute(async (req, res) => {
    const jobId = req.params.id;
    const job = await getImportJob({
      jobId,
      allowedCompanyIds: req.user.allowedCompanyIds,
      expectedTargetType: 'account',
    });
    if (!job) {
      return res.status(404).json({ error: 'job_not_found', message: 'Import job bulunamadı.' });
    }
    res.json(job);
  }),
);

router.get(
  '/jobs/:id/rows',
  asyncRoute(async (req, res) => {
    const jobId = req.params.id;
    const job = await getImportJob({
      jobId,
      allowedCompanyIds: req.user.allowedCompanyIds,
      expectedTargetType: 'account',
    });
    if (!job) {
      return res.status(404).json({ error: 'job_not_found', message: 'Import job bulunamadı.' });
    }
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const rows = await listImportJobRows({ jobId, status, limit, offset });
    res.json({ value: rows });
  }),
);

// ─────────────────────────────────────────────────────────────────
// Customer 360 (Phase 2a — schema + auto-map + validate + dry-run ONLY)
// No commit, no rollback, no DB mutation. Phase 2b will add those.
// ─────────────────────────────────────────────────────────────────

router.get(
  '/targets/customer360/schema',
  asyncRoute(async (_req, res) => {
    res.json(describeCustomer360Schema());
  }),
);

router.post(
  '/customer360/auto-map',
  asyncRoute(async (req, res) => {
    const { companyId, entity, columns } = req.body ?? {};
    assertCompanyAdmin(req, companyId);
    if (!entity || typeof entity !== 'string') {
      throw new ImportError('entity zorunlu.', { code: 'entity_required' });
    }
    if (!Array.isArray(columns)) {
      throw new ImportError('columns array zorunlu.', { code: 'columns_required' });
    }
    const suggestions = autoMapEntityColumns(entity, columns);
    res.json({ ok: true, entity, suggestions });
  }),
);

router.post(
  '/customer360/validate',
  asyncRoute(async (req, res) => {
    const { companyId, entity, mapping } = req.body ?? {};
    assertCompanyAdmin(req, companyId);
    if (!entity || typeof entity !== 'string') {
      throw new ImportError('entity zorunlu.', { code: 'entity_required' });
    }
    if (!Array.isArray(mapping)) {
      throw new ImportError('mapping array zorunlu.', { code: 'mapping_required' });
    }
    const r = validateEntityMapping(entity, mapping);
    res.json({ ok: r.ok, entity, errors: r.errors, warnings: r.warnings });
  }),
);

router.post(
  '/customer360/dry-run',
  asyncRoute(async (req, res) => {
    const { companyId, entities, sourceMeta } = req.body ?? {};
    assertCompanyAdmin(req, companyId);
    if (!entities || typeof entities !== 'object') {
      throw new ImportError('entities zorunlu.', { code: 'entities_required' });
    }
    const result = await dryRunCustomer360({
      companyId,
      allowedCompanyIds: req.user.allowedCompanyIds,
      entities,
      sourceMeta: sourceMeta ?? null,
    });
    // WR-A8 Phase 2b — surface commitAvailable for UI: if registry-level
    // validation passes, commit can proceed (server re-validates as well).
    const commitAvailable = Boolean(
      result.ok === true &&
        !result.code &&
        result.customer360SchemaVersion,
    );
    // Strip rowsForCommit before sending to browser — it's an internal
    // field used by persistJob only; could be tens of MB for large
    // imports and is not part of the dry-run preview contract.
    res.json({ ...stripCommitRowsFromDryRunResult(result), commitAvailable });
  }),
);

// ─────────────────────────────────────────────────────────────────
// Customer 360 — Server-side XLSX dry-run (multipart)
//
// Frontend büyük workbook'u parse edip JSON gövdesi olarak yollayamaz
// (2 MB express body limit + 24 MB router override ineffective). Bu
// endpoint XLSX'i multipart/form-data ile alır, server-side parse edip
// mevcut dryRunCustomer360 engine'ini çalıştırır. Yanıt shape'i JSON
// dry-run ile birebir uyumludur; UI aynı render path'ini kullanır.
//
// Sınırlamalar (Phase B):
//   - Sadece standart Customer 360 şablonu (5 sheet, TR/EN alias).
//   - Legacy preset (Genel/Genel Tekil/Detaylar) DESTEKLENMEZ; client
//     bu workbook'lar için mevcut small-flow'da kalır.
//   - 25 MB file size limit (multer).
//   - 5k account / 10k çocuk entity satır cap'i hâlâ geçerli.
//   - 100k+ / 1M satır için async ImportJob pipeline ayrı PR'da gelecek;
//     bu endpoint o pipeline'a köprü DEĞİL, "medium-large" için PARÇA.
// ─────────────────────────────────────────────────────────────────

/**
 * Codex P2 fix — multipart xlsx route'larında kullanıcının onayladığı
 * eşleştirmeyi (`mappingByEntity`) sunucu-tarafı bundle'a uygula. Yoksa
 * mevcut identity fallback (`source === targetKey`) korunur (standart
 * Customer 360 şablonu zaten kolon başlıklarını target field key olarak
 * taşıdığı için identity güvenli).
 *
 * mappingByEntity shape: Record<entityKey, Array<{source, targetKey}>>.
 * Per-entity yokluğu identity'ye düşer; per-entity boş array verilirse
 * normalize çalıştırılmaz (registry'nin "mapping yok" davranışı).
 *
 * Doğrulamalar:
 *   - mappingByEntity null/undefined → tümü identity.
 *   - Entity bilinmiyorsa o key sessizce atlanır (bundle dışı).
 *   - source/targetKey string değilse o mapping satırı atılır (defansif).
 */
function buildXlsxEntitiesPayload(parsedBundle, userMapping) {
  const out = {};
  const map = userMapping && typeof userMapping === 'object' ? userMapping : null;
  for (const [entityKey, block] of Object.entries(parsedBundle)) {
    const userEntityMapping = map?.[entityKey];
    let mapping;
    if (Array.isArray(userEntityMapping)) {
      mapping = userEntityMapping.filter(
        (m) => m && typeof m.source === 'string' && typeof m.targetKey === 'string',
      );
    } else {
      mapping = block.columns.map((c) => ({ source: c, targetKey: c }));
    }
    out[entityKey] = { columns: block.columns, mapping, rows: block.rows };
  }
  return out;
}

const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const okMime =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/octet-stream' || // bazı tarayıcılar
      file.mimetype === 'application/zip'; // XLSX aslında zip
    const okExt = /\.xlsx?$/i.test(file.originalname ?? '');
    if (!okMime && !okExt) {
      return cb(
        Object.assign(new Error('Sadece XLSX dosyaları kabul edilir.'), {
          code: 'unsupported_file_type',
          status: 415,
        }),
      );
    }
    cb(null, true);
  },
});

router.post(
  '/customer360/dry-run-xlsx',
  (req, res, next) => {
    xlsxUpload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            code: 'payload_too_large',
            message:
              'Dosya 25 MB sunucu sınırının üstünde. Lütfen Excel\'i daha küçük parçalara bölüp her parçayı ayrı dry-run + commit ile yükleyin.',
            maxBytes: 25 * 1024 * 1024,
          });
        }
        return res.status(400).json({ code: err.code ?? 'multer_error', message: err.message });
      }
      if (err?.code === 'unsupported_file_type') {
        return res.status(415).json({ code: 'unsupported_file_type', message: err.message });
      }
      return res.status(400).json({ code: 'upload_failed', message: err?.message ?? 'Yükleme başarısız.' });
    });
  },
  asyncRoute(async (req, res) => {
    const file = req.file;
    if (!file || !file.buffer) {
      throw new ImportError('file zorunlu (multipart/form-data alanı).', { code: 'file_required' });
    }

    const companyId = (req.body?.companyId ?? '').toString().trim();
    assertCompanyAdmin(req, companyId);

    let sourceMeta = null;
    if (req.body?.sourceMeta) {
      try {
        sourceMeta = JSON.parse(req.body.sourceMeta);
      } catch {
        throw new ImportError('sourceMeta JSON parse edilemedi.', { code: 'source_meta_invalid' });
      }
    }
    // Codex P2 fix — kullanıcı UI'da custom field mapping yapmış olabilir;
    // varsa mappingByEntity ile gelir, yoksa identity fallback (kolon ===
    // field key) korunur. Çift parse'li body güvenli (boyut multer
    // limit'inde).
    let mappingByEntity = null;
    if (req.body?.mapping) {
      try { mappingByEntity = JSON.parse(req.body.mapping); }
      catch { throw new ImportError('mapping JSON parse edilemedi.', { code: 'mapping_invalid' }); }
    }

    const parsed = parseCustomer360Workbook(file.buffer);
    if (!parsed.ok) {
      const status = parsed.error.code === 'unsupported_legacy_layout' ? 422 : 400;
      return res.status(status).json({
        code: parsed.error.code,
        message: parsed.error.message,
        meta: parsed.error.meta ?? null,
      });
    }

    const entitiesPayload = buildXlsxEntitiesPayload(parsed.bundle, mappingByEntity);

    const result = await dryRunCustomer360({
      companyId,
      allowedCompanyIds: req.user.allowedCompanyIds,
      entities: entitiesPayload,
      sourceMeta: sourceMeta ?? {
        sourceType: 'file',
        fileName: file.originalname ?? 'workbook.xlsx',
        byteSize: file.size,
      },
    });
    const commitAvailable = Boolean(
      result.ok === true && !result.code && result.customer360SchemaVersion,
    );
    // Strip rowsForCommit before sending to browser (internal commit-time
    // field; not part of dry-run preview contract).
    res.json({
      ...stripCommitRowsFromDryRunResult(result),
      commitAvailable,
      serverParseInfo: parsed.info,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────
// Phase 2b — Commit + Rollback + Job audit (Customer 360)
// ─────────────────────────────────────────────────────────────────

router.post(
  '/customer360/commit',
  asyncRoute(async (req, res) => {
    const { companyId, entities, sourceMeta, options, jobId } = req.body ?? {};
    assertCompanyAdmin(req, companyId);
    if (!jobId && (!entities || typeof entities !== 'object')) {
      throw new ImportError('entities veya jobId zorunlu.', { code: 'entities_or_jobid_required' });
    }
    const result = await commitCustomer360({
      user: req.user,
      companyId,
      entities,
      sourceMeta: sourceMeta ?? null,
      options: options ?? {},
      jobId: jobId ?? null,
    });
    res.json({ ok: true, ...result });
  }),
);

// ─────────────────────────────────────────────────────────────────
// Customer 360 — Tick-mode commit (Hobby/serverless 60s ceiling)
//
// Büyük dosyalar (5k+ müşteri) tek call'da hem 2 MB body limit'i hem 60s
// function ceiling'i aşıyor. Çözüm:
//   1. POST /customer360/commit-xlsx  — multipart raw XLSX + ilk tick.
//      Body 2 MB sınırından bağımsız; sunucu parse + dry-run + persist +
//      maxRowsPerCall kadar satır işler. jobId + progress döner.
//   2. POST /customer360/jobs/:id/commit-tick — küçük JSON body
//      ({ maxRowsPerCall, skipErrors }). Resume yolu üzerinden sonraki
//      tick'i işler. Frontend hasMore=false olana kadar loop'lar.
//
// Maliyet/kapsam: hâlâ 5k–10k aralığı için pragmatic; permanent 100k–1M
// async pipeline OD-174'te. Müşteri Ana Kartı (Phase 1) import yolu
// dokunulmadı.
// ─────────────────────────────────────────────────────────────────

router.post(
  '/customer360/commit-xlsx',
  (req, res, next) => {
    xlsxUpload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            code: 'payload_too_large',
            message:
              'Dosya 25 MB sunucu sınırının üstünde. Excel\'i parçalara bölüp her parçayı ayrı commit ile yükleyin.',
            maxBytes: 25 * 1024 * 1024,
          });
        }
        return res.status(400).json({ code: err.code ?? 'multer_error', message: err.message });
      }
      if (err?.code === 'unsupported_file_type') {
        return res.status(415).json({ code: 'unsupported_file_type', message: err.message });
      }
      return res.status(400).json({ code: 'upload_failed', message: err?.message ?? 'Yükleme başarısız.' });
    });
  },
  asyncRoute(async (req, res) => {
    const file = req.file;
    if (!file || !file.buffer) {
      throw new ImportError('file zorunlu (multipart/form-data alanı).', { code: 'file_required' });
    }

    const companyId = (req.body?.companyId ?? '').toString().trim();
    assertCompanyAdmin(req, companyId);

    let sourceMeta = null;
    if (req.body?.sourceMeta) {
      try { sourceMeta = JSON.parse(req.body.sourceMeta); }
      catch { throw new ImportError('sourceMeta JSON parse edilemedi.', { code: 'source_meta_invalid' }); }
    }
    let options = { skipErrors: true };
    if (req.body?.options) {
      try {
        const parsed = JSON.parse(req.body.options);
        options = { ...options, ...parsed };
      } catch { throw new ImportError('options JSON parse edilemedi.', { code: 'options_invalid' }); }
    }
    if (req.body?.maxRowsPerCall) {
      const n = Number(req.body.maxRowsPerCall);
      if (Number.isFinite(n) && n > 0) options.maxRowsPerCall = Math.floor(n);
    }
    // Codex P2 fix — kullanıcının onayladığı mapping commit'te de aynen
    // uygulanır; dry-run preview ile commit sonucunun aynı normalize
    // path'ini yürütmesini garanti eder. Yoksa identity fallback.
    let mappingByEntity = null;
    if (req.body?.mapping) {
      try { mappingByEntity = JSON.parse(req.body.mapping); }
      catch { throw new ImportError('mapping JSON parse edilemedi.', { code: 'mapping_invalid' }); }
    }

    const parsed = parseCustomer360Workbook(file.buffer);
    if (!parsed.ok) {
      const status = parsed.error.code === 'unsupported_legacy_layout' ? 422 : 400;
      return res.status(status).json({
        code: parsed.error.code,
        message: parsed.error.message,
        meta: parsed.error.meta ?? null,
      });
    }

    const entitiesPayload = buildXlsxEntitiesPayload(parsed.bundle, mappingByEntity);

    const result = await commitCustomer360({
      user: req.user,
      companyId,
      entities: entitiesPayload,
      sourceMeta: sourceMeta ?? {
        sourceType: 'file',
        fileName: file.originalname ?? 'workbook.xlsx',
        byteSize: file.size,
      },
      options,
      jobId: null,
    });
    res.json({ ok: true, ...result, serverParseInfo: parsed.info });
  }),
);

router.post(
  '/customer360/jobs/:id/commit-tick',
  asyncRoute(async (req, res) => {
    const jobId = req.params.id;
    const job = await getCustomer360Job({ jobId, allowedCompanyIds: req.user.allowedCompanyIds });
    if (!job) throw new ImportError('Import job bulunamadı.', { status: 404, code: 'job_not_found' });
    assertCompanyAdmin(req, job.companyId);
    const options = { skipErrors: true, ...(req.body?.options ?? {}) };
    if (req.body?.maxRowsPerCall) {
      const n = Number(req.body.maxRowsPerCall);
      if (Number.isFinite(n) && n > 0) options.maxRowsPerCall = Math.floor(n);
    }
    const result = await commitCustomer360({
      user: req.user,
      companyId: job.companyId,
      entities: null,
      sourceMeta: null,
      options,
      jobId,
    });
    res.json({ ok: true, ...result });
  }),
);

router.post(
  '/customer360/jobs/:id/rollback',
  asyncRoute(async (req, res) => {
    const jobId = req.params.id;
    const job = await getCustomer360Job({ jobId, allowedCompanyIds: req.user.allowedCompanyIds });
    if (!job) throw new ImportError('Import job bulunamadı.', { status: 404, code: 'job_not_found' });
    assertCompanyAdmin(req, job.companyId);
    const result = await rollbackCustomer360({ jobId, user: req.user });
    res.json({ ok: true, ...result });
  }),
);

router.get(
  '/customer360/jobs/:id',
  asyncRoute(async (req, res) => {
    const jobId = req.params.id;
    const job = await getCustomer360Job({ jobId, allowedCompanyIds: req.user.allowedCompanyIds });
    if (!job) return res.status(404).json({ error: 'job_not_found', message: 'Import job bulunamadı.' });
    res.json(job);
  }),
);

router.get(
  '/customer360/jobs/:id/rows',
  asyncRoute(async (req, res) => {
    const jobId = req.params.id;
    const job = await getCustomer360Job({ jobId, allowedCompanyIds: req.user.allowedCompanyIds });
    if (!job) return res.status(404).json({ error: 'job_not_found', message: 'Import job bulunamadı.' });
    const entity = typeof req.query.entity === 'string' ? req.query.entity : null;
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const limit = req.query.limit ? Number(req.query.limit) : 500;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const rows = await listCustomer360JobRows({ jobId, entity, status, limit, offset });
    res.json({ value: rows });
  }),
);

export default router;
