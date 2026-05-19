# Agentic Planning Card — A3 Account Address (Country-agnostic)

- **Work Register ID:** A3
- **Product Planning Matrix ID:** PM-02 (Account Address — billing/shipping/visit/HQ/branch addresses for B2B/B2C master data)
- **Product capability:** Çoklu adres bilgisi (faturalama, merkez, şube, saha ziyaret, sevkiyat) — country-agnostic schema, TR default
- **Request source:** Backlog A3 (Decision Sprint follow-up; addresses surface in service routing, billing, future import/API mapping)
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-19
- **Protocol versiyonu:** 2.0

---

## ① Product Fit

- **Problem:** Account modelinde adres yok; `phone`/`email` Account'ta tutuluyor ama fiziksel adres bilgisi tutulmuyor. UNIVERA müşterileri için saha ziyaret adresi, FINROTA için faturalama adresi gibi senaryolar mevcut. AccountContact iletişim kişisidir — adresi taşımaz. Adres yokken: ileride import/API mapping yapılamıyor, saha personeli adres bilgisini Case description'da serbest metin olarak yazıyor (search/filter imkânsız).

- **Business fit:**
  - **B2B:** UNIVERA / FINROTA — sözleşme adresi, sevkiyat adresi, saha servis adresi farklı olabilir
  - **B2C:** Individual müşteri tek bir teslimat adresi
  - **Foundation:** A8 Import (Phase 2) Address tablosunu kullanır; ileride harita/route altyapısı buradan beslenir
  - **Country-agnostic:** Decision Sprint #2 — TR default ama uluslararası müşteri için friction-free; il/ilçe lookup TR-only enhancement olarak ayrı PR'a ertelenir

- **Affected roles:**
  - Agent / Backoffice: AccountDetailPage'de adres listesini görür (read-only)
  - Supervisor / CSM: read-only
  - Admin / SystemAdmin: CRUD (add/edit/deactivate)

- **Acceptance criteria:**
  1. `Address` entity `accountId` FK ile Account'a bağlı (parent-child Cascade)
  2. `companyId` denormalized — tenant scope için (`Case` pattern'i: index'li filter)
  3. Type enum: Billing, Shipping, Visit, Headquarters, Branch
  4. `country` ISO-2 string default `TR`; format validation `^[A-Z]{2}$` (app-layer, lookup yok)
  5. `line1` zorunlu; `line2`, `district`, `city`, `state`, `postalCode` opsiyonel (country-agnostic)
  6. `label` opsiyonel (örn. "İstanbul merkez ofis", "Adana şube")
  7. `isDefault` flag — aynı (accountId, companyId, type) için tek aktif default; transaction-level enforcement (DB unique YOK — soft delete olduğunda flicker olur, app-layer atomic clear)
  8. `isActive` soft-delete flag; cascade DELETE Account silindiğinde
  9. CRUD endpoints: list (read roles), add/edit/remove (Admin+)
  10. Tenant scope: `account in allowedCompanyIds` + `address.companyId` belirli bir AccountCompany.companyId'yle eşleşmeli
  11. UI: AccountDetailPage'de "Adresler" section + AccountAddressEditor modal
  12. Seed: UNIVERA + PARAM + FINROTA major hesaplarda 1-2 adres; TR + en az 2 non-TR ülke örneği
  13. Smoke 14 senaryo + data-contracts extension

- **Out-of-scope:**
  - TR il/ilçe lookup (ayrı enhancement PR — adres alanlarında dropdown)
  - Posta kodu format validation per country
  - Harita preview (lat/lng entegrasyonu Phase 2)
  - Import (A8'de Address ayrı phase)
  - Account create modal'ına address satırı (Account detail'da CRUD; create flow basit kalır)

- **Decisions:** `city` nullable — country-agnostic için (P.O. boxes, kırsal adresler, yapısız adres formatları olan ülkeler için flexible kalmalı). TR için UI tarafında hint "Şehir önerilir" gösterilir ama validation yok.

---

## ② Critical Files

**Schema/migration:**
- `prisma/schema.prisma` — `enum AddressType` + `model Address`; `Account` modeline `addresses Address[]` relation
- `prisma/migrations/20260520120000_add_account_addresses/migration.sql` — enum + tablo + indexes

**BFF:**
- `server/db/accountRepository.js` — `loadEditableAddress`, `addAddress`, `updateAddress`, `removeAddress` + `getAccount` response shape'inde `addresses` array
- `server/routes/accounts.js` — `GET/POST/PATCH/DELETE /:id/addresses[/:addressId]`
- (Address-only; case routes etkilenmez)

