# Supabase Setup — FAZ 2 BFF + DB

Bu doküman tek seferlik kurulum içindir. Senden 5 dakika sürecek 4 adım var.

---

## 1. Supabase projesi oluştur

1. [supabase.com](https://supabase.com) → **Sign in** (GitHub ile)
2. **New Project** → ayarlar:
   - **Name**: `varuna-case-management` (ya da istediğin)
   - **Database Password**: güçlü bir şifre üret (1Password vb.) — bu şifreyi sakla
   - **Region**: **Frankfurt (eu-central-1)** ← KVKK / EU residency için
   - **Pricing**: Free tier (demo için yeterli)
3. Proje oluşması ~2 dakika sürer

---

## 2. Connection string'leri al

**Project Settings → Database → Connection String** sayfasında 3 sekme:

### A) Transaction pooler (port 6543) — **DATABASE_URL** için
- Vercel serverless ve uygulama runtime için optimal
- Format:
  ```
  postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
  ```
- "URI" sekmesinde göreceksin; `[YOUR-PASSWORD]` yerine az önce kaydettiğin şifreyi yaz

### B) Session pooler (port 5432) — **DIRECT_URL** için
- Prisma migration için (DDL pooler üzerinden çalışmaz)
- Format:
  ```
  postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
  ```

---

## 3. .env'e yaz

Lokal `.env` dosyana ekle (yoksa `.env.example`'dan kopyala):

```env
DATABASE_URL=postgresql://postgres.xxxxx:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
DIRECT_URL=postgresql://postgres.xxxxx:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

**Vercel için aynısını** Project Settings → Environment Variables'a ekle.

---

## 4. Migration + seed çalıştır

Claude'a şu komutu ver: **"DATABASE_URL hazır, migrate ve seed at"**.

Claude şunları yapacak:

```bash
npx prisma migrate dev --name init   # 16 tabloyu Supabase'e oluşturur
npm run db:seed                      # MOCK_* verisini DB'ye taşır
```

Doğrulama: Supabase Dashboard → **Table Editor**'da 19 tablo (16 spec + Company + Account + Person) görünür. `Case` tablosunda 150 satır.

---

## Sonraki adımlar (sonraki oturumda)

- [ ] Frontend: `lookupService` bootstrap pattern'e dönüştür (1 endpoint, React Context)
- [ ] `caseService.ts` `USE_MOCK = false` flip
- [ ] Production'da `prisma migrate deploy` (Vercel build sırasında)
- [ ] Supabase Storage bucket → file upload S3 URL'i (şu an dataUrl in DB)

---

## MSSQL'e geçiş (canlı için ileride)

Tüm soyutlamalar buna göre kuruldu. Geçiş tek dosya değişikliği:

**`prisma/schema.prisma`:**
```diff
- provider = "postgresql"
+ provider = "sqlserver"
```

**`.env`:**
```diff
- DATABASE_URL=postgresql://...
+ DATABASE_URL=sqlserver://localhost:1433;database=Varuna;user=sa;password=...
```

Sonra `npx prisma migrate dev --name init` ile MSSQL'de tabloları oluştur. Tüm uygulama kodu (route'lar, repository'ler, frontend) aynı kalır — Prisma Client provider farkını soyutlar.

**Dikkat noktaları:**
- MSSQL'de Prisma enum'lar nvarchar(50) olarak saklanır (Postgres'te native enum) — değer kümesi aynı, davranış aynı.
- `Json` tipi MSSQL'de `nvarchar(max)` olur — sorgu performansı için index gerekirse computed column eklenir.
- `cuid()` ID'ler MSSQL'de string olarak çalışır.
