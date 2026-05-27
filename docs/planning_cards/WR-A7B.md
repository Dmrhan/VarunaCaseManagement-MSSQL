# Agentic Planning Card — A7b Case ↔ Product/Package/Project Integration

> **⚠ SUPERSEDED:** This card is retained for history only. The canonical implementation card is [`docs/planning_cards/WR-A7B-INTEGRATED.md`](WR-A7B-INTEGRATED.md), which consolidated the 4-phase split (A7b-1..A7b-4) proposed below into a single integrated PR (shipped 2026-05-20 via PR #181 + review fix #182). The phased plan that follows did **not** ship as separate PRs — read this file only for design context.

- **Work Register ID:** A7b (planning only — implementation gated on this card's approval)
- **Product Planning Matrix IDs touched:** PM-04 (AccountProject), PM-05 (Catalog: Product + Package), PM-03 (Support Level)
- **Product capability:** Case create/edit'inde Account → AccountCompany → (Package / Product / Project) bağı + supportLevel cascade'i. Vaka açılışından raporlamaya kadar uçtan uca tier-aware iş akışı için temel.
- **Request source:** A7 Package (PR #175) + A6 follow-up Product.supportLevel (PR #173) shipped; tüm catalog primitives + SupportLevel hazır. A7b artık tek geniş PR olarak değil, bu kartla küçük PR'lara bölünüyor.
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-20
- **Protocol versiyonu:** 2.0
- **Status:** **Planning only.** Kart onaylanmadan A7b-* PR'ları açılmaz.

---

## ① Product Fit (recap)

**Shipped primitives (read-only context):**
- A1/A2/A3: Account identity + privacy + addresses ✓
- A4 AccountProject (AccountCompany-scoped) ✓
- A5 SupportLevel enum + Case.supportLevel + Person/Team supportLevel ✓
- B1 Person.isTeamLead ✓
- A6 Product + ProductGroup + Product.supportLevel ✓
- A7 Package + PackageItem (with cross-company invariant) ✓
- Product Catalog RBAC + Package RBAC gates ✓

**Open problem (A7b):** Şu an Case'de Product/Package/Project'i resmî bir FK'ye bağlamıyor; sadece `Case.productGroup` serbest string ve `Case.accountProjectId` (A4) var. SLA/checklist matching string-drift'e açık; raporlama paket bazında imkânsız; UNIVERA L1/L2 routing manuel.

---

## ② Product vs Package vs Project ilişkisi

| Boyut | Product | Package | AccountProject |
|---|---|---|---|
| **Tanım** | Desteklenen uygulama/modül/servis | Sözleşme bundle / abonelik planı | Müşterinin tenant-içi proje çalışması |
| **Sahibi** | Tenant (companyId) | Tenant (companyId) | Account × Company (AccountCompany) |
| **Tier hint** | `Product.supportLevel` | `Package.supportLevel` | `AccountProject.defaultSupportLevel` (gelecek) |
| **Müşteri etkisi** | Hangi ürünle ilgili sorun? | Hangi paketin kapsamında? | Hangi proje akışında? |
| **Atama zorunlu mu?** | Opsiyonel (kategori bazlı SLA yeterli olabilir) | Opsiyonel (müşteride paket FK yoksa hiç gelmez) | Opsiyonel (CompanySettings.projectsEnabled toggle) |

**Schema bağı önerisi:**
- `Case.productId?` (FK to Product, nullable) — opsiyonel
- `Case.packageId?` (FK to Package, nullable) — opsiyonel
- `Case.accountProjectId?` zaten var (A4)
- `AccountCompany.packageId?` (FK to Package, nullable) — Phase A7b-1'de gelir; müşteri için "kullandığı paket" zincirini kapatır
- **NOT** `Case.productGroupId` FK — `Case.productGroup` free string aynen kalır (geri uyumluluk; SLAPolicy/Checklist 5-tuple eşleşmesi şu an productGroup string'ine bağlı, ileride ayrı PR)

**Required/optional per company setting:**
- `CompanySettings.productsEnabled` (default false) — UI'da Case formunda product picker'ı görünür kılar
- `CompanySettings.packagesEnabled` (default false) — UI'da package picker'ı görünür kılar
- `CompanySettings.productsRequired` (default false) — vaka açarken product seçimi zorunlu olur
- `CompanySettings.packagesRequired` (default false) — vaka açarken package seçimi zorunlu olur
- Mevcut `projectsEnabled` / `projectsRequired` pattern'i (A4) — aynı şablon

Default: tüm tenantlar kapalı. UNIVERA isterse açar (örn. `packagesEnabled=true` + `productsEnabled=true`). PARAM/FINROTA mevcut akış değişmez.

---

## ③ Backward compatibility

| Legacy alan | Karar | Süre |
|---|---|---|
| `Case.productGroup` (free string) | **Saklanır.** A7b'de dokunulmaz. SLAPolicy/Checklist matching bu string'e bağlı; ileride A6c (catalog-bound SLA/Checklist) ayrı PR. | Belirsiz (en az 2 phase) |
| `AccountCompany.packageName` (free string) | **Saklanır.** `AccountCompany.packageId?` FK eklendiğinde packageName "deprecated" yorumu eklenir; data backfill manuel item-by-item Admin UI üzerinden (Decision Sprint #6). | Belirsiz |
| `Case.productName` denormalization | **Eklenir** (`Case.productName?` String) — Case shipped olduktan sonra Product silinir/rename edilirse history kaybolmasın diye snapshot. AccountProjectName / customerName pattern'iyle aynı. |
| `Case.packageName` denormalization | **Eklenir** (`Case.packageName?` String) — aynı gerekçe. |
| `AccountProduct` (Phase C2 catalog-bound müşteri ürün listesi) | **Saklanır.** A6 Product ile reconcile gelecek bir phase'de; bu PR scope dışı. |

**Migration risk:** Tüm yeni alanlar nullable; mevcut 330+ Case satırı backfill sıfır (NULL). Sıfır data loss. SLAPolicy/Checklist regression riski yok (yalnız productGroup okuyor).

---

## ④ Recommended phase split

**Öneri:** A7b 4 ardışık PR'a bölünür. Her biri kendi smoke + contract + planning card sahibidir.

| Phase | Scope | Bağımlı | Risk |
|---|---|---|---|
| **A7b-1** | `AccountCompany.packageId?` FK + Admin UI reconcile (manuel paket atama) + smoke + contract | A7 ✓ | Düşük — sadece bir alan + UI; veri yok |
| **A7b-2** | `Case.productId?` + `Case.productName?` denorm + Case create cascade (Phase 2 supportLevel kullanır) + NewCaseForm product picker + smoke | A6 ✓; A7b-1 OPSİYONEL | Orta — Case shape değişir, create/update pathları etkilenir |
| **A7b-3** | `Case.packageId?` + `Case.packageName?` denorm + NewCaseForm package picker + Package → Product filter UI | A7 ✓; A7b-1 ✓ (paket atama olmadan Case form'a package picker pratik değil) | Orta — Case shape ek alan + UI'da package-product filter logic |
| **A7b-4** | supportLevel cascade integration — Case create'te `Product.supportLevel` → `Person.supportLevel` → `Team.defaultSupportLevel` → L1 zinciri | A5 ✓; A7b-2 ✓ | Düşük — sadece create cascade logic'i; data shape değişmez |

**Niye bu sıra:**
- A7b-1 önce: AccountCompany paket atamadan, Case package picker hangi paketleri göstereceğini bilemez (müşterinin paketi bilinir olmazsa filter yapılamaz).
- A7b-2 önce: Product picker tek başına işlevsel (kategori bazlı); package picker olmadan da değer üretir.
- A7b-3 paket UI'sının A7b-1'e bağımlılığı doğal sırayı belirler.
- A7b-4 son: ProductId/PackageId zaten yerleştikten sonra cascade'i bağlamak basit.

**Alternatif (red):** Tek büyük PR (A6+A7 catalog gibi). **Red** — Case create path her PR'da değişiyor; tek PR'da hem catalog hem cascade hem UI değiştirmek smoke karmaşıklaştırır, rollback riski büyür.

---

## ⑤ SupportLevel cascade — kesin sıra

**Önerilen create-time resolution:**

```
1. patch.supportLevel (frontend explicit) → use it
2. Product.supportLevel (via assignedProductId) → use it
3. Person.supportLevel (via assignedPersonId)  → use it
4. Team.defaultSupportLevel (via assignedTeamId) → use it
5. L1 (DB default)                              → fallback
```

**Niye Product en üstte (Person'dan önce):** Product = "vaka konusu/ürünü"; Person = "kim çalışıyor". UNIVERA için "Bu vaka WMS modülünde" hint'i, "İlk olarak L1 ekibe atadık" kararından daha güvenilir bir tier sinyali — WMS hep L3'tür ama L1 person'a atayan kullanıcı atama hatası yapmış olabilir.

**Package YOK** — paket çoklu ürün içerebilir; tek bir tier hint vermez. UI'da `Package → Product` filter görselleşir, ama cascade'de Product seviyesinde durulur.

**Explicit override:** UI/form'da kullanıcı tier'ı override edebilir (mevcut A5 PATCH role gate'i geçerli — Agent override yapamaz; Supervisor/CSM/Admin/SystemAdmin yapabilir). Override edildiğinde cascade overrideyı geçemez.

---

## ⑥ NewCaseForm behavior

**Mevcut akış (A4 dahil):**
- Şirket seç → AccountSearchPicker (müşteri seç ya da müşterisiz devam et)
- Müşteri seçildiyse + `projectsEnabled` → opsiyonel proje seçici
- `requireCustomerOnCaseCreate` toggle "Müşterisiz devam" akışını engeller
- `projectsRequired` → müşteri seçilince proje de zorunlu

**A7b sonrası eklemeler:**

| Sahne | productPicker | packagePicker | Notlar |
|---|---|---|---|
| Müşteri seçili + `packagesEnabled=true` + müşterinin `AccountCompany.packageId` set | Görünür — package'ın PackageItem'larıyla filtrelenmiş Product listesi | Read-only chip — müşterinin paket adı görüntülenir | "Bu vaka müşterinin X paketinin Y ürünüyle ilgili" akışı |
| Müşteri seçili + `packagesEnabled=true` + müşterinin paketi yok | Görünür — şirketin tüm aktif Product'ları | Görünür — şirketin tüm aktif Package'ları (opsiyonel) | Kullanıcı manuel paket de seçebilir |
| Müşteri seçili + `productsEnabled=true` + `packagesEnabled=false` | Görünür — şirketin tüm aktif Product'ları | Hiç gösterilmez | Sadece product bazlı |
| Müşterisiz + `customerless` izinli | Hiç gösterilmez (productId/packageId NULL kalır) | Hiç gösterilmez | Mevcut müşterisiz akışı korunur |
| `requireCustomerOnCaseCreate=true` | Müşteri yoksa picker bile açılmaz | — | — |
| `projectsRequired=true` + müşteri var | Mevcut proje seçici görünür + product picker yan yana | — | İkisi paralel; bağımlı değil |

**Edge case'ler:**
- `productsRequired=true` + müşterisiz vaka: validation hangisi üstün? **Karar:** `productsRequired` sadece accountId var iken etkin (analoji: A4 `projectsRequired` ile aynı).
- `packagesRequired=true` + müşterinin paketi yok: validation 400 — kullanıcı önce müşteriye paket atamalı (Admin UI üzerinden A7b-1).
- Package seçildiyse Product picker filtered (sadece o paketteki ürünler). Package seçilmezse Product picker tüm aktif ürünleri gösterir.

**Yeni custom event'ler:** Yok — Case create/PATCH zaten event yayınlıyor.

---

## ⑦ CaseDetail behavior

**Görsel yerleşim (öneri):**
- Müşteri & Sınıflandırma section: yeni 3 satır
  - **Ürün**: badge + edit link (Supervisor+ inline edit)
  - **Paket**: badge + read-only chip (paket değişimi nadir; ayrı modal'da)
  - **Proje**: zaten var (A4)
- Customer panel: hem ürün hem paket chip görünür (mevcut accountProjectName badge pattern'i)

**Roller:**
- **Read:** Tüm roller (Agent dahil) görür
- **Edit:** `Case.productId` PATCH için Agent yeterli (kategori değişimi kadar yaygın), ama `Case.packageId` PATCH Supervisor+ (sözleşme bağlamı = daha kritik)
- **History log:** Her iki alan değişikliği `CaseActivity.actionType=FieldUpdate` log'lar (mevcut alan değişim log pattern'i)

**Catalog değişiklikleri:** Product/Package merge/rename **mevcut Case'leri etkilemez** çünkü:
- `Case.productId` FK + denormalized `productName` snapshot
- Catalog ürünü silinirse → ON DELETE RESTRICT (PackageItem'da da öyle); önce manuel olarak ürünü tüm referanslardan çıkarmak gerekir
- Catalog ürünü rename edilirse → Case.productName eski adı korur (snapshot intent'i)

---

## ⑧ Reporting / filtering

**CasesList filtreleri (yeni):**
- `?productId=` — tek ürün filtresi
- `?packageId=` — tek paket filtresi
- `?supportLevel=L2` — A5'te DB-index'i hazır, sadece UI eklenir

**Analytics dashboard boyutları:**
- Vaka × Paket (top paket alanları, paket başına SLA breach oranı)
- Vaka × Product × Tier (hangi ürün hangi tier'da daha sık?)
- Müşteri × Paket × Vaka sayısı (sözleşme paket bazlı destek yoğunluğu)
- **Tüm bunlar Phase 3** (A7b sonrası ayrı analytics PR'ı)

**Jira mapping:** Phase 3 — Project/Component eşleşmesi Package/Product'a göre yapılır; bu PR'da kapsam dışı.

**SavedView:** Mevcut SavedView yapısı `companyId + filters JSON` tutuyor; productId/packageId/supportLevel filter'ları eklenince otomatik destekleniyor. Schema değişikliği yok.

---

## ⑨ Data integrity rules (cross-tenant + cross-table)

| # | Kural | Enforce yeri |
|---|---|---|
| **DI.1** | `Product.companyId === Case.companyId` | caseRepository.create + update (productId set ediliyorsa) |
| **DI.2** | `Package.companyId === Case.companyId` | caseRepository.create + update (packageId set ediliyorsa) |
| **DI.3** | If both packageId + productId set: `productId ∈ PackageItem.productId where packageId = Case.packageId` | caseRepository.create + update |
| **DI.4** | `AccountCompany.packageId.companyId === AccountCompany.companyId` | Account repo addPackage / Package picker'da (A7b-1) |
| **DI.5** | Customerless cases (accountId NULL) → `productId` opsiyonel, `packageId` **YOK** | caseRepository (`package_requires_account` — A4 hierarchy pattern) |
| **DI.6** | If `Case.accountProjectId` set AND `Case.productId` set: ileride opsiyonel kural — A7b'de validation yok, A7b sonrası tracking için açık |
| **DI.7** | `Case.productName` / `Case.packageName` denormalize her zaman set edilir (frontend hint olarak da gönderir, BFF kendi de doğrular) |

**Smoke + data-contract'ta enforce:** DI.1-DI.5 her PR'da regression olarak korunur (Account Project Contract'taki P.3 pattern'i — drift query).

---

## ⑩ Performance & Architecture Gate (her A7b-* PR'ı için)

**Yeni Case fieldları için index önerileri:**
- `Case @@index([companyId, productId])` — analytics + filter
- `Case @@index([companyId, packageId])` — analytics + filter
- (Phase 2 Routing için zaten `companyId, supportLevel` mevcut — A5 ✓)

**N+1 önlemleri:**
- Case list view'a `product: { select: { code, name } }` JOIN'lenmez — `productName` denorm yeterli (chip için)
- CaseDetail tek `findUnique` ile `product`, `package`, `accountProject` include'lar — tek query
- NewCaseForm product picker: müşteri seçildiğinde lazy fetch (`accountService.get(accountId).companies.find(c => c.companyId === companyId).products`); UI cache 30s WR-H2 pattern'i

**Cache:**
- Lookup bootstrap'a `products` + `packages` (per company) eklenir; mevcut WR-H2 TTL cache pattern (30s) yeterli
- Admin endpoint'ler değişmez; sadece Case-side lookup eklenir

**Migration backfill:** Tüm yeni alanlar `NULL` default; 330+ Case için zero-cost backfill. Phase 4'te (Case ↔ productGroup → productId mapping) opsiyonel script — bu PR scope dışı.

**Data-contract additions:**
- `Case ↔ Product Integrity Contract` (DI.1, DI.5, DI.7 invariantları)
- `Case ↔ Package Integrity Contract` (DI.2, DI.3, DI.5)
- `AccountCompany ↔ Package Compatibility` (DI.4)

---

## ⑪ QA / Smoke plan

**Per phase smokes:**
- **A7b-1:** `scripts/smoke-account-company-package.js` (8 senaryo: assign, unassign, cross-company reject, soft-delete behavior, Admin UI render, RBAC, contract)
- **A7b-2:** `scripts/smoke-case-product-link.js` (~14 senaryo: create with productId, with productId + accountId mismatch, customerless create, supportLevel cascade Product→Person→Team→L1, Agent vs Supervisor edit, list filter `?productId=`, denorm productName, project-aware)
- **A7b-3:** `scripts/smoke-case-package-link.js` (~14 senaryo: create with packageId, with packageId AccountCompany mismatch, package-product compat (DI.3), Package picker filters Product list, customerless packageId reject, RBAC, denorm packageName)
- **A7b-4:** `scripts/smoke-supportlevel-cascade.js` (~10 senaryo: explicit > Product > Person > Team > L1; override role gate; existing PATCH behavior unchanged)

**Data-contract group eklemeleri:**
- "Case Product Integrity Contract" (A7b-2)
- "Case Package Integrity Contract" (A7b-3)
- "AccountCompany Package Compatibility Contract" (A7b-1)

---

## ⑫ Recommendation — next implementation PR

**Önerilen:** A7b-1 — AccountCompany.packageId + reconcile UI.

**Scope:**
- Schema: `AccountCompany.packageId String?` FK (RESTRICT — Account silinmek istenirse paket bağı önce kaldırılmalı), `@@index([packageId])`
- BFF: accountRepository'de `assignPackage(accountCompanyId, packageId)` + `unassignPackage(accountCompanyId)` helper'ları; `assertCompanyAdmin` per-company gate (A7 pattern); cross-company invariant validation (DI.4)
- UI: AccountDetailPage'de AccountCompany satırı altında "Paket" alanı + "Paket Ata" modal (mevcut AccountCompanyEditor pattern'i)
- Seed: UNIVERA major hesaplarına WhitePackage atanır; PARAM/FINROTA Backlog kalır
- Smoke: 8 senaryo `scripts/smoke-account-company-package.js`
- Contract: "AccountCompany Package Compatibility Contract" 5 invariant

**Non-scope (A7b-1):**
- `Case.productId` / `Case.packageId` — A7b-2 / A7b-3'te
- supportLevel cascade — A7b-4'te
- NewCaseForm değişikliği — A7b-2'de
- `AccountCompany.packageName` (legacy) silinmez
- Reconcile batch tool yok (manuel item-by-item)

**Risk:** Düşük. Mevcut AccountCompany shape'i değişmez; sadece bir nullable FK ekleniyor. Mevcut 36 AccountCompany satırı NULL packageId ile gelir. Admin UI yeni modal eklenmesi standard pattern.

**Tahmini effort:** 1 working session (~3-4 saat agent time).

**Exact prompt outline (next session için saklı):**
```
TASK: A7b-1 — AccountCompany.packageId + reconcile UI
- Schema: AccountCompany.packageId String? FK
- BFF: assignPackage + unassignPackage helpers + assertCompanyAdmin
- DI.4 validation: package.companyId === accountCompany.companyId
- UI: AccountDetailPage AccountCompany row + "Paket Ata" modal
- Seed: UNIVERA major hesaplara paket atanır
- Smoke 8 senaryo + data-contract 5 invariant
- Performance Gate: @@index([packageId]); no relation-heavy include
- Scope guardrails:
  - NO Case.productId / Case.packageId
  - NO NewCaseForm change
  - NO supportLevel cascade
  - NO AccountCompany.packageName removal
```

---

## ⑬ Rollback Plan (per phase)

Her A7b-* PR'ı kendi migration'ını revert eder. Bağımlılık zinciri:
- A7b-1 revert → A7b-2/3 UI'larında müşteri paket bağı kaybolur (zaten opsiyonel)
- A7b-2 revert → A7b-3 NewCaseForm product picker kaldırılır
- A7b-3 revert → standalone
- A7b-4 revert → cascade öncesi davranışa döner (Person→Team→L1)

---

## ⑭ Register Updates (planning approval sonrası)

- [ ] WR'da A7b row(lar)ı yaratılır (4 alt-PR ID'siyle) ya da mevcut A7 row'una "Next: A7b-1/2/3/4" not eklenir.
- [ ] PRODUCT_PLANNING_MATRIX'te yeni satır gerekmez — PM-05 (Catalog) altında integrasyon olarak yer alır.

---

## ⑮ Git Flow / Topology Metadata (this card)

- **Current branch:** `docs/wr-a7b-planning-card` (base `dev`)
- **Intended PR base:** `dev`
- **Intended PR head:** `docs/wr-a7b-planning-card`
- **Topology pre-PR:** `origin/main..origin/dev` empty ✓ · `origin/dev..origin/main` empty ✓ (her ikisi `69117e6`)
- **Branch deletion after merge:** Yes (local + remote)
- **Path detection:** Post-merge re-fetch + path A/B per [AI_WORKFLOW.md → Git Flow Rules](../AI_WORKFLOW.md#git-flow-rules)
