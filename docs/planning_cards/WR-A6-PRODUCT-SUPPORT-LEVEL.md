# Agentic Planning Card — A6 Follow-up: `Product.supportLevel`

- **Work Register ID:** A6 follow-up (A5 dependency satisfied)
- **Product Planning Matrix ID:** PM-05 (Product Catalog) × PM-03 (Support Level)
- **Product capability:** Ürün başına varsayılan destek seviyesi (L1/L2/L3/Expert). Phase 2'de Case create cascade Product → Person → Team → L1 zinciri için altyapı.
- **Request source:** A6 (PR #167) sırasında deferred edilen alan — A5 SupportLevel enum shipped (PR #169) olduktan sonra additive olarak gelir.
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-20
- **Protocol versiyonu:** 2.0
- **Scope guard:** NARROW FOLLOW-UP. **No** Package, **no** `Case.productId` migration, **no** Case form picker, **no** SLA/escalation rewrite, **no** routing/auto-assign.

---

## ① Product Fit

- **Problem:** A6 foundation `Product` modeli shipped ama `supportLevel` alanı yoktu (A5 enum henüz mevcut değildi). Şimdi A5 shipped (PR #169) — ürün başına default tier tanımlamak mümkün. UNIVERA WMS/e-Dönüşüm ve FINROTA Açık Bankacılık gibi ürünler L2/L3 ister; PARAM POS çekirdeği L1/L2'de kalır. Mevcut Phase 2'de Case create cascade'i Product → Person → Team → L1 zincirine genişletmek için altyapı.

- **Business fit:**
  - **PARAM** — POS çözümleri L1/L2 ağırlıklı; settlement/mutabakat L2
  - **UNIVERA** — WMS, e-Fatura/e-Arşiv/e-İrsaliye → L2/L3 karışım; mobil app/saha ürünleri L1
  - **FINROTA** — Açık Bankacılık + E-DBS L2; raporlama L1/L2 karışım

- **Affected roles:**
  - Admin / SystemAdmin — Product modal'ında "Varsayılan Destek Seviyesi" select; ürün listesinde badge
  - Diğer roller — read-only badge görür (lookup bootstrap'a şimdilik dahil değil; A7b'de bağlanır)

- **Acceptance criteria:**
  1. `Product.supportLevel SupportLevel @default(L1)` — additive, mevcut tüm satırlar L1
  2. `@@index([companyId, supportLevel])` — Phase 2 tier-filter sorgu için hazır
  3. BFF productRepo.create/update accepts + validates supportLevel (mevcut `normalizeSupportLevel` helper ile)
  4. Invalid değerde 400 `support_level_invalid`
  5. AdminProductCatalogPage Product modal: select; list satırında badge
  6. Seed: dağılım — PARAM mostly L1/L2, UNIVERA L1/L2/L3 karışım, FINROTA L1/L2
  7. Smoke 4 yeni senaryo + contract 4 yeni invariant
  8. Mevcut A6 smoke 13/13 ve contract 8/8 PASS olarak kalır (regression yok)

- **Out-of-scope:**
  - **A7 Package** — paket adları hâlâ Product değil
  - **A7b `Case.productId`** migration — Case create cascade `Product.supportLevel`'a bağlanmaz bu PR'da
  - **Case form product picker** — Case form'una eklenmez
  - **Lookup bootstrap exposure** — Supervisor/CSM/Agent okumasi yok (A7b)
  - **SLA matching tier-aware rewrite**
  - **Routing/auto-assign tier dispatch**

- **Decisions:**
  - **D-A6PS.1:** `supportLevel` default L1 — mevcut tüm satırlar backfill için sorunsuz; DB-level default.
  - **D-A6PS.2:** `code` immutable invariant aynen korunur (A6 D-A6.2). `supportLevel` mutable.
  - **D-A6PS.3:** Helper merkezîleştirme — `normalizeSupportLevel` zaten adminRepository içinde shared. productRepo create/update onu kullanır; ayrı kopya yapılmaz.
  - **D-A6PS.4:** Index `(companyId, supportLevel)` Phase 2 routing/SLA tier-filter sorguları için hazırlanır. Bu PR'da kullanılmaz ama additive index — write maliyeti ihmal edilebilir.
  - **D-A6PS.5:** UI'da display her zaman badge (görsel polish); inline edit modal üzerinden.

---

## ② Critical Files

**Schema/migration:**
- `prisma/schema.prisma` — `Product` modeline `supportLevel SupportLevel @default(L1)` + composite index
- `prisma/migrations/20260520150000_add_product_support_level/migration.sql`

**BFF:**
- `server/db/adminRepository.js` — `productRepo.create/update` supportLevel kabul + validate
  - `normalizeSupportLevel` zaten mevcut; ek değişiklik yok

**Frontend:**
- `src/services/adminService.ts` — `Product.supportLevel`, `ProductInput.supportLevel`
- `src/features/admin/AdminProductCatalogPage.tsx` — Product modal'da Select; ProductRow'da badge
- `src/features/cases/types.ts` — `SUPPORT_LEVEL_LABELS` zaten export — import sırası

**Seed/smoke:**
- `scripts/seed-full-demo-scenarios.js` — CATALOG sabitinde her product'a `supportLevel` ekle + upsert'te dağıt
- `scripts/smoke-product-catalog.js` — 4 yeni senaryo (supportLevel set/update/invalid + seed coverage)
- `scripts/smoke-data-contracts.js` — Product Catalog Contract'a 4 invariant

---

## ③ Performance & Architecture Gate

| # | Concern | Address |
|---|---|---|
| 1 | **Indexed FK + scope index** | `@@index([companyId, supportLevel])` — Phase 2 routing/tier-filter için hazır. Mevcut `@@index([companyId, productGroupId, isActive])` korunur. |
| 2 | **No relation-heavy `include` in hot paths** | productRepo zaten chip select; supportLevel scalar enum — extra cost ihmal edilebilir. |
| 3 | **N+1 guard** | Cascade entegrasyonu YOK bu PR'da (A7b'de gelir). Sadece field; ek query yok. |
| 4 | **Unbounded list cap** | Mevcut `take: 500` korunur. |
| 5 | **`count()` vs `findMany().length`** | Smoke/contracts `count` kullanır. |
| 6 | **Large query guard** | Yok — single-row CRUD. |
| 7 | **Mutation atomicity** | Tek alan ekleme; helper validation create + update için aynı kural. |
| 8 | **UI loading state** | Mevcut modal pattern korunur; ek Select non-blocking. |
| 9 | **Lazy load** | Yok — AdminProductCatalogPage zaten admin route'da. |
| 10 | **Connection pool** | Endpoint sayısı değişmez. |

**Verdict: PASS.**

---

## ④ Test Plan (özet)

**Smoke (4 yeni senaryo) + mevcut 13 regression korunur:**
- New 14. Create product with supportLevel=L2 → 201 + DB matches
- New 15. Update product supportLevel=L3 → 200 + DB matches
- New 16. Invalid supportLevel ('Z9') → 400 (admin error)
- New 17. Seed coverage: products with supportLevel != L1 exist (at least one across catalog)

**Data contracts (4 yeni invariant):**
- C.7 Product.supportLevel column not nullable (default L1)
- C.8 Product.supportLevel value ∈ {L1, L2, L3, Expert} (PostgreSQL enum guard)
- C.9 UNIVERA: ≥1 product with supportLevel ∈ {L2, L3, Expert}
- C.10 PARAM/FINROTA: ≥1 product with supportLevel != L1 (mix coverage)

---

## ⑤ Rollback Plan

`git revert <merge-sha>` + `prisma migrate resolve --rolled-back 20260520150000_add_product_support_level`. UI gracefully degrades (Select hidden if field undefined). No data loss (column was additive default L1; all existing rows revert to having no supportLevel field, no downstream consumer yet).

---

## ⑥ Register Updates

- [ ] Merge sonrası A6 row update: "Review/follow-up — Product.supportLevel landed (PR #X, commit Y)" — A6 tally cell'e ek not.

---

## ⑦ Git Flow / Topology Metadata

- **Current branch:** `feat/product-support-level` (base `dev`)
- **Intended PR base:** `dev`
- **Intended PR head:** `feat/product-support-level`
- **Topology pre-PR:** `origin/main..origin/dev` empty ✓ · `origin/dev..origin/main` empty ✓ (her ikisi `67143cb`)
- **Branch deletion after merge:** Yes (local + remote)
- **Path detection:** Post-merge re-fetch + path A/B per [AI_WORKFLOW.md → Git Flow Rules](../AI_WORKFLOW.md#git-flow-rules)
