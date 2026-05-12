# Varuna Case Management

Varuna Case Management, şirket bazlı vaka yönetimi için geliştirilmiş bağımsız bir web uygulamasıdır. Uygulama; vaka oluşturma, listeleme, detay görüntüleme, statü geçişleri, SLA takibi, notlar, dosya ekleri, @mention bildirimleri, erteleme ve operasyonel yönetim akışlarını destekler.

## Mevcut Durum

Proje artık yalnızca mock UI aşamasında değildir. Frontend, Express BFF üzerinden gerçek API çağrıları yapacak şekilde yapılandırılmıştır.

- Frontend: React + Vite + TypeScript
- Backend: Express BFF
- Veritabanı: Prisma + PostgreSQL
- Auth: Supabase Auth
- Dosya yönetimi: Supabase Storage signed upload URL akışı
- Multi-tenant erişim: Kullanıcının erişebildiği şirketler üzerinden filtreleme
- Mock veri: Geliştirme fallback'i olarak kodda durur, aktif kullanım `USE_MOCK = false`

## Dokümantasyon

- [API Dokümantasyonu](docs/API.md): BFF endpointleri, auth, yetki, request body örnekleri ve durum kodları
- [Mimari Dokümantasyon](docs/ARCHITECTURE.md): Frontend, BFF, repository, Prisma, Supabase, AI, cron ve tenant mimarisi
- [Operasyon Dokümantasyonu](docs/OPERATIONS.md): Local kurulum, environment, migration, deploy, cron, monitoring ve troubleshooting
- [Test Senaryoları](docs/TEST_SCENARIOS.md): PM ve QA için manuel test senaryoları, persona'lar, bilinen kısıtlamalar
- [Yol Haritası](docs/ROADMAP.md): Önerilen, planlanan ve aktif özellikler; bilinen kısıtlamalar

## Geliştirme

```bash
npm install
npm run dev
```

Bu komut client ve BFF'i birlikte çalıştırır.

```bash
npm run dev:client
npm run dev:server
npm run build
npm run preview
```

Varsayılan portlar:

- Client: `5273`
- BFF/API: `3101`

> Not: VarunaExecutiveCockpit projesi `5173/3001` portlarını kullandığı için bu proje `5273/3101` portlarına alınmıştır. İki proje aynı anda paralel çalışabilir.

## Ortam Değişkenleri

Proje gerçek BFF, Supabase ve Prisma entegrasyonları kullandığı için `.env` dosyası gerektirir.

Beklenen temel değişkenler:

```bash
DATABASE_URL=
DIRECT_URL=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

CRON_SECRET=
OPENAI_API_KEY=
```

`DATABASE_URL` uygulama bağlantısı için, `DIRECT_URL` ise Prisma migration işlemleri için kullanılır.

## Veritabanı Komutları

```bash
npm run db:generate
npm run db:migrate
npm run db:migrate:deploy
npm run db:seed
npm run db:seed:auth
npm run db:studio
npm run db:reset
```

## Proje Yapısı

```txt
src/
  components/ui/           Ortak UI bileşenleri
  features/cases/          Vaka listeleme, form, detay drawer ve case tipleri
  mocks/caseMockData.ts    Geliştirme fallback mock verileri
  services/caseService.ts  Frontend case API servisleri
  services/supabase.ts     Supabase auth/session yardımcıları
  lib/format.ts            Tarih ve format yardımcıları

server/
  index.js                 BFF başlangıç noktası
  app.js                   Express app konfigürasyonu
  routes/cases.js          Case API endpointleri
  db/                      Prisma repository ve auth yardımcıları
  cron/                    Zamanlanmış işler

prisma/
  schema.prisma            Veri modeli
  seed.ts                  Uygulama seed verileri
  seedAuth.ts              Auth seed verileri

scripts/
  test-pattern-alert.js    Pattern alert test scripti
  test-qa-scores.js        QA score test scripti
```

## Ana Özellikler

- Vaka listeleme, filtreleme ve sayfalama
- Yeni vaka oluşturma
- Vaka detay görüntüleme
- Kısmi vaka güncelleme
- Statü geçişleri
- SLA cevap ve çözüm tarihi takibi
- 3rd party bekleme ve SLA duraklatma
- Toplu vaka güncelleme
- Duplicate/open case kontrolü
- Not ekleme
- Not içinde @mention desteği
- Okunmamış mention bildirimleri
- Dosya yükleme, indirme ve silme
- Supabase Storage signed URL upload akışı
- Checklist toggle
- Call log ekleme
- Manuel aktivite ekleme
- Snooze / Inbox Later
- Cron ile snooze wakeup
- Multi-tenant şirket erişim kontrolü
- AI öneri ve kullanım log altyapısı
- Smart QA Lite skor altyapısı
- Pattern alert altyapısı

