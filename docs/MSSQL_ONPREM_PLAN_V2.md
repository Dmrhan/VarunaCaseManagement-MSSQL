# On-Prem MSSQL Geçiş Planı (v2)

Tarih: 2026-06-11
Kapsam: Supabase (DB + Auth + Storage) ve Vercel bağımlılıklarının tamamen kaldırılıp
uygulamanın Windows Server üzerinde MSSQL ile self-hosted çalıştırılması.

Bu plan, kod tabanının fiilî analizine dayanır ve `ONPREM_MSSQL_MIGRATION_PLAN.md`
dokümanının yerine geçer. Önceki plandan temel farklar:

- **Adapter fazı yok.** Bu repo ayrı bir fork olduğu için Supabase'i geçici olarak
  adapter arkasında yaşatmak gereksiz efor; doğrudan değişim yapılır.
- **Enum ve Json gerçeği.** Prisma'nın `sqlserver` connector'ı **enum** ve **Json**
  tiplerini desteklemez. Şemadaki "MSSQL geçişinde sadece provider değişir" varsayımı
  geçersizdir; şema dönüşümü bu planın en büyük iş kalemidir.

## Alınan Kararlar

| Konu | Karar |
|---|---|
| Auth | Local e-posta/şifre + bcrypt + uygulamanın ürettiği JWT (access + refresh) |
| Kullanıcı oluşturma | Admin panelinden başlangıç şifresiyle oluşturulur; e-posta/davet akışı YOK. Kullanıcı şifresini kendi kullanıcı ayarlarından değiştirir. |
| Şifre unutma | Admin, kullanıcıya yeni geçici şifre atar (panelden). `mustChangePassword` bayrağı ile ilk girişte değişim zorlanabilir. |
| Storage | Local disk; upload/download BFF üzerinden yetkili endpoint'lerle (multer mevcut) |
| Deployment | Windows Server; Node süreci Windows Service olarak (nssm veya pm2) |
| Migration geçmişi | 56 Postgres migration'ı atılır; tek MSSQL **baseline** migration üretilir |
| Veri taşıma | Kapsam dışı (boş DB + seed ile başlanır); gerekirse ayrı runbook |
| Google OAuth | Kaldırılır (ileride OIDC olarak eklenebilir) |

## Kritik Teknik Bulgular (analiz çıktısı)

