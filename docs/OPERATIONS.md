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
TCKN_HASH_PEPPER=
```

| Degisken | Kullanim |
| --- | --- |
| `DATABASE_URL` | Runtime Prisma baglantisi |
| `DIRECT_URL` | Prisma migration icin direct DB baglantisi |
| `SUPABASE_URL` | Backend Supabase client icin project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend auth dogrulama ve storage islemleri |
| `CRON_SECRET` | Cron endpointlerini koruyan secret |
| `OPENAI_API_KEY` | AI endpointleri icin OpenAI key |
| `TCKN_HASH_PEPPER` | **KVKK (Individual musteri kayitlari icin zorunlu).** 16+ karakterlik random secret (production: `openssl rand -hex 32`). `server/utils/accountValidation.js::hashTckn` plain TCKN'i HMAC-SHA256 ile hash'ler; pepper bu HMAC'in anahtaridir. Atlanirsa veya 16 haneden kisaysa **Individual musteri create / update** akislari (TCKN ile) `400 tckn_pepper_missing` doner (safe-fail; plain TCKN asla saklanmaz). Okuma/listeleme/search bu hata kodunu fırlatmaz. Rotation: **forward-only** — eski hash'ler eski pepper'la sealed kalir. Runbook: `docs/TECHNICAL_DEBT.md §"TCKN pepper rotation owner / runbook"`. |

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

Demo seed:

```bash
npm run db:seed
npm run db:seed:auth
npm run db:seed:scenarios
```

- `db:seed` — mock veri (sirketler/musteriler/orneklem vakalar)
- `db:seed:auth` — demo personalar (Agent/Supervisor/CSM/Backoffice/Admin/SystemAdmin, sifre demo1234)
- `db:seed:scenarios` — Univera/Finrota/PARAM senaryo verisi (Watcher, Linked, Reply/Reaction, AI Status Report, Customer Pulse, Multi-tenant). Idempotent — tekrar calistirmak guvenli.

`db:seed` / `db:seed:auth` / `db:seed:scenarios` — fresh local, demo veya sandbox veritabanlari icin kullanilabilir. Ekiplerin uygulama akisini test amaciyla gorecegi paylasilmi demo ortamlarinda da uygundur, ancak bu ortamlar gercek musteri verisi tasimamali ve production ile ayni Supabase projesini/DB'yi kullanmamalidir.

Production veya gercek veri tasiyan shared environment uzerinde **asla** calistirmayin; demo veri, mock vaka kayitlari ve bilinen demo credential'lar olusturabilir. Senaryo seed'i `DEMO-` prefix'li ID kullanir — yalnislikla prod'da calisirsa bile arama/filtre ile temizlenebilir, ancak yine de **once .env'inin prod olmadigini dogrulayin**.

Detayli senaryo rehberi: [docs/TEST_SCENARIOS.md](TEST_SCENARIOS.md).

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

Yeni local, demo veya sandbox ortam icin onerilen sira:

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:seed:auth
npm run dev
```

Bu seed akisi yalnizca sifirdan kurulan local/demo/sandbox DB icindir. Ekip testleri icin paylasimli demo ortam kurulacaksa once ayri Supabase project veya ayri non-production DB kullanildigini dogrula.

Production veya gercek veri tasiyan shared environment icin seed komutlarini calistirma. Sadece migration deploy uygula ve gerekiyorsa ortam icin ozel, denetlenmis bir bootstrap proseduru kullan:

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

### Environment Variables Checklist

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

### On-Prem (PM2) Deploy — kanonik

On-prem MSSQL kurulumunda kanonik komut:

```bash
npm run deploy:onprem
```

İçeride [`scripts/deploy-onprem.mjs`](../scripts/deploy-onprem.mjs) sırayı
yönetir: `pm2 stop → git pull → npm ci → migrate deploy → build → pm2 start`.

**KRİTİK SIRA:** `service stop → mutate → service start`. Üç kural birlikte:

1. **Migration mutlaka yeni process başlamadan ÖNCE bitmiş olmalı**;
   aksi halde Prisma Client yeni alanları select edip P2022
   (`column does not exist`) ile çakar.
2. **`npm ci` ve `npm run build` live tree'yi mutate eder** — Express
   `dist/`'i serve eder ve KB lazy-import'ları `node_modules/`'tan paket
   çeker. Service ayaktayken yarım/eksik dosyalara çakar (codex review
   bulgusu). Service önce DURUR, sonra mutate, sonra START.
3. **PM2 stop verify** (Codex P2): `pm2 stop` exit'i yetersiz — daemon
   problemi / permission / yanlış user durumlarında stop fail ama service
   ÇALIŞIYOR olabilir. Script `pm2 jlist` ile state doğrular; "online"
   veya "launching" durumda mutate İPTAL (exit 3) — live tree dokunulmaz.

