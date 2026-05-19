# Agentic Planning Card — A2 VKN / TCKN / Phone Validation + Privacy Design

- **Work Register ID:** A2
- **Product Planning Matrix ID:** PM-01 (Master Data & Müşteri Kimliği)
- **Product capability:** Müşteri kimliği doğrulama + KVKK-safe TCKN saklama + telefon normalize
- **Request source:** WR Ready (Decision Sprint #1, #2, #3 onaylı 2026-05-19); A1 sonrası master data foundation devamı
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-19
- **Protocol versiyonu:** 2.0
- **Decision references:** [MASTER_DATA_DECISION_SPRINT.md](./MASTER_DATA_DECISION_SPRINT.md) §① TCKN HMAC + last4, §② phone normalize only, §③ VKN global @unique + checksum

---

## ① Product Fit

- **Problem:** A1 sonrası Account modelinde:
  - VKN format/checksum yok → invalid kayıt mümkün
  - TCKN field hiç yok → Bireysel müşteri kimliklendirilemiyor (search, dedup)
  - Phone normalize edilmiyor → "+90 532 ...", "0532 ...", "532..." varyasyonları search'ü kırıyor
  Bu PR üç eksiği aynı pakette kapatır.

- **Business fit:** PARAM/UNIVERA/FINROTA — üçü de:
  - VKN doğrulama → invalid 10-haneli olmayan girişler frontline'da inline reddedilir
  - TCKN HMAC → Bireysel müşteri arama + duplicate önleme (PARAM B2C, FINROTA bireysel)
  - Phone E.164 normalize → call center workflow'da phone-by-number lookup

- **Affected roles:**
  - **Agent / Backoffice / CSM:** AccountSearchPicker'da `vkn`/`phoneE164`/`tcknHash` ile arama
  - **Admin / SystemAdmin:** Account create/edit form'unda inline validation görür; TCKN giriş alanı **sadece Bireysel** customerType seçildiğinde görünür
  - **DPO (audit):** Mevcut audit log mekanizması; TCKN field'ına yazım operasyonları izlenebilir

- **Acceptance criteria:**
  1. `POST /api/accounts` (Admin) `vkn` 10-hane + checksum validation → invalid 400
  2. Bireysel customerType seçildiğinde **TCKN inline validation** (11-hane + Verhoeff-benzeri checksum); plain TCKN sadece HTTP body'de gelir, DB'ye **hash + last4** olarak yazılır
  3. API response (GET, POST, PATCH) **asla plain TCKN içermez**; sadece `tcknLast4: "*******1234"` veya `tcknMasked` döner
  4. `tcknHash` global `@unique` — aynı TCKN ile iki Account yaratılamaz
  5. Phone field'ları (`Account.phone`, `AccountContact.phone`) E.164 normalize edilir; ayrı `phoneE164` kolonu eklenir; **DB unique constraint YOK**
  6. `/api/lookup/validate-vkn?value=…` ve `/api/lookup/validate-tckn?value=…` endpoint'leri inline UX feedback için
  7. `TCKN_HASH_PEPPER` env değişkeni eksik veya boş ise: TCKN create/update path **400 fail** ile döner ("Sistem yapılandırılmamış"); search path TCKN field'ını sessizce ignore eder (production deploy'unda env zorunlu)
  8. Seed (`seed-full-demo-scenarios.js`) **gerçek TCKN üretmez**; Bireysel müşteriler için synthetic hash + last4 ("0000")
  9. Smoke harness 4 ana invariant'ı assert eder (privacy + validation + uniqueness + pepper-missing fail-safe)

- **Out-of-scope:**
  - Üçüncü taraf gerçek TCKN doğrulama servisi (NVI / Gelir İdaresi entegrasyonu)
  - Üçüncü taraf VKN doğrulama servisi (Gelir İdaresi)
  - Multiple phone numbers per Account (tek `phone` + `phoneE164` korunur)
  - Phone country code seçici UI (TR-only ilk versiyon; libphonenumber gelecek)
  - Pepper rotation tooling (Phase 2 — yıllık batch)
  - DPO admin dashboard / access audit log tablosu (separate WR item gerekirse)
  - SMS doğrulama
  - TCKN-by-search UI (TCKN ile müşteri ara) — backend hazır olur, UI bu PR'da yok

