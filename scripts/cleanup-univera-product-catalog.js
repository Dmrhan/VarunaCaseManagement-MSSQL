/**
 * cleanup-univera-product-catalog.js
 *
 * Guarded cleanup of UNIVERA-only Product Catalog + Package Catalog seed data.
 * Used when the project manager wants to reset UNIVERA's catalog and rebuild
 * it manually. PARAM and FINROTA are NEVER touched.
 *
 * Usage:
 *   node --env-file=.env scripts/cleanup-univera-product-catalog.js
 *       → dry-run: print counts + lists, no DB mutation
 *
 *   node --env-file=.env scripts/cleanup-univera-product-catalog.js --execute
 *       → wraps the whole cleanup in a single Prisma transaction:
 *         1. Clear FK references that point to UNIVERA catalog/package rows
 *            (Case.{productId,productName,packageId,packageName},
 *             AccountCompany.packageId,
 *             AccountProduct.productId — snapshot productName/Code kept)
 *         2. Delete PackageItems (UNIVERA)
 *         3. Delete Packages (UNIVERA)
 *         4. Delete Products (UNIVERA)
 *         5. Delete ProductGroups (UNIVERA)
 *
 * Idempotent: re-running after --execute → counts are zero, transaction is a
 * no-op, customer/case/account rows preserved.
 *
 * Hard rules:
 *   - Account / AccountCompany / AccountProduct / Case rows are NEVER deleted.
 *   - PARAM / FINROTA catalog rows are NEVER touched.
 *   - AccountProduct snapshots (productName / productCode) are preserved
 *     so customer product history survives even after catalog removal.
 *   - AccountCompany.packageName (legacy free-text) is preserved.
 *
 * Exit codes:
 *   0  — success (dry-run printed; or --execute completed)
 *   1  — aborted (multi-resolve, no UNIVERA, or post-execute verification failed)
 */

import { prisma } from '../server/db/client.js';

const UNIVERA_ID_HINTS = ['COMP-UNIVERA'];
const UNIVERA_NAME_HINTS = ['UNIVERA'];

const EXECUTE = process.argv.includes('--execute');

function fmt(n) { return String(n).padStart(4, ' '); }
function line(label, value) {
  console.log(`  ${label.padEnd(48, ' ')} ${value}`);
}
function header(title) {
  console.log(`\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`);
}

async function resolveUniveraCompany() {
  // Try id hints first, then exact name match.
  const candidates = await prisma.company.findMany({
    where: {
      OR: [
        { id: { in: UNIVERA_ID_HINTS } },
        { name: { in: UNIVERA_NAME_HINTS } },
      ],
    },
    select: { id: true, name: true, isActive: true },
  });
  if (candidates.length === 0) {
    console.error('[ABORT] UNIVERA company not found (looked for ids %j, names %j).', UNIVERA_ID_HINTS, UNIVERA_NAME_HINTS);
    process.exit(1);
  }
  // De-dupe by id (in case both id+name match same row).
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const uniq = [...byId.values()];
  if (uniq.length > 1) {
    console.error('[ABORT] Multiple UNIVERA candidates resolved: %j', uniq.map((c) => `${c.id} (${c.name})`));
    process.exit(1);
  }
  return uniq[0];
}

