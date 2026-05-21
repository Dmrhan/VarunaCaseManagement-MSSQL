# Agentic Planning Card — A8 Phase 2: Customer 360 Import (Dynamic Multi-Target Schema Registry)

- **Work Register ID:** A8 Phase 2
- **Product Planning Matrix IDs touched:** PM-01 (Müşteri Tipi), PM-02 (Address), PM-04 (AccountProject), PM-05 (Catalog — Phase 3 dokunuş)
- **Product capability:** Müşteri onboarding sırasında yalnız Account ana kartı değil; ilişkili şirket bağı, iletişim kişileri, adresler ve projelerle birlikte tam Customer 360 yapısını Varuna'ya güvenli, görsel ve geri alınabilir biçimde aktarmak.
- **Request source:** Phase 1 (WR-A8) merge sonrası kullanıcı isteği; Phase 1 review fix turlarında öğrenilen ders (sample vs full dataset, rollback failure surfacing, skipErrors enforcement) Phase 2'ye taşınır.
- **Card sahibi:** Ürün direktörü + agent
- **Tarih:** 2026-05-22
- **Protocol versiyonu:** 2.0
- **Decision references:**
  - [WR-A8 Phase 1 — Veri Aktarım Stüdyosu (Account import foundation)](../../scripts/smoke-account-import.js) — Phase 1 davranışı tanım kaynağı
  - [MASTER_DATA_DECISION_SPRINT.md §②/③/④/⑤](./MASTER_DATA_DECISION_SPRINT.md) — Account/Address/AccountProject mimari sınırları
  - [WR-A4.md](./WR-A4.md) — AccountProject AccountCompany-scoped olmalı kuralı
  - [WR-A3.md](./WR-A3.md) — Address country-agnostic; ISO-2 normalize
  - [WR-A1.md](./WR-A1.md) — Müşteri tipi enum + privacy guardrails

---

## ⓪ Planning-Only Notice

**Bu kart yalnız planlamadır.** Kod, Prisma schema, migration, route ve UI değişikliği bu kart kapsamında YAPILMAZ. İmplementasyon ayrı kartlar/PR'lar (Phase 2a/2b vs. — bkz. §20) ile tetiklenir.

**Phase 1 kapsam beyanı:**
> WR-A8 Phase 1 (Account import) yalnızca **Müşteri Ana Kartı** alanlarını içe aktarır. Phase 1 sürümü Customer 360 değildir; AccountCompany ilişkileri (Account+Company unique satırı), AccountContact, AccountAddress ve AccountProject Phase 1'de aktarılmaz. Müşteri 360 ihtiyacı yalnız bu kartın hedefi olan Phase 2 ile karşılanır.

---

## ① Product Goal

Customer 360 Import, admin'in tek bir Veri Aktarım Stüdyosu akışında müşteri varlığının tüm önemli parçalarını Varuna'ya bilinçli biçimde sokmasını sağlar.

Faz 2 hedef varlıklar:

1. **Account** — Müşteri Ana Kartı
2. **AccountCompany** — Müşterinin Varuna şirket(ler)i ile ilişkisi (per-tenant kod, paket, segment)
3. **AccountContact** — İletişim kişileri
4. **AccountAddress** — Adresler (ISO-2, tip bazlı)
5. **AccountProject** — Projeler (AccountCompany-scoped)

Premium UX kuralları Phase 1 ile aynı:

- Kaynak seçimi → Görsel eşleştirme → Doğrulama → Normalize önizleme → Dry-run → Commit → Sonuç + Rollback.
- Hiçbir adım sessiz/varsayım yapmaz; her risk operatöre gösterilir.

---

## ② Strict Scope for Phase 2 Plan

**Phase 2'de planlanır:**

1. account
2. accountCompany
3. accountContact
4. accountAddress
5. accountProject

**Phase 2'de explicit olarak DIŞARIDA:**

- Case import (Faz 3+)
- Product catalog import (Faz 3+)
- Package catalog import (Faz 3+)
- AccountProduct / Package relation import → Phase 2c veya Phase 3
- Recurring/scheduled import (yok)
- Fuzzy merge (yasak)
- Destructive delete (yasak)
- Otomatik cross-system sync / webhook ingestion (yok)
- TCKN import — Privacy Guardrail #1 (TCKN plain ASLA dış kaynaktan kabul edilmez)

---

## ③ Critical Architecture Requirement: Dynamic Multi-Target Schema Registry

Phase 1'de tek hedef (Account) için `accountTargetSchema.js` tek-dosya registry'di. Phase 2 birden çok varlık taşır; yeni alanlar sürekli eklenecek. Bu yüzden **çoklu hedef** ve **dinamik fetch** zorunlu.

### Klasör yapısı (öneri)

```
server/lib/import/targetSchemas/
  customer360TargetSchemas/
    index.js                    ← composer; tüm entity'leri birleştirir
    accountTargetSchema.js      ← Phase 1'in genişletilmiş hali (yeniden kullanım)
    accountCompanyTargetSchema.js
    accountContactTargetSchema.js
    accountAddressTargetSchema.js
    accountProjectTargetSchema.js
    relationships.js            ← entity-arası key tanımları + business invariants
    versions.js                 ← her entity versiyonu + composite customer360 versiyonu
```

### Kurallar

- **Hardcode YASAK:** React/UI hiçbir entity için statik alan listesi tutmaz. Tüm field metadata BFF'den fetch edilir.
- **Duplicate YASAK:** Field tanımı tek yerde (registry). Smoke'lar, frontend ve backend doğrulama bu kaynaktan beslenir.
- **Composite version:** `customer360.version = sha256(entity.account.version + entity.accountCompany.version + ...)` veya açık tarih+counter. Bir entity güncellense bile composite version değişir.

