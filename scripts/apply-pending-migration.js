#!/usr/bin/env node
/**
 * One-off migration applier — Phase D Step 1.
 *
 * Sadece şu migration dosyasını okur ve uygular:
 *   prisma/migrations/20260518180000_add_customer_match_pending/migration.sql
 *
 * Kurallar:
 *  - Tek migration SQL dosyası dışında hiçbir DB mutasyonu yok.
 *  - Idempotent: column zaten varsa atlar; UPDATE zaten where filter'lı.
 *  - Apply sonrası doğrulama:
 *      • Case.customerMatchPending column exists
 *      • CompanySettings.requireCustomerOnCaseCreate column exists
 *      • COUNT(Case where accountId IS NULL) === COUNT(Case where accountId IS NULL AND customerMatchPending = true)
 *  - Hassas DB URL credentials redact.
 *
 * Çalıştır:
 *   node --env-file=.env scripts/apply-pending-migration.js
 */

import { prisma } from '../server/db/client.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATION_SQL = path.resolve(
  __dirname,
  '../prisma/migrations/20260518180000_add_customer_match_pending/migration.sql',
);

const POSTGRES_DUPLICATE_COLUMN = '42701';

function sanitizeDbUrl(url) {
  if (!url) return '(env yok)';
  // postgres://user:pass@host/db → postgres://user:<redacted>@host/db
  return url.replace(/(:\/\/[^:]+:)[^@/]+(@)/, '$1<redacted>$2').slice(0, 90);
}

async function columnExists(table, column) {
  const rows = await prisma.$queryRaw`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
      AND column_name = ${column}
    LIMIT 1
  `;
  return Array.isArray(rows) && rows.length > 0;
}

async function applyStatement(stmt) {
  try {
    const rows = await prisma.$executeRawUnsafe(stmt);
    return { ok: true, rows: typeof rows === 'number' ? rows : null };
  } catch (err) {
    // Idempotent: column zaten varsa skip
    if (err?.meta?.code === POSTGRES_DUPLICATE_COLUMN || /already exists/i.test(err?.message ?? '')) {
      return { ok: true, skipped: true };
    }
    return { ok: false, err };
  }
}

async function main() {
  console.log('🔧 apply-pending-migration — Phase D Step 1\n');
  console.log(`Migration file: ${path.relative(process.cwd(), MIGRATION_SQL)}`);
  console.log(`Target DB:      ${sanitizeDbUrl(process.env.DATABASE_URL)}\n`);

  const sql = readFileSync(MIGRATION_SQL, 'utf8');
  console.log('── Migration contents ──');
  console.log(sql.trim());
  console.log('────────────────────────\n');

  const statements = sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s && s.replace(/--[^\n]*/g, '').trim().length > 0);

  console.log(`Applying ${statements.length} statement(s)...`);
  for (const stmt of statements) {
    const firstLine = stmt.split('\n').find((l) => l.trim() && !l.trim().startsWith('--'))?.slice(0, 90) ?? '<stmt>';
    const result = await applyStatement(stmt);
    if (!result.ok) {
      console.error(`  ✗ ${firstLine}`);
      console.error(`     -> ${result.err?.message ?? result.err}`);
      throw result.err;
    }
    if (result.skipped) {
      console.log(`  ~ skipped (already): ${firstLine}`);
    } else if (typeof result.rows === 'number') {
      console.log(`  ✓ ${firstLine}  (rows=${result.rows})`);
    } else {
      console.log(`  ✓ ${firstLine}`);
    }
  }

  // ── Validation ──
  console.log('\n── Validation ──');

  const caseColumnOk = await columnExists('Case', 'customerMatchPending');
  console.log(`  ${caseColumnOk ? '✓' : '✗'} Case.customerMatchPending exists`);

  const settingsColumnOk = await columnExists('CompanySettings', 'requireCustomerOnCaseCreate');
  console.log(`  ${settingsColumnOk ? '✓' : '✗'} CompanySettings.requireCustomerOnCaseCreate exists`);

  const nullAccount = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM "Case" WHERE "accountId" IS NULL`;
  const nullAccountMatched = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n FROM "Case"
    WHERE "accountId" IS NULL AND "customerMatchPending" = true
  `;
  const totalNull = nullAccount?.[0]?.n ?? 0;
  const matchedNull = nullAccountMatched?.[0]?.n ?? 0;
  const backfillOk = totalNull === matchedNull;
  console.log(
    `  ${backfillOk ? '✓' : '✗'} accountId IS NULL backfill match: ${matchedNull}/${totalNull}`,
  );

  // Bonus diagnostics — total counts (sensitive payload yok)
  const totalCases = await prisma.case.count();
  const totalSettings = await prisma.companySettings.count();
  console.log(`  ℹ total cases: ${totalCases}, total CompanySettings rows: ${totalSettings}`);

  const allOk = caseColumnOk && settingsColumnOk && backfillOk;
  console.log(`\n${allOk ? '✅' : '❌'} Phase 1 DB apply ${allOk ? 'PASS' : 'FAIL'}`);

  await prisma.$disconnect();
  process.exit(allOk ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\n✗ apply-pending-migration FAILED:', err?.message ?? err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
