# Agentic Planning Card — A1 Account customerType discriminator

- **Work Register ID:** A1
- **Product Planning Matrix ID:** PM-01 (Master Data & Müşteri Kimliği)
- **Product capability:** Account modelinde B2B/B2C ayırımı + tipe göre conditional alanlar
- **Request source:** Master Data Discovery (2026-05-19) + üç tenant'ın hem B2B hem B2C ihtiyacı + Backlog
- **Card sahibi:** Ürün direktörü
- **Tarih:** 2026-05-19
- **Protocol versiyonu:** 1.0 (AGENTIC_PLANNING_PROTOCOL.md ilk yayını)

---

## ① Product Fit

- **Problem statement:** Account modelinde B2B/B2C ayırımı yok; tipe göre conditional alan/UI imkânsız. Üç tenant da hem kurumsal hem bireysel müşteri taşıyor; ortak field-set'te ergonomi düşük.
- **Business fit:** PARAM / UNIVERA / FINROTA — her üçünde geçerli. Foundation: A2 (VKN/TCKN/phone validation), A3 (Address) ve A8 (Import) bu karara dayanır.
- **Affected roles:**
  - Agent: vaka açma akışında AccountSearchPicker → değişmez (UI ek alanları opsiyonel)
  - Backoffice: read-only
  - Supervisor / CSM: detail read (chip görür)
  - Admin / SystemAdmin: create + edit (yeni alanlar dolu/boş tüm permütasyon)
- **Acceptance criteria:**
  1. Account oluştururken Kurumsal/Bireysel/Kamu/Vakıf-STK seçilebilir; default Kurumsal
  2. Bireysel seçilince VKN alanı disabled + helper text "TCKN doğrulaması sonraki fazda eklenecek."
  3. Kurumsal/Kamu/Vakıf seçilince legalName + registrationNo alanları görünür ve opsiyonel
  4. Mevcut tüm hesaplar migration sonrası `customerType = Corporate` (varsayılan)
  5. GET /api/accounts ve GET /api/accounts/:id response'unda `customerType`, `legalName`, `registrationNo` döner
  6. Detay sayfasında customerType badge + (varsa) legalName/registrationNo görünür
- **Out-of-scope (explicit):**
  - TCKN field/storage (A2 — privacy/hash kararı sonrası)
  - VKN/TCKN/phone format validation + checksum (A2)
  - Phone E.164 normalize + uniqueness (A2)
  - UI'da customerType ile filter/arama (F4/F5 saved view + filter standard)
  - Migration sonrası mevcut Corporate atamasının manuel düzeltme tool'u (ayrı admin job)
- **Product decisions needed:** Yok. A1 scope kararsızlık taşımıyor; A2 kararları (TCKN storage modeli) A1'i bloklamıyor — A2 bağımsız PR.

---

## ② Architecture Fit

- **Schema impact:**
  - Yeni Prisma enum: `CustomerType { Individual, Corporate, Government, NonProfit }` (TR map: Bireysel/Kurumsal/Kamu/Vakıf-STK)
  - Account modeline 3 yeni kolon:
    - `customerType CustomerType @default(Corporate)` — NOT NULL (default backfill için)
    - `legalName String?`
    - `registrationNo String?`
  - **TCKN eklenmiyor** — Modeling Guardrail #1
- **API impact:**
  - POST /api/accounts ve PATCH /api/accounts/:id `customerType`, `legalName`, `registrationNo` kabul eder
  - GET /api/accounts response shape additive: `customerType`, `legalName`, `registrationNo` field'ları
  - GET /api/accounts/:id aynı alanları include eder
  - Backward compat: eski client'lar yeni alanları ignore eder; eksik field-set göndermek hâlâ geçerli (Corporate default)
- **Role/scope impact:** Yok. Mevcut LIST_ROLES / DETAIL_READ_ROLES / WRITE_ROLES korunur.
- **Privacy/risk notes:** legalName + registrationNo public B2B verisi; encryption gerekmez. TCKN scope dışında — KVKK riski yok. Logger'a yeni alan eklenmiyor.
- **Migration/backfill needs:** Prisma migration `add_account_customer_type`:
  - Enum CustomerType create
  - Account ALTER TABLE: 3 kolon (default Corporate sayesinde NULL backfill yok)
  - Manuel "Bireysel mi?" reconcile out-of-scope
