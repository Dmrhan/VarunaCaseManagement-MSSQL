# Agentic Planning Card — A4 AccountProject (UNIVERA Project-Based Cases)

- **Work Register ID:** A4
- **Product Planning Matrix ID:** PM-04 (AccountProject — UNIVERA için proje modeli)
- **Product capability:** Company-relationship scoped proje modeli; vakaların proje bazlı takibi + raporlaması
- **Request source:** Master Data Decision Sprint §④ (onaylı 2026-05-19); UNIVERA core ihtiyacı (Anadolu FMCG, Marmara Soğuk Zincir vb. çoklu projeli müşteriler)
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-20
- **Protocol versiyonu:** 2.0
- **Decision references:** [MASTER_DATA_DECISION_SPRINT.md](./MASTER_DATA_DECISION_SPRINT.md) §④ AccountCompany-scoped + `projectsEnabled/Required` company flags

---

## ① Product Fit

- **Problem:** Schema'da Project entity yok. UNIVERA müşterileri (Anadolu FMCG, Marmara Soğuk Zincir vb.) çoklu projeli (Rota Opt + e-Fatura + Saha Veri paralel yürür) ama Case'ler şu an doğrudan Account'a bağlı; "Bu vaka hangi projeye ait?" sorusu cevapsız. PARAM/FINROTA için proje konsepti opsiyonel.

- **Business fit:**
  - **UNIVERA** core ihtiyacı (PM-04 P0 olarak işaretli) — projeye bağlı SLA, raporlama, proje bazlı vaka backlog'u
  - **PARAM/FINROTA** opt-in — gelecekte sözleşme/SLA paketi projeleri için
  - Tüm tenantlar `Company.projectsEnabled` flag ile kontrol; default false → mevcut davranış bozulmaz

- **Affected roles:**
  - Agent / Backoffice: Case create'te `Project` combobox (sadece `projectsEnabled=true` tenant'larda)
  - Supervisor / CSM: Project listesi okur, vaka filtresi
  - Admin / SystemAdmin: Project CRUD + `Company.projectsEnabled/Required` toggle

