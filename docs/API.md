# API Documentation

Bu dokuman Varuna Case Management BFF endpointlerini ozetler. API Express uzerinde calisir ve production ortaminda `/api/*` path'leriyle servis edilir.

## Genel Kurallar

Base path:

```txt
/api
```

Liste endpointlerinde genellikle su yanit sekli kullanilir:

```json
{
  "value": [],
  "@odata.count": 0
}
```

Hata yanitlari genellikle su bicimdedir:

```json
{
  "error": "error_code",
  "message": "Aciklama"
}
```

## Kimlik Dogrulama

Case, lookup, admin, analytics, AI ve kullanici endpointlerinin buyuk bolumu Supabase access token gerektirir.

```txt
Authorization: Bearer <supabase_access_token>
```

BFF token'i Supabase ile dogrular, veritabanindaki `User` kaydini yukler ve `req.user` olusturur. Tenant kapsami `req.user.allowedCompanyIds` uzerinden uygulanir.

## Roller ve Yetki

Roller:

- `Agent`
- `Backoffice`
- `Supervisor`
- `CSM`
- `Admin`
- `SystemAdmin`

`SystemAdmin` tum aktif sirketlere erisir. `Admin` ve diger roller icin sirket bazli yetkiler `UserCompany` kayitlari uzerinden belirlenir.

## Health

| Method | Path | Auth | Aciklama |
| --- | --- | --- | --- |
| GET | `/api/health` | Yok | BFF servis durumu |
| GET | `/api/health/deep` | Yok | DB baglanti kontrolu |

## Auth

| Method | Path | Auth | Aciklama |
| --- | --- | --- | --- |
| GET | `/api/auth/me` | JWT | Aktif kullanici, rol ve person bilgisini dondurur |

Ornek yanit:

```json
{
  "id": "user-id",
  "email": "user@example.com",
  "fullName": "Demo User",
  "role": "Agent",
  "isActive": true,
  "personId": "person-id"
}
```

## Cases

Base path:

```txt
/api/cases
```

Tum case endpointleri JWT gerektirir. Istisna: `/api/cases/cron/snooze-wakeup` endpointi `CRON_SECRET` ile korunur.

### Listeleme

| Method | Path | Aciklama |
| --- | --- | --- |
| GET | `/api/cases` | Vaka listesi, filtreleme ve pagination |

Query parametreleri:

| Parametre | Aciklama |
| --- | --- |
| `search` | Baslik, case number veya musteri adinda arama |
| `statuses` | Virgulle ayrilmis statu listesi |
| `caseType` | Vaka tipi |
| `priorities` | Virgulle ayrilmis oncelik listesi |
| `teamId` | Atanan takim |
| `personId` | Atanan kisi |
| `dateFrom` | Olusturma tarihi baslangic |
| `dateTo` | Olusturma tarihi bitis |
| `page` | Sayfa numarasi |
| `pageSize` | Sayfa boyutu, default 25 |

Ornek:

```txt
GET /api/cases?statuses=Acik,Incelemede&priorities=High,Critical&page=1&pageSize=25
```

### Vaka Detay ve Degisiklik

| Method | Path | Aciklama |
| --- | --- | --- |
| GET | `/api/cases/:id` | Tek vaka detayi |
| POST | `/api/cases` | Yeni vaka olusturur |
| PATCH | `/api/cases/:id` | Vaka uzerinde kismi guncelleme yapar |
| POST | `/api/cases/:id/transition` | Statu gecisi yapar |

Yeni vaka olusturma icin temel body:

```json
{
  "title": "Vaka basligi",
  "description": "Vaka aciklamasi",
  "caseType": "GeneralSupport",
  "priority": "Medium",
  "origin": "Telefon",
  "companyId": "company-id",
  "companyName": "Company",
  "accountId": "account-id",
  "accountName": "Account",
  "category": "Kategori",
  "subCategory": "Alt kategori",
  "requestType": "Talep"
}
```

Statu gecisi body:

```json
{
  "nextStatus": "Incelemede",
  "resolutionNote": "Opsiyonel cozum notu",
  "cancellationReason": "Opsiyonel iptal nedeni",
  "thirdPartyId": "third-party-id",
  "thirdPartyName": "Third Party",
  "escalationLevel": "TakimLideri",
  "escalationReason": "Opsiyonel eskalasyon nedeni"
}
```

### Arama ve Kontrol