- **Backward compatibility notes:**
  - Mevcut response shape'leri **ek** alanlarla genişler, çıkarılan yok
  - Mevcut PATCH /api/accounts/:id body field'ları aynı kalır; yeni alanlar opsiyonel
  - Seed script'inin re-runable'lığı bozulmaz (upsert update payload'una customerType eklenir)
- **Modeling guardrails check:**
  - ✓ #1 TCKN PII: TCKN alanı eklenmiyor
  - ✓ #2 Project AccountCompany-scoped: A1 Project'e dokunmuyor
  - ✓ #3 Category Layer: A1 kategoriye dokunmuyor
  - ✓ #4 Eşleştirme ≠ Birleştirme: A1 Account merge'e dokunmuyor
  - ✓ #5 Address country-agnostic: A1 Address'e dokunmuyor
  - ✓ #6 Multi-tenant scope: Yeni endpoint yok, mevcut scope korunuyor
  - ✓ #7 Enum mapping: `CustomerType` `enumMap.js`'e M_CUSTOMER_TYPE map'i + frontend mirror eklenecek

---

## ③ Code Fit

- **File impact map:**
  - **BE:**
    - `prisma/schema.prisma` — Account + enum CustomerType
    - `prisma/migrations/20260519XXXXXX_add_account_customer_type/migration.sql`
    - `server/db/enumMap.js` — M_CUSTOMER_TYPE forward + reverse
    - `server/db/accountRepository.js` — shape + create + update + getAccount alan eklemeleri
    - `server/routes/accounts.js` — değişiklik gerekmez (req.body passthrough); validation accountRepository'de
  - **FE:**
    - `src/services/accountService.ts` — type interface'leri (AccountListItem, AccountDetail, AccountCreateInput, AccountUpdateInput)
    - `src/features/accounts/AccountFormModal.tsx` — segmented control + conditional alanlar + helper text
    - `src/features/accounts/AccountDetailPage.tsx` — header badge + GeneralSection ek satırlar
  - **Script:**
    - `scripts/seed-full-demo-scenarios.js` — Account.upsert payload'una customerType + (rastgele) legalName/registrationNo
    - `scripts/smoke-account-customer-type.js` — yeni
    - `scripts/smoke-data-contracts.js` — Account/Case Integrity grubuna 2 yeni check
- **Reuse plan:**
  - `shapeAccountRow` helper'ı (accountRepository) — ek field'lar burada eklenir
  - `Badge` + `Field` + `Select`/`Segmented` UI primitive'leri
  - `enumMap.js` forward/reverse pattern (M_STATUS gibi)
  - Mevcut `notify` toast pattern
- **No-touch list:**
  - VKN @unique constraint
  - AccountCompany, AccountContact, AccountProduct modelleri (sadece okuma)
  - assertAccountInScope guard logic
  - Phase D customerMatchPending, Case modeli
  - LIST_ROLES / DETAIL_READ_ROLES / WRITE_ROLES sabitleri
- **Implementation risk:**
  - Migration default value: mevcut satırlarda hızlı; PostgreSQL ALTER TABLE ADD COLUMN with DEFAULT modern (10+) versiyonda hızlı, yine de production'da büyük tabloda check edilmeli
  - Enum case sensitivity: `customerType: 'Corporate'` vs 'corporate' — Prisma client kabul ettiği identifier ile gönderilmeli
  - Form state init: edit modunda account.customerType undefined ise Corporate fallback
- **Likely test/smoke files:**
  - `scripts/smoke-account-customer-type.js` (yeni, ~14 senaryo)
  - `scripts/smoke-data-contracts.js` — yeni iki check: (a) Account.customerType set on all rows (no nulls); (b) Account.tckn / Account.tcknHash field yok (regression guard)

---

## ④ QA Fit

- **Automated test plan:**
  - `smoke-account-customer-type.js`:
    1. Migration sonrası tüm Account'larda customerType set (no null)
    2. POST /api/accounts (Admin) create Corporate → response'ta customerType=Corporate
    3. POST /api/accounts (Admin) create Individual → response'ta customerType=Individual, vkn null kabul ederse OK
    4. POST /api/accounts (Admin) create Government with legalName + registrationNo
    5. POST /api/accounts (Admin) create NonProfit
    6. PATCH /api/accounts/:id (Admin) Corporate → Individual değişimi başarılı
    7. PATCH /api/accounts/:id (Admin) sadece legalName güncelle, customerType değişmez
    8. GET /api/accounts (Agent) response'ta customerType field'ı var
    9. GET /api/accounts/:id (Supervisor) response'ta customerType + legalName + registrationNo var
    10. POST /api/accounts (Supervisor) → 403 (read-only)
    11. POST /api/accounts (Agent) → 403
    12. Tenant scope: cross-company account leak yok (assertAccountInScope korunur)
    13. POST /api/accounts geçersiz customerType ("Foo") → 400
    14. Response'ta tckn / tcknHash field'ı YOK (regression guard)
  - `smoke-data-contracts.js` extension:
    - Account.customerType has no nulls (PASS/FAIL)
    - Account schema does not include tckn or tcknHash field (PASS/FAIL — via Object.keys on Prisma model)
- **Manual QA checklist:**
  - Agent: AccountSearchPicker'da müşteri ara → customerType etkilenmiyor, vaka açma akışı bozulmamış
  - Backoffice: Account list görüntü, customerType chip varsa (Phase B'de henüz UI gösterilmiyor — sadece detayda)
  - Supervisor: Account detail aç → customerType badge görünür; legalName/registrationNo varsa Genel Bilgiler'de
  - CSM: Aynı Supervisor davranışı
  - Admin / SystemAdmin: Yeni Bireysel hesap oluştur (VKN alanı disabled), Yeni Kurumsal hesap oluştur (legalName+registrationNo open), mevcut hesabı düzenle (customerType değiştir)
- **Seed readiness check:**
  - `npm run db:seed:full-demo` → 80% Corporate / 15% Individual / 3% Government / 2% NonProfit (deterministic mix)
  - `npm run smoke:data-contracts` PASS
  - `node scripts/smoke-account-customer-type.js` PASS
- **Backward compatibility checks:**
  - Eski client GET /api/accounts'tan dönen response'u parse edebiliyor (yeni alanları yok sayar)
  - Phase D customerless akışı kırılmıyor (customer-match-pending bağımsız)
  - Account 360 detail page eski alanları + yeni customerType birlikte render ediyor
- **Rollback/regression risks:**
  - Migration revert: yeni 3 kolon drop; veri kaybı sadece manuel girilen legalName/registrationNo değerleri
  - Seed re-run: customerType update payload'unda olduğu için idempotent
  - FE revert: type union genişleme problemi olmaz (ek field'lar opsiyonel)
- **Production smoke:** Gerekli (multi-tenant + KVKK kapsamında doğrulama: TCKN ve tcknHash field'larının response'ta bulunmadığı production'da da assert edilmeli).

---

## ⑤ Decisions

Yok. A1 scope karar dışı; A2 kararları bağımsız.

---

## ⑥ Ready / Not Ready

- **Durum:** **Ready**
- **Engelleyen:** Yok

---

## ⑦ Implementation Prompt

Yukarıdaki ① ② ③ ④ çıktıları + WORK_REGISTER A1 + AGENTIC_PLANNING_PROTOCOL.md anti-pattern'leri implementation prompt'a sentezlendi. Kuralların özeti:

1. **TCKN eklenmez** (field, hash, encrypted variant — hiçbiri).
2. CustomerType enum + 3 alan (`customerType` default Corporate, `legalName?`, `registrationNo?`).
3. Mevcut Account.companyId, AccountCompany, AccountContact, AccountProduct **dokunulmaz**.
4. enumMap.js'e M_CUSTOMER_TYPE forward + reverse map zorunlu.
5. shapeAccountRow + getAccount response'a 3 alan additive eklenir.
6. AccountFormModal: segmented control Kurumsal/Bireysel/Kamu/Vakıf-STK; Bireysel'de VKN disabled, helper text gösterilir.
7. AccountDetailPage: header'da customerType badge; GeneralSection'a legalName + registrationNo.
8. seed-full-demo-scenarios.js: deterministic 80/15/3/2 mix.
9. smoke-account-customer-type.js: 14 senaryo + smoke:data-contracts.js'e 2 regression check.
10. Branch: `feat/account-customer-type` → `dev` → `main` release flow.

---

## ⑧ Test Plan (özet)

- **Otomatik:** 14 senaryolu smoke + smoke-data-contracts.js'e 2 regression check (no-null + no-tckn). Toplam 16 yeni assertion.
- **Manuel:** 5 rol × ortalama 2 senaryo = ~10 manuel test
- **Production:** smoke endpoint çıktısında customerType field'ı doğrulanır; tckn / tcknHash field'ları regex-grep edilir

---

## ⑨ Rollback Plan

- `git revert <merge-sha>` → kod geri döner
- `prisma migrate resolve --rolled-back <migration-name>` veya `prisma migrate reset --skip-seed` + re-seed
- Seed idempotent — yeniden çalıştırınca eski state'e gelir
- Manuel girilen legalName/registrationNo veri kaybı; geri alma için DB backup gerekli (production)

---

## ⑩ Register Updates Needed

- [ ] **Merge sonrası** WORK_REGISTER.md A1 Status: `Ready` → `Shipped` + commit hash
- [ ] **Merge sonrası** WORK_REGISTER.md A1 Next action: commit hash + "Next: A2 prompt → PR"
- [ ] PRODUCT_PLANNING_MATRIX.md PM-01: scope değişmedi → güncelleme yok
- [ ] AGENTIC_PLANNING_PROTOCOL.md: A1 örnek pattern olarak referansta kalıyor

---

## ⑪ Card History

- 2026-05-19: Card oluşturuldu. Status: Ready. Implementation başlatılabilir.