**Frontend:**
- `src/services/accountService.ts` — `AddressType`, `ADDRESS_TYPE_LABELS`, `AccountAddressSummary`, `AccountAddressMutationInput`, `AccountDetail.addresses`, `addAddress`/`updateAddress`/`removeAddress` methods
- `src/features/accounts/AccountAddressEditor.tsx` — yeni modal (Mevcut `AccountContactEditor` pattern'i)
- `src/features/accounts/AccountDetailPage.tsx` — `AddressesSection` + modal wire-up

**Seed/smoke:**
- `scripts/seed-full-demo-scenarios.js` — yeni step (3.6) `Address` seed
- `scripts/smoke-account-addresses.js` — yeni (14 senaryo)
- `scripts/smoke-data-contracts.js` — yeni "Account Address Contract" group

---

## ③ Performance & Architecture Gate

Implementation öncesi enforced. Each item explicitly addressed; verdict at the end.

| # | Concern | Address |
|---|---|---|
| 1 | **Indexed FK + scope index** | `@@index([accountId])`, `@@index([companyId])`, `@@index([accountId, type])`, `@@index([accountId, isDefault])` — query patterns: list by account, filter by tenant, filter by type, find default. |
| 2 | **No relation-heavy `include` in hot paths** | `getAccount` response `addresses` zaten select edilmiş (scalar columns only); list/search query'lerinde Account list view'a address eklenmez (out-of-scope; sadece detail'da). |
| 3 | **N+1 guard** | AccountDetailPage tek getAccount call ile addresses array'i alır; her render'da fetch yok (TTL cache zaten WR-H2'de var). |
| 4 | **Unbounded list cap** | Address list per-account; bir account'ta maksimum address sayısı pratikte düşük (10-20). UI list zaten account-scoped, global list endpoint yok → cap gereksiz. |
| 5 | **`count()` vs `findMany().length`** | Bu PR'da count kullanan yer yok; data-contracts smoke'da `prisma.address.count()` yazılır. |
| 6 | **Large query guard** | List endpoint per-account; cross-account query yok. Account-only sınır zaten yapısal. |
| 7 | **Mutation atomicity** | `isDefault` clearing transaction-içi: yeni adres `isDefault=true` ile yaratılırsa aynı (accountId, companyId, type) için diğer aktif default'lar `updateMany` ile `isDefault=false` yapılır — single Prisma transaction. |
| 8 | **UI loading state** | AccountAddressEditor mevcut `AccountContactEditor` ile aynı disabled-buton + spinner pattern'ini kullanır; full-screen blocker yok. |
| 9 | **Lazy load** | Adres detay/edit modal lazy değil (modal zaten ihtiyaç anında open olur); section page render'ını bloklamaz. |
| 10 | **Connection pool** | Yeni endpoint sayısı 4 (list/add/edit/delete); her biri tek transaction max 2 query. Supabase pooler limitleri için risk yok. |

**Verdict: PASS.** Address modeli Account-child pattern'inin (AccountContact) bir uzantısı; performans karakteri öngörülebilir.

---

## ④ Decisions Log

- **D-A3.1:** Address `accountId`-scoped, `companyId` denormalized — AccountCompany-scoped DEĞİL. (AccountProject AccountCompany-scoped olduğu için bilinçli farklılaştırma: müşterinin adresi tenant'tan bağımsız temel bir kayıt; tenant başına farklı adres ileride `addressTypeAlias` ile çözülebilir.)
- **D-A3.2:** `city` nullable — country-agnostic. UI'da hint var ama validation yok.
- **D-A3.3:** `country` ISO-2 string `@default("TR")`; lookup tablosu yok (basit `^[A-Z]{2}$` regex).
- **D-A3.4:** `isDefault` DB unique YOK — app-layer atomic clear (soft-delete + re-create race window'unu izole etmek için). Smoke "default behavior" senaryosu bu invariant'ı test eder.
- **D-A3.5:** Account create modal'ına address satırı eklenmez. CRUD sadece Account detail'da yaşar — base modal complexity'sini artırmaz.

---

## ⑤ Test Plan (özet)

14 ana senaryo:
1. Admin creates Billing address with country=TR → 201
2. Admin creates HQ address with country=DE → 201
3. Admin edits address (label + line1) → 200
4. Admin soft-deletes address → 200, isActive=false in DB
5. List addresses (Supervisor) → 200, only active by default
6. Agent attempts POST → 403
7. Backoffice attempts PATCH → 403
8. Cross-tenant: account A (UNIVERA), admin scoped to PARAM only → 404
9. country="tr" lowercase → 400 (uppercase required)
10. country="USA" (3 char) → 400
11. country missing → defaults to "TR"
12. line1 empty → 400
13. isDefault=true → previous default for same (account, company, type) cleared in same transaction
14. Account detail response includes `addresses[]` array; no leakage of addresses from other accounts

**Data contracts (5 extra):**
- DA.1 Address table has accountId column + companyId column
- DA.2 No Address row with NULL accountId
- DA.3 No Address row with country length != 2
- DA.4 No Address row where companyId not in account's AccountCompany.companyId set
- DA.5 Default address uniqueness: at most one isActive=true + isDefault=true per (accountId, companyId, type)

---

## ⑥ Rollback Plan

`git revert <merge-sha>` + `prisma migrate resolve --rolled-back 20260520120000_add_account_addresses`. Manuel girilen address verisi kayıp. Account modelindeki `addresses` relation drops (orphan FK olmaz çünkü ON DELETE CASCADE).

---

## ⑦ Register Updates

- [ ] Merge sonrası WR-A3 Status: `Ready` → `Shipped` + commit hash + PR ref.
- [ ] Status tally: Shipped count `9 → 10`; Ready `13 → 12`.

---

## ⑧ Git Flow / Topology Metadata

- **Current branch:** `feat/account-addresses` (base `dev`)
- **Intended PR base:** `dev`
- **Intended PR head:** `feat/account-addresses`
- **Topology pre-PR:** `origin/main..origin/dev` empty ✓ · `origin/dev..origin/main` empty ✓ (her ikisi `8b866bc`)
- **Branch deletion after merge:** Yes (local + remote)
- **Path detection:** Post-merge re-fetch + path A/B per [AI_WORKFLOW.md → Git Flow Rules](../AI_WORKFLOW.md#git-flow-rules)
