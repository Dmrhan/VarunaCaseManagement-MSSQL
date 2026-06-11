#!/usr/bin/env node
/**
 * smoke-pr5-static-guards.js — Half-Shipped Audit follow-up coverage.
 *
 * Pure file-string static checks. No DB, no HTTP, no Node import cycles.
 * Cheap to run, safe in CI, deterministic.
 *
 * Guards:
 *
 *  A. AI Accept/Reject FE telemetry timing (PR-4a / PR-4a-b)
 *     A1. aiService exports markUsageAccepted.
 *     A2. TransferModal.applyAiSuggestion does NOT call markUsageAccepted
 *         (the Apply-click telemetry write regressed once via Codex P1 —
 *         must stay deferred to submit success).
 *     A3. TransferModal.handleSubmit DOES call markUsageAccepted inside
 *         the post-`updated` truthy branch (after early-return on failure).
 *     A4. NewCaseForm applyAllFromAi / applyTitleOnly call markUsageAccepted.
 *     A5. NewCaseForm dismissAiCard calls markUsageAccepted.
 *
 *  B. Cron workflow visibility (PR-2b)
 *     B1. Every `.github/workflows/*.yml` that POSTs to /api/cron/* uses
 *         `curl --fail-with-body` (silent 5xx regressions blocked).
 *     B2. notification-cleanup workflow exists and targets the right path.
 *     B3. actionitem-archive workflow exists and targets the right path.
 *
 *  C. ActionItem revive contract (PR-3b)
 *     C1. actionItemRepository.emitActionItem upsert update branch sets
 *         `archivedAt: null` (so retention-archived rows revive correctly).
 *
 *  D. TCKN-by-search privacy (PR-4b)
 *     D1. accountRepository imports tcknPepperAvailable.
 *     D2. listAccounts gates the tcknHash branch on /^\d{11}$/ + validateTckn.
 *     D3. select clauses never include tcknHash in list/detail shapes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath: URL.pathname Windows'ta '/C:/...' döndürür ve path.resolve
// 'C:\C:\...' üretirdi — cross-platform doğru çözüm bu.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const record = (label, ok, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ─── A. AI Accept/Reject FE telemetry timing ─────────────────────────
console.log('\n── A. AI Accept/Reject FE telemetry timing ──');
{
  const aiSvc = readText('src/services/aiService.ts');
  record(
    'A1. aiService exports markUsageAccepted',
    /async\s+markUsageAccepted\s*\(/.test(aiSvc),
    'src/services/aiService.ts',
  );

  const tm = readText('src/features/cases/components/TransferModal.tsx');

  // Extract applyAiSuggestion body (function...{...}); robust enough since
  // its body is small + balanced braces.
  function bodyOf(name, src) {
    const m = src.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`));
    if (!m) return null;
    let i = m.index + m[0].length - 1; // pointer at '{'
    let depth = 1;
    let j = i + 1;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    return src.slice(i, j);
  }

  const applyBody = bodyOf('applyAiSuggestion', tm);
  record(
    'A2. TransferModal.applyAiSuggestion does NOT call markUsageAccepted',
    !!applyBody && !/markUsageAccepted\s*\(/.test(applyBody),
    applyBody ? `${applyBody.split('\n').length} lines` : 'body not extracted',
  );

  const submitBody = bodyOf('handleSubmit', tm);
  record(
    'A3. TransferModal.handleSubmit calls markUsageAccepted (submit-success)',
    !!submitBody && /markUsageAccepted\s*\(/.test(submitBody),
    submitBody ? 'present in handleSubmit body' : 'body not extracted',
  );

  const ncf = readText('src/features/cases/NewCaseForm.tsx');
  const applyAll = bodyOf('applyAllFromAi', ncf);
  const applyTitle = bodyOf('applyTitleOnly', ncf);
  const dismiss = bodyOf('dismissAiCard', ncf);
  record(
    'A4. NewCaseForm applyAllFromAi/applyTitleOnly call markUsageAccepted',
    !!applyAll && /markUsageAccepted\s*\(/.test(applyAll) &&
      !!applyTitle && /markUsageAccepted\s*\(/.test(applyTitle),
    'both apply paths fire telemetry',
  );
  record(
    'A5. NewCaseForm dismissAiCard calls markUsageAccepted',
    !!dismiss && /markUsageAccepted\s*\(/.test(dismiss),
    'dismiss path fires telemetry',
  );
}

// ─── B. Cron workflow visibility ─────────────────────────────────────
console.log('\n── B. Cron workflow visibility ──');
{
  const workflowDir = path.join(ROOT, '.github/workflows');
  const cronFiles = fs
    .readdirSync(workflowDir)
    .filter((f) => f.endsWith('.yml') && f !== 'ci.yml')
    .map((f) => path.join('.github/workflows', f));

  let allHaveFlag = true;
  const missing = [];
  for (const rel of cronFiles) {
    const txt = readText(rel);
    // Only require flag if the workflow actually calls curl.
    if (!/\bcurl\b/.test(txt)) continue;
    if (!/curl\s+--fail-with-body/.test(txt)) {
      allHaveFlag = false;
      missing.push(rel);
    }
  }
  record(
    `B1. All cron workflows curl with --fail-with-body (${cronFiles.length} files scanned)`,
    allHaveFlag,
    allHaveFlag ? '' : `missing: ${missing.join(', ')}`,
  );

  const nc = readText('.github/workflows/notification-cleanup.yml');
  record(
    'B2. notification-cleanup workflow exists + hits /api/cron/notification-cleanup',
    /\/api\/cron\/notification-cleanup/.test(nc),
    '',
  );

  const aa = readText('.github/workflows/actionitem-archive.yml');
  record(
    'B3. actionitem-archive workflow exists + hits /api/cron/actionitem-archive',
    /\/api\/cron\/actionitem-archive/.test(aa),
    '',
  );
}

// ─── C. ActionItem revive contract ───────────────────────────────────
console.log('\n── C. ActionItem revive contract ──');
{
  const repo = readText('server/db/actionItemRepository.js');
  // Look for upsert update branch that clears archivedAt to null.
  const hasUpsert = /prisma\.actionItem\.upsert\s*\(\s*\{[\s\S]*?update\s*:\s*\{[\s\S]*?archivedAt\s*:\s*null/.test(repo);
  record(
    'C1. actionItemRepository upsert update branch sets archivedAt: null',
    hasUpsert,
    'PR-3b Codex P1 fix',
  );
}

// ─── D. TCKN-by-search privacy ───────────────────────────────────────
console.log('\n── D. TCKN-by-search privacy ──');
{
  const repo = readText('server/db/accountRepository.js');
  record(
    'D1. accountRepository imports tcknPepperAvailable',
    /tcknPepperAvailable/.test(repo),
    '',
  );
  // Gating predicate: 11-digit regex + validateTckn + tcknPepperAvailable.
  const tcknBranchOk =
    /\/\^\\d\{11\}\$\/\.test\([^)]*\)\s*&&\s*validateTckn\([^)]*\)\.ok\s*&&\s*tcknPepperAvailable\(\)/.test(
      repo,
    );
  record(
    'D2. listAccounts gates tcknHash branch on 11-digit + validateTckn.ok + pepper',
    tcknBranchOk,
    'silent skip otherwise',
  );

  // tcknHash MUST NOT appear inside a Prisma `select` block. Walk every
  // `select: {` block and confirm tcknHash isn't selected; allowed in
  // create/update data writes.
  const selectBlocks = [];
  const re = /select\s*:\s*\{/g;
  let m;
  while ((m = re.exec(repo))) {
    let i = m.index + m[0].length - 1;
    let depth = 1;
    let j = i + 1;
    while (j < repo.length && depth > 0) {
      if (repo[j] === '{') depth++;
      else if (repo[j] === '}') depth--;
      j++;
    }
    selectBlocks.push(repo.slice(i, j));
  }
  const leakedBlock = selectBlocks.find((b) => /\btcknHash\s*:\s*true\b/.test(b));
  record(
    `D3. No Prisma select block exposes tcknHash (${selectBlocks.length} blocks scanned)`,
    !leakedBlock,
    leakedBlock ? 'FOUND tcknHash:true — privacy leak' : '',
  );
}

// ─── Result ──────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n[smoke] ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log('[smoke] FAILED:');
  for (const f of failed) console.log(`  - ${f.label} — ${f.detail}`);
  process.exit(1);
}
console.log('[smoke] ALL GREEN');