### Her entity şema descriptor'u

```js
{
  entity: 'accountContact',
  version: '2026-05-xx.accountContact.v1',
  label: 'İletişim Kişileri',
  description: '...',
  parentEntity: 'account',
  relationshipKeys: ['accountKey'],
  fields: [ /* her alanın metadata'sı */ ],
  validators: { /* satır seviyesi cross-field kurallar */ },
  normalizers: { /* phone E.164, country ISO-2 vb. */ },
  createAllowed: [...],
  updateAllowed: [...],
}
```

### Her field için ZORUNLU metadata

- `key` — Prisma model property
- `label` — Türkçe display
- `description` — Tek satırlık iş açıklaması
- `example` — Şablonda doldurulur
- `group` — UI gruplama (Zorunlu / Kimlik / İletişim / Adres / İlişki / Durum vb.)
- `type` — text | number | email | phone | vkn | boolean | date | enum | iso2-country
- `required` — true/false
- `aliases` — Auto-map için
- `validationHint` — UI'da gösterilebilir kısa kural ("10 haneli rakam")
- `normalizationHint` — UI'da "E.164 formatına çevrilecek" gibi
- `businessWarning` — Eşleşmediğinde gösterilecek uyarı (örn. VKN yoksa update yapılamayacağı)
- `sensitive` — boolean (log/analytics'e maskeli)
- `pii` — boolean (KVKK kapsamı)
- `createAllowed` — Create payload'da yer alır mı
- `updateAllowed` — Update payload'da yer alır mı
- `warningIfMissing` — `{ code, message }` ya da null

Yeni Customer 360 alanı (örn. `account.taxOffice`) eklenecekse: **yalnızca** registry'de `accountTargetSchema.fields` listesine eklenir. UI, smoke ve doğrulama otomatik picker'a girer.

---

## ④ Proposed Schema Endpoint

`GET /api/admin/imports/targets/customer360/schema`

Yanıt iskeleti:

```json
{
  "target": "customer360",
  "version": "2026-05-xx.customer360.v1",
  "entities": [
    {
      "entity": "account",
      "version": "2026-05-xx.account.v2",
      "label": "Müşteri Ana Kartı",
      "description": "Tüm müşteri yapısının kökü. Eşleştirme anahtarı: VKN.",
      "fields": [ /* …Phase 1 fields + Phase 2 ek alanlar */ ]
    },
    {
      "entity": "accountCompany",
      "version": "2026-05-xx.accountCompany.v1",
      "label": "İlişkili Şirket",
      "parentEntity": "account",
      "relationshipKeys": ["accountKey"],
      "fields": [ /* … */ ]
    },
    {
      "entity": "accountContact",
      "version": "...",
      "label": "İletişim Kişileri",
      "parentEntity": "account",
      "relationshipKeys": ["accountKey"],
      "fields": [ /* … */ ]
    },
    {
      "entity": "accountAddress",
      "version": "...",
      "label": "Adresler",
      "parentEntity": "account",
      "relationshipKeys": ["accountKey"],
      "fields": [ /* … */ ]
    },
    {
      "entity": "accountProject",
      "version": "...",
      "label": "Projeler",
      "parentEntity": "accountCompany",
      "relationshipKeys": ["accountKey", "accountCompanyKey"],
      "fields": [ /* … */ ]
    }
  ],
  "relationships": [
    { "from": "account", "to": "accountCompany", "key": "accountKey" },
    { "from": "account", "to": "accountContact", "key": "accountKey" },
    { "from": "account", "to": "accountAddress", "key": "accountKey" },
    { "from": "accountCompany", "to": "accountProject", "key": "accountCompanyKey" }
  ],
  "matchingRules": {
    "account": ["vkn", "externalCustomerCode(secondary)"],
    "accountCompany": ["accountKey + companyCode"],
    "accountContact": ["accountKey + email", "accountKey + phone(fallback)"],
    "accountAddress": ["accountKey + type + label", "accountKey + type + normalized(line1)(secondary)"],
    "accountProject": ["accountCompanyKey + projectCode"]
  }
}
```

**Frontend:** Bu yanıttan dinamik render eder. Tip union, label, group, badge'ler hep buradan. Yeni alan eklenince yalnız BFF kaynağı değişir; UI otomatik adapt eder.

---

## ⑤ Schema Freshness / Versioning

Phase 1 davranışı genişletilir:

- ImportSession.customer360SchemaVersion saklanır.
- Dry-run yanıtı customer360SchemaVersion taşır.
- Commit, kullanıcı dry-run sonrası ekrandayken bu versiyonu **header veya body** olarak gönderir.
- Backend commit aşamasında live registry versiyonunu karşılaştırır:
  - Match → devam.
  - Mismatch → **HTTP 409, `import_schema_changed`**, mesaj:
    > "Customer 360 hedef alan şeması değişti. Lütfen eşleştirmeyi yeniden doğrulayın."

**UI:**

- Hedef şema bilgisi her zaman görünür: "Hedef şema: Customer 360 · v..."
- Stale durumda kırmızı blocking banner: "Customer 360 hedef alanları güncellendi. Eşleştirme yeniden doğrulanmalı."
- "Şemayı Yenile" butonu — yeniden fetch + mapping doğrulama tetikler.

**Composite vs entity version:** Composite değişmeden hiçbir alt-entity field düzenleme olmaz. Yani entity.version değişince composite mutlaka değişir.

---

## ⑥ Preview Sample vs Full Dataset — Mandatory Rule

Phase 1'in P1 review fix'inde öğrenilen ders: **sample asla import edilen veri DEĞİLDİR.** Bu kuralı Phase 2'ye taşı.

**Kurallar:**

- UI önizleme: ilk 5 satır/entity (sampleLimit yalnız UX). Asla import bu örnekten çalışmaz.
- ImportSession (memory + DB rawJson) tüm allowed dataset'i tutar.
- Dry-run **tüm dataset** üzerinden çalışır (her entity için).
- Commit **tüm dataset** üzerinden çalışır.
- API kaynağında nested JSON ise tüm parent + child elemanları, entity-bazlı satır limitleri içinde tutulur.

**Limitler (öneri, Phase 1 ile uyumlu):**

- Per entity max rows: 5000 (account), 10000 (children — contact/address/project). Phase 2 implementasyonu tarafında nihai sayı `MAX_ROWS_PER_ENTITY` map'i ile registry'e yazılır.
- Toplam payload limit: ~20MB JSON body (route-level Express limit ayarı — Phase 1'de 12mb idi; Phase 2'de büyüt).
- Limit aşımı → `too_many_rows` veya `too_many_entities`, **silent truncation yok**.

**UI dili:**

- "Önizleme" = sample.
- "Aktarılacak veri" = full dataset.

---

## ⑦ Target Entities and Field Examples

### A) account — Müşteri Ana Kartı

Phase 1 alanları **aynen korunur** (uyumluluk için):

| key | label | type | required | notes |
|---|---|---|---|---|
| `name` | Müşteri Adı | text | ✓ | Boş bırakılamaz |
| `vkn` | VKN | vkn | — | Match key; warningIfMissing(no_vkn) |
| `customerType` | Müşteri Tipi | enum | — | Bireysel/Kurumsal/Kamu/Vakıf-STK |
| `legalName` | Ticari Unvan | text | — |  |
| `registrationNo` | Sicil No | text | — |  |
| `externalCustomerCode` | Dış Müşteri Kodu | text | — | AccountCompany'e yazılır (entity boundary) |
| `phone` | Telefon | phone | — | E.164 normalize |
| `email` | E-posta | email | — |  |
| `isActive` | Aktif mi? | boolean | — |  |

**Phase 2 düşünülen genişlemeler** (planlama yorumu — finalize değil):

- `sector` (text) — Sektör segmentasyonu
- `website` (text) — URL validation
- `notes` (textarea, sensitive=false ama uzun)

### B) accountCompany — İlişkili Şirket

Amaç: Müşterinin Varuna company/tenant ile ilişkisi (per-tenant kod, paket, sözleşme).

| key | label | type | required | notes |
|---|---|---|---|---|
| `accountKey` | Müşteri Anahtarı | text | ✓ | Relationship key (VKN veya externalCustomerCode) |
| `companyCode` | Varuna Şirket Kodu | text | ✓ | "COMP-PARAM" vs "COMP-UNIVERA" → güvenli lookup |
| `externalCustomerCode` | Dış Müşteri Kodu | text | — | Şirket-scope unique |
| `packageName` | Paket Adı (legacy) | text | — | Snapshot; packageId set olsa bile silinmez |
| `packageId` | Paket | text/lookup | — | Phase 3'te aktif; Phase 2'de opsiyonel |
| `segment` | Segment | text | — | Anahtar müşteri / VIP etiket |
| `contractStartAt` | Sözleşme Başlangıç | date | — |  |
| `contractEndAt` | Sözleşme Bitiş | date | — |  |
| `status` | Durum | enum | — | active/churn/prospect/inactive |
| `isActive` | Aktif mi? | boolean | — |  |

**Kurallar:**

- `companyCode` **selected import company'ye** veya `assertCompanyAdmin(req, companyId)` izinli şirketlerden birine resolve etmeli.
- **Source companyCode override** edemez: import wizard'da seçilen "hedef şirket" belirleyici; satırdaki companyCode başka şirkete işaret ediyorsa **error** veya **safe lookup ile çözümlü** (admin'in birden fazla şirkete yetkisi varsa açık seçim gerekir).
- **Cross-tenant relation YASAK** — error path açık.

