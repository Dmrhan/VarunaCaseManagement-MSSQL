# On-Prem MSSQL Migration Plan

## 1. Amaç

Bu doküman Varuna Case Management uygulamasını Supabase tabanlı bulut mimarisinden,
on-premise çalışabilen MSSQL tabanlı bir mimariye taşımak için yol haritasını tanımlar.

Hedef sadece veritabanını değiştirmek değildir. Mevcut sistemde Supabase üç ayrı rol
üstlenmektedir:

- Veritabanı: Supabase Postgres + Prisma
- Kimlik doğrulama: Supabase Auth + JWT doğrulama
- Dosya saklama: Supabase Storage + signed upload URL

Bu nedenle geçiş DB, Auth ve Storage bağımlılıkları ayrıştırılarak yapılmalıdır.

## 2. Hedef Mimari

İlk hedef mimari:

- Frontend: React / Vite
- Backend: Express BFF
- ORM: Prisma
- DB: Microsoft SQL Server
- Auth: Supabase dışı, değiştirilebilir auth provider
- Storage: Supabase dışı, değiştirilebilir storage provider
- Deployment: Windows Server veya Linux sunucu üzerinde on-prem kurulum

Önerilen provider seçenekleri:

| Katman | Kısa vadeli seçenek | Uzun vadeli öneri |
|---|---|---|
| Database | MSSQL Server | MSSQL Server |
| Auth | Local email/password + JWT | OIDC / Keycloak / Azure AD / AD entegrasyonu |
| Storage | MinIO veya local filesystem | MinIO / S3-compatible / Azure Blob |
| Background jobs | Node cron / Windows Task Scheduler | Worker service + job table |

## 3. Kapsam Dışı

İlk geçiş fazında aşağıdakiler kapsam dışıdır:

- Ürün fonksiyonlarını yeniden tasarlamak
- Smart Ticket iş akışını değiştirmek
- Yeni raporlama modülü yapmak
- Veri temizliği veya müşteri dedup operasyonu yapmak
- Existing production data migration uygulamak
- Supabase bağımlılıklarını tek PR'da topluca silmek

Production data migration ayrı bir cutover planı gerektirir.

## 4. Mevcut Supabase Bağımlılık Haritası

### 4.1 Database

Ana dosyalar:

- `prisma/schema.prisma`
- `prisma/migrations/*`
- `server/db/client.js`
- `server/db/*Repository.js`
- `scripts/*smoke*.js`
- `prisma/seed*.ts`

Mevcut schema taşınabilirlik için zaten kısmen hazırlanmıştır:

- String ID + `cuid()`
- Prisma enum kullanımı
- JSON alanlarının application-layer kullanımı
- Repository pattern

Riskli alanlar:

- `datasource db.provider = "postgresql"`
- `directUrl` kullanımı
- Postgres migration history
- `migration_lock.toml` provider değeri
- JSON alanlarının MSSQL'de `nvarchar(max)` olarak davranması
- Enum `@map` değerleri ve Türkçe karakterler
- Index / unique constraint isimleri
- Raw SQL veya Postgres'e özel sorgu olup olmadığı

### 4.2 Auth

Ana dosyalar:

- `src/services/supabase.ts`
- `src/services/AuthContext.tsx`
- `src/features/auth/LoginPage.tsx`
- `src/features/auth/SetPasswordPage.tsx`
- `server/db/auth.js`
- `server/routes/auth.js`
- `server/routes/admin.js`
- `server/db/adminRepository.js`
- `prisma/seedAuth.ts`

Bugünkü davranış:

- Frontend Supabase session üretir.
- Frontend BFF çağrılarına Supabase access token gönderir.
- Backend `verifyJwt` token'ı Supabase ile doğrular.
- Backend DB `User` satırını yükler ve `req.user` oluşturur.
- Admin invite/reset/deactivate Supabase Admin API kullanır.

Hedef:

- Frontend auth client soyutlanmalı.
- Backend `verifyJwt` provider bağımsız hale gelmeli.
- `User`, `UserCompany`, `Person` modeli korunmalı.
- Admin kullanıcı yönetimi yeni auth provider'a bağlanmalı.

### 4.3 Storage

Ana dosyalar:

- `server/db/storage.js`
- `server/db/caseRepository.js`
- `src/services/caseService.ts`
- `server/lib/uploadWhitelist.js`

Bugünkü davranış:

- BFF signed upload URL üretir.
- Browser dosyayı doğrudan Supabase Storage'a PUT eder.
- Finalize çağrısı DB attachment kaydı oluşturur.
- Download için signed URL alınır.

Hedef:

- Storage provider interface oluşturulmalı.
- Supabase Storage, MinIO/local/Azure Blob ile değiştirilebilir hale gelmeli.
- Existing `CaseAttachment` metadata modeli mümkün olduğunca korunmalı.

## 5. Faz Planı

### Faz 0 — İzolasyon

Durum: Tamamlandı.

