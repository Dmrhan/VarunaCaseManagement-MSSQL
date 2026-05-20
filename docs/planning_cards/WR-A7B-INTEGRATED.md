# Agentic Planning Card — A7b Integrated: Case ↔ Product/Package Integration

- **Work Register ID:** A7b (integrated PR — supersedes the A7b-1/2/3/4 phase split proposed in WR-A7B.md for this delivery)
- **Product Planning Matrix IDs touched:** PM-05 (Catalog: Product + Package), PM-03 (Support Level)
- **Product capability:** Catalog'u günlük case operasyonuna bağlar — AccountCompany package link, Case productId/packageId, NewCaseForm picker'lar, CaseDetail inline edit, supportLevel cascade.
- **Request source:** WR-A7B.md planning card (PR #180 merged 2026-05-20) — entegre PR olarak konsolide edildi.
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-20
- **Protocol versiyonu:** 2.0

---

## ① Why one integrated PR (not the 4-phase split)

WR-A7B.md baştan 4 alt-phase (A7b-1..A7b-4) önermişti. Bu PR konsolide ediyor çünkü:

- **Phase'ler güçlü şekilde birbirine bağlı.** A7b-1 olmadan A7b-3 NewCaseForm package picker hangi paketi vurgulayacağını bilemez; A7b-2 olmadan A7b-4 cascade'i bağlanacak alanı bulamaz. Tek PR'da entegre ederek ara durumlarda kullanılamaz UI riski yok.
- **Tüm değişiklikler additive.** Yeni alanlar nullable; mevcut Case'ler ve AccountCompany'ler etkilenmez. SLA/Checklist hâlâ `Case.productGroup` string'inden besleniyor.
- **Smoke + contract aynı anda anlamlı.** Cross-table invariants (DI.1-DI.7) tek bir smoke'da test edilince entegre garantili.
- **Rollback senaryosu temiz.** Tek migration revert; UI graceful degrades (Picker'lar undefined alanları gizler).

**What this PR EXPLICITLY does NOT include (per user task spec):**
- **No SLA rewrite** — SLAPolicy + Checklist hâlâ `Case.productGroup` free-string ile eşleşir; productId/packageId tier hint olarak kullanılır ama SLA matching'a girmez
- **No Jira/reporting work** — analytics dashboard boyutları (Vaka × Paket, Vaka × Product × Tier) Phase 3'e ertelenir
- **No SavedView / list-filter work** — `?productId=`/`?packageId=` query filter eklenmez; SavedView değişmez
- **No import work** — A8 Import Phase 3'te (Product/Package mapping) gelir
- **No Account merge work** — A4-related ayrı PR
- **No auto-routing** — supportLevel cascade Case create'te uygulanır, ama routing/auto-assign yok (Phase 2)

---

## ② Acceptance Criteria

1. `AccountCompany.packageId?` FK eklenir; legacy `packageName` korunur
2. `Case.productId?` + `Case.productName?` (denorm) eklenir
3. `Case.packageId?` + `Case.packageName?` (denorm) eklenir
4. Legacy `Case.productGroup` ve `AccountCompany.packageName` **dokunulmaz**
5. Cross-tenant invariantlar enforce edilir (DI.1-DI.7 — bkz §⑤)
6. Lookup endpoint `/api/lookups/catalog?companyId=&accountId=` ile catalog snapshot
7. NewCaseForm:
   - Şirket seçiminden sonra catalog lazy yüklenir
   - Müşteri seçildiyse `AccountCompany.packageId` suggested chip
   - Package seçildiyse Product picker filtered (PackageItem'a göre)
   - Müşterisiz vaka: productId opsiyonel; packageId disabled
8. CaseDetail: Product/Package badge + inline edit (Product: Supervisor/Admin/CSM; Package: Supervisor/Admin only); field change history log
9. SupportLevel cascade: explicit > Product > Person > Team > L1 (Package YOK — multi-product)
10. Smoke 15 senaryo + Case Product Integrity Contract + Case Package Integrity Contract
11. Mevcut smoke'lar (product-catalog, package-catalog, customerless) regression clean

---

## ③ Critical Decisions Log

- **D-A7BI.1: AccountCompany.packageId clear behavior.** `packageId` clear edilirse `packageName` legacy alanı **dokunulmaz** (kullanıcı explicit `packageName: null` patch göndermediği sürece). Eski sözleşme adı kayıtta kalır; reconcile ileride manual.

- **D-A7BI.2: Case.accountId cleared → packageId/packageName clears, productId remains.** Müşteri kaldırıldığında paket sözleşme kontekstini kaybeder; ama ürün (kategori benzeri) bağımsız kalabilir. WR-A7B.md §② tablosunda yer alan recommendation.

- **D-A7BI.3: Package compatibility with AccountCompany.packageId — STRICT REJECT.** `Case.packageId` ile `AccountCompany.packageId` farklıysa case create reddedilir (`package_account_company_mismatch`). UI'da bu durum açıkça hidden ya da warning; backend defense-in-depth.

- **D-A7BI.4: Customerless + packageId → reject (400 `package_requires_account`).** Paket sözleşme kontekstidir; müşterisiz vakada anlamlı değil. ProductId customerless'ta serbest.

- **D-A7BI.5: Product/Package PATCH role gates.**
  - `Case.productId` PATCH: Agent/Backoffice **forbidden** (404/403); Supervisor/CSM/Admin/SystemAdmin allowed.
  - `Case.packageId` PATCH: Supervisor/Admin/SystemAdmin only (CSM dahil değil — sözleşme paketi customer-facing değil; CSM ileride ekleyebilir).
  - Implementation: caseRepository.update'te yeni role gate (A5'in `support_level_forbidden` pattern'i).

- **D-A7BI.6: Denormalization snapshot.** `Case.productName` ve `Case.packageName` her create/update'te güncellenir (Product/Package rename edildiğinde Case'de eski isim kalmaz — current naming convention). NOTE: bu kararı Case.accountProjectName ile uyumlu yaptık (A4 pattern).

- **D-A7BI.7: SupportLevel cascade Product > Person.** WR-A7B.md'de tartışıldı; Product en üstte çünkü "WMS=L3" gibi sabit hint atama hatasından daha güvenilir.

---

## ④ Critical Files

**Schema/migration:**
- `prisma/schema.prisma` — `AccountCompany.packageId`, `Case.productId/productName/packageId/packageName` + indexes
- `prisma/migrations/20260520170000_add_case_product_package_integration/migration.sql`

**BFF:**
- `server/db/accountRepository.js` — `updateCompanyRelation` accepts `packageId`; same-company validation
- `server/db/caseRepository.js` — `create` accepts productId/packageId + cascade + validations; `update` role gate for product/package fields + denorm refresh; `lifecyclePatch` extended for accountId clear → package fields cleared
- `server/db/lookupRepository.js` — new `getCaseCatalog({ companyId, accountId, allowedCompanyIds })` returning packages, products, packageItems map, suggestedPackage
- `server/routes/lookups.js` — `GET /api/lookups/catalog?companyId=&accountId=` route
- `server/routes/cases.js` — pass `req.user.role` to update (already done in A5 review fix)

**Frontend:**
- `src/services/accountService.ts` — `AccountCompanyDetail.packageId` field
- `src/services/caseService.ts` — `NewCaseInput.productId/packageId`; `Case` interface productId/productName/packageId/packageName fields; new `getCaseCatalog(companyId, accountId)` service method
- `src/features/accounts/AccountCompanyEditor.tsx` — package picker (select); legacy packageName preserved
- `src/features/cases/NewCaseForm.tsx` — catalog lazy fetch, package picker, product picker with filter, cascade hint
- `src/features/cases/CaseDetailPage.tsx` — Product + Package badge + inline edit
- `src/features/cases/types.ts` — Case typeläufes

**Seed/smoke:**
- `scripts/seed-full-demo-scenarios.js` — Step 3.10 AccountCompany.packageId map + Step 4 case product/package assignment
- `scripts/smoke-case-product-package-flow.js` — 15 senaryo (new)
- `scripts/smoke-data-contracts.js` — yeni "Case Product/Package Integrity Contract" group

---

## ⑤ Performance & Architecture Gate

| # | Concern | Address |
|---|---|---|
| 1 | **Indexed FKs** | `AccountCompany.@@index([packageId])`; `Case.@@index([companyId, productId])`; `Case.@@index([companyId, packageId])`. Mevcut companyId scope index'leri korunur. |
| 2 | **No relation-heavy `include` in hot paths** | Case list view'da `product` JOIN'lenmez; `productName` denorm chip için yeterli. CaseDetail tek `findUnique` ile `product` + `package` + `accountProject` include (3 small-row JOIN). Catalog lookup tek endpoint, scope-filtered. |
| 3 | **N+1 guard** | Catalog endpoint: tek `findMany` (active packages) + tek `findMany` (active products) + tek `findMany` (PackageItem joins for selected company). UI bootstrap çağrısı şirket başına bir kere. |
| 4 | **Unbounded list cap** | Package/Product catalog: mevcut `take: 500` cap'i; AccountCompany.packageId per-account opsiyonel. |
| 5 | **`count()` vs `findMany().length`** | Smoke + contracts `prisma.X.count` kullanır. Repository'de N+1 yok. |
| 6 | **Large query guard** | Cross-company sorgu yok; `assertCompanyAdmin` + `allowedCompanyIds` gating mevcut. |
| 7 | **Mutation atomicity** | Case create/update tek statement; cascade hesaplama `findUnique` (Product/Package companyId match), sonra tek `prisma.case.create/update`. AccountCompany package atama tek `update`. |
| 8 | **UI loading state** | NewCaseForm catalog lazy yüklenir (`useEffect` on companyId/accountId); existing form pattern; spinner + disabled. |
| 9 | **Lazy load** | Catalog endpoint Case form açıldığında çağrılır; admin sayfaları zaten kendi bootstrap'larını yapıyor. |
| 10 | **Connection pool** | Yeni endpoint sayısı: 1 catalog lookup. Heavy path yok (catalog 3 queries × ~20 rows). |

**Verdict: PASS.**

---

## ⑥ Cross-table invariants (DI.1-DI.7)

| # | Rule | Enforce yeri |
|---|---|---|
| **DI.1** | `Product.companyId === Case.companyId` (case create + update with productId) | caseRepository |
| **DI.2** | `Package.companyId === Case.companyId` (case create + update with packageId) | caseRepository |
| **DI.3** | If both productId + packageId: `productId ∈ PackageItem.productId for that packageId` | caseRepository — error code `package_product_mismatch` |
| **DI.4** | `AccountCompany.packageId.companyId === AccountCompany.companyId` | accountRepository — error code `package_company_mismatch` |
| **DI.5** | Customerless (accountId NULL) → packageId MUST be NULL | caseRepository — error code `package_requires_account` |
| **DI.6** | accountId provided + packageId provided → if `AccountCompany.packageId` exists and differs → 400 `package_account_company_mismatch` | caseRepository (strict reject per D-A7BI.3) |
| **DI.7** | accountId cleared (PATCH accountId=null) → packageId + packageName auto-cleared; productId may remain | caseRepository update lifecycle |

---

## ⑦ Test Plan (özet)

**Smoke (15 senaryo):**
1. AccountCompany.packageId same-company → 200
2. AccountCompany.packageId cross-company → 400 package_company_mismatch
3. Case create productId only → 201 + productName denorm
4. Case create packageId without accountId → 400 package_requires_account
5. Case create packageId + accountId → 201 + packageName denorm
6. Case create productId + packageId not in PackageItem → 400 package_product_mismatch
7. Case create productId + packageId in PackageItem → 201
8. Customerless productId only → 201
9. Customerless packageId → 400
10. Case create with productId → supportLevel = Product.supportLevel (cascade Product > Person > Team)
11. Explicit supportLevel override (Supervisor) → respected
12. Case PATCH productId by Supervisor → 200
13. Case PATCH packageId by Agent → 403 case_field_forbidden
14. PATCH accountId=null → packageId/packageName cleared; productId remains
15. Legacy Case.productGroup string preserved through create/update

**Data contracts ("Case Product/Package Integrity Contract" — 8 invariant):**
- CP.1 AccountCompany.packageId column + FK
- CP.2 No AccountCompany where packageId set + Package.companyId != AccountCompany.companyId
- CP.3 Case.productId + productName columns; same for packageId + packageName
- CP.4 No Case where productId set + Product.companyId != Case.companyId
- CP.5 No Case where packageId set + Package.companyId != Case.companyId
- CP.6 No Case where productId + packageId both set, productId not in PackageItem for packageId
- CP.7 No Case where packageId IS NOT NULL and accountId IS NULL (hierarchy invariant DI.5)
- CP.8 Legacy Case.productGroup column still present (regression check)

---

## ⑧ Rollback Plan

`git revert <merge-sha>` + `prisma migrate resolve --rolled-back 20260520170000_add_case_product_package_integration`. Manuel girilen package/product Case bağı kayıp; mevcut Case.productGroup ve AccountCompany.packageName dokunulmadığı için her şey çalışmaya devam eder. Tüm yeni alanlar nullable → zero-cost backfill.

---

## ⑨ Register Updates

- [ ] Merge sonrası WR-A7 row'una "A7b integrated shipped" sub-line.
- [ ] Status tally değişmez (A7 zaten Shipped; A7b kapsamına özel ayrı row açılmadı — A7'nin altında follow-up).

---

## ⑩ Git Flow / Topology Metadata

- **Current branch:** `feat/case-product-package-integration` (base `dev`)
- **Intended PR base:** `dev`
- **Intended PR head:** `feat/case-product-package-integration`
- **Topology pre-PR:** `origin/main..origin/dev` empty ✓ · `origin/dev..origin/main` empty ✓ (her ikisi `175d022`)
- **Branch deletion after merge:** Yes (local + remote)
- **Path detection:** Post-merge re-fetch + path A/B per [AI_WORKFLOW.md → Git Flow Rules](../AI_WORKFLOW.md#git-flow-rules)