- **Acceptance criteria:**
  1. `AccountProject` entity `accountCompanyId` FK ile — Account-level değil, AccountCompany-level (Decision Sprint #4 kilitli kural)
  2. Hierarchy: `Account → AccountCompany → AccountProject → Case`
  3. `Case.accountProjectId?` nullable — mevcut tüm vakalar etkilenmez
  4. CompanySettings'e `projectsEnabled` (default false) + `projectsRequired` (default false) eklenir
  5. `projectsEnabled=false` tenant'ta UI Project field'ı gizli; backend null kabul eder
  6. `projectsRequired=true` tenant'ta Case create accountId varken accountProjectId zorunlu (400 if missing)
  7. Cross-tenant: Project'in `accountCompany.companyId` mutlaka case'in `companyId`'si ile eşleşmeli (validation)
  8. Admin Project CRUD endpoints + UI; Supervisor/CSM read-only
  9. Seed: UNIVERA müşterilerinde 2-3 proje üretilir; bazı UNIVERA vakaları projeye bağlı; PARAM/FINROTA proje yok
  10. Smoke: 14 senaryo + data-contracts extension

- **Out-of-scope:**
  - Project-level SLA (`AccountProject.defaultSupportLevel` Phase 3 — A5 ile sonrası)
  - Project portfolio dashboard (Project sağlık skoru, milestone takibi)
  - Project bütçe takibi / saatlik faturalama
  - Project ile Package ilişkisi (A7 sonrası `Package.projectId?` opsiyonel)
  - UNIVERA `projectsRequired=true` flag flip — Phase 2 ayrı admin operasyonu, demo seed'te `projectsRequired=false`
  - CasesListPage advanced filter UI (Phase 2; backend filter param hazır)
  - Reporting / analytics dashboard

- **Decisions:** Yok — Decision Sprint §④ onaylı.

---

## ② Architecture Fit

- **Schema impact:**
  ```prisma
  enum ProjectStatus { Active Passive Completed Cancelled }

  model AccountProject {
    id               String        @id @default(cuid())
    accountCompanyId String                            // ← AccountCompany'ye bağlı, Account değil (Guardrail #2)
    code             String                            // tenant-içi unique kod, örn "ROTA-2026"
    name             String
    status           ProjectStatus @default(Active)
    startDate        DateTime?
    endDate          DateTime?
    description      String?       @db.Text
    isActive         Boolean       @default(true)
    createdAt        DateTime      @default(now())
    updatedAt        DateTime      @updatedAt
    accountCompany   AccountCompany @relation(fields: [accountCompanyId], references: [id], onDelete: Cascade)
    cases            Case[]
    @@unique([accountCompanyId, code])
    @@index([accountCompanyId])
    @@index([accountCompanyId, isActive])
  }

  model AccountCompany {
    // mevcut alanlar
    projects AccountProject[]
  }

  model Case {
    // mevcut alanlar
    accountProjectId String?
    accountProject   AccountProject? @relation(fields: [accountProjectId], references: [id])
    @@index([accountProjectId])
  }

  model CompanySettings {
    // mevcut alanlar
    projectsEnabled  Boolean @default(false)
    projectsRequired Boolean @default(false)
  }
  ```

- **API impact:**
  - **Account routes:** GET response'a `companies[].projects[]` eklenir (lightweight: id, code, name, status, isActive, startDate, endDate)
  - **Yeni endpoint'ler:**
    - `POST   /api/accounts/:id/companies/:accountCompanyId/projects` → Admin write
    - `PATCH  /api/accounts/:id/projects/:projectId` → Admin write
    - `DELETE /api/accounts/:id/projects/:projectId` → Admin write (soft delete = isActive=false, status=Cancelled)
  - **Case routes:**
    - POST/PATCH `/api/cases` body: `accountProjectId?` kabul + validation
    - GET `/api/cases` query: `accountProjectId=…` filter desteği
    - GET `/api/cases` response: case'lerde `accountProjectId`, `accountProjectName`, `accountProjectCode` (lightweight)
  - **CompanySettings:**
    - Mevcut PUT `/api/admin/company-settings/:companyId` extend: `projectsEnabled` + `projectsRequired` toggle kabul

- **Role/scope impact:**
  - Mevcut `WRITE_ROLES = ['Admin', 'SystemAdmin']` korunur; project CRUD bu listede
  - Read: `LIST_ROLES` (Agent dahil) tüm rollerin case create akışında project görmesine izin verir; AccountDetailPage'de detail-read olduğu için Supervisor+ görür
  - Tenant scope: AccountProject'in `accountCompany.companyId` `allowedCompanyIds` içinde olmalı (mevcut `loadEditableAccountCompany` pattern'ine uyumlu)

- **Privacy/PII:** Yok. AccountProject metadata (kod, isim, tarih) hassas değil.

- **Migration/backfill:**
  - Yeni `AccountProject` tablosu — boş başlar
  - `Case.accountProjectId?` — tüm mevcut Case'ler null; backfill **yok** (kasıtlı, decision sprint)
  - `CompanySettings.projectsEnabled/Required` — default false; mevcut tenantlar etkilenmez
  - Seed: UNIVERA için `projectsEnabled=true` + 2-3 proje + bazı linked Case'ler

- **Backward compatibility:**
  - Mevcut Case create akışları (accountProjectId göndermeden) bozulmaz
  - GET response shape additive; eski client'lar `projects` array'ini ignore eder
  - `projectsRequired=true` tenant **yok**; bu flag opt-in olarak ayrı admin operasyonunda etkin