async function main() {
  header(`Mode: ${EXECUTE ? 'EXECUTE (DB will be mutated)' : 'DRY-RUN (no DB mutation)'}`);

  const company = await resolveUniveraCompany();
  line('Resolved UNIVERA company', `${company.id} (${company.name})  isActive=${company.isActive}`);

  // ───── Collect UNIVERA catalog IDs ─────
  const productGroups = await prisma.productGroup.findMany({
    where: { companyId: company.id },
    select: { id: true, code: true, name: true, isActive: true },
    orderBy: [{ name: 'asc' }],
  });
  const products = await prisma.product.findMany({
    where: { companyId: company.id },
    select: { id: true, code: true, name: true, isActive: true, productGroupId: true },
    orderBy: [{ name: 'asc' }],
  });
  const packages = await prisma.package.findMany({
    where: { companyId: company.id },
    select: { id: true, code: true, name: true, isActive: true },
    orderBy: [{ name: 'asc' }],
  });
  const packageItemCount = packages.length === 0 ? 0 : await prisma.packageItem.count({
    where: { package: { companyId: company.id } },
  });

  const productIds = products.map((p) => p.id);
  const packageIds = packages.map((p) => p.id);

  header('UNIVERA catalog rows to be removed');
  line('ProductGroup count', fmt(productGroups.length));
  for (const g of productGroups) line(`  · ${g.code} — ${g.name}`, g.isActive ? 'active' : 'inactive');
  line('Product count', fmt(products.length));
  for (const p of products) line(`  · ${p.code} — ${p.name}`, p.isActive ? 'active' : 'inactive');
  line('Package count', fmt(packages.length));
  for (const p of packages) line(`  · ${p.code} — ${p.name}`, p.isActive ? 'active' : 'inactive');
  line('PackageItem count', fmt(packageItemCount));

  // ───── Collect dependent FK references ─────
  const caseProductCount = productIds.length === 0 ? 0 : await prisma.case.count({
    where: { productId: { in: productIds } },
  });
  const casePackageCount = packageIds.length === 0 ? 0 : await prisma.case.count({
    where: { packageId: { in: packageIds } },
  });
  const acPackageCount = packageIds.length === 0 ? 0 : await prisma.accountCompany.count({
    where: { packageId: { in: packageIds } },
  });
  const accountProductCount = productIds.length === 0 ? 0 : await prisma.accountProduct.count({
    where: { productId: { in: productIds } },
  });

  header('Dependent references that will be CLEARED (not deleted)');
  line('Cases that will have productId/productName cleared', fmt(caseProductCount));
  line('Cases that will have packageId/packageName cleared', fmt(casePackageCount));
  line('AccountCompany.packageId references to clear', fmt(acPackageCount));
  line('  (legacy AccountCompany.packageName is PRESERVED)', '');
  line('AccountProduct.productId references to clear', fmt(accountProductCount));
  line('  (AccountProduct row + productName/Code snapshot PRESERVED)', '');

  // ───── PARAM / FINROTA untouched confirmation ─────
  const paramProducts = await prisma.product.count({ where: { companyId: 'COMP-PARAM' } });
  const finrotaProducts = await prisma.product.count({ where: { companyId: 'COMP-FINROTA' } });
  const paramPackages = await prisma.package.count({ where: { companyId: 'COMP-PARAM' } });
  const finrotaPackages = await prisma.package.count({ where: { companyId: 'COMP-FINROTA' } });

  header('PARAM / FINROTA — NOT TOUCHED (pre-cleanup counts for reference)');
  line('PARAM Product count', fmt(paramProducts));
  line('PARAM Package count', fmt(paramPackages));
  line('FINROTA Product count', fmt(finrotaProducts));
  line('FINROTA Package count', fmt(finrotaPackages));

  if (!EXECUTE) {
    header('DRY-RUN COMPLETE');
    console.log('  Re-run with --execute to actually delete UNIVERA catalog rows.');
    console.log('  No DB mutation occurred. PARAM/FINROTA untouched.');
    await prisma.$disconnect();
    process.exit(0);
  }

  // ────────────────────────────────────────────────────────────
  // EXECUTE — Prisma transaction
  // ────────────────────────────────────────────────────────────
  header('EXECUTING transaction…');

  const result = await prisma.$transaction(async (tx) => {
    // 1) Clear Case.{productId, productName}
    const caseProductCleared = productIds.length === 0 ? { count: 0 } : await tx.case.updateMany({
      where: { productId: { in: productIds } },
      data: { productId: null, productName: null },
    });
    // 2) Clear Case.{packageId, packageName}
    const casePackageCleared = packageIds.length === 0 ? { count: 0 } : await tx.case.updateMany({
      where: { packageId: { in: packageIds } },
      data: { packageId: null, packageName: null },
    });
    // 3) Clear AccountCompany.packageId (keep packageName legacy snapshot)
    const acPackageCleared = packageIds.length === 0 ? { count: 0 } : await tx.accountCompany.updateMany({
      where: { packageId: { in: packageIds } },
      data: { packageId: null },
    });
    // 4) Clear AccountProduct.productId (keep productName/Code snapshot)
    const accountProductCleared = productIds.length === 0 ? { count: 0 } : await tx.accountProduct.updateMany({
      where: { productId: { in: productIds } },
      data: { productId: null },
    });
    // 5) Delete PackageItems (must precede Package + Product)
    const piDeleted = packageIds.length === 0 ? { count: 0 } : await tx.packageItem.deleteMany({
      where: { packageId: { in: packageIds } },
    });
    // 6) Delete Packages
    const pkgDeleted = packageIds.length === 0 ? { count: 0 } : await tx.package.deleteMany({
      where: { companyId: company.id },
    });
    // 7) Delete Products
    const prodDeleted = productIds.length === 0 ? { count: 0 } : await tx.product.deleteMany({
      where: { companyId: company.id },
    });
    // 8) Delete ProductGroups
    const pgDeleted = productGroups.length === 0 ? { count: 0 } : await tx.productGroup.deleteMany({
      where: { companyId: company.id },
    });

    return {
      caseProductCleared: caseProductCleared.count,
      casePackageCleared: casePackageCleared.count,
      acPackageCleared: acPackageCleared.count,
      accountProductCleared: accountProductCleared.count,
      piDeleted: piDeleted.count,
      pkgDeleted: pkgDeleted.count,
      prodDeleted: prodDeleted.count,
      pgDeleted: pgDeleted.count,
    };
  });

  header('Transaction success — counts');
  line('Case.product cleared', fmt(result.caseProductCleared));
  line('Case.package cleared', fmt(result.casePackageCleared));
  line('AccountCompany.packageId cleared', fmt(result.acPackageCleared));
  line('AccountProduct.productId cleared', fmt(result.accountProductCleared));
  line('PackageItem deleted', fmt(result.piDeleted));
  line('Package deleted', fmt(result.pkgDeleted));
  line('Product deleted', fmt(result.prodDeleted));
  line('ProductGroup deleted', fmt(result.pgDeleted));

  // ────────────────────────────────────────────────────────────
  // POST-EXECUTE VERIFICATION
  // ────────────────────────────────────────────────────────────
  const remainingPg = await prisma.productGroup.count({ where: { companyId: company.id } });
  const remainingProd = await prisma.product.count({ where: { companyId: company.id } });
  const remainingPkg = await prisma.package.count({ where: { companyId: company.id } });
  const remainingPi = await prisma.packageItem.count({ where: { package: { companyId: company.id } } });

  const paramProductsAfter = await prisma.product.count({ where: { companyId: 'COMP-PARAM' } });
  const finrotaProductsAfter = await prisma.product.count({ where: { companyId: 'COMP-FINROTA' } });
  const paramPackagesAfter = await prisma.package.count({ where: { companyId: 'COMP-PARAM' } });
  const finrotaPackagesAfter = await prisma.package.count({ where: { companyId: 'COMP-FINROTA' } });

  // Cross-check: no surviving FK refs to deleted UNIVERA ids.
  const orphanCaseProduct = productIds.length === 0 ? 0 : await prisma.case.count({
    where: { productId: { in: productIds } },
  });
  const orphanCasePackage = packageIds.length === 0 ? 0 : await prisma.case.count({
    where: { packageId: { in: packageIds } },
  });
  const orphanAcPackage = packageIds.length === 0 ? 0 : await prisma.accountCompany.count({
    where: { packageId: { in: packageIds } },
  });
  const orphanAccountProduct = productIds.length === 0 ? 0 : await prisma.accountProduct.count({
    where: { productId: { in: productIds } },
  });

  // AccountProduct survival check: rows whose IDs we cleared should still exist
  // (the rows weren't deleted; only productId was nulled). We can't easily look
  // up rows-we-touched without storing IDs, but a global "no AP references
  // UNIVERA productIds" check is enough proof + AP count is positive proves
  // rows survived overall.
  const remainingAccountProducts = await prisma.accountProduct.count();

  header('Post-execute verification');
  line('UNIVERA ProductGroup remaining', fmt(remainingPg));
  line('UNIVERA Product remaining', fmt(remainingProd));
  line('UNIVERA Package remaining', fmt(remainingPkg));
  line('UNIVERA PackageItem remaining', fmt(remainingPi));
  line('PARAM Product (unchanged)', `${paramProductsAfter} (was ${paramProducts})`);
  line('PARAM Package (unchanged)', `${paramPackagesAfter} (was ${paramPackages})`);
  line('FINROTA Product (unchanged)', `${finrotaProductsAfter} (was ${finrotaProducts})`);
  line('FINROTA Package (unchanged)', `${finrotaPackagesAfter} (was ${finrotaPackages})`);
  line('Case rows still referencing deleted UNIVERA productIds', fmt(orphanCaseProduct));
  line('Case rows still referencing deleted UNIVERA packageIds', fmt(orphanCasePackage));
  line('AccountCompany still referencing deleted packageIds', fmt(orphanAcPackage));
  line('AccountProduct still referencing deleted productIds', fmt(orphanAccountProduct));
  line('AccountProduct total rows surviving (system-wide)', fmt(remainingAccountProducts));

  const ok =
    remainingPg === 0 &&
    remainingProd === 0 &&
    remainingPkg === 0 &&
    remainingPi === 0 &&
    paramProductsAfter === paramProducts &&
    paramPackagesAfter === paramPackages &&
    finrotaProductsAfter === finrotaProducts &&
    finrotaPackagesAfter === finrotaPackages &&
    orphanCaseProduct === 0 &&
    orphanCasePackage === 0 &&
    orphanAcPackage === 0 &&
    orphanAccountProduct === 0;

  await prisma.$disconnect();

  if (!ok) {
    console.error('\n[VERIFICATION FAILED] Some invariant did not hold. See counts above.');
    process.exit(1);
  }

  console.log('\n[VERIFICATION PASSED] UNIVERA catalog removed safely; PARAM/FINROTA untouched; customer/case/account rows preserved.');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[ERROR]', err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
