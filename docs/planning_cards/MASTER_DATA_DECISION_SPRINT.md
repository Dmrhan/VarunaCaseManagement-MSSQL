# Master Data Decision Sprint — Agentic Planning Pack

> **Amaç:** A2 / A4 / A5 / A7 / A8 / B1 / B2 implementation'larını kilitleyen 8 ürün-model kararını tek pakette analiz et ve onay için sun. Hiçbir kod/şema/migration değişikliği yok — bu doküman sadece kararı yapılandırır.
>
> **Karar sahibi:** Ürün direktörü (connect@univera.com.tr)
> **Tarih:** 2026-05-19
> **Protocol:** AGENTIC_PLANNING_PROTOCOL.md v2.0
> **Statü:** Karar bekliyor — bu doküman bağlayıcı değildir, sen seçimini yapınca implementation Card'larına dökülür.
>
> **Tek satırlık ilke:** *Opinionated ama irreversible varsayım yapmıyoruz; her kararda en az iki seçenek + neden seçildiği var.*

---

## ⓪ Kapsam ve Mevcut Durum Özeti

A1 (customerType) Shipped. A1'in **bilinçli olarak dışarıda bıraktığı** TCKN + format validation + phone normalize + tüm büyük data-model genişlemeleri (Project, Address, Package, Import vb.) bu sprint'in kararlarına bağlı.