- **Modeling guardrails check:**
  - ✓ #2 Project AccountCompany-scoped: tam uyum
  - ✓ Multi-tenant scope: AccountProject erişimi `accountCompany.companyId` filter'ı ile
  - ✓ Enum mapping: `ProjectStatus` 4 ASCII identifier; @map TR label gerekmiyor (Türkçe görünüm UI map'inde)
  - ✓ Diğerleri etkilenmiyor

---

## ③ Performance & Architecture Gate  *(TEMİZ ve GÜÇLÜ MİMARİ)*

- **Query/index impact:**
  - Yeni 3 index: `AccountProject.accountCompanyId`, `AccountProject(accountCompanyId, isActive)`, `Case.accountProjectId`
  - `Account detail` query'sine `companies[].projects[]` include eklenir — companies zaten include edildiği için marginal cost (her account ~3 company × ~5 proje = ~15 ek satır worst case)
  - Case list'te project lightweight select (id, name, code) — relation eklenir; N+1 önleme için Prisma include kullanılır
  - Project listesi `take` cap'i: Admin endpoint'leri default 25, max 100 (WR-H1 pattern)
- **Cache strategy:** Mevcut WR-H2 client cache invalidation: Project mutation'ları → AccountDetail prefix invalidate (`invalidateAccountAndCustomerContext`)
- **Large query guard:** Project list endpoint'leri `take` cap'li; Account detail'de tek `findUnique` ile include
- **Frontend performance:**
  - AccountDetailPage'de "Projeler" section ek render; render maliyeti küçük (3-10 proje per company)
  - Case form'da project combobox: sadece `projectsEnabled=true` ise gösterilir; account seçildikten sonra lazy fetch (`/api/accounts/:id/companies/:companyId/projects`)
  - CasesListPage'de project chip: case row'unda küçük badge — render-light
- **Concurrency:** Project mutation'ları Prisma `@@unique` ile race-safe (duplicate code → P2002 → 409)
- **Observability:** CaseActivity audit log Case update'lerde mevcut pattern korunur (`accountProjectId` field değişimi otomatik log'lanır mevcut `update` pattern'iyle)
- **Verdict:** **Pass** — yeni endpoint'ler bounded list; Account detail include marginal; case list lightweight project select; cache invalidation hook'u var.

---

## ④ Code Fit

- **File impact map:**
  - **BE:**
    - `prisma/schema.prisma` — 4 değişiklik (AccountProject + ProjectStatus enum, AccountCompany.projects, Case.accountProjectId, CompanySettings flags)
    - `prisma/migrations/20260521120000_add_account_projects/migration.sql`
    - `server/db/accountRepository.js` — Account detail'e projects include; yeni `createProject`, `updateProject`, `removeProject` methods
    - `server/routes/accounts.js` — 3 yeni endpoint
    - `server/db/caseRepository.js` — Case create/update'te accountProjectId validation; list query'sine project include; filter param
    - `server/routes/cases.js` — list query param `accountProjectId`; create/patch body
    - `server/db/adminRepository.js` — `companySettingsRepo.upsert` projectsEnabled/Required ekle
    - `server/db/enumMap.js` — ProjectStatus için mapping yok (ASCII display direkt UI'da)
  - **FE:**
    - `src/services/accountService.ts` — `AccountProject` interface + `AccountCompanyDetail`'a `projects: AccountProject[]`; CRUD methods
    - `src/features/accounts/AccountDetailPage.tsx` — "Projeler" section per AccountCompany
    - `src/features/accounts/AccountProjectEditor.tsx` (yeni) — create/edit/delete modal
    - `src/services/caseService.ts` — `Case` interface'ine `accountProjectId`, `accountProjectName`, `accountProjectCode`
    - `src/features/cases/NewCaseForm.tsx` ve `CaseDetailPage.tsx` — Project combobox/badge
    - `src/features/cases/CasesListPage.tsx` — project chip (badge)
    - `src/features/admin/AdminCompaniesPage.tsx` — toggle (projectsEnabled, projectsRequired)
  - **Script:**
    - `scripts/seed-full-demo-scenarios.js` — UNIVERA projeleri + linked cases + `projectsEnabled=true`
    - `scripts/smoke-account-projects.js` (yeni, ~350 satır)
    - `scripts/smoke-data-contracts.js` — yeni "Account Project Contract" group

- **Reuse plan:**
  - Account CRUD pattern (`loadEditableAccountCompany` guard, `assertAccountInScope`)
  - WR-H2 cache invalidation hook'u
  - Case update audit log pattern
  - Mevcut companySettings UI'da toggle ekleme — `requireCustomerOnCaseCreate` pattern'i takip
  - Prisma `@@unique([accountCompanyId, code])` → P2002 → 409 pattern (mevcut external customer code ile aynı)

- **No-touch list:**
  - Case status state machine
  - Phase D customerMatchPending
  - WR-A1/A2 customerType/TCKN flow
  - AccountContact / AccountProduct CRUD
  - WR-H1/H2 cap + cache helpers

- **Implementation risk:**
  - Düşük-Orta. AccountProject + Case + CompanySettings + UI üç farklı yere değiyor ama her biri mevcut pattern'lerle birebir uyumlu
  - En riskli kısım: `projectsRequired=true` tenant'ta Case create flow'un validation'ı — null kalmasını önlemek için backend re-check (UI bypass'a güven yok)

- **Likely test files:** `smoke-account-projects.js` (yeni, ~14 ana senaryo + alt assertions); `smoke-data-contracts.js` extension (5-6 cheap check)

---

## ⑤ QA Fit

- **Automated test plan:**

  **`smoke-account-projects.js`:**
  | Section | Assertions |
  |---|---|
  | 1. Admin CRUD | Project create, duplicate code 409, same code different AC OK |
  | 2. Read | Supervisor read OK, Account detail includes projects |
  | 3. Write RBAC | Supervisor write 403; Agent write 403 |
  | 4. Cross-tenant | Cross-tenant project erişim 403; case linkAccount cross-tenant 400 |
  | 5. Case integration | Valid project ile case create OK; cross-account project 400; cross-company project 400 |
  | 6. List filter | `?accountProjectId=...` filter çalışır |
  | 7. Detail | Case detail response project info içerir |
  | 8. Backward compat | accountProjectId null vakalar etkilenmez |
  | 9. projectsRequired | `projectsRequired=true` → null project 400; false → null OK |
  | 10. Seed | UNIVERA seed projeleri ve linked case'ler oluşur |

  Toplam ~30 assertion.

  **`smoke-data-contracts.js` extension** — "Account Project Contract":
  - AccountProject.accountCompanyId → AccountCompany FK
  - Case.accountProjectId → AccountProject FK
  - Project AccountCompany scope: case.companyId === accountProject.accountCompany.companyId
  - Hiçbir Account-level project relation yok (sadece AccountCompany altında)

- **Manual QA:**
  - Admin UNIVERA company settings → `projectsEnabled` toggle on → save
  - Admin UNIVERA Account detail → "Projeler" section görünür; "Yeni Proje" → modal açılır → project oluşturulur
  - Agent (UNIVERA) Case create → account seçince Project dropdown açılır; project seçince case oluşur
  - Agent (PARAM, projectsEnabled=false) Case create → Project field gizli
  - Supervisor case list → project chip görünür
  - Mevcut PARAM case'leri (project null) hâlâ açılıp düzenlenebilir

- **Seed readiness:** seed `npm run db:seed:full-demo` UNIVERA için 2-3 proje + 3-5 linked case üretir
- **Backward compat:** Mevcut case smoke'lar (case-claim, case-stats, customer-type, validation-privacy) hâlâ PASS olmalı
- **Production smoke:** Gereksiz — yeni endpoint'ler ve UI; dev smoke yeterli

- **Rollback risks:** Migration revert: AccountProject table drop + Case.accountProjectId drop + CompanySettings 2 column drop. Veri kaybı: manuel girilen projeler ve project link'leri.

---

## ⑥ Decisions — Yok (Decision Sprint §④ onaylı)

---

## ⑦ Ready / Not Ready — **Ready**

---

## ⑧ Implementation Prompt
(Card sonu — schema + migration → BFF → UI → Seed → Smoke sırası)

---

## ⑨ Test Plan (özet)
14 ana senaryo (~30 assertion) + 5 data-contract check + ~6 manual rol senaryosu.

---

## ⑩ Rollback Plan
`git revert <merge-sha>` + `prisma migrate resolve --rolled-back 20260521120000_add_account_projects` (veya reset+seed). Manuel girilen project verisi kayıp; CompanySettings 2 flag default'a düşer.

---

## ⑪ Register Updates
- [ ] **Merge sonrası** WR-A4 Status: `Ready (Phase 1)` → `Shipped` + commit hash + PR ref.
- [ ] A4 Next action: PR + smoke counts; Phase 2 (`projectsRequired=true` flag flip) ayrı turla.

---

## ⑫ Git Flow / Topology Metadata
- **Current branch:** `feat/account-projects`
- **PR base:** `dev`
- **PR head:** `feat/account-projects`
- **Branch deletion after merge:** Yes (local + remote)
- **Topology pre-PR:** `origin/main..origin/dev` empty ✓ · `origin/dev..origin/main` empty ✓ (her ikisi `796e3ae`)
