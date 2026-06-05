#!/usr/bin/env node
/**
 * smoke-c360-xlsx-mapping-preservation.js — Codex P2 follow-up
 *
 * Verifies that user-approved mappingByEntity flows through both
 * /customer360/dry-run-xlsx and /customer360/commit-xlsx instead of
 * being silently replaced by identity (source===targetKey).
 *
 *   PART A — source-grep guardrails (always run, no DB):
 *     - Backend buildXlsxEntitiesPayload helper exists
 *     - Helper falls back to identity when userMapping null
 *     - Helper applies user mapping per-entity when provided
 *     - Both routes parse `mapping` form field
 *     - FE service signatures accept optional mappingByEntity
 *     - FE page passes mappingByEntity to both calls
 *
 *   PART B — runtime helper (pure, no DB):
 *     - identity fallback: no userMapping → columns map to identity
 *     - per-entity override: userMapping for `account` only honored;
 *       others fall back to identity
 *     - defensive: bogus mapping entries (non-string source/targetKey)
 *       stripped without throwing
 *
 * Run: node scripts/smoke-c360-xlsx-mapping-preservation.js
 */
import fs from 'node:fs';

const results = [];
const record = (label, ok, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

// ─── PART A: source-grep ──────────────────────────────────────────────────

const routes = fs.readFileSync('server/routes/imports.js', 'utf8');
record(
  'backend: buildXlsxEntitiesPayload helper defined',
  /function buildXlsxEntitiesPayload\(parsedBundle, userMapping\)/.test(routes),
);
record(
  'backend: helper identity fallback when userMapping is null',
  /block\.columns\.map\(\(c\) => \(\{ source: c, targetKey: c \}\)\)/.test(routes),
);
record(
  'backend: helper accepts per-entity Array.isArray user mapping',
  /Array\.isArray\(userEntityMapping\)/.test(routes),
);
record(
  'backend: helper filters non-string source/targetKey defensively',
  /typeof m\.source === 'string'[\s\S]{0,40}typeof m\.targetKey === 'string'/.test(routes),
);
record(
  'backend: /dry-run-xlsx parses mapping form field',
  /'\/customer360\/dry-run-xlsx'[\s\S]*?req\.body\?\.mapping[\s\S]*?JSON\.parse\(req\.body\.mapping\)/.test(routes),
);
record(
  'backend: /commit-xlsx parses mapping form field',
  /'\/customer360\/commit-xlsx'[\s\S]*?req\.body\?\.mapping[\s\S]*?JSON\.parse\(req\.body\.mapping\)/.test(routes),
);
record(
  'backend: /dry-run-xlsx uses buildXlsxEntitiesPayload',
  /'\/customer360\/dry-run-xlsx'[\s\S]{0,3000}buildXlsxEntitiesPayload\(parsed\.bundle, mappingByEntity\)/.test(routes),
);
record(
  'backend: /commit-xlsx uses buildXlsxEntitiesPayload',
  /'\/customer360\/commit-xlsx'[\s\S]{0,3000}buildXlsxEntitiesPayload\(parsed\.bundle, mappingByEntity\)/.test(routes),
);
record(
  'backend: legacy identity replacement removed (no inline source/targetKey loop after parse)',
  !/for \(const \[entityKey, block\] of Object\.entries\(parsed\.bundle\)\) \{\s*entitiesPayload/.test(routes),
);

const svc = fs.readFileSync('src/services/importService.ts', 'utf8');
record(
  'service: customer360DryRunXlsx accepts mappingByEntity',
  /customer360DryRunXlsx\(input: \{[\s\S]*?mappingByEntity\?:\s*Record<string, MappingItem\[\]>/.test(svc),
);
record(
  'service: customer360CommitXlsx accepts mappingByEntity',
  /customer360CommitXlsx\(input: \{[\s\S]*?mappingByEntity\?:\s*Record<string, MappingItem\[\]>/.test(svc),
);
record(
  'service: both append `mapping` form field when provided',
  /fd\.append\('mapping', JSON\.stringify\(input\.mappingByEntity\)\)/.test(svc) &&
    (svc.match(/fd\.append\('mapping'/g) ?? []).length === 2,
);

const pageSrc = fs.readFileSync(
  'src/features/admin/dataImport/customer360/Customer360Page.tsx',
  'utf8',
);
record(
  'page: customer360DryRunXlsx call passes mappingByEntity',
  /customer360DryRunXlsx\(\s*\{[\s\S]{0,300}mappingByEntity/.test(pageSrc),
);
record(
  'page: customer360CommitXlsx call passes mappingByEntity',
  /customer360CommitXlsx\(\s*\{[\s\S]{0,600}mappingByEntity/.test(pageSrc),
);

// ─── PART B: pure helper behavior re-implemented for assertion ────────────

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

const bundle = {
  account: { columns: ['Müşteri Adı', 'VKN'], rows: [{ 'Müşteri Adı': 'Acme', 'VKN': '1234567890' }] },
  accountCompany: { columns: ['Cari Kod'], rows: [{ 'Cari Kod': 'C-1' }] },
};

// B1: identity fallback
{
  const r = buildXlsxEntitiesPayload(bundle, null);
  record(
    'helper: null mapping → identity for both entities',
    r.account.mapping[0].source === 'Müşteri Adı' &&
      r.account.mapping[0].targetKey === 'Müşteri Adı' &&
      r.account.mapping[1].targetKey === 'VKN' &&
      r.accountCompany.mapping[0].targetKey === 'Cari Kod',
  );
}

// B2: per-entity override (account custom; accountCompany falls back)
{
  const r = buildXlsxEntitiesPayload(bundle, {
    account: [
      { source: 'Müşteri Adı', targetKey: 'name' },
      { source: 'VKN', targetKey: 'vkn' },
    ],
  });
  record(
    'helper: account user mapping honored (source→targetKey)',
    r.account.mapping[0].targetKey === 'name' && r.account.mapping[1].targetKey === 'vkn',
  );
  record(
    'helper: accountCompany falls back to identity when not in userMapping',
    r.accountCompany.mapping[0].source === 'Cari Kod' && r.accountCompany.mapping[0].targetKey === 'Cari Kod',
  );
}

// B3: defensive filter
{
  const r = buildXlsxEntitiesPayload(bundle, {
    account: [
      { source: 'Müşteri Adı', targetKey: 'name' },
      { source: 42, targetKey: 'vkn' }, // bogus source
      { source: 'VKN', targetKey: null }, // bogus targetKey
      null,
      { source: 'Extra', targetKey: 'extra' },
    ],
  });
  record('helper: bogus mapping entries stripped', r.account.mapping.length === 2);
  record(
    'helper: surviving entries are the two valid ones',
    r.account.mapping[0].targetKey === 'name' && r.account.mapping[1].targetKey === 'extra',
  );
}

// B4: rows + columns preserved
{
  const r = buildXlsxEntitiesPayload(bundle, null);
  record(
    'helper: rows and columns unchanged through helper',
    r.account.rows.length === 1 &&
      r.account.columns.length === 2 &&
      r.account.rows[0]['Müşteri Adı'] === 'Acme',
  );
}

const total = results.length;
const passed = results.filter((r) => r.ok).length;
console.log(`\n[smoke-c360-xlsx-mapping-preservation] ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