- **Product decisions needed:** Yok — Decision Sprint'te kararlar onaylandı.

---

## ② Architecture Fit

- **Schema impact:**
  ```prisma
  model Account {
    // mevcut alanlar korunur
    tcknHash  String?  @unique          // HMAC-SHA256(TCKN, pepper); 64-char hex; global unique
    tcknLast4 String?                   // Display için son 4 hane (örn "1234")
    phoneE164 String?                   // "+905XXXXXXXXX" normalize
    @@index([phoneE164])                // Search için, NOT unique
  }
  model AccountContact {
    // mevcut alanlar korunur
    phoneE164 String?                   // contact phone normalize
    @@index([phoneE164])
  }
  ```
  - Mevcut `vkn` global @unique korunur (değişmez).
  - Mevcut `phone` (display) korunur; `phoneE164` ek kolon.
  - TCKN için iki kolon (hash + last4); plain TCKN **hiçbir kolonda yok**.

- **API impact:**
  - POST/PATCH `/api/accounts` request body:
    - `vkn` → format + checksum validation (Corporate/Government için zorunlu olmayan kontrol; girilirse valid olmalı)
    - `tckn` (plain, sadece Individual customerType) → backend HMAC + last4 hesaplar, hash/last4 yazar, plain'i atar
    - `phone` → backend E.164 normalize, hem `phone` (display) hem `phoneE164` yazar
  - GET response shape:
    - **YENİ:** `tcknMasked: string | null` (örn `"*******1234"` veya null)
    - **YENİ:** `phoneE164: string | null`
    - **vknMasked** (mevcut): aynı kalır
    - **ASLA:** `tckn`, `tcknHash` ham field response'ta yok (smoke regression guard)
  - YENİ endpoint:
    - `GET /api/lookup/validate-vkn?value=…` → `{ valid: boolean, message: string | null }` — sync UX feedback
    - `GET /api/lookup/validate-tckn?value=…` → aynı shape

- **Role/scope impact:** Yok. Mevcut LIST_ROLES/DETAIL_READ_ROLES/WRITE_ROLES korunur. Validate endpoint'leri authenticated all-roles (input doğrulama, scope gerekmiyor).

- **Privacy/risk notes:**
  - **TCKN HMAC pepper (`TCKN_HASH_PEPPER`):** env değişkeni. **Hayati önem:** production'da rotate edilirse mevcut hash'ler eşleşmez → user re-entry veya rehash batch gerekir. Phase 1'de pepper sabit; rotation Phase 2.
  - **Pepper missing fail-safe:** Env yoksa TCKN write path 400 döner ("TCKN yapılandırılmamış"); silently plain saklamaz. Read path TCKN aramayı (varsa) ignore eder.
  - **TCKN log emission:** Hiçbir log/error path plain TCKN içermez. `console.error` payload sanitize edilir; aiClient.js'in `apiFetch` benzeri log policy'si zaten safe (key prefix/suffix log'ları gate'li #142).
  - **Audit:** Bu Phase 1 ayrı access audit tablosu eklemiyor; mevcut `CaseActivity` audit pattern Account create/update'i kapsamıyor (TCKN write log'lanmaz olarak kalır). Phase 2 ayrı doc'ta planlanır (DPO ihtiyaçları).

- **Migration/backfill needs:**
  - Yeni kolonlar nullable + default'suz → backfill yok.
  - Mevcut Account'ların `phone` → `phoneE164` migration script tek seferlik (ayrı migration file veya seed re-run yaparken).
  - TCKN backfill **yok** (hiç kayıt yok zaten).