### C) accountContact — İletişim Kişileri

| key | label | type | required | notes |
|---|---|---|---|---|
| `accountKey` | Müşteri Anahtarı | text | ✓ | VKN veya externalCustomerCode |
| `fullName` | Ad Soyad | text | ✓ | PII |
| `title` | Unvan | text | — |  |
| `email` | E-posta | email | — | Match key (sekonder) |
| `phone` | Telefon | phone | — | E.164 normalize, match key (üçüncül) |
| `isPrimary` | Birincil mi? | boolean | — | Account başına en fazla 1 (mevcut iş kuralı) |
| `isActive` | Aktif mi? | boolean | — |  |
| `notes` | Not | textarea | — |  |

**Kurallar:**

- Account başına `isPrimary=true` tek satır — import sırasında ikinci birincil görünürse error/warning + son satır kazanır kuralı (tasarım sırasında karara bağlanır).
- Aynı account içinde duplicate (email/phone match) → warning veya error (kararı Phase 2 implementasyonu önünde).
- PII alanlar: `fullName`, `email`, `phone`. Analytics/log payload'larından maskeli.

### D) accountAddress — Adresler

| key | label | type | required | notes |
|---|---|---|---|---|
| `accountKey` | Müşteri Anahtarı | text | ✓ |  |
| `type` | Adres Tipi | enum | ✓ | Billing/Shipping/Visit/Headquarters/Branch (WR-A3) |
| `label` | Etiket | text | — | "Merkez Ofis", "İstanbul Şube" |
| `line1` | Sokak/Cadde | text | ✓ |  |
| `line2` | Bina/Apt No | text | — |  |
| `district` | İlçe | text | — |  |
| `city` | Şehir | text | — |  |
| `state` | Bölge/Eyalet | text | — | Türkiye için il bilgisi `city`'ye gider |
| `postalCode` | Posta Kodu | text | — |  |
| `country` | Ülke | iso2-country | ✓ | ISO-3166-1 alpha-2 normalize ("TR", "DE") |
| `isDefault` | Varsayılan mı? | boolean | — | Account + type başına 1 (mevcut iş kuralı) |
| `isActive` | Aktif mi? | boolean | — |  |

