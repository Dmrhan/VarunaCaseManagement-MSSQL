# Architecture Documentation

Bu dokuman Varuna Case Management uygulamasinin teknik mimarisini, katmanlarini ve temel tasarim kararlarini ozetler.

## Mimari Ozet

Varuna Case Management, React frontend ve Express BFF katmanindan olusan bir web uygulamasidir. BFF; Supabase Auth ile kimlik dogrulama yapar, Prisma uzerinden veritabanina erisir, Supabase Storage icin signed URL uretir ve AI/cron/analytics gibi operasyonel akislari tek API yuzeyi altinda toplar.

Ana teknoloji stack'i:

- Frontend: React, Vite, TypeScript
- UI: Tailwind CSS, lucide-react, Recharts
- Backend: Express BFF
- Data access: Prisma Client
- Database: PostgreSQL, Supabase uzerinde
- Auth: Supabase Auth
- File storage: Supabase Storage
- AI: OpenAI API
- Deployment target: Vercel/serverless uyumlu Express app

## Katmanlar

```txt
Browser / React App
        |
        |  fetch + Authorization: Bearer <Supabase access token>
        v
Express BFF (/api/*)
        |
        |  verifyJwt -> req.user + allowedCompanyIds
        v
Repository Layer
        |
        |  Prisma Client
        v
PostgreSQL / Supabase

Side integrations:
- Supabase Auth: JWT dogrulama
- Supabase Storage: signed upload/download URL
- OpenAI API: AI onerileri, ozetler ve QA skor akislari
- Cron callers: Vercel Cron, UptimeRobot veya GitHub Actions
```

## Frontend

Frontend `src/` altinda yer alir ve Vite ile calisir.

Onemli alanlar:

```txt
src/features/cases/          Vaka listeleme, form, detay drawer ve case tipleri
src/services/caseService.ts  Case API client ve mock fallback
src/services/supabase.ts     Supabase browser client ve token yardimcilari
src/components/ui/           Ortak UI bilesenleri
src/lib/format.ts            Format yardimcilari
```

Frontend API cagrilarinda `caseService.apiFetch` merkezi wrapper olarak kullanilir. Bu wrapper aktif Supabase session'dan access token alir ve request header'ina ekler.

```txt
React component -> service function -> apiFetch -> /api/* endpoint
```

`USE_MOCK = false` oldugunda uygulama gercek BFF endpointlerini kullanir. Mock data kodda dev/test fallback olarak durur.

## Backend / BFF

Backend `server/` altindadir.

```txt
server/index.js       Local dev icin listen baslatir
server/app.js         Express app factory ve route mount noktasi
server/routes/        HTTP route handler katmani
server/db/            Repository, Prisma client, auth ve storage yardimcilari
server/cron/          Zamanlanmis is job implementasyonlari
```

`server/app.js` hem local development hem de serverless calisma modeli icin Express app'i export eder. Local development'ta `server/index.js` bu app'i `3101` portunda dinletir.

Route mount yapisi:

```txt
/api/auth       Auth helper endpointleri
/api/cases      Vaka operasyonlari
/api/ai         AI endpointleri
/api/lookups    Lookup bootstrap
/api/admin      Admin tanim ekranlari
/api/analytics  Analitik ve ROI endpointleri
/api/cron       Periyodik is tetikleyicileri
/api/my         Kisisel dashboard, takvim ve reminder endpointleri
```

## Request Flow

Tipik bir authenticated request akisi:

```txt
1. Kullanici React uygulamasinda aksiyon alir.
2. Frontend service fonksiyonu API request'i hazirlar.
3. apiFetch aktif Supabase access token'i alir.
4. Request BFF'e Authorization header ile gider.
5. Route seviyesinde verifyJwt token'i Supabase ile dogrular.
6. verifyJwt DB'den User kaydini yukler.
7. allowedCompanyIds ve companyRoles req.user'a eklenir.
8. Route handler repository fonksiyonunu cagirir.
9. Repository Prisma ile DB islemini yapar.
10. Repository frontend'in bekledigi shape'e donusturur.
11. BFF JSON yaniti dondurur.
```

## Auth Modeli

Auth iki parcadan olusur:

- Supabase Auth: Kullanici oturumu ve JWT uretimi
- Local `User` tablosu: Rol, aktiflik, person baglantisi ve tenant yetkisi

Frontend tarafinda Supabase browser client `VITE_SUPABASE_URL` ve `VITE_SUPABASE_ANON_KEY` ile calisir. Backend tarafinda token dogrulama icin `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` kullanilir.

`verifyJwt` sorumluluklari:

- `Authorization: Bearer <token>` header'ini okumak
- Token'i Supabase ile dogrulamak
- `User` kaydini DB'den yuklemek
- Kullanici yoksa auto-provision yapmak
- Pasif kullaniciyi engellemek
- `allowedCompanyIds` ve `companyRoles` hesaplamak

## Multi-Tenant Model

Tenant izolasyonu sirket bazlidir.

Temel modeller:

- `Company`: Tenant/sirket
- `User`: Auth kimliginin uygulama karsiligi
- `UserCompany`: Kullanici-sirket yetki baglantisi
- `CompanyRole`: Sirket bazli rol
- `Case.companyId`: Vakanin tenant bilgisi

Cogu sorguda `allowedCompanyIds` filtre olarak uygulanir.

```txt
User -> UserCompany[] -> allowedCompanyIds -> repository WHERE companyId IN (...)
```

`SystemAdmin` icin `allowedCompanyIds` tum aktif sirketlerle doldurulur. Diger kullanicilar yalnizca aktif `UserCompany` kayitlarindan gelen sirketlere erisir.

Repository seviyesinde de scope guard kullanilir. Ornegin case mutation'larinda `assertCaseInScope` once case'in `companyId` degerini bulur, sonra kullanicinin bu company'ye erisimi var mi kontrol eder.

## Repository Katmani

Route handler'lar dogrudan Prisma detaylariyla calismak yerine repository katmanini kullanir.

Repository katmaninin amaclari:

- HTTP route kodunu DB detaylarindan ayirmak
- Prisma sorgularini tek yerde toplamak
- Frontend'in bekledigi denormalized shape'i uretmek
- Tenant scope kontrollerini mutation katmaninda tekrar uygulamak
- MSSQL gecisi gibi veri katmani degisikliklerinin etkisini sinirlamak

Ornek:

```txt
server/routes/cases.js -> caseRepository.list/get/create/update
```

`caseRepository` DB'deki normalized iliskileri frontend shape'ine cevirir:

```txt
CaseAttachment[] -> files[]
CaseActivity[]   -> history[]
CaseCallLog[]    -> callLogs[]
```

Enum mapping icin `enumMap.js` kullanilir. Bu sayede frontend'deki Turkce/deger odakli representation ile Prisma enum identifier'lari ayrilmis olur.

## Veri Modeli

Ana veri modeli `prisma/schema.prisma` icindedir.

Tasarim kararlari:

- ID alanlari string/cuid tabanlidir.
- Prisma enum kullanilir.
- Postgres'e ozel tiplerden kacinilir.
- JSON alanlari tasinabilir olacak sekilde kullanilir.
- Case uzerinde bazi alanlar denormalized tutulur.

Bu kararlar ileride MSSQL'e gecisi kolaylastirmak icin alinmistir. Gecis senaryosunda temel beklenti `datasource provider` ve connection string degisikligiyle data access katmaninin buyuk olcude korunmasidir.

Onemli model gruplari:

- Auth ve tenant: `User`, `UserCompany`, `Company`
- Operasyon: `Case`, `CaseActivity`, `CaseNote`, `CaseAttachment`, `CaseCallLog`
- Admin tanimlari: `Team`, `Person`, `SLAPolicy`, `ChecklistTemplate`, `CategoryDef`, `FieldDefinition`
- AI/analytics: `AISuggestion`, `AIUsageLog`, `QAScoreLog`, `PatternAlert`, `KnowledgeSource`
- Kisisel akislar: `CaseReminder`, snooze alanlari

## Dosya Yukleme Mimarisi

Dosya yukleme Vercel request body limitlerini asmak icin BFF uzerinden proxy edilmez. Bunun yerine signed URL akisi kullanilir.

```txt
1. Frontend -> BFF: POST /api/cases/:id/files/upload-url
2. BFF -> Supabase Storage: signed upload URL uretir
3. Frontend -> Supabase Storage: dosyayi signed URL'e PUT eder
4. Frontend -> BFF: POST /api/cases/:id/files/finalize
5. BFF -> DB: CaseAttachment kaydi ve history log yazar
```

Indirme akisi:

```txt
Frontend -> BFF: GET /api/cases/:id/files/:fileId/download
BFF -> Supabase Storage: signed download URL uretir
Frontend -> signed URL: dosyayi acar veya indirir
```

Bu tasarim:

- Buyuk dosyalari BFF body limitinden bagimsiz hale getirir.
- Dosya kaydini ancak upload basarili olduktan sonra finalize eder.
- Download linklerini kisa omurlu signed URL ile sinirlar.

## SLA ve Status Flow

Case status gecisleri `/api/cases/:id/transition` uzerinden yapilir.

SLA ile ilgili alanlar:

- `slaResponseDueAt`
- `slaResolutionDueAt`
- `slaViolation`
- `slaPausedAt`
- `slaPausedDurationMin`
- `slaThirdPartyWaitMin`

`3rdPartyBekleniyor` status'une girildiginde SLA pause baslar. Bu statuden cikildiginda gecen sure `slaPausedDurationMin` ve `slaThirdPartyWaitMin` alanlarina eklenir; cozum hedef tarihi ileri kaydirilir.

Toplu update akisi basit field update olarak tasarlanmistir. Bu nedenle bulk status update, SLA pause/resume mantigini calistirmaz. SLA etkisi isteniyorsa tek vaka status transition akisi kullanilmalidir.

## Snooze ve Reminder Mimarisi

Snooze, vakayi gecici olarak ana inbox'tan ayirmak icin kullanilir.

Case uzerindeki alanlar:

- `snoozeUntil`
- `snoozeReason`
- `snoozePreviousStatus`

Akis:

```txt
POST /api/cases/:id/snooze
  -> snoozeUntil ve snoozeReason set edilir
  -> snoozePreviousStatus saklanir
  -> history log yazilir

DELETE /api/cases/:id/snooze
  -> snooze alanlari temizlenir
  -> onceki statuye geri donulur
```

Zamani gelen snooze kayitlari cron ile uyandirilir:

```txt
POST /api/cases/cron/snooze-wakeup
```

Kisisel reminder akisi `CaseReminder` modeliyle ayridir ve `/api/my/reminders` endpointleri uzerinden yonetilir. Reminder vakaya bagli veya vakasiz olabilir.

## Cron Mimarisi

Cron endpointleri JWT kullanmaz. Bunun yerine `CRON_SECRET` ile korunur.

Kabul edilen header bicimleri:

```txt
Authorization: Bearer <CRON_SECRET>
x-uptime-secret: <CRON_SECRET>
```

Cron endpointleri:

```txt
/api/cases/cron/snooze-wakeup
/api/cron/pattern-detect
/api/cron/qa-score-batch
/api/cron/qa-score
```

Tasarim notu: Snooze wakeup tarihsel sebeple `/api/cases/cron/snooze-wakeup` altinda kalmistir. Yeni cron isleri `/api/cron/*` altinda toplanir.

## AI Mimarisi

AI endpointleri `/api/ai/*` altinda yer alir ve JWT gerektirir. Backend OpenAI client'i `OPENAI_API_KEY` ile kurar.

AI endpoint gruplari:

- Kategori/oncelik onerisi
- Baslik onerisi
- Cozum notu taslagi
- Supervisor summary
- Churn conversion onerisi
- Dashboard chat
- Call summary
- Vaka aktarimi onerisi
- Customer Pulse AI ozet
- Vaka aksiyon log ozeti (Action Timeline Summary)
- AI usage accept tracking

Bazi AI ozellikleri case-scoped olarak `/api/cases/:id/*` altinda mount edilir
(`transfer-brief`, `action-summary`) — bunlar caseRepository scope kontrolu
icin natural bir path verir. Helper kodu `server/lib/*Ai.js` modullerinde
toplanir (`transferAi.js`, `actionSummaryAi.js`).

Action Timeline Summary (post `/api/cases/:id/action-summary`) ozeli:
- SADECE CaseActivity log verisi AI'a gider — UI metin scraping yok.
- Persist edilmez; UI her "Yenile" tikladiginda yeniden uretilir.
- aiSummary (vaka icerigi) ve supervisor-summary (risk) ile FARKLI amac:
  vakanin operasyonel yolculugunu kronolojik anlatir.
- Promptta hallucination disiplini: bir bilgi logda yoksa AI "loglarda
  gorunmuyor" yazmak zorunda.

AI cagrilarinda temel guvenlik ve operasyon kararlar:

- IP bazli basit rate limit uygulanir.
- `OPENAI_API_KEY` yoksa endpointler `503` doner.
- Bazi endpointlerde JSON schema veya JSON object output beklenir.
- Basarili cagrilar `AIUsageLog` tablosuna yazilir.
- Kullanici oneriyi uygular veya yoksayarsa `/api/ai/usage/:id/accept` ile kabul/red bilgisi islenir.

AI telemetry akisi:

```txt
AI endpoint success -> AIUsageLog
User applies/ignores -> PATCH /api/ai/usage/:id/accept
Analytics -> /api/analytics/ai-usage
```

## Analytics Mimarisi

Analytics endpointleri `/api/analytics/*` altindadir ve `Supervisor`, `Admin` veya `SystemAdmin` rolu gerektirir.

Ana metrik kaynaklari:

- `AIUsageLog`: AI kullanim sayilari, kabul orani, ortalama yanit suresi
- `Case`: QA score alanlari ve operasyonel case metrikleri
- `PatternAlert`: Yogunluk/pattern alarm kayitlari

Analytics sorgulari `allowedCompanyIds` ile tenant scope uygular.

## Lookup Bootstrap

Frontend'in form ve dropdown verilerini tek istekle yuklemesi icin `/api/lookups/bootstrap` kullanilir.

Bu endpoint:

- Companies
- Teams
- Persons
- Accounts
- Categories
- Third parties
- Document types
- Offered solutions
- Product groups
- Field definitions

gibi lookup setlerini kullanicinin tenant kapsamina gore dondurur.

Frontend bu veriyi cache'ler. Boylece UI icindeki `lookupService.*` fonksiyonlari sync sekilde kullanilmaya devam eder.

## Admin Mimarisi

Admin endpointleri `/api/admin/*` altinda toplanir.

Yetki modeli ikiye ayrilir:

- Sistem geneli tanimlar: yalnizca `SystemAdmin`
- Sirket bazli tanimlar: ilgili `companyId` icin `Admin` veya `SystemAdmin`

Sistem geneli kayitlara ornek:

- Third parties
- Document types
- Persons
- Offered solutions

Sirket bazli kayitlara ornek:

- Teams
- SLA policies
- Checklists
- Field definitions
- Company settings
- Categories
- Users/company assignments

## Local Development

Local development komutlari:

```bash
npm install
npm run dev
```

Bu komut client ve BFF'i birlikte calistirir.

Varsayilan portlar:

```txt
Client: 5273
BFF:    3101
```

CORS yalnizca local development icin `http://localhost:5273` origin'ine aciktir.

## Environment Variables

Backend tarafinda beklenen temel degiskenler:

```bash
DATABASE_URL=
DIRECT_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
OPENAI_API_KEY=
```

Frontend tarafinda Vite prefix'li degiskenler kullanilir:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

`DIRECT_URL`, Prisma migration islemleri icin kullanilir. Supabase pooler DDL/migration icin yeterli olmadigindan direct connection ayrica tutulur.

## Deployment Notlari

BFF Express app olarak organize edilmistir. Local development'ta `server/index.js` app'i dinletir. Serverless deployment'ta ise app factory yaklasimi sayesinde ayni Express app `/api/*` endpointlerine baglanabilir.

Deployment sirasinda dikkat edilmesi gerekenler:

- `DATABASE_URL` runtime DB baglantisini gostermelidir.
- `DIRECT_URL` migration icin direct DB connection olmalidir.
- `SUPABASE_SERVICE_ROLE_KEY` sadece backend ortaminda bulunmalidir.
- `VITE_SUPABASE_ANON_KEY` frontend tarafinda kullanilir, service role key frontend'e verilmez.
- `CRON_SECRET` production'da mutlaka set edilmelidir.
- `OPENAI_API_KEY` yoksa AI endpointleri kullanilamaz.

## Tasarim Kararlari

### BFF Kullanimi

Frontend'in dogrudan DB veya service role yetkileriyle calismamasi icin tum hassas islemler BFF uzerinden yapilir. Bu sayede auth, tenant scope, audit log, file finalize ve AI telemetry tek noktada kontrol edilir.

### Denormalized Case Alanlari

`Case` uzerinde `companyName`, `accountName`, `assignedTeamName`, `assignedPersonName` gibi alanlar tutulur. Bu yaklasim eski vaka kayitlarinda isimlerin tarihsel olarak korunmasini ve frontend shape'inin daha basit kalmasini saglar.

### Child Tablolarda companyId

`CaseActivity`, `CaseNote`, `CaseAttachment`, `CaseMention`, `CaseReminder` gibi child tablolarda `companyId` denormalize edilir. Bunun nedeni tenant scope sorgularinda join ihtiyacini azaltmak ve raporlama/analytics sorgularini sade tutmaktir.

### MSSQL'e Tasinabilirlik

Schema Postgres'e ozel ozelliklere baglanmadan tasarlanmistir. String ID, Prisma enum ve tasinabilir JSON alanlari bu hedefin parcasidir.

### Storage Proxy Etmeme

Dosya upload islemi BFF uzerinden proxy edilmez. Signed URL ile dogrudan Storage'a PUT edilir. Bu karar hem performans hem de Vercel body limitleri acisindan daha uygundur.

## Ilgili Dokumanlar

- `README.md`: Kurulum ve proje ozeti
- `docs/API.md`: Endpoint dokumantasyonu
- `prisma/schema.prisma`: Veri modeli