| Method | Path | Aciklama |
| --- | --- | --- |
| GET | `/api/cases/duplicate-check` | Musteri + vaka tipi icin acik vaka kontrolu |
| GET | `/api/cases/by-account` | Musteriye ait vakalari listeler |
| GET | `/api/cases/snoozed` | Aktif kullanicinin erteledigi vakalar |
| GET | `/api/cases/watching` | Kullanicinin izlemekte oldugu vakalar (Watcher Inbox) |
| GET | `/api/cases/:id/customer-pulse` | Musteri durumu (Customer Context Intelligence) |
| POST | `/api/cases/:id/action-summary` | AI ile paydaslara gonderilebilecek "Durum Raporu" uretir |
| GET | `/api/cases/:id/watchers` | Vakanin izleyicileri (FAZ 2 Collab) |
| POST | `/api/cases/:id/watchers` | Izleyici ekle. Body: `{ userId }` |
| DELETE | `/api/cases/:id/watchers/:userId` | Izleyiciyi kaldir |
| GET | `/api/cases/:id/links` | Vakanin bagli vakalari (3 tip) |
| POST | `/api/cases/:id/links` | Bagli vaka ekle. Body: `{ linkedCaseId, linkType }` |
| DELETE | `/api/cases/:id/links/:linkId` | Baglanti kaldir |

`action-summary` response (transient, persist edilmez):

```json
{
  "report": "Konu: CASE-... — ... — Durum Raporu\n\nSayin ilgili,\n\n... (mail-ready full text)",
  "subject": "Konu: CASE-... — ... — Durum Raporu",
  "eventCount": 12,
  "generatedAt": "ISO"
}
```

- Yetki: `verifyJwt` + `allowedCompanyIds` (cross-tenant ise 403).
- Body yok; caseId path param yeterli.
- Profesyonel, mail-ready format. Sablonun statik kisimlari (header, vaka
  bilgisi, footer/imza) backend tarafindan eklenir; AI sadece dort bolumu
  uretir: `problemSummary`, `processSummary`, `currentStatus`, `nextStep`.
- AI'a giden veride raw note 300 char ile kirpilir. AI metadata field
  guncellemeleri (aiSummary, aiFollowupRecommendation, aiCallBrief vs.)
  surec ozetinden filtrelenir — operasyonel anlami yok, mail i kirletir.
- AI key yoksa 503; AI cagri basarisizsa 502.
- AIUsageLog endpoint = `status-report`.
- aiSummary (vaka icerigi) ve supervisor-summary (risk) ile FARKLI amac:
  paydaslara gonderilebilecek durum raporu uretir; kullanici raporu
  kopyalayip mail ile gonderebilir.

**Watcher + Linked Cases (FAZ 2 Collab):**

`watchers` response:

```json
{
  "value": [
    {
      "id": "wat-...",
      "userId": "user-...",
      "userName": "Selin Gumus",
      "userEmail": "selin@param.com.tr",
      "addedBy": "user-...",
      "addedByName": "Aslı Tan",
      "addedAt": "ISO"
    }
  ]
}
```

- Yetki POST: self-watch tüm roller; başka kullanıcı eklemek Supervisor+ veya
  Agent + case.assignedPersonId === self.personId.
- Yetki DELETE: self veya Supervisor+.
- Cross-tenant block: eklenecek kullanıcı vakanın companyId'sinde aktif olmalı.
- Yan etkiler: CaseActivity ("X izleyici olarak eklendi/çıkarıldı") +
  eklenende CaseNotification (eventType='watcher_added').
- Watcher bildirim akışı (eventType='watcher_update') — vaka not eklenince,
  atama/öncelik değişince, status geçince tüm watcher'lara yazılır.

`links` response:

```json
{
  "value": [
    {
      "linkId": "lnk-...",
      "linkType": "Related | Duplicate | Parent",
      "linkTypeLabel": "İlişkili | Mükerrer | Üst Vaka",
      "createdBy": "user-...",
      "createdAt": "ISO",
      "linkedCase": {
        "id": "case-...", "caseNumber": "VK-...", "title": "...",
        "status": "Açık", "priority": "High",
        "assignedPersonName": "..."
      }
    }
  ]
}
```

- POST body: `{ linkedCaseId, linkType }`.
- Validasyonlar: self_link (400), invalid_type (400), target_not_found (404),
  cross_tenant (403), already (409), circular Parent (400).