4. **Real rollback** (Codex P1): mutate fail durumunda script:
   - `git reset --hard <oldHead>` — kaynak eski revizyona döner
   - `dist/` backup'tan restore
   - `npm ci` tekrar koşulur (eski package-lock)
   - Sonra `pm2 start` eski state ile ayağa kalkar

   Eski script "start her durumda" pattern'i CHIMERA state'e yol açıyordu
   (yeni kaynak + eski dist + yarım migrate). Yeni script gerçek restore
   yapar.

   > **Migration caveat**: Prisma migrate forward-only. Migrate başarılı +
   > sonraki adım fail durumunda schema YENİ kaldı, code ESKİ döner. Pratikte
   > sorunsuz çünkü migration'lar nullable column addition pattern'ine uyar
   > (Faz 3 örneği). Breaking change varsa manuel rollback gerekir.

   Çıkış kodları:
   - `0` — yeni build canlıda
   - `1` — mutate fail, ESKİ state restore edildi, servis çalışıyor
   - `2` — KRİTİK: `pm2 start` fail; manuel müdahale gerek
   - `3` — pre-flight fail (pm2 still online / git rev-parse fail);
     mutate başlamadı, hiçbir şey değişmedi

**Downtime**: build + npm ci süresi kadar (~30-120 sn). Pure zero-downtime
gerekiyorsa bkz. "Zero-downtime atomic release — opsiyonel" altta.

