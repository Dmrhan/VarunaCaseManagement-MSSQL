# Operations Documentation

Bu dokuman Varuna Case Management uygulamasinin local calistirma, environment, database, deployment, cron ve sorun giderme operasyonlarini ozetler.

## Hizli Baslangic

Local gelistirme icin:

```bash
npm install
npm run dev
```

Bu komut iki sureci birlikte baslatir:

```txt
Client: http://localhost:5273
BFF:    http://localhost:3101
```

Tek tek calistirma:

```bash
npm run dev:client
npm run dev:server
```

Build kontrolu:

```bash
npm run build
```

Production build preview:

```bash
npm run preview
```

## Environment Dosyasi

Local ortamda `.env.example` dosyasini `.env` olarak kopyalayip gercek degerleri gir.

```bash
cp .env.example .env
```

Vercel ortaminda ayni degerler Project Settings -> Environment Variables panelinden tanimlanir.

## Environment Variables

### Backend

Backend tarafinda kullanilan degiskenler:

```bash
DATABASE_URL=
DIRECT_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
OPENAI_API_KEY=
```

| Degisken | Kullanim |
| --- | --- |
| `DATABASE_URL` | Runtime Prisma baglantisi |
| `DIRECT_URL` | Prisma migration icin direct DB baglantisi |
| `SUPABASE_URL` | Backend Supabase client icin project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend auth dogrulama ve storage islemleri |
| `CRON_SECRET` | Cron endpointlerini koruyan secret |
| `OPENAI_API_KEY` | AI endpointleri icin OpenAI key |

### Frontend

Frontend tarafinda Vite prefix'i zorunludur:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

`VITE_SUPABASE_ANON_KEY` browser'a gider. Secret degildir. `SUPABASE_SERVICE_ROLE_KEY` ise sadece backend ortaminda tutulmalidir.

## Supabase Database Baglantisi

Supabase tarafinda iki ayri connection string kullanilir:

```txt
DATABASE_URL -> Transaction pooler, port 6543
DIRECT_URL   -> Direct/session connection, port 5432
```

`DATABASE_URL` runtime sorgular icin kullanilir. Vercel serverless ortaminda pooler kullanmak daha guvenlidir.

`DIRECT_URL` migration icin gerekir. Supabase transaction pooler DDL/migration islemleri icin uygun degildir.

## Prisma Operasyonlari

Prisma client uretmek:

```bash
npm run db:generate
```

Local/dev migration:

```bash
npm run db:migrate
```

Production migration deploy:

```bash
npm run db:migrate:deploy
```

Local/demo seed:

```bash
npm run db:seed
npm run db:seed:auth
```

Dikkat: `db:seed` ve ozellikle `db:seed:auth` yalnizca fresh local/demo veritabanlari icin kullanilmalidir. Production veya shared environment uzerinde calistirma; demo veri, mock vaka kayitlari ve bilinen demo credential'lar olusturabilir.

Prisma Studio:

```bash
npm run db:studio
```

Reset:

```bash
npm run db:reset
```

Dikkat: `db:reset` destructive bir islemdir. Local disinda kullanilmamalidir.

## Ilk Kurulum Sirasi

