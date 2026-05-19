# Agentic Planning Card — A7 Package Catalog Foundation

- **Work Register ID:** A7
- **Product Planning Matrix ID:** PM-05 (Catalog) — Package alt-bölümü
- **Product capability:** Tenant-scoped paket/sözleşme bundle modeli + Package ↔ Product join. UNIVERA WhitePackage/RedPackage gibi paket adları artık Product değil Package. Foundation for AccountCompany.packageId, Case.packageId, reporting by package.
- **Request source:** Backlog A7 — A6 Product Catalog Foundation (PR #167) + A6 Product.supportLevel follow-up (PR #173) shipped olduktan sonra ardışık adım.
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-20
- **Protocol versiyonu:** 2.0
- **Scope guard:** FOUNDATION ONLY. **No** `Case.productId` migration, **no** Case form picker, **no** ProductPackage auto-resolution in case create, **no** SLA rewrite, **no** `AccountCompany.packageId` in this PR.

---

## ① Product Fit

- **Problem:** A6 Product Catalog ürünleri (uygulamalar/modüller/servisler) modelliyor; paket/sözleşme bundle'ı yok. Şu an `AccountCompany.packageName` serbest string (örn. "Enterprise"). UNIVERA WhitePackage/RedPackage'ı seed'de Product DEĞİL diye reserved'da tutmuştuk — bu PR onları gerçek Package olarak konumlandırır. PARAM/FINROTA için tahsilat/POS paket adları ileride sözleşme/raporlama altyapısının temeli.

- **Business fit:**
  - **UNIVERA** — WhitePackage, RedPackage, BlackPackage, EnterprisePackage (4 paket)
  - **PARAM** — POS Başlangıç, POS Pro, Pazaryeri, Kurumsal Tahsilat (4 paket)
  - **FINROTA** — Tahsilat Basic, Tahsilat Plus, Open Banking Pro, Enterprise Finance (4 paket)

- **Affected roles:**
  - Admin / SystemAdmin — Package CRUD + PackageItem ürün ataması
  - Diğer roller — bu PR'da yok (UI Case form picker'a girmedi; A7b'de gelir)

- **Acceptance criteria:**
  1. `Package` modeli (id, companyId, code, name, description, supportLevel, sortOrder, isActive, timestamps); `@@unique([companyId, code])` + `@@index([companyId, isActive])` + `@@index([companyId, supportLevel])`
  2. `PackageItem` modeli (packageId, productId, sortOrder, createdAt); `@@id([packageId, productId])` composite PK + `@@index([productId])`
  3. PackageItem FK: package CASCADE, product RESTRICT (paket içinde kullanılan ürün hard-delete edilemez)
  4. **Cross-table invariant:** `Package.companyId === Product.companyId` her PackageItem için. Prisma DB-level enforce edemez; repository + smoke + data-contract enforce eder.
  5. Admin CRUD endpoints: `/api/admin/packages` (GET/POST/PATCH), `/api/admin/packages/:id/items` (GET/PUT). Admin/SystemAdmin only.
  6. PUT items bulk-replace: deduped productIds, unknown product → 400 `package_product_invalid`, cross-company product → 400 `package_product_company_mismatch`
  7. `code` immutable after create (A6 D-A6.2 pattern)
  8. `Case.productId`, `AccountCompany.packageId`, `Case.packageId` eklenmez
  9. `AccountCompany.packageName` legacy free string korunur (A4 backward-compat)
  10. AdminProductCatalogPage: Package section paneli; product assignment için multi-select; ürün sayımı + supportLevel badge
  11. Seed: 12 package across PARAM/UNIVERA/FINROTA + ~50 PackageItem; WhitePackage/RedPackage Package olarak, **Product değil**
  12. Smoke 13 senaryo + data-contracts extension (7 invariant)

- **Out-of-scope:**
  - `Case.productId` / `Case.packageId` migration
  - Case form product/package picker
  - Auto-resolve product → package in case create
  - `AccountCompany.packageId` FK (legacy packageName free string kalır)
  - SLA/escalation tier-aware rewrite (Phase 2)
  - Reporting / analytics by package
  - Cross-company package "template" inheritance

- **Decisions:**
  - **D-A7.1:** PackageItem composite PK `(packageId, productId)` — duplicate row impossible at DB level; PUT bulk-replace pattern (delete-all + create-new in single transaction).
  - **D-A7.2:** PackageItem same-company invariant enforced at write (PUT items) + smoke + contract. Prisma'da DB-level CHECK constraint Prisma-managed schema'da clean değil; app-layer + audit yeterli.
  - **D-A7.3:** PUT items bulk-replace — partial-set isteyenler için ayrı PATCH endpoint Phase 2. Şimdilik tam set replace daha açık API.
  - **D-A7.4:** `code` immutable; PATCH'te silently ignored (A6 D-A6.2 pattern).
  - **D-A7.5:** `Product` onDelete RESTRICT for PackageItem — paketteki ürün silinmek istenirse önce paketlerden çıkarılması gerekir; veri kaybı koruması.
  - **D-A7.6:** WhitePackage/RedPackage seed sırasında "Product table'ında olmamalı" invariant'i contract'ta enforce edilir — A6 seed'inde zaten Product olarak yok; A7 seed'i bunu Package olarak ekler. Smoke + contract regression olarak sürekli kontrol eder.

---

## ② Critical Files

**Schema/migration:**
- `prisma/schema.prisma` — `Package` + `PackageItem` modelleri + `Company.packages` + `Product.packageItems` reverse relations
- `prisma/migrations/20260520160000_add_package_catalog/migration.sql`

**BFF:**
- `server/db/adminRepository.js` — `packageRepo` (list/create/update + items get/replace) — `normalizeSupportLevel` + `normalizeCode` shared helpers
- `server/routes/admin.js` — 5 yeni route

**Frontend:**
- `src/services/adminService.ts` — `Package` + `PackageItem` types + service methods
- `src/features/admin/AdminProductCatalogPage.tsx` — yeni "Paketler" sekmesi/sectionı: package list (left) + assigned product checkboxes (right)

**Seed/smoke:**
- `scripts/seed-full-demo-scenarios.js` — yeni step 3.9 Package seed + PackageItem upsert
- `scripts/smoke-package-catalog.js` — yeni (13 senaryo)
- `scripts/smoke-data-contracts.js` — yeni "Package Catalog Contract" group (7 invariant)

---

## ③ Performance & Architecture Gate

| # | Concern | Address |
|---|---|---|
| 1 | **Indexed FK + scope index** | `Package`: `@@unique([companyId, code])`, `@@index([companyId, isActive])`, `@@index([companyId, supportLevel])`. `PackageItem`: composite PK + `@@index([productId])`. List query hot path indexed. |
| 2 | **No relation-heavy `include` in hot paths** | `packageRepo.list` Package satırlarını scalar select + ayrı `productCount` via `count`. PackageItems'i ayrı endpoint'te (`:id/items`) almak: list view'a productlar JOIN'lenmez. |
| 3 | **N+1 guard** | List: tek `findMany` Package + tek `groupBy` PackageItem ile productCount; per-package query yok. Items endpoint: tek query (packageId scope). |
| 4 | **Unbounded list cap** | Mevcut `take: 500` pattern korunur. PackageItem PUT body cap 200 productId (app-layer). |
| 5 | **`count()` vs `findMany().length`** | `prisma.packageItem.groupBy` + `_count` kullanılır. Smoke/contract `prisma.package.count`. |
| 6 | **Large query guard** | Cross-company query yok; assertCompanyAdmin gating. |
| 7 | **Mutation atomicity** | PUT items: `prisma.$transaction([deleteMany, createMany])` — atomic replace. Cross-company check pre-transaction. P2002 → 409 conflict mapping mevcut. |
| 8 | **UI loading state** | Mevcut AdminProductCatalogPage pattern korunur (Card layout). Modal disable + spinner; full-screen blocker yok. |
| 9 | **Lazy load** | Yeni component zaten admin route altında. Bundle etkisi ihmal edilebilir. |
| 10 | **Connection pool** | Yeni endpoint sayısı 5. Heavy path PUT items (max 2 query in transaction). Supabase pooler için risk yok. |

**Verdict: PASS.**

---

## ④ Test Plan (özet)

**Smoke (13 senaryo):**
1. Admin creates Package → 201
2. Admin updates Package supportLevel → 200
3. Admin assigns 3 products via PUT items → 200 + items returned
4. PUT items with duplicate productIds → deduped, success
5. PUT items with cross-company productId → 400 `package_product_company_mismatch`
6. PUT items with unknown productId → 400 `package_product_invalid`
7. Duplicate package code same company → 409
8. Same package code different company → 201
9. Soft deactivate package → 200, DB isActive=false
10. Agent POST package → 403
11. Backoffice PATCH package → 403
12. Cross-tenant: out-of-scope companyId → 403
13. Seed coverage: PARAM/UNIVERA/FINROTA each ≥2 packages; UNIVERA WhitePackage + RedPackage in Package, NOT in Product

**Data contracts (Package Catalog Contract — 7 invariant):**
- PK.1 Package.companyId column + FK to Company
- PK.2 PackageItem composite PK (packageId, productId)
- PK.3 Package.companyId == Product.companyId for every PackageItem (cross-table same-company invariant)
- PK.4 No duplicate active package code per company
- PK.5 Seed coverage: each of PARAM/UNIVERA/FINROTA has ≥2 Package rows
- PK.6 UNIVERA WhitePackage + RedPackage exist as Package rows
- PK.7 UNIVERA WhitePackage + RedPackage do NOT exist as Product rows

---

## ⑤ Rollback Plan

`git revert <merge-sha>` + `prisma migrate resolve --rolled-back 20260520160000_add_package_catalog`. Manuel girilen package + PackageItem verisi kayıp; mevcut `AccountCompany.packageName` ve `Product.supportLevel` dokunulmadığı için her şey çalışmaya devam eder.

---

## ⑥ Register Updates

- [ ] Merge sonrası WR-A7 Status: `Ready (A6 sonrası)` → `Shipped (Foundation)` + commit hash + PR ref.
- [ ] Status tally: Shipped count `13 → 14`; Ready `9 → 8`.

---

## ⑦ Git Flow / Topology Metadata

- **Current branch:** `feat/package-catalog` (base `dev`)
- **Intended PR base:** `dev`
- **Intended PR head:** `feat/package-catalog`
- **Topology pre-PR:** `origin/main..origin/dev` empty ✓ · `origin/dev..origin/main` empty ✓ (her ikisi `df50794`)
- **Branch deletion after merge:** Yes (local + remote)
- **Path detection:** Post-merge re-fetch + path A/B per [AI_WORKFLOW.md → Git Flow Rules](../AI_WORKFLOW.md#git-flow-rules)