> **Sadece `db:migrate:deploy` kullanılır.** Prod'da `db:migrate` (= `prisma
> migrate dev`), `db:reset`, `prisma db push` **YASAK** — schema drift +
> veri kaybı riski. `migrate deploy` idempotent + non-destructive (pending
> migration yoksa no-op, her deploy'da güvenli).

PM2 app adı `varuna-cm` ([ecosystem.config.cjs](../ecosystem.config.cjs)).
Sunucu nssm ile yönetiliyorsa (Windows Service `VarunaCM`) bkz.
[docs/IIS_DEPLOY.md §6.b](IIS_DEPLOY.md) — aynı stop→mutate→start sırası,
sadece komut adı farklı (`nssm stop VarunaCM` / `nssm start VarunaCM`).

#### Zero-downtime atomic release — opsiyonel

Stop→build→start akışında ~30-120 sn kesinti var. Sıfır kesinti gerekiyorsa
Capistrano-stili atomik release pattern uygulanabilir (bu repo'da default
değil; ileri seviye operasyon):

```
/apps/varuna-cm/
  current → releases/20260623-1530   (symlink)
  releases/
    20260623-1530/   ← yeni deploy hedefi
    20260622-1100/
    20260621-0900/
  shared/
    .env, data/, logs/   (release'ler arası paylaşılır)
```

Adımlar:
1. Yeni `releases/<timestamp>` dir'a clone/checkout
2. `shared/.env` + `shared/data` + `shared/logs` symlink'le
3. Yeni release dir'da `npm ci && npm run build`
4. `npm run db:migrate:deploy` (DB shared — current process bunu yaşayabilir
   *eğer* yeni migration backward-compatible ise; değilse stop→start akışı
   zorunlu)
5. `ln -sfn releases/<timestamp> current` (atomik symlink swap)
6. `pm2 reload varuna-cm` (yeni `current`'a graceful geçiş)
7. Eski release'ler temizlik (keep last 3)

Bu pattern PowerShell/Windows'ta `ln` yerine `mklink /J` veya `New-Item
-ItemType Junction` ile yapılır; kurulum bu repo'nun standartı değildir
ama gerekirse [planlanabilir](BACKLOG.md).

### Production Deploy Checklist (Vercel)

Schema degisikligi (yeni migration) iceren PR'lar icin uygulama siralamasi
asagidaki gibidir. `npm run build` icinde **otomatik migrate calistirilmaz**:
bunun nedeni preview/local build'lerin yanlislikla production DB'ye DDL
yazmasini engellemek + build failure'larinda schema-deployment drift'ini
onlemektir (bkz. "Migration neden build'e gomulmedi" bolumu).

1. **Deploy / app build** — Vercel `npm run build` (`tsc -b && vite build`).
   Build yesilse Vercel yeni deployment'i hazirlar.
2. **Production DB'ye migration uygula** — yeni migration varsa local'den
   (veya CI release adimindan) production `DATABASE_URL`/`DIRECT_URL`
   ile:

   ```bash
   npm run db:migrate:deploy
   ```

   `prisma migrate deploy` idempotent + non-destructive — sadece pending
   migration'lari uygular. Yoksa sessiz cikar.

3. **Health verify** — yeni deployment + schema canli:

   ```bash
   curl https://<prod-domain>/api/health/deep
   ```

   `{"status":"ok","db":"reachable"}` dondugunden emin ol.

4. **Smoke test** — yeni feature endpoint'lerine kisa bir istek at:

   ```bash
   curl -H "Authorization: Bearer <token>" \
        https://<prod-domain>/api/cases/<id>/watchers
   ```

   Eski deployment hala servis ediyorsa migration tablosu/sutunu eksik
   olabilir (rollback gerekebilir).

5. **Production uzerinde `db:seed`, `db:seed:auth` veya `db:seed:scenarios` calistirma** — bu
   komutlar yalniz local/demo ortamlari icindir (bkz. AI_WORKFLOW Seed
   Safety bolumu).

### Migration neden build'e gomulmedi

`prisma migrate deploy` `npm run build` icine konursa:

- **Preview build'leri** ayni `DATABASE_URL`'i kullanir ve production DB'ye
  DDL yazabilir. Preview, deploy edilmeden silinen "throwaway" bir
  ortamdir; ona ait olmayan bir migration prod schema'sini mutate eder.
- **Build failure** durumunda schema mutate edilmis ama uygulama henuz
  promote edilmemis kalir. Backward-incompatible migration'larda eski
  deployment yeni schema ile bozulur.
- **Local `npm run build`** yanlislikla prod migration calistirabilir.

Bu nedenle migration `db:migrate:deploy` ayri script olarak tutulur ve
release surecinin **build'i takip eden** bilincli bir adimi olarak
calistirilir.

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

### Notification Cleanup

```txt
POST /api/cron/notification-cleanup
```

`readAt NOT NULL` ve **30 gunden eski** `CaseNotification` satirlarini siler.
Okunmamis bildirimler (`readAt = null`) korunur. Idempotent.

Response:

```json
{ "ok": true, "deleted": 42, "cutoff": "2026-04-12T00:00:00.000Z" }
```

Periyot: **gunluk 03:00 UTC** — `.github/workflows/notification-cleanup.yml`
GitHub Actions workflow'u tarafindan tetiklenir (qa-score-batch 02:00
UTC'den sonra calisir, snooze-wakeup */5dk ile cakismaz). Manuel
tetiklemek icin: GitHub Actions UI → "Notification Cleanup Cron"
workflow → "Run workflow" (workflow_dispatch). Auth pattern: ayni
`x-uptime-secret: ${{ secrets.CRON_SECRET }}` header'i (digger 3 cron
workflow'uyla ayni).

### ActionItem Archive

```txt
POST /api/cron/actionitem-archive
```

OD-073 retention politikasi — terminal state'teki ActionItem'lara
(Done/Dismissed/Expired) `updatedAt` 30 gunden eskiyse
`archivedAt = now()` set eder. **Hicbir satir DELETE edilmez** (soft
archive); deep-link / audit replay senaryolarinda `findUnique`
calismaya devam eder. Aktif inbox queries (`listForUser`,
`summaryForUser`, `computeBadgeCounts`, MyHome pendingApprovals)
`archivedAt: null` filtresiyle archived satirlari gizler. Idempotent.

Response:

```json
{ "ok": true, "archived": 17, "cutoff": "2026-04-28T03:20:00.000Z" }
```

Periyot: **gunluk 03:20 UTC** — `.github/workflows/actionitem-archive.yml`
GitHub Actions workflow'u tarafindan tetiklenir (notification-cleanup
03:00 UTC'den sonra). `workflow_dispatch` ile manuel tetik mevcut.
Auth pattern: digger cron'larla ayni `x-uptime-secret`.

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

Kod veya schema degisikligi iceren release icin (degisiklik tipi
basina gerekli kapilarin tam listesi: [docs/QUALITY_GATES.md](QUALITY_GATES.md)):

- `npm run build` basarili
- Prisma migration dosyalari commitlenmis
- `npm run db:migrate:deploy` staging ortamda denenmis
- Production veya gercek veri tasiyan shared ortamda `db:seed` / `db:seed:auth` calistirilmeyecegi onaylanmis
- Demo/sandbox ortamda seed gerekiyorsa ortamın production'dan izole oldugu ve gercek musteri verisi tasimadigi dogrulanmis
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
- `docs/QUALITY_GATES.md`: Degisiklik tipi basina zorunlu kapilar matrisi
- `docs/AI_WORKFLOW.md`: AI ajan disiplini, review checklist, smoke gate kullanimi
- `.env.example`: Environment template
- `prisma/schema.prisma`: Veri modeli
