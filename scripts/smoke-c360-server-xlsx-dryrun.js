#!/usr/bin/env node
/**
 * smoke-c360-server-xlsx-dryrun.js — Phase B server-side XLSX dry-run
 *
 * PART A — pure parser unit tests (always run, no DB/network):
 *   - sheet alias mapping (TR + EN)
 *   - cell normalize (NULL/-/whitespace/"33652.0")
 *   - legacy sheet detection → structured error
 *   - no recognized sheet → structured error
 *   - missing account sheet → structured error
 *   - row cap exceeded → structured error
 *   - happy path: standart 5-sheet workbook → bundle counts correct
 *
 * PART B — in-process Express + multer route test (no DB):
 *   - multipart POST with a small XLSX file → multer parses → 400/422 expected
 *     because dryRunCustomer360 hits Prisma. Skipped if Prisma fails.
 *   - 26 MB body → 413 structured payload_too_large
 *   - unsupported content type → 415
 *
 * Run: node --env-file=.env scripts/smoke-c360-server-xlsx-dryrun.js
 */
import fs from 'node:fs';
import http from 'node:http';
import * as XLSX from 'xlsx';
import express from 'express';
import multer from 'multer';
import { parseCustomer360Workbook, __testing__ } from '../server/lib/import/customer360XlsxParser.js';

const results = [];
const record = (label, ok, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

// ─── helpers ──────────────────────────────────────────────────────────────

function buildWorkbookBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false });
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ─── PART A: pure parser unit tests ───────────────────────────────────────

record(
  'alias: "Müşteri Ana Kartı" → account',
  __testing__.mapSheetNameToEntity('Müşteri Ana Kartı') === 'account',
);
record(
  'alias: "Accounts" → account',
  __testing__.mapSheetNameToEntity('Accounts') === 'account',
);
record(
  'alias: "İlişkili Şirket" → accountCompany',
  __testing__.mapSheetNameToEntity('İlişkili Şirket') === 'accountCompany',
);
record(
  'alias: "Projeler" → accountProject',
  __testing__.mapSheetNameToEntity('Projeler') === 'accountProject',
);
record(
  'alias: unknown sheet → null',
  __testing__.mapSheetNameToEntity('RandomSheet') === null,
);

record('legacy: "Genel" detected', __testing__.isLegacySheet('Genel') === true);
record('legacy: "Genel Tekil" detected', __testing__.isLegacySheet('Genel Tekil') === true);
record('legacy: "Detaylar" detected', __testing__.isLegacySheet('Detaylar') === true);
record('legacy: "Accounts" NOT legacy', __testing__.isLegacySheet('Accounts') === false);

record('cell: "NULL" → ""', __testing__.normalizeCell('NULL') === '');
record('cell: " - " → ""', __testing__.normalizeCell(' - ') === '');
record('cell: "33652.0" → "33652"', __testing__.normalizeCell('33652.0') === '33652');
record('cell: "  John  " → "John"', __testing__.normalizeCell('  John  ') === 'John');
record('cell: undefined → ""', __testing__.normalizeCell(undefined) === '');

// Happy path: standard 5-sheet template
{
  const buf = buildWorkbookBuffer([
    { name: 'Accounts', rows: [{ vkn: '1234567890', name: 'ACME LTD' }, { vkn: '1112223334', name: 'BETA AŞ' }] },
    { name: 'Companies', rows: [{ accountKey: '1234567890', externalCustomerCode: 'A001' }] },
    { name: 'Contacts', rows: [{ accountKey: '1234567890', email: 'a@b.com' }] },
    { name: 'Addresses', rows: [{ accountKey: '1234567890', line1: 'Sokak 1' }] },
    { name: 'Projects', rows: [{ accountCompanyKey: 'A001', code: 'P-1' }] },
  ]);
  const r = parseCustomer360Workbook(buf);
  record('parser: 5-sheet template → ok', r.ok === true);
  if (r.ok) {
    record('parser: account.totalRows === 2', r.bundle.account.totalRows === 2);
    record('parser: accountCompany.totalRows === 1', r.bundle.accountCompany.totalRows === 1);
    record('parser: accountProject.totalRows === 1', r.bundle.accountProject.totalRows === 1);
    record('parser: info.mappedSheets === 5', r.info.mappedSheets.length === 5);
  }
}