1. **39 Prisma enum** (28'i Türkçe `@map` değerli) → `String` alana dönüştürülecek.
   `server/db/enumMap.js` TR↔ASCII dönüşümünü zaten yapıyor; DB'de ASCII identifier
   saklanacak, doğrulama CHECK constraint + uygulama katmanıyla sağlanacak.
2. **21 `Json` alanı** → `String @db.NVarChar(Max)`; repository katmanında
   `JSON.parse/stringify` sarmalayıcısı gerekecek.
3. **Raw SQL:** `server/analytics/operationsAggregator.js` 6 sorguda Postgres'e özgü
   `FILTER (WHERE ...)`, `ANY($n::text[])`, `::timestamp` kullanıyor → MSSQL'e
   (CASE WHEN / IN / CAST) elle çevrilecek. `server/app.js` health check (`SELECT 1`) sorunsuz.
4. **Nullable unique (3 adet):** `CaseSolutionStep(caseId,source,sourceRef)`,
   `NotificationDispatch.idempotencyKey`, `ActionItem.dedupKey` — MSSQL'de unique
   index birden fazla NULL kabul etmez → filtered unique index gerekir.
5. **Cascade döngüleri:** MSSQL "multiple cascade paths" hatası verebilir; baseline
   migration sırasında çıkan ilişkiler `onDelete: NoAction` yapılıp silme mantığı
   uygulama/transaction katmanına alınır.
6. **Türkçe arama:** 26 yerde `mode: 'insensitive'`; DB collation **Turkish_CI_AS**
   seçilecek, `server/utils/turkishSearch.js` varyant üretimi korunacak.
7. **Auth bugün:** backend her istekte Supabase `auth.getUser(token)` çağırıyor;
   `User.id` = Supabase UUID. Local JWT'de `verifyJwt` lokal imza doğrulamasına geçer,
   `req.user` shape'i ve `allowedCompanyIds`/`companyRoles` aynen korunur.
8. **Storage bugün:** tarayıcı signed URL'e doğrudan PUT ediyor; local disk modelinde
   upload BFF endpoint'i üzerinden olur (25MB limit, `uploadWhitelist` korunur).
9. **Cron:** 5 job (`snooze-wakeup`, `pattern-detect`, `qa-score-batch`,
   `notification-cleanup`, `actionitem-archive`) HTTP endpoint + harici tetikleyici
   (UptimeRobot/GH Actions) ile çalışıyor → `node-cron` ile sürece gömülecek.
   Fonksiyonlar zaten ayrık modüllerde, HTTP endpoint'ler manuel tetik için kalabilir.
10. **Hosting:** Express `dist/` serve etmiyor (Vercel yapıyordu) → static serving +
    SPA fallback eklenecek; `api/index.js`, `vercel.json`, `.vercelignore` kaldırılacak.
11. **Script taşınabilirliği:** `scripts/smoke-data-contracts.js` ve
    `scripts/seed-univera-smart-ticket-taxonomies.js` içinde hardcoded macOS path var.

## Mevcut MSSQL Veritabanı Durumu (2026-06-11 incelemesi)

Hedef DB el ile (DB-first) oluşturulmuş durumda: `DEMOCLES\YAZDES` (SQL Server 2019,
15.0.4360.2), database `VarunaCaseManagement`, collation **Turkish_100_CI_AS_SC_UTF8**.
Bağlantı named instance üzerinden: `10.135.140.17\yazdes` (port 1433 varsayılan
instance'a gidiyor ve orada UNIVERA hesabı devre dışı).

Tespitler:

- **52 tablo** mevcut, tamamı boş (0 satır). Adlandırma Prisma modelleriyle birebir.
- Enum kolonları `nvarchar(50)` + **ASCII identifier** değerler (örn. `N'Acik'`) —
  planın enum→String yaklaşımıyla tam uyumlu; `enumMap.js` değişmeden hedefe oturur.
- JSON alanları `nvarchar(max)`, ID'ler `nvarchar(450)`, tarihler `datetime2` +
  `sysutcdatetime()` default. 67 FK, 143 default, 71 unique index, 19 CHECK constraint
  (kritik enum kolonları için; tümü için değil — kalan doğrulama uygulama katmanında).
- **Eksik 2 tablo:** `TaxonomyDef` ve `CaseSolutionStep` (Smart Ticket taksonomi /
  çözüm adımları — şemanın daha yeni eklentileri).
- **Eksik unique index'ler:** `ActionItem.dedupKey` ve `NotificationDispatch.idempotencyKey`
  üzerinde unique index yok (uygulama dedup/idempotency için bunlara güveniyor) —
  filtered unique index (`WHERE col IS NOT NULL`) olarak eklenecek.
- `User` tablosunda henüz auth kolonları yok (`passwordHash` vb. Faz 3'te eklenecek).
- `_prisma_migrations` tablosu yok — şema Prisma dışında oluşturulmuş.

Strateji kararı: Repo'daki `schema.prisma` sqlserver'a dönüştürüldükten sonra
`prisma migrate diff --from-url <DB> --to-schema-datamodel` ile canlı DB ve hedef şema
arasındaki fark SQL'i üretilir; eksik tablolar/index'ler bu diff ile kapatılır ve
mevcut DB baseline olarak işaretlenir (`prisma migrate resolve`). Böylece bundan
sonraki şema değişiklikleri Prisma migrate ile yönetilir.

## Fazlar

### Faz 1 — Şema dönüşümü ve MSSQL baseline

**Durum: TAMAMLANDI (2026-06-11).** Notlar:

- Şema dönüşümü `scripts/convert-schema-mssql.mjs` + `-pass2` + `fix-annotation` ile
  yapıldı; kolon uzunlukları eski el yapımı DB'den (scripts/mssql-columns.csv) alındı.
- El yapımı 52 tablo (boş, kullanıcı onayıyla) drop edilip tek baseline migration
  (`prisma/migrations/00000000000000_init`) ile 54 tablo kanonik adlarla kuruldu;
  19 CHECK constraint baseline'a gömüldü, `migrate status` temiz.
- Nullable kolonlu **8 unique** filtered index'e çevrildi (3 bilinen + Account.tcknHash,
  Account.vkn, AccountCompany.externalCustomerCode, AccountProduct.productCode,
  User.personId). Prisma şemada `@unique` duruyor (client API için); DB'de filtered.
  Gelecek `migrate dev` bunları drift sanabilir → `--create-only` ile gözden geçir.
- `yazdes` named instance dinamik portta (50404) — Prisma instance adı çözemez,
  porta bağlanıyor. Statik port sabitlenmeli (kurulum dokümanına girecek).
- `prisma/seed.ts` 4 noktada JSON.stringify'a çevrildi ve MSSQL'de yeşil
  (150 vaka dahil). `seedScenarios.ts` demo kullanıcılara bağımlı → Faz 3'te
  seedAuth local auth'a geçince çalışacak. `smoke-mssql-schema.js` (8 kontrol) yeşil.
- `npm run build` yeşil.

En riskli iş önce: şema MSSQL'de ayağa kalkmadan diğer fazların anlamı yok.

- `provider = "sqlserver"`, `directUrl` kaldırılır, `DATABASE_URL` MSSQL formatına geçer.
- 39 enum → `String`; enum tanımları silinir, alanlara yorumla geçerli değer seti yazılır.
- `enumMap.js` güncellenir: DB artık ASCII identifier saklar (TR `@map` değerleri değil).
  Forward/reverse dönüşüm (TR app-string ↔ ASCII) aynen kalır.
- 21 `Json` → `String @db.NVarChar(Max)`; `server/db/jsonField.js` (yeni) parse/stringify
  helper'ı; tüm repository'lerde Json okuma/yazma noktaları bu helper'a bağlanır.
- 3 nullable-unique → baseline SQL'de filtered unique index'e çevrilir.
- Cascade döngüsü çıkan ilişkiler `NoAction` + uygulama katmanı silme.
- `prisma/migrations/` boşaltılır; `prisma migrate dev` ile tek baseline üretilir.
- DB collation `Turkish_CI_AS` ile oluşturulur.
- Kabul: `prisma validate`, `prisma generate`, `migrate deploy` boş MSSQL'de yeşil;
  `seed.ts` + `seedScenarios.ts` çalışır (seedAuth.ts Faz 3'te değişir).

### Faz 2 — Runtime uyumu

- `operationsAggregator.js` 6 raw sorgunun MSSQL'e çevrimi; analytics ekranı doğrulanır.
- Json alanı kullanan tüm akışların (Case, ImportJob, NotificationRule, ActionItem,
  TaxonomyDef, FieldDefinition...) okuma/yazma smoke'ları.
- Türkçe arama testi (İ/ı, Ş/ş) gerçek MSSQL collation üzerinde.
- Import (Customer360 XLSX) commit/rollback transaction akışı doğrulanır.
- Kabul: case create/list/detail/update, account arama, Smart Ticket create/close/transfer
  ve ilgili smoke scriptleri lokal MSSQL'de yeşil.

### Faz 3 — Auth değişimi

- `User` modeline `passwordHash`, `mustChangePassword`, `passwordUpdatedAt` eklenir;
  `User.id` artık `cuid()` (Supabase UUID bağı kopar).
- Yeni endpoint'ler: `POST /api/auth/login`, `POST /api/auth/refresh`,
  `POST /api/auth/logout`, `POST /api/auth/change-password`. `GET /api/auth/me` korunur.
- `verifyJwt` lokal HS256 doğrulamasına geçer (`JWT_SECRET`); `req.user` shape'i,
  `isActive` bariyeri, `allowedCompanyIds`, `requireRole` aynen korunur.
- Admin akışları: davet yerine **şifreli kullanıcı oluşturma** (`fullName`, e-posta, rol,
  şirket, başlangıç şifresi, `mustChangePassword=true`); "şifre sıfırla" = admin yeni
  geçici şifre atar. `inviteUserByEmail`/`resetPasswordForEmail`/orphan-recovery silinir.
- Frontend: `supabase.ts` kaldırılır; `AuthContext` login/refresh/logout'u BFF'e bağlar
  (token localStorage + refresh rotation); `LoginPage` sadeleşir (Google butonu kalkar);
  `SetPasswordPage` → kullanıcı ayarlarında "şifre değiştir" + ilk giriş zorunlu değişim.
- `seedAuth.ts` bcrypt hash ile doğrudan DB'ye kullanıcı yazar.
- Yeni bağımlılıklar: `bcryptjs` (veya `bcrypt`), `jsonwebtoken`.
- Kabul: login → me → rol bazlı yetki → tenant scope → admin kullanıcı CRUD →
  şifre değiştirme uçtan uca; Supabase auth env'leri olmadan çalışır.

### Faz 4 — Storage değişimi (local disk)

- `server/db/storage.js` yeniden yazılır: `STORAGE_ROOT` (örn. `D:\varuna-data\attachments`)
  altında `cases/{caseId}/{attachmentId}-{safeName}`.
- Upload: `POST /api/cases/:id/files/upload` (multer, 25MB limit, whitelist korunur) —
  signed-URL + finalize iki adımı tek yetkili endpoint'e iner; `caseService.ts` buna uyarlanır
  (progress için XHR korunabilir).
- Download: `GET .../files/:fileId/download` dosyayı stream eder (Content-Disposition).
- Silme: DB kaydı + disk dosyası; disk hatası warning olarak loglanır (mevcut davranış).
- `CaseAttachment` modeli değişmez (`fileUrl` = relative path).
- Kabul: aynı UI ile yükle/indir/sil + history kayıtları çalışır.

### Faz 5 — On-prem hosting ve temizlik

- Express `dist/` static serving + SPA fallback (`server/app.js`).
- `server/cronScheduler.js` (node-cron): 5dk snooze-wakeup, 15dk pattern-detect,
  gece 02:00 qa-score-batch, günlük cleanup/archive; HTTP cron endpoint'leri
  `CRON_SECRET` ile manuel tetik için kalır.
- `@supabase/supabase-js` kaldırılır; `api/`, `vercel.json`, `.vercelignore` silinir;
  `VERCEL` env kontrolleri temizlenir; CORS `CORS_ORIGIN` env'ine bağlanır.
- 2 script'teki hardcoded path düzeltilir.
- `.env.example` yeni şemaya göre yazılır (aşağıda).
- Windows Service kurulumu (nssm/pm2) + kurulum dokümanı `docs/ONPREM_INSTALL.md`.
- Kabul: temiz Windows Server'da dokümana göre kurulum yapılabilir; uygulama
  Supabase/Vercel'siz, tek serviste (UI + API + cron) çalışır.

### Faz 6 — Uçtan uca doğrulama

- Senaryo: login → account arama → case create/update → Smart Ticket create/close/transfer →
  dosya yükle/indir → admin kullanıcı oluştur/deaktive et → analytics ekranı → cron tetikleri.
- `npm run build` + kritik smoke suite yeşil.
- Bilinen sınırlamalar ve işletim notları dokümante edilir.

## Hedef Environment

```txt
# DB
DATABASE_URL="sqlserver://HOST:1433;database=VarunaCM;user=...;password=...;encrypt=true;trustServerCertificate=true"

# Auth
JWT_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRY=30m
JWT_REFRESH_EXPIRY=7d

# Storage
STORAGE_ROOT=D:\varuna-data\attachments

# App
PORT=3101
APP_URL=
CORS_ORIGIN=
CRON_SECRET=
TCKN_HASH_PEPPER=

# Harici (değişmez)
OPENAI_API_KEY=
EXTERNAL_KB_API_KEY=
```

Kaldırılan env'ler: `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_INVITE_REDIRECT_URL`.

## Riskler

| Risk | Etki | Önlem |
|---|---|---|
| Enum→String geçişinde gözden kaçan değer uyumsuzluğu | Yüksek | enumMap tek doğruluk kaynağı + CHECK constraint + smoke |
| Json parse katmanında atlanan okuma/yazma noktası | Yüksek | Faz 1'de tüm `Json` alan referansları grep ile envanterlenir, helper zorunlu kılınır |
| Cascade `NoAction` sonrası yetim kayıt/silme hatası | Orta | Silme akışları transaction içinde explicit child delete |
| Raw SQL çevrimlerinde sonuç farkı | Orta | Postgres/MSSQL çıktı karşılaştırmalı test (seed verisiyle) |
| Refresh token güvenliği (localStorage) | Orta | Kısa access TTL + refresh rotation; ileride httpOnly cookie'ye geçilebilir |
| Tek süreçte cron + API (restart'ta job kaçırma) | Düşük | Job'lar idempotent (mevcut tasarım); service auto-restart |

## Önerilen PR Sırası

1. `PR-1` Şema dönüşümü + baseline migration + enumMap/jsonField katmanı (Faz 1)
2. `PR-2` Raw SQL çevrimi + runtime smoke düzeltmeleri (Faz 2)
3. `PR-3` Backend local auth (endpoint'ler + verifyJwt + admin akışları + seedAuth) (Faz 3a)
4. `PR-4` Frontend auth değişimi (Faz 3b)
5. `PR-5` Local disk storage (Faz 4)
6. `PR-6` Hosting/cron/temizlik + kurulum dokümanı (Faz 5)
7. `PR-7` E2E doğrulama düzeltmeleri (Faz 6)