- **Backward compatibility notes:**
  - Mevcut response shape genişler (additive): yeni `tcknMasked`, `phoneE164` alanları eklenir; mevcut client'lar bunları ignore eder.
  - Eski POST/PATCH request body korunur; yeni alanlar opsiyonel (Individual değilse tckn yok zaten).
  - VKN format validation eski geçerli kayıtları (zaten 10-haneli) kırmaz; sadece YENİ create/update'lerde devreye girer.

- **Modeling guardrails check:**
  - ✓ #1 TCKN PII: plain TCKN saklanmıyor, hash + last4 only
  - ✓ #2 Project AccountCompany-scoped: A2 Project'e dokunmuyor
  - ✓ #3 Category Layer: A2 kategoriye dokunmuyor
  - ✓ #4 Eşleştirme ≠ Birleştirme: A2 merge/match akışına dokunmuyor
  - ✓ #5 Address country-agnostic: A2 address'e dokunmuyor
  - ✓ #6 Multi-tenant scope: validate endpoint'leri authenticated, mevcut scope korunuyor
  - ✓ #7 Enum mapping: yeni Prisma enum eklenmiyor; sadece string alanlar

---

## ③ Performance & Architecture Gate  *(TEMİZ ve GÜÇLÜ MİMARİ)*

- **Query/index impact:** Yeni `tcknHash` @unique index (B-tree); `phoneE164` ayrı index (search için). Account modelinde +3 kolon (tcknHash, tcknLast4, phoneE164) + 1 unique + 2 normal index. AccountContact'a +1 kolon + 1 index. Search latency için pozitif (mevcut LIKE/ILIKE arama yerine eşitlik araması mümkün).
- **Cache strategy:** Account detail cache (WR-H2 prefix invalidate) zaten kapsıyor; ek strateji gerekmez. Validate endpoint'leri stateless → cache yok.
- **Large query guard:** Validate endpoint'leri tek-input pure compute (HMAC hesabı + format kontrolü); query yok. Search endpoint'leri mevcut pagination cap (WR-H1) korunur.
- **Frontend performance:** AccountFormModal'a 1-2 ek conditional alan (TCKN Individual seçildiğinde); render maliyeti ihmal. Inline validate çağrıları **debounce** edilir (350ms).
- **Concurrency:** TCKN/VKN unique constraint Prisma P2002 ile yakalanır → 409 "duplicate" toast (mevcut accountRepository pattern'i).
- **Observability:**
  - Pepper missing dev mode'da uyarı log'u (`console.warn`); production'da silent fail-safe (TCKN write 400).
  - Validate endpoint metric ihtiyacı yok (lightweight).
  - TCKN/VKN write fail event'leri standart Prisma error path; ayrı telemetri gerekmez.
- **Verdict:** **Pass**
  - Mitigation: pepper rotation prosedürü Phase 2 dokümante edilecek (out of scope ama backlog'a not düşür)
  - Mitigation: phone backfill migration tek seferlik script (Phase 1 PR'da dahil)

---

## ④ Code Fit

- **File impact map:**
  - **BE:**
    - `prisma/schema.prisma` — Account + AccountContact yeni alanlar + indexler
    - `prisma/migrations/20260520XXXXXX_add_account_validation_fields/migration.sql`
    - `server/lib/validators.js` (yeni) — `validateVkn(s)`, `validateTckn(s)`, `normalizePhoneE164(s)`, `hashTckn(s, pepper)`, `maskTcknLast4(s)`
    - `server/db/accountRepository.js` — `shape()` + `create()` + `update()` TCKN/VKN/phone akışı; pepper-missing fail-safe; tcknMasked + phoneE164 response
    - `server/routes/accounts.js` — yeni response field'lar passthrough (zaten transparent)
    - `server/routes/lookups.js` — yeni `/validate-vkn`, `/validate-tckn` endpoint'leri (validate sadece input doğrulama; auth zorunlu ama scope gerekmez)
  - **FE:**
    - `src/services/accountService.ts` — `AccountListItem` / `AccountDetail` / `AccountCreateInput` / `AccountUpdateInput`'a `tcknMasked`, `phoneE164` alanları + `tckn` (sadece create input)
    - `src/features/accounts/AccountFormModal.tsx` — Individual seçildiğinde TCKN input açılır; inline `validate-tckn` debounced call
    - `src/features/accounts/AccountDetailPage.tsx` — tcknMasked badge gösterimi (varsa)
  - **Script:**
    - `scripts/seed-full-demo-scenarios.js` — Individual müşterilere synthetic tcknHash + tcknLast4 (gerçek TCKN üretmez; deterministic hash dummy)
    - `scripts/smoke-account-validation.js` (yeni, ~250 satır) — 4 section (validation, privacy, pepper-missing, uniqueness)
    - `scripts/smoke-data-contracts.js` — Account/Case Integrity grubuna yeni check: response'ta plain `tckn` field absence
    - `scripts/migrate-phone-to-e164.js` (yeni, opsiyonel one-shot) — mevcut Account.phone değerlerini phoneE164'a kopyalar

- **Reuse plan:**
  - `accountRepository.maskVkn` pattern → `maskTcknLast4` analog
  - `assertCustomerTypeFields` benzeri pattern → `assertTcknOnlyIfIndividual` validator
  - WR-H2 cache invalidation hook'ları (mutation → invalidateAccountAndCustomerContext)
  - WR-F7 privacy guard pattern → smoke "no plain tckn in response" assertion

- **No-touch list:**
  - `Account.vkn @unique` constraint
  - AccountCompany / AccountContact (phone hariç) / AccountProduct
  - Phase D customerMatchPending, Case modeli
  - Mevcut RBAC sabitleri

- **Implementation risk:**
  - **Pepper management:** Env değişkeni yok ise development'ta UX'i bozar — fail-safe net olmalı (TCKN write için 400, search için silently skip)
  - **Phone normalize edge case:** Türkiye dışı numaralar veya `0` prefix vs `+90` çakışması — basit regex Phase 1 yeterli; libphonenumber-js phase 2
  - **Test seed:** Synthetic TCKN gerçek 11 haneye benzemeli ama deterministic — sahte algoritma seed-only
  - **Migration:** `tcknHash @unique` migration sırasında mevcut Account'larda null olduğundan sorun yok

- **Likely test/smoke files:**
  - `scripts/smoke-account-validation.js` (yeni, ~30 assertion)
  - `scripts/smoke-data-contracts.js` extension (1-2 yeni check: plain tckn absence in API responses)
  - Reuse `scripts/smoke-account-customer-type.js` regression (TCKN ekledikten sonra A1 davranışı bozulmamalı)

---

## ⑤ QA Fit

- **Automated test plan:**

  **`smoke-account-validation.js` — 4 section:**

  | Section | Assertions | Detay |
  |---|---|---|
  | A. VKN validation | 6 | format 10-hane + checksum valid/invalid; create 400 on invalid; existing @unique still works |
  | B. TCKN HMAC + last4 | 8 | create Individual + TCKN → hash + last4 stored; plain TCKN never in DB; tcknHash uniqueness; response only `tcknMasked` |
  | C. Phone normalize | 6 | "+90 532 X", "0532 X", "532 X" → same phoneE164; index works for search; no DB unique |
  | D. Pepper-missing fail-safe | 4 | env yokken create-with-tckn → 400 "TCKN yapılandırılmamış"; search-without-pepper sessizce skip |
  | E. Validate endpoint | 6 | `/api/lookup/validate-vkn` + `/api/lookup/validate-tckn` happy/sad paths |

  Total ~30 assertion.

  **`smoke-data-contracts.js` extension:**
  - Yeni "Account Privacy Contract" grubu (3 check):
    - API response'larda plain `tckn` field **yok**
    - `Account` schema'da plain `tckn` column **yok** (sadece tcknHash, tcknLast4)
    - Tüm `tcknHash` değerleri 64-char hex (HMAC-SHA256 output)

- **Manual QA checklist:**
  - **Agent:** Account search → vkn/phone ile arama hâlâ çalışır; tcknHash search ileride
  - **Backoffice:** Account edit form → değişiklik yok
  - **Supervisor:** Account detail → tcknMasked görünür (varsa)
  - **Admin:** Yeni Bireysel hesap oluştur, TCKN gir → DB'de plain TCKN yok, tcknHash + tcknLast4 var, response'ta `tcknMasked`
  - **Admin:** Yeni Kurumsal hesap, VKN invalid (9 hane, checksum bozuk) → 400 inline toast
  - **Admin:** Phone field "+90 532 5551234" → DB phoneE164 "+905325551234"; başka Account aynı phone'u kullanabilir
  - **SystemAdmin:** Pepper env'i temizle, restart → TCKN write 400 fail; mevcut hesapların TCKN aramaları çalışmaz ama Account list normal

- **Seed readiness check:**
  - `npm run db:seed:full-demo` → Individual müşterilere synthetic tcknHash (deterministic dummy, real TCKN değil) + tcknLast4 "0000"
  - `npm run smoke:data-contracts` → AI Telemetry Contract + Account Privacy Contract PASS
  - `node scripts/smoke-account-validation.js` PASS

- **Backward compatibility checks:**
  - WR-A1 smoke (smoke-account-customer-type.js) hâlâ PASS — TCKN scope dışı (none), VKN flow korunur
  - WR-H1 case list pageSize cap korunur
  - WR-H2 cache invalidation Account mutation'larında çalışır (yeni alanlar invalidation tetikler)

- **Rollback/regression risks:**
  - Migration revert: 3 kolon drop + 2 index drop; veri kaybı sadece manuel girilen tcknHash/tcknLast4/phoneE164 değerleri
  - Pepper rotation: phase 2'de gelir; phase 1 sabit; rotation yapılırsa hash'ler invalid olur (kullanıcı re-entry gerekir)
  - Phone backfill script idempotent (E.164 normalize tekrar çalışırsa aynı sonuç)

- **Production smoke gereksinimi:** **Gerekli** — KVKK kapsamında critical PII path; production'da:
  - TCKN write/read roundtrip
  - Plain TCKN response leak yok
  - Pepper env doğru set edilmiş
  - Phone normalize edge case (TR mobile + landline)

---

## ⑥ Decisions — Yok

Decision Sprint'te (MASTER_DATA_DECISION_SPRINT.md) onaylandı:
- **§① TCKN:** HMAC + last4, env pepper, fail-safe ✓
- **§② Phone:** Normalize only, no unique ✓
- **§③ VKN:** Global @unique + checksum validation ✓

---

## ⑦ Ready / Not Ready

- **Durum:** **Ready**
- **Engelleyen:** Yok

---

## ⑧ Implementation Prompt

1. **Schema (prisma/schema.prisma):**
   ```prisma
   Account: + tcknHash String? @unique, + tcknLast4 String?, + phoneE164 String?
   @@index([phoneE164])
   AccountContact: + phoneE164 String?, @@index([phoneE164])
   ```
2. **Migration:** `prisma/migrations/20260520120000_add_account_validation_fields/migration.sql` — ALTER TABLE 4 ADD COLUMN + 3 CREATE INDEX (1 unique, 2 normal).
3. **server/lib/validators.js (yeni):**
   - `validateVkn(s)`: 10-hane regex + checksum (Türk VKN Luhn variant)
   - `validateTckn(s)`: 11-hane regex + Türk TCKN checksum (Verhoeff-benzeri, son hane = ilk 10 hanenin hesabı)
   - `normalizePhoneE164(s)`: TR-only basit pattern (0XXX, +90XXX, XXX → +90XXX)
   - `hashTckn(plain, pepper)`: HMAC-SHA256(plain, pepper) hex; pepper missing → throw
   - `maskTcknLast4(plain)`: `"*******1234"` format
4. **server/db/accountRepository.js:**
   - `shape()` response'a `tcknMasked` (last4'ten format'lı), `phoneE164` ekle; **plain tckn YOK**
   - `createAccount`/`updateAccount`:
     - Body'de `vkn` varsa → `validateVkn`, invalid 400
     - Body'de `tckn` varsa + customerType=Individual → `hashTckn` + `tcknLast4` set; plain bırakılır (bellekte) ama DB yazılmaz
     - Body'de `phone` varsa → `normalizePhoneE164` → `phoneE164` set
     - Pepper env yoksa → 400 "Sistem TCKN için yapılandırılmamış"
5. **server/routes/lookups.js:**
   - `router.get('/validate-vkn')` + `router.get('/validate-tckn')` — auth zorunlu, scope gerekmez
6. **src/services/accountService.ts:**
   - Type'lara `tcknMasked: string | null`, `phoneE164: string | null` ekle
   - `AccountCreateInput`/`AccountUpdateInput`'a `tckn?: string | null` (sadece input)
7. **src/features/accounts/AccountFormModal.tsx:**
   - Individual seçildiğinde TCKN input açılır; inline `validate-tckn` debounced (350ms)
   - VKN input'unda inline validate-vkn debounced
8. **scripts/seed-full-demo-scenarios.js:**
   - Individual hesaplara `tcknHash = hashTckn(deterministicDummy, pepper)`, `tcknLast4 = "0000"`; gerçek TCKN üretmez
9. **scripts/smoke-account-validation.js:** Yeni 30 assertion
10. **scripts/smoke-data-contracts.js:** Yeni "Account Privacy Contract" group (3 check)
11. **Migration script (opsiyonel):** `scripts/migrate-phone-to-e164.js` — mevcut Account.phone → phoneE164 normalize batch

**Branch:** `feat/account-validation` from updated `dev`. PR → `dev` → release `dev → main`.

---

## ⑨ Test Plan (özet)

- Otomatik: ~30 + 3 = 33 yeni assertion (smoke-account-validation + data-contracts)
- Manuel: 6 rol senaryosu (Agent search, Admin create + invalid VKN, Pepper missing)
- Backward compat: A1 smoke (smoke-account-customer-type) + H1 + H2 hâlâ PASS
- Production smoke: gerekli (KVKK critical)

---

## ⑩ Rollback Plan

- `git revert <merge-sha>` → kod geri döner
- Migration revert: `prisma migrate resolve --rolled-back ...` veya manual `ALTER TABLE` 3 kolon drop + 3 index drop
- TCKN data: phase 1'de sentetik dummy → kayıp yok
- Pepper env: silinirse mevcut hash'ler invalid; rotation tooling Phase 2
- Phone backfill script idempotent (re-run safe)

---

## ⑪ Register Updates Needed
- [ ] **Merge sonrası** WORK_REGISTER.md A2 Status: `Ready` → `Shipped` + commit hash
- [ ] A2 Next action: PR hash + smoke counts
- [ ] PRODUCT_PLANNING_MATRIX.md PM-01: scope tckn HMAC details refine (opsiyonel — capability adı aynı)

---

## ⑫ Git Flow / Topology Metadata

Detaylı kurallar: [AI_WORKFLOW.md → Git Flow Rules](../AI_WORKFLOW.md#git-flow-rules)

- **Current branch:** `feat/account-validation` (yeni açılacak, implementation aşamasında)
- **Intended PR base:** `dev`
- **Intended PR head:** `feat/account-validation`
- **Feature branch deleted after merge:** Yes (local + remote)
- **Topology check (pre-PR):**
  - `origin/main..origin/dev` boş mu? ✓
  - `origin/dev..origin/main` boş mu? ✓
  - (Şu an her ikisi `eb43655` — F7 son merge)