// Legacy preset → structured error
{
  const buf = buildWorkbookBuffer([
    { name: 'Genel Tekil', rows: [{ vkn: '1234567890', name: 'X' }] },
    { name: 'Detaylar', rows: [{ accountKey: '1234567890', email: 'x@y.com' }] },
  ]);
  const r = parseCustomer360Workbook(buf);
  record('parser: legacy preset → ok=false + unsupported_legacy_layout', !r.ok && r.error.code === 'unsupported_legacy_layout');
  record('parser: legacy meta has legacySheets', Array.isArray(r.error?.meta?.legacySheets) && r.error.meta.legacySheets.length === 2);
}

// No recognized sheet
{
  const buf = buildWorkbookBuffer([{ name: 'RandomSheet', rows: [{ a: 1 }] }]);
  const r = parseCustomer360Workbook(buf);
  record('parser: no recognized sheet → no_recognized_sheet', !r.ok && r.error.code === 'no_recognized_sheet');
}

// Missing required account sheet
{
  const buf = buildWorkbookBuffer([{ name: 'Companies', rows: [{ accountKey: '1234567890', externalCustomerCode: 'A001' }] }]);
  const r = parseCustomer360Workbook(buf);
  record('parser: missing account sheet → missing_required_sheet', !r.ok && r.error.code === 'missing_required_sheet');
}

// Row cap exceeded
{
  const rows = Array.from({ length: 5001 }, (_, i) => ({ vkn: String(1000000000 + i), name: `Co ${i}` }));
  const buf = buildWorkbookBuffer([{ name: 'Accounts', rows }]);
  const r = parseCustomer360Workbook(buf);
  record('parser: 5001 account rows → row_cap_exceeded', !r.ok && r.error.code === 'row_cap_exceeded');
}

// Garbage buffer: XLSX library is forgiving, may parse it into a single
// "Sheet1" → reaches no_recognized_sheet. Empty buffer or null → invalid.
{
  const r = parseCustomer360Workbook(Buffer.from('not an xlsx', 'utf8'));
  record(
    'parser: garbage text buffer → graceful structured error (no throw)',
    !r.ok && (r.error.code === 'no_recognized_sheet' || r.error.code === 'invalid_workbook'),
    r.error.code,
  );
}
{
  const r = parseCustomer360Workbook(null);
  record('parser: null buffer → invalid_buffer', !r.ok && r.error.code === 'invalid_buffer');
}

// ─── PART B: in-process Express + multer route ────────────────────────────