- Ana repo klonlandı.
- Yeni repo oluşturuldu: `Dmrhan/VarunaCaseManagement-MSSQL`
- Çalışma branch'i: `mssql-onprem-migration`
- Başlangıç noktası: production main snapshot

Amaç:

- Ana ürün hattını kirletmeden MSSQL/on-prem spike yürütmek.

### Faz 1 — Portability Audit

Amaç:

MSSQL'e geçişte kırılacak yerleri kod yazmadan netleştirmek.

Kontrol listesi:

- Prisma schema MSSQL uyumu
- Migration history stratejisi
- Raw SQL kullanımı
- JSON alanlarının kullanım biçimi
- Enum mapping uyumu
- Seed scriptlerinin MSSQL uyumu
- Smoke scriptlerinin platform bağımlılıkları
- Supabase Auth kullanımları
- Supabase Storage kullanımları
- Environment variable listesi
- Windows path / shell uyumu

Deliverable:

- `docs/ONPREM_MSSQL_AUDIT.md`
- Risk tablosu
- İlk spike scope'u

### Faz 2 — MSSQL Schema Spike

Amaç:

Boş MSSQL veritabanında Prisma schema'nın ayağa kalkabildiğini kanıtlamak.

Önerilen yaklaşım:

- Mevcut Postgres migration'ları replay edilmeye çalışılmayacak.
- MSSQL için yeni baseline migration üretilecek.
- `provider = "sqlserver"` denenecek.
- `DATABASE_URL` MSSQL connection string olacak.
- `DIRECT_URL` kaldırılacak veya MSSQL için gereksiz hale getirilecek.

Testler:

- `npx prisma validate`
- `npx prisma generate`
- `npx prisma migrate dev` veya baseline deploy
- Minimal seed
- `npm run build`
- Basit read/write smoke

Kritik karar:

Production data migration bu fazda yapılmayacak. Bu sadece schema uyumluluk spike'ıdır.

### Faz 3 — DB Runtime Adaptasyonu

Amaç:

Uygulamanın MSSQL üzerinde temel akışlarla çalışması.

Kapsam:

- `server/db/client.js`
- Repository query kontrolleri
- Pagination / ordering davranışları
- JSON read/write davranışları
- Import commit/rollback akışları
- Case create/list/detail/update
- Account list/detail/search
- Smart Ticket create/close/transfer

Başarı kriteri:

- Local MSSQL veya test MSSQL üzerinde temel operasyonlar yeşil.

### Faz 4 — Auth Provider Ayrıştırma

Amaç:

Supabase Auth'u doğrudan sökmeden önce auth katmanını provider bağımsız hale getirmek.

Önerilen ara interface:

```txt
AuthProvider
- getSession()
- signIn()
- signOut()
- updatePassword()
- getAccessToken()

ServerAuthProvider
- verifyRequest()
- inviteUser()
- resetPassword()
- deactivateUser()
```

Kademeli geçiş:

1. Mevcut Supabase Auth bu interface arkasına alınır.
2. Local JWT provider eklenir.
3. OIDC/AD provider için karar verilir.
4. Supabase Auth bağımlılığı kaldırılır.

Başarı kriteri:

- `req.user` shape'i değişmez.
- Tenant scope (`allowedCompanyIds`) korunur.
- Rol kontrolleri aynı çalışır.

### Faz 5 — Storage Provider Ayrıştırma

Amaç:

Supabase Storage yerine on-prem storage kullanmak.

Önerilen interface:

```txt
StorageProvider
- ensureBucket()
- createUploadUrl(path, options)
- createDownloadUrl(path, options)
- remove(path)
```

Seçenekler:

- MinIO: önerilen ana seçenek
- Local filesystem: sadece dev/test için
- Azure Blob / S3-compatible: müşteri altyapısına göre

Başarı kriteri:

- Dosya upload/download akışı aynı UI ile çalışır.
- `CaseAttachment` metadata modeli korunur.
- Eski Supabase Storage helper kaldırılabilir hale gelir.

### Faz 6 — Supabase Temizliği

Amaç:

DB/Auth/Storage replacement tamamlandıktan sonra Supabase bağımlılığını kaldırmak.

Kapsam:

- `@supabase/supabase-js` dependency kaldırılır.
- `src/services/supabase.ts` kaldırılır veya adapter dışına çıkar.
- `server/db/auth.js` provider bağımsız hale gelir.
- `server/db/storage.js` provider bağımsız hale gelir.
- Supabase env'leri kaldırılır.
- Docs güncellenir.

Başarı kriteri:

- Uygulama Supabase URL/key olmadan çalışır.
- Login, API auth, upload, download, admin user yönetimi çalışır.

### Faz 7 — Veri Taşıma Planı

Bu faz yalnız gerçek production data taşınacaksa uygulanır.

Konular:

- Postgres export stratejisi
- MSSQL import stratejisi
- ID korunumu
- JSON alanlarının taşınması
- Dosya objelerinin Supabase Storage'dan yeni storage'a aktarımı
- Supabase Auth kullanıcılarının yeni auth provider'a taşınması
- Password reset / invite süreci
- Cutover günü read-only freeze
- Rollback planı