**Schema bugün:**
- `Account`: id/name/vkn? (`@unique`)/companyId?/email?/phone?/isActive/**customerType** (NEW)/legalName?/registrationNo?
- `AccountCompany`: per-tenant 5-tuple (accountId+companyId unique, externalCustomerCode 5-digit, packageName **free string**, contractStart/End, segment, status, notes)
- `AccountContact`: per-account (accountId, fullName, title?, email?, phone?, isPrimary, preferredChannel?)
- `AccountProduct`: AccountCompany-scoped (productName, productCode? unique-per-AC, isActive)
- `Team`: companyId-scoped, members: Person[] (1:N)
- `Person`: id/name/email?/teamId? (nullable single FK)

**Bilinen tenant gerçekleri:**
- **PARAM** — ödeme/POS fintech; B2B ağırlıklı; bireysel ödeme müşterileri mevcut
- **UNIVERA** — dağıtım/saha servis; proje-bazlı destek (FMCG/Soğuk Zincir/Tütün vb. müşterilerin her biri Rota/e-Fatura/Saha Veri gibi paralel projeler yürütüyor)
- **FINROTA** — açık bankacılık; sigorta + bireysel banka entegrasyonları

---

## ① TCKN Storage Strategy (WR-A2)

### Mevcut Durum
- `tckn` kolonu **yok**; A1 PR review'inde bilinçli olarak dışarıda bırakıldı (Modeling Guardrail #1).
- Bireysel müşterilerin (B2C) kimliklendirilmesi için tek yol VKN/telefon/email.

### Seçenekler

| Seçenek | Açıklama | Search | Uniqueness | KVKK Risk | Implementation |
|---|---|---|---|---|---|
| **A** Saklama yok | TCKN hiç tutulmaz; yalnız doğrulama anında alınır, atılır | ❌ | ❌ | 🟢 düşük | trivial |
| **B** Plain encrypted (at-rest) | Kolon encrypt — Postgres pgcrypto veya app-level | ✅ tam | ✅ tam | 🟡 anahtar yönetimi riski | orta — KMS/secret rotation gerekli |
| **C** HMAC hash + last4 | Search/dedupe için deterministic hash (`HMAC-SHA256(TCKN, pepper)`); UI'da maskeli son 4 hane | ✅ exact match | ✅ tam | 🟢 plain TCKN yok | düşük-orta |
| **D** Masked only (last4) | Sadece `*******1234` göster, hash yok | ❌ search yok | ❌ uniqueness yok | 🟢 | trivial |

### Pros / Cons

- **A (no-store):** En basit + KVKK-safest, ama Bireysel müşteri uniqueness sağlanamaz (aynı kişi iki kez kayıt). Frontline'da "TCKN ile müşteri ara" özelliği imkânsız.
- **B (encrypted plain):** Tam fonksiyonel ama operasyonel maliyet yüksek — KMS key rotation, backup encryption, audit log eklemesi şart.
- **C (HMAC + last4):** **En dengeli.** Search edebiliyoruz (`WHERE tcknHash = HMAC(input, pepper)`), uniqueness sağlanabiliyor (`tcknHash @unique`), display'de last4 yeterli. Plain TCKN hiç DB'ye yazılmaz. Pepper rotation gerekirse rehash batch (offline) operasyonu plan'a alınır.
- **D (masked):** Compliance açısından safest ama operasyonel olarak A'dan farkı yok — uniqueness/search yok.

### Önerilen Karar

**Seçenek C — HMAC hash + last 4 hane.**

```prisma
model Account {
  // mevcut
  tcknHash   String?  @unique          // HMAC-SHA256(TCKN, pepper) — 64 char hex
  tcknLast4  String?                   // UI'da maskeli display için son 4 hane
  // pepper env'de: TCKN_HMAC_PEPPER (rotated annually with rehash batch)
}
```

**Operasyonel kurallar:**
- POST/PATCH endpoint plain TCKN alır (HTTPS), HMAC hesaplar, sadece hash + last4 yazar; plain'i bellekte tutmaz.
- `WHERE tcknHash = …` ile search; uniqueness `@unique` ile.
- Audit: TCKN read/write tüm endpoint'ler `AccessAudit` tablosuna log (DPO için).
- Pepper rotation: yıllık; rehash batch script (`scripts/rehash-tckn.js`) offline çalışır.

### Tenant Fit
- **PARAM:** Bireysel ödeme müşterileri için duplicate önleme + search → C şart.
- **UNIVERA:** Bireysel müşteri azınlık (B2B ağırlık); C aşırı yatırım gibi ama infrastructure tek seferlik.
- **FINROTA:** Sigorta bireysel müşterileri + open banking individual → C şart.

### Impacted
- **WR:** A2 (Status: Needs Decision → Ready), A8 (import semantics TCKN nasıl alacak), C5 (duplicate detection), C8 (info request flow — public form'da TCKN doğrulama)
- **PM:** PM-01 (kapsam genişler), PM-06 (import validation), PM-09 (duplicate)

### Implementation Order Impact
A2 phase'inde aynı PR'da TCKN + VKN + phone validation paketlenir. Pepper env değişkeni production öncesi set edilir.

### Open Questions (decision needed)
- Pepper kim üretip yönetir? (System admin, KMS, .env)
- Audit tablosu yeni mi yoksa mevcut AIUsageLog pattern'i mi taklit eder?

---

## ② Phone Uniqueness Scope (WR-A2)

### Mevcut Durum
- `Account.phone String?` — **uniqueness yok**, **format normalize yok**.
- `AccountContact.phone String?` — aynı.
- Demo data'da telefon `+90 5XX ...` formatında ama varyasyon var.

### Seçenekler

| Seçenek | Davranış | False Positive Riski | Operasyonel |
|---|---|---|---|
| **A** No unique, normalize only | E.164 normalize (`phoneE164` ayrı kolon); duplicate kabul | 🟢 yok | en esnek |
| **B** Unique per Account | Aynı Account'a iki kez aynı telefon yazılamaz | 🟢 | basit guard |
| **C** Unique per Company | `(companyId, phoneE164)` unique | 🟡 paylaşılan callcenter → false positive | orta |
| **D** Unique globally | `phoneE164 @unique` | 🔴 santral/firma genel numarası iki müşteride → conflict | sert |

### Pros / Cons

- **A:** Şirket santral numarası 50 müşteride aynı olabilir; A en güvenli ama duplicate prevention sıfır.
- **B:** İki ayrı Account aynı telefonu kullanabilir (ortak danışman); Account içinde tekrar engellenir. Frontline güçlüğü düşük.
- **C:** Aynı şirket tenant'ında iki müşteri aynı numarayı kullanamaz — gerçek dışı (PARAM'da çağrı merkezi numarası onlarca müşteri formunda görünür).
- **D:** Açıkça yanlış model; her telefon-numarası tek müşteriye bağlıyor.

### Önerilen Karar

**Seçenek A — normalize only, no DB unique constraint.**

```prisma
model Account {
  phone     String?   // legacy display
  phoneE164 String?   // normalized: +905XXXXXXXXX
  @@index([phoneE164])  // search için, unique değil
}
```

**Operasyonel kurallar:**
- Tüm yazımlarda E.164 normalize (libphonenumber-js veya basit regex `+90 5XX XXX XXXX`).
- Search `WHERE phoneE164 = …` — index ile O(log n).
- Duplicate detection (C5) **fuzzy katmana** taşınır: birden çok Account aynı `phoneE164` ile listeleyebilir, Supervisor review eder.

### Tenant Fit
- **PARAM:** Çağrı merkezi numarası ortak; D/C imkânsız.
- **UNIVERA:** Saha ekibinin paylaşılan numarası var; A doğru.
- **FINROTA:** Sigorta acentaları aynı telefonu kullanıyor; A doğru.

### Impacted
- **WR:** A2 (phone normalize part), C2 (search refactor — phone'a göre arama), C5 (duplicate review fuzzy match), C6 (account merge)
- **PM:** PM-01, PM-08, PM-09

### Open Questions
- Tek user phone vs çoklu phone? Şu an Account.phone tek; AccountContact.phone ayrı liste. Tek seviyede kalsın (yeterli).
- Search input'unda `0532 ...` da çalışsın mı? — Evet, normalize edilince input form ne olursa olsun aynı output.

---

## ③ VKN Validation + Uniqueness (WR-A2)

### Mevcut Durum
- `Account.vkn String? @unique` — **global unique** (zaten kararlı).
- Format check yok; A1 sonrası 10 haneli ama runtime kontrolü yok.

### Seçenekler

| Konu | Seçenek | Karar |
|---|---|---|
| Format | App-layer regex `/^\d{10}$/` + checksum | ✅ |
| Checksum algoritması | Türk VKN checksum (Luhn variant) | ✅ |
| Uniqueness scope | (a) Global `@unique` (mevcut) (b) Per-company | (a) **Global koru** |
| B2B duplicate | Aynı VKN aynı global Account'a düşer (mevcut model) | ✅ |

### Pros / Cons (uniqueness)

- **Global @unique (mevcut):** Bir VKN tek Account → multi-tenant'ta (`AccountCompany`) o Account çok şirketle paralel ilişki kurabilir. Bu doğru model — bir kurumun TC tarihi tektir.
- **Per-company unique:** Aynı VKN'i iki şirketin ayrı Account'larında tutmak mümkün olur ama bu **müşteri verisini parçalar** — Account 360 anlamsız hale gelir.

### Önerilen Karar

**Mevcut global `@unique` korunur; format + checksum validation app-layer'da eklenir.**

```js
// server/lib/validators.js
export function validateVkn(vkn) {
  if (!/^\d{10}$/.test(vkn)) return 'VKN 10 haneli rakam olmalı.';
  if (!vknChecksumValid(vkn)) return 'VKN doğrulanamadı (checksum hatalı).';
  return null;
}
```

- Endpoint: `POST /api/lookup/validate-vkn?value=…` → sync feedback (UX inline).
- Backend her create/update'te re-validate (UI bypass'a güven yok).

### Tenant Fit
Üç tenant'ta da kurumsal müşteri formatları aynı → tek doğrulama tüm tenantlarda çalışır.

### Impacted
- **WR:** A2; opsiyonel olarak C5 (duplicate review benzer VKN'leri flag'leyebilir — Levenshtein 1-2)
- **PM:** PM-01

### Open Questions
- VKN üçüncü taraf gerçek doğrulama servisine entegre edilsin mi (Gelir İdaresi)? — Out of scope; checksum yeterli.

---

## ④ AccountProject Required / Optional Model (WR-A4)

### Mevcut Durum
- Schema'da `Project` veya `AccountProject` **yok**.
- UNIVERA müşterileri çoklu projeli (FMCG dağıtıcısının "Rota Opt", "e-Fatura", "Saha Veri" projeleri paralel yürür); şu an vakalar account'a doğrudan bağlı, proje görünmüyor.
- Modeling Guardrail #2: Project AccountCompany-scoped (`Account → AccountCompany → AccountProject → Case`).

### Karar Noktaları

1. **Hangi seviyeye bağlanır?** AccountCompany ✅ (zaten Guardrail #2 ile kilitli — tekrar onay).
2. **Tenant başına opt-in mi?** Evet — `Company.projectsEnabled` flag.
3. **Bazı tenantlarda zorunlu mu?** `Company.projectsRequired` flag — UNIVERA için TRUE.
4. **Case.accountProjectId nullable mi?** Evet — `projectsRequired=false` tenantlarda her zaman NULL; `projectsRequired=true` için POST/PATCH'te app-layer validation.

### Önerilen Karar — Phased Model

**Phase 1 (A4 implementation PR):**

```prisma
model Company {
  // mevcut
  projectsEnabled  Boolean @default(false)   // bu tenant için Project modülü açık mı?
  projectsRequired Boolean @default(false)   // case oluştururken projectId zorunlu mu?
}

enum ProjectStatus { Planning Active OnHold Completed Cancelled }

model AccountProject {
  id               String        @id @default(cuid())
  accountCompanyId String                                            // ← AccountCompany'ye bağlı (Guardrail #2)
  code             String                                            // "ROTA-2026"
  name             String
  status           ProjectStatus @default(Active)
  startDate        DateTime?
  endDate          DateTime?
  description      String?
  isActive         Boolean       @default(true)
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  accountCompany   AccountCompany @relation(fields: [accountCompanyId], references: [id], onDelete: Cascade)
  cases            Case[]
  @@unique([accountCompanyId, code])
  @@index([accountCompanyId, status])
}

model Case {
  // mevcut
  accountProjectId String?
  accountProject   AccountProject? @relation(fields: [accountProjectId], references: [id])
  @@index([accountProjectId])
}
```

**App-layer kuralları:**
- `projectsEnabled=false` tenant'ta UI'da Project menüsü görünmez.
- `projectsRequired=true` tenant'ta Case create form'unda Project combobox **zorunlu**; backend POST `/api/cases` `projectId` boşsa 400.
- Backfill seed: PARAM/FINROTA tenant'ları `projectsEnabled=false`; UNIVERA `projectsEnabled=true, projectsRequired=false` (önce opt-in, kullanım netleşince required'a alınır).

### Tenant Fit
- **UNIVERA:** Birinci sınıf vatandaş — phase 2'de `projectsRequired=true` (admin onayı sonrası flag flip).
- **PARAM:** Default kapalı; gelecekte "yıllık SLA paketi" projeleri için opt-in olabilir.
- **FINROTA:** Default kapalı.

### Impacted
- **WR:** A4 (Status: Needs Decision → Ready), A7 (Package + Project ilişkisi opsiyonel — `Package.projectId?` ileride eklenebilir), C2/C3 (case create form'unda Project alanı; conditional)
- **PM:** PM-04

### Implementation Order Impact
A4 phase'i iki PR'a bölünebilir:
- **A4a** — schema + admin Project CRUD (`projectsEnabled=true` tenantlar için)
- **A4b** — Case.accountProjectId + Case form + list filter

### Open Questions
- `Project.code` Univera'nın mevcut müşteri kodu (`AccountCompany.externalCustomerCode`) ile çakışır mı? **Hayır** — kod farklı entity (Account != Project). Project code free text + tenant-içi unique yeterli.

---

## ⑤ L1/L2 Support Level Scope (WR-A5)

### Mevcut Durum
- `EscalationLevel` enum var (Yok/TakımLideri/Direktör/ÜstYönetim) — **case durumu**, support tier değil.
- Team/Person/Case'de `supportLevel` yok.
- SLA matching 5-tuple (company+productGroup+category+subCategory+requestType) tier'sız.

### Seçenekler — Hangi entity'lerde olmalı?

| Entity | Önerilen | Neden? |
|---|---|---|
| **Case.supportLevel** | ✅ Phase 1 | Direkt routing + SLA + reporting karşılığı |
| **Team.defaultLevel** | ✅ Phase 1 | Team'in "L1 frontline" vs "L2 expert" kimliği |
| **Person.supportLevel** | ✅ Phase 1 | Skill-based assignment için future-proof |
| **Product.defaultSupportLevel** | 🟡 Phase 2 (A6 sonrası) | Product entity zaten A6 bağımlısı; phase ayır |
| **AccountProject.defaultSupportLevel** | 🟡 Phase 3 (A4 + A5 olgunluk sonrası) | Proje SLA matrisi gerçek müşteri ihtiyacında devreye gir |

### Önerilen Karar — Phased

**Phase 1 (A5 implementation PR — A4 ile paralel veya sonra):**

```prisma
enum SupportLevel { L1 L2 L3 Expert }

model Person { /* mevcut */ supportLevel SupportLevel @default(L1) }
model Team   { /* mevcut */ defaultLevel SupportLevel @default(L1) }
model Case   { /* mevcut */ supportLevel SupportLevel @default(L1) }
```

**App-layer kuralları:**
- Case create default: assigned team'in `defaultLevel`'i kopyalanır.
- SLAPolicy matching genişler: opsiyonel `supportLevel` 6. tuple elementi (backward compat: NULL → matches all).
- Reporting: KPI'larda L1/L2 breakdown (case count, SLA compliance %).

**Phase 2 (A6 sonrası):** `Product.defaultSupportLevel` eklenir; case create'te account'un mevcut ürünü → ürünün default tier'ı → case.supportLevel.

**Phase 3 (A4 + A5 stabil sonrası):** `AccountProject.defaultSupportLevel` — UNIVERA proje portföyünde değerli.

### Tenant Fit
- **PARAM:** L1/L2 ayrımı mevcut destek operasyonunda var (frontline vs technical); doğrudan eşleşir.
- **UNIVERA:** Saha L1, ofis L2 — opsiyonel.
- **FINROTA:** Açık bankacılık → L1 müşteri destek, L2 entegrasyon ekibi.

### Impacted
- **WR:** A5 (Status: Needs Decision → Ready Phase 1), B1 (team lead modeli L1/L2 ile uyumlu), C1 (claim — tier filter ileride)
- **PM:** PM-03

### Open Questions
- L3 ve Expert ihtiyacı gerçek mi? **Şu an evet** — enum'a koymak risksiz, kullanım sonradan.

---

## ⑥ Package Model (WR-A7)

### Mevcut Durum
- `AccountCompany.packageName String?` — **free text** (örn. "Premium", "Pro", "Standart").
- Demo data string'leri varyasyonlu (büyük/küçük harf, accent farkları).
- Sözleşme raporlamasında bu string string-match yapıyor → drift kaynağı.

### Seçenekler

| Seçenek | Açıklama | Migration | Raporlama |
|---|---|---|---|
| **A** Free text kalsın | Mevcut korunur, sadece normalize cron | trivial | 🔴 drift devam |
| **B** Package catalog | `Package` + `PackageItem` tabloları; AccountCompany.packageId FK | orta — migration + reconcile | 🟢 normalize |
| **C** Hybrid | `packageName` korunur (legacy) + yeni `packageId?` FK; admin'de katalog yönetimi; reconcile süreci uzun | en az risk | 🟢 phased |

### Pros / Cons

- **A:** En kolay ama PM-05 değerini sağlamaz; data drift sorunu yarın daha büyük olur.
- **B:** Doğru hedef ama tek seferde migration zor — mevcut 100+ farklı packageName string'i product/admin reconcile gerekir.
- **C:** **En ergonomik.** Yeni Account'lar `packageId` ile bağlanır; eski `packageName`'lar admin-driven reconcile cron ile zamanla normalize edilir. Backward compat tam.

### Önerilen Karar

**Seçenek C — Hybrid.**

```prisma
model Package {
  id          String   @id @default(cuid())
  companyId   String
  code        String   // "PREMIUM-2026"
  name        String
  description String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([companyId, code])
  items       PackageItem[]
  accountCompanies AccountCompany[]
}