Yeni local veya demo ortam icin onerilen sira:

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:seed:auth
npm run dev
```

Bu seed akisi yalnizca sifirdan kurulan local/demo DB icindir.

Production veya shared environment icin seed komutlarini calistirma. Sadece migration deploy uygula ve gerekiyorsa ortam icin ozel, denetlenmis bir bootstrap proseduru kullan:

```bash
npm run db:migrate:deploy
```

Production bootstrap gerekiyorsa demo kullanici, bilinen sifre veya mock case data olusturmayan ayri bir operasyon playbook'u hazirlanmalidir.

## Vercel Deployment

`vercel.json` Vite build ve API rewrite kurallarini tanimlar:

```json
{
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" }
  ]
}
```

Serverless entrypoint:

```txt
api/index.js
```

Akis:

```txt
Vite static build -> dist/ -> Vercel CDN
/api/* request -> rewrite -> api/index.js -> Express app -> server/routes/*
```

Production checklist:

- `DATABASE_URL` Vercel env'de tanimli
- `DIRECT_URL` Vercel env'de tanimli
- `SUPABASE_URL` tanimli
- `SUPABASE_SERVICE_ROLE_KEY` tanimli ve frontend'e verilmemis
- `VITE_SUPABASE_URL` tanimli
- `VITE_SUPABASE_ANON_KEY` tanimli
- `CRON_SECRET` guclu rastgele deger
- `OPENAI_API_KEY` AI ozellikleri gerekiyorsa tanimli
- Supabase Auth redirect/origin ayarlari production domain'i iceriyor
- Supabase Storage bucket ve policy ayarlari upload/download akisina uygun
- Migration deploy production DB'ye uygulanmis
- Production uzerinde `db:seed` veya `db:seed:auth` calistirilmamis

## Health Checks

BFF health endpointi:

```txt
GET /api/health
```

Ornek yanit:

```json
{
  "status": "ok",
  "service": "varuna-case-management-bff",
  "time": "2026-05-06T09:00:00.000Z"
}
```

DB-touching health endpointi:

```txt
GET /api/health/deep
```

Bu endpoint DB'ye `SELECT 1` atar. UptimeRobot veya benzeri monitor araclari icin uygundur.

## Cron Operasyonlari

Cron endpointleri JWT kullanmaz. `CRON_SECRET` ile korunur.

Kabul edilen header bicimleri:

```txt
Authorization: Bearer <CRON_SECRET>
x-uptime-secret: <CRON_SECRET>
```

Endpointler:

```txt
POST /api/cases/cron/snooze-wakeup
POST /api/cron/pattern-detect
POST /api/cron/qa-score-batch
POST /api/cron/qa-score
```

### Snooze Wakeup

```txt
POST /api/cases/cron/snooze-wakeup
```

Zamani gelen snooze kayitlarini uyandirir. Tarihsel sebeple `/api/cases` router'i altinda durur.

### Pattern Detect

```txt
POST /api/cron/pattern-detect
```

Son donem vaka yogunlugundan `PatternAlert` kayitlari uretir.

### QA Score Batch

```txt
POST /api/cron/qa-score-batch
```

Kapanmis vakalar icin batch QA scoring calistirir.

### Tek Vaka QA Score

```txt
POST /api/cron/qa-score
```

Body:

```json
{
  "caseId": "case-id"
}
```

Manuel test ve debug icin kullanilir.

## Cron Testleri

Local scriptler:

```bash
npm run test:pattern
npm run test:qa
```

Bu scriptler `.env` dosyasini kullanir. `CRON_SECRET`, DB ve AI env degerlerinin dogru olmasi gerekir.

## Supabase Auth Operasyonlari

Frontend Supabase browser client ile login/session yonetir. Backend her API isteginde access token'i Supabase ile dogrular.

Ilk kez giren kullanici icin backend auto-provision yapabilir:

```txt
Supabase user exists -> local User row missing -> User role Agent olarak olusturulur
```

Person bridging:

- Kullanici email'i aktif bir `Person.email` ile eslesirse `personId` otomatik baglanir.
- Eslesme yoksa `personId` null kalir.
- `personId` null olan kullanicilar bazi "Benim" ve assignment akislarinda bos veri gorebilir.

## Supabase Storage Operasyonlari

Dosya yukleme signed URL akisi ile calisir:

```txt
1. BFF signed upload URL uretir
2. Browser dosyayi dogrudan Supabase Storage'a PUT eder
3. Browser finalize endpointini cagirir
4. BFF DB kaydi ve history log yazar
```

Operasyon kontrol listesi:

- Storage bucket mevcut
- Service role key backend ortaminda tanimli
- Upload URL uretimi calisiyor
- Browser PUT request'i CORS/policy tarafinda engellenmiyor
- Finalize basarili olunca `CaseAttachment` kaydi olusuyor

## AI Operasyonlari

AI endpointleri `/api/ai/*` altindadir.

Gerekli env:

```bash
OPENAI_API_KEY=
```

`OPENAI_API_KEY` yoksa AI endpointleri `503` doner.

AI cagrilari basarili oldugunda `AIUsageLog` kaydi yazilir. Kullanici oneriyi uygular veya yoksayarsa acceptance bilgisi guncellenir.

AI health icin dogrudan health endpoint yoktur. En pratik kontrol, dusuk riskli bir AI endpointini test kullanicisiyla cagirmaktir.

## Monitoring

Onerilen monitor endpointleri:

```txt
GET /api/health
GET /api/health/deep
```

Cron tetikleme dis servisi kullaniliyorsa `CRON_SECRET` header'i eklenmelidir.

Loglarda takip edilecek prefix'ler:

```txt
[bff]
[auth]
[cases]
[admin]
[ai]
[analytics:*]
[cron:*]
[my:*]
```

## Yaygin Hatalar

### Frontend Supabase env eksik

Belirti:

```txt
[supabase] VITE_SUPABASE_URL veya VITE_SUPABASE_ANON_KEY tanimli degil
```

Cozum:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Degerleri local `.env` veya Vercel env paneline ekle.

### Backend Supabase service role eksik

Belirti:

```txt
SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY .env'de yok.
```

Cozum:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Service role key sadece backend ortaminda tanimli olmalidir.

### Migration pooler hatasi

Belirti:

- Migration DDL hatasi
- Supabase pooler uzerinden migration basarisiz

Cozum:

`DIRECT_URL` direct/session connection string olmalidir. Migration icin transaction pooler kullanma.

### Production ortamda demo seed calismis

Belirti:

- Beklenmeyen demo kullanicilar
- Bilinen demo sifreli auth kullanicilari
- Mock case veya lookup verisi

Cozum:

- Etkilenen credential'lari hemen disable veya rotate et.
- Demo kullanicilari ve mock veriyi temizlemeden production'i acma.
- Gerekirse DB snapshot/backup'tan geri don.
- Sonraki bootstrap icin demo seed yerine ortam ozelinde denetlenmis script kullan.

### 401 unauthenticated

Belirti:

```json
{
  "error": "unauthenticated"
}
```

Nedenler:

- Authorization header yok
- Token expired
- Frontend session yok

Cozum:

- Kullanici tekrar login olmali
- Frontend `apiFetch` token ekliyor mu kontrol edilmeli
- Supabase Auth config kontrol edilmeli

### 403 forbidden

Belirti:

```json
{
  "error": "forbidden"
}
```

Nedenler:

- Kullanici ilgili sirketin `allowedCompanyIds` listesinde degil
- Admin endpointi icin rol yetersiz
- Cross-tenant case ID deneniyor

Cozum:

- `UserCompany` kayitlarini kontrol et
- Kullanici rolu ve company role atamalarini kontrol et
- `SystemAdmin` gerekiyorsa local `User.role` dogru mu bak

### Cron 503 donuyor

Belirti:

```json
{
  "error": "cron_disabled"
}
```

Cozum:

```bash
CRON_SECRET=
```

Production ortaminda guclu rastgele bir secret tanimla.

### Cron 401 donuyor

Neden:

Header'daki secret, env'deki `CRON_SECRET` ile eslesmiyor.

Dogru header:

```txt
Authorization: Bearer <CRON_SECRET>
```

veya:

```txt
x-uptime-secret: <CRON_SECRET>
```

### AI 503 donuyor

Neden:

`OPENAI_API_KEY` tanimli degil.

Cozum:

```bash
OPENAI_API_KEY=
```

### AI 429 donuyor

Neden:

IP bazli rate limit asilmis.

Cozum:

Bir sure bekle veya testleri daha dusuk siklikta calistir.

### Dosya upload finalize olmuyor

Kontrol listesi:

- `upload-url` endpointi 200 donuyor mu?
- Browser Storage PUT request'i basarili mi?
- `finalize` body icinde `attachmentId`, `path`, `fileName`, `fileSize`, `mimeType` var mi?
- Storage bucket policy/CORS izinleri uygun mu?
- Service role key backend'de mevcut mu?

## Debug Komutlari

Build:

```bash
npm run build
```

DB client generate:

```bash
npm run db:generate
```

Migration deploy dry-run alternatifi yoktur; production oncesi staging DB'de denenmelidir:

```bash
npm run db:migrate:deploy
```

Pattern alert test:

```bash
npm run test:pattern
```

QA score test:

```bash
npm run test:qa
```

Health check:

```bash
curl http://localhost:3101/api/health
curl http://localhost:3101/api/health/deep
```

Cron manuel test:

```bash
curl -X POST http://localhost:3101/api/cron/pattern-detect \
  -H "x-uptime-secret: $CRON_SECRET"
```

QA tek vaka manuel test:

```bash
curl -X POST http://localhost:3101/api/cron/qa-score \
  -H "content-type: application/json" \
  -H "x-uptime-secret: $CRON_SECRET" \
  -d '{"caseId":"case-id"}'
```

## Release Checklist

Kod veya schema degisikligi iceren release icin:

- `npm run build` basarili
- Prisma migration dosyalari commitlenmis
- `npm run db:migrate:deploy` staging ortamda denenmis
- Production/shared ortamda `db:seed` veya `db:seed:auth` calistirilmeyecegi onaylanmis
- Production bootstrap gerekiyorsa demo veri/credential olusturmayan ayri prosedur hazirlanmis
- Yeni env degiskenleri `.env.example` ve Vercel env panelinde mevcut
- Auth/tenant etkisi olan degisikliklerde Admin ve Agent kullanicilarla smoke test yapilmis
- Dosya upload degisikligi varsa upload, download ve delete akislari test edilmis
- AI degisikligi varsa `AIUsageLog` yazimi ve acceptance update kontrol edilmis
- Cron degisikligi varsa manuel cron endpoint testi yapilmis
- README ve docs gerekirse guncellenmis

Documentation-only release icin build check yeterlidir.

## Ilgili Dokumanlar

- `README.md`: Proje ozeti ve gelistirme komutlari
- `docs/API.md`: Endpoint dokumantasyonu
- `docs/ARCHITECTURE.md`: Sistem mimarisi ve tasarim kararlari
- `.env.example`: Environment template
- `prisma/schema.prisma`: Veri modeli