async function testRouteIntegration() {
  const xlsxUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
    fileFilter(_req, file, cb) {
      const okExt = /\.xlsx?$/i.test(file.originalname ?? '');
      if (!okExt) {
        return cb(Object.assign(new Error('Sadece XLSX'), { code: 'unsupported_file_type', status: 415 }));
      }
      cb(null, true);
    },
  });

  const app = express();
  app.post(
    '/test/dry-run-xlsx',
    (req, res, next) => {
      xlsxUpload.single('file')(req, res, (err) => {
        if (!err) return next();
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ code: 'payload_too_large', message: 'too large', maxBytes: 25 * 1024 * 1024 });
          }
          return res.status(400).json({ code: err.code });
        }
        if (err?.code === 'unsupported_file_type') {
          return res.status(415).json({ code: 'unsupported_file_type', message: err.message });
        }
        return res.status(400).json({ code: 'upload_failed', message: err?.message });
      });
    },
    (req, res) => {
      if (!req.file?.buffer) return res.status(400).json({ code: 'file_required' });
      const parsed = parseCustomer360Workbook(req.file.buffer);
      if (!parsed.ok) {
        const status = parsed.error.code === 'unsupported_legacy_layout' ? 422 : 400;
        return res.status(status).json({ code: parsed.error.code, message: parsed.error.message });
      }
      res.json({ ok: true, info: parsed.info });
    },
  );

  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  try {
    // 1. Happy path multipart
    const buf = buildWorkbookBuffer([
      { name: 'Accounts', rows: [{ vkn: '1234567890', name: 'ACME LTD' }] },
    ]);
    const fd = new FormData();
    fd.append('companyId', 'co-test');
    fd.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'test.xlsx');
    const r = await fetch(`http://127.0.0.1:${port}/test/dry-run-xlsx`, { method: 'POST', body: fd });
    const j = await r.json().catch(() => null);
    record('route: happy multipart → 200 + ok=true', r.status === 200 && j?.ok === true, JSON.stringify(j));

    // 2. Legacy workbook → 422 unsupported_legacy_layout
    const legacyBuf = buildWorkbookBuffer([
      { name: 'Genel Tekil', rows: [{ vkn: '1234567890', name: 'X' }] },
    ]);
    const fd2 = new FormData();
    fd2.append('file', new Blob([legacyBuf]), 'legacy.xlsx');
    const r2 = await fetch(`http://127.0.0.1:${port}/test/dry-run-xlsx`, { method: 'POST', body: fd2 });
    const j2 = await r2.json().catch(() => null);
    record('route: legacy workbook → 422 unsupported_legacy_layout', r2.status === 422 && j2?.code === 'unsupported_legacy_layout', `status ${r2.status}`);

    // 3. Unsupported extension → 415
    const fd3 = new FormData();
    fd3.append('file', new Blob(['hello']), 'notes.txt');
    const r3 = await fetch(`http://127.0.0.1:${port}/test/dry-run-xlsx`, { method: 'POST', body: fd3 });
    const j3 = await r3.json().catch(() => null);
    record('route: .txt upload → 415 unsupported_file_type', r3.status === 415 && j3?.code === 'unsupported_file_type', `status ${r3.status}`);

    // 4. Oversize → 413 (skip if memory cost too high; we use 26 MB dummy zip-shaped)
    const bigBuf = Buffer.alloc(26 * 1024 * 1024, 0x50); // 26 MB raw
    const fd4 = new FormData();
    fd4.append('file', new Blob([bigBuf]), 'huge.xlsx');
    const r4 = await fetch(`http://127.0.0.1:${port}/test/dry-run-xlsx`, { method: 'POST', body: fd4 });
    const j4 = await r4.json().catch(() => null);
    record('route: 26 MB upload → 413 payload_too_large', r4.status === 413 && j4?.code === 'payload_too_large', `status ${r4.status}`);
  } finally {
    server.close();
  }
}

try {
  await testRouteIntegration();
} catch (err) {
  record('PART B exception', false, err?.message || String(err));
}

// ─── PART C: source-grep — no schema migration, no commit/rollback change ─

const importSvcSrc = fs.readFileSync('src/services/importService.ts', 'utf8');
record(
  'importService.ts: existing /dry-run JSON endpoint untouched',
  /postJson\(`\$\{BASE\}\/customer360\/dry-run`/.test(importSvcSrc),
);
record(
  'importService.ts: new customer360DryRunXlsx exists',
  /customer360DryRunXlsx/.test(importSvcSrc),
);
record(
  'importService.ts: commit endpoint untouched',
  /postJson\(`\$\{BASE\}\/customer360\/commit`/.test(importSvcSrc),
);
record(
  'importService.ts: Phase 1 /account/dry-run untouched',
  /\$\{BASE\}\/account\/dry-run/.test(importSvcSrc),
);

const schemaSrc = fs.readFileSync('prisma/schema.prisma', 'utf8');
record(
  'prisma/schema.prisma: no new model added in this PR (grep ImportStagingRow)',
  !/model\s+ImportStagingRow/.test(schemaSrc),
);

const total = results.length;
const passed = results.filter((r) => r.ok).length;
console.log(`\n[smoke-c360-server-xlsx-dryrun] ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