**Kurallar:**

- Country **ISO-2** zorunlu; "Türkiye"/"Turkey"/"TUR" gibi varyasyonlar normalize tablosuyla TR'ye çevrilir (validator listesi registry'de).
- TR-only assumption YOK — DE/US müşterileri için aynı şema.
- `isDefault` uniqueness: Account+type başına yalnız bir tane; import sırasında çakışma → en son satır kazanır kuralı (veya error — Phase 2 kararı).

### E) accountProject — Projeler

| key | label | type | required | notes |
|---|---|---|---|---|
| `accountKey` | Müşteri Anahtarı | text | ✓ |  |
| `accountCompanyKey` | Şirket İlişki Anahtarı | text | ✓ | `accountKey + companyCode` resolve eder |
| `projectCode` | Proje Kodu | text | ✓ | AccountCompany-scope unique |
| `projectName` | Proje Adı | text | ✓ |  |
| `status` | Durum | enum | — | Active/Passive/Completed/Cancelled (ProjectStatus enum, WR-A4) |
| `startDate` | Başlangıç | date | — |  |
| `endDate` | Bitiş | date | — | startDate ≤ endDate validation |
| `description` | Açıklama | textarea | — |  |
| `isActive` | Aktif mi? | boolean | — |  |

**Kurallar (WR-A4 ile uyumlu):**

- AccountProject **AccountCompany-scoped**. Doğrudan Account'a bağlanmaz.
- `projectCode` AccountCompany içinde unique.
- Cross-company project relation YASAK.
- `defaultSupportLevel` — model şu an taşımıyor; eklenecekse Phase 2 implementasyonu öncesi WR-A4 + WR-A5-B1 referansları üzerinden Decision Sprint kararı gerekir. Bu kart önermez.

---

## ⑧ Parent-Child Data Representation

Phase 2 birden çok kaynak şeklini destekler. Plan **iki şekli kesin**, üçüncüyü "Phase 2b" olarak ertelemeyi öneriyor.

### A) Multi-sheet XLSX (öncelikli, non-teknik admin için)

Sayfalar:

- `Accounts` — Account satırları
- `AccountCompany` — Account-Company ilişki satırları
- `Contacts` — İletişim satırları
- `Addresses` — Adres satırları
- `Projects` — Proje satırları

Her child sheet ilgili relationship key'leri tekrarlar:

