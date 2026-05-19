# Agentic Planning Card — A6 ProductGroup + Product Catalog (Foundation)

- **Work Register ID:** A6
- **Product Planning Matrix ID:** PM-05 (Product Catalog — tenant-scoped product master data)
- **Product capability:** Tenant-scoped product master data — ProductGroup + Product CRUD + admin UI. Foundation for A7 Package, future Case.productId migration, AccountProduct enrichment.
- **Request source:** Backlog A6; UNIVERA/PARAM/FINROTA katalog ihtiyacı; A7 Package'ı temellendirir
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-19
- **Protocol versiyonu:** 2.0
- **Scope guard:** FOUNDATION ONLY. **No** A7 Package, **no** Case.productId migration, **no** AccountProduct refactor. Mevcut `Case.productGroup` free-string kolonu olduğu gibi kalır.

---

## ① Product Fit

- **Problem:** ProductGroup ve Product tabloları yok. `Case.productGroup` serbest string; `AccountProduct.productName` serbest string; `lookupRepository.productGroups()` DB'deki distinct case değerlerinden besleniyor. Bu nedenle SLA/checklist eşleştirmesi string-drift'e açık, paket-ürün-müşteri ilişkisi olmayan üç farklı domain'de farklı ad kullanımı muhtemel.

- **Business fit:**
  - **PARAM** — ParamPOS, Sanal POS, Fiziki POS, Cep POS, Pazaryeri, Kolay Tahsilat, ParamKart, Mutabakat
  - **UNIVERA** — Enroute, Stokbar, Quest, Varuna, Uni-Dox, WMS/Depo, e-Fatura/e-Arşiv/e-İrsaliye; **WhitePackage/RedPackage paket adı → Product değil, A7 Package'a saklı**
  - **FINROTA** — Netahsilat, Netekstre, Posrapor, E-DBS, TÖS, Açık Bankacılık

- **Affected roles:**
  - Admin / SystemAdmin — Catalog CRUD
  - Agent / Backoffice / Supervisor / CSM — Bu PR'da read entry-point yok. Mevcut `Case.productGroup` UI dropdown'ı `lookupRepository.productGroups()` distinct lookup'ından beslenmeye devam eder (A7b'de catalog'a switch edilir).