Deliverable:

- `docs/ONPREM_DATA_MIGRATION_RUNBOOK.md`

## 6. Windows Kurulum Notları

Windows makinede geliştirme/test yapılabilir; ancak aşağıdaki noktalar kontrol edilmelidir:

- Node.js sürümü aynı major olmalı.
- `npm install` sonrası `npm run build` çalışmalı.
- `node --env-file=.env` destekleyen Node sürümü kullanılmalı.
- PowerShell/CMD quoting farkları smoke scriptlerini etkileyebilir.
- Unix path varsayımları (`/private/tmp`, `/Users/...`) temizlenmeli.
- MSSQL connection string özel karakterleri doğru escape edilmeli.
- Dosya upload için local path ve storage provider netleşmeli.

İlk Windows smoke:

```bash
npm install
npx prisma validate
npm run build
```

MSSQL provider'a geçmeden önce bu smoke yalnız kod tabanının Windows'ta kurulabilir olduğunu gösterir.

## 7. Environment Değişim Taslağı

Bugünkü Supabase ağırlıklı env:

```txt
DATABASE_URL=
DIRECT_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_INVITE_REDIRECT_URL=
```

Hedef on-prem env taslağı:

```txt
DATABASE_URL=sqlserver://...
APP_URL=
AUTH_PROVIDER=local|oidc|ad
JWT_SECRET=
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
STORAGE_PROVIDER=minio|filesystem|azure_blob
STORAGE_BUCKET=case-attachments
MINIO_ENDPOINT=
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
```

Kesin env listesi Faz 4 ve Faz 5 sonunda netleşecektir.

## 8. Açık Kararlar

| Karar | Seçenekler | Öneri |
|---|---|---|
| Auth provider | Local JWT, AD/LDAP, OIDC, Keycloak, Azure AD | OIDC uyumlu tasarım + local fallback |
| Storage | Local disk, MinIO, Azure Blob, S3-compatible | MinIO |
| MSSQL deployment | Local SQL Server, dedicated server, managed SQL | Müşteri altyapısına göre |
| Migration strategy | Existing migrations replay, MSSQL baseline | MSSQL baseline |
| User migration | Password taşınmaz, reset ile geçiş; veya IdP entegrasyonu | Password reset / IdP |
| File migration | Supabase Storage export, manual copy, scripted transfer | Scripted transfer |
| Cron/jobs | Windows Task Scheduler, Node worker, SQL Server Agent | Node worker + scheduler |

## 9. Riskler

| Risk | Etki | Mitigasyon |
|---|---|---|
| Supabase Auth doğrudan sökülürse login kırılır | Yüksek | Önce auth adapter |
| Storage provider geçmeden upload kırılır | Yüksek | Önce storage adapter |
| Postgres migration'ları MSSQL'de replay edilemez | Orta | MSSQL baseline migration |
| JSON alanlarında query ihtiyacı çıkarsa MSSQL performansı düşer | Orta | JSON sadece storage; query app-layer prensibini koru |
| Windows path/shell farkları scriptleri bozar | Orta | Cross-platform script audit |
| Production data migration sırasında ID kaybı | Yüksek | ID korunumu ve dry-run import |
| Kullanıcı şifreleri taşınamaz | Orta | Password reset veya IdP |

## 10. İlk Uygulama Sırası

Önerilen ilk üç PR:

1. `PR-MSSQL-0`: Portability audit dokümanı
2. `PR-MSSQL-1`: Prisma provider spike + MSSQL baseline denemesi
3. `PR-MSSQL-2`: Auth adapter tasarımı, Supabase Auth hâlâ arkasında çalışır

Bu sıralama ana ürün davranışını bozmadan teknik riski azaltır.

## 11. Başarı Kriterleri

On-prem MSSQL geçişi tamamlandı sayılmadan önce:

- Uygulama Supabase env olmadan açılır.
- Kullanıcı login olur.
- Tenant scope doğru çalışır.
- Müşteri listesi açılır.
- Vaka listesi açılır.
- Vaka oluşturulur.
- Smart Ticket oluşturulur, çözülür, devredilir.
- Dosya yüklenir ve indirilir.
- Admin kullanıcı yönetimi çalışır.
- Günlük rapor scripti çalışır.
- `npm run build` yeşil.
- Kritik smoke testleri yeşil.

## 12. Kısa Sonuç

On-prem MSSQL geçişi yapılabilir; mevcut kod tabanı repository pattern ve Prisma
kullanımı sayesinde buna kısmen hazırdır. Ancak Supabase yalnız DB değil, Auth ve
Storage sağlayıcısı olduğu için geçiş kontrollü adapter fazlarıyla yapılmalıdır.

En güvenli yol:

1. Önce MSSQL schema spike
2. Sonra Auth adapter
3. Sonra Storage adapter
4. En son Supabase temizliği ve gerçek veri taşıma