- `accountKey` (her child sheet'te)
- `accountCompanyKey` (yalnız Projects sheet'inde)

**Avantajları:**

- Admin'ler Excel'de güvenle ayrı sheet'ler doldurur.
- Headers schema endpoint'ten generate edilebilir → "Şablon İndir" 5 sheet'li xlsx üretir.
- Auto-map sheet-bazlı: her sheet kendi entity'sine map edilir.

### B) Nested API JSON (öncelikli, dış sistem entegrasyonu için)

```json
{
  "accounts": [
    {
      "name": "Acme A.Ş.",
      "vkn": "1234567890",
      "companies": [
        { "companyCode": "COMP-UNIVERA", "externalCustomerCode": "U-12345", "package": "Premium" }
      ],
      "contacts": [
        { "fullName": "Ali Veli", "email": "ali@acme.com.tr", "phone": "+90...", "isPrimary": true }
      ],
      "addresses": [
        { "type": "Billing", "line1": "...", "country": "TR" }
      ],
      "projects": [
        { "companyCode": "COMP-UNIVERA", "projectCode": "RT-001", "projectName": "Rota Opt" }
      ]
    }
  ]
}
```

**Resolver:** `dataPath="accounts"` ile dışa açılır; her account içindeki nested array'ler entity'lerine dağılır. Frontend bu yapıyı **flatten** ederek ortak ImportSession rowset'ine çevirir; relationship key'leri otomatik enjekte edilir (her contact/address/project'e `accountKey` = parent'ın VKN'i).

### C) Flat CSV with repeated account keys — **Phase 2b'ye ertelendi**

Tek dosyada satır başına tekrar eden `accountKey` ile karışık entity satırları (örn. `entityType` kolonu ile ayrılır). UX karmaşık; admin'ler kafa karıştırır. Phase 2'de iki şekil yeterli.

---

## ⑨ Relationship Graph UX

Data Integration Studio'nun mapping ve dry-run aşamalarında **görsel ilişki ağacı** olmalı.

```
Müşteri Ana Kartı (Account)
  ├─→ İlişkili Şirket (AccountCompany)
  │      └─→ Projeler (AccountProject)
  ├─→ İletişim Kişileri (AccountContact)
  └─→ Adresler (AccountAddress)
```

Her node şunları gösterir:

- Entity label + ikon
- Mapped row count: "50 müşteri / 48 şirket ilişkisi / 162 iletişim / 89 adres / 12 proje"
- Validation status badge: ✓ / ⚠ / ✗
- Tıklanınca → o entity'nin row table'ı drawer'da açılır

Operasyonel uyarı mesajları:

- "12 iletişim kişisi müşteriyle eşleşti"
- "3 adres için accountKey bulunamadı" (orphan child)
- "2 proje için AccountCompany ilişkisi eksik"
- "8 müşterinin hiç iletişim kişisi yok" (completeness uyarısı)
- "4 müşterinin hiç adres yok"

**Visual primitives:** Phase 1'in Stepper + MetricTile bileşenleri yeniden kullanılır; ek olarak `RelationshipGraph.tsx` (basit DOM/SVG; complex canvas zorunlu değil).

---

## ⑩ Matching Semantics

| Entity | Birincil match | Sekonder | Tersiyer | Fuzzy? |
|---|---|---|---|---|
| Account | VKN (valid checksum) | externalCustomerCode (admin opsiyon) | — | YASAK |
| AccountCompany | accountKey + companyCode | — | — | YASAK |
| AccountContact | accountKey + email | accountKey + phone | — | YASAK (no person merge) |
| AccountAddress | accountKey + type + label | accountKey + type + normalize(line1) (uyarılı) | — | YASAK |
| AccountProject | accountCompanyKey + projectCode | — | — | YASAK |

**Dry-run'da matching kuralı satır bazında görünür olmalı:** "Bu satır <müşteri>'ye `VKN` üzerinden eşleşti."

Tüm eşleştirmeler exact match. Fuzzy YOK (name benzerliği, levenshtein vs.). Account merge bu PR'da YOK.

---

## ⑪ Validation Rules

**Cross-cutting:**

- Parent Account child'lardan ÖNCE resolve edilmeli. Parent eksikse child orphan → error.
- Duplicate child satırı (aynı entity içinde aynı match key) → error veya warning (severity Phase 2 implementasyonu kararı; kontaktlarda muhtemelen warning, projectCode'da error).
- Source companyId/companyCode override YASAK; selected company belirleyici.
- Cross-tenant write YASAK.
- TCKN içeren herhangi bir alan → 400 `tckn_import_blocked` (registry whitelist'inde TCKN yok; explicit guard).

**Entity-spesifik:**

- **Contact:** email format, phone E.164, isPrimary uniqueness, fullName boş olamaz.
- **Address:** line1 required, country ISO-2, type enum, isDefault uniqueness per (account, type).
- **Project:** projectCode required, accountCompanyKey resolve edilmeli, status ProjectStatus enum, startDate ≤ endDate.

Her validation hatası **kullanıcı diliyle** mesaj döner:
> "VKN 10 haneli rakam olmalı." / "Ülke kodu tanınmadı (TR/DE/US gibi 2 haneli)." / "Bu projeye ait AccountCompany bulunamadı: COMP-XYZ"

---

## ⑫ skipErrors Semantics — Mandatory

Phase 1'in P2 review fix'i bu davranışı netleştirdi. Phase 2 aynı modeli **parent-child** boyutuna taşır.

### Kural matrisi

| Senaryo | skipErrors=false | skipErrors=true |
|---|---|---|
| Hiçbir hata yok | ✓ Commit tüm satırlar | ✓ Commit tüm satırlar |
| Parent (Account) invalid | ✗ Block (`import_has_errors`) | Account skip + ALL child skip (cascading) |
| Child invalid, parent valid | ✗ Block | ✓ Parent + valid sibling commit, invalid child skip |
| AccountCompany invalid → bağlı Project | ✗ Block | AccountCompany skip + bağlı Project skip |

**Cascading skip kuralı:** Bir parent atlanırsa, tüm bağımlı child'lar da atlanır. UI'da:

> "12 müşteri commit edilecek. 3 müşteri hatalı satır nedeniyle atlanacak. Bu 3 müşteriye bağlı 9 iletişim, 5 adres, 2 proje de atlanacak."

**Pre-commit ekran:** Kullanıcı commit'e basmadan önce **tam impact** tabular gösterilir. Onay sonra başlar.

---

## ⑬ Dry-run / Impact Preview

Dry-run yanıtı entity-bazlı özet taşır:

```json
{
  "ok": true,
  "customer360SchemaVersion": "2026-05-xx.customer360.v1",
  "jobId": "imp_...",
  "summary": {
    "totalRows": 318,
    "byEntity": {
      "account":        { "total": 50, "create": 12, "update": 35, "skip": 0, "error": 3 },
      "accountCompany": { "total": 48, "create": 2,  "update": 46, "skip": 0, "error": 0 },
      "accountContact": { "total": 162, "create": 102, "update": 50, "skip": 5, "error": 5 },
      "accountAddress": { "total": 89, "create": 65, "update": 22, "skip": 0, "error": 2 },
      "accountProject": { "total": 12, "create": 8,  "update": 4,  "skip": 0, "error": 0 }
    },
    "completenessScore": {
      "accountsWithCompany":   { "have": 48, "total": 50, "pct": 96 },
      "accountsWithContact":   { "have": 42, "total": 50, "pct": 84 },
      "accountsWithAddress":   { "have": 39, "total": 50, "pct": 78 },
      "accountsWithProject":   { "have": 12, "total": 50, "pct": 24 }
    },
    "orphanChildRows": [
      { "entity": "accountContact", "rowNumber": 17, "reason": "accountKey eşleşmedi: 9999999999" }
    ]
  },
  "preview": [ /* her entity için 100 satırlık örnek; geri kalan job rows'a yazılır */ ]
}
```

**UI tile'lar (per entity):** Toplam · Oluşturulacak · Güncellenecek · Atlanacak · Hatalı · Uyarılı · Kalite skoru.

**Completeness panel:** Müşteri 360 tamamlanma yüzdeleri (yukarıdaki örnek). Bu admin'e "Burada eksik veri var" sinyali verir.

**Detay drawer (per satır):** Parent + child gösterimi; "Bu müşterinin importu sırasında: 1 AccountCompany update, 3 Contact create, 2 Address create, 1 Project create".

**Hiçbir mutation yok** — dry-run garantili read-only. Smoke #17 bunu doğrular.

---

## ⑭ Commit / Rollback

### Commit dependency order

1. Account
2. AccountCompany
3. AccountContact
4. AccountAddress
5. AccountProject

**Idempotency:** Phase 1 modeli uyarlanır. Her ImportJobRow'un statusu (`pending` → `created`/`updated`/`skipped`/`error`) takip edilir. Retry, tamamlanmış satırları atlar.

**Transaction stratejisi:** Tek dev mega-tx kullanılmaz (5000+ satırlık veri uzun lock). Yerine **per-row tx**:

- Parent Account create/update kendi tx'inde.
- Bağlı children kendi tx'lerinde (parent'ın ID'sini ImportJobRow.accountId'den okur).

Kısmi başarı kabul edilir; status `partial` olur.

### Rollback

**Kapsam:** Rollback artık yalnız Account+AccountCompany değil; commit'in dokunduğu **her entity'yi** geri alır.

**Snapshot model:** Her ImportJobRow per-entity beforeJson/afterJson taşır. Phase 1'in tek snapshot'ı entity-keyed map'e dönüşür:

```js
ImportJobRow.beforeJson = {
  account:        { /* … */ } | null,
  accountCompany: { /* … */ } | null,
  // accountContact/Address/Project child satırları zaten kendi ImportJobRow'larında
}
ImportJobRow.afterJson = { /* aynı şekil + accountCompanyCreated flag */ }
```

Child entity'ler için ayrı ImportJobRow'lar yaratılır (her entity'nin kendi snapshot'ı kendi satırında).

**Rollback execution order (DEPENDENCY-SAFE REVERSE):**

1. AccountProject
2. AccountAddress
3. AccountContact
4. AccountCompany
5. Account

Önce child'lar geri alınır (cascade tetiklenmesin).

**Rollback policy (Phase 1'den miras):**

- Created kayıtlar → soft deactivate (`isActive=false` veya `status='inactive'`); hard delete YOK.
- Updated kayıtlar → beforeJson restore.
- Yeni yaratılan AccountCompany (commit sırasında doğmuş) → status='inactive'.
- AccountContact create → isActive=false (kart üzerinde gizli olur ama referans hala duruyor).
- AccountAddress create → isActive=false.
- AccountProject create → status='Passive' (ProjectStatus enum uyumu; "Cancelled" değil çünkü iptal başka iş anlamı taşır).

### Rollback Failure Surfacing — **MANDATORY**

Phase 1'in P2 review fix'i (no-swallow) Phase 2'ye genelleştirilir:

- Her entity restore ayrı try/catch'te koşar.
- `.catch(() => {})` YASAK — global olarak.
- Restore başarısız → ImportJobRow.status='rollback_error', errorsJson'a structured kayıt:
  ```json
  { "code": "account_company_rollback_failed",
    "entity": "accountCompany",
    "recordId": "...",
    "message": "AccountCompany geri alınamadı: <safe one-line>" }
  ```
- Başarı sayacı (`rolledBackXxxCount`) **yalnız tam başarıda** artar.
- Job status `failedCount > 0` ise → `rollback_partial`.
- Rollback response her zaman `report.errorCount` + `report.failedRows[]` taşır.

Hard delete avoided unless model safely permits and no downstream relation. Phase 2'de **hard delete tamamen kapalı**.

---

## ⑮ Audit

ImportJob ve ImportJobRow modelleri Customer 360 için genişletilir.

### ImportJob (Phase 2 ek alanlar)

| Yeni alan | Tip | Anlam |
|---|---|---|
| `targetType` | string | "customer360" (mevcut; Phase 1: "account") |
| `entityCountsJson` | Json | `{ account: {create, update, error, skip}, accountCompany: {…}, … }` |
| `customer360SchemaVersion` | string | Composite version snapshot |
| `sourceMetaJson` | Json | sheet adları, dataPath, sample limits |

Phase 1 alanları (status, sourceType, sourceName, totalRows, errorCount, vb.) korunur.

### ImportJobRow (Phase 2 ek alanlar)

| Yeni alan | Tip | Anlam |
|---|---|---|
| `entityType` | string | "account" / "accountCompany" / "accountContact" / "accountAddress" / "accountProject" |
| `parentRowNumber` | int? | Bağlı olduğu parent ImportJobRow.rowNumber (account row) |
| `relationshipKey` | string? | "VKN:1234567890" veya "AC:cuid:abc" |
| `recordId` | string? | Created/updated Prisma kaydı ID'si (Account.id, Contact.id, vb.) |

`accountId` alanı korunur ama yalnız entity='account' satırları için doldurulur (geriye uyumluluk). Diğer entity'ler için `recordId` kullanılır.

### Filtering/Reporting

- entityType, status, action — **scalar fields**, B-tree index (MSSQL uyumlu).
- JSON alanları (errorsJson, beforeJson, afterJson) yalnız detay drawer'da okunur; filter/query'de kullanılmaz.

### Retention

Phase 1'in dokümante edilen 90 günlük hedefi aynen. Cleanup automatic değil (manuel script). Phase 2'de değişmez.

---

## ⑯ MSSQL Portability

Varuna ileride Microsoft SQL Server'a geçebilir. Phase 2 tasarımı bu kısıtla **uyumlu kalır**.

**Yasaklar:**

- ❌ JSONB operatörleri (`->`, `->>`, `@>`, `?`, `?&`, `?|`)
- ❌ GIN/GiST indeksleri
- ❌ Generated columns (PG-spesifik syntax)
- ❌ `ON CONFLICT … DO UPDATE` (Prisma upsert'i hem MSSQL'de hem PG'de çalışır)
- ❌ `COPY` import (MSSQL'de BULK INSERT; bu yol kullanılmıyor)
- ❌ `pg_trgm`, `pgvector` uzantıları
- ❌ Raw SQL — kaçınılmaz ise dokümante + iki dialect için ifade

**İzinli:**

- ✅ Prisma upsert + create + update + findUnique pattern'leri
- ✅ Standart B-tree compound indexes (örn. `@@index([importJobId, status])`)
- ✅ Json tipi (PG'de jsonb, MSSQL'de nvarchar(max))
- ✅ Batch processing — application logic'te (`for…await` ile per-row tx)

**JSON kullanım kuralı:**

- Snapshot ve audit detay için Json OK (beforeJson, afterJson, errorsJson).
- Status, count, companyId, targetType, sourceType, createdAt, completedAt, entityType, action — **scalar** alanlar.
- Hiçbir core filter/sort/group sorgusu Json içine bakmaz.

---

## ⑰ UX Quality Bar

Phase 2'de Stüdyo "developer ekranı" olmaktan kaçınmalı.

**Her ekranda olması gereken:**

- Her entity için iş diliyle açıklama ("Müşteri Ana Kartı — temel müşteri bilgileri. Eşleştirme VKN ile.")
- Her field için label + description + example + validation hint
- Her risk için business warning ("VKN yoksa update yapamayız.")
- İlişki ağacı (graph) — entity bağımlılıkları görsel
- Orphan child satırlar açık ("3 adres müşteriyle eşleşmedi" + tıklanır)
- Parent-child row matching dry-run drawer'da
- Müşteri 360 completeness score panel
- Dry-run impact tablosu (per entity)
- Rollback kapsamı pre-confirmation ekranında: "Bu işlem 12 müşteri, 48 şirket ilişkisi, 102 iletişim, 65 adres, 8 projeyi geri alacak."

**Yasak UX kalıpları:**

- Field key'lerini ham göstermek (mutlaka label)
- "row 7: column 3 invalid" gibi cryptic mesajlar
- Sessiz başarısızlık (rollback no-swallow kuralı)
- "Click here to fix" linkler — admin operasyonel ekran, fix yapması beklenmez; ihlal varsa source'u düzeltir

---

## ⑱ Smoke / QA Plan

Phase 2 smoke (`scripts/smoke-customer360-import.js` önerisi):

1. **Schema endpoint** — Customer 360 schema endpoint tüm 5 entity'yi döner.
2. **Field metadata** — her field için label/description/example/type/group dolu.
3. **Frontend schema-driven** — UI alan listesi backend response'tan render edilir; mock kullanılmaz.
4. **Schema version mismatch** — dry-run sonrası live registry değişirse commit `import_schema_changed` (409).
5. **Multi-sheet XLSX** — 5 sheet'li workbook entity'lerine dağılır.
6. **API nested JSON** — `accounts[].contacts[]` doğru parse edilir; tüm child satırlar retain edilir.
7. **Sample vs full** — API kaynağı 120 müşteri × 3 contact = 360 contact döner; preview 5; dry-run tüm 360'ı işler.
8. **Orphan contact** — accountKey eşleşmeyen contact satırı error olarak işaretlenir.
9. **Orphan address** — aynı.
10. **Orphan project** — accountCompanyKey eşleşmeyen project error.
11. **Project ↔ AccountCompany invariant** — AccountCompany'siz project create denenirse error.
12. **Duplicate contact** — aynı account + aynı email iki satırda → warning veya error (kural Phase 2'de finalize).
13. **Invalid address country** — "Türkiyye" → normalize tablosunda yok → error; "Türkiye" → "TR" → ok.
14. **skipErrors=false blocks any child error** — 1 valid Account + 1 invalid Contact → `import_has_errors` (400), zero mutation.
15. **skipErrors=true cascade** — Account valid + child invalid → Account+valid children commit, invalid skip.
16. **Invalid parent blocks all children** — Account error → children cascading skip (skipErrors=true) veya block (false).
17. **Dry-run no mutation** — schema değişikliği dahil DB count Δ=0.
18. **Commit dependency order** — Account önce, sonra AccountCompany, sonra Contact/Address, sonra Project. Smoke timestamp ile doğrular.
19. **Rollback reverse order** — Project önce, Account en son.
20. **Rollback restores all updated entities** — AccountCompany.externalCustomerCode, Contact.email, Address.line1, Project.status üzerinde update → rollback hepsini eski değerine döndürür.
21. **Rollback failure surfaced** — induced failure (örn. child entity'yi rollback öncesi sil) → `rollback_partial`, `errorCount ≥ 1`, `failedRows[]` dolu, no silent swallow.
22. **Cross-tenant relation blocked** — companyCode başka şirkete işaret ederse + admin o şirkete yetkili değilse → error.
23. **Source companyId override** — payload'a "companyId" alanı eklense bile selected company kullanılır.
24. **TCKN absent** — `customer360Schema.entities.account.fields.find(f => f.key === 'tckn')` → undefined. TCKN içeren satır → `tckn_import_blocked`.
25. **PII fields labeled** — `accountContact.fields.find(f => f.key === 'fullName').pii === true` ve `email.sensitive === true`.
26. **MSSQL portability** — `git grep -E "(jsonb|->>|GIN|pg_trgm|ON CONFLICT)" server/lib/import/customer360* server/db/import*` çıkış 0; planlamada yasaklı pattern kaçağı yok.

---

## ⑲ Final Report Requirements

Phase 2 implementasyonu (kart kapsamında DEĞİL) tamamlandığında final report şunları açıkça doğrulamalı:

- Planning card path: `docs/planning_cards/WR-A8-PHASE2-CUSTOMER-360-IMPORT.md`
- Phase 2 scope: account + accountCompany + accountContact + accountAddress + accountProject
- Explicit deferrals: Case/Product/Package import, scheduled sync, fuzzy merge, destructive delete
- Multi-target schema registry design: `server/lib/import/targetSchemas/customer360TargetSchemas/`
- Schema freshness/versioning: composite version + `import_schema_changed` (409)
- Sample vs full dataset rule: enforced; smoke #7 doğrular
- Supported source shapes: multi-sheet XLSX + nested API JSON (flat CSV repeated key Phase 2b)
- Relationship graph UX: account → company → contact/address/project node ağacı
- Matching rules: VKN, email/phone, type+label, projectCode (per entity)
- Validation rules: parent-first, orphan child error, ISO-2 country, isPrimary/isDefault uniqueness
- skipErrors semantics: parent-child cascade matrix uygulanır
- Dry-run design: per-entity summary + completenessScore + zero mutation
- Commit/rollback design: dependency order + reverse rollback + soft deactivate
- Rollback failure surfacing: no-swallow + errorCount + failedRows[] + rollback_partial status
- Audit model: entityType, parentRowNumber, relationshipKey, recordId scalar fields
- MSSQL portability: Json snapshot OK, scalar filtering only, no PG-specific SQL
- Smoke/QA plan: 26-scenario suite
- Implementation split recommendation: §20

---

## ⑳ Recommendation for Implementation Split

Plan tek mega-PR önermez. Üç phase önerilir:

### Phase 2a — Foundation + Multi-Target Registry (kritik)

- Multi-target schema registry klasör yapısı + composite version
- Schema endpoint
- ImportJob.targetType='customer360' + ImportJobRow.entityType eklenmesi (Prisma migration)
- BFF parse/dry-run/commit/rollback için entity-agnostic core extension
- Smoke 1-5 (registry, schema, version, basic multi-sheet)
- UI: relationship graph stub + entity-based stepper

**Kapsam:** Account + AccountCompany yalnız (yeni alanlar yok, mevcut Phase 1 davranışı entity registry'e taşınır). Backward compat: Phase 1 commit/rollback davranışı bozulmaz.

### Phase 2b — Child Entities (Contact + Address + Project)

- accountContactTargetSchema + accountAddressTargetSchema + accountProjectTargetSchema registry'leri
- Parent-child matching + orphan detection + cascading skipErrors
- Dependency-ordered commit + reverse rollback
- Rollback no-swallow her entity için
- Smoke 6-23 (parent-child, validation, rollback)
- UI: per-entity dry-run tile'ları + drawer field diff

**Kapsam:** Phase 2a üzerine; production'a release öncesi tüm parent-child path'leri kapalı.

### Phase 2c — Polish + PII + MSSQL Audit + Flat CSV (opsiyonel)

- PII/sensitive flag rendering (UI badge)
- TCKN guard smoke
- MSSQL portability statik analiz (smoke #26)
- Flat CSV repeated key source — eğer admin'lerden gelirse
- Completeness score panel + history sidebar enrich

**Kapsam:** Phase 2b sonrası polish. Production'a ihtiyaç görülürse Phase 2b ile birleştirilebilir.

---

## Bilinçli Bırakılanlar / Açık Sorular

1. **isPrimary uniqueness davranışı:** İmport sırasında ikinci `isPrimary=true` contact gelirse → son satır kazanır mı yoksa error mı? Phase 2 implementasyonu öncesi ürün direktörü kararı.
2. **isDefault address uniqueness:** Aynı tip için iki default satırı → son kazanır vs. error.
3. **Duplicate contact (aynı email):** Warning mı error mı? Konservatif öneri: warning (operatör görür ama commit yapar); admin'ler tekrar gönderim yapabilir.
4. **AccountCompany companyCode resolution:** Admin'in yetkili olduğu birden fazla şirket varsa import wizard'da "hedef şirket" tek seçim mi yoksa per-row seçim mi? Konservatif öneri: tek seçim (Phase 1 ile uyumlu).
5. **AccountProject defaultSupportLevel:** Model şu an taşımıyor. Phase 2 öncesi Decision Sprint kararı gerekir; bu kart önermez.
6. **Date format esnekliği:** ISO 8601 zorunlu mu yoksa "DD.MM.YYYY" TR format kabul mu? Konservatif öneri: ikisini de kabul eden normalizer; ambiguous (örn. 03/04/2026) error.
7. **Composite schema version hesabı:** Hash (sha256 over entity versions) vs. tarih+counter. Önerilen: tarih+counter ("2026-05-22.customer360.v1") — okuması kolay, drift tespiti net.

Bu kararlar **Phase 2a kapsamına başlanmadan** ürün direktörü ile netleşmeli; kart referans niteliğinde.