model PackageItem {
  packageId  String
  productId  String                   // → A6'da gelecek Product entity
  @@id([packageId, productId])
}

model AccountCompany {
  // mevcut packageName String?  ← legacy, deprecated comment ile korunur
  packageId String?                   // YENİ — Package FK
  package   Package? @relation(fields: [packageId], references: [id])
}
```

**Reconcile path:**
- Admin'de `/admin/packages` CRUD eklenir.
- Reconcile UI: `packageName` string'lerini Supervisor mevcut Package kataloğundaki kayıtlara map'ler; map'lemediği string'ler `packageName` field'ında string olarak kalır.
- `PackageItem` (Package ↔ Product) A6 (Product catalog) shipped olduktan sonra anlam kazanır; o zamana kadar boş tutulabilir.

### Tenant Fit
- **UNIVERA:** Paket = "Rota+e-Fatura bundle", "Saha Servis paketi" — gerçek katalog ihtiyacı net.
- **PARAM:** Sözleşme paketi (Sanal POS Premium) — katalog değerli.
- **FINROTA:** "Open Banking Pro" gibi standart paketler.

### Impacted
- **WR:** A7 (Status: Needs Decision → Ready Phase 1), A6 (Package ↔ Product ilişkisi A6'nın Product katalogundan beslenir)
- **PM:** PM-05

### Implementation Order Impact
A7 phase'i A6 (Product catalog) **sonrası** yapılır; A6 Product entity'sini açar, A7 Package onun üstüne PackageItem ekler.

### Open Questions
- Mevcut packageName string'leri reconcile UI'da batch toplu eşle özelliği gerekli mi? **Evet, ileride.** İlk PR'da manuel item-by-item yeterli.

---

## ⑦ Team Lead / TeamMembership Model (WR-B1 / WR-B2)

### Mevcut Durum
- `Person.teamId String?` — **tek FK** (1 person → 0 veya 1 team).
- Team lead alanı **yok**.
- Supervisor scope = Person.teamId üzerinden tek takım.

### Seçenekler

| Seçenek | Şema | Multi-team | Multi-lead | Karmaşıklık |
|---|---|---|---|---|
| **A** Person.isTeamLead | Person'a flag | ❌ tek takım | ✅ aynı takımda çoklu lead | 🟢 minimal |
| **B** Team.leadPersonId | Team'e FK | ❌ tek takım | ❌ tek lead | 🟢 minimal |
| **C** PersonTeam table + role | `PersonTeam(personId, teamId, role)` join | ✅ çok takım | ✅ çoklu lead | 🟡 orta |

### Pros / Cons

- **A:** En basit; mevcut `Person.teamId` ile uyumlu. "Aynı takımda iki lead" mümkün (önemli senaryo: shift değişiminde co-lead).
- **B:** "Team'in bir lead'i" semantiği güçlü ama çoklu lead/co-lead modelleyemiyor.
- **C:** Tam esnek ama mevcut Person.teamId backward compat'ını bozar; supervisor scope sorgu kompleksleşir; AD/Emakin sync (B4) bunu zorunlu kılabilir ama bugün gerek yok.

### Önerilen Karar — Phased

**Phase 1 (B1 implementation PR):**

```prisma
model Person {
  // mevcut + ↓
  isTeamLead   Boolean @default(false)
  supportLevel SupportLevel @default(L1)   // A5 ile birlikte
}
model Team {
  // mevcut + ↓
  defaultLevel SupportLevel @default(L1)
}
```

**App-layer:**
- Admin Team detail'inde members listesinde "Lead" toggle.
- Supervisor stats endpoint: Person.teamId tek takım scope korunur (mevcut davranış).
- Future B2: AD/Emakin sync veya gerçek multi-team senaryosunda C'ye geçiş; o zaman `PersonTeam` join eklenir, `Person.teamId` "default team" denormalize olarak kalır.

**Phase 2 (B2 sonrası, ihtiyaç doğunca):**
- `PersonTeam` join table → tek kişi N takımda + her takımda farklı rol.
- Mevcut Person.teamId fallback değer olarak kalır.

### Tenant Fit
- **PARAM:** Tek takım üyeliği yeterli; lead semantiği değerli.
- **UNIVERA:** Saha + Office cross-team membership gelecekte ihtiyaç olabilir — phase 2'ye bırak.
- **FINROTA:** Tek takım yeterli.

### Impacted
- **WR:** B1 (Status: Needs Decision → Ready Phase 1), B2 (Phase 2'ye ertelenmiş), B3 (Supervisor scope korunur)
- **PM:** PM-03

### Open Questions
- AD/Emakin (B4) entegrasyonunda sync formatı gerçekten multi-team mi? — Bu henüz bilinmiyor; B4 kararı geldiğinde tekrar değerlendir.

---

## ⑧ Import Semantics (WR-A8)

### Mevcut Durum
- Toplu import altyapısı **yok**.
- Manuel form ile tek tek yaratım.

### Karar Noktaları

| Entity | Matching Key (idempotency) | Semantik | Validation Preview | Rollback |
|---|---|---|---|---|
| **Account** | `vkn` (varsa) > `tcknHash` (varsa, A2 sonrası) > `(name + email)` fuzzy | Create + Update | ✅ row-by-row | audit log + soft-delete |
| **Contact** | `(accountId, email)` veya `(accountId, phoneE164)` | Create + Update | ✅ | audit log |
| **Address** | `(accountId, type)` for default; çoklu adres için match key zor → create only | Create only (v1) | ✅ | audit log |
| **Project** | `(accountCompanyId, code)` | Create + Update | ✅ | audit log |
| **Product** (A6) | `(companyId, code)` | Create + Update | ✅ | audit log |

### Önerilen Karar — Phased

**Phase 1 (A8a — Account import only):**
- ImportJob + ImportRow tabloları
- 4-adım ImportWizard (yükle → sütun eşle → preview → commit)
- Account entity'si için: `vkn` match key
- Validation: VKN format + duplicate (existing global @unique)
- Semantik: **create + update** (vkn varsa update, yoksa create)
- Skip duplicates checkbox UX'i
- Audit: ImportJob.id ile her ImportRow'un targetId'si bağlanır (rollback için)

**Phase 2 (A8b):** Contact + Address — Account import sonrası
**Phase 3 (A8c):** Project + Product (A6 ve A4 shipped olduktan sonra)

### Pros / Cons (semantik)

- **Create only:** Safest ama practical değil — günde yeni hesap ekleniyor, mevcudu update etmek istiyoruz.
- **Create + Update:** Standart ETL pattern; idempotent match key ile güvenli.
- **Create + Update + Delete (full sync):** Tehlikeli — yanlış dosya tüm DB siler. Out of scope.

### Tenant Fit
- **UNIVERA:** Çeyreklik 150 hesap göçü ana use case → Phase 1 yeterli.
- **PARAM:** İçeride yarı manuel akış var; Phase 1 yeterli.
- **FINROTA:** Sigorta + bireysel müşteri sync; Phase 2 (Contact) öncelikli.

### Impacted
- **WR:** A8 (Status: Needs Decision → Ready Phase 1), C5 (duplicate detection — import sonrası tetiklenebilir)
- **PM:** PM-06

### Open Questions
- File format ilk versiyonda CSV mi XLSX mi? — **CSV first**; XLSX (sheetjs) Phase 2.
- API import (programmatic) v1'de olsun mu? — **Hayır**, sadece dashboard upload.
- Public form / partner self-service? — Çok daha sonra (out of scope).

---

# Recommended Decisions — Summary Table

| # | Karar | Önerilen Seçenek | WR Status After | Tenant Driver |
|---|---|---|---|---|
| 1 | TCKN storage | **C — HMAC hash + last4** | A2 → Ready | PARAM B2C, FINROTA bireysel |
| 2 | Phone uniqueness | **A — Normalize only, no unique** | A2 → Ready | PARAM/UNIVERA shared call center |
| 3 | VKN validation | **Global @unique korunur + checksum** | A2 → Ready | Tüm 3 tenant |
| 4 | AccountProject model | **AccountCompany-scoped + `projectsEnabled/Required` flags** | A4 → Ready (Phase 1) | UNIVERA |
| 5 | L1/L2 support level | **Case + Team + Person (Phase 1); Product/Project Phase 2-3** | A5 → Ready (Phase 1) | PARAM + UNIVERA + FINROTA |
| 6 | Package model | **Hybrid (legacy packageName + new packageId FK)** | A7 → Ready (Phase 1, A6 sonrası) | UNIVERA bundle |
| 7 | Team lead / membership | **Person.isTeamLead flag (Phase 1); PersonTeam table Phase 2** | B1 → Ready (Phase 1); B2 → Backlog | PARAM/FINROTA single-team |
| 8 | Import semantics | **Phase 1: Account-only, vkn match key, create + update** | A8 → Ready (Phase 1) | UNIVERA quarterly migration |

---

# Updated Implementation Order

Kararlar onaylanırsa Recommended Implementation Order güncellenir:

| # | Adım | İlgili WR | Ön koşul | Tahmin |
|---|---|---|---|---|
| 1 | ~~Decision sprint~~ — **BU DOKÜMAN** | — | — | 1-2 saat onay |
| 2 | **A2 — VKN/TCKN/phone validation + privacy design** | A2 | Karar #1, #2, #3 onay | 2 gün (validators + TCKN HMAC + endpoint) |
| 3 | **A3 — Address country-agnostic** (zaten Ready) | A3 | A1 ✓ | 2 gün |
| 4 | **B1 — Team lead + SupportLevel** | B1, A5 (Phase 1) | Karar #5, #7 onay | 1.5 gün |
| 5 | **A6 — ProductGroup + Product catalog** | A6, D1 | — (bağımsız) | 2-3 gün |
| 6 | **A7 — Package catalog (Hybrid Phase 1)** | A7 | A6 ✓ | 2 gün |
| 7 | **A4 — AccountProject (Phase 1: schema + admin CRUD)** | A4 | Karar #4 onay | 2-3 gün |
| 8 | **A4b — Case.accountProjectId + form integration** | A4 | A4 Phase 1 ✓ | 1.5 gün |
| 9 | **A8a — Import infra + Account import** | A8 | A2 ✓, A3 ✓ | 4 gün |
| 10 | **A8b — Contact + Address import** | A8 | A8a ✓ | 1.5 gün |

**Paralel slot'lar (kararlardan bağımsız):**
- F2 Cron health monitoring (1 gün, Ready)
- F3 QA Playbook docs (0.5 gün, Ready)
- F4/F5 SavedView + list standard (2 gün toplam)
- G4 Bundle splitting (0.5-1 gün, Ready)
- C2 Customer search refactor (1.5 gün, Ready)

---

# Which Items Become Ready If Accepted

Bu kararlar onaylanırsa **5 yeni Ready** + **Phase tanımı netleştirilen 3 item**:

| WR ID | Önceki | Yeni |
|---|---|---|
| A2 | Needs Decision | **Ready** |
| A4 | Needs Decision | **Ready (Phase 1)** |
| A5 | Needs Decision | **Ready (Phase 1)** |
| A7 | Needs Decision | **Ready (A6 sonrası, Phase 1 Hybrid)** |
| A8 | Needs Decision | **Ready (Phase 1: Account-only)** |
| B1 | Needs Decision | **Ready (Phase 1: isTeamLead flag)** |
| B2 | Needs Decision | **Backlog** (Phase 2'ye ertelenmiş — multi-team ihtiyacı gerçekleşince) |

Toplam: 7 item'ın decision blocker'ı kalkar.

---

# First Item to Implement After This Sprint

**Önerim: A2 — VKN/TCKN/phone validation + privacy design.**

Neden:
- En çok dependency unlock eder (A8 import, C5 duplicate review, C6 merge audit dolaylı bağlı)
- TCKN HMAC infrastructure'ı tek seferlik yatırım — sonraki tüm Bireysel müşteri akışı buna güvenir
- Validator endpoint'leri (`/api/lookup/validate-vkn`, `/api/lookup/validate-tckn`) ek kullanım için hazır olur
- Phase 1 scope tek PR'da bitirilebilir (2 gün tahmin)

**Alternatif quick-start:** A3 Address — A1'in mantıksal devamı, karar bekletmiyor (zaten Ready), 2 gün. Sıra istersen A3'ten başlayıp A2'yi paralel decision-finalize ederken yapabilirsin.

---

# Recommended WORK_REGISTER Status Updates (yapılmadı — onay sonrası)

> **Önemli:** Bu turda WORK_REGISTER.md **değiştirilmedi**. Aşağıdaki güncellemeler kararlar onaylandıktan sonra ayrı bir turda uygulanır.

```
A2: Needs Decision → Ready  (Karar #1, #2, #3 onay)
A4: Needs Decision → Ready  (Phase 1 scope; Karar #4 onay)
A5: Needs Decision → Ready  (Phase 1 scope; Karar #5 onay)
A7: Needs Decision → Ready  (A6 sonrası; Karar #6 onay)
A8: Needs Decision → Ready  (Phase 1 Account; Karar #8 onay)
B1: Needs Decision → Ready  (Phase 1 isTeamLead; Karar #7 onay)
B2: Needs Decision → Backlog (Phase 2'ye ertelenmiş; Karar #7 onay)
```

Status distribution etki: Shipped 7 (değişmez) · Ready 9 → **15** (+6) · Needs Decision 18 → **11** (−7) · Backlog 11 → **12** (+1).

---

# Open Questions for Human Approval

Kararlar tek tek onaylanmalı (8 madde). Tartışmalı olabilecek noktalar:

1. **TCKN HMAC pepper kim yönetir?** SystemAdmin env değişkeni / KMS / üçüncü taraf vault? (Karar #1)
2. **`projectsRequired=true` ne zaman aktif olur?** UNIVERA için flag bugünden mi yoksa A4 Phase 2 sonrası mı? (Karar #4)
3. **Reconcile UI öncelik?** A7 Package phase 1'de manuel item-by-item mı yoksa toplu batch tool mü? (Karar #6)
4. **L3 / Expert tier gerçekten gerekli mi?** Operasyonel test sonra düşebilir. (Karar #5)
5. **Import audit retention?** 30 gün mü, 1 yıl mı? (Karar #8)

---

**Bu doküman kararı bağlamaz.** Sen onayladıktan sonra ilgili WR satırları güncellenir + ilk implementation Card'ı (önerilen: A2) açılır.