- Symmetric Duplicate: A dup B yazılınca B dup A da otomatik yazılır;
  silinince ikisi de düşer.
- Yan etki: CaseActivity ("Bağlantı eklendi/kaldırıldı: X → Y").

`duplicate-check` query:

```txt
accountId=<id>&caseType=<caseType>
```

`by-account` query:

```txt
accountId=<id>&excludeId=<caseId>&statusIn=Acik,Incelemede&statusNotIn=Cozuldu,IptalEdildi
```

`customer-pulse` response (deterministic, AI gerekmez):

```json
{
  "accountId": "ACC-...",
  "accountName": "...",
  "caseId": "case-...",
  "state": "Stable | Watch | Risky | Critical",
  "metrics": {
    "openCases": 0,
    "recent30d": 0,
    "recent60d": 0,
    "recent90d": 0,
    "slaViolations": 0,
    "criticalCases": 0,
    "escalatedCases": 0
  },
  "repeatedIssues": [
    { "category": "...", "subCategory": "...", "count": 2 }
  ],
  "recentCases": [
    {
      "id": "case-...", "caseNumber": "VK-...", "title": "...",
      "status": "Acik", "priority": "High",
      "category": "...", "subCategory": "...",
      "createdAt": "ISO", "slaViolation": false
    }
  ],
  "summary": {
    "text": "Plain-language ozet (TR).",
    "evidence": ["3 acik vaka", "1 SLA ihlali"],
    "recommendedAction": "Onerilen aksiyon (TR).",
    "source": "deterministic"
  }
}
```

- Yetki: `verifyJwt` + `allowedCompanyIds` (vaka companyId scope dışıysa 403).
- Performans: tek prisma sorgu, son 200 vakaya kadar bound.
- AI gerektirmez. AI varsa frontend ayrı bir endpoint ile özetı zenginleştirir
  (`POST /api/ai/customer-pulse-summary`); başarısız olursa deterministic
  metin korunur.

### Toplu Guncelleme

| Method | Path | Aciklama |
| --- | --- | --- |
| POST | `/api/cases/bulk-update` | En fazla 100 vaka icin toplu alan guncelleme |

Body:

```json
{
  "caseIds": ["case-1", "case-2"],
  "updates": {
    "assignedPersonId": "person-id",
    "assignedTeamId": "team-id",
    "priority": "High",
    "status": "Incelemede"
  }
}
```

Not: Kapatma statuleri toplu guncellemede engellenir. Cross-tenant case ID denenirse islem reddedilir.

### Notlar ve Mention

| Method | Path | Aciklama |
| --- | --- | --- |
| POST | `/api/cases/:id/notes` | Vakaya not ekler. Case detayindaki notes alani sadece top-level (parentNoteId=NULL) notlari dondurur; her not `replyCount` ve `reactions` icerir |
| GET | `/api/cases/:id/notes/:noteId/replies` | Bir notun thread reply'larini lazy fetch eder (createdAt ASC). Her reply `reactions` icerir |
| POST | `/api/cases/:id/notes/:noteId/reply` | Bir nota yanit ekle. Body: `{ content, isInternal? }`. Max 1 derinlik (yanita yanit yok), @mention destegi |
| POST | `/api/cases/:id/notes/:noteId/reactions` | Bir nota (top-level veya reply) emoji reaksiyonu toggle eder. Body: `{ emoji }`. Whitelist: `thumbs_up \| eyes \| check \| important \| thanks`. Response: `{ ok: true, action: 'added' \| 'removed', emoji }` |
| GET | `/api/cases/:id/mentionable-users` | Mention dropdown adaylarini dondurur |
| POST | `/api/cases/:id/mentions/seen` | Vaka icindeki aktif kullanici mentionlarini goruldu yapar |
| GET | `/api/cases/me/mentions/unread` | Aktif kullanicinin okunmamis mentionlarini listeler |

Not body:

```json
{
  "content": "Not icerigi @[Demo User](user-id)",
  "visibility": "Internal",
  "authorName": "Demo User"
}
```

Not response her zaman `reactions: [{ id, userId, emoji }]` (bos olabilir) ve top-level notlarda `replyCount` icerir. Frontend reaksiyonlari emoji'ye gore aggregate eder ve `userId === currentUser.id` ile "mine" flag'ini hesaplar.

Reaction toggle body:

```json
{ "emoji": "thumbs_up" }
```