## API Özeti

Case API ana path'i:

```txt
/api/cases
```

Öne çıkan endpointler:

```txt
GET    /api/cases
POST   /api/cases
GET    /api/cases/:id
PATCH  /api/cases/:id
POST   /api/cases/:id/transition
POST   /api/cases/:id/notes
GET    /api/cases/:id/mentionable-users
POST   /api/cases/:id/mentions/seen
GET    /api/cases/me/mentions/unread
POST   /api/cases/bulk-update
GET    /api/cases/duplicate-check
GET    /api/cases/by-account
GET    /api/cases/snoozed
POST   /api/cases/:id/snooze
DELETE /api/cases/:id/snooze
PATCH  /api/cases/:id/checklist/:itemId
POST   /api/cases/:id/files/upload-url
POST   /api/cases/:id/files/finalize
GET    /api/cases/:id/files/:fileId/download
DELETE /api/cases/:id/files/:fileId
POST   /api/cases/cron/snooze-wakeup
```

Tüm case endpointleri JWT doğrulaması gerektirir. Cron endpoint'i JWT'den önce mount edilir ve `CRON_SECRET` ile korunur.

Detaylı endpoint listesi için [API Dokümantasyonu](docs/API.md) dosyasına bakın.

## Veri Modeli

Ana veri modeli Prisma üzerinde tanımlıdır.

Öne çıkan tablolar:

- `Case`
- `Company`
- `Account`
- `User`
- `UserCompany`
- `Team`
- `Person`
- `SLAPolicy`
- `ChecklistTemplate`
- `CaseActivity`
- `CaseNote`
- `CaseAttachment`
- `CaseMention`
- `CaseReminder`
- `QAScoreLog`
- `PatternAlert`
- `AIUsageLog`

Mimari karar olarak model MSSQL'e taşınabilir kalacak şekilde tasarlanmıştır. Bu nedenle string ID, Prisma enum ve taşınabilir JSON alanları tercih edilmiştir.

## Multi-Tenant Erişim

Kullanıcıların erişebileceği şirketler `UserCompany` kayıtları üzerinden belirlenir. API sorguları `req.user.allowedCompanyIds` ile filtrelenir.

`SystemAdmin` rolündeki kullanıcılar tüm şirketlere erişebilir. Diğer roller yalnızca kendilerine tanımlı şirketlerde işlem yapabilir.

## Dosya Yükleme Akışı

Dosya yükleme üç adımlıdır:

1. BFF'den signed upload URL alınır.
2. Dosya doğrudan Supabase Storage'a yüklenir.
3. BFF'ye finalize çağrısı yapılır ve dosya kaydı veritabanına yazılır.

Bu yapı Vercel request body limitlerini aşmamak için tercih edilmiştir.

## Cron

Snooze edilen vakaları zamanı geldiğinde tekrar aktif hale getirmek için cron endpoint'i bulunur:

```txt
POST /api/cases/cron/snooze-wakeup
```

Endpoint iki header tipini kabul eder:

```txt
Authorization: Bearer <CRON_SECRET>
x-uptime-secret: <CRON_SECRET>
```

`CRON_SECRET` tanımlı değilse endpoint kapalı kabul edilir ve `503` döner.

## Test Scriptleri

```bash
npm run test:pattern
npm run test:qa
```

Bu scriptler sırasıyla pattern alert ve QA score akışlarını kontrol etmek için kullanılır.

## Faz Planı

- [x] Mock UI başlangıç ekranları
- [x] Express BFF entegrasyonu
- [x] Prisma veri modeli
- [x] Supabase Auth entegrasyonu
- [x] Supabase Storage dosya akışı
- [x] Multi-tenant erişim kontrolü
- [x] Vaka listeleme, oluşturma ve detay akışları
- [x] Notes, mentions, files, snooze ve bulk update altyapısı
- [x] API dokümantasyonunun detaylandırılması
- [x] Mimari dokümantasyonun genişletilmesi
- [x] Operasyon/deploy dokümantasyonunun tamamlanması
- [ ] Dashboard ve analitik dokümantasyonu