- **Acceptance criteria:**
  1. `ProductGroup` entity (id, companyId, code, name, description, sortOrder, isActive, timestamps) — `@@unique([companyId, code])`
  2. `Product` entity (id, companyId, productGroupId, code, name, description, sortOrder, isActive, timestamps) — `@@unique([companyId, code])`
  3. **`Product.supportLevel` field OMITTED** in this PR — `SupportLevel` enum (A5) henüz mevcut değil; A5 shipped olduğunda ek migration ile eklenir
  4. **`Case.productId` eklenmez** (A7b'ye ertelendi)
  5. **`Case.productGroup` string kolonu dokunulmaz** (geri uyumluluk)
  6. **`AccountProduct` tablosu dokunulmaz** (mevcut Phase C2 davranışı korunur)
  7. Admin CRUD endpoints (read + write) — sadece Admin/SystemAdmin; per-company scope `assertCompanyAdmin`
  8. `code` immutable (PATCH'te değiştirilemez) — A7 paket-ürün referansları stabil olsun diye
  9. Product → ProductGroup `companyId` zorunlu match (cross-company FK orphan önlenir)
  10. Soft delete: `isActive=false` (hard delete yok)
  11. Admin UI: yeni `admin-product-catalog` view'i + master-detail (ProductGroup ↔ Product)
  12. Seed: PARAM/UNIVERA/FINROTA her biri için ≥2 group + ≥5 product (deterministic IDs)
  13. Smoke 11 senaryo + data-contracts extension

- **Out-of-scope:**
  - **A7 Package** — Package, PackageItem tabloları + UI (ayrı PR)
  - **A7b Case.productId** migration + Case form'una product picker
  - **AccountProduct refactor** — bir sonraki phase'de catalog-bound olabilir (kararı ileride)
  - **`SupportLevel` enum entegrasyonu** — A5 shipped olunca ek migration
  - **lookupRepository.productGroups() switch** — Bu PR'da distinct-from-case beslenir gibi kalır; A7b'de catalog'a bağlanır
  - **Bulk import** — A8 Import scope

- **Decisions:**
  - **D-A6.1:** Read access Admin/SystemAdmin only (`/api/admin/...` namespace). Supervisor/CSM read-only erişimi A7b'de lookup bootstrap'a eklenecek (mevcut admin pattern'ini bozma).
  - **D-A6.2:** `code` immutable after create. PATCH'te `code` alanı silently ignore edilir; ileride paket-ürün referansları bu invariant'a bel bağlar.
  - **D-A6.3:** Hard delete yok; sadece `isActive=false`. AccountProduct/Case referans stabilitesi.
  - **D-A6.4:** `Product.supportLevel` schema'ya bu PR'da eklenmez. A5 shipped olduğunda ek migration (`ALTER TABLE Product ADD COLUMN supportLevel`).

---

## ② Critical Files

**Schema/migration:**
- `prisma/schema.prisma` — yeni `ProductGroup` + `Product` modelleri; `Company` reverse relations
- `prisma/migrations/20260520130000_add_product_catalog/migration.sql`

**BFF:**
- `server/db/adminRepository.js` — `productGroupRepo` + `productRepo`
- `server/routes/admin.js` — `/api/admin/product-groups` + `/api/admin/products` CRUD (per-company scope, `assertCompanyAdmin`)

**Frontend:**
- `src/services/adminService.ts` — `ProductGroup` + `Product` types + service methods
- `src/features/admin/AdminProductCatalogPage.tsx` — master-detail UI (yeni)
- `src/features/admin/AdminLayout.tsx` — `admin-product-catalog` view eklenir
- `src/App.tsx` — route case

**Seed/smoke:**
- `scripts/seed-full-demo-scenarios.js` — yeni step 3.7 product catalog
- `scripts/smoke-product-catalog.js` — yeni (11 senaryo)
- `scripts/smoke-data-contracts.js` — yeni "Product Catalog Contract" group

---

## ③ Performance & Architecture Gate

Implementation öncesi enforced. Each item explicitly addressed; verdict at the end.

| # | Concern | Address |
|---|---|---|
| 1 | **Indexed FK + scope index** | `ProductGroup`: `@@index([companyId])`, `@@unique([companyId, code])`, `@@index([companyId, isActive])`. `Product`: `@@index([companyId])`, `@@unique([companyId, code])`, `@@index([companyId, productGroupId, isActive])` — list/filter by tenant + group hot path indexed. |
| 2 | **No relation-heavy `include` in hot paths** | List endpoint'leri scalar select; `Product` list'te `productGroup: { select: { code, name } }` minimum chip-için-veri include'u (single-row JOIN, cap 200 via Math.min). Case list / bootstrap'a etkisi yok (bu PR Case'i değiştirmez). |
| 3 | **N+1 guard** | List endpoint'ler tek query + cap; per-product extra fetch yok. UI master-detail iki ayrı `findMany` (groups + products) — paralel değil seçili groupId değişince fetch (lazy load); explicit. |
| 4 | **Unbounded list cap** | List endpoint'leri `Math.min(200, Number(limit) || 100)` cap'i ile filter validation. Account pattern'ini takip ediyor (H1). |
| 5 | **`count()` vs `findMany().length`** | Bu PR'da admin liste pagination yok — total count `prisma.product.count()` ile alınır (gerekirse). Data-contracts'ta `prisma.productGroup.count()` kullanır. |
| 6 | **Large query guard** | Cross-company query yok; admin routes `assertCompanyAdmin(req, companyId)` ile per-tenant scoped. SystemAdmin için all-companies erişim explicit. |
| 7 | **Mutation atomicity** | Single-row create/update; `isDefault` benzeri shared-state invariant yok. Product oluşturulurken `productGroup.companyId === product.companyId` check tek transaction içinde (P2002 → 409 conflict map'i). |
| 8 | **UI loading state** | AdminProductCatalogPage existing AdminListLayout pattern'ini takip eder — inline spinner, button disabled. Full-screen blocker yok. |
| 9 | **Lazy load** | Yeni admin view eager bound (admin namespace zaten Admin-only girer). Ana app eager bundle'a etkisi yok (admin layout zaten gizli rota). |
| 10 | **Connection pool** | Yeni endpoint sayısı 6 (3 GET + 2 POST + 1 PATCH × 2 entity = 6 path); her biri tek transaction. Supabase pooler limitleri için risk yok. |

**Verdict: PASS.**

---

## ④ Decisions Log

- **D-A6.1:** Read access Admin/SystemAdmin only. Lookup bootstrap entegrasyonu A7b'ye ertelendi.
- **D-A6.2:** `code` immutable after create. PATCH'te silently ignored.
- **D-A6.3:** Soft delete only; hard delete yasak.
- **D-A6.4:** `Product.supportLevel` A5 shipped olunca ek migration ile eklenecek.
- **D-A6.5:** `Case.productGroup` string + `lookupRepository.productGroups()` distinct lookup olduğu gibi kalır — A7b'de catalog'a switch.

---

## ⑤ Test Plan (özet)

**11 ana senaryo (smoke-product-catalog.js):**
1. Admin creates ProductGroup → 201
2. Admin creates Product under that group → 201
3. Duplicate code aynı şirket için → 400/409
4. Aynı code farklı şirkette → 201 (multi-tenant izolasyon)
5. Cross-company Product → ProductGroup → 400 (productGroup.companyId mismatch)
6. PATCH soft-deactivate (isActive=false) → 200, DB isActive=false
7. PATCH `code` alanı → silently ignored (D-A6.2)
8. Agent attempts POST product-group → 403
9. Backoffice attempts POST product → 403
10. Cross-tenant: PARAM Admin scope, UNIVERA companyId ile yarat → 403
11. Seed verification: PARAM/UNIVERA/FINROTA her birinde ≥2 group, ≥5 product

**Data contracts (Product Catalog Contract — 6 invariant):**
- C.1 ProductGroup table has companyId column + FK
- C.2 Product table has companyId + productGroupId columns
- C.3 No Product where Product.companyId != ProductGroup.companyId
- C.4 No active duplicate codes per (companyId) (groups + products separately)
- C.5 Seed coverage: each of PARAM/UNIVERA/FINROTA has ≥2 active groups
- C.6 Seed coverage: each of PARAM/UNIVERA/FINROTA has ≥5 active products

---

## ⑥ Rollback Plan

`git revert <merge-sha>` + `prisma migrate resolve --rolled-back 20260520130000_add_product_catalog`. Manuel girilen catalog verisi kayıp; mevcut `Case.productGroup` ve `AccountProduct` dokunulmadığı için her şey çalışmaya devam eder.

---

## ⑦ Register Updates

- [ ] Merge sonrası WR-A6 Status: `Ready` → `Shipped` + commit hash + PR ref.
- [ ] Status tally: Shipped count `10 → 11`; Ready `12 → 11`.

---

## ⑧ Git Flow / Topology Metadata

- **Current branch:** `feat/product-catalog` (base `dev`)
- **Intended PR base:** `dev`
- **Intended PR head:** `feat/product-catalog`
- **Topology pre-PR:** `origin/main..origin/dev` empty ✓ · `origin/dev..origin/main` empty ✓ (her ikisi `3d34054`)
- **Branch deletion after merge:** Yes (local + remote)
- **Path detection:** Post-merge re-fetch + path A/B per [AI_WORKFLOW.md → Git Flow Rules](../AI_WORKFLOW.md#git-flow-rules)