Whitelist disindaki emoji'ler 400 ile reddedilir. Ayni (note, user, emoji) ikinci kez gonderilirse satir silinir (toggle off).

### Aktivite, Call Log ve Checklist

| Method | Path | Aciklama |
| --- | --- | --- |
| POST | `/api/cases/:id/call-logs` | Vakaya cagri kaydi ekler |
| POST | `/api/cases/:id/activity` | Manuel aktivite ekler |
| PATCH | `/api/cases/:id/checklist/:itemId` | Checklist maddesini isaretler veya kaldirir |

Checklist body:

```json
{
  "checked": true
}
```

### Snooze

| Method | Path | Aciklama |
| --- | --- | --- |
| POST | `/api/cases/:id/snooze` | Vakayi erteleyip Inbox Later'a tasir |
| DELETE | `/api/cases/:id/snooze` | Ertelemeyi kaldirir |

Body:

```json
{
  "snoozeUntil": "2026-05-07T09:00:00.000Z",
  "snoozeReason": "Reminder"
}
```

Desteklenen `snoozeReason` degerleri:

- `CustomerWillCall`
- `WaitingThirdParty`
- `Reminder`

### Dosyalar

Dosya yukleme uc adimlidir: signed URL alma, dosyayi Supabase Storage'a PUT etme, finalize cagrisi.

| Method | Path | Aciklama |
| --- | --- | --- |
| POST | `/api/cases/:id/files/upload-url` | Signed upload URL uretir |
| POST | `/api/cases/:id/files/finalize` | Storage upload sonrasi DB kaydini tamamlar |
| GET | `/api/cases/:id/files/:fileId/download` | Kisa omurlu signed download URL dondurur |
| DELETE | `/api/cases/:id/files/:fileId` | Dosya kaydini siler |

Upload URL body:

```json
{
  "fileName": "ornek.pdf",
  "fileSize": 102400,
  "mimeType": "application/pdf"
}
```

Finalize body:

```json
{
  "attachmentId": "attachment-id",
  "path": "storage/path/ornek.pdf",
  "fileName": "ornek.pdf",
  "fileSize": 102400,
  "mimeType": "application/pdf"
}
```

### Case Cron

| Method | Path | Auth | Aciklama |
| --- | --- | --- | --- |
| POST | `/api/cases/cron/snooze-wakeup` | `CRON_SECRET` | Zamani gelen snooze vakalarini uyandirir |

Header secenekleri:

```txt
Authorization: Bearer <CRON_SECRET>
x-uptime-secret: <CRON_SECRET>
```

## Lookups

Base path:

```txt
/api/lookups
```

| Method | Path | Auth | Aciklama |
| --- | --- | --- | --- |
| GET | `/api/lookups/bootstrap` | JWT | Uygulama acilisinda gereken lookup verilerini tek istekte dondurur |

## Admin

Base path:

```txt
/api/admin
```

Tum admin endpointleri `Admin` veya `SystemAdmin` rolunu gerektirir. Sirket bazli endpointlerde ek olarak ilgili `companyId` icin admin yetkisi kontrol edilir.

### Sistem Geneli CRUD

Bu endpointler yalnizca `SystemAdmin` tarafindan kullanilabilir.

| Method | Path |
| --- | --- |
| GET | `/api/admin/third-parties` |
| POST | `/api/admin/third-parties` |
| PATCH | `/api/admin/third-parties/:id` |
| DELETE | `/api/admin/third-parties/:id` |
| GET | `/api/admin/document-types` |
| POST | `/api/admin/document-types` |
| PATCH | `/api/admin/document-types/:id` |
| DELETE | `/api/admin/document-types/:id` |
| GET | `/api/admin/persons` |
| POST | `/api/admin/persons` |
| PATCH | `/api/admin/persons/:id` |
| DELETE | `/api/admin/persons/:id` |
| GET | `/api/admin/offered-solutions` |
| POST | `/api/admin/offered-solutions` |
| PATCH | `/api/admin/offered-solutions/:id` |
| DELETE | `/api/admin/offered-solutions/:id` |

### Sirket Bazli Admin Endpointleri

| Method | Path | Aciklama |
| --- | --- | --- |
| GET | `/api/admin/teams` | Takim listesi, opsiyonel `companyId` query |
| POST | `/api/admin/teams` | Takim olusturur |
| PATCH | `/api/admin/teams/:id` | Takim gunceller |
| DELETE | `/api/admin/teams/:id` | Takim siler veya pasifler |
| GET | `/api/admin/sla-policies` | SLA policy listesi |
| POST | `/api/admin/sla-policies` | SLA policy olusturur |
| PATCH | `/api/admin/sla-policies/:id` | SLA policy gunceller |
| DELETE | `/api/admin/sla-policies/:id` | SLA policy siler |
| GET | `/api/admin/checklists` | Checklist template listesi |
| POST | `/api/admin/checklists` | Checklist template olusturur |
| PATCH | `/api/admin/checklists/:id` | Checklist template gunceller |
| DELETE | `/api/admin/checklists/:id` | Checklist template siler |
| GET | `/api/admin/field-definitions?companyId=<id>` | Custom field tanimlarini listeler |
| POST | `/api/admin/field-definitions` | Custom field olusturur |
| PATCH | `/api/admin/field-definitions/:id` | Custom field gunceller |
| DELETE | `/api/admin/field-definitions/:id` | Custom field siler |
| GET | `/api/admin/company-settings/:companyId` | Sirket marka/UI ayarlarini dondurur |
| PUT | `/api/admin/company-settings/:companyId` | Sirket ayarlarini upsert eder |
| GET | `/api/admin/categories` | Kategori listesi |
| POST | `/api/admin/categories` | Ana kategori olusturur |
| POST | `/api/admin/categories/:parentId/sub` | Alt kategori olusturur |
| PATCH | `/api/admin/categories/:id` | Kategori gunceller |
| DELETE | `/api/admin/categories/:id` | Kategori siler |

### Companies ve Users

| Method | Path | Aciklama |
| --- | --- | --- |
| GET | `/api/admin/companies` | Sirket listesi |
| POST | `/api/admin/companies` | Yeni sirket olusturur, `SystemAdmin` only |
| PATCH | `/api/admin/companies/:id` | Sirket gunceller |
| DELETE | `/api/admin/companies/:id` | Sirket pasifler, `SystemAdmin` only |
| GET | `/api/admin/users` | Kullanici listesi |
| PUT | `/api/admin/users/:id/companies` | Kullanicinin sirket atamalarini degistirir |

User company assignment body:

```json
{
  "assignments": [
    {
      "companyId": "company-id",
      "role": "Agent",
      "isActive": true
    }
  ]
}
```

### Knowledge Sources

| Method | Path | Aciklama |
| --- | --- | --- |
| GET | `/api/admin/knowledge-sources` | Bilgi kaynagi kayitlarini listeler |
| POST | `/api/admin/knowledge-sources` | Bilgi kaynagi olusturur |
| PATCH | `/api/admin/knowledge-sources/:id` | Bilgi kaynagi gunceller |

## AI

Base path:

```txt
/api/ai
```

Tum AI endpointleri JWT gerektirir ve IP bazli basit rate limit uygular. `OPENAI_API_KEY` tanimli degilse AI endpointleri `503` doner.

| Method | Path | Aciklama |
| --- | --- | --- |
| POST | `/api/ai/suggest-category` | Aciklamadan kategori, alt kategori, talep tipi ve oncelik onerir |
| POST | `/api/ai/draft-resolution` | Vaka icin cozum notu taslagi uretir |
| POST | `/api/ai/supervisor-summary` | Supervisor incelemesi icin ozet ve risk onerisi uretir |
| POST | `/api/ai/churn-conversion` | Churn riski ve aksiyon onerisi uretir |
| POST | `/api/ai/dashboard-chat` | Dashboard analist asistani cevabi uretir |
| POST | `/api/ai/call-summary` | Cagri notunu kisa ozetler |
| POST | `/api/ai/suggest-title` | Aciklamadan kisa Turkce vaka basligi onerir |
| POST | `/api/ai/transfer-suggest` | Vakaya en uygun takimi onerir (FAZ 2 §20.2) |
| POST | `/api/ai/customer-pulse-summary` | Deterministic Customer Pulse'i AI ile zenginlestirir (raw not/cagri GONDERMEZ) |
| POST | `/api/ai/suggest-links` | Vakaya benzer/iliskili olabilecek vakalari onerir (FAZ 2 Collab). Body: `{ caseId }`. Max 3 oneri |
| PATCH | `/api/ai/usage/:id/accept` | AI onerisi kabul/red bilgisini log kaydina yazar |

`suggest-category` temel body:

```json
{
  "description": "Musteri odeme ekraninda hata aldigini belirtiyor.",
  "caseType": "GeneralSupport",
  "companyName": "Company",
  "availableCategories": [
    {
      "category": "Teknik Destek",
      "subCategories": ["Odeme", "Entegrasyon"]
    }
  ],
  "availableRequestTypes": ["Bilgi", "Oneri", "Talep", "Sikayet", "Hata"],
  "caseId": "case-id",
  "companyId": "company-id"
}
```

`usage/:id/accept` body:

```json
{
  "accepted": true
}
```

## Analytics

Base path:

```txt
/api/analytics
```

Tum analytics endpointleri JWT ve `Supervisor`, `Admin` veya `SystemAdmin` rolu gerektirir.

| Method | Path | Aciklama |
| --- | --- | --- |
| GET | `/api/analytics/ai-usage?period=7d` | AI kullanim metrikleri |
| GET | `/api/analytics/qa-scores?period=7d` | QA skor metrikleri |
| GET | `/api/analytics/patterns?status=active` | Pattern alert listesi |
| PATCH | `/api/analytics/patterns/:id/dismiss` | Pattern alert kaydini kapatir |

Desteklenen period degerleri: `7d`, `30d`.

## My

Base path:

```txt
/api/my
```

Tum endpointler JWT gerektirir ve aktif kullanicinin `id`, `personId` ve `allowedCompanyIds` kapsamina gore calisir.

| Method | Path | Aciklama |
| --- | --- | --- |
| GET | `/api/my/dashboard` | Benim Sayfam icin tek round-trip veri seti |
| GET | `/api/my/calendar` | Takvim olaylari |
| POST | `/api/my/reminders` | Hatirlatici olusturur |
| GET | `/api/my/reminders/:id` | Tek hatirlatici detayi |
| PATCH | `/api/my/reminders/:id` | Hatirlatici gunceller |
| DELETE | `/api/my/reminders/:id` | Hatirlatici siler |

Calendar query secenekleri:

```txt
from=<ISO>&to=<ISO>
```

veya:

```txt
date=YYYY-MM-DD
```

Opsiyonel tip filtresi:

```txt
types=reminder,snooze,sla_response,sla_resolution,followup
```

Reminder create body:

```json
{
  "caseId": "case-id",
  "remindAt": "2026-05-07T09:00:00.000Z",
  "message": "Musteriyi tekrar ara"
}
```

`caseId` bos veya null olabilir; bu durumda vakasiz kisisel hatirlatici olusturulur.

## Cron

Base path:

```txt
/api/cron
```

Cron endpointleri JWT kullanmaz. `CRON_SECRET` ile korunur.

Header secenekleri:

```txt
Authorization: Bearer <CRON_SECRET>
x-uptime-secret: <CRON_SECRET>
```

| Method | Path | Aciklama |
| --- | --- | --- |
| POST | `/api/cron/pattern-detect` | Son donem vaka yogunlugundan pattern alert uretir |
| POST | `/api/cron/qa-score-batch` | Kapanmis vakalar icin QA score batch calistirir |
| POST | `/api/cron/qa-score` | Tek vaka icin QA score calistirir |

`qa-score` body:

```json
{
  "caseId": "case-id"
}
```

Not: Snooze wakeup cron tarihsel sebeple `/api/cases/cron/snooze-wakeup` altinda kalmistir.

## Durum Kodlari

| Kod | Anlam |
| --- | --- |
| 200 | Basarili istek |
| 201 | Kayit olusturuldu |
| 400 | Eksik veya gecersiz body/query |
| 401 | Token yok, gecersiz veya cron secret hatali |
| 403 | Yetki veya tenant kapsami yetersiz |
| 404 | Kayit bulunamadi |
| 429 | AI rate limit |
| 500 | Sunucu hatasi |
| 503 | Cron veya AI servisi yapilandirilmamis |

## Notlar

- Frontend API cagrilarinda access token `caseService.apiFetch` uzerinden otomatik eklenir.
- CORS yalnizca local development icin `http://localhost:5273` origin'ine aciktir.
- Dosya upload akisi Vercel body limitlerini asmak icin dogrudan Supabase Storage PUT kullanir.
- Admin endpointlerinde `companyId` alanlari yetki kontrolunun temel parcasidir.
- Liste endpointlerinde `value` alaninin bos donmesi genellikle hata degil, kullanicinin kapsami icinde veri olmadigi anlamina gelir.
